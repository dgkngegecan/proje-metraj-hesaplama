/**
 * Ölçüm bağlamı: bir girişin "nerede" olduğu (blok, kat, mahal, zon, şaft, hat
 * no, pafta…). Masaüstünde Inspector altındaki Blok/Kat/Mahal/Pafta/Not
 * alanlarıydı ve kayıttan sonra DEĞİŞMEDEN kalıyordu: art arda aynı kattan
 * satır girerken her seferinde yeniden yazdırmak hızlı girişi bozardı. Telefonda
 * aynı kural geçerli, üstelik tuş takımı olmadan yazmak zor: bu yüzden son
 * kullanılan değerler çip olarak saklanır ve tek dokunuşla seçilir.
 *
 * Sunucudaki ölçüm satırında blok, kat, mahal, zon, pafta ve çizim revizyonu
 * ayrı alandır. Şaft ve hat no için ayrı alan YOKTUR (şema değişmez); bunlar
 * serbest not alanına "Şaft: A · Hat: 3" biçiminde, satıra özel notun ardına
 * yazılır — masaüstüyle ortak `composeRowNotes` kuralı (lib/measurementBodies.ts).
 */
import { composeRowNotes, type EntryContext, type EntryFields } from '../../../lib/measurementBodies.ts';

export const CONTEXT_FIELDS = [
  { key: 'block', label: 'Blok', hint: 'A', max: 128, primary: true },
  { key: 'floor', label: 'Kat', hint: '2', max: 128, primary: true },
  { key: 'room', label: 'Mahal', hint: 'Mutfak', max: 256, primary: true },
  { key: 'zone', label: 'Zon', hint: 'Z1', max: 128, primary: false },
  { key: 'shaft', label: 'Şaft', hint: 'Ş3', max: 64, primary: false },
  { key: 'line', label: 'Hat no', hint: 'H-12', max: 64, primary: false },
  { key: 'sheet', label: 'Pafta', hint: 'M-03', max: 128, primary: false },
  { key: 'drawingRevision', label: 'Çizim rev.', hint: 'R2', max: 64, primary: false },
  { key: 'note', label: 'Not', hint: 'Kısa not', max: 400, primary: false },
] as const;

export type ContextKey = (typeof CONTEXT_FIELDS)[number]['key'];
export type MeasureContext = Record<ContextKey, string>;
export type ContextRecents = Record<ContextKey, string[]>;

export const CONTEXT_KEYS: readonly ContextKey[] = CONTEXT_FIELDS.map((field) => field.key);
export const MAX_RECENT_VALUES = 8;

export const fieldOf = (key: ContextKey) => CONTEXT_FIELDS.find((field) => field.key === key)!;

export function emptyContext(): MeasureContext {
  return Object.fromEntries(CONTEXT_KEYS.map((key) => [key, ''])) as MeasureContext;
}

export function emptyRecents(): ContextRecents {
  return Object.fromEntries(CONTEXT_KEYS.map((key) => [key, [] as string[]])) as ContextRecents;
}

/** Değeri alan sınırına göre kırpar; boşluklar teklenir. */
export function cleanValue(key: ContextKey, value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, fieldOf(key).max);
}

/** Bozuk/eski kayıt sessizce boş bağlama döner; uygulama açılmaya devam eder. */
export function normalizeContext(raw: unknown): MeasureContext {
  const context = emptyContext();
  if (!raw || typeof raw !== 'object') return context;
  for (const key of CONTEXT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string') context[key] = cleanValue(key, value);
  }
  return context;
}

export function normalizeRecents(raw: unknown): ContextRecents {
  const recents = emptyRecents();
  if (!raw || typeof raw !== 'object') return recents;
  for (const key of CONTEXT_KEYS) {
    const list = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const value = cleanValue(key, item);
      const folded = value.toLocaleLowerCase('tr');
      if (value && !seen.has(folded)) {
        seen.add(folded);
        recents[key].push(value);
      }
      if (recents[key].length >= MAX_RECENT_VALUES) break;
    }
  }
  return recents;
}

/** Değeri alanın son kullanılanlarının başına alır (büyük/küçük harf farkı aynı değer sayılır). */
export function pushRecentValue(recents: ContextRecents, key: ContextKey, value: string): ContextRecents {
  const cleaned = cleanValue(key, value);
  if (!cleaned) return recents;
  const folded = cleaned.toLocaleLowerCase('tr');
  const next = [cleaned, ...recents[key].filter((item) => item.toLocaleLowerCase('tr') !== folded)].slice(
    0,
    MAX_RECENT_VALUES,
  );
  return { ...recents, [key]: next };
}

/** Bir alanı değiştirir (boş = temizle). Değişmediyse AYNI nesne döner. */
export function withValue(context: MeasureContext, key: ContextKey, value: string): MeasureContext {
  const cleaned = cleanValue(key, value);
  return context[key] === cleaned ? context : { ...context, [key]: cleaned };
}

export const hasContext = (context: MeasureContext) => CONTEXT_KEYS.some((key) => context[key] !== '');

/** Sunucudaki ayrı alanlar. Boş değer `null` gider (masaüstüyle aynı). */
export function contextToFields(context: MeasureContext): EntryFields {
  const orNull = (value: string) => value || null;
  return {
    block: orNull(context.block),
    floor: orNull(context.floor),
    room: orNull(context.room),
    zone: orNull(context.zone),
    sheet: orNull(context.sheet),
    drawingRevision: orNull(context.drawingRevision),
  };
}

/** Ayrı alanı olmayan bağlam parçaları + serbest not. */
export function contextNoteSegments(context: MeasureContext): string[] {
  const segments: string[] = [];
  if (context.shaft) segments.push(`Şaft: ${context.shaft}`);
  if (context.line) segments.push(`Hat: ${context.line}`);
  if (context.note) segments.push(context.note);
  return segments;
}

/** Ortak gövde üreticisinin (lib/measurementBodies.ts) beklediği bağlam. */
export function toEntryContext(context: MeasureContext): EntryContext {
  return { fields: contextToFields(context), noteSegments: contextNoteSegments(context) };
}

/**
 * Satırın notu: önce satıra özel not (ör. "Çap: DN25"), sonra bağlam notları.
 * Masaüstüyle aynı ortak `composeRowNotes` kuralı.
 */
export function composeNotes(rowNotes: string | null | undefined, context: MeasureContext): string | null {
  return composeRowNotes(rowNotes, contextNoteSegments(context));
}

/** Değer zaten "Kat 1" gibi öneki taşıyorsa ("Kat Kat 1" olmasın) ikinci kez eklenmez. */
const prefixed = (prefix: string) => (value: string) =>
  value.toLocaleLowerCase('tr').startsWith(prefix.toLocaleLowerCase('tr')) ? value : `${prefix} ${value}`;

const SHORT_LABEL: Record<ContextKey, (value: string) => string> = {
  block: prefixed('Blok'),
  floor: prefixed('Kat'),
  room: (value) => value,
  zone: prefixed('Zon'),
  shaft: prefixed('Şaft'),
  line: prefixed('Hat'),
  sheet: prefixed('Pafta'),
  drawingRevision: prefixed('Rev'),
  note: (value) => value,
};

/** "Blok A · Kat 2 · Mutfak" gibi tek satırlık özet; boş bağlamda boş metin. */
export function contextSummary(context: MeasureContext): string {
  return CONTEXT_KEYS.filter((key) => context[key])
    .map((key) => SHORT_LABEL[key](context[key]))
    .join(' · ');
}

type ContextSource = Partial<
  Record<'block' | 'floor' | 'room' | 'zone' | 'sheet' | 'drawingRevision', string | null | undefined>
>;

const SEEDED_KEYS = ['block', 'floor', 'room', 'zone', 'sheet', 'drawingRevision'] as const;

/**
 * Henüz hiç çip seçilmemiş projede bile seçenek çıksın: son kullanılanların
 * ardına, revizyondaki mevcut ölçümlerde geçen değerler (verilen sırayla; en
 * yeni önce verilmeli) eklenir. Böylece masaüstünde veya önceki girişlerde
 * yazılmış "Kat 1 / Kat 2" telefonda tek dokunuşla seçilir.
 */
export function seedRecents(recents: ContextRecents, measurements: readonly ContextSource[]): ContextRecents {
  let result = recents;
  for (const key of SEEDED_KEYS) {
    const seen = new Set(recents[key].map((item) => item.toLocaleLowerCase('tr')));
    const extra: string[] = [];
    for (const measurement of measurements) {
      if (recents[key].length + extra.length >= MAX_RECENT_VALUES) break;
      const value = cleanValue(key, measurement[key] ?? '');
      const folded = value.toLocaleLowerCase('tr');
      if (!value || seen.has(folded)) continue;
      seen.add(folded);
      extra.push(value);
    }
    if (extra.length) result = { ...result, [key]: [...recents[key], ...extra] };
  }
  return result;
}

/** Bir ölçüm satırının bağlam özeti (geçmiş listesi için). */
export function measurementContextSummary(measurement: {
  block?: string | null;
  floor?: string | null;
  room?: string | null;
  zone?: string | null;
  sheet?: string | null;
  drawingRevision?: string | null;
}): string {
  const context = emptyContext();
  context.block = measurement.block ?? '';
  context.floor = measurement.floor ?? '';
  context.room = measurement.room ?? '';
  context.zone = measurement.zone ?? '';
  context.sheet = measurement.sheet ?? '';
  context.drawingRevision = measurement.drawingRevision ?? '';
  return contextSummary(context);
}

/** Taslak anahtarları: bağlam proje başına (blok/kat adları projeye özgüdür). */
export const CONTEXT_DRAFT_KIND = 'measure-context';
export const CONTEXT_RECENTS_DRAFT_KIND = 'measure-context-recent';
