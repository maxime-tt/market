package poc

// The cooperative spend: the one primitive behind both terminal money moves.
//
// A bidder locks real proofs to the committee with NUT-11 and keeps the
// secrets. When the lock reaches a terminal state the browser hands the
// coordinator the material for exactly one request, the coordinator checks it
// against committed state, signs the NUT-11 witness with the committee key, and
// swaps at the mint. The fresh proofs are returned in the HTTP response and
// imported by the beneficiary's own wallet. The coordinator persists neither
// the old proofs nor the new ones.
//
// Refund (this slice) and settlement (the next one) differ only in which
// committed state fact authorizes the spend and which Nostr key the outputs are
// locked to. Everything else -- proof-set binding, NUT-07, witness signing,
// swap, unblinding -- lives here once so the two modes cannot drift.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// demoMintSwapTimeout bounds the one mint call that actually moves value. It is
// longer than the admission probe because a swap does real work, but still
// short enough that a wedged mint cannot hold an HTTP request forever.
const demoMintSwapTimeout = 10 * time.Second

// demoMintSpendProof is one bearer proof handed over for a single cooperative
// spend. Unlike the admission binding this carries the secret and the unblinded
// signature, because the mint needs them to spend. It is never logged and never
// stored.
type demoMintSpendProof struct {
	Amount   int64  `json:"amount"`
	KeysetID string `json:"id"`
	Secret   string `json:"secret"`
	C        string `json:"C"`
	// DLEQ is the proof's NUT-12 material, including the blinding factor r.
	// The mint does not need it to spend, but the browser holds it and the
	// request carries the proof whole rather than a lossy projection.
	DLEQ *MintDLEQProof `json:"dleq,omitempty"`
}

// demoMintSpentProof is a fresh proof the beneficiary's wallet imports.
type demoMintSpentProof struct {
	Amount   int64          `json:"amount"`
	KeysetID string         `json:"id"`
	Secret   string         `json:"secret"`
	C        string         `json:"C"`
	DLEQ     *MintDLEQProof `json:"dleq,omitempty"`
}

// demoMintRefundBody is the browser's request. The signed KindRefund event is
// the authorization: it identifies the bid and proves the caller holds the bidder's
// Nostr key. It is never submitted to consensus (a legacy refund of a
// mint-backed bid is refused at admission, see ValidateForMempool).
type demoMintRefundBody struct {
	BidID  string               `json:"bid_id"`
	Proofs []demoMintSpendProof `json:"proofs"`
	Event  SignedEvent          `json:"event"`
}

// demoMintRefundResponse returns the fresh proofs to the bidder's browser.
type demoMintRefundResponse struct {
	Proofs []demoMintSpentProof `json:"proofs"`
}

// cashuHashToCurve is NUT-00's hash_to_curve: SHA-256 over the domain separator
// and the secret, with a little-endian counter, until the digest is a valid
// compressed point. It is the only way to turn a secret into the Y reference
// the receipt is bound to, and it must match the mint and cashu-ts byte for
// byte.
func cashuHashToCurve(secret string) (*btcec.PublicKey, error) {
	// NUT-00 hashes the domain separator and the message once, then iterates
	// SHA-256(inner || counter_le32) until the digest is a valid x coordinate.
	// The extra inner hash is easy to miss and silently produces a different
	// point from every wallet and mint.
	inner := sha256.Sum256(append([]byte("Secp256k1_HashToCurve_Cashu_"), []byte(secret)...))
	for counter := uint32(0); counter < 1<<16; counter++ {
		hash := sha256.New()
		hash.Write(inner[:])
		var encoded [4]byte
		binary.LittleEndian.PutUint32(encoded[:], counter)
		hash.Write(encoded[:])
		digest := hash.Sum(nil)
		candidate := make([]byte, 33)
		candidate[0] = 0x02
		copy(candidate[1:], digest)
		point, err := btcec.ParsePubKey(candidate)
		if err == nil {
			return point, nil
		}
	}
	return nil, errors.New("Cashu secret does not hash to a curve point")
}

// demoMintProofY returns the compressed Y reference for a proof secret.
func demoMintProofY(secret string) (string, error) {
	point, err := cashuHashToCurve(secret)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(point.SerializeCompressed()), nil
}

// demoMintVerifyProofSet binds the submitted bearer proofs to the committed
// receipt. It is the check that stops a caller from swapping arbitrary proofs
// (or a different amount) under the authority of someone else's bid:
//
//   - every secret hashes to a Y in receipt.ProofStateRefs;
//   - the submitted Y set equals the receipt's set exactly;
//   - the submitted amounts sum to at least the lock amount.
//
// It does not ask the mint anything; the caller does that next, fail-closed.
func demoMintVerifyProofSet(receipt CashuLockReceipt, proofs []demoMintSpendProof, minimum int64) error {
	if len(proofs) == 0 || len(proofs) > MaxInputs {
		return errors.New("cooperative spend requires a bounded nonempty proof set")
	}
	if len(receipt.ProofStateRefs) == 0 {
		return errors.New("committed receipt carries no proof references")
	}
	submitted := make([]string, 0, len(proofs))
	seen := map[string]bool{}
	var total int64
	for index, proof := range proofs {
		if proof.Amount <= 0 || proof.KeysetID == "" {
			return fmt.Errorf("proof %d has no positive amount or keyset", index)
		}
		if proof.Secret == "" || len(proof.Secret) > 4096 {
			return fmt.Errorf("proof %d has an invalid secret", index)
		}
		if !validCompressedPublicKey(proof.C) {
			return fmt.Errorf("proof %d has an invalid unblinded signature", index)
		}
		reference, err := demoMintProofY(proof.Secret)
		if err != nil {
			return fmt.Errorf("proof %d: %w", index, err)
		}
		if seen[reference] {
			return errors.New("cooperative spend proof set contains a duplicate secret")
		}
		seen[reference] = true
		submitted = append(submitted, reference)
		if proof.Amount > (1<<62)-total {
			return errors.New("cooperative spend proof amounts overflow")
		}
		total += proof.Amount
	}
	expected := append([]string(nil), receipt.ProofStateRefs...)
	sort.Strings(expected)
	sort.Strings(submitted)
	if strings.Join(submitted, ",") != strings.Join(expected, ",") {
		return errors.New("submitted proofs do not match the committed receipt's proof references")
	}
	if total < minimum {
		return fmt.Errorf("submitted proofs total %d sats, less than the locked %d", total, minimum)
	}
	return nil
}

// demoMintCooperativeSpend performs the one swap both terminal modes share.
//
// It builds outputs P2PK-locked to `02||recipient` with no locktime, signs the
// NUT-11 SIG_INPUTS witness with the committee key over each input secret, and
// posts /v1/swap to the mint's transport origin. It returns the unblinded fresh
// proofs; it does not persist them.
func (server *APIServer) demoMintCooperativeSpend(ctx context.Context, proofs []demoMintSpendProof, recipient string) ([]demoMintSpentProof, error) {
	if server.demoCommitteeKey == nil {
		return nil, errors.New("cooperative spend has no committee key")
	}
	if server.demoMintKeyset == nil {
		return nil, errors.New("cooperative spend has no mint keyset")
	}
	if !validActor(recipient) {
		return nil, errors.New("cooperative spend recipient is not a Nostr public key")
	}
	if len(proofs) == 0 || len(proofs) > MaxInputs {
		return nil, errors.New("cooperative spend requires a bounded nonempty proof set")
	}
	keysetID := proofs[0].KeysetID
	for _, proof := range proofs {
		if proof.KeysetID != keysetID {
			return nil, errors.New("cooperative spend proofs span more than one keyset")
		}
	}
	keyset, err := server.demoMintKeyset.Keyset(keysetID)
	if err != nil {
		return nil, err
	}

	// The output secret is a fresh P2PK condition naming the beneficiary. No
	// refund tag and no locktime: the beneficiary can spend it immediately, and
	// nobody else can.
	outputs := make([]mintSwapOutput, 0, len(proofs))
	blinding := make([]*btcec.PrivateKey, 0, len(proofs))
	secrets := make([]string, 0, len(proofs))
	for _, proof := range proofs {
		secret, err := demoMintP2PKSecret(recipient)
		if err != nil {
			return nil, err
		}
		blinder, err := btcec.NewPrivateKey()
		if err != nil {
			return nil, err
		}
		Y, err := cashuHashToCurve(secret)
		if err != nil {
			return nil, err
		}
		curve := btcec.S256()
		blinderBytes := blinder.Key.Bytes()
		rGx, rGy := curve.ScalarBaseMult(blinderBytes[:])
		bx, by := curve.Add(Y.X(), Y.Y(), rGx, rGy)
		outputs = append(outputs, mintSwapOutput{
			Amount: proof.Amount,
			ID:     keysetID,
			B_:     hex.EncodeToString(compressedPoint(bx, by)),
		})
		blinding = append(blinding, blinder)
		secrets = append(secrets, secret)
	}

	inputs := make([]mintSwapInput, 0, len(proofs))
	for _, proof := range proofs {
		// NUT-11 signs the SHA-256 of the secret: BIP-340 takes a 32-byte
		// message, and cashu-ts and Nutshell both hash the secret first.
		digest := sha256.Sum256([]byte(proof.Secret))
		signature, err := schnorr.Sign(server.demoCommitteeKey, digest[:])
		if err != nil {
			return nil, fmt.Errorf("cooperative spend witness signing failed: %w", err)
		}
		witness, err := json.Marshal(map[string][]string{"signatures": {hex.EncodeToString(signature.Serialize())}})
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, mintSwapInput{
			Amount: proof.Amount, ID: proof.KeysetID, Secret: proof.Secret,
			C: proof.C, Witness: string(witness),
		})
	}

	payload, err := json.Marshal(mintSwapRequest{Inputs: inputs, Outputs: outputs})
	if err != nil {
		return nil, err
	}
	origin := mintTransportOrigin(server.manifest.CashuMintURL)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/v1/swap", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: demoMintSwapTimeout}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("mint swap request failed: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		// The mint's refusal text is safe to surface: it names the condition
		// (spent, wrong signature) and carries no secret.
		return nil, fmt.Errorf("mint refused the cooperative swap (status %d): %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var signed mintSwapResponse
	if err := json.Unmarshal(body, &signed); err != nil {
		return nil, fmt.Errorf("mint swap response is not a NUT-03 document: %w", err)
	}
	if len(signed.Signatures) != len(outputs) {
		return nil, errors.New("mint returned a different number of signatures than outputs")
	}

	fresh := make([]demoMintSpentProof, 0, len(outputs))
	for index, signature := range signed.Signatures {
		amount := outputs[index].Amount
		mintKey, published := keyset.Keys[amount]
		if !published || mintKey == nil {
			return nil, fmt.Errorf("mint published no key for amount %d", amount)
		}
		blinded, err := btcec.ParsePubKey(mustHex(signature.C_))
		if err != nil {
			return nil, errors.New("mint returned an invalid blind signature")
		}
		unblinded := unblindSignature(blinded, blinding[index], mintKey)
		proof := demoMintSpentProof{
			Amount: amount, KeysetID: keysetID, Secret: secrets[index],
			C: hex.EncodeToString(unblinded.SerializeCompressed()),
		}
		if signature.DLEQ != nil && signature.DLEQ.E != "" && signature.DLEQ.S != "" {
			blinderBytes := blinding[index].Key.Bytes()
			proof.DLEQ = &MintDLEQProof{E: signature.DLEQ.E, S: signature.DLEQ.S, R: hex.EncodeToString(blinderBytes[:])}
		}
		fresh = append(fresh, proof)
	}
	return fresh, nil
}

// demoMintP2PKSecret builds the NUT-11 secret cashu-ts's P2PKBuilder emits for
// a single main pubkey with SIG_INPUTS and no locktime.
func demoMintP2PKSecret(recipient string) (string, error) {
	if !validActor(recipient) {
		return "", errors.New("P2PK recipient is not a Nostr public key")
	}
	nonceBytes := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, nonceBytes); err != nil {
		return "", err
	}
	secret := []any{
		"P2PK",
		map[string]any{
			"nonce": hex.EncodeToString(nonceBytes),
			"data":  "02" + recipient,
			"tags":  [][]string{{"sigflag", "SIG_INPUTS"}},
		},
	}
	encoded, err := json.Marshal(secret)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// unblindSignature computes C = C_ - r*A, the NUT-00 step3_alice operation.
func unblindSignature(blinded *btcec.PublicKey, r *btcec.PrivateKey, A *btcec.PublicKey) *btcec.PublicKey {
	curve := btcec.S256()
	rBytes := r.Key.Bytes()
	rAx, rAy := curve.ScalarMult(A.X(), A.Y(), rBytes[:])
	negY := new(big.Int).Sub(curve.Params().P, rAy)
	cx, cy := curve.Add(blinded.X(), blinded.Y(), rAx, negY)
	point, err := btcec.ParsePubKey(compressedPoint(cx, cy))
	if err != nil {
		// The arithmetic above is on the curve, so this cannot happen; return
		// the blinded point rather than a nil that would panic later.
		return blinded
	}
	return point
}

func compressedPoint(x, y *big.Int) []byte {
	encoded := make([]byte, 33)
	if y.Bit(0) == 0 {
		encoded[0] = 0x02
	} else {
		encoded[0] = 0x03
	}
	x.FillBytes(encoded[1:])
	return encoded
}

func mustHex(value string) []byte {
	decoded, _ := hex.DecodeString(value)
	return decoded
}

// mintSwapInput / mintSwapOutput / mintSwapResponse are the NUT-03 wire shapes.
type mintSwapInput struct {
	Amount  int64  `json:"amount"`
	ID      string `json:"id"`
	Secret  string `json:"secret"`
	C       string `json:"C"`
	Witness string `json:"witness"`
}

type mintSwapOutput struct {
	Amount int64  `json:"amount"`
	ID     string `json:"id"`
	B_     string `json:"B_"`
}

type mintSwapRequest struct {
	Inputs  []mintSwapInput  `json:"inputs"`
	Outputs []mintSwapOutput `json:"outputs"`
}

type mintSwapResponse struct {
	Signatures []struct {
		ID     string         `json:"id"`
		Amount int64          `json:"amount"`
		C_     string         `json:"C_"`
		DLEQ   *MintDLEQProof `json:"dleq"`
	} `json:"signatures"`
}

// demoMintRefund returns a displaced bidder's locked proofs to their own Nostr
// key. The signed KindRefund event authorizes it; committed state and the mint
// decide whether it is allowed.
func (server *APIServer) demoMintRefund(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim || server.manifest.ApplicationAuthority != ApplicationAuthorityLegacy {
		writeError(response, http.StatusNotFound, errors.New("demo mint-refund coordinator is available only on a legacy loopback network"))
		return
	}
	if server.demoCommitteeKey == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo mint-refund coordinator has no committee key"))
		return
	}
	if server.demoMintChecker == nil || server.demoMintKeyset == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo mint-refund coordinator has no mint"))
		return
	}
	var body demoMintRefundBody
	if err := decodeBody(request, &body); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validIdentifier(body.BidID) {
		writeError(response, http.StatusBadRequest, errors.New("demo mint refund requires a valid bid id"))
		return
	}

	// (a) The event is the authorization. Verify its signature with the same
	// code path /api/event uses, require the refund kind, and require the
	// signer to be the lock's bidder. The content must name this bid, so an
	// authorization for one bid cannot be replayed against another.
	bidder, err := VerifyNostrEvent(body.Event)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("refund authorization is not a valid Nostr event: %w", err))
		return
	}
	if body.Event.Kind != KindRefund {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("refund authorization must be a KindRefund (%d) event", KindRefund))
		return
	}
	var content refundContent
	if err := decodeStrictContent(body.Event.Content, &content); err != nil {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("refund authorization content is invalid: %w", err))
		return
	}
	if content.BidID != body.BidID {
		writeError(response, http.StatusUnprocessableEntity, errors.New("refund authorization names a different bid"))
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 4*time.Second)
	defer cancel()
	snapshot, err := server.demoCommittedState(ctx)
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, err)
		return
	}

	// (b) Committed state must say this lock is refundable and belongs to the
	// signer. The lock is keyed by bid id.
	lock, exists := snapshot.Locks[body.BidID]
	if !exists {
		writeError(response, http.StatusNotFound, errors.New("bid lock not found in committed state"))
		return
	}
	if lock.Bidder != bidder {
		writeError(response, http.StatusForbidden, errors.New("refund authorization signer is not the lock's bidder"))
		return
	}
	if lock.Status != "refundable" {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("bid lock is %q, not refundable", lock.Status))
		return
	}
	bid, exists := snapshot.Bids[body.BidID]
	if !exists || bid.CashuTokenSHA256 == "" {
		writeError(response, http.StatusUnprocessableEntity, errors.New("bid is not mint-backed, so it has no cooperative refund"))
		return
	}
	receipt, exists := snapshot.CashuLocks[bid.CashuTokenSHA256]
	if !exists {
		writeError(response, http.StatusUnprocessableEntity, errors.New("committed receipt for the bid is missing"))
		return
	}

	// (c) and (d): the submitted material must be exactly the committed proof
	// set, and must cover the locked amount.
	if err := demoMintVerifyProofSet(receipt, body.Proofs, lock.Amount); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}

	// (e) The mint must still see every proof as UNSPENT. Fail closed on any
	// uncertainty; a SPENT proof means the refund already happened (or someone
	// else spent it), and swapping again would be a double spend attempt.
	if err := VerifyCashuLockProofsAtMint(server.demoMintChecker, receipt); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}

	// The state query is bounded tightly; the swap does real work and gets its
	// own, longer deadline.
	swapCtx, swapCancel := context.WithTimeout(request.Context(), demoMintSwapTimeout)
	defer swapCancel()
	fresh, err := server.demoMintCooperativeSpend(swapCtx, body.Proofs, bidder)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	writeJSON(response, http.StatusOK, demoMintRefundResponse{Proofs: fresh})
}
