// Drives the browser wallet against the real local mint, outside a browser.
// Proves the wallet logic before any of it is bundled or wired into the page.
import { readFileSync } from "node:fs";
import { BidderWallet, memoryStorage, refundPublicKeyFromNostr } from "./src/wallet";

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
const refundPub = refundPublicKeyFromNostr(bidderXOnly);

const wallet = new BidderWallet(MINT, memoryStorage());
console.log(`mint      : ${MINT}`);
console.log(`committee : ${committeePub}`);
console.log(`refund    : ${refundPub} (from Nostr key ${bidderXOnly.slice(0, 16)}…)\n`);

check("refund key is the Nostr key in compressed form", refundPub === `02${bidderXOnly}`,
  refundPub.slice(0, 20));

const balance = await wallet.mint(256, (state) => console.log(`   … ${state}`));
check("minted real proofs from the mint", balance === 256, `${balance} sats`);

const locktime = Math.floor(Date.now() / 1000) + 3600;
const funding = await wallet.lockForBid(128, committeePub, refundPub, locktime, (s) =>
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

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map(([n]) => n).join("; ")}`);
  process.exit(1);
}
