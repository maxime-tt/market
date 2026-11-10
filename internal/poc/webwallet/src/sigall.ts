// The SIG_ALL outcome templates, bidder side.
//
// Under cashu_lock_v1 a single-key NUT-11 P2PK witness signs only the proof
// secret, so whoever holds the locked proofs can spend them anywhere. The
// SIG_ALL route locks with `sigflag=SIG_ALL`, where the signature covers the
// whole transaction -- inputs AND outputs -- so the coordinator's power is
// exactly "submit one of the two outcomes the bidder pre-authorized", and the
// destination is provably the one the bidder chose.
//
// The digest convention is Nutshell 0.19.2's SIG_ALL message and is frozen by
// SLICE-B-WAVE1-BRIEF.md §3:
//
//	sha256( concat(input proof secrets, in order) || concat(output B_ hex, in order) )
//
// It is implemented once here and once in Go at internal/poc/sigall.go. cashu-ts
// derives a DIFFERENT SIG_ALL message, so its own helper is deliberately unused.
// Keep SIGALL_GOLDEN_* byte-for-byte aligned with sigAllGolden* in sigall.go;
// both are pinned by tests.

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { hashToCurve } from "@cashu/cashu-ts";

export const SIGALL_TEMPLATES_SCHEMA = "PlebeianAuctionsPOCSigAllTemplatesV1";

/** The shared golden vector. Keep aligned with internal/poc/sigall.go. */
export const SIGALL_GOLDEN_INPUTS = ["sigall-golden-secret-0001", "sigall-golden-secret-0002"];
export const SIGALL_GOLDEN_BLINDED = [
  `02${"aa".repeat(32)}`,
  `03${"bb".repeat(32)}`,
];
export const SIGALL_GOLDEN_DIGEST = "54fe6fe064563ecd412a19c79f8c966c82b317448dd6ce1e8b8b9009d841adce";
/** Pins the B_ = hash_to_curve(secret) + r*G derivation for the vector above. */
export const SIGALL_GOLDEN_OUTPUT_POINT = "0336bf38b85ee80f36950f9a05f22c0f36576118dcb30b5300b5a9f73bd41af17e";

/** One locked proof offered for an outcome. Bearer material: deposit only. */
export interface SigAllTemplateInput {
  amount: number;
  id: string;
  secret: string;
  C: string;
}

/** One fresh proof an outcome creates, with the opening the coordinator needs. */
export interface SigAllTemplateOutput {
  amount: number;
  id: string;
  secret: string;
  r: string;
}

/** One exact outcome transaction plus the bidder's signature over its digest. */
export interface SigAllSignedTemplate {
  inputs: SigAllTemplateInput[];
  outputs: SigAllTemplateOutput[];
  digest: string;
  bidder_signature: string;
}

/**
 * The two outcome templates the wallet commits IN the bid content (json
 * `outcome_templates`). This is the exact shape of Go's `sigAllDepositTemplates`
 * carrier, which is why the name is kept: the FULL signed templates travel on
 * chain, not a compact commitment. Consensus (verifySigAllBidTemplates)
 * re-derives each digest and re-checks the bidder's signature, so the
 * coordinator can submit one of these two transactions with the bidder offline.
 */
export interface SigAllDepositTemplates {
  settle: SigAllSignedTemplate;
  refund: SigAllSignedTemplate;
}

/** Nutshell's SIG_ALL message, hashed once. */
export function sigAllDigest(inputSecrets: string[], blinded: string[]): string {
  return bytesToHex(sha256(utf8ToBytes(inputSecrets.join("") + blinded.join(""))));
}

/** A fresh 32-byte lowercase-hex blinding factor. */
export function randomBlindingHex(): string {
  return bytesToHex(secp256k1.utils.randomSecretKey());
}

/** B_ = hash_to_curve(secret) + r*G, hex, the point the mint signs. */
export function sigAllOutputPoint(secret: string, rHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(rHex)) throw new Error("template output blinding factor must be 32 lowercase hex bytes");
  const yHex = hashToCurve(new TextEncoder().encode(secret)).toHex(true);
  const Y = secp256k1.Point.fromHex(yHex);
  const B_ = Y.add(secp256k1.Point.BASE.multiply(BigInt(`0x${rHex}`)));
  return bytesToHex(B_.toBytes(true));
}

/** The (§3) digest of one exact template: input secrets then output B_ points. */
export function sigAllTemplateDigest(template: SigAllSignedTemplate): string {
  return sigAllDigest(
    template.inputs.map((input) => input.secret),
    template.outputs.map((output) => sigAllOutputPoint(output.secret, output.r)),
  );
}

/** Build a NUT-10 P2PK output secret locked to one compressed recipient key. */
export function buildP2PKOutputSecret(recipient: string, nonce: string): string {
  if (!/^0[23][0-9a-f]{64}$/.test(recipient)) throw new Error("output recipient must be a compressed secp256k1 key");
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error("output secret nonce must be 16 lowercase hex bytes");
  return JSON.stringify([
    "P2PK",
    { nonce, data: recipient, tags: [["sigflag", "SIG_INPUTS"]] },
  ]);
}

/** Sign a template digest with the wallet spend key (BIP-340). */
export function signDigest(digestHex: string, spendSecretKey: Uint8Array): string {
  return bytesToHex(schnorr.sign(hexToBytes(digestHex), spendSecretKey));
}
