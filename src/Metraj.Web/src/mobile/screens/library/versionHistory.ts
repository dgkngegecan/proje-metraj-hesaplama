import { quantity } from '../../../lib/format.ts';
import type { CatalogCardVersion } from '../../../types';

/*
 * Kart ayrıntısındaki "Sürüm geçmişi"nin saf modeli (tests/mobile-library-model.test.mjs).
 * Sunucu sürümleri en yeni önce verir; her satır bir önceki sürüme göre neyin değiştiğini söyler.
 */

const dateTime = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

/** Sunucu UTC'yi "Z" ile yazar; eksiz eski bir değer de UTC sayılır (yerel saat sanılmasın). */
export function formatVersionDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? '' : dateTime.format(date);
}

/** "17 Eki 2026 14:45 · 2 yerleşimde kullanılıyor" */
export function versionMeta(version: Pick<CatalogCardVersion, 'createdAtUtc' | 'placementCount'>): string {
  const usage =
    version.placementCount > 0 ? `${version.placementCount} yerleşimde kullanılıyor` : 'Projelerde kullanılmıyor';
  return [formatVersionDate(version.createdAtUtc), usage].filter(Boolean).join(' · ');
}

const text = (value: string | null | undefined) => (value ?? '').trim();
const percent = (value: number) => `%${quantity(value)}`;
const optionalQuantity = (value: number | null | undefined) => (value == null ? '—' : quantity(value));
const orDash = (value: string) => value || '—';

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if ((left[key] ?? '') !== (right[key] ?? '')) return false;
  return true;
}

/**
 * `older` sürümden `newer` sürüme değişenler, okunur satırlar hâlinde. İlk sürüm için
 * (`older` yok) boş liste döner; alan değişmeden kaydedilmiş bir sürüm için de boş döner.
 */
export function versionChanges(newer: CatalogCardVersion, older: CatalogCardVersion | undefined): string[] {
  if (!older) return [];
  const changes: string[] = [];
  const compare = (label: string, before: string, after: string) => {
    if (before !== after) changes.push(`${label}: ${before} → ${after}`);
  };
  compare('Ad', orDash(text(older.name)), orDash(text(newer.name)));
  compare('Birim', orDash(text(older.unit)), orDash(text(newer.unit)));
  compare('Fire payı', percent(older.wasteRatePct), percent(newer.wasteRatePct));
  compare(
    'Boy / paket kapasitesi',
    optionalQuantity(older.containerParameter),
    optionalQuantity(newer.containerParameter),
  );
  compare('Malzeme ailesi', orDash(text(older.materialType)), orDash(text(newer.materialType)));
  compare('Poz numarası', orDash(text(older.positionNumber)), orDash(text(newer.positionNumber)));
  compare('Özel tür', orDash(text(older.customTypeName)), orDash(text(newer.customTypeName)));

  if (older.variants.length !== newer.variants.length) {
    compare('Çeşit sayısı', String(older.variants.length), String(newer.variants.length));
  } else if (JSON.stringify(older.variants) !== JSON.stringify(newer.variants)) {
    changes.push('Çeşitler güncellendi');
  }
  if (older.compatibleDiameters.join('|') !== newer.compatibleDiameters.join('|')) {
    changes.push('Uyumlu çaplar güncellendi');
  }
  if (!sameRecord(older.attributeValues, newer.attributeValues)) changes.push('Nitelikler güncellendi');
  return changes;
}
