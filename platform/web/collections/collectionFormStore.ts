/**
 * The collection create/edit form store — moved out of the legacy src/ store (store drain).
 *
 * React-free form state: the five form surfaces read it with `useStore(collectionFormStore)`, so the
 * `@tanstack/react-store` `Store` shape is a hard contract. Publishing goes through the Platform
 * collection binding (`collectionPublish.ts`) and the product-selection helpers through the
 * framework-free SDK, so this module carries no `@/` specifier.
 */
import { type CollectionFormData, publishCollection, updateCollection } from '@platform/web/collections/collectionPublish'
import type { SignerCapability } from '@sdk/core/signer'
import { type NDKSigner, type NdkClient as NDK } from '@platform/web/ndkPublishContext'
import {
	addProductToCollectionSelection,
	createCollectionEditDraft,
	removeProductFromCollectionSelection,
	type CollectionWorkflowEvent,
} from '@sdk/commerce/collections'
import { Store } from '@tanstack/react-store'

/**
 * The `shipping` slot is the structural narrowing of `Pick<RichShippingInfo, 'id' | 'name'>` from
 * `@/lib/stores/cart`, whose `name` is optional — so `name` stays optional here. Spelling the fields
 * inline keeps the cart store out of this module (the gated `platform -> src` boundary) and adds no
 * edge: the shape is identical to the SDK's `CollectionShippingInput['shipping']`, so every existing
 * caller still assigns structurally.
 */
export type CollectionShippingForm = {
	shipping: { id: string; name?: string } | null
	extraCost: string
}

export interface CollectionFormState {
	// Form data
	name: string
	summary: string
	description: string
	headerImageUrl: string
	selectedProducts: string[] // Array of product coordinates
	shippings: CollectionShippingForm[]

	// UI state
	isEditing: boolean
	editingCollectionId: string | null

	// Available products for selection
	availableProducts: Array<{
		id: string
		title: string
		coordinates: string
		imageUrl?: string
	}>
}

export const DEFAULT_COLLECTION_FORM_STATE: CollectionFormState = {
	name: '',
	summary: '',
	description: '',
	headerImageUrl: '',
	selectedProducts: [],
	shippings: [],
	isEditing: false,
	editingCollectionId: null,
	availableProducts: [],
}

export const collectionFormStore = new Store(DEFAULT_COLLECTION_FORM_STATE)

export const collectionFormActions = {
	/**
	 * Update form values
	 */
	updateValues: (updates: Partial<CollectionFormState>) => {
		collectionFormStore.setState((state) => ({
			...state,
			...updates,
		}))
	},

	/**
	 * Reset form to default state
	 */
	reset: () => {
		collectionFormStore.setState(() => ({ ...DEFAULT_COLLECTION_FORM_STATE }))
	},

	/**
	 * Set editing mode with collection data
	 */
	setEditingCollection: (collectionId: string, collectionData: Partial<CollectionFormState>) => {
		collectionFormStore.setState((state) => ({
			...state,
			...collectionData,
			isEditing: true,
			editingCollectionId: collectionId,
		}))
	},

	/**
	 * Load collection for editing from a collection event
	 */
	loadCollectionForEdit: (event: CollectionWorkflowEvent) => {
		const draft = createCollectionEditDraft(event)

		collectionFormStore.setState(() => ({
			...DEFAULT_COLLECTION_FORM_STATE,
			isEditing: true,
			...draft,
		}))
	},

	/**
	 * Add product to collection
	 */
	addProduct: (productCoordinates: string) => {
		collectionFormStore.setState((state) => ({
			...state,
			selectedProducts: addProductToCollectionSelection(state.selectedProducts, productCoordinates),
		}))
	},

	/**
	 * Remove product from collection
	 */
	removeProduct: (productCoordinates: string) => {
		collectionFormStore.setState((state) => ({
			...state,
			selectedProducts: removeProductFromCollectionSelection(state.selectedProducts, productCoordinates),
		}))
	},

	/**
	 * Set available products for selection
	 */
	setAvailableProducts: (products: CollectionFormState['availableProducts']) => {
		collectionFormStore.setState((state) => ({
			...state,
			availableProducts: products,
		}))
	},

	/**
	 * Publish or update collection
	 */
	publishCollection: async (signer: SignerCapability, ndk: NDK): Promise<string | null> => {
		const state = collectionFormStore.state

		const formData: CollectionFormData = {
			name: state.name,
			summary: state.summary,
			description: state.description,
			headerImageUrl: state.headerImageUrl || undefined,
			products: state.selectedProducts,
			shippings: state.shippings,
		}

		try {
			if (state.isEditing && state.editingCollectionId) {
				// Update existing collection
				const result = await updateCollection(state.editingCollectionId, formData, signer, ndk)
				return result
			} else {
				// Create new collection
				const result = await publishCollection(formData, signer, ndk)
				return result
			}
		} catch (error) {
			console.error('Error publishing collection:', error)
			throw error
		}
	},
}
