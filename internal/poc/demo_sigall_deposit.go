package poc

// The SIG_ALL deposit route: the coordinator accepts the bidder's two
// pre-authorized outcome transactions, verifies them with the one shared
// verifySigAllDeposit (the five rules in sigall.go), stores the bearer
// templates durably under a deterministic deposit id, and returns its own
// signed deposit receipt so admission can bind the on-chain deposit_id to a
// real deposit.
//
// This is the one place the coordinator holds spendable material between bid
// and outcome: the templates carry the locked proofs' `secret` and `C`. That is
// the unavoidable cost of letting the bidder go offline, and SIG_ALL is what
// makes it safe -- the stored transaction is signed, so the coordinator can
// only ever submit one of the two the bidder authorized. The store is durable
// (write-then-rename, mode 0600) so a deposit survives a restart, exactly like
// settlementStore and demoOutcomeProofStore.
//
// The signer is the SAME application authority key that signs the lock receipts
// in demo_mint_lock.go (server.demoCommitteeKey): this file introduces no second
// authority.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// sigAllStoredDeposit is what the coordinator keeps for one deposit: its own
// signed receipt, the bearer templates (the two exact outcome transactions),
// and the committed settle destination (the auction's seller payout key). The
// destination is stored so the submit path can re-check it without re-reading
// consensus state.
type sigAllStoredDeposit struct {
	Receipt           sigAllDepositReceipt   `json:"receipt"`
	Templates         sigAllDepositTemplates `json:"templates"`
	SettleDestination string                 `json:"settle_destination"`
}

// sigAllDepositStore is the durable bearer-template store. A deposit is written
// to <dir>/<deposit_id>.json and read back on a cache miss, so a restart between
// bid and outcome no longer loses the ability to resolve the lock. The bytes
// carry secrets, so the files are mode 0600 and never leave the coordinator.
type sigAllDepositStore struct {
	mu sync.Mutex
	// dir is the durable root; empty keeps the store in memory only (tests, or
	// a host with no configured network root). A deposit id is a valid
	// identifier, so filepath.Base collapses any separator and a key can never
	// escape dir.
	dir  string
	byID map[string]sigAllStoredDeposit
}

func (store *sigAllDepositStore) path(key string) string {
	return filepath.Join(store.dir, filepath.Base(key)+".json")
}

// put stores a deposit durably before returning, so the caller knows it can
// survive a restart. It is idempotent for the same id (a retry with the same
// digests derives the same id and overwrites byte-identical content).
func (store *sigAllDepositStore) put(deposit sigAllStoredDeposit) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.byID == nil {
		store.byID = map[string]sigAllStoredDeposit{}
	}
	store.byID[deposit.Receipt.DepositID] = deposit
	return store.persistLocked(deposit.Receipt.DepositID, deposit)
}

// persistLocked writes one deposit durably with the same discipline persistState
// uses for committed state: an atomic temp-file plus rename, fsyncing the file
// and then its directory, mode 0600.
func (store *sigAllDepositStore) persistLocked(key string, deposit sigAllStoredDeposit) error {
	if store.dir == "" {
		return nil
	}
	if err := os.MkdirAll(store.dir, 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(deposit)
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

func (store *sigAllDepositStore) get(key string) (sigAllStoredDeposit, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if deposit, ok := store.byID[key]; ok {
		return deposit, true
	}
	if store.dir == "" {
		return sigAllStoredDeposit{}, false
	}
	raw, err := os.ReadFile(store.path(key))
	if err != nil {
		return sigAllStoredDeposit{}, false
	}
	var deposit sigAllStoredDeposit
	if err := json.Unmarshal(raw, &deposit); err != nil {
		return sigAllStoredDeposit{}, false
	}
	if store.byID == nil {
		store.byID = map[string]sigAllStoredDeposit{}
	}
	store.byID[key] = deposit
	return deposit, true
}

// findForAuctionBidder returns the deposit already stored for one auction and
// bidder, if any, so a second deposit for the same auction+bidder can be
// refused when its digests differ.
func (store *sigAllDepositStore) findForAuctionBidder(auctionID, bidder string) (sigAllStoredDeposit, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, deposit := range store.byID {
		if deposit.Receipt.AuctionID == auctionID && deposit.Receipt.Bidder == bidder {
			return deposit, true
		}
	}
	return sigAllStoredDeposit{}, false
}

// reload reads every durable deposit back into the cache, so a fresh process
// serves what a previous one stored. It is safe to call when dir is empty.
func (store *sigAllDepositStore) reload() error {
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
	if store.byID == nil {
		store.byID = map[string]sigAllStoredDeposit{}
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		key := strings.TrimSuffix(entry.Name(), ".json")
		if !validOperationID(key) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(store.dir, entry.Name()))
		if err != nil {
			return err
		}
		var deposit sigAllStoredDeposit
		if err := json.Unmarshal(raw, &deposit); err != nil {
			return err
		}
		store.byID[key] = deposit
	}
	return nil
}

// sigAllDepositID derives the deposit id deterministically from the verified
// material (auction, bidder and the two template digests), so a retry of the
// same deposit is idempotent and a different deposit for the same auction+bidder
// gets a different id. The result has the validOperationID shape (lowercase hex,
// 64 chars).
func sigAllDepositID(auctionID, bidder, settleDigest, refundDigest string) string {
	material := strings.Join([]string{
		"PlebeianAuctionsPOCSigAllDepositIDV1", auctionID, bidder, settleDigest, refundDigest,
	}, "\n")
	digest := sha256.Sum256([]byte(material))
	return hex.EncodeToString(digest[:])
}

// sigAllDepositCandidates collects the caller's committed lock receipts for one
// auction and bidder. A sigall_deposit request names only the auction and the
// bidder, so the receipt is found by walking the committed locks for that pair.
func sigAllDepositCandidates(snapshot State, auctionID, bidder string) []CashuLockReceipt {
	var receipts []CashuLockReceipt
	seen := map[string]bool{}
	for _, lock := range snapshot.Locks {
		if lock.AuctionID != auctionID || lock.Bidder != bidder {
			continue
		}
		bid, ok := snapshot.Bids[lock.BidID]
		if !ok || bid.CashuTokenSHA256 == "" || seen[bid.CashuTokenSHA256] {
			continue
		}
		receipt, ok := snapshot.CashuLocks[bid.CashuTokenSHA256]
		if !ok {
			continue
		}
		seen[bid.CashuTokenSHA256] = true
		receipts = append(receipts, receipt)
	}
	return receipts
}

// demoSigAllDeposit accepts and stores the bidder's two pre-authorized outcome
// transactions. The lock receipt it verifies against comes from the request body
// when the wallet posts it (the live ordering), and otherwise from the caller's
// committed lock for the auction (a retry after the bid committed). It verifies
// the deposit with the shared verifySigAllDeposit, stores the bearer templates
// durably under a deterministic deposit id, and returns its own signed deposit
// receipt. It refuses, naming the rule, when the posted receipt is not a
// cashu_sigall_v1 lock for this auction and bidder signed by the authority, when
// there is no receipt for this auction+bidder on the fallback path, when the
// auction is closed, when the auction committed no seller payout key, when a rule
// in verifySigAllDeposit fails, or when a second deposit with different digests
// already exists.
func (server *APIServer) demoSigAllDeposit(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim || server.manifest.ApplicationAuthority != ApplicationAuthorityLegacy {
		writeError(response, http.StatusNotFound, errors.New("demo sigall deposit coordinator is available only on a legacy loopback network"))
		return
	}
	if server.demoCommitteeKey == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo sigall deposit coordinator has no committee key"))
		return
	}
	var body sigAllDepositRequest
	if err := decodeBody(request, &body); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validIdentifier(body.AuctionID) || !validActor(body.Bidder) {
		writeError(response, http.StatusBadRequest, errors.New("demo sigall deposit requires a valid auction and bidder"))
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 4*time.Second)
	defer cancel()
	snapshot, err := server.demoCommittedState(ctx)
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, err)
		return
	}
	auction, exists := snapshot.Auctions[body.AuctionID]
	if !exists {
		writeError(response, http.StatusNotFound, errors.New("auction not found in committed state"))
		return
	}
	if auction.Status != "open" {
		writeError(response, http.StatusUnprocessableEntity, errors.New("sigall deposit: auction is not open"))
		return
	}

	// The lock receipt the deposit is verified against. The preferred source is
	// the receipt the wallet posts in the body, which the coordinator verifies
	// itself: that is the only source that exists in the live ordering, because
	// no committed lock exists until a bid commits and a cashu_sigall_v1 bid does
	// not commit without a deposit. A cashu_lock_v1 receipt is refused on either
	// path: it carries no SIG_ALL templates.
	var sigAllReceipts []CashuLockReceipt
	if body.Receipt != nil {
		if err := verifySigAllLockReceiptForDeposit(*body.Receipt, server.demoCommitteePublicKey, body.AuctionID, body.Bidder); err != nil {
			writeError(response, http.StatusUnprocessableEntity, err)
			return
		}
		sigAllReceipts = append(sigAllReceipts, *body.Receipt)
	} else {
		// Fallback: a retry posted after the bid committed, found by walking the
		// committed locks for this auction+bidder.
		candidates := sigAllDepositCandidates(snapshot, body.AuctionID, body.Bidder)
		if len(candidates) == 0 {
			writeError(response, http.StatusUnprocessableEntity, errors.New("sigall deposit: no lock receipt for this auction and bidder"))
			return
		}
		for _, candidate := range candidates {
			if candidate.FundingMode == FundingModeCashuSigAll {
				sigAllReceipts = append(sigAllReceipts, candidate)
			}
		}
		if len(sigAllReceipts) == 0 {
			writeError(response, http.StatusUnprocessableEntity, errors.New("sigall deposit: lock receipt for this auction and bidder is not a cashu_sigall_v1 lock"))
			return
		}
	}
	if !validCompressedPublicKey(auction.SellerCocoPaymentPublicKey) {
		writeError(response, http.StatusUnprocessableEntity, errors.New("sigall deposit: auction committed no seller payout key"))
		return
	}

	// Verify with the one shared implementation of the five rules. Its error
	// text names the rule; surface it verbatim, the way demoMintLock does.
	var settleDigest, refundDigest string
	var verified CashuLockReceipt
	var lastErr error
	for _, candidate := range sigAllReceipts {
		settle, refund, err := verifySigAllDeposit(candidate, auction, body.Templates)
		if err == nil {
			settleDigest, refundDigest, verified = settle, refund, candidate
			break
		}
		lastErr = err
	}
	if verified.CommitteePublicKey == "" {
		writeError(response, http.StatusUnprocessableEntity, lastErr)
		return
	}

	// Refuse a second deposit for the same auction+bidder whose digests differ;
	// an identical retry derives the same id and is idempotent.
	depositID := sigAllDepositID(body.AuctionID, body.Bidder, settleDigest, refundDigest)
	if existing, ok := server.demoSigAllDeposits.findForAuctionBidder(body.AuctionID, body.Bidder); ok {
		if existing.Receipt.SettleDigest != settleDigest || existing.Receipt.RefundDigest != refundDigest {
			writeError(response, http.StatusUnprocessableEntity, errors.New("sigall deposit: a different deposit for this auction and bidder is already stored"))
			return
		}
	}

	receipt := sigAllDepositReceipt{
		Schema:       SigAllDepositReceiptSchema,
		DepositID:    depositID,
		AuctionID:    body.AuctionID,
		Bidder:       body.Bidder,
		SettleDigest: settleDigest,
		RefundDigest: refundDigest,
		Signer:       server.demoCommitteePublicKey,
	}
	// The application authority key signs the receipt, exactly as it signs the
	// lock receipts. sigAllDepositReceiptDigest covers every field but the
	// signature, so the signed bytes cannot drift from the verified bytes.
	digest := sigAllDepositReceiptDigest(receipt)
	signature, err := schnorr.Sign(server.demoCommitteeKey, digest[:])
	if err != nil {
		writeError(response, http.StatusInternalServerError, fmt.Errorf("demo sigall deposit signing failed: %w", err))
		return
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())

	stored := sigAllStoredDeposit{Receipt: receipt, Templates: body.Templates, SettleDestination: auction.SellerCocoPaymentPublicKey}
	if err := server.demoSigAllDeposits.put(stored); err != nil {
		writeError(response, http.StatusInternalServerError, fmt.Errorf("demo sigall deposit could not be stored: %w", err))
		return
	}
	writeJSON(response, http.StatusOK, receipt)
}

// demoSigAllOutcome resolves a cashu_sigall_v1 lock through its stored deposit.
// It is the cooperative endpoints' SIG_ALL branch: the coordinator submits the
// pre-authorized template for the committed outcome, never a freshly-built
// transaction, and returns a named refusal when no deposit is stored. A settle
// parks the payout for the seller under the auction id, exactly as the
// cooperative settlement does; a refund parks the payout under the bid id and
// returns the proofs to the caller, so the sweeper can post the refund outcome
// that marks the lock refunded.
func (server *APIServer) demoSigAllOutcome(response http.ResponseWriter, request *http.Request, lock Lock, receipt CashuLockReceipt, outcome string) {
	if lock.SigAllDepositID == "" {
		writeError(response, http.StatusUnprocessableEntity, errors.New("sigall outcome requires a deposited template, and the lock names none"))
		return
	}
	deposit, ok := server.demoSigAllDeposits.get(lock.SigAllDepositID)
	if !ok {
		writeError(response, http.StatusUnprocessableEntity, errors.New("sigall outcome requires the deposited outcome templates, which are not stored"))
		return
	}
	// Fail closed on any uncertainty about the mint's spend state before the one
	// swap that moves value.
	if err := VerifyCashuLockProofsAtMint(server.demoMintChecker, receipt); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	swapCtx, swapCancel := context.WithTimeout(request.Context(), demoMintSwapTimeout)
	defer swapCancel()
	fresh, err := server.demoMintSigAllSpend(swapCtx, receipt, deposit, outcome)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	if outcome == "settle" {
		// Park the payout for the seller. Its proofs are P2PK-locked to the
		// seller's committed key, so publishing the bytes is safe.
		if err := server.demoSettlements.put(lock.AuctionID, fresh); err != nil {
			log.Printf("demo settlement payout could not be persisted: %v", err)
		}
	} else {
		// Park the refund under the bid id -- the sweeper's own refund park
		// key -- so the sweeper posts the refund outcome that marks the lock
		// refunded, instead of looping forever on a proof this swap just
		// spent. The bidder's cooperative refund endpoint serves the parked
		// payout afterward. Without this the lock stayed `refundable` while
		// its proofs were already SPENT at the mint.
		if err := server.demoSettlements.put(demoOutcomeParkKey(lock, outcome), fresh); err != nil {
			log.Printf("demo refund payout could not be persisted: %v", err)
		}
	}
	writeJSON(response, http.StatusOK, demoMintRefundResponse{Proofs: fresh})
}
