/**
 * src/lib/terms.ts — the terms-acceptance concern, on its own.
 *
 * Extracted from `src/components/dialogs/TermsConditionsDialog.tsx` (store drain B3) because a **store must
 * not import a component**. `src/lib/stores/auth.ts` needs exactly `hasAcceptedTerms()` and
 * `TERMS_ACCEPTED_KEY` — nothing about the dialog — and importing them from a `.tsx` dragged the whole
 * component (and, transitively, React and the query layer) into the store's module graph.
 *
 * The behaviour is moved verbatim: the same localStorage key and the same equality check, so every existing
 * acceptance record keeps working and no user is asked to re-accept.
 */

/** The localStorage key recording that the user accepted the terms. */
export const TERMS_ACCEPTED_KEY = 'plebeian_terms_accepted'

/** Whether the user has accepted the terms on this device. */
export function hasAcceptedTerms(): boolean {
	return localStorage.getItem(TERMS_ACCEPTED_KEY) === 'true'
}

/** Record the acceptance. The dialog host calls this on accept. */
export function acceptTerms(): void {
	localStorage.setItem(TERMS_ACCEPTED_KEY, 'true')
}
