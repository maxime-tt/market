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
	"math/big"
	"net/http"
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
//     Cashu spend key over demoMintRefundClaimMessage, binding the bid id and
//     the exact output pubkeys. The Nostr identity authorizes; the wallet owns
//     value and owns its own spend key. The two are linked by this
//     authorization, never by deriving one key from the other.
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

// demoMintRefundClaimMessage is the deterministic message a refund claim signs
// with the wallet spend key. The browser builds the same bytes
// (refundClaimMessage in webwallet/src/wallet.ts); the two must not drift, or
// every genuine claim is refused.
func demoMintRefundClaimMessage(bidID string, outputPublicKeys []string) []byte {
	outputs := append([]string(nil), outputPublicKeys...)
	sort.Strings(outputs)
	return []byte("PlebeianAuctionsCashuRefundClaimV1\nbid_id=" + bidID + "\noutputs=" + strings.Join(outputs, ","))
}

// demoMintVerifyRefundClaim checks the wallet spend-key half of a refund: the
// key is a real compressed point, the output list is exactly one key per proof
// and all of them are that key, and the signature verifies over the claim
// message. It returns the spend key so the caller locks the outputs to it.
func demoMintVerifyRefundClaim(body demoMintRefundBody) (string, error) {
	if body.SpendPublicKey == "" {
		return "", errors.New("refund claim carries no wallet spend key")
	}
	if !validCompressedPublicKey(body.SpendPublicKey) {
		return "", errors.New("refund claim wallet spend key is not a valid compressed secp256k1 point")
	}
	if len(body.OutputPublicKeys) != len(body.Proofs) {
		return "", fmt.Errorf("refund claim names %d output keys for %d proofs", len(body.OutputPublicKeys), len(body.Proofs))
	}
	for index, key := range body.OutputPublicKeys {
		if key != body.SpendPublicKey {
			return "", fmt.Errorf("refund claim output %d is not locked to the wallet spend key", index)
		}
	}
	if body.SpendSignature == "" {
		return "", errors.New("refund claim carries no wallet spend-key signature")
	}
	if !validLowerHex(body.SpendSignature, 64) {
		return "", errors.New("refund claim wallet spend-key signature is not a 64-byte hex Schnorr signature")
	}
	// schnorr.ParsePubKey takes the 32-byte x-only form, so the compressed key
	// is parsed as a curve point and then lifted to its BIP-340 x-only form.
	// Passing the 33-byte compressed encoding straight in is refused.
	point, err := btcec.ParsePubKey(mustHex(body.SpendPublicKey))
	if err != nil {
		return "", errors.New("refund claim wallet spend key is not a valid compressed secp256k1 point")
	}
	spendKey, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
	if err != nil {
		return "", errors.New("refund claim wallet spend key is not a valid compressed secp256k1 point")
	}
	signature, err := schnorr.ParseSignature(mustHex(body.SpendSignature))
	if err != nil {
		return "", errors.New("refund claim wallet spend-key signature is malformed")
	}
	message := demoMintRefundClaimMessage(body.BidID, body.OutputPublicKeys)
	if !signature.Verify(sha256Sum(message), spendKey) {
		return "", errors.New("refund claim wallet spend-key signature does not verify over the bid id and output keys")
	}
	return body.SpendPublicKey, nil
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
func (server *APIServer) demoMintCooperativeSpend(ctx context.Context, proofs []demoMintSpendProof, recipient string) ([]demoMintSpentProof, error) {
	if server.demoCommitteeKey == nil {
		return nil, errors.New("cooperative spend has no committee key")
	}
	if server.demoMintKeyset == nil {
		return nil, errors.New("cooperative spend has no mint keyset")
	}
	if !validCompressedPublicKey(recipient) {
		return nil, errors.New("cooperative spend recipient is not a compressed secp256k1 public key")
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

	// (a2) The wallet spend key is the ownership half. It is a key the wallet
	// generated and holds, never one derived from the Nostr identity, and the
	// signature binds this bid id and the exact output keys. A valid Nostr
	// authorization without it proves who is asking, not that the returned
	// value lands somewhere they can spend.
	spendPublicKey, err := demoMintVerifyRefundClaim(body)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
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
	fresh, err := server.demoMintCooperativeSpend(swapCtx, body.Proofs, spendPublicKey)
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

// demoMintVerifySettleClaim checks the ownership half of a settlement: the
// signature must verify, over the hashed claim message, against the wallet
// spend key the committed receipt names. A valid Nostr authorization alone
// proves who is asking, not that they hold the value being spent.
func demoMintVerifySettleClaim(body demoMintSettleBody, receipt CashuLockReceipt) error {
	if body.SpendSignature == "" {
		return errors.New("settlement claim carries no wallet spend-key signature")
	}
	if !validLowerHex(body.SpendSignature, 64) {
		return errors.New("settlement claim wallet spend-key signature is not a 64-byte hex Schnorr signature")
	}
	if !validCompressedPublicKey(receipt.RefundPublicKey) {
		return errors.New("committed receipt carries no valid wallet spend key")
	}
	point, err := btcec.ParsePubKey(mustHex(receipt.RefundPublicKey))
	if err != nil {
		return errors.New("committed receipt carries no valid wallet spend key")
	}
	spendKey, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
	if err != nil {
		return errors.New("committed receipt carries no valid wallet spend key")
	}
	signature, err := schnorr.ParseSignature(mustHex(body.SpendSignature))
	if err != nil {
		return errors.New("settlement claim wallet spend-key signature is malformed")
	}
	refs := make([]string, 0, len(body.Proofs))
	for index, proof := range body.Proofs {
		reference, err := demoMintProofY(proof.Secret)
		if err != nil {
			return fmt.Errorf("proof %d: %w", index, err)
		}
		refs = append(refs, reference)
	}
	if !signature.Verify(sha256Sum(demoMintSettleClaimMessage(body.AuctionID, refs)), spendKey) {
		return errors.New("settlement claim wallet spend-key signature does not verify over the auction id and proof set")
	}
	return nil
}

// settlementStore holds the fresh proofs a settlement swap produced until the
// seller's browser fetches them. It is durable across requests, not across a
// process restart: the proofs are P2PK-locked to the seller's key, so a restart
// between the swap and the fetch loses them. That window is one request wide
// and is the honest cost of not giving the coordinator custody.
type settlementStore struct {
	mu        sync.Mutex
	byAuction map[string][]demoMintSpentProof
}

func (store *settlementStore) put(auctionID string, proofs []demoMintSpentProof) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.byAuction == nil {
		store.byAuction = map[string][]demoMintSpentProof{}
	}
	store.byAuction[auctionID] = proofs
}

func (store *settlementStore) get(auctionID string) ([]demoMintSpentProof, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	proofs, ok := store.byAuction[auctionID]
	return proofs, ok
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
	if auction.FundingMode != FundingModeCashuLock {
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
	fresh, err := server.demoMintCooperativeSpend(swapCtx, body.Proofs, auction.SellerCocoPaymentPublicKey)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	// Park the payout for the seller. Publishing these bytes is safe: each
	// proof's secret is a P2PK condition naming the seller's wallet key, so
	// only that key can produce the NUT-11 witness the mint requires. Nobody
	// else -- not the winner, not the coordinator, not another reader of this
	// endpoint -- can spend them.
	server.demoSettlements.put(body.AuctionID, fresh)
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
