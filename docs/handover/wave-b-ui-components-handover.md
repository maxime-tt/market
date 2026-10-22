# Wave B UI handover — wallet component work in parallel with the NIP-60 cut

**Audience:** a separate agent building wallet **UI components**.
**Author:** wave B (Hermes agent, model `deepseek-v4.1-flash`, custom provider) — the
agent doing the NIP-60 cut and the wallet-port wiring on `inc/wave-b`.
**Repo / worktree:** `/home/admin_maxime/work/pr1420-inc-p6`, branch `inc/wave-b`.
**Written at:** commit `bfb09804` (`cashu: take the mint list from coco, not the relay store`).

This document has one job: let you build the wallet's presentational layer **now**,
without touching a single file wave B is going to rewrite. Read §4 (the frozen
store contract), §5 (your props contracts) and §6 (the rules) before writing code.
§3 is the end-state architecture so your props fit it; §9 is what is landing under
you and when.

---

## 1. The one-line split

- **Your lane — additive only:** new files under `ui/components/wallet/**`, plus an
  append-only block at the end of `ui/index.ts`. Nothing else.
- **Wave B's lane — everything else that mentions a wallet:** `src/**`, `sdk/**`,
  `platform/**`, `scripts/**`, the guard baselines, and every existing `*.test.ts`.

If a change you need falls outside your lane, do not make it — ask (§8).

---

## 2. Why the lane is drawn exactly here

`ui/boundary.test.ts` forbids a `ui/` module from importing `@/` (i.e. `src/`),
`@platform/`, `@tanstack/`, `@nostr-dev-kit/`, `applesauce-*`, `nostr-tools`, or from
escaping `ui/` with a relative path. So a `ui/` view **cannot** subscribe to a store:
it must be pure props in, callbacks out. Containers in `src/components/**` and
`src/feature/wallet/components/**` own the store subscription and pass props down.

That is what makes this split conflict-free: your files are pure functions of props,
so they compile and test on their own even while the store underneath them is being
replaced.

---

## 3. The final architecture (target end state)

```
                 @cashu/coco-core 2.0.0  (IndexedDB: proofs, mints, quotes, counters, history)
                          │
        ┌─────────────────┴───────────────────────────────┐
        │  src/lib/stores/cashu.ts      THE wallet module │  coco is the only authority
        │  cashuStore  (projection)                       │  for proofs, mints, balances,
        │  cashuActions (operations)                      │  history, quotes, pending tokens
        └───────┬─────────────────────────────┬───────────┘
                │                             │
   src/lib/wallet/auctionFunds.ts     src/lib/sdkAdapters.ts
   (NUT-11 P2PK lock / receive /      createCashuWalletPort()          ← WalletPort
    reclaim / settle over coco's      createCashuWalletRecoveryPort()  ← WalletRecoveryPort
    proof repository + cashu-ts)      (coco-backed, replaces the
                │                      relay-state-backed ports)
                │                             │
                │                    src/lib/wallet/rails.ts
                │                    composes sdk/core/wallet's PayAggregator with the
                │                    cashu-wrapper registration → the set record,
                │                    the conservation rule and the refund guard
                │                    become reachable from the app
                │                             │
                └──────────────┬──────────────┘
                               │
   containers (wave B)   src/components/**, src/feature/wallet/components/**
                               │  props down / callbacks up
                               ▼
   views (YOU)           ui/components/wallet/**
```

Module table (who owns what in the end state):

| Layer                                                      | Path                                                    | Owner   | Note                                             |
| ---------------------------------------------------------- | ------------------------------------------------------- | ------- | ------------------------------------------------ |
| the set: aggregator, gate, refund guard, conservation rule | `sdk/core/wallet/**`                                    | wave B  | rail-free; already exists, has 0 importers today |
| Coco melt leg onto the funds contract                      | `sdk/core/cashu-wrapper/**`                             | wave B  | already exists (`CocoWalletPortAdapter`)         |
| `WalletPort` / `WalletRecoveryPort`                        | `sdk/core/ports/wallet.ts`                              | wave B  | already exists                                   |
| **the wallet store**                                       | `src/lib/stores/cashu.ts`                               | wave B  | coco-backed; the single wallet module            |
| auction P2PK money flows                                   | `src/lib/wallet/auctionFunds.ts`                        | wave B  | new; over coco's proof repository                |
| wallet P2PK + auction HD key                               | `src/lib/wallet/walletKeys.ts`                          | wave B  | new; local, see §9 blocker                       |
| port implementations                                       | `src/lib/sdkAdapters.ts`                                | wave B  | coco-backed                                      |
| rail registry                                              | `src/lib/wallet/rails.ts`                               | wave B  | new                                              |
| containers                                                 | `src/components/**`, `src/feature/wallet/components/**` | wave B  | store → props                                    |
| **presentational wallet views**                            | `ui/components/wallet/**`                               | **YOU** | props only                                       |

Invariants the end state must satisfy (so your props do not fight them):

1. **One wallet module.** `src/lib/stores/cashu.ts` is it. There is no second store
   holding balances, mints or proofs.
2. **coco is the authority** for proofs, mints, balances, quotes, history and pending
   tokens — `@cashu/coco-core@2.0.0` over `@cashu/coco-indexeddb`, not the
   `coco-cashu-core@1.0.0-rc11` alpha-line pin this tree still carries (stage B2a). Nothing
   reads a relay-backed wallet event for them.
3. **One conservation rule** — `deriveSetState` in `sdk/core/wallet`. The app does not
   get a second one.
4. **Payment lifecycle is never a boolean.** Your views must be able to render
   `requested / attempted / wallet-acknowledged / settled / receipt-published /
expired / failed / refunded` as distinct states. `depositStatus` below is the
   smallest example; do not collapse a state you are handed into "done".
5. **No NIP-60 vocabulary in the UI.** Users see "Cashu wallet" / "ecash". Do not put
   `nip60` in a prop name, a string, a test name or a CSS class.

---

## 4. THE FROZEN STORE CONTRACT (your input surface)

This is the shape wave B implements in stage 2 (the NIP-60 cut). Code against it.
Today's store still exposes a subset under the old names; see §9.

### 4.1 State

```ts
import type { Manager } from '@cashu/coco-core'

export interface WalletTransactionView {
	id: string
	type: 'mint' | 'melt' | 'send' | 'receive'
	direction: 'in' | 'out' // mint/receive -> 'in', melt/send -> 'out'
	amount: number // sats
	mintUrl: string
	createdAt: number // unix ms
	/** coco's own entry state for mint/melt entries; '' for send/receive. */
	state: string
}

export interface CashuState {
	/** coco handle. Implementation detail — containers must not read it. */
	manager: Manager | null
	status: 'idle' | 'initializing' | 'ready' | 'error'
	error: string | null
	/** Spendable sats per mint URL. */
	balances: Record<string, number>
	totalBalance: number
	/** coco's mint list. */
	mints: string[]
	/** Local preference (persisted); null when unset. */
	defaultMint: string | null
	/** coco history, newest first. */
	transactions: WalletTransactionView[]
	/** Tokens generated but not yet claimed by the recipient. */
	pendingTokens: PendingToken[]
	activeDeposit: { readonly quoteId: string } | null
	depositInvoice: string | null
	depositStatus: 'idle' | 'pending' | 'awaiting_confirmation_retry' | 'success' | 'error'
}
```

```ts
export interface PendingToken {
	id: string
	token: string
	amount: number
	mintUrl: string
	createdAt: number
	status: 'pending' | 'claimed' | 'reclaimed'
	/** Present for auction-bid legs; `locktime` is unix SECONDS. */
	context?: {
		kind: 'auction_bid'
		auctionEventId: string
		auctionCoordinates?: string
		bidEventId?: string
		sellerPubkey: string
		pathIssuerPubkey: string
		lockPubkey: string
		refundPubkey: string
		locktime: number
		derivationPath?: string
		childPubkey?: string
		grantId?: string
	}
	/** Attempt counter for reclaim retries — drives exponential backoff. */
	reclaimAttempts?: number
	/** Unix seconds of the last reclaim attempt (successful or failed). */
	lastReclaimAttemptAt?: number
	/** Human-readable reason the last reclaim attempt failed, preserved for UX. */
	reclaimFailureReason?: string
	/** The mint permanently rejects the refund-path spend; a manual retry resets it. */
	reclaimPermanentlyFailed?: boolean
}
```

`PendingToken` is already exported from `src/lib/stores/cashu.ts` — import the type
from there (type-only imports from `@/` are forbidden in `ui/`, so **re-declare the
props you need structurally** in your own props interfaces; do not import it).

### 4.2 Actions (callbacks your containers will wire)

```ts
cashuActions.initialize(): Promise<void>
cashuActions.refresh(options?: { consolidate?: boolean }): Promise<void>
cashuActions.addMint(mintUrl: string): Promise<void>
cashuActions.removeMint(mintUrl: string): Promise<void>
cashuActions.setDefaultMint(mintUrl: string | null): void
cashuActions.getMints(): string[]
cashuActions.startDeposit(amount: number, mint?: string): Promise<string | null> // invoice
cashuActions.checkDepositNow(): Promise<void>
cashuActions.retryDepositConfirmation(): void
cashuActions.cancelDeposit(options?: { preserveRecovery?: boolean }): void
cashuActions.send(mintUrl: string, amount: number): Promise<string> // encoded token
cashuActions.receive(token: string): Promise<void>
cashuActions.melt(mintUrl: string, invoice: string): Promise<unknown>
cashuActions.payLightningInvoice(invoice: string): Promise<{ preimage?: string }>
cashuActions.withdrawLightning(invoice: string): Promise<boolean>
cashuActions.reclaimToken(tokenId: string, options?: { manual?: boolean }): Promise<void>
cashuActions.removePendingToken(tokenId: string): void
```

You never call these. Your views receive the _outcome_ of a call as a prop, and ask
for a call through an `on*` callback.

---

## 5. YOUR DELIVERABLE — views and their props

Create `ui/components/wallet/` and export these six views. Every view is a pure
component: props in, callbacks out, no store, no `@/`, no `@tanstack/`, no fetch.

Shared sub-shapes (declare them in `ui/components/wallet/types.ts`, export them):

```ts
export interface WalletMintOption {
	mintUrl: string
	/** Display host, e.g. `mint.minibits.cash`. Derived by the container. */
	hostname: string
	/** Spendable sats at this mint. */
	balance: number
	/** Whether the mint is in the wallet's mint list (vs only holding a balance). */
	configured: boolean
}

export type WalletOperationStatus = 'idle' | 'running' | 'success' | 'error'
```

### 5.1 `WalletOverviewView.tsx`

```ts
export interface WalletOverviewViewProps {
	status: 'idle' | 'initializing' | 'ready' | 'error'
	error: string | null
	totalBalance: number
	mints: WalletMintOption[]
	defaultMint: string | null
	pendingTokens: PendingTokenView[]
	onRefresh: () => void
	onOpenDeposit: () => void
	onOpenSendEcash: () => void
	onOpenReceiveEcash: () => void
	onOpenWithdrawLightning: () => void
	onAddMint: (mintUrl: string) => void
	onRemoveMint: (mintUrl: string) => void
	onSetDefaultMint: (mintUrl: string | null) => void
	/** Reclaim a still-unclaimed token; disabled until `reclaimableAt` has passed. */
	onReclaimToken: (tokenId: string) => void
	onRemovePendingToken: (tokenId: string) => void
}
export interface PendingTokenView {
	id: string
	amount: number
	mintUrl: string
	hostname: string
	createdAt: number
	status: 'pending' | 'claimed' | 'reclaimed'
	/** unix ms, or null when the token is immediately reclaimable. */
	reclaimableAt: number | null
	/** Auction-bid legs are shown with their own copy. */
	isAuctionBid: boolean
	/** Reclaim backoff/terminal state, so the view can explain a refusal. */
	reclaimAttempts: number
	reclaimFailureReason: string | null
	reclaimPermanentlyFailed: boolean
}
```

### 5.2 `WalletDepositView.tsx` — Lightning deposit (mint ecash)

```ts
export interface WalletDepositViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	mints: WalletMintOption[]
	defaultMint: string | null
	amount: number
	onAmountChange: (amount: number) => void
	/** 'idle' | 'pending' | 'awaiting_confirmation_retry' | 'success' | 'error' */
	depositStatus: 'idle' | 'pending' | 'awaiting_confirmation_retry' | 'success' | 'error'
	/** The bolt11 to pay, once a quote exists. */
	invoice: string | null
	error: string | null
	/** Fee-padded estimate shown before the quote is created, when available. */
	quoteEstimate?: {
		requiredAmount: number
		totalAmount: number
		mintFee: number
		lightningFee: number
		usedFallbackEstimate: boolean
	}
	onStartDeposit: () => void
	onCheckNow: () => void
	onRetryConfirmation: () => void
	/** Paid-or-uncertain close: `preserveRecovery: true`. */
	onCancel: () => void
	onCopyInvoice: (invoice: string) => void
}
```

`awaiting_confirmation_retry` is a **distinct** state: the invoice was paid or its
outcome is unknown and the mint has not confirmed. Render it with its own copy and a
retry affordance — do not render it as "pending" and do not render it as an error.

### 5.3 `WalletSendEcashView.tsx`

```ts
export interface WalletSendEcashViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	mints: WalletMintOption[]
	defaultMint: string | null
	amount: number
	onAmountChange: (amount: number) => void
	status: WalletOperationStatus
	/** The generated token, once `send` returned it. */
	token: string | null
	error: string | null
	onSend: () => void
	onCopyToken: (token: string) => void
	/** The token is unclaimed: it can be taken back. */
	onReclaim: () => void
}
```

### 5.4 `WalletReceiveEcashView.tsx`

```ts
export interface WalletReceiveEcashViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	tokenInput: string
	onTokenInputChange: (value: string) => void
	status: WalletOperationStatus
	/** Sats received, once known. */
	receivedAmount: number | null
	mintUrl: string | null
	error: string | null
	onReceive: () => void
}
```

### 5.5 `WalletWithdrawLightningView.tsx`

```ts
export interface WalletWithdrawLightningViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	mints: WalletMintOption[]
	defaultMint: string | null
	amount: number
	onAmountChange: (amount: number) => void
	invoice: string
	onInvoiceChange: (value: string) => void
	status: WalletOperationStatus
	/** Melt fee quote in sats, once the mint answered. */
	feeSats: number | null
	/** Preimage when the melt settled — proof, not acknowledgement. */
	preimage: string | null
	error: string | null
	onWithdraw: () => void
}
```

### 5.6 `WalletTransactionListView.tsx`

```ts
export interface WalletTransactionListViewProps {
	transactions: WalletTransactionViewProps[] // same shape as §4.1, re-declared locally
	loading: boolean
	emptyLabel?: string
}
export interface WalletTransactionViewProps {
	id: string
	type: 'mint' | 'melt' | 'send' | 'receive'
	direction: 'in' | 'out'
	amount: number
	mintUrl: string
	hostname: string
	createdAt: number
	state: string
}
```

### 5.7 Required tests

One `*.test.tsx` per view beside it, in the existing style
(`ui/components/lightning/LightningPaymentView.test.tsx` is the closest model — read
it first). Cover, at minimum:

- every `status` / `depositStatus` value renders distinct copy (a state you cannot
  distinguish is a bug in the view, not in the test);
- a disabled action is disabled **and** explains why (the existing views use a
  tooltip for this — see `DisabledWithTooltip` in `LightningPaymentView.tsx`);
- `reclaimableAt` in the future disables reclaim and shows a wait label; in the past
  enables it;
- an empty mint list and an empty transaction list render their empty states;
- `error` is rendered as text, never swallowed.

---

## 6. Rules you must not break

1. **`ui/` boundary.** `bun test ui/boundary.test.ts` must stay green: no `@/`,
   `@tanstack/`, `@nostr-dev-kit/`, `applesauce-*`, `nostr-tools` imports, no relative
   path escaping `ui/`. `@ui/...` and relative-within-`ui/` are fine.
2. **Do not edit any existing file except `ui/index.ts` (append only).** In
   particular do not touch `ui/components/lightning/LightningPaymentView.tsx`: its
   `hasNip60` / `onPayNip60` props are renamed by wave B in the retarget commit (§9).
   Use the new vocabulary in your own views.
3. **Do not touch `src/**`, `sdk/**`, `platform/**`, `scripts/**`, `package.json`,
`bun.lock`, `scripts/\*-baseline.txt`.** Two agents editing the same file is the
   only real way to create a conflict here.
4. **Style:** tabs, single quotes, no semicolons, `bun run format:check` clean. Run
   `bun run format` before committing.
5. **Gates before every commit** (see §7). A red gate means stop, do not commit.
6. **No new runtime dependencies.** No `npm`/`bun add`.
7. **Vocabulary:** no `nip60`, `NIP-60`, `NDKCashu*` in any identifier, string, test
   name or comment in your files. The wallet is "the Cashu wallet"; ecash is "ecash".
8. **Never log or render a proof, seed, private key or NWC URI.** A token string is
   bearer material: render it only in the send view, behind an explicit copy action.

---

## 7. Verification recipe (run these, paste the numbers into your report)

```bash
cd /home/admin_maxime/work/pr1420-inc-p6
export PATH="$HOME/.bun/bin:$PATH"

bun install --frozen-lockfile          # once
bun test ui/boundary.test.ts           # must be 1 pass
bun run format:check                   # must be clean
bunx tsc -p tsconfig.json --noEmit 2>&1 | grep -c 'error TS'   # must be 274 — no new errors
bun run test:unit                      # 0 fail; pass count >= the floor in §9
```

`bun run test:unit` collects `ui/**/*.test.tsx` automatically, so your tests are in the
suite with no config change. The repo has **pre-existing** type debt: `tsc` reports 274
errors on this base (all in files unrelated to the wallet). "tsc clean" here means
**the number does not grow**.

---

## 8. Coordination protocol

- **You need a prop that §5 does not define, or a behaviour the contract cannot
  express?** Stop and ask. Do not add a store import to `ui/`, and do not
  approximate a state you were not given.
- **Wave B needs to change a §5 props contract?** It will say so explicitly in the
  commit message and in a note at the bottom of this file (§10), and will name the
  view. Treat this document as the interface of record: if the code and §5 disagree,
  §5 wins and that is a bug report.
- **Landing order:** your commits can land before, between or after wave B's. Your
  files are additive, so there is nothing to rebase around. Do not create the
  containers — wave B wires them.

---

## 9. Status of wave B, and what changes under you

| Stage                                                                                                                   | State                                  | Commit     |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------- |
| B1 — coco is the mint authority (the dependency inversion that has to land first)                                       | **landed**                             | `bfb09804` |
| B2-pre — the wallet P2PK keypair + auction HD root get a local store behind an injected port                            | **landed**                             | `bb6f5ed4` |
| B2a — upgrade coco to the renamed `@cashu/coco-core@2.0.0` (+ `@cashu/coco-indexeddb`), port `src/lib/stores/cashu.ts`  | **blocked — see the coupling in §9.1** | —          |
| B2-i — the deposit session moves onto coco's mint quote (`src/lib/wallet/depositQuote.ts`)                              | **landed**                             | `8638fa92` |
| B2 — cut NIP-60: delete `src/lib/stores/nip60.ts`, re-home the wallet store onto coco, retarget every consumer and test | **in progress** (deposit half done)    | —          |
| B3 — wire the coco-backed port + the rail registry behind `sdk/core/wallet`                                             | not started                            | —          |

Test-count floor: **2590** (base 2561 + 7 B1 + 10 B2-pre + 1 rail rename + 11 deposit slices). Your work raises it.

### 9.1 The cashu-ts v5 upgrade is gated on removing `@nostr-dev-kit/wallet`, not on its type errors

Decided: take the pre-release coco ships with (`@cashu/coco-core@2.0.0` +
`@cashu/cashu-ts@5.0.0-rc.4`), since the project is not in production and cashu-ts 5 is
expected to stabilise before it is.

The vendor chain is what sets the price, and it is not the type migration:

- `@nostr-dev-kit/wallet@1.0.0` declares a **peer dependency on `@cashu/cashu-ts@^2.1`**, and
  its published `dist/index.d.ts` opens with
  `import { CashuWallet, GetInfoResponse, MintKeys, Proof, SendResponse } from '@cashu/cashu-ts'`.
  Those names are gone in v5 (`CashuWallet` → `Wallet`, the response types moved).
- The package publishes **one entry point** — no subpath exports — so importing anything from
  it (even `NDKNWCWallet`) loads that declaration file, and `skipLibCheck` is unset in this
  repo, so the break is a hard error rather than a hidden one.
- coco 2.0 pins cashu-ts v5 and the app's own code must match it: one cashu-ts can win. So the
  upgrade cannot be green while `@nostr-dev-kit/wallet` is in the tree.

Five files import it, and only one of them is the file B2 deletes: `src/lib/stores/nip60.ts`,
`src/lib/stores/wallet.ts` (the **NWC store**, 7 importers — not otherwise part of the cut),
`src/lib/wallet/proofs.ts`, `src/publish/payment.tsx`, `scripts/seed.ts`.

Measured cost with the dependency bumped and the `cashu.ts` port applied: **355 tsc errors
against the 274 baseline (+81)** — see
`work/pr1420-runs/2026-10-19-sdk-integration/w2-0/` for the error list, the incomplete patch and
a note correcting an earlier +89 figure (that run had 8 errors from a stale `coco-cashu-core`
directory still on disk).

Ordering that follows: finish the cut's wallet-state slices first (they are unblocked on today's
pin), then move the NWC store and the other four off NDK's wallet, and only then the version
bump — so the auction P2PK rails are re-homed once rather than twice.

### 9.2 The remaining B2 surface, measured (2026-10-20)

29 files under `src/` and `platform/` still read `nip60Store` / `nip60Actions` (excluding the store
itself). The split matters, because the two halves have very different costs.

**State reads are already mostly coco's.** They are dominated by the deposit session —
`activeDeposit` 26, `depositStatus` 24, `depositInvoice` 9, `error` 8 — and after `8638fa92` that
whole group _is_ coco's adapter, so the deposit UI (including `DepositLightningModal`'s four
actions) is end-to-end coco today. Everything else is negligible: `mints` 2, `mintBalances` 2,
`balance` 1, `defaultMint` 1.

**The weight is in the actions**, and most of them already have a coco-backed implementation
sitting in `src/lib/stores/cashu.ts`: `send`, `receive`, `melt`, `reclaimToken`,
`removePendingToken`, `addMint`, `getMints`, `setMints`, `createMintQuote`, `redeemMintQuote`,
`refreshBalances`, `reset`, plus the state fields `manager`, `status`, `error`, `balances`,
`totalBalance`, `mints`, `pendingTokens`. So the remaining slices are mostly **retargeting, not
re-implementation** — with four known semantic deltas to respect:

- `sendEcash(amount, mint?)` takes the mint last and optionally (falling back to the default
  mint); `send(mintUrl, amount)` takes it first and requires it.
- `withdrawLightning(invoice)` has no mint argument, while `melt(mintUrl, invoice)` needs one —
  each call site has to resolve a mint.
- `zapWithNutzap` (NIP-61) has **no coco equivalent** in the store today; it needs a decision, not
  a rename.
- `createWallet` / `publishWallet` / `getWallet` are kind-17375 relay-wallet concepts. They are
  **deleted with the relay state**, not ported — nothing replaces them.

Production call sites, by file → action, as measured:

| File                                                                                                                                       | Actions                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/publish/auctions.tsx`                                                                                                                 | `lockAuctionBidFunds`, `receiveLockedEcash`, `updatePendingTokenContext`, `loadAuctionMintKeysets`, `getAuctionHdChildPrivkey`                                                                   |
| `src/feature/wallet/components/Nip60Wallet.tsx`                                                                                            | 12 actions: `addMint`✓, `initialize`✓, `reclaimToken`✓, `removePendingToken`✓ `removeMint`(needs coco), or deleted with nip60 (createWallet, getWallet, publishWallet, setDefaultMint, dev-only) |
| `src/hooks/useAuctionBidFunding.ts`, `…/dashboard/products/bids.tsx`                                                                       | `reclaimToken`, `refresh`                                                                                                                                                                        |
| `src/lib/sdkAdapters.ts`                                                                                                                   | `payLightningInvoice`, `receiveEcash`, `reclaimToken` — **all retargeted** (next commit)                                                                                                         |
| the four settlement consumers (`src/components/AuctionSettlement.tsx`, `AuctionWonModal.tsx`, `platform/web/…/auctions.$auctionId.tsx` ×2) | `settleAuctionAsWinner`                                                                                                                                                                          |
| `SendEcashModal` / `ReceiveEcashModal` / `WithdrawLightningModal`                                                                          | `sendEcash` / `receiveEcash` / `withdrawLightning` — **all retargeted** (B2-ii → iv)                                                                                                             |
| `ZapDialog.tsx`                                                                                                                            | `zapWithNutzap`                                                                                                                                                                                  |
| `src/lib/stores/ndk.ts`                                                                                                                    | `initialize`, `reset`                                                                                                                                                                            |

### 9.3 Remaining slices — ordered plan with judgement calls (2026-10-21)

The easy retargets are done. Everything left is either auction money flows or UI deletions
requiring product decisions. These are my calls, made with the maintainer's autonomy mandate:

**1. Nip60Wallet.tsx — the mint surface (742 lines, 12 actions)**

Mostly retarget to coco now. Specific calls:

- `createWallet` / `getWallet` / `publishWallet` → **remove the three buttons and their
  handlers.** These are kind-17375 relay-wallet concepts. The wallet is now coco's local
  IndexedDB; there is no "create wallet on relays" operation and no wallet event to publish.
- `setDefaultMint` → **remove the mint selector's default-mint dropdown.** Coco has no
  concept of a default mint. The UI still offers a mint selector (line 248); it just no
  longer marks one as the \"default\".
- `transactions` → **remove the transactions section** (lines 469‑491). The transaction
  list came from kind-7375/7376 events on relays. Coco has no transaction event history;
  proof history is available but not as human-readable transactions. The section has no
  coco equivalent.
- `removeMint` → **add to cashuStore** as a new action (`removeMint: async (mintUrl) =>
{ await manager.mint.addMint(mintUrl, { trusted: false }) }` — the coco SDK has no
  removeMint, but adding a mint with trusted: false effectively removes it. The UI gets
  its remove-mint button back.
- `mintTestEcash` / `placeDevBidOnSeededAuction` → **gate behind `import.meta.env.DEV`**
  rather than `isNip60WalletDevModeEnabled()`. The logic does not change; only the guard.
- `proofsByMint` (line 118, uses `nip60Actions.getWallet()`) → **remove the \"proofs\"
  collapsible section** or replace it with a coco-proof dump. The old section rendered
  raw proof data from the NDK wallet state; a coco equivalent would read from
  `cashuStore.state.manager.wallet.state.getProofs()` if the developer needs it.
  Simplest: remove the collapsible (it's a dev/debug feature).
- The remaining actions (`addMint`, `initialize`, `reclaimToken`, `removePendingToken`,
  `refresh`) already have direct coco equivalents and are retargeted as part of this
  commit — same pattern as the modals.

**2. useAuctionBidFunding.ts + bids.tsx — reclaim + refresh (2 actions)**

`reclaimToken` and `refresh` both have matching coco action signatures now (added in the
sdkAdapters pass). Retarget: replace the nip60 call with its cashu counterpart. Each file
has one or two call sites. The `refresh` -> `refreshBalances` difference is the same one
handled in Nip60Wallet.tsx — use `refreshBalances`.

**3. Settlement — settleAuctionAsWinner (4 consumers, 1 action)**

This creates a P2PK token and pays the seller. The funds come from the auction-locked
collateral which is currently in the NDK wallet's proof repository. **Hold**: retarget
this after the version bump, because coco 2.0 provides native P2PK send
(`SendMethod: 'p2pk'`, `P2pkSendOptions` with locktime, refund keys, etc.) — currently
P2PK is hand-rolled cashu-ts proof surgery. Waiting means re-homing once.

> **Corrected 2026-10-21 — the bump is a SEND-side win only.** coco has native P2PK
> _output creation_; it has no way to _spend_ an incoming P2PK-locked token. Verified
> against the published typings of both the pin and 2.0.0: `receive(token: Token | string, …)`
> takes only a token, and **no `spendingKey` / `privkey` / `privateKey` parameter exists
> anywhere in either `.d.ts`**. 2.0's `reclaim(operationId)` is documented as "attempts to
> reclaim a **pending send operation**" — rolling back an outgoing send, not claiming an
> incoming output. So the auction _lock_ (send side) gains coco's P2PK after the bump, while
> the auction _receive/reclaim_ legs must stay on cashu-ts, which does support P2PK spending.
> Holding items 3–4 for the bump is still right for the lock, but the "re-home once" argument
> covers only half of each leg.

**4. Auction lock rails — publish/auctions.tsx (2,213 lines)**

Same reason as settlement: the lock creates P2PK outputs with locktime. **Hold** for the
version bump. This is the single largest file in the census and the one that benefits
most from coco 2.0's native P2PK — sending only, see the correction above.

**5. ZapDialog.tsx — nutzap (separate module)**

Neither coco nor cashu-ts handles NIP-61 (confirmed by grep of both dist trees). A full
implementation spec now exists at
`work/pr1420-runs/2026-10-19-sdk-integration/w2-1/NUTZAP-SPEC.md` (1,306 lines): protocol
shapes, the dependency search, the current flow traced through `NDKZapper`, the proposed
module API, the test strategy and 14 open questions with recommendations. Build
`src/lib/wallet/nutzap.ts` from it. Gate the dialog behind the new module; the old
`nip60Actions.zapWithNutzap` path is deleted with nip60.ts.

**Event kinds — corrected.** The real NIP-61 kinds are **10019** (the info event carrying a
user's accepted mints, relays and nutzap pubkey), **9321** (the nutzap itself), and **7376**
(redemption history, shared with NIP-60). An earlier revision of this section said 9325 and
9324; **those kinds do not exist** — they were a transcription error and were verified absent
from the spec and from every file in `nostr-protocol/nips`. Do not implement them.
Two protocol details that shape the module: the sender **MUST** prefix the recipient's pubkey
with `"02"` when P2PK-locking, and the `kind:10019` pubkey "corresponds to the `privkey` field
encrypted in a user's NIP-60 wallet event" — which is exactly the pair `walletKeys.ts` now
holds locally, so the nutzap key is derivable from `WalletKeyMaterial` rather than from a
relay event.

### 9.4 Slice 1 landed, and the two holes it opened (2026-10-21)

`55ecf78f` retargeted `Nip60Wallet.tsx`. Two interim consequences, both deliberate and both
needing a closing slice rather than being forgotten:

1. **The wallet panel no longer lists auction-locked pending tokens.** The panel used to merge
   `cashuStore.pendingTokens` with `nip60Store.pendingTokens`; it is now coco-only, and the
   auction lock flows still write to the nip60 store until slices 3–4 move them. Closing slice:
   the auction rails (item 4), after which the list is coco-only in fact and not just in
   appearance. Reclaim is not lost in the meantime — `bids.tsx` and `useAuctionBidFunding.ts`
   have their own paths (item 2).
2. **There is no remove-mint affordance, on purpose.** The plan's proposed shape
   (`addMint(url, { trusted: false })`) does not work: `syncMints` re-trusts every mint coco
   holds, which `walletMintAuthority.test.ts` pins as intended behaviour. `deleteMint` exists
   only on coco's internal `MintRepository` / `MintService`, not on the `MintApi` the manager
   exposes, so on this pin there is no durable removal at all. The action, its handler and its
   button were dropped rather than shipped, with the reason recorded in `cashu.ts`; revisit
   against coco 2.0's mint API during the version bump.

### 9.5 Slice 2 landed as a partial, and the boundary it hit (2026-10-21)

`b1ce5434` moved **one** call: `useAuctionBidFunding.ts`'s best-effort `refresh()` →
`cashuActions.refreshBalances()` (no options were passed, so nothing option-expressed was lost).

**The reclaim call was deliberately NOT moved, and the reasons are verified:**

- `bids.tsx`'s `reclaimToken(token.id, { manual: true })` is for auction tokens, which still
  live in `nip60_pending_tokens` (the held lock rails write them). coco's `reclaimToken` looks
  the id up in `cashuStore.state.pendingTokens` and throws `Pending token not found` — so the
  retarget would turn a working reclaim into a guaranteed failure on a money path.
- Even if it found the token, coco's reclaim is `manager.wallet.receive(pendingToken.token)` —
  a plain receive with no spending key, no timelock check and no refund-key signing. It cannot
  sweep a P2PK-locked auction token. See the correction under item 3.
- `manual: true` (override the auto-reclaim "permanently failed" flag) has no coco target at
  all, since coco's action takes no options bag.

**A structural blocker worth knowing before the auction slices: a `platform/` route cannot
gain a `src/` import.** Adding `cashuActions` to `bids.tsx` grows `platform → src` production
imports 412 → 413, and `scripts/check-src-boundary.sh` is a downward-only ratchet, so it fails
by design. `bids.tsx` therefore keeps its nip60 import until the auction rails move, at which
point both the pending tokens and the `platform → src` edge move together legitimately.
Anything in `platform/` that needs the coco store must reach it through an existing seam
(the sdk ports), not a new direct import.

Also carried forward: the fundable-mint check a few lines below that retargeted refresh still
reads `nip60Store.state.mintBalances`, so the refresh no longer freshens the state that check
reads — same class as the §9.4 hole 1, and it closes with the same slice.

### 9.6 The auction extraction, measured (2026-10-21)

The store has shrunk in this stretch — 2,990 lines to 2,925 — after the transaction subsystem and
the two non-store importers went. What is left to move is the auction cluster and the
pending-token bookkeeping around it.

**The actions, with measured line ranges** (`src/lib/stores/nip60.ts`, 2,925 lines):

- `lockAuctionBidFunds` 1967–2260 (≈294 lines) — the P2PK lock with locktime and refund key
- `sendEcash` 2261–2587 (≈327) — not auction-specific, but shares the proof plumbing
- `settleAuctionAsWinner` 2588–2605 (≈18) — thin, delegates to the lock/receive helpers
- `receiveEcash` 2606–2636 (≈31)
- `receiveLockedEcash` 2637–2665 (≈29) — the P2PK _spend_, the leg coco cannot do
- `loadAuctionMintKeysets` 2666–2683 (≈18)
- `syncAuctionTransfers` 2684–2690 (≈7)
- `loadPendingTokens` 2691–2705 (≈15)
- `reclaimToken` 2706–2854 (≈149) — timelock-aware reclaim with backoff
- `autoReclaimTimelockedBids` 2855–2888 (≈34)
- `removePendingToken` 2889–2900, `removePendingTokens` 2901–2914, `getActivePendingTokens` 2915–2925
- `updatePendingTokenContext` 1459–1488, `getAuctionHdChildPrivkey` 1401–1458, `runAutoCleanup` 1297–1400

That is roughly **630 lines of auction-specific code** plus shared helpers (reclaim backoff,
reclaim-prepare timing, the AUCTION\_\* constants) that several of them read.

**What they reach for**, measured by counting reads inside the file:

- `nip60Store.state.wallet` ×25 — the NDK wallet, and the reason the package is still imported
- `nip60Store.state.pendingTokens` ×13 — the pending-token bookkeeping
- `nip60Store.state.status` ×12
- everything else is single digits

**What now exists to move them onto**, all landed in this stretch:

- the `(walletP2pk, walletPrivkey)` pair and the auction HD root — `walletKeys.ts` plus the sealed
  store, the signer sealer, the fail-closed binding and the one-way migration (§9.4/§9.5 and the
  four commits of the key medium)
- a proof source that is a **structural contract** now, not a class (`WalletProofSource` in
  `proofs.ts`) — so a coco-backed source can satisfy it without this module importing the relay
  wallet
- the coco store's own `send` / `receive` / `reclaimToken` / `pendingTokens`

**Extraction order, and why:**

1. `receiveLockedEcash` first (≈29 lines, one call site). It is the P2PK **spend** — the leg coco
   cannot do on either the pin or 2.0 — so it must stay on cashu-ts with the key from
   `deriveAuctionChildPrivkey`. Proving the pattern on the smallest leg that has the hardest
   dependency is the point: if the key path works here it works everywhere.
2. `loadAuctionMintKeysets` + `syncAuctionTransfers` (≈25 lines) — no wallet reads beyond keysets.
3. `reclaimToken` + `autoReclaimTimelockedBids` (≈183 lines) — the reclaim pair, which is where
   the backoff and timelock semantics live, and where `bids.tsx` reads from.
4. `lockAuctionBidFunds` + `settleAuctionAsWinner` (≈312 lines) **last**, and ideally after B2a:
   the lock is the leg that gains coco's native P2PK send after the bump, so moving it twice
   would be wasted work.
5. The pending-token bookkeeping: decide once whether it moves to `cashuStore.pendingTokens` (which
   already exists and is already coco's) or to a wallet-local store of its own. It is read 13 times
   inside the store and by `bids.tsx` in `platform/` — and that file **cannot** gain a `src/` import
   (the boundary guard only ratchets down), so whichever way it goes, `platform/` reaches it
   through an existing seam or not at all.

**Structural traps for whoever does this:**

- `platform/` routes cannot take new `src/` imports (412 → 413 fails by design). `bids.tsx` keeps
  its nip60 import until its pending-token read moves with the rest.
- The suite is flaky under load — a single red at ~3× the normal duration (126s vs 42s) should be
  re-run before it is believed. Both patterns were seen tonight: a non-zero exit reporting "0 fail"
  (stale expects) and a transient "1 fail" that two clean runs did not reproduce.
- Every refusal added by the key medium is a specific way an HD root could move. If a slice finds
  one inconvenient, that is the moment to be suspicious rather than to relax the rule.
- `NDKPrivateKeySigner` does not declare `nip44`; the wallet event is opened through the event's own
  `decrypt()`, which is what NDK's loader does. Do not reach for `signer.nip44`.

**6. NDK-wallet unwind — before the version bump can be green**

Four files import `@nostr-dev-kit/wallet` (not just nip60.ts). The upgrade to cashu-ts
v5 breaks its types (`peer ^2.1`). These must stop importing it before the bump:

- `src/lib/stores/wallet.ts` (NWC store) — replace `NDKNWCWallet` with the SDK's
  nwc-wrapper (`sdk/core/nwc-wrapper/ts/wrapper.ts`). The wrapper already exists in the
  repo; no new code, just a wiring change.
- `src/lib/wallet/proofs.ts` — uses `type NDKCashuWallet` for proof extraction. Replace
  with coco's `ProofRepository` / `cashuActions` equivalents.
- `src/publish/payment.tsx` — uses `NDKNWCWallet, NDKWalletStatus` for NWC payments.
  Same nwc-wrapper replacement as wallet.ts.
- `scripts/seed.ts` — uses `NDKCashuWallet` for dev seeding. Gate behind coco actions;
  the local mint already supports the same operations.

**7. Version bump — coco 2.0.0 + cashu-ts 5.0.0-rc.4**

After the NDK-wallet is gone, apply the patch from
`w2-0/v5-upgrade.INCOMPLETE.patch` (dep swap + cashu.ts port + patch removal), then fix
the +81 tsc errors (see `w2-0/v5-tsc-355-errors-CLEAN.txt` for the work list). The three
runtime changes (`Amount` class semantics, hex-id keysets, `loadMint()` requirement) are
tested by the existing deposit-integration and auction-suites.

Then **delete nip60.ts** and retarget the remaining residue
(`src/lib/wallet/nip60.test.ts` becomes the wallet suite). Wire B3 (rail registry).
The nutzap module is independent and can land anywhere in this sequence.

Proposed order, cheapest-and-safest first: (1) the three wallet-op modals, (2) the mint surface,
(3) settlement for the four `settleAuctionAsWinner` consumers, (4) reclaim + pending tokens,
(5) the auction lock/receive rails **last**, since those are the ones that gain coco's native P2PK
after the version bump — then delete `nip60.ts` and retarget the residue (`src/lib/wallet/nip60.test.ts`
becomes the wallet suite).

### What B2 will do to the surface you consume

- `src/lib/stores/nip60.ts` (2,993 lines, kind-17375/7375/7376 relay wallet state) is
  **deleted**. Its state fields and action names are folded into
  `src/lib/stores/cashu.ts`, which becomes the single wallet module.
- Every container that reads `nip60Store` / `nip60Actions` is retargeted to
  `cashuStore` / `cashuActions`. That is a wave-B change in wave-B files.
- `ui/components/lightning/LightningPaymentView.tsx`: props `hasNip60` →
  `hasCashuWallet`, `onPayNip60` → `onPayCashuWallet`. Wave B owns that rename (both
  the view and its container) in the retarget commit, so **do not do it yourself**.
- `ui/index.ts` gets one appended export block for `ui/components/wallet/**`. Wave B
  will not touch `ui/index.ts` while your work is open, so an append at the end of the
  file will not conflict.

### Known blockers in B2 (relevant to you only as "why the shape is what it is")

1. **The coco pin is the blocker, not the feature.** P2PK _is_ supported upstream.
   `@cashu/coco-core@2.0.0` declares `SendMethod = 'default' | 'p2pk'` with
   `P2pkSendOptions = (Omit<P2PKOptions,'kind'> & { kind: 'P2PK' }) | LegacyP2pkSendOptions`,
   i.e. `pubkey`, `locktime`, `refundKeys`, `requiredSignatures`,
   `requiredRefundSignatures`, `additionalTags`, `blindKeys`, `sigFlag` — only
   HTLC/NUT-14 `hashlock` is out of scope (stated in the type's own doc comment). The
   auction lock maps onto it directly (`lockPubkey → pubkey`, `locktime → locktime`,
   `refundPubkey → refundKeys: [refundPubkey]`, 1-of-1 → `requiredSignatures: 1`), so the
   leg is a coco P2PK send — not hand-rolled cashu-ts proof surgery. What is unavailable is
   that API _in the version this repo pins_: `coco-cashu-core@1.0.0-rc11` (the `latest` tag
   of the package's old name) contains no `p2pk` at all. Hence **B2a: upgrade to the renamed
   `@cashu/coco-core` 2.0.0 before B2.** (An earlier revision of this document claimed coco
   could not send to a P2PK output. That was measured on the pin, not on the library, and
   is withdrawn.)
   **B2a is now measured and blocked, not merely pending.** coco 2.0.0 pins
   `@cashu/cashu-ts@5.0.0-rc.4` exactly, while this app is on 2.9.0; porting `cashu.ts`
   compiles (`tsc` 273 vs 274) but `bun test` fails at import —
   `Export named 'Amount' not found in node_modules/@cashu/cashu-ts/...` — because coco's
   `Amount` resolves to the root v2 copy. Making it one version means migrating the app to
   cashu-ts v5: **+88 error sites across 28 files**, concentrated in the auction money paths,
   and `Amount` becoming a class whose `toJSON()` returns a _string_. None of that touches the
   props in §5. Until it lands, the auction P2PK legs stay on the cashu-ts v2 helpers they use
   today.
2. **Wallet key continuity.** The wallet's P2PK keypair and the auction HD root live in
   the encrypted kind-17375 event and nowhere else (no `localStorage` in
   `@nostr-dev-kit/wallet`). Deleting the NIP-60 read path without a local key store
   would change the auction HD root and strand in-flight auctions' locked funds.
   B2 needs an explicit local key store (plus a documented one-time migration, which
   is the residue `grep -rn nip60 src/` is allowed to find).
   **The seam now exists** (`src/lib/wallet/walletKeys.ts`, `bb6f5ed4`): the material, a
   correspondence check that refuses a pair whose halves disagree, the child derivation with
   the expected-pubkey guard, and the store as an injected port. What is still open is the
   **medium and its protection** — a plaintext `localStorage` copy of the private half is not
   acceptable — so the adapter and the one-time read of the existing event land with the cut.
3. **Deposit engine swap.** `NDKCashuDeposit` becomes a coco mint quote plus a polling
   adapter that keeps the same `on('success'|'error')` / `check()` shape, so the
   deposit-identity contract (`activeDeposit` identity, `preserveRecovery`) and its
   tests survive. Your `WalletDepositView` props above are exactly that contract's
   product surface — `awaiting_confirmation_retry` exists because of it.

---

## 10. Amendments to this document

- **B2-pre landed (`bb6f5ed4`).** §9 only: the stage table gains B2-pre and the floor moves to
  2578; blocker 2 records that the key seam exists while the _medium_ remains open. No §5 props
  contract changed.
- **B2a measured and blocked; the P2PK blocker corrected.** §3 (engine named and versioned), §4
  (import path), §9 (stage table gains B2a — now _blocked_ — and blocker 1 rewritten). The
  withdrawn claim was that coco cannot send to a P2PK output — that holds only for the pinned
  `coco-cashu-core@1.0.0-rc11`; `@cashu/coco-core@2.0.0` declares
  `P2pkSendOptions` with `locktime`, `refundKeys`, `sigFlag` and multisig tags. What blocks the
  upgrade is the dependency line: 2.0.0 pins `@cashu/cashu-ts@5.0.0-rc.4`, and the single-version
  fix is a measured 28-file migration in the auction money paths. Verified by reading the
  published tarballs' type definitions and by running the gates, not from documentation. **No §5
  props contract changed**, so nothing you have written is affected.
