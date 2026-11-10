package poc

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

const (
	TxVersion  = 1
	KindCreate = 28640
	KindBid    = 28641
	KindRefund = 28642
	// KindSettle is the winner's record that the cooperative settlement swap
	// happened. It moves no value: the mint swap is the money, this event is
	// only the mirror. A settlement that never commits still leaves the seller
	// holding proofs locked to their own key.
	KindSettle = 28643
	// KindOutcome is the coordinator's own committed record that a mint-backed
	// lock reached its terminal outcome. It is posted only by the application
	// authority (the network's single secp256k1 committee key today), never by a
	// browser, and it carries the bidder's pre-published outcome authorization
	// as its warrant. It moves no value: the mint swap is the money, this event
	// is only the mirror, exactly like KindSettle.
	KindOutcome      = 28645
	KindFundingAbort = 28650
	MaxTxBytes       = 64 * 1024
	MaxInputs        = 32
	TestMintURL      = "http://127.0.0.1:8080/test-mint"
	CashuMintURL     = "http://127.0.0.1:3338"
	ProductionURL    = "relay.plebeian.market"

	FundingModeLegacy               = "legacy"
	FundingModeCustodialReservation = "custodial_reservation_v1"
	FundingModeThresholdSigAll      = "threshold_sigall_v1"
	// FundingModeCashuLock is the mint-backed route: the bidder locks real
	// Cashu proofs at the mint to a NUT-11 P2PK condition, and the receipt
	// carries the proof references the mint can be asked about (NUT-07).
	// It is the first funding mode whose backing is not a signed IOU.
	FundingModeCashuLock = "cashu_lock_v1"
	// FundingModeCashuSigAll is the SIG_ALL route: the bidder locks real Cashu
	// proofs to a 2-of-2 NUT-11 condition (bidder + committee) with
	// sigflag=SIG_ALL, so a spend must be signed by both and the signature
	// covers the whole transaction. The coordinator may then submit only one of
	// the two outcomes the bidder pre-authorized. It is mint-backed exactly
	// like cashu_lock_v1 and must not be confused with the Friday
	// threshold_sigall_v1 mode or the FROST/Comet pipeline.
	FundingModeCashuSigAll         = "cashu_sigall_v1"
	ApplicationAuthorityLegacy     = "legacy_ed25519_v1"
	ApplicationAuthorityFrostCashu = "frost_cashu_v4"
	frostLegacyNotePublicPinDomain = "PLEBEIAN_FRIDAY_DISABLED_LEGACY_NOTE_AUTHORITY_V1"

	// EmergencyRecoverySeconds is measured from the maximum possible auction
	// end, not the current end.  The cooperative committee stops new MAIN
	// authorizations five minutes before this locktime; the later unilateral
	// refund branch remains a liveness escape and does not revoke an older MAIN.
	EmergencyRecoverySeconds = int64(900)
)

var errIntegratedFundingReceiptExpired = errors.New("integrated funding attestation expired at committed block time")

type Policy struct {
	FaucetAmount       int64 `json:"faucet_amount"`
	FaucetCap          int64 `json:"faucet_cap"`
	MinBidIncrement    int64 `json:"min_bid_increment"`
	MinDurationSeconds int64 `json:"min_duration_seconds"`
	MaxDurationSeconds int64 `json:"max_duration_seconds"`
	EventSkewSeconds   int64 `json:"event_skew_seconds"`
	LateBidWindow      int64 `json:"late_bid_window_seconds"`
	LateBidExtension   int64 `json:"late_bid_extension_seconds"`
	MaxTotalExtension  int64 `json:"max_total_extension_seconds"`
	ReceiptTTLSeconds  int64 `json:"receipt_ttl_seconds"`
	// KeysetID and KeysetKeys are the genesis-pinned mint identity: the one
	// keyset every bid proof must name and the mint's public key for each
	// amount. They are what lets consensus verify a proof's DLEQ without any
	// mint call, so a bid can carry its own backing and every validator checks
	// it rather than trusting one party's attestation. Both are OMITTED while
	// empty: a manifest (and the app hash over the marshalled state) that never
	// pinned a keyset must serialize exactly as it did before these fields
	// existed. Amounts are decimal strings; keys are compressed secp256k1 hex.
	KeysetID   string            `json:"keyset_id,omitempty"`
	KeysetKeys map[string]string `json:"keyset_keys,omitempty"`
}

// keysetKeyForAmount is the derived convenience the brief freezes: the pinned
// mint public key for an amount, or false when this network pinned no keyset or
// pinned none for that amount. It never falls back to a fetched key: consensus
// must read only what genesis pinned.
func (p Policy) keysetKeyForAmount(amount int64) (string, bool) {
	if amount <= 0 || len(p.KeysetKeys) == 0 {
		return "", false
	}
	key, ok := p.KeysetKeys[strconv.FormatInt(amount, 10)]
	if !ok || key == "" {
		return "", false
	}
	return key, true
}

// pinnedKeysetID reports the keyset every proof must name, empty when none is
// pinned.
func (p Policy) pinnedKeysetID() string {
	return p.KeysetID
}

// validatePinnedKeyset enforces that the pinned identity is either entirely
// absent or internally consistent at genesis: a keyset id and a nonempty key
// map that parses as compressed points, both required together. This runs at
// init (through Policy.Validate) and again on every manifest load, so consensus
// never starts against a half-pinned keyset.
func (p Policy) validatePinnedKeyset() error {
	if p.KeysetID == "" && len(p.KeysetKeys) == 0 {
		return nil
	}
	if p.KeysetID == "" || len(p.KeysetKeys) == 0 {
		return errors.New("invalid explicit POC policy: pinned mint keyset requires both a keyset id and its per-amount keys")
	}
	for amount, encoded := range p.KeysetKeys {
		if !pinnedAmountIsPositive(amount) {
			return fmt.Errorf("invalid explicit POC policy: pinned mint key amount %q is not a positive decimal", amount)
		}
		if !validCompressedPublicKey(encoded) {
			return fmt.Errorf("invalid explicit POC policy: pinned mint key for amount %s is not a compressed secp256k1 point", amount)
		}
	}
	return nil
}

// pinnedAmountIsPositive reports whether a pinned amount key is a positive
// decimal integer of any width. It cannot use strconv.ParseInt: a real Cashu
// mint pins amounts up to 2^63, which does not fit an int64, and the intended
// genesis input is the mint's own /keys object. Such an amount is recorded but
// is unreachable through keysetKeyForAmount, because a proof's amount is an
// int64, so the check is about the shape of the key, not its magnitude. The
// grammar matches strconv.ParseInt base 10 (an optional single sign, then
// digits) so no previously valid keyset is newly refused.
func pinnedAmountIsPositive(amount string) bool {
	digits := amount
	if digits != "" && (digits[0] == '+' || digits[0] == '-') {
		if digits[0] == '-' {
			return false
		}
		digits = digits[1:]
	}
	if digits == "" {
		return false
	}
	nonzero := false
	for i := 0; i < len(digits); i++ {
		if digits[i] < '0' || digits[i] > '9' {
			return false
		}
		if digits[i] != '0' {
			nonzero = true
		}
	}
	return nonzero
}

// Equal reports whether two policies are identical, including the pinned mint
// identity maps. The maps make Policy non-comparable with ==, so genesis
// comparisons that must pin the WHOLE struct (friday_comet_init.go) call this
// instead of losing that property.
func (p Policy) Equal(other Policy) bool {
	if p.FaucetAmount != other.FaucetAmount || p.FaucetCap != other.FaucetCap ||
		p.MinBidIncrement != other.MinBidIncrement || p.MinDurationSeconds != other.MinDurationSeconds ||
		p.MaxDurationSeconds != other.MaxDurationSeconds || p.EventSkewSeconds != other.EventSkewSeconds ||
		p.LateBidWindow != other.LateBidWindow || p.LateBidExtension != other.LateBidExtension ||
		p.MaxTotalExtension != other.MaxTotalExtension || p.ReceiptTTLSeconds != other.ReceiptTTLSeconds ||
		p.KeysetID != other.KeysetID {
		return false
	}
	if len(p.KeysetKeys) != len(other.KeysetKeys) {
		return false
	}
	for amount, key := range p.KeysetKeys {
		if other.KeysetKeys[amount] != key {
			return false
		}
	}
	return true
}

func DefaultPolicy() Policy {
	return Policy{
		FaucetAmount: 10_000, FaucetCap: 50_000, MinBidIncrement: 100,
		MinDurationSeconds: 3, MaxDurationSeconds: 3_600, EventSkewSeconds: 300,
		LateBidWindow: 180, LateBidExtension: 180, MaxTotalExtension: 1_800,
		ReceiptTTLSeconds: 300,
	}
}

func (p Policy) Validate() error {
	if p.FaucetAmount <= 0 || p.FaucetCap < p.FaucetAmount || p.MinBidIncrement <= 0 ||
		p.FaucetAmount > 9_007_199_254_740_991 || p.FaucetCap > 9_007_199_254_740_991 ||
		p.MinDurationSeconds <= 0 || p.MaxDurationSeconds < p.MinDurationSeconds || p.EventSkewSeconds <= 0 ||
		p.LateBidWindow <= 0 || p.LateBidExtension <= 0 || p.MaxTotalExtension < p.LateBidExtension || p.ReceiptTTLSeconds <= 0 {
		return errors.New("invalid explicit POC policy")
	}
	return p.validatePinnedKeyset()
}

type SignedEvent struct {
	ID        string     `json:"id"`
	PubKey    string     `json:"pubkey"`
	CreatedAt int64      `json:"created_at"`
	Kind      int        `json:"kind"`
	Tags      [][]string `json:"tags"`
	Content   string     `json:"content"`
	Sig       string     `json:"sig"`
}

type Transaction struct {
	Version      int                        `json:"version"`
	Type         string                     `json:"type"`
	Actor        string                     `json:"actor,omitempty"`
	AuctionID    string                     `json:"auction_id,omitempty"`
	Event        *SignedEvent               `json:"event,omitempty"`
	FundingAbort *FundingAbortCertificateV1 `json:"funding_abort,omitempty"`
}

type Note struct {
	ID        string `json:"id"`
	Amount    int64  `json:"amount"`
	Owner     string `json:"owner"`
	Signature string `json:"signature"`
	SpentBy   string `json:"spent_by,omitempty"`
}

type Bid struct {
	ID                  string   `json:"id"`
	AuctionID           string   `json:"auction_id"`
	Bidder              string   `json:"bidder"`
	Amount              int64    `json:"amount"`
	InputNoteIDs        []string `json:"input_note_ids,omitempty"`
	CashuTokenSHA256    string   `json:"cashu_token_sha256,omitempty"`
	CashuLockOperation  string   `json:"cashu_lock_operation,omitempty"`
	ReservationID       string   `json:"reservation_id,omitempty"`
	IntegratedFundingID string   `json:"integrated_funding_id,omitempty"`
	ReplacesBidID       string   `json:"replaces_bid_id,omitempty"`
	// OutcomeTemplates is the committed cashu_sigall_v1 bid's own carrier of
	// the bidder's pre-signed settle and refund transactions. It lives in
	// consensus state (verified in ApplyTransaction before it is stored) so the
	// coordinator's offline sweeper can submit exactly the pre-authorized
	// outcome without a separate bearer store. Omitted for every other route.
	OutcomeTemplates *sigAllDepositTemplates `json:"outcome_templates,omitempty"`
	CommittedAt      int64                   `json:"committed_at"`
}

// IntegratedFundingReceipt is the non-bearer, consensus-visible admission
// record for the fake-only threshold route.  The proof references are Cashu Y
// points, never bearer secrets.  The FROST group attests that its participants
// independently verified the exact hidden package, mint state, current leader,
// and pre-signed full-pool return before admission.  The ABCI transition—not a
// participant-local row—then serializes the global proof claim.  This route is
// deliberately separate from the coordinator-signed custodial candidate.
type IntegratedFundingReceipt struct {
	Schema                    string       `json:"schema"`
	AuthNetworkID             string       `json:"auth_network_id"`
	ChainID                   string       `json:"chain_id"`
	MintURL                   string       `json:"mint_url"`
	AuctionID                 string       `json:"auction_id"`
	Bidder                    string       `json:"bidder"`
	BidAmount                 int64        `json:"bid_amount"`
	PoolAmount                int64        `json:"pool_amount"`
	ReplacesBidID             string       `json:"replaces_bid_id"`
	FundingOperationID        string       `json:"funding_operation_id"`
	AttestedAt                int64        `json:"attested_at"`
	ExpiresAt                 int64        `json:"expires_at"`
	ProofStateRefs            []string     `json:"proof_state_refs"`
	ActiveKeysetID            string       `json:"active_keyset_id"`
	InputFeePPK               int64        `json:"input_fee_ppk"`
	Locktime                  int64        `json:"locktime"`
	BidderPublicKey           string       `json:"bidder_public_key"`
	RefundPublicKey           string       `json:"refund_public_key"`
	CommitteePublicKey        string       `json:"committee_public_key"`
	CommitteeKeysetID         string       `json:"committee_keyset_id"`
	CommitteeKeysetVersion    string       `json:"committee_keyset_version"`
	DKGRunID                  string       `json:"dkg_run_id"`
	PublicKeyPackageSHA256    string       `json:"public_key_package_sha256"`
	SignerRosterDigest        string       `json:"signer_roster_digest"`
	WinnerPackageDigest       string       `json:"winner_package_digest"`
	ReturnPackageDigest       string       `json:"return_package_digest"`
	ReturnCashuSigAllDigest   string       `json:"return_cashu_sigall_digest"`
	PreparedBundleDigest      string       `json:"prepared_bundle_digest,omitempty"`
	BundleDigest              string       `json:"bundle_digest"`
	ActorFundingSignature     string       `json:"actor_funding_signature,omitempty"`
	ActorFundingAuthorization *SignedEvent `json:"actor_funding_authorization,omitempty"`
	BidderReturnSignature     string       `json:"bidder_return_signature"`
	ParticipantPolicyDigest   string       `json:"participant_policy_digest"`
	CommitteeSignature        string       `json:"committee_signature"`
}

type IntegratedFunding struct {
	ID              string                   `json:"id"`
	AuctionID       string                   `json:"auction_id"`
	BidID           string                   `json:"bid_id"`
	Bidder          string                   `json:"bidder"`
	Status          string                   `json:"status"`
	RejectionReason string                   `json:"rejection_reason,omitempty"`
	CommittedAt     int64                    `json:"committed_at"`
	Receipt         IntegratedFundingReceipt `json:"receipt"`
}

// IntegratedDisplacement is immutable consensus history retained when one
// threshold-funded bid replaces another.  A signer still verifies the raw
// replacement transaction in its local Comet block and H+1/H+2 commits; this
// record supplies the deterministic prior-state facts that are not caller
// assertions.
type IntegratedDisplacement struct {
	ID                   string `json:"id"`
	AuctionID            string `json:"auction_id"`
	DisplacedBidID       string `json:"displaced_bid_id"`
	ReplacementBidID     string `json:"replacement_bid_id"`
	DisplacedFundingID   string `json:"displaced_funding_id"`
	ReplacementFundingID string `json:"replacement_funding_id"`
	CommittedAt          int64  `json:"committed_at"`
	OriginalEndTime      int64  `json:"original_end_time"`
	CertifiedEndTime     int64  `json:"certified_end_time"`
}

// CustodyReservationReceipt is public, non-bearer evidence that the custodial
// coordinator has made already-funded wallet value unavailable. It is an
// application reservation, not a Cashu/NUT-11 lock.
type CustodyReservationReceipt struct {
	Schema                string `json:"schema"`
	MintURL               string `json:"mint_url"`
	AuctionID             string `json:"auction_id"`
	Bidder                string `json:"bidder"`
	Amount                int64  `json:"amount"`
	ReservationID         string `json:"reservation_id"`
	ReplacesReservationID string `json:"replaces_reservation_id,omitempty"`
	ExpiresAt             int64  `json:"expires_at"`
	CommitteePublicKey    string `json:"committee_public_key"`
	Signature             string `json:"signature"`
}

type CustodyReservation struct {
	ID                    string `json:"id"`
	AuctionID             string `json:"auction_id"`
	BidID                 string `json:"bid_id"`
	Bidder                string `json:"bidder"`
	Amount                int64  `json:"amount"`
	ReplacesReservationID string `json:"replaces_reservation_id,omitempty"`
	Status                string `json:"status"`
	CommittedAt           int64  `json:"committed_at"`
}

// CashuLockReceipt is public, non-bearer evidence from the application-level
// payment coordinator. The signed receipt is issued only after Coco has
// produced and read back the mint-signed NUT-11 token. It deliberately carries
// a token digest rather than bearer proofs. The trusted signer is a single POC
// committee key, not FROST or threshold custody.
type CashuLockReceipt struct {
	Schema             string `json:"schema"`
	MintURL            string `json:"mint_url"`
	AuctionID          string `json:"auction_id"`
	Bidder             string `json:"bidder"`
	Amount             int64  `json:"amount"`
	OperationID        string `json:"operation_id"`
	TokenSHA256        string `json:"token_sha256"`
	CommitteePublicKey string `json:"committee_public_key"`
	RefundPublicKey    string `json:"refund_public_key"`
	Locktime           int64  `json:"locktime"`
	// FundingMode records which mint-backed route issued the receipt:
	// cashu_lock_v1 (single-key P2PK witness) or cashu_sigall_v1 (2-of-2
	// SIG_ALL lock). It is omitempty so every pre-existing receipt replays
	// byte-identically; the digest commits it only when it is non-empty.
	FundingMode string `json:"funding_mode,omitempty"`
	// ProofStateRefs are the NUT-07 references (compressed Y points) of the
	// proofs backing this bid. They are public, non-bearer material: a Y point
	// lets anyone ask the mint about the proof but lets nobody spend it.
	ProofStateRefs []string `json:"proof_state_refs,omitempty"`
	Signature      string   `json:"signature"`
}

type Lock struct {
	ID           string `json:"id"`
	AuctionID    string `json:"auction_id"`
	BidID        string `json:"bid_id"`
	Bidder       string `json:"bidder"`
	Amount       int64  `json:"amount"`
	Status       string `json:"status"`
	OutputNoteID string `json:"output_note_id,omitempty"`
	// CashuPayoutTokenSHA256 is the winner's record of the fresh proofs the
	// settlement swap produced. Consensus cannot verify it -- the proofs are
	// P2PK-locked to the seller's key and only the seller can spend them -- so
	// it is a record, not a proof. It is omitempty so every pre-existing lock
	// replays byte-identically.
	CashuPayoutTokenSHA256 string `json:"cashu_payout_token_sha256,omitempty"`
	// SettleAuthorization and RefundAuthorization are the bidder's wallet
	// spend-key pre-signatures, published with the bid and stored here so the
	// coordinator can settle or refund later without the bidder online. Both
	// are omitempty: a lock for any non-mint-backed funding path, or one
	// committed before this field existed, replays byte-identically.
	SettleAuthorization string `json:"settle_authorization,omitempty"`
	RefundAuthorization string `json:"refund_authorization,omitempty"`
}

type Auction struct {
	ID                         string `json:"id"`
	Seller                     string `json:"seller"`
	Title                      string `json:"title"`
	Description                string `json:"description,omitempty"`
	ImageURL                   string `json:"image_url,omitempty"`
	FundingMode                string `json:"funding_mode"`
	SellerCocoPaymentPublicKey string `json:"seller_coco_payment_public_key,omitempty"`
	StartingBid                int64  `json:"starting_bid"`
	MinIncrement               int64  `json:"min_increment"`
	Reserve                    int64  `json:"reserve"`
	CreatedAt                  int64  `json:"created_at"`
	OriginalEndTime            int64  `json:"original_end_time"`
	EndTime                    int64  `json:"end_time"`
	ExtensionCount             int    `json:"extension_count"`
	Status                     string `json:"status"`
	LeaderBidID                string `json:"leader_bid_id,omitempty"`
	HighBid                    int64  `json:"high_bid"`
	Winner                     string `json:"winner,omitempty"`
	ClosedAt                   int64  `json:"closed_at,omitempty"`
	PaymentNoteID              string `json:"payment_note_id,omitempty"`
	// The auction chooses its own anti-snipe timing, exactly as it already
	// chooses duration and min increment; the network policy is only the
	// CEILING enforced at create. LateBidWindow == 0 disables anti-sniping:
	// no bid extends the end and the auction closes exactly at EndTime.
	LateBidWindow     int64 `json:"late_bid_window_seconds"`
	LateBidExtension  int64 `json:"late_bid_extension_seconds"`
	MaxTotalExtension int64 `json:"max_total_extension_seconds"`
	// RequiredLocktime is DERIVED, read-only: the locktime a bid's mint lock
	// must carry. It is the maximum reachable end (OriginalEndTime +
	// MaxTotalExtension) plus the recovery window consensus reserves after it.
	// It is exposed so a client reads the floor instead of recomputing it.
	RequiredLocktime int64 `json:"required_locktime"`
}

// auctionRequiredLocktime is the single derivation every call site uses: the
// locktime a mint-backed bid must carry so it outlives the worst-case auction
// end (original_end + this auction's own cumulative extension cap) plus the
// recovery window consensus reserves after that end. EmergencyRecoverySeconds
// stays a package constant: it is not an auction choice.
func auctionRequiredLocktime(auction Auction) int64 {
	return auction.OriginalEndTime + auction.MaxTotalExtension + EmergencyRecoverySeconds
}

type State struct {
	Schema               string                      `json:"schema"`
	ApplicationAuthority string                      `json:"application_authority"`
	AuthNetworkID        string                      `json:"auth_network_id"`
	ChainID              string                      `json:"chain_id"`
	Height               int64                       `json:"height"`
	MintURL              string                      `json:"mint_url"`
	MintPublicKey        string                      `json:"mint_public_key"`
	CashuMintURL         string                      `json:"cashu_mint_url"`
	CommitteePublicKey   string                      `json:"committee_public_key"`
	Issued               map[string]bool             `json:"issued"`
	Notes                map[string]Note             `json:"notes"`
	Auctions             map[string]Auction          `json:"auctions"`
	Bids                 map[string]Bid              `json:"bids"`
	Locks                map[string]Lock             `json:"locks"`
	Operations           map[string]bool             `json:"operations"`
	CashuLocks           map[string]CashuLockReceipt `json:"cashu_locks"`
	// CashuProofUses maps a proof reference (the x coordinate of Y) to the
	// token digest of the bid that committed it. This is the deterministic,
	// consensus-enforced half of mint-backed funding: one proof can never fund
	// two bids, no matter what any mint or coordinator says.
	// omitempty matters: CanonicalHash is a hash of the whole marshalled state,
	// so a field that is always emitted would change every state's hash and make
	// an existing chain impossible to replay. Omitted while empty, a chain that
	// never used mint-backed funding hashes exactly as it did before this field
	// existed.
	CashuProofUses          map[string]string                 `json:"cashu_proof_uses,omitempty"`
	CustodyReservations     map[string]CustodyReservation     `json:"custody_reservations"`
	IntegratedFundings      map[string]IntegratedFunding      `json:"integrated_fundings"`
	IntegratedProofUses     map[string]string                 `json:"integrated_proof_uses"`
	IntegratedDisplacements map[string]IntegratedDisplacement `json:"integrated_displacements"`
	FundingAbortPins        *FundingAbortPinsV1               `json:"funding_abort_pins,omitempty"`
	FundingLifecycles       map[string]FundingLifecycleV1     `json:"funding_lifecycles"`
	FundingProofOwners      map[string]string                 `json:"funding_proof_owners"`
	LastConsensusTime       int64                             `json:"last_consensus_time"`
}

type WalletView struct {
	Actor      string `json:"actor"`
	Spendable  int64  `json:"spendable"`
	Locked     int64  `json:"locked"`
	Refundable int64  `json:"refundable"`
	Notes      []Note `json:"notes"`
}

type StateView struct {
	State          State      `json:"state"`
	Wallet         WalletView `json:"wallet"`
	AppHash        string     `json:"app_hash"`
	CanonicalState string     `json:"canonical_state"`
}

func NewState(chainID string, mintPublic ed25519.PublicKey, committeePublicKey string) (State, error) {
	return NewStateWithEndpoints(chainID, mintPublic, committeePublicKey, TestMintURL, CashuMintURL)
}

func validateFakeMoneyEndpoint(raw string, expectedPath string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != expectedPath {
		return errors.New("fake-money endpoint must be one exact private HTTP origin/path")
	}
	ip := net.ParseIP(parsed.Hostname())
	port, err := strconv.Atoi(parsed.Port())
	if ip == nil || (!ip.IsLoopback() && !ip.IsPrivate()) || err != nil || port < 1024 || port > 65535 || strings.Contains(raw, ProductionURL) {
		return errors.New("fake-money endpoint must use a private IP and unprivileged port")
	}
	return nil
}

// validateCashuMintIdentity validates the canonical receipt identity, not the
// server's transport address. Local/lab networks retain the private HTTP form;
// a public deployment records the HTTPS origin a bidder's browser will actually
// reach, which may be an IP literal or a hostname. The transport is separately
// pinned, so the identity only has to be unambiguous and credential-free.
func validateCashuMintIdentity(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" || parsed.Opaque != "" || strings.Contains(raw, ProductionURL) {
		return errors.New("Cashu mint identity must be one exact credential-free origin")
	}
	if parsed.Scheme == "http" {
		return validateFakeMoneyEndpoint(raw, "")
	}
	if parsed.Scheme != "https" || parsed.Hostname() == "" || (parsed.Port() != "" && parsed.Port() != "443") {
		return errors.New("Cashu mint identity must use private HTTP or public HTTPS")
	}
	// The host is deliberately not constrained beyond the origin checks above.
	// An earlier rule required a public IP literal and refused any hostname,
	// which conflated the mint's identity with its addressing: a mint reached by
	// name over verified TLS is not less well identified than one reached by
	// address, and a name is what a certificate can actually attest. It also made
	// the intended deployment impossible, because a bidder's browser has to reach
	// this origin and browsers reach names. The identity still has to be one
	// credential-free origin with no path or query, which is what the receipt is
	// bound to; that is the property worth enforcing.
	return nil
}

func NewStateWithEndpoints(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string) (State, error) {
	return newStateWithAuthority(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL, ApplicationAuthorityLegacy)
}

// newStateWithFrostAuthority creates the Friday FROST/Coco application state
// from public pins only. MintPublicKey is a deterministic disabled-legacy-note
// namespace pin; no corresponding private key is generated or accepted.
func newStateWithFrostAuthority(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string) (State, error) {
	return newStateWithAuthority(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL, ApplicationAuthorityFrostCashu)
}

func newStateWithAuthority(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL, authority string) (State, error) {
	if strings.TrimSpace(chainID) == "" || len(mintPublic) != ed25519.PublicKeySize || !validCompressedPublicKey(committeePublicKey) {
		return State{}, errors.New("chain id, mint public key, and Cashu committee public key are required")
	}
	if authority != ApplicationAuthorityLegacy && authority != ApplicationAuthorityFrostCashu {
		return State{}, errors.New("application authority mode is unsupported")
	}
	if err := validateFakeMoneyEndpoint(mintURL, "/test-mint"); err != nil {
		return State{}, err
	}
	if err := validateCashuMintIdentity(cashuMintURL); err != nil {
		return State{}, err
	}
	return State{
		Schema:                  "PlebeianAuctionsPOCStateV8",
		ApplicationAuthority:    authority,
		AuthNetworkID:           chainID,
		ChainID:                 chainID,
		MintURL:                 mintURL,
		MintPublicKey:           hex.EncodeToString(mintPublic),
		CashuMintURL:            cashuMintURL,
		CommitteePublicKey:      committeePublicKey,
		Issued:                  map[string]bool{},
		Notes:                   map[string]Note{},
		Auctions:                map[string]Auction{},
		Bids:                    map[string]Bid{},
		Locks:                   map[string]Lock{},
		Operations:              map[string]bool{},
		CashuLocks:              map[string]CashuLockReceipt{},
		CashuProofUses:          map[string]string{},
		CustodyReservations:     map[string]CustodyReservation{},
		IntegratedFundings:      map[string]IntegratedFunding{},
		IntegratedProofUses:     map[string]string{},
		IntegratedDisplacements: map[string]IntegratedDisplacement{},
		FundingLifecycles:       map[string]FundingLifecycleV1{},
		FundingProofOwners:      map[string]string{},
	}, nil
}

// NewStateWithFundingAbortPins is the only constructor that enables the
// FundingAbortV1 transition. The persisted pins are deployment authority;
// abort transactions can never supply or replace them.
func NewStateWithFundingAbortPins(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string, pins FundingAbortPinsV1) (State, error) {
	state, err := NewStateWithEndpoints(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL)
	if err != nil {
		return State{}, err
	}
	if err := validateFundingAbortPins(state, pins); err != nil {
		return State{}, err
	}
	state.FundingAbortPins = &pins
	return state, nil
}

// NewStateWithFrostFundingAbortPins binds FundingAbortV1 without enrolling
// the legacy shared Ed25519 note issuer.
func NewStateWithFrostFundingAbortPins(chainID string, mintPublic ed25519.PublicKey, committeePublicKey, mintURL, cashuMintURL string, pins FundingAbortPinsV1) (State, error) {
	expectedPublic, err := DeriveFrostCashuLegacyNotePublicPin(pins)
	if err != nil {
		return State{}, err
	}
	if !bytes.Equal(mintPublic, expectedPublic) {
		return State{}, errors.New("FROST/Cashu disabled legacy-note authority pin differs")
	}
	state, err := newStateWithFrostAuthority(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL)
	if err != nil {
		return State{}, err
	}
	if err := validateFundingAbortPins(state, pins); err != nil {
		return State{}, err
	}
	state.FundingAbortPins = &pins
	return state, nil
}

// DeriveFrostCashuLegacyNotePublicPin deterministically fills the historical
// MintPublicKey field without creating, retaining, or implying a shared note
// issuer secret. The FROST/Cashu transition gate rejects every legacy note
// issuance path; the derived bytes only bind that disabled namespace into the
// genesis application hash and deployment receipt.
func DeriveFrostCashuLegacyNotePublicPin(pins FundingAbortPinsV1) (ed25519.PublicKey, error) {
	if pins.AuthNetworkID == "" || pins.AuthNetworkID != pins.ChainID ||
		validateCashuMintIdentity(pins.MintURL) != nil || !validLowerHex(pins.GenesisSHA256, sha256.Size) ||
		!validOperationID(pins.ActiveKeysetID) || !validCompressedPublicKey(pins.CommitteePublicKey) ||
		!validOperationID(pins.CommitteeKeysetID) || !validOperationID(pins.CommitteeKeysetVersion) ||
		!validOperationID(pins.DKGRunID) || !validLowerHex(pins.PublicKeyPackageSHA256, sha256.Size) ||
		!validLowerHex(pins.SignerRosterDigest, sha256.Size) {
		return nil, errors.New("FROST/Cashu authority pins are malformed")
	}
	material, err := json.Marshal([]string{
		pins.AuthNetworkID, pins.ChainID, pins.GenesisSHA256, pins.MintURL, pins.ActiveKeysetID,
		pins.CommitteePublicKey, pins.CommitteeKeysetID, pins.CommitteeKeysetVersion,
		pins.DKGRunID, pins.PublicKeyPackageSHA256, pins.SignerRosterDigest,
	})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(append([]byte(frostLegacyNotePublicPinDomain), material...))
	return append(ed25519.PublicKey(nil), digest[:]...), nil
}

// ensureMaps restores any map this application writes to. Two ways a map
// arrives nil: a state persisted before the field existed, and Clone's
// marshal/unmarshal round-trip, which drops an empty map whose field is tagged
// omitempty. Assigning into a nil map is a panic, and inside ApplyTransaction a
// panic is a chain halt rather than a rejected transaction, so both paths must
// be closed here rather than at each assignment site.
func (s *State) ensureMaps() {
	if s.CustodyReservations == nil {
		s.CustodyReservations = map[string]CustodyReservation{}
	}
	if s.IntegratedFundings == nil {
		s.IntegratedFundings = map[string]IntegratedFunding{}
	}
	if s.IntegratedProofUses == nil {
		s.IntegratedProofUses = map[string]string{}
	}
	if s.CashuProofUses == nil {
		s.CashuProofUses = map[string]string{}
	}
}

func normalizeState(state *State, policy Policy) error {
	if state.Schema != "PlebeianAuctionsPOCStateV2" && state.Schema != "PlebeianAuctionsPOCStateV3" &&
		state.Schema != "PlebeianAuctionsPOCStateV4" && state.Schema != "PlebeianAuctionsPOCStateV5" &&
		state.Schema != "PlebeianAuctionsPOCStateV6" && state.Schema != "PlebeianAuctionsPOCStateV7" &&
		state.Schema != "PlebeianAuctionsPOCStateV8" {
		return errors.New("persisted application state schema is unsupported")
	}
	state.Schema = "PlebeianAuctionsPOCStateV8"
	if state.ApplicationAuthority == "" {
		state.ApplicationAuthority = ApplicationAuthorityLegacy
	}
	if state.ApplicationAuthority != ApplicationAuthorityLegacy && state.ApplicationAuthority != ApplicationAuthorityFrostCashu {
		return errors.New("persisted application authority mode is unsupported")
	}
	if state.AuthNetworkID == "" {
		state.AuthNetworkID = state.ChainID
	}
	state.ensureMaps()
	normalizedProofUses := make(map[string]string, len(state.IntegratedProofUses))
	for proofStateRef, operationID := range state.IntegratedProofUses {
		key := proofStateRef
		if validCompressedPublicKey(proofStateRef) {
			key = proofStateRef[2:]
		} else if !validLowerHex(proofStateRef, 32) {
			return errors.New("persisted integrated proof-use key is malformed")
		}
		if !validOperationID(operationID) {
			return errors.New("persisted integrated proof-use operation is malformed")
		}
		if existing := normalizedProofUses[key]; existing != "" && existing != operationID {
			return errors.New("persisted integrated proof-use aliases conflict")
		}
		normalizedProofUses[key] = operationID
	}
	state.IntegratedProofUses = normalizedProofUses
	if state.IntegratedDisplacements == nil {
		state.IntegratedDisplacements = map[string]IntegratedDisplacement{}
	}
	if state.FundingLifecycles == nil {
		state.FundingLifecycles = map[string]FundingLifecycleV1{}
	}
	if state.FundingProofOwners == nil {
		state.FundingProofOwners = map[string]string{}
	}
	if state.FundingAbortPins != nil {
		if err := validateFundingAbortPins(*state, *state.FundingAbortPins); err != nil {
			return fmt.Errorf("persisted funding-abort pins are invalid: %w", err)
		}
	}
	if err := normalizeFundingLifecycleState(state); err != nil {
		return err
	}
	for id, auction := range state.Auctions {
		if auction.FundingMode == "" {
			auction.FundingMode = FundingModeLegacy
		}
		if auction.FundingMode != FundingModeLegacy && auction.FundingMode != FundingModeCustodialReservation &&
			auction.FundingMode != FundingModeThresholdSigAll && auction.FundingMode != FundingModeCashuLock &&
			auction.FundingMode != FundingModeCashuSigAll {
			return errors.New("persisted auction funding mode is unsupported")
		}
		if auction.OriginalEndTime == 0 {
			auction.OriginalEndTime = auction.EndTime
		}
		if auction.MinIncrement == 0 {
			auction.MinIncrement = policy.MinBidIncrement
		}
		state.Auctions[id] = auction
	}
	return nil
}

func (s State) Clone() (State, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return State{}, err
	}
	var cloned State
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return State{}, err
	}
	cloned.ensureMaps()
	return cloned, nil
}

func (s State) CanonicalHash() ([32]byte, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(raw), nil
}

func (s State) View(actor string) (StateView, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return StateView{}, err
	}
	hash := sha256.Sum256(raw)
	view := StateView{
		State: s, AppHash: hex.EncodeToString(hash[:]), CanonicalState: base64.StdEncoding.EncodeToString(raw),
		Wallet: WalletView{Actor: actor},
	}
	for _, note := range s.Notes {
		if note.Owner == actor && note.SpentBy == "" {
			view.Wallet.Spendable += note.Amount
			view.Wallet.Notes = append(view.Wallet.Notes, note)
		}
	}
	for _, lock := range s.Locks {
		if lock.Bidder != actor {
			continue
		}
		switch lock.Status {
		case "locked":
			view.Wallet.Locked += lock.Amount
		case "refundable":
			view.Wallet.Refundable += lock.Amount
		}
	}
	sort.Slice(view.Wallet.Notes, func(i, j int) bool { return view.Wallet.Notes[i].ID < view.Wallet.Notes[j].ID })
	return view, nil
}

func EncodeTransaction(tx Transaction) ([]byte, error) {
	if tx.Version == 0 {
		tx.Version = TxVersion
	}
	raw, err := json.Marshal(tx)
	if err != nil {
		return nil, err
	}
	if len(raw) > MaxTxBytes {
		return nil, errors.New("transaction exceeds POC byte limit")
	}
	return raw, nil
}

func DecodeTransaction(raw []byte) (Transaction, error) {
	if len(raw) == 0 || len(raw) > MaxTxBytes {
		return Transaction{}, errors.New("transaction byte length is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var tx Transaction
	if err := decoder.Decode(&tx); err != nil {
		return Transaction{}, fmt.Errorf("decode transaction: %w", err)
	}
	if err := requireEOF(decoder); err != nil {
		return Transaction{}, err
	}
	if tx.Version != TxVersion {
		return Transaction{}, errors.New("unsupported transaction version")
	}
	switch tx.Type {
	case "faucet":
		if !validActor(tx.Actor) || tx.Event != nil || tx.AuctionID != "" || tx.FundingAbort != nil {
			return Transaction{}, errors.New("invalid faucet transaction shape")
		}
	case "event":
		if tx.Event == nil || tx.Actor != "" || tx.AuctionID != "" || tx.FundingAbort != nil {
			return Transaction{}, errors.New("invalid signed-event transaction shape")
		}
	case "close":
		if !validIdentifier(tx.AuctionID) || tx.Actor != "" || tx.Event != nil || tx.FundingAbort != nil {
			return Transaction{}, errors.New("invalid close transaction shape")
		}
	case "funding_abort":
		if tx.FundingAbort == nil || tx.Actor != "" || tx.AuctionID != "" || tx.Event != nil {
			return Transaction{}, errors.New("invalid funding-abort transaction shape")
		}
	default:
		return Transaction{}, errors.New("unsupported transaction type")
	}
	return tx, nil
}

type createContent struct {
	AuctionID                  string `json:"auction_id"`
	Title                      string `json:"title"`
	Description                string `json:"description,omitempty"`
	ImageURL                   string `json:"image_url,omitempty"`
	Duration                   int64  `json:"duration_seconds"`
	StartingBid                int64  `json:"starting_bid"`
	MinIncrement               int64  `json:"min_increment,omitempty"`
	Reserve                    int64  `json:"reserve"`
	FundingMode                string `json:"funding_mode,omitempty"`
	SellerCocoPaymentPublicKey string `json:"seller_coco_payment_public_key,omitempty"`
	// The auction's own anti-snipe timing. Each is OPTIONAL (a pointer): nil
	// means "omit, take the network policy's value", which is exactly the
	// pre-existing behaviour. A present 0 is a deliberate choice -- a zero
	// window disables anti-sniping. The network policy bounds each at create.
	LateBidWindowSeconds     *int64 `json:"late_bid_window_seconds,omitempty"`
	LateBidExtensionSeconds  *int64 `json:"late_bid_extension_seconds,omitempty"`
	MaxTotalExtensionSeconds *int64 `json:"max_total_extension_seconds,omitempty"`
	// LocktimeSeconds is the explicit final locktime a bid's mint lock must
	// carry. Omitted means exactly the derived floor.
	LocktimeSeconds *int64 `json:"locktime_seconds,omitempty"`
}

type bidContent struct {
	AuctionID         string                     `json:"auction_id"`
	Amount            int64                      `json:"amount"`
	ReplacesBidID     string                     `json:"replaces_bid_id,omitempty"`
	Inputs            []string                   `json:"inputs,omitempty"`
	CashuLock         *CashuLockReceipt          `json:"cashu_lock,omitempty"`
	Reservation       *CustodyReservationReceipt `json:"reservation,omitempty"`
	IntegratedFunding *IntegratedFundingReceipt  `json:"integrated_funding,omitempty"`
	// OutcomeAuthorizations are the bidder's wallet spend-key pre-signatures
	// over the settle and refund consent messages, published with the bid so
	// the coordinator can act at close without the bidder online.
	OutcomeAuthorizations *bidOutcomeAuthorizations `json:"outcome_authorizations,omitempty"`
	// Proofs are the bearer proofs backing this bid, carried IN the committed
	// transaction so every validator verifies their DLEQ and their sum inside
	// consensus rather than trusting one party's attestation that the bid is
	// funded. Each carries its amount, keyset id, secret, C and NUT-12 DLEQ;
	// the secret is safe to publish because the proof is locked 2-of-2 SIG_ALL
	// and is unspendable without the committee's signature. Omitted for every
	// funding path that does not carry bearer proofs, so those bids serialize
	// byte-identically. Type reused: demoMintSpendProof already carries exactly
	// this field set for the mint-backed routes.
	Proofs []demoMintSpendProof `json:"proofs,omitempty"`
	// OutcomeTemplates carries the bidder's two pre-signed SIG_ALL outcome
	// transactions (settle and refund) IN the committed bid content, so a
	// cashu_sigall_v1 bid remains settleable and refundable after the bidder
	// goes offline. Consensus verifies them in ApplyTransaction
	// (verifySigAllBidTemplates): the inputs are the bid's committed proofs,
	// the destinations are the committed seller key and the receipt's wallet
	// spend key, and each carries the bidder's signature over its own digest.
	// Required for cashu_sigall_v1 and omitted for every other route, so those
	// bids serialize byte-identically.
	OutcomeTemplates *sigAllDepositTemplates `json:"outcome_templates,omitempty"`
}

// bidOutcomeAuthorizations is the bid content the bidder's wallet publishes
// alongside a mint-backed lock. Both signatures are by the wallet spend key the
// receipt commits as RefundPublicKey; without them the bid would reintroduce
// the liveness requirement this bridge exists to remove.
type bidOutcomeAuthorizations struct {
	Schema               string `json:"schema"`
	SettleSpendSignature string `json:"settle_spend_signature"`
	RefundSpendSignature string `json:"refund_spend_signature"`
}

// outcomeContent is the application authority's committed record that a
// mint-backed lock reached its terminal outcome. It issues no note and moves
// no value.
type outcomeContent struct {
	Schema            string `json:"schema"`
	AuctionID         string `json:"auction_id"`
	BidID             string `json:"bid_id"`
	Outcome           string `json:"outcome"`
	PayoutTokenSHA256 string `json:"payout_token_sha256"`
}

type refundContent struct {
	BidID string `json:"bid_id"`
}

// settleContent is the winner's record of a completed settlement swap. It
// names the auction and the winning bid, and carries the digest of the fresh
// proofs the coordinator returned. Nothing here moves value.
type settleContent struct {
	AuctionID         string `json:"auction_id"`
	BidID             string `json:"bid_id"`
	PayoutTokenSHA256 string `json:"payout_token_sha256"`
}

func ApplyTransaction(prior State, tx Transaction, consensusSeconds int64, policy Policy, mintSeed []byte) (State, error) {
	if err := policy.Validate(); err != nil {
		return State{}, err
	}
	if consensusSeconds < prior.LastConsensusTime {
		return State{}, errors.New("consensus time moved backwards")
	}
	next, err := prior.Clone()
	if err != nil {
		return State{}, err
	}
	var privateKey ed25519.PrivateKey
	switch next.ApplicationAuthority {
	case ApplicationAuthorityLegacy:
		if len(mintSeed) != ed25519.SeedSize {
			return State{}, errors.New("shared POC committee seed is invalid")
		}
		privateKey = ed25519.NewKeyFromSeed(mintSeed)
		if next.MintPublicKey != hex.EncodeToString(privateKey.Public().(ed25519.PublicKey)) {
			return State{}, errors.New("shared POC committee key does not match state")
		}
	case ApplicationAuthorityFrostCashu:
		if len(mintSeed) != 0 {
			return State{}, errors.New("FROST/Cashu application refuses a legacy mint seed")
		}
		if next.FundingAbortPins == nil {
			return State{}, errors.New("FROST/Cashu application requires pinned funding authority")
		}
		if err := validateFrostCashuTransaction(next, tx); err != nil {
			return State{}, err
		}
	default:
		return State{}, errors.New("application authority mode is unsupported")
	}
	switch tx.Type {
	case "faucet":
		err = applyFaucet(&next, tx.Actor, policy, privateKey)
	case "event":
		err = applySignedEvent(&next, *tx.Event, consensusSeconds, policy, privateKey)
	case "close":
		err = applyClose(&next, tx.AuctionID, consensusSeconds, privateKey)
	case "funding_abort":
		err = applyFundingAbort(&next, *tx.FundingAbort, consensusSeconds)
	default:
		err = errors.New("unsupported transaction")
	}
	if err != nil {
		return State{}, err
	}
	next.LastConsensusTime = consensusSeconds
	return next, nil
}

// validateFrostCashuTransaction proves the transition cannot reach any legacy
// Ed25519 note-issuing path. The normal V4 receipt and FundingAbort handlers
// still perform the complete cryptographic and state validation afterward.
func validateFrostCashuTransaction(state State, tx Transaction) error {
	switch tx.Type {
	case "faucet":
		return errors.New("FROST/Cashu application does not support the legacy faucet")
	case "event":
		if tx.Event == nil {
			return errors.New("FROST/Cashu event is absent")
		}
		switch tx.Event.Kind {
		case KindCreate:
			var content createContent
			if err := decodeStrictContent(tx.Event.Content, &content); err != nil {
				return err
			}
			if content.FundingMode != FundingModeThresholdSigAll {
				return errors.New("FROST/Cashu application requires threshold-funded auctions")
			}
		case KindBid:
			var content bidContent
			if err := decodeStrictContent(tx.Event.Content, &content); err != nil {
				return err
			}
			if content.IntegratedFunding == nil || content.IntegratedFunding.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" {
				return errors.New("FROST/Cashu application requires V4 integrated funding")
			}
		case KindRefund:
			return errors.New("FROST/Cashu refunds require committed terminal entitlement")
		default:
			return errors.New("unsupported Nostr event kind")
		}
	case "close":
		auction, ok := state.Auctions[tx.AuctionID]
		if !ok || auction.FundingMode != FundingModeThresholdSigAll {
			return errors.New("FROST/Cashu close requires a threshold-funded auction")
		}
	case "funding_abort":
		// applyFundingAbort verifies the complete pinned certificate and proof
		// ownership after this authority-mode gate.
	default:
		return errors.New("FROST/Cashu application transaction type is unsupported")
	}
	return nil
}

func ValidateForMempool(prior State, tx Transaction, policy Policy, mintSeed []byte) error {
	if tx.Type == "close" {
		auction, ok := prior.Auctions[tx.AuctionID]
		if !ok || auction.Status != "open" {
			return errors.New("auction is not open")
		}
		if prior.ApplicationAuthority == ApplicationAuthorityFrostCashu && auction.FundingMode != FundingModeThresholdSigAll {
			return errors.New("FROST/Cashu close requires a threshold-funded auction")
		}
		// Close is a permissionless deterministic-finalization trigger: it has
		// no actor and cannot select or alter the winner, amount, or destination.
		// CheckTx has no proposed block time, so it admits the trigger only once
		// the last committed consensus clock reaches the certified end. Proposal
		// and finalization repeat the same rule with their authoritative time.
		if prior.LastConsensusTime < auction.EndTime {
			return errors.New("auction has not ended")
		}
		return nil
	}
	// A mint-backed bid is refunded by the cooperative mint swap, which returns
	// the bidder's own proofs. The legacy KindRefund path issues a signed IOU
	// note instead, so admitting it for a cashu-backed bid would pay the bidder
	// twice: once in fresh mint proofs and once in a note, while the mint proofs
	// are still theirs. applyRefund cannot be changed -- it runs inside the
	// deterministic transition and replaying committed blocks through a new rule
	// would fork the chain -- so the refusal lives here, in local admission.
	// This is an honest-node property, not a consensus guarantee; the mint
	// remains the backstop against spending the same proof twice.
	if tx.Type == "event" && tx.Event != nil && tx.Event.Kind == KindRefund {
		var content refundContent
		if err := decodeStrictContent(tx.Event.Content, &content); err == nil {
			if bid, ok := prior.Bids[content.BidID]; ok && bid.CashuTokenSHA256 != "" {
				return errors.New("legacy refund refused: bid is mint-backed (cashu_token_sha256 set); the cooperative mint swap returns the proofs, so a legacy note would double-credit the bidder")
			}
		}
	}
	// A mint-backed bid must publish both outcome authorizations with the bid.
	// Without them the coordinator would again need the bidder online to settle
	// or refund, which is exactly the liveness the bridge removes. This is a
	// local-admission (CheckTx) rule, like the KindRefund double-credit refusal
	// above: the deterministic transition stores whatever the bid carries, and a
	// lock with no stored authorization simply cannot be resolved by
	// applyOutcomeRecord, so admitting such a bid is never a settlement hazard.
	if tx.Type == "event" && tx.Event != nil && tx.Event.Kind == KindBid {
		var content bidContent
		if err := decodeStrictContent(tx.Event.Content, &content); err == nil && content.CashuLock != nil {
			// A cashu_sigall_v1 bid carries its proofs and is authorized
			// inside consensus by the strict 2-of-2 SIG_ALL lock parse
			// (verifyBidProofs, run by ApplyTransaction below), not by
			// wallet-spend-key consent signatures, so it does not need the
			// outcome-authorization rule. Every other mint-backed bid
			// publishes both outcome authorizations; without them the
			// coordinator would again need the bidder online to settle or
			// refund, which is exactly the liveness the bridge removes. This
			// is a local-admission (CheckTx) rule like the KindRefund
			// double-credit refusal above: the deterministic transition
			// stores whatever the bid carries, and a lock with no usable
			// authorization simply cannot be resolved by applyOutcomeRecord,
			// so admitting such a bid is never a settlement hazard.
			if auction, known := prior.Auctions[content.AuctionID]; !known || auction.FundingMode != FundingModeCashuSigAll {
				if err := verifyBidOutcomeAuthorizations(content); err != nil {
					return err
				}
			} else if err := verifySigAllBidTemplates(auction, content, *content.CashuLock, policy); err != nil {
				// The committed bid content carries the bidder's pre-signed
				// settle and refund templates; refuse a malformed or
				// unauthorized one deterministically at mempool admission,
				// exactly as ApplyTransaction will.
				return err
			}
		}
	}
	// CheckTx has no proposed block timestamp. Use only the last committed
	// consensus time for advisory admission; a client-controlled Nostr timestamp
	// must never decide whether a deadline has passed. PrepareProposal,
	// ProcessProposal, and FinalizeBlock repeat the complete transition with the
	// proposed/committed block time and remain authoritative.
	_, err := ApplyTransaction(prior, tx, prior.LastConsensusTime, policy, mintSeed)
	return err
}

func applyFaucet(state *State, actor string, policy Policy, privateKey ed25519.PrivateKey) error {
	operation := "faucet:" + actor
	if state.Operations[operation] || state.Issued[actor] {
		return errors.New("faucet already used for this Nostr identity")
	}
	note, err := issueNote(*state, privateKey, operation, "faucet", actor, policy.FaucetAmount)
	if err != nil {
		return err
	}
	state.Issued[actor] = true
	state.Operations[operation] = true
	state.Notes[note.ID] = note
	return nil
}

func applySignedEvent(state *State, event SignedEvent, now int64, policy Policy, privateKey ed25519.PrivateKey) error {
	actor, err := VerifyNostrEvent(event)
	if err != nil {
		return err
	}
	if state.Operations[event.ID] {
		return errors.New("signed event was already committed")
	}
	if delta := now - event.CreatedAt; delta > policy.EventSkewSeconds || delta < -policy.EventSkewSeconds {
		return errors.New("signed event is outside the consensus-time window")
	}
	switch event.Kind {
	case KindCreate:
		var content createContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if !validIdentifier(content.AuctionID) || strings.TrimSpace(content.Title) == "" || len(content.Title) > 120 ||
			len(content.Description) > 2_000 || !validImageURL(content.ImageURL) {
			return errors.New("invalid auction identity or title")
		}
		if content.Duration < policy.MinDurationSeconds || content.Duration > policy.MaxDurationSeconds {
			return errors.New("auction duration is outside POC policy")
		}
		if content.StartingBid <= 0 || content.Reserve < 0 || content.MinIncrement < 0 {
			return errors.New("auction amount policy is invalid")
		}
		if _, exists := state.Auctions[content.AuctionID]; exists {
			return errors.New("auction already exists")
		}
		fundingMode := content.FundingMode
		if fundingMode == "" {
			fundingMode = FundingModeCustodialReservation
		}
		if fundingMode != FundingModeCustodialReservation && fundingMode != FundingModeThresholdSigAll &&
			fundingMode != FundingModeCashuLock && fundingMode != FundingModeCashuSigAll {
			return errors.New("auction funding mode is unsupported")
		}
		if fundingMode == FundingModeThresholdSigAll && content.SellerCocoPaymentPublicKey == "" {
			return errors.New("threshold auction requires the seller Coco payment key")
		}
		// A mint-backed auction may commit the seller's WALLET spend key here
		// too: it is the destination the settlement swap locks the winning
		// proofs to, and the seller's own signature on this create event is
		// what authorizes it. The key must be a real compressed point and must
		// not be the seller's Nostr identity -- the Nostr key authorizes, the
		// wallet key owns value, and one is never derived from the other.
		// This is an acceptance RELAXATION (a field that was refused is now
		// accepted), so replaying committed history cannot fork.
		if content.SellerCocoPaymentPublicKey != "" &&
			((fundingMode != FundingModeThresholdSigAll && fundingMode != FundingModeCashuLock && fundingMode != FundingModeCashuSigAll) ||
				!validCompressedPublicKey(content.SellerCocoPaymentPublicKey) ||
				content.SellerCocoPaymentPublicKey[2:] == actor) {
			return errors.New("seller payment key is invalid, is the seller's Nostr identity, or is used outside a threshold or mint-backed auction")
		}
		increment := content.MinIncrement
		if increment == 0 {
			increment = policy.MinBidIncrement
		}
		// The auction chooses its own anti-snipe timing; the network policy is
		// only the CEILING. An omitted field takes the policy's value, so an
		// auction that says nothing behaves exactly as today. An explicit zero
		// window is a deliberate choice: no bid extends the end.
		lateBidWindow := policy.LateBidWindow
		if content.LateBidWindowSeconds != nil {
			lateBidWindow = *content.LateBidWindowSeconds
		}
		if lateBidWindow < 0 || lateBidWindow > policy.LateBidWindow {
			return fmt.Errorf("auction late_bid_window_seconds %d is outside the network ceiling %d", lateBidWindow, policy.LateBidWindow)
		}
		lateBidExtension := policy.LateBidExtension
		if content.LateBidExtensionSeconds != nil {
			lateBidExtension = *content.LateBidExtensionSeconds
		}
		if lateBidExtension < 0 || lateBidExtension > policy.LateBidExtension {
			return fmt.Errorf("auction late_bid_extension_seconds %d is outside the network ceiling %d", lateBidExtension, policy.LateBidExtension)
		}
		maxTotalExtension := policy.MaxTotalExtension
		if content.MaxTotalExtensionSeconds != nil {
			maxTotalExtension = *content.MaxTotalExtensionSeconds
		}
		if maxTotalExtension < 0 || maxTotalExtension > policy.MaxTotalExtension {
			return fmt.Errorf("auction max_total_extension_seconds %d is outside the network ceiling %d", maxTotalExtension, policy.MaxTotalExtension)
		}
		// Internal coherence: one late bid can never push the end past the
		// auction's own cumulative cap.
		if lateBidExtension > maxTotalExtension {
			return fmt.Errorf("auction late_bid_extension_seconds %d exceeds its own max_total_extension_seconds %d", lateBidExtension, maxTotalExtension)
		}
		end := now + content.Duration
		auction := Auction{
			ID: content.AuctionID, Seller: actor, Title: strings.TrimSpace(content.Title),
			Description: strings.TrimSpace(content.Description), ImageURL: strings.TrimSpace(content.ImageURL),
			FundingMode: fundingMode, SellerCocoPaymentPublicKey: content.SellerCocoPaymentPublicKey,
			StartingBid: content.StartingBid, MinIncrement: increment, Reserve: content.Reserve,
			CreatedAt: now, OriginalEndTime: end, EndTime: end, Status: "open",
			LateBidWindow: lateBidWindow, LateBidExtension: lateBidExtension, MaxTotalExtension: maxTotalExtension,
		}
		// The locktime floor is derived, never stored from the request. A
		// supplied locktime_seconds must sit at or above it (a shorter lock can
		// expire while the auction is still open) and within the policy band.
		floor := auctionRequiredLocktime(auction)
		auction.RequiredLocktime = floor
		if content.LocktimeSeconds != nil {
			locktime := *content.LocktimeSeconds
			if locktime < floor {
				return fmt.Errorf("auction locktime_seconds %d is below the required locktime floor %d", locktime, floor)
			}
			if locktime > floor+policy.MaxTotalExtension {
				return fmt.Errorf("auction locktime_seconds %d exceeds the permitted ceiling %d", locktime, floor+policy.MaxTotalExtension)
			}
		}
		state.Auctions[content.AuctionID] = auction
	case KindBid:
		var content bidContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if err := applyBid(state, actor, event.ID, now, content, policy, privateKey); err != nil {
			return err
		}
	case KindRefund:
		var content refundContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if err := applyRefund(state, actor, event.ID, content.BidID, privateKey); err != nil {
			return err
		}
	case KindSettle:
		var content settleContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if err := applySettle(state, actor, content); err != nil {
			return err
		}
	case KindOutcome:
		var content outcomeContent
		if err := decodeStrictContent(event.Content, &content); err != nil {
			return err
		}
		if err := applyOutcomeRecord(state, actor, content); err != nil {
			return err
		}
	default:
		return errors.New("unsupported Nostr event kind")
	}
	state.Operations[event.ID] = true
	return nil
}

func applyBid(state *State, actor, eventID string, committedAt int64, content bidContent, policy Policy, privateKey ed25519.PrivateKey) error {
	auction, ok := state.Auctions[content.AuctionID]
	if !ok {
		return errors.New("auction is not open")
	}
	// Auction.HighBid is the leading position, so the uniform admission rule is
	// one comparison: the bidder's RESULTING position must be at least the
	// leading position plus the increment. That covers both a bidder below the
	// leader (it must clear the leader) and the leader raising its own position
	// (it must raise by the increment, so no dust legs).
	minimum := auction.StartingBid
	if auction.LeaderBidID != "" {
		minimum = auction.HighBid + auction.MinIncrement
	}
	// A bid's amount is the delta it locks: the resulting position is the
	// bidder's existing position plus that delta. A bid that replaces a prior
	// commitment instead states its resulting position outright, exactly as
	// that route always has.
	resulting := content.Amount
	if bidIsLeg(content) {
		resulting = bidderPosition(state, content.AuctionID, actor) + content.Amount
	}
	rejectionReason := ""
	var rejectionError error
	switch {
	case auction.Status != "open":
		rejectionReason, rejectionError = "auction_not_open", errors.New("auction is not open")
	case actor == auction.Seller:
		rejectionReason, rejectionError = "seller_self_bid", errors.New("seller cannot bid on own auction")
	case committedAt >= auction.EndTime:
		rejectionReason, rejectionError = "late", errors.New("bid is late")
	case resulting < minimum:
		rejectionReason, rejectionError = "below_minimum", errors.New("bid does not satisfy the minimum increment over the leading position")
	case content.IntegratedFunding != nil && content.ReplacesBidID != auction.LeaderBidID:
		rejectionReason, rejectionError = "stale_leader", errors.New("integrated bid replacement does not match the committed leader")
	}
	// Only the V4 browser route has a pre-authorized, exact full-pool return
	// package.  Its valid funding receipt may have been prepared against an
	// earlier leader or pre-deadline state.  Committing the definitive business
	// rejection gives participant-local terminal signers authenticated evidence
	// for that return.  Legacy/V3 or structurally invalid bids remain ordinary
	// transaction errors.
	canCommitRejectedReturn := rejectionError != nil && content.IntegratedFunding != nil &&
		content.IntegratedFunding.Schema == "PlebeianAuctionsPOCIntegratedFundingV4"
	if rejectionError != nil && !canCommitRejectedReturn {
		return rejectionError
	}
	paths := 0
	if content.CashuLock != nil {
		paths++
	}
	if content.Reservation != nil {
		paths++
	}
	if content.IntegratedFunding != nil {
		paths++
	}
	if len(content.Inputs) != 0 {
		paths++
	}
	if paths != 1 {
		return errors.New("bid must use exactly one funding path")
	}
	if auction.FundingMode == FundingModeCustodialReservation && content.Reservation == nil {
		return errors.New("Friday auction requires a custodial reservation")
	}
	if auction.FundingMode == FundingModeThresholdSigAll && content.IntegratedFunding == nil {
		return errors.New("integrated auction requires threshold SIG_ALL funding")
	}
	if auction.FundingMode == FundingModeLegacy && (content.Reservation != nil || content.IntegratedFunding != nil) {
		return errors.New("legacy auction cannot mix in Friday reservations")
	}
	if auction.FundingMode == FundingModeCustodialReservation && content.IntegratedFunding != nil {
		return errors.New("custodial auction cannot mix in threshold funding")
	}
	if auction.FundingMode == FundingModeThresholdSigAll && content.Reservation != nil {
		return errors.New("threshold auction cannot mix in custodial reservations")
	}
	if (auction.FundingMode == FundingModeCashuLock || auction.FundingMode == FundingModeCashuSigAll) && content.CashuLock == nil {
		return errors.New("mint-backed auction requires a Cashu lock")
	}
	// Without this a mint-backed auction would accept a custodial reservation
	// and quietly fall back to attested funding, which is the whole thing the
	// mode exists to stop.
	if auction.FundingMode != FundingModeCashuLock && auction.FundingMode != FundingModeCashuSigAll && content.CashuLock != nil {
		return errors.New("only a mint-backed auction accepts a Cashu lock")
	}
	if content.IntegratedFunding != nil {
		if err := verifyIntegratedFundingReceipt(*state, actor, committedAt, content, *content.IntegratedFunding, policy); err != nil {
			// Expiry is a deterministic auction-business outcome for a fully
			// authenticated V4 package.  It can race between browser preparation,
			// CheckTx and DeliverTx after Coco has reserved the proof pool.  Commit
			// the exact return entitlement instead of leaving the wallet operation
			// indefinitely ambiguous.  Every structural and cryptographic error
			// remains a hard transaction failure.
			if errors.Is(err, errIntegratedFundingReceiptExpired) &&
				content.IntegratedFunding.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
				// Receipt expiry is checked only after every structural, cryptographic,
				// mint and proof binding.  Once authenticated, it has deterministic
				// precedence over simultaneous auction-business rejection so every
				// verifier observes one canonical terminal cause.
				return applyRejectedIntegratedFunding(state, actor, eventID, committedAt, content, "funding_expired")
			}
			return err
		}
		if canCommitRejectedReturn {
			return applyRejectedIntegratedFunding(state, actor, eventID, committedAt, content, rejectionReason)
		}
		return applyAcceptedBid(state, actor, eventID, committedAt, content, nil, policy)
	}
	if content.Reservation != nil {
		if err := verifyCustodyReservationReceipt(*state, actor, committedAt, content, *content.Reservation, policy); err != nil {
			return err
		}
		return applyAcceptedBid(state, actor, eventID, committedAt, content, nil, policy)
	}
	if content.CashuLock != nil {
		if err := verifyCashuLockReceipt(*state, actor, content, *content.CashuLock); err != nil {
			return err
		}
		// The proof set, when the bid carries one, is verified inside
		// consensus here: every validator re-derives the DLEQ and the sum from
		// the transaction's own contents, so no single party attests that the
		// bid is funded.
		if err := verifyBidProofs(auction, content, policy); err != nil {
			return err
		}
		// A cashu_sigall_v1 bid must also carry the bidder's pre-signed outcome
		// templates, verified inside consensus here so every validator agrees
		// before the bid commits.
		if auction.FundingMode == FundingModeCashuSigAll || content.CashuLock.FundingMode == FundingModeCashuSigAll {
			if err := verifySigAllBidTemplates(auction, content, *content.CashuLock, policy); err != nil {
				return err
			}
		}
		return applyAcceptedBid(state, actor, eventID, committedAt, content, nil, policy)
	}
	if len(content.Inputs) == 0 || len(content.Inputs) > MaxInputs {
		return errors.New("bid must carry a verified Cashu lock or spend a bounded nonempty interim note set")
	}
	seen := map[string]bool{}
	var total int64
	for _, input := range content.Inputs {
		if seen[input] {
			return errors.New("duplicate input note")
		}
		seen[input] = true
		note, exists := state.Notes[input]
		if !exists || note.Owner != actor || note.SpentBy != "" {
			return errors.New("bid input is missing, spent, or not owned by signer")
		}
		if err := verifyNote(*state, note); err != nil {
			return err
		}
		if note.Amount > (1<<62)-total {
			return errors.New("input amount overflow")
		}
		total += note.Amount
	}
	if total < content.Amount {
		return errors.New("unfunded bid")
	}
	for _, input := range content.Inputs {
		note := state.Notes[input]
		note.SpentBy = eventID
		state.Notes[input] = note
	}
	if change := total - content.Amount; change > 0 {
		note, err := issueNote(*state, privateKey, eventID, "change", actor, change)
		if err != nil {
			return err
		}
		state.Notes[note.ID] = note
	}
	return applyAcceptedBid(state, actor, eventID, committedAt, content, content.Inputs, policy)
}

func applyRejectedIntegratedFunding(state *State, actor, eventID string, committedAt int64, content bidContent, reason string) error {
	receipt := *content.IntegratedFunding
	if receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" ||
		(reason != "auction_not_open" && reason != "seller_self_bid" && reason != "late" &&
			reason != "below_minimum" && reason != "stale_leader" && reason != "funding_expired") {
		return errors.New("integrated rejected-return authority is invalid")
	}
	// Rejected V4 bids cannot replace or alias an earlier funding operation.
	// Their complete proof pool becomes owned by this one committed return
	// entitlement until terminal import completes.
	for _, proofStateRef := range receipt.ProofStateRefs {
		if state.IntegratedProofUses[proofStateRef[2:]] != "" {
			return errors.New("rejected integrated funding proof was already allocated")
		}
	}
	if err := claimCommittedV4Funding(state, receipt, actor, eventID, committedAt, "rejected_return_entitled", reason); err != nil {
		return err
	}
	state.IntegratedFundings[receipt.FundingOperationID] = IntegratedFunding{
		ID: receipt.FundingOperationID, AuctionID: content.AuctionID, BidID: eventID, Bidder: actor,
		Status: "rejected_return_entitled", RejectionReason: reason, CommittedAt: committedAt, Receipt: receipt,
	}
	for _, proofStateRef := range receipt.ProofStateRefs {
		state.IntegratedProofUses[proofStateRef[2:]] = receipt.FundingOperationID
	}
	return nil
}

// bidderPosition returns what a bidder currently holds in an auction: the sum
// of the amounts of its committed legs, where a leg is a committed bid whose
// lock is still held. Positions are derived from committed state -- there is no
// stored position record -- and a leg that has been outbid is refundable and so
// no longer part of the bidder's live position.
func bidderPosition(state *State, auctionID, bidder string) int64 {
	var total int64
	for _, lock := range state.Locks {
		if lock.AuctionID == auctionID && lock.Bidder == bidder && lock.Status == "locked" {
			total += lock.Amount
		}
	}
	return total
}

// bidIsLeg reports whether a bid adds an additional leg to the bidder's
// existing position rather than stating a new absolute position. Only a bid
// carrying its own route's explicit replacement evidence -- a custodial own
// raise naming the leader's reservation, or an integrated full-pool
// replacement naming the leader's bid -- keeps the absolute semantics those
// routes have always had; every other bid, including every mint-backed bid, is
// a leg whose amount is a delta. Keying on route evidence rather than a bare
// ReplacesBidID is deliberate: a mint-backed bid must never be able to release
// its own legs by asserting a replacement it has no mechanism to perform.
func bidIsLeg(content bidContent) bool {
	if content.Reservation != nil && content.Reservation.ReplacesReservationID != "" {
		return false
	}
	if content.IntegratedFunding != nil && content.ReplacesBidID != "" {
		return false
	}
	return true
}

// displaceLeaderPosition returns every locked leg of the auction's current
// leading position to "refundable" and releases the funding each leg carried.
// A position is the unit that wins, so when it loses the lead the whole
// position is returned at once -- every leg, not just the last one. It is never
// called for a raise by the leader itself, so a bidder cannot exit its own bid.
func displaceLeaderPosition(state *State, auction Auction, replacementBidder string) error {
	leaderBid, ok := state.Bids[auction.LeaderBidID]
	if !ok {
		return errors.New("previous leader bid is missing from state")
	}
	displaced := false
	for id, lock := range state.Locks {
		if lock.AuctionID != auction.ID || lock.Bidder != leaderBid.Bidder || lock.Status != "locked" {
			continue
		}
		displaced = true
		lock.Status = "refundable"
		state.Locks[id] = lock
		bid := state.Bids[id]
		if bid.IntegratedFundingID != "" {
			funding := state.IntegratedFundings[bid.IntegratedFundingID]
			if bid.Bidder == replacementBidder {
				funding.Status = "superseded"
			} else {
				funding.Status = "outbid_return_entitled"
			}
			state.IntegratedFundings[funding.ID] = funding
		}
		if bid.ReservationID != "" {
			reservation := state.CustodyReservations[bid.ReservationID]
			reservation.Status = "release_entitled"
			state.CustodyReservations[reservation.ID] = reservation
		}
	}
	if !displaced {
		return errors.New("previous leader lock is not spendable")
	}
	return nil
}

func applyAcceptedBid(state *State, actor, eventID string, committedAt int64, content bidContent, inputs []string, policy Policy) error {
	auction := state.Auctions[content.AuctionID]
	previousBidID := auction.LeaderBidID
	// An own raise that is an additional leg leaves the raiser's existing legs
	// untouched: a bidder can never exit its own bid. Any other bid that takes
	// the lead returns the WHOLE previous position -- every leg of the previous
	// leader -- because a position is the unit that wins and so the unit that is
	// returned.
	if previousBidID != "" {
		previousBid, ok := state.Bids[previousBidID]
		if !ok {
			return errors.New("previous leader bid is missing from state")
		}
		if previousBid.Bidder == actor && bidIsLeg(content) {
			previousBidID = ""
		} else if err := displaceLeaderPosition(state, auction, actor); err != nil {
			return err
		}
	}
	bid := Bid{ID: eventID, AuctionID: auction.ID, Bidder: actor, Amount: content.Amount, InputNoteIDs: append([]string(nil), inputs...), ReplacesBidID: previousBidID, CommittedAt: committedAt}
	if content.CashuLock != nil {
		bid.CashuTokenSHA256 = content.CashuLock.TokenSHA256
		bid.CashuLockOperation = content.CashuLock.OperationID
		state.CashuLocks[content.CashuLock.TokenSHA256] = *content.CashuLock
		for _, proofStateRef := range content.CashuLock.ProofStateRefs {
			state.CashuProofUses[proofStateRef[2:]] = content.CashuLock.TokenSHA256
		}
	}
	if content.Reservation != nil {
		bid.ReservationID = content.Reservation.ReservationID
		state.CustodyReservations[bid.ReservationID] = CustodyReservation{
			ID: bid.ReservationID, AuctionID: auction.ID, BidID: eventID, Bidder: actor,
			Amount: content.Amount, ReplacesReservationID: content.Reservation.ReplacesReservationID,
			Status: "reserved", CommittedAt: committedAt,
		}
	}
	if content.IntegratedFunding != nil {
		receipt := *content.IntegratedFunding
		if err := claimCommittedV4Funding(state, receipt, actor, eventID, committedAt, "active", ""); err != nil {
			return err
		}
		bid.IntegratedFundingID = receipt.FundingOperationID
		state.IntegratedFundings[receipt.FundingOperationID] = IntegratedFunding{
			ID: receipt.FundingOperationID, AuctionID: auction.ID, BidID: eventID, Bidder: actor,
			Status: "active", CommittedAt: committedAt, Receipt: receipt,
		}
		for _, proofStateRef := range receipt.ProofStateRefs {
			state.IntegratedProofUses[proofStateRef[2:]] = receipt.FundingOperationID
		}
		if previousBidID != "" {
			previousBid := state.Bids[previousBidID]
			state.IntegratedDisplacements[eventID] = IntegratedDisplacement{
				ID: eventID, AuctionID: auction.ID, DisplacedBidID: previousBidID, ReplacementBidID: eventID,
				DisplacedFundingID: previousBid.IntegratedFundingID, ReplacementFundingID: receipt.FundingOperationID,
				CommittedAt: committedAt, OriginalEndTime: auction.OriginalEndTime, CertifiedEndTime: auction.EndTime,
			}
		}
	}
	// A cashu_sigall_v1 bid carries its pre-signed outcome templates; storing
	// them in consensus state is what lets the coordinator's offline sweeper
	// submit exactly the pre-authorized transaction without a separate bearer
	// store. They were verified by verifySigAllBidTemplates before reaching
	// here.
	if content.OutcomeTemplates != nil {
		bid.OutcomeTemplates = content.OutcomeTemplates
	}
	state.Bids[eventID] = bid
	lock := Lock{ID: eventID, AuctionID: auction.ID, BidID: eventID, Bidder: actor, Amount: content.Amount, Status: "locked"}
	// A mint-backed bid publishes its outcome authorizations; storing them
	// here is what lets the coordinator sweep the lock to a terminal outcome
	// after the bidder has gone offline. A bid without them simply stores
	// empty strings, and applyOutcomeRecord then refuses to resolve the lock.
	if content.CashuLock != nil && content.OutcomeAuthorizations != nil {
		lock.SettleAuthorization = content.OutcomeAuthorizations.SettleSpendSignature
		lock.RefundAuthorization = content.OutcomeAuthorizations.RefundSpendSignature
	}
	state.Locks[eventID] = lock
	auction.LeaderBidID = eventID
	// HighBid is the leading position: the sum of every locked leg the new
	// leader holds after this bid, resolved from committed state rather than
	// assumed to be this one lock.
	auction.HighBid = bidderPosition(state, auction.ID, actor)
	// The extension reads the AUCTION's own anti-snipe timing, not the network
	// policy: window==0 means no anti-sniping, so no bid extends the end and
	// the auction closes exactly at EndTime.
	if auction.LateBidWindow > 0 && committedAt >= auction.EndTime-auction.LateBidWindow {
		candidate := committedAt + auction.LateBidExtension
		capEnd := auction.OriginalEndTime + auction.MaxTotalExtension
		if candidate > capEnd {
			candidate = capEnd
		}
		if candidate > auction.EndTime {
			auction.EndTime = candidate
			auction.ExtensionCount++
		}
	}
	if displacement, exists := state.IntegratedDisplacements[eventID]; exists {
		displacement.CertifiedEndTime = auction.EndTime
		state.IntegratedDisplacements[eventID] = displacement
	}
	state.Auctions[auction.ID] = auction
	return nil
}

func verifyCustodyReservationReceipt(state State, actor string, committedAt int64, content bidContent, receipt CustodyReservationReceipt, policy Policy) error {
	if receipt.Schema != "PlebeianAuctionsPOCCustodyReservationV1" || receipt.MintURL != state.CashuMintURL {
		return errors.New("custody reservation receipt schema or mint is not trusted")
	}
	if receipt.AuctionID != content.AuctionID || receipt.Bidder != actor || receipt.Amount != content.Amount || receipt.Amount <= 0 {
		return errors.New("custody reservation receipt does not bind this bid")
	}
	if receipt.CommitteePublicKey != state.CommitteePublicKey || !validOperationID(receipt.ReservationID) {
		return errors.New("custody reservation receipt identity is invalid")
	}
	if committedAt > (1<<63-1)-policy.ReceiptTTLSeconds || receipt.ExpiresAt < committedAt || receipt.ExpiresAt > committedAt+policy.ReceiptTTLSeconds {
		return errors.New("custody reservation receipt is expired or unbounded")
	}
	if _, exists := state.CustodyReservations[receipt.ReservationID]; exists {
		return errors.New("custody reservation was already committed")
	}
	auction := state.Auctions[content.AuctionID]
	wantReplacement := ""
	if auction.LeaderBidID != "" {
		prior := state.Bids[auction.LeaderBidID]
		if prior.Bidder == actor && prior.ReservationID != "" {
			wantReplacement = prior.ReservationID
		}
	}
	if receipt.ReplacesReservationID != wantReplacement {
		return errors.New("custody reservation replacement does not match the committed leader")
	}
	if !validLowerHex(receipt.Signature, schnorr.SignatureSize) {
		return errors.New("custody reservation signature shape is invalid")
	}
	publicBytes, _ := hex.DecodeString(receipt.CommitteePublicKey)
	publicKey, err := btcec.ParsePubKey(publicBytes)
	if err != nil {
		return errors.New("custody reservation committee key is invalid")
	}
	signatureBytes, _ := hex.DecodeString(receipt.Signature)
	signature, err := schnorr.ParseSignature(signatureBytes)
	digest := custodyReservationDigest(receipt)
	if err != nil || !signature.Verify(digest[:], publicKey) {
		return errors.New("custody reservation signature is invalid")
	}
	return nil
}

func custodyReservationDigest(receipt CustodyReservationReceipt) [32]byte {
	material, _ := json.Marshal([]any{
		receipt.Schema, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.Amount,
		receipt.ReservationID, receipt.ReplacesReservationID, receipt.ExpiresAt, receipt.CommitteePublicKey,
	})
	return sha256.Sum256(material)
}

func verifyIntegratedFundingReceipt(state State, actor string, committedAt int64, content bidContent, receipt IntegratedFundingReceipt, policy Policy) error {
	if (receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV3" && receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4") || receipt.MintURL != state.CashuMintURL {
		return errors.New("integrated funding schema or mint is not trusted")
	}
	// A network with FundingAbortV1 enabled must never admit the legacy V3
	// receipt. V3 writes only IntegratedProofUses, while FundingAbort owns the
	// unified lifecycle/proof tombstones required to make abort-first and
	// bid-first mutually exclusive across restart and parity aliases. Rejecting
	// V3 before any receipt or proof processing prevents an old, otherwise valid
	// receipt from bypassing that consensus invariant.
	if state.FundingAbortPins != nil && receipt.Schema != "PlebeianAuctionsPOCIntegratedFundingV4" {
		return errors.New("legacy integrated funding is disabled when funding-abort lifecycle pins are active")
	}
	if receipt.AuthNetworkID != state.AuthNetworkID || receipt.ChainID != state.ChainID {
		return errors.New("integrated funding belongs to another authenticated network or chain")
	}
	if err := verifyIntegratedFundingAbortPins(state, receipt); err != nil {
		return err
	}
	if receipt.AuctionID != content.AuctionID || receipt.Bidder != actor || receipt.BidAmount != content.Amount || receipt.BidAmount <= 0 || receipt.PoolAmount != receipt.BidAmount || receipt.ReplacesBidID != content.ReplacesBidID {
		return errors.New("integrated funding does not bind this bid and its full pool")
	}
	if receipt.AttestedAt <= 0 || receipt.ExpiresAt < receipt.AttestedAt || receipt.ExpiresAt-receipt.AttestedAt > policy.ReceiptTTLSeconds ||
		(receipt.AttestedAt > committedAt && receipt.AttestedAt-committedAt > policy.EventSkewSeconds) {
		return errors.New("integrated funding attestation interval is invalid or unbounded")
	}
	if !validOperationID(receipt.FundingOperationID) || !validOperationID(receipt.ActiveKeysetID) || receipt.InputFeePPK != 0 {
		return errors.New("integrated funding identity, keyset, or zero-fee policy is invalid")
	}
	if receipt.CommitteePublicKey != state.CommitteePublicKey || !strings.HasPrefix(receipt.CommitteePublicKey, "02") ||
		!validCompressedPublicKey(receipt.BidderPublicKey) || !validCompressedPublicKey(receipt.RefundPublicKey) ||
		receipt.BidderPublicKey[2:] == receipt.RefundPublicKey[2:] || receipt.BidderPublicKey[2:] == receipt.CommitteePublicKey[2:] || receipt.RefundPublicKey[2:] == receipt.CommitteePublicKey[2:] ||
		receipt.BidderPublicKey[2:] == actor || receipt.RefundPublicKey[2:] == actor || receipt.CommitteePublicKey[2:] == actor {
		return errors.New("integrated funding signer keys are invalid or not distinct")
	}
	if !validOperationID(receipt.CommitteeKeysetID) || !validOperationID(receipt.CommitteeKeysetVersion) || !validOperationID(receipt.DKGRunID) {
		return errors.New("integrated funding committee keyset identity is invalid")
	}
	digests := []string{receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest, receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest, receipt.BundleDigest, receipt.ParticipantPolicyDigest}
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
		digests = append(digests, receipt.PreparedBundleDigest)
	}
	for _, digest := range digests {
		if !validLowerHex(digest, sha256.Size) {
			return errors.New("integrated funding package digest is invalid")
		}
	}
	if (receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV3" && !validLowerHex(receipt.ActorFundingSignature, schnorr.SignatureSize)) ||
		(receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" && receipt.ActorFundingSignature != "") ||
		!validLowerHex(receipt.BidderReturnSignature, schnorr.SignatureSize) || !validLowerHex(receipt.CommitteeSignature, schnorr.SignatureSize) {
		return errors.New("integrated funding signature shape is invalid")
	}
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV3" &&
		(receipt.PreparedBundleDigest != "" || receipt.ActorFundingAuthorization != nil) {
		return errors.New("integrated funding V3 receipt contains V4 authorization fields")
	}
	auction := state.Auctions[content.AuctionID]
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" &&
		(!validCompressedPublicKey(auction.SellerCocoPaymentPublicKey) || auction.SellerCocoPaymentPublicKey[2:] == auction.Seller) {
		return errors.New("integrated V4 funding auction lacks a distinct direct Coco seller payment key")
	}
	// The locktime floor is the AUCTION's, derived from its own cumulative
	// extension cap, not the network policy's. Consensus accepts a lock at or
	// above that floor and within the policy band; the old exact-equality
	// against a policy constant would reject an auction that chose a shorter
	// cap than the network ceiling.
	if auction.OriginalEndTime > (1<<63-1)-auction.MaxTotalExtension-EmergencyRecoverySeconds {
		return errors.New("integrated funding locktime does not use the selected maximum-end recovery policy")
	}
	floor := auctionRequiredLocktime(auction)
	if receipt.Locktime < floor || receipt.Locktime > floor+policy.MaxTotalExtension {
		return fmt.Errorf("integrated funding locktime %d is outside the auction locktime band [%d, %d]", receipt.Locktime, floor, floor+policy.MaxTotalExtension)
	}
	if len(receipt.ProofStateRefs) == 0 || len(receipt.ProofStateRefs) > MaxInputs {
		return errors.New("integrated funding proof pool is empty or unbounded")
	}
	seenX := map[string]bool{}
	previousFundingID := ""
	previousRefs := map[string]bool{}
	if auction.LeaderBidID != "" {
		previousBid := state.Bids[auction.LeaderBidID]
		if previousBid.Bidder == actor && previousBid.IntegratedFundingID != "" {
			previousFundingID = previousBid.IntegratedFundingID
			for _, proofStateRef := range state.IntegratedFundings[previousFundingID].Receipt.ProofStateRefs {
				previousRefs[proofStateRef] = true
			}
		}
	}
	for index, proofStateRef := range receipt.ProofStateRefs {
		if !validCompressedPublicKey(proofStateRef) || seenX[proofStateRef[2:]] || (index > 0 && receipt.ProofStateRefs[index-1] >= proofStateRef) {
			return errors.New("integrated funding proof references are invalid, duplicated, or noncanonical")
		}
		seenX[proofStateRef[2:]] = true
		if existing := state.IntegratedProofUses[proofStateRef[2:]]; existing != "" && existing != previousFundingID {
			return errors.New("integrated funding proof was already allocated to another bid or operation")
		}
	}
	for proofStateRef := range previousRefs {
		if !slicesContains(receipt.ProofStateRefs, proofStateRef) {
			return errors.New("integrated own raise cannot silently drop the previously active proof pool")
		}
	}
	if _, exists := state.IntegratedFundings[receipt.FundingOperationID]; exists {
		return errors.New("integrated funding operation was already committed")
	}
	expectedBundle := integratedFundingBundleDigest(receipt)
	if receipt.BundleDigest != hex.EncodeToString(expectedBundle[:]) {
		return errors.New("integrated funding bundle digest is not canonical")
	}
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV3" {
		actorPublicBytes, _ := hex.DecodeString(actor)
		actorPublic, err := schnorr.ParsePubKey(actorPublicBytes)
		actorSignatureBytes, _ := hex.DecodeString(receipt.ActorFundingSignature)
		actorSignature, signatureErr := schnorr.ParseSignature(actorSignatureBytes)
		if err != nil || signatureErr != nil || !actorSignature.Verify(expectedBundle[:], actorPublic) {
			return errors.New("auction actor did not approve the exact integrated funding bundle")
		}
	} else if err := verifyIntegratedFundingV4Authorization(receipt, actor); err != nil {
		return err
	}
	bidderPublicBytes, _ := hex.DecodeString(receipt.BidderPublicKey)
	bidderPublic, err := btcec.ParsePubKey(bidderPublicBytes)
	if err != nil {
		return errors.New("integrated bidder public key is invalid")
	}
	bidderSignatureBytes, _ := hex.DecodeString(receipt.BidderReturnSignature)
	bidderSignature, err := schnorr.ParseSignature(bidderSignatureBytes)
	returnDigest, _ := hex.DecodeString(receipt.ReturnCashuSigAllDigest)
	if err != nil || !bidderSignature.Verify(returnDigest, bidderPublic) {
		return errors.New("integrated bidder did not pre-sign the exact full-pool return package")
	}
	committeePublicBytes, _ := hex.DecodeString(receipt.CommitteePublicKey)
	committeePublic, err := btcec.ParsePubKey(committeePublicBytes)
	if err != nil {
		return errors.New("integrated committee public key is invalid")
	}
	committeeSignatureBytes, _ := hex.DecodeString(receipt.CommitteeSignature)
	committeeSignature, err := schnorr.ParseSignature(committeeSignatureBytes)
	digest := integratedFundingAdmissionSignatureDigest(receipt)
	if err != nil || !committeeSignature.Verify(digest[:], committeePublic) {
		return errors.New("integrated funding threshold attestation is invalid")
	}
	// Check committed-time expiry only after every exact package, signer,
	// proof-reference and threshold binding above has authenticated.  This
	// prevents malformed client claims from obtaining a return entitlement.
	if receipt.ExpiresAt < committedAt {
		return errIntegratedFundingReceiptExpired
	}
	return nil
}

func slicesContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func integratedFundingBundleDigest(receipt IntegratedFundingReceipt) [32]byte {
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
		material, _ := json.Marshal([]any{
			"PlebeianAuctionsPOCIntegratedFundingBundleV4", receipt.AuthNetworkID, receipt.ChainID,
			receipt.MintURL, receipt.AuctionID, receipt.Bidder,
			receipt.BidAmount, receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs,
			receipt.ActiveKeysetID, receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey,
			receipt.RefundPublicKey, receipt.CommitteePublicKey, receipt.CommitteeKeysetID,
			receipt.CommitteeKeysetVersion, receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
			receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest,
			receipt.PreparedBundleDigest,
		})
		return sha256.Sum256(material)
	}
	material, _ := json.Marshal([]any{
		"PlebeianAuctionsPOCIntegratedFundingBundleV3", receipt.AuthNetworkID, receipt.ChainID,
		receipt.MintURL, receipt.AuctionID, receipt.Bidder,
		receipt.BidAmount, receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs,
		receipt.ActiveKeysetID, receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey,
		receipt.RefundPublicKey, receipt.CommitteePublicKey, receipt.CommitteeKeysetID,
		receipt.CommitteeKeysetVersion, receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
		receipt.WinnerPackageDigest, receipt.ReturnPackageDigest,
		receipt.ReturnCashuSigAllDigest,
	})
	return sha256.Sum256(material)
}

func integratedFundingReceiptDigest(receipt IntegratedFundingReceipt) [32]byte {
	if receipt.Schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
		authorizationID := ""
		if receipt.ActorFundingAuthorization != nil {
			authorizationID = receipt.ActorFundingAuthorization.ID
		}
		material, _ := json.Marshal([]any{
			receipt.Schema, receipt.AuthNetworkID, receipt.ChainID, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.BidAmount,
			receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs, receipt.ActiveKeysetID,
			receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey, receipt.RefundPublicKey,
			receipt.CommitteePublicKey, receipt.CommitteeKeysetID, receipt.CommitteeKeysetVersion,
			receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
			receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest,
			receipt.PreparedBundleDigest, receipt.BundleDigest, authorizationID, receipt.BidderReturnSignature,
		})
		return sha256.Sum256(material)
	}
	material, _ := json.Marshal([]any{
		receipt.Schema, receipt.AuthNetworkID, receipt.ChainID, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.BidAmount,
		receipt.PoolAmount, receipt.ReplacesBidID, receipt.FundingOperationID, receipt.AttestedAt, receipt.ExpiresAt, receipt.ProofStateRefs, receipt.ActiveKeysetID,
		receipt.InputFeePPK, receipt.Locktime, receipt.BidderPublicKey, receipt.RefundPublicKey,
		receipt.CommitteePublicKey, receipt.CommitteeKeysetID, receipt.CommitteeKeysetVersion,
		receipt.DKGRunID, receipt.PublicKeyPackageSHA256, receipt.SignerRosterDigest,
		receipt.WinnerPackageDigest, receipt.ReturnPackageDigest, receipt.ReturnCashuSigAllDigest,
		receipt.BundleDigest,
		receipt.ActorFundingSignature,
		receipt.BidderReturnSignature,
	})
	return sha256.Sum256(material)
}

type fridayFundingAuthorizationContentV1 struct {
	Schema                           string `json:"schema"`
	AuthNetworkID                    string `json:"authNetworkId"`
	ChainID                          string `json:"chainId"`
	AuctionID                        string `json:"auctionId"`
	Amount                           int64  `json:"amount"`
	MintURL                          string `json:"mintUrl"`
	PaymentPublicKey                 string `json:"paymentPublicKey"`
	RefundPublicKey                  string `json:"refundPublicKey"`
	FundingOperationID               string `json:"fundingOperationId"`
	BundleDigest                     string `json:"bundleDigest"`
	ReturnPackageDigest              string `json:"returnPackageDigest"`
	ReturnCashuSigAllDigest          string `json:"returnCashuSigAllDigest"`
	BidderReturnSignature            string `json:"bidderReturnSignature"`
	ExpiresAt                        int64  `json:"expiresAt"`
	PaymentKeyAuthorizationSignature string `json:"paymentKeyAuthorizationSignature"`
	RefundKeyAuthorizationSignature  string `json:"refundKeyAuthorizationSignature"`
}

func verifyIntegratedFundingV4Authorization(receipt IntegratedFundingReceipt, actor string) error {
	event := receipt.ActorFundingAuthorization
	if event == nil || event.Kind != 28647 || event.PubKey != actor || event.CreatedAt != receipt.AttestedAt {
		return errors.New("V4 funding authorization event identity differs")
	}
	verifiedActor, err := VerifyNostrEvent(*event)
	if err != nil || verifiedActor != actor {
		return errors.New("V4 funding authorization Nostr signature is invalid")
	}
	decoder := json.NewDecoder(strings.NewReader(event.Content))
	decoder.DisallowUnknownFields()
	var authorization fridayFundingAuthorizationContentV1
	if err := decoder.Decode(&authorization); err != nil {
		return errors.New("V4 funding authorization content is noncanonical")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("V4 funding authorization content is noncanonical")
	}
	canonical, err := json.Marshal(authorization)
	if err != nil || string(canonical) != event.Content {
		return errors.New("V4 funding authorization content is noncanonical")
	}
	expectedTags := [][]string{
		{"t", "plebeian-friday-funding-v1"}, {"a", receipt.AuctionID},
		{"operation", receipt.FundingOperationID}, {"payment", receipt.BidderPublicKey},
	}
	actualTags, _ := json.Marshal(event.Tags)
	wantedTags, _ := json.Marshal(expectedTags)
	if !bytes.Equal(actualTags, wantedTags) {
		return errors.New("V4 funding authorization tags differ")
	}
	if authorization.Schema != "PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1" ||
		authorization.AuthNetworkID != receipt.AuthNetworkID || authorization.ChainID != receipt.ChainID ||
		authorization.AuctionID != receipt.AuctionID || authorization.Amount != receipt.PoolAmount ||
		authorization.MintURL != receipt.MintURL || authorization.PaymentPublicKey != receipt.BidderPublicKey ||
		authorization.RefundPublicKey != receipt.RefundPublicKey || authorization.FundingOperationID != receipt.FundingOperationID ||
		authorization.BundleDigest != receipt.PreparedBundleDigest || authorization.ReturnPackageDigest != receipt.ReturnPackageDigest ||
		authorization.ReturnCashuSigAllDigest != receipt.ReturnCashuSigAllDigest || authorization.BidderReturnSignature != receipt.BidderReturnSignature ||
		authorization.ExpiresAt != receipt.ExpiresAt {
		return errors.New("V4 funding authorization content differs from receipt")
	}
	type keyTerms struct {
		Schema                  string `json:"schema"`
		Actor                   string `json:"actor"`
		AuthNetworkID           string `json:"authNetworkId"`
		ChainID                 string `json:"chainId"`
		AuctionID               string `json:"auctionId"`
		Amount                  int64  `json:"amount"`
		MintURL                 string `json:"mintUrl"`
		PaymentPublicKey        string `json:"paymentPublicKey"`
		RefundPublicKey         string `json:"refundPublicKey"`
		FundingOperationID      string `json:"fundingOperationId"`
		BundleDigest            string `json:"bundleDigest"`
		ReturnPackageDigest     string `json:"returnPackageDigest"`
		ReturnCashuSigAllDigest string `json:"returnCashuSigAllDigest"`
		BidderReturnSignature   string `json:"bidderReturnSignature"`
		ExpiresAt               int64  `json:"expiresAt"`
	}
	terms, _ := json.Marshal(keyTerms{
		authorization.Schema, actor, authorization.AuthNetworkID, authorization.ChainID,
		authorization.AuctionID, authorization.Amount, authorization.MintURL,
		authorization.PaymentPublicKey, authorization.RefundPublicKey, authorization.FundingOperationID,
		authorization.BundleDigest, authorization.ReturnPackageDigest, authorization.ReturnCashuSigAllDigest,
		authorization.BidderReturnSignature, authorization.ExpiresAt,
	})
	domain := []byte("PLEBEIAN_FRIDAY_PAYMENT_KEY_AUTHORIZATION_V1")
	keyDigest := sha256.Sum256(append(domain, terms...))
	verifyKey := func(signatureHex, compressed string) bool {
		if !validLowerHex(signatureHex, schnorr.SignatureSize) || !validCompressedPublicKey(compressed) {
			return false
		}
		signatureBytes, _ := hex.DecodeString(signatureHex)
		signature, err := schnorr.ParseSignature(signatureBytes)
		publicBytes, _ := hex.DecodeString(compressed[2:])
		public, keyErr := schnorr.ParsePubKey(publicBytes)
		return err == nil && keyErr == nil && signature.Verify(keyDigest[:], public)
	}
	if !verifyKey(authorization.PaymentKeyAuthorizationSignature, receipt.BidderPublicKey) ||
		!verifyKey(authorization.RefundKeyAuthorizationSignature, receipt.RefundPublicKey) {
		return errors.New("V4 payment/refund key proof-of-possession is invalid")
	}
	return nil
}

// The admission threshold signature has its own protocol domain.  In
// particular it is not a signature over the raw receipt digest and cannot be
// replayed as a Cashu disposition authorization.  Keep this framing byte-for-
// byte aligned with demoIntegratedFundingAdmissionSignatureDigest in the TS
// coordinator and ADMISSION_SIGNATURE_DOMAIN in the Rust signer.
func integratedFundingAdmissionSignatureDigest(receipt IntegratedFundingReceipt) [32]byte {
	policyDigest, _ := hex.DecodeString(receipt.ParticipantPolicyDigest)
	return integratedFundingAdmissionSignatureDigestFromDigests(integratedFundingReceiptDigest(receipt), policyDigest)
}

func integratedFundingAdmissionSignatureDigestFromDigests(receiptDigest [32]byte, participantPolicyDigest []byte) [32]byte {
	const domain = "COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1"
	material := make([]byte, 0, len(domain)+len(receiptDigest)+len(participantPolicyDigest))
	material = append(material, domain...)
	material = append(material, receiptDigest[:]...)
	material = append(material, participantPolicyDigest...)
	return sha256.Sum256(material)
}

func verifyCashuLockReceipt(state State, actor string, content bidContent, receipt CashuLockReceipt) error {
	if receipt.Schema != "PlebeianAuctionsPOCCashuLockV1" || receipt.MintURL != state.CashuMintURL {
		return errors.New("Cashu lock receipt schema or mint is not trusted")
	}
	if receipt.AuctionID != content.AuctionID || receipt.Bidder != actor || receipt.Amount != content.Amount || receipt.Amount <= 0 {
		return errors.New("Cashu lock receipt does not bind this bid")
	}
	if receipt.CommitteePublicKey != state.CommitteePublicKey || !validCompressedPublicKey(receipt.RefundPublicKey) {
		return errors.New("Cashu lock receipt does not use the trusted committee and a valid refund key")
	}
	auction := state.Auctions[content.AuctionID]
	if receipt.Locktime < auction.EndTime || receipt.Locktime > auction.EndTime+3_600 {
		return errors.New("Cashu lock receipt locktime is outside the auction settlement window")
	}
	// The receipt must carry the mode its auction uses, so a plain
	// cashu_lock_v1 receipt can never fund a cashu_sigall_v1 auction (whose
	// admission requires the SIG_ALL outcome templates) and vice versa. The
	// check is additive: a legacy receipt with no recorded mode still funds a
	// cashu_lock_v1 auction, so committed history replays unchanged.
	if auction.FundingMode == FundingModeCashuSigAll && receipt.FundingMode != FundingModeCashuSigAll {
		return errors.New("sigall auction requires a cashu_sigall_v1 lock receipt")
	}
	if auction.FundingMode == FundingModeCashuLock && receipt.FundingMode != "" && receipt.FundingMode != FundingModeCashuLock {
		return errors.New("mint-backed auction lock receipt names a different funding mode")
	}
	if !validOperationID(receipt.OperationID) || !validLowerHex(receipt.TokenSHA256, sha256.Size) || !validLowerHex(receipt.Signature, schnorr.SignatureSize) {
		return errors.New("Cashu lock receipt identifiers or signature shape are invalid")
	}
	if _, exists := state.CashuLocks[receipt.TokenSHA256]; exists {
		return errors.New("Cashu lock token was already committed")
	}
	// The proof set must be a bounded, canonically ordered, unique set of
	// compressed points, and no proof may already be committed to another bid.
	// This is the deterministic half of the guarantee: it holds on every
	// validator without asking anyone, so one proof cannot fund two bids even
	// if the mint is unreachable or a proposer smuggles the transaction past
	// CheckTx.
	if len(receipt.ProofStateRefs) == 0 || len(receipt.ProofStateRefs) > MaxInputs {
		return errors.New("Cashu lock receipt must bind a bounded nonempty proof set")
	}
	seenProof := map[string]bool{}
	for index, proofStateRef := range receipt.ProofStateRefs {
		if !validCompressedPublicKey(proofStateRef) || seenProof[proofStateRef[2:]] ||
			(index > 0 && receipt.ProofStateRefs[index-1] >= proofStateRef) {
			return errors.New("Cashu lock proof references must be sorted, unique compressed points")
		}
		seenProof[proofStateRef[2:]] = true
		if state.CashuProofUses[proofStateRef[2:]] != "" {
			return errors.New("Cashu lock proof was already committed to another bid")
		}
	}
	digest := cashuReceiptDigest(receipt)
	// The application-authority signature over the receipt digest, through the
	// one shared Schnorr check (verifyFundingSchnorr) the receipt paths all use.
	if !verifyFundingSchnorr(receipt.Signature, digest[:], receipt.CommitteePublicKey) {
		return errors.New("Cashu lock receipt signature is invalid")
	}
	return nil
}

// verifyBidProofs checks a bid's carried proof set inside consensus: rules 2-6
// of the escrow-synthesis brief. A bid with no proofs returns immediately and
// behaves exactly as before, so a chain that predates the field replays
// unchanged. When proofs are present every validator re-derives the DLEQ and
// the sum from the transaction itself; rule 1 (the auction is open and the
// bidder is not the seller) is enforced earlier in applyBid, and rule 6 (the
// reuse guard) is the EXISTING one in verifyCashuLockReceipt, which the proof
// set is bound to by requiring it to be exactly the receipt's references.
func verifyBidProofs(auction Auction, content bidContent, policy Policy) error {
	if len(content.Proofs) == 0 {
		return nil
	}
	if content.CashuLock == nil {
		return errors.New("a bid that carries proofs must also carry the Cashu lock they back")
	}
	if len(content.Proofs) > MaxInputs {
		return errors.New("bid carries more proofs than the network permits")
	}
	receipt := *content.CashuLock

	var total int64
	refs := make([]string, 0, len(content.Proofs))
	seen := map[string]bool{}
	for index, proof := range content.Proofs {
		if proof.Amount <= 0 {
			return fmt.Errorf("proof %d: bad proof amount: no positive amount", index)
		}
		if proof.Secret == "" || len(proof.Secret) > 4096 {
			return fmt.Errorf("proof %d: a proof requires a secret", index)
		}
		// Rule 2: every proof must name the genesis-pinned keyset.
		if policy.pinnedKeysetID() == "" {
			return fmt.Errorf("proof %d: proof from unpinned keyset: the network pinned no mint keyset", index)
		}
		if proof.KeysetID != policy.pinnedKeysetID() {
			return fmt.Errorf("proof %d: proof from unpinned keyset: proof names %q but the network pinned %q", index, proof.KeysetID, policy.pinnedKeysetID())
		}
		// Rule 3: a pinned key must exist for the proof's amount.
		pinnedKeyHex, ok := policy.keysetKeyForAmount(proof.Amount)
		if !ok {
			return fmt.Errorf("proof %d: bad proof amount: the pinned keyset has no key for %d", index, proof.Amount)
		}
		if !validCompressedPublicKey(proof.C) {
			return fmt.Errorf("proof %d: proof C is not a compressed secp256k1 point", index)
		}
		// Rule 4: the DLEQ verifies against that pinned key, through the
		// existing verifier -- no new cryptography. Y is derived from the
		// secret with the same hash_to_curve the mint and wallet use.
		reference, err := demoMintProofY(proof.Secret)
		if err != nil {
			return fmt.Errorf("proof %d: %w", index, err)
		}
		pinnedKey, err := pinnedMintKeyForAmount(pinnedKeyHex)
		if err != nil {
			return fmt.Errorf("proof %d: %w", index, err)
		}
		binding := MintProofBinding{Amount: proof.Amount, KeysetID: proof.KeysetID, Y: reference, C: proof.C, DLEQ: proof.DLEQ}
		keyset := &MintKeySet{ID: policy.pinnedKeysetID(), Unit: "sat", Keys: map[int64]*btcec.PublicKey{proof.Amount: pinnedKey}}
		if err := VerifyProofBinding(binding, keyset); err != nil {
			return fmt.Errorf("proof %d: proof DLEQ does not verify against the pinned mint key: %w", index, err)
		}
		if seen[reference[2:]] {
			return errors.New("bid carries a duplicate proof reference")
		}
		seen[reference[2:]] = true
		refs = append(refs, reference)
		if proof.Amount > (1<<62)-total {
			return errors.New("proof amounts overflow")
		}
		total += proof.Amount
	}
	// Rule 5: the proof amounts must sum exactly to the bid's amount.
	if total != content.Amount {
		return fmt.Errorf("proof amounts sum to %d, but the bid claims %d", total, content.Amount)
	}
	// The proof set must be exactly the references the lock receipt commits.
	// That is what makes the existing reuse guard in verifyCashuLockReceipt
	// cover these proofs: the receipt's references -- not a caller-supplied
	// list -- are what was checked against CashuProofUses.
	sort.Strings(refs)
	expected := append([]string(nil), receipt.ProofStateRefs...)
	sort.Strings(expected)
	if strings.Join(refs, ",") != strings.Join(expected, ",") {
		return errors.New("the bid's proofs are not the references its Cashu lock receipt commits")
	}
	// Rule 7: the lock parses as EXACTLY the 2-of-2 SIG_ALL shape. It applies
	// to the SIG_ALL route, whose lock is the secret of each proof.
	if auction.FundingMode == FundingModeCashuSigAll || receipt.FundingMode == FundingModeCashuSigAll {
		required := auctionRequiredLocktime(auction)
		for index, proof := range content.Proofs {
			if err := parseSigAllLock(proof.Secret, receipt.RefundPublicKey, receipt.CommitteePublicKey, required); err != nil {
				return fmt.Errorf("proof %d: %w", index, err)
			}
		}
	}
	return nil
}

// pinnedMintKeyForAmount parses a genesis-pinned compressed key. It is the only
// key consensus may use: there is no fetch and no fallback.
func pinnedMintKeyForAmount(encoded string) (*btcec.PublicKey, error) {
	decoded, err := hex.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("the pinned mint key is not hex")
	}
	key, err := btcec.ParsePubKey(decoded)
	if err != nil {
		return nil, errors.New("the pinned mint key is not a valid compressed secp256k1 point")
	}
	return key, nil
}

func cashuReceiptDigest(receipt CashuLockReceipt) [32]byte {
	fields := []any{
		receipt.Schema, receipt.MintURL, receipt.AuctionID, receipt.Bidder, receipt.Amount,
		receipt.OperationID, receipt.TokenSHA256, receipt.CommitteePublicKey,
		receipt.RefundPublicKey, receipt.Locktime, receipt.ProofStateRefs,
	}
	// A receipt that records a funding mode commits it too, so the mode cannot
	// be swapped out from under a signature. The append is conditional so a
	// cashu_lock_v1 receipt (mode "") keeps the byte-identical digest it had
	// before this field existed.
	if receipt.FundingMode != "" {
		fields = append(fields, receipt.FundingMode)
	}
	material, _ := json.Marshal(fields)
	return sha256.Sum256(material)
}

func validLowerHex(value string, bytes int) bool {
	if len(value) != bytes*2 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == bytes
}

func validCompressedPublicKey(value string) bool {
	if !validLowerHex(value, 33) || (value[:2] != "02" && value[:2] != "03") {
		return false
	}
	decoded, _ := hex.DecodeString(value)
	_, err := btcec.ParsePubKey(decoded)
	return err == nil
}

func validOperationID(value string) bool {
	if len(value) < 1 || len(value) > 160 {
		return false
	}
	for _, current := range value {
		if !((current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '-' || current == '_') {
			return false
		}
	}
	return true
}

func applyClose(state *State, auctionID string, now int64, privateKey ed25519.PrivateKey) error {
	operation := "close:" + auctionID
	if state.Operations[operation] {
		return errors.New("auction close was already committed")
	}
	auction, ok := state.Auctions[auctionID]
	if !ok || auction.Status != "open" {
		return errors.New("auction is not open")
	}
	if now < auction.EndTime {
		return errors.New("auction has not ended")
	}
	auction.Status = "closed"
	auction.ClosedAt = now
	if auction.LeaderBidID != "" {
		leaderBid, ok := state.Bids[auction.LeaderBidID]
		if !ok {
			return errors.New("winner bid is missing from state")
		}
		leaderLock, ok := state.Locks[auction.LeaderBidID]
		if !ok || leaderLock.Status != "locked" {
			return errors.New("winner lock is not locked")
		}
		// The winner is the bidder holding the leading position: every locked
		// leg of that position is selected together, and the reserve is
		// compared against the position total, not one leg.
		var legs []string
		var positionTotal int64
		for id, lock := range state.Locks {
			if lock.AuctionID != auction.ID || lock.Bidder != leaderBid.Bidder || lock.Status != "locked" {
				continue
			}
			legs = append(legs, id)
			positionTotal += lock.Amount
		}
		sort.Strings(legs)
		if len(legs) == 0 {
			return errors.New("winner position has no locked leg")
		}
		if auction.Reserve == 0 || positionTotal >= auction.Reserve {
			auction.Winner = leaderBid.Bidder
			var legacyLegs []string
			for _, id := range legs {
				lock := state.Locks[id]
				legBid := state.Bids[id]
				switch {
				case legBid.IntegratedFundingID != "":
					funding := state.IntegratedFundings[legBid.IntegratedFundingID]
					funding.Status = "payout_entitled"
					state.IntegratedFundings[funding.ID] = funding
					lock.Status = "winner_selected"
				case legBid.ReservationID != "":
					reservation := state.CustodyReservations[legBid.ReservationID]
					reservation.Status = "payout_entitled"
					state.CustodyReservations[reservation.ID] = reservation
					lock.Status = "winner_selected"
				case legBid.CashuTokenSHA256 != "":
					lock.Status = "winner_selected"
				default:
					legacyLegs = append(legacyLegs, id)
					continue
				}
				state.Locks[id] = lock
			}
			if len(legacyLegs) > 0 {
				// The legacy interim-note route pays the seller one note for
				// the whole winning position.
				note, err := issueNote(*state, privateKey, operation, "seller-payout", auction.Seller, positionTotal)
				if err != nil {
					return err
				}
				state.Notes[note.ID] = note
				auction.PaymentNoteID = note.ID
				for _, id := range legacyLegs {
					lock := state.Locks[id]
					lock.Status = "paid"
					lock.OutputNoteID = note.ID
					state.Locks[id] = lock
				}
			}
		} else {
			for _, id := range legs {
				lock := state.Locks[id]
				lock.Status = "refundable"
				state.Locks[id] = lock
				legBid := state.Bids[id]
				if legBid.IntegratedFundingID != "" {
					funding := state.IntegratedFundings[legBid.IntegratedFundingID]
					funding.Status = "release_entitled"
					state.IntegratedFundings[funding.ID] = funding
				}
				if legBid.ReservationID != "" {
					reservation := state.CustodyReservations[legBid.ReservationID]
					reservation.Status = "release_entitled"
					state.CustodyReservations[reservation.ID] = reservation
				}
			}
		}
	}
	state.Operations[operation] = true
	state.Auctions[auctionID] = auction
	return nil
}

func applyRefund(state *State, actor, eventID, bidID string, privateKey ed25519.PrivateKey) error {
	lock, ok := state.Locks[bidID]
	if !ok || lock.Bidder != actor {
		return errors.New("refund lock is missing or owned by another signer")
	}
	if lock.Status != "refundable" {
		return errors.New("bid is not refund eligible")
	}
	note, err := issueNote(*state, privateKey, eventID, "loser-refund", actor, lock.Amount)
	if err != nil {
		return err
	}
	state.Notes[note.ID] = note
	lock.Status = "refunded"
	lock.OutputNoteID = note.ID
	state.Locks[bidID] = lock
	return nil
}

// applySettle records that the winning lock was paid out. It is the mirror of
// the mint swap, never the swap itself: it issues no note, moves no value, and
// its absence cannot cost anyone their money. The proofs the coordinator
// produced are P2PK-locked to the seller's committed wallet key, so the seller
// keeps them whether or not this event ever commits.
//
// It is deliberately narrow: only the winner, only a closed cashu_lock_v1
// auction, only the winning lock, and only from winner_selected. A lock that is
// already paid is refused rather than silently re-recorded.
func applySettle(state *State, actor string, content settleContent) error {
	auction, ok := state.Auctions[content.AuctionID]
	if !ok {
		return errors.New("settlement names an unknown auction")
	}
	if auction.Status != "closed" {
		return errors.New("settlement requires a closed auction")
	}
	if auction.Winner == "" || auction.Winner != actor {
		return errors.New("settlement signer is not the auction winner")
	}
	if auction.FundingMode != FundingModeCashuLock {
		return errors.New("settlement requires a mint-backed auction")
	}
	if content.BidID == "" || content.BidID != auction.LeaderBidID {
		return errors.New("settlement does not name the winning bid")
	}
	if !validLowerHex(content.PayoutTokenSHA256, sha256.Size) {
		return errors.New("settlement payout token digest is not a sha256 digest")
	}
	lock, ok := state.Locks[content.BidID]
	if !ok || lock.AuctionID != auction.ID || lock.Bidder != actor {
		return errors.New("settlement lock is missing or owned by another signer")
	}
	if lock.Status != "winner_selected" {
		return fmt.Errorf("winning lock is %q, not winner_selected", lock.Status)
	}
	lock.Status = "paid"
	lock.CashuPayoutTokenSHA256 = content.PayoutTokenSHA256
	state.Locks[content.BidID] = lock
	return nil
}

// applicationAuthorityPubKey is the Nostr identity of the coordinator's own
// key -- the network's single secp256k1 committee key today (FROST later). A
// Nostr pubkey is the x-only form of that key, so it is the compressed
// committee key with its parity byte dropped.
func applicationAuthorityPubKey(state State) string {
	if !validCompressedPublicKey(state.CommitteePublicKey) {
		return ""
	}
	return state.CommitteePublicKey[2:]
}

// applyOutcomeRecord commits the coordinator's own record that a mint-backed
// lock reached its terminal outcome. It is the mirror of the mint swap, never
// the swap itself: it issues no IOU note and moves no value, so its absence
// cannot cost anyone their money. The bidder's stored pre-signature is the
// warrant; the coordinator holds no live signature and needs none.
//
// It is deliberately narrow. It is accepted only from the application
// authority, and only for a lock that actually holds the authorization naming
// the outcome it claims. The op key is outcome:<bid_id>:<outcome>, so a repeat
// is idempotent and settle and refund are distinct terminal records.
func applyOutcomeRecord(state *State, actor string, content outcomeContent) error {
	if content.Schema != "PlebeianAuctionsPOCOutcomeV1" {
		return errors.New("outcome record schema is unsupported")
	}
	// Only the application authority may post this kind. A bidder's browser
	// signs its own outcome authorizations, but it never posts the outcome.
	if actor == "" || actor != applicationAuthorityPubKey(*state) {
		return errors.New("outcome record must be posted by the application authority")
	}
	if content.Outcome != "settle" && content.Outcome != "refund" {
		return errors.New("outcome record names an unknown outcome")
	}
	if !validIdentifier(content.AuctionID) || !validIdentifier(content.BidID) {
		return errors.New("outcome record names an invalid auction or bid")
	}
	if !validLowerHex(content.PayoutTokenSHA256, sha256.Size) {
		return errors.New("outcome payout digest is not a sha256 digest")
	}
	operation := "outcome:" + content.BidID + ":" + content.Outcome
	if state.Operations[operation] {
		return errors.New("outcome was already committed")
	}
	lock, ok := state.Locks[content.BidID]
	if !ok || lock.AuctionID != content.AuctionID {
		return errors.New("outcome names an unknown lock")
	}
	switch content.Outcome {
	case "settle":
		auction, ok := state.Auctions[content.AuctionID]
		if !ok {
			return errors.New("outcome names an unknown auction")
		}
		if auction.Status != "closed" {
			return errors.New("settle outcome requires a closed auction")
		}
		if auction.FundingMode != FundingModeCashuLock && auction.FundingMode != FundingModeCashuSigAll {
			return errors.New("settle outcome requires a mint-backed auction")
		}
		// The winner is the bidder holding the leading position, so any leg of
		// that position may be settled; a leg that belongs to nobody's position
		// is refused. This is what lets a multi-leg winner settle every leg
		// rather than only the one that last established the lead.
		if auction.Winner == "" || lock.Bidder != auction.Winner {
			return errors.New("settle outcome does not name the winning bid")
		}
		if lock.Status != "winner_selected" {
			return fmt.Errorf("winning lock is %q, not winner_selected", lock.Status)
		}
		// A cashu_lock_v1 lock is authorized by the bidder's wallet spend-key
		// consent signature; a lock with none cannot be resolved.
		if lock.SettleAuthorization == "" {
			return errors.New("winning bid holds no settle authorization")
		}
		lock.Status = "paid"
		lock.CashuPayoutTokenSHA256 = content.PayoutTokenSHA256
	case "refund":
		if lock.Status != "refundable" {
			return fmt.Errorf("lock is %q, not refundable", lock.Status)
		}
		if lock.RefundAuthorization == "" {
			return errors.New("bid holds no refund authorization")
		}
		lock.Status = "refunded"
		lock.CashuPayoutTokenSHA256 = content.PayoutTokenSHA256
	}
	state.Locks[content.BidID] = lock
	state.Operations[operation] = true
	return nil
}

// bidOutcomeRefundClaimMessageV2 is the deterministic message the V2 refund
// consent signs with the wallet spend key. It is the pre-authorizable form: the
// old V1 bound the bid event id, which is unknowable when the bid is signed,
// so V2 binds only what is known at bid time -- the auction, the exact input
// proof set, and the exact output keys the returned proofs will be locked to.
// Both the live refund and the pre-authorized refund use it. Keep this byte-for-
// byte aligned with refundClaimMessageV2 in webwallet/src/wallet.ts.
func bidOutcomeRefundClaimMessageV2(auctionID string, proofRefs, outputPublicKeys []string) []byte {
	refs := append([]string(nil), proofRefs...)
	sort.Strings(refs)
	outputs := append([]string(nil), outputPublicKeys...)
	sort.Strings(outputs)
	return []byte("PlebeianAuctionsCashuRefundClaimV2\nauction_id=" + auctionID +
		"\nproofs=" + strings.Join(refs, ",") + "\noutputs=" + strings.Join(outputs, ","))
}

// verifyBidOutcomeAuthorizations checks the wallet spend-key pre-signatures a
// mint-backed bid publishes. Both must verify against the key the receipt
// commits as RefundPublicKey -- the key that owns the locked value -- over the
// exact consent messages the coordinator will later act on. A bid missing them,
// or carrying a signature by any other key, reintroduces the liveness
// requirement, so this is a mandatory local-admission (CheckTx) rule.
func verifyBidOutcomeAuthorizations(content bidContent) error {
	receipt := content.CashuLock
	if receipt == nil {
		return nil
	}
	authorization := content.OutcomeAuthorizations
	if authorization == nil || authorization.Schema != "PlebeianAuctionsPOCBidOutcomesV1" {
		return errors.New("mint-backed bid must publish settle and refund outcome authorizations")
	}
	if !validLowerHex(authorization.SettleSpendSignature, schnorr.SignatureSize) {
		return errors.New("bid must publish a settle authorization as a 64-byte hex Schnorr signature")
	}
	if !validLowerHex(authorization.RefundSpendSignature, schnorr.SignatureSize) {
		return errors.New("bid must publish a refund authorization as a 64-byte hex Schnorr signature")
	}
	if !validCompressedPublicKey(receipt.RefundPublicKey) {
		return errors.New("bid outcome authorizations require the receipt's wallet spend key")
	}
	publicBytes, _ := hex.DecodeString(receipt.RefundPublicKey)
	point, err := btcec.ParsePubKey(publicBytes)
	if err != nil {
		return errors.New("bid outcome authorizations require the receipt's wallet spend key")
	}
	spendKey, err := schnorr.ParsePubKey(schnorr.SerializePubKey(point))
	if err != nil {
		return errors.New("bid outcome authorizations require the receipt's wallet spend key")
	}
	settleBytes, _ := hex.DecodeString(authorization.SettleSpendSignature)
	settleSignature, err := schnorr.ParseSignature(settleBytes)
	if err != nil {
		return errors.New("bid settle authorization is malformed")
	}
	settleDigest := sha256.Sum256(demoMintSettleClaimMessage(content.AuctionID, receipt.ProofStateRefs))
	if !settleSignature.Verify(settleDigest[:], spendKey) {
		return errors.New("bid settle authorization does not verify over the auction id and proof set")
	}
	outputs := make([]string, len(receipt.ProofStateRefs))
	for index := range outputs {
		outputs[index] = receipt.RefundPublicKey
	}
	refundBytes, _ := hex.DecodeString(authorization.RefundSpendSignature)
	refundSignature, err := schnorr.ParseSignature(refundBytes)
	if err != nil {
		return errors.New("bid refund authorization is malformed")
	}
	refundDigest := sha256.Sum256(bidOutcomeRefundClaimMessageV2(content.AuctionID, receipt.ProofStateRefs, outputs))
	if !refundSignature.Verify(refundDigest[:], spendKey) {
		return errors.New("bid refund authorization does not verify over the auction id, proof set and outputs")
	}
	return nil
}

func issueNote(state State, privateKey ed25519.PrivateKey, operation, purpose, owner string, amount int64) (Note, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return Note{}, errors.New("legacy test-mint authority is unavailable")
	}
	if amount <= 0 || !validActor(owner) {
		return Note{}, errors.New("invalid test-mint output")
	}
	material := fmt.Sprintf("%s|%s|%s|%s|%d", state.ChainID, operation, purpose, owner, amount)
	digest := sha256.Sum256([]byte(material))
	note := Note{ID: hex.EncodeToString(digest[:]), Amount: amount, Owner: owner}
	message := noteMessage(state, note)
	note.Signature = hex.EncodeToString(ed25519.Sign(privateKey, []byte(message)))
	if _, exists := state.Notes[note.ID]; exists {
		return Note{}, errors.New("deterministic test-mint output already exists")
	}
	return note, nil
}

func verifyNote(state State, note Note) error {
	publicKey, err := hex.DecodeString(state.MintPublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("invalid mint public key")
	}
	signature, err := hex.DecodeString(note.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(noteMessage(state, note)), signature) {
		return errors.New("test-mint note signature is invalid")
	}
	return nil
}

func noteMessage(state State, note Note) string {
	return fmt.Sprintf("plebeian-test-mint-v1|%s|%s|%s|%d", state.ChainID, note.ID, note.Owner, note.Amount)
}

// CashuLockReceiptOf returns the Cashu lock receipt carried by a bid
// transaction, or nil when the transaction is not a Cashu-lock bid.
func CashuLockReceiptOf(tx Transaction) (*CashuLockReceipt, error) {
	if tx.Event == nil || tx.Event.Kind != KindBid {
		return nil, nil
	}
	var content bidContent
	if err := decodeStrictContent(tx.Event.Content, &content); err != nil {
		return nil, err
	}
	return content.CashuLock, nil
}

func decodeStrictContent(raw string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode signed event content: %w", err)
	}
	return requireEOF(decoder)
}

func requireEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("trailing JSON value")
	}
	return err
}

func validActor(actor string) bool {
	if len(actor) != 64 || strings.ToLower(actor) != actor {
		return false
	}
	decoded, err := hex.DecodeString(actor)
	return err == nil && len(decoded) == 32
}

func validIdentifier(value string) bool {
	if len(value) < 1 || len(value) > 64 {
		return false
	}
	for _, current := range value {
		if !((current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '-' || current == '_') {
			return false
		}
	}
	return true
}

func validImageURL(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	if len(value) > 512 {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && parsed.Fragment == ""
}
