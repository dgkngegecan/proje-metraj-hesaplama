import { createSearchIndex } from '../../components/search.ts';
import { purchaseUnit, quantity } from '../../../lib/format.ts';
import type { MeasurementSummary, Placement, RadiatorSummary, ReportData } from '../../../types';
import { summaryKey } from '../../store/entities.ts';

/*
 * Özet / Çıktı ekranının saf modeli: kapsam çözümleme, indirme adresi ve dosya adı,
 * malzeme satırlarının gruplanması, radyatör tablosunun düzleştirilmesi ve toplamlar.
 * React'siz yazıldı; `node:test` ile sınanır (tests/mobile-output-model.test.mjs).
 *
 * Sayı biçimi masaüstüyle AYNI işlevden gelir (`lib/format.ts`): iki arayüzde aynı rapor
 * aynı rakamlarla okunur. Toplamlar da masaüstündeki `RadiatorSummaryTable` ile aynı
 * toplama + biçimleme sırasını izler.
 */

// ---------------------------------------------------------------------------
// Kapsam
// ---------------------------------------------------------------------------

/** Rota parametresi: Proje sekmesi "rapor kapsamı yap" derken bu adı kullanır. */
export const SCOPE_ROUTE = 'scope';

export interface ResolvedScope {
  /** Geçerli kapsam kökü; yok ya da bu revizyonda bulunamadıysa `null` (bütün proje). */
  rootId: string | null;
  root: Placement | null;
  /** Kökün kendisi ve bütün altındakiler; bütün proje için `null`. */
  ids: ReadonlySet<string> | null;
}

/**
 * İstenen kapsam kimliğini çözer. Kimlik bu revizyonda yoksa (revizyon değişti, kart silindi)
 * sessizce "bütün proje"ye düşülür: bayat bir kapsam boş bir rapor göstermesin.
 */
export function resolveScope(placements: readonly Placement[], requestedId: string | null | undefined): ResolvedScope {
  const root = requestedId ? (placements.find((item) => item.id === requestedId) ?? null) : null;
  if (!root) return { rootId: null, root: null, ids: null };
  const childrenOf = new Map<string, string[]>();
  for (const placement of placements) {
    if (!placement.parentPlacementId) continue;
    const bucket = childrenOf.get(placement.parentPlacementId);
    if (bucket) bucket.push(placement.id);
    else childrenOf.set(placement.parentPlacementId, [placement.id]);
  }
  const ids = new Set<string>();
  const stack = [root.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return { rootId: root.id, root, ids };
}

/** `?placementId=…` (masaüstü indirme bağlantılarıyla aynı sorgu) ya da boş. */
export function scopeQuery(rootId: string | null): string {
  return rootId ? `?placementId=${encodeURIComponent(rootId)}` : '';
}

/** Rapor verisi uç noktası (alt ağaç kapsamı yolda). */
export function reportDataPath(revisionId: string, rootId: string | null): string {
  return `/revisions/${revisionId}/report${rootId ? `/subtree/${rootId}` : ''}`;
}

export type ReportFormat = 'excel' | 'pdf' | 'word';

export const REPORT_FORMATS: Readonly<Record<ReportFormat, { label: string; extension: string }>> = {
  excel: { label: 'Excel', extension: 'xlsx' },
  pdf: { label: 'PDF', extension: 'pdf' },
  word: { label: 'Word', extension: 'docx' },
};

export function reportDownloadPath(revisionId: string, format: ReportFormat, rootId: string | null): string {
  return `/revisions/${revisionId}/report/${format}${scopeQuery(rootId)}`;
}

const FILE_UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** `PRJ-001-R0.pdf` ya da kapsamlıysa `PRJ-001-R0-KART.pdf`; dosya sistemi için güvenli. */
export function reportFileName(
  projectCode: string | null | undefined,
  revisionCode: string | null | undefined,
  format: ReportFormat,
  scopeCode?: string | null,
): string {
  const parts = [projectCode || 'Metraj', revisionCode, scopeCode]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim().replace(FILE_UNSAFE, '-').replace(/\s+/g, '-'));
  return `${parts.join('-')}.${REPORT_FORMATS[format].extension}`;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}

// ---------------------------------------------------------------------------
// Malzeme listesi
// ---------------------------------------------------------------------------

export interface MaterialGroup {
  key: string;
  label: string;
  rows: MeasurementSummary[];
}

export type MaterialRow =
  | { kind: 'header'; key: string; groupKey: string; label: string; count: number }
  | { kind: 'item'; key: string; groupKey: string; summary: MeasurementSummary };

const ROOT_GROUP = '__root__';

/**
 * Bir yerleşimin ait olduğu başlık: kendisinden yukarıdaki en yakın ölçülemeyen (klasör
 * türü) atası. Boru altındaki fitting'ler boru kartının değil, boru ile aynı sistem
 * başlığının altında görünür.
 */
export function folderOf(placementId: string, placements: readonly Placement[]): Placement | null {
  const byId = new Map(placements.map((item) => [item.id, item]));
  let cursor = byId.get(placementId)?.parentPlacementId ?? null;
  for (let depth = 0; cursor && depth < 24; depth += 1) {
    const parent = byId.get(cursor);
    if (!parent) return null;
    if (!parent.isMeasurable) return parent;
    cursor = parent.parentPlacementId ?? null;
  }
  return null;
}

function treeOrder(placements: readonly Placement[]): Map<string, number> {
  const children = new Map<string | null, Placement[]>();
  const ids = new Set(placements.map((item) => item.id));
  for (const placement of placements) {
    const parent =
      placement.parentPlacementId && ids.has(placement.parentPlacementId) ? placement.parentPlacementId : null;
    const bucket = children.get(parent);
    if (bucket) bucket.push(placement);
    else children.set(parent, [placement]);
  }
  const order = new Map<string, number>();
  const visit = (placement: Placement) => {
    if (order.has(placement.id)) return;
    order.set(placement.id, order.size);
    for (const child of children.get(placement.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
  for (const placement of placements) visit(placement);
  return order;
}

/** Çap/boyut sayısı: "DN25 / 1\"" → 25 (masaüstü SummaryTable ile aynı kural). */
function sizeOf(name: string): number {
  return Number(name.match(/(?:DN\s*|\b)(\d+(?:[.,]\d+)?)/i)?.[1]?.replace(',', '.') ?? '') || 0;
}

const collator = new Intl.Collator('tr');

/**
 * Özetleri başlıklara böler. Başlıklar ağaç sırasıyla, satırlar başlık içinde masaüstü
 * `SummaryTable` sırasıyla (büyük çap önce, ad, varyant) dizilir.
 */
export function groupSummaries(
  summaries: readonly MeasurementSummary[],
  placements: readonly Placement[],
  rootLabel = 'Diğer kalemler',
): MaterialGroup[] {
  const order = treeOrder(placements);
  const groups = new Map<string, MaterialGroup & { order: number }>();
  for (const summary of summaries) {
    const folder = folderOf(summary.placementId, placements);
    const key = folder?.id ?? ROOT_GROUP;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: folder?.displayName ?? rootLabel,
        rows: [],
        order: folder ? (order.get(folder.id) ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER,
      };
      groups.set(key, group);
    }
    group.rows.push(summary);
  }
  const sortKey = (summary: MeasurementSummary) => ({
    summary,
    size: sizeOf(summary.variant ?? summary.placementName),
  });
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ key, label, rows }) => ({
      key,
      label,
      rows: rows
        .map(sortKey)
        .sort(
          (a, b) =>
            b.size - a.size ||
            collator.compare(a.summary.placementName, b.summary.placementName) ||
            collator.compare(a.summary.variant ?? '', b.summary.variant ?? ''),
        )
        .map((entry) => entry.summary),
    }));
}

export function summarySearchText(summary: MeasurementSummary): string {
  return [summary.placementName, summary.placementCode, summary.variant, summary.secondaryVariant, summary.unit]
    .filter(Boolean)
    .join(' ');
}

/** Arama uygulanmış, başlıkları düzleştirilmiş satırlar (sanallaştırılmış listeye hazır). */
export function materialRows(groups: readonly MaterialGroup[], query: string): MaterialRow[] {
  const search = createSearchIndex<MeasurementSummary>(summarySearchText);
  const rows: MaterialRow[] = [];
  for (const group of groups) {
    const matched = search(group.rows, query);
    if (!matched.length) continue;
    rows.push({
      kind: 'header',
      key: `h:${group.key}`,
      groupKey: group.key,
      label: group.label,
      count: matched.length,
    });
    for (const summary of matched) rows.push({ kind: 'item', key: summaryKey(summary), groupKey: group.key, summary });
  }
  return rows;
}

export function materialItemCount(rows: readonly MaterialRow[]): number {
  return rows.reduce((count, row) => count + (row.kind === 'item' ? 1 : 0), 0);
}

/** Satırdaki miktar kutuları: masaüstündeki Net / Fireli / Satın alma + artan. */
export function summaryQuantities(summary: MeasurementSummary) {
  return {
    net: `${quantity(summary.netQuantity)} ${summary.unit}`,
    withWaste: `${quantity(summary.withWasteQuantity)} ${summary.unit}`,
    purchase: `${quantity(summary.purchaseQuantity)} ${purchaseUnit(summary)}`,
    remainder: summary.remainderQuantity > 0 ? `${quantity(summary.remainderQuantity)} ${summary.unit}` : null,
    wastePct: summary.appliedWasteRatePct ? `%${quantity(summary.appliedWasteRatePct)}` : null,
  };
}

export function summaryDetail(summary: MeasurementSummary): string {
  const variants = [summary.variant, summary.secondaryVariant].filter(Boolean).join(' · ') || 'Standart';
  return `${variants} · ${summary.measurementCount} giriş`;
}

// ---------------------------------------------------------------------------
// Radyatör tablosu
// ---------------------------------------------------------------------------

type RadiatorTotalKey = 'netQuantity' | 'withWasteQuantity' | 'purchaseQuantity';

/** Masaüstüyle aynı: önce topla, sonra biçimle. */
export function radiatorTotal(rows: readonly RadiatorSummary[], key: RadiatorTotalKey): string {
  return quantity(rows.reduce((sum, row) => sum + row[key], 0));
}

export function radiatorTypes(rows: readonly RadiatorSummary[]): Array<{ type: string; label: string }> {
  const seen = new Map<string, string>();
  for (const row of rows) if (!seen.has(row.type)) seen.set(row.type, row.typeLabel);
  return [...seen].map(([type, label]) => ({ type, label }));
}

/** Birim başına genel net toplam ("Genel toplam · net: 12 adet"). */
export function radiatorGrandTotals(rows: readonly RadiatorSummary[]): Array<{ unit: string; net: string }> {
  return [...new Set(rows.map((row) => row.unit))].map((unit) => ({
    unit,
    net: radiatorTotal(
      rows.filter((row) => row.unit === unit),
      'netQuantity',
    ),
  }));
}

export type RadiatorRow =
  | { kind: 'header'; key: string; groupKey: string; label: string; total: string }
  | { kind: 'height'; key: string; groupKey: string; label: string }
  | {
      kind: 'item';
      key: string;
      groupKey: string;
      label: string;
      net: string;
      withWaste: string;
      purchase: string;
      unit: string;
      purchaseUnit: string;
    }
  | { kind: 'subtotal'; key: string; groupKey: string; label: string; net: string; withWaste: string; purchase: string }
  | { kind: 'total'; key: string; groupKey: string; label: string; net: string; withWaste: string; purchase: string };

/**
 * Radyatör metrajını düz satırlara açar: tip/birim grubu başlığı → yükseklik başlığı →
 * uzunluk satırları → yükseklik toplamı … → tip toplamı. Masaüstü tablosundaki aynı
 * gruplama (tip + birim + satın alma birimi) ve sıralama (yükseklik, uzunluk artan).
 */
export function buildRadiatorRows(rows: readonly RadiatorSummary[], selectedType: string): RadiatorRow[] {
  const visible = rows.filter((row) => !selectedType || row.type === selectedType);
  const groups = new Map<string, RadiatorSummary[]>();
  for (const row of visible) {
    const key = JSON.stringify([row.type, row.unit, row.purchaseUnit]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result: RadiatorRow[] = [];
  for (const [groupKey, group] of groups) {
    const first = group[0]!;
    result.push({
      kind: 'header',
      key: `h:${groupKey}`,
      groupKey,
      label: first.typeLabel,
      total: `${radiatorTotal(group, 'netQuantity')} ${first.unit}`,
    });
    const heights = [...new Set(group.map((row) => row.heightMm))].sort((a, b) => a - b);
    for (const height of heights) {
      const sizes = group
        .filter((row) => row.heightMm === height)
        .sort((a, b) => (a.lengthMm ?? 0) - (b.lengthMm ?? 0));
      result.push({
        kind: 'height',
        key: `${groupKey}|H${height}`,
        groupKey,
        label: `Yükseklik: ${quantity(height)} mm`,
      });
      for (const row of sizes)
        result.push({
          kind: 'item',
          key: `${groupKey}|H${height}|L${row.lengthMm ?? 'x'}`,
          groupKey,
          label:
            row.lengthMm === null ? (row.unit === 'dilim' ? 'Dilim' : 'Belirtilmedi') : `${quantity(row.lengthMm)} mm`,
          net: quantity(row.netQuantity),
          withWaste: quantity(row.withWasteQuantity),
          purchase: quantity(row.purchaseQuantity),
          unit: row.unit,
          purchaseUnit: row.purchaseUnit,
        });
      result.push({
        kind: 'subtotal',
        key: `${groupKey}|H${height}|T`,
        groupKey,
        label: `${quantity(height)} mm toplamı`,
        net: radiatorTotal(sizes, 'netQuantity'),
        withWaste: radiatorTotal(sizes, 'withWasteQuantity'),
        purchase: radiatorTotal(sizes, 'purchaseQuantity'),
      });
    }
    result.push({
      kind: 'total',
      key: `${groupKey}|T`,
      groupKey,
      label: 'Tip toplamı',
      net: radiatorTotal(group, 'netQuantity'),
      withWaste: radiatorTotal(group, 'withWasteQuantity'),
      purchase: radiatorTotal(group, 'purchaseQuantity'),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Rapor özeti
// ---------------------------------------------------------------------------

export function pendingChecks(report: Pick<ReportData, 'calculationChecks'> | undefined): number {
  return report?.calculationChecks.filter((item) => item.status === 'PendingReview').length ?? 0;
}

export function reportStats(report: ReportData | undefined) {
  return {
    materials: report?.summaries.length ?? 0,
    sources: (report as (ReportData & { sourceMeasurements?: unknown[] }) | undefined)?.sourceMeasurements?.length ?? 0,
    pending: pendingChecks(report),
    radiatorRows: report?.radiatorSummaries?.length ?? 0,
  };
}
