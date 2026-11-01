import { expect, test, type MockApi } from './support/mock-api';
import type { Page } from '@playwright/test';

/**
 * Web khổ điện thoại 375px: các màn CTV, gian hàng, nhãn hàng, đại lý không tràn ngang (document không rộng hơn khung nhìn,
 * không phần tử nào lòi qua mép phải). Mọi lời gọi /api/** đi qua mock (fixture `api`).
 */

const USER = { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0 };
const PRODUCT = { id: 'p1', name: 'Nước rửa chén hương chanh sả dung tích lớn', slug: 'nrc', brand: 'Tubu', basePrice: 120_000, salePrice: 99_000, thumbnail: null };
const DASH = {
  todayCommission: 5_000, monthCommission: 125_000, pendingCommission: 30_000, withdrawableCommission: 80_000, withdrawingCommission: 0,
  totalClicks: 4, totalConversions: 1, monthRevenue: 0,
  tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
};
const OWNER_BRAND = {
  id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: null, story: null, origin: null,
  isVerified: true, isPublished: true, followerCount: 12,
  promotions: [{ id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: null, couponCode: 'TUBU20', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true }],
};

function mockSession(api: MockApi, role = 'CUSTOMER') {
  const user = { ...USER, role };
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user }));
  api.get('/me', () => user);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
}

/**
 * Chiều rộng nội dung vượt khung nhìn, và các phần tử lòi qua mép phải (để báo lỗi chỉ đúng chỗ). Dải cuộn ngang có chủ đích
 * (thanh chọn kỳ) không tính: phần tử nằm trong đó được phép vượt mép.
 */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inScroller = (el: HTMLElement) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    };
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('[aria-hidden="true"]') && !inScroller(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, offenders };
  });
}

test.describe('Web 375px: CTV, gian hàng, nhãn hàng, đại lý không tràn ngang', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project điện thoại');
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  async function expectFits(page: Page, name: string, testInfo: { outputPath: (n: string) => string }) {
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    const o = await overflow(page);
    expect(o.scrollWidth, `${name}: ${o.offenders.join(' | ')}`).toBeLessThanOrEqual(o.clientWidth);
    expect(o.offenders, name).toEqual([]);
  }

  test('/chu-thuong-hieu: hồ sơ và khuyến mãi, doanh thu', async ({ page, api }, testInfo) => {
    mockSession(api);
    api.get('/brand/owner/me', OWNER_BRAND);
    api.get('/brand/owner/me/sales', {
      period: '30d', from: '2026-09-10T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z',
      orderCount: 12, unitsSold: 31, revenue: 4_560_000, delivered: { orderCount: 9, revenue: 3_200_000 },
      topProducts: [{ productId: 'p1', name: 'Nước rửa chén Sachi dung tích lớn hương chanh sả', slug: 'nrc', quantity: 20, revenue: 3_000_000 }],
    });
    await page.goto('/chu-thuong-hieu');
    await expect(page.getByText('Sachi', { exact: true })).toBeVisible();
    await expectFits(page, 'chu-thuong-hieu-ho-so', testInfo);
    await page.goto('/chu-thuong-hieu?tab=sales');
    await expect(page.getByText('4.560.000đ')).toBeVisible();
    await expectFits(page, 'chu-thuong-hieu-doanh-thu', testInfo);
  });

  test('/dai-ly: đăng ký (có ô CCCD) và bảng giá', async ({ page, api }, testInfo) => {
    mockSession(api, 'DEALER');
    api.get('/dealer/me', { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 });
    await page.goto('/dai-ly');
    await expect(page.getByRole('heading', { name: /đại lý/i, level: 1 })).toBeVisible();
    await expectFits(page, 'dai-ly-dang-ky', testInfo);
  });

  test('/ctv: khung chờ rồi bảng điều khiển', async ({ page, api }, testInfo) => {
    mockSession(api);
    api.get('/affiliate/me', { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    api.get('/affiliate/tiers', { revenue: 0, tier: DASH.tier, allTiers: [{ name: 'Hạt Giống', emoji: '🌱', min: 0, milestoneRewardPoints: null }] });
    api.get('/affiliate/milestones', { monthKey: '2026-10', currentRevenue: 0, pendingRevenue: 0, holdDays: 20, milestones: [], previousMonth: null });
    api.get('/affiliate/analytics/storefronts', { storefronts: [] });
    api.get('/affiliate/analytics/products', []);
    api.get('/academy/courses', []);
    api.get('/me/wallet', { walletBalance: 0, cashbackPending: 0, commissionApproved: 80_000, commissionPending: 30_000 });
    api.get('/affiliate/dashboard', DASH);
    api.get('/affiliate/links', []);
    api.get('/affiliate/commissions', [
      { id: 'c1', orderId: 'o1', orderCode: 'TB1', orderTotal: 500_000, rate: '0.1', amount: 50_000, status: 'APPROVED', createdAt: '2026-10-02T03:00:00Z', orderStatus: 'DELIVERED' },
    ]);
    api.get('/affiliate/payouts', []);
    api.get('/affiliate/tax-statement', { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } });
    await page.goto('/ctv');
    await expect(page.getByRole('heading', { name: 'Cộng tác viên', level: 1 })).toBeVisible();
    await expect(page.getByText('125.000đ')).toBeVisible();
    await expectFits(page, 'ctv-bang-dieu-khien', testInfo);
    await page.getByRole('tab', { name: 'Hoa hồng' }).click();
    await expect(page.getByText('+50.000đ')).toBeVisible();
    await expectFits(page, 'ctv-hoa-hong', testInfo);
  });

  test('/ctv/gian-hang: trình dựng có món ghim, ẩn và lý do', async ({ page, api }, testInfo) => {
    mockSession(api);
    api.get('/affiliate/me', { isAffiliate: true, canRegister: true, canOpenStorefront: true, referralCode: 'AN123', walletBalance: 0 });
    api.get('/storefront/me', {
      id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: null, avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
      subdomain: null, isPublished: true, status: 'LIVE', referralCode: 'AN123', subdomainEnabled: false, publicHiddenReason: null,
      collections: [{
        id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0,
        items: [
          { id: 'i1', productId: 'p1', note: null, isPinned: true, isHidden: false, sortOrder: 0, product: PRODUCT },
          { id: 'i2', productId: 'p2', note: 'Rất êm tay', isPinned: false, isHidden: false, sortOrder: 1, hiddenReason: 'Sản phẩm chưa được duyệt bán nên khách chưa thấy trong gian hàng', product: { ...PRODUCT, id: 'p2', name: 'Xà phòng' } },
        ],
      }],
    });
    api.get('/categories', []);
    api.get('/storefront/me/products', []);
    api.get('/storefront/me/stats', { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] });
    api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
    api.get('/me/wishlist/ids', []);
    api.get('/flash-sales/active', []);
    await page.goto('/ctv/gian-hang');
    await expect(page.getByText('Bộ sưu tập A')).toBeVisible();
    await expectFits(page, 'gian-hang-danh-sach-khoi', testInfo);
    await page.goto('/ctv/gian-hang?khoi=c1');
    await expect(page.getByText('Đã ghim')).toBeVisible();
    await expectFits(page, 'gian-hang-trinh-dung', testInfo);
  });
});
