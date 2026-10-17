import { expect, openApp, openTreeRow, screenHeading, test, typeOnKeypad } from '../support/fixtures.ts';

const format = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 4 });

test('giriş sayfası: tuş takımı 2,5+3×2 → önizleme 8,5 → kaydet → net toplam artar → geçmişte görünür', async ({
  page,
  api,
}) => {
  const sample = await api.importSample();
  const revisionId = sample.project.latestRevisionId;
  const before = (await api.summaries(revisionId)).find((item) => item.placementName === 'PPRC Boru DN25 — A Blok')!;

  await openApp(page);
  await openTreeRow(page, 'Sentetik Temiz Su Referans Projesi');
  await openTreeRow(page, 'PPRC Boru DN25 — A Blok');
  await expect(screenHeading(page, 'PPRC Boru DN25 — A Blok')).toBeVisible();

  // Mevcut net toplam arayüzde sunucudakiyle aynı.
  const totals = page.getByRole('region', { name: 'Toplam' });
  await expect(totals).toContainText(`${format(before.netQuantity)} m`);

  await page.getByRole('button', { name: /^Miktar gir/ }).click();
  const keypad = page.getByRole('dialog');
  await typeOnKeypad(page, '2,5+3×2');
  // Çarpma önce yapılır: 2,5 + (3×2) = 8,5.
  await expect(keypad).toContainText('= 8,5 m');
  await keypad.getByRole('button', { name: 'Kaydet', exact: true }).click();

  // İyimser güncelleme + sunucu özeti: net toplam tam 8,5 m artar.
  const expectedNet = before.netQuantity + 8.5;
  await expect(totals).toContainText(`${format(expectedNet)} m`);
  const after = (await api.summaries(revisionId)).find((item) => item.placementName === 'PPRC Boru DN25 — A Blok')!;
  expect(after.netQuantity).toBeCloseTo(expectedNet, 6);
  expect(after.measurementCount).toBe(before.measurementCount + 1);

  // Geçmişte en yeni satır olarak görünür; sayaç bir artar.
  await expect(page.getByRole('heading', { name: /Giriş geçmişi/ })).toContainText(`(${before.measurementCount + 1})`);
  const history = page.getByRole('list', { name: 'Giriş geçmişi' });
  await expect(history.getByRole('button', { name: /^8,5 m,/ })).toBeVisible();
});
