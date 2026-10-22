import { readUiState } from '../../uiState';
import { draftKey } from '../store/drafts.ts';

/** Tema tercihi: sistem, açık veya koyu. Ayarlar ekranı değiştirir; değer `/ui-state`'te saklanır. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Tercih kaydedilmemişse koyu tema: uygulamanın varsayılan görünümü. */
export const DEFAULT_THEME: ThemePreference = 'dark';

export const THEME_KEY = draftKey('mobile-prefs', 'theme');
export const HAPTICS_KEY = draftKey('mobile-prefs', 'haptics');

export function parseThemePreference(raw: string | null): ThemePreference {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

/**
 * İlk çizimden ÖNCE çağrılır: sunucudaki taslaklar henüz gelmemişken yerel
 * aynadan (localStorage) okunur, böylece koyu tema seçmiş kullanıcı açılışta
 * bir an beyaz ekran görmez.
 */
export function applyStoredTheme() {
  applyTheme(parseThemePreference(readUiState({}, THEME_KEY)));
}
