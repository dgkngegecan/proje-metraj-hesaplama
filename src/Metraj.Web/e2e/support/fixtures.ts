import { test as base, expect, type Page } from '@playwright/test';
import { MetrajApi, type ApiCard, type ApiPlacement, type ApiProject } from './api.ts';
import { readState } from './runtime.ts';

/**
 * Her test:
 *  - çalışma alanını boş başlar (projeler ve kalıcı taslaklar silinir), bu yüzden testler
 *    birbirinin verisine bağımlı değildir;
 *  - kendi verisini `api` ile kurar ve arayüzü `/mobile.html`'de açar;
 *  - sayfada yakalanmamış bir hata oluşursa başarısız olur.
 */
export const test = base.extend<{ api: MetrajApi }>({
  api: [
    async ({ request }, use) => {
      const api = new MetrajApi(request, readState().apiUrl);
      await api.resetWorkspace();
      await use(api);
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    expect(errors, 'Sayfada yakalanmamış hata olmamalı').toEqual([]);
  },
});

export { expect };

// ---------------------------------------------------------------------------
// Ortak test verisi
// ---------------------------------------------------------------------------

/** Çelik boru (çap çipleri), uyumlu fitting ve radyatör kartları; kod sabit, ad okunur. */
export async function ensureE2eCards(api: MetrajApi) {
  const system = await api.cardByCode('STD-SYS-CW-DIST');
  const pipe = await api.ensureCard({
    code: 'E2E-BORU',
    name: 'E2E Çelik Boru',
    cardType: 'Material',
    unit: 'm',
    variantMode: 'Pipe',
    materialType: 'Çelik',
    salesConversion: 'StandardLength',
    containerParameter: 6,
    wasteRatePct: 5,
    variants: [
      { code: 'DN20', label: 'DN20', standardLength: 6 },
      { code: 'DN25', label: 'DN25', standardLength: 6 },
    ],
  });
  const fitting = await api.ensureCard({
    code: 'E2E-FITTING',
    name: 'E2E Çelik Fitting',
    cardType: 'Accessory',
    unit: 'adet',
    variantMode: 'Fitting',
    materialType: 'Çelik',
    variants: [
      { code: 'DIRSEK-DN20', label: 'Dirsek 90° DN20', compatibleDiameters: ['DN20'], compatiblePipeSystems: ['*'] },
      { code: 'TE-DN20', label: 'Te DN20', compatibleDiameters: ['DN20'], compatiblePipeSystems: ['*'] },
      { code: 'DIRSEK-DN25', label: 'Dirsek 90° DN25', compatibleDiameters: ['DN25'], compatiblePipeSystems: ['*'] },
    ],
  });
  const radiator = await api.ensureCard({
    code: 'E2E-RADYATOR',
    name: 'E2E Panel Radyatör',
    cardType: 'Material',
    unit: 'adet',
    variantMode: 'None',
  });
  const plain = await api.ensureCard({
    code: 'E2E-MALZEME',
    name: 'E2E Düz Malzeme',
    cardType: 'Material',
    unit: 'm',
    wasteRatePct: 10,
  });
  return { system, pipe, fitting, radiator, plain };
}

export interface E2eProject {
  project: ApiProject;
  revisionId: string;
  cards: Awaited<ReturnType<typeof ensureE2eCards>>;
  /** "E2E Sistem" kökü; altına boru, fitting, radyatör ve düz malzeme eklenir. */
  system: ApiPlacement;
  pipe: ApiPlacement;
  fitting: ApiPlacement;
  radiator: ApiPlacement;
  plain: ApiPlacement;
}

/**
 * Boş bir proje + sistem altında boru / fitting / radyatör / düz malzeme. Ölçüm girilmez:
 * testler beklenen toplamı kendileri kurar. Proje tek proje olduğu için arayüz onu açar.
 */
export async function seedProject(api: MetrajApi, code = 'E2E-001'): Promise<E2eProject> {
  const cards = await ensureE2eCards(api);
  const project = await api.createProject(code, 'E2E Deneme Projesi');
  const revisionId = project.latestRevisionId;
  const system = await api.addPlacement(revisionId, cards.system, null, 'E2E Sistem');
  const pipe = await api.addPlacement(revisionId, cards.pipe, system.id, 'E2E Boru Hattı');
  const fitting = await api.addPlacement(revisionId, cards.fitting, pipe.id, 'E2E Fittingler');
  const radiator = await api.addPlacement(revisionId, cards.radiator, system.id, 'E2E Radyatör');
  const plain = await api.addPlacement(revisionId, cards.plain, system.id, 'E2E Düz Kalem');
  return { project, revisionId, cards, system, pipe, fitting, radiator, plain };
}

export type { ApiCard };

// ---------------------------------------------------------------------------
// Arayüz yardımcıları (rol / etiket tabanlı)
// ---------------------------------------------------------------------------

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Ana gezinme' });

/** Mobil uygulamayı açar ve kabuğun çizilmesini bekler. */
export async function openApp(page: Page) {
  await page.goto('/mobile.html');
  await expect(nav(page)).toBeVisible();
}

export async function openTab(page: Page, name: 'Proje' | 'Özet' | 'Kütüphane' | 'Ayarlar') {
  await nav(page).getByRole('button', { name, exact: true }).click();
  await expect(nav(page).getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
}

const KEY_NAMES: Record<string, string> = { ',': 'virgül', '+': 'artı', '×': 'çarpı', '−': 'eksi' };

/** Tuş takımına metni dokunarak yazar: "2,5+3×2". */
export async function typeOnKeypad(page: Page, text: string) {
  const keypad = page.getByRole('group', { name: /tuş takımı/ });
  for (const char of text) {
    await keypad.getByRole('button', { name: KEY_NAMES[char] ?? char, exact: true }).click();
  }
}

/** Ağaçtaki bir satırı görünen adıyla açar (ölçülebilirse giriş sayfası, klasörse alt seviye). */
export async function openTreeRow(page: Page, displayName: string) {
  const list = page.getByRole('list', { name: /Proje ağacı|alt kartları/ });
  await list
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(displayName)}`) })
    .first()
    .click();
}

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** İç içe ekranın başlığı (yalnız görünen katman erişilebilirlik ağacındadır). */
export const screenHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 1, name: title, exact: true });
