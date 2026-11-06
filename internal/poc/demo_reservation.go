package poc

// The demo reservation coordinator.
//
// A legacy loopback network (PlebeianAuctionsPOCNetworkV2) funds bids through a
// committee-attested CustodyReservationReceiptV1 (model.go:196-210).  On the
// four-host deployment that receipt is produced by the separately deployed Cashu
// coordinator.  A single-machine demo has no such service, so this file provides
// the smallest honest substitute: it holds the network's committee key (which
// init already wrote into the network root) and signs the exact receipt the
// application expects.
//
// This is deliberately NOT a threshold authority.  It cannot make a bid
// acceptable that the application would otherwise refuse, it never contacts a
// mint, and it moves no value.  It only attests "this bidder has this amount
// reserved", which is precisely the trust the legacy funding mode already
// encodes.  It is registered only for a loopback, legacy, faucet-enabled demo.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	cmtbytes "github.com/cometbft/cometbft/libs/bytes"
)

// demoReservationReserveSeconds bounds how long an issued reservation may live.
// Verification refuses anything beyond policy.ReceiptTTLSeconds from committed
// time (model.go:1161), so this stays inside that ceiling with margin.
const demoReservationReserveSeconds = 240

// loadDemoCommitteeKey reads the committee private key that init wrote to the
// network root (network.go:467-476).  It refuses a missing, non-regular or
// group/world-readable key rather than creating one.
func loadDemoCommitteeKey(root string) (*btcec.PrivateKey, string, error) {
	path := filepath.Join(root, "cashu-committee.key")
	info, err := os.Lstat(path)
	if err != nil {
		return nil, "", fmt.Errorf("demo coordinator requires the network committee key: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&0o077 != 0 {
		return nil, "", errors.New("demo committee key must be a regular file with no group or other access")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) != 32 {
		return nil, "", errors.New("demo committee key is not a 32-byte hex secret")
	}
	privateKey, publicKey := btcec.PrivKeyFromBytes(key)
	return privateKey, hex.EncodeToString(publicKey.SerializeCompressed()), nil
}

// demoCommittedState reads the committed application state through the same ABCI
// query the /api/state handler serves, so the coordinator reasons about exactly
// what consensus has accepted rather than a cached copy.
func (server *APIServer) demoCommittedState(ctx context.Context) (State, error) {
	client, err := server.firstHealthyClient(ctx)
	if err != nil {
		return State{}, err
	}
	result, err := client.ABCIQuery(ctx, "/state", cmtbytes.HexBytes([]byte("")))
	if err != nil {
		return State{}, fmt.Errorf("committed state query: %w", err)
	}
	if result.Response.Code != 0 {
		return State{}, fmt.Errorf("committed state refused: %s", result.Response.Log)
	}
	var view StateView
	if err := json.Unmarshal(result.Response.Value, &view); err != nil {
		return State{}, fmt.Errorf("committed state decode: %w", err)
	}
	return view.State, nil
}

// demoReservation issues one committee-signed reservation receipt for a bid.
func (server *APIServer) demoReservation(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim || server.manifest.ApplicationAuthority != ApplicationAuthorityLegacy {
		writeError(response, http.StatusNotFound, errors.New("demo reservation coordinator is available only on a legacy faucet-enabled loopback network"))
		return
	}
	if server.demoCommitteeKey == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo reservation coordinator has no committee key"))
		return
	}
	var body struct {
		AuctionID             string `json:"auction_id"`
		Bidder                string `json:"bidder"`
		Amount                int64  `json:"amount"`
		ReplacesReservationID string `json:"replaces_reservation_id"`
	}
	if err := decodeBody(request, &body); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validIdentifier(body.AuctionID) || !validActor(body.Bidder) || body.Amount <= 0 {
		writeError(response, http.StatusBadRequest, errors.New("demo reservation requires a valid auction, bidder and positive amount"))
		return
	}
	if body.Amount > server.manifest.Policy.FaucetCap {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("demo reservation exceeds the fake-money cap of %d", server.manifest.Policy.FaucetCap))
		return
	}

	// The receipt must describe an auction the committed state actually has, and
	// it must respect that auction's own rules.  Anything the application would
	// refuse is refused here too, instead of producing a receipt that fails
	// later at consensus with a less useful message.
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
		writeError(response, http.StatusUnprocessableEntity, errors.New("auction is not open"))
		return
	}
	if auction.FundingMode != FundingModeCustodialReservation {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("auction funding mode %q does not accept a custodial reservation", auction.FundingMode))
		return
	}
	if auction.Seller == body.Bidder {
		writeError(response, http.StatusUnprocessableEntity, errors.New("a seller cannot reserve against their own auction"))
		return
	}
	// Own raises must carry the leader's reservation forward, so say so here
	// rather than emitting a receipt the application will refuse (model.go:1175).
	if auction.LeaderBidID != "" {
		leader, ok := snapshot.Bids[auction.LeaderBidID]
		if !ok {
			writeError(response, http.StatusServiceUnavailable, errors.New("committed leader bid is missing from state"))
			return
		}
		if leader.Bidder == body.Bidder && body.ReplacesReservationID != leader.ReservationID {
			writeError(response, http.StatusUnprocessableEntity, errors.New("an own raise must replace the leader's existing reservation"))
			return
		}
		if leader.Bidder != body.Bidder && body.ReplacesReservationID != "" {
			writeError(response, http.StatusBadRequest, errors.New("only an own raise may declare a replaced reservation"))
			return
		}
	} else if body.ReplacesReservationID != "" {
		writeError(response, http.StatusBadRequest, errors.New("no leader exists to replace"))
		return
	}

	receipt := CustodyReservationReceipt{
		Schema:                "PlebeianAuctionsPOCCustodyReservationV1",
		MintURL:               snapshot.CashuMintURL,
		AuctionID:             body.AuctionID,
		Bidder:                body.Bidder,
		Amount:                body.Amount,
		ReservationID:         newDemoReservationID(),
		ReplacesReservationID: body.ReplacesReservationID,
		ExpiresAt:             time.Now().Unix() + demoReservationReserveSeconds,
		CommitteePublicKey:    server.demoCommitteePublicKey,
	}
	// custodyReservationDigest is the application's own function, so the signed
	// bytes cannot drift from the verified bytes.
	digest := custodyReservationDigest(receipt)
	signature, err := schnorr.Sign(server.demoCommitteeKey, digest[:])
	if err != nil {
		writeError(response, http.StatusInternalServerError, fmt.Errorf("demo reservation signing failed: %w", err))
		return
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())
	writeJSON(response, http.StatusOK, receipt)
}

// newDemoReservationID returns a 32-byte lowercase-hex operation identifier.
// It panics on entropy failure rather than returning a predictable id, because a
// reused reservation id is a correctness fault in the application state.
func newDemoReservationID() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("demo reservation entropy unavailable: %v", err))
	}
	return hex.EncodeToString(buf)
}