import { P2PKBuilder, OutputData } from "@cashu/cashu-ts";
import pkg from "@cashu/cashu-ts/package.json";
const bidder = "02" + "11".repeat(32), committee = "02" + "22".repeat(32);
const xonly = (k: string) => k.slice(2);
console.log("VERSION:", (pkg as any).version);
for (const n of [1, 2]) {
  try {
    const b = new P2PKBuilder()
      .addMainPubkey(xonly(bidder)).addMainPubkey(xonly(committee))
      .requireMainSignatures(2)
      .addRefundPubkey(xonly(bidder))
      .requireRefundSignatures(n)
      .sigAll().lockUntil(1800000000);
    const od: any = (OutputData as any).createSingleP2PKData(b.toOptions(), 64, "00abcdef01234567");
    const s = new TextDecoder().decode(od.secret); const p = JSON.parse(s);
    console.log(`nRefund=${n} TAGS(${p[1].tags.length}):`, JSON.stringify(p[1].tags));
    console.log("  SECRET:", s);
  } catch (e:any) { console.log(`nRefund=${n} ERROR: ${e.message}`); }
}
