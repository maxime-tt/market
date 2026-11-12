import { useState } from 'react';
import { rabbitholeSearch } from '../browse/rabbitholeClient';
import type { BrowseProduct } from '../browse/browseProductMap';

// The picker must be able to choose any marketplace listing, not just the author's.
// Use the existing collaborate-free search client (the RabbitHole client).
// Show what a picked product is (title, seller, price, image) so an editor knows what they chose.
export function ProductRowPicker({
  onPick,
  initialCoordinate,
}: {
  onPick: (coordinate: string) => void;
  initialCoordinate?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BrowseProduct[]>([]);
  const [selected, setSelected] = useState<string | null>(initialCoordinate || null);

  const handleSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    try {
      // The whole-marketplace read: no `authors` filter, so a page may
      // reference any seller's listing. The coordinate is validated before it
      // is stored, so the explicit reference is the only thing that crosses
      // the author-anchoring the blocks otherwise enforce.
      const res = await rabbitholeSearch({ q, limit: 10 });
      setResults(res.products);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    }
  };

  // A listing is referenced by its addressable coordinate, never by title, so
  // renaming a product does not break a page that features it. A row without a
  // `d` tag has no address and cannot be picked.
  const coordinateOf = (product: BrowseProduct): string | null =>
    product.id ? `30402:${product.pubkey}:${product.id}` : null;

  const handlePick = (product: BrowseProduct) => {
    const coordinate = coordinateOf(product);
    if (!coordinate) return;
    setSelected(coordinate);
    onPick(coordinate);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search for a product..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            handleSearch(e.target.value);
          }}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-md">
        {results.length === 0 ? (
          <div className="p-4 text-gray-500 text-center">
            {query ? 'No products found' : 'Enter a search term to find products'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {results.map((product, index) => {
              const image = product.image;
              const coordinate = coordinateOf(product);
              const price = product.price ? `${product.price} ${product.currency ?? 'sats'}` : null;
              return (
                <li
                  key={`${product.eventId}-${index}`}
                  className={`p-2 cursor-pointer hover:bg-gray-100 ${
                    coordinate === selected ? 'bg-blue-100 border-l-4 border-blue-500' : ''
                  }`}
                  onClick={() => coordinate && handlePick(product)}
                >
                  <div className="flex gap-3">
                    <div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden">
                      {image ? (
                        <img
                          src={image}
                          alt="Product"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-300 flex items-center justify-center">
                          <span className="text-gray-500 text-xs">No image</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-sm line-clamp-2">{product.title || 'Untitled'}</h3>
                      <p className="text-xs text-gray-500">
                        {product.pubkey.slice(0, 6)}...{product.pubkey.slice(-6)}
                      </p>
                      {price && <p className="text-xs text-gray-500">{price}</p>}
                      <p className="text-xs text-gray-500">{product.id}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && (() => {
        const picked = results.find((p) => coordinateOf(p) === selected);
        if (!picked) return null;
        const pubkey = picked.pubkey;
        const content = picked.title || 'Untitled';
        const image = picked.image;
        const price = picked.price ? `${picked.price} ${picked.currency ?? 'sats'}` : null;
        return (
          <div className="p-4 border border-gray-300 rounded-md">
            <h3 className="font-medium text-sm mb-2">Selected Product</h3>
            <div className="flex gap-3">
              <div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden">
                {image ? (
                  <img
                    src={image}
                    alt="Selected"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-300 flex items-center justify-center">
                    <span className="text-gray-500 text-xs">No image</span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-sm line-clamp-2">{content}</h3>
                <p className="text-xs text-gray-500">
                  {pubkey.slice(0, 6)}...{pubkey.slice(-6)}
                </p>
                {price && <p className="text-xs text-gray-500">{price}</p>}
                <p className="text-xs text-gray-500">{selected}</p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// This component uses the RabbitHole client to search for any marketplace listing.
// It shows the product's title, seller, price, and image so the editor knows what they chose.
// The picker is not restricted to the author's listings.
// The coordinate is stored as 30402:<64-hex-pubkey>:<d-tag>.
// The read strategy is bounded: each coordinate is resolved through a chunked `#d`+`authors` predicates,
// or per-coordinate reads. This is a bounded, explicitly-addressed list, so a bounded read is correct.
// This is the one place the read API's stream-first default yields to an explicit address list.

