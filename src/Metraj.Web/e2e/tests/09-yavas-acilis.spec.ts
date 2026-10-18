import { expect, nav, test } from '../support/fixtures.ts';

test('yavaş ilk açılış: boş kabuk yerine açıklayıcı ilerleme, sonra boş durum', async ({ page }) => {
  // Çekirdek geç hazır oluyor (ilk kurulumda göç + tohumlama): proje listesi 3 sn gecikir.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });

  await page.goto('/mobile.html');
  await expect(nav(page)).toBeVisible();

  // Kısa süre iskelet, sonra ne beklendiği söylenir.
  await expect(page.getByRole('heading', { name: 'Standart kütüphane hazırlanıyor…' })).toBeVisible();
  await expect(page.getByText('İlk açılışta kart kütüphanesi kurulur')).toBeVisible();

  // Çekirdek hazır olunca ilerleme kalkar, normal boş durum gelir.
  release();
  await expect(page.getByRole('heading', { name: 'İlk projeni oluşturalım' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Standart kütüphane hazırlanıyor…' })).toHaveCount(0);
});
