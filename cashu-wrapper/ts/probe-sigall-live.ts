/**
 * probe-sigall-live.ts — SLICE B0: prove on the LIVE mint that a NUT-11 2-of-2
 * SIG_ALL P2PK lock can be created and spent, that one signature is refused,
 * that the destination is pinned, and record the exact accepted digest.
 *
 * Run:  PATH="$HOME/.bun/bin:$PATH" bun run probe-sigall-live.ts
 * from this directory (cashu-wrapper/ts), whose node_modules has cashu-ts 5.0.0-rc.4.
 *
 * Reuses the repo's existing digest convention: demoCashuSigAllDigest() from
 * ./demo-sigall-settlement = sha256( concat(input secrets) + concat(output B_) ).
 * That is Nutshell 0.19.2's SIG_ALL message. cashu-ts 5.0.0-rc.4 derives a
 * DIFFERENT one; both are printed in step 6.
 *
 * Freshly generated keypairs only. The real committee key is never read or used.
 * Fake, worthless sats; small consumption.
 */
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  buildP2PKSigAllMessage as cashuTsSigAllMessage,
  buildLegacyP2PKSigAllMessage as cashuTsLegacySigAllMessage,
  computeMessageDigest as cashuTsDigest,
} from '@cashu/cashu-ts'

import {
  CashuMintClient,
  CashuMintError,
  buildBlindedOutputs,
  hashToCurve,
  inputFee,
  keysetPublicKey,
  parseP2PKSecret,
  randomSecretHex,
  blindMessage,
  unblindBlindedSignature,
  type BlindedMessage,
  type CashuProof,
} from './nut-client'
import { demoCashuSigAllDigest } from './demo-sigall-settlement'

const MINT = 'https://mint.playday.it'
const log = (...parts: unknown[]) => console.log(...parts)
const section = (n: number, title: string) => log(`\n===== STEP ${n}: ${title} =====`)

function keypair(label: string) {
  const { secretKey } = schnorr.keygen()
  const priv = bytesToHex(secretKey)
  const pubCompressed = bytesToHex(secp256k1.getPublicKey(secretKey, true))
  const pubXOnly = bytesToHex(schnorr.getPublicKey(secretKey))
  return { label, priv, pubCompressed, pubXOnly }
}

function sign(digestHex: string, priv: string): string {
  return bytesToHex(schnorr.sign(hexToBytes(digestHex), hexToBytes(priv)))
}

/** NUT-10 canonical P2PK secret, tag order matching the repo's buildDemoSigAllSecret. */
function buildLockSecret(o: {
  nonce: string; data: string; committee: string; refund: string; locktime: number
}): string {
  return JSON.stringify(['P2PK', {
    nonce: o.nonce,
    data: o.data,
    tags: [
      ['locktime', String(o.locktime)],
      ['pubkeys', o.committee],
      ['n_sigs', '2'],
      ['refund', o.refund],
      ['sigflag', 'SIG_ALL'],
    ],
  }])
}

async function checkState(proofs: CashuProof[]): Promise<unknown> {
  const Ys = proofs.map((p) => hashToCurve(p.secret).toHex(true))
  const response = await fetch(`${MINT}/v1/checkstate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Ys }),
  })
  return response.json()
}

async function main() {
  log(`mint: ${MINT}`)
  const client = new CashuMintClient({ mintUrl: MINT })

  const info = await client.info()
  log(`mint version: ${info.version}`)
  log(`NUT-10 supported: ${(info.nuts as any)?.['10']?.supported}  NUT-11 supported: ${(info.nuts as any)?.['11']?.supported}`)
  const keyset = await client.activeKeyset('sat')
  if (!keyset) throw new Error('no active sat keyset')
  const keysetId = keyset.id
  const feePpk = keyset.input_fee_ppk ?? 0
  log(`active sat keyset: ${keysetId}  input_fee_ppk: ${feePpk}`)
  const keysResponse = await client.keys(keysetId)
  const keys = keysResponse.keysets[0]!
  const mintPublicKey = (a: number) => keysetPublicKey(keys, a)

  // ---- Fresh keys ----
  const bidder = keypair('bidder')       // main key #1 (data)
  const committee = keypair('committee') // main key #2 (pubkeys tag)
  const recipient = keypair('recipient') // plain destination for the successful spend
  const redirect = keypair('redirect')   // third destination for step 7 (T')
  log(`\nfresh keys (public only):`)
  log(`  bidder    data      = ${bidder.pubCompressed}`)
  log(`  committee pubkeys   = ${committee.pubCompressed}`)
  log(`  refund              = ${bidder.pubCompressed} (the bidder's own key, per brief)`)
  log(`  recipient (plain)   = ${recipient.pubCompressed}`)
  log(`  redirect  (T')      = ${redirect.pubCompressed}`)

  // ---- STEP 1: create the lock ----
  section(1, 'CREATE the 2-of-2 SIG_ALL lock (mint 128, swap into two 64-sat locks)')
  const nowSeconds = Math.floor(Date.now() / 1000)
  const locktime = nowSeconds + 86_400
  log(`now=${nowSeconds}  locktime=${locktime} (future)`)

  const quote = await client.createMintQuote(128, 'sat')
  log(`mint quote: ${quote.quote}  state=${quote.state}`)
  await client.awaitMintQuotePaid(quote.quote, { intervalMs: 500, timeoutMs: 30_000 })
  const { outputs: mintOutputs, blindings: mintBlindings } = (() => {
    const parts = [128]
    return buildBlindedOutputs(parts, keysetId)
  })()
  const mintResult = await client.mint(quote.quote, mintOutputs)
  const minted: CashuProof[] = mintResult.signatures.map((s, i) =>
    unblindBlindedSignature(s, mintBlindings[i]!, mintPublicKey(mintOutputs[i]!.amount)))
  log(`minted proofs: ${JSON.stringify(minted.map((p) => ({ amount: p.amount, id: p.id })))}`)
  log(`minted secrets: ${minted.map((p) => p.secret).join(', ')}`)

  // Two locked outputs of 64 each. Fee is 0 here (ppk=0), asserted, so balance is exact.
  const lockedOutputs: BlindedMessage[] = []
  const lockedBlindings = []
  const lockSecrets: string[] = []
  for (let i = 0; i < 2; i++) {
    const secret = buildLockSecret({ nonce: randomSecretHex(), data: bidder.pubCompressed, committee: committee.pubCompressed, refund: bidder.pubCompressed, locktime })
    lockSecrets.push(secret)
    const b = blindMessage(secret)
    lockedBlindings.push(b)
    lockedOutputs.push({ amount: 64, id: keysetId, B_: b.B_ })
  }
  const gross = minted.reduce((t, p) => t + p.amount, 0)
  const fee = inputFee(feePpk, minted.length)
  log(`inputs gross=${gross} fee=${fee} outputs=${lockedOutputs.reduce((t, o) => t + o.amount, 0)}`)

  const createSwap = await client.swap(minted, lockedOutputs)
  log(`RAW create-swap response: ${JSON.stringify(createSwap)}`)
  const locked: CashuProof[] = createSwap.signatures.map((s, i) =>
    unblindBlindedSignature(s, lockedBlindings[i]!, mintPublicKey(lockedOutputs[i]!.amount)))
  log(`locked proofs: ${JSON.stringify(locked.map((p) => ({ amount: p.amount, id: p.id })))}`)

  // ---- STEP 2: re-read the token ----
  section(2, 'RE-READ: assert the secret carries pubkeys/n_sigs=2/sigflag=SIG_ALL/refund/locktime')
  let step2Pass = true
  for (const [i, p] of locked.entries()) {
    const parsed = parseP2PKSecret(p.secret)
    log(`\nproof[${i}].secret = ${p.secret}`)
    if (!parsed) { step2Pass = false; log(`  FAIL: not parseable as NUT-10 P2PK`); continue }
    const tags = new Map(parsed.tags.map(([k, v]) => [k, v]))
    log(`  data    = ${parsed.data}  (== bidder: ${parsed.data === bidder.pubCompressed})`)
    log(`  pubkeys = ${tags.get('pubkeys')}  (== committee: ${tags.get('pubkeys') === committee.pubCompressed})`)
    log(`  n_sigs  = ${tags.get('n_sigs')}  (== 2: ${tags.get('n_sigs') === '2'})`)
    log(`  refund  = ${tags.get('refund')}  (== bidder: ${tags.get('refund') === bidder.pubCompressed})`)
    log(`  sigflag = ${tags.get('sigflag')}  (== SIG_ALL: ${tags.get('sigflag') === 'SIG_ALL'})`)
    log(`  locktime= ${tags.get('locktime')}  (== ${locktime}: ${tags.get('locktime') === String(locktime)})`)
    const ok = parsed.data === bidder.pubCompressed && tags.get('pubkeys') === committee.pubCompressed
      && tags.get('n_sigs') === '2' && tags.get('refund') === bidder.pubCompressed
      && tags.get('sigflag') === 'SIG_ALL' && tags.get('locktime') === String(locktime)
    if (!ok) step2Pass = false
    if (p.secret !== lockSecrets[i]) { step2Pass = false; log(`  FAIL: secret changed through the mint`) }
  }
  const state2 = await checkState(locked)
  log(`\nraw NUT-07 checkstate: ${JSON.stringify(state2)}`)
  log(`STEP 2: ${step2Pass ? 'PASS' : 'FAIL'}`)

  const proofA = locked[0]!
  const proofB = locked[1]!

  // ---- STEP 3: ONE signature must be refused ----
  section(3, 'SPEND with ONE signature (bidder only) — must be REFUSED')
  const { outputs: oneOutputs, blindings: oneBlindings } = buildBlindedOutputs([64], keysetId)
  const oneDigest = demoCashuSigAllDigest([proofA], oneOutputs)
  const oneSignature = sign(oneDigest, bidder.priv)
  const oneWitness = JSON.stringify({ signatures: [oneSignature] })
  try {
    const r = await client.swap([{ ...proofA, witness: oneWitness }], oneOutputs)
    log(`STEP 3: FAIL — mint ACCEPTED a single signature: ${JSON.stringify(r)}`)
  } catch (error) {
    if (error instanceof CashuMintError) {
      log(`mint refused: HTTP ${error.status}`)
      log(`RAW body: ${error.body}`)
    } else {
      log(`unexpected error: ${String(error)}`)
    }
    log(`STEP 3: PASS (refused)`)
  }
  void oneBlindings

  // ---- STEP 4: BOTH signatures must succeed ----
  section(4, 'SPEND with BOTH signatures (bidder + committee) — must SUCCEED')
  const { outputs: bothOutputs, blindings: bothBlindings } = buildBlindedOutputs([64], keysetId)
  const bothDigest = demoCashuSigAllDigest([proofA], bothOutputs)
  const sigBidder = sign(bothDigest, bidder.priv)
  const sigCommittee = sign(bothDigest, committee.priv)
  const bothWitness = JSON.stringify({ signatures: [sigBidder, sigCommittee] })
  log(`accepted SIG_ALL message preimage (utf8): ${[proofA.secret, ...bothOutputs.map((o) => o.B_)].join('')}`)
  log(`accepted SIG_ALL digest (sha256 hex): ${bothDigest}`)
  log(`witness on input[0]: ${bothWitness}`)
  const bothSwap = await client.swap([{ ...proofA, witness: bothWitness }], bothOutputs)
  log(`RAW both-signature swap response: ${JSON.stringify(bothSwap)}`)
  const spent: CashuProof[] = bothSwap.signatures.map((s, i) =>
    unblindBlindedSignature(s, bothBlindings[i]!, mintPublicKey(bothOutputs[i]!.amount)))
  log(`new proofs: ${JSON.stringify(spent)}`)
  log(`STEP 4: PASS`)

  // ---- STEP 5: the money is real ----
  section(5, 'PROVE the money is real: NUT-07 state of the new proofs, then a plain swap')
  const state5 = await checkState(spent)
  log(`raw NUT-07 checkstate of new proofs: ${JSON.stringify(state5)}`)
  const oldState = await checkState([proofA])
  log(`raw NUT-07 checkstate of the spent P2PK lock: ${JSON.stringify(oldState)}`)
  const { outputs: plainOutputs, blindings: plainBlindings } = buildBlindedOutputs([64], keysetId)
  const plainSwap = await client.swap(spent, plainOutputs)
  log(`RAW plain re-spend response: ${JSON.stringify(plainSwap)}`)
  const finalProofs: CashuProof[] = plainSwap.signatures.map((s, i) =>
    unblindBlindedSignature(s, plainBlindings[i]!, mintPublicKey(plainOutputs[i]!.amount)))
  log(`final proofs: ${JSON.stringify(finalProofs)}`)
  log(`STEP 5: ${plainSwap.signatures.length === 1 ? 'PASS' : 'FAIL'}`)

  // ---- STEP 6: record the digest, exactly, and the difference ----
  section(6, 'RECORD the digest: Nutshell-accepted vs cashu-ts-derived')
  const nutsHellMessage = [proofA.secret, ...bothOutputs.map((o) => o.B_)].join('')
  const nutsHellDigest = bytesToHex(sha256(utf8ToBytes(nutsHellMessage)))
  log(`Nutshell accepted message (utf8): ${nutsHellMessage}`)
  log(`Nutshell accepted message (hex) : ${bytesToHex(utf8ToBytes(nutsHellMessage))}`)
  log(`Nutshell accepted digest sha256 : ${nutsHellDigest}`)
  log(`repo demoCashuSigAllDigest()     : ${bothDigest}`)
  log(`digests equal                    : ${nutsHellDigest === bothDigest}`)
  log(`signature verifies on this digest: ${schnorr.verify(hexToBytes(sigBidder), hexToBytes(nutsHellDigest), hexToBytes(bidder.pubXOnly))}`)

  const tsInputs = [{ secret: proofA.secret, C: proofA.C }]
  const tsOutputs = bothOutputs.map((o) => ({ blindedMessage: { amount: o.amount, B_: o.B_ } }))
  const tsCurrentMessage = cashuTsSigAllMessage(tsInputs as any, tsOutputs as any)
  const tsLegacyMessage = cashuTsLegacySigAllMessage(tsInputs as any, tsOutputs as any)
  log(`\ncashu-ts buildP2PKSigAllMessage (current) message: ${tsCurrentMessage}`)
  log(`cashu-ts current digest (hex): ${cashuTsDigest(tsCurrentMessage, true)}`)
  log(`cashu-ts buildLegacyP2PKSigAllMessage message    : ${tsLegacyMessage}`)
  log(`cashu-ts legacy digest (hex) : ${cashuTsDigest(tsLegacyMessage, true)}`)

  // ---- STEP 7: destination is pinned ----
  section(7, 'DESTINATION PINNED: signatures over T cannot be reused on a different transaction T\'')
  // Transaction T: spend proofB to `recipient`.
  const { outputs: tOutputs } = buildBlindedOutputs([64], keysetId)
  const tDigest = demoCashuSigAllDigest([proofB], tOutputs)
  const tSigs = JSON.stringify({ signatures: [sign(tDigest, bidder.priv), sign(tDigest, committee.priv)] })
  // Different transaction T': a redirect key controls the fresh outputs.
  const { outputs: tPrimeOutputs } = buildBlindedOutputs([64], keysetId)
  const tPrimeDigest = demoCashuSigAllDigest([proofB], tPrimeOutputs)
  log(`T  digest (signed)      : ${tDigest}`)
  log(`T' digest (submitted)   : ${tPrimeDigest}`)
  log(`T  outputs B_ : ${tOutputs.map((o) => o.B_).join(',')}`)
  log(`T' outputs B_ : ${tPrimeOutputs.map((o) => o.B_).join(',')}`)
  log(`(T' is a different output set; nota bene redirect.pub = ${redirect.pubCompressed})`)
  try {
    const r = await client.swap([{ ...proofB, witness: tSigs }], tPrimeOutputs)
    log(`STEP 7: FAIL — mint ACCEPTED T's signatures over T': ${JSON.stringify(r)}`)
  } catch (error) {
    if (error instanceof CashuMintError) {
      log(`mint refused T' with T's signatures: HTTP ${error.status}`)
      log(`RAW body: ${error.body}`)
    } else {
      log(`unexpected error: ${String(error)}`)
    }
    log(`STEP 7: PASS (refused: the signature binds the outputs)`)
  }
  // Positive control: correct signatures over T' DO spend it (so the refusal above
  // is about the binding, not about the lock being unspendable).
  const tPrimeSigs = JSON.stringify({ signatures: [sign(tPrimeDigest, bidder.priv), sign(tPrimeDigest, committee.priv)] })
  try {
    const r = await client.swap([{ ...proofB, witness: tPrimeSigs }], tPrimeOutputs)
    log(`positive control: signatures over T' accepted (proofB spent): ${JSON.stringify(r.signatures)}`)
  } catch (error) {
    if (error instanceof CashuMintError) log(`positive control: refused HTTP ${error.status}: ${error.body}`)
    else log(`positive control unexpected: ${String(error)}`)
  }

  log(`\nDONE`)
}

main().catch((error) => { console.error('PROBE FAILED:', error); process.exit(1) })
