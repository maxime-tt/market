import { useConfigQuery } from '@/queries/config'
import { TermsConditionsDialogView } from '@ui/dialogs/terms-conditions-dialog-view'
import { acceptTerms } from '@/lib/terms'

/**
 * The terms acceptance concern now lives in `src/lib/terms.ts` (store drain B3): `src/lib/stores/auth.ts`
 * needs `hasAcceptedTerms()`/`TERMS_ACCEPTED_KEY` and importing them from a `.tsx` made a store import a
 * component. They are re-exported here so existing importers of this module keep working unchanged.
 */
export { TERMS_ACCEPTED_KEY, hasAcceptedTerms } from '@/lib/terms'

interface TermsConditionsDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onAccept: () => void
}

export function TermsConditionsDialog({ open, onOpenChange, onAccept }: TermsConditionsDialogProps) {
	const { data: config } = useConfigQuery()

	return (
		<TermsConditionsDialogView
			open={open}
			instanceName={config?.displayName || config?.name || 'Marketplace'}
			termsUrl={config?.termsUrl}
			onAccept={() => {
				acceptTerms()
				onAccept()
				onOpenChange(false)
			}}
		/>
	)
}
