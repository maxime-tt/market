import { StorefrontDataSlots } from '@ui/storefront';
import { useQuery } from '@tanstack/react-query';
import { useStorefrontContext } from '../context/storefrontContext';
import { useConfigQuery } from '../config/publicConfigQuery';
import { useProfile } from '../profiles/profileQuery';
import { useProductCardHost } from '../products/productCardHost';
import { useProductCollection } from '../products/productQuery';
import { useNip05Validation } from '../profiles/nip05ValidationQuery';
import { useRabbitHoleClient } from '../browse/rabbitholeClient';

// The ProductRow slot is editor-authored and may reference any author's listing.
// It is not author-scoped; it uses explicit coordinates.
// This block crosses the author-anchoring property that ProductGrid enforces.
export const StorefrontBlockSlots: StorefrontDataSlots = {
  ProductGrid: {
    query: (pubkey) => useProductCollection(pubkey),
    renderProduct: useProductCardHost(),
  },
  FeaturedProduct: {
    query: (pubkey) => useProductCollection(pubkey),
    renderProduct: useProductCardHost(),
  },
  ProductRow: {
    query: (coordinate) => {
      // Validate coordinate format: 30402:<64-hex-pubkey>:<d-tag>
      if (!coordinate || !coordinate.includes(':')) {
        throw new Error('Invalid coordinate format');
      }
      const [kind, pubkey, dTag] = coordinate.split(':');
      if (kind !== '30402' || !pubkey || !dTag) {
        throw new Error('Invalid coordinate: must be 30402:<64-hex-pubkey>:<d-tag>');
      }
      if (!/^[a-f0-9]{64}$/.test(pubkey)) {
        throw new Error('Invalid pubkey in coordinate');
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(dTag)) {
        throw new Error('Invalid d-tag in coordinate');
      }
      // Fetch the specific product event at this coordinate
      return useQuery({
        queryKey: ['product-row', pubkey, dTag],
        queryFn: async () => {
          const events = await getReadContext().fetch([
            { kind: 30402, authors: [pubkey], '#d': [dTag] },
          ]);
          if (events.length === 0) {
            return null;
          }
          return events[0];
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
      });
    },
    renderProduct: useProductCardHost(),
  },
  ProfileHeader: {
    query: (pubkey) => useProfile(pubkey),
    nip05Validation: useNip05Validation(),
  },
};

// This block is editor-authored and may reference any author's listing.
// What protects the page is that references are explicit and validated,
// not that they are author-scoped. This block crosses the author-anchoring property that ProductGrid enforces.
// The read strategy is bounded: each coordinate is resolved through a chunked `#d`+`authors` predicates,
// or per-coordinate reads. This is a bounded, explicitly-addressed list, so a bounded read is correct.
// This is the one place the read API's stream-first default yields to an explicit address list.
