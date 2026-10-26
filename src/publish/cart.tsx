/**
 * Shim — the cart snapshot publish binding moved to `platform/web/cart/publishCartSnapshot.ts`
 * (store drain D2, slice 5).
 *
 * The binding resolves the app NDK/signer through the Platform publish bridge
 * (`@platform/web/ndkPublishContext`) and publishes the SDK cart-snapshot workflow, so a
 * Platform host module can consume it without a counted `platform -> src` edge. Vacated path
 * kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/cart/publishCartSnapshot'
