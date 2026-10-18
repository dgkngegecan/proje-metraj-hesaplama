import { expect, openApp, openTreeRow, screenHeading, seedProject, test, typeOnKeypad } from '../support/fixtures.ts';

test.describe('giriş sayfası yüzeyleri', () => {
  test('bağlam çipi: seçilen kat kaydedilen satıra yazılır', async ({ page, api }) => {
    const data = await seedProject(api);
    await openApp(page);
    await openTreeRow(page, 'E2E Sistem');
    await openTreeRow(page, 'E2E Düz Kalem');
    await expect(screenHeading(page, 'E2E Düz Kalem')).toBeVisible();

    // Kat çipi → değer panelinde yeni değer → Uygula.
    await page.getByRole('button', { name: 'Kat seç' }).click();
    const picker = page.getByRole('dialog', { name: 'Kat' });
    await picker.getByLabel('Kat değeri').fill('3');
    await picker.getByRole('button', { name: 'Uygula' }).click();
    await expect(page.getByRole('region', { name: 'Giriş konumu' })).toContainText('Kat 3');

    await page.getByRole('button', { name: /^Miktar gir/ }).click();
    await typeOnKeypad(page, '12');
    await page.getByRole('dialog').getByRole('button', { name: 'Kaydet', exact: true }).click();

    // Satır sunucuda kat bilgisiyle durur; geçmişte konumuyla görünür.
    await expect(
      page.getByRole('list', { name: 'Giriş geçmişi' }).getByRole('button', { name: /^12 m,/ }),
    ).toBeVisible();
    await expect
      .poll(async () => (await api.measurements(data.revisionId)).filter((row) => row.placementId === data.plain.id))
      .toHaveLength(1);
    const [saved] = (await api.measurements(data.revisionId)).filter((row) => row.placementId === data.plain.id);
    expect(saved).toMatchObject({ inputQuantity: 12, inputUnit: 'm', floor: '3' });
  });

  test('boru çapı çipi: seçilen çap kayıtta variant olur', async ({ page, api }) => {
    const data = await seedProject(api);
    await openApp(page);
    await openTreeRow(page, 'E2E Sistem');
    await openTreeRow(page, 'E2E Boru Hattı');
    await expect(screenHeading(page, 'E2E Boru Hattı')).toBeVisible();

    const diameters = page.getByRole('radiogroup', { name: 'Çap' });
    await diameters.getByRole('radio', { name: /^DN25/ }).click();
    await expect(diameters.getByRole('radio', { name: /^DN25/ })).toBeChecked();

    await page.getByRole('button', { name: /^Metre gir · DN25/ }).click();
    await typeOnKeypad(page, '10');
    await page.getByRole('dialog').getByRole('button', { name: 'Kaydet', exact: true }).click();

    await expect(
      page.getByRole('list', { name: 'Giriş geçmişi' }).getByRole('button', { name: /^10 m, DN25/ }),
    ).toBeVisible();
    await expect
      .poll(
        async () => (await api.measurements(data.revisionId)).find((row) => row.placementId === data.pipe.id)?.variant,
      )
      .toBe('DN25');
    const summary = (await api.summaries(data.revisionId)).find((item) => item.placementId === data.pipe.id);
    expect(summary).toMatchObject({ variant: 'DN25', netQuantity: 10 });
  });

  test('fitting adetleri: artırıcılarla sayılır, "Hepsini ekle" tek toplu kayıt olur', async ({ page, api }) => {
    const data = await seedProject(api);
    await openApp(page);
    await openTreeRow(page, 'E2E Sistem');
    // Fitting, borunun altında: boru satırındaki alt kart düğmesiyle seviyeye girilir.
    await page.getByRole('button', { name: /^E2E Boru Hattı alt kartları/ }).click();
    await openTreeRow(page, 'E2E Fittingler');
    await expect(screenHeading(page, 'E2E Fittingler')).toBeVisible();

    await page.getByRole('radiogroup', { name: 'Çap' }).getByRole('radio', { name: /^DN20/ }).click();
    const plus = (name: string) => page.getByRole('button', { name: `${name} adedi artır` });
    for (let i = 0; i < 3; i += 1) await plus('Dirsek 90° DN20').click();
    for (let i = 0; i < 2; i += 1) await plus('Te DN20').click();
    await expect(page.getByRole('spinbutton', { name: 'Dirsek 90° DN20 adedi' })).toHaveAttribute('aria-valuenow', '3');

    await page.getByRole('button', { name: 'Hepsini ekle · 5 adet' }).click();
    await expect(page.getByRole('button', { name: 'Adetleri girin' })).toBeDisabled();

    await expect
      .poll(async () => (await api.measurements(data.revisionId)).filter((row) => row.placementId === data.fitting.id))
      .toHaveLength(2);
    const rows = (await api.measurements(data.revisionId)).filter((row) => row.placementId === data.fitting.id);
    // variant = seçilen çap, secondaryVariant = parça çeşidi.
    expect(rows.every((row) => row.variant === 'DN20')).toBe(true);
    const bySecondary = Object.fromEntries(rows.map((row) => [row.secondaryVariant, row.inputQuantity]));
    expect(bySecondary).toEqual({ 'DIRSEK-DN20': 3, 'TE-DN20': 2 });
    await expect(page.getByRole('heading', { name: /Giriş geçmişi/ })).toContainText('(2)');
  });

  test('radyatör girişi: tip ve yükseklik seçilir, boy başına adetler tek kayıtta gider', async ({ page, api }) => {
    const data = await seedProject(api);
    await openApp(page);
    await openTreeRow(page, 'E2E Sistem');
    await openTreeRow(page, 'E2E Radyatör');
    await expect(page.getByRole('heading', { name: 'Radyatör sayımı' })).toBeVisible();

    await page.getByRole('radiogroup', { name: 'Radyatör yüksekliği' }).getByRole('radio').first().click();
    const lengthCounter = page
      .getByRole('list', { name: /mm sayımı/ })
      .getByRole('spinbutton')
      .first();
    const counterName = (await lengthCounter.getAttribute('aria-label'))!;
    await page.getByRole('button', { name: `${counterName} artır`, exact: true }).click();
    await page.getByRole('button', { name: `${counterName} artır`, exact: true }).click();
    await expect(lengthCounter).toHaveAttribute('aria-valuenow', '2');

    await page.getByRole('button', { name: '2 adet kaydet' }).click();
    await expect(page.getByRole('button', { name: 'Adetleri girin' })).toBeDisabled();

    await expect
      .poll(async () => (await api.measurements(data.revisionId)).filter((row) => row.placementId === data.radiator.id))
      .toHaveLength(1);
    const [row] = (await api.measurements(data.revisionId)).filter((item) => item.placementId === data.radiator.id);
    expect(row!.inputQuantity).toBe(2);
    // Radyatör ölçüleri satır notunda taşınır ("Radyatör: Tip 22 · Yükseklik: 300 mm · Uzunluk: 300 mm").
    expect(row!.notes).toMatch(/^Radyatör: Tip .+ · Yükseklik: \d+ mm · Uzunluk: \d+ mm$/);
    await expect(page.getByRole('heading', { name: /Giriş geçmişi/ })).toContainText('(1)');
  });
});
