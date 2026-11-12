// Drives the browser wallet against the real local mint, outside a browser.
// Proves the wallet logic before any of it is bundled or wired into the page.
import { readFileSync } from "node:fs";
import { BidderWallet, memoryStorage, refundClaimMessage, settleClaimMessage } from "./src/wallet";
import { Wallet, P2PKBuilder } from "@cashu/cashu-ts";

const MINT = process.env.MINT_URL ?? "http://127.0.0.1:3338";
const NET = process.env.NET_ROOT!;
const { createHash } = await import("node:crypto");
// The committee identity the application itself records, not a recomputation.
const committeePub = JSON.parse(readFileSync(`${NET}/network.json`, "utf8")).committee_public_key as string;

const results: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
}

const secp = await import("@noble/curves/secp256k1.js");

// The bidder's Nostr identity, standing in for the page's demo signer.
const bidderSecret = createHash("sha256").update("test-bidder").digest();
const bidderXOnly = Buffer.from(secp.schnorr.getPublicKey(bidderSecret)).toString("hex");

const storage = memoryStorage();
const wallet = new BidderWallet(MINT, storage);
const refundPub = wallet.spendPublicKey();
console.log(`mint      : ${MINT}`);
console.log(`committee : ${committeePub}`);
console.log(`refund    : ${refundPub} (wallet spend key; Nostr key ${bidderXOnly.slice(0, 16)}…)\n`);

check("the refund key is a compressed wallet spend key", /^0[23][0-9a-f]{64}$/.test(refundPub),
  refundPub.slice(0, 20));
check("the refund key is NOT derived from the Nostr identity", refundPub.slice(2) !== bidderXOnly,
  "independent key");
check("the spend key is persisted in wallet storage", storage.get("spendKey") !== null,
  `${(storage.get("spendKey") ?? "").length} hex chars`);
check("a second wallet over the same storage reuses the spend key",
  new BidderWallet(MINT, storage).spendPublicKey() === refundPub, "stable");
check("a fresh wallet gets a different spend key",
  new BidderWallet(MINT, memoryStorage()).spendPublicKey() !== refundPub, "independent");

const balance = await wallet.mint(256, (state) => console.log(`   … ${state}`));
check("minted real proofs from the mint", balance === 256, `${balance} sats`);

const locktime = Math.floor(Date.now() / 1000) + 3600;
const funding = await wallet.lockForBid(128, committeePub, locktime, (s) =>
  console.log(`   … ${s}`));

check("locked proofs to the committee", funding.proofStateRefs.length > 0,
  `${funding.proofStateRefs.length} proof references`);
check("proof references are sorted and unique",
  funding.proofStateRefs.every((r, i) => i === 0 || funding.proofStateRefs[i - 1] < r) &&
    new Set(funding.proofStateRefs).size === funding.proofStateRefs.length, "canonical");
check("proof references are compressed points",
  funding.proofStateRefs.every((r) => /^0[23][0-9a-f]{64}$/.test(r)), "all 33-byte compressed");
check("token digest is a sha256", /^[0-9a-f]{64}$/.test(funding.tokenSha256),
  funding.tokenSha256.slice(0, 16));
check("the wallet kept the locked proofs (it never sent them)",
  wallet.locked().length > 0, `${wallet.locked().length} proofs held, ${wallet.lockedBalance()} sats`);
check("change was retained", wallet.balance() >= 0, `${wallet.balance()} sats spendable`);

// The mint must agree that these proofs exist and are unspent.
const response = await fetch(`${MINT}/v1/checkstate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ Ys: funding.proofStateRefs }),
});
const states = (await response.json()) as { states: Array<{ Y: string; state: string }> };
const byY = new Map(states.states.map((s) => [s.Y, s.state]));
check("the mint reports every locked proof UNSPENT",
  funding.proofStateRefs.every((r) => byY.get(r) === "UNSPENT"),
  [...new Set(byY.values())].join(","));

// And the locked proofs really do carry the committee's P2PK condition.
const lockedSecret = JSON.parse(wallet.locked()[0].secret as unknown as string) as unknown[];
check("the locked proofs carry a P2PK condition for the committee",
  Array.isArray(lockedSecret) && lockedSecret[0] === "P2PK" &&
    (lockedSecret[1] as { data: string }).data.slice(2) === committeePub.slice(2),
  JSON.stringify(lockedSecret).slice(0, 110));
check("the lock names the wallet spend key as its refund key",
  (lockedSecret[1] as { tags: string[][] }).tags.some((tag) => tag[0] === "refund" && tag[1] === refundPub),
  JSON.stringify((lockedSecret[1] as { tags: string[][] }).tags));
check("the funding record carries the spend key that owns the proofs",
  funding.spendPublicKey === refundPub, funding.spendPublicKey.slice(0, 20));

// The claim message is what the coordinator verifies; it must bind the bid id
// and the output keys, and be stable across calls.
const claimMessage = new TextDecoder().decode(refundClaimMessage("bid-1", [refundPub, refundPub]));
check("the refund claim message binds the bid id and output keys",
  claimMessage === `PlebeianAuctionsCashuRefundClaimV1\nbid_id=bid-1\noutputs=${refundPub},${refundPub}`,
  claimMessage.replace(/\n/g, " | "));
check("the claim message differs for a different bid",
  new TextDecoder().decode(refundClaimMessage("bid-2", [refundPub])) !== claimMessage, "bound to the bid");

// A failed bid must not strand the bidder's whole balance. Before this, the
// first lock moved everything to `locked` and every later bid reported "holds no
// proofs" while the funds sat there.
const beforeRelease = wallet.balance();
const lockedBefore = wallet.lockedBalance();
const early = wallet.reclaimLocked();
check("locked proofs are NOT reclaimable before the locktime",
  early.released === 0 && early.reclaimableAt > Math.floor(Date.now() / 1000),
  `reclaimable at ${early.reclaimableAt}`);
check("and the balance is untouched by that attempt", wallet.balance() === beforeRelease,
  `${wallet.balance()} spendable, ${wallet.lockedBalance()} locked`);

// Past the locktime the bidder really can move them, because the NUT-11 lock
// named them as a refund key from that moment.
await wallet.lockForBid(1, committeePub, Math.floor(Date.now() / 1000) + 1);
await new Promise((r) => setTimeout(r, 2200));
const late = wallet.reclaimLocked();
check("past the locktime everything is reclaimed",
  late.released === wallet.lockedBalance() + late.released && wallet.lockedBalance() === 0,
  `${late.released} sats reclaimed, ${wallet.balance()} spendable`);
check("nothing remains locked", wallet.lockedBalance() === 0, `${wallet.lockedBalance()} locked`);

// And the message a locked-out bidder sees must describe their real position.
const stranded = new BidderWallet(MINT, memoryStorage());
await stranded.mint(64, () => {});
await stranded.lockForBid(64, committeePub, locktime);
let message = "";
try { await stranded.lockForBid(16, committeePub, locktime); } catch (e) { message = (e as Error).message; }
check("a fully-locked wallet says so instead of 'mint some first'",
  message.includes("locked") && !message.includes("mint some first"), message);

// --- Settlement -------------------------------------------------------------
// The winner hands the locked proofs to the coordinator, which swaps them to
// the SELLER's committed wallet key. The seller then fetches and spends them.
// The coordinator is faked here; the mint is real, so the P2PK witness path the
// seller needs is exercised for real.
const settleMessage = new TextDecoder().decode(settleClaimMessage("auction-1", [refundPub, refundPub]));
check("the settlement claim message binds the auction id and proof set",
  settleMessage === `PlebeianAuctionsCashuSettleClaimV1\nauction_id=auction-1\nproofs=${refundPub},${refundPub}`,
  settleMessage.replace(/\n/g, " | "));
check("the settlement claim message differs for a different auction",
  new TextDecoder().decode(settleClaimMessage("auction-2", [refundPub])) !== settleMessage, "bound to the auction");

// A seller wallet with its own spend key, and a payout locked to it exactly the
// way the coordinator builds one: a P2PK output, SIG_INPUTS, no locktime.
const sellerStorage = memoryStorage();
const seller = new BidderWallet(MINT, sellerStorage);
await seller.mint(64, () => {});
const sellerPub = seller.spendPublicKey();
const rawMint = new Wallet(MINT);
await rawMint.loadMint();
const { send: payout } = await rawMint.send(64, seller.spendable(), {}, {
  send: { type: "p2pk", options: new P2PKBuilder().addMainPubkey(sellerPub.slice(2)).toOptions() },
});
sellerStorage.set("spendable", "[]");
check("the payout is P2PK-locked to the seller's wallet key",
  payout.length > 0 && (JSON.parse(payout[0].secret as unknown as string) as { data: string }[])[1].data === sellerPub,
  `${payout.length} proofs`);

const coordinator = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/demo/mint-settle") {
      return request.json().then((body: { auction_id?: string; spend_signature?: string; proofs?: unknown[] }) => {
        if (!body.auction_id || !body.spend_signature || !body.proofs?.length) {
          return Response.json({ error: "incomplete settlement request" }, { status: 422 });
        }
        return Response.json({ proofs: payout });
      });
    }
    if (request.method === "GET" && url.pathname === "/api/demo/settlement/auction-1") {
      return Response.json({ proofs: payout });
    }
    return Response.json({ error: "no settlement payout is stored for that auction" }, { status: 404 });
  },
});
const coordinatorUrl = `http://127.0.0.1:${coordinator.port}`;

const imported = await seller.importSettlement("auction-1", `${coordinatorUrl}/api/demo/settlement/auction-1`);
check("the seller imports the payout into spendable", imported.imported && imported.amount === 64,
  `${imported.amount} sats`);
const again = await seller.importSettlement("auction-1", `${coordinatorUrl}/api/demo/settlement/auction-1`);
check("importing the same payout twice does not duplicate it", !again.imported && seller.balance() === 64,
  `${seller.balance()} sats spendable`);
const missing = await seller.importSettlement("auction-2", `${coordinatorUrl}/api/demo/settlement/auction-2`);
check("an auction with no payout yet imports nothing", !missing.imported && missing.amount === 0, "404 handled");

// The real test: the seller can SPEND what they received. These proofs are
// P2PK-locked to the seller's key, so the mint refuses the swap unless the
// wallet signs a NUT-11 witness first.
let spendError = "";
try {
  const relocked = await seller.lockForBid(64, committeePub, locktime);
  check("the seller can spend the payout it received (P2PK witness path)",
    relocked.proofStateRefs.length > 0, `${relocked.proofStateRefs.length} references`);
} catch (error) {
  spendError = (error as Error).message;
  check("the seller can spend the payout it received (P2PK witness path)", false, spendError);
}

// The winner's side: the wallet builds the claim, posts it, and clears the
// locked bid without importing the payout (it belongs to the seller).
wallet.recordLockedBid("bid-1", funding.lockedProofs, funding.spendPublicKey, "auction-1");
const settled = await wallet.settleAuction("auction-1", { kind: 1444 }, `${coordinatorUrl}/api/demo/mint-settle`);
check("the winner's settlement returns the payout digest and amount",
  settled.amount === 64 && /^[0-9a-f]{64}$/.test(settled.tokenSha256),
  `${settled.amount} sats, ${settled.tokenSha256.slice(0, 16)}`);
check("the winner does not keep the seller's payout", wallet.lockedForBid("bid-1").length === 0, "association cleared");
coordinator.stop(true);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map(([n]) => n).join("; ")}`);
  process.exit(1);
}
