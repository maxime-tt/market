import { z } from 'zod';

export const ProductRowSchema = z.array(
  z.object({
    type: z.literal('product-row'),
    // Explicit 30402 coordinate: 30402:<64-hex-pubkey>:<d-tag>
    coordinate: z.string().refine(
      (s) => {
        const parts = s.split(':');
        if (parts.length !== 3) return false;
        const [kind, pubkey, dTag] = parts;
        return kind === '30402' &&
          /^([a-f0-9]{64})$/.test(pubkey) &&
          /^[a-zA-Z0-9._-]+$/.test(dTag);
      },
      {
        message: 'Must be a valid 30402 coordinate: 30402:<64-hex-pubkey>:<d-tag>',
      }
    ),
  })
);

export type ProductRow = z.infer<typeof ProductRowSchema>;

// The <d-tag> must be valid for kind 30402 (same as 30405, 30406)
const ValidCoordinateForKind30402 = z.object({
  kind: z.literal(30402),
  pubkey: z.string().length(64).regex(/^[a-f0-9]+$/),
  dTag: z.string().min(1).max(255),
});

export const validateCoordinate = (coordinate: string): boolean => {
  try {
    const [kind, pubkey, dTag] = coordinate.split(':');
    return (
      kind === '30402' &&
      /^[a-f0-9]{64}$/.test(pubkey) &&
      /^[a-zA-Z0-9._-]+$/.test(dTag)
    );
  } catch (error) {
    return false;
  }
};

// This block is editor-authored and may reference any author's listing.
// The security boundary is that references are explicit and validated,
// not that they are author-scoped. This block is an exception to the author-anchoring property of ProductGrid and FeaturedProduct.
export const ProductRowSlot = {
  type: 'product-row',
  resolve: async (coordinate: string) => {
    if (!validateCoordinate(coordinate)) {
      throw new Error(`Invalid coordinate: ${coordinate}`);
    }
    const [kind, pubkey, dTag] = coordinate.split(':');
    // Now get the actual product event at this exact coordinate
    const events = await getReadContext().fetch([
      { kind: 30402, authors: [pubkey], '#d': [dTag] },
    ]);
    if (events.length === 0) {
      return null; // Not found
    }
    return events[0]; // Return the first (highest created_at) by selectReplaceable rule
  },
};

export const getBlockType = () => 'product-row';

// JSDoc: This block is editor-authored and may reference any author's listing.
// What protects the page is that references are explicit and validated,
// not that they are author-scoped. This block crosses the author-anchoring property that ProductGrid enforces.
// The read strategy is bounded: each coordinate is resolved through a chunked `#d`+`authors` predicates,
// or per-coordinate reads. This is a bounded, explicitly-addressed list, so a bounded read is correct.
// This is the one place the read API's stream-first default yields to an explicit address list.
