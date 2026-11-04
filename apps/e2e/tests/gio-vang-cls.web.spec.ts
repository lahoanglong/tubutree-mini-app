import { test, expect } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { FLASH_NOW, SLOT_LIVE, SLOTS, liveItems, mockFlashSlots, nextItems } from './support/flash-slot-mocks';
import { gate } from './support/pdp-cls';

/**
 * Web, /gio-vang: khung chờ cao đúng phần đầu thật (dải tab + dải đồng hồ), nên khi khung giờ rồi danh sách món về trễ, danh sách không nhảy.
 * Ghi CLS khi hai lời gọi về lần lượt (có trễ); mọi lời gọi từ trình duyệt đi qua mock.
 */
const CLS_MAX = 0.02;

for (const vp of [{ name: 'web375', width: 375, height: 812 }, { name: 'web1280', width: 1280, height: 800 }]) {
  test(`CLS /gio-vang ${vp.name}: khung giờ rồi danh sách món về trễ`, async ({ page, api }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await observeCls(page);
    mockFlashSlots(api);
    const slots = gate();
    const items = gate();
    // Đăng ký sau `mockFlashSlots` nên thắng: treo hai lời gọi cho tới khi test cho về.
    api.get('/flash-sales/slots', async () => {
      await slots.wait;
      return { serverNow: FLASH_NOW, slots: SLOTS };
    });
    api.get('/flash-sales/slots/:id/items', async ({ params }) => {
      await items.wait;
      const slot = SLOTS.find((s) => s.id === params.id)!;
      return { serverNow: FLASH_NOW, slot, items: slot.id === SLOT_LIVE.id ? liveItems() : nextItems() };
    });
    await page.goto('/gio-vang');
    await expect(page.getByTestId('flash-slots-loading')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(500);
    slots.release();
    await expect(page.getByTestId('flash-items-loading')).toBeVisible();
    await page.waitForTimeout(500);
    items.release();
    await expect(page.getByRole('button', { name: /^Mua ngay Sản phẩm Giờ vàng/ }).first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const { cls, sources } = await readClsTotal(page);
    test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
    console.log(`CLS gio-vang ${vp.name} = ${cls.toFixed(4)}\n${sources.map((s) => `  shift ${s}`).join('\n')}`);
    expect(cls).toBeLessThan(CLS_MAX);
  });
}
