import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import type { AuctionPublishValidationField } from '@sdk/commerce/auctions/auctionPublishValidation'

/**
 * Shared auction-editor shapes, following the `ui/nav/model.ts` precedent: the
 * data contract plus one pure formatter, and nothing else. No React, no state,
 * no I/O.
 *
 * Extracted from the `auction-editor` monolith (T6.3 slice S1); the views that
 * consume these shapes and the host that supplies them migrate in later slices.
 */

/** One uploaded auction image and its display order. */
export type AuctionImage = { imageUrl: string; imageOrder: number }

/** Per-field publish-validation messages, keyed by validation field. */
export type AuctionValidationMessages = Partial<Record<AuctionPublishValidationField, string>>
export type ValidationMessages = AuctionValidationMessages

/** Host-supplied uploader; `index` is -1 for the empty "add image" slot. */
export type RenderAuctionImageUploader = (props: {
	src: string | null
	index: number
	imagesLength: number
	onSave: (result: { url: string; index: number }) => void
	onDelete: (index: number) => void
	onPromote?: (index: number) => void
	onDemote?: (index: number) => void
}) => ReactNode

/** Props every auction form tab shares: the form slice plus its setter. */
export type TabProps = {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
}

export type StartMode = 'immediate' | 'scheduled'
export type EndMode = 'duration' | 'absolute'

/** A shipping option flattened from a host event for the view. */
export type AuctionShippingOptionSummary = {
	id: string
	name: string
	price: string
	currency: string
	service: string
	carrier: string | undefined
}

export interface AuctionShippingViewProps {
	attached: readonly { shippingRef: string; extraCost: string; option: AuctionShippingOptionSummary | null }[]
	unselected: readonly AuctionShippingOptionSummary[]
	hasUser: boolean
	isLoading: boolean
	hasAnyOptions: boolean
	extraCostErrors: Record<number, string>
	onAdd: (option: AuctionShippingOptionSummary) => void
	onRemove: (index: number) => void
	onExtraCostChange: (index: number, extraCost: string) => void
}

/** The ` · service · carrier` suffix shown under a shipping option's price. */
export function describeShipping(option: AuctionShippingOptionSummary): string {
	return `${option.service ? ` · ${option.service}` : ''}${option.carrier ? ` · ${option.carrier}` : ''}`
}
