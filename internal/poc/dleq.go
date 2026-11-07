package poc

// NUT-12 DLEQ verification: the piece that turns "some points exist" into
// "value is behind them".
//
// NUT-07 answers UNSPENT for proofs a mint has never issued, so a receipt naming
// arbitrary points satisfies it while holding nothing. A DLEQ proof removes that
// possibility: the mint returns, alongside each blind signature, a proof that
// it used the same private key for its published public key `A` and for signing
// this exact point. Given that proof anyone can check, with no mint call and no
// trust, that this proof really was signed by the mint under the key for the
// amount it claims.
//
// The check is pure arithmetic on secp256k1, which matters twice over: it needs
// no network, and it is deterministic, so consensus can perform it rather than
// delegating it to an admission-time probe.
//
// From NUT-12, for a recipient (`Carol`) holding a proof `(x, C)` plus the
// blinded DLEQ `(e, s)` and the blinding factor `r`:
//
//	Y  = hash_to_curve(x)
//	C' = C + r*A
//	B' = Y + r*G
//	R1 = s*G - e*A
//	R2 = s*B' - e*C'
//	e  == hash(R1, R2, A, C')
//
// where `hash` concatenates the UNCOMPRESSED (65-byte) hexadecimal encodings of
// its arguments as a string and takes the SHA-256 of that string.
//
// This implementation takes `Y` directly rather than `x`. The caller already
// holds `Y` -- it is the proof reference the receipt is bound to -- so the
// secret never has to leave the bidder's wallet, which is the whole point of the
// bidder-held design. The proof proves the mint signed that point for that
// amount; whether the point came from any particular secret is irrelevant to
// the claim being checked.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
)

// MintDLEQProof is the NUT-12 proof as it appears on a Proof: the mint's
// `(e, s)` plus the wallet's blinding factor `r`.
type MintDLEQProof struct {
	E string `json:"e"`
	S string `json:"s"`
	R string `json:"r"`
}

// MintProofBinding is one proof offered as backing, carrying exactly what a
// third party needs to verify it and nothing that can spend it.
type MintProofBinding struct {
	Amount   int64         `json:"amount"`
	KeysetID string        `json:"id"`
	Y        string        `json:"Y"`
	C        string        `json:"C"`
	DLEQ     *MintDLEQProof `json:"dleq"`
}

var (
	errDLEQShape    = errors.New("Cashu proof binding is not a canonical secp256k1 point set")
	errDLEQProof    = errors.New("Cashu proof DLEQ proof does not verify against the mint key")
	errDLEQKeyset   = errors.New("Cashu proof names a keyset or amount the mint does not publish")
	errDLEQNoProof  = errors.New("Cashu proof carries no DLEQ proof")
)

// MintKeySetFetcher loads the mint's published per-amount signing keys (NUT-01,
// served by /v1/keys) and caches them, because NUT-12 verification needs the key
// for a proof's amount and that key changes only when the mint rotates a keyset.
//
// A fetch failure must never be read as "nothing to verify": it returns an error
// and the caller refuses. That is why this is a separate type rather than another
// method on the state checker.
type MintKeySetFetcher struct {
	Client  *http.Client
	MintURL string

	mu      sync.Mutex
	cached  map[string]*MintKeySet
	fetched time.Time
}

// mintKeysCacheTTL is short enough that a rotated keyset is picked up, long
// enough that a burst of bids does not re-fetch per transaction.
const mintKeysCacheTTL = 10 * time.Minute

func NewMintKeySetFetcher(mintURL string, timeout time.Duration) *MintKeySetFetcher {
	return &MintKeySetFetcher{Client: &http.Client{Timeout: timeout}, MintURL: strings.TrimRight(mintURL, "/")}
}

// Keyset returns the published keys for one keyset id, fetching if needed.
func (fetcher *MintKeySetFetcher) Keyset(keysetID string) (*MintKeySet, error) {
	if fetcher == nil || fetcher.Client == nil || fetcher.MintURL == "" {
		return nil, errors.New("no mint keyset fetcher is configured")
	}
	fetcher.mu.Lock()
	defer fetcher.mu.Unlock()
	if fetcher.cached == nil || time.Since(fetcher.fetched) > mintKeysCacheTTL {
		loaded, err := fetcher.fetch()
		if err != nil {
			return nil, err
		}
		fetcher.cached, fetcher.fetched = loaded, time.Now()
	}
	keyset, ok := fetcher.cached[keysetID]
	if !ok || keyset == nil {
		return nil, fmt.Errorf("%w: keyset %q", errDLEQKeyset, keysetID)
	}
	return keyset, nil
}

func (fetcher *MintKeySetFetcher) fetch() (map[string]*MintKeySet, error) {
	response, err := fetcher.Client.Get(fetcher.MintURL + "/v1/keys")
	if err != nil {
		return nil, fmt.Errorf("mint keyset request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mint keyset returned status %d", response.StatusCode)
	}
	var document mintKeysResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&document); err != nil {
		return nil, fmt.Errorf("mint keyset response is not a NUT-01 document: %w", err)
	}
	if len(document.Keysets) == 0 {
		return nil, errors.New("mint published no keysets, so no proof can be verified")
	}
	sets := make(map[string]*MintKeySet, len(document.Keysets))
	for _, entry := range document.Keysets {
		set := &MintKeySet{ID: entry.ID, Unit: entry.Unit, Keys: map[int64]*btcec.PublicKey{}}
		for amount, encoded := range entry.Keys {
			// Mints publish a key for every power of two up to and including
			// 2^63, which does not fit in an int64. Skip the ones we cannot
			// represent rather than failing the whole fetch: a bid amount is
			// bounded by policy, so an unusable denomination is not an error.
			value, parseErr := strconv.ParseInt(amount, 10, 64)
			if parseErr != nil || value <= 0 {
				continue
			}
			decoded, decodeErr := hex.DecodeString(encoded)
			if decodeErr != nil {
				return nil, fmt.Errorf("mint published an unparseable key for amount %s", amount)
			}
			key, keyErr := btcec.ParsePubKey(decoded)
			if keyErr != nil {
				return nil, fmt.Errorf("mint published an invalid key for amount %s", amount)
			}
			set.Keys[value] = key
		}
		sets[entry.ID] = set
	}
	return sets, nil
}

// MintKeySet is the public signing key material the mint publishes (NUT-01/09).
type MintKeySet struct {
	ID   string
	Unit string
	Keys map[int64]*btcec.PublicKey
}

// VerifyProofBinding checks a single NUT-12 binding against the mint key for its
// amount. It returns an error for every failure mode rather than a bool, so a
// caller cannot mistake "could not check" for "checked and fine".
func VerifyProofBinding(binding MintProofBinding, keyset *MintKeySet) error {
	if binding.DLEQ == nil {
		return errDLEQNoProof
	}
	if binding.Amount <= 0 || binding.KeysetID == "" {
		return errDLEQShape
	}
	if keyset == nil || keyset.ID != binding.KeysetID {
		return errDLEQKeyset
	}
	mintKey, published := keyset.Keys[binding.Amount]
	if !published || mintKey == nil {
		return fmt.Errorf("%w: amount %d", errDLEQKeyset, binding.Amount)
	}
	if !validCompressedPublicKey(binding.Y) || !validCompressedPublicKey(binding.C) {
		return errDLEQShape
	}

	curve := btcec.S256()
	order := curve.Params().N
	// Two different moduli matter here and confusing them is silent. Scalars
	// (e, s, r) are reduced modulo the curve ORDER; a point is negated by
	// subtracting its y coordinate from the FIELD prime. Negating modulo the
	// order instead produces a point that is not on the curve, so the challenge
	// never matches and every genuine proof is rejected.
	fieldPrime := curve.Params().P

	scalar := func(value string, what string) (*big.Int, error) {
		if !validLowerHex(value, 32) {
			return nil, fmt.Errorf("%w: %s", errDLEQShape, what)
		}
		decoded, _ := hex.DecodeString(value)
		candidate := new(big.Int).SetBytes(decoded)
		if candidate.Sign() == 0 || candidate.Cmp(order) >= 0 {
			return nil, fmt.Errorf("%w: %s is out of range", errDLEQShape, what)
		}
		return candidate, nil
	}
	e, err := scalar(binding.DLEQ.E, "e")
	if err != nil {
		return err
	}
	s, err := scalar(binding.DLEQ.S, "s")
	if err != nil {
		return err
	}
	r, err := scalar(binding.DLEQ.R, "r")
	if err != nil {
		return err
	}

	point := func(value string) (*big.Int, *big.Int, error) {
		decoded, _ := hex.DecodeString(value)
		parsed, err := btcec.ParsePubKey(decoded)
		if err != nil {
			return nil, nil, errDLEQShape
		}
		return parsed.X(), parsed.Y(), nil
	}
	Yx, Yy, err := point(binding.Y)
	if err != nil {
		return err
	}
	Cx, Cy, err := point(binding.C)
	if err != nil {
		return err
	}
	Ax, Ay := mintKey.X(), mintKey.Y()

	// C' = C + r*A
	rAx, rAy := curve.ScalarMult(Ax, Ay, r.Bytes())
	cpx, cpy := curve.Add(Cx, Cy, rAx, rAy)

	// B' = Y + r*G
	rGx, rGy := curve.ScalarBaseMult(r.Bytes())
	bpx, bpy := curve.Add(Yx, Yy, rGx, rGy)

	// R1 = s*G - e*A
	sGx, sGy := curve.ScalarBaseMult(s.Bytes())
	eAx, eAy := curve.ScalarMult(Ax, Ay, e.Bytes())
	r1x, r1y := curve.Add(sGx, sGy, eAx, new(big.Int).Sub(fieldPrime, eAy))

	// R2 = s*B' - e*C'
	sBx, sBy := curve.ScalarMult(bpx, bpy, s.Bytes())
	eCx, eCy := curve.ScalarMult(cpx, cpy, e.Bytes())
	r2x, r2y := curve.Add(sBx, sBy, eCx, new(big.Int).Sub(fieldPrime, eCy))

	// e == hash(R1, R2, A, C'), with each point as its uncompressed SEC1 hex.
	material := uncompressedHex(r1x, r1y) + uncompressedHex(r2x, r2y) +
		uncompressedHex(Ax, Ay) + uncompressedHex(cpx, cpy)
	challenge := sha256.Sum256([]byte(material))
	if hex.EncodeToString(challenge[:]) != binding.DLEQ.E {
		return errDLEQProof
	}
	return nil
}

// uncompressedHex renders a point exactly as NUT-12's hash expects: the 0x04
// SEC1 prefix followed by the two coordinates, each 32 bytes big-endian.
func uncompressedHex(x, y *big.Int) string {
	buffer := make([]byte, 65)
	buffer[0] = 4
	x.FillBytes(buffer[1:33])
	y.FillBytes(buffer[33:65])
	return hex.EncodeToString(buffer)
}

// VerifiedBacking sums the amounts of every binding that verifies against the
// published mint key, and reports the first failure. It returns the total AND
// the error, so a caller can distinguish "this bundle is worth less than
// claimed" from "this bundle is malformed".
func VerifiedBacking(bindings []MintProofBinding, keyset *MintKeySet) (int64, error) {
	var total int64
	for index, binding := range bindings {
		if err := VerifyProofBinding(binding, keyset); err != nil {
			return total, fmt.Errorf("proof %d: %w", index, err)
		}
		if binding.Amount > (1<<62)-total {
			return total, errors.New("Cashu proof amounts overflow")
		}
		total += binding.Amount
	}
	return total, nil
}
