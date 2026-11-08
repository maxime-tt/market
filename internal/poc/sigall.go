package poc

// The SIG_ALL outcome templates: the bidder pre-authorizes the two exact
// transactions the committee may submit.
//
// Under cashu_lock_v1 a NUT-11 single-key P2PK witness signs only the proof
// secret, so a holder of the locked proofs could spend them anywhere. This
// route instead locks with SIG_ALL, where the signature covers the whole
// transaction -- inputs AND outputs -- so the committee's power is exactly
// "submit one of the two outcomes the bidder pre-authorized", and the
// destination is provably the one the bidder chose, not one the coordinator
// asserts.
//
// The digest convention is Nutshell 0.19.2's SIG_ALL message and is frozen by
// SLICE-B-WAVE1-BRIEF.md §3:
//
//	sha256( concat(input proof secrets, in order) || concat(output B_ hex, in order) )
//
// It is implemented once in TypeScript at internal/poc/webwallet/src/sigall.ts
// and once here. cashu-ts derives a DIFFERENT SIG_ALL message, so its own
// helper is deliberately not used. The two implementations share the golden
// vector in sigAllGoldenInputs/sigAllGoldenBlinded/sigAllGoldenDigest, and both
// are pinned by tests.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

const (
	// SigAllTemplatesSchema is the on-chain outcome_templates schema name.
	SigAllTemplatesSchema = "PlebeianAuctionsPOCSigAllTemplatesV1"
	// SigAllDepositReceiptSchema is the coordinator's signed deposit receipt.
	SigAllDepositReceiptSchema = "PlebeianAuctionsPOCSigAllDepositV1"
)

// The shared golden vector. Keep byte-for-byte aligned with sigall.ts.
var sigAllGoldenInputs = []string{"sigall-golden-secret-0001", "sigall-golden-secret-0002"}

var sigAllGoldenBlinded = []string{
	"02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	"03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
}

const sigAllGoldenDigest = "54fe6fe064563ecd412a19c79f8c966c82b317448dd6ce1e8b8b9009d841adce"

// sigAllGoldenOutputPoint pins the B_ = hash_to_curve(secret) + r*G derivation
// for the shared vector, so the Go coordinator recomputes the exact points the
// TypeScript wallet signed. Cross-checked against sigall.ts's sigAllOutputPoint.
const sigAllGoldenOutputPoint = "0336bf38b85ee80f36950f9a05f22c0f36576118dcb30b5300b5a9f73bd41af17e"

// sigAllDigest is Nutshell's SIG_ALL message: the input secrets followed by the
// output blinded points, concatenated as their wire strings and hashed once.
// The order the mint receives the inputs and outputs in is the order used here.
func sigAllDigest(inputSecrets, outputBlinded []string) [32]byte {
	hash := sha256.New()
	for _, secret := range inputSecrets {
		hash.Write([]byte(secret))
	}
	for _, blinded := range outputBlinded {
		hash.Write([]byte(blinded))
	}
	var digest [32]byte
	copy(digest[:], hash.Sum(nil))
	return digest
}

// sigAllTemplateInput is one locked proof offered for an outcome. It is bearer
// material (the secret and C), so it lives only in the off-chain deposit.
type sigAllTemplateInput struct {
	Amount int64  `json:"amount"`
	ID     string `json:"id"`
	Secret string `json:"secret"`
	C      string `json:"C"`
}

// sigAllTemplateOutput is one fresh proof the outcome creates. It carries the
// opening (secret + blinding r) so the coordinator can unblind the mint's
// signature without ever choosing the destination itself.
type sigAllTemplateOutput struct {
	Amount int64  `json:"amount"`
	ID     string `json:"id"`
	Secret string `json:"secret"`
	R      string `json:"r"`
}

// sigAllTemplates is one exact outcome transaction: the inputs it spends and
// the blinded outputs it creates.
type sigAllTemplates struct {
	Inputs  []sigAllTemplateInput  `json:"inputs"`
	Outputs []sigAllTemplateOutput `json:"outputs"`
}

// sigAllSignedTemplate is a template plus the bidder's signature over its
// SIG_ALL digest. The digest and signature are the compact on-chain
// commitment; the inputs and outputs are the off-chain bearer deposit.
type sigAllSignedTemplate struct {
	Inputs          []sigAllTemplateInput  `json:"inputs"`
	Outputs         []sigAllTemplateOutput `json:"outputs"`
	Digest          string                 `json:"digest"`
	BidderSignature string                 `json:"bidder_signature"`
}

// sigAllDepositTemplates is the two outcome templates the wallet deposits.
type sigAllDepositTemplates struct {
	Settle sigAllSignedTemplate `json:"settle"`
	Refund sigAllSignedTemplate `json:"refund"`
}

// sigAllDepositRequest is the wire body the wallet posts to
// POST /api/demo/sigall-deposit (wave 2 implements the route). It carries the
// bidder and the two signed, bearer outcome templates; the coordinator verifies
// them with verifySigAllDeposit before storing them under a new deposit id.
type sigAllDepositRequest struct {
	AuctionID string                 `json:"auction_id"`
	Bidder    string                 `json:"bidder"`
	Templates sigAllDepositTemplates `json:"templates"`
	// Receipt is the coordinator's own signed cashu_sigall_v1 lock receipt, the
	// exact object POST /api/demo/mint-lock returned to the wallet. It is public,
	// non-bearer material (NUT-07 Y references, never a proof), so the wallet can
	// hand it back and the coordinator verifies its OWN signature rather than
	// trusting a committed-state lookup. That lookup cannot work on the first
	// deposit: no lock exists until a bid commits, and a cashu_sigall_v1 bid does
	// not commit without a deposit. When it is absent the endpoint keeps the
	// committed-lock lookup as the fallback (a retry posted after the bid
	// committed).
	Receipt *CashuLockReceipt `json:"receipt,omitempty"`
}

// sigAllTemplateSignature is the compact on-chain commitment for one outcome.
type sigAllTemplateSignature struct {
	Digest          string `json:"digest"`
	BidderSignature string `json:"bidder_signature"`
}

// sigAllOutcomeTemplates is the public, compact on-chain bid content. It names
// the deposit the coordinator stores and carries the digests plus the bidder's
// signatures over them, so anyone can re-derive the transaction the coordinator
// is allowed to submit.
type sigAllOutcomeTemplates struct {
	Schema    string                  `json:"schema"`
	DepositID string                  `json:"deposit_id"`
	Settle    sigAllTemplateSignature `json:"settle"`
	Refund    sigAllTemplateSignature `json:"refund"`
}

// sigAllDepositReceipt is the coordinator's signed acknowledgement that it
// verified and stored a deposit. It is non-bearer: it carries the digests and
// the identity, never a proof secret. Admission verifies its signature and its
// binding to the bid so the on-chain deposit_id cannot be invented.
type sigAllDepositReceipt struct {
	Schema       string `json:"schema"`
	DepositID    string `json:"deposit_id"`
	AuctionID    string `json:"auction_id"`
	Bidder       string `json:"bidder"`
	SettleDigest string `json:"settle_digest"`
	RefundDigest string `json:"refund_digest"`
	Signer       string `json:"signer"`
	Signature    string `json:"signature"`
}

// sigAllDepositReceiptDigest is the application's own digest over the deposit
// receipt, so the signed bytes cannot drift from the verified bytes. The
// coordinator signs it with the application authority key (the committee key
// today) and admission re-derives it.
func sigAllDepositReceiptDigest(receipt sigAllDepositReceipt) [32]byte {
	material, _ := json.Marshal([]any{
		receipt.Schema, receipt.DepositID, receipt.AuctionID, receipt.Bidder,
		receipt.SettleDigest, receipt.RefundDigest, receipt.Signer,
	})
	return sha256.Sum256(material)
}

// sigAllOutputPoint computes B_ = hash_to_curve(secret) + r*G for one template
// output, exactly the point the mint will sign and the coordinator will submit.
func sigAllOutputPoint(secret, rHex string) (string, error) {
	if !validLowerHex(rHex, 32) {
		return "", errors.New("template output blinding factor is not 32 bytes of lowercase hex")
	}
	Y, err := cashuHashToCurve(secret)
	if err != nil {
		return "", err
	}
	curve := btcec.S256()
	rGx, rGy := curve.ScalarBaseMult(mustHex(rHex))
	bx, by := curve.Add(Y.X(), Y.Y(), rGx, rGy)
	return hex.EncodeToString(compressedPoint(bx, by)), nil
}

// sigAllTemplateDigest computes the (§3) digest of one exact template: the input
// secrets in order, then the B_ points of the outputs in order.
func sigAllTemplateDigest(template sigAllSignedTemplate) (string, error) {
	secrets := make([]string, 0, len(template.Inputs))
	for index, input := range template.Inputs {
		if input.Secret == "" || len(input.Secret) > 4096 {
			return "", fmt.Errorf("template input %d has an invalid secret", index)
		}
		secrets = append(secrets, input.Secret)
	}
	blinded := make([]string, 0, len(template.Outputs))
	for index, output := range template.Outputs {
		if output.Secret == "" || len(output.Secret) > 4096 {
			return "", fmt.Errorf("template output %d has an invalid secret", index)
		}
		point, err := sigAllOutputPoint(output.Secret, output.R)
		if err != nil {
			return "", fmt.Errorf("template output %d: %w", index, err)
		}
		blinded = append(blinded, point)
	}
	digest := sigAllDigest(secrets, blinded)
	return hex.EncodeToString(digest[:]), nil
}

// sigAllP2PKCondition is the NUT-10 P2PK body of an output secret.
type sigAllP2PKCondition struct {
	Nonce string     `json:"nonce"`
	Data  string     `json:"data"`
	Tags  [][]string `json:"tags"`
}

// sigAllOutputRecipient reads the destination key a template output is locked
// to. The coordinator never chooses this; the bidder built it.
func sigAllOutputRecipient(secret string) (string, error) {
	var decoded []json.RawMessage
	if err := json.Unmarshal([]byte(secret), &decoded); err != nil || len(decoded) != 2 {
		return "", errors.New("template output secret is not a NUT-10 P2PK condition")
	}
	var kind string
	if err := json.Unmarshal(decoded[0], &kind); err != nil || kind != "P2PK" {
		return "", errors.New("template output secret is not a NUT-10 P2PK condition")
	}
	var condition sigAllP2PKCondition
	if err := json.Unmarshal(decoded[1], &condition); err != nil {
		return "", errors.New("template output secret is not a NUT-10 P2PK condition")
	}
	if !validCompressedPublicKey(condition.Data) {
		return "", errors.New("template output is not locked to a compressed secp256k1 key")
	}
	return condition.Data, nil
}

// verifySigAllBidderSignature checks a bidder's BIP-340 signature over a
// template digest against the wallet spend key that owns the lock. The digest
// is already a 32-byte sha256, so it is signed directly.
func verifySigAllBidderSignature(spendPublicKey, digestHex, signatureHex string) error {
	if !validCompressedPublicKey(spendPublicKey) {
		return errors.New("template wallet spend key is not a valid compressed secp256k1 point")
	}
	if !validLowerHex(digestHex, 32) {
		return errors.New("template digest is not a 32-byte hex string")
	}
	if !validLowerHex(signatureHex, 64) {
		return errors.New("template signature is not a 64-byte hex Schnorr signature")
	}
	point, err := btcec.ParsePubKey(mustHex(spendPublicKey))
	if err != nil {
		return errors.New("template wallet spend key is not a valid compressed secp256k1 point")
	}
	spendKey, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
	if err != nil {
		return errors.New("template wallet spend key is not a valid compressed secp256k1 point")
	}
	signature, err := schnorr.ParseSignature(mustHex(signatureHex))
	if err != nil {
		return errors.New("template signature is malformed")
	}
	if !signature.Verify(mustHex(digestHex), spendKey) {
		return errors.New("bidder signature does not verify over the template digest")
	}
	return nil
}

// verifySigAllDeposit is the coordinator's pre-storage check, shared by the
// deposit endpoint (wave 2) and these tests. It refuses, naming the rule, when:
//
//  1. either template's outputs do not conserve the locked amount;
//  2. the settle outputs are not all locked to the auction's committed seller
//     payout key;
//  3. the refund outputs are not all locked to the receipt's wallet spend key;
//  4. either bidder signature does not verify over that template's digest;
//  5. the templates' input refs are not the receipt's refs.
//
// It returns the two digests the coordinator records on the deposit receipt.
func verifySigAllDeposit(receipt CashuLockReceipt, auction Auction, templates sigAllDepositTemplates) (string, string, error) {
	if !validCompressedPublicKey(auction.SellerCocoPaymentPublicKey) {
		return "", "", errors.New("sigall deposit: auction committed no seller payout key")
	}
	set := []struct {
		name     string
		template sigAllSignedTemplate
		dest     string
	}{
		{"settle", templates.Settle, auction.SellerCocoPaymentPublicKey},
		{"refund", templates.Refund, receipt.RefundPublicKey},
	}
	digests := map[string]string{}
	for _, entry := range set {
		template := entry.template
		if len(template.Inputs) == 0 || len(template.Outputs) == 0 {
			return "", "", fmt.Errorf("sigall deposit: %s template has no inputs or outputs", entry.name)
		}
		// Rule 1: the outputs must conserve the locked amount exactly.
		var outputTotal int64
		for index, output := range template.Outputs {
			if output.Amount <= 0 || output.ID == "" {
				return "", "", fmt.Errorf("sigall deposit: %s output %d has no positive amount or keyset", entry.name, index)
			}
			if output.Amount > (1<<62)-outputTotal {
				return "", "", fmt.Errorf("sigall deposit: %s output amounts overflow", entry.name)
			}
			outputTotal += output.Amount
		}
		if outputTotal != receipt.Amount {
			return "", "", fmt.Errorf("sigall deposit: %s outputs conserve %d sats, not the locked %d", entry.name, outputTotal, receipt.Amount)
		}
		// Rules 2 and 3: every output must be locked to the one committed key.
		for index, output := range template.Outputs {
			recipient, err := sigAllOutputRecipient(output.Secret)
			if err != nil {
				return "", "", fmt.Errorf("sigall deposit: %s output %d: %w", entry.name, index, err)
			}
			if recipient != entry.dest {
				if entry.name == "settle" {
					return "", "", fmt.Errorf("sigall deposit: settle output %d is not locked to the auction's committed seller payout key", index)
				}
				return "", "", fmt.Errorf("sigall deposit: refund output %d is not locked to the receipt's wallet spend key", index)
			}
		}
		// Rule 5: the inputs must be exactly the receipt's committed refs.
		submitted := make([]string, 0, len(template.Inputs))
		seen := map[string]bool{}
		for index, input := range template.Inputs {
			if input.Amount <= 0 || input.ID == "" {
				return "", "", fmt.Errorf("sigall deposit: %s input %d has no positive amount or keyset", entry.name, index)
			}
			if input.Secret == "" || len(input.Secret) > 4096 || !validCompressedPublicKey(input.C) {
				return "", "", fmt.Errorf("sigall deposit: %s input %d is malformed", entry.name, index)
			}
			reference, err := demoMintProofY(input.Secret)
			if err != nil {
				return "", "", fmt.Errorf("sigall deposit: %s input %d: %w", entry.name, index, err)
			}
			if seen[reference] {
				return "", "", fmt.Errorf("sigall deposit: %s has a duplicate input secret", entry.name)
			}
			seen[reference] = true
			submitted = append(submitted, reference)
		}
		expected := append([]string(nil), receipt.ProofStateRefs...)
		sort.Strings(submitted)
		sort.Strings(expected)
		if strings.Join(submitted, ",") != strings.Join(expected, ",") {
			return "", "", fmt.Errorf("sigall deposit: %s input references are not the receipt's committed references", entry.name)
		}
		// Rule 4: the bidder's signature over the digest the coordinator will
		// itself recompute.
		digest, err := sigAllTemplateDigest(template)
		if err != nil {
			return "", "", fmt.Errorf("sigall deposit: %s template: %w", entry.name, err)
		}
		if template.Digest != digest {
			return "", "", fmt.Errorf("sigall deposit: %s template digest does not match its inputs and outputs", entry.name)
		}
		digests[entry.name] = digest
	}
	if err := verifySigAllBidderSignature(receipt.RefundPublicKey, digests["settle"], templates.Settle.BidderSignature); err != nil {
		return "", "", fmt.Errorf("sigall deposit: settle %w", err)
	}
	if err := verifySigAllBidderSignature(receipt.RefundPublicKey, digests["refund"], templates.Refund.BidderSignature); err != nil {
		return "", "", fmt.Errorf("sigall deposit: refund %w", err)
	}
	return digests["settle"], digests["refund"], nil
}

// verifySigAllLockReceiptForDeposit is the coordinator's own check on the lock
// receipt a bidder posts with a deposit, run before the receipt is used. The
// receipt is public, non-bearer material the wallet holds from mint-lock, so the
// coordinator verifies its OWN application-authority signature -- the exact
// signature over cashuReceiptDigest the bid-admission path verifies, through the
// same shared helper -- instead of trusting a committed-lock lookup that cannot
// exist yet. It refuses, naming the rule, when the schema is not the Cashu lock
// receipt schema, when the receipt is not a cashu_sigall_v1 lock, when it names
// another auction or bidder, when it is not signed by this authority, or when
// its signature does not verify.
func verifySigAllLockReceiptForDeposit(receipt CashuLockReceipt, authority, auctionID, bidder string) error {
	if receipt.Schema != "PlebeianAuctionsPOCCashuLockV1" {
		return errors.New("sigall deposit: the provided receipt is not a Cashu lock receipt")
	}
	if receipt.FundingMode != FundingModeCashuSigAll {
		return errors.New("sigall deposit: the provided receipt is not a cashu_sigall_v1 lock")
	}
	if receipt.AuctionID != auctionID {
		return errors.New("sigall deposit: the provided receipt names a different auction")
	}
	if receipt.Bidder != bidder {
		return errors.New("sigall deposit: the provided receipt names a different bidder")
	}
	if receipt.CommitteePublicKey != authority {
		return errors.New("sigall deposit: the provided receipt was not signed by the application authority")
	}
	digest := cashuReceiptDigest(receipt)
	if !verifyFundingSchnorr(receipt.Signature, digest[:], receipt.CommitteePublicKey) {
		return errors.New("sigall deposit: the provided receipt signature does not verify")
	}
	return nil
}

// verifySigAllBidAdmission is the local-admission (CheckTx) rule for a
// cashu_sigall_v1 bid. The digest-and-destination work happened at deposit
// time, before the coordinator stored the bearer templates; admission only has
// the compact on-chain commitment plus the coordinator's signed receipt, and
// checks that the two agree and that the receipt is the application authority's.
//
// It deliberately cannot re-derive the digests -- that needs the bearer deposit
// the coordinator holds off chain -- so it verifies the binding instead: the
// receipt names this deposit, this auction and this bidder, its signature
// verifies, its digests equal the on-chain digests, and the bidder signed both
// on-chain digests with the wallet spend key that owns the lock.
func verifySigAllBidAdmission(state State, actor string, auction Auction, content bidContent) error {
	commitment := content.OutcomeTemplates
	if commitment == nil || commitment.Schema != SigAllTemplatesSchema {
		return errors.New("sigall bid must publish outcome_templates with the PlebeianAuctionsPOCSigAllTemplatesV1 schema")
	}
	if !validOperationID(commitment.DepositID) {
		return errors.New("sigall outcome_templates carry no valid deposit id")
	}
	deposit := content.SigAllDeposit
	if deposit == nil || deposit.Schema != SigAllDepositReceiptSchema {
		return errors.New("sigall bid must publish the coordinator's signed deposit receipt")
	}
	if deposit.DepositID != commitment.DepositID {
		return errors.New("sigall deposit receipt does not name the published deposit id")
	}
	if deposit.AuctionID != content.AuctionID {
		return errors.New("sigall deposit names a different auction")
	}
	if deposit.Bidder != actor {
		return errors.New("sigall deposit names a different bidder")
	}
	if deposit.Signer != state.CommitteePublicKey {
		return errors.New("sigall deposit was not signed by the application authority")
	}
	if !validLowerHex(deposit.SettleDigest, 32) || !validLowerHex(deposit.RefundDigest, 32) {
		return errors.New("sigall deposit digests are malformed")
	}
	if !validLowerHex(deposit.Signature, 64) {
		return errors.New("sigall deposit receipt signature is malformed")
	}
	signer, err := btcec.ParsePubKey(mustHex(deposit.Signer))
	if err != nil {
		return errors.New("sigall deposit signer is not a valid compressed secp256k1 point")
	}
	authority, err := schnorr.ParsePubKey(schnorr.SerializePubKey(signer))
	if err != nil {
		return errors.New("sigall deposit signer is not a valid compressed secp256k1 point")
	}
	receiptSignature, err := schnorr.ParseSignature(mustHex(deposit.Signature))
	if err != nil {
		return errors.New("sigall deposit receipt signature is malformed")
	}
	receiptDigest := sigAllDepositReceiptDigest(*deposit)
	if !receiptSignature.Verify(receiptDigest[:], authority) {
		return errors.New("sigall deposit receipt signature does not verify")
	}
	if commitment.Settle.Digest != deposit.SettleDigest {
		return errors.New("sigall settle digest does not match the stored deposit")
	}
	if commitment.Refund.Digest != deposit.RefundDigest {
		return errors.New("sigall refund digest does not match the stored deposit")
	}
	receipt := content.CashuLock
	if receipt == nil {
		return errors.New("sigall bid must carry a Cashu lock")
	}
	if err := verifySigAllBidderSignature(receipt.RefundPublicKey, commitment.Settle.Digest, commitment.Settle.BidderSignature); err != nil {
		return fmt.Errorf("sigall settle template: %w", err)
	}
	if err := verifySigAllBidderSignature(receipt.RefundPublicKey, commitment.Refund.Digest, commitment.Refund.BidderSignature); err != nil {
		return fmt.Errorf("sigall refund template: %w", err)
	}
	return nil
}
