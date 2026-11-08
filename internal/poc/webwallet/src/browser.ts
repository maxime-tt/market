// Browser entry point: exposes exactly the wallet surface the demo page uses.
import { BidderWallet, browserStorage, memoryStorage, refundClaimMessage, refundClaimMessageV2 } from "./wallet";

declare global {
  interface Window {
    PlebeianWallet: {
      BidderWallet: typeof BidderWallet;
      browserStorage: typeof browserStorage;
      memoryStorage: typeof memoryStorage;
      refundClaimMessage: typeof refundClaimMessage;
      refundClaimMessageV2: typeof refundClaimMessageV2;
    };
  }
}

window.PlebeianWallet = { BidderWallet, browserStorage, memoryStorage, refundClaimMessage, refundClaimMessageV2 };
