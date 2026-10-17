import type { CatalogCard, Placement } from '../../../types';

/**
 * Kart (yerleşim) işlemlerinin istek gövdeleri ve iyimser karşılıkları (saf).
 * Gövdeler masaüstü App.tsx ile birebir aynıdır (addCardToFlow, savePlacementNotes,
 * reparent, linkCalculationSource).
 */
export function addPlacementBody(card: Pick<CatalogCard, 'latestVersionId'>, parentPlacementId: string | null) {
  return {
    cardVersionId: card.latestVersionId,
    parentPlacementId,
    displayNameOverride: null,
    procurementScope: null,
  };
}

export interface PlacementProperties {
  displayName: string;
  procurementScope: string;
  notes: string;
}

export const emptyToNull = (value: string) => value.trim() || null;

/**
 * `PUT /placements/{id}` üç alanı birlikte değiştirir; verilmeyen alan silinir.
 * Bu yüzden form her zaman üçünü de gönderir. Görünen ad kartın kendi adına
 * eşitse veya boşsa geçersiz kılma kaldırılır (kart sonradan yeniden
 * adlandırılırsa ad onunla gelsin).
 */
export function updatePlacementBody(placement: Pick<Placement, 'cardName'>, values: PlacementProperties) {
  const name = values.displayName.trim();
  return {
    displayNameOverride: name && name !== placement.cardName ? name : null,
    procurementScope: emptyToNull(values.procurementScope),
    notes: emptyToNull(values.notes),
  };
}

/** İstek başarılı olacaksa listede görünecek kart (sunucu da `override ?? cardName` döndürür). */
export function appliedProperties(placement: Placement, body: ReturnType<typeof updatePlacementBody>): Placement {
  return {
    ...placement,
    displayNameOverride: body.displayNameOverride,
    displayName: body.displayNameOverride ?? placement.cardName,
    procurementScope: body.procurementScope,
    notes: body.notes,
  };
}

export const moveBody = (parentPlacementId: string | null) => ({ parentPlacementId });

export const calculatedFromBody = (sourcePlacementId: string) => ({ sourcePlacementId, notes: null });

export type LinkCheck = { ok: true } | { ok: false; error: string };

/** Masaüstüyle aynı ön kontroller; asıl kural sunucudadır. */
export function checkCalculationLink(targetId: string | null, sourceId: string | null): LinkCheck {
  if (!targetId) return { ok: false, error: 'Önce hesaplanacak ek parça kartını seçin.' };
  if (!sourceId) return { ok: false, error: 'Bu hesabın kaynak kartını seçin.' };
  if (targetId === sourceId) return { ok: false, error: 'Kaynak kartı ile hesaplanacak kart aynı olamaz.' };
  return { ok: true };
}

/** Hesap bağı için kaynak olabilecek kartlar: ölçülebilir, hesaplanmayan, hedef dışındakiler. */
export function linkSources(placements: readonly Placement[], targetId: string): Placement[] {
  return placements.filter((item) => item.id !== targetId && item.isMeasurable && item.inputBehavior !== 'Derived');
}

/** Rapor kapsamı: Çıktı sekmesinin üst rotası. Sözleşme `MIMARI.md` değil, bu dosyada: `{ screen: 'scope', params: { placementId } }`. */
export const REPORT_SCOPE_ROUTE = 'scope';
