/* Plebeian Auctions lab: seller, three independent bidder tabs, monitor.
 *
 * Plain browser JavaScript, no build step. The lab defaults to the SIG_ALL
 * money path: mint -> 2-of-2 NUT-11 SIG_ALL lock -> /api/demo/mint-lock ->
 * build both outcome templates -> /api/demo/sigall-deposit -> signed kind
 * 28641 carrying outcome_templates + sigall_deposit -> /api/event. The legacy
 * cashu_lock_v1 route (winner's tab settles) is still selectable.
 */
(function lab() {
  "use strict";

  // ---- console capture ----------------------------------------------------
  // A tester's report is only actionable with the page's own state beside it.
  // This keeps a bounded ring buffer of what the console actually said, so a
  // feedback note can carry the errors that led to it. It never leaves the
  // page except when a tester presses "Send note", and it is capped so a long
  // session cannot bloat a note past the server's limit.
  const CONSOLE_LIMIT = 200;
  const CONSOLE_TEXT_LIMIT = 600;
  const consoleBuffer = [];
  let consoleInstalled = false;

  function installConsoleCapture() {
    if (consoleInstalled) return;
    consoleInstalled = true;
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const original = console[level]?.bind(console);
      if (!original) continue;
      console[level] = (...args) => {
        try {
          const text = args
            .map((value) => {
              if (typeof value === "string") return value;
              if (value instanceof Error) return `${value.name}: ${value.message}`;
              try { return JSON.stringify(value); } catch { return String(value); }
            })
            .join(" ");
          consoleBuffer.push({ at: Date.now(), level, text: text.slice(0, CONSOLE_TEXT_LIMIT) });
          if (consoleBuffer.length > CONSOLE_LIMIT) consoleBuffer.shift();
        } catch {
          // Capture must never break the page it is observing.
        }
        original(...args);
      };
    }
    window.addEventListener("error", (event) => {
      consoleBuffer.push({
        at: Date.now(),
        level: "error",
        text: `uncaught: ${event.message} at ${event.filename || "?"}:${event.lineno || 0}`.slice(0, CONSOLE_TEXT_LIMIT),
      });
      if (consoleBuffer.length > CONSOLE_LIMIT) consoleBuffer.shift();
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      consoleBuffer.push({
        at: Date.now(),
        level: "error",
        text: `unhandled rejection: ${reason}`.slice(0, CONSOLE_TEXT_LIMIT),
      });
      if (consoleBuffer.length > CONSOLE_LIMIT) consoleBuffer.shift();
    });
  }

  installConsoleCapture();

  const ui = window.PlebeianUI;
  const PREFIX = "plebeian-lab:v1";
  const API_TIMEOUT_MS = 15000;
  const REFRESH_MS = 3000;

  const state = {
    config: null,
    view: null,
    validators: null,
    tab: "seller",
    slot: 1,
    seller: { signer: null, actor: "", wallet: null },
    bidders: {
      1: { signer: null, actor: "", wallet: null },
      2: { signer: null, actor: "", wallet: null },
      3: { signer: null, actor: "", wallet: null },
    },
    busy: new Set(),
    drafts: new Map(),
    settlementAttempts: new Map(),
    lastRefresh: 0,
    refreshPromise: null,
  };

  const $ = (id) => document.getElementById(id);
  const short = (value) => (value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—");
  const sats = (value) => (Number.isSafeInteger(Number(value)) ? Number(value).toLocaleString("en-US") : "—");

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function toast(text, tone = "info") {
    const node = $("toast");
    node.textContent = text;
    node.dataset.tone = tone;
    node.className = `toast ${tone}`;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 6000);
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await fetch(path, {
        redirect: "error",
        credentials: "same-origin",
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
      const type = response.headers.get("content-type")?.split(";")[0];
      if (type !== "application/json") {
        throw new Error(`${path} answered ${response.status} with ${type || "no content type"}; the demo backend may be restarting.`);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${path} did not answer within ${Math.round(API_TIMEOUT_MS / 1000)}s.`);
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }

  /* ------------------------------------------------------------------ *
   * Identities
   *
   * demo-signer.js creates a fresh secp256k1 key from crypto.getRandomValues
   * and never exposes it. To keep one identity per tab across reloads we
   * capture the 32 random bytes it consumed, store them in localStorage, and
   * replay them into the same factory on the next load. If a browser refuses
   * the override, the page falls back to an ephemeral identity and says so.
   * ------------------------------------------------------------------ */

  function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function withRandomBytes(bytes, run) {
    const original = crypto.getRandomValues;
    let used = false;
    const replacement = (array) => {
      if (!used && array instanceof Uint8Array && array.length === 32) {
        used = true;
        array.set(bytes);
        return array;
      }
      return original.call(crypto, array);
    };
    let restore;
    try {
      crypto.getRandomValues = replacement;
      if (crypto.getRandomValues !== replacement) throw new Error("override refused");
      restore = () => { crypto.getRandomValues = original; };
    } catch {
      Object.defineProperty(crypto, "getRandomValues", { configurable: true, writable: true, value: replacement });
      restore = () => Object.defineProperty(crypto, "getRandomValues", { configurable: true, writable: true, value: original });
    }
    try {
      return run();
    } finally {
      restore();
    }
  }

  function freshSigner() {
    if (!window.plebeianCreateDemoSigner) throw new Error("The demo signer bundle did not load.");
    let captured = null;
    const original = crypto.getRandomValues;
    const replacement = (array) => {
      const result = original.call(crypto, array);
      if (array instanceof Uint8Array && array.length === 32) captured = bytesToHex(array);
      return result;
    };
    let restore;
    try {
      crypto.getRandomValues = replacement;
      if (crypto.getRandomValues !== replacement) throw new Error("override refused");
      restore = () => { crypto.getRandomValues = original; };
    } catch {
      Object.defineProperty(crypto, "getRandomValues", { configurable: true, writable: true, value: replacement });
      restore = () => Object.defineProperty(crypto, "getRandomValues", { configurable: true, writable: true, value: original });
    }
    try {
      const signer = window.plebeianCreateDemoSigner();
      if (!captured) throw new Error("could not capture the generated demo key");
      return { signer, secretHex: captured };
    } finally {
      restore();
    }
  }

  function signerFromSecret(secretHex) {
    if (!/^[0-9a-f]{64}$/.test(secretHex)) throw new Error("stored demo key is malformed");
    return withRandomBytes(hexToBytes(secretHex), () => window.plebeianCreateDemoSigner());
  }

  function identityKey(role) { return `${PREFIX}:identity:${role}`; }

  async function ensureIdentity(role) {
    const stored = localStorage.getItem(identityKey(role));
    let signer;
    let ephemeral = false;
    if (stored) {
      try {
        signer = signerFromSecret(stored);
      } catch (error) {
        console.warn("lab: stored identity could not be restored", error);
        localStorage.removeItem(identityKey(role));
      }
    }
    if (!signer) {
      const fresh = freshSigner();
      signer = fresh.signer;
      try { localStorage.setItem(identityKey(role), fresh.secretHex); }
      catch { ephemeral = true; }
    }
    const actor = await signer.getPublicKey();
    return { signer, actor, ephemeral };
  }

  function walletFor(role, actor) {
    if (!window.PlebeianWallet) throw new Error("The wallet bundle did not load; reload the page.");
    const mintUrl = state.config?.cashu_mint_url
      ? String(state.config.cashu_mint_url).replace(/\/+$/, "")
      : new URL(state.config?.browser_mint_path || "/api/mint", window.location.origin).toString().replace(/\/+$/, "");
    return new window.PlebeianWallet.BidderWallet(
      mintUrl,
      window.PlebeianWallet.browserStorage(`${PREFIX}:wallet:${role}:${actor}`),
    );
  }

  function clearWalletNamespace(role) {
    const prefix = `${PREFIX}:wallet:${role}:`;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) localStorage.removeItem(key);
    }
  }

  async function installIdentity(role) {
    const identity = await ensureIdentity(role);
    const target = role === "seller" ? state.seller : state.bidders[Number(role)];
    target.signer = identity.signer;
    target.actor = identity.actor;
    target.wallet = walletFor(role, identity.actor);
    if (identity.ephemeral) toast("This browser refused localStorage; the identity will not survive a reload.", "error");
    return target;
  }

  async function newIdentity(role) {
    const label = role === "seller" ? "seller" : `bidder ${role}`;
    if (!window.confirm(`Replace the ${label} identity? Its wallet stays in this browser under the old key, but this tab will no longer use it.`)) return;
    localStorage.removeItem(identityKey(role));
    clearWalletNamespace(role);
    await installIdentity(role);
    renderIdentities();
    renderSeller();
    renderBidder();
    toast(`Created a new ${label} identity.`, "success");
  }

  /* ------------------------------------------------------------------ *
   * Signing and money
   * ------------------------------------------------------------------ */

  async function sign(identity, kind, tags, content) {
    if (!identity?.signer) throw new Error("This tab has no identity yet.");
    return identity.signer.signEvent({
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify(content),
    });
  }

  function mintBacked() { return state.config?.mint_backed_funding === true; }

  function locktimeFor(auction) {
    const maxTotalExtension = Number(state.config?.max_total_extension_seconds);
    const emergencyRecovery = Number(state.config?.emergency_recovery_seconds);
    if (!Number.isSafeInteger(maxTotalExtension) || !Number.isSafeInteger(emergencyRecovery)
      || maxTotalExtension < 0 || emergencyRecovery < 0) {
      throw new Error("The coordinator did not publish the locktime policy; refusing to lock with a guessed margin.");
    }
    return Number(auction.original_end_time) + maxTotalExtension + emergencyRecovery;
  }

  async function mint(identity, amount) {
    if (!mintBacked()) throw new Error("This deployment does not serve mint-backed funding.");
    const wallet = identity.wallet;
    const balance = await wallet.mint(amount, (step) => setBidderStatus(step));
    setBidderStatus(`Minted ${sats(amount)} fake sats. Wallet holds ${sats(balance)}.`);
    toast(`Minted ${sats(amount)} fake sats from the demo mint.`, "success");
    renderBidder();
  }

  async function placeBid(identity, auction, amount) {
    if (!mintBacked()) throw new Error("This deployment does not serve mint-backed funding.");
    if (!state.config?.committee_public_key) throw new Error("The committee public key is missing from /api/config.");
    const wallet = identity.wallet;
    const locktime = locktimeFor(auction);
    if (auction.funding_mode === "cashu_sigall_v1") {
      return placeSigAllBid(identity, auction, amount, wallet, locktime);
    }
    setBidderStatus("Locking proofs to the committee…");
    const funding = await wallet.lockForBid(amount, state.config.committee_public_key, locktime, (step) => setBidderStatus(step));
    // Pre-sign the settle and refund consents now, while the bidder's wallet is
    // present, and publish them with the bid. Without them the coordinator would
    // again need this browser online at close to settle or refund, which is the
    // liveness this bridge removes. The coordinator refuses a mint-backed bid
    // that omits them.
    setBidderStatus("Pre-signing the outcome authorizations…");
    const outcomeAuthorizations = await wallet.preauthorizeOutcome(auction.id, funding.proofStateRefs, funding.lockedProofs);
    setBidderStatus("Submitting the lock receipt…");
    const receipt = await api("/api/demo/mint-lock", {
      method: "POST",
      body: JSON.stringify({
        auction_id: auction.id,
        bidder: identity.actor,
        amount,
        locktime,
        refund_public_key: funding.refundPublicKey,
        token_sha256: funding.tokenSha256,
        proof_state_refs: funding.proofStateRefs,
        proofs: funding.proofs,
      }),
    });
    const signed = await sign(identity, 28641, [["e", auction.id]], {
      auction_id: auction.id,
      amount,
      cashu_lock: receipt,
      outcome_authorizations: outcomeAuthorizations,
    });
    const result = await api("/api/event", { method: "POST", body: JSON.stringify(signed) });
    wallet.recordLockedBid(signed.id, funding.lockedProofs, funding.spendPublicKey, auction.id);
    setBidderStatus(`Bid committed at height ${result.height}.`);
    toast(`Bid of ${sats(amount)} committed at height ${result.height}.`, "success");
    await refresh();
  }

  /**
   * The SIG_ALL bid. The bidder locks 2-of-2 to itself and the committee,
   * builds BOTH exact outcome transactions (settle to the seller's committed
   * key, refund to its own wallet key), deposits them with the coordinator,
   * and publishes only the compact commitment (the deposit id, the two digests,
   * the two bidder signatures) plus the coordinator's signed deposit receipt.
   *
   * Because the authorizations and the bearer templates are on record, the
   * bidder never has to be online again: the coordinator submits whichever
   * outcome commits. This is the lab's default route.
   */
  async function placeSigAllBid(identity, auction, amount, wallet, locktime) {
    setBidderStatus("Locking proofs to the bidder and the committee (SIG_ALL)…");
    const funding = await wallet.lockForBidSigAll(amount, state.config.committee_public_key, locktime, (step) => setBidderStatus(step));
    setBidderStatus("Submitting the SIG_ALL lock receipt…");
    const receipt = await api("/api/demo/mint-lock", {
      method: "POST",
      body: JSON.stringify({
        auction_id: auction.id,
        bidder: identity.actor,
        amount,
        locktime,
        refund_public_key: funding.refundPublicKey,
        token_sha256: funding.tokenSha256,
        proof_state_refs: funding.proofStateRefs,
        proofs: funding.proofs,
        funding_mode: "cashu_sigall_v1",
      }),
    });
    // buildOutcomeTemplates + POST /api/demo/sigall-deposit in one wallet call:
    // the coordinator verifies the two templates and returns its signed receipt.
    setBidderStatus("Depositing the two pre-authorized outcomes…");
    const commitment = await wallet.depositOutcomeTemplates(
      { id: auction.id, seller_coco_payment_public_key: auction.seller_coco_payment_public_key },
      funding,
      identity.actor,
      receipt,
      "/api/demo/sigall-deposit",
    );
    const signed = await sign(identity, 28641, [["e", auction.id]], {
      auction_id: auction.id,
      amount,
      cashu_lock: receipt,
      outcome_templates: commitment.outcome_templates,
      sigall_deposit: commitment.sigall_deposit,
    });
    const result = await api("/api/event", { method: "POST", body: JSON.stringify(signed) });
    wallet.recordLockedBid(signed.id, funding.lockedProofs, funding.spendPublicKey, auction.id);
    setBidderStatus(`SIG_ALL bid committed at height ${result.height}. This tab may be closed.`);
    toast(`SIG_ALL bid of ${sats(amount)} committed at height ${result.height}.`, "success");
    await refresh();
  }

  async function claimRefunds(identity, manual = false) {
    if (!mintBacked()) return 0;
    const wallet = identity.wallet;
    const bids = Object.values(state.view?.state?.bids || {});
    const locks = state.view?.state?.locks || {};
    let claimed = 0;
    for (const bid of bids) {
      if (bid.bidder !== identity.actor) continue;
      const lock = locks[bid.id];
      // "refundable" is the live swap; "refunded" is a payout the coordinator's
      // sweeper already performed for an offline bidder and parked under the
      // bid id. Both are collected through the same refund claim: the endpoint
      // serves the parked proofs when the lock is already refunded.
      if (!lock || (lock.status !== "refundable" && lock.status !== "refunded")) continue;
      if (!wallet.lockedForBid(bid.id).length) continue;
      try {
        const event = await sign(identity, 28642, [["e", bid.auction_id]], { bid_id: bid.id });
        const result = await wallet.refundBid(bid.id, event);
        claimed += 1;
        if (manual) toast(`Refunded ${sats(result.amount)} fake sats to this wallet.`, "success");
      } catch (error) {
        if (manual) toast(`Refund for ${short(bid.id)} failed: ${error.message}`, "error");
      }
    }
    if (claimed) {
      setBidderStatus(`Claimed ${claimed} refund(s).`);
      renderBidder();
    } else if (manual) {
      setBidderStatus("No refundable bid with locally held proofs was found.");
    }
    return claimed;
  }

  /**
   * The winner's half of settlement. When this tab's own lock is
   * `winner_selected`, it hands the proofs to the coordinator, which swaps them
   * to the SELLER's committed wallet key, and then records the outcome as a kind
   * 28643 event. The swap is the money; the event is only the record, so a
   * failed post is reported and retried on a later refresh, never treated as a
   * lost payment.
   *
   * Two events, deliberately: the authorization event is signed before the swap
   * and is never committed (exactly like a refund), because the payout digest it
   * would have to carry does not exist until the swap returns.
   */
  async function settleWins(identity, manual = false) {
    if (!mintBacked()) return 0;
    const wallet = identity.wallet;
    const auctions = Object.values(state.view?.state?.auctions || {});
    const locks = state.view?.state?.locks || {};
    let settled = 0;
    for (const auction of auctions) {
      if (auction.status !== "closed" || auction.winner !== identity.actor) continue;
      // Only the legacy cashu_lock_v1 route needs the winner's tab to settle.
      // A cashu_sigall_v1 lock is settled by the coordinator from the stored
      // deposit, so this tab deliberately does nothing for it.
      if (auction.funding_mode !== "cashu_lock_v1") continue;
      const lock = locks[auction.leader_bid_id];
      if (!lock || lock.status !== "winner_selected") continue;
      if (!wallet.lockedForBid(auction.leader_bid_id).length) continue;
      const last = state.settlementAttempts.get(auction.id) || 0;
      if (!manual && Date.now() - last < 15000) continue;
      state.settlementAttempts.set(auction.id, Date.now());
      try {
        const authorization = await sign(identity, 28643, [["e", auction.id]], { auction_id: auction.id, bid_id: auction.leader_bid_id });
        const result = await wallet.settleAuction(auction.id, authorization);
        settled += 1;
        state.settlementAttempts.delete(auction.id);
        try {
          const record = await sign(identity, 28643, [["e", auction.id]], {
            auction_id: auction.id,
            bid_id: auction.leader_bid_id,
            payout_token_sha256: result.tokenSha256,
          });
          await api("/api/event", { method: "POST", body: JSON.stringify(record) });
        } catch (error) {
          if (manual) toast(`Settled ${sats(result.amount)} to the seller, but the record did not commit: ${error.message}`, "error");
        }
        if (manual) toast(`Settled ${short(auction.id)}: ${sats(result.amount)} fake sats paid to the seller's wallet.`, "success");
      } catch (error) {
        if (manual) toast(`Settlement for ${short(auction.id)} failed: ${error.message}`, "error");
      }
    }
    if (settled) {
      setBidderStatus(`Settled ${settled} won auction(s).`);
      renderBidder();
    } else if (manual) {
      setBidderStatus("No won auction with locally held proofs is ready to settle.");
    }
    return settled;
  }

  /**
   * The seller's half: fetch any payout a settlement swap parked for this
   * auction and put it in this wallet's spendable balance.
   *
   * The endpoint is unauthenticated because the proofs are P2PK-locked to this
   * wallet's spend key -- the lock is the access control, and a wallet without
   * the key can download what it cannot spend.
   */
  async function importPayouts(identity, manual = false) {
    if (!mintBacked()) return 0;
    const wallet = identity.wallet;
    const auctions = Object.values(state.view?.state?.auctions || {});
    let imported = 0;
    for (const auction of auctions) {
      if (auction.seller !== identity.actor || auction.status !== "closed" || !auction.winner) continue;
      if (auction.funding_mode !== "cashu_lock_v1" && auction.funding_mode !== "cashu_sigall_v1") continue;
      const key = `import:${auction.id}`;
      const last = state.settlementAttempts.get(key) || 0;
      if (!manual && Date.now() - last < 15000) continue;
      state.settlementAttempts.set(key, Date.now());
      try {
        const result = await wallet.importSettlement(auction.id);
        if (result.imported) {
          imported += 1;
          state.settlementAttempts.delete(key);
          if (manual) toast(`Imported ${sats(result.amount)} fake sats of seller payout.`, "success");
        }
      } catch (error) {
        if (manual) toast(`Payout import for ${short(auction.id)} failed: ${error.message}`, "error");
      }
    }
    if (imported) renderSeller();
    else if (manual) setSellerStatus("No settlement payout is waiting for this identity's wallet.");
    return imported;
  }

  /* ------------------------------------------------------------------ *
   * Seller
   * ------------------------------------------------------------------ */

  const LISTINGS = [
    ["Hand-bound notebook, 96 pages", "Cotton paper, waxed linen thread, board cover. Slight shelf wear on the spine."],
    ["Vintage brass desk lamp", "Weighted base, original cloth cord replaced with modern braided cable. Warm bulb included."],
    ["Set of four stoneware mugs", "Wheel-thrown, oatmeal glaze, small variation in each rim. Dishwasher safe."],
    ["1987 touring bicycle frame", "Reynolds 531 tubing, 56 cm, resprayed in British racing green. No wheels or groupset."],
    ["Letterpress type specimen pack", "Assorted wood and metal type from a closed print shop. Sold as a mixed lot."],
    ["Wool camp blanket", "Heavyweight melton wool, 200 × 150 cm, one repaired moth hole near the corner."],
    ["Mechanical keyboard, 65%", "Aluminium case, lubed linear switches, PBT keycaps. USB-C cable included."],
    ["Pair of oak bookends", "Solid white oak, felted undersides, finished with hardwax oil."],
    ["Field camera, 4×5", "Bellows light-tight, ground glass intact, one film holder. Shutter untested."],
    ["Ceramic pour-over set", "Cone dripper and carafe, speckled clay, food-safe glaze. Fits standard filters."],
    ["Archive of railway timetables", "Forty-one paper timetables, 1958–1974, stored flat. Some foxing."],
    ["Hand-forged chef's knife", "1095 carbon steel, 210 mm blade, walnut handle. Patina from use; sharpened."],
  ];

  function randomListing() {
    const [title, description] = LISTINGS[Math.floor(Math.random() * LISTINGS.length)];
    $("title").value = title;
    $("description").value = description;
    $("duration").value = String([120, 180, 300, 600][Math.floor(Math.random() * 4)]);
    $("starting").value = String([50, 100, 150, 200][Math.floor(Math.random() * 4)]);
    $("increment").value = String([5, 10, 25][Math.floor(Math.random() * 3)]);
    $("reserve").value = "0";
  }

  async function createAuction() {
    const identity = state.seller;
    if (!identity?.signer) throw new Error("The seller identity is not ready.");
    if (!mintBacked()) throw new Error("This deployment does not serve mint-backed funding, so mint-backed auctions cannot be created here.");
    const title = $("title").value.trim();
    if (!title) throw new Error("A title is required.");
    const fundingMode = $("funding-mode")?.value || "cashu_sigall_v1";
    if (fundingMode !== "cashu_sigall_v1" && fundingMode !== "cashu_lock_v1") throw new Error("Unknown funding mode.");
    const duration = Number($("duration").value);
    const starting = Number($("starting").value);
    const increment = Number($("increment").value);
    const reserve = $("reserve").value.trim() === "" ? 0 : Number($("reserve").value);
    for (const [name, value, min] of [["Duration", duration, 3], ["Starting bid", starting, 1], ["Minimum increment", increment, 1], ["Reserve", reserve, 0]]) {
      if (!Number.isSafeInteger(value) || value < min) throw new Error(`${name} must be a whole number of at least ${min}.`);
    }
    if (duration > 3600) throw new Error("Duration may not exceed 3,600 seconds.");
    const id = `auction-${Date.now()}`;
    const signed = await sign(identity, 28640, [["t", "plebeian-auctions-poc"], ["auction", id]], {
      auction_id: id,
      title,
      description: $("description").value.trim(),
      image_url: "",
      duration_seconds: duration,
      starting_bid: starting,
      min_increment: increment,
      reserve,
      funding_mode: fundingMode,
      // The seller commits this tab's WALLET key as the settlement destination.
      // It is the seller's own signature on this create event that authorizes
      // it, and it is never the Nostr identity: the Nostr key authorizes, the
      // wallet key owns value.
      ...(mintBacked() ? { seller_coco_payment_public_key: identity.wallet.spendPublicKey() } : {}),
    });
    const result = await api("/api/event", { method: "POST", body: JSON.stringify(signed) });
    toast(`Auction committed at height ${result.height}.`, "success");
    $("create-form").reset();
    $("duration").value = "300";
    $("starting").value = "100";
    $("increment").value = "10";
    $("reserve").value = "0";
    await refresh();
  }

  function renderSeller() {
    const actor = state.seller.actor;
    $("seller-actor").textContent = actor ? short(actor) : "creating…";
    $("seller-actor").title = actor || "";
    const auctions = Object.values(state.view?.state?.auctions || {})
      .filter((auction) => auction.seller === actor)
      .sort((a, b) => b.created_at - a.created_at);
    const target = $("seller-auctions");
    target.replaceChildren();
    $("seller-summary").textContent = `${auctions.length} auction(s) from this identity`;
    try {
      $("seller-payout-balance").textContent = sats(state.seller.wallet.balance());
    } catch (error) {
      // The seller wallet is not loaded yet; the next refresh fills this in.
    }
    $("seller-import").disabled = state.busy.has("import") || !mintBacked();
    if (!auctions.length) {
      target.append(el("p", "empty", "No auctions from this identity yet. Create one above."));
      return;
    }
    for (const auction of auctions) {
      const row = el("div", "auction-row");
      const top = el("div", "top");
      const left = el("div");
      left.append(el("h3", "", auction.title), el("p", "meta", `Seller ${short(auction.seller)} · created ${ui.formatTime(auction.created_at)}`));
      const pill = el("span", `pill ${auction.status}`, auction.status);
      top.append(left, pill);
      row.append(top);
      const facts = el("p", "meta");
      facts.textContent = `High bid ${sats(auction.high_bid)} · increment ${sats(auction.min_increment)} · reserve ${auction.reserve ? sats(auction.reserve) : "none"} · ends ${ui.formatTime(auction.end_time)}`;
      row.append(facts);
      let payout;
      if (auction.status === "open") {
        payout = auction.high_bid > 0
          ? `Leading bid ${sats(auction.high_bid)}. Payout is released when the auction closes and the winner settles.`
          : "No bids yet. Payout is released when the auction closes and the winner settles.";
      } else if (auction.winner) {
        payout = `Closed with winner ${short(auction.winner)} at ${sats(auction.high_bid)}. Settlement pays the seller's committed wallet key.`;
      } else {
        payout = "Closed without a sale. No payout is due.";
      }
      row.append(el("p", "fine", payout));
      target.append(row);
    }
  }

  /* ------------------------------------------------------------------ *
   * Bidder
   * ------------------------------------------------------------------ */

  function currentBidder() { return state.bidders[state.slot]; }

  function setBidderStatus(text) {
    const node = $("bidder-status");
    if (node) node.textContent = text;
  }

  function setSellerStatus(text) {
    const node = $("seller-status");
    if (node) node.textContent = text;
  }

  function renderIdentities() {
    $("seller-actor").textContent = state.seller.actor ? short(state.seller.actor) : "creating…";
    $("seller-actor").title = state.seller.actor || "";
    for (const slot of [1, 2, 3]) {
      const button = $(`tab-bidder-${slot}`);
      const actor = state.bidders[slot].actor;
      button.textContent = actor ? `Bidder ${slot} · ${actor.slice(0, 6)}` : `Bidder ${slot}`;
      button.title = actor || "";
    }
  }

  function renderBidder() {
    const identity = currentBidder();
    $("bidder-title").textContent = `Bidder ${state.slot}`;
    $("bidder-actor").textContent = identity.actor ? short(identity.actor) : "creating…";
    $("bidder-actor").title = identity.actor || "";
    let spendable = 0;
    let locked = 0;
    let walletKey = "—";
    try {
      spendable = identity.wallet.balance();
      locked = identity.wallet.lockedBalance();
      walletKey = identity.wallet.spendPublicKey();
    } catch (error) {
      setBidderStatus(error.message);
    }
    $("bidder-spendable").textContent = sats(spendable);
    $("bidder-locked").textContent = sats(locked);
    $("bidder-wallet-key").textContent = walletKey === "—" ? "—" : short(walletKey);
    $("bidder-wallet-key").title = walletKey;
    $("bidder-mint").disabled = state.busy.has("mint") || !mintBacked();
    $("bidder-claim").disabled = state.busy.has("claim") || !mintBacked();
    $("bidder-settle").disabled = state.busy.has("settle") || !mintBacked();
    renderBidderAuctions(identity);
    renderBidderPositions(identity);
  }

  function renderBidderAuctions(identity) {
    const target = $("bidder-auctions");
    const active = document.activeElement;
    if (active && active.closest && active.closest("#bidder-auctions") && active.tagName === "INPUT") {
      // Do not replace an input the bidder is typing into on the 3s refresh.
      return;
    }
    const auctions = Object.values(state.view?.state?.auctions || {})
      .filter((auction) => auction.status === "open")
      .sort((a, b) => a.end_time - b.end_time);
    $("bidder-auction-summary").textContent = `${auctions.length} open auction(s) · app height ${state.view?.state?.height ?? "—"}`;
    target.replaceChildren();
    if (!auctions.length) {
      target.append(el("p", "empty", "No open auctions. Create one in the Seller tab."));
      return;
    }
    for (const auction of auctions) {
      const row = el("div", "auction-row");
      const top = el("div", "top");
      const left = el("div");
      left.append(el("h3", "", auction.title), el("p", "meta", `Seller ${short(auction.seller)} · ${ui.countdown(Number(auction.end_time)).label}`));
      top.append(left, el("span", "pill open", "open"));
      row.append(top);
      if (auction.description) row.append(el("p", "meta", auction.description));
      const minimum = ui.minimumBid(auction);
      row.append(el("p", "meta", `High bid ${sats(auction.high_bid)} · minimum next bid ${minimum === null ? "—" : sats(minimum)} · ends ${ui.formatTime(auction.end_time)}`));
      const line = el("div", "bid-line");
      const label = el("label", "", "Bid amount");
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.dataset.auctionId = auction.id;
      const draftKey = `${state.slot}:${auction.id}`;
      input.value = state.drafts.get(draftKey) ?? (minimum === null ? "" : String(minimum));
      input.oninput = () => state.drafts.set(draftKey, input.value);
      label.append(input);
      const button = el("button", "button primary", "Bid");
      button.type = "button";
      const own = auction.seller === identity.actor;
      button.disabled = own || minimum === null || !mintBacked() || state.busy.has(`bid:${auction.id}`);
      if (own) button.textContent = "Your auction";
      button.onclick = async () => {
        const parsed = ui.bidAmount(input.value, minimum);
        if (!parsed.ok) { toast(parsed.reason, "error"); return; }
        state.busy.add(`bid:${auction.id}`);
        button.disabled = true;
        button.textContent = "Bidding…";
        try {
          await placeBid(identity, auction, parsed.amount);
          state.drafts.delete(draftKey);
        } catch (error) {
          toast(error.message, "error");
          setBidderStatus(error.message);
        } finally {
          state.busy.delete(`bid:${auction.id}`);
          renderBidder();
        }
      };
      line.append(label, button);
      row.append(line);
      target.append(row);
    }
  }

  function renderBidderPositions(identity) {
    const target = $("bidder-positions");
    const bids = Object.values(state.view?.state?.bids || {})
      .filter((bid) => bid.bidder === identity.actor)
      .sort((a, b) => b.committed_at - a.committed_at);
    const auctions = state.view?.state?.auctions || {};
    const locks = state.view?.state?.locks || {};
    target.replaceChildren();
    if (!bids.length) {
      target.append(el("p", "empty", "No bids from this identity yet."));
      return;
    }
    for (const bid of bids) {
      const auction = auctions[bid.auction_id];
      const lock = locks[bid.id];
      const row = el("div", "auction-row");
      const top = el("div", "top");
      const left = el("div");
      left.append(el("h3", "", auction?.title || bid.auction_id), el("p", "meta", `Bid ${sats(bid.amount)} · committed ${ui.formatTime(bid.committed_at)}`));
      const status = lock?.status || "no lock record";
      top.append(left, el("span", `pill ${status}`, status));
      row.append(top);
      let detail;
      if (status === "refundable") {
        detail = "Displaced. This browser can ask the coordinator to swap the locked proofs back to its own wallet key.";
      } else if (status === "refunded") {
        detail = "Refunded. The coordinator reports the lock as returned; the fresh proofs are in this wallet if the claim ran here.";
      } else if (status === "winner_selected") {
        detail = auction?.funding_mode === "cashu_sigall_v1"
          ? "Winner selected. The coordinator submits the settle outcome you pre-authorized; no action is needed in this tab."
          : "Winner selected. The winner's browser settles by spending the locked proofs to the seller's committed wallet key.";
      } else if (status === "paid") {
        detail = "Paid. The lock is terminal.";
      } else {
        detail = "Locked to the committee. The bidder holds the proofs but cannot spend them until the lock resolves.";
      }
      row.append(el("p", "fine", detail));
      if (status === "refundable" && identity.wallet.lockedForBid(bid.id).length) {
        const claim = el("button", "button ghost", "Claim refund");
        claim.type = "button";
        claim.disabled = state.busy.has(`claim:${bid.id}`);
        claim.onclick = async () => {
          state.busy.add(`claim:${bid.id}`);
          claim.disabled = true;
          try {
            const event = await sign(identity, 28642, [["e", bid.auction_id]], { bid_id: bid.id });
            const result = await identity.wallet.refundBid(bid.id, event);
            toast(`Refunded ${sats(result.amount)} fake sats.`, "success");
            await refresh();
          } catch (error) {
            toast(error.message, "error");
          } finally {
            state.busy.delete(`claim:${bid.id}`);
            renderBidder();
          }
        };
        row.append(claim);
      }
      target.append(row);
    }
  }

  /* ------------------------------------------------------------------ *
   * Monitor
   * ------------------------------------------------------------------ */

  function renderMonitor() {
    const view = state.view;
    $("monitor-height").textContent = view?.state?.height ?? "—";
    $("monitor-apphash").textContent = view?.app_hash ? short(view.app_hash) : "—";
    $("monitor-apphash").title = view?.app_hash || "";

    const validators = state.validators?.validators || [];
    const grid = $("monitor-validators");
    grid.replaceChildren();
    if (!validators.length) {
      grid.append(el("p", "empty", "No validator status was returned."));
    }
    for (const validator of validators) {
      const card = el("article", `validator ${validator.online ? "online" : "offline"}`);
      const head = el("div", "vhead");
      const name = el("strong", "", `Validator ${validator.slot}`);
      const dot = el("i", "dot");
      head.append(name, dot);
      card.append(head);
      card.append(el("small", "", validator.online ? "online" : `offline${validator.error ? ` · ${validator.error}` : ""}`));
      card.append(el("small", "", `height ${validator.height ?? "—"} · commit ${validator.canonical_commit_height ?? "—"}`));
      card.append(el("small", "", `commit signatures ${validator.commit_signatures ?? 0} · ${validator.observed_signature ? "own signature observed" : "own signature not observed"}`));
      card.append(el("small", "", `app ${validator.app_hash ? short(validator.app_hash) : "—"}`));
      card.append(el("small", "", `node ${validator.node_id ? short(validator.node_id) : "—"}`));
      grid.append(card);
    }

    const auctions = view?.state?.auctions || {};
    const bids = view?.state?.bids || {};
    const locks = view?.state?.locks || {};
    const entries = [];
    for (const auction of Object.values(auctions)) {
      entries.push({
        t: Number(auction.created_at) || 0,
        kind: "auction",
        what: `Auction created: ${auction.title}`,
        detail: `seller ${short(auction.seller)} · start ${sats(auction.starting_bid)} · ends ${ui.formatTime(auction.end_time)}`,
      });
      if (auction.status !== "open" && auction.closed_at) {
        entries.push({
          t: Number(auction.closed_at) || 0,
          kind: "close",
          what: `Auction closed: ${auction.title}`,
          detail: auction.winner
            ? `winner ${short(auction.winner)} at ${sats(auction.high_bid)}`
            : "closed without a sale",
        });
      }
    }
    for (const bid of Object.values(bids)) {
      const auction = auctions[bid.auction_id];
      const lock = locks[bid.id];
      entries.push({
        t: Number(bid.committed_at) || 0,
        kind: "bid",
        what: `Bid ${sats(bid.amount)} on ${auction?.title || bid.auction_id}`,
        detail: `bidder ${short(bid.bidder)} · lock ${lock?.status || "not recorded"}`,
      });
    }
    entries.sort((a, b) => b.t - a.t);
    const log = $("monitor-log");
    log.replaceChildren();
    $("monitor-log-summary").textContent = `${entries.length} committed event(s) · ${Object.keys(locks).length} lock(s)`;
    if (!entries.length) {
      log.append(el("p", "empty", "No committed events yet."));
    }
    let currentSecond = null;
    let group = null;
    for (const entry of entries.slice(0, 120)) {
      if (entry.t !== currentSecond) {
        currentSecond = entry.t;
        group = el("div", "timeline-group");
        group.append(el("h3", "", entry.t ? `Consensus time ${ui.formatTime(entry.t)}` : "Consensus time not recorded"));
        log.append(group);
      }
      const event = el("div", "event");
      const what = el("div", "what");
      what.append(el("span", `kind ${entry.kind}`, entry.kind.toUpperCase()), document.createTextNode(entry.what));
      event.append(what, el("div", "detail", entry.detail));
      group.append(event);
    }

    const lockTarget = $("monitor-locks");
    lockTarget.replaceChildren();
    const lockList = Object.values(locks).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!lockList.length) {
      lockTarget.append(el("p", "empty", "No locks in committed state."));
    }
    for (const lock of lockList) {
      const auction = auctions[lock.auction_id];
      const row = el("div", "auction-row");
      const top = el("div", "top");
      const left = el("div");
      left.append(el("h3", "", auction?.title || lock.auction_id), el("p", "meta", `bidder ${short(lock.bidder)} · ${sats(lock.amount)} fake sats`));
      top.append(left, el("span", `pill ${lock.status}`, lock.status));
      row.append(top);
      row.append(el("p", "fine", `bid ${short(lock.bid_id)} · refund/close time is not recorded per event by the API`));
      lockTarget.append(row);
    }
  }

  /* ------------------------------------------------------------------ *
   * Refresh and tabs
   * ------------------------------------------------------------------ */

  async function refresh() {
    if (state.refreshPromise) return state.refreshPromise;
    state.refreshPromise = (async () => {
      const [view, validators] = await Promise.all([api("/api/state"), api("/api/validators")]);
      state.view = view;
      state.validators = validators;
      state.lastRefresh = Date.now();
      renderSeller();
      renderBidder();
      renderMonitor();
      if (mintBacked()) {
        const identity = currentBidder();
        if (identity?.actor) {
          // A displaced bidder's tab claims its own refund; a winning tab pays
          // the seller. Both act only on state consensus has already marked
          // terminal, and both are throttled so a 3s refresh cannot spam the
          // coordinator.
          await claimRefunds(identity, false);
          await settleWins(identity, false);
        }
        // The seller's tab picks up whatever a winner's swap parked for it.
        if (state.seller?.actor) await importPayouts(state.seller, false);
      }
    })().catch((error) => {
      toast(error.message, "error");
    }).finally(() => { state.refreshPromise = null; });
    return state.refreshPromise;
  }

  function selectTab(tab, slot) {
    state.tab = tab;
    if (slot) state.slot = slot;
    for (const button of document.querySelectorAll(".tab")) {
      const selected = button.dataset.tab === tab && (tab !== "bidder" || Number(button.dataset.slot) === state.slot);
      button.setAttribute("aria-selected", String(selected));
    }
    $("panel-seller").hidden = tab !== "seller";
    $("panel-bidder").hidden = tab !== "bidder";
    $("panel-monitor").hidden = tab !== "monitor";
    if (tab === "bidder") renderBidder();
    if (tab === "monitor") renderMonitor();
  }

  // ---- feedback -----------------------------------------------------------
  // A tester's report is a signed kind 1 note, never a chain transaction: it
  // cannot affect an auction, no validator orders it, and it carries no wallet
  // authority. It is signed by a page-local key of its own rather than by the
  // seller or bidder identity, so a report can never be mistaken for consent.
  let feedbackIdentity = null;

  function feedbackTab() {
    return state.tab === "seller" ? "seller" : `bidder-${state.slot}`;
  }

  function setFeedbackStatus(text) {
    $("feedback-status").textContent = text;
  }

  function openFeedback() {
    $("feedback-panel").hidden = false;
    $("feedback-open").setAttribute("aria-expanded", "true");
    $("feedback-text").focus();
  }

  function closeFeedback() {
    $("feedback-panel").hidden = true;
    $("feedback-open").setAttribute("aria-expanded", "false");
  }

  // What the page knows about itself: the protocol in force and what the
  // console actually said. Attached to the note so a report is actionable
  // without a second round trip asking the tester to reproduce it.
  function captureContext() {
    const config = state.config || {};
    const view = state.view?.state || {};
    const validators = Array.isArray(state.validators?.validators) ? state.validators.validators : [];
    const auctions = Object.values(view.auctions || {});
    const open = auctions.filter((auction) => auction.state === "open").length;
    return {
      page: {
        url: window.location.href,
        title: document.title,
        tab: feedbackTab(),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        user_agent: navigator.userAgent,
        captured_at: new Date().toISOString(),
      },
      auction: {
        chain_id: config.chain_id ?? null,
        app_height: view.height ?? null,
        funding_mode_selected: $("funding-mode")?.value ?? null,
        funding_mode_deployment: config.funding_mode ?? null,
        mint_url: config.cashu_mint_url ?? config.mint_url ?? null,
        committee_public_key: config.committee_public_key ?? null,
        max_total_extension_seconds: config.max_total_extension_seconds ?? null,
        emergency_recovery_seconds: config.emergency_recovery_seconds ?? null,
        auctions_open: open,
        auctions_total: auctions.length,
        validators_online: validators.filter((validator) => validator.online).length,
        validators_total: validators.length,
      },
      console: consoleBuffer.slice(-40),
    };
  }

  async function sendFeedback() {
    const text = $("feedback-text").value.trim();
    if (!text) {
      setFeedbackStatus("Write something first.");
      return;
    }
    const button = $("feedback-send");
    button.disabled = true;
    setFeedbackStatus("Signing…");
    try {
      if (!feedbackIdentity) feedbackIdentity = await ensureIdentity("feedback");
      const context = captureContext();
      // The note stays human-readable: the tester's words first, then the
      // machine context as a compact JSON block. A relay query therefore
      // carries the same detail as the durable copy, and the server bounds
      // the total so one report cannot fill the disk.
      const content = `${text}\n\n--- page context ---\n${JSON.stringify(context)}`.slice(0, 3900);
      const event = await feedbackIdentity.signer.signEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["t", "auctions-lab-feedback"], ["client", "plebeian-lab"]],
        content,
      });
      const reply = await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ event, tab: feedbackTab(), context }),
      });
      $("feedback-text").value = "";
      setFeedbackStatus(reply.relay_sent
        ? `Sent as ${short(reply.id)} and published to the relay.`
        : `Kept on the server as ${short(reply.id)}; the relay was unavailable.`);
      toast("Feedback sent.", "success");
    } catch (error) {
      setFeedbackStatus(error.message);
      toast(`Feedback failed: ${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  }

  function wire() {
    for (const button of document.querySelectorAll(".tab")) {
      button.addEventListener("click", () => selectTab(button.dataset.tab, button.dataset.slot ? Number(button.dataset.slot) : undefined));
    }
    $("feedback-open").addEventListener("click", () => {
      if ($("feedback-panel").hidden) openFeedback();
      else closeFeedback();
    });
    $("feedback-close").addEventListener("click", closeFeedback);
    $("feedback-send").addEventListener("click", sendFeedback);
    $("feedback-text").addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeFeedback();
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendFeedback();
    });
    $("honesty-toggle").addEventListener("click", () => {
      const panel = $("honesty");
      panel.hidden = !panel.hidden;
      $("honesty-toggle").setAttribute("aria-expanded", String(!panel.hidden));
    });
    $("randomize").addEventListener("click", randomListing);
    $("seller-new").addEventListener("click", () => newIdentity("seller").catch((error) => toast(error.message, "error")));
    $("bidder-new").addEventListener("click", () => newIdentity(String(state.slot)).catch((error) => toast(error.message, "error")));
    $("create-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy.has("create")) return;
      state.busy.add("create");
      const button = $("create-submit");
      button.disabled = true;
      button.textContent = "Signing…";
      try {
        await createAuction();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        state.busy.delete("create");
        button.disabled = false;
        button.textContent = "Sign and create auction";
      }
    });
    $("bidder-mint").addEventListener("click", async () => {
      if (state.busy.has("mint")) return;
      const amount = Math.floor(Number($("bidder-mint-amount").value));
      if (!Number.isFinite(amount) || amount <= 0) { toast("Enter a whole number of sats to mint.", "error"); return; }
      state.busy.add("mint");
      $("bidder-mint").disabled = true;
      try {
        await mint(currentBidder(), amount);
      } catch (error) {
        toast(error.message, "error");
        setBidderStatus(error.message);
      } finally {
        state.busy.delete("mint");
        renderBidder();
      }
    });
    $("bidder-claim").addEventListener("click", async () => {
      if (state.busy.has("claim")) return;
      state.busy.add("claim");
      $("bidder-claim").disabled = true;
      try {
        await claimRefunds(currentBidder(), true);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        state.busy.delete("claim");
        renderBidder();
      }
    });
    $("bidder-settle").addEventListener("click", async () => {
      if (state.busy.has("settle")) return;
      state.busy.add("settle");
      $("bidder-settle").disabled = true;
      try {
        await settleWins(currentBidder(), true);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        state.busy.delete("settle");
        renderBidder();
      }
    });
    $("seller-import").addEventListener("click", async () => {
      if (state.busy.has("import")) return;
      state.busy.add("import");
      $("seller-import").disabled = true;
      try {
        await importPayouts(state.seller, true);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        state.busy.delete("import");
        renderSeller();
      }
    });
  }

  async function boot() {
    wire();
    randomListing();
    try {
      state.config = await api("/api/config");
    } catch (error) {
      toast(`Could not read /api/config: ${error.message}`, "error");
    }
    try {
      await Promise.all([
        installIdentity("seller"),
        installIdentity("1"),
        installIdentity("2"),
        installIdentity("3"),
      ]);
    } catch (error) {
      toast(`Identity setup failed: ${error.message}`, "error");
    }
    renderIdentities();
    renderSeller();
    renderBidder();
    await refresh();
    setInterval(() => { refresh(); }, REFRESH_MS);
    setInterval(() => {
      if (state.tab === "bidder") renderBidderAuctions(currentBidder());
    }, 1000);
  }

  boot();
})();
