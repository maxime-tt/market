const ui = window.PlebeianUI;
const state = {
  actor: "", signer: null, identityMode: "", config: null, releasePins: null, friday: null,
  view: null, wallet: null, validators: null, query: "", generation: 0,
  refreshPromise: null, maintenancePromise: null, actionKeys: new Set(), lastPresentation: "",
  readinessPromise: null, readinessNextAt: 0, readinessFailures: 0,
  maintenanceNextAt: 0, maintenanceFailures: 0, refreshStartedAt: 0,
  bidDrafts: new Map(), expiredPrelockBids: [], auctionPayoutAvailability: new Map(),
  refundAttempts: new Map(),
};
const byId = (id) => document.getElementById(id);
const short = (value) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
const exactInteger = (value, name, minimum = 1) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${name} must be a safe whole number of at least ${minimum}.`);
  return number;
};

// A request that never settles must not be able to wedge the page.  Without a
// deadline, a single stalled fetch leaves refresh() pending forever, and the
// four-second retry loop below keeps returning that same dead promise.
const API_TIMEOUT_MS = 15000;
async function api(path, options = {}) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    // signal is applied after ...options so a caller cannot silently disable it.
    const response = await fetch(path, { redirect: "error", credentials: "same-origin", ...options, signal: controller.signal,
      headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) } });
    const type = response.headers.get("content-type")?.split(";")[0];
    if (type !== "application/json") {
      // A non-JSON body means the reverse proxy answered instead of the app --
      // in practice a 502/504 while the demo is restarting. Report the status,
      // not a content type the reader cannot act on.
      throw new Error(response.status >= 500
        ? `${path} answered ${response.status}; the demo backend is unavailable or restarting.`
        : `${path} answered ${response.status} ${response.statusText || ""} with ${type || "no content type"}.`.trim());
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${path} did not answer within ${Math.round(API_TIMEOUT_MS / 1000)}s.`);
    throw error;
  } finally { clearTimeout(deadline); }
}
function message(text, tone = "info") { const target = byId("message"); target.textContent = text; target.dataset.tone = tone; }
function el(tag, className = "", content = "") { const node = document.createElement(tag); if (className) node.className = className; if (content) node.textContent = content; return node; }
function empty(title, detail) { const node = el("div", "empty-state"); node.append(el("strong", "", title), el("span", "", detail)); return node; }
function scope() { return ui.scopeKey(state.actor, state.releasePins?.deployment_id || ""); }
function r20Pins(config) { return {
  environmentId: config.deployment_id, authNetworkId: config.auth_network_id, chainId: config.chain_id,
  genesisSha256: config.genesis_sha256, canonicalMintUrl: config.cashu_mint_url,
  committeeKeysetId: config.committee_keyset_id, committeeKeysetVersion: config.committee_keyset_version,
  dkgRunId: config.dkg_run_id, committeePublicKey: config.committee_public_key,
  publicKeyPackageSha256: config.public_key_package_sha256, signerRosterDigest: config.signer_roster_digest,
  fakeFundingPolicyDigest: config.fake_funding_policy_digest,
}; }
function readinessNow() { return typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now(); }
function r20RuntimeReady(config = state.config) {
  return config?.threshold_custody === true && config.browser_threshold_wallet_ready === true
    && config.browser_threshold_admission_ready === true && config.recovery_only === false;
}
// A legacy loopback network (custodial reservations over faucet-issued notes)
// publishes funding_mode "custodial_reservation_v1".  It is a real, distinct
// funding model, not a threshold fallback, and it must never be allowed to
// masquerade as threshold custody.  Its controls stay open exactly when the
// server says that is the mode it serves.
function legacyFundingReady(config = state.config) {
  return config?.threshold_custody !== true && config?.recovery_only === false
    && config?.funding_mode === "custodial_reservation_v1";
}
function siteReady(config = state.config) { return r20RuntimeReady(config) || legacyFundingReady(config); }
// Mint-backed funding: the bidder holds real proofs and the mint is asked about
// them. Available independently of the threshold route, and only when the
// deployment actually serves it.
function mintBackedAvailable(config = state.config) { return config?.mint_backed_funding === true; }
// The mint the browser talks to is the same origin that serves this page, so
// there is no cross-origin exception and no second identity for one mint.
function browserMintUrl(config = state.config) {
  // The mint IDENTITY recorded in consensus state, which is the origin the
  // receipt is bound to. It must be an absolute origin a browser can reach, so
  // a relative path would be a different mint identity and the receipt would be
  // refused. Absolute first, and only fall back to a same-origin path if the
  // deployment publishes nothing better.
  if (config?.cashu_mint_url) return String(config.cashu_mint_url).replace(/\/+$/, "");
  return new URL(config?.browser_mint_path || "/api/mint", window.location.origin).toString().replace(/\/+$/, "");
}
function bidderWallet() {
  if (!window.PlebeianWallet) throw new Error("The wallet bundle did not load; reload the page.");
  if (!state.actor) throw new Error("Connect an identity first.");
  return new window.PlebeianWallet.BidderWallet(
    browserMintUrl(), window.PlebeianWallet.browserStorage(`plebeian-wallet:${state.actor}`));
}
async function renderWalletBalance() {
  const output = byId("wallet-balance");
  if (!output) return;
  if (!state.actor || !window.PlebeianWallet) { output.textContent = "No wallet yet."; return; }
  try {
    const wallet = bidderWallet();
    const locked = wallet.lockedBalance();
    const until = wallet.lockedUntil();
    const when = locked > 0 && until > Math.floor(Date.now() / 1000)
      ? `\nLocked proofs are reclaimable from ${new Date(until * 1000).toLocaleTimeString()}; until then the committee can spend them and this wallet cannot.`
      : "";
    output.textContent = `Wallet holds ${wallet.balance()} spendable and ${locked} locked (bidder-held proofs).${when}`;
  } catch (error) { output.textContent = error.message; }
}
// Whether this identity can actually place a bid.  The threshold mode needs the
// browser wallet controller; the legacy mode needs only a connected identity,
// because its funds and reservations are server-side.  Gating the bid button on
// the threshold controller alone left it permanently disabled on a legacy
// network that funds bids perfectly well.
function bidReady() {
  return legacyFundingReady() ? Boolean(state.actor && state.signer) : Boolean(state.friday && r20RuntimeReady());
}
function invalidateReadinessIdentity() {
  state.generation += 1;
  // Retire the controller without discarding a tab-local private identity.
  state.actor = ""; state.friday = null; state.wallet = null; state.expiredPrelockBids = [];
  state.maintenanceNextAt = 0; state.maintenanceFailures = 0;
  byId("actor").textContent = "Disconnected";
}
function readinessIdentityError() {
  const error = new Error("The independently pinned release identity changed or could not be verified. Reconnect after configuration is restored.");
  error.identityFault = true; return error;
}
function validateReadinessPins(pins) {
  if (!pins || pins.schema !== "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1") throw readinessIdentityError();
  const values = r20Pins(pins), id = /^[A-Za-z0-9_-]{1,160}$/, hash = /^[0-9a-f]{64}$/;
  for (const key of ["environmentId", "authNetworkId", "chainId", "committeeKeysetId", "committeeKeysetVersion", "dkgRunId"]) {
    if (typeof values[key] !== "string" || !id.test(values[key])) throw readinessIdentityError();
  }
  for (const key of ["genesisSha256", "publicKeyPackageSha256", "signerRosterDigest", "fakeFundingPolicyDigest"]) {
    if (typeof values[key] !== "string" || !hash.test(values[key])) throw readinessIdentityError();
  }
  if (typeof values.committeePublicKey !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(values.committeePublicKey)
    || typeof values.canonicalMintUrl !== "string" || !/^https:\/\/[^/?#@]+$/.test(values.canonicalMintUrl)) throw readinessIdentityError();
  return pins;
}
async function refreshReadiness() {
  if (state.readinessPromise) return state.readinessPromise;
  const now = readinessNow();
  if (now < state.readinessNextAt) return siteReady();
  state.readinessPromise = (async () => {
    const abort = new AbortController(); let timer;
    const wasReady = siteReady();
    try {
      // The pins endpoint answers 503 on any network that does not serve the
      // threshold browser wallet, so it must not be able to fail the whole
      // readiness check.  Fetch it tolerantly and decide from the mode below.
      const [config, pins] = await Promise.race([
        Promise.all([
          api("/api/config", { signal: abort.signal }),
          api("/api/browser-release-pins", { signal: abort.signal }).catch(() => null),
        ]),
        new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error("Runtime readiness check timed out.")); }, 8000); }),
      ]);
      // A legacy loopback network has no threshold browser wallet, therefore no
      // release pins to compare: its identity is the chain and funding mode it
      // publishes.  Requiring pins here disabled every control on a network that
      // works, which is exactly the failure this mode distinction removes.
      if (!legacyFundingReady(config)) {
        validateReadinessPins(pins);
        const runtimePins = r20Pins({ ...config, fake_funding_policy_digest: config?.fake_funding_policy?.digest });
        if (JSON.stringify(runtimePins) !== JSON.stringify(r20Pins(pins))) throw readinessIdentityError();
      }
      const identityChanged = state.releasePins && JSON.stringify(r20Pins(state.releasePins)) !== JSON.stringify(r20Pins(pins));
      const ready = siteReady(config);
      if (identityChanged) invalidateReadinessIdentity();
      else if (wasReady && !ready) state.maintenanceNextAt = 0;
      state.config = config; state.releasePins = legacyFundingReady(config) ? null : pins;
      // Valid false can be backend warmup, not a transport failure. Keep two
      // observations inside its continuity window, even after slow collection.
      // Start-based spacing caps request rate without adding response latency.
      state.readinessFailures = 0;
      state.readinessNextAt = now + 4000;
      updateControls();
      if (wasReady && !ready) message("New operations paused while runtime dependencies recover. Existing payment imports retain their normal safety checks.", "warning");
      else if (!wasReady && ready) message("Runtime ready. Connect an identity or continue.", "success");
      return ready;
    } catch (error) {
      if (error.identityFault) invalidateReadinessIdentity();
      else if (wasReady) state.maintenanceNextAt = 0;
      state.config = { ...state.config, browser_threshold_wallet_ready: false, browser_threshold_admission_ready: false };
      state.readinessFailures = Math.min(state.readinessFailures + 1, 4);
      state.readinessNextAt = readinessNow() + Math.min(30000, 4000 * 2 ** (state.readinessFailures - 1));
      updateControls(); message(error.message, "warning"); return false;
    } finally { clearTimeout(timer); abort.abort(); }
  })().finally(() => { state.readinessPromise = null; });
  return state.readinessPromise;
}

function requireR20Ready() {
  if (!r20RuntimeReady() || !state.releasePins) throw new Error("The reviewed R20 browser wallet and admission path is not active. Refresh or retry after runtime recovery.");
}
function requireSiteReady() {
  // Called before the actor is assigned, so it must not depend on state.actor.
  // A legacy network is ready on its published funding mode alone.
  if (legacyFundingReady()) return;
  requireR20Ready();
}

async function connectFridayController(signer) {
  await refreshReadiness(); requireR20Ready();
  if (!window.plebeianFridayR20Connect) throw new Error("The reviewed R20 browser connector did not load.");
  if (!state.releasePins) throw new Error("The independently release-pinned R20 manifest is unavailable.");
  return window.plebeianFridayR20Connect({ signer, pins: r20Pins(state.releasePins) });
}
async function installSigner(signer, mode) {
  await refreshReadiness(); requireSiteReady();
  disconnect();
  // disconnect() bumps state.generation, so the generation must be captured
  // AFTER it.  Capturing before made the guard below always true and the
  // function returned before ever assigning the actor, so connecting silently
  // did nothing.
  const generation = state.generation;
  const actor = await signer.getPublicKey();
  // NIP-07 getPublicKey is an explicit permission boundary in common browser
  // extensions. Consent once for this connected session instead of prompting
  // again on every four-second wallet refresh. Every signed event still goes
  // to the extension and the browser controller verifies its exact actor and
  // immutable fields, so an account change remains fail-closed on mutation.
  const sessionSigner = Object.freeze({
    getPublicKey: async () => actor,
    signEvent: (event) => signer.signEvent(event),
  });
  // A legacy network has no browser Coco wallet or admission service, so there
  // is nothing to connect.  pretend otherwise would fake a controller.
  const friday = r20RuntimeReady() ? await connectFridayController(sessionSigner) : null;
  if (generation !== state.generation) return;
  state.actor = actor; state.signer = sessionSigner; state.identityMode = mode; state.friday = friday; state.wallet = null;
  byId("actor").textContent = `${mode} · ${short(actor)}`;
  const pending = friday ? await friday.pendingFakeFunding() : [];
  if (generation !== state.generation) return;
  if (pending) {
    byId("faucet-amount").value = String(pending.amount);
    message(`Recovered unresolved funding ${short(pending.operationId)}. Retry only its original ${ui.formatSats(pending.amount)} fake sats.`, "warning");
  }
  updateControls();
  await refresh();
}
async function connect() {
  if (!window.nostr?.getPublicKey || !window.nostr?.signEvent) throw new Error("A NIP-07 signer is required; this site never requests its private key.");
  await installSigner(window.nostr, "NIP-07");
}
async function connectDemo() {
  if (!window.plebeianCreateDemoSigner) throw new Error("The disposable demo signer did not load.");
  const retained = !state.friday && !state.actor && state.identityMode === "tab-local demo signer" ? state.signer : null;
  await installSigner(retained || window.plebeianCreateDemoSigner(), "tab-local demo signer");
  message(retained ? "Reconnected this tab's existing demo identity. Reloading still loses its key."
    : "Created a fresh tab-local Nostr identity. Reloading loses this demo key; use NIP-07 for durable identity.", "warning");
}
function disconnect() {
  state.generation += 1;
  state.bidDrafts.clear(); state.auctionPayoutAvailability.clear();
  state.actor = ""; state.signer = null; state.friday = null; state.wallet = null; state.identityMode = ""; state.expiredPrelockBids = [];
  state.maintenanceNextAt = 0; state.maintenanceFailures = 0;
  byId("actor").textContent = "Disconnected"; updateControls();
}

async function sign(kind, tags, content) {
  if (!state.actor || !state.signer) throw new Error("Connect a Nostr signer first.");
  return state.signer.signEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content: JSON.stringify(content) });
}
function updateControls() {
  const legacyReady = legacyFundingReady();
  const thresholdReady = Boolean(state.releasePins && r20RuntimeReady());
  const connectReady = thresholdReady || legacyReady;
  // Threshold needs the browser wallet controller; the legacy mode needs only a
  // connected identity, because its funds and reservations are server-side.
  const ready = Boolean(state.actor && (state.friday || legacyReady) && connectReady);
  byId("login").disabled = !connectReady;
  byId("demo-login").disabled = !connectReady;
  byId("faucet").disabled = !ready;
  byId("process-payments").disabled = !thresholdReady;
  byId("disconnect").disabled = !state.signer;
  byId("create-submit").disabled = !ready;
  // Minting needs a connected identity and a deployment that actually serves a
  // mint this browser can reach.
  byId("wallet-mint").disabled = !(ready && mintBackedAvailable());
  // Only meaningful when something is actually locked, and it is the escape
  // hatch a failed bid otherwise leaves the bidder without.
  try { byId("wallet-release").disabled = !ready || bidderWallet().lockedBalance() <= 0; }
  catch { byId("wallet-release").disabled = true; }
  const fundingSelect = byId("funding-mode");
  if (fundingSelect && !mintBackedAvailable()) {
    fundingSelect.value = "custodial_reservation_v1";
    [...fundingSelect.options].forEach((option) => { if (option.value === "cashu_lock_v1") option.disabled = true; });
  }
  const policy = state.config?.fake_funding_policy;
  if (policy) {
    byId("faucet-amount").max = String(policy.max_per_request);
    byId("faucet-help").textContent = `Per request: 1–${ui.formatSats(policy.max_per_request)}. Browser-wallet advisory resulting balance: ${ui.formatSats(policy.max_resulting_balance)}. Mint-wide and ingress controls are separate.`;
  }
}

async function runMaintenance(capturedScope, { force = false } = {}) {
  if (!state.friday || !capturedScope) return { refunds: 0, winnerPayments: 0 };
  if (state.maintenancePromise) {
    const prior = await state.maintenancePromise;
    if (!force) return prior;
  }
  const now = readinessNow();
  if (!force && now < state.maintenanceNextAt) return { refunds: 0, winnerPayments: 0 };
  const controller = state.friday;
  state.maintenancePromise = (async () => {
    try {
      const imported = await controller.importAvailable();
      if (capturedScope !== scope()) throw new Error("Signer or deployment changed during wallet maintenance.");
      state.maintenanceFailures = 0;
      state.maintenanceNextAt = readinessNow() + 15000;
      if (imported.refunds || imported.winnerPayments) {
        message(`Imported ${imported.refunds} certified outbid return(s) and ${imported.winnerPayments} seller payout(s).`, "success");
      }
      return imported;
    } catch (error) {
      state.maintenanceFailures = Math.min(state.maintenanceFailures + 1, 4);
      state.maintenanceNextAt = readinessNow() + Math.min(120000, 15000 * 2 ** (state.maintenanceFailures - 1));
      if (force) throw error;
      return { refunds: 0, winnerPayments: 0 };
    }
  })().finally(() => { state.maintenancePromise = null; });
  return state.maintenancePromise;
}
async function runExclusiveMaintenance(capturedScope, operation) {
  while (state.maintenancePromise) {
    await state.maintenancePromise.catch(() => undefined);
  }
  if (capturedScope !== scope()) throw new Error("Signer or deployment changed before wallet maintenance.");
  const controller = state.friday;
  if (!controller) throw new Error("Connect a signer first.");
  state.maintenancePromise = (async () => operation(controller))()
    .finally(() => { state.maintenancePromise = null; });
  return state.maintenancePromise;
}
// Claims every displaced bid this browser still holds proofs for. The
// coordinator swaps the locked proofs back to this wallet's own spend key and
// returns fresh ones, which the wallet imports. The signed KindRefund event is
// the authorization for that request and the wallet spend-key signature proves
// ownership of the returned value; the event is deliberately NOT posted to
// /api/event, where a legacy refund of a mint-backed bid is refused.
async function claimRefunds({ manual = false } = {}) {
  if (!state.actor || !state.signer || !mintBackedAvailable()) return { claimed: 0, amount: 0 };
  const wallet = bidderWallet();
  const bids = Object.values(state.view?.state?.bids || {});
  const locks = state.view?.state?.locks || {};
  let claimed = 0, amount = 0;
  for (const bid of bids) {
    if (bid.bidder !== state.actor) continue;
    const lock = locks[bid.id];
    if (!lock || lock.status !== "refundable") continue;
    if (!wallet.lockedForBid(bid.id).length) continue;
    const last = state.refundAttempts.get(bid.id) || 0;
    if (!manual && Date.now() - last < 15000) continue;
    state.refundAttempts.set(bid.id, Date.now());
    try {
      const event = await sign(28642, [["e", bid.auction_id]], { bid_id: bid.id });
      const result = await wallet.refundBid(bid.id, event);
      claimed += 1; amount += result.amount;
      state.refundAttempts.delete(bid.id);
    } catch (error) {
      // A transient mint or coordinator failure is retried on a later refresh;
      // a manual attempt always reports why it failed.
      if (manual) message(`Refund for ${short(bid.id)} failed: ${error.message}`, "warning");
    }
  }
  if (claimed) {
    message(`Claimed ${claimed} outbid refund(s): ${amount} sats returned to this wallet.`, "success");
    await renderWalletBalance();
  }
  return { claimed, amount };
}

async function refresh() {
  if (state.refreshPromise) {
    // Retry only once the pending attempt has had longer than its own deadline
    // to finish.  Returning a stuck promise forever is what turned one slow
    // request into a permanently dead page.
    if (readinessNow() - (state.refreshStartedAt || 0) < API_TIMEOUT_MS + 5000) return state.refreshPromise;
    state.refreshPromise = null;
  }
  state.refreshStartedAt = readinessNow();
  const generation = state.generation, capturedScope = scope();
  state.refreshPromise = (async () => {
    await refreshReadiness();
    const suffix = state.actor ? `?actor=${encodeURIComponent(state.actor)}` : "";
    const [view, validators] = await Promise.all([api(`/api/state${suffix}`), api("/api/validators")]);
    if (generation !== state.generation || capturedScope !== scope()) return;
    state.view = view; state.validators = validators;
    if (state.actor && state.friday) {
      const controller = state.friday;
      const currentActor = await controller.actor();
      if (generation !== state.generation || controller !== state.friday) return;
      if (currentActor !== state.actor) { disconnect(); message("Signer account changed. Reconnect before continuing.", "warning"); render(); return; }
      await runMaintenance(capturedScope);
      if (!state.maintenancePromise) {
        const balance = await runExclusiveMaintenance(capturedScope, (held) => held.balance());
        if (generation !== state.generation || capturedScope !== scope()) return;
        state.wallet = balance;
      }
      const ownedOpenAuctions = Object.values(state.view?.state?.auctions || {})
        .filter((auction) => auction.status === "open" && auction.seller === state.actor);
      const retained = new Set(ownedOpenAuctions.map((auction) => auction.id));
      for (const id of state.auctionPayoutAvailability.keys()) {
        if (!retained.has(id)) state.auctionPayoutAvailability.delete(id);
      }
      await Promise.all(ownedOpenAuctions.map(async (auction) => {
        if (state.auctionPayoutAvailability.get(auction.id) === "ready") return;
        try {
          const payout = await controller.readAuctionPayout(auction.id);
          if (generation !== state.generation || controller !== state.friday) return;
          state.auctionPayoutAvailability.set(auction.id, payout === null ? "missing" : "ready");
        } catch {
          if (generation === state.generation && controller === state.friday) state.auctionPayoutAvailability.set(auction.id, "unknown");
        }
      }));
    } else state.wallet = null;
    // A displaced bidder's browser claims its own refund automatically. This
    // runs after committed state is read, so it only acts on a lock consensus
    // has actually marked refundable.
    if (state.actor && state.signer && mintBackedAvailable()) {
      await claimRefunds();
      if (generation !== state.generation || capturedScope !== scope()) return;
    }
    render();
  })().catch((error) => { message(error.message, "error"); throw error; }).finally(() => { state.refreshPromise = null; });
  return state.refreshPromise;
}

async function refreshCommittedAuction(auctionId, minimumHeight, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (state.refreshPromise) await state.refreshPromise.catch(() => undefined);
    await refresh();
    const height = Number(state.view?.state?.height);
    const auction = state.view?.state?.auctions?.[auctionId];
    if (Number.isSafeInteger(height) && height >= minimumHeight && auction) return auction;
  }
  return null;
}

function renderWallet() {
  const wallet = state.wallet, target = byId("notes"); target.replaceChildren();
  byId("spendable").textContent = wallet ? ui.formatSats(wallet.available) : "—";
  // "locked" here is an attestation, not a deduction: the underlying ledger note
  // stays spendable, so showing both as independent totals double-counts the
  // same value. Say so rather than implying a hold.
  byId("locked").textContent = wallet ? `${ui.formatSats(wallet.reserved + wallet.locked)} (attested)` : "—";
  byId("refundable").textContent = wallet ? ui.formatSats(wallet.pending + wallet.unresolved) : "—";
  if (!wallet) { target.append(empty("Connect an identity", "The threshold wallet remains fail-closed until an exact signer and release are connected.")); return; }
  const card = el("div", "note");
  card.append(el("strong", "", `${ui.formatSats(wallet.available)} spendable fake sats`),
    el("small", "", `${ui.formatSats(wallet.reserved)} reserved · ${ui.formatSats(wallet.locked)} locked`),
    el("small", "", `${ui.formatSats(wallet.pending)} pending · ${ui.formatSats(wallet.unresolved)} unresolved`),
    el("small", "receipt", `Actor ${short(state.actor)} · ${state.identityMode}`));
  target.append(card);
  const review = el("button", "button button-secondary", "Review expired bid intents");
  review.type = "button"; review.disabled = !state.friday || state.actionKeys.has("review-expired-prelock");
  review.onclick = () => performAction("review-expired-prelock", review, "Checking…", async () => {
    requireR20Ready();
    const controller = state.friday, captured = scope();
    if (!controller) throw new Error("Connect a signer first.");
    const pending = await runExclusiveMaintenance(captured, (held) => held.expiredPrelockPending());
    if (controller !== state.friday || captured !== scope()) throw new Error("Signer or deployment changed during recovery review.");
    state.expiredPrelockBids = pending; renderWallet();
    message(pending.length ? `${pending.length} expired pre-lock bid intent(s) need review.` : "No expired pre-lock bid intents were found.", pending.length ? "warning" : "success");
  }).catch(() => undefined);
  target.append(review);
  for (const pending of state.expiredPrelockBids) {
    const recovery = el("div", "note");
    recovery.append(el("strong", "", `Expired bid intent · ${ui.formatSats(pending.bidAmount)}`),
      el("small", "", `Auction ${pending.auctionId} · expired ${ui.formatTime(pending.expiresAt)}`),
      el("small", "receipt", `Operation ${pending.fundingOperationId}`));
    const discard = el("button", "button button-secondary", "Discard pre-lock intent"); discard.type = "button";
    discard.onclick = () => performAction(`discard-prelock:${pending.fundingOperationId}`, discard, "Verifying…", async () => {
      if (!window.confirm(`Discard expired pre-lock intent ${pending.fundingOperationId} for auction ${pending.auctionId}? This is allowed only if no seller plan, payment lock or cancellation journal exists.`)) return;
      requireR20Ready(); const controller = state.friday, captured = scope();
      if (!controller) throw new Error("Connect a signer first.");
      const result = await runExclusiveMaintenance(captured, (held) => held.discardExpiredPrelockPending(pending.fundingOperationId));
      if (controller !== state.friday || captured !== scope()) throw new Error("Signer or deployment changed during expired intent recovery.");
      state.expiredPrelockBids = state.expiredPrelockBids.filter((entry) => entry.fundingOperationId !== result.fundingOperationId);
      message(`Discarded expired pre-lock intent ${short(result.fundingOperationId)}. The next bid will use a new operation.`, "success");
      await refresh();
    }).catch(() => undefined);
    recovery.append(discard, el("small", "fine-print", "This never cancels a locked bid. If private payment or abort state exists, recovery stops and preserves the operation."));
    target.append(recovery);
  }
}
function participantStatus(auction) {
  // A settled auction has an outcome to report whether or not this visitor is
  // connected.  Telling a passer-by to "connect to participate" on a closed
  // auction hides the one thing the page exists to show.
  if (auction.status !== "open") {
    if (auction.seller === state.actor && auction.winner) return { tone: "leading", title: "Seller payout eligible", detail: "Import the certified winner payment into your Coco key." };
    if (auction.winner && auction.winner === state.actor) return { tone: "leading", title: "You won", detail: "Consensus selected this identity. The seller receives the winning amount." };
    return auction.winner
      ? { tone: "leading", title: "Sold", detail: `Winning bid ${ui.formatSats(auction.high_bid)} fake sats.` }
      : { tone: "refund", title: "Closed without a sale", detail: auction.high_bid ? "Reserve not met; the bid returns to the bidder." : "No bids were placed." };
  }
  if (!state.actor) return { tone: "", title: "Connect to participate", detail: legacyFundingReady() ? "A Nostr identity is required to bid." : "A Nostr identity and browser-owned Coco wallet are required." };
  if (auction.seller === state.actor) {
    const payout = state.auctionPayoutAvailability.get(auction.id);
    if (payout === "missing") return { tone: "refund", title: "Offline bidding setup incomplete", detail: "Complete the one-time auction-scoped payout setup; no per-bid seller approval is used." };
    if (payout === "ready") return { tone: "", title: "You are the seller", detail: "The auction-scoped payout authorization lets bidders bid while you are offline." };
    return { tone: "", title: "You are the seller", detail: "Checking the auction-scoped offline bidding authorization." };
  }
  const bids = Object.values(state.view?.state?.bids || {}).filter((bid) => bid.auction_id === auction.id && bid.bidder === state.actor).sort((a,b) => b.committed_at-a.committed_at);
  const latest = bids[0], leading = auction.leader_bid_id && state.view?.state?.bids?.[auction.leader_bid_id]?.bidder === state.actor;
  if (auction.status === "closed" && auction.winner === state.actor) return { tone: "leading", title: "You won", detail: "Consensus selected this identity. The seller receives the winning amount." };
  if (latest && leading && auction.status === "open") return {
    tone: "leading", title: "You are leading",
    detail: legacyFundingReady()
      ? `${ui.formatSats(auction.high_bid)} fake sats are attested by the demo coordinator; this is not a mint-enforced hold.`
      : `${ui.formatSats(auction.high_bid)} fake sats remain in the exact funded pool.`,
  };
  if (latest && !leading) return { tone: "refund", title: "Outbid return pending or imported", detail: "Automatic import rechecks the certified terminal return on refresh." };
  return legacyFundingReady()
    ? { tone: "", title: "Ready to bid", detail: "The bid is attested by the demo coordinator. No real value is locked; this is not a mint-enforced hold." }
    : { tone: "", title: "Ready to bid", detail: "The next bid uses a fresh exact threshold-funded pool." };
}
function renderAuctions() {
  const target = byId("auctions"), all = Object.values(state.view?.state?.auctions || {}).sort((a,b) => b.created_at-a.created_at);
  const active = document.activeElement, focusedBid = active?.dataset?.auctionBidId ? {
    auctionId: active.dataset.auctionBidId,
    start: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
    end: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
    direction: active.selectionDirection || "none",
  } : null;
  let restoreBidFocus = null;
  const draftPrefix = `${scope()}\u0000`;
  const openIds = new Set(all.filter((auction) => auction.status === "open").map((auction) => auction.id));
  for (const key of state.bidDrafts.keys()) {
    if (key.startsWith(draftPrefix) && !openIds.has(key.slice(draftPrefix.length))) state.bidDrafts.delete(key);
  }
  const auctions = ui.filterAuctions(all, state.query); target.replaceChildren(); target.setAttribute("aria-busy", "false");
  byId("market-meta").textContent = `${auctions.length} of ${all.length} committed auction(s) · app height ${state.view?.state?.height ?? "—"}`;
  if (!auctions.length) { target.append(empty("No matching auctions", state.query ? "Clear the search to view all committed auctions." : "Create the first signed auction.")); return; }
  for (const auction of auctions) {
    const card = el("article", "auction"), status = participantStatus(auction), timer = ui.countdown(Number(auction.end_time));
    card.append(el("p", "eyebrow", auction.status.toUpperCase()), el("h3", "", auction.title), el("p", "section-subtitle", `Seller ${short(auction.seller)} · ${timer.label}`));
    const imageSource = ui.imageURL(auction.image_url);
    if (imageSource.ok && imageSource.url) { const image = document.createElement("img"); image.className="auction-image"; image.src=imageSource.url; image.alt="Auction item"; image.loading="lazy"; image.decoding="async"; image.referrerPolicy="no-referrer"; card.append(image); }
    if (auction.description) card.append(el("p", "", auction.description));
    const list = el("dl");
    [["High bid", ui.formatSats(Number(auction.high_bid))],["Increment",ui.formatSats(Number(auction.min_increment))],["Reserve",auction.reserve ? ui.formatSats(Number(auction.reserve)) : "None"],["Ends",ui.formatTime(Number(auction.end_time))],["Extension",`${Math.max(0,Number(auction.end_time)-Number(auction.original_end_time))}s`],["Winner",short(auction.winner)]].forEach(([key,value]) => list.append(el("dt","",key),el("dd","",String(value))));
    card.append(list, el("div", `status-card ${status.tone}`, "")); card.lastChild.append(el("strong","",status.title),el("small","",status.detail));
    const actions = el("div", "actions");
    if (auction.status === "open" && state.actor && auction.seller !== state.actor) {
      const minimum = ui.minimumBid(auction), label = document.createElement("label"), input = document.createElement("input");
      const draftKey = `${scope()}\u0000${auction.id}`;
      label.append(el("span","field-help","Bid amount")); input.type="text"; input.pattern="[0-9]*"; input.autocomplete="off"; input.spellcheck=false; input.inputMode="numeric"; input.dataset.auctionBidId=auction.id; input.value=state.bidDrafts.get(draftKey) || ""; label.append(input);
      const validate = () => { const parsed = ui.bidAmount(input.value, minimum); state.bidDrafts.set(draftKey, input.value); input.setCustomValidity?.(parsed.ok ? "" : parsed.reason); input.setAttribute("aria-invalid", String(input.value !== "" && !parsed.ok)); };
      input.oninput=validate; validate();
      const button = el("button","button button-primary","Authorize funded bid"); button.type="button"; button.disabled = minimum === null || !bidReady(); button.onclick=()=>performAction(`bid:${auction.id}`,button,"Authorizing…",async()=>{const parsed=ui.bidAmount(input.value,minimum);if(!parsed.ok)throw new Error(parsed.reason);await placeBid(auction.id,parsed.amount);state.bidDrafts.delete(draftKey);});
      if (focusedBid?.auctionId === auction.id) restoreBidFocus = input;
      actions.append(label,button);
    }
    if (auction.status === "open"
      && Number(auction.end_time) <= Number(state.view?.state?.last_consensus_time || 0)) {
      const close = el("button", "button button-secondary", "Close auction");
      close.type = "button";
      close.onclick = () => performAction(`close:${auction.id}`, close, "Closing…", async () => {
        const result = await api("/api/close", { method: "POST", body: JSON.stringify({ auction_id: auction.id }) });
        message(`Auction closed at height ${result.height}.`, "success");
        await refresh();
      }).catch(() => undefined);
      actions.append(close);
    }
    if (auction.status === "open" && auction.seller === state.actor
      && state.auctionPayoutAvailability.get(auction.id) === "missing") {
      const setup = el("button", "button button-secondary", "Complete offline bidding setup");
      setup.type = "button";
      setup.onclick = () => performAction(`auction-payout:${auction.id}`, setup, "Authorizing…", async () => {
        await authorizeCommittedAuctionPayout(auction);
        message(`Offline bidding is ready for auction ${auction.id}; bidders no longer need this seller tab.`, "success");
        renderAuctions();
        await refresh();
      }).catch(() => undefined);
      actions.append(setup);
    }
    if (auction.status === "open") actions.append(el("small","fine-print",timer.ended ? "Awaiting the R20 deterministic close trigger and committed closed state." : "Consensus time controls anti-sniping extension and close eligibility."));
    card.append(actions); target.append(card);
  }
  if (restoreBidFocus) {
    restoreBidFocus.focus?.({ preventScroll: true });
    if (focusedBid.start !== null && focusedBid.end !== null && typeof restoreBidFocus.setSelectionRange === "function") {
      const length = restoreBidFocus.value.length;
      restoreBidFocus.setSelectionRange(Math.min(focusedBid.start, length), Math.min(focusedBid.end, length), focusedBid.direction);
    }
  }
}
function renderValidators() {
  const target=byId("validators"), validators=state.validators?.validators || []; target.replaceChildren(); target.setAttribute("aria-busy","false");
  const heights=validators.map((v)=>v.canonical_commit_height).filter(Number.isSafeInteger);
  byId("validator-summary").textContent = `${validators.filter((v)=>v.online).length}/4 signatures observed · canonical commit ${heights.length ? Math.max(...heights) : "—"}`;
  for (const validator of validators) { const evidence=ui.validatorEvidence(validator), card=el("article",`validator ${evidence.state==='observed'?"online":"offline"}`), heading=el("strong"); heading.append(document.createTextNode(`V${validator.slot}`),el("i","dot")); card.append(heading,el("span","",evidence.label),el("small","",evidence.detail),el("small","",`node ${short(validator.node_id)}`),el("small","",`app ${short(validator.app_hash)}`)); target.append(card); }
}
function render() { updateControls(); renderWallet(); renderAuctions(); renderValidators(); renderWalletBalance().catch(()=>undefined); }

async function performAction(key, button, pendingLabel, action) {
  if (state.actionKeys.has(key)) return;
  state.actionKeys.add(key); const prior=button?.textContent; if(button){button.disabled=true;button.textContent=pendingLabel;}
  try { return await action(); } catch(error) { message(error.message,"error"); throw error; }
  finally { state.actionKeys.delete(key); if(button){button.textContent=prior;updateControls();} }
}
async function placeBid(auctionId, amount) {
  const legacy = legacyFundingReady();
  if (!legacy) { requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first."); }
  else if (!state.actor || !state.signer) throw new Error("Connect a signer first.");
  const auction=state.view?.state?.auctions?.[auctionId]; if(!auction||auction.status!=="open") throw new Error("Auction is not open in committed state.");
  const leader=auction.leader_bid_id?state.view?.state?.bids?.[auction.leader_bid_id]:null;
  // A mint-backed raise is a fresh lock of fresh proofs, not a replacement of a
  // prior reservation, so the own-raise restriction does not apply to it.
  if(auction.funding_mode!=="cashu_lock_v1" && leader?.bidder===state.actor) throw new Error("Own raises remain fail-closed until full-pool key continuity is proven.");
  if (legacy && auction.funding_mode === "cashu_lock_v1") {
    // The bidder locks their OWN proofs to the committee, keeps them, and sends
    // only references. The coordinator cannot invent value here: it confirms the
    // references with the mint before it signs anything.
    const wallet = bidderWallet();
    // The lock must outlive every reachable auction end. Anti-sniping extensions
    // can push the end to original_end + max_total_extension, and consensus
    // requires the lock to add emergency_recovery on top (model.go:1318), so the
    // margin comes from /api/config rather than a hardcoded constant. A short
    // lock lets an extension outlive it, the bidder reclaims, and the leading
    // bid loses its backing.
    const maxTotalExtension = Number(state.config?.max_total_extension_seconds);
    const emergencyRecovery = Number(state.config?.emergency_recovery_seconds);
    if (!Number.isSafeInteger(maxTotalExtension) || !Number.isSafeInteger(emergencyRecovery) || maxTotalExtension < 0 || emergencyRecovery < 0) {
      throw new Error("The coordinator did not publish the locktime policy (max_total_extension_seconds, emergency_recovery_seconds); refusing to lock with a guessed margin.");
    }
    const locktime = Number(auction.original_end_time) + maxTotalExtension + emergencyRecovery;
    // The refund key is the wallet's own spend key, not the Nostr identity: the
    // Nostr key authorizes, the wallet owns value, and a NIP-07 signer cannot
    // produce a Cashu signature. The lock names a key this wallet can spend.
    const funding = await wallet.lockForBid(amount, state.config.committee_public_key, locktime, (step)=>message(step));
    const receipt = await api("/api/demo/mint-lock", { method: "POST", body: JSON.stringify({
      auction_id: auctionId, bidder: state.actor, amount, locktime,
      refund_public_key: funding.refundPublicKey, token_sha256: funding.tokenSha256,
      proof_state_refs: funding.proofStateRefs, proofs: funding.proofs }) });
    const signed = await sign(28641, [["e", auctionId]], { auction_id: auctionId, amount, cashu_lock: receipt });
    const result = await api("/api/event", { method: "POST", body: JSON.stringify(signed) });
    // Bind the proofs this browser just locked to the committed bid id, so a
    // later displacement can hand exactly this set to the refund endpoint.
    wallet.recordLockedBid(signed.id, funding.lockedProofs, funding.spendPublicKey);
    message(`Bid committed at height ${result.height} (mint-backed lock, proofs held by this browser).`, "success");
    await refresh(); await renderWalletBalance(); return;
  }
  if (legacy) {
    // Legacy mode: ask the demo coordinator for a committee-signed custodial
    // reservation receipt, then commit the signed bid carrying it.  This is the
    // same funding path the automated journey exercises end to end.
    // A replacement may only be declared when this same bidder is replacing
    // their OWN reservation (model.go:1168-1177 requires an exact match, and ""
    // for a cross-bidder outbid).  Sending the leader's reservation here made
    // every outbid of somebody else's bid fail.
    const replaces = leader && leader.bidder === state.actor ? (leader.reservation_id || "") : "";
    const receipt = await api("/api/demo/reservation", { method: "POST", body: JSON.stringify({ auction_id: auctionId, bidder: state.actor, amount, replaces_reservation_id: replaces }) });
    const signed = await sign(28641, [["e", auctionId]], { auction_id: auctionId, amount, reservation: receipt });
    const result = await api("/api/event", { method: "POST", body: JSON.stringify(signed) });
    message(`Bid committed at height ${result.height} (custodial reservation).`, "success");
    await refresh(); return;
  }
  const maximumEnd=Number(auction.original_end_time)+1800;
  const result=await state.friday.placeBid({auctionId,bidAmount:amount,fullPoolAmount:amount,reservedPoolAmount:amount,replacesBidId:auction.leader_bid_id||"",locktime:maximumEnd+900});
  message(result.status==="seller_plan_pending"
    ? `This auction has no registered offline payout authorization. Bid ${short(result.fundingOperationId)} remains pre-lock and cannot proceed.`
    : `Threshold bid ${result.status}${result.committedHeight?` at height ${result.committedHeight}`:""}.`,result.status==="unknown"||result.status==="seller_plan_pending"?"warning":"success"); await refresh();
}
async function authorizeCommittedAuctionPayout(auction) {
  requireR20Ready(); if (!state.friday) throw new Error("Connect a signer first.");
  if (!auction || auction.status !== "open" || auction.seller !== state.actor) throw new Error("Connect the open auction's seller first.");
  const startingBid = exactInteger(auction.starting_bid, "Starting bid");
  const minIncrement = exactInteger(auction.min_increment, "Minimum increment");
  const reserve = exactInteger(auction.reserve, "Reserve", 0);
  const originalEndTime = exactInteger(auction.original_end_time, "Original end time");
  const existing = await state.friday.readAuctionPayout(auction.id);
  if (existing === null) {
    const maximumEndTime = originalEndTime + 1800;
    await state.friday.authorizeAuctionPayout({ auctionId: auction.id, startingBid, minIncrement, reserve,
      originalEndTime, maximumEndTime, maximumPayout: 50000, validUntil: maximumEndTime + 900 });
  }
  state.auctionPayoutAvailability.set(auction.id, "ready");
}
async function servicePayments() {
  requireR20Ready(); if (!state.friday) throw new Error("Connect a signer first.");
  await runMaintenance(scope(), { force: true });
  await refresh();
}

byId("login").onclick=()=>connect().catch((error)=>message(error.message,"error"));
byId("disconnect").onclick=()=>{disconnect();render();message("Disconnected. Reconnect to recover returns and payouts.");};
byId("demo-login").onclick=()=>connectDemo().catch((error)=>message(error.message,"error"));
byId("refresh").onclick=()=>refresh().catch(()=>undefined);
byId("wallet-release").onclick=()=>performAction("wallet-release",byId("wallet-release"),"Claiming…",async()=>{
  // First try the cooperative refund for any bid this browser was displaced
  // from. That returns the proofs immediately, without waiting for locktime.
  const claimed = await claimRefunds({ manual: true });
  if (claimed.claimed > 0) return;
  const wallet = bidderWallet();
  const outcome = wallet.reclaimLocked();
  if (outcome.released > 0) {
    message(`Reclaimed ${outcome.released} sats back to spendable.`, "success");
  } else {
    // Not a failure: the NUT-11 lock gives the committee sole spending authority
    // until the locktime, so the bidder genuinely cannot move these yet.
    message(`Locked proofs become reclaimable at ${new Date(outcome.reclaimableAt * 1000).toLocaleTimeString()}. Until then the committee, not this wallet, can spend them.`, "warning");
  }
  await renderWalletBalance();
});
byId("wallet-mint").onclick=()=>performAction("wallet-mint",byId("wallet-mint"),"Minting…",async()=>{
  const amount = Math.floor(Number(byId("wallet-amount").value));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a whole number of sats to mint.");
  const balance = await bidderWallet().mint(amount, (step)=>message(step));
  message(`Minted ${amount} real proofs from the demo mint. Wallet holds ${balance} sats.`, "success");
  await renderWalletBalance();
});
byId("auction-search").oninput=(event)=>{state.query=event.target.value;renderAuctions();};
byId("faucet").onclick=(event)=>performAction("fund",event.currentTarget,"Funding…",async()=>{
  if (legacyFundingReady()) {
    // Legacy network: the server faucet issues a signed fake-sat note to this
    // actor.  It is a closed-loop ledger credit, not a Cashu token, and the UI
    // says so.  The amount is fixed by the network policy, so the input is only
    // validated, not requested.
    if (!state.actor) throw new Error("Connect a signer first.");
    const amount = exactInteger(byId("faucet-amount").value, "Faucet amount", 1);
    const policy = state.config?.fake_funding_policy;
    if (policy && amount > policy.max_per_request) throw new Error(`The faucet issues at most ${ui.formatSats(policy.max_per_request)} per request.`);
    const result = await api("/api/interim/faucet", { method: "POST", body: JSON.stringify({ actor: state.actor }) });
    message(`Fake sats credited in the demo ledger at height ${result.height}.`, "success");
    byId("faucet-amount").value = ""; await refresh(); return;
  }
  requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first.");
  const policy=state.friday.fundingPolicy(), parsed=ui.fundingAmount(byId("faucet-amount").value,policy.maxPerRequest); if(!parsed.ok) throw new Error(parsed.reason);
  const pending=await state.friday.pendingFakeFunding(); if(pending&&(pending.amount!==parsed.amount||pending.policyDigest!==policy.digest)) throw new Error(`Unresolved funding ${short(pending.operationId)} must retry its original amount and policy.`);
  const result=await state.friday.fundFake(parsed.amount); message(`${ui.formatSats(parsed.amount)} fake sats finalized in Coco (${short(result.operationId)}).`,"success"); byId("faucet-amount").value=""; await refresh();
}).catch(()=>undefined);
byId("process-payments").onclick=(event)=>performAction("maintenance",event.currentTarget,"Importing…",servicePayments).catch(()=>undefined);
byId("create-form").onsubmit=(event)=>{event.preventDefault();return performAction("create",byId("create-submit"),"Signing…",async()=>{
  const legacy = legacyFundingReady();
  if (legacy) { if (!state.actor || !state.signer) throw new Error("Connect a signer first."); }
  else { requireR20Ready(); if(!state.friday) throw new Error("Connect a signer first."); }
  const duration=exactInteger(byId("duration").value,"Duration",3),starting=exactInteger(byId("starting").value,"Starting bid"),increment=exactInteger(byId("increment").value,"Minimum increment"),reserve=byId("reserve").value.trim()===""?0:exactInteger(byId("reserve").value,"Reserve",0);
  const image=ui.imageURL(byId("image").value); if(!image.ok) throw new Error(image.reason);
  if(duration>3600) throw new Error("Duration may not exceed 3,600 seconds.");
  if (legacy) {
    // Legacy mode: no seller Coco payment key exists on this network, so the
    // listing carries only the custodial reservation funding mode.
    const id=`auction-${Date.now()}`;
    const chosenMode = byId("funding-mode")?.value || "custodial_reservation_v1";
    const signed=await sign(28640,[["t","plebeian-auctions-poc"],["auction",id]],{auction_id:id,title:byId("title").value,description:byId("description").value,image_url:image.url,duration_seconds:duration,starting_bid:starting,min_increment:increment,reserve,funding_mode:chosenMode});
    const result=await api("/api/event",{method:"POST",body:JSON.stringify(signed)});
    await refresh();
    message(`Auction committed at height ${result.height} in legacy fake-sat mode (custodial reservations).`,"success");
    byId("create-form").reset(); return;
  }
  const sellerPaymentPublicKey=await state.friday.sellerPaymentPublicKey();
  const id=`auction-${Date.now()}`; const signed=await sign(28640,[["t","plebeian-auctions-poc"],["auction",id]],{auction_id:id,title:byId("title").value,description:byId("description").value,image_url:image.url,duration_seconds:duration,starting_bid:starting,min_increment:increment,reserve,funding_mode:"threshold_sigall_v1",seller_coco_payment_public_key:sellerPaymentPublicKey});
  const result=await api("/api/event",{method:"POST",body:JSON.stringify(signed)});
  const committed=await refreshCommittedAuction(id,result.height);
  if(!committed||committed.status!=="open"||committed.seller!==state.actor
    ||committed.starting_bid!==starting||committed.min_increment!==increment||committed.reserve!==reserve){
    throw new Error("Committed auction differs from the signed listing; offline payout authorization was not created.");
  }
  await authorizeCommittedAuctionPayout(committed);
  message(`Auction committed at height ${result.height}. One auction-scoped payout authorization now covers bids while the seller is offline.`,"success");
  byId("create-form").reset(); await refresh();
}).catch(()=>undefined);};

(async function boot(){
  try { await refresh(); }
  catch(error){message(error.message,"error");updateControls();}
})();
setInterval(()=>refresh().catch(()=>undefined),4000);
setInterval(()=>{if(state.view)renderAuctions();},1000);
