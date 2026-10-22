import { expect, openApp, openTreeRow, screenHeading, test } from '../support/fixtures.ts';

test('ilk açılış: boş durum → örnek proje → ağaç → iç seviye → Net/Fireli/Alım rozetleri', async ({ page, api }) => {
  await openApp(page);

  // Boş durum: ne olduğunu ve sonraki adımı söyler.
  await expect(page.getByRole('heading', { name: 'Henüz proje yok' })).toBeVisible();
  await page.getByRole('button', { name: 'Örnek projeyi aç' }).click();

  // Üst çubukta örnek proje; kök seviyede tek kart (proje kökü).
  await expect(page.getByRole('button', { name: /Açık proje: Sentetik Temiz Su Referans Projesi/ })).toBeVisible();
  const tree = page.getByRole('list', { name: 'Proje ağacı' });
  await expect(tree.getByRole('listitem')).toHaveCount(1);

  // İç seviye: klasöre girince yol göstergesi ve 13 alt kart.
  await openTreeRow(page, 'Sentetik Temiz Su Referans Projesi');
  await expect(screenHeading(page, 'Sentetik Temiz Su Referans Projesi')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Konum' })).toBeVisible();

  // Beklenen sayılar sunucudan: arayüzdeki rozetler aynı toplamları göstermeli.
  const [project] = await api.get<Array<{ latestRevisionId: string }>>('/projects');
  const summaries = await api.summaries(project!.latestRevisionId);
  const pipe = summaries.find((item) => item.placementName === 'PPRC Boru DN25 — A Blok');
  expect(pipe, 'örnek projede A Blok boru özeti').toBeTruthy();
  expect(pipe!.netQuantity).toBeGreaterThan(0);

  const row = page.getByRole('button', { name: /^PPRC Boru DN25 — A Blok/ });
  await expect(row).toBeVisible();
  const format = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 4 });
  await expect(row).toContainText(`Net ${format(pipe!.netQuantity)} m`);
  await expect(row).toContainText(`Fireli ${format(pipe!.withWasteQuantity)}`);
  await expect(row).toContainText(`Alım ${format(pipe!.purchaseQuantity)} boy`);
});
