/**
 * sdk/config/ui.ts — the app's UI state (drawers, dialogs, toasts, title, currency, NSFW visibility) and the
 * actions over it, on the generic state primitive.
 *
 * The state moved here from `src/lib/stores/ui.ts` and is one `createStateStore` instance; every action reads
 * or replaces it through `get`/`set`. The public surface the app already imports is unchanged — `UIState`,
 * `uiActions` and `useUI` keep every method and the same semantics — so a consumer sees no difference; only
 * the mechanism underneath is now shared rather than a hand-rolled `@tanstack/store` `Store`.
 *
 * This module holds no React and no `@tanstack/*`. Unlike the state modules rebuilt before it, `ui` has
 * consumers that need a `@tanstack/store`-shaped object — 15 components read it with `useStore(uiStore)` and
 * several call `uiStore.setState(...)` / read `uiStore.state` directly — so the `Store`-shaped adapter lives
 * in `src/lib/stores/ui.ts`, not here.
 *
 * This is app state, not nostr-derived state: it is not synced from a query and is written by the UI itself
 * (a settings toggle, opening a drawer), so per the owner's ruling it does NOT automatically get a reactive
 * binding in `platform/web/config/`. A binding is added only if a future consumer needs cross-tree reactivity;
 * the two browser-only preferences it reads/writes (`selectedCurrency`, `showNSFWContent`) already persist
 * through `localStorage` inline, exactly as before.
 */
import { createStateStore } from '../core/state'
import type { StateStore } from '../core/state'
import { CURRENCIES } from './constants'

// Define types for different UI elements
export type DrawerType = 'cart' | 'createProduct' | 'createAuction' | 'createCollection' | 'conversation'
export type DialogType = 'login' | 'signup' | 'checkout' | 'product-details' | 'scan-qr' | 'v4v-setup' | 'terms' | 'nsfw-confirmation'
export type ToastType = 'success' | 'error' | 'warning' | 'info'
export type SupportedCurrency = (typeof CURRENCIES)[number]

// Toast notification structure
export interface Toast {
	id: string
	type: ToastType
	message: string
	duration?: number
}

// Navigation state type
export type NavigationState = {
	productSourcePath: string | null
	originalResultsPath: string | null // Track the first/original results page
}

// Dashboard header action structure
export interface DashboardHeaderAction {
	label: string
	onClick: () => void
}

// UI State interface
export interface UIState {
	drawers: Record<DrawerType, boolean>
	dialogs: Record<DialogType, boolean>
	toasts: Toast[]
	activeElement?: string
	dialogCallbacks?: Partial<Record<DialogType, any>>
	dashboardTitle: string
	dashboardHeaderAction: DashboardHeaderAction | null
	mobileMenuOpen: boolean
	navigation: NavigationState
	selectedCurrency: SupportedCurrency
	conversationPubkey: string | null // Track which conversation to open
	showNSFWContent: boolean // Whether to show NSFW/adult content
}

const getSelectedCurrency = (): SupportedCurrency => {
	const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedCurrency') : null
	return saved && CURRENCIES.includes(saved as SupportedCurrency) ? (saved as SupportedCurrency) : 'USD'
}

const getShowNSFWContent = (): boolean => {
	if (typeof window === 'undefined') return false
	return localStorage.getItem('showNSFWContent') === 'true'
}

// Initial state
const initialState: UIState = {
	drawers: {
		cart: false,
		createProduct: false,
		createAuction: false,
		createCollection: false,
		conversation: false,
	},
	conversationPubkey: null,
	dialogs: {
		login: false,
		signup: false,
		checkout: false,
		'product-details': false,
		'scan-qr': false,
		'v4v-setup': false,
		terms: false,
		'nsfw-confirmation': false,
	},
	toasts: [],
	dialogCallbacks: {},
	dashboardTitle: 'DASHBOARD',
	dashboardHeaderAction: null,
	mobileMenuOpen: false,
	navigation: {
		productSourcePath: null,
		originalResultsPath: null,
	},
	selectedCurrency: getSelectedCurrency(),
	showNSFWContent: getShowNSFWContent(),
}

/**
 * The UI state, on the generic primitive. Exposed so a host can bridge it to its own reactivity or seed it;
 * `src/lib/stores/ui.ts` keeps the `@tanstack/store`-shaped adapter consumers read with `useStore`. This
 * module holds no React and no `@tanstack/*`.
 */
export const uiState: StateStore<UIState> = createStateStore<UIState>({ initial: initialState })

// UI Actions
export const uiActions = {
	// Drawer actions
	openDrawer: (drawer: DrawerType) => {
		uiState.set((state) => ({
			...state,
			drawers: {
				...state.drawers,
				[drawer]: true,
			},
			activeElement: `drawer-${drawer}`,
		}))
	},

	closeDrawer: (drawer: DrawerType) => {
		uiState.set((state) => ({
			...state,
			drawers: {
				...state.drawers,
				[drawer]: false,
			},
			activeElement: state.activeElement === `drawer-${drawer}` ? undefined : state.activeElement,
		}))
	},

	toggleDrawer: (drawer: DrawerType) => {
		uiState.set((state) => ({
			...state,
			drawers: {
				...state.drawers,
				[drawer]: !state.drawers[drawer],
			},
			activeElement: state.drawers[drawer] ? undefined : `drawer-${drawer}`,
		}))
	},

	// Dialog actions
	openDialog: (dialog: DialogType, callback?: any) => {
		uiState.set((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				[dialog]: true,
			},
			dialogCallbacks: {
				...state.dialogCallbacks,
				[dialog]: callback,
			},
			activeElement: `dialog-${dialog}`,
		}))
	},

	closeDialog: (dialog: DialogType) => {
		uiState.set((state) => {
			const newCallbacks = { ...state.dialogCallbacks }
			delete newCallbacks[dialog]

			return {
				...state,
				dialogs: {
					...state.dialogs,
					[dialog]: false,
				},
				dialogCallbacks: newCallbacks,
				activeElement: state.activeElement === `dialog-${dialog}` ? undefined : state.activeElement,
			}
		})
	},

	toggleDialog: (dialog: DialogType) => {
		uiState.set((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				[dialog]: !state.dialogs[dialog],
			},
			activeElement: state.dialogs[dialog] ? undefined : `dialog-${dialog}`,
		}))
	},

	// Close all drawers and dialogs
	closeAll: () => {
		uiState.set((state) => {
			const drawersClosed = Object.keys(state.drawers).reduce(
				(acc, key) => {
					acc[key as DrawerType] = false
					return acc
				},
				{} as Record<DrawerType, boolean>,
			)

			const dialogsClosed = Object.keys(state.dialogs).reduce(
				(acc, key) => {
					acc[key as DialogType] = false
					return acc
				},
				{} as Record<DialogType, boolean>,
			)

			return {
				...state,
				drawers: drawersClosed,
				dialogs: dialogsClosed,
				activeElement: undefined,
			}
		})
	},

	// Toast actions
	addToast: (toast: Omit<Toast, 'id'>) => {
		const id = Math.random().toString(36).substring(2, 9)

		uiState.set((state) => ({
			...state,
			toasts: [...state.toasts, { ...toast, id }],
		}))

		// Auto-remove toast after duration (default: 5000ms)
		const duration = toast.duration || 5000
		setTimeout(() => {
			uiActions.removeToast(id)
		}, duration)

		return id
	},

	removeToast: (id: string) => {
		uiState.set((state) => ({
			...state,
			toasts: state.toasts.filter((toast) => toast.id !== id),
		}))
	},

	clearToasts: () => {
		uiState.set((state) => ({
			...state,
			toasts: [],
		}))
	},

	// Mobile menu actions
	openMobileMenu: () => {
		uiState.set((state) => ({
			...state,
			mobileMenuOpen: true,
			activeElement: 'mobile-menu',
		}))
	},

	closeMobileMenu: () => {
		uiState.set((state) => ({
			...state,
			mobileMenuOpen: false,
			activeElement: state.activeElement === 'mobile-menu' ? undefined : state.activeElement,
		}))
	},

	toggleMobileMenu: () => {
		uiState.set((state) => ({
			...state,
			mobileMenuOpen: !state.mobileMenuOpen,
			activeElement: state.mobileMenuOpen ? undefined : 'mobile-menu',
		}))
	},

	// Dashboard title action
	setDashboardTitle: (title: string) => {
		uiState.set((state) => ({
			...state,
			dashboardTitle: title,
		}))
	},

	// Dashboard header action
	setDashboardHeaderAction: (action: DashboardHeaderAction | null) => {
		uiState.set((state) => ({
			...state,
			dashboardHeaderAction: action,
		}))
	},

	clearDashboardHeaderAction: () => {
		uiState.set((state) => ({
			...state,
			dashboardHeaderAction: null,
		}))
	},

	// Navigation actions
	setProductSourcePath: (path: string | null) => {
		uiState.set((state) => ({
			...state,
			navigation: {
				...state.navigation,
				productSourcePath: path,
				// Only set originalResultsPath if it's not already set and we're setting a new path
				originalResultsPath: state.navigation.originalResultsPath || path,
			},
		}))
	},

	setCollectionSourcePath: (path: string | null) => {
		uiState.set((state) => ({
			...state,
			navigation: {
				...state.navigation,
				collectionSourcePath: path,
				// Only set originalResultsPath if it's not already set and we're setting a new path
				originalResultsPath: state.navigation.originalResultsPath || path,
			},
		}))
	},

	clearProductNavigation: () => {
		uiState.set((state) => ({
			...state,
			navigation: {
				productSourcePath: null,
				originalResultsPath: null,
			},
		}))
	},

	// Currency actions
	setCurrency: (currency: SupportedCurrency) => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('selectedCurrency', currency)
		}

		uiState.set((state) => ({
			...state,
			selectedCurrency: currency,
		}))
	},

	// Conversation actions
	openConversation: (pubkey: string) => {
		uiState.set((state) => ({
			...state,
			conversationPubkey: pubkey,
			drawers: {
				...state.drawers,
				conversation: true,
			},
			activeElement: 'drawer-conversation',
		}))
	},

	closeConversation: () => {
		uiState.set((state) => ({
			...state,
			conversationPubkey: null,
			drawers: {
				...state.drawers,
				conversation: false,
			},
			activeElement: state.activeElement === 'drawer-conversation' ? undefined : state.activeElement,
		}))
	},

	// NSFW content actions
	enableNSFWContent: () => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('showNSFWContent', 'true')
		}
		uiState.set((state) => ({
			...state,
			showNSFWContent: true,
			dialogs: {
				...state.dialogs,
				'nsfw-confirmation': false,
			},
		}))
	},

	disableNSFWContent: () => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('showNSFWContent', 'false')
		}
		uiState.set((state) => ({
			...state,
			showNSFWContent: false,
		}))
	},

	openNSFWConfirmation: () => {
		uiState.set((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				'nsfw-confirmation': true,
			},
		}))
	},
}

/**
 * Non-reactive accessor: the current UI state merged with the actions. Kept for parity with the source
 * module; no consumer reads it today.
 */
export const useUI = () => {
	return {
		...uiState.get(),
		...uiActions,
	}
}
