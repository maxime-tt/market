/**
 * The CMS auction-create form (`NewAuctionContent` hosts it in a sheet).
 *
 * The form is a kind-1440 arena create and nothing else. Its tabs are the create's fields:
 * display (title, description, name), mechanics (duration, starting price, increment,
 * closing rule), category, the single image, and the optional committed split. The retired
 * 30408 knobs — reserve, the anti-snipe floor curve, settlement grace, the auditor list,
 * trusted mints, specs, shipping selections, NSFW/chat flags and start/end scheduling — are
 * **not rendered**, because the settled protocol has no field to receive them; a control
 * whose value is dropped on publish is worse than no control. Shipping in particular has no
 * home in a create: the winner's claim (`AuctionClaimFormData`) is what carries a shipping
 * address, and the auction itself never named one under this protocol.
 *
 * Validation is the publish path's own rule (`arenaCreateFormIssues`), so the editor cannot
 * enable a Publish button the publisher would refuse.
 */
import { Button } from '@ui/primitives/button'
import { ImageUploader } from '@platform/web/media/ImageUploader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ui/primitives/tabs'
import {
	auctionFormToCreateInput,
	AUCTION_V4V_TOTAL_BPS,
	getArenaCreateIssues,
	type AuctionPublishValidationField,
	type ArenaCreateValidationIssue,
} from '@sdk/commerce/auctions/auctionPublishValidation'
import { AUCTION_MIN_BID_LEG_SATS } from '@sdk/commerce/auctions/constants'
import { PRODUCT_CATEGORIES } from '@sdk/config/constants'
import { authStore } from '@platform/web/auth/authStore'
import { usePublishAuctionMutation, type AuctionFormData, type AuctionV4vSplitRowInput } from '@platform/web/auctions/auctionPublish'
import { clearAuctionFormDraft, getAuctionFormDraft, saveAuctionFormDraft } from '@platform/web/auctions/auctionFormStorage'
import { Input } from '@ui/primitives/input'
import { Label } from '@ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { AuctionCategoryTab, AuctionNameTab } from '@ui/auction/auction-editor-tabs'
import { AuctionTabView } from '@ui/auction/auction-tab-view'
import type { AuctionValidationMessages as ValidationMessages } from '@ui/auction/model'

type AuctionTab = 'name' | 'auction' | 'category' | 'image' | 'split'

const DEFAULT_DURATION_SEC = 24 * 60 * 60

const INITIAL_FORM: AuctionFormData = {
	auctionId: '',
	title: '',
	description: '',
	imageUrl: '',
	category: '',
	name: '',
	startPrice: '',
	minIncrement: String(AUCTION_MIN_BID_LEG_SATS),
	mode: 'fixed',
	windowSec: '',
	durationSec: DEFAULT_DURATION_SEC,
	v4vSplit: [],
}

const TAB_ORDER: AuctionTab[] = ['name', 'auction', 'category', 'image', 'split']

const VALIDATION_FIELD_LABELS: Record<AuctionPublishValidationField, string> = {
	auctionId: 'Auction id',
	title: 'Title',
	description: 'Description',
	image: 'Image',
	startPrice: 'Starting Bid',
	minIncrement: 'Bid Increment',
	mode: 'Closing Rule',
	windowSec: 'Anti-snipe Window',
	durationSec: 'Duration',
	v4vSplit: 'Split',
	sellerWallet: 'Wallet',
}

function toValidationMessages(issues: ArenaCreateValidationIssue[]): ValidationMessages {
	const messages: ValidationMessages = {}
	for (const issue of issues) messages[issue.field] ??= issue.message
	return messages
}

function toIndexedValidationMessages(issues: ArenaCreateValidationIssue[], field: AuctionPublishValidationField): Record<number, string> {
	const messages: Record<number, string> = {}
	for (const issue of issues) {
		if (issue.field === field && issue.index !== undefined) messages[issue.index] ??= issue.message
	}
	return messages
}

function isMeaningfulDraft(formData: AuctionFormData): boolean {
	return formData.title.trim().length > 0 || formData.imageUrl.trim().length > 0
}

/** The committed split: rows of role + recipient + basis points, total capped at 10000. */
function SplitTab({
	formData,
	setFormData,
	errors,
}: {
	formData: AuctionFormData
	setFormData: (updater: (prev: AuctionFormData) => AuctionFormData) => void
	errors: Record<number, string>
}) {
	const rows = formData.v4vSplit
	const update = (index: number, patch: Partial<AuctionV4vSplitRowInput>) => {
		setFormData((prev) => {
			const next = [...prev.v4vSplit]
			next[index] = { ...next[index], ...patch }
			return { ...prev, v4vSplit: next }
		})
	}
	const allocated = rows.reduce((sum, row) => sum + (parseInt(row.allocationBps, 10) || 0), 0)

	return (
		<div className="flex flex-col gap-4">
			<div className="space-y-1">
				<Label className="text-base font-medium">Value split</Label>
				<p className="text-sm text-text-mid">
					Optional. Each row pays a fixed share of the hammer price, in basis points (1% = 100 bps). The rows may
					allocate at most {AUCTION_V4V_TOTAL_BPS} bps between them; the seller keeps the remainder.
				</p>
				<p className="text-xs text-text-mid">
					Allocated: {allocated} / {AUCTION_V4V_TOTAL_BPS} bps
				</p>
			</div>

			{rows.map((row, index) => (
				<div key={index} className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-sunken px-3 py-3">
					<div className="flex items-center gap-2">
						<Select
							value={row.role}
							onValueChange={(value) => update(index, { role: value === 'v4v' ? 'v4v' : 'validator' })}
						>
							<SelectTrigger className="w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="validator">validator</SelectItem>
								<SelectItem value="v4v">v4v</SelectItem>
							</SelectContent>
						</Select>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="text-error hover:text-error-foreground"
							onClick={() => setFormData((prev) => ({ ...prev, v4vSplit: prev.v4vSplit.filter((_, i) => i !== index) }))}
						>
							<Trash2 className="w-4 h-4" />
						</Button>
					</div>
					<Input
						placeholder="Recipient Nostr pubkey (64 hex)"
						value={row.recipientPubkey}
						onChange={(e) => update(index, { recipientPubkey: e.target.value })}
						className="font-mono text-xs"
					/>
					<Input
						type="number"
						min={1}
						max={AUCTION_V4V_TOTAL_BPS}
						step="1"
						placeholder="Allocation (basis points)"
						value={row.allocationBps}
						onChange={(e) => update(index, { allocationBps: e.target.value })}
					/>
					{errors[index] && <p className="text-xs text-error">{errors[index]}</p>}
				</div>
			))}

			<Button
				type="button"
				variant="outline"
				className="w-full"
				onClick={() =>
					setFormData((prev) => ({
						...prev,
						v4vSplit: [...prev.v4vSplit, { role: 'validator', recipientPubkey: '', allocationBps: '' }],
					}))
				}
			>
				Add split row
			</Button>
		</div>
	)
}

export function AuctionFormContent() {
	const navigate = useNavigate()
	const publishMutation = usePublishAuctionMutation()
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	const [formData, setFormData] = useState<AuctionFormData>(() => ({ ...INITIAL_FORM, auctionId: uuidv4() }))
	const [activeTab, setActiveTab] = useState<AuctionTab>('name')
	const [savedAt, setSavedAt] = useState<number | null>(null)
	const [publishError, setPublishError] = useState<string | null>(null)
	const draftLoadedRef = useRef(false)
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const draftGenerationRef = useRef(0)

	const hasDraft = savedAt !== null

	useEffect(() => {
		if (!userPubkey || draftLoadedRef.current) return
		draftLoadedRef.current = true
		const draft = getAuctionFormDraft(userPubkey)
		if (!draft) return
		setSavedAt(draft.savedAt)
		// A draft without an identity (one written before this form existed) gets a fresh
		// `d` rather than an empty one: the identity is required to publish at all.
		setFormData({ ...draft.formData, auctionId: draft.formData.auctionId || uuidv4() })
	}, [userPubkey])

	useEffect(() => {
		if (!userPubkey || !draftLoadedRef.current) return

		const generation = draftGenerationRef.current
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

		saveTimerRef.current = setTimeout(() => {
			if (draftGenerationRef.current !== generation) return
			if (!isMeaningfulDraft(formData)) return
			saveAuctionFormDraft(userPubkey, { formData })
			if (draftGenerationRef.current === generation) setSavedAt(Date.now())
		}, 1500)

		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
		}
	}, [formData, userPubkey])

	const validationIssues = getArenaCreateIssues(auctionFormToCreateInput(formData), { sellerWallet: 'not-checked-here' })
	const validationMessages = toValidationMessages(validationIssues)
	const splitErrors = toIndexedValidationMessages(validationIssues, 'v4vSplit')

	const hasValidName = !validationMessages.title && !validationMessages.description
	const hasValidBidding =
		!validationMessages.startPrice &&
		!validationMessages.minIncrement &&
		!validationMessages.durationSec &&
		!validationMessages.mode &&
		!validationMessages.windowSec
	const hasValidImage = !validationMessages.image

	const canSubmit = validationIssues.length === 0

	const currentTabIndex = TAB_ORDER.indexOf(activeTab)
	const isLastTab = currentTabIndex === TAB_ORDER.length - 1

	const tabValid: Record<AuctionTab, boolean> = {
		name: hasValidName,
		auction: hasValidBidding,
		category: true,
		image: hasValidImage,
		split: Object.keys(splitErrors).length === 0 && !validationMessages.v4vSplit,
	}

	const isTabReachable = (tabIndex: number): boolean => {
		for (let i = 0; i < tabIndex; i++) {
			if (!tabValid[TAB_ORDER[i]]) return false
		}
		return true
	}

	const handleNext = () => {
		const nextIndex = currentTabIndex + 1
		if (nextIndex < TAB_ORDER.length) setActiveTab(TAB_ORDER[nextIndex])
	}

	const handleBack = () => {
		const prevIndex = currentTabIndex - 1
		if (prevIndex >= 0) setActiveTab(TAB_ORDER[prevIndex])
	}

	const missingLabels = (fields: AuctionPublishValidationField[]): string[] => {
		const fieldsWithIssues = new Set(validationIssues.filter((i) => fields.includes(i.field)).map((i) => i.field))
		return [...fieldsWithIssues].map((f) => `Missing ${VALIDATION_FIELD_LABELS[f]}`)
	}

	const currentTabErrors: string[] = (() => {
		if (isLastTab) {
			const fieldsWithIssues = [...new Set(validationIssues.map((i) => i.field))]
			return fieldsWithIssues.map((f) => `Missing ${VALIDATION_FIELD_LABELS[f]}`)
		}
		switch (activeTab) {
			case 'name':
				return missingLabels(['title', 'description'])
			case 'auction':
				return missingLabels(['startPrice', 'minIncrement', 'durationSec', 'mode', 'windowSec'])
			case 'image':
				return missingLabels(['image'])
			case 'split':
				return missingLabels(['v4vSplit'])
			default:
				return []
		}
	})()

	const handleClearDraft = () => {
		draftGenerationRef.current++
		draftLoadedRef.current = true
		clearAuctionFormDraft(userPubkey)
		setSavedAt(null)
		setFormData({ ...INITIAL_FORM, auctionId: uuidv4() })
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		event.stopPropagation()
		setPublishError(null)

		try {
			const result = await publishMutation.mutateAsync(formData)
			if (!result.eventId) return

			draftGenerationRef.current++
			clearAuctionFormDraft(userPubkey)
			setSavedAt(null)

			document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			navigate({ to: '/auctions' })
		} catch (error) {
			console.error('Failed to submit auction form:', error)
			setPublishError(error instanceof Error ? error.message : String(error))
		}
	}

	const tabs: { value: AuctionTab; label: string; showAsterisk: boolean }[] = [
		{ value: 'name', label: 'Name', showAsterisk: !hasValidName },
		{ value: 'auction', label: 'Auction', showAsterisk: !hasValidBidding },
		{ value: 'category', label: 'Category', showAsterisk: false },
		{ value: 'image', label: 'Image', showAsterisk: !hasValidImage },
		{ value: 'split', label: 'Split', showAsterisk: !tabValid.split },
	]

	return (
		<form onSubmit={handleSubmit} className="flex flex-col h-full mt-4 overflow-hidden">
			<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
				<Tabs
					value={activeTab}
					onValueChange={(value) => {
						const idx = TAB_ORDER.indexOf(value as AuctionTab)
						if (isTabReachable(idx)) setActiveTab(value as AuctionTab)
					}}
					className="w-full flex flex-col flex-1 min-h-0 overflow-hidden"
				>
					<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
						{tabs.map((tab, index) => (
							<TabsTrigger
								key={tab.value}
								value={tab.value}
								disabled={!isTabReachable(index)}
								className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none disabled:opacity-40 disabled:cursor-not-allowed"
							>
								{tab.label}
								{tab.showAsterisk && <span className="ml-1 text-red-500">*</span>}
							</TabsTrigger>
						))}
					</TabsList>

					<div className="flex-1 overflow-y-auto min-h-0 pr-1">
						<TabsContent value="name" className="mt-4">
							<AuctionNameTab formData={formData} setFormData={setFormData} />
						</TabsContent>
						<TabsContent value="auction" className="mt-4">
							<AuctionTabView formData={formData} setFormData={setFormData} validationMessages={validationMessages} />
						</TabsContent>
						<TabsContent value="category" className="mt-4">
							<AuctionCategoryTab formData={formData} setFormData={setFormData} mainCategories={PRODUCT_CATEGORIES} />
						</TabsContent>
						<TabsContent value="image" className="mt-4">
							<div className="space-y-3">
								<p className="text-text-mid">The lot has one image. We recommend a square image of 1600x1600 and under 2mb.</p>
								{validationMessages.image && <p className="text-xs text-error">{validationMessages.image}</p>}
								<ImageUploader
									src={formData.imageUrl || null}
									index={0}
									imagesLength={1}
									forSingle
									initialUrl={formData.imageUrl}
									onUrlChange={(url) => setFormData((prev) => ({ ...prev, imageUrl: url }))}
									onSave={({ url }) => setFormData((prev) => ({ ...prev, imageUrl: url }))}
									onDelete={() => setFormData((prev) => ({ ...prev, imageUrl: '' }))}
								/>
							</div>
						</TabsContent>
						<TabsContent value="split" className="mt-4">
							<SplitTab formData={formData} setFormData={setFormData} errors={splitErrors} />
						</TabsContent>
					</div>
				</Tabs>
			</div>

			<div className="shrink-0 bg-white border-t pt-4 pb-2 mt-2 flex flex-col gap-2">
				{hasDraft && (
					<div className="flex items-center justify-between gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5">
						<p className="text-xs font-medium text-amber-700">Draft saved</p>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-red-600 px-2"
							onClick={handleClearDraft}
						>
							<Trash2 className="w-3 h-3" />
							Clear draft
						</Button>
					</div>
				)}
				{publishError && (
					<p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{publishError}</p>
				)}
				{currentTabErrors.length > 0 && (
					<ul className="mb-3 max-h-28 overflow-y-auto space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2">
						{currentTabErrors.map((err, i) => (
							<li key={i} className="text-xs text-red-600 flex items-center gap-1">
								<span>•</span>
								{err}
							</li>
						))}
					</ul>
				)}
				<div className="flex gap-2">
					{currentTabIndex > 0 && (
						<Button
							type="button"
							variant="ghost"
							className="flex-1 uppercase border border-input bg-white hover:bg-white"
							onClick={handleBack}
						>
							<ArrowLeft className="w-4 h-4" />
							Back
						</Button>
					)}
					{isLastTab ? (
						<Button
							key="publish"
							type="submit"
							variant="secondary"
							className="flex-1 uppercase"
							disabled={!canSubmit || publishMutation.isPending}
						>
							{publishMutation.isPending ? 'Publishing...' : 'Publish Auction'}
						</Button>
					) : (
						<Button
							key="next"
							type="button"
							variant="secondary"
							className="flex-1 uppercase"
							onClick={handleNext}
							disabled={!tabValid[activeTab]}
						>
							Next
						</Button>
					)}
				</div>
			</div>
		</form>
	)
}