// Headless harness: the same wallet code the page loads, driven against the
// PUBLIC mint origin so the browser's real network path is exercised, not a
// loopback shortcut. Prints one JSON line for the caller.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BidderWallet, memoryStorage } from "./src/wallet";

const MINT = process.env.MINT_URL ?? "https://mint.playday.it";
const REFUND = process.env.REFUND_PUBKEY ?? "";
const AMOUNT = Number(process.env.AMOUNT ?? "128");

// A deterministic throwaway identity standing in for the page's demo signer.
const nostrXOnly = process.env.BIDDER_XONLY
  ?? Buffer.from(createHash("sha256").update("harness").digest()).toString("hex");

const committee = JSON.parse(
  readFileSync(`${process.env.NET_ROOT}/network.json`, "utf8"),
).committee_public_key as string;

const wallet = new BidderWallet(MINT, memoryStorage());
const balance = await wallet.mint(AMOUNT);
const locktime = Math.floor(Date.now() / 1000) + 3600;
const funding = await wallet.lockForBid(AMOUNT, committee, REFUND || `02${nostrXOnly}`, locktime);

// Fail loudly rather than emit a document the server will reject.
if (!funding.proofStateRefs.length) throw new Error("wallet produced no proof references");
console.log(JSON.stringify({ ...funding, minted: balance, heldByBidder: wallet.lockedBalance() }));
