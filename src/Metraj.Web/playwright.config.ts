import { defineConfig, devices } from '@playwright/test';

// Telefon uçtan uca testleri. Gerçek çekirdek (DevServer: göç + 733 kartlık
// standart katalog + yerel API) ve en güncel `dist` (vite preview + /api vekili)
// kullanılır; hiçbir şey taklit edilmez. Süreçleri e2e/global-setup.ts başlatır:
// vekil adresi DevServer'ın seçtiği porttan geldiği için `webServer` seçeneği
// (globalSetup'tan ÖNCE çalışır) kullanılamaz.
//
//   npm run test:e2e                 (önce derler: vite preview dist'i sunar)
//   METRAJ_E2E_PORT=4311 npm run test:e2e   (önizleme portu; varsayılan 4310)
export const E2E_PORT = Number(process.env.METRAJ_E2E_PORT ?? 4310);

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/.results',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // Bütün testler TEK DevServer veritabanını paylaşır; her test başında çalışma
  // alanı sıfırlanır (e2e/support/fixtures.ts). Paralel çalışma bu sıfırlamaları
  // birbirinin altından çeker, bu yüzden tek işçi.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'e2e/.results/junit.xml' }]]
    : [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'pixel-7', use: { browserName: 'chromium' } }],
});
