import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, makeUser, mockSession } from './support/mock-api';
import { CUSTOMER_TEXT, STAFF_REPLY_TEXT, mockSupportChat } from './support/support-chat-mocks';

/** Zalo Mini App — chat với Tubu Tree (apps/miniapp/src/pages/support-chat.tsx, route /chat). */

const SCREENS = resolve(__dirname, '../../../docs/2026-10-23-q5/screens');

test.describe('Chat với Tubu Tree — Mini App', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('gửi tin, lần hỏi sau có tin Tubu Tree hiện bên trái', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-chat' }));
    const state = mockSupportChat(api);
    await page.goto('/chat');

    await expect(page.getByText('Chat với Tubu Tree').first()).toBeVisible({ timeout: 15_000 });
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
    const composerBox = (await page.getByRole('textbox', { name: 'Nội dung tin nhắn' }).boundingBox())!;
    expect(Math.abs(box.x - listBox.x)).toBeLessThanOrEqual(24);
    expect(Math.abs(listBox.x + listBox.width - (myBox.x + myBox.width))).toBeLessThanOrEqual(24);
    expect(box.y + box.height).toBeLessThanOrEqual(composerBox.y);

    if (process.env.Q5_SCREENS === '1') {
      mkdirSync(SCREENS, { recursive: true });
      await page.screenshot({ path: resolve(SCREENS, 'chat-miniapp-390.png'), scale: 'css' });
    }
  });
});
