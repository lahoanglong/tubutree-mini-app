import { expect, test, type MockApi } from './support/mock-api';

/**
 * Web khách: Đổi rác lấy quà (/doi-rac, /doi-rac/yeu-cau, /doi-rac/quy-dinh). Mọi lời gọi /api/** đi qua mock (fixture `api`).
 * Khách chưa đủ điều kiện (thiếu SĐT đã xác minh) chỉ thấy lời chỉ sang Zalo, không có lối đổi rác nào trên web.
 */

const USER = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 9000, pointsConvertedBalance: 5000, walletBalance: 0,
};

const ITEM = {
  id: 'item-carton', code: 'CARTON', name: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000,
  dropsPerUnit: 0, dailyCapQty: 10, monthlyCapQty: 20, status: 'ACTIVE', prepInstructions: 'Gấp phẳng, bỏ băng keo',
  imageUrl: null, gramsPerUnit: null, hazardous: false, sortOrder: 1, monthRemainingQty: 20, dayRemainingQty: 10,
};

const summary = (over: Record<string, unknown> = {}) => ({
  id: 'req-1', code: 'TR-8K2M9', method: 'DROP_OFF', status: 'OPEN', closeReason: null,
  createdAt: '2026-10-17T03:00:00.000Z', expiresAt: '2026-10-24T17:30:00.000Z', estimatedPoints: 5000, pointsAwarded: null,
  pointName: 'Đại lý Cô Ba', orderCode: null,
  lines: [{ itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 5 }],
  ...over,
});

const me = (over: Record<string, unknown> = {}) => ({
  programmeEnabled: true, eligibility: 'OK', blocked: false, shipLockedAt: null,
  laneFlags: { dropoff: true, mailin: true, pickup: false },
  parcelLimits: { maxWeightKg: 10, maxEdgeCm: 60 },
  balance: { pointsBalance: 9000, pointsConvertedBalance: 5000, redeemablePoints: 14000 },
  monthUsage: { capMonthKey: '2026-10', pointsUsed: 0, pointsCap: 200000 },
  impactGrams: 1940,
  thresholds: { mailinMinPoints: 15000, pickupMinPoints: 10000, maxOpenRequests: 3 },
  items: [ITEM], openRequests: [summary()], deskPoints: [],
  ...over,
});

const REWARDS = {
  pointsBalance: 9000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: 14000, giftClaimDays: 60, claimPoint: null,
  rewards: [
    { id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', description: null, label: null, pointsCost: 20000, imageUrl: null,
      stockRemaining: null, soldOut: false, canRedeem: false, claimInstructions: null,
      voucher: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 }, sortOrder: 1 },
  ],
};

function mockRecycle(api: MockApi, meBody: Record<string, unknown> = me()) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } });
  api.get('/waste/me', () => meBody);
  api.get('/me/loyalty/rewards', REWARDS);
  api.get('/waste/requests', () => [
    summary(),
    summary({ id: 'req-2', code: 'TR-AAAAA', method: 'MAIL_IN', status: 'IN_TRANSIT' }),
    summary({ id: 'req-3', code: 'TR-BBBBB', status: 'COMPLETED', pointsAwarded: 4000 }),
    summary({ id: 'req-4', code: 'TR-CCCCC', status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }),
  ]);
  api.get('/waste/rules', { text: 'Điểm Xanh là ưu đãi cho khách.\nKhông đổi ra tiền.' });
}

test.describe('Web khách: Đổi rác lấy quà', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('trang vào: số dư, tiến độ tới quà, yêu cầu đang xử lý và lối sang các màn con', async ({ page, api }) => {
    mockRecycle(api);
    await page.goto('/doi-rac');
    await expect(page.getByRole('heading', { name: 'Đổi rác lấy quà', level: 1 })).toBeVisible();
    await expect(page.getByText('14.000 điểm', { exact: true })).toBeVisible();
    await expect(page.getByText('Còn 6.000 điểm tới mã giảm giá Miễn phí vận chuyển')).toBeVisible();
    await expect(page.getByText('Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu')).toBeVisible();
    await expect(page.getByRole('link', { name: /TR-8K2M9/ })).toHaveAttribute('href', '/doi-rac/yeu-cau/req-1');
    await expect(page.getByRole('link', { name: 'Đổi rác ngay' })).toHaveAttribute('href', '/doi-rac/tao');
    await expect(page.getByRole('link', { name: 'Yêu cầu của tôi' })).toHaveAttribute('href', '/doi-rac/yeu-cau');
    await expect(page.getByRole('link', { name: /Thể lệ chương trình/ })).toHaveAttribute('href', '/doi-rac/quy-dinh');
  });

  test('thiếu SĐT đã xác minh: chỉ thấy lời chỉ sang Zalo, không có lối đổi rác', async ({ page, api }) => {
    mockRecycle(api, me({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null }));
    await page.goto('/doi-rac');
    await expect(page.getByText('Tính năng này cần mở Tubu Tree trên Zalo.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đổi rác ngay' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Yêu cầu của tôi' })).toHaveCount(0);
    await expect(page.getByText(/số điện thoại/i)).toHaveCount(0);
  });

  test('danh sách yêu cầu: hai tab, hoàn tất dẫn tới trang kết quả', async ({ page, api }) => {
    mockRecycle(api);
    await page.goto('/doi-rac/yeu-cau');
    await expect(page.getByRole('tab', { name: /Đang xử lý/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('link', { name: /TR-AAAAA/ })).toHaveAttribute('href', '/doi-rac/yeu-cau/req-2');
    await expect(page.getByRole('link', { name: /TR-BBBBB/ })).toHaveCount(0);
    await page.getByRole('tab', { name: /Đã đóng/ }).click();
    await expect(page.getByRole('link', { name: /TR-BBBBB/ })).toHaveAttribute('href', '/doi-rac/xong/req-3');
    await expect(page.getByRole('link', { name: /TR-CCCCC/ })).toContainText('Hết hạn giữ chỗ');
  });

  test('thể lệ: trang công khai, giữ xuống dòng', async ({ page, api }) => {
    mockRecycle(api);
    await page.goto('/doi-rac/quy-dinh');
    await expect(page.getByRole('heading', { name: 'Thể lệ Đổi rác lấy quà', level: 1 })).toBeVisible();
    await expect(page.getByText(/Điểm Xanh là ưu đãi cho khách\./)).toBeVisible();
  });
});
