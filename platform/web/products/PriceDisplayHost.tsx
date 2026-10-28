/**
 * Host/binding for the pure `@ui/shared/price-display` view. It supplies the two
 * reads the legacy `src/components/PriceDisplay.tsx` owned — the ui-state selected
 * currency (`@sdk/config/ui` `uiState`, the same store `useStore(uiStore)` read) and
 * the exchange-rate/conversion queries — and renders the view unchanged. The legacy
 * component stays alive for its remaining `src/` consumer (`src/components/CartItem.tsx`).
 */
import { uiState } from '@sdk/config/ui'
import { isBitcoinCurrency, resolvePriceDisplay } from '@sdk/commerce/products/priceDisplay'
import { useBtcExchangeRates, useCurrencyConversion } from '@platform/web/payments/exchangeRatesQuery'
import { PriceDisplayView } from '@ui/shared/price-display'
import { useSyncExternalStore } from 'react'

interface PriceDisplayHostProps {
	priceValue: number
	originalCurrency: string
	className?: string
	showOriginalPrice?: boolean
	showSatsPrice?: boolean
	showRootCurrency?: boolean
}

/** Stable `useSyncExternalStore` bindings; `uiState` is the same store `useStore(uiStore)` read. */
const subscribeSelectedCurrency = (onStoreChange: () => void) => uiState.subscribe(() => onStoreChange())
const getSelectedCurrency = () => uiState.get().selectedCurrency

/** The loading rule the legacy computed inline; exported so it has one behaviour test. */
export const isPriceDisplayLoading = (originalCurrency: string, ratesLoading: boolean, satsLoading: boolean): boolean =>
	ratesLoading || (!isBitcoinCurrency(originalCurrency) && satsLoading)

export function PriceDisplayHost({ priceValue, originalCurrency = 'SATS', ...display }: PriceDisplayHostProps) {
	const selectedCurrency = useSyncExternalStore(subscribeSelectedCurrency, getSelectedCurrency, () => 'USD')
	const { data: exchangeRates, isLoading: ratesLoading } = useBtcExchangeRates()
	const { data: satsFromFiat, isLoading: satsLoading } = useCurrencyConversion(originalCurrency, priceValue)

	const price = resolvePriceDisplay({ priceValue, originalCurrency, selectedCurrency, exchangeRates, satsFromFiat })
	const isLoading = isPriceDisplayLoading(originalCurrency, ratesLoading, satsLoading)

	return (
		<PriceDisplayView
			{...display}
			priceValue={priceValue}
			originalCurrency={originalCurrency}
			selectedCurrency={selectedCurrency}
			price={price}
			isLoading={isLoading}
		/>
	)
}
