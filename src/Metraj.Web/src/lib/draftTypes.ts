import type { CardType, CatalogCard, CatalogCardVariant, CatalogVariantMode } from '../types';

// Arayüzün form taslakları. Hem App hem de sayfa bileşenleri kullanır;
// bu yüzden App.tsx'ten çıkarılıp paylaşılan bir modüle alındı.

export type CardDraftState = {
  code: string;
  name: string;
  type: CardType;
  unit: string;
  customTypeId: string;
  attributeValues: Record<string, string>;
  variantMode: CatalogVariantMode;
  variants: CatalogCardVariant[];
  notes: string;
  materialType: string;
  wasteRatePct: string;
  /**
   * Düzenleyicide GÖSTERİLMEYEN ama korunması gereken alanlar. Bunlar olmadan
   * bir kartın yalnızca adını değiştirmek, kartın giriş davranışını, paket
   * dönüşümünü, rapor davranışını ve poz numarasını sessizce varsayılana
   * döndürüyordu; kullanıcı neyi kaybettiğini göremiyordu.
   */
  carried?: CarriedCardFields;
};

export type CarriedCardFields = {
  cardType: CardType;
  variantMode: CatalogVariantMode;
  inputBehavior: CatalogCard['inputBehavior'];
  salesConversion: CatalogCard['salesConversion'];
  reportBehavior: CatalogCard['reportBehavior'];
  positionNumber: string | null;
  containerParameter: number | null;
};

export type TypeDraftState = {
  code: string;
  name: string;
  baseCardType: CardType;
  description: string;
  parentCardIds: string[];
  childCardIds: string[];
  attributeKeys: string[];
};

export type MeasurementDraft = {
  quantity: string;
  block: string;
  floor: string;
  room: string;
  sheet: string;
  notes: string;
};
