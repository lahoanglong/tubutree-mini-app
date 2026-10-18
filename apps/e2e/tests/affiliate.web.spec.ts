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

function mockDashboard(api: MockApi, links: unknown[]) {
  api.get('/affiliate/me', { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
  api.get('/affiliate/dashboard', DASH);
  api.get('/affiliate/links', () => links);
  api.get('/affiliate/commissions', [
    { id: 'c1', orderId: 'o1', orderCode: 'TB1', orderTotal: 500_000, rate: '0.1', amount: 50_000, status: 'APPROVED', createdAt: '2026-10-02T03:00:00Z', orderStatus: 'DELIVERED' },
  ]);
  api.get('/affiliate/payouts', []);
  api.get('/affiliate/tax-statement', { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } });
}

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
    api.get('/affiliate/dashboard', DASH);
    api.get('/affiliate/links', []);
    api.get('/affiliate/commissions', []);
    api.get('/affiliate/payouts', []);
    api.get('/affiliate/tax-statement', { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } });

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
    await expect(page.getByText('0 click · 0 đơn')).toBeVisible();
    const calls = api.callsTo('POST', '/affiliate/links');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ targetType: 'HOMEPAGE' });
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi API CTV', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    await page.goto('/ctv');
    await expect(page.getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('GET', '/affiliate/me')).toHaveLength(0);
  });
});
