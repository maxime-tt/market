// Browser entry point: exposes exactly the wallet surface the demo page uses.
import { BidderWallet, browserStorage, memoryStorage, refundClaimMessage } from "./wallet";

declare global {
  interface Window {
    PlebeianWallet: {
      BidderWallet: typeof BidderWallet;
      browserStorage: typeof browserStorage;
      memoryStorage: typeof memoryStorage;
      refundClaimMessage: typeof refundClaimMessage;
    };
  }
}

window.PlebeianWallet = { BidderWallet, browserStorage, memoryStorage, refundClaimMessage };
