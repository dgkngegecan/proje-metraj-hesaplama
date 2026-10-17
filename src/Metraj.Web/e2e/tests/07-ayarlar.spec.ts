import { statSync } from 'node:fs';
import { expect, openApp, openTab, openTreeRow, seedProject, test } from '../support/fixtures.ts';

test.describe('ayarlar', () => {
  test('revizyon onayı: onaylı revizyonda proje ekranında yazma yüzeyleri gizlenir', async ({ page, api }) => {
    const data = await seedProject(api);
    await api.addMeasurement(data.revisionId, data.plain.id, 9, 'm');
    await openApp(page);

    // Onay öncesi yazma yüzeyleri açık.
    await openTreeRow(page, 'E2E Sistem');
    await expect(page.getByRole('button', { name: 'Kart ekle' })).toBeVisible();

    await openTab(page, 'Ayarlar');
    await page.getByRole('button', { name: /^Revizyonlar/ }).click();
    await page.getByRole('button', { name: 'Onayla', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: /onaylansın mı/ });
    await confirm.getByRole('button', { name: 'Onayla ve kilitle' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'onaylandı ve kilitlendi' })).toBeVisible();

    const revisions = await api.get<Array<{ id: string; status: string }>>(`/projects/${data.project.id}/revisions`);
    expect(revisions.find((revision) => revision.id === data.revisionId)?.status).toBe('Approved');

    // Proje sekmesi: kalıcı kilit şeridi; "Kart ekle" yok; giriş sayfasında yazma yüzeyi yok, okuma tam.
    await openTab(page, 'Proje');
    await expect(page.getByText('R0 onaylı ve kilitli.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kart ekle' })).toHaveCount(0);
    await openTreeRow(page, 'E2E Düz Kalem');
    await expect(page.getByRole('region', { name: 'Toplam' })).toContainText('9 m');
    await expect(page.getByRole('button', { name: /^Miktar gir/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Ölçüm konumu' })).toHaveCount(0);
    const history = page.getByRole('list', { name: 'Giriş geçmişi' });
    // Okuma tam (satır görünür), düzenleme yolu yok (satır düğme değil, kaydırma eylemi yok).
    await expect(history).toContainText('9');
    await expect(history.getByRole('button')).toHaveCount(0);
  });

  test('yedek al ve çalışma alanını dışa aktar', async ({ page, api }) => {
    await seedProject(api);
    type Backup = { fileName: string; reason: string };
    const namesBefore = new Set((await api.get<Backup[]>('/database/backups')).map((backup) => backup.fileName));
    await openApp(page);
    await openTab(page, 'Ayarlar');

    // Yedek: listeye yeni satır eklenir.
    await page.getByRole('button', { name: /^Yedekler ve güvenlik/ }).click();
    await page.getByRole('button', { name: 'Şimdi yedekle' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Güvenli yedek alındı.' })).toBeVisible();
    // Yedek sayısı saklama kuralıyla sınırlı olduğundan sayıya değil yeni dosyaya bakılır.
    let created: Backup | undefined;
    await expect
      .poll(async () => {
        created = (await api.get<Backup[]>('/database/backups')).find(
          (backup) => backup.reason === 'Manual' && !namesBefore.has(backup.fileName),
        );
        return created?.fileName;
      })
      .toBeTruthy();
    await expect(
      page.getByRole('list', { name: 'Yedekler' }).getByText(created!.fileName, { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Geri', exact: true }).click();

    // Çalışma alanı dışa aktarma: tarayıcı indirmesi, okunur ad, boyut > 0.
    await page.getByRole('button', { name: /^Çalışma alanı/ }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Çalışma alanını dışa aktar' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^ProjeMetraj-\d{8}-\d{6}\.metraj$/);
    expect(statSync(await download.path()).size).toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({ hasText: /indirildi/ })).toBeVisible();
  });
});
