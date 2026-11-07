package poc

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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

// VerifyCashuLockProofsAtMint asks the mint whether every proof reference bound
// by the receipt is currently unspent, and refuses the transaction unless every
// single one is confirmed UNSPENT.
//
// It fails closed on every uncertainty: an unreachable mint, a non-200
// response, a malformed document, or a reference the mint did not answer for.
// SPENT and PENDING are both refusals -- PENDING means another spend of the
// same proof is already in flight, which is exactly the double-spend this check
// exists to catch.
func VerifyCashuLockProofsAtMint(checker MintStateChecker, receipt CashuLockReceipt) error {
	if checker == nil {
		return errors.New("no mint state checker is configured")
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
