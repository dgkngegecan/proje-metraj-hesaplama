import { longPress, swipeLeft } from '../support/gestures.ts';
import { expect, openApp, openTreeRow, screenHeading, seedProject, test } from '../support/fixtures.ts';

test.describe('kart ekleme, taşıma, silme', () => {
  test('kart ekleme paneli: Türkçe/aksan duyarsız arama bulur, tek dokunuşla ekler', async ({ page, api }) => {
    const data = await seedProject(api);
    await openApp(page);
    await openTreeRow(page, 'E2E Sistem');
    await page.getByRole('button', { name: 'Kart ekle' }).click();

    const panel = page.getByRole('dialog', { name: 'Kart ekle' });
    const search = panel.getByRole('searchbox', { name: 'Kütüphanede ara' });
    const target = panel.getByRole('button', { name: 'E2E Çelik Fitting ekle', exact: true });

    // Aksansız küçük harf, Türkçe büyük harf (İ/I) ve karışık sözcük sırası aynı kartı bulur.
    await search.fill('celik fitting e2e');
    await expect(target).toBeVisible();
    await search.fill('ÇELİK FİTTİNG E2E');
    await expect(target).toBeVisible();
    await search.fill('E2E fitting CELIK');
    await expect(target).toBeVisible();
    // Alakasız sorgu hiçbir şey bulmaz ve sonraki adımı söyler.
    await search.fill('zzzyokboylebirkart');
    await expect(panel.getByRole('heading', { name: 'Eşleşen kart yok' })).toBeVisible();
    await search.fill('celik fitting e2e');

    await target.click();
    await expect(page.getByRole('dialog', { name: 'Kart ekle' })).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: '“E2E Çelik Fitting” eklendi.' })).toBeVisible();

    // Seviyede yeni satır; sunucuda sistemin altında.
    await expect(
      page.getByRole('list', { name: /alt kartları/ }).getByRole('button', { name: /^E2E Çelik Fitting/ }),
    ).toBeVisible();
    const added = (await api.placements(data.revisionId)).find((item) => item.displayName === 'E2E Çelik Fitting');
    expect(added?.parentPlacementId).toBe(data.system.id);
  });

  test('uzun basma menüsü: kartı başka bir kartın altına taşır', async ({ page, api }) => {
    const data = await seedProject(api);
    await openApp(page);
    await openTreeRow(page, 'E2E Sistem');

    const row = page.getByRole('list', { name: /alt kartları/ }).getByRole('button', { name: /^E2E Düz Kalem/ });
    await longPress(page, row, page.getByRole('dialog', { name: 'E2E Düz Kalem' }));

    await page.getByRole('menuitem', { name: /^Taşı/ }).click();
    const picker = page.getByRole('dialog', { name: 'Nereye taşınsın?' });
    await picker.getByRole('button', { name: /^E2E Boru Hattı/ }).click();

    await expect(page.getByRole('status').filter({ hasText: 'taşındı' })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await api.placements(data.revisionId)).find((item) => item.id === data.plain.id)?.parentPlacementId,
      )
      .toBe(data.pipe.id);
    // Eski seviyeden kalktı.
    await expect(
      page.getByRole('list', { name: /alt kartları/ }).getByRole('button', { name: /^E2E Düz Kalem/ }),
    ).toHaveCount(0);
  });

  test('kaydırarak sil: "Geri al" kaydı geri getirir; geri alınmayan silme sunucuya gider', async ({ page, api }) => {
    const data = await seedProject(api);
    await api.addMeasurement(data.revisionId, data.plain.id, 4, 'm');
    await api.addMeasurement(data.revisionId, data.plain.id, 7, 'm');
    await openApp(page);
    await openTreeRow(page, 'E2E Sistem');
    await openTreeRow(page, 'E2E Düz Kalem');
    await expect(screenHeading(page, 'E2E Düz Kalem')).toBeVisible();

    const history = page.getByRole('list', { name: 'Giriş geçmişi' });
    const four = history.getByRole('button', { name: /^4 m,/ });
    const seven = history.getByRole('button', { name: /^7 m,/ });
    await expect(four).toBeVisible();
    await expect(seven).toBeVisible();

    // 1) Tam kaydırma → satır kalkar, çubukta "Geri al" → satır geri gelir.
    await swipeLeft(page, four, 330);
    await expect(four).toBeHidden();
    await page.getByRole('button', { name: 'Geri al' }).click();
    await expect(four).toBeVisible();

    // 2) Ötekini sil ve geri alma: 5 sn sonra DELETE gider.
    const deleted = page.waitForResponse(
      (response) => response.request().method() === 'DELETE' && /\/api\/measurements\//.test(response.url()),
    );
    await swipeLeft(page, seven, 330);
    await expect(seven).toBeHidden();
    expect((await deleted).status()).toBe(204);

    // Geri alınan 4 m sunucuda kaldı, silinen 7 m gitti.
    const remaining = (await api.measurements(data.revisionId))
      .filter((row) => row.placementId === data.plain.id)
      .map((row) => row.inputQuantity);
    expect(remaining).toEqual([4]);
    await expect(four).toBeVisible();
  });
});
