import type { ReactNode, Ref } from 'react'
import { StatusBadge } from '../../shared/status-badge'
import { cn } from '../../utils/cn'
import { readStateMessage } from './auction-card'
import {
	ARENA_QUORUM_DISCLAIMER,
	shortKey,
	verdictTone,
	type ArenaRelayHealth,
	type ArenaSurfaceStatus,
	type ArenaVerdictPanelModel,
	type ArenaVerdictRow,
} from './model'

/**
 * The 1440-series **verdict panel** — what each validator published about one
 * auction, with relay-level disagreement flagged.
 *
 * Ported from `ui/auction/auction-verdict-view.tsx` (the retired 30408 panel):
 * one row per published verdict, the claim as the badge, the anchoring data
 * beside it.
 *
 * ## What this panel refuses to do
 *
 * Quorum is **not implemented**. There is no threshold, no counting rule and no
 * tie-break in the read path, so the panel does not infer a winner from the
 * rows it has. It shows:
 *
 * - every distinct verdict event, per validator, with the height and block hash
 *   it claims (an unanchored verdict never reaches this panel — the read's gate
 *   refuses it);
 * - when two relays report different outcome sets, that **divergence**, named by
 *   relay — the equivocation signal a single pooled subscription cannot see;
 * - when the validators themselves published different outcomes, that they
 *   disagree, without choosing between them;
 * - the {@link ARENA_QUORUM_DISCLAIMER}, always, in every state — including when
 *   a single verdict is on screen, because one verdict is not a quorum.
 *
 * "No verdict published" and "verdict unknown" are rendered as different
 * sentences, and neither is rendered as "no outcome".
 */

export interface ArenaVerdictPanelProps {
	model: ArenaVerdictPanelModel | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Host-owned identity node for a validator pubkey (avatar + name); a short key otherwise. */
	renderValidator?: (pubkey: string | null) => ReactNode
	className?: string
	ref?: Ref<HTMLDivElement>
}

function relayCountLabel(relayHealth: ArenaRelayHealth): string | null {
	if (relayHealth.total === 0) return null
	return `${relayHealth.answered} of ${relayHealth.total} relays answered`
}

function VerdictRow({ row, renderValidator }: { row: ArenaVerdictRow; renderValidator?: (pubkey: string | null) => ReactNode }) {
	return (
		<li data-slot="arena-verdict-row" data-outcome={row.outcome} className="rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-xs">
			<div className="flex flex-wrap items-center gap-2">
				<StatusBadge status={row.outcome} tone={verdictTone(row.outcome)} className="text-[10px] font-semibold uppercase tracking-wide" />
				<span className="text-text-mid">height {row.height.toLocaleString()}</span>
				<span className="font-mono text-[10px] text-text-mid">block {shortKey(row.blockHash)}</span>
				{row.derivedFrom !== 'committed_state' && (
					<span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-text-mid">from {row.derivedFrom}</span>
				)}
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-text-mid">
				<span className="inline-flex items-center gap-1">
					<span>validator</span>
					{renderValidator ? renderValidator(row.validator) : <span className="font-mono">{shortKey(row.validator)}</span>}
				</span>
				<span>bid {row.bidId === null ? 'none (no bid)' : shortKey(row.bidId)}</span>
				<span>
					payout{' '}
					{row.payoutTokenSha256 === null ? 'none claimed' : <span className="font-mono">{shortKey(row.payoutTokenSha256)}</span>}
				</span>
			</div>
		</li>
	)
}

export function ArenaVerdictPanel({ model, status, relayHealth, renderValidator, className, ref }: ArenaVerdictPanelProps) {
	const counts = relayCountLabel(relayHealth)

	if (model === null) {
		const message = readStateMessage(status, 'the verdicts')
		return (
			<div
				ref={ref}
				data-slot="arena-verdict-panel"
				data-state={status}
				className={cn('space-y-3 rounded-xl border border-border-default bg-surface-sunken/40 p-4', className)}
			>
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-mid">Validator verdicts</p>
				{message && (
					<div role="status">
						<p className="text-sm font-medium text-text-high">{message.title}</p>
						<p className="mt-1 text-xs text-text-mid">{message.detail}</p>
					</div>
				)}
				{counts && <p className="text-[11px] text-text-mid opacity-80">{counts}</p>}
				<p className="rounded-lg bg-warning-muted px-3 py-2 text-[11px] text-warning-muted-foreground">{ARENA_QUORUM_DISCLAIMER}</p>
			</div>
		)
	}

	const soFar = status === 'settled' ? '' : ' so far'
	const verdictLabel = `${model.rows.length} ${model.rows.length === 1 ? 'verdict' : 'verdicts'}${soFar}`
	const validatorLabel = `${model.validatorCount} ${model.validatorCount === 1 ? 'validator' : 'validators'}`
	const duplicates = model.rows.length > model.validatorCount

	return (
		<div
			ref={ref}
			data-slot="arena-verdict-panel"
			data-state={status}
			data-outcomes={model.outcomes.join(',') || 'none'}
			data-divergent={model.divergence !== null}
			className={cn('space-y-3 rounded-xl border border-border-default bg-surface-sunken/40 p-4', className)}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-mid">Validator verdicts</p>
				<p className="text-[10px] text-text-mid opacity-80">
					{verdictLabel} · {validatorLabel}
				</p>
			</div>

			<p data-slot="arena-verdict-quorum" className="rounded-lg bg-warning-muted px-3 py-2 text-[11px] text-warning-muted-foreground">
				{ARENA_QUORUM_DISCLAIMER}
			</p>

			{duplicates && (
				<p className="text-[11px] text-text-mid">
					More verdicts than validators: at least one validator published more than one verdict. The panel lists them by
					height and does not merge them.
				</p>
			)}

			{model.outcomes.length > 1 && (
				<p data-slot="arena-verdict-disagreement" className="rounded-lg border border-warning-border bg-warning-muted px-3 py-2 text-xs text-warning-muted-foreground">
					The published verdicts disagree (outcomes: {model.outcomes.join(', ')}). No quorum is applied here, so this
					panel does not pick one.
				</p>
			)}

			{model.divergence !== null && (
				<div
					data-slot="arena-verdict-divergence"
					className="rounded-lg border border-error-border bg-error-muted px-3 py-2 text-xs text-error-muted-foreground"
				>
					<p className="font-semibold">Two relays report different outcomes for this auction.</p>
					<p className="mt-1 text-[11px]">
						This is a signal, not proof: it can be a stale relay, a partition, or equivocation. The read does not
						adjudicate it.
					</p>
					<ul className="mt-2 space-y-1">
						{Object.entries(model.divergence.byRelay)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([relay, outcomes]) => (
								<li key={relay} className="flex flex-wrap gap-2 text-[11px]">
									<span className="font-mono">{relay}</span>
									<span>→ {outcomes.join(', ') || 'nothing'}</span>
								</li>
							))}
					</ul>
				</div>
			)}

			{model.rows.length === 0 ? (
				<p data-slot="arena-verdict-empty" className="rounded-lg border border-dashed border-border-default bg-surface-raised p-3 text-xs text-text-mid">
					{status === 'settled'
						? 'No validator published a verdict for this auction that these relays carried. That is an absence, not a verdict of "no outcome".'
						: 'No verdict has been read yet — the read has not finished, so this is not "no verdict".'}
				</p>
			) : (
				<ol className="space-y-1.5">
					{model.rows.map((row, index) => (
						<VerdictRow key={`${row.validator ?? 'anonymous'}-${row.height}-${index}`} row={row} renderValidator={renderValidator} />
					))}
				</ol>
			)}

			{counts && <p className="text-[11px] text-text-mid opacity-80">{counts}</p>}
		</div>
	)
}