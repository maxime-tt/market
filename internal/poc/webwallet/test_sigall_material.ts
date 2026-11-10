// Wave E3 unit check: the on-chain bid material the browser wallet now builds.
//
// It runs with no network and no mint: it pins (1) the cross-language SIG_ALL
// digest golden vector that must stay byte-identical to internal/poc/sigall.go,
// and (2) the shape of sigAllBidMaterial/buildOutcomeTemplates against exactly
// what consensus rule verifySigAllBidTemplates requires -- the proofs carry
// their secrets, the template inputs are those secrets in the same order, each
// settle output is locked to the auction's committed seller key, each refund
// output to the wallet spend key, and each template's stored digest is the one
// its inputs and outputs derive.
//
//   cd internal/poc/webwallet && bun run test_sigall_material.ts

import { BidderWallet, memoryStorage } from "./src/wallet";
import {
  SIGALL_GOLDEN_INPUTS,
  SIGALL_GOLDEN_BLINDED,
  SIGALL_GOLDEN_DIGEST,
  SIGALL_GOLDEN_OUTPUT_POINT,
  sigAllDigest,
  sigAllOutputPoint,
  sigAllTemplateDigest,
  type SigAllSignedTemplate,
} from "./src/sigall";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
}

// (1) The frozen cross-language digest convention, byte-for-byte with Go.
check("golden SIG_ALL digest matches sigall.go", sigAllDigest(SIGALL_GOLDEN_INPUTS, SIGALL_GOLDEN_BLINDED) === SIGALL_GOLDEN_DIGEST);
// The output-point vector is pinned in sigall_test.go with this exact secret
// and blinding factor r = 11*32.
const goldenSecret = `["P2PK",{"nonce":"${"00".repeat(16)}","data":"02${"aa".repeat(32)}","tags":[["sigflag","SIG_INPUTS"]]}]`;
check("golden output point matches sigall.go", sigAllOutputPoint(goldenSecret, "11".repeat(32)) === SIGALL_GOLDEN_OUTPUT_POINT);

// (2) The on-chain bid material.
const SELLER = `02${"11".repeat(32)}`;
const committee = `02${"22".repeat(32)}`;
const wallet = new BidderWallet("http://127.0.0.1:3338", memoryStorage());
const spendKey = wallet.spendPublicKey();

// Two committed proofs, exactly the shape the SIG_ALL lock produces: a NUT-10
// P2PK JSON secret, its C, amount, keyset id and DLEQ.
const lockedProofs = [64, 64].map((amount, index) => ({
  amount,
  id: "00abcdef01234567",
  secret: JSON.stringify(["P2PK", { nonce: `${"0".repeat(30)}${index}0`, data: spendKey.slice(2), tags: [["sigflag", "SIG_ALL"]] }]),
  C: `02${String(index).repeat(64)}`.slice(0, 66),
  dleq: { e: "aa".repeat(32), s: "bb".repeat(32), r: "cc".repeat(32) },
}));

const funding = {
  proofStateRefs: [],
  tokenSha256: "a".repeat(64),
  refundPublicKey: spendKey,
  amount: 128,
  mintUrl: "http://127.0.0.1:3338",
  proofs: [],
  lockedProofs,
  spendPublicKey: spendKey,
} as never;

const auction = { id: "auc-1", seller_coco_payment_public_key: SELLER };

const material = await wallet.sigAllBidMaterial(auction, funding);

// The proofs travel with their secrets, in the same order as funding.lockedProofs.
check("bid proofs carry their secrets", material.proofs.every((p, i) => p.secret === String(lockedProofs[i].secret)));
check("bid proofs carry amount, id, C, dleq", material.proofs.every((p, i) => p.amount === lockedProofs[i].amount && p.id === lockedProofs[i].id && p.C === lockedProofs[i].C && !!p.dleq));
check("bid proofs sum to the bid amount", material.proofs.reduce((t, p) => t + p.amount, 0) === 128);

const settle = material.outcome_templates.settle;
const refund = material.outcome_templates.refund;

check("settle inputs ARE the committed proof secrets, in order", settle.inputs.length === material.proofs.length && settle.inputs.every((input, i) => input.secret === material.proofs[i].secret));
check("refund inputs ARE the committed proof secrets, in order", refund.inputs.length === material.proofs.length && refund.inputs.every((input, i) => input.secret === material.proofs[i].secret));
check("each template's outputs sum to the bid amount", settle.outputs.reduce((t, o) => t + o.amount, 0) === 128 && refund.outputs.reduce((t, o) => t + o.amount, 0) === 128);
check("each template output names a keyset", settle.outputs.every((o) => o.id === lockedProofs[0].id) && refund.outputs.every((o) => o.id === lockedProofs[0].id));

const recipientOf = (secret: string): string => (JSON.parse(secret) as [string, { data: string }])[1].data;
check("settle outputs are locked to the auction's committed seller key", settle.outputs.every((o) => recipientOf(o.secret) === SELLER));
check("refund outputs are locked to the wallet spend key", refund.outputs.every((o) => recipientOf(o.secret) === spendKey));

const reDerive = (t: SigAllSignedTemplate) => sigAllTemplateDigest(t);
check("settle stored digest is the one its inputs and outputs derive", settle.digest === reDerive(settle));
check("refund stored digest is the one its inputs and outputs derive", refund.digest === reDerive(refund));
check("both templates carry a signature", settle.bidder_signature.length === 128 && refund.bidder_signature.length === 128);

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
