# SLICE B0 — prove the mint does 2-of-2 SIG_ALL, before any protocol change

## Why this is a gate

The owner chose the SIG_ALL route: a NUT-11 lock where the bidder and the committee must
**both** sign the whole transaction, so the coordinator's power is "submit one of two
pre-authorized outcomes", not a free spend, and the destination is pinned by the signature
rather than by coordinator policy.

Two facts from this repo say we must not assume it works:

* `LIMITATIONS.md`: "A truthful positive integrated claim still requires ... **the real SIG_ALL
  terminal swap** ..." — it has never been executed against a real mint here.
* `LIMITATIONS.md`: "Nutshell 0.19.2 and cashu-ts 5.0.0-rc.4 derive **different raw `SIG_ALL`
  messages**. The working fake-mint route uses **Nutshell's input-secret plus output-`B_`
  message**."

So: prove the mechanism on the live mint before we change the protocol around it. If it cannot
be done, that is a first-class result and it stops the slice — report it, do not work around it.

## What to prove (in order, all against the live mint at https://mint.playday.it, Nutshell 0.19.2)

1. **Create the lock.** Mint a small amount (e.g. 64 sats) and swap it into a P2PK NUT-11 lock
   whose condition is exactly:
   * main key set: two compressed pubkeys, `n_sigs = 2`, `sigflag = SIG_ALL`
   * refund key set: the bidder's own key, `n_sigs = 1`, `sigflag = SIG_ALL`
   * a `locktime` in the future
   Use two **freshly generated** keypairs. **Do not read, use or derive from the real committee
   key** (`<network root>/cashu-committee.key`); this probe proves mint mechanics, not our keys.
2. **Re-read the token.** Decode the returned proofs and assert the secret carries `pubkeys`,
   `n_sigs=2`, `sigflag=SIG_ALL`, `refund`, and the locktime, and that it survives a round trip
   through the mint unchanged.
3. **Spend it with ONE signature.** It must be **refused**. Record the mint's exact error. A lock
   that a single key can spend is not the lock we are buying.
4. **Spend it with BOTH signatures.** Build the `SIG_ALL` message exactly as Nutshell does — the
   concatenation of the input secret(s) and the output `B_` value(s) per the note above — sign it
   with both keys, and submit the swap. It must succeed. Record the new proofs.
5. **Prove the money is real.** Take the proofs that came out, check their proof state at the mint
   (NUT-07) and spend them again in a plain swap, so the result is not a token the mint refuses
   later.
6. **Record the digest, exactly.** Print the exact preimage bytes and the hex digest that the mint
   accepted, plus what cashu-ts derives on its own, so the difference the note mentions is
   documented with a concrete pair rather than a claim.
7. **Prove the destination is pinned.** With both signatures over transaction T, attempt to submit
   a *different* transaction T' (different output `B_`, e.g. to a third key) signed by the same two
   keys where possible, and record what the mint does. The point being tested: the signature binds
   the outputs, so a coordinator holding both halves still cannot redirect the value.

## Deliverable

A single evidence file at
`/home/admin_maxime/.hermes/profiles/maxime/cache/scratch/audit-parent/sigall-probe.md`
containing, for each numbered step: the exact command or script path, the raw output, and a
PASS/FAIL line. Alongside it, the script itself, kept at
`/home/admin_maxime/work/auctions-simplify/cashu-wrapper/ts/probe-sigall-live.ts` (bun).

Then a short report: what was proven, what was refused, the digest pair, and — if anything failed —
the exact mint response, with no interpretation beyond what the output shows.

## Ground rules

* Mint: `https://mint.playday.it`. App API: `http://127.0.0.1:8080`.
* `export PATH="$HOME/.bun/bin:$PATH"` for bun; run TS from a directory whose `node_modules` has
  `cashu-ts` (e.g. `internal/poc/webwallet`) or add a `node_modules` symlink.
* Read `internal/poc/webwallet/src/wallet.ts` for the existing P2PK signing helpers, and
  `cashu-wrapper/ts/demo-sigall-settlement.ts` + `coco-rail.ts` for the repo's existing SIG_ALL
  digest and 2-of-2 lock construction. Reuse them; do not invent a second convention.
* **Do not** restart any service, do not touch the demo network root, do not use the real
  committee key, do not wipe or re-init anything, do not push or commit.
* The sats are fake and worthless; keep consumption small (a few hundred sats at most).
* Claim nothing you did not run. If a step is impossible, say so and stop there.
