import type { FormEvent, ReactNode, Ref } from 'react'
import { Cloud, CloudUpload, Globe, Loader2, Plus, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react'
import { Button } from '../primitives/button'
import { Badge } from '../primitives/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { ScrollArea } from '../primitives/scroll-area'
import { Switch } from '../primitives/switch'
import { Notice } from '../shared/notice'
import { StatusBadge } from '../shared/status-badge'
import { cn } from '../utils/cn'

/** Relay connectivity as the host reports it (derived from the NDK transport there). */
export type RelayConnectionStatus = 'connected' | 'connecting' | 'disconnected'

/** Which pool a relay row belongs to; only explicit relays are removable. */
export type RelayListKind = 'explicit' | 'outbox'

export interface RelayRow {
	url: string
	status: RelayConnectionStatus
}

export interface RelayCardViewProps {
	url: string
	type: RelayListKind
	status: RelayConnectionStatus
	/** Removes the relay; only rendered for explicit relays. */
	onRemove: (relayUrl: string) => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

const STATUS_ICON: Record<RelayConnectionStatus, ReactNode> = {
	connected: <Wifi className="h-4 w-4 text-success" />,
	connecting: <Wifi className="h-4 w-4 animate-pulse text-warning" />,
	disconnected: <WifiOff className="h-4 w-4 text-error" />,
}

const STATUS_TONE: Record<RelayConnectionStatus, 'success' | 'warning' | 'error'> = {
	connected: 'success',
	connecting: 'warning',
	disconnected: 'error',
}

const STATUS_LABEL: Record<RelayConnectionStatus, string> = {
	connected: 'Connected',
	connecting: 'Connecting',
	disconnected: 'Disconnected',
}

/** Display domain of a relay URL; the raw URL is returned when it does not parse. */
function relayDomain(url: string): string {
	try {
		return new URL(url).hostname
	} catch {
		return url
	}
}

/** One relay row, moved verbatim from the retired `src/components/ui/relay-manager/RelayCard.tsx`.
 * The NDK relay object and its connectivity events stay with the platform host; this view
 * renders the url, the kind, and the host-derived status. */
export function RelayCardView({ url, type, status, onRemove, className, ref }: RelayCardViewProps) {
	return (
		<div
			ref={ref}
			className={cn(
				'flex flex-col items-start justify-between gap-2 rounded-md border p-3 transition-colors hover:bg-surface-hover sm:flex-row sm:items-center',
				className,
			)}
			data-testid="relay-card"
			data-status={status}
		>
			<div className="flex w-full min-w-0 flex-1 items-center gap-3 sm:w-auto">
				{STATUS_ICON[status]}
				<div className="min-w-0 flex-1 overflow-hidden">
					<div className="mb-1 flex flex-wrap items-center gap-2">
						<Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
						<span className="truncate text-sm font-medium">{relayDomain(url)}</span>
						<Badge variant="secondary" className="shrink-0 text-xs">
							{type}
						</Badge>
					</div>
					<div className="truncate break-all text-xs text-muted-foreground">{url}</div>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
				<StatusBadge status={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
				{type === 'explicit' && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onRemove(url)}
						className="text-muted-foreground hover:text-error"
						aria-label={`Remove ${url}`}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				)}
			</div>
		</div>
	)
}

export interface RelayManagerViewProps {
	/** False while the relay connection is still booting; renders the waiting card only. */
	ndkReady: boolean
	/** Nostr sync card — rendered only when the viewer is signed in. */
	showNostrSync: boolean
	relayListLoading: boolean
	preferencesLoading: boolean
	preferencesPending: boolean
	saving: boolean
	hasUnsavedChanges: boolean
	includeAppDefaults: boolean
	onLoadFromNostr: () => void
	onSaveToNostr: () => void
	onToggleAppDefaults: (enabled: boolean) => void
	/** Controlled add-relay form; the submit handler receives the parsed event. */
	newRelayUrl: string
	onNewRelayUrlChange: (url: string) => void
	onAddRelay: () => void
	addingRelay: boolean
	/** No local relays at all — offers the app defaults. */
	onConnectToDefaults: () => void
	explicitRelays: readonly RelayRow[]
	outboxRelays: readonly RelayRow[]
	onRemoveRelay: (relayUrl: string) => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** Relay management settings, moved verbatim from the retired
 * `src/components/ui/relay-manager/RelayManager.tsx`. Store reads, the relay
 * pool, the NIP-65 publish/read mutations, and toasts stay in the platform
 * `RelayManagerHost`; the raw-palette banners became the shared Notice kit. */
export function RelayManagerView({
	ndkReady,
	showNostrSync,
	relayListLoading,
	preferencesLoading,
	preferencesPending,
	saving,
	hasUnsavedChanges,
	includeAppDefaults,
	onLoadFromNostr,
	onSaveToNostr,
	onToggleAppDefaults,
	newRelayUrl,
	onNewRelayUrlChange,
	onAddRelay,
	addingRelay,
	onConnectToDefaults,
	explicitRelays,
	outboxRelays,
	onRemoveRelay,
	className,
	ref,
}: RelayManagerViewProps) {
	if (!ndkReady) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Globe className="h-5 w-5" />
						Network
					</CardTitle>
					<CardDescription>NDK not initialized</CardDescription>
				</CardHeader>
			</Card>
		)
	}

	const totalRelays = explicitRelays.length + outboxRelays.length
	const submitAddRelay = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		onAddRelay()
	}

	return (
		<div className={cn('space-y-6', className)} ref={ref} data-testid="relay-manager">
			{/* Nostr Sync Actions */}
			{showNostrSync && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<Cloud className="h-5 w-5" />
							Nostr Sync
						</CardTitle>
						<CardDescription>Save your relay list to Nostr so it persists across sessions and devices</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-col gap-2 sm:flex-row">
							<Button
								variant="outline"
								onClick={onLoadFromNostr}
								disabled={relayListLoading || saving}
								className="flex-1"
								data-testid="relay-load-from-nostr"
							>
								{relayListLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
								Load from Nostr
							</Button>
							<Button
								onClick={onSaveToNostr}
								disabled={saving || explicitRelays.length === 0}
								className="flex-1"
								data-testid="relay-save-to-nostr"
							>
								{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
								Save to Nostr
							</Button>
						</div>

						{hasUnsavedChanges && <Notice tone="warning">Your local relay list differs from your published Nostr relay list</Notice>}

						{/* Fallback Relay Toggle */}
						<div className="flex items-center justify-between rounded-md border p-3">
							<div className="space-y-0.5">
								<Label htmlFor="include-defaults" className="text-sm font-medium">
									Include app default relays
								</Label>
								<p className="text-xs text-muted-foreground">
									When enabled, products are also published to common public relays for better discoverability
								</p>
							</div>
							<Switch
								id="include-defaults"
								checked={includeAppDefaults}
								onCheckedChange={onToggleAppDefaults}
								disabled={preferencesLoading || preferencesPending}
							/>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Add Relay Form */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Add Relay</CardTitle>
					<CardDescription>Add a new relay to your network</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={submitAddRelay} className="flex flex-col gap-2 sm:flex-row">
						<div className="flex-1">
							<Label htmlFor="relay-url" className="sr-only">
								Relay URL
							</Label>
							<Input
								id="relay-url"
								type="url"
								placeholder="relay.example.com or wss://relay.example.com"
								value={newRelayUrl}
								onChange={(e) => onNewRelayUrlChange(e.target.value)}
								disabled={addingRelay}
							/>
						</div>
						<Button type="submit" disabled={!newRelayUrl.trim() || addingRelay} className="w-full sm:w-auto" data-testid="relay-add-submit">
							<Plus className="mr-2 h-4 w-4" />
							{addingRelay ? 'Adding...' : 'Add'}
						</Button>
					</form>

					{totalRelays === 0 && (
						<Notice
							tone="warning"
							className="mt-4"
							action={
								<Button variant="outline" size="sm" onClick={onConnectToDefaults} data-testid="relay-connect-defaults">
									<RefreshCw className="mr-2 h-4 w-4" />
									Use Default Relays
								</Button>
							}
						>
							You&apos;re not connected to any relays. Connect to default relays to get started.
						</Notice>
					)}
				</CardContent>
			</Card>

			{/* Explicit Relays */}
			{explicitRelays.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Explicit Relays ({explicitRelays.length})</CardTitle>
						<CardDescription>Relays you&apos;ve explicitly configured for publishing and reading events</CardDescription>
					</CardHeader>
					<CardContent>
						<ScrollArea className={explicitRelays.length > 5 ? 'h-80' : undefined}>
							<div className="space-y-2">
								{explicitRelays.map((relay) => (
									<RelayCardView key={relay.url} url={relay.url} status={relay.status} onRemove={onRemoveRelay} type="explicit" />
								))}
							</div>
						</ScrollArea>
					</CardContent>
				</Card>
			)}

			{/* Outbox Relays */}
			{outboxRelays.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Outbox Relays ({outboxRelays.length})</CardTitle>
						<CardDescription>Relays discovered through the outbox model for efficient data distribution</CardDescription>
					</CardHeader>
					<CardContent>
						<ScrollArea className={outboxRelays.length > 5 ? 'h-80' : undefined}>
							<div className="space-y-2">
								{outboxRelays.map((relay) => (
									<RelayCardView key={`outbox-${relay.url}`} url={relay.url} status={relay.status} onRemove={() => {}} type="outbox" />
								))}
							</div>
						</ScrollArea>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
