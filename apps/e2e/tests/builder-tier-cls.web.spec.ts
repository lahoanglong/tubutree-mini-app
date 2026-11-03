import type { Page } from '@playwright/test';
import { expect, reply, test } from './support/mock-api';
import { CTV_TIERS } from './support/affiliate-mocks';
import { mockBuilder, setBuilderSession } from './support/builder-web-mocks';

/**
 * Hàng huy hiệu bậc CTV ở đầu xem trước của trình dựng (web 375px) không gây xê dịch bố cục, vào thẳng bằng liên kết: `/affiliate/tiers` về chậm rồi về bậc thấp nhất,
 * bậc cao hoặc lỗi; chủ shop đã duyệt hay chưa duyệt (chưa duyệt thì không có "CTV tuyển chọn" giữ hàng). Giống `builder-tier-cls.miniapp.spec.ts`.
 */
test.use({ viewport: { width: 375, height: 812 } });

async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const readCls = async (page: Page): Promise<number> => {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
};

const PERSONAS = [
  { name: 'ctv đã duyệt', approved: true },
  { name: 'ctv_pending (chưa duyệt)', approved: false },
];
const OUTCOMES: { name: string; tier?: 'Tân binh' | 'Đồng' | 'Kim Cương'; fail?: boolean }[] = [
  { name: 'bậc thấp nhất (không huy hiệu)', tier: 'Tân binh' },
  { name: 'bậc Đồng', tier: 'Đồng' },
  { name: 'bậc Kim Cương (tên dài)', tier: 'Kim Cương' },
  { name: 'lỗi 500', fail: true },
];

test.describe('Trình dựng CTV web 375px: hàng huy hiệu bậc không xê dịch', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'chỉ chạy ở project Web Customer (đặt khổ 375px trong test)');
    await setBuilderSession(page);
  });

  for (const persona of PERSONAS) {
    for (const outcome of OUTCOMES) {
      test(`${persona.name}, /affiliate/tiers về chậm rồi ${outcome.name}: CLS do hàng huy hiệu = 0 và khối dưới không nhích`, async ({ page, api }) => {
        let release!: () => void;
        const hold = new Promise<void>((r) => { release = r; });
        mockBuilder(api, { approved: persona.approved });
        const final = CTV_TIERS.allTiers.find((t) => t.name === (outcome.tier ?? 'Tân binh'))!;
        api.get('/affiliate/tiers', async () => {
          await hold;
          return outcome.fail ? reply(500, { statusCode: 500, message: 'Máy chủ lỗi' }) : { ...CTV_TIERS, tier: { name: final.name, emoji: final.emoji } };
        });
        await trackLayoutShift(page);
        await page.goto('/ctv/gian-hang');
        await expect(page.getByRole('heading', { level: 2, name: 'Cửa hàng Xanh' })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('tier-badge-skeleton')).toBeVisible();
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
        const head = page.getByTestId('builder-sections-head');
        const clsBefore = await readCls(page);
        const headBefore = (await head.boundingBox())!.y;
        release();
        await expect(page.getByTestId('tier-badge-skeleton')).toHaveCount(0, { timeout: 15_000 });
        const clsAfter = await readCls(page);
        const headAfter = (await head.boundingBox())!.y;
        expect(clsAfter - clsBefore, `CLS lúc bậc về ${(clsAfter - clsBefore).toFixed(4)}`).toBeLessThanOrEqual(0.0001);
        expect(Math.abs(headAfter - headBefore), `khối bên dưới nhích ${headAfter - headBefore}px`).toBeLessThanOrEqual(1);
        const hintCount = outcome.fail || outcome.tier === 'Tân binh' ? 1 : 0;
        await expect(page.getByTestId('tier-badge-hint')).toHaveCount(hintCount);
      });
    }
  }
});
