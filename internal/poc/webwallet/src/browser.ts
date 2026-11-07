// Browser entry point: exposes exactly the wallet surface the demo page uses.
import { BidderWallet, browserStorage, refundPublicKeyFromNostr, memoryStorage } from "./wallet";

declare global {
  interface Window {
    PlebeianWallet: {
      BidderWallet: typeof BidderWallet;
      browserStorage: typeof browserStorage;
      memoryStorage: typeof memoryStorage;
      refundPublicKeyFromNostr: typeof refundPublicKeyFromNostr;
    };
  }
}

window.PlebeianWallet = { BidderWallet, browserStorage, memoryStorage, refundPublicKeyFromNostr };
