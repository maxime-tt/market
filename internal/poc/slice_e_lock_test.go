package poc

// Wave E1, rule 7: the strict, differential 2-of-2 SIG_ALL lock parser. The
// parser must accept EXACTLY the one shape the wallet builds and the mint
// enforces and refuse every near-miss by name, because a validator and the mint
// reading the same secret differently is the bug class that cost the peer repo a
// fix. The differential set below ports the *shape* of their parser tests
// (crafted secrets, uppercase hex, duplicated key tags, tag order) rather than
// only the happy path.

import (
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// sigAllLockSecret builds the canonical 2-of-2 SIG_ALL lock secret cashu-ts
// emits: main keys [bidder, committee] in that order, n_sigs 2, refund [bidder],
// sigflag SIG_ALL, one locktime. bidderKey and committeeKey are COMPRESSED.
func sigAllLockSecret(t *testing.T, bidderKey, committeeKey string, locktime int64) string {
	t.Helper()
	return sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
		{"locktime", strconv.FormatInt(locktime, 10)},
		{"pubkeys", committeeKey[2:]},
		{"n_sigs", "2"},
		{"refund", bidderKey[2:]},
		{"sigflag", "SIG_ALL"},
	})
}

func sigAllLockSecretTags(t *testing.T, bidderKey, committeeKey string, tags [][]string) string {
	t.Helper()
	return sigAllLockSecretRaw(t, hex.EncodeToString(testPrivateKey(t).Serialize()), bidderKey[2:], tags)
}

func sigAllLockSecretRaw(t *testing.T, nonce, data string, tags [][]string) string {
	t.Helper()
	raw, err := json.Marshal([]any{"P2PK", sigAllLockCondition{Nonce: nonce, Data: data, Tags: tags}})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func compressed(key *btcec.PrivateKey) string {
	return hex.EncodeToString(key.PubKey().SerializeCompressed())
}

// TestSliceERule7LockMustBeExactlyTwoOfTwoSigAll is the happy path: the one
// shape is accepted.
func TestSliceERule7LockMustBeExactlyTwoOfTwoSigAll(t *testing.T) {
	t.Parallel()
	bidder, committee := testPrivateKey(t), testPrivateKey(t)
	secret := sigAllLockSecret(t, compressed(bidder), compressed(committee), 5_000)
	if err := parseSigAllLock(secret, compressed(bidder), compressed(committee), 4_000); err != nil {
		t.Fatalf("the canonical 2-of-2 SIG_ALL lock was refused: %v", err)
	}
}

// TestSliceERule7DifferentialParserSet accepts exactly the one shape and
// refuses every near-miss by name. Each case states the mutation and the reason
// substring the refusal must carry.
func TestSliceERule7DifferentialParserSet(t *testing.T) {
	t.Parallel()
	bidder, committee := testPrivateKey(t), testPrivateKey(t)
	bidderKey, committeeKey := compressed(bidder), compressed(committee)
	const required = 4_000
	valid := sigAllLockSecret(t, bidderKey, committeeKey, 5_000)

	// Sanity: the baseline is accepted, or the whole set proves nothing.
	if err := parseSigAllLock(valid, bidderKey, committeeKey, required); err != nil {
		t.Fatalf("baseline lock refused: %v", err)
	}

	cases := []struct {
		name    string
		secret  string
		reasons []string
	}{
		{"crafted: n_sigs one", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:]}, {"n_sigs", "1"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_ALL"},
		}), []string{"n_sigs must be 2"}},
		{"crafted: extra pubkey", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:], bidderKey[2:]}, {"n_sigs", "2"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_ALL"},
		}), []string{"exactly one value"}},
		{"crafted: duplicated pubkeys tag", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:]}, {"pubkeys", committeeKey[2:]}, {"n_sigs", "2"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_ALL"},
		}), []string{"exactly 5"}},
		{"crafted: extra tag", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:]}, {"n_sigs", "2"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_ALL"}, {"custom", "x"},
		}), []string{"exactly 5"}},
		{"crafted: missing sigflag", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:]}, {"n_sigs", "2"}, {"refund", bidderKey[2:]},
		}), []string{"exactly 5"}},
		{"crafted: wrong tag order", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"pubkeys", committeeKey[2:]}, {"locktime", "5000"}, {"n_sigs", "2"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_ALL"},
		}), []string{"first tag must be locktime"}},
		{"crafted: sigflag inputs", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:]}, {"n_sigs", "2"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_INPUTS"},
		}), []string{"sigflag must be SIG_ALL"}},
		{"crafted: refund is the committee", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:]}, {"n_sigs", "2"}, {"refund", committeeKey[2:]}, {"sigflag", "SIG_ALL"},
		}), []string{"refund pubkeys must be exactly"}},
		{"crafted: data is the committee", sigAllLockSecretRaw(t, hex.EncodeToString(testPrivateKey(t).Serialize()), committeeKey[2:], [][]string{
			{"locktime", "5000"}, {"pubkeys", committeeKey[2:]}, {"n_sigs", "2"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_ALL"},
		}), []string{"first main pubkey is not the bidder"}},
		{"crafted: pubkeys names a foreign key", sigAllLockSecretTags(t, bidderKey, committeeKey, [][]string{
			{"locktime", "5000"}, {"pubkeys", bidderKey[2:]}, {"n_sigs", "2"}, {"refund", bidderKey[2:]}, {"sigflag", "SIG_ALL"},
		}), []string{"[bidder, committee] in that order"}},
		{"uppercase hex in data", strings.Replace(valid, bidderKey[2:], strings.ToUpper(bidderKey[2:]), 1), []string{"lowercase x-only"}},
		{"uppercase hex in a tag", strings.Replace(valid, committeeKey[2:], strings.ToUpper(committeeKey[2:]), 1), []string{"[bidder, committee] in that order"}},
		{"escaped key name", strings.Replace(valid, "\"pubkeys\"", "\"\\u0070ubkeys\"", 1), []string{"not canonical"}},
		{"whitespace padding", strings.Replace(valid, "[\"P2PK\",", "[\"P2PK\", ", 1), []string{"not canonical"}},
		{"extra condition field", strings.Replace(valid, "\"tags\":", "\"extra\":\"x\",\"tags\":", 1), []string{"not canonical"}},
		{"locktime below required", sigAllLockSecret(t, bidderKey, committeeKey, required-1), []string{"below the auction's required locktime"}},
		{"not a P2PK condition", "[\"HTLC\",{\"nonce\":\"" + strings.Repeat("a", 64) + "\",\"data\":\"" + bidderKey[2:] + "\",\"tags\":[]}]", []string{"not a P2PK condition"}},
		{"not JSON", "not json at all", []string{"not a NUT-10 P2PK condition"}},
		{"empty", "", []string{"not a NUT-10 P2PK condition"}},
	}
	for _, testCase := range cases {
		err := parseSigAllLock(testCase.secret, bidderKey, committeeKey, required)
		if err == nil {
			t.Fatalf("%s: the near-miss was ACCEPTED", testCase.name)
		}
		message := err.Error()
		for _, reason := range testCase.reasons {
			if !strings.Contains(message, reason) {
				t.Fatalf("%s: error = %q, want it to name %q", testCase.name, message, reason)
			}
		}
	}
}

// TestSliceERule7IsEnforcedInsideProofAdmission drives rule 7 through
// verifyBidProofs, the consensus helper applyBid calls, so the enforced path is
// the one a validator runs -- not only the parser in isolation.
func TestSliceERule7IsEnforcedInsideProofAdmission(t *testing.T) {
	t.Parallel()
	auction := Auction{ID: "sigall-lock-auction", FundingMode: FundingModeCashuSigAll, OriginalEndTime: 1_000, MaxTotalExtension: 1_800}
	required := auctionRequiredLocktime(auction)
	wallet, committee := testPrivateKey(t), testPrivateKey(t)
	mint := newTestPinnedMint(t, 64)
	policy := mint.policy(t)

	build := func(secretFor func() string) (bidContent, error) {
		var proofs []demoMintSpendProof
		var refs []string
		for index := 0; index < 2; index++ {
			secret := secretFor()
			proofs = append(proofs, mint.proofForSecret(t, 64, secret))
			reference, err := demoMintProofY(secret)
			if err != nil {
				t.Fatal(err)
			}
			refs = append(refs, reference)
		}
		sort.Strings(refs)
		receipt := CashuLockReceipt{
			Schema: "PlebeianAuctionsPOCCashuLockV1", MintURL: CashuMintURL, AuctionID: auction.ID,
			Bidder: "bidder", Amount: 128, OperationID: "op-sigall-lock", TokenSHA256: strings.Repeat("a", 64),
			CommitteePublicKey: compressed(committee), RefundPublicKey: compressed(wallet),
			Locktime: required, FundingMode: FundingModeCashuSigAll, ProofStateRefs: refs,
		}
		return bidContent{AuctionID: auction.ID, Amount: 128, CashuLock: &receipt, Proofs: proofs}, nil
	}

	good, err := build(func() string { return sigAllLockSecret(t, compressed(wallet), compressed(committee), required) })
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyBidProofs(auction, good, policy); err != nil {
		t.Fatalf("a correctly locked SIG_ALL proof set was refused: %v", err)
	}

	bad, err := build(func() string {
		return sigAllLockSecretTags(t, compressed(wallet), compressed(committee), [][]string{
			{"locktime", strconv.FormatInt(required, 10)}, {"pubkeys", compressed(committee)[2:]}, {"n_sigs", "1"}, {"refund", compressed(wallet)[2:]}, {"sigflag", "SIG_ALL"},
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyBidProofs(auction, bad, policy); err == nil || !strings.Contains(err.Error(), "n_sigs must be 2") {
		t.Fatalf("a one-of-two lock was admitted: %v", err)
	}
}

// TestSliceERule7SigAllBidWithProofsCommitsEndToEnd is the full-path proof: a
// cashu_sigall_v1 bid carrying its own 2-of-2-locked proofs is admitted through
// ApplyTransaction, and the same bid with a near-miss lock is refused by name.
func TestSliceERule7SigAllBidWithProofsCommitsEndToEnd(t *testing.T) {
	t.Parallel()
	fx := sigAllFixture(t)
	auction := fx.state.Auctions[fx.auctionID]
	required := auctionRequiredLocktime(auction)
	committee := fx.committee
	mint := newTestPinnedMint(t, 64)
	policy := mint.policy(t)
	wallet := newWalletClaim(t)
	bidder := testPrivateKey(t)

	buildContent := func(lock func() string) bidContent {
		var proofs []demoMintSpendProof
		var refs []string
		for index := 0; index < 2; index++ {
			secret := lock()
			proofs = append(proofs, mint.proofForSecret(t, 64, secret))
			reference, err := demoMintProofY(secret)
			if err != nil {
				t.Fatal(err)
			}
			refs = append(refs, reference)
		}
		sort.Strings(refs)
		receipt := testCarriedProofReceipt(t, committee, fx.auctionID, actorForKey(bidder), 128, required, wallet.publicKey, refs, FundingModeCashuSigAll)
		return bidContent{
			AuctionID: fx.auctionID, Amount: 128, CashuLock: &receipt, Proofs: proofs,
		}
	}

	good := buildContent(func() string { return sigAllLockSecret(t, wallet.publicKey, compressed(committee), required) })
	event := testEvent(t, bidder, 1_001, KindBid, good)
	if _, err := ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &event}, 1_001, policy, fx.seed); err != nil {
		t.Fatalf("a correctly locked sigall bid with proofs was refused: %v", err)
	}

	bad := buildContent(func() string { return sigAllLockSecret(t, wallet.publicKey, compressed(committee), required-1) })
	badEvent := testEvent(t, bidder, 1_001, KindBid, bad)
	if _, err := ApplyTransaction(fx.state, Transaction{Version: TxVersion, Type: "event", Event: &badEvent}, 1_001, policy, fx.seed); err == nil || !strings.Contains(err.Error(), "below the auction's required locktime") {
		t.Fatalf("a short-locktime sigall bid was admitted: %v", err)
	}
}
