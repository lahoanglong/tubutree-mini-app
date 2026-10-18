import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: Đổi rác lấy quà (/doi-rac, /doi-rac/yeu-cau, /doi-rac/quy-dinh, /doi-rac/tao, /doi-rac/diem-nhan). Mọi lời gọi /api/** đi qua mock (fixture `api`).
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

const detail = (over: Record<string, unknown> = {}) => ({
  ...summary(),
  lines: [{ itemId: 'item-carton', itemName: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0,
    gramsPerUnit: null, declaredQty: 5, receivedQty: null, shortfallReason: null, pointsAwarded: null }],
  point: { id: 'pt-1', kind: 'PARTNER', name: 'Đại lý Cô Ba', addressLine: '12 Lê Lợi', communeName: 'Phường Bến Thành', provinceName: 'TP.HCM',
    phone: '0901234567', openingHours: { MON: [{ open: '08:00', close: '17:00' }] } },
  pointAvailable: true, carrier: null, trackingCode: null, inTransitAt: null, receivedAt: null, completedAt: null, closedAt: null,
  rejectionReason: null, rejectionNote: null, dropsAwarded: null, impactGrams: null, reversedPoints: null, reversalReason: null,
  editable: true, cancellable: true, orderId: null,
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

  test('tạo yêu cầu: chọn món, chọn điểm nhận theo tỉnh, gửi đúng body và Idempotency-Key', async ({ page, api }) => {
    mockRecycle(api, me({ openRequests: [] }));
    const POINT = {
      id: 'pt-1', kind: 'PARTNER', name: 'Đại lý Cô Ba', addressLine: '12 Lê Lợi', provinceCode: '79', provinceName: 'TP.HCM',
      communeCode: '26734', communeName: 'Phường Bến Thành', lat: 10.77, lng: 106.7, phone: '0901234567',
      openingHours: { MON: [{ open: '08:00', close: '18:00' }] }, acceptedItemIds: ['item-carton'], perkText: null, quotaFull: false, distanceKm: null,
    };
    api.get('/waste/points', () => [POINT]);
    api.get('/geo/provinces', () => [{ code: '79', name: 'TP.HCM' }]);
    api.post('/waste/preview', () => ({
      estimatedPoints: 3000, estimatedDrops: 0, estimatedGrams: null, pointsValueVnd: 3000, blocks: [], feeEstimate: null,
      itemCaps: [], pointsMonthRemaining: 190000,
    }));
    api.post('/waste/requests', () => summary({ id: 'req-new', code: 'TR-NEW01', lines: [] }));

    await page.goto('/doi-rac/tao');
    await expect(page.getByRole('heading', { name: 'Đổi rác', level: 1 })).toBeVisible();
    await expect(page.getByText('Bước 1/3: Chọn món')).toBeVisible();
    const next = page.getByRole('button', { name: 'Tiếp tục' });
    await expect(next).toBeDisabled();
    const plus = page.getByRole('button', { name: 'Tăng số lượng' });
    await plus.click();
    await plus.click();
    await plus.click();
    await expect(page.getByText('Ước tính 3.000 điểm')).toBeVisible();
    await next.click();

    await expect(page.getByText('Bước 2/3: Chọn cách giao')).toBeVisible();
    await page.getByRole('radio', { name: /Mang tới điểm nhận/ }).click();
    await page.getByRole('button', { name: 'Chọn điểm nhận' }).click();

    await expect(page.getByRole('heading', { name: 'Điểm nhận gần bạn', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dùng vị trí của tôi' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Gần tôi' })).toHaveCount(0);
    await page.getByRole('radio', { name: /Đại lý Cô Ba/ }).click();
    await page.getByRole('button', { name: 'Chọn điểm này' }).click();

    await expect(page.getByText('Bước 2/3: Chọn cách giao')).toBeVisible();
    await expect(page.getByText('Đại lý Cô Ba', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Tôi đồng ý cho Tubu Tree xử lý yêu cầu này' }).check();
    const created = api.waitForCall('POST', '/waste/requests');
    await page.getByRole('button', { name: 'Tạo yêu cầu' }).click();
    const call = await created;
    expect(call.body).toEqual({ method: 'DROP_OFF', lines: [{ itemId: 'item-carton', declaredQty: 3 }], pointId: 'pt-1', consent: true });
    expect(call.headers['idempotency-key']).toMatch(/\S+/);
  });

  test('thiếu SĐT đã xác minh: /doi-rac/tao và /doi-rac/diem-nhan chỉ thấy lời chỉ sang Zalo', async ({ page, api }) => {
    mockRecycle(api, me({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null, openRequests: [] }));
    await page.goto('/doi-rac/tao');
    await expect(page.getByText('Tính năng này cần mở Tubu Tree trên Zalo.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toHaveCount(0);
    await expect(page.getByText(/số điện thoại/i)).toHaveCount(0);
  });

  test('chi tiết yêu cầu mang tới điểm: timeline, mã QR trong sheet, huỷ có hỏi lại', async ({ page, api }) => {
    mockRecycle(api);
    api.get('/waste/requests/:id', () => detail());
    api.get('/waste/points', () => []);
    api.post('/waste/requests/:id/cancel', () => detail({ status: 'CANCELLED', cancellable: false, editable: false }));
    await page.goto('/doi-rac/yeu-cau/req-1');
    await expect(page.getByRole('heading', { name: 'TR-8K2M9', level: 1 })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tiến độ yêu cầu' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sửa món' })).toHaveAttribute('href', '/doi-rac/yeu-cau/req-1/sua');
    await page.getByRole('button', { name: 'Xem mã QR' }).click();
    const qr = page.getByRole('dialog', { name: 'Mã đổi rác' });
    await expect(qr.getByText('Giữ chỗ tới 25/10/2026')).toBeVisible();
    await qr.getByRole('button', { name: 'Theo dõi yêu cầu' }).click();
    await page.getByRole('button', { name: 'Huỷ yêu cầu' }).click();
    const cancelled = api.waitForCall('POST', '/waste/requests/:id/cancel');
    await page.getByRole('dialog', { name: 'Huỷ yêu cầu này?' }).getByRole('button', { name: 'Xác nhận huỷ' }).click();
    await cancelled;
    await expect(page.getByText('Đã huỷ yêu cầu')).toBeVisible();
  });

  test('chi tiết yêu cầu gửi về kho: nhập hãng và mã vận đơn gửi PUT tracking', async ({ page, api }) => {
    mockRecycle(api);
    api.get('/waste/requests/:id', () => detail({ method: 'MAIL_IN', pointName: 'Kho Tubu TP.HCM', point: { ...detail().point, name: 'Kho Tubu TP.HCM', kind: 'WAREHOUSE' } }));
    api.on('PUT', '/waste/requests/:id/tracking', () => detail({ method: 'MAIL_IN', status: 'IN_TRANSIT', carrier: 'GHN', trackingCode: 'GHN123' }));
    await page.goto('/doi-rac/yeu-cau/req-1');
    await expect(page.getByText('Ghi mã này lên kiện, mỗi kiện một yêu cầu')).toBeVisible();
    const sent = page.getByRole('button', { name: 'Đã gửi' });
    await expect(sent).toBeDisabled();
    await page.getByLabel('Hãng').fill('GHN');
    await page.getByLabel('Mã vận đơn').fill('GHN123');
    const put = api.waitForCall('PUT', '/waste/requests/:id/tracking');
    await sent.click();
    expect((await put).body).toEqual({ carrier: 'GHN', trackingCode: 'GHN123' });
  });

  test('chi tiết yêu cầu không có: thấy trạng thái rỗng dẫn về Yêu cầu của tôi', async ({ page, api }) => {
    mockRecycle(api);
    api.get('/waste/requests/:id', () => reply(404, { message: 'Not found' }));
    await page.goto('/doi-rac/yeu-cau/req-x');
    await expect(page.getByText('Không tìm thấy yêu cầu')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xem yêu cầu của tôi' })).toHaveAttribute('href', '/doi-rac/yeu-cau');
  });

  test('sửa yêu cầu: đổi số lượng, thấy ước tính mới, PATCH đúng body rồi về trang yêu cầu', async ({ page, api }) => {
    mockRecycle(api);
    api.get('/waste/requests/:id', () => detail());
    api.post('/waste/preview', () => ({
      estimatedPoints: 4000, estimatedDrops: 0, estimatedGrams: null, pointsValueVnd: 4000, blocks: [], feeEstimate: null,
      itemCaps: [], pointsMonthRemaining: 190000,
    }));
    api.patch('/waste/requests/:id', () => detail());
    await page.goto('/doi-rac/yeu-cau/req-1/sua');
    await expect(page.getByRole('heading', { name: 'Sửa yêu cầu', level: 1 })).toBeVisible();
    await expect(page.getByText('Hạn giữ chỗ không đổi: 25/10/2026').first()).toBeVisible();
    await page.getByRole('button', { name: 'Giảm số lượng' }).click();
    await expect(page.getByText('Ước tính mới 4.000 điểm').first()).toBeVisible();
    const patched = api.waitForCall('PATCH', '/waste/requests/:id');
    await page.getByRole('button', { name: 'Lưu thay đổi' }).first().click();
    expect((await patched).body).toEqual({ lines: [{ itemId: 'item-carton', declaredQty: 4 }], pointId: 'pt-1' });
    await expect(page).toHaveURL(/\/doi-rac\/yeu-cau\/req-1$/);
  });
});
