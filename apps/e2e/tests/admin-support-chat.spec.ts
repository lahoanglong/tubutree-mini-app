import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  SupportAdminMessage,
  SupportBridgeStatus,
  SupportConversationDetail,
  SupportConversationPage,
  SupportConversationRow,
  SupportZaloGroup,
} from '../../web/src/lib/admin-client';
import { test, expect, type MockApi } from './support/mock-api';

/** Admin — tab "Chat CSKH": trạng thái cầu nối, mở hội thoại, trả lời. Mở thẳng `/admin?tab=supportChat`. */

const SCREENS = resolve(__dirname, '../../../docs/2026-10-23-q5/screens');

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
}

const BRIDGE = {
  state: 'CONNECTED',
  since: '2026-10-23T03:05:00.000Z',
  lastError: null,
  zaloUid: 'z1',
  displayName: 'CSKH Tubu',
  avatar: null,
  checkedAt: '2026-10-23T03:06:00.000Z',
  groupId: 'G1',
  enabled: true,
} satisfies SupportBridgeStatus;
const GROUPS = { groups: [{ id: 'G1', name: 'Nhóm CSKH', memberCount: 5 }] satisfies SupportZaloGroup[] };
const ROW = {
  id: 'c1',
  code: 'K7Q2',
  blocked: false,
  lastMessageAt: '2026-10-23T09:00:00.000Z',
  user: { id: 'u1', fullName: 'Lan', phone: '0901234234' },
  lastMessage: { sender: 'CUSTOMER', body: 'cho mình hỏi đơn', hasImage: false },
  needsAttention: false,
} satisfies SupportConversationRow;
const LIST = { items: [ROW], nextCursor: null } satisfies SupportConversationPage;
const message = (over: Partial<SupportAdminMessage>): SupportAdminMessage => ({
  id: 'm1', sender: 'CUSTOMER', source: 'MINIAPP', body: 'cho mình hỏi đơn', imageUrl: null, context: null, staffName: null,
  adminUserId: null, recalledAt: null, createdAt: '2026-10-23T09:00:00.000Z',
  forward: { id: 'f1', status: 'SENT', lastError: null, attempts: 1, resendable: false },
  ...over,
});
const detailOf = (messages: SupportAdminMessage[]): SupportConversationDetail => ({
  id: 'c1', code: 'K7Q2', blocked: false, blockedAt: null, blockedByUserId: null,
  user: { id: 'u1', fullName: 'Lan', phone: '0901234234' }, truncated: false,
  messages,
});

test.describe('Admin — Chat CSKH', () => {
  test.beforeEach(async ({ page, api }) => {
    mockAdminSession(api);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
    api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
    api.get('/admin/config', []);
    api.get('/admin/support-chat/bridge', BRIDGE);
    api.get('/admin/support-chat/bridge/groups', GROUPS);
    api.get('/admin/support-chat/conversations', LIST);
  });

  test('thấy trạng thái cầu nối, mở hội thoại và trả lời', async ({ page, api }) => {
    // Chi tiết hội thoại có trạng thái: tin vừa trả lời phải nằm trong lần tải lại, như máy chủ thật.
    const thread: SupportAdminMessage[] = [message({})];
    api.get('/admin/support-chat/conversations/c1', () => detailOf([...thread]));
    const replied = api.waitForCall('POST', '/admin/support-chat/conversations/c1/reply');
    api.post('/admin/support-chat/conversations/c1/reply', ({ call }) => {
      const m = message({ id: 'm2', sender: 'STAFF', source: 'ADMIN', adminUserId: 'admin-1', body: (call.body as { body: string }).body, forward: null, createdAt: '2026-10-23T09:05:00.000Z' });
      thread.push(m);
      return m;
    });

    await page.goto('/admin?tab=supportChat');

    const state = page.locator('[data-bridge-state]');
    await expect(state).toHaveAttribute('data-bridge-state', 'CONNECTED', { timeout: 15_000 });
    await expect(state).toContainText('Đang kết nối');
    await expect(page.getByText('CSKH Tubu')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Cho khách chat' })).toBeChecked();

    await page.locator('[data-conv="c1"]').click();
    await expect(page.getByRole('heading', { name: /#K7Q2 · Lan/ })).toBeVisible();
    await expect(page.locator('[data-msg="m1"]')).toContainText('cho mình hỏi đơn');
    await expect(page.locator('[data-msg="m1"] [data-forward="SENT"]')).toContainText('Đã chuyển vào Zalo');

    await page.getByLabel('Trả lời khách (không gửi vào nhóm Zalo)').fill('Dạ đơn mai giao ạ');
    await page.getByRole('button', { name: 'Gửi trả lời' }).click();
    const call = await replied;
    expect(call.body).toEqual({ body: 'Dạ đơn mai giao ạ' });
    await expect(page.locator('[data-msg="m2"]')).toContainText('Dạ đơn mai giao ạ');

    if (process.env.Q5_SCREENS === '1') {
      mkdirSync(SCREENS, { recursive: true });
      await page.screenshot({ path: resolve(SCREENS, 'admin-chat.png'), fullPage: true });
    }
  });
});
