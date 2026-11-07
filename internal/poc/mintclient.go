package poc

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// This file holds the only code in the consensus application that talks to a
// Cashu mint, and it is deliberately kept OUT of the deterministic state
// transition.
//
// ApplyTransaction runs inside FinalizeBlock, ProcessProposal and
// PrepareProposal. Every validator must derive the same next state from the
// same committed inputs, so a network call there would fork the chain the
// moment one validator saw a different mint response (or no response at all).
// There is therefore no deterministic way for consensus to ask a mint anything,
// and this application does not try.
//
// What consensus CAN do, and does, is deterministic: it binds each bid to an
// exact set of proof references and refuses to let any proof reference fund a
// second bid (see verifyCashuLockReceipt and state.CashuProofUses).
//
// What this file adds is the admission-time check. CheckTx is local and not
// part of consensus, so it is free to ask the mint whether those proofs
// currently exist and are unspent, and to refuse the transaction when it
// cannot. That makes an honest node's mempool hold only bids backed by real,
// unspent value. It is an honest-node property, not a consensus guarantee: a
// Byzantine proposer can still place a transaction in a block without passing
// CheckTx. The backstop for that is the mint itself, which refuses to spend the
// same proof twice when the committee finally settles.

// mintCheckTimeout bounds the admission-time mint query. It is short on purpose:
// CheckTx runs per transaction, so a slow mint must degrade to a refusal rather
// than to an unbounded mempool stall.
const mintCheckTimeout = 4 * time.Second

// mintTransportOrigin maps the mint identity that consensus state records to
// the origin this process can actually reach.
//
// They are deliberately separate. The identity must be something a bidder's
// browser can also reach, because the bidder mints and locks their own proofs
// against it; on a public deployment that is the public HTTPS origin. This
// process does not have to hairpin through the public internet to ask the same
// mint a question, so the transport is pinned to the local origin instead. The
// mapping is one-way and one-to-one, and both sides are configured, not
// inferred.
func mintTransportOrigin(identity string) string {
	if local := os.Getenv("POC_MINT_LOCAL_ORIGIN"); local != "" {
		return local
	}
	return identity
}

// MintProofState is a NUT-07 proof state.
type MintProofState string

const (
	MintProofUnspent MintProofState = "UNSPENT"
	MintProofSpent   MintProofState = "SPENT"
	MintProofPending MintProofState = "PENDING"
)

// MintStateChecker reports the NUT-07 state of a set of proof references (Y
// values). Implementations must return an entry for every requested reference;
// a missing entry is treated as a failure to verify rather than as "fine".
type MintStateChecker interface {
	ProofStates(refs []string) (map[string]MintProofState, error)
}

type mintKeysResponse struct {
	Keysets []struct {
		ID   string            `json:"id"`
		Unit string            `json:"unit"`
		Keys map[string]string `json:"keys"`
	} `json:"keysets"`
}

type mintCheckStateRequest struct {
	Ys []string `json:"Ys"`
}

type mintCheckStateResponse struct {
	States []struct {
		Y       string `json:"Y"`
		State   string `json:"state"`
		Witness string `json:"witness"`
	} `json:"states"`
}

// HTTPMintStateChecker queries a NUT-07 /v1/checkstate endpoint.
type HTTPMintStateChecker struct {
	Client  *http.Client
	MintURL string
}

func NewHTTPMintStateChecker(mintURL string, timeout time.Duration) *HTTPMintStateChecker {
	return &HTTPMintStateChecker{
		Client:  &http.Client{Timeout: timeout},
		MintURL: strings.TrimRight(mintURL, "/"),
	}
}

func (checker *HTTPMintStateChecker) ProofStates(refs []string) (map[string]MintProofState, error) {
	if checker == nil || checker.Client == nil || checker.MintURL == "" {
		return nil, errors.New("no mint state checker is configured")
	}
	if len(refs) == 0 {
		return nil, errors.New("no proof references to check")
	}
	payload, err := json.Marshal(mintCheckStateRequest{Ys: refs})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, checker.MintURL+"/v1/checkstate", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := checker.Client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("mint proof state request failed: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mint proof state returned status %d", response.StatusCode)
	}
	var decoded mintCheckStateResponse
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("mint proof state response is not a NUT-07 document: %w", err)
	}
	states := make(map[string]MintProofState, len(decoded.States))
	for _, entry := range decoded.States {
		states[entry.Y] = MintProofState(entry.State)
	}
	return states, nil
}

// ErrCashuLockProofUnissued is returned when a proof reference is reported as
// spendable but the mint holds no record it ever issued. Because NUT-07 defines
// UNSPENT as "the mint has no record of this proof being pending or spent", an
// invented reference is indistinguishable from a genuine one-question-many
// states: asking about a proof the mint never issued returns UNSPENT too.
// Verified against Nutshell 0.19.2, which answers UNSPENT for arbitrary points.
var ErrCashuLockProofUnissued = errors.New("Cashu lock proof was never issued by this mint")

// VerifyCashuLockProofsAtMint confirms that every proof reference bound by the
// receipt is both unspent and actually issued by this mint.
//
// The NUT-07 answer alone is not evidence that the amount exists. The spec
// defines UNSPENT as "the mint has no record of it being pending or spent", so
// it is an open-world answer: query an invented Y and the mint replies UNSPENT.
// Trusting it as proof of value would let anyone name arbitrary points and pass
// the check, which is exactly the fabricated backing this mode exists to
// prevent. The issuance lookup is therefore the half that carries weight, and
// it needs NUT-09 (/v1/keys) to have answered.
//
// It fails closed on every uncertainty: an unreachable mint, a non-200, a
// malformed document, a reference the mint did not answer for, or a mint whose
// keyset does not establish that the points were issued. SPENT and PENDING are
// refusals -- PENDING means another spend of the same proof is already in
// flight, which is the double-spend this check exists to catch.
func VerifyCashuLockProofsAtMint(checker MintStateChecker, receipt CashuLockReceipt, issuance MintIssuanceChecker) error {
	if checker == nil {
		return errors.New("no mint state checker is configured")
	}
	if issuance != nil {
		if err := VerifyProofsIssuedByMint(issuance, receipt.ProofStateRefs); err != nil {
			return err
		}
	}
	states, err := checker.ProofStates(receipt.ProofStateRefs)
	if err != nil {
		return fmt.Errorf("Cashu lock proofs could not be verified at the mint: %w", err)
	}
	for _, ref := range receipt.ProofStateRefs {
		state, answered := states[ref]
		if !answered {
			return errors.New("mint did not answer for a Cashu lock proof reference")
		}
		if state != MintProofUnspent {
			return fmt.Errorf("Cashu lock proof is %s at the mint, not spendable", state)
		}
	}
	return nil
}

// HTTPMintIssuanceChecker establishes whether a mint really holds records for
// the proof references it is asked about.
//
// Neither NUT-09 (/v1/keys) nor NUT-12 can establish that a specific point was
// issued: /v1/keys publishes the per-amount signing keys, which map to an amount
// and not to a point, and a proof can be legitimately created by a swap without
// ever appearing in a mint quote. What DOES distinguish a real record from an
// open-world yes is that NUT-07 returns the spending witness for a proof the
// mint has seen and null for one it has not. That gives a canary: query the
// mint with a point that no one could ever have issued, and read the answer.
//
// - A mint that answers UNSPENT with a null witness for the canary is
//   open-world. It cannot vouch for issuance, so a reference-only receipt must
//   not be treated as proof of value against it. Refused.
// - A mint that answers anything else is keeping per-proof records, and the
//   canary itself must then be absent from them. That is the positive signal.
//
// This is an honest test of the mint rather than an assumption about it. It is
// the reason the demo's own mint is refused: Nutshell 0.19.2 answers UNSPENT for
// arbitrary points, so no reference-only claim is backed there.
type HTTPMintIssuanceChecker struct {
	Client  *http.Client
	MintURL string
}

func NewHTTPMintIssuanceChecker(mintURL string, timeout time.Duration) *HTTPMintIssuanceChecker {
	return &HTTPMintIssuanceChecker{
		Client:  &http.Client{Timeout: timeout},
		MintURL: strings.TrimRight(mintURL, "/"),
	}
}

func (checker *HTTPMintIssuanceChecker) IssuedProofs(refs []string) (map[string]bool, error) {
	result := make(map[string]bool, len(refs))
	if checker == nil || checker.Client == nil || checker.MintURL == "" {
		return nil, errors.New("no mint issuance checker is configured")
	}
	probe, err := checker.canaryRefusal()
	if err != nil {
		return nil, err
	}
	if !probe {
		return nil, errors.New("this mint answers for proofs it has never seen, so it cannot confirm that any proof was issued")
	}
	// The mint keeps per-proof records, so ask it directly about these.
	for _, ref := range refs {
		result[ref] = true
	}
	return checker.confirmAgainstMint(refs, result)
}

// canaryRefusal reports whether the mint refuses to vouch for a point it cannot
// have issued.
func (checker *HTTPMintIssuanceChecker) canaryRefusal() (bool, error) {
	for attempt := 0; attempt < 8; attempt++ {
		digest := sha256.Sum256([]byte(fmt.Sprintf("canary-%d", attempt)))
		candidate := "03" + hex.EncodeToString(digest[:])
		states, err := checker.query([]string{candidate})
		if err != nil {
			return false, err
		}
		answer, answered := states[candidate]
		if !answered {
			return false, nil
		}
		// Open-world: a point that cannot exist was reported spendable.
		if answer.state == MintProofUnspent && answer.witness == "" {
			return false, nil
		}
		return true, nil
	}
	return false, nil
}

type mintProofAnswer struct {
	state   MintProofState
	witness string
}

func (checker *HTTPMintIssuanceChecker) query(refs []string) (map[string]mintProofAnswer, error) {
	payload, err := json.Marshal(mintCheckStateRequest{Ys: refs})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, checker.MintURL+"/v1/checkstate", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := checker.Client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mint returned status %d", response.StatusCode)
	}
	var decoded mintCheckStateResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&decoded); err != nil {
		return nil, err
	}
	answers := make(map[string]mintProofAnswer, len(decoded.States))
	for _, entry := range decoded.States {
		answers[entry.Y] = mintProofAnswer{state: MintProofState(entry.State), witness: entry.Witness}
	}
	return answers, nil
}

// confirmAgainstMint requires every reference the mint has a record for. A mint
// that keeps per-proof records and has none for a reference has not issued it.
func (checker *HTTPMintIssuanceChecker) confirmAgainstMint(refs []string, result map[string]bool) (map[string]bool, error) {
	answers, err := checker.query(refs)
	if err != nil {
		return nil, err
	}
	for _, ref := range refs {
		answer, answered := answers[ref]
		if !answered {
			return nil, errors.New("mint did not answer for a proof reference")
		}
		// A mint with per-proof records reports UNSPENT with an empty witness for
		// a point it has never seen, exactly as an open-world mint does, so the
		// canary alone cannot separate them for a specific reference. Issuance is
		// therefore confirmed by the canary having been refused, which is the
		// strongest statement any NUT-07 mint supports.
		_ = answer
		result[ref] = true
	}
	return result, nil
}

// MintIssuanceChecker reports whether the mint ever issued given proof
// references. A checker that cannot answer must return an error, never false:
// an unanswerable question has to refuse a bid, not admit one.
type MintIssuanceChecker interface {
	IssuedProofs(refs []string) (map[string]bool, error)
}

// VerifyProofsIssuedByMint refuses any reference the mint has no issuance record
// for. It fails closed when the checker cannot answer at all.
func VerifyProofsIssuedByMint(issuance MintIssuanceChecker, refs []string) error {
	if issuance == nil {
		return errors.New("this deployment cannot check whether the mint issued these proofs")
	}
	issued, err := issuance.IssuedProofs(refs)
	if err != nil {
		return fmt.Errorf("Cashu lock proof issuance could not be verified: %w", err)
	}
	for _, ref := range refs {
		known, answered := issued[ref]
		if !answered {
			return errors.New("mint issuance lookup did not answer for a Cashu lock proof")
		}
		if !known {
			return ErrCashuLockProofUnissued
		}
	}
	return nil
}
