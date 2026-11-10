package poc

// The committee signing port: the one place a committee spend signature is
// produced.
//
// Today the demo network holds a single secp256k1 committee key as a file, so
// the implementation below is a thin local signer. Later the same 33-byte
// public key will be a 3-of-4 FROST aggregate behind this exact method, so the
// mint, the lock and the wallet see no difference and nothing outside this port
// ever touches committee key material.
//
// Only the spend witness routes through here for now. The lock-receipt signing
// in demo_mint_lock.go still signs with the raw key; unifying it behind the
// port is a later change and is noted in the wave-1 report.
//
// A committee spend signature is never produced on the strength of caller-
// supplied values alone. Before either spend path calls SignDigest it runs the
// release check (release_check.go), which re-derives from the server's own
// committed state that the spend is authorized and its destination is the
// committed one. The check gates the call into this port, so it applies to any
// implementation behind it -- today's single key and a future FROST aggregate
// alike. The check catches non-colluding faults only; it does not stop a hacked
// majority.

import (
	"encoding/hex"
	"errors"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// CommitteeSigner is the only place a committee spend signature is produced.
// Today: one local secp256k1 key. Later: a 3-of-4 FROST aggregate behind the
// same method and the same 33-byte public key, so the mint, the lock and the
// wallet see no difference. Nothing outside this port may touch the key.
type CommitteeSigner interface {
	PublicKey() string
	SignDigest(digest []byte) (signature []byte, err error)
}

// localCommitteeSigner is the single-key implementation: it wraps the demo
// network's one committee secp256k1 key.
type localCommitteeSigner struct {
	key *btcec.PrivateKey
}

// NewLocalCommitteeSigner adapts the existing committee key to the port. It
// refuses a nil key so a misconfigured server fails at the seam rather than at
// the mint.
func NewLocalCommitteeSigner(key *btcec.PrivateKey) (CommitteeSigner, error) {
	if key == nil {
		return nil, errors.New("committee signer requires a key")
	}
	return localCommitteeSigner{key: key}, nil
}

// committeeSigner returns the port that produces the committee's half of a
// spend signature. It returns an injected signer when one is configured (the
// FROST seam), and otherwise adapts the demo network's single committee key to
// the same interface, so the spend path never signs with the raw key directly.
func (server *APIServer) committeeSigner() (CommitteeSigner, error) {
	if server.demoCommitteeSigner != nil {
		return server.demoCommitteeSigner, nil
	}
	if server.demoCommitteeKey == nil {
		return nil, errors.New("committee spend has no committee key or signer")
	}
	return NewLocalCommitteeSigner(server.demoCommitteeKey)
}

// PublicKey returns the compressed 33-byte committee public key, the form the
// mint, the lock and the wallet all use.
func (signer localCommitteeSigner) PublicKey() string {
	return hex.EncodeToString(signer.key.PubKey().SerializeCompressed())
}

// SignDigest produces the committee's half of a spend signature: a BIP-340
// Schnorr signature over the 32-byte digest. A FROST aggregate would return the
// same shape here.
func (signer localCommitteeSigner) SignDigest(digest []byte) ([]byte, error) {
	signature, err := schnorr.Sign(signer.key, digest)
	if err != nil {
		return nil, err
	}
	return signature.Serialize(), nil
}
