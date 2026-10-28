import type { ProductShippingSelection, SellerProductFormTab } from '@sdk/commerce/products'

const DB_NAME = 'plebeian_market_db'
const DB_VERSION = 1
const STORE_NAME = 'product_form_drafts'

/**
 * The product-form draft fields the persistence layer round-trips.
 *
 * Typed from the SDK product types rather than the store's `ProductFormState`, so this module carries no
 * `platform -> src` edge. The IndexedDB record still holds the caller's whole form state; these are the fields
 * the storage layer itself reads/keys on (`editingProductId` is the keyPath).
 */
export type ProductFormDraftInput = {
	editingProductId: string | null
	formSessionId: number
	activeTab: SellerProductFormTab
	isDirty: boolean
	shippings?: ProductShippingSelection[]
}

export type ProductFormDraft = ProductFormDraftInput & { savedAt: number }

let dbPromise: Promise<IDBDatabase> | null = null

const isBrowserEnvironment = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'

const openDB = (): Promise<IDBDatabase> => {
	if (!isBrowserEnvironment()) {
		return Promise.reject(new Error('IndexedDB not available'))
	}

	if (dbPromise) return dbPromise

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)

		request.onerror = () => {
			dbPromise = null
			reject(request.error)
		}

		request.onsuccess = () => {
			resolve(request.result)
		}

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result

			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'editingProductId' })
			}
		}
	})

	return dbPromise
}

export const saveProductFormDraft = async (productId: string, formState: ProductFormDraftInput): Promise<void> => {
	if (!isBrowserEnvironment() || !productId) return

	try {
		const db = await openDB()

		const draft: ProductFormDraft = {
			...formState,
			editingProductId: productId,
			savedAt: Date.now(),
		}

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.put(draft)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	} catch (error) {
		console.error('Failed to save product form draft:', error)
	}
}

export const getProductFormDraft = async (productId: string): Promise<ProductFormDraft | null> => {
	if (!isBrowserEnvironment() || !productId) return null

	try {
		const db = await openDB()

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readonly')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.get(productId)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve(request.result || null)
		})
	} catch (error) {
		console.error('Failed to get product form draft:', error)
		return null
	}
}

export const clearProductFormDraft = async (productId: string): Promise<void> => {
	if (!isBrowserEnvironment() || !productId) return

	try {
		const db = await openDB()

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.delete(productId)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	} catch (error) {
		console.error('Failed to clear product form draft:', error)
	}
}

export const hasProductFormDraft = async (productId: string): Promise<boolean> => {
	const draft = await getProductFormDraft(productId)
	return draft !== null
}

export const clearAllProductFormDrafts = async (): Promise<void> => {
	if (!isBrowserEnvironment()) return

	try {
		const db = await openDB()

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.clear()

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	} catch (error) {
		console.error('Failed to clear all product form drafts:', error)
	}
}
