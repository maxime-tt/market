package poc

// The frozen SIG_ALL message convention, plus the bidder's pre-authorized
// outcome templates.
//
// The digest derivation the wallet and the coordinator must agree on byte for
// byte stays exactly as the cross-language contract defines it:
//
//	sha256( concat(input proof secrets, in order) || concat(output B_ hex, in order) )
//
// It is implemented once in TypeScript at internal/poc/webwallet/src/sigall.ts
// and once here. cashu-ts derives a DIFFERENT SIG_ALL message, so its own
// helper is deliberately not used. The two implementations share the golden
// vector in sigAllGoldenInputs/sigAllGoldenBlinded/sigAllGoldenDigest, and both
// are pinned by tests.
//
// Wave E2b reinstates the bidder's pre-signed outcome templates, but as
// consensus-verifiable material: the two exact transactions the committee may
// submit travel INSIDE the committed bid content, not in an off-chain bearer
// store. Every validator re-derives each template's digest and re-checks the
// bidder's signature, the destinations and the inputs, so a committee cannot
// submit a transaction the bidder did not pre-authorize.
//
// The off-chain deposit endpoint and its bearer store stay removed: the proofs
// are in the bid, and the templates are in the bid.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// SigAllTemplatesSchema is the schema name the outcome_templates carry.
const SigAllTemplatesSchema = "PlebeianAuctionsPOCSigAllTemplatesV1"

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

// sigAllOutputPoint computes B_ = hash_to_curve(secret) + r*G for one output,
// exactly the point the mint will sign and the coordinator will submit.
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

// sigAllTemplateInput is one locked proof offered for an outcome. It carries
// the proof secret and C, which are the committed bid's own proofs: the whole
// point of the on-chain carrier is that these are the SAME inputs consensus
// already committed and verified.
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

// sigAllSignedTemplate is a template plus the bidder's signature over its
// SIG_ALL digest.
type sigAllSignedTemplate struct {
	Inputs          []sigAllTemplateInput  `json:"inputs"`
	Outputs         []sigAllTemplateOutput `json:"outputs"`
	Digest          string                 `json:"digest"`
	BidderSignature string                 `json:"bidder_signature"`
}

// sigAllDepositTemplates is the two outcome templates the bidder pre-signs:
// settle (pay the auction's committed seller key) and refund (return to the
// bidder's own wallet spend key).
type sigAllDepositTemplates struct {
	Settle sigAllSignedTemplate `json:"settle"`
	Refund sigAllSignedTemplate `json:"refund"`
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

// verifySigAllBidTemplates is the CONSENSUS admission rule for a
// cashu_sigall_v1 bid's committed outcome templates, run inside ApplyTransaction
// so every validator agrees, and again at mempool admission for a deterministic
// refusal. It refuses, naming the rule, when:
//
//	(a) the bid publishes no outcome_templates at all;
//	(b) either template's inputs are not exactly the bid's committed proof
//	    secrets, in the same order (the SIG_ALL inputs ARE the committed proofs);
//	(c) either template's outputs do not sum to the bid's amount, or name a
//	    keyset other than the pinned keyset_id;
//	(d) the settle outputs are not all locked to the auction's committed seller
//	    payout key;
//	(e) the refund outputs are not all locked to the receipt's wallet spend key;
//	(f) either template's stored digest is not the one its inputs and outputs
//	    derive;
//	(g) either bidder signature does not verify over that digest.
func verifySigAllBidTemplates(auction Auction, content bidContent, receipt CashuLockReceipt, policy Policy) error {
	// (a) The bidder must publish the templates; without them the committee
	// would have to construct a transaction nobody pre-authorized.
	if content.OutcomeTemplates == nil {
		return errors.New("sigall bid must publish outcome_templates carrying the bidder's pre-signed settle and refund templates")
	}
	// (b) The templates spend the committed proofs, so the bid must carry them.
	if len(content.Proofs) == 0 {
		return errors.New("sigall bid publishes outcome_templates but carries no proofs for them to spend")
	}
	if policy.pinnedKeysetID() == "" {
		return errors.New("sigall bid: the network pinned no mint keyset for the templates' outputs")
	}
	if !validCompressedPublicKey(auction.SellerCocoPaymentPublicKey) {
		return errors.New("sigall bid: the auction committed no seller payout key for the settle template")
	}
	if !validCompressedPublicKey(receipt.RefundPublicKey) {
		return errors.New("sigall bid: the receipt committed no wallet spend key for the refund template")
	}

	entries := []struct {
		name     string
		template sigAllSignedTemplate
		dest     string
	}{
		{"settle", content.OutcomeTemplates.Settle, auction.SellerCocoPaymentPublicKey},
		{"refund", content.OutcomeTemplates.Refund, receipt.RefundPublicKey},
	}
	for _, entry := range entries {
		template := entry.template

		// (b) The inputs are the committed proofs: the same secrets, in the
		// same order. Order matters because the SIG_ALL digest concatenates
		// the input secrets in the order the mint receives them.
		if len(template.Inputs) != len(content.Proofs) {
			return fmt.Errorf("sigall %s template has %d inputs but the bid carries %d proofs", entry.name, len(template.Inputs), len(content.Proofs))
		}
		for index, input := range template.Inputs {
			if input.Secret != content.Proofs[index].Secret {
				return fmt.Errorf("sigall %s template input %d is not the committed proof's secret", entry.name, index)
			}
		}
		if len(template.Outputs) == 0 {
			return fmt.Errorf("sigall %s template has no outputs", entry.name)
		}

		// (c) The outputs must conserve the bid's amount and name the pinned
		// keyset.
		var total int64
		for index, output := range template.Outputs {
			if output.Amount <= 0 {
				return fmt.Errorf("sigall %s output %d has no positive amount", entry.name, index)
			}
			if output.Amount > (1<<62)-total {
				return fmt.Errorf("sigall %s output amounts overflow", entry.name)
			}
			total += output.Amount
			if output.ID != policy.pinnedKeysetID() {
				return fmt.Errorf("sigall %s output %d names keyset %q, not the pinned %q", entry.name, index, output.ID, policy.pinnedKeysetID())
			}
		}
		if total != content.Amount {
			return fmt.Errorf("sigall %s outputs sum to %d, not the bid's amount %d", entry.name, total, content.Amount)
		}

		// (d) settle and (e) refund: every output is locked to the one
		// committed destination.
		for index, output := range template.Outputs {
			recipient, err := sigAllOutputRecipient(output.Secret)
			if err != nil {
				return fmt.Errorf("sigall %s output %d: %w", entry.name, index, err)
			}
			if recipient != entry.dest {
				if entry.name == "settle" {
					return fmt.Errorf("sigall settle output %d is not locked to the auction's committed seller payout key", index)
				}
				return fmt.Errorf("sigall refund output %d is not locked to the receipt's wallet spend key", index)
			}
		}

		// (f) The stored digest must be the one the inputs and outputs derive.
		digest, err := sigAllTemplateDigest(template)
		if err != nil {
			return fmt.Errorf("sigall %s template: %w", entry.name, err)
		}
		if template.Digest != digest {
			return fmt.Errorf("sigall %s template digest does not match its inputs and outputs", entry.name)
		}

		// (g) The bidder's signature must verify over that digest under the
		// wallet spend key that owns the lock.
		if err := verifySigAllBidderSignature(receipt.RefundPublicKey, digest, template.BidderSignature); err != nil {
			return fmt.Errorf("sigall %s template: %w", entry.name, err)
		}
	}
	return nil
}
