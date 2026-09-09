import type { CatalogCard, CatalogCardVariant } from '../types';

export const STEEL_DIAMETERS: CatalogCardVariant[] = (
  [
    ['DN15', 'DN15 / 1/2"'],
    ['DN20', 'DN20 / 3/4"'],
    ['DN25', 'DN25 / 1"'],
    ['DN32', 'DN32 / 1 1/4"'],
    ['DN40', 'DN40 / 1 1/2"'],
    ['DN50', 'DN50 / 2"'],
    ['DN65', 'DN65 / 2 1/2"'],
    ['DN80', 'DN80 / 3"'],
    ['DN100', 'DN100 / 4"'],
    ['DN125', 'DN125 / 5"'],
    ['DN150', 'DN150 / 6"'],
  ] as [string, string][]
).map(([code, label]) => ({ code, label, standardLength: 6 }));
export const PPRC_DIAMETERS: CatalogCardVariant[] = (
  [
    ['DN16', 'DN16 / 1/2"'],
    ['DN20', 'DN20 / 1/2"'],
    ['DN25', 'DN25 / 3/4"'],
    ['DN32', 'DN32 / 1"'],
    ['DN40', 'DN40 / 1 1/4"'],
    ['DN50', 'DN50 / 1 1/2"'],
    ['DN63', 'DN63 / 2"'],
    ['DN75', 'DN75 / 2 1/2"'],
    ['DN90', 'DN90 / 3"'],
    ['DN110', 'DN110 / 4"'],
  ] as [string, string][]
).map(([code, label]) => ({ code, label, standardLength: 4 }));
export const FITTING_PRESETS: CatalogCardVariant[] = (
  [
    ['ELBOW-90', '90° Dirsek'],
    ['ELBOW-45', '45° Dirsek'],
    ['TEE', 'Te'],
    ['REDUCER', 'Redüksiyon'],
    ['UNION', 'Rakor'],
    ['NIPPLE', 'Muşon'],
    ['VALVE', 'Vana'],
    ['FLANGE', 'Flanş'],
  ] as [string, string][]
).map(([code, label]) => ({ code, label, compatibleDiameters: [] }));

export function variantName(card: CatalogCardVariant) {
  return card.label || card.code;
}

/**
 * Çok çaplı aile kartı kütüphanedeyken gizlenen, standart pakete ait tekil
 * kartlar. Liste KESİN kodlardan oluşur.
 *
 * Önceki sürüm kod öneki + ad regex'i ile eşleştiriyordu ve kullanıcının kendi
 * kartını sessizce yok edebiliyordu: `makeCardCode` adı büyük harfe çevirip
 * kod ürettiği için "Std Steel Boru" adlı bir kart `STD-STEEL-BORU-...` kodunu
 * alıyor, adında "TE"/"VANA" geçiyorsa kütüphaneden kayboluyordu. Bulunamayan
 * kart hata da vermiyordu; sadece yoktu.
 *
 * Not: Bu bir iş kuralıdır ve asıl yeri backend'dir (karta bir `supersededBy`
 * alanı ya da bu kartların hiç seed edilmemesi). Sunucu tarafına taşınana
 * kadar burada açık ve denetlenebilir bir liste olarak duruyor.
 */
export const SUPERSEDED_BY_FAMILY: Array<{ family: string; codes: string[]; generatedPrefixes: string[] }> = [
  {
    family: 'STD-PIPE-PPRC',
    codes: ['STD-PPRC-DN20', 'STD-PPRC-DN25', 'STD-PPRC-DN32', 'STD-PPRC-DN40', 'STD-PPRC-DN50'],
    generatedPrefixes: ['SYN-CW-PPR'],
  },
  {
    family: 'STD-PIPE-STEEL',
    codes: ['STD-STEEL-DN25', 'STD-STEEL-DN32', 'STD-STEEL-DN40', 'STD-STEEL-DN50', 'STD-STEEL-DN65'],
    generatedPrefixes: [],
  },
  {
    family: 'STD-FIT-PPRC',
    codes: [
      'STD-PPRC-ELBOW-20',
      'STD-PPRC-ELBOW-25',
      'STD-PPRC-ELBOW-32',
      'STD-PPRC-TEE-25',
      'STD-PPRC-TEE-32',
      'STD-PPRC-RED-25-20',
      'STD-PPRC-UNION-25',
      'STD-PPRC-VALVE-25',
      'STD-PPRC-VALVE-32',
    ],
    generatedPrefixes: ['SYN-CW-ELB', 'SYN-CW-TEE', 'SYN-CW-VAL'],
  },
  {
    family: 'STD-FIT-STEEL',
    codes: ['STD-STEEL-ELBOW-25', 'STD-STEEL-TEE-25', 'STD-STEEL-FLANGE-50', 'STD-STEEL-VALVE-50'],
    generatedPrefixes: [],
  },
];

export function visibleCatalogCards(cards: CatalogCard[]) {
  const active = cards.filter((card) => card.isActive);
  const hasFamily = (code: string) => active.some((card) => card.variantMode !== 'None' && card.code === code);
  const hidden = new Set<string>();
  for (const group of SUPERSEDED_BY_FAMILY) {
    if (!hasFamily(group.family)) continue;
    for (const code of group.codes) hidden.add(code);
    for (const card of active) {
      // SYN- ad alanı yalnızca sentetik içe aktarma tarafından üretilir;
      // kullanıcı bu önekle kart oluşturmaz.
      const code = card.code.toUpperCase();
      if (group.generatedPrefixes.some((prefix) => code.startsWith(prefix))) hidden.add(card.code);
    }
  }
  return active.filter((card) => !hidden.has(card.code) && !hidden.has(card.code.toUpperCase()));
}
