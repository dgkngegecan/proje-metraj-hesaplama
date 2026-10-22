import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from './Icon';
import { createSearchIndex } from './search.ts';

export interface SearchableListProps<T extends object> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Ekran okuyucu için listenin adı: "Kartlar". */
  ariaLabel: string;
  /** Verilirse üstte arama kutusu görünür; metin Türkçe duyarlı aranır. */
  searchText?: (item: T) => string;
  searchPlaceholder?: string;
  /** Denetimli arama (ör. sorguyu taslak olarak saklamak için). */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Satır yüksekliği tahmini (px); gerçek yükseklik ölçülür. */
  estimateSize?: number;
  overscan?: number;
  /** Liste hiç öğe içermiyorsa. */
  emptyState?: ReactNode;
  /** Arama sonuç vermezse. */
  noResultsState?: ReactNode;
  /** Arama kutusunun altında, liste üstünde sabit içerik (sayaç, süzgeç çipleri). */
  header?: ReactNode;
  /** Listenin altında boşluk (ör. yüzen düğmenin arkasında kalmasın). */
  bottomPadding?: number;
}

/**
 * Arama kutulu, sanallaştırılmış liste. Yalnız görünen satırlar (+ birkaç
 * satır pay) çizilir: 2.000 satırlık bir proje ağacı veya katalog, düşük
 * segment bir telefonda da 60 fps kayar. Satır yükseklikleri ölçülür, yani
 * satırlar farklı yükseklikte olabilir. Arama metni öğe başına bir kez
 * sadeleştirilir ve yazarken liste `useDeferredValue` ile geriden gelir
 * (tuş vuruşu bekletilmez).
 */
export function SearchableList<T extends object>({
  items,
  getKey,
  renderItem,
  ariaLabel,
  searchText,
  searchPlaceholder = 'Ara',
  query: controlledQuery,
  onQueryChange,
  estimateSize = 64,
  overscan = 8,
  emptyState,
  noResultsState,
  header,
  bottomPadding = 0,
}: SearchableListProps<T>) {
  const [ownQuery, setOwnQuery] = useState('');
  const query = controlledQuery ?? ownQuery;
  const setQuery = (next: string) => {
    if (controlledQuery === undefined) setOwnQuery(next);
    onQueryChange?.(next);
  };
  const deferredQuery = useDeferredValue(query);
  const textRef = useRef(searchText);
  textRef.current = searchText;
  const search = useMemo(() => createSearchIndex<T>((item) => textRef.current?.(item) ?? ''), []);
  const visible = useMemo(
    () => (searchText ? search(items, deferredQuery) : items),
    [items, deferredQuery, search, searchText],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => getKey(visible[index]!),
    paddingEnd: bottomPadding,
  });

  const stale = query !== deferredQuery;
  return (
    <div className="m-vlist-wrap">
      {searchText && (
        <div className="m-search" role="search">
          <Icon name="search" size={20} />
          <input
            className="m-search__input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" className="m-icon-button" aria-label="Aramayı temizle" onClick={() => setQuery('')}>
              <Icon name="close" size={20} />
            </button>
          )}
        </div>
      )}
      {header}
      {!items.length && emptyState ? (
        emptyState
      ) : !visible.length && noResultsState ? (
        noResultsState
      ) : (
        <div
          ref={scrollRef}
          className={`m-vlist${stale ? ' is-stale' : ''}`}
          role="list"
          aria-label={ariaLabel}
          aria-busy={stale || undefined}
        >
          <div className="m-vlist__inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = visible[row.index]!;
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className="m-vlist__row"
                  role="listitem"
                  aria-setsize={visible.length}
                  aria-posinset={row.index + 1}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  {renderItem(item, row.index)}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {searchText && query && (
        <p className="m-visually-hidden" aria-live="polite">
          {visible.length} sonuç
        </p>
      )}
    </div>
  );
}
