import type { Measurement, Placement } from '../../../types';
import {
  activeRadiatorDraft,
  canonicalRadiatorType,
  clearActiveRadiatorCounts,
  initialRadiatorGroups,
  isPanelRadiator,
  isSectionalRadiator,
  legacyRadiatorCounts,
  mergeRadiatorGroups,
  PANEL_HEIGHTS,
  PANEL_LENGTHS,
  radiatorDimension,
  radiatorGroupKey,
  radiatorMeasurementRows,
  radiatorSizeKey,
  readRadiatorDraft,
  type RadiatorDraft,
  type RadiatorGroup,
} from '../../../lib/radiatorChoices.ts';

/**
 * Radyatör sayımının durum mantığı (saf). Masaüstü `RadiatorInput.tsx` bileşeninin
 * içindeki durum geçişleri burada işlev olarak durur; seçenek kümesi, anahtarlar
 * ve kayıt satırları `lib/radiatorChoices.ts` ile AYNIDIR (yeniden yazılmadı):
 *   - taslak:  `radiator-draft.v1.{placementId}`   (adetler dahil)
 *   - tercih:  `radiator-options.v1.{cardCode}`    (tip/yükseklik/boy seçenekleri, adetsiz)
 * Telefon ve masaüstü aynı yedekten aynı yarım kalmış sayımı okur.
 */
export const MAX_RADIATOR_COUNT = 1_000_000;

export const radiatorDraftKind = 'radiator-draft';
export const radiatorOptionsKind = 'radiator-options';
export const legacyFittingKind = 'fitting-draft';

/** Masaüstü ilk durumu: kart + ölçümler + tercihler + kayıtlı taslak (+ eski fitting sayımı, bir kez). */
export function hydrateRadiatorDraft(
  placement: Placement,
  measurements: Measurement[],
  savedRaw: string | null,
  preferencesRaw: string | null,
  legacyRaw: string | null,
): RadiatorDraft {
  const saved = readRadiatorDraft(savedRaw);
  const preferences = readRadiatorDraft(preferencesRaw);
  const groups = mergeRadiatorGroups(
    initialRadiatorGroups(placement, measurements),
    preferences?.groups ?? [],
    saved?.groups ?? [],
  );
  const fallback = groups.find((group) => group.type === 'Tip 22' && group.height === '600') ?? groups[0];
  const active = saved?.active || preferences?.active || (fallback ? radiatorGroupKey(fallback) : '');
  return { groups, active, counts: saved?.counts ?? legacyRadiatorCounts(legacyRaw) };
}

export const serializeDraft = (draft: RadiatorDraft) => JSON.stringify(draft);
/** Tercih kaydı: aynı kataloğun öteki kartları ve projeler de seçenekleri görsün; adetler karta özeldir. */
export const serializePreferences = (draft: RadiatorDraft) => JSON.stringify({ ...draft, counts: {} });

export function activeGroup(draft: RadiatorDraft): RadiatorGroup | undefined {
  return draft.groups.find((group) => radiatorGroupKey(group) === draft.active) ?? draft.groups[0];
}

export const typesOf = (draft: RadiatorDraft) => [...new Set(draft.groups.map((group) => group.type))];

export function heightsOf(draft: RadiatorDraft, type: string): string[] {
  return [...new Set(draft.groups.filter((group) => group.type === type).map((group) => group.height))].sort(
    (a, b) => Number(a) - Number(b),
  );
}

/** Tip değişince aynı yükseklik korunur, yoksa tipin ilk grubu seçilir (masaüstüyle aynı). */
export function selectType(draft: RadiatorDraft, type: string): RadiatorDraft {
  const current = activeGroup(draft);
  const group =
    draft.groups.find((item) => item.type === type && item.height === current?.height) ??
    draft.groups.find((item) => item.type === type);
  return group ? { ...draft, active: radiatorGroupKey(group) } : draft;
}

export function selectHeight(draft: RadiatorDraft, height: string): RadiatorDraft {
  const current = activeGroup(draft);
  const group =
    draft.groups.find((item) => item.height === height && item.type === current?.type) ??
    draft.groups.find((item) => item.height === height);
  return group ? { ...draft, active: radiatorGroupKey(group) } : draft;
}

export function selectGroup(draft: RadiatorDraft, group: RadiatorGroup): RadiatorDraft {
  return { ...draft, active: radiatorGroupKey(group) };
}

export const countFor = (draft: RadiatorDraft, group: RadiatorGroup, length: string) =>
  draft.counts[radiatorSizeKey({ ...group, length })] ?? 0;

/** Sayaç değeri 0..1.000.000 tam sayı olmalı; aksi hâlde taslak değişmez (masaüstüyle aynı). */
export function withCount(draft: RadiatorDraft, group: RadiatorGroup, length: string, value: number): RadiatorDraft {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RADIATOR_COUNT) return draft;
  const key = radiatorSizeKey({ ...group, length });
  if ((draft.counts[key] ?? 0) === value) return draft;
  return { ...draft, counts: { ...draft.counts, [key]: value } };
}

/** Bir tipin (veya tip + yüksekliğin) bekleyen toplamı; rozetler için. */
export function groupCount(draft: RadiatorDraft, placement: Placement, type: string, height?: string): number {
  const sectional = isSectionalRadiator(placement);
  return draft.groups
    .filter((group) => group.type === type && (!height || group.height === height))
    .reduce(
      (total, group) =>
        total + (sectional ? [''] : group.lengths).reduce((sum, value) => sum + countFor(draft, group, value), 0),
      0,
    );
}

export type DraftResult = { ok: true; draft: RadiatorDraft } | { ok: false; error: string };

/** Özel uzunluk: yeni uzunluk 1 adetle başlar (masaüstü `addLength`). */
export function addCustomLength(draft: RadiatorDraft, input: string): DraftResult {
  const group = activeGroup(draft);
  const normalized = radiatorDimension(input);
  if (!group || !normalized) return { ok: false, error: 'Uzunluğu mm olarak, sıfırdan büyük bir sayı ile yazın.' };
  const key = radiatorSizeKey({ ...group, length: normalized });
  return {
    ok: true,
    draft: {
      ...draft,
      groups: mergeRadiatorGroups(draft.groups, [{ ...group, lengths: [normalized] }]),
      counts: { ...draft.counts, [key]: Math.min(MAX_RADIATOR_COUNT, (draft.counts[key] ?? 0) + 1) },
    },
  };
}

/** Yeni tip veya yükseklik ekler (masaüstü `addGroup`). `mode`: hangi düğmeden açıldı. */
export function addGroup(
  draft: RadiatorDraft,
  placement: Placement,
  input: { mode: 'type' | 'height'; type: string; height: string },
): DraftResult {
  const height = radiatorDimension(input.height);
  const type = canonicalRadiatorType(input.type);
  if (!height || !type || type.length > 40 || type.includes(' · '))
    return { ok: false, error: 'Bir tip adı (en çok 40 karakter) ve sıfırdan büyük yükseklik yazın.' };
  const group = activeGroup(draft);
  const lengths = isPanelRadiator(placement) ? [...PANEL_LENGTHS] : [...(group?.lengths ?? [])];
  const added = { type, height, lengths };
  const groups =
    input.mode === 'type' && isPanelRadiator(placement)
      ? [...new Set([...PANEL_HEIGHTS, height])].map((value) => ({ ...added, height: value }))
      : [added];
  return {
    ok: true,
    draft: { ...draft, groups: mergeRadiatorGroups(draft.groups, groups), active: radiatorGroupKey(added) },
  };
}

export interface RadiatorPending {
  /** Seçili tip + yükseklik için kaydedilecek satırlar (Enter yalnız bunları kaydeder). */
  rows: ReturnType<typeof radiatorMeasurementRows>;
  /** Seçili grubun bekleyen adedi. */
  active: number;
  /** Bütün gruplardaki bekleyen adet. */
  all: number;
}

export function pendingOf(draft: RadiatorDraft, placement: Placement, measurements: Measurement[]): RadiatorPending {
  const group = activeGroup(draft);
  const rows = group
    ? radiatorMeasurementRows(
        activeRadiatorDraft({ ...draft, active: radiatorGroupKey(group) }),
        placement,
        measurements,
      )
    : [];
  return {
    rows,
    active: rows.reduce((total, row) => total + row.quantity, 0),
    all: Object.values(draft.counts).reduce((total, count) => total + count, 0),
  };
}

/** Başarılı kayıttan sonra: yalnız seçili grubun adetleri silinir, ötekiler bekler. */
export function afterSubmit(draft: RadiatorDraft): RadiatorDraft {
  const group = activeGroup(draft);
  return group ? clearActiveRadiatorCounts({ ...draft, active: radiatorGroupKey(group) }) : draft;
}

/** Diğer gruplarda bekleyenler (özet düğmeleri). */
export function otherPending(
  draft: RadiatorDraft,
  placement: Placement,
): Array<{ group: RadiatorGroup; text: string }> {
  const sectional = isSectionalRadiator(placement);
  const unit = sectional ? 'dilim' : 'adet';
  const active = activeGroup(draft);
  const result: Array<{ group: RadiatorGroup; text: string }> = [];
  for (const group of draft.groups) {
    if (active && radiatorGroupKey(group) === radiatorGroupKey(active)) continue;
    const values = (sectional ? [''] : group.lengths).filter((value) => countFor(draft, group, value) > 0);
    if (!values.length) continue;
    result.push({
      group,
      text: values
        .map((value) => `${value ? `${value} mm × ` : ''}${countFor(draft, group, value)} ${unit}`)
        .join(', '),
    });
  }
  return result;
}
