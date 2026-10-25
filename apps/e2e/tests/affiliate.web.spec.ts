import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: CTV (/ctv). Mọi lời gọi /api/** đi qua mock (fixture `api`).
 * Đăng ký phải gửi đúng POST /affiliate/register {termsVersion} một lần; tạo link gửi {targetType: HOMEPAGE}.
 */

const USER = { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0 };
const DASH = {
  todayCommission: 5_000, monthCommission: 125_000, pendingCommission: 30_000, withdrawableCommission: 80_000, withdrawingCommission: 0,
  totalClicks: 4, totalConversions: 1, monthRevenue: 0,
  tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
};

function mockSession(api: MockApi) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, affiliateMinWithdrawBank: 50000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
}

const EMPTY_TAX = { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } };

function mockExtras(api: MockApi, milestones: unknown = null) {
  api.get('/affiliate/tiers', { revenue: 0, tier: DASH.tier, allTiers: [{ name: 'Hạt Giống', emoji: '🌱', min: 0, milestoneRewardPoints: null }] });
  api.get('/affiliate/milestones', milestones ?? { monthKey: '2026-10', currentRevenue: 0, pendingRevenue: 0, holdDays: 20, milestones: [], previousMonth: null });
  api.get('/affiliate/analytics/storefronts', { storefronts: [] });
  api.get('/affiliate/analytics/products', []);
  api.get('/academy/courses', []);
}

function mockDashboard(api: MockApi, links: unknown[], me: Record<string, unknown> = {}) {
  api.get('/affiliate/me', { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0, ...me });
  mockExtras(api);
  api.get('/affiliate/dashboard', DASH);
  api.get('/affiliate/links', () => links);
  api.get('/affiliate/commissions', [
    { id: 'c1', orderId: 'o1', orderCode: 'TB1', orderTotal: 500_000, rate: '0.1', amount: 50_000, status: 'APPROVED', createdAt: '2026-10-02T03:00:00Z', orderStatus: 'DELIVERED' },
  ]);
  api.get('/affiliate/payouts', []);
  api.get('/affiliate/tax-statement', { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } });
}

const EMPTY_STATS = { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] };
const SF = (over: Record<string, unknown> = {}) => ({
  id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: null, avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
  subdomain: null, isPublished: false, referralCode: 'AN123', subdomainEnabled: false, publicHiddenReason: null,
  collections: [{ id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [] }],
  ...over,
});

test.describe('Web khách: CTV', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('chưa là CTV: phải tick điều khoản mới đăng ký được, gửi đúng một POST kèm termsVersion dù bấm đúp', async ({ page, api }) => {
    mockSession(api);
    const state = { registered: false };
    api.get('/affiliate/me', () => ({ isAffiliate: state.registered, referralCode: 'TUBU88', walletBalance: 0 }));
    api.post('/affiliate/register', () => {
      state.registered = true;
      return { ok: true, referralCode: 'TUBU88' };
    });
    mockExtras(api);
    api.get('/affiliate/dashboard', DASH);
    api.get('/affiliate/links', []);
    api.get('/affiliate/commissions', []);
    api.get('/affiliate/payouts', []);
    api.get('/affiliate/tax-statement', EMPTY_TAX);

    await page.goto('/ctv');
    const register = page.getByRole('button', { name: 'Đăng ký miễn phí ngay' });
    await expect(register).toBeDisabled();
    await page.getByRole('checkbox', { name: /đồng ý với điều khoản hoa hồng/ }).check();
    await register.dblclick();
    await expect(page.getByText('Hoa hồng tháng này')).toBeVisible();
    const calls = api.callsTo('POST', '/affiliate/register');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ termsVersion: '2026-10' });
  });

  test('đại lý không đăng ký CTV được: không có form đăng ký', async ({ page, api }) => {
    mockSession(api);
    api.get('/affiliate/me', { isAffiliate: false, canRegister: false, referralCode: '', walletBalance: 0 });
    await page.goto('/ctv');
    await expect(page.getByText('Tài khoản này không đăng ký CTV được')).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(api.callsTo('POST', '/affiliate/register')).toHaveLength(0);
  });

  test('bảng điều khiển: số liệu, hoa hồng với nhãn trạng thái, tạo link HOMEPAGE một lần dù bấm đúp', async ({ page, api }) => {
    mockSession(api);
    const links: unknown[] = [];
    mockDashboard(api, links);
    api.post('/affiliate/links', () => {
      links.push({ id: 'l1', shortCode: 'abc123', targetType: 'HOMEPAGE', targetId: null, clicks: 0, conversions: 0, revenue: 0, createdAt: '2026-10-19T00:00:00Z' });
      return links[0];
    });
    await page.goto('/ctv');
    await expect(page.getByRole('heading', { name: 'Cộng tác viên', level: 1 })).toBeVisible();
    await expect(page.getByText('125.000đ')).toBeVisible();
    await expect(page.getByText('+50.000đ')).toBeVisible();
    await expect(page.getByText('Giao thành công')).toBeVisible();
    await expect(page.getByText('Chưa có link')).toBeVisible();
    await page.getByRole('button', { name: '+ Tạo link' }).dblclick();
    await expect(page.getByText('0 lượt bấm', { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ đơn/)).toHaveCount(0);
    const calls = api.callsTo('POST', '/affiliate/links');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ targetType: 'HOMEPAGE' });
  });

  test('rút về Ví Tubu: gửi đúng một POST /affiliate/payouts kèm Idempotency-Key dù bấm đúp, rồi đóng sheet và báo đã gửi', async ({ page, api }) => {
    mockSession(api);
    mockDashboard(api, []);
    api.post('/affiliate/payouts', () => ({ ok: true, method: 'WALLET_BALANCE', credited: 80_000, payoutId: 'p1' }));
    await page.goto('/ctv');
    await page.getByRole('button', { name: 'Rút tiền hoa hồng' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rút hoa hồng' });
    await expect(dialog.getByText('80.000đ').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Nhận 80.000đ vào Ví' }).dblclick();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Đã gửi yêu cầu rút.')).toBeVisible();
    const calls = api.callsTo('POST', '/affiliate/payouts');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ amount: 80_000, method: 'WALLET_BALANCE' });
    expect(calls[0]!.headers['idempotency-key']).toBeTruthy();
  });

  test('rút về ngân hàng có khấu trừ thuế TNCN: hỏi MST, chặn tới khi đúng mẫu, gửi kèm bankInfo và taxId', async ({ page, api }) => {
    mockSession(api);
    api.get('/config/public', { freeshipThreshold: 500000, affiliateMinWithdrawBank: 50000, affiliatePitWithhold: { pct: 0.1, threshold: 50000 }, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
    mockDashboard(api, []);
    api.post('/affiliate/payouts', () => ({ ok: true, method: 'BANK', payoutId: 'p2', status: 'REQUESTED' }));
    await page.goto('/ctv');
    await page.getByRole('button', { name: 'Rút tiền hoa hồng' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rút hoa hồng' });
    await dialog.getByRole('button', { name: /Ngân hàng/ }).click();
    await expect(dialog.getByText('Khấu trừ thuế TNCN 8.000đ · thực nhận 72.000đ')).toBeVisible();
    await dialog.getByLabel('Tên ngân hàng').fill('Vietcombank');
    await dialog.getByLabel('Số tài khoản').fill('0123456789');
    await dialog.getByLabel('Chủ tài khoản').fill('NGUYEN VAN AN');
    const send = dialog.getByRole('button', { name: 'Rút 80.000đ' });
    await expect(send).toBeDisabled();
    await dialog.getByLabel('Mã số thuế cá nhân hoặc số CCCD').fill('123');
    await expect(dialog.getByText('Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số.')).toBeVisible();
    await expect(send).toBeDisabled();
    await dialog.getByLabel('Mã số thuế cá nhân hoặc số CCCD').fill('0123456789');
    await send.click();
    await expect(page.getByText('Đã gửi lệnh rút. Theo dõi trạng thái ở mục Lệnh rút.')).toBeVisible();
    const calls = api.callsTo('POST', '/affiliate/payouts');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      amount: 80_000,
      method: 'BANK',
      bankInfo: { bankName: 'Vietcombank', accountNumber: '0123456789', accountName: 'NGUYEN VAN AN' },
      taxId: '0123456789',
    });
  });

  test('thưởng mốc: nhận một mốc gọi POST claim kèm tháng và hiện lời của máy chủ', async ({ page, api }) => {
    mockSession(api);
    mockDashboard(api, []);
    mockExtras(api, {
      monthKey: '2026-10', currentRevenue: 4_000_000, pendingRevenue: 0, holdDays: 20, previousMonth: null,
      milestones: [{ id: 'M1', title: 'Mốc 3 triệu', threshold: 3_000_000, rewardPoints: 100, description: '', achieved: true, claimed: false, canClaim: true, progressPct: 100 }],
    });
    api.post('/affiliate/milestones/M1/claim', { success: true, message: 'Đã cộng 100 điểm', rewardPoints: 100, monthKey: '2026-10' });
    await page.goto('/ctv');
    await page.getByRole('button', { name: 'Nhận thưởng' }).click();
    await expect(page.getByText('Đã cộng 100 điểm')).toBeVisible();
    expect(api.callsTo('POST', '/affiliate/milestones/M1/claim')[0]!.body).toEqual({ month: '2026-10' });
  });

  test('lên đơn hộ khách: báo giá rồi tạo đơn với expectedTotal, Idempotency-Key và đúng body Mini App', async ({ page, api }) => {
    mockSession(api);
    mockDashboard(api, []);
    api.get('/geo/provinces', [{ code: '84_VN01', name: 'Hà Nội' }]);
    api.get('/geo/communes', [{ code: '84_VN0101', name: 'Phường Ba Đình' }]);
    api.get('/search/suggest', [{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]);
    api.get('/products/nrc', { id: 'p1', slug: 'nrc', name: 'Nước rửa chén', variations: [{ id: 'var1', sku: 'S', name: 'Chanh', attributes: {}, retailPrice: 65_000, salePrice: null, stock: 10 }] });
    api.post('/affiliate/orders/quote', { items: [{ variationId: 'var1', unitPrice: 65_000, quantity: 1, total: 65_000, isFlash: false, flashLimitNotice: null }], goods: 65_000, shippingFee: 19_000, total: 84_000, blockedPaymentMethods: {} });
    api.post('/affiliate/orders', { id: 'o9', code: 'TUBU9', total: 84_000, status: 'PENDING', items: [] });
    await page.goto('/ctv');
    await page.getByRole('button', { name: 'Lên đơn hộ khách' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lên đơn hộ khách' });
    await dialog.getByLabel('Tên người nhận').fill('Lê Cúc');
    await dialog.getByLabel('Số điện thoại').fill('0933 444 555');
    await dialog.getByLabel('Tỉnh/thành').selectOption('84_VN01');
    await dialog.getByLabel('Phường/xã').selectOption('84_VN0101');
    await dialog.getByLabel('Địa chỉ (số nhà, đường)').fill('9 Trần Phú');
    await dialog.getByPlaceholder('Tìm sản phẩm để thêm…').fill('nước');
    await dialog.getByRole('button', { name: /Nước rửa chén/ }).click();
    await dialog.getByRole('button', { name: /^Chanh/ }).click();
    await expect(dialog.getByTestId('ctv-order-total')).toHaveText('84.000đ');
    await dialog.getByRole('button', { name: 'Tạo đơn hộ khách' }).click();
    await expect(page.getByText('Đã tạo đơn hộ khách')).toBeVisible();
    await expect(page.getByText('TUBU9')).toBeVisible();
    const calls = api.callsTo('POST', '/affiliate/orders');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['idempotency-key']).toBeTruthy();
    expect(calls[0]!.body).toEqual({
      items: [{ variationId: 'var1', quantity: 1 }],
      customer: {
        recipient: 'Lê Cúc', phone: '0933444555', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình', street: '9 Trần Phú',
        provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN0101',
      },
      paymentMethod: 'COD',
      expectedTotal: 84_000,
    });
  });

  test('đăng ký gian hàng 4 bước: điều kiện, thông tin, chọn mẫu, gửi duyệt', async ({ page, api }) => {
    mockSession(api);
    const state = { created: false, templated: false, submitted: false };
    const draft = () =>
      SF({
        status: state.submitted ? 'PENDING_APPROVAL' : 'DRAFT',
        isPublished: state.submitted,
        collections: state.templated
          ? [{ id: 'c1', title: 'Chăm sóc da', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [{ id: 'i1', productId: 'p1', note: null, isPinned: false, isHidden: false, sortOrder: 0, product: { id: 'p1', name: 'Kem dưỡng', slug: 'kem', brand: 'Tubu', basePrice: 120_000, salePrice: null } }] }]
          : [],
      });
    api.get('/affiliate/me', { isAffiliate: true, canRegister: true, canOpenStorefront: true, referralCode: 'AN123', walletBalance: 0 });
    api.get('/storefront/me', () => (state.created ? draft() : reply(404, { message: 'Chưa có gian hàng' })));
    api.get('/categories', [{ id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null }]);
    api.get('/storefront/me/products', []);
    api.get('/storefront/me/stats', EMPTY_STATS);
    api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
    api.get('/me/wishlist/ids', []);
    api.get('/flash-sales/active', []);
    api.post('/storefront', () => {
      state.created = true;
      return draft();
    });
    api.patch('/storefront/me', () => draft());
    api.post('/storefront/me/apply-template', () => {
      state.templated = true;
      return { collectionId: 'c1', title: 'Chăm sóc da', itemCount: 8 };
    });
    api.post('/storefront/me/publish', () => {
      state.submitted = true;
      return draft();
    });
    await page.goto('/ctv/gian-hang');
    await expect(page.getByText('Bước 1/4')).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu mở gian hàng' }).click();
    await expect(page.getByText('Bước 2/4')).toBeVisible();
    await page.getByLabel('Tên gian hàng').fill('Shop của An');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByText('Bước 3/4')).toBeVisible();
    await page.getByRole('button', { name: 'Chọn danh mục' }).click();
    await page.getByRole('button', { name: 'Dùng mẫu Chăm sóc da' }).click();
    await expect(page.getByText('Đã chọn 1 sản phẩm')).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByText('Bước 4/4')).toBeVisible();
    await expect(page.getByTestId('storefront-preview')).toBeVisible();
    await page.getByRole('button', { name: 'Gửi duyệt' }).click();
    await expect(page.getByText('Chờ duyệt').first()).toBeVisible();
    await expect(page.getByText('Đang hiển thị')).toHaveCount(0);
    expect(api.callsTo('POST', '/storefront')).toHaveLength(1);
    expect(api.callsTo('PATCH', '/storefront/me')[0]!.body).toMatchObject({ title: 'Shop của An' });
    expect(api.callsTo('POST', '/storefront/me/apply-template')[0]!.body).toEqual({ categoryId: 'cat1' });
    expect(api.callsTo('POST', '/storefront/me/publish')[0]!.body).toEqual({ isPublished: true });
  });

  test('khách thường chưa là CTV: thấy lối Đăng ký làm Cộng tác viên, không tạo được gian hàng', async ({ page, api }) => {
    mockSession(api);
    api.get('/affiliate/me', { isAffiliate: false, canRegister: true, canOpenStorefront: false, walletBalance: 0 });
    api.get('/storefront/me', () => reply(404, { message: 'Chưa có gian hàng' }));
    await page.goto('/ctv/gian-hang');
    await expect(page.getByText('Bạn cần là Cộng tác viên trước khi mở gian hàng.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đăng ký làm Cộng tác viên' })).toHaveAttribute('href', '/ctv');
    await expect(page.getByRole('button', { name: 'Bắt đầu mở gian hàng' })).toHaveCount(0);
    expect(api.callsTo('POST', '/storefront')).toHaveLength(0);
  });

  test('gian hàng: tạo bộ sưu tập (chỉ tên), thêm sản phẩm, đăng — đúng body như Mini App', async ({ page, api }) => {
    mockSession(api);
    let added = false;
    api.get('/storefront/me', () =>
      SF({ collections: [{ id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: added ? [{ id: 'i2', productId: 'p2' }] : [] }] }),
    );
    api.get('/storefront/me/products', [{ id: 'p2', name: 'Xà phòng', slug: 'xa-phong', thumbnail: null, brand: 'Tubu', basePrice: 50_000, salePrice: null, ratingAvg: 5, reviewCount: 1, maxAffiliateRate: 12 }]);
    api.get('/storefront/me/stats', EMPTY_STATS);
    api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
    api.post('/storefront/me/collections', { id: 'c2', title: 'Combo Tết', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 1, items: [] });
    api.post('/storefront/me/collections/:id/items', () => {
      added = true;
      return { id: 'i2', productId: 'p2' };
    });
    api.post('/storefront/me/publish', SF({ isPublished: true }));
    await page.goto('/ctv/gian-hang');
    await page.getByLabel('Tên bộ sưu tập').fill('Combo Tết');
    await expect(page.getByLabel('Loại bộ sưu tập')).toHaveCount(0);
    await expect(page.getByLabel('Giảm giá combo (%)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tạo bộ sưu tập' }).click();
    await expect.poll(() => api.callsTo('POST', '/storefront/me/collections')).toHaveLength(1);
    expect(api.callsTo('POST', '/storefront/me/collections')[0]!.body).toEqual({ title: 'Combo Tết' });
    await page.getByRole('button', { name: 'Thêm sản phẩm' }).first().click();
    await page.getByRole('button', { name: 'Thêm Xà phòng' }).click();
    await expect.poll(() => api.callsTo('POST', '/storefront/me/collections/:id/items')).toHaveLength(1);
    expect(api.callsTo('POST', '/storefront/me/collections/:id/items')[0]!.body).toEqual({ productId: 'p2' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Gửi duyệt' }).click();
    await expect.poll(() => api.callsTo('POST', '/storefront/me/publish')).toHaveLength(1);
    expect(api.callsTo('POST', '/storefront/me/publish')[0]!.body).toEqual({ isPublished: true });
  });

  test('gian hàng: gian hàng tự giao lưu SĐT kho cùng màu chủ đề mặc định', async ({ page, api }) => {
    mockSession(api);
    api.get('/storefront/me', SF({ type: 'MERCHANT', warehousePhone: '0912345678', isPublished: true }));
    api.get('/storefront/me/products', []);
    api.get('/storefront/me/stats', EMPTY_STATS);
    api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
    api.patch('/storefront/me', SF());
    await page.goto('/ctv/gian-hang');
    await page.getByRole('button', { name: 'Cài đặt' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cấu hình gian hàng' });
    await dialog.getByLabel('Hotline kho liên hệ').fill('0988111222');
    await dialog.getByRole('button', { name: 'Lưu cấu hình gian hàng' }).click();
    await expect.poll(() => api.callsTo('PATCH', '/storefront/me')).toHaveLength(1);
    expect(api.callsTo('PATCH', '/storefront/me')[0]!.body).toMatchObject({ warehousePhone: '0988111222', themeColor: '#16a34a' });
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi API CTV', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    await page.goto('/ctv');
    await expect(page.getByRole('main').getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('GET', '/affiliate/me')).toHaveLength(0);
  });
});
