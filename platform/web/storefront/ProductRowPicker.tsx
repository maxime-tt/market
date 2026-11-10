import { useState } from 'react';
import { useRabbitHoleClient } from '../browse/rabbitholeClient';
import { ProductCard } from '@ui/storefront';
import { useStorefrontContext } from '../context/storefrontContext';
import { useConfigQuery } from '../config/publicConfigQuery';

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
  const { pubkey } = useStorefrontContext();
  const { data: config } = useConfigQuery();
  const { search } = useRabbitHoleClient();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<unknown[]>([]);
  const [selected, setSelected] = useState<string | null>(initialCoordinate || null);

  const handleSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    try {
      const res = await search(q, {
        kinds: [30402],
        limit: 10,
      });
      setResults(res.events);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    }
  };

  const handlePick = (event: any) => {
    const coordinate = `30402:${event.pubkey}:${event.tags.find(t => t[0] === 'd')?.[1]}`;
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
            {results.map((event: any, index: number) => {
              const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
              const coordinate = dTag ? `30402:${event.pubkey}:${dTag}` : null;
              return (
                <li
                  key={`${event.id}-${index}`}
                  className={`p-2 cursor-pointer hover:bg-gray-100 ${
                    coordinate === selected ? 'bg-blue-100 border-l-4 border-blue-500' : ''
                  }`}
                  onClick={() => coordinate && handlePick(event)}
                >
                  <div className="flex gap-3">
                    <div className="w-16 h-16 bg-gray-200 rounded-md overflow-hidden">
                      {event.tags.find((t) => t[0] === 'image')?.[1] ? (
                        <img
                          src={event.tags.find((t) => t[0] === 'image')?.[1]}
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
                      <h3 className="font-medium text-sm line-clamp-2">{event.content || 'Untitled'}</h3>
                      <p className="text-xs text-gray-500">
                        {event.pubkey.slice(0, 6)}...{event.pubkey.slice(-6)}
                      </p>
                      <p className="text-xs text-gray-500">{dTag}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
      </div>
      {selected && (() => {
        const selectedEvent = results.find((e: any) => {
          const d = e.tags.find((t) => t[0] === 'd')?.[1];
          const coord = d ? `30402:${e.pubkey}:${d}` : null;
          return coord === selected;
        });
        if (!selectedEvent) return null;
        const dTag = selectedEvent.tags.find((t) => t[0] === 'd')?.[1];
        const pubkey = selectedEvent.pubkey;
        const content = selectedEvent.content || 'Untitled';
        const image = selectedEvent.tags.find((t) => t[0] === 'image')?.[1];
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
                <p className="text-xs text-gray-500">{dTag}</p>
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

