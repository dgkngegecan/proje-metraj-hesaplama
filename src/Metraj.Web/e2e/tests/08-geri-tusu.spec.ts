import {
  expect,
  openApp,
  openTab,
  openTreeRow,
  screenHeading,
  seedProject,
  test,
  typeOnKeypad,
} from '../support/fixtures.ts';

test.describe('geri tuşu zinciri', () => {
  test('panel → iç seviye → sekme kökü: her geri bir katman kapatır', async ({ page, api }) => {
    await seedProject(api);
    await openApp(page);

    // Zincir: kök → "E2E Sistem" seviyesi → "E2E Düz Kalem" giriş sayfası → tuş takımı paneli.
    const rootList = page.getByRole('list', { name: 'Proje ağacı' });
    await openTreeRow(page, 'E2E Sistem');
    await openTreeRow(page, 'E2E Düz Kalem');
    await expect(screenHeading(page, 'E2E Düz Kalem')).toBeVisible();
    await page.getByRole('button', { name: /^Miktar gir/ }).click();
    await typeOnKeypad(page, '5');
    const keypad = page.getByRole('dialog', { name: 'E2E Düz Kalem' });
    await expect(keypad).toBeVisible();

    // 1) Geri: yalnız panel kapanır; yazılan ifade korunur, giriş sayfası yerinde.
    await page.goBack();
    await expect(keypad).toBeHidden();
    await expect(screenHeading(page, 'E2E Düz Kalem')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Miktar gir.*5/ })).toBeVisible();

    // 2) Geri: giriş sayfası kapanır, bir üst iç seviyeye (E2E Sistem) dönülür.
    await page.goBack();
    await expect(screenHeading(page, 'E2E Düz Kalem')).toBeHidden();
    await expect(screenHeading(page, 'E2E Sistem')).toBeVisible();

    // 3) Geri: iç seviye kapanır, sekme köküne (proje ağacı) dönülür.
    await page.goBack();
    await expect(screenHeading(page, 'E2E Sistem')).toBeHidden();
    await expect(rootList).toBeVisible();
    await expect(rootList.getByRole('button', { name: /^E2E Sistem/ })).toBeVisible();
  });

  test('başlangıç sekmesi dışındaki sekmede geri, Proje sekmesine döner', async ({ page, api }) => {
    await seedProject(api);
    await openApp(page);
    await openTab(page, 'Ayarlar');
    await page.getByRole('button', { name: /^Uygulama hakkında/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Uygulama hakkında' })).toBeVisible();

    // Sürüm ve veri klasörü /api/health'ten; köprüsüz (masaüstü/tarayıcı) yalnız klasör adı görünür.
    const health = await api.get<{ status: string; version: string; dataLocation: string }>('/health');
    const folder = health.dataLocation
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop()!;
    const facts = (label: string) =>
      page.locator('.m-facts__row').filter({ has: page.getByText(label, { exact: true }) });
    await expect(facts('Uygulama sürümü').locator('dd')).toHaveText(health.version);
    await expect(facts('Veri konumu').locator('dd')).toHaveText(`Bu bilgisayar · ${folder} klasörü`);

    // İç ekran → Ayarlar kökü → Proje sekmesi.
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Uygulama hakkında' })).toBeHidden();
    await expect(
      page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Ayarlar' }),
    ).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(
      page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Proje' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});
