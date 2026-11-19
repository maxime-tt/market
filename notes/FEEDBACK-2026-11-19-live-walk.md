# FEEDBACK — the first manual browser walk of `https://market-e2e.playday.it` (2026-11-19)

Recorded verbatim from the user's report of the walk. No interpretation is added here.

## Bidding

On `/dashboard/products/auctions/<id>` the bid panel shows `Place a bid` / `Bidding open` / `100 sats`.
Submitting it returns:

1. `Your bid was not submitted.`
2. `the escrow terms could not be read from the relay (no anchored arena.params.v1 reading is available on the configured relays)`
3. `Nothing was published.`

The user had no ecash at that point, so nothing could have been bid.

## Wallet

The wallet UI shows `no mints available` — invoices cannot be generated from a mint.

## Dashboard auction detail

`https://market-e2e.playday.it/dashboard/products/auctions/e6d0d72d-3c47-47c0-9285-d989b3c32441?seller=becb0c53d97e21e88c2b95e2475cc1fbcc341f3b0041a3efb1f24e9f079aee44`

renders `no auction found`.

## Performance (reported separately, not yet worked)

1. Auctions load surprisingly slowly. Everything should live/lazy-load from relays, with no awaiting
   query timeouts.
2. Dependent queries should cascade into the UI as they resolve (e.g. the highest bid) rather than
   gating the whole view, and the UI must distinguish a loading state from genuine no-data.

## Priority

As stated by the user: the ecash/bidding situation first — that is the thing that must work.

## Scheduled

The two performance items above are scheduled work.

## Status

The three defects (bidding, wallet mints, dashboard auction detail) are under diagnosis as of this note.
