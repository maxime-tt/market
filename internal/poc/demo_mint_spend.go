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
// Refund and settlement differ only in which committed state fact authorizes
// the spend and which key the outputs are locked to. Everything else --
// proof-set binding, NUT-07, witness signing, swap, unblinding -- lives here
// once so the two modes cannot drift.
//
// Settlement has one extra problem the refund does not: the caller is the
// WINNER's browser, and the beneficiary is the SELLER, who is not in the
// request. The fresh proofs are therefore parked in a small server-side store
// keyed by auction id and fetched by the seller's own browser. That is safe to
// publish: every proof is P2PK-locked to the seller's committed wallet key, so
// holding the bytes confers no ability to spend them.

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
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
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

// demoMintRefundBody is the browser's request. It carries two independent
// proofs, and both are required:
//
//   - the signed KindRefund event is the AUTHORIZATION: it names the bid and
//     proves the caller holds the bidder's Nostr key. It is never submitted to
//     consensus (a legacy refund of a mint-backed bid is refused at admission,
//     see ValidateForMempool).
//   - SpendSignature is OWNERSHIP: a BIP-340 signature by the wallet's own
//     Cashu spend key over the V2 refund claim message
//     (bidOutcomeRefundClaimMessageV2), binding the auction, the committed
//     proof set and the exact output pubkeys. The Nostr identity authorizes;
//     the wallet owns value and owns its own spend key. The two are linked by
//     this authorization, never by deriving one key from the other.
type demoMintRefundBody struct {
	BidID  string               `json:"bid_id"`
	Proofs []demoMintSpendProof `json:"proofs"`
	Event  SignedEvent          `json:"event"`
	// SpendPublicKey is the wallet spend key, compressed. The returned proofs
	// are locked to it.
	SpendPublicKey string `json:"spend_public_key"`
	// OutputPublicKeys is one compressed key per submitted proof, in proof
	// order. The coordinator builds the same list itself and refuses any
	// difference, so the signature binds exactly the outputs it creates.
	OutputPublicKeys []string `json:"output_public_keys"`
	// SpendSignature is the hex BIP-340 signature over the claim message.
	SpendSignature string `json:"spend_signature"`
}

// demoMintVerifyRefundOwnership checks the wallet spend-key half of a refund
// against the V2 consent message. The old V1 bound the bid event id, which is
// unknowable when the bid -- and therefore the consent -- is signed, so V2 binds
// only what is known at bid time. Both the live refund endpoint and the
// coordinator's offline sweeper call this one function over the same bytes
// (bidOutcomeRefundClaimMessageV2 in model.go), and the bidder's bid-time
// signature is verified by the identical message, so the three cannot drift.
//
// outputPublicKeys are the wallet spend key repeated once per committed proof,
// which is the only destination a refund may use.
func demoMintVerifyRefundOwnership(auctionID string, proofRefs []string, spendPublicKey, spendSignature string) (string, error) {
	if spendPublicKey == "" {
		return "", errors.New("refund claim carries no wallet spend key")
	}
	if !validCompressedPublicKey(spendPublicKey) {
		return "", errors.New("refund claim wallet spend key is not a valid compressed secp256k1 point")
	}
	if spendSignature == "" {
		return "", errors.New("refund claim carries no wallet spend-key signature")
	}
	if !validLowerHex(spendSignature, 64) {
		return "", errors.New("refund claim wallet spend-key signature is not a 64-byte hex Schnorr signature")
	}
	// schnorr.ParsePubKey takes the 32-byte x-only form, so the compressed key
	// is parsed as a curve point and then lifted to its BIP-340 x-only form.
	// Passing the 33-byte compressed encoding straight in is refused.
	point, err := btcec.ParsePubKey(mustHex(spendPublicKey))
	if err != nil {
		return "", errors.New("refund claim wallet spend key is not a valid compressed secp256k1 point")
	}
	spendKey, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
	if err != nil {
		return "", errors.New("refund claim wallet spend key is not a valid compressed secp256k1 point")
	}
	signature, err := schnorr.ParseSignature(mustHex(spendSignature))
	if err != nil {
		return "", errors.New("refund claim wallet spend-key signature is malformed")
	}
	outputs := make([]string, len(proofRefs))
	for index := range outputs {
		outputs[index] = spendPublicKey
	}
	message := bidOutcomeRefundClaimMessageV2(auctionID, proofRefs, outputs)
	if !signature.Verify(sha256Sum(message), spendKey) {
		return "", errors.New("refund claim wallet spend-key signature does not verify over the auction id, proof set and output keys")
	}
	return spendPublicKey, nil
}

// demoMintVerifyRefundClaim is the live endpoint's wrapper. It checks the shape
// of the submitted output-key list -- exactly one key per committed proof, all
// of them the wallet spend key -- and then verifies the V2 claim against
// committed state. The committed proof references, not the caller's submitted
// list, are what the signature binds, so a caller cannot point the claim at a
// proof set the receipt never committed.
func demoMintVerifyRefundClaim(body demoMintRefundBody, auctionID string, proofRefs []string) (string, error) {
	if body.SpendPublicKey == "" {
		return "", errors.New("refund claim carries no wallet spend key")
	}
	if !validCompressedPublicKey(body.SpendPublicKey) {
		return "", errors.New("refund claim wallet spend key is not a valid compressed secp256k1 point")
	}
	if len(body.OutputPublicKeys) != len(proofRefs) {
		return "", fmt.Errorf("refund claim names %d output keys for %d committed proofs", len(body.OutputPublicKeys), len(proofRefs))
	}
	for index, key := range body.OutputPublicKeys {
		if key != body.SpendPublicKey {
			return "", fmt.Errorf("refund claim output %d is not locked to the wallet spend key", index)
		}
	}
	return demoMintVerifyRefundOwnership(auctionID, proofRefs, body.SpendPublicKey, body.SpendSignature)
}

// sha256Sum is the BIP-340 message digest: the claim message is hashed once so
// the signature covers a fixed 32-byte message.
func sha256Sum(message []byte) []byte {
	digest := sha256.Sum256(message)
	return digest[:]
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
// It builds outputs P2PK-locked to the recipient's compressed key with no
// locktime, signs the NUT-11 SIG_INPUTS witness with the committee key over
// each input secret, and posts /v1/swap to the mint's transport origin. It
// returns the unblinded fresh proofs; it does not persist them.
//
// The recipient is a Cashu spend key, not a Nostr identity: the value must come
// back to a key its owner can actually sign with.
func (server *APIServer) demoMintCooperativeSpend(ctx context.Context, proofs []demoMintSpendProof, intent committeeSpendIntent) ([]demoMintSpentProof, error) {
	if server.demoMintKeyset == nil {
		return nil, errors.New("cooperative spend has no mint keyset")
	}
	if len(proofs) == 0 || len(proofs) > MaxInputs {
		return nil, errors.New("cooperative spend requires a bounded nonempty proof set")
	}
	// RELEASE CHECK. This is the committee signing boundary: before the port
	// produces a signature, the server re-derives from its OWN committed state
	// that this spend is authorized and that its destination is the committed
	// one, and refuses by name otherwise. It catches a non-colluding fault (a
	// stale or forged request, a substituted destination) that its own state
	// contradicts; it does NOT stop a hacked majority, and CommitteeSigner
	// still holds one local key, not threshold custody. See release_check.go.
	if _, err := server.releaseCheck(ctx, intent, proofs); err != nil {
		return nil, err
	}
	recipient := intent.Recipient
	signer, err := server.committeeSigner()
	if err != nil {
		return nil, err
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
		// The committee's half of the spend goes through the port, which is
		// the one place a committee spend signature is produced. Today it is a
		// single local key; a FROST aggregate will replace it behind the same
		// call without changing the mint's view.
		signature, err := signer.SignDigest(digest[:])
		if err != nil {
			return nil, fmt.Errorf("cooperative spend witness signing failed: %w", err)
		}
		witness, err := json.Marshal(map[string][]string{"signatures": {hex.EncodeToString(signature)}})
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
// a single main pubkey with SIG_INPUTS and no locktime. The recipient is a
// compressed secp256k1 key, used verbatim: a wallet spend key may be odd-Y, so
// it must not be re-encoded as `02||x`.
func demoMintP2PKSecret(recipient string) (string, error) {
	if !validCompressedPublicKey(recipient) {
		return "", errors.New("P2PK recipient is not a compressed secp256k1 public key")
	}
	nonceBytes := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, nonceBytes); err != nil {
		return "", err
	}
	secret := []any{
		"P2PK",
		map[string]any{
			"nonce": hex.EncodeToString(nonceBytes),
			"data":  recipient,
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

// demoMintRefund returns a displaced bidder's locked proofs to their own wallet
// spend key. Two checks must both pass: the signed KindRefund event authorizes
// the request (it names the bid and proves the caller holds the bidder's Nostr
// key), and a signature by the wallet spend key proves ownership of the value
// being returned. Committed state and the mint decide whether it is allowed.
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

	// The wallet spend-key ownership half (a2) is verified below, once the
	// committed receipt is known: the V2 claim binds the committed proof set,
	// which is not caller-supplied, so it cannot be checked before the lock and
	// receipt are read.

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
	// A refund the coordinator already performed -- the background sweeper acts
	// when the bidder is offline -- is parked under the bid id. The bidder
	// collects it later; the authorization above is the same one this endpoint
	// would require, and the parked proofs are P2PK-locked to the bidder's own
	// committed refund key, so handing them over returns nothing the caller
	// does not already own. Swapping again is impossible anyway: those inputs
	// are spent at the mint.
	if parked, ok := server.demoSettlements.get(body.BidID); ok && lock.Status == "refunded" {
		writeJSON(response, http.StatusOK, demoMintRefundResponse{Proofs: parked})
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
	// set, and must cover the locked amount. Checked before ownership so the
	// signature is verified over material the receipt actually committed.
	if err := demoMintVerifyProofSet(receipt, body.Proofs, lock.Amount); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}

	// (a2) The wallet spend key is the ownership half: a key the wallet
	// generated and holds, never one derived from the Nostr identity. The V2
	// claim binds the auction, the committed proof set and the exact output
	// keys, so a valid Nostr authorization without it would prove who is asking
	// but not that the returned value lands somewhere they can spend.
	spendPublicKey, err := demoMintVerifyRefundClaim(body, lock.AuctionID, receipt.ProofStateRefs)
	if err != nil {
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
	fresh, err := server.demoMintCooperativeSpend(swapCtx, body.Proofs, committeeSpendIntent{
		Outcome: "refund", AuctionID: lock.AuctionID, BidID: body.BidID, Recipient: spendPublicKey,
	})
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	writeJSON(response, http.StatusOK, demoMintRefundResponse{Proofs: fresh})
}

// demoMintSettleBody is the winner's settlement request. It names the auction
// rather than the bid: the winning bid is committed state (auction.LeaderBidID),
// so the caller cannot point the swap at a different lock.
//
// There is no spend_public_key field, unlike the refund. The key that must sign
// is the one the lock was created with -- receipt.RefundPublicKey -- and taking
// it from committed state means the caller cannot substitute a key of their own.
type demoMintSettleBody struct {
	AuctionID string               `json:"auction_id"`
	Proofs    []demoMintSpendProof `json:"proofs"`
	Event     SignedEvent          `json:"event"`
	// SpendSignature is the hex BIP-340 signature by the wallet spend key that
	// owns the lock, over the hashed claim message.
	SpendSignature string `json:"spend_signature"`
}

// demoMintSettleClaimMessage is the deterministic message a settlement claim
// signs with the wallet spend key. It binds the auction id and the exact input
// proof set, which is what the signer owns.
//
// It deliberately does NOT bind the output keys, unlike the refund claim: the
// destination is the seller's payout key committed in the create event, so the
// coordinator cannot redirect it without contradicting committed state, and the
// winner has no business naming it.
func demoMintSettleClaimMessage(auctionID string, proofRefs []string) []byte {
	refs := append([]string(nil), proofRefs...)
	sort.Strings(refs)
	return []byte("PlebeianAuctionsCashuSettleClaimV1\nauction_id=" + auctionID + "\nproofs=" + strings.Join(refs, ","))
}

// demoMintVerifySettleOwnership checks the ownership half of a settlement: the
// signature must verify, over the hashed claim message, against the wallet
// spend key that owns the locked value. A valid Nostr authorization alone
// proves who is asking, not that they hold the value being spent. The live
// endpoint and the coordinator's offline sweeper both call this one function,
// and the bidder's bid-time settle signature is verified by the identical
// message (verifyBidOutcomeAuthorizations in model.go).
func demoMintVerifySettleOwnership(auctionID string, proofRefs []string, spendPublicKey, spendSignature string) error {
	if spendSignature == "" {
		return errors.New("settlement claim carries no wallet spend-key signature")
	}
	if !validLowerHex(spendSignature, 64) {
		return errors.New("settlement claim wallet spend-key signature is not a 64-byte hex Schnorr signature")
	}
	if !validCompressedPublicKey(spendPublicKey) {
		return errors.New("committed receipt carries no valid wallet spend key")
	}
	point, err := btcec.ParsePubKey(mustHex(spendPublicKey))
	if err != nil {
		return errors.New("committed receipt carries no valid wallet spend key")
	}
	spendKey, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
	if err != nil {
		return errors.New("committed receipt carries no valid wallet spend key")
	}
	signature, err := schnorr.ParseSignature(mustHex(spendSignature))
	if err != nil {
		return errors.New("settlement claim wallet spend-key signature is malformed")
	}
	if !signature.Verify(sha256Sum(demoMintSettleClaimMessage(auctionID, proofRefs)), spendKey) {
		return errors.New("settlement claim wallet spend-key signature does not verify over the auction id and proof set")
	}
	return nil
}

// demoMintVerifySettleClaim is the live endpoint's wrapper: it derives the
// proof references from the submitted proofs and verifies the claim against the
// wallet spend key the committed receipt names.
func demoMintVerifySettleClaim(body demoMintSettleBody, receipt CashuLockReceipt) error {
	refs := make([]string, 0, len(body.Proofs))
	for index, proof := range body.Proofs {
		reference, err := demoMintProofY(proof.Secret)
		if err != nil {
			return fmt.Errorf("proof %d: %w", index, err)
		}
		refs = append(refs, reference)
	}
	return demoMintVerifySettleOwnership(body.AuctionID, refs, receipt.RefundPublicKey, body.SpendSignature)
}

// settlementStore holds the fresh proofs a settlement swap produced until the
// seller's browser fetches them. It is durable across a process restart: every
// payout is written to <dir>/<key>.json mode 0600 and read back on a cache
// miss, so a restart between the swap and the seller's fetch no longer loses
// the payout. That is safe to persist: each proof's secret is a P2PK condition
// naming the seller's own wallet key, so the bytes confer no ability to spend.
type settlementStore struct {
	mu sync.Mutex
	// dir is the durable root; empty keeps the store in memory only (tests, or
	// a host with no configured network root). A key is a valid identifier, so
	// filepath.Base collapses any separator and a key can never escape dir.
	dir       string
	byAuction map[string][]demoMintSpentProof
}

func (store *settlementStore) path(key string) string {
	return filepath.Join(store.dir, filepath.Base(key)+".json")
}

// put parks a payout under key. It writes the durable copy before returning so
// the caller knows the payout can survive a restart; a write failure leaves the
// in-memory copy intact and is reported to the caller to log.
func (store *settlementStore) put(key string, proofs []demoMintSpentProof) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.byAuction == nil {
		store.byAuction = map[string][]demoMintSpentProof{}
	}
	store.byAuction[key] = proofs
	return store.persistLocked(key, proofs)
}

// persistLocked writes one payout durably with the same discipline persistState
// uses for committed state: an atomic temp-file plus rename, fsyncing the file
// and then its directory, mode 0600.
func (store *settlementStore) persistLocked(key string, proofs []demoMintSpentProof) error {
	if store.dir == "" {
		return nil
	}
	if err := os.MkdirAll(store.dir, 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(proofs)
	if err != nil {
		return err
	}
	target := store.path(key)
	temporary := target + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(raw); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporary, target); err != nil {
		return err
	}
	directory, err := os.Open(store.dir)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (store *settlementStore) get(key string) ([]demoMintSpentProof, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if proofs, ok := store.byAuction[key]; ok {
		return proofs, true
	}
	if store.dir == "" {
		return nil, false
	}
	raw, err := os.ReadFile(store.path(key))
	if err != nil {
		return nil, false
	}
	var proofs []demoMintSpentProof
	if err := json.Unmarshal(raw, &proofs); err != nil {
		return nil, false
	}
	if store.byAuction == nil {
		store.byAuction = map[string][]demoMintSpentProof{}
	}
	store.byAuction[key] = proofs
	return proofs, true
}

// reload reads every durable payout back into the cache, so a fresh process
// serves what a previous one parked. It is safe to call when dir is empty.
func (store *settlementStore) reload() error {
	if store.dir == "" {
		return nil
	}
	entries, err := os.ReadDir(store.dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.byAuction == nil {
		store.byAuction = map[string][]demoMintSpentProof{}
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		key := strings.TrimSuffix(entry.Name(), ".json")
		if !validIdentifier(key) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(store.dir, entry.Name()))
		if err != nil {
			return err
		}
		var proofs []demoMintSpentProof
		if err := json.Unmarshal(raw, &proofs); err != nil {
			return err
		}
		store.byAuction[key] = proofs
	}
	return nil
}

// demoMintSettle is the winner's half of settlement: the winner hands over the
// locked proofs, the coordinator verifies them against committed state, signs
// the NUT-11 witness with the committee key, and swaps them to the SELLER's
// committed wallet key. The winner never receives the value and cannot redirect
// it.
func (server *APIServer) demoMintSettle(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim || server.manifest.ApplicationAuthority != ApplicationAuthorityLegacy {
		writeError(response, http.StatusNotFound, errors.New("demo mint-settle coordinator is available only on a legacy loopback network"))
		return
	}
	if server.demoCommitteeKey == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo mint-settle coordinator has no committee key"))
		return
	}
	if server.demoMintChecker == nil || server.demoMintKeyset == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo mint-settle coordinator has no mint"))
		return
	}
	var body demoMintSettleBody
	if err := decodeBody(request, &body); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validIdentifier(body.AuctionID) {
		writeError(response, http.StatusBadRequest, errors.New("demo mint settlement requires a valid auction id"))
		return
	}

	// (a) The event is the authorization: a valid signature, the settle kind,
	// and content naming this auction, so an authorization for one auction
	// cannot be replayed against another.
	bidder, err := VerifyNostrEvent(body.Event)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("settlement authorization is not a valid Nostr event: %w", err))
		return
	}
	if body.Event.Kind != KindSettle {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("settlement authorization must be a KindSettle (%d) event", KindSettle))
		return
	}
	var content settleContent
	if err := decodeStrictContent(body.Event.Content, &content); err != nil {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("settlement authorization content is invalid: %w", err))
		return
	}
	if content.AuctionID != body.AuctionID {
		writeError(response, http.StatusUnprocessableEntity, errors.New("settlement authorization names a different auction"))
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 4*time.Second)
	defer cancel()
	snapshot, err := server.demoCommittedState(ctx)
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, err)
		return
	}

	// (b) Committed state must say this auction is closed and this signer won.
	auction, exists := snapshot.Auctions[body.AuctionID]
	if !exists {
		writeError(response, http.StatusNotFound, errors.New("auction not found in committed state"))
		return
	}
	if auction.Status != "closed" {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("auction is %q, not closed", auction.Status))
		return
	}
	if auction.Winner == "" || auction.Winner != bidder {
		writeError(response, http.StatusForbidden, errors.New("settlement signer is not the auction winner"))
		return
	}
	if auction.FundingMode != FundingModeCashuLock && auction.FundingMode != FundingModeCashuSigAll {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("auction funding mode %q has no cooperative settlement", auction.FundingMode))
		return
	}
	// The destination is committed, not chosen by the caller. Without it there
	// is nowhere to send the value, and guessing would be worse than refusing.
	if !validCompressedPublicKey(auction.SellerCocoPaymentPublicKey) {
		writeError(response, http.StatusUnprocessableEntity, errors.New("auction committed no seller wallet payout key, so there is nowhere to settle"))
		return
	}

	// (c) The winning lock must be the one close selected, and still unpaid.
	lock, exists := snapshot.Locks[auction.LeaderBidID]
	if !exists {
		writeError(response, http.StatusUnprocessableEntity, errors.New("winning bid lock is missing from committed state"))
		return
	}
	if lock.Bidder != bidder {
		writeError(response, http.StatusForbidden, errors.New("winning lock belongs to another bidder"))
		return
	}
	if lock.Status != "winner_selected" {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("winning lock is %q, not winner_selected", lock.Status))
		return
	}
	bid, exists := snapshot.Bids[auction.LeaderBidID]
	if !exists || bid.CashuTokenSHA256 == "" {
		writeError(response, http.StatusUnprocessableEntity, errors.New("winning bid is not mint-backed, so it has no cooperative settlement"))
		return
	}
	receipt, exists := snapshot.CashuLocks[bid.CashuTokenSHA256]
	if !exists {
		writeError(response, http.StatusUnprocessableEntity, errors.New("committed receipt for the winning bid is missing"))
		return
	}

	// A retry after a lost response must not look like a double spend. The
	// proofs are already locked to the seller, so returning them again is safe
	// and is the only honest answer once the mint has seen the swap.
	if stored, ok := server.demoSettlements.get(body.AuctionID); ok {
		writeJSON(response, http.StatusOK, demoMintRefundResponse{Proofs: stored})
		return
	}

	// (d) The submitted material must be exactly the committed proof set and
	// must cover the winning amount.
	if err := demoMintVerifyProofSet(receipt, body.Proofs, lock.Amount); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}

	// (e) The mint must still see every proof as UNSPENT. Fail closed: a SPENT
	// proof means the settlement already happened or the winner reclaimed.
	if err := VerifyCashuLockProofsAtMint(server.demoMintChecker, receipt); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}

	// (f) Ownership: the wallet spend key that created the lock must sign the
	// claim. Checked last because it needs the committed receipt.
	if err := demoMintVerifySettleClaim(body, receipt); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}

	swapCtx, swapCancel := context.WithTimeout(request.Context(), demoMintSwapTimeout)
	defer swapCancel()
	fresh, err := server.demoMintCooperativeSpend(swapCtx, body.Proofs, committeeSpendIntent{
		Outcome: "settle", AuctionID: body.AuctionID, BidID: auction.LeaderBidID, Recipient: auction.SellerCocoPaymentPublicKey,
	})
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	// Park the payout for the seller. Publishing these bytes is safe: each
	// proof's secret is a P2PK condition naming the seller's wallet key, so
	// only that key can produce the NUT-11 witness the mint requires. Nobody
	// else -- not the winner, not the coordinator, not another reader of this
	// endpoint -- can spend them. The write is durable so a restart before the
	// seller fetches does not lose the payout.
	if err := server.demoSettlements.put(body.AuctionID, fresh); err != nil {
		log.Printf("demo settlement payout could not be persisted: %v", err)
	}
	writeJSON(response, http.StatusOK, demoMintRefundResponse{Proofs: fresh})
}

// demoSettlement serves the payout a settlement swap produced, so the seller's
// browser can import it. It is unauthenticated on purpose: the proofs are
// P2PK-locked to the seller's committed wallet key, so the response is
// worthless to anyone else. There is no signature to check that would add
// anything -- the lock is the access control.
func (server *APIServer) demoSettlement(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim || server.manifest.ApplicationAuthority != ApplicationAuthorityLegacy {
		writeError(response, http.StatusNotFound, errors.New("demo settlement store is available only on a legacy loopback network"))
		return
	}
	auctionID := request.PathValue("auction_id")
	if !validIdentifier(auctionID) {
		writeError(response, http.StatusBadRequest, errors.New("settlement lookup requires a valid auction id"))
		return
	}
	proofs, ok := server.demoSettlements.get(auctionID)
	if !ok {
		writeError(response, http.StatusNotFound, errors.New("no settlement payout is stored for that auction"))
		return
	}
	writeJSON(response, http.StatusOK, demoMintRefundResponse{Proofs: proofs})
}

// sigAllPrivKey parses a 32-byte hex blinding factor into a private key, which
// is how a template output's opening `r` is recovered for unblinding.
func sigAllPrivKey(rHex string) (*btcec.PrivateKey, error) {
	if !validLowerHex(rHex, 32) {
		return nil, errors.New("sigall template output blinding factor is not 32 bytes of lowercase hex")
	}
	key, _ := btcec.PrivKeyFromBytes(mustHex(rHex))
	return key, nil
}

// sigAllTemplateInputsAreReceipt checks that a template's inputs are exactly the
// receipt's committed proof references. Consensus admission (verifySigAllBidTemplates)
// already enforces that the template inputs are the bid's committed proof
// secrets; the submit path re-checks the same fact against the committed
// receipt's NUT-07 references, so a committed template can never be submitted
// against a receipt it does not bind.
func sigAllTemplateInputsAreReceipt(template sigAllSignedTemplate, receipt CashuLockReceipt) error {
	submitted := make([]string, 0, len(template.Inputs))
	seen := map[string]bool{}
	for index, input := range template.Inputs {
		reference, err := demoMintProofY(input.Secret)
		if err != nil {
			return fmt.Errorf("sigall template input %d: %w", index, err)
		}
		if seen[reference] {
			return errors.New("sigall template has a duplicate input secret")
		}
		seen[reference] = true
		submitted = append(submitted, reference)
	}
	expected := append([]string(nil), receipt.ProofStateRefs...)
	sort.Strings(submitted)
	sort.Strings(expected)
	if strings.Join(submitted, ",") != strings.Join(expected, ",") {
		return errors.New("sigall template inputs are not the receipt's committed references")
	}
	return nil
}

// demoMintSigAllSpend submits ONLY the bidder's pre-authorized template
// transaction for one committed outcome, adding the committee's half of the
// SIG_ALL signature through the committee port. It constructs nothing: the swap
// body is the committed template's own inputs and outputs, and it fails closed
// if the recomputed digest is not the committed one, if the inputs are not the
// receipt's references, or if a destination is not the one the bidder pinned.
//
// The templates come from the COMMITTED BID CONTENT, re-derived by the release
// check against the committed auction and receipt -- never from a caller-supplied
// copy and never from an off-chain bearer store: the bidder's pre-authorization
// is consensus-verifiable material now.
//
// The witness carries both signatures over the §3 SIG_ALL digest: the bidder's
// from the template and the committee's from the port, in the order the B0 probe
// saw accepted (bidder then committee). This is the only place a committee spend
// signature for the SIG_ALL route is produced. On success the mint's signatures
// are unblinded with the template openings; the caller persists the fresh proofs
// exactly as the cooperative path does.
func (server *APIServer) demoMintSigAllSpend(ctx context.Context, lockReceipt CashuLockReceipt, intent committeeSpendIntent) ([]demoMintSpentProof, error) {
	if server.demoMintKeyset == nil {
		return nil, errors.New("sigall spend has no mint keyset")
	}

	// RELEASE CHECK. This is the committee signing boundary for the SIG_ALL
	// route: before the port produces a signature, the server re-derives from
	// its OWN committed state that this spend is authorized, that its
	// destination is the committed one, and that the outcome template it is
	// about to submit is the COMMITTED one -- re-verified against the committed
	// auction and receipt, never a caller-supplied copy. It catches a
	// non-colluding fault; it does NOT stop a hacked majority, and
	// CommitteeSigner still holds one local key, not threshold custody. See
	// release_check.go.
	release, err := server.releaseCheck(ctx, intent, nil)
	if err != nil {
		return nil, err
	}
	if release.templates == nil {
		return nil, fmt.Errorf("sigall spend has no committed %s template to submit", intent.Outcome)
	}
	outcome := intent.Outcome
	recipient := intent.Recipient

	// Submit the COMMITTED template the release check verified, not a copy the
	// caller passed in.
	templates := *release.templates
	signer, err := server.committeeSigner()
	if err != nil {
		return nil, err
	}

	// Pick the committed outcome. There is no fallback and no locally-built
	// output: a missing or mismatched template is an error.
	var template sigAllSignedTemplate
	switch outcome {
	case "settle":
		template = templates.Settle
	case "refund":
		template = templates.Refund
	default:
		return nil, fmt.Errorf("sigall spend names an unknown outcome %q", outcome)
	}
	if len(template.Inputs) == 0 || len(template.Outputs) == 0 {
		return nil, fmt.Errorf("sigall spend has no committed %s template to submit", outcome)
	}

	// Recompute the digest and fail closed if it is not the committed one.
	digest, err := sigAllTemplateDigest(template)
	if err != nil {
		return nil, err
	}
	if template.Digest != digest {
		return nil, fmt.Errorf("sigall %s template digest does not match the committed digest", outcome)
	}
	if err := sigAllTemplateInputsAreReceipt(template, lockReceipt); err != nil {
		return nil, err
	}
	// Every output must be locked to the committed destination.
	if !validCompressedPublicKey(recipient) {
		return nil, fmt.Errorf("sigall %s has no committed destination", outcome)
	}
	for index, output := range template.Outputs {
		destination, err := sigAllOutputRecipient(output.Secret)
		if err != nil {
			return nil, fmt.Errorf("sigall %s output %d: %w", outcome, index, err)
		}
		if destination != recipient {
			return nil, fmt.Errorf("sigall %s output %d is not locked to the committed destination", outcome, index)
		}
	}

	// Both signatures are over the same §3 digest. The committee's half comes
	// from the port; the bidder's is in the template.
	committeeSignature, err := signer.SignDigest(mustHex(digest))
	if err != nil {
		return nil, fmt.Errorf("sigall spend committee signing failed: %w", err)
	}
	witness, err := json.Marshal(map[string][]string{"signatures": {
		template.BidderSignature, hex.EncodeToString(committeeSignature),
	}})
	if err != nil {
		return nil, err
	}

	inputs := make([]mintSwapInput, 0, len(template.Inputs))
	for _, input := range template.Inputs {
		inputs = append(inputs, mintSwapInput{
			Amount: input.Amount, ID: input.ID, Secret: input.Secret,
			C: input.C, Witness: string(witness),
		})
	}
	// The swap body is the template's own outputs. The mint takes B_, never r:
	// recompute B_ from the output secret and its opening.
	outputs := make([]mintSwapOutput, 0, len(template.Outputs))
	openings := make([]*btcec.PrivateKey, 0, len(template.Outputs))
	secrets := make([]string, 0, len(template.Outputs))
	for index, output := range template.Outputs {
		point, err := sigAllOutputPoint(output.Secret, output.R)
		if err != nil {
			return nil, fmt.Errorf("sigall %s output %d: %w", outcome, index, err)
		}
		opening, err := sigAllPrivKey(output.R)
		if err != nil {
			return nil, fmt.Errorf("sigall %s output %d: %w", outcome, index, err)
		}
		outputs = append(outputs, mintSwapOutput{Amount: output.Amount, ID: output.ID, B_: point})
		openings = append(openings, opening)
		secrets = append(secrets, output.Secret)
	}

	keyset, err := server.demoMintKeyset.Keyset(outputs[0].ID)
	if err != nil {
		return nil, err
	}

	payload, err := json.Marshal(mintSwapRequest{Inputs: inputs, Outputs: outputs})
	if err != nil {
		return nil, err
	}
	origin := mintTransportOrigin(server.manifest.CashuMintURL)
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/v1/swap", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: demoMintSwapTimeout}
	httpResponse, err := client.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("mint swap request failed: %w", err)
	}
	defer httpResponse.Body.Close()
	body, err := io.ReadAll(io.LimitReader(httpResponse.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if httpResponse.StatusCode != http.StatusOK {
		// The mint's refusal text is the evidence: it names the condition
		// (spent, wrong signature) and carries no secret.
		return nil, fmt.Errorf("mint refused the sigall swap (status %d): %s", httpResponse.StatusCode, strings.TrimSpace(string(body)))
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
		unblinded := unblindSignature(blinded, openings[index], mintKey)
		proof := demoMintSpentProof{
			Amount: amount, KeysetID: outputs[index].ID, Secret: secrets[index],
			C: hex.EncodeToString(unblinded.SerializeCompressed()),
		}
		if signature.DLEQ != nil && signature.DLEQ.E != "" && signature.DLEQ.S != "" {
			proof.DLEQ = &MintDLEQProof{E: signature.DLEQ.E, S: signature.DLEQ.S, R: template.Outputs[index].R}
		}
		fresh = append(fresh, proof)
	}
	return fresh, nil
}
