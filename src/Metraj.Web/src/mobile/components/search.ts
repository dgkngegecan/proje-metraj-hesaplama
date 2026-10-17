/**
 * Türkçe duyarlı arama (saf). Sahada telefon klavyesiyle "dirsek ppr" yazan
 * kullanıcı "PPR-C Dirsek 90°"yu bulmalı; "celik" yazan "Çelik"i, "I" ile
 * "ı/i" farkı da aramayı bozmamalı.
 */

const TURKISH_FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

/** Küçük harfe indirir (tr-TR), Türkçe harfleri ve diğer aksanları sadeleştirir, boşlukları tekler. */
export function foldSearchText(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (char) => TURKISH_FOLD[char] ?? char)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sorgudaki her sözcük metinde (herhangi bir sırada) geçiyorsa eşleşir. */
export function matchesQuery(foldedText: string, query: string): boolean {
  const tokens = foldSearchText(query).split(' ').filter(Boolean);
  return tokens.every((token) => foldedText.includes(token));
}

/**
 * Listeyi süzer. Metinler öğe başına bir kez sadeleştirilir (2.000 kartta her
 * tuşta yeniden sadeleştirmek gecikme yaratıyordu); önbellek öğe nesnesine bağlıdır.
 */
export function createSearchIndex<T extends object>(textOf: (item: T) => string) {
  const folded = new WeakMap<T, string>();
  const textFor = (item: T) => {
    let value = folded.get(item);
    if (value === undefined) {
      value = foldSearchText(textOf(item));
      folded.set(item, value);
    }
    return value;
  };
  return (items: readonly T[], query: string): readonly T[] => {
    if (!query.trim()) return items;
    return items.filter((item) => matchesQuery(textFor(item), query));
  };
}
