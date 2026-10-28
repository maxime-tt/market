import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/primitives/card'
import { Spinner } from '@ui/primitives/spinner'
import { CheckCircle2Icon, InfoIcon } from 'lucide-react'

export interface ProfileWalletCheckViewProps {
	/** True while the profile query is fetching and has no data yet -> the "checking" card. */
	isLoading: boolean
	/** True when the profile carries a non-empty `lud16` -> the green "address found" card. */
	hasLud16: boolean
	/** Rendered in the mono box when `hasLud16`. */
	lud16: string | null
	/** The amber card copy interpolates it. */
	instanceName: string
}

/**
 * Presentation-only view of the receiving-payments wallet check.
 *
 * Moved verbatim from the legacy `src/` leaf (D4 leaf retirement):
 * structure, copy and icon placement are unchanged, but the raw palette is
 * migrated to the semantic token families the settings cluster uses
 * (`text-info`/`border-info-border`/`bg-info-muted`, the `success` and `warning`
 * equivalents) because `scripts/check-ui-styles.sh` forbids raw-palette additions.
 * Zero data access: the host derives every prop.
 */
export function ProfileWalletCheckView({ isLoading, hasLud16, lud16, instanceName }: ProfileWalletCheckViewProps) {
	if (isLoading) {
		return (
			<Card className="border-info-border bg-info-muted">
				<CardHeader>
					<div className="flex items-center gap-3">
						<Spinner className="w-6 h-6 text-info" />
						<div>
							<CardTitle className="text-info-foreground text-base">Checking your public wallet settings</CardTitle>
							<CardDescription className="text-info-muted-foreground">Loading your Nostr profile information...</CardDescription>
						</div>
					</div>
				</CardHeader>
			</Card>
		)
	}

	if (hasLud16) {
		return (
			<Card className="border-success-border bg-success-muted">
				<CardHeader>
					<div className="flex items-start gap-3">
						<CheckCircle2Icon className="w-6 h-6 text-success flex-shrink-0 mt-0.5" />
						<div className="flex-1">
							<CardTitle className="text-success-foreground text-base">Lightning Address Found</CardTitle>
							<CardDescription className="text-success-muted-foreground mt-1">
								Your Nostr profile has a Lightning address configured
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="bg-surface-raised p-3 rounded-md border border-success-border">
						<p className="text-sm font-medium text-text-mid mb-1">Lightning Address</p>
						<p className="font-mono text-sm break-all text-text-high">{lud16}</p>
					</div>
					<div className="text-sm text-success-muted-foreground space-y-2">
						<p>
							<strong>By default</strong>, payments go to your Lightning address on your Nostr profile.
						</p>
						<p>Want to use a different one? Add new addresses below for specific products or collections.</p>
					</div>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card className="border-warning-border bg-warning-muted">
			<CardHeader>
				<div className="flex items-start gap-3">
					<InfoIcon className="w-6 h-6 text-warning flex-shrink-0 mt-0.5" />
					<div className="flex-1">
						<CardTitle className="text-warning-foreground text-base">No Lightning Address in Profile</CardTitle>
						<CardDescription className="text-warning-muted-foreground mt-1">Set up a wallet to receive Bitcoin payments</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="text-sm text-warning-muted-foreground space-y-2">
					<p>
						Your Nostr profile doesn't have a Lightning address (lud16) configured. To receive payments on {instanceName}, you'll need to
						set up a Bitcoin wallet.
					</p>
					<p>
						You can choose a wallet from the recommended options below (or any other Lightning-compatible wallet). Once you have a Lightning
						address, you can either:
					</p>
					<ul className="list-disc list-inside space-y-1 ml-2">
						<li>Add it to your Nostr profile so it works everywhere</li>
						<li>Add it here specifically for {instanceName}</li>
					</ul>
				</div>
			</CardContent>
		</Card>
	)
}
