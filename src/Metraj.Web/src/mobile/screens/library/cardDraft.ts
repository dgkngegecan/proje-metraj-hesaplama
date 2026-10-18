import { FITTING_PRESETS, PPRC_DIAMETERS, STEEL_DIAMETERS } from '../../../lib/catalogData.ts';
import type { CardDraftState } from '../../../lib/draftTypes';
import { parseDecimal } from '../../../lib/format.ts';
import type {
  CardType,
  CatalogCardAttributeDescriptor,
  CatalogCardType,
  CatalogCardVariant,
  CatalogVariantMode,
} from '../../../types';

/*
 * Kart formunun telefon tarafı: alan doğrulaması, varyant düzenleme, tür formu.
 * Taslak ve sunucuya giden gövde (`emptyCardDraft`, `draftFromCard`,
 * `buildCardPayload`) masaüstüyle ORTAK modülden gelir (lib/cardPayload.ts); burada
 * kopyası yoktur. Sunucu kuralları (`DomainMessageCatalog`) ayrıca doğrular;
 * buradaki hatalar yalnız hızlı geri bildirimdir.
 */

export { buildCardPayload, draftFromCard, emptyCardDraft, type CardPayload } from '../../../lib/cardPayload.ts';

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
  if (!Number.isFinite(waste) || waste < 0) errors.wasteRatePct = 'Fire payı sıfır ya da daha büyük olmalı.';
  if (draft.variantMode !== 'None') {
    if (!draft.variants.length) errors.variants = 'En az bir çeşit ekleyin.';
    else if (draft.variants.some((variant) => !variant.code.trim() || !variant.label.trim()))
      errors.variants = 'Her çeşidin kodunu ve adını yazın.';
    else if (draft.variantMode === 'Pipe' && draft.variants.some((variant) => !(Number(variant.standardLength) > 0)))
      errors.variants = 'Her çap için sıfırdan büyük bir boy yazın.';
  }
  return errors;
}

export const hasErrors = (errors: CardDraftErrors) => Object.keys(errors).length > 0;

/** İlk hata (alan sırasıyla): bildirim ve odak için. */
export function firstError(errors: CardDraftErrors): string | null {
  return errors.name ?? errors.unit ?? errors.wasteRatePct ?? errors.variants ?? null;
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
    { value: 'Boolean', label: 'Yapıldı / yapılmadı' },
    { value: 'Derived', label: 'Hesapla bulunur' },
  ],
  SalesConversion: [
    { value: 'None', label: 'Girilen birimle' },
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
