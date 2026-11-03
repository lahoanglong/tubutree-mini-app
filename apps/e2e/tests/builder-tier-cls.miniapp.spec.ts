import type { Page } from '@playwright/test';
import { test, expect, reply } from './support/mock-api';
import { mockBuilder } from './support/builder-mocks';
import { CTV_TIERS } from './support/affiliate-mocks';

/**
 * Hàng huy hiệu bậc CTV ở đầu xem trước của trình dựng (Mini 375px) không gây xê dịch bố cục, vào thẳng bằng liên kết (không có cache bậc từ trang CTV):
 * `/affiliate/tiers` về chậm, về bậc thấp nhất, về bậc cao hoặc lỗi; chủ shop đã duyệt hay chưa duyệt. Dự án Mini chạy WebKit, không có PerformanceObserver 'layout-shift',
 * nên spec ép Chromium. Đo phần xê dịch sinh ra SAU lúc khung chờ đã vẽ (lúc bậc về), không phải lúc trang dựng lần đầu.
 */
test.use({ browserName: 'chromium', viewport: { width: 375, height: 812 } });

async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const frames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const readCls = async (page: Page): Promise<number> => {
  await frames(page);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
};

const PERSONAS = [
  { name: 'ctv đã duyệt', storefront: { approved: true } },
  { name: 'ctv_pending (chưa duyệt)', storefront: { approved: false, needsApproval: true, status: 'LIVE', isPublished: true } },
];
const OUTCOMES: { name: string; tier?: 'Tân binh' | 'Đồng' | 'Kim Cương'; fail?: boolean }[] = [
  { name: 'bậc thấp nhất (không huy hiệu)', tier: 'Tân binh' },
  { name: 'bậc Đồng', tier: 'Đồng' },
  { name: 'bậc Kim Cương (tên dài)', tier: 'Kim Cương' },
  { name: 'lỗi 500', fail: true },
];

for (const persona of PERSONAS) {
  for (const outcome of OUTCOMES) {
    test(`${persona.name}, /affiliate/tiers về chậm rồi ${outcome.name}: CLS do hàng huy hiệu = 0 và khối dưới không nhích`, async ({ page, api }) => {
      let release!: () => void;
      const hold = new Promise<void>((r) => { release = r; });
      mockBuilder(api, { storefront: persona.storefront, tier: outcome.tier });
      const final = CTV_TIERS.allTiers.find((t) => t.name === (outcome.tier ?? 'Tân binh'))!;
      api.get('/affiliate/tiers', async () => {
        await hold;
        return outcome.fail ? reply(500, { statusCode: 500, message: 'Máy chủ lỗi' }) : { ...CTV_TIERS, tier: { name: final.name, emoji: final.emoji } };
      });
      await trackLayoutShift(page);
      await page.goto('/storefront');
      await expect(page.getByTestId('section-card')).toHaveCount(3, { timeout: 15_000 });
      await expect(page.getByTestId('tier-badge-skeleton')).toBeVisible();
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      const clsBefore = await readCls(page);
      const cardBefore = (await page.getByTestId('section-card').first().boundingBox())!.y;
      release();
      await expect(page.getByTestId('tier-badge-skeleton')).toHaveCount(0);
      const clsAfter = await readCls(page);
      const cardAfter = (await page.getByTestId('section-card').first().boundingBox())!.y;
      expect(clsAfter - clsBefore, `CLS lúc bậc về ${(clsAfter - clsBefore).toFixed(4)}`).toBeLessThanOrEqual(0.0001);
      expect(Math.abs(cardAfter - cardBefore), `khối đầu nhích ${cardAfter - cardBefore}px`).toBeLessThanOrEqual(1);
      await expect(page.getByTestId(outcome.fail || outcome.tier === 'Tân binh' ? 'tier-badge-hint' : 'tier-badge-skeleton')).toHaveCount(outcome.fail || outcome.tier === 'Tân binh' ? 1 : 0);
      if (outcome.fail) await expect(page.getByTestId('tier-badge-hint')).toHaveText('Huy hiệu chưa tải');
      if (outcome.tier === 'Tân binh') await expect(page.getByTestId('tier-badge-hint')).toHaveText('Huy hiệu từ bậc Đồng');
    });
  }
}

test('bậc cao: huy hiệu và dòng gợi ý không cùng xuất hiện, tên bậc dài không tràn ngang 375px', async ({ page, api }) => {
  mockBuilder(api, { tier: 'Kim Cương', storefront: { approved: true } });
  await page.goto('/storefront');
  await expect(page.getByText('CTV Kim Cương')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('tier-badge-hint')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('khổ 320px, ctv đã duyệt + Tân binh: dòng gợi ý chung hàng với "CTV tuyển chọn", không xuống dòng khi bậc về', async ({ page, api }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  mockBuilder(api, { storefront: { approved: true }, tier: 'Tân binh' });
  api.get('/affiliate/tiers', async () => {
    await hold;
    return { ...CTV_TIERS, tier: { name: 'Tân binh', emoji: CTV_TIERS.allTiers[0]!.emoji } };
  });
  await page.goto('/storefront');
  await expect(page.getByTestId('tier-badge-skeleton')).toBeVisible({ timeout: 15_000 });
  const skeletonRow = (await page.getByTestId('tier-badge-skeleton').boundingBox())!;
  release();
  const hint = page.getByTestId('tier-badge-hint');
  await expect(hint).toBeVisible();
  const box = (await hint.boundingBox())!;
  expect(Math.abs(box.y - skeletonRow.y), 'dòng gợi ý xuống dòng so với khung chờ').toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
