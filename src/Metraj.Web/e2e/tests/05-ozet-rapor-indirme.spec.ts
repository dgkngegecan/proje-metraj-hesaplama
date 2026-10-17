import { statSync } from 'node:fs';
import { longPress } from '../support/gestures.ts';
import { expect, openApp, openTab, openTreeRow, seedProject, test } from '../support/fixtures.ts';

const STAMP = '\\d{4}-\\d{2}-\\d{2}_\\d{4}';

test('özet: ağaçtan rapor kapsamı → PDF/Excel/Word indirme (tarayıcı yolu, okunur ad, boyut > 0)', async ({
  page,
  api,
}) => {
  const data = await seedProject(api, 'E2E-RAPOR');
  await api.addMeasurement(data.revisionId, data.pipe.id, 12, 'm', { variant: 'DN25' });
  await api.addMeasurement(data.revisionId, data.plain.id, 5, 'm');

  await openApp(page);
  await openTreeRow(page, 'E2E Sistem');

  // Boru satırına uzun bas → "Rapor kapsamı yap" → Özet sekmesi kapsamla açılır.
  const row = page
    .getByRole('list', { name: /alt kartları/ })
    .getByRole('button', { name: /^E2E Boru Hattı/ })
    .first();
  await longPress(page, row, page.getByRole('dialog', { name: 'E2E Boru Hattı' }));
  await page.getByRole('menuitem', { name: /^Rapor kapsamı yap/ }).click();

  await expect(
    page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Özet' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: /^Rapor kapsamı: E2E Boru Hattı ve altı/ })).toBeVisible();
  // Kapsam yalnız boruyu içerir: düz kalemin 5 m'si raporda yok.
  const materials = page.getByRole('list', { name: 'Malzeme listesi' });
  await expect(materials.getByRole('article', { name: 'E2E Boru Hattı' })).toBeVisible();
  await expect(materials.getByRole('article', { name: 'E2E Düz Kalem' })).toHaveCount(0);

  const formats = [
    { button: 'PDF', extension: 'pdf' },
    { button: 'Excel', extension: 'xlsx' },
    { button: 'Word', extension: 'docx' },
  ];
  for (const { button, extension } of formats) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const download = await downloadPromise;

    // {ProjeKodu}_R{No}_{Kapsam}_{yyyy-MM-dd_HHmm}.{uzantı}; GUID'li geçici ad sızmaz.
    expect(download.suggestedFilename()).toMatch(new RegExp(`^E2E-RAPOR_R0_E2E-Boru-Hattı_${STAMP}\\.${extension}$`));
    const file = await download.path();
    expect(statSync(file).size, `${button} dosyası boş olmamalı`).toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({ hasText: 'indirildi' })).toBeVisible();
  }

  // Bütün proje kapsamında ad kapsam parçasını taşımaz.
  await page.getByRole('button', { name: 'Bütün proje', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Rapor kapsamı: bütün proje/ })).toBeVisible();
  const whole = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  expect((await whole).suggestedFilename()).toMatch(new RegExp(`^E2E-RAPOR_R0_${STAMP}\\.pdf$`));

  // Sekme değişimi sonrası da özet tutarlı: Proje sekmesine dönülebilir.
  await openTab(page, 'Proje');
});
