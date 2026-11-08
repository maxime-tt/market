// What the coordinator actually receives at bid time, and whether the locked
// secret is reconstructible from public parts. This decides whether the
// committee key alone can spend a locked proof (no bidder online, no deposit).
import { BidderWallet, memoryStorage } from "./src/wallet";
import { hashToCurve } from "@cashu/cashu-ts";

const API = "http://127.0.0.1:8080";
const cfg = await (await fetch(`${API}/api/config`)).json();
const committee: string = cfg.committee_public_key;
const wallet = new BidderWallet(cfg.cashu_mint_url ?? "https://mint.playday.it", memoryStorage());

await wallet.mint(64);
const locktime = Math.floor(Date.now() / 1000) + 3600;
const fund = await wallet.lockForBid(64, committee, locktime);

console.log("=== locked proof the BIDDER keeps (spendable material) ===");
for (const p of fund.lockedProofs ?? []) {
  console.log(JSON.stringify(p, null, 1));
}
console.log("=== binding the COORDINATOR receives with the bid ===");
console.log(JSON.stringify(fund.proofs, null, 1));
console.log("=== refs / token / refund key ===");
console.log(JSON.stringify({ refs: fund.proofStateRefs, tokenSha256: fund.tokenSha256, refundPublicKey: fund.refundPublicKey }));

const secret = String((fund.lockedProofs ?? [])[0]?.secret ?? "");
const Y = String(fund.proofStateRefs?.[0] ?? "");
console.log("=== secret format ===");
console.log("secret:", secret);
console.log("Y      :", Y);

// Is the secret reconstructible from what the coordinator already knows: the
// committee key (its own), the bidder's refund key, the locktime?
const xonly = (k: string) => k.slice(2);
const candidates = [
  `P2PK${committee}`,
  `P2PK${xonly(committee)}`,
  `P2PK${fund.refundPublicKey}`,
  `P2PK${xonly(fund.refundPublicKey)}`,
];
let match = secret.length > 0 && candidates.includes(secret);
if (!match) {
  for (const c of candidates) {
    const point = hashToCurve(new TextEncoder().encode(c)).toHex(true);
    if (point === Y) { match = true; console.log("RECONSTRUCTED from candidate:", JSON.stringify(c)); break; }
  }
}
console.log("=== verdict ===");
console.log("secret in the binding the coordinator receives?", JSON.stringify(Object.keys(fund.proofs?.[0] ?? {})));
console.log("hash_to_curve(secret) === the Y the coordinator receives?",
  hashToCurve(new TextEncoder().encode(secret)).toHex(true) === Y);
console.log("secret reconstructible from public parts alone?", match);
