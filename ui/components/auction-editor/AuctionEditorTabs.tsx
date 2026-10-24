// T6.3 retired this monolith slice by slice. S1 moved its pure helpers and shared
// types into `ui/utils/*` and `ui/auction/model.ts`; S5a moved its views into
// `ui/auction/{auction-editor-tabs,auction-tab-view,auction-shipping-view}.tsx`.
//
// What is left is a transitional re-export shim: the module's previous public
// surface, under its previous names, so existing importers (`ui/index.ts`, the
// legacy host `src/components/sheet-contents/auctions/AuctionFormContent.tsx`)
// keep resolving. S6 deletes this file and rewires those importers to the
// taxonomy paths directly. `ui/components/` is drained apart from this shim, and
// no new component may be added here.

export {
	AuctionCategoryTab as CategoryTab,
	AuctionImagesTab as ImagesTab,
	AuctionNameTab as NameTab,
	AuctionSpecTab as SpecTab,
} from '../../auction/auction-editor-tabs'
export { AuctionShippingView } from '../../auction/auction-shipping-view'
export { AuctionTabView as AuctionTabContent } from '../../auction/auction-tab-view'

export { parseDatetimeLocalSeconds, toDatetimeLocal } from '../../utils/datetime'
export type {
	AuctionImage,
	AuctionShippingOptionSummary,
	AuctionShippingViewProps,
	AuctionValidationMessages,
	EndMode,
	RenderAuctionImageUploader,
	StartMode,
	TabProps,
} from '../../auction/model'
