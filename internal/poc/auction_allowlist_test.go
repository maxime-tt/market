package poc

import (
	"crypto/ed25519"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// auctionAllowlistState builds a genesis POC state and returns the committee key
// so a test can mint custodial reservation receipts against it.
func auctionAllowlistState(t *testing.T, chainID string, seedByte byte) (State, []byte, *btcec.PrivateKey) {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = seedByte
	committee := testPrivateKey(t)
	state, err := NewState(chainID, ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	return state, seed, committee
}

func applyAllowlistEvent(t *testing.T, state State, seed []byte, policy Policy, event SignedEvent, at int64) (State, error) {
	t.Helper()
	return ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, at, policy, seed)
}

func mustApplyAllowlistEvent(t *testing.T, state State, seed []byte, policy Policy, event SignedEvent, at int64) State {
	t.Helper()
	next, err := applyAllowlistEvent(t, state, seed, policy, event, at)
	if err != nil {
		t.Fatalf("apply kind %d at %d: %v", event.Kind, at, err)
	}
	return next
}

// TestAuctionKindNumberingIsThe1440SeriesAndRegular pins the whole point of the
// renumber: our kinds are the 1440 series, every one is in the NIP-01 REGULAR
// range (1000 <= n < 10000), and none is in the ephemeral range (20000..29999)
// where khatru drops an unsubscribed event. It also pins the reserved chat kind
// and the allow-list sizes.
func TestAuctionKindNumberingIsThe1440SeriesAndRegular(t *testing.T) {
	t.Parallel()
	want := map[string]int{
		"create":           1440,
		"bid":              1441,
		"chat":             1442,
		"refund":           1443,
		"settle":           1444,
		"outcome":          1445,
		"funding_abort":    1446,
		"state_commitment": 1447,
	}
	if len(AuctionKinds) != len(want) {
		t.Fatalf("AuctionKinds has %d roles, want %d", len(AuctionKinds), len(want))
	}
	for role, kind := range want {
		if got := AuctionKinds[role]; got != kind {
			t.Fatalf("AuctionKinds[%q] = %d, want %d", role, got, kind)
		}
		if !IsRegularAuctionKind(kind) {
			t.Fatalf("auction kind %d for role %q is not in the NIP-01 regular range [1000, 10000)", kind, role)
		}
		if kind >= 20000 && kind < 30000 {
			t.Fatalf("auction kind %d for role %q is in the ephemeral range that relays drop", kind, role)
		}
	}
	if KindCreate != 1440 || KindBid != 1441 || KindRefund != 1443 || KindSettle != 1444 ||
		KindOutcome != 1445 || KindFundingAbort != 1446 {
		t.Fatalf("symbolic kind names drifted: create=%d bid=%d refund=%d settle=%d outcome=%d abort=%d",
			KindCreate, KindBid, KindRefund, KindSettle, KindOutcome, KindFundingAbort)
	}
	for _, ours := range []int{KindCreate, KindBid, KindRefund, KindSettle, KindOutcome, KindFundingAbort} {
		if ours == AuctionKinds["chat"] {
			t.Fatalf("kind %d reuses the reserved chat kind", ours)
		}
	}
	if got := len(AuctionImmutableCreateFields); got != 11 {
		t.Fatalf("immutable create-field count = %d, want 11 (%v)", got, AuctionImmutableCreateFields)
	}
	if got := len(AuctionMutableCreateFields); got != 3 {
		t.Fatalf("mutable create-field count = %d, want 3 (%v)", got, AuctionMutableCreateFields)
	}
}

// TestFirstCreateBecomesAuctionRoot pins root pinning: the first create for
// (seller, d) is the root, and its event id is stored as auction_root_event_id.
func TestFirstCreateBecomesAuctionRoot(t *testing.T) {
	t.Parallel()
	state, seed, _ := auctionAllowlistState(t, "allowlist-root", 7)
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "lot", Title: "Lot", Duration: 600, StartingBid: 1_000})
	next := mustApplyAllowlistEvent(t, state, seed, policy, create, 1_000)
	auction := next.Auctions["lot"]
	if auction.RootEventID != create.ID {
		t.Fatalf("auction_root_event_id = %q, want the create event id %q", auction.RootEventID, create.ID)
	}
	if auction.VersionCreatedAt != 1_000 {
		t.Fatalf("version_created_at = %d, want 1000", auction.VersionCreatedAt)
	}
	if auction.Title != "Lot" {
		t.Fatalf("title = %q, want Lot", auction.Title)
	}
}

// TestDisplayEditIsAcceptedAndBecomesCanonical pins that title/description/
// image_url may be edited after publish, that the root pin and the end time are
// unchanged, and that the edit becomes the canonical version.
func TestDisplayEditIsAcceptedAndBecomesCanonical(t *testing.T) {
	t.Parallel()
	state, seed, _ := auctionAllowlistState(t, "allowlist-display", 8)
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "lot", Title: "Lot", Duration: 600, StartingBid: 1_000})
	state = mustApplyAllowlistEvent(t, state, seed, policy, create, 1_000)

	edit := testEvent(t, seller, 1_010, KindCreate, createContent{
		AuctionID: "lot", Title: "Better lot", Description: "now with a photo",
		ImageURL: "https://example.com/a.png", Duration: 600, StartingBid: 1_000,
	}, []string{"e", create.ID})
	next, err := applyAllowlistEvent(t, state, seed, policy, edit, 1_010)
	if err != nil {
		t.Fatalf("display-only edit refused: %v", err)
	}
	auction := next.Auctions["lot"]
	if auction.Title != "Better lot" || auction.Description != "now with a photo" || auction.ImageURL != "https://example.com/a.png" {
		t.Fatalf("display edit not applied: title=%q description=%q image=%q", auction.Title, auction.Description, auction.ImageURL)
	}
	if auction.RootEventID != create.ID {
		t.Fatalf("display edit moved the root: %q want %q", auction.RootEventID, create.ID)
	}
	if auction.OriginalEndTime != 1_600 || auction.EndTime != 1_600 {
		t.Fatalf("display edit moved the end: original=%d end=%d", auction.OriginalEndTime, auction.EndTime)
	}
	if auction.VersionCreatedAt != 1_010 {
		t.Fatalf("version_created_at = %d, want 1010", auction.VersionCreatedAt)
	}
}

// TestMoneyFieldEditIsRefusedByName pins supersession gating: a create that
// changes any immutable field is refused with the exact string
// "immutable_field_changed: <field>", naming the offending field.
func TestMoneyFieldEditIsRefusedByName(t *testing.T) {
	t.Parallel()
	state, seed, _ := auctionAllowlistState(t, "allowlist-immutable", 9)
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	paymentKey := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "lot", Title: "Lot", Duration: 600, StartingBid: 1_000})
	state = mustApplyAllowlistEvent(t, state, seed, policy, create, 1_000)

	base := func() createContent {
		return createContent{AuctionID: "lot", Title: "Lot", Duration: 600, StartingBid: 1_000}
	}
	cases := []struct {
		field   string
		content createContent
	}{
		{"starting_bid", func() createContent { c := base(); c.StartingBid = 2_000; return c }()},
		{"min_increment", func() createContent { c := base(); c.MinIncrement = 200; return c }()},
		{"reserve", func() createContent { c := base(); c.Reserve = 500; return c }()},
		{"duration_seconds", func() createContent { c := base(); c.Duration = 900; return c }()},
		{"late_bid_window_seconds", func() createContent { c := base(); c.LateBidWindowSeconds = int64Ptr(60); return c }()},
		{"late_bid_extension_seconds", func() createContent { c := base(); c.LateBidExtensionSeconds = int64Ptr(60); return c }()},
		{"max_total_extension_seconds", func() createContent { c := base(); c.MaxTotalExtensionSeconds = int64Ptr(900); return c }()},
		{"locktime_seconds", func() createContent { c := base(); c.LocktimeSeconds = int64Ptr(4_310); return c }()},
		{"funding_mode", func() createContent { c := base(); c.FundingMode = FundingModeCashuLock; return c }()},
		{"seller_coco_payment_public_key", func() createContent { c := base(); c.SellerCocoPaymentPublicKey = paymentKey; return c }()},
	}
	for _, testCase := range cases {
		edit := testEvent(t, seller, 1_010, KindCreate, testCase.content, []string{"e", create.ID})
		_, err := applyAllowlistEvent(t, state, seed, policy, edit, 1_010)
		want := "immutable_field_changed: " + testCase.field
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("%s: error = %v, want %q", testCase.field, err, want)
		}
	}
}

// TestBidMustBindToTheAuctionRoot pins root binding at admission: a bid with no
// e tag, or with an e tag that is not the root, is refused; one bound to the
// root is admitted.
func TestBidMustBindToTheAuctionRoot(t *testing.T) {
	t.Parallel()
	state, seed, committee := auctionAllowlistState(t, "allowlist-bid-root", 10)
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	bidder := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "lot", Title: "Lot", Duration: 600, StartingBid: 100})
	state = mustApplyAllowlistEvent(t, state, seed, policy, create, 1_000)

	receipt := testReservationReceipt(t, committee, "lot", actorForKey(bidder), 100, "res-1", "", 1_200)
	bidFor := func(tags ...[]string) SignedEvent {
		return testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "lot", Amount: 100, Reservation: &receipt}, tags...)
	}
	asTx := func(event SignedEvent) Transaction {
		return Transaction{Version: TxVersion, Type: "event", Event: &event}
	}

	if err := ValidateForMempool(state, asTx(bidFor()), policy, seed); err == nil || !strings.Contains(err.Error(), "root event") {
		t.Fatalf("unbound bid admission error = %v, want a root-binding refusal", err)
	}
	if err := ValidateForMempool(state, asTx(bidFor([]string{"e", strings.Repeat("0", 64)})), policy, seed); err == nil || !strings.Contains(err.Error(), "root event") {
		t.Fatalf("wrong-root bid admission error = %v, want a root-binding refusal", err)
	}
	if err := ValidateForMempool(state, asTx(bidFor([]string{"e", create.ID})), policy, seed); err != nil {
		t.Fatalf("root-bound bid admission error = %v, want admission", err)
	}
}

// TestLatestAcceptedVersionResolutionIgnoresRejectedUpdate pins the piece that a
// regular kind does not give for free: the canonical auction is the LATEST
// create by created_at that passes the immutable check; an accepted but older
// version, and a rejected (immutable-changing) update, are both ignored.
func TestLatestAcceptedVersionResolutionIgnoresRejectedUpdate(t *testing.T) {
	t.Parallel()
	state, seed, _ := auctionAllowlistState(t, "allowlist-latest", 11)
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "lot", Title: "First", Duration: 600, StartingBid: 1_000})
	state = mustApplyAllowlistEvent(t, state, seed, policy, create, 1_000)

	v2 := testEvent(t, seller, 1_010, KindCreate, createContent{AuctionID: "lot", Title: "Second", Duration: 600, StartingBid: 1_000}, []string{"e", create.ID})
	state = mustApplyAllowlistEvent(t, state, seed, policy, v2, 1_010)

	// An accepted but OLDER display edit must not override the canonical version.
	// The consensus clock stays monotonic, but the event's own created_at is
	// older than the canonical version, which is what resolution keys on.
	older := testEvent(t, seller, 1_005, KindCreate, createContent{AuctionID: "lot", Title: "Stale", Duration: 600, StartingBid: 1_000}, []string{"e", create.ID})
	next, err := applyAllowlistEvent(t, state, seed, policy, older, 1_015)
	if err != nil {
		t.Fatalf("an older display edit should be accepted (and ignored), got %v", err)
	}
	if got := next.Auctions["lot"].Title; got != "Second" {
		t.Fatalf("older version overrode the canonical title: %q, want Second", got)
	}
	if got := next.Auctions["lot"].VersionCreatedAt; got != 1_010 {
		t.Fatalf("older version changed version_created_at to %d, want 1010", got)
	}

	// A rejected update (an immutable field changed) must be ignored, never
	// applied, even though it is the newest by created_at.
	bad := testEvent(t, seller, 1_020, KindCreate, createContent{AuctionID: "lot", Title: "Third", Duration: 600, StartingBid: 9_999}, []string{"e", create.ID})
	if _, err := applyAllowlistEvent(t, state, seed, policy, bad, 1_020); err == nil || !strings.Contains(err.Error(), "immutable_field_changed: starting_bid") {
		t.Fatalf("immutable-changing update error = %v, want immutable_field_changed: starting_bid", err)
	}
	if got := state.Auctions["lot"].Title; got != "Second" {
		t.Fatalf("rejected update was applied: title %q, want Second", got)
	}
}

// TestBidPlacedBeforeADisplayEditStandsAfterIt pins that an edit is
// non-destructive: a committed bid binds to the root, so a later display edit
// leaves the leader, the lock and the bid in place.
func TestBidPlacedBeforeADisplayEditStandsAfterIt(t *testing.T) {
	t.Parallel()
	state, seed, committee := auctionAllowlistState(t, "allowlist-bid-survives-edit", 12)
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	bidder := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "lot", Title: "Lot", Duration: 600, StartingBid: 100})
	state = mustApplyAllowlistEvent(t, state, seed, policy, create, 1_000)

	receipt := testReservationReceipt(t, committee, "lot", actorForKey(bidder), 100, "res-1", "", 1_200)
	bid := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "lot", Amount: 100, Reservation: &receipt}, []string{"e", create.ID})
	state = mustApplyAllowlistEvent(t, state, seed, policy, bid, 1_001)
	if state.Auctions["lot"].LeaderBidID != bid.ID {
		t.Fatalf("bid did not take the lead before the edit")
	}

	edit := testEvent(t, seller, 1_010, KindCreate, createContent{
		AuctionID: "lot", Title: "Edited title", Description: "edited", ImageURL: "https://example.com/b.png",
		Duration: 600, StartingBid: 100,
	}, []string{"e", create.ID})
	next := mustApplyAllowlistEvent(t, state, seed, policy, edit, 1_010)

	auction := next.Auctions["lot"]
	if auction.Title != "Edited title" {
		t.Fatalf("edit not applied: title %q", auction.Title)
	}
	if auction.RootEventID != create.ID {
		t.Fatalf("edit moved the root: %q want %q", auction.RootEventID, create.ID)
	}
	if auction.LeaderBidID != bid.ID {
		t.Fatalf("edit detached the leader bid: %q want %q", auction.LeaderBidID, bid.ID)
	}
	if _, ok := next.Bids[bid.ID]; !ok {
		t.Fatalf("edit dropped the committed bid %q", bid.ID)
	}
	if next.Locks[bid.ID].Status != "locked" {
		t.Fatalf("edit changed the bid lock status to %q, want locked", next.Locks[bid.ID].Status)
	}
}
