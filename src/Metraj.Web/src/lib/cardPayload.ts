import type { CardType, CatalogCard, CatalogCardType, CatalogCardVariant, CatalogVariantMode } from '../types';
import type { CardDraftState } from './draftTypes';
import { makeCardCode, parseDecimal } from './format.ts';

/*
 * Kart formunun taslağı ve sunucuya giden gövdesi — masaüstü (App.tsx) ve telefon
 * (src/mobile/screens/library) AYNI fonksiyonları çağırır. Rapor davranışı, paket
 * dönüşümü ve ticari boy (`containerParameter`) kartın miktarını belirler; ikinci
 * bir kopya olmaz.
 */

export const emptyCardDraft = (): CardDraftState => ({
  code: '',
  name: '',
  type: 'Material',
  unit: 'adet',
  customTypeId: '',
  attributeValues: {},
  variantMode: 'None',
  variants: [],
  notes: '',
  materialType: '',
  wasteRatePct: '0',
});

/** Mevcut kartın düzenleme taslağı (yeni sürüm için). Gösterilmeyen alanlar `carried` ile korunur. */
export function draftFromCard(card: CatalogCard): CardDraftState {
  return {
    code: card.code,
    name: card.name,
    type: card.cardType,
    unit: card.unit,
    customTypeId: card.customTypeId ?? '',
    attributeValues: { ...(card.attributeValues ?? {}) },
    variantMode: card.variantMode ?? 'None',
    variants: (card.variants ?? []).map((item) => ({
      ...item,
      compatibleDiameters: item.compatibleDiameters ? [...item.compatibleDiameters] : item.compatibleDiameters,
    })),
    notes: card.notes ?? '',
    materialType: card.materialType ?? '',
    wasteRatePct: String(card.wasteRatePct ?? 0),
    carried: {
      cardType: card.cardType,
      variantMode: card.variantMode ?? 'None',
      inputBehavior: card.inputBehavior,
      salesConversion: card.salesConversion,
      reportBehavior: card.reportBehavior,
      positionNumber: card.positionNumber ?? null,
      containerParameter: card.containerParameter ?? null,
    },
  };
}

export interface CardPayload {
  code: string;
  name: string;
  cardType: CardType;
  unit: string;
  inputBehavior: CatalogCard['inputBehavior'];
  salesConversion: CatalogCard['salesConversion'];
  reportBehavior: CatalogCard['reportBehavior'];
  wasteRatePct: number;
  containerParameter: number | null;
  positionNumber: string | null;
  notes: string | null;
  materialType: string | null;
  customTypeId: string | null;
  attributeValues: Record<string, string> | null;
  variantMode: CatalogVariantMode;
  variants: CatalogCardVariant[];
}

/**
 * `POST /catalog/cards` ve `POST /catalog/cards/{id}/versions` gövdesi.
 *
 * Yalnız kullanıcının gerçekten değiştirdiği kontrollere bağlı alanlar yeniden
 * çıkarılır (tür, varyant davranışı); geri kalanı kartın mevcut hâlinden taşınır.
 * Önceden bir kartın yalnız adını değiştirmek giriş davranışını, paket dönüşümünü ve
 * poz numarasını sessizce varsayılana döndürüyordu.
 */
export function buildCardPayload(
  draft: CardDraftState,
  catalogTypes: readonly CatalogCardType[],
  makeCode: (name: string) => string = makeCardCode,
): CardPayload {
  const selectedType = catalogTypes.find((type) => type.id === draft.customTypeId);
  const wasteRatePct = parseDecimal(draft.wasteRatePct);
  const attributeValues = selectedType ? { ...draft.attributeValues } : null;
  if (selectedType && attributeValues) {
    const enabled = new Set(selectedType.attributeKeys.map((key) => key.toLowerCase()));
    if (enabled.has('notes')) {
      if (draft.notes.trim()) attributeValues.Notes = draft.notes.trim();
      else delete attributeValues.Notes;
    }
    if (enabled.has('materialtype')) {
      if (draft.materialType.trim()) attributeValues.MaterialType = draft.materialType.trim();
      else delete attributeValues.MaterialType;
    }
    if (enabled.has('wasteratepct')) attributeValues.WasteRatePct = String(wasteRatePct);
  }
  const carried = draft.carried;
  const effectiveType = selectedType?.baseCardType ?? draft.type;
  const typeChanged = !carried || carried.cardType !== effectiveType;
  const variantModeChanged = !carried || carried.variantMode !== draft.variantMode;
  return {
    code: draft.code.trim() || makeCode(draft.name),
    name: draft.name.trim(),
    cardType: effectiveType,
    unit: draft.unit.trim(),
    inputBehavior: carried?.inputBehavior ?? 'Manual',
    salesConversion:
      draft.variantMode === 'Pipe'
        ? 'StandardLength'
        : variantModeChanged
          ? 'None'
          : (carried?.salesConversion ?? 'None'),
    reportBehavior: typeChanged
      ? effectiveType === 'Material' || effectiveType === 'Accessory'
        ? 'Measurable'
        : 'Folder'
      : carried!.reportBehavior,
    wasteRatePct,
    containerParameter:
      draft.variantMode === 'Pipe' && draft.variants[0]?.standardLength
        ? draft.variants[0].standardLength
        : variantModeChanged
          ? null
          : (carried?.containerParameter ?? null),
    positionNumber: carried?.positionNumber ?? null,
    notes: draft.notes.trim() || null,
    materialType: draft.materialType.trim() || null,
    customTypeId: selectedType?.id ?? null,
    attributeValues,
    variantMode: draft.variantMode,
    variants: draft.variants,
  };
}
