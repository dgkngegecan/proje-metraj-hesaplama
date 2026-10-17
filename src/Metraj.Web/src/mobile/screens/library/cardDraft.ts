import { FITTING_PRESETS, PPRC_DIAMETERS, STEEL_DIAMETERS } from '../../../lib/catalogData.ts';
import type { CardDraftState } from '../../../lib/draftTypes';
import { makeCardCode, parseDecimal } from '../../../lib/format.ts';
import type {
  CardType,
  CatalogCard,
  CatalogCardAttributeDescriptor,
  CatalogCardType,
  CatalogCardVariant,
  CatalogVariantMode,
} from '../../../types';

/*
 * Kart formunun saf mantığı: taslak, doğrulama, sunucuya giden gövde. Masaüstündeki
 * `createCard`/`editCatalogCard` (App.tsx) içindeki kurallar BİREBİR aynıdır; yalnız
 * telefon formunun ihtiyacı olan alan hatası ayrımı eklendi. Sunucu kuralları
 * (`DomainMessageCatalog`) ayrıca doğrular; buradaki hatalar yalnız hızlı geri bildirimdir.
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

/** Kullanıcı bir şey değiştirdi mi (geri tuşunda "değişiklikler atılsın mı" sorusu için). */
export function draftChanged(initial: CardDraftState, current: CardDraftState): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

export interface CardDraftErrors {
  name?: string;
  unit?: string;
  wasteRatePct?: string;
  variants?: string;
}

/**
 * Alan hataları. Metinler masaüstündekiyle ve sunucunun Türkçe kural metinleriyle aynıdır.
 * Boş nesne = gönderilebilir.
 */
export function validateCardDraft(draft: CardDraftState): CardDraftErrors {
  const errors: CardDraftErrors = {};
  if (!draft.name.trim()) errors.name = 'Kart adı gerekli.';
  if (!draft.unit.trim()) errors.unit = 'Birim gerekli.';
  const waste = parseDecimal(draft.wasteRatePct);
  if (!Number.isFinite(waste) || waste < 0)
    errors.wasteRatePct = 'Fire payını sıfır veya daha büyük bir sayı olarak yazın.';
  if (draft.variantMode !== 'None') {
    if (!draft.variants.length) errors.variants = 'Boru ve fitting kartlarında en az bir varyant tanımlanmalıdır.';
    else if (draft.variants.some((variant) => !variant.code.trim() || !variant.label.trim()))
      errors.variants = 'Varyant kodu ve etiketi doldurulmalıdır.';
    else if (draft.variantMode === 'Pipe' && draft.variants.some((variant) => !(Number(variant.standardLength) > 0)))
      errors.variants = 'Her boru çapının pozitif bir ticari boyu olmalıdır.';
  }
  return errors;
}

export const hasErrors = (errors: CardDraftErrors) => Object.keys(errors).length > 0;

/** İlk hata (alan sırasıyla): bildirim ve odak için. */
export function firstError(errors: CardDraftErrors): string | null {
  return errors.name ?? errors.unit ?? errors.wasteRatePct ?? errors.variants ?? null;
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

// ---------------------------------------------------------------------------
// Varyant düzenleme (taslak üzerinde saf dönüşümler)
// ---------------------------------------------------------------------------

export function setVariantMode(draft: CardDraftState, mode: CatalogVariantMode): CardDraftState {
  return {
    ...draft,
    variantMode: mode,
    unit: mode === 'Pipe' ? 'm' : mode === 'Fitting' ? 'adet' : draft.unit,
    variants: mode === 'None' ? [] : draft.variants,
  };
}

export function applyDiameterPreset(draft: CardDraftState, preset: 'steel' | 'pprc'): CardDraftState {
  return {
    ...draft,
    variantMode: 'Pipe',
    unit: 'm',
    variants: (preset === 'steel' ? STEEL_DIAMETERS : PPRC_DIAMETERS).map((item) => ({ ...item })),
  };
}

export function applyFittingPreset(draft: CardDraftState): CardDraftState {
  return {
    ...draft,
    variantMode: 'Fitting',
    unit: 'adet',
    variants: FITTING_PRESETS.map((item) => ({ ...item })),
  };
}

export function addVariant(draft: CardDraftState): CardDraftState {
  const next = draft.variants.length + 1;
  return {
    ...draft,
    variants: [
      ...draft.variants,
      draft.variantMode === 'Pipe'
        ? { code: `DN-${next}`, label: 'Yeni çap', standardLength: 6 }
        : { code: `FITTING-${next}`, label: 'Yeni fitting', compatibleDiameters: [] },
    ],
  };
}

export function updateVariant(
  draft: CardDraftState,
  index: number,
  change: Partial<CatalogCardVariant>,
): CardDraftState {
  return { ...draft, variants: draft.variants.map((item, i) => (i === index ? { ...item, ...change } : item)) };
}

export function removeVariant(draft: CardDraftState, index: number): CardDraftState {
  return { ...draft, variants: draft.variants.filter((_, i) => i !== index) };
}

/** "DN25, DN32" → ["DN25","DN32"] */
export function parseDiameterList(text: string): string[] {
  return text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Özel türün dinamik nitelikleri
// ---------------------------------------------------------------------------

/** Formda zaten ayrı alanı olan nitelikler (tekrar çizilmez). */
export const SEPARATELY_RENDERED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'Code',
  'Name',
  'Unit',
  'Notes',
  'MaterialType',
  'WasteRatePct',
]);

/** Seçili özel türün açtığı, formda ayrıca çizilecek nitelikler. */
export function dynamicAttributes(
  attributes: readonly CatalogCardAttributeDescriptor[],
  selectedType: CatalogCardType | null | undefined,
): CatalogCardAttributeDescriptor[] {
  if (!selectedType) return [];
  const enabled = new Set(selectedType.attributeKeys.map((key) => key.toLowerCase()));
  return attributes.filter(
    (attribute) => enabled.has(attribute.key.toLowerCase()) && !SEPARATELY_RENDERED_ATTRIBUTES.has(attribute.key),
  );
}

export type AttributeControl =
  | { kind: 'textarea' }
  | { kind: 'select'; options: ReadonlyArray<{ value: string; label: string }> }
  | { kind: 'decimal' }
  | { kind: 'text' };

const ENUM_OPTIONS: Record<string, ReadonlyArray<{ value: string; label: string }>> = {
  ItemKind: [
    { value: 'Material', label: 'Malzeme' },
    { value: 'Equipment', label: 'Cihaz' },
    { value: 'Labor', label: 'İşçilik' },
    { value: 'Service', label: 'Hizmet' },
    { value: 'Other', label: 'Diğer' },
  ],
  InputBehavior: [
    { value: 'Manual', label: 'Elle giriş' },
    { value: 'Boolean', label: 'Onay kutusu' },
    { value: 'Derived', label: 'Türetilmiş' },
  ],
  SalesConversion: [
    { value: 'None', label: 'Dönüşüm yok' },
    { value: 'StandardLength', label: 'Standart boy' },
    { value: 'Package', label: 'Paket' },
  ],
  ReportBehavior: [
    { value: 'Folder', label: 'Başlık' },
    { value: 'Measurable', label: 'Ölçülebilir' },
    { value: 'Auxiliary', label: 'Yardımcı' },
    { value: 'Reference', label: 'Referans' },
  ],
};

/** Niteliğin hangi denetimle girileceği; sayısal olanlarda ondalık klavye açılır. */
export function attributeControl(key: string): AttributeControl {
  if (key === 'Notes') return { kind: 'textarea' };
  const options = ENUM_OPTIONS[key];
  if (options) return { kind: 'select', options };
  if (key === 'WasteRatePct' || key === 'ContainerParameter') return { kind: 'decimal' };
  return { kind: 'text' };
}

/** Bir enum değerinin Türkçe karşılığı (detay ekranında); bilinmeyen değer olduğu gibi döner. */
export function attributeValueLabel(key: string, value: string): string {
  return ENUM_OPTIONS[key]?.find((option) => option.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Kart türü (şablon) formu
// ---------------------------------------------------------------------------

export interface TypeDraft {
  code: string;
  name: string;
  baseCardType: CardType;
  description: string;
  parentCardIds: string[];
  childCardIds: string[];
  attributeKeys: string[];
}

export const emptyTypeDraft = (): TypeDraft => ({
  code: '',
  name: '',
  baseCardType: 'Material',
  description: '',
  parentCardIds: [],
  childCardIds: [],
  attributeKeys: [],
});

export interface TypeDraftErrors {
  code?: string;
  name?: string;
}

export function validateTypeDraft(draft: TypeDraft): TypeDraftErrors {
  const errors: TypeDraftErrors = {};
  if (!draft.code.trim()) errors.code = 'Tür için kısa kod yazın.';
  if (!draft.name.trim()) errors.name = 'Tür için ad yazın.';
  return errors;
}

export function buildTypePayload(draft: TypeDraft) {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    baseCardType: draft.baseCardType,
    allowedParentCardIds: draft.parentCardIds,
    allowedChildCardIds: draft.childCardIds,
    attributeKeys: draft.attributeKeys,
    description: draft.description.trim() || null,
  };
}

/** Listeyi açıp kapatır: seçili değilse ekler, seçiliyse çıkarır. */
export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

/** Zorunlu nitelikler her zaman açıktır ve kapatılamaz. */
export function toggleAttributeKey(keys: readonly string[], attribute: CatalogCardAttributeDescriptor): string[] {
  if (attribute.isRequired) return [...keys];
  return toggleId(keys, attribute.key);
}
