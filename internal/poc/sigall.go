package poc

// The frozen SIG_ALL message convention.
//
// What remains here is the cross-language digest derivation the wallet and the
// coordinator must agree on byte for byte:
//
//	sha256( concat(input proof secrets, in order) || concat(output B_ hex, in order) )
//
// It is implemented once in TypeScript at internal/poc/webwallet/src/sigall.ts
// and once here. cashu-ts derives a DIFFERENT SIG_ALL message, so its own
// helper is deliberately not used. The two implementations share the golden
// vector in sigAllGoldenInputs/sigAllGoldenBlinded/sigAllGoldenDigest, and both
// are pinned by tests.
//
// The bearer outcome-template deposit that once carried the two pre-authorized
// transactions is gone: the bid now commits its proofs, so no party has to hold
// bearer material between bid and outcome.

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/btcsuite/btcd/btcec/v2"
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
