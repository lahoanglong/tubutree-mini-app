import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './support/mock-api';
import { CUSTOMER_TEXT, STAFF_REPLY_TEXT, mockSupportChat } from './support/support-chat-mocks';

/** Web khách — chat với Tubu Tree (/ho-tro/chat). Ở khổ 390 px phải giống Mini App: cùng thứ tự, cùng chữ. */

const SCREENS = resolve(__dirname, '../../../docs/2026-10-23-q5/screens');
const USER = {
  id: 'u-chat', fullName: 'Khách E2E', referralCode: 'E2EREF', phone: '0901234567', role: 'CUSTOMER',
  pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0,
};

test.describe('Chat với Tubu Tree — web', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page, api }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
    api.get('/me', () => USER);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 });
  });

  test('gửi tin, lần hỏi sau có tin Tubu Tree hiện bên trái', async ({ page, api }, testInfo) => {
    const state = mockSupportChat(api);
    await page.goto('/ho-tro/chat');

    await expect(page.getByRole('heading', { name: 'Chat với Tubu Tree' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Chào bạn, Tubu Tree có thể giúp gì cho bạn?')).toBeVisible();

    await page.getByRole('textbox', { name: 'Nội dung tin nhắn' }).fill(CUSTOMER_TEXT);
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();

    const mine = page.locator('[data-sender="CUSTOMER"]');
    await expect(mine).toContainText(CUSTOMER_TEXT);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ body: CUSTOMER_TEXT });
    expect(state.sent[0]?.clientMsgId).toBeTruthy();

    const reply = page.locator('[data-sender="STAFF"]').filter({ hasText: STAFF_REPLY_TEXT });
    await expect(reply).toHaveCount(0);
    await expect(reply).toBeVisible({ timeout: 20_000 });
    await expect(reply).toContainText('Tubu Tree');

    const box = (await reply.locator('div').filter({ hasText: STAFF_REPLY_TEXT }).last().boundingBox())!;
    const myBox = (await mine.locator('div').filter({ hasText: CUSTOMER_TEXT }).last().boundingBox())!;
    expect(box.x).toBeLessThan(myBox.x);

    const listBox = (await mine.locator('xpath=..').boundingBox())!;
    // Thanh nhập là khối ngoài có viền trên (gồm cả padding), không phải riêng ô textarea.
    const composerBox = (await page.getByRole('textbox', { name: 'Nội dung tin nhắn' }).locator('xpath=ancestor::div[contains(@style,"border-top")][1]').boundingBox())!;
    expect(Math.abs(box.x - listBox.x)).toBeLessThanOrEqual(24);
    expect(Math.abs(listBox.x + listBox.width - (myBox.x + myBox.width))).toBeLessThanOrEqual(24);
    expect(box.y + box.height).toBeLessThanOrEqual(composerBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Cả hai project web chạy spec này ở 390 px; chỉ một project ghi ảnh để hai lượt không ghi đè nhau.
    if (process.env.Q5_SCREENS === '1' && testInfo.project.name === 'Web Customer Mobile') {
      mkdirSync(SCREENS, { recursive: true });
      await page.screenshot({ path: resolve(SCREENS, 'chat-web-390.png'), scale: 'css' });
    }
  });
});
