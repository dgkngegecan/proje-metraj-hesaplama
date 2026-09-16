import { useState } from 'react';
import { quantity } from '../lib/format';
import type { RadiatorSummary } from '../types';
import './radiator-summary.css';

const total = (rows: RadiatorSummary[], key: 'netQuantity' | 'withWasteQuantity' | 'purchaseQuantity') =>
  quantity(rows.reduce((sum, row) => sum + row[key], 0));

export function RadiatorSummaryTable({ rows }: { rows: RadiatorSummary[] }) {
  const [selectedType, setSelectedType] = useState('');
  if (!rows.length) return null;
  const types = [...new Set(rows.map((row) => row.type))];
  const units = [...new Set(rows.map((row) => row.unit))];
  const selected = types.includes(selectedType) ? selectedType : '';
  const visible = rows.filter((row) => !selected || row.type === selected);
  const groups = new Map<string, RadiatorSummary[]>();
  for (const row of visible) {
    const key = JSON.stringify([row.type, row.unit, row.purchaseUnit]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return <section className="radiator-report" aria-label="Radyatör metrajı">
    <div className="summary-heading">
      <div><span className="eyebrow">RADYATÖR METRAJI</span><h3>Tip ve ölçülere göre genel durum</h3></div>
      <span>{types.length} tip · {rows.length} ölçü / birim grubu</span>
    </div>
    <div className="radiator-report-totals">
      {units.map((unit) => <div key={unit}><span>Genel toplam · net</span><strong>{total(rows.filter((row) => row.unit === unit), 'netQuantity')} {unit}</strong></div>)}
    </div>
    <div className="radiator-report-filters" role="group" aria-label="Radyatör tablosunda tip seçimi">
      <button type="button" aria-pressed={!selected} onClick={() => setSelectedType('')}>Tüm tipler</button>
      {types.map((type) => <button type="button" key={type} aria-pressed={selected === type} onClick={() => setSelectedType(type)}>
        {rows.find((row) => row.type === type)!.typeLabel}
      </button>)}
    </div>
    {[...groups].map(([key, group]) => {
      const first = group[0]!;
      const heights = [...new Set(group.map((row) => row.heightMm))].sort((a, b) => a - b);
      return <section className="radiator-report-type" key={key}>
        <div className="radiator-report-type-heading"><h4>{first.typeLabel}</h4><strong>{total(group, 'netQuantity')} {first.unit}</strong></div>
        <div className="radiator-report-scroll" role="region" aria-label={`${first.typeLabel} ölçü tablosu`} tabIndex={0}>
          <table>
            <caption>{first.typeLabel} — yükseklik ve uzunluk kırılımı</caption>
            <thead><tr><th scope="col">Uzunluk (mm)</th><th scope="col">Net ({first.unit})</th><th scope="col">Fireli ({first.unit})</th><th scope="col">Satın alma ({first.purchaseUnit})</th></tr></thead>
            {heights.map((height) => {
              const sizes = group.filter((row) => row.heightMm === height).sort((a, b) => (a.lengthMm ?? 0) - (b.lengthMm ?? 0));
              return <tbody key={height}>
                <tr className="radiator-height-heading"><th colSpan={4} scope="rowgroup">Yükseklik: {quantity(height)} mm</th></tr>
                {sizes.map((row) => <tr key={row.lengthMm ?? 'section'}>
                  <th scope="row">{row.lengthMm === null ? row.unit === 'dilim' ? 'Dilim' : 'Belirtilmedi' : quantity(row.lengthMm)}</th>
                  <td className="radiator-net">{quantity(row.netQuantity)}</td><td>{quantity(row.withWasteQuantity)}</td><td>{quantity(row.purchaseQuantity)}</td>
                </tr>)}
                <tr className="radiator-height-total"><th scope="row">{quantity(height)} mm toplamı</th><td>{total(sizes, 'netQuantity')}</td><td>{total(sizes, 'withWasteQuantity')}</td><td>{total(sizes, 'purchaseQuantity')}</td></tr>
              </tbody>;
            })}
            <tfoot><tr><th scope="row">Tip toplamı</th><td>{total(group, 'netQuantity')}</td><td>{total(group, 'withWasteQuantity')}</td><td>{total(group, 'purchaseQuantity')}</td></tr></tfoot>
          </table>
        </div>
      </section>;
    })}
    <p className="radiator-report-note">Bu tablo genel metrajın radyatör bölümüdür. Adet ve dilim ayrı toplamlanır; satın alma miktarları kendi birimleriyle gösterilir.</p>
  </section>;
}
