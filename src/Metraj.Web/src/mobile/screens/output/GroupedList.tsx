import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface GroupedRow {
  key: string;
  /** Aynı gruptaki satırlar aynı `groupKey`'i paylaşır; yapışkan başlık buna göre seçilir. */
  groupKey: string;
}

/**
 * Başlıkları yapışkan, sanallaştırılmış liste. Yalnız görünen satırlar çizilir (yüzlerce
 * malzeme satırında da akıcı kayar); kaydırırken en üstteki satırın grubunun başlığı
 * listenin üstünde sabit kalır.
 *
 * Neden `position: sticky` değil: sanallaştırılmış satırlar mutlak konumlu ve kaydırma
 * dışına çıkınca DOM'dan silinir; başlık satırı da silinirse yapışacak bir şey kalmaz.
 * Bu yüzden başlık ayrı bir katmanda, kaydırma konumundan türetilerek çizilir.
 */
export function GroupedList<R extends GroupedRow>({
  rows,
  renderRow,
  renderSticky,
  estimateSize,
  ariaLabel,
  bottomPadding = 16,
}: {
  rows: readonly R[];
  renderRow: (row: R) => ReactNode;
  /** Bir grubun yapışkan başlığı; `null` dönerse o grup için yapışkan başlık çizilmez. */
  renderSticky: (groupKey: string) => ReactNode;
  estimateSize: (row: R) => number;
  ariaLabel: string;
  bottomPadding?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateSize(rows[index]!),
    overscan: 8,
    getItemKey: (index) => rows[index]!.key,
    paddingEnd: bottomPadding,
  });

  const offset = virtualizer.scrollOffset ?? 0;
  const items = virtualizer.getVirtualItems();
  let current = items[0];
  for (const item of items) if (item.start <= offset + 1) current = item;
  const currentRow = current ? rows[current.index] : undefined;
  // Konum sıfırdayken ilk başlık zaten görünür; üstüne ikinci kez çizmeye gerek yok.
  const sticky = currentRow && offset > 0 ? renderSticky(currentRow.groupKey) : null;

  return (
    <div className="m-grouped">
      {sticky && <div className="m-grouped__sticky">{sticky}</div>}
      <div ref={scrollRef} className="m-vlist" role="list" aria-label={ariaLabel}>
        <div className="m-vlist__inner" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((virtual) => {
            const row = rows[virtual.index]!;
            return (
              <div
                key={virtual.key}
                ref={virtualizer.measureElement}
                data-index={virtual.index}
                className="m-vlist__row"
                role="listitem"
                aria-setsize={rows.length}
                aria-posinset={virtual.index + 1}
                style={{ transform: `translateY(${virtual.start}px)` }}
              >
                {renderRow(row)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
