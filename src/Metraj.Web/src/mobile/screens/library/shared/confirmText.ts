import { foldSearchText } from '../../../components/search.ts';

/**
 * Yazarak onay kuralı (saf). "Bütün projeleri temizle" gibi geri alınamaz
 * işlemler kullanıcıdan bir sözcüğü yazmasını ister; telefon klavyesinde
 * "TEMİZLE"yi noktalı İ ile yazmak zordur. Karşılaştırma Türkçe duyarlı ve
 * büyük/küçük harf, noktalı/noktasız i ve boşluk farkını yok sayar:
 * "temizle", "TEMIZLE", "Temizle " ve "TEMİZLE" aynı sayılır; "temizl" ya da
 * "evet" sayılmaz.
 */
export const CLEAR_PROJECTS_PHRASE = 'TEMİZLE';

const fold = (text: string) => foldSearchText(text).replace(/\s+/g, '');

export function confirmationMatches(input: string, phrase: string): boolean {
  const typed = fold(input);
  return typed.length > 0 && typed === fold(phrase);
}
