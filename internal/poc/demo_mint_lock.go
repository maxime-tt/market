package poc

// The demo mint-backed funding coordinator.
//
// The difference from demo_reservation.go matters and is the whole point of
// this file. The custodial coordinator invents the value: it signs "this bidder
// has this amount reserved" against nothing at all. This one cannot. The bidder
// mints real proofs from the mint, locks them to the committee itself, and keeps
// them; this service never sees a bearer proof, never holds one, and never moves
// one. All it does is
//
//  1. confirm with the mint that the proof references the bidder named really
//     do exist and are unspent, and
//  2. sign the exact receipt the application expects over those references.
//
// So the trust it carries is strictly smaller than the custodial path's: it can
// overstate the AMOUNT (the references carry no amounts, see below), but it can
// no longer invent value that does not exist, and it cannot move anything.
// A receipt it refuses is a bid the application would refuse anyway.
//
// What it still cannot check, and neither can the application: that the proofs
// are locked to the committee. A NUT-11 spending condition lives inside the
// proof secret, and only the bearer of the proof holds it. Checking it would
// mean taking custody of the token, which is exactly what this design exists to
// avoid. The mint enforces the condition when the committee finally spends, and
// the application independently refuses any proof reference it has already seen
// in another bid.

import (
	"context"
	"errors"
	"fmt"
	"encoding/hex"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

// demoMintLockBody is what the browser wallet posts. It carries references and
// digests only: no secret, no unblinded signature, nothing spendable.
type demoMintLockBody struct {
	AuctionID       string   `json:"auction_id"`
	Bidder          string   `json:"bidder"`
	Amount          int64    `json:"amount"`
	Locktime        int64    `json:"locktime"`
	RefundPublicKey string   `json:"refund_public_key"`
	TokenSHA256     string   `json:"token_sha256"`
	ProofStateRefs  []string `json:"proof_state_refs"`
	// The proofs themselves, each with its DLEQ. Without these the amount is an
	// assertion; with them it is arithmetic.
	Proofs []MintProofBinding `json:"proofs"`
}

// demoMintLockMargin is how long after the auction ends the committee lock stays
// valid. It must sit inside the window the application enforces
// (model.go:1546 allows end .. end+3600).
const demoMintLockMargin = 600

func (server *APIServer) demoMintLock(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim || server.manifest.ApplicationAuthority != ApplicationAuthorityLegacy {
		writeError(response, http.StatusNotFound, errors.New("demo mint-lock coordinator is available only on a legacy loopback network"))
		return
	}
	if server.demoCommitteeKey == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo mint-lock coordinator has no committee key"))
		return
	}
	if server.demoMintChecker == nil {
		writeError(response, http.StatusServiceUnavailable, errors.New("demo mint-lock coordinator has no mint"))
		return
	}
	var body demoMintLockBody
	if err := decodeBody(request, &body); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if !validIdentifier(body.AuctionID) || !validActor(body.Bidder) || body.Amount <= 0 {
		writeError(response, http.StatusBadRequest, errors.New("demo mint lock requires a valid auction, bidder and positive amount"))
		return
	}
	if body.Amount > server.manifest.Policy.FaucetCap {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("demo mint lock exceeds the fake-money cap of %d", server.manifest.Policy.FaucetCap))
		return
	}
	if !validCompressedPublicKey(body.RefundPublicKey) {
		writeError(response, http.StatusBadRequest, errors.New("demo mint lock requires a valid compressed refund key"))
		return
	}
	if !validLowerHex(body.TokenSHA256, 32) {
		writeError(response, http.StatusBadRequest, errors.New("demo mint lock requires a sha256 token digest"))
		return
	}
	// The application enforces canonically ordered, unique compressed points and
	// a bounded set, so refuse anything else here rather than emit a receipt that
	// fails later at consensus with a less useful message.
	if len(body.ProofStateRefs) == 0 || len(body.ProofStateRefs) > MaxInputs {
		writeError(response, http.StatusBadRequest, errors.New("demo mint lock requires a bounded nonempty proof set"))
		return
	}
	ordered := append([]string(nil), body.ProofStateRefs...)
	sort.Strings(ordered)
	seen := map[string]bool{}
	for index, ref := range body.ProofStateRefs {
		if !validCompressedPublicKey(ref) || seen[ref[2:]] || ref != ordered[index] {
			writeError(response, http.StatusBadRequest, errors.New("demo mint lock proof references must be sorted, unique compressed points"))
			return
		}
		seen[ref[2:]] = true
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
		writeError(response, http.StatusUnprocessableEntity, errors.New("auction is not open"))
		return
	}
	if auction.FundingMode != FundingModeCashuLock {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("auction funding mode %q does not accept a mint lock", auction.FundingMode))
		return
	}
	if auction.Seller == body.Bidder {
		writeError(response, http.StatusUnprocessableEntity, errors.New("a seller cannot fund against their own auction"))
		return
	}
	if body.Locktime < auction.EndTime || body.Locktime > auction.EndTime+3_600 {
		writeError(response, http.StatusUnprocessableEntity, errors.New("mint lock locktime is outside the auction settlement window"))
		return
	}
	// Sign only what consensus would accept: a reference already committed to
	// another bid makes the receipt dead on arrival.
	for _, ref := range body.ProofStateRefs {
		if snapshot.CashuProofUses[ref[2:]] != "" {
			writeError(response, http.StatusUnprocessableEntity, errors.New("a proof reference is already committed to another bid"))
			return
		}
	}

	receipt := CashuLockReceipt{
		Schema:             "PlebeianAuctionsPOCCashuLockV1",
		MintURL:            snapshot.CashuMintURL,
		AuctionID:          body.AuctionID,
		Bidder:             body.Bidder,
		Amount:             body.Amount,
		OperationID:        newDemoReservationID(),
		TokenSHA256:        body.TokenSHA256,
		CommitteePublicKey: server.demoCommitteePublicKey,
		RefundPublicKey:    body.RefundPublicKey,
		Locktime:           body.Locktime,
		ProofStateRefs:     body.ProofStateRefs,
	}

	// Ask the mint before signing anything. A receipt signed over proofs that do
	// not exist, or are already spent, would be the coordinator asserting
	// something untrue -- which is precisely the failure this mode exists to
	// remove.
	// Prove the backing before signing anything. NUT-07 cannot establish that a
	// proof exists -- it answers UNSPENT for points never issued -- so the sum of
	// independently verified DLEQ proofs is what carries weight. A receipt signed
	// over arithmetic that does not add up is the coordinator attesting to
	// something false, which is the failure this mode exists to remove.
	if len(body.Proofs) == 0 {
		writeError(response, http.StatusBadRequest, errors.New("demo mint lock requires the proofs themselves, with their DLEQ proofs, not only references"))
		return
	}
	if len(body.Proofs) != len(body.ProofStateRefs) {
		writeError(response, http.StatusBadRequest, errors.New("demo mint lock proof set and reference set must be the same size"))
		return
	}
	keyset, err := server.demoMintKeyset.Keyset(body.Proofs[0].KeysetID)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	verified, err := VerifiedBacking(body.Proofs, keyset)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}
	if verified < body.Amount {
		writeError(response, http.StatusUnprocessableEntity,
			fmt.Errorf("the proofs prove %d sats of backing, less than the %d claimed", verified, body.Amount))
		return
	}
	// The references the receipt binds must be exactly the points that verified,
	// or the receipt would attest to a set it did not check.
	verifiedRefs := make([]string, 0, len(body.Proofs))
	for _, proof := range body.Proofs {
		verifiedRefs = append(verifiedRefs, proof.Y)
	}
	sort.Strings(verifiedRefs)
	if strings.Join(verifiedRefs, ",") != strings.Join(ordered, ",") {
		writeError(response, http.StatusBadRequest, errors.New("demo mint lock references do not match the verified proofs"))
		return
	}
	// DLEQ has already proven these points were signed by the mint for these
	// amounts, which is a positive statement. The issuance canary existed only to
	// detect that NUT-07 cannot make one, so it is not passed here: NUT-07's
	// remaining job is the narrower "is it still unspent".
	if err := VerifyCashuLockProofsAtMint(server.demoMintChecker, receipt, nil); err != nil {
		writeError(response, http.StatusUnprocessableEntity, err)
		return
	}

	// cashuReceiptDigest is the application's own function, so the signed bytes
	// cannot drift from the verified bytes.
	digest := cashuReceiptDigest(receipt)
	signature, err := schnorr.Sign(server.demoCommitteeKey, digest[:])
	if err != nil {
		writeError(response, http.StatusInternalServerError, fmt.Errorf("demo mint lock signing failed: %w", err))
		return
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())
	writeJSON(response, http.StatusOK, receipt)
}
