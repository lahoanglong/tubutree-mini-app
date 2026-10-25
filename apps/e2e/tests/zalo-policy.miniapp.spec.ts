import { test, expect, makeOrder, makeUser, mockSession, publicConfig, reply } from './support/mock-api';
import type { MockApi } from './support/mock-api';

/**
 * Chính sách kiểm duyệt Zalo: Cộng đồng chỉ đọc (4.6), không điều hướng ra link ngoài (4.1).
 * Ảnh chụp 375 lưu vào SHOT_DIR khi đặt biến môi trường ZALO_SHOTS_DIR.
 */
const SHOT_DIR = process.env.ZALO_SHOTS_DIR;
const NOW = '2026-10-25T03:00:00.000Z';
const DAY = 24 * 3600 * 1000;

const POST = (id: string, author: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'TIP', status: 'APPROVED', title: `Mẹo của ${author}`, body: `Nội dung ${id}`, images: [], meta: null, createdAt: NOW,
  author, avatar: null, badge: null, authorLevel: 1, category: null, productTags: [], tags: [], isPinned: false,
  likeCount: 3, commentCount: 1, liked: false, bestCommentId: null, isOwner: false, ...over,
});

function mockCommunity(api: MockApi) {
  mockSession(api, makeUser({ id: 'u-zalo', fullName: 'Khách Zalo' }));
  api.get('/config/public', publicConfig({
    community: { eventRewardMaxPoints: 100, zaloGroupUrl: 'https://zalo.me/g/abc', facebookUrl: 'https://facebook.com/tubutree', tiktokUrl: 'https://tiktok.com/@tubutree' },
  }));
  api.get('/feed/categories', [{ id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }]);
  api.get('/feed', { posts: [POST('p1', 'Lan Anh', { kind: 'QUESTION', title: 'Rửa bình sữa thế nào?' }), POST('p2', 'Minh Tâm')], nextCursor: null });
  api.get('/feed/p1', POST('p1', 'Lan Anh', { kind: 'QUESTION', title: 'Rửa bình sữa thế nào?', body: 'Mình cần mẹo rửa bình sữa cho bé', commentCount: 1, isOwner: true }));
  api.get('/feed/p1/comments', {
    items: [{ id: 'c1', body: 'Ngâm nước ấm trước rồi chà bằng bàn chải mềm', author: 'Hạnh', avatar: null, badge: null, authorLevel: 1, isAccepted: false, createdAt: NOW, isOwner: false }],
    nextCursor: null,
  });
  api.get('/feed/events', [{ id: 'e1', title: 'Thử thách vườn xanh', description: 'Khoe góc vườn của bạn', coverUrl: null, startAt: new Date(Date.parse(NOW) - DAY).toISOString(), endAt: new Date(Date.parse(NOW) + 5 * DAY).toISOString(), rewardPoints: 5, status: 'ACTIVE', winnerUserId: null, createdAt: NOW }]);
  api.get('/feed/events/e1/posts', { posts: [POST('p1', 'Lan Anh')], nextCursor: null });
}

const shot = async (page: import('@playwright/test').Page, name: string, fullPage = false) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage });
};

test.use({ viewport: { width: 375, height: 812 } });

test.describe('Zalo Mini App - Cộng đồng chỉ đọc, không link ngoài', () => {
  test('feed: không có Đăng bài, Xếp hạng, chip Facebook/TikTok', async ({ page, api }) => {
    mockCommunity(api);
    await page.goto('/feed');
    await expect(page.getByText('Lan Anh').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Sự kiện' })).toBeVisible();
    for (const name of ['Đăng bài', 'Facebook', 'TikTok', 'Nhóm Zalo']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: /Xếp hạng/ })).toHaveCount(0);
    await expect(page.locator('a[href^="http"]')).toHaveCount(0);
    await shot(page, 'feed');
  });

  test('/feed/leaderboard chuyển về /feed', async ({ page, api }) => {
    mockCommunity(api);
    await page.goto('/feed/leaderboard');
    await expect(page).toHaveURL(/\/feed$/);
  });

  test('chi tiết bài: chỉ có danh sách trả lời, không ô trả lời, không thích, không sửa/xoá dù là chủ bài', async ({ page, api }) => {
    mockCommunity(api);
    await page.goto('/feed/p1');
    await expect(page.getByText('Ngâm nước ấm trước rồi chà bằng bàn chải mềm')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder('Viết trả lời…')).toHaveCount(0);
    for (const name of ['Gửi', 'Sửa', 'Xoá', 'Chọn hay nhất', 'Ghim']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Báo cáo' })).toHaveCount(1);
    await shot(page, 'feed-detail');
  });

  test('sự kiện: chỉ đọc, không có nút Đăng bài dự thi', async ({ page, api }) => {
    mockCommunity(api);
    await page.goto('/feed/events');
    await shot(page, 'events-list');
    await page.getByText('Thử thách vườn xanh').click();
    await expect(page.getByText('Bài dự thi')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Đăng bài dự thi' })).toHaveCount(0);
    await shot(page, 'events-detail');
  });

  test('chính sách: popup hiện nội dung từ API, không rời app', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-zalo', fullName: 'Khách Zalo' }));
    api.get('/faqs', []);
    api.get('/config/legal/doi-tra', { loai: 'doi-tra', content: '## 1. Thời hạn\nĐổi trả trong **7 ngày** kể từ khi nhận.\n\n- Sản phẩm còn nguyên tem\n- Có ảnh minh chứng\n\n## 2. Hoàn tiền\nHoàn vào Ví Tubu.', vars: {} });
    api.get('/config/legal/van-chuyen', () => reply(500, { message: 'lỗi' }));
    await page.goto('/about');
    await page.getByRole('button', { name: /Chính sách đổi trả/ }).click();
    await expect(page.getByText('Thời hạn', { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sản phẩm còn nguyên tem')).toBeVisible();
    await expect(page.getByRole('button', { name: /trên web/ })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/about');
    await shot(page, 'policy-sheet-approved');
  });

  test('chính sách chưa duyệt: popup hiện bản nháp đầy đủ kèm biển, link nội bộ mở popup khác', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-zalo', fullName: 'Khách Zalo' }));
    api.get('/faqs', []);
    api.get('/config/legal/doi-tra', { loai: 'doi-tra', content: null, vars: { returnWindowDays: 7, freeshipThreshold: 199000, legalName: 'Công ty TNHH Tubu Tree' } });
    api.get('/config/legal/van-chuyen', { loai: 'van-chuyen', content: null, vars: { returnWindowDays: 7, freeshipThreshold: 199000 } });
    await page.goto('/about');
    await page.getByRole('button', { name: /Chính sách đổi trả/ }).click();
    await expect(page.getByTestId('legal-draft-banner')).toContainText('BẢN NHÁP', { timeout: 15_000 });
    await expect(page.getByText('hư hỏng, đổ vỡ', { exact: false })).toBeVisible();
    await expect(page.getByText('Đơn vị vận hành: Công ty TNHH Tubu Tree')).toBeVisible();
    await shot(page, 'policy-sheet');
    await page.getByTestId('legal-markdown').getByRole('button', { name: 'Chính sách vận chuyển' }).click();
    await expect(page.getByRole('heading', { name: 'Chính sách vận chuyển' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/about');
  });

  test('chi tiết đơn có vận đơn: hãng, mã, hành trình, nút Chép mã; không có nút tra cứu trang hãng', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-zalo', fullName: 'Khách Zalo' }));
    const order = makeOrder({
      code: 'TUBU20261025001',
      status: 'SHIPPING',
      shippingPartner: 'Giao Hàng Nhanh',
      shippingCode: 'GHN123456789',
      shippingStatus: 'Đang vận chuyển tới người nhận',
      trackingLink: 'https://tracking.ghn.vn/?code=GHN123456789',
      shippingHistory: [{ at: '2026-10-25T08:00:00.000Z', status: 'Lấy hàng thành công', carrier: 'Giao Hàng Nhanh', code: 'GHN123456789' }],
    });
    api.get('/orders/:code', order);
    await page.setViewportSize({ width: 375, height: 1500 });
    await page.goto(`/order/${order.code}`);
    await expect(page.getByText('Mã vận đơn: GHN123456789')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Chép mã' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tra cứu hành trình' })).toHaveCount(0);
    await shot(page, 'order-detail-shipping');
  });
});
