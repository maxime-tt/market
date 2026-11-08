# BUG: browser mint fails with "No valid point found" (Chrome only)

Status: **RESOLVED** — root cause was a browser global-variable collision, not cashu-ts.
Fixed by rebuilding the demo binary so the served `wallet.js` is the IIFE-wrapped bundle;
verified live on 2026-11-08 19:52 UTC (see "Resolution" below).

## Symptom
Every browser mint failed. The lab's "Mint fake sats" button reported
`No valid point found` and the balance stayed 0. Bidding was impossible
in the demo UI. The same throw broke the outbid "Claim refunds" button —
one root cause, two symptoms.

## Evidence gathered while OPEN (all run against https://auctions.playday.it)
1. Reproduced in two independent Chromes (browser harness + puppeteer Chrome 145),
   and directly against the wallet class:
   `new BidderWallet(mintUrl, memoryStorage()).mint(4)` throws
   `CTSError: No valid point found` at `wallet.js:4887` in `Bt`.
2. Stack: `Bt` -> `Yt` -> `createSingleRandomData` -> `createRandomData` ->
   `createOutputData` -> `prepareMint` -> `mintProofsBolt11`.
3. The SAME `wallet.js` in Node (bun) mints 5/5 successfully. So it is
   browser-specific, not a broken bundle or a dead mint.
4. The mint received the call (`POST /v1/mint` present in its log) and answered;
   the failure happened while BUILDING outputs, before proofs were submitted.

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
- Falsified hypothesis (recorded here so nobody re-runs it): it was NOT a
  noble-curves instance/duplication problem in cashu-ts. Loading the REPO's
  IIFE-wrapped `wallet.js` beside `demo-signer.js` in an otherwise identical page
  reproduces nothing: `window.Bt` is `undefined` and the mint reaches the network.

## Root cause (independent review, agent-refund-a, corroborated in this run)
The bundle served at `/wallet.js` was the **unwrapped** build (379,470 B, top-level
`// node_modules/...`, no `(() => {`). Its top-level `var`s therefore leaked to the
global scope. `demo-signer.js` is loaded *after* it (`internal/poc/static/lab.html`)
and defines a global helper also named `P`:

- unwrapped `wallet.js` line ~4897: `function P(e){ return secp256k1.Point.fromHex(e); }`
- `demo-signer.js`: `var P = ($,J,q) => o($,J,q)` where `o` is noble's `abytes`
  (the "expected Uint8Array" guard)

`demo-signer.js` clobbers the wallet's point parser. cashu-ts's `hashToCurve` (`Bt`)
calls `P(bytesToHex(...))`, which is now `abytes(hexString)` and throws for all
65,536 counters — hence `CTSError: No valid point found` before any network call.
This also explains the "0 calls to `Point.fromHex`" observation above.

The IIFE wrap is load-bearing: it is what keeps `wallet.js`'s top-level `var`s out
of the global scope, so `demo-signer.js` cannot clobber them.

## Resolution (deployed and verified 2026-11-08 19:52 UTC)
The committed bundle `internal/poc/static/wallet.js` (401,546 B, sha256
`01597c22d9a6772e3cd7a36265b7f570f42665f376dcce688ddff629e6c78594`) **is** the
IIFE-wrapped build — `internal/poc/webwallet/package.json` builds with
`bun build src/browser.ts --target=browser --format=iife`. The defect was entirely
in the deployed artifact: the running `poc` binary (built 18:53) embedded the
unwrapped bundle (379,470 B, sha256 `34869cec…`), which is what `/wallet.js` served.

Fix = rebuild from the committed tree and restart (no source change):
```
export PATH="$HOME/.local/go/bin:$PATH"; GOWORK=off GOTOOLCHAIN=local go build -mod=readonly -o poc .
```
Verification in this run:
- new binary: wrapped-prefix `(() => {\n  // node_modules/@noble/hashes/_u64.js` present (1);
  old binary: absent (0).
- `curl https://auctions.playday.it/wallet.js | sha256sum` = `01597c22…` = committed file.
- `lab.js` and `lab.html` served == committed (sha match).
- live browser, `https://auctions.playday.it/lab.html`: `typeof window.Bt` = `undefined`;
  `new BidderWallet(cfg.cashu_mint_url, memoryStorage()).mint(4)` -> `MINT_OK`, balance 4.
- live browser, `refundBid(...)` no longer throws `No valid point found`; it proceeds
  into validation and reaches the network (netCalls 1).

## Durable lesson
Never load an unwrapped `wallet.js` next to `demo-signer.js`. Keep the `--format=iife`
build, and after any bundle change rebuild + redeploy the binary (the bundle is
`go:embed`ded, so a wrapped file on disk alone does not fix a running demo).
