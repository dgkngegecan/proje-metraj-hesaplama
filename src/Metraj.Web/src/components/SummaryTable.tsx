import { useMemo } from 'react';
import { parseDecimal, purchaseUnit, quantity } from '../lib/format';
import type { Measurement, MeasurementSummary, Placement } from '../types';

export function SummaryTable({
  summaries,
  measurements,
  placements = [],
}: {
  summaries: MeasurementSummary[];
  measurements: Measurement[];
  placements?: Placement[];
}) {
  // Derinlik ve boyut, sıralama KARŞILAŞTIRMASININ içinde hesaplanıyordu:
  // her karşılaştırmada `placements` baştan taranıyor, üstelik zincir boyunca
  // tekrar tekrar. Malzeme listesi büyüdükçe tablo gözle görülür yavaşlıyordu.
  // Anahtarlar artık satır başına bir kez, sıralamadan önce hesaplanıyor.
  const depthOf = useMemo(() => {
    const parentById = new Map(placements.map((item) => [item.id, item.parentPlacementId ?? null]));
    const depths = new Map<string, number>();
    return (id: string) => {
      const cached = depths.get(id);
      if (cached !== undefined) return cached;
      let depth = 0;
      let cursor = parentById.get(id) ?? null;
      while (cursor && depth < 12) {
        depth += 1;
        cursor = parentById.get(cursor) ?? null;
      }
      depths.set(id, depth);
      return depth;
    };
  }, [placements]);
  const sizeOf = (name: string) => parseDecimal(name.match(/(?:DN\s*|\b)(\d+(?:[.,]\d+)?)/i)?.[1] ?? '') || 0;
  const sorted = useMemo(
    () =>
      summaries
        .map((summary) => ({
          summary,
          depth: depthOf(summary.placementId),
          size: sizeOf(summary.variant ?? summary.placementName),
        }))
        .sort(
          (a, b) =>
            a.depth - b.depth ||
            b.size - a.size ||
            a.summary.placementName.localeCompare(b.summary.placementName, 'tr') ||
            (a.summary.variant ?? '').localeCompare(b.summary.variant ?? '', 'tr'),
        )
        .map((row) => row.summary),
    [summaries, depthOf],
  );
  return (
    <section className="summary-section">
      <div className="summary-heading">
        <div>
          <span className="eyebrow">DÜZENLİ METRAJ</span>
          <h3>Malzeme listesi</h3>
        </div>
        <span>{measurements.length} kaynak satırı</span>
      </div>
      {sorted.length ? (
        <div className="summary-list">
          {sorted.map((summary) => (
            <div
              className="summary-row"
              key={`${summary.placementId}:${summary.variant ?? ''}:${summary.secondaryVariant ?? ''}`}
              style={{ '--tree-depth': depthOf(summary.placementId) } as React.CSSProperties}
            >
              <div>
                <strong>{summary.placementName}</strong>
                <small>
                  {[summary.variant, summary.secondaryVariant].filter(Boolean).join(' · ') || 'Standart'} ·{' '}
                  {summary.measurementCount} giriş · {summary.unit}
                </small>
              </div>
              <div>
                <span>Net</span>
                <b>{quantity(summary.netQuantity)}</b>
              </div>
              <div>
                <span>Fireli</span>
                <b>{quantity(summary.withWasteQuantity)}</b>
              </div>
              <div>
                <span>Satın alma</span>
                <b>
                  {quantity(summary.purchaseQuantity)} {purchaseUnit(summary)}
                </b>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-table">Henüz metraj yok. Haritada bir malzeme seçip miktarı yazın.</div>
      )}
    </section>
  );
}
