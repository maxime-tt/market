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
