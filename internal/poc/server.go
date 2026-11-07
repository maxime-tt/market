package poc

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	cmtbytes "github.com/cometbft/cometbft/libs/bytes"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	jsonrpctypes "github.com/cometbft/cometbft/rpc/jsonrpc/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

//go:embed static/*
var staticFiles embed.FS

type NodeStatus struct {
	Slot                  int    `json:"slot"`
	Moniker               string `json:"moniker"`
	Online                bool   `json:"online"`
	Error                 string `json:"error,omitempty"`
	NodeID                string `json:"node_id,omitempty"`
	ValidatorAddress      string `json:"validator_address,omitempty"`
	VotingPower           int64  `json:"voting_power,omitempty"`
	Peers                 int    `json:"peers,omitempty"`
	Height                int64  `json:"height,omitempty"`
	BlockHash             string `json:"block_hash,omitempty"`
	AppHash               string `json:"app_hash,omitempty"`
	CatchingUp            bool   `json:"catching_up,omitempty"`
	CanonicalCommitHeight int64  `json:"canonical_commit_height,omitempty"`
	CommitSignatures      int    `json:"commit_signatures,omitempty"`
	ObservedSignature     bool   `json:"observed_signature,omitempty"`
	Observation           string `json:"observation,omitempty"`
}

type APIServer struct {
	manifest NetworkManifest
	clients  []*rpchttp.HTTP
	offline  func(int) error
	cashu    *httputil.ReverseProxy
	// mintProxy maps the mint identity recorded in consensus state onto the
	// origin this host can reach, so a browser can mint against the same mint
	// the validators reason about without either side being told a half-truth.
	mintProxy http.Handler
	// The same checker the application uses for admission, so the coordinator
	// cannot sign a receipt over proofs the engine would then refuse.
	demoMintChecker MintStateChecker
	// Publishes the keys a proof's DLEQ must verify against.
	demoMintKeyset *MintKeySetFetcher
	legacyInterim  bool
	// Explicit activation is combined with current runtime readiness for UI
	// flags and direct R20 broadcasts. Authority/mint retain their own checks.
	browserThresholdReady bool
	// Loaded once from a root-owned create-once manifest whose digest is
	// independently pinned in the root-owned environment file.
	browserReleasePins *BrowserReleasePinsV1
	// Server-enforced public rollback boundary. It blocks every site mutation;
	// exact pre-existing payment recovery remains on the separately guarded
	// loopback Friday authority service.
	recoveryOnly bool
	// Legacy loopback demo only: the committee key that signs custodial
	// reservation receipts in the absence of a deployed coordinator.
	demoCommitteeKey       *btcec.PrivateKey
	demoCommitteePublicKey string
	runtimeReadyProbe      func(context.Context) bool
	healthPinsSHA256       string
	observerNodeID         string
	// demoStateSnapshot, when set, replaces the ABCI state query. Production
	// leaves it nil and reads committed state through the node; tests use it to
	// drive the coordinator without a live CometBFT cluster.
	demoStateSnapshot func(context.Context) (State, error)
}

const browserReleasePinsPath = "/etc/plebeian-auctions-friday/browser-r20-pins.json"

// applicationRejectionLogMarker identifies a deterministic CheckTx rejection in
// the CometBFT RPC error body.  broadcast_tx_commit returns JSON-RPC code
// -32603 ("Internal error") with the application's verdict embedded as
// "broadcast error on transaction validation: tx ... is invalid: code=1,
// data=, log='<app log>', codespace='<app codespace>'".  Only that explicit
// marker proves an application verdict; a timeout, refused connection or
// ambiguous broadcast does not carry it and must stay a 503.
const applicationRejectionLogMarker = "broadcast error on transaction validation:"

// Funding mode names published to the browser.  They mirror the on-chain
// FundingMode values so the client cannot invent one the application rejects.
const (
	browserFundingThreshold = "threshold_sigall_v1"
	browserFundingLegacy    = "custodial_reservation_v1"
	browserFundingNone      = ""
)

// legacyFundingMode names the funding mode this site can actually serve.  A
// threshold network serves the threshold mode; a legacy network serves the
// custodial reservation mode, but only when its faucet is enabled, because
// without a faucet no bidder can obtain value to reserve.  Otherwise the site
// publishes no mode and the browser keeps its controls closed.
func legacyFundingMode(thresholdRoute, legacyInterim bool) string {
	switch {
	case thresholdRoute:
		return browserFundingThreshold
	case legacyInterim:
		return browserFundingLegacy
	default:
		return browserFundingNone
	}
}

type BrowserReleasePinsV1 struct {
	Schema                  string `json:"schema"`
	DeploymentID            string `json:"deployment_id"`
	AuthNetworkID           string `json:"auth_network_id"`
	ChainID                 string `json:"chain_id"`
	GenesisSHA256           string `json:"genesis_sha256"`
	CashuMintURL            string `json:"cashu_mint_url"`
	CommitteePublicKey      string `json:"committee_public_key"`
	CommitteeKeysetID       string `json:"committee_keyset_id"`
	CommitteeKeysetVersion  string `json:"committee_keyset_version"`
	DKGRunID                string `json:"dkg_run_id"`
	PublicKeyPackageSHA256  string `json:"public_key_package_sha256"`
	SignerRosterDigest      string `json:"signer_roster_digest"`
	FakeFundingPolicyDigest string `json:"fake_funding_policy_digest"`
}

func browserDeploymentProfile(deployment, mint, keyset, version, dkg string) bool {
	if deployment == fridaySeparatedDeploymentID {
		return mint == "https://139.162.161.233" && keyset == fridaySeparatedKeysetID && version == "3" && dkg == fridaySeparatedDKGRunID
	}
	return deployment == fridayR20DeploymentID && mint == "https://172.105.95.57" && keyset == fridayR20KeysetID && version == fridayR20KeysetVersion && dkg == fridayR20DKGRunID
}

func validateBrowserReleasePins(value BrowserReleasePinsV1) error {
	if value.Schema != "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1" ||
		!browserDeploymentProfile(value.DeploymentID, value.CashuMintURL, value.CommitteeKeysetID, value.CommitteeKeysetVersion, value.DKGRunID) || !validOperationID(value.AuthNetworkID) ||
		!validOperationID(value.ChainID) || !validLowerHex(value.GenesisSHA256, 32) ||
		!validCompressedPublicKey(value.CommitteePublicKey) ||
		!validLowerHex(value.PublicKeyPackageSHA256, 32) || !validLowerHex(value.SignerRosterDigest, 32) ||
		!validLowerHex(value.FakeFundingPolicyDigest, 32) {
		return errors.New("browser release pins are malformed or differ from the fixed R20 deployment")
	}
	return nil
}

func loadBrowserReleasePins(expectedSHA256 string) (*BrowserReleasePinsV1, error) {
	if !validLowerHex(expectedSHA256, 32) {
		return nil, errors.New("POC_FRIDAY_BROWSER_PINS_SHA256 must be an exact lowercase SHA-256")
	}
	fd, err := syscall.Open(browserReleasePinsPath, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, fmt.Errorf("open browser release pins: %w", err)
	}
	file := os.NewFile(uintptr(fd), browserReleasePinsPath)
	if file == nil {
		syscall.Close(fd)
		return nil, errors.New("open browser release pins returned no file")
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat browser release pins: %w", err)
	}
	statValue, ok := before.Sys().(*syscall.Stat_t)
	if !ok || !before.Mode().IsRegular() || statValue.Nlink != 1 || statValue.Uid != 0 ||
		statValue.Gid != uint32(os.Getegid()) || before.Mode().Perm() != 0o640 {
		return nil, errors.New("browser release pins must be root-owned, service-group, regular single-link mode 0640")
	}
	data, err := io.ReadAll(io.LimitReader(file, 16_385))
	if err != nil || len(data) > 16_384 {
		return nil, errors.New("browser release pins read failed or exceeded 16 KiB")
	}
	after, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("restat browser release pins: %w", err)
	}
	afterStat, ok := after.Sys().(*syscall.Stat_t)
	if !ok || statValue.Dev != afterStat.Dev || statValue.Ino != afterStat.Ino ||
		before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return nil, errors.New("browser release pins changed while being read")
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != expectedSHA256 {
		return nil, errors.New("browser release pins digest differs")
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	var value BrowserReleasePinsV1
	if err := decoder.Decode(&value); err != nil {
		return nil, errors.New("browser release pins JSON is invalid")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return nil, errors.New("browser release pins contain trailing JSON")
	}
	if err := validateBrowserReleasePins(value); err != nil {
		return nil, err
	}
	return &value, nil
}

func NewAPIServer(manifest NetworkManifest, offline func(int) error) (*APIServer, error) {
	recoveryOnlyValue := os.Getenv("POC_FRIDAY_RECOVERY_ONLY")
	if recoveryOnlyValue != "" && recoveryOnlyValue != "true" && recoveryOnlyValue != "false" {
		return nil, errors.New("POC_FRIDAY_RECOVERY_ONLY must be exactly true or false")
	}
	observerNodeID := ""
	if manifest.DeploymentID == fridaySeparatedDeploymentID {
		if os.Getenv("FRIDAY_ROLE") != "APPLICATION" || os.Getenv("FRIDAY_SLOT") != "" {
			return nil, errors.New("separated site requires non-voting app role")
		}
		receipt, pinned, _, err := loadFridayObserver(os.Getenv("FRIDAY_NETWORK_ROOT"), os.Getenv("FRIDAY_OBSERVER_RECEIPT_SHA256"))
		if err != nil || pinned.ChainID != manifest.ChainID || receipt.NodeID != os.Getenv("FRIDAY_OBSERVER_NODE_ID") || receipt.OwnerApprovalPublicKey != os.Getenv("FRIDAY_OWNER_APPROVAL_PUBLIC_KEY") {
			return nil, errors.New("separated site observer pins invalid")
		}
		observerNodeID = receipt.NodeID
	}
	clientManifests := manifest.Validators
	if manifest.Mode == "remote" {
		// The site runs beside validator 1. Every remote RPC remains loopback
		// only; the other three nodes are observed from canonical commit
		// signatures and the primary node's live peer set.
		clientManifests = manifest.Validators[:1]
		if observerNodeID != "" {
			clientManifests = []ValidatorManifest{{RPCListen: fridayObserverRPC}}
		}
	}
	clients := make([]*rpchttp.HTTP, 0, len(clientManifests))
	for _, validator := range clientManifests {
		parsed, err := url.Parse(validator.RPCListen)
		if err != nil {
			return nil, err
		}
		client, err := rpchttp.New("http://" + parsed.Host)
		if err != nil {
			return nil, err
		}
		clients = append(clients, client)
	}
	coordinatorURL := os.Getenv("POC_CASHU_COORDINATOR_URL")
	if coordinatorURL == "" {
		coordinatorURL = "http://127.0.0.1:3339"
	}
	coordinator, err := url.Parse(coordinatorURL)
	if err != nil || coordinator.Scheme != "http" || coordinator.Hostname() != "127.0.0.1" {
		return nil, errors.New("Cashu coordinator must be an explicit loopback HTTP origin")
	}
	mintOrigin, err := url.Parse(mintTransportOrigin(manifest.CashuMintURL))
	if err != nil {
		return nil, fmt.Errorf("mint transport origin is invalid: %w", err)
	}
	mintProxy := httputil.NewSingleHostReverseProxy(mintOrigin)
	mintProxy.ErrorHandler = func(response http.ResponseWriter, _ *http.Request, proxyErr error) {
		writeError(response, http.StatusServiceUnavailable, fmt.Errorf("Cashu mint unavailable: %w", proxyErr))
	}
	proxy := httputil.NewSingleHostReverseProxy(coordinator)
	proxy.ErrorHandler = func(response http.ResponseWriter, _ *http.Request, proxyErr error) {
		writeError(response, http.StatusServiceUnavailable, fmt.Errorf("Cashu coordinator unavailable: %w", proxyErr))
	}
	browserReady := os.Getenv("POC_FRIDAY_BROWSER_READY") == "true"
	var browserPins *BrowserReleasePinsV1
	if browserReady && manifest.Schema == "PlebeianAuctionsPOCNetworkV4" {
		browserPins, err = loadBrowserReleasePins(os.Getenv("POC_FRIDAY_BROWSER_PINS_SHA256"))
		if err != nil {
			return nil, err
		}
	}
	// A loopback legacy demo signs its own custodial reservation receipts.  The
	// key is loaded here, once, and only for the exact mode that can serve them;
	// any other configuration registers no coordinator at all.
	var demoKey *btcec.PrivateKey
	demoPublicKey := ""
	if manifest.Mode != "remote" && manifest.ApplicationAuthority == ApplicationAuthorityLegacy &&
		os.Getenv("POC_ENABLE_LEGACY_INTERIM") == "true" && recoveryOnlyValue != "true" {
		loaded, loadedPublic, err := loadDemoCommitteeKey(os.Getenv("POC_DEMO_NETWORK_ROOT"))
		if err != nil {
			return nil, err
		}
		demoKey, demoPublicKey = loaded, loadedPublic
		if demoPublicKey != manifest.CommitteePublicKey {
			return nil, errors.New("demo committee key does not match the network committee public key")
		}
	}
	return &APIServer{observerNodeID: observerNodeID, manifest: manifest, clients: clients, offline: offline, cashu: proxy, mintProxy: mintProxy,
		legacyInterim:    os.Getenv("POC_ENABLE_LEGACY_INTERIM") == "true",
		demoCommitteeKey: demoKey, demoCommitteePublicKey: demoPublicKey,
		demoMintChecker:       NewHTTPMintStateChecker(mintTransportOrigin(manifest.CashuMintURL), mintCheckTimeout),
		demoMintKeyset:        NewMintKeySetFetcher(mintTransportOrigin(manifest.CashuMintURL), mintCheckTimeout),
		browserThresholdReady: browserReady, browserReleasePins: browserPins,
		recoveryOnly: recoveryOnlyValue == "true", healthPinsSHA256: os.Getenv("POC_FRIDAY_HEALTH_PINS_SHA256")}, nil
}

func (server *APIServer) Handler() (http.Handler, error) {
	assets, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/config", server.config)
	mux.HandleFunc("GET /api/browser-release-pins", server.browserPins)
	mux.HandleFunc("GET /api/state", server.state)
	mux.HandleFunc("GET /api/validators", server.validators)
	if server.recoveryOnly {
		mux.HandleFunc("POST /api/interim/faucet", server.recoveryOnlyMutation)
	} else {
		mux.HandleFunc("POST /api/interim/faucet", server.faucet)
		// A loopback legacy demo has no deployed coordinator, so the site signs
		// its own custodial reservation receipts.  Registered only in this exact
		// mode and only on loopback; every request is re-validated against
		// committed state.
		if server.demoCommitteeKey != nil {
			mux.HandleFunc("POST /api/demo/reservation", server.demoReservation)
			mux.HandleFunc("POST /api/demo/mint-lock", server.demoMintLock)
			mux.HandleFunc("POST /api/demo/mint-refund", server.demoMintRefund)
		}
	}
	if server.manifest.Schema == "PlebeianAuctionsPOCNetworkV4" {
		// The V4 threshold route has a different custody and authorization
		// contract.  Disabling the buttons in browser JavaScript is not a
		// security boundary: direct clients must not be able to reach the
		// Wednesday shared-key coordinator through the Friday site.
		mux.Handle("/api/mint/", http.StripPrefix("/api/mint", server.mintProxy))
		mux.HandleFunc("/api/cashu/", func(response http.ResponseWriter, _ *http.Request) {
			writeError(response, http.StatusGone, errors.New("Friday threshold wallet API is not installed; Wednesday custody fallback is disabled"))
		})
	} else {
		mux.Handle("/api/cashu/", server.cashu)
	}
	if server.recoveryOnly {
		mux.HandleFunc("POST /api/event", server.recoveryOnlyMutation)
		mux.HandleFunc("POST /api/close", server.recoveryOnlyMutation)
		mux.HandleFunc("POST /api/admin/offline", server.recoveryOnlyMutation)
	} else {
		mux.HandleFunc("POST /api/event", server.event)
		mux.HandleFunc("POST /api/close", server.closeAuction)
		mux.HandleFunc("POST /api/admin/offline", server.offlineValidator)
	}
	mux.Handle("/", http.FileServer(http.FS(assets)))
	return securityHeaders(mux, connectSources(server.manifest.CashuMintURL)), nil
}

// connectSources returns the extra origins the page is allowed to reach.
//
// It is exactly one: the Cashu mint identity recorded in consensus state. The
// page's own code never needed to leave its origin before, so connect-src 'self'
// was correct -- and it silently blocked the browser wallet the moment the
// bidder started minting their own proofs, because a CSP denial and a CORS
// denial look identical from JavaScript ("Failed to fetch"). The mint has to be
// reachable by the browser or the whole bidder-held design is impossible, so it
// is named here, one origin, rather than widened to a scheme or a wildcard.
func connectSources(cashuMintURL string) []string {
	parsed, err := url.Parse(cashuMintURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil
	}
	// A loopback mint is reached same-origin through the local site, so 'self'
	// already covers it and naming it again would only add noise.
	if parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1" {
		return nil
	}
	return []string{parsed.Scheme + "://" + parsed.Host}
}

func securityHeaders(next http.Handler, mintOrigins []string) http.Handler {
	connect := "'self'"
	for _, origin := range mintOrigins {
		connect += " " + origin
	}
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src "+connect+"; img-src 'self' data: https:; frame-ancestors 'none'")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(response, request)
	})
}

const r20FakeFundingPolicySchema = "PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1"

func r20FakeFundingPolicy(policy Policy) map[string]any {
	canonical := fmt.Sprintf("{\"max_per_request\":%d,\"max_resulting_balance\":%d,\"schema\":%q}",
		policy.FaucetAmount, policy.FaucetCap, r20FakeFundingPolicySchema)
	digest := sha256.Sum256([]byte(canonical))
	return map[string]any{
		"schema":                r20FakeFundingPolicySchema,
		"max_per_request":       policy.FaucetAmount,
		"max_resulting_balance": policy.FaucetCap,
		"digest":                hex.EncodeToString(digest[:]),
		"enforcement":           "browser_wallet_advisory_only",
	}
}

func (server *APIServer) browserPinsReady() bool {
	thresholdRoute := server.manifest.Schema == "PlebeianAuctionsPOCNetworkV4"
	pins := server.manifest.FundingAbortPins
	fundingPolicyDigest, _ := r20FakeFundingPolicy(server.manifest.Policy)["digest"].(string)
	return thresholdRoute && pins != nil && browserDeploymentProfile(server.manifest.DeploymentID, pins.MintURL, pins.CommitteeKeysetID, pins.CommitteeKeysetVersion, pins.DKGRunID) &&
		pins.AuthNetworkID != "" && pins.ChainID == server.manifest.ChainID &&
		pins.MintURL == server.manifest.CashuMintURL &&
		pins.CommitteePublicKey == server.manifest.CommitteePublicKey &&
		validLowerHex(pins.GenesisSHA256, 32) && validOperationID(pins.ActiveKeysetID) &&
		validCompressedPublicKey(pins.CommitteePublicKey) &&
		validLowerHex(pins.PublicKeyPackageSHA256, 32) && validLowerHex(pins.SignerRosterDigest, 32) &&
		server.browserReleasePins != nil && server.browserReleasePins.DeploymentID == server.manifest.DeploymentID &&
		server.browserReleasePins.AuthNetworkID == pins.AuthNetworkID && server.browserReleasePins.ChainID == pins.ChainID &&
		server.browserReleasePins.GenesisSHA256 == pins.GenesisSHA256 && server.browserReleasePins.CashuMintURL == pins.MintURL &&
		server.browserReleasePins.CommitteePublicKey == pins.CommitteePublicKey &&
		server.browserReleasePins.CommitteeKeysetID == pins.CommitteeKeysetID &&
		server.browserReleasePins.CommitteeKeysetVersion == pins.CommitteeKeysetVersion &&
		server.browserReleasePins.DKGRunID == pins.DKGRunID &&
		server.browserReleasePins.PublicKeyPackageSHA256 == pins.PublicKeyPackageSHA256 &&
		server.browserReleasePins.SignerRosterDigest == pins.SignerRosterDigest &&
		server.browserReleasePins.FakeFundingPolicyDigest == fundingPolicyDigest
}

func (server *APIServer) config(response http.ResponseWriter, request *http.Request) {
	thresholdRoute := server.manifest.Schema == "PlebeianAuctionsPOCNetworkV4"
	pins := server.manifest.FundingAbortPins
	fundingPolicy := r20FakeFundingPolicy(server.manifest.Policy)
	pinsReady := server.browserPinsReady()
	ready := pinsReady && server.browserRuntimeReady(request.Context())
	// On a deployment that also serves mint-backed funding the honest description
	// is not the custodial one, so say what the engine actually does now.
	mintBacked := server.demoMintChecker != nil && server.demoCommitteeKey != nil
	paymentAttestation := "validators verify the coordinator reservation signature; they do not independently inspect Cashu bearer proofs"
	walletAuthority := "custodial Coco v2 wallet against a Nutshell FakeWallet mint"
	bidFunding := "application-level custodial reservation; not a mint-enforced lock"
	if mintBacked {
		paymentAttestation = "a mint-backed bid's proof references are checked against the mint (NUT-07) before admission, and consensus refuses any reference already bound to another bid; the mint enforces non-double-spend at settlement"
		walletAuthority = "bidder-held NUT-11 P2PK proofs in the browser; the server never holds a bearer proof"
		bidFunding = "bidder-held NUT-11 lock to the committee, or an attested custodial reservation on auctions that ask for one"
	}
	if thresholdRoute {
		paymentAttestation = "validators verify a domain-separated 3-of-4 FROST admission over public proof references and exact package digests; bearer proofs stay off-chain"
		walletAuthority = "client-authorized NUT-11 proof pools with participant-local policy checks and durable exact mint recovery"
		bidFunding = "bidder-plus-FROST SIG_ALL pool; ordinary terminal branches use exact pre-signed templates"
	}
	config := map[string]any{
		"profile":                 "FAKE_MONEY_ONLY",
		"chain_id":                server.manifest.ChainID,
		"mint_url":                server.manifest.MintURL,
		"cashu_mint_url":          server.manifest.CashuMintURL,
		"committee_public_key":    server.manifest.CommitteePublicKey,
		"faucet_amount":           server.manifest.Policy.FaucetAmount,
		"default_auction_seconds": 600,
		// The browser must build a NUT-11 locktime that outlives every reachable
		// auction end, otherwise an anti-sniping extension can push the auction
		// past the lock and the leading bid loses its backing. The end can reach
		// original_end + MaxTotalExtension, and the lock must additionally cover
		// the recovery window consensus already requires (model.go:1318), so the
		// page is told the two policy numbers instead of hardcoding a margin.
		"max_total_extension_seconds": server.manifest.Policy.MaxTotalExtension,
		"emergency_recovery_seconds":  EmergencyRecoverySeconds,
		"shared_application_key":      !thresholdRoute,
		"threshold_custody":           thresholdRoute,
		// The legacy loopback demo (PlebeianAuctionsPOCNetworkV2) is a distinct,
		// honest funding mode: faucet-issued notes plus a committee-attested
		// custodial reservation.  The browser needs to be told which funding mode
		// it may actually use instead of assuming the threshold one, otherwise
		// every control is disabled on a network that demonstrably works.
		"funding_mode": legacyFundingMode(thresholdRoute, server.legacyInterim),
		// True when this deployment can serve a bid whose backing is real proofs
		// the mint will answer questions about, rather than a pure attestation.
		"mint_backed_funding": server.demoMintChecker != nil && server.demoCommitteeKey != nil,

		"fips_transport": thresholdRoute,
		// This remains false until the two-phase client-held payment signer and
		// admission service are installed. The browser must never fall back to a
		// shared-key reservation while labelling the result as threshold funded.
		"browser_threshold_admission_ready": ready,
		// The Wednesday Coco proxy is a different custody protocol. A Friday
		// browser must not read or mutate that wallet while presenting threshold
		// funding. The future two-phase API must set both readiness flags only
		// after its exact build/config has been reviewed and installed.
		"browser_threshold_wallet_ready": ready,
		"recovery_only":                  server.recoveryOnly,
		"payment_attestation":            paymentAttestation,
		"wallet_authority":               walletAuthority,
		"bid_funding":                    bidFunding,
		"fault_control_enabled":          server.offline != nil,
		"legacy_interim_enabled":         server.legacyInterim,
	}
	if thresholdRoute {
		config["fake_funding_policy"] = fundingPolicy
	}
	if pinsReady {
		config["deployment_id"] = server.manifest.DeploymentID
		config["auth_network_id"] = pins.AuthNetworkID
		config["genesis_sha256"] = pins.GenesisSHA256
		config["committee_keyset_id"] = pins.CommitteeKeysetID
		config["committee_keyset_version"] = pins.CommitteeKeysetVersion
		config["dkg_run_id"] = pins.DKGRunID
		config["public_key_package_sha256"] = pins.PublicKeyPackageSHA256
		config["signer_roster_digest"] = pins.SignerRosterDigest
	}
	writeJSON(response, http.StatusOK, config)
}

func (server *APIServer) browserPins(response http.ResponseWriter, _ *http.Request) {
	if server.browserReleasePins == nil || !server.browserThresholdReady || server.recoveryOnly {
		writeError(response, http.StatusServiceUnavailable, errors.New("R20 browser release pins are unavailable"))
		return
	}
	writeJSON(response, http.StatusOK, server.browserReleasePins)
}

func (server *APIServer) recoveryOnlyMutation(response http.ResponseWriter, _ *http.Request) {
	writeError(response, http.StatusConflict, errors.New("Friday recovery-only mode rejects new public mutations"))
}

func (server *APIServer) state(response http.ResponseWriter, request *http.Request) {
	actor := request.URL.Query().Get("actor")
	if actor != "" && !validActor(actor) {
		writeError(response, http.StatusBadRequest, errors.New("actor must be a lowercase 32-byte Nostr public key"))
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 4*time.Second)
	defer cancel()
	client, err := server.firstHealthyClient(ctx)
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, err)
		return
	}
	result, err := client.ABCIQuery(ctx, "/state", cmtbytes.HexBytes([]byte(actor)))
	if err != nil || result.Response.Code != 0 {
		if err == nil {
			err = errors.New(result.Response.Log)
		}
		writeError(response, http.StatusServiceUnavailable, err)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	_, _ = response.Write(result.Response.Value)
}

func (server *APIServer) validators(response http.ResponseWriter, request *http.Request) {
	if server.manifest.Mode == "remote" {
		statuses, err := server.remoteValidatorStatuses(request.Context())
		if err != nil {
			writeError(response, http.StatusServiceUnavailable, err)
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{"validators": statuses, "observed_at": time.Now().UTC().Format(time.RFC3339Nano)})
		return
	}
	statuses := make([]NodeStatus, 0, len(server.clients))
	for index, client := range server.clients {
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		status := server.nodeStatus(ctx, index, client)
		cancel()
		statuses = append(statuses, status)
	}
	writeJSON(response, http.StatusOK, map[string]any{"validators": statuses, "observed_at": time.Now().UTC().Format(time.RFC3339Nano)})
}

func (server *APIServer) remoteValidatorStatuses(parent context.Context) ([]NodeStatus, error) {
	ctx, cancel := context.WithTimeout(parent, 4*time.Second)
	defer cancel()
	client := server.clients[0]
	status, err := client.Status(ctx)
	if err != nil {
		return nil, fmt.Errorf("primary validator RPC: %w", err)
	}
	if server.manifest.DeploymentID == fridaySeparatedDeploymentID && (server.observerNodeID == "" || string(status.NodeInfo.ID()) != server.observerNodeID || status.NodeInfo.Network != server.manifest.ChainID || status.ValidatorInfo.VotingPower != 0 || status.SyncInfo.CatchingUp) {
		return nil, errors.New("pinned local non-voting observer unavailable or catching up")
	}
	network, err := client.NetInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("primary validator peers: %w", err)
	}
	commitHeight := status.SyncInfo.LatestBlockHeight - 1
	if commitHeight < 1 {
		return nil, errors.New("primary validator has no canonical commit yet")
	}
	commit, err := client.Commit(ctx, &commitHeight)
	if err != nil || !commit.CanonicalCommit || commit.Commit == nil {
		return nil, errors.New("primary validator did not return a canonical commit")
	}
	signed := map[string]bool{}
	commitSignatures := 0
	for _, signature := range commit.Commit.Signatures {
		if signature.BlockIDFlag == cmttypes.BlockIDFlagCommit {
			signed[strings.ToUpper(hex.EncodeToString(signature.ValidatorAddress))] = true
			commitSignatures++
		}
	}
	peers := map[string]bool{string(status.NodeInfo.ID()): true}
	for _, peer := range network.Peers {
		peers[string(peer.NodeInfo.ID())] = true
	}
	result := make([]NodeStatus, 0, len(server.manifest.Validators))
	for _, validator := range server.manifest.Validators {
		committed := signed[validator.ValidatorAddress]
		view := NodeStatus{
			Slot: validator.Slot, Moniker: validator.Moniker, Online: committed,
			NodeID: validator.NodeID, ValidatorAddress: validator.ValidatorAddress, VotingPower: 1,
			Height: commitHeight, BlockHash: strings.ToUpper(hex.EncodeToString(commit.Commit.BlockID.Hash)),
			AppHash:    strings.ToUpper(hex.EncodeToString(status.SyncInfo.LatestAppHash)),
			CatchingUp: status.SyncInfo.CatchingUp, CanonicalCommitHeight: commitHeight,
			CommitSignatures: commitSignatures,
			Observation:      "canonical commit signature observed via pinned local full replica",
		}
		if !peers[validator.NodeID] {
			view.Error = "node absent from local full replica live peer set"
		}
		if !committed {
			view.Error = fmt.Sprintf("validator signature absent from canonical commit %d", commitHeight)
		}
		result = append(result, view)
	}
	return result, nil
}

func (server *APIServer) nodeStatus(ctx context.Context, index int, client *rpchttp.HTTP) NodeStatus {
	manifest := server.manifest.Validators[index]
	view := NodeStatus{Slot: manifest.Slot, Moniker: manifest.Moniker}
	status, err := client.Status(ctx)
	if err != nil {
		view.Error = err.Error()
		return view
	}
	network, err := client.NetInfo(ctx)
	if err != nil {
		view.Error = err.Error()
		return view
	}
	view.Online = true
	view.NodeID = string(status.NodeInfo.ID())
	view.ValidatorAddress = strings.ToUpper(hex.EncodeToString(status.ValidatorInfo.Address))
	view.VotingPower = status.ValidatorInfo.VotingPower
	view.Peers = network.NPeers
	view.Height = status.SyncInfo.LatestBlockHeight
	view.BlockHash = strings.ToUpper(hex.EncodeToString(status.SyncInfo.LatestBlockHash))
	view.AppHash = strings.ToUpper(hex.EncodeToString(status.SyncInfo.LatestAppHash))
	view.CatchingUp = status.SyncInfo.CatchingUp
	commitHeight := view.Height - 1
	if commitHeight >= 1 {
		commit, commitErr := client.Commit(ctx, &commitHeight)
		if commitErr == nil && commit.CanonicalCommit && commit.Commit != nil {
			view.CanonicalCommitHeight = commitHeight
			for _, signature := range commit.Commit.Signatures {
				if signature.BlockIDFlag == cmttypes.BlockIDFlagCommit {
					view.CommitSignatures++
					if strings.EqualFold(hex.EncodeToString(signature.ValidatorAddress), view.ValidatorAddress) {
						view.ObservedSignature = true
					}
				}
			}
			// Describe what was actually examined.  The browser decides between
			// "signed" and "unknown" from this string, so leaving it empty here
			// made every local validator render as unknown/offline even though
			// this branch directly queried its own node and read its commit.
			switch {
			case view.ObservedSignature:
				view.Observation = "canonical commit signature observed via direct validator RPC"
			case view.CommitSignatures > 0:
				// The node answered and the commit exists, but this validator's
				// signature is not in it.  That is a real absence, not an unknown.
				view.Observation = "canonical commit evaluated; signature absent for this slot"
				view.Error = fmt.Sprintf("validator signature absent from canonical commit %d", commitHeight)
			default:
				view.Observation = "canonical commit evaluated; no signatures present"
			}
		} else {
			view.Observation = "node reachable; canonical commit unavailable"
		}
	} else {
		view.Observation = "node reachable; no canonical commit yet"
	}
	return view
}

func (server *APIServer) faucet(response http.ResponseWriter, request *http.Request) {
	if !server.legacyInterim {
		writeError(response, http.StatusGone, errors.New("interim note faucet is disabled; Friday bids require mint-backed custodial reservations"))
		return
	}
	var body struct {
		Actor string `json:"actor"`
	}
	if err := decodeBody(request, &body); err != nil || !validActor(body.Actor) {
		if err == nil {
			err = errors.New("actor must be a lowercase 32-byte Nostr public key")
		}
		writeError(response, http.StatusBadRequest, err)
		return
	}
	server.broadcast(response, request, Transaction{Version: TxVersion, Type: "faucet", Actor: body.Actor})
}

func (server *APIServer) event(response http.ResponseWriter, request *http.Request) {
	var event SignedEvent
	if err := decodeBody(request, &event); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	server.broadcast(response, request, Transaction{Version: TxVersion, Type: "event", Event: &event})
}

func (server *APIServer) closeAuction(response http.ResponseWriter, request *http.Request) {
	var body struct {
		AuctionID string `json:"auction_id"`
	}
	if err := decodeBody(request, &body); err != nil || !validIdentifier(body.AuctionID) {
		if err == nil {
			err = errors.New("invalid auction id")
		}
		writeError(response, http.StatusBadRequest, err)
		return
	}
	server.broadcast(response, request, Transaction{Version: TxVersion, Type: "close", AuctionID: body.AuctionID})
}

func (server *APIServer) broadcast(response http.ResponseWriter, request *http.Request, tx Transaction) {
	ctx, cancel := context.WithTimeout(request.Context(), 20*time.Second)
	defer cancel()
	if server.manifest.Schema == "PlebeianAuctionsPOCNetworkV4" && !server.browserRuntimeReady(ctx) {
		writeError(response, http.StatusServiceUnavailable, errors.New("new operations unavailable: runtime readiness required"))
		return
	}

	raw, err := EncodeTransaction(tx)
	if err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	client, err := server.firstHealthyClient(ctx)
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, err)
		return
	}
	result, err := client.BroadcastTxCommit(ctx, cmttypes.Tx(raw))
	if err != nil {
		// A deterministic application rejection must not be reported as a
		// transport failure.  CometBFT's BroadcastTxCommit surfaces a CheckTx
		// rejection as an error (RPCError code 22, with the CheckTx log) rather
		// than as a populated result, so the branch below never fires for the
		// commonest failure a user actually hits.  Classify only that explicit,
		// documented shape as 422; every other error stays a 503, because a
		// transport, RPC, timeout, cache or duplicate outcome is not proof of a
		// permanent application rejection.
		if rejected, ok := applicationRejectionLog(err); ok {
			writeError(response, http.StatusUnprocessableEntity, errors.New(rejected))
			return
		}
		// An unclassified broadcast error is an operator problem, not a user
		// problem: without the raw text there is nothing to diagnose from.
		log.Printf("unclassified broadcast error: %v", err)
		writeError(response, http.StatusServiceUnavailable, errors.New("consensus transaction outcome unavailable"))
		return
	}
	if result.CheckTx.Code != 0 {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("CheckTx rejected: %s", result.CheckTx.Log))
		return
	}
	if result.TxResult.Code != 0 {
		writeError(response, http.StatusUnprocessableEntity, fmt.Errorf("FinalizeBlock rejected: %s", result.TxResult.Log))
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"height": result.Height, "tx_hash": strings.ToUpper(hex.EncodeToString(result.Hash)), "check_code": result.CheckTx.Code, "deliver_code": result.TxResult.Code})
}

// applicationRejectionLog reports the CheckTx log when err is CometBFT's
// deterministic application rejection, and false for every transport-shaped
// error.  CometBFT returns RPCError code 22 ("Invalid Request", carrying the
// CheckTx log) when CheckTx refuses a transaction; a timeout, a refused
// connection or an ambiguous broadcast does not carry that code, so those stay
// 503 rather than being mislabelled as a permanent rejection.
func applicationRejectionLog(err error) (string, bool) {
	// The HTTP client returns *RPCError (a pointer) while other callers can
	// produce the value form, so both must classify.  A pointer target alone
	// would silently fail errors.As for a value error, which is exactly how the
	// original bug hid.
	var detail string
	var rpcErrPtr *jsonrpctypes.RPCError
	if errors.As(err, &rpcErrPtr) && rpcErrPtr != nil {
		detail = rpcErrPtr.Data
	} else {
		var rpcErrValue jsonrpctypes.RPCError
		if !errors.As(err, &rpcErrValue) {
			return "", false
		}
		detail = rpcErrValue.Data
	}
	if !strings.Contains(detail, applicationRejectionLogMarker) {
		return "", false
	}
	// Require an actual verdict after the marker.  A body that is only the
	// marker carries no application reason, so it is not proof of a rejection.
	verdict := strings.TrimSpace(detail[strings.Index(detail, applicationRejectionLogMarker)+len(applicationRejectionLogMarker):])
	if verdict == "" {
		return "", false
	}
	// Prefer the application's own log= field; fall back to the whole verdict so
	// the caller still sees a real reason rather than a generic transport error.
	if start := strings.Index(verdict, "log='"); start >= 0 {
		if end := strings.Index(verdict[start+len("log='"):], "'"); end >= 0 {
			if appLog := strings.TrimSpace(verdict[start+len("log='") : start+len("log='")+end]); appLog != "" {
				return appLog, true
			}
		}
	}
	return verdict, true
}

func (server *APIServer) firstHealthyClient(ctx context.Context) (*rpchttp.HTTP, error) {
	for _, client := range server.clients {
		if _, err := client.Status(ctx); err == nil {
			return client, nil
		}
	}
	return nil, errors.New("no CometBFT RPC node is reachable")
}

func (server *APIServer) offlineValidator(response http.ResponseWriter, request *http.Request) {
	if server.offline == nil {
		writeError(response, http.StatusForbidden, errors.New("offline control is disabled outside the loopback local-demo supervisor"))
		return
	}
	var body struct {
		Slot int `json:"slot"`
	}
	if err := decodeBody(request, &body); err != nil || body.Slot < 1 || body.Slot > 4 {
		if err == nil {
			err = errors.New("slot must be 1..4")
		}
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if err := server.offline(body.Slot); err != nil {
		writeError(response, http.StatusConflict, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"slot": body.Slot, "status": "stop_requested"})
}

func decodeBody(request *http.Request, target any) error {
	request.Body = http.MaxBytesReader(nil, request.Body, MaxTxBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return requireEOF(decoder)
}

// BroadcastOutcome is the commit result of one transaction, in the shape the
// relay observer needs and nothing more.  It is the transport-free projection of
// CometBFT's broadcast_tx_commit result that both the HTTP handler and the
// observer agree on.
type BroadcastOutcome struct {
	Height      int64
	CheckCode   uint32
	DeliverCode uint32
	TxHash      string
}

// BroadcastRawEvent submits an already-encoded transaction to the first healthy
// CometBFT node, exactly as POST /api/event does.  It exists so the relay
// observer reuses the same node selection and the same result interpretation as
// the HTTP path: one admission route, two transports.  It performs no
// application-level validation of its own; CheckTx does that.
func (server *APIServer) BroadcastRawEvent(ctx context.Context, raw []byte) (BroadcastOutcome, error) {
	client, err := server.firstHealthyClient(ctx)
	if err != nil {
		return BroadcastOutcome{}, err
	}
	result, err := client.BroadcastTxCommit(ctx, cmttypes.Tx(raw))
	if err != nil {
		if rejected, ok := applicationRejectionLog(err); ok {
			return BroadcastOutcome{}, fmt.Errorf("application rejected transaction: %s", rejected)
		}
		return BroadcastOutcome{}, fmt.Errorf("broadcast failed: %w", err)
	}
	return BroadcastOutcome{
		Height:      result.Height,
		CheckCode:   result.CheckTx.Code,
		DeliverCode: result.TxResult.Code,
		TxHash:      strings.ToUpper(hex.EncodeToString(result.Hash)),
	}, nil
}

func writeError(response http.ResponseWriter, status int, err error) {
	if err == nil {
		err = errors.New("unknown error")
	}
	writeJSON(response, status, map[string]any{"error": err.Error(), "status": status, "status_text": http.StatusText(status)})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func parseHeight(value string) (int64, error) {
	return strconv.ParseInt(value, 10, 64)
}
