import { expect, openApp, openTab, seedProject, test } from '../support/fixtures.ts';

test('kütüphane: arama, yeni kart, düzenleme → yeni sürüm', async ({ page, api }) => {
  await seedProject(api); // E2E kartlarını (E2E Çelik Fitting…) kütüphaneye koyar
  await openApp(page);
  await openTab(page, 'Kütüphane');

  // Arama: Türkçe/aksan duyarsız; sayaç süzülmüş sayıyı gösterir.
  const caption = page.getByRole('status').filter({ hasText: /kart/ }).first();
  await expect(caption).toContainText('kart');
  await page.getByRole('searchbox', { name: /Kütüphanede ara/ }).fill('E2E-FITTING');
  const library = page.getByRole('list', { name: 'Kart kütüphanesi' });
  await expect(library.getByRole('button', { name: /^E2E Çelik Fitting/ })).toBeVisible();
  await expect(library.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Aramayı temizle' }).click();

  // Yeni kart: benzersiz ad (kütüphane testler arasında korunur).
  const unique = Date.now().toString(36);
  const name = `E2E Yeni Kart ${unique}`;
  await page.getByRole('button', { name: 'Yeni kart', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Yeni kart' })).toBeVisible();
  await page.getByLabel('Ad', { exact: true }).fill(name);
  await page.getByLabel('Birim', { exact: true }).fill('adet');
  await page.getByRole('button', { name: 'Kartı kaydet' }).click();

  // Kayıttan sonra kart ayrıntısı: v1.
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Güncel sürüm:')).toContainText('v1');
  const created = (await api.get<Array<{ id: string; name: string; latestVersion: number }>>('/catalog/cards')).find(
    (card) => card.name === name,
  );
  expect(created?.latestVersion).toBe(1);

  // Düzenle → yeni sürüm: ad ve not değişir, sürüm v2 olur; kod sabit kalır.
  await page.getByRole('button', { name: 'Düzenle (yeni sürüm)' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kartı düzenle' })).toBeVisible();
  await expect(page.getByText(/v1 → v2/)).toBeVisible();
  await page.getByLabel('Not', { exact: true }).fill('İkinci sürümde eklendi');
  await page.getByRole('button', { name: 'Yeni sürüm olarak kaydet' }).click();

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Güncel sürüm:')).toContainText('v2');
  await expect(page.getByText('İkinci sürümde eklendi')).toBeVisible();
  const updated = (
    await api.get<Array<{ id: string; name: string; latestVersion: number; notes: string | null }>>('/catalog/cards')
  ).find((card) => card.id === created!.id);
  expect(updated).toMatchObject({ latestVersion: 2, notes: 'İkinci sürümde eklendi' });
});
