import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Uzun basma: işaretçi basılı tutulur, eylem paneli GÖRÜNENE kadar beklenir (sabit uyku yok),
 * sonra bırakılır. Uygulamanın uzun basma eşiği zamanlayıcıyla çalıştığı için panelin çıkması
 * gerçek bir uzun basma olduğunu kanıtlar.
 */
export async function longPress(page: Page, target: Locator, expectedDialog: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Uzun basılacak öğe görünür değil.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await expect(expectedDialog).toBeVisible();
  } finally {
    await page.mouse.up();
  }
}

/**
 * Satırı sola kaydırır (yatay jest). Adımlı hareket: uygulama ilk 8 px'te ekseni kilitler.
 * `distance` satır genişliğine yakınsa "tam kaydırma" eylemi çalışır.
 */
export async function swipeLeft(page: Page, row: Locator, distance: number) {
  const box = await row.boundingBox();
  if (!box) throw new Error('Kaydırılacak satır görünür değil.');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width - 12;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX - (distance * step) / steps, y);
  }
  await page.mouse.up();
}
