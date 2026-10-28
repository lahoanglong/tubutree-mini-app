import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type MockApi } from './support/mock-api';

/**
 * Admin web: công cụ cộng đồng (trả lời câu hỏi, sự kiện), lương (thưởng/phạt, tính lại tháng) và tab Chat CSKH ở 375px.
 * Mock toàn bộ API (không cần DB). Đặt E2E_CONGCU_SCREENS=<thư mục> để lưu ảnh chụp.
 */

const SCREENS = process.env.E2E_CONGCU_SCREENS;
async function shot(page: import('@playwright/test').Page, name: string) {
  if (!SCREENS) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: resolve(SCREENS, `${name}.png`), fullPage: true });
}

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
  api.get('/admin/ops/inbox', { generatedAt: '2026-10-28T03:00:00.000Z', items: [] });
}

test.describe('Admin: Chat CSKH ở khổ điện thoại', () => {
  test.beforeEach(async ({ page, api }) => {
    mockAdminSession(api);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
    api.get('/admin/support-chat/bridge', {
      state: 'UNREACHABLE',
      since: '2026-10-23T03:05:00.000Z',
      lastError: null,
      zaloUid: 'z1',
      displayName: 'CSKH Tubu',
      avatar: null,
      checkedAt: '2026-10-23T03:06:00.000Z',
      groupId: 'G1',
      enabled: true,
      deaf: false,
    });
    api.get('/admin/support-chat/bridge/groups', { groups: [{ id: 'G1', name: 'Nhóm CSKH', memberCount: 5 }] });
    api.get('/admin/support-chat/conversations', {
      items: [
        { id: 'c1', code: 'K7Q2', blocked: false, lastMessageAt: '2026-10-23T09:00:00.000Z', user: { id: 'u1', fullName: 'Lan', phone: '0901234234' }, lastMessage: { sender: 'CUSTOMER', body: 'cho mình hỏi đơn', hasImage: false }, needsAttention: false },
      ],
      nextCursor: null,
    });
    api.get('/admin/support-chat/conversations/c1', {
      id: 'c1',
      code: 'K7Q2',
      blocked: false,
      blockedAt: null,
      blockedByUserId: null,
      user: { id: 'u1', fullName: 'Lan', phone: '0901234234' },
      truncated: false,
      messages: [
        { id: 'm1', sender: 'CUSTOMER', source: 'MINIAPP', body: 'cho mình hỏi đơn', imageUrl: null, context: null, staffName: null, adminUserId: null, recalledAt: null, createdAt: '2026-10-23T09:00:00.000Z', forward: null },
      ],
    });
  });

  test('thẻ cầu nối chỉ còn một dòng, bấm hội thoại mở ngăn kéo chứa tin và ô trả lời', async ({ page, api }) => {
    await page.goto('/admin?tab=supportChat');

    const head = page.getByRole('button', { name: /Cầu nối Zalo/ });
    await expect(head).toHaveAttribute('aria-expanded', 'false', { timeout: 20_000 });
    await expect(head).toContainText('Mất kết nối');
    const box = await head.boundingBox();
    expect(box!.height).toBeLessThan(80);
    await expect(page.getByRole('button', { name: 'Đăng nhập Zalo' })).toHaveCount(0);
    await shot(page, 'chat375-list');

    await head.click();
    await expect(page.getByRole('button', { name: 'Đăng nhập Zalo' })).toBeVisible();
    await head.click();

    await page.locator('[data-conv="c1"]').click();
    const drawer = page.getByRole('dialog', { name: 'Hội thoại với khách' });
    await expect(drawer.locator('[data-msg="m1"]')).toContainText('cho mình hỏi đơn');
    await expect(drawer.getByLabel('Trả lời khách (không gửi vào nhóm Zalo)')).toBeVisible();
    await shot(page, 'chat375-drawer');

    const replied = api.waitForCall('POST', '/admin/support-chat/conversations/c1/reply');
    api.post('/admin/support-chat/conversations/c1/reply', () => ({ id: 'm2', sender: 'STAFF', source: 'ADMIN', body: 'Dạ ạ', imageUrl: null, context: null, staffName: null, adminUserId: 'admin-1', recalledAt: null, createdAt: '2026-10-23T09:05:00.000Z', forward: null }));
    await drawer.getByLabel('Trả lời khách (không gửi vào nhóm Zalo)').fill('Dạ ạ');
    await drawer.getByRole('button', { name: 'Gửi trả lời' }).click();
    expect((await replied).body).toEqual({ body: 'Dạ ạ' });

    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noHScroll).toBe(true);
    await drawer.getByRole('button', { name: 'Đóng' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-conv="c1"]')).toBeVisible();
  });
});

test.describe('Admin: cộng đồng', () => {
  test.beforeEach(async ({ page, api }) => {
    mockAdminSession(api);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
    api.get('/config/public', {});
  });

  test('trả lời câu hỏi chưa ai trả lời ngay trong dòng, rồi tạo sự kiện', async ({ page, api }) => {
    let answered = false;
    api.get('/feed/admin/unanswered', () => (answered ? [] : [{ id: 'q1', title: 'Cây khô lá', excerpt: 'Cây để ngoài nắng bị khô.', createdAt: '2026-10-25T03:00:00.000Z', author: 'Bình', category: 'Hỏi đáp', waitingHours: 52 }]));
    api.post('/feed/q1/comments', () => {
      answered = true;
      return { id: 'c1' };
    });
    api.get('/feed/admin/pending', []);
    api.get('/feed/admin/reports', []);
    await page.goto('/admin?tab=community');
    await page.getByRole('button', { name: 'Chưa trả lời' }).click();
    const row = page.locator('[data-post="q1"]');
    await expect(row).toContainText('Cây khô lá', { timeout: 20_000 });
    await expect(row.getByRole('link', { name: 'Mở bài' })).toHaveAttribute('href', '/cong-dong/q1');
    const replied = api.waitForCall('POST', '/feed/:id/comments');
    await row.getByLabel(/Trả lời Bình/).fill('Dạ bạn để chỗ mát nhé.');
    await row.getByRole('button', { name: 'Gửi trả lời' }).click();
    expect((await replied).body).toEqual({ body: 'Dạ bạn để chỗ mát nhé.' });
    await expect(page.locator('[data-post="q1"]')).toHaveCount(0);

    api.get('/feed/admin/events', () => []);
    await page.getByRole('button', { name: 'Sự kiện' }).click();
    await expect(page.getByText('Chưa có sự kiện nào đang mở.')).toBeVisible();
    const created = api.waitForCall('POST', '/feed/events');
    api.post('/feed/events', () => ({ id: 'e9' }));
    await page.locator('[name="eventTitle"]').fill('Thi ảnh rau mầm');
    await page.locator('[name="eventStart"]').fill('2026-11-01T08:00');
    await page.locator('[name="eventEnd"]').fill('2026-11-30T23:59');
    await page.locator('[name="eventReward"]').fill('30000');
    await shot(page, 'events1280');
    await page.getByRole('button', { name: 'Tạo sự kiện' }).last().click();
    expect((await created).body).toEqual({ title: 'Thi ảnh rau mầm', startAt: '2026-11-01T01:00:00.000Z', endAt: '2026-11-30T16:59:00.000Z', rewardPoints: 30_000 });
  });
});

test.describe('Admin: lương', () => {
  test('thưởng/phạt qua hộp xác nhận ở khổ điện thoại, không gọi gì khi chưa xác nhận', async ({ page, api }) => {
    mockAdminSession(api);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
    const now = new Date(Date.now() + 7 * 3600_000);
    const [year, month] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
    api.get('/admin/payroll', [
      {
        staff: { id: 's1', fullName: 'Lan', phone: '0900000001' },
        month: { year, month, totalMinutes: 125, gross: 500_000, totalFines: 0, net: 500_000, status: 'OPEN', paidAt: null, proofImageUrl: null, note: null },
        profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: null, bankAccountName: null, qrImageUrl: null, active: true },
        qrImageUrl: null,
      },
    ]);
    api.post('/admin/payroll/adjust', () => ({ adjusted: true }));
    api.post('/admin/payroll/:id/recompute', () => ({ year, month, totalMinutes: 125, gross: 500_000, totalFines: 0, net: 500_000, status: 'OPEN', paidAt: null, proofImageUrl: null, note: null }));

    await page.goto('/admin?tab=payroll');
    await page.getByRole('button', { name: 'Thưởng/phạt · Lan' }).click({ timeout: 20_000 });
    const sheet = page.getByRole('dialog', { name: /Thưởng\/phạt · Lan/ });
    await sheet.getByRole('button', { name: 'Phạt', exact: true }).click();
    await sheet.getByLabel('Số tiền (VND)').fill('50000');
    await sheet.getByLabel(/Lý do/).fill('Đi trễ ca sáng');
    await shot(page, 'payroll375-adjust');
    await sheet.getByRole('button', { name: 'Xem lại và ghi' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('50.000đ');
    await confirm.getByRole('button', { name: 'Huỷ' }).click();
    expect(api.callsTo('POST', '/admin/payroll/adjust')).toHaveLength(0);

    await sheet.getByRole('button', { name: 'Xem lại và ghi' }).click();
    await confirm.getByRole('button', { name: 'Ghi phạt' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã ghi khoản phạt 50.000đ' })).toBeVisible();
    expect(api.callsTo('POST', '/admin/payroll/adjust')[0]!.body).toMatchObject({ staffId: 's1', amount: 50_000, reason: 'Đi trễ ca sáng' });

    await page.getByRole('button', { name: 'Tính lại tháng · Lan' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Huỷ' }).click();
    expect(api.callsTo('POST', '/admin/payroll/:id/recompute')).toHaveLength(0);
  });
});
