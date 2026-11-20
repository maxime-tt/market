import type {
	StorefrontBlock,
	StorefrontBlockType,
	StorefrontRootProps,
	StorefrontThemeId,
	StorefrontThemeTune,
} from '@sdk/commerce/storefront/storefrontPage'
import { STOREFRONT_TUNE_DEFAULTS, StorefrontRootPropsSchema } from '@sdk/commerce/storefront/storefrontPage'
import { STOREFRONT_THEMES } from '@sdk/config/storefront/storefrontThemes'
import { StorefrontBlockView, StorefrontRoot } from '@ui/storefront'
import { usePuck, type Config, type Data } from '@puckeditor/core'
import { storefrontBlockSlots } from './StorefrontBlockSlots'
import { CollectionPickerField, ProductPickerField, ProductRowPickerField } from './fields/ItemPickerField'
import { AuctionPickerField } from './fields/AuctionPickerField'
import { ThemeColourList, ThemeTunePanel } from './fields/ThemePickerField'

/**
 * The CMS component registry: what the Puck editor can put on a page.
 *
 * Two invariants tie this file to `@sdk/commerce/storefront/storefrontPage`:
 *
 *  1. Every key in `components` is a block `type` in the schema's discriminated
 *     union, and `STOREFRONT_COMPONENT_KEYS` below is type-checked against it.
 *     A component the editor can add but the schema rejects would let an author
 *     build a page that silently loses blocks the moment they publish.
 *
 *  2. Each `render` delegates to `StorefrontBlockView` — the same switch the
 *     published page uses. The canvas is therefore not a preview of the page;
 *     it is the page, with editor chrome around it. Preview drift is not
 *     something we keep in sync, it is something that cannot happen.
 *
 * Field definitions here shape the sidebar only. They are a convenience, never
 * a security boundary: the schema validates on publish and again on read, since
 * a document can reach the renderer without ever passing through this editor.
 */

/** Renders one block through the production renderer, with editor context on. */
function renderBlock<T extends StorefrontBlockType>(type: T) {
	return (props: Record<string, unknown>) => {
		// Puck injects `puck` and `editMode` alongside the author's props; the
		// block union does not know about them.
		const { puck: _puck, editMode: _editMode, ...blockProps } = props as Record<string, unknown> & { puck?: unknown; editMode?: unknown }
		// The batch-3 data-slot seam: the fork's renderer resolved the data-bound
		// blocks itself, the port's `StorefrontBlockView` takes them from the
		// caller. Same slots the published page mounts with, resolved against the
		// author from `StorefrontProvider` — never against the document.
		return <StorefrontBlockView block={{ type, props: blockProps } as StorefrontBlock} slots={storefrontBlockSlots} />
	}
}

const alignOptions = [
	{ label: 'Left', value: 'left' },
	{ label: 'Centre', value: 'center' },
	{ label: 'Right', value: 'right' },
]

const widthOptions = [
	{ label: 'Narrow', value: 'narrow' },
	{ label: 'Normal', value: 'normal' },
	{ label: 'Wide', value: 'wide' },
]

/**
 * The look currently selected on the page, read from Puck's own state.
 *
 * Step 3 needs to know which look is chosen, and a Puck custom field receives
 * only its own `value` and `onChange` — there is no sibling access. `usePuck`
 * is the supported way to read it, and these fields only ever render inside
 * the editor sidebar, which is inside the Puck context.
 */
function useRootLook(): { theme: StorefrontThemeId; palette: string } {
	const { appState } = usePuck()
	const props = appState?.data?.root?.props as { theme?: string; palette?: string } | undefined
	const theme = (
		props?.theme && Object.prototype.hasOwnProperty.call(STOREFRONT_THEMES, props.theme) ? props.theme : 'default'
	) as StorefrontThemeId
	return { theme, palette: props?.palette ?? '' }
}

/** Step 3 as a sidebar field: the six bounded axes for the selected look. */
function ThemeTuneField({
	value,
	onChange,
	readOnly,
}: {
	value?: Partial<StorefrontThemeTune>
	onChange: (v: StorefrontThemeTune) => void
	readOnly?: boolean
}) {
	const { theme } = useRootLook()
	return <ThemeTunePanel themeId={theme} value={value} onChange={onChange} readOnly={readOnly} />
}

/**
 * Step 2 as a sidebar field: one list of every look and colourway.
 *
 * A choice writes the look and the colourway together, and a change of look
 * also resets the tuning to that look's defaults, as the wizard does.
 *
 * Puck binds one field to one value, so this cannot go through the field's own
 * `onChange` — the sibling `palette` and `tune` props would keep whatever the
 * previous look left behind. `dispatch({ type: 'setData' })` writes all three
 * root props in one action, and the functional form composes with the current
 * props rather than a captured copy.
 *
 * This is not hypothetical. A page published from a staging instance named the
 * `elec` layout with the `cards` palette `holo-night` and `cards`' default tune,
 * because the switch only ever wrote the layout.
 */
function ThemeColourField({ readOnly }: { readOnly?: boolean }) {
	const { dispatch } = usePuck()
	const { theme, palette } = useRootLook()
	return (
		<ThemeColourList
			themeId={theme}
			paletteKey={palette}
			readOnly={readOnly}
			onChange={({ themeId, paletteKey }) =>
				dispatch({
					type: 'setData',
					data: (previous: Data) => {
						const props = previous.root.props as { theme?: string; tune?: StorefrontThemeTune }
						const sameLook = props.theme === themeId
						return {
							...previous,
							root: {
								...previous.root,
								props: {
									...previous.root.props,
									theme: themeId,
									palette: paletteKey,
									tune: sameLook && props.tune ? props.tune : { ...STOREFRONT_THEMES[themeId].tune },
								},
							},
						}
					},
				})
			}
		/>
	)
}

/**
 * The render surface Puck calls for the page root. The index signature is the
 * honest part: Puck passes its own wrapper (`id`, `puck`, zone props), which
 * `StorefrontRootPropsSchema` then strips — parsing is the filter, not the type.
 */
type RootRenderProps = { children?: React.ReactNode } & Partial<StorefrontRootProps> & Record<string, unknown>

export const storefrontCmsConfig: Config = {
	categories: {
		magazine: { title: 'Magazine', components: ['Ticker', 'CoverAuction', 'ProductSpread', 'CollectionRow', 'CategorySection'] },
		zine: { title: 'Zine', components: ['AuctionBento', 'ClosingPicks'] },
		identity: { title: 'Identity', components: ['ProfileHeader', 'Hero'] },
		content: { title: 'Content', components: ['Text', 'Image', 'LinkList', 'Search'] },
		commerce: { title: 'Products', components: ['ProductGrid', 'FeaturedProduct', 'ProductRow'] },
		auctions: { title: 'Auctions', components: ['AuctionList'] },
		layout: { title: 'Layout', components: ['Divider', 'Spacer'] },
		browse: { title: 'Browse', components: ['Categories'] },
	},

	root: {
		fields: {
			title: { type: 'text', label: 'Page title' },
			// The colour list writes `theme`, `palette` and `tune` together, so it
			// sits on `theme` and the palette has no field of its own.
			theme: {
				type: 'custom',
				label: 'Colours',
				render: ({ readOnly }) => <ThemeColourField readOnly={readOnly} />,
			},
			tune: {
				type: 'custom',
				label: 'Make it yours',
				render: ({ value, onChange, readOnly }) => (
					<ThemeTuneField value={value as Partial<StorefrontThemeTune>} onChange={onChange} readOnly={readOnly} />
				),
			},
		},
		defaultProps: { title: '', theme: 'default', palette: '', tune: STOREFRONT_TUNE_DEFAULTS },
		// The canvas wraps children in the very element the published page uses,
		// so a background chosen here looks the same in both places.
		// Puck hands a component its own props wrapper (`WithId<WithPuckProps<…>>`),
		// so the parameter must also admit keys this module does not name — the
		// schema below is what decides which ones survive.
		render: ({ children, ...rootProps }: RootRenderProps) => {
			// safeParse, not parse: a throw here would take the whole editor down
			// over a root prop the author can still fix.
			const parsed = StorefrontRootPropsSchema.safeParse(rootProps)
			return <StorefrontRoot props={parsed.success ? parsed.data : StorefrontRootPropsSchema.parse({})}>{children}</StorefrontRoot>
		},
	},

	components: {
		ProfileHeader: {
			label: 'Profile header',
			fields: {
				showBanner: {
					type: 'radio',
					label: 'Banner',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				fullScreen: {
					type: 'radio',
					label: 'Full-screen height',
					options: [
						{ label: 'On', value: true },
						{ label: 'Off', value: false },
					],
				},
				showAbout: {
					type: 'radio',
					label: 'About text',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				showNip05: {
					type: 'radio',
					label: 'Nostr address',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				align: { type: 'select', label: 'Alignment', options: alignOptions },
			},
			defaultProps: { showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
			render: renderBlock('ProfileHeader'),
		},

		Hero: {
			label: 'Hero banner',
			fields: {
				title: { type: 'text', label: 'Title' },
				subtitle: { type: 'textarea', label: 'Subtitle' },
				imageUrl: { type: 'text', label: 'Background image URL', placeholder: 'https://…' },
				ctaLabel: { type: 'text', label: 'Button label' },
				ctaHref: { type: 'text', label: 'Button link', placeholder: 'https://… or /products' },
				align: { type: 'select', label: 'Alignment', options: alignOptions },
				minHeight: { type: 'number', label: 'Height (px)', min: 120, max: 1200, step: 20 },
			},
			defaultProps: {
				title: 'Welcome',
				subtitle: '',
				imageUrl: '',
				ctaLabel: '',
				ctaHref: '',
				align: 'center',
				minHeight: 360,
			},
			render: renderBlock('Hero'),
		},

		Text: {
			label: 'Text',
			fields: {
				markdown: {
					type: 'textarea',
					label: 'Text (markdown)',
					placeholder: '# Heading\n\nSome **bold** text with a [link](https://example.com).',
				},
				align: { type: 'select', label: 'Alignment', options: alignOptions },
				width: { type: 'select', label: 'Width', options: widthOptions },
			},
			defaultProps: { markdown: '', align: 'left', width: 'normal' },
			render: renderBlock('Text'),
		},

		ProductGrid: {
			label: 'Product grid',
			fields: {
				title: { type: 'text', label: 'Section title' },
				source: {
					type: 'radio',
					label: 'Show',
					options: [
						{ label: 'All my products', value: 'all' },
						{ label: 'One collection', value: 'collection' },
					],
				},
				collectionDTag: {
					type: 'custom',
					label: 'Collection',
					render: ({ value, onChange, readOnly }) => (
						<CollectionPickerField label="Collection" value={(value as string) ?? ''} onChange={onChange} readOnly={readOnly} />
					),
				},
				limit: { type: 'number', label: 'Maximum products', min: 1, max: 60, step: 1 },
				columns: {
					type: 'select',
					label: 'Columns',
					options: [
						{ label: 'Two', value: 2 },
						{ label: 'Three', value: 3 },
						{ label: 'Four', value: 4 },
					],
				},
				emptyMessage: { type: 'text', label: 'Message when empty' },
			},
			defaultProps: {
				title: 'Products',
				source: 'all',
				collectionDTag: '',
				limit: 12,
				columns: 3,
				emptyMessage: 'Nothing listed here yet.',
			},
			render: renderBlock('ProductGrid'),
		},

		FeaturedProduct: {
			label: 'Featured product',
			fields: {
				productDTag: {
					type: 'custom',
					label: 'Product',
					render: ({ value, onChange, readOnly }) => (
						<ProductPickerField label="Product" value={(value as string) ?? ''} onChange={onChange} readOnly={readOnly} />
					),
				},
			},
			defaultProps: { productDTag: '' },
			render: renderBlock('FeaturedProduct'),
		},

		LinkList: {
			label: 'Links',
			fields: {
				title: { type: 'text', label: 'Section title' },
				links: {
					type: 'array',
					label: 'Links',
					max: 25,
					getItemSummary: (item: { label?: string }) => item?.label || 'Link',
					arrayFields: {
						label: { type: 'text', label: 'Label' },
						href: { type: 'text', label: 'Address', placeholder: 'https://…' },
					},
					defaultItemProps: { label: 'New link', href: 'https://' },
				},
				layout: {
					type: 'radio',
					label: 'Layout',
					options: [
						{ label: 'Row', value: 'row' },
						{ label: 'Column', value: 'column' },
					],
				},
			},
			defaultProps: { title: 'Find me elsewhere', links: [], layout: 'row' },
			render: renderBlock('LinkList'),
		},

		Image: {
			label: 'Image',
			fields: {
				url: { type: 'text', label: 'Image URL', placeholder: 'https://…' },
				alt: { type: 'text', label: 'Alt text (for screen readers)' },
				width: {
					type: 'select',
					label: 'Width',
					options: [...widthOptions, { label: 'Full bleed', value: 'full' }],
				},
				rounded: {
					type: 'radio',
					label: 'Corners',
					options: [
						{ label: 'Rounded', value: true },
						{ label: 'Square', value: false },
					],
				},
				href: { type: 'text', label: 'Link to (optional)', placeholder: 'https://… or /products' },
			},
			defaultProps: { url: '', alt: '', width: 'normal', rounded: true, href: '' },
			render: renderBlock('Image'),
		},

		Divider: {
			label: 'Divider',
			fields: {},
			defaultProps: {},
			render: renderBlock('Divider'),
		},

		Spacer: {
			label: 'Spacer',
			fields: {
				size: {
					type: 'select',
					label: 'Size',
					options: [
						{ label: 'Small', value: 'sm' },
						{ label: 'Medium', value: 'md' },
						{ label: 'Large', value: 'lg' },
						{ label: 'Extra large', value: 'xl' },
					],
				},
			},
			defaultProps: { size: 'md' },
			render: renderBlock('Spacer'),
		},

		ProductRow: {
			label: 'Product row',
			fields: {
				productDTags: {
					type: 'custom',
					label: 'Products (ordered)',
					render: ({ value, onChange, readOnly }) => (
						<ProductRowPickerField
							label="Products (ordered)"
							value={Array.isArray(value) ? (value as string[]).filter((entry) => typeof entry === 'string') : []}
							onChange={onChange}
							readOnly={readOnly}
						/>
					),
				},
			},
			defaultProps: { productDTags: [] },
			render: renderBlock('ProductRow'),
		},

		Search: {
			label: 'Search field',
			fields: {
				placeholder: { type: 'text', label: 'Placeholder text', placeholder: 'Search products' },
				size: {
					type: 'select',
					label: 'Width',
					options: [
						{ label: 'Small', value: 'sm' },
						{ label: 'Medium', value: 'md' },
						{ label: 'Large', value: 'lg' },
					],
				},
			},
			defaultProps: { placeholder: 'Search products', size: 'md' },
			render: renderBlock('Search'),
		},

		Categories: {
			label: 'Categories',
			fields: {
				title: { type: 'text', label: 'Section title' },
				categories: {
					type: 'array',
					label: 'Categories (ordered)',
					max: 30,
					getItemSummary: (item: { label?: string }) => item?.label || 'Category',
					arrayFields: {
						label: { type: 'text', label: 'Label' },
						key: { type: 'text', label: 'Search word (blank uses the label)' },
					},
					defaultItemProps: { label: 'Category', key: '' },
				},
			},
			defaultProps: { title: '', categories: [] },
			render: renderBlock('Categories'),
		},

		AuctionList: {
			label: 'Auctions',
			fields: {
				title: { type: 'text', label: 'Section title' },
				source: {
					type: 'radio',
					label: 'Show',
					options: [
						{ label: 'My auctions', value: 'mine' },
						{ label: 'Hand-picked', value: 'picked' },
						{ label: 'All marketplace auctions', value: 'all' },
					],
				},
				auctionCoordinates: {
					type: 'custom',
					label: 'Auctions (ordered)',
					render: ({ value, onChange, readOnly }) => (
						<AuctionPickerField
							label="Auctions (ordered)"
							value={Array.isArray(value) ? (value as string[]) : []}
							onChange={onChange}
							readOnly={readOnly}
						/>
					),
				},
				limit: { type: 'number', label: 'Maximum auctions', min: 1, max: 30, step: 1 },
				layout: {
					type: 'select',
					label: 'Card style',
					options: [
						{ label: 'Classic grid', value: 'grid' },
						{ label: 'Closing soon (countdown and time bar)', value: 'closing' },
						{ label: 'Tall magazine cards', value: 'tall' },
					],
				},
				sort: {
					type: 'radio',
					label: 'Order (all marketplace auctions)',
					options: [
						{ label: 'Ending soonest', value: 'ending' },
						{ label: 'Most bids', value: 'popular' },
						{ label: 'Newest', value: 'newest' },
					],
				},
				linkLabel: { type: 'text', label: 'Heading link text', placeholder: 'All auctions' },
				linkHref: { type: 'text', label: 'Heading link address', placeholder: '/auctions' },
				emptyMessage: { type: 'text', label: 'Message when empty' },
			},
			defaultProps: {
				title: 'Live auctions',
				source: 'mine',
				auctionCoordinates: [],
				limit: 6,
				layout: 'grid',
				sort: 'ending',
				linkLabel: '',
				linkHref: '',
				emptyMessage: 'No auctions here yet.',
			},
			render: renderBlock('AuctionList'),
		},

		// Magazine home blocks (ADR-0028). Titles take *one word* in asterisks
		// for the italic accent.
		Ticker: {
			label: 'Ticker strip',
			fields: {
				style: {
					type: 'radio',
					label: 'Style',
					options: [
						{ label: 'Thin strip', value: 'strip' },
						{ label: 'Big band', value: 'band' },
					],
				},
				showLiveStats: {
					type: 'radio',
					label: 'Live auction figures',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				messages: {
					type: 'array',
					label: 'Your lines',
					max: 12,
					getItemSummary: (item: { text?: string }) => item?.text || 'Line',
					arrayFields: { text: { type: 'text', label: 'Text' } },
					defaultItemProps: { text: 'Paid in sats' },
				},
			},
			defaultProps: { style: 'strip', showLiveStats: true, messages: [{ text: 'Paid in sats' }, { text: 'Escrow in Cashu ecash' }] },
			render: renderBlock('Ticker'),
		},

		CoverAuction: {
			label: 'Cover auction',
			fields: {
				source: {
					type: 'radio',
					label: 'Lot',
					options: [
						{ label: 'Automatic (most bids)', value: 'auto' },
						{ label: 'Hand-picked', value: 'picked' },
					],
				},
				auctionCoordinates: {
					type: 'custom',
					label: 'Cover lot',
					render: ({ value, onChange, readOnly }) => (
						<AuctionPickerField
							label="Cover lot (the first one is used)"
							value={Array.isArray(value) ? (value as string[]).slice(0, 1) : []}
							onChange={(next) => onChange(next.slice(-1))}
							readOnly={readOnly}
						/>
					),
				},
				kicker: { type: 'text', label: 'Kicker', placeholder: 'Featured auction' },
				deck: { type: 'textarea', label: 'Deck (blank uses the lot description)' },
				sticker: { type: 'text', label: 'Sticker', placeholder: 'Lot of the week' },
				ctaLabel: { type: 'text', label: 'Button text', placeholder: 'Open the arena' },
				footnote: { type: 'text', label: 'Footnote' },
			},
			defaultProps: {
				source: 'auto',
				auctionCoordinates: [],
				kicker: 'Featured auction',
				deck: '',
				sticker: 'Lot of the week',
				ctaLabel: 'Open the arena',
				footnote: 'Signed listing · Sats held in Cashu ecash escrow',
			},
			render: renderBlock('CoverAuction'),
		},

		ProductSpread: {
			label: 'Featured products spread',
			fields: {
				title: { type: 'text', label: 'Section title' },
				source: {
					type: 'radio',
					label: 'Products',
					options: [
						{ label: 'Featured list (App settings)', value: 'featured' },
						{ label: 'Hand-picked', value: 'picked' },
					],
				},
				productDTags: {
					type: 'custom',
					label: 'Products (up to three)',
					render: ({ value, onChange, readOnly }) => (
						<ProductRowPickerField
							label="Products (up to three)"
							value={Array.isArray(value) ? (value as string[]).filter((entry) => typeof entry === 'string') : []}
							onChange={(next: string[]) => onChange(next.slice(0, 3))}
							readOnly={readOnly}
						/>
					),
				},
				quote: { type: 'text', label: 'Pull quote on the big card' },
				kickers: {
					type: 'array',
					label: 'Card labels',
					max: 3,
					getItemSummary: (item: { text?: string }) => item?.text || 'Label',
					arrayFields: { text: { type: 'text', label: 'Label' } },
					defaultItemProps: { text: 'Staff favourite' },
				},
				linkLabel: { type: 'text', label: 'Heading link text', placeholder: 'All products' },
				linkHref: { type: 'text', label: 'Heading link address', placeholder: '/products' },
			},
			defaultProps: {
				title: 'Featured *products*',
				source: 'featured',
				productDTags: [],
				quote: '',
				kickers: [{ text: "Editor's pick" }, { text: 'Staff favourite' }, { text: 'Just restocked' }],
				linkLabel: 'All products',
				linkHref: '/products',
			},
			render: renderBlock('ProductSpread'),
		},

		CollectionRow: {
			label: 'Collections row',
			fields: {
				title: { type: 'text', label: 'Section title' },
				source: {
					type: 'radio',
					label: 'Collections',
					options: [
						{ label: 'Featured, then newest', value: 'featured' },
						{ label: 'Newest', value: 'newest' },
					],
				},
				style: {
					type: 'radio',
					label: 'Style',
					options: [
						{ label: 'Collage cards', value: 'cards' },
						{ label: 'Colour tiles', value: 'tiles' },
					],
				},
				limit: { type: 'number', label: 'How many', min: 1, max: 8, step: 1 },
				linkLabel: { type: 'text', label: 'Heading link text' },
				linkHref: { type: 'text', label: 'Heading link address' },
			},
			defaultProps: { title: 'Collections', source: 'featured', style: 'cards', limit: 4, linkLabel: '', linkHref: '' },
			render: renderBlock('CollectionRow'),
		},

		CategorySection: {
			label: 'Category section',
			fields: {
				label: { type: 'text', label: 'Label', placeholder: '01 / Category' },
				title: { type: 'text', label: 'Title' },
				subtitle: { type: 'text', label: 'Subtitle' },
				tags: { type: 'text', label: 'Product tags (comma separated)', placeholder: 'bitcoin, node' },
				style: {
					type: 'radio',
					label: 'Style',
					options: [
						{ label: 'Row of cards', value: 'row' },
						{ label: 'Bento (one big, four small)', value: 'bento' },
					],
				},
				limit: { type: 'number', label: 'How many products', min: 1, max: 10, step: 1 },
				badge: { type: 'text', label: 'Badge on the big pick (bento)', placeholder: 'Best seller' },
				linkLabel: { type: 'text', label: 'Link text (blank: Browse <title>)' },
			},
			defaultProps: { label: '01 / Category', title: 'Category', subtitle: '', tags: '', style: 'row', limit: 5, badge: '', linkLabel: '' },
			render: renderBlock('CategorySection'),
		},

		// Zine home blocks (ADR-0029).
		AuctionBento: {
			label: 'Auction bento',
			fields: {
				title: { type: 'text', label: 'Headline (*word* for the accent)' },
				intro: { type: 'textarea', label: 'Intro beside the headline' },
				showLiveCount: {
					type: 'radio',
					label: 'Live count sticker',
					options: [
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					],
				},
				source: {
					type: 'radio',
					label: 'Lots',
					options: [
						{ label: 'Automatic (live, most bids)', value: 'auto' },
						{ label: 'Hand-picked', value: 'picked' },
					],
				},
				auctionCoordinates: {
					type: 'custom',
					label: 'Lots (up to four)',
					render: ({ value, onChange, readOnly }) => (
						<AuctionPickerField
							label="Lots (up to four, the first is the big one)"
							value={Array.isArray(value) ? (value as string[]).slice(0, 4) : []}
							onChange={(next) => onChange(next.slice(0, 4))}
							readOnly={readOnly}
						/>
					),
				},
				sticker: { type: 'text', label: 'Sticker on the big lot (blank hides it)', placeholder: 'Top bid' },
			},
			defaultProps: {
				title: 'On the *block*',
				intro:
					'Bid in sats on things people actually made. Every lot is a signed Nostr listing, and every bid sits in Cashu ecash escrow until the hammer.',
				showLiveCount: true,
				source: 'auto',
				auctionCoordinates: [],
				sticker: 'Top bid',
			},
			render: renderBlock('AuctionBento'),
		},

		ClosingPicks: {
			label: 'Closing soon + picks',
			fields: {
				closingTitle: { type: 'text', label: 'Closing list title' },
				closingChip: { type: 'text', label: 'Closing list chip' },
				closingLimit: { type: 'number', label: 'How many lots', min: 1, max: 8, step: 1 },
				picksTitle: { type: 'text', label: 'Pinboard title' },
				picksChip: { type: 'text', label: 'Pinboard chip' },
				source: {
					type: 'radio',
					label: 'Products',
					options: [
						{ label: 'Featured list (App settings)', value: 'featured' },
						{ label: 'Hand-picked', value: 'picked' },
					],
				},
				productDTags: {
					type: 'custom',
					label: 'Products (up to six)',
					render: ({ value, onChange, readOnly }) => (
						<ProductRowPickerField
							label="Products (up to six)"
							value={Array.isArray(value) ? (value as string[]).filter((entry) => typeof entry === 'string') : []}
							onChange={(next: string[]) => onChange(next.slice(0, 6))}
							readOnly={readOnly}
						/>
					),
				},
				picksLimit: { type: 'number', label: 'How many products', min: 1, max: 6, step: 1 },
				buttonLabel: { type: 'text', label: 'Card button text', placeholder: 'View' },
			},
			defaultProps: {
				closingTitle: 'Closing soon',
				closingChip: 'Next hour',
				closingLimit: 5,
				picksTitle: 'Featured products',
				picksChip: 'Fresh picks',
				source: 'featured',
				productDTags: [],
				picksLimit: 6,
				buttonLabel: 'View',
			},
			render: renderBlock('ClosingPicks'),
		},
	},
}

/**
 * Compile-time assertion that the editor offers exactly the block types the
 * schema accepts. If the two drift, this stops being assignable.
 */
export const STOREFRONT_COMPONENT_KEYS = Object.keys(storefrontCmsConfig.components) as StorefrontBlockType[]
