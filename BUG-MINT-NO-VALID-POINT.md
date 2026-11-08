# BUG: browser mint fails with "No valid point found" (Chrome only)

Status: OPEN. Pinned to cashu-ts 4.13.0's `hashToCurve` as bundled for the browser.

## Symptom
Every browser mint fails. The lab's "Mint fake sats" button reports
`No valid point found` and the balance stays 0. Bidding is therefore impossible
in the demo UI. Introduced between the SIG_ALL deploy and now.

## Evidence (all run against https://auctions.playday.it)
1. Reproduced in two independent Chromes (browser harness + puppeteer Chrome 145),
   and directly against the wallet class:
   `new BidderWallet(mintUrl, memoryStorage()).mint(4)` throws
   `CTSError: No valid point found` at `wallet.js:4887` in `Bt`.
2. Stack: `Bt` -> `Yt` -> `createSingleRandomData` -> `createRandomData` ->
   `createOutputData` -> `prepareMint` -> `mintProofsBolt11`.
3. The SAME `wallet.js` in Node (bun) mints 5/5 successfully. So it is
   browser-specific, not a broken bundle or a dead mint.
4. The mint received the call (`POST /v1/mint` present in its log) and answered;
   the failure happens while BUILDING outputs, before proofs are submitted.

## What was ruled out
- Network / CORS: quotes succeed, and the mint logs the request.
- Key generation: 20/20 keygens succeed in-page.
- The point parser: `window.secp256k1.Point.fromHex` parses valid candidates fine
  in-page, and parses its own freshly generated keys.
- sha256 / concatBytes: instrumenting them during a failing mint shows 65,538
  sha256 calls and 131,073 concat calls with ZERO thrown errors. So `Bt`'s loop
  ran the full 65,536 iterations without a single candidate parsing.
- Instrumenting `Point.fromHex` during a failing mint records 0 calls, which
  means the throwing parser is NOT the one reachable as `window.secp256k1.Point`.
- The math: replicating hash_to_curve with the page's own primitives succeeds
  40/40 on random 32-byte inputs and 20/20 on hex-string inputs.

## What this implies
`Bt` resolves a DIFFERENT `Point` binding than the one the page can reach, and
that binding rejects every candidate. The bundle inlines six noble-curves copies
(`grep -c 'noble-curves - MIT License' static/wallet.js` = 6), so the binding
cashu-ts's hashToCurve closes over is not the one exported to `window`. In Node
the module graph resolves them to one instance; under the browser bundle it does
not.

## Next step (not yet done)
Make cashu-ts and our own code share ONE noble instance in the browser bundle,
then re-run a browser mint. The check is behavioural, not structural: a mint must
succeed in a real browser, and the resulting proofs must be spendable at the mint.
