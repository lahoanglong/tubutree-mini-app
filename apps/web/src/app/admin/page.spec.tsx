// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import AdminPage from './page';
import { click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, scrollRegionProblems, unlabeledFields } from '@/test-utils/a11y';
import { ADMIN_CONFIG_ROWS } from '@/test-utils/fixtures/admin-config-rows';

const mocks = vi.hoisted(() => ({
  auth: { user: { role: 'ADMIN' } as { role: string } | null, status: 'authenticated', initialized: true },
  recycling: 0,
  pancake: 0,
  listOrders: vi.fn(),
  resolvePancakeAttention: vi.fn(),
  claims: 0,
  payouts: 0,
  refundsPending: 0,
  returnsArgs: [] as unknown[][],
  dealerArgs: [] as unknown[][],
  orders: [] as unknown[],
  users: [
    { id: 'u1', fullName: 'Nguyễn An', phone: '0944444444', role: 'CUSTOMER', pointsBalance: 12, createdAt: '2026-09-01T00:00:00.000Z' },
  ] as unknown[],
  setUserRole: vi.fn(),
  listUsersArgs: [] as unknown[][],
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  createCoupon: vi.fn(),
  config: [] as unknown[],
  configFails: false,
  brands: [] as unknown[],
  brandProducts: [] as unknown[],
  promotions: [] as unknown[],
  rewards: [] as unknown[],
  createBrand: vi.fn(),
  updateBrand: vi.fn(),
  verifyBrand: vi.fn(),
  detachBrandProducts: vi.fn(),
  createPromotion: vi.fn(),
  deletePromotion: vi.fn(),
  createDealerReward: vi.fn(),
  deleteDealerReward: vi.fn(),
  flashSales: [] as unknown[],
  productSearch: [] as unknown[],
  createFlashSale: vi.fn(),
  updateFlashSale: vi.fn(),
  addFlashSaleItem: vi.fn(),
  deleteFlashSaleItem: vi.fn(),
  deleteFlashSale: vi.fn(),
  faqs: [] as unknown[],
  createFaq: vi.fn(),
  updateFaq: vi.fn(),
  deleteFaq: vi.fn(),
  quickReplies: [] as unknown[],
  createQuickReply: vi.fn(),
  updateQuickReply: vi.fn(),
  deleteQuickReply: vi.fn(),
  kit: null as unknown,
  saveContentKit: vi.fn(),
  courses: [] as unknown[],
  createAcademyCourse: vi.fn(),
  updateAcademyCourse: vi.fn(),
  deleteAcademyCourse: vi.fn(),
  addAcademyLesson: vi.fn(),
  updateAcademyLesson: vi.fn(),
  deleteAcademyLesson: vi.fn(),
  inbox: vi.fn(),
  access: { role: 'STAFF', staffPermissions: [] as string[] },
  refundsCalls: 0,
  refundsArgs: [] as unknown[][],
  downloadOrders: vi.fn(),
  downloadUsers: vi.fn(),
  userDetail: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/admin-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin-client')>();
  const order = (status: string, i: number) => ({
    id: `o${i}`,
    code: `TT${i}`,
    total: 100000 + i,
    status,
    paymentMethod: 'COD',
    createdAt: '2026-10-01T03:00:00.000Z',
    user: { fullName: 'Khách', phone: '0900000000' },
  });
  const STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED', 'RETURNED'];
  return {
    ...actual,
    getDashboardStats: async () => ({
      totalRevenue: 1_000_000,
      gmv: 1_500_000,
      codPendingValue: 400_000,
      returnedOrders: 2,
      pendingReturns: 3,
      returnRefundTotal: 120_000,
      dealerDebtOutstanding: 2_500_000,
      totalOrders: 7,
      pendingOrders: 1,
      shippingOrders: 1,
      deliveredOrders: 1,
      cancelledOrders: 1,
      totalUsers: 10,
      totalAffiliates: 2,
      totalProducts: 5,
      plantedTreesCount: 3,
      recentOrders: STATUSES.map(order),
    }),
    countRecyclingAttention: async () => mocks.recycling,
    countPancakeAttention: async () => mocks.pancake,
    resolvePancakeAttention: (...args: unknown[]) => mocks.resolvePancakeAttention(...args),
    listDealerRewardClaims: async () => ({ data: [], meta: { total: mocks.claims, page: 1, limit: 1 } }),
    listPayouts: async () => ({ data: [], meta: { total: mocks.payouts, page: 1, limit: 1 } }),
    listCustomerRefunds: async (...args: unknown[]) => {
      mocks.refundsCalls += 1;
      mocks.refundsArgs.push(args);
      return { data: [], meta: { total: mocks.refundsPending, page: 1, limit: 1 } };
    },
    getOpsInbox: async () => {
      mocks.inbox();
      return {
        generatedAt: '2026-10-14T03:00:00.000Z',
        items: [
          { key: 'pancakeAttention', count: 2 },
          { key: 'customerRefunds', count: 4 },
          { key: 'returnsPending', count: 1 },
          { key: 'returnsToReceive', count: 2 },
          { key: 'refillPending', count: 0 },
          { key: 'communityPending', count: 3 },
          { key: 'communityUnanswered', count: 1 },
          { key: 'invoicePending', count: 2 },
        ],
      };
    },
    getOpsAccess: async () => mocks.access,
    getOpsHealth: async () => ({
      generatedAt: '2026-10-14T03:00:00.000Z',
      thresholds: { unsyncedMinutes: 30, stuckOrders: 1, webhookFailed: 1, queueFailed1h: 5, repeatHours: 6, gomdonBacklogMinutes: 15 },
      pancake: {
        configured: true, lastPushOkAt: null, lastWebhookAt: null, lastWebhookProcessedAt: null, webhookFailed24h: 0, webhookFailedOpen: 0, webhookStuck: 0, failedEvents: [],
        unsynced: 0, stuck: 0, stuckOrders: [], attention: 0, attentionOrders: [], catalog: { lastOkAt: null, lastErrorAt: null, lastError: null, detail: null },
      },
      gomdon: {
        configured: false, connection: null, credentialsRejected: false, lastWebhookAt: null, webhookFailed24h: 0, webhookFailedOpen: 0, failedEvents: [],
        openAlerts: 0, alerts: [], attention: 0, backlog: 0, backlogOrders: [] },
      queues: { ok: true, items: [] },
      problems: [],
    }),
    listLiveAttendance: async () => [],
    getWasteOverview: () => new Promise(() => undefined),
    listWasteItems: async () => [],
    listWastePoints: async () => [],
    listWasteRequests: async () => ({ rows: [], nextCursor: null }),
    listWasteUnmatched: async () => [],
    listWasteGifts: async () => [],
    listGiftRedemptions: async () => [],
    getWasteUserFlags: async (userId: string) => ({ userId, shipLockedAt: null, shipUnlockedAt: null, blockedAt: null, reason: null, setByUserId: null, updatedAt: null }),
    downloadOrdersCsv: async (...args: unknown[]) => {
      mocks.downloadOrders(...args);
      return { filename: 'don-hang-2026-10-14.csv', bytes: 10 };
    },
    downloadUsersCsv: async (...args: unknown[]) => {
      mocks.downloadUsers(...args);
      return { filename: 'nguoi-dung-2026-10-14.csv', bytes: 10 };
    },
    getUserDetail: async (id: string) => mocks.userDetail(id),
    listOrders: async (...args: unknown[]) => {
      mocks.listOrders(...args);
      return { data: mocks.orders, meta: { total: 60, page: 1, limit: 20 } };
    },
    listDealerApps: async (...args: unknown[]) => (mocks.dealerArgs.push(args), {
      data: [
        {
          id: 'd1',
          businessName: 'Cửa hàng Xanh',
          ownerName: 'Lan',
          phone: '0911111111',
          address: '1 Lê Lợi',
          taxCode: null,
          cccdFrontUrl: 'https://img.test/f.jpg',
          cccdBackUrl: '',
          status: 'PENDING',
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      meta: { total: 45, page: 1, limit: 20 },
    }),
    listReturnRequests: async (...args: unknown[]) => (mocks.returnsArgs.push(args), {
      data: ['REQUESTED', 'APPROVED', 'REJECTED'].map((status, i) => ({
        id: `r${i}`,
        orderId: `o${i}`,
        userId: 'u',
        reason: 'Hàng lỗi nhà sản xuất',
        images: [],
        status,
        refundMethod: 'ORIGINAL',
        adminNote: status === 'REQUESTED' ? null : 'Đã kiểm tra',
        reviewedBy: null,
        reviewedAt: status === 'REQUESTED' ? null : '2026-10-03T00:00:00.000Z',
        createdAt: `2026-10-0${i + 1}T00:00:00.000Z`,
        order: { id: `o${i}`, code: `TT20${i}`, total: 90000, status: 'DELIVERED', paymentMethod: 'COD' },
        user: { id: 'u', fullName: 'Mai', phone: '0933333333' },
      })),
      meta: { total: 3, page: 1, limit: 20 },
    }),
    listUsers: async (...args: unknown[]) => {
      mocks.listUsersArgs.push(args);
      return { data: mocks.users, meta: { total: 45, page: 1, limit: 20 } };
    },
    setUserRole: (...args: unknown[]) => mocks.setUserRole(...args),
    blockUser: (...args: unknown[]) => mocks.blockUser(...args),
    unblockUser: (...args: unknown[]) => mocks.unblockUser(...args),
    createCoupon: (...args: unknown[]) => mocks.createCoupon(...args),
    listCoupons: async () => ({ data: [], meta: { total: 0, page: 1, limit: 20 } }),
    updateCoupon: vi.fn(),
    getConfig: async () => {
      if (mocks.configFails) throw new Error('boom');
      return mocks.config;
    },
    listDealerTiers: async () => [{ id: 't1', name: 'Bạc', minOrderVolume: 0, creditLimit: 0, paymentTerms: null }],
    listBrands: async () => mocks.brands,
    listBrandProducts: async () => mocks.brandProducts,
    listPromotions: async () => mocks.promotions,
    listDealerRewards: async () => mocks.rewards,
    createBrand: (...args: unknown[]) => mocks.createBrand(...args),
    updateBrand: (...args: unknown[]) => mocks.updateBrand(...args),
    verifyBrand: (...args: unknown[]) => mocks.verifyBrand(...args),
    detachBrandProducts: (...args: unknown[]) => mocks.detachBrandProducts(...args),
    createPromotion: (...args: unknown[]) => mocks.createPromotion(...args),
    deletePromotion: (...args: unknown[]) => mocks.deletePromotion(...args),
    createDealerReward: (...args: unknown[]) => mocks.createDealerReward(...args),
    deleteDealerReward: (...args: unknown[]) => mocks.deleteDealerReward(...args),
    listFlashSales: async () => mocks.flashSales,
    lookupVariations: async () => [],
    createFlashSale: (...args: unknown[]) => mocks.createFlashSale(...args),
    updateFlashSale: (...args: unknown[]) => mocks.updateFlashSale(...args),
    addFlashSaleItem: (...args: unknown[]) => mocks.addFlashSaleItem(...args),
    deleteFlashSaleItem: (...args: unknown[]) => mocks.deleteFlashSaleItem(...args),
    deleteFlashSale: (...args: unknown[]) => mocks.deleteFlashSale(...args),
    listFaqs: async () => mocks.faqs,
    createFaq: (...args: unknown[]) => mocks.createFaq(...args),
    updateFaq: (...args: unknown[]) => mocks.updateFaq(...args),
    deleteFaq: (...args: unknown[]) => mocks.deleteFaq(...args),
    listQuickReplies: async () => mocks.quickReplies,
    createQuickReply: (...args: unknown[]) => mocks.createQuickReply(...args),
    updateQuickReply: (...args: unknown[]) => mocks.updateQuickReply(...args),
    deleteQuickReply: (...args: unknown[]) => mocks.deleteQuickReply(...args),
    searchAdminProducts: async () => mocks.productSearch,
    getContentKit: async () => mocks.kit,
    saveContentKit: (...args: unknown[]) => mocks.saveContentKit(...args),
    listAcademyCourses: async () => mocks.courses,
    createAcademyCourse: (...args: unknown[]) => mocks.createAcademyCourse(...args),
    updateAcademyCourse: (...args: unknown[]) => mocks.updateAcademyCourse(...args),
    deleteAcademyCourse: (...args: unknown[]) => mocks.deleteAcademyCourse(...args),
    addAcademyLesson: (...args: unknown[]) => mocks.addAcademyLesson(...args),
    updateAcademyLesson: (...args: unknown[]) => mocks.updateAcademyLesson(...args),
    deleteAcademyLesson: (...args: unknown[]) => mocks.deleteAcademyLesson(...args),
  };
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AdminPage />);
  mounted.push(r);
  await flush();
  return r;
};

beforeEach(() => {
  mocks.auth = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
  mocks.recycling = 0;
  mocks.pancake = 0;
  mocks.listOrders.mockReset();
  mocks.resolvePancakeAttention.mockReset();
  mocks.claims = 0;
  mocks.payouts = 0;
  mocks.refundsPending = 0;
  mocks.returnsArgs = [];
  mocks.dealerArgs = [];
  mocks.orders = [];
  mocks.users = [
    { id: 'u1', fullName: 'Nguyễn An', phone: '0944444444', role: 'CUSTOMER', pointsBalance: 12, createdAt: '2026-09-01T00:00:00.000Z' },
  ];
  mocks.setUserRole.mockReset();
  mocks.createCoupon.mockReset();
  mocks.config = [];
  mocks.configFails = false;
  mocks.brands = [];
  mocks.brandProducts = [];
  mocks.promotions = [];
  mocks.rewards = [];
  mocks.flashSales = [];
  mocks.productSearch = [{ id: 'p1', name: 'Dừa sáp', brand: 'Bến Tre', isActive: true, variations: [] }];
  mocks.faqs = [];
  mocks.quickReplies = [];
  mocks.kit = null;
  mocks.courses = [];
  for (const fn of [
    mocks.createAcademyCourse, mocks.updateAcademyCourse, mocks.deleteAcademyCourse,
    mocks.addAcademyLesson, mocks.updateAcademyLesson, mocks.deleteAcademyLesson,
    mocks.saveContentKit,
    mocks.createQuickReply, mocks.updateQuickReply, mocks.deleteQuickReply,
    mocks.createFaq, mocks.updateFaq, mocks.deleteFaq,
    mocks.createFlashSale, mocks.updateFlashSale, mocks.addFlashSaleItem, mocks.deleteFlashSaleItem, mocks.deleteFlashSale,
    mocks.createBrand, mocks.updateBrand, mocks.verifyBrand, mocks.detachBrandProducts,
    mocks.createPromotion, mocks.deletePromotion, mocks.createDealerReward, mocks.deleteDealerReward,
  ]) fn.mockReset();
  mocks.inbox.mockReset();
  mocks.access = { role: 'STAFF', staffPermissions: [] };
  mocks.refundsCalls = 0;
  mocks.refundsArgs = [];
  mocks.downloadOrders.mockReset();
  mocks.downloadUsers.mockReset();
  mocks.userDetail.mockReset();
  window.history.replaceState(null, '', '/admin');
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

// C-097 (Q-25, Q-29): khung trang admin theo token DS v2, tối ưu máy tính nhưng dùng được ở 390px. Màu cụ thể
// do bánh cóc ds-palette-pc11.spec.ts giữ; ở đây khoá bố cục/vùng chạm và ánh xạ màu trạng thái đơn.
describe('admin/page — khung, đăng nhập, thanh tab', () => {
  it('chưa đăng nhập: liên kết Đăng nhập dùng màu forest và vẫn trỏ /dang-nhap', async () => {
    mocks.auth = { user: null, status: 'unauthenticated', initialized: true };
    const { container } = await mount();
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Đăng nhập');
    expect(link.getAttribute('href')).toBe('/dang-nhap');
    expect(link.className).toContain('text-forest-700');
  });

  it('không phải ADMIN: chỉ hiện thông báo không có quyền, không có thanh tab', async () => {
    mocks.auth = { user: { role: 'CUSTOMER' }, status: 'authenticated', initialized: true };
    const { container } = await mount();
    expect(container.textContent).toContain('Bạn không có quyền truy cập trang quản trị.');
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('ADMINOPS-13: mục quản trị chia 9 nhóm (đủ 8 nhóm nghiệp vụ), mỗi mục cao 44px ở điện thoại, mục đang mở tô forest', async () => {
    const { container } = await mount();
    const nav = container.querySelector('nav[aria-label="Mục quản trị"]')!;
    expect(nav.className).toContain('lg:block');
    const groups = [...nav.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual([
      'Tổng quan',
      'Đơn hàng & giao vận',
      'Hoàn tiền & đổi trả',
      'Người bán',
      'Khách hàng',
      'Khuyến mãi',
      'Nội dung',
      'Nhân sự',
      'Cấu hình & tích hợp',
    ]);
    const items = [...nav.querySelectorAll('button')];
    expect(items).toHaveLength(37);
    for (const b of items) expect(b.className).toContain('min-h-[44px]');
    const group = (label: string) =>
      [...nav.querySelector(`[role="group"][aria-label="${label}"]`)!.querySelectorAll('button')].map((b) => b.textContent);
    expect(group('Người bán')).toEqual(
      expect.arrayContaining(['Lịch sử giá đại lý', 'Hoa hồng & giá sỉ', 'Danh mục sản phẩm', 'Đại lý & công nợ', 'Gian hàng']),
    );
    expect(group('Khuyến mãi')).toEqual(['Voucher', 'Flash Sale', 'Nhiệm vụ & quà đổi điểm']);
    expect(group('Tổng quan')).toContain('Báo cáo');
    expect(group('Khách hàng')).toContain('Cộng đồng');
    expect(group('Khách hàng')).toContain('Đổi rác');
    expect(group('Khách hàng')).not.toContain('Đổi vỏ chai');
    expect(items.map((b) => b.textContent)).not.toContain('Đổi vỏ chai');
    const current = items.find((b) => b.getAttribute('aria-current') === 'page')!;
    expect(current.textContent).toBe('Việc cần xử lý');
    expect(current.className).toContain('bg-forest-100');
    expect(items.filter((b) => b.className.includes('bg-forest-100'))).toHaveLength(1);
  });

  it('tab Đổi rác luôn hiện với ADMIN dù waste.enabled tắt (spec 11.7, 16.2)', async () => {
    window.history.replaceState(null, '', '/admin?tab=waste');
    const { container } = await mount();
    const btn = [...container.querySelectorAll('nav[aria-label="Mục quản trị"] button')].find((b) => b.textContent === 'Đổi rác')!;
    expect(btn.getAttribute('aria-current')).toBe('page');
    expect([...container.querySelectorAll('h2')].some((h) => h.textContent === 'Đổi rác lấy quà')).toBe(true);
  });

  it('trang chủ mặc định là "Việc cần xử lý"; bấm một mục ghi ?tab= lên URL, link cũ ?tab=orders&pancake=attention vẫn mở đúng chỗ', async () => {
    const { container } = await mount();
    expect(container.textContent).toContain('Việc cần xử lý');
    expect(mocks.inbox).toHaveBeenCalled();
    click([...container.querySelectorAll('nav[aria-label="Mục quản trị"] button')].find((b) => b.textContent === 'Tổng quan KPI')!);
    await flush();
    expect(window.location.search).toBe('?tab=dashboard');
    expect(container.textContent).toContain('Doanh thu đã thu');
  });

  it('điện thoại: nút "Đổi mục" mở ngăn kéo liệt kê đủ nhóm, chọn mục thì đóng ngăn kéo và mở mục đó', async () => {
    const { container } = await mount();
    const opener = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Đổi mục'))!;
    expect(opener.className).toContain('min-h-[44px]');
    expect(opener.textContent).toContain('Tổng quan · Việc cần xử lý');
    click(opener);
    await flush();
    const drawer = document.body.querySelector('[role="dialog"]')!;
    expect(drawer.querySelectorAll('[role="group"]')).toHaveLength(9);
    click([...drawer.querySelectorAll('button')].find((b) => b.textContent === 'Đổi rác')!);
    await flush();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.search).toBe('?tab=waste');
  });

  it('tab Hoàn tiền khách (Q-01) có trong thanh tab, bấm vào mở màn hoàn tiền và ghi tab lên URL', async () => {
    const { container } = await mount();
    const tab = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Hoàn tiền khách'))!;
    expect(tab).toBeDefined();
    click(tab);
    await flush();
    expect(window.location.search).toBe('?tab=customerRefunds');
    expect(container.textContent).toContain('Không còn khoản hoàn nào cần xử lý');
  });

  it('mở thẳng /admin?tab=customerRefunds vào đúng tab Hoàn tiền khách', async () => {
    window.history.replaceState(null, '', '/admin?tab=customerRefunds');
    const { container } = await mount();
    expect(container.textContent).toContain('Chờ chuyển khoản');
    expect(container.textContent).toContain('Không còn khoản hoàn nào cần xử lý');
  });

  it('huy hiệu số khoản hoàn cần xử lý (Đang mở, cùng tập với thẻ trang chủ) cạnh nhãn tab, tông cảnh báo; 0 khoản thì không hiện', async () => {
    mocks.refundsPending = 3;
    const withBadge = await mount();
    const tab = [...withBadge.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Hoàn tiền khách'))!;
    const badge = tab.querySelector('span[data-refunds-pending]')!;
    expect(badge.textContent).toContain('3');
    expect(badge.textContent).toContain('khoản hoàn cần xử lý');
    expect(badge.className).toContain('bg-warning-bg');
    expect(badge.className).toContain('text-warning-fg');
    withBadge.unmount();
    mounted = mounted.filter((m) => m !== withBadge);

    mocks.refundsPending = 0;
    const none = await mount();
    const tab0 = [...none.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Hoàn tiền khách'))!;
    expect(tab0.querySelector('span[data-refunds-pending]')).toBeNull();
    expect(tab0.textContent).toBe('Hoàn tiền khách');
  });

  it('liên kết Màn thu ngân vẫn trỏ /admin/pos và cao 44px ở điện thoại', async () => {
    const { container } = await mount();
    const pos = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/admin/pos')!;
    expect(pos.textContent).toContain('Màn thu ngân');
    expect(pos.className).toContain('min-h-[44px]');
  });
});

describe('admin/page — tab Tổng quan', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin?tab=dashboard');
  });
  const BADGE: [string, string, string][] = [
    ['Chờ thanh toán', 'bg-warning-bg', 'text-warning-fg'],
    ['Đã xác nhận', 'bg-info-bg', 'text-info-fg'],
    ['Đã đóng gói', 'bg-sage-100', 'text-sage-700'],
    ['Đang vận chuyển', 'bg-forest-100', 'text-forest-800'],
    ['Đã giao hàng', 'bg-success-bg', 'text-success-fg'],
    ['Đã hủy', 'bg-danger-bg', 'text-danger-fg'],
    ['Đã trả hàng', 'bg-promo-bg', 'text-promo-fg'],
  ];

  it('R6-ADMIN-5 — điện thoại: mỗi đơn gần đây là thẻ hai dòng có tổng tiền và trạng thái, bảng chỉ hiện từ 640px', async () => {
    const { container } = await mount();
    const cards = container.querySelectorAll('ul[data-recent-orders-cards] > li');
    expect(cards).toHaveLength(7);
    expect(cards[0]!.textContent).toContain('TT0');
    expect(cards[0]!.textContent).toContain('100.000');
    expect(cards[0]!.textContent).toContain('Chờ thanh toán');
    expect(cards[6]!.textContent).toContain('Đã trả hàng');
    expect(container.querySelector('ul[data-recent-orders-cards]')!.className).toContain('sm:hidden');
    expect(container.querySelector('table')!.closest('[role="region"]')!.className).toContain('hidden sm:block');
  });

  it('huy hiệu trạng thái đơn mỗi trạng thái một cặp nền/chữ cùng họ token, nhãn giữ nguyên', async () => {
    const { container } = await mount();
    const badges = [...container.querySelectorAll('tbody span.inline-block')];
    expect(badges).toHaveLength(7);
    badges.forEach((el, i) => {
      const [label, bg, fg] = BADGE[i]!;
      expect(el.textContent).toBe(label);
      expect(el.className).toContain(bg);
      expect(el.className).toContain(fg);
    });
  });

  it('bảng đơn mới nhất cuộn ngang trong khung riêng; thẻ KPI dùng bo/bóng thẻ DS v2', async () => {
    const { container } = await mount();
    const table = container.querySelector('table')!;
    expect(table.parentElement!.className).toContain('overflow-x-auto');
    expect(container.querySelector('.rounded-card.shadow-card')).not.toBeNull();
  });

  it('thẻ Sản phẩm nói "góp quỹ trồng cây", không hứa cây thật hay nêu PanNature (C-010, Q-16)', async () => {
    const { container } = await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Sản phẩm & Quỹ trồng cây');
    expect(text).toContain('3 cây góp quỹ trồng cây');
    expect(text).not.toMatch(/cây thật|PanNature|Rừng Xanh/);
  });

  it('biểu ngữ cần xử lý dùng biểu tượng lucide thay emoji, giữ số đếm và nhãn bấm', async () => {
    mocks.recycling = 2;
    mocks.claims = 3;
    mocks.payouts = 4;
    const { container } = await mount();
    const banners = [...container.querySelectorAll('button')].filter((b) => /Xử lý ngay|Xem →/.test(b.textContent ?? ''));
    expect(banners).toHaveLength(3);
    for (const b of banners) expect(b.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(banners[0]!.textContent).toContain('2 đơn thu gom tái chế cần xử lý');
    expect(banners[1]!.textContent).toContain('3 yêu cầu nhận thưởng đại lý đang chờ duyệt');
    expect(banners[2]!.textContent).toContain('4 lệnh rút tiền');
  });
});

describe('admin/page — tab Đơn hàng', () => {
  const openOrders = async () => {
    window.history.replaceState(null, '', '/admin?tab=orders');
    return mount();
  };

  it('bộ lọc thu gom: nhãn "Có thu gom" không còn emoji, chip cao 44px ở điện thoại', async () => {
    const { container } = await openOrders();
    const group = container.querySelector('[aria-label="Lọc đơn thu gom tái chế"]')!;
    const chips = [...group.querySelectorAll('[role="tab"]')];
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['Mọi đơn', 'Có thu gom', expect.stringContaining('Cần xử lý thu gom')]);
    for (const c of chips) expect(c.className).toContain('min-h-[44px]');
    expect(chips[1]!.querySelector('svg')).not.toBeNull();
  });

  it('thanh tìm kiếm + lọc không tràn ngang ở 390px: ô nhập co được, hàng điều khiển xuống dòng', async () => {
    const { container } = await openOrders();
    const input = container.querySelector('input[type="text"]')!;
    expect(input.className).toContain('min-w-0');
    const select = container.querySelector('select')!;
    expect(select.parentElement!.className).toContain('flex-wrap');
  });

  it('thanh phân trang xuống dòng được và nút Trước/Sau giữ nhãn', async () => {
    const { container } = await openOrders();
    const prev = [...container.querySelectorAll('button')].find((b) => b.textContent === '← Trang trước');
    // listOrders mock trả data rỗng nên bảng hiện thông báo rỗng; phân trang vẫn hiện vì meta.total=60.
    expect(prev).toBeDefined();
    expect(prev!.parentElement!.parentElement!.className).toContain('flex-wrap');
    expect(prev!.className).toContain('min-h-[44px]');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Trang sau →')).toBe(true);
  });
});

describe('admin/page — hàng đơn hàng', () => {
  it('nút Xem & Sửa cao 44px ở điện thoại, mở rộng thì hiện sản phẩm + huy hiệu đặt trước theo token và đổi nhãn Đóng', async () => {
    mocks.orders = [
      {
        id: 'o1',
        code: 'TT100',
        status: 'CONFIRMED',
        type: 'DEALER',
        dealerOnCredit: true,
        total: 250000,
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'UNPAID',
        note: 'Giao giờ hành chính',
        createdAt: '2026-10-02T03:00:00.000Z',
        user: { fullName: 'Đại lý A', phone: '0922222222' },
        items: [{ id: 'i1', productName: 'Hạt chia', variationName: '500g', unitPrice: 50000, quantity: 5, total: 250000, backorderedQty: 2 }],
      },
    ];
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Xem & Sửa')!;
    expect(toggle.className).toContain('min-h-[44px]');
    expect(container.textContent).toContain('Đại lý · công nợ');
    const dealerNote = [...container.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Đại lý ·'))!;
    expect(dealerNote.className).toContain('text-warning-fg');
    act(() => toggle.click());
    await flush();
    expect(toggle.textContent).toBe('Đóng');
    expect(toggle.querySelector('svg')).not.toBeNull();
    const pill = [...container.querySelectorAll('span')].find((x) => x.textContent === 'Đặt trước 2')!;
    expect(pill.className).toContain('bg-warning-bg');
    expect(container.textContent).toContain('Ghi chú từ khách: Giao giờ hành chính');
  });
});

describe('admin/page — hàng đợi "Cần xử lý Pancake"', () => {
  const flagged = {
    id: 'o9',
    code: 'TUBU9',
    status: 'CANCELLED',
    total: 300000,
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'PAID',
    createdAt: '2026-10-02T03:00:00.000Z',
    user: { fullName: 'Khách B', phone: '0933333333' },
    pancakeAttention: 'Pancake ghi nhận đã nhận tiền chuyển khoản nhưng đơn đã huỷ/trả — CẦN HOÀN TIỀN THỦ CÔNG cho khách.',
    pancakeAttentionAt: '2026-10-03T03:00:00.000Z',
  };

  it('biểu ngữ tổng quan đếm đơn cần xử lý, bấm vào mở tab Đơn hàng đã lọc pancake=attention', async () => {
    mocks.pancake = 3;
    window.history.replaceState(null, '', '/admin?tab=dashboard');
    const { container } = await mount();
    const banner = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('báo cáo Pancake'))!;
    expect(banner.textContent).toContain('3 đơn cần xử lý theo báo cáo Pancake');
    expect(banner.className).toContain('bg-danger-bg');
    act(() => banner.click());
    await flush();
    expect(window.location.search).toBe('?tab=orders&pancake=attention');
    expect(mocks.listOrders).toHaveBeenLastCalledWith(1, undefined, undefined, undefined, 20, undefined, 'attention', undefined, undefined, {});
    const chip = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Cần xử lý Pancake'))!;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.textContent).toBe('Cần xử lý Pancake (3)');
    act(() => chip.click());
    await flush();
    expect(window.location.search).toBe('?tab=orders');
    expect(mocks.listOrders).toHaveBeenLastCalledWith(1, undefined, undefined, undefined, 20, undefined, undefined, undefined, undefined, {});
  });

  it('đơn bị gắn cờ: huy hiệu ở dòng, chi tiết hiện lý do; "Đã xử lý" qua hộp xác nhận rồi gửi ghi chú', async () => {
    mocks.orders = [flagged];
    mocks.resolvePancakeAttention.mockResolvedValue({ ok: true, message: 'Đơn TUBU9 đã rời hàng đợi cần xử lý Pancake.' });
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    expect(container.textContent).toContain('Pancake: cần xử lý');
    act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Xem & Sửa')!.click());
    await flush();
    const panel = container.querySelector('section[aria-label="Cần xử lý Pancake"]')!;
    expect(panel.textContent).toContain('CẦN HOÀN TIỀN THỦ CÔNG');
    typeInto(panel.querySelector('input'), '  đã hoàn tay cho khách ');
    act(() => [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Đã xử lý')!.click());
    await flush();
    expect(mocks.resolvePancakeAttention).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Đơn TUBU9 sẽ rời hàng đợi');
    act(() => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Đã xử lý')!.click());
    await flush();
    expect(mocks.resolvePancakeAttention).toHaveBeenCalledWith('o9', '  đã hoàn tay cho khách ');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('đã rời hàng đợi');
  });
});

describe('admin/page — tab Đại lý', () => {
  const openDealers = async () => {
    window.history.replaceState(null, '', '/admin?tab=dealers');
    return mount();
  };

  it('hồ sơ chờ duyệt: Duyệt (tô forest) bị khoá tới khi chọn bậc, Từ chối viền danger, cả hai cao 44px', async () => {
    const { container } = await openDealers();
    const approve = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Duyệt')!;
    const reject = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Từ chối')!;
    expect(approve.disabled).toBe(true);
    expect(approve.title).toBe('Cần chọn bậc đại lý để duyệt');
    expect(approve.className).toContain('bg-forest-600');
    expect(approve.className).toContain('min-h-[44px]');
    expect(reject.disabled).toBe(false);
    expect(reject.className).toContain('border-danger-fg');
    expect(reject.className).toContain('min-h-[44px]');
  });

  it('còn trang chưa tải: thông báo cảnh báo theo token và nút Tải thêm cao 44px', async () => {
    const { container } = await openDealers();
    const notice = [...container.querySelectorAll('p')].find((p) => p.textContent?.includes('mới hơn chưa tải'))!;
    expect(notice.textContent).toContain('Còn 44 hồ sơ mới hơn chưa tải');
    expect(notice.className).toContain('bg-warning-bg');
    const more = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Tải thêm')!;
    expect(more.className).toContain('min-h-[44px]');
  });

  it('R5-ADMIN-2: bộ lọc và hàng hồ sơ ghi trạng thái bằng tiếng Việt, không in mã PENDING/APPROVED/REJECTED', async () => {
    const { container } = await openDealers();
    const filter = container.querySelector<HTMLSelectElement>('select[aria-label="Lọc hồ sơ đại lý theo trạng thái"]')!;
    expect([...filter.options].map((o) => [o.value, o.textContent])).toEqual([
      ['PENDING', 'Chờ duyệt'],
      ['APPROVED', 'Đã duyệt'],
      ['REJECTED', 'Đã từ chối'],
      ['', 'Tất cả trạng thái'],
    ]);
    const card = [...container.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Cửa hàng Xanh') && d.className.includes('rounded-card'))!;
    expect(card.textContent).toContain('Chờ duyệt');
    expect(container.textContent).not.toMatch(/PENDING|APPROVED|REJECTED/);
  });

  it('R5-ADMIN-2: đổi bộ lọc vẫn gửi giá trị API (APPROVED), chữ hiển thị chỉ là nhãn', async () => {
    const { container } = await openDealers();
    const filter = container.querySelector<HTMLSelectElement>('select[aria-label="Lọc hồ sơ đại lý theo trạng thái"]')!;
    selectValue(filter, 'APPROVED');
    await flush();
    expect(mocks.dealerArgs.at(-1)![0]).toBe('APPROVED');
    expect(filter.selectedOptions[0]!.textContent).toBe('Đã duyệt');
  });

  it('thẻ hồ sơ: tên/địa chỉ dài ngắt dòng, ảnh CCCD có viền token', async () => {
    const { container } = await openDealers();
    const card = [...container.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Cửa hàng Xanh') && d.className.includes('rounded-card'))!;
    expect(card.querySelector('span.break-words')!.textContent).toBe('Cửa hàng Xanh');
    expect(card.querySelector('img')!.className).toContain('border-stone-200');
  });
});

describe('admin/page — tab Đổi / Trả', () => {
  const openReturns = async () => {
    window.history.replaceState(null, '', '/admin?tab=returns');
    return mount();
  };
  const badge = (root: HTMLElement, text: string) => [...root.querySelectorAll('span')].find((x) => x.textContent?.trim() === text)!;

  it('huy hiệu trạng thái yêu cầu theo token: chờ = cảnh báo, đã duyệt = thành công, từ chối = nguy hiểm', async () => {
    const { container } = await openReturns();
    expect(badge(container, 'Chờ duyệt').className).toContain('bg-warning-bg');
    expect(badge(container, 'Đã duyệt (Hoàn tiền)').className).toContain('bg-success-bg');
    expect(badge(container, 'Đã từ chối').className).toContain('bg-danger-bg');
  });

  it('yêu cầu chờ duyệt: Duyệt hoàn tiền tô forest, Từ chối viền danger, ô ghi chú và cả hai nút cao 44px', async () => {
    const { container } = await openReturns();
    const approve = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Duyệt hoàn tiền')!;
    const reject = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Từ chối')!;
    expect(approve.className).toContain('bg-forest-600');
    expect(approve.className).toContain('min-h-[44px]');
    expect(reject.className).toContain('border-danger-fg');
    expect(reject.className).toContain('min-h-[44px]');
    const note = container.querySelector('input[placeholder^="Ghi chú duyệt"]')!;
    expect(note.className).toContain('min-h-[44px]');
    expect(note.className).toContain('border-stone-450');
  });

  it('dòng tiêu đề và huy hiệu xuống dòng được ở 390px; yêu cầu đã xử lý hiện ghi chú admin', async () => {
    const { container } = await openReturns();
    const head = badge(container, 'Chờ duyệt').parentElement!;
    expect(head.className).toContain('flex-wrap');
    expect(container.textContent).toContain('Ghi chú admin: Đã kiểm tra');
  });
});

describe('admin/page — tab Người dùng', () => {
  const openUsers = async () => {
    window.history.replaceState(null, '', '/admin?tab=users');
    return mount();
  };

  it('bảng người dùng: ô dữ liệu có đệm ngang như ô tiêu đề, bảng cuộn ngang trong khung riêng', async () => {
    const { container } = await openUsers();
    const table = container.querySelector('table')!;
    expect(table.parentElement!.className).toContain('overflow-x-auto');
    const cells = [...table.querySelectorAll('tbody td')];
    expect(cells.map((c) => c.textContent)).toEqual(['Nguyễn An', '0944444444', 'Khách hàng', '12', '01/09/2026', 'Khoá']);
    for (const c of cells) expect(c.className).toContain('px-3');
  });

  // ADMINOPS-11: trước đây không tìm được người dùng (listUsers chỉ gửi page) và không có cách khoá tài khoản gian lận.
  it('ô tìm kiếm gửi từ khoá lên API và quay về trang 1; Xóa lọc bỏ từ khoá', async () => {
    mocks.listUsersArgs = [];
    const { container } = await openUsers();
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Tìm theo SĐT, tên hoặc mã người dùng');
    typeInto(input, ' 0944 ');
    act(() => (container.querySelector('form[role="search"]') as HTMLFormElement).requestSubmit());
    await flush();
    expect(mocks.listUsersArgs.at(-1)).toEqual([1, '0944']);
    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Xóa lọc')!;
    act(() => clear.click());
    await flush();
    expect(mocks.listUsersArgs.at(-1)).toEqual([1, undefined]);
  });

  it('khoá người dùng: bắt buộc nhập lý do trong hộp thoại, gửi đúng id + lý do, báo thành công', async () => {
    mocks.blockUser.mockReset().mockResolvedValue({ id: 'u1', isBlocked: true, blockedAt: null, blockedReason: 'Bom hàng COD', revokedSessions: 2 });
    const { container } = await openUsers();
    const btn = container.querySelector('button[aria-label="Khoá Nguyễn An"]') as HTMLButtonElement;
    act(() => btn.click());
    await flush();
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Khoá Nguyễn An (0944444444)?');
    const accept = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Khoá tài khoản')!;
    expect(accept.disabled).toBe(true);
    typeInto(dialog.querySelector('textarea'), 'Bom hàng COD');
    expect(accept.disabled).toBe(false);
    act(() => accept.click());
    await flush();
    expect(mocks.blockUser).toHaveBeenCalledWith('u1', 'Bom hàng COD');
    const ok = container.querySelector('p[role="status"]')!;
    expect(ok.textContent).toContain('Đã khoá Nguyễn An');
    expect(ok.className).toContain('text-success-fg');
  });

  it('người dùng đã khoá: hiện nhãn Đã khoá + lý do, nút Mở khoá qua hộp xác nhận', async () => {
    mocks.users = [
      { id: 'u3', fullName: 'Trần Cường', phone: '0966666666', role: 'CUSTOMER', pointsBalance: 0, createdAt: '2026-09-03T00:00:00.000Z', isBlocked: true, blockedReason: 'Farm voucher' },
    ];
    mocks.unblockUser.mockReset().mockResolvedValue({ id: 'u3', isBlocked: false, blockedAt: null, blockedReason: null });
    const { container } = await openUsers();
    const status = container.querySelectorAll('table tbody td')[5]!;
    expect(status.textContent).toContain('Đã khoá');
    expect(status.textContent).toContain('Lý do: Farm voucher');
    act(() => (container.querySelector('button[aria-label="Mở khoá Trần Cường"]') as HTMLButtonElement).click());
    await flush();
    const accept = [...document.body.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === 'Mở khoá')!;
    act(() => (accept as HTMLButtonElement).click());
    await flush();
    expect(mocks.unblockUser).toHaveBeenCalledWith('u3');
  });

  it('khoá thất bại (vd tự khoá mình) → báo lỗi màu danger, không nuốt lỗi', async () => {
    mocks.blockUser.mockReset().mockRejectedValue(new Error('Không thể tự khoá tài khoản của chính mình.'));
    const { container } = await openUsers();
    act(() => (container.querySelector('button[aria-label^="Khoá "]') as HTMLButtonElement).click());
    await flush();
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    typeInto(dialog.querySelector('textarea'), 'thử');
    act(() => ([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Khoá tài khoản') as HTMLButtonElement).click());
    await flush();
    const bad = container.querySelector('p[role="status"]')!;
    expect(bad.textContent).toBe('Không thể tự khoá tài khoản của chính mình.');
    expect(bad.className).toContain('text-danger-fg');
  });

  it('PD-3: khách có điểm quy đổi → ô Điểm là tổng hai lô kèm phần không hết hạn, để nhân viên xử lý khiếu nại quy đổi', async () => {
    mocks.users = [
      { id: 'u2', fullName: 'Lê Bình', phone: '0955555555', role: 'CUSTOMER', pointsBalance: 5, pointsConvertedBalance: 30, createdAt: '2026-09-02T00:00:00.000Z' },
    ];
    const { container } = await openUsers();
    const pointsCell = container.querySelectorAll('table tbody td')[3]!;
    expect(pointsCell.textContent).toContain('35');
    expect(pointsCell.textContent).toContain('trong đó 30 điểm không hết hạn');
  });

  it('nút Xuất CSV người dùng dùng icon lucide (không emoji) và giữ nhãn', async () => {
    const { container } = await openUsers();
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Xuất CSV người dùng'))!;
    expect(btn.textContent?.trim()).toBe('Xuất CSV người dùng');
    expect(btn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(btn.className).toContain('min-h-[44px]');
  });

  it('phân trang: Tổng số, nhãn Trang trước/sau giữ nguyên, nút cao 44px, thanh xuống dòng được', async () => {
    const { container } = await openUsers();
    const next = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Trang sau →')!;
    const prev = [...container.querySelectorAll('button')].find((b) => b.textContent === '← Trang trước')!;
    expect(prev.disabled).toBe(true);
    expect(next.className).toContain('min-h-[44px]');
    expect(next.parentElement!.parentElement!.className).toContain('flex-wrap');
    expect(container.textContent).toContain('Tổng số: 45 người dùng');
  });

  it('form cấp quyền: nút Cấp quyền khoá khi chưa có SĐT; thành công báo màu success, lỗi báo màu danger', async () => {
    const { container } = await openUsers();
    const grant = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cấp quyền')!;
    expect(grant.disabled).toBe(true);
    expect(grant.className).toContain('bg-forest-600');
    expect(grant.className).toContain('min-h-[44px]');
    const phone = container.querySelector('input[placeholder^="SĐT"]') as HTMLInputElement;
    expect(phone.className).toContain('border-stone-450');
    typeInto(phone, '0955555555');
    expect(grant.disabled).toBe(false);

    mocks.setUserRole.mockResolvedValueOnce({ id: 'u9', phone: '0955555555', previousRole: 'CUSTOMER', role: 'CUSTOMER' });
    act(() => grant.click());
    await flush();
    const ok = [...container.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Đã đổi'))!;
    expect(ok.className).toContain('text-success-fg');

    typeInto(phone, '0966666666');
    mocks.setUserRole.mockRejectedValueOnce(new Error('Không tìm thấy SĐT'));
    act(() => grant.click());
    await flush();
    const bad = [...container.querySelectorAll('p')].find((p) => p.textContent === 'Không tìm thấy SĐT')!;
    expect(bad.className).toContain('text-danger-fg');
    expect(mocks.setUserRole).toHaveBeenCalledTimes(2);
  });

  it('cấp quyền ADMIN vẫn phải qua hộp xác nhận: chưa xác nhận thì không gọi API', async () => {
    const { container } = await openUsers();
    const roleSelect = container.querySelector('select[class*="min-h-[44px]"]') as HTMLSelectElement;
    expect([...roleSelect.options].map((o) => o.value)).toEqual(['CUSTOMER', 'AFFILIATE', 'DEALER', 'STAFF', 'ADMIN']);
    selectValue(roleSelect, 'ADMIN');
    typeInto(container.querySelector('input[placeholder^="SĐT"]'), '0977777777');
    const grant = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cấp quyền')!;
    act(() => grant.click());
    await flush();
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]');
    expect(dialog?.textContent).toContain('Cấp quyền ADMIN (toàn quyền quản trị) cho SĐT 0977777777?');
    expect(mocks.setUserRole).not.toHaveBeenCalled();
    const cancel = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Huỷ')!;
    act(() => cancel.click());
    await flush();
    expect(mocks.setUserRole).not.toHaveBeenCalled();
  });
});

describe('admin/page — tab Cấu hình', () => {
  const openConfig = async () => {
    window.history.replaceState(null, '', '/admin?tab=config');
    return mount();
  };

  it('khối "Tất cả tham số" dùng tiêu đề Fraunces, chữ phụ stone-500 và liệt kê từng khoá cấu hình', async () => {
    mocks.config = [{ key: 'shipping.freeThreshold', value: 500000, description: 'Ngưỡng miễn phí vận chuyển', category: 'shipping' }];
    const { container } = await openConfig();
    const h3 = [...container.querySelectorAll('h2')].find((h) => h.textContent === 'Tất cả tham số (JSON)')!;
    expect(h3.className).toContain('font-display');
    expect(h3.nextElementSibling!.className).toContain('text-stone-500');
    expect(container.textContent).toContain('shipping.freeThreshold');
  });

  it('lỗi tải cấu hình báo bằng màu danger và không dựng các thẻ cấu hình', async () => {
    mocks.configFails = true;
    const { container } = await openConfig();
    const err = [...container.querySelectorAll('p')].find((p) => p.textContent === 'Không tải được danh sách cấu hình.')!;
    expect(err.className).toContain('text-danger-fg');
    expect(container.querySelector('h2')).toBeNull();
  });

  describe('key của danh sách tham số (cảnh báo React "two children with the same key")', () => {
    const duplicateKeyWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
      spy.mock.calls.filter((c) => /same key/i.test(String(c[0]))).map((c) => String(c[0]));

    it('107 dòng cấu hình đúng hình dạng API thật dựng xong mà không có console.error nào', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        mocks.config = ADMIN_CONFIG_ROWS;
        const { container } = await openConfig();
        expect(new Set(ADMIN_CONFIG_ROWS.map((r) => r.key)).size).toBe(ADMIN_CONFIG_ROWS.length);
        expect(container.textContent).toContain(ADMIN_CONFIG_ROWS[ADMIN_CONFIG_ROWS.length - 1]!.key);
        expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });

    it('bắt được cảnh báo khi API trả hai dòng trùng key và trùng giá trị (kiểm chứng bộ bắt console.error)', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const dup = ADMIN_CONFIG_ROWS[0]!;
        mocks.config = [dup, ...ADMIN_CONFIG_ROWS.slice(0, 3)];
        await openConfig();
        expect(duplicateKeyWarnings(spy)).not.toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

describe('admin/page — tab Voucher', () => {
  const openCoupons = async () => {
    window.history.replaceState(null, '', '/admin?tab=coupons');
    return mount();
  };

  it('ô nhập cao 44px ở điện thoại với viền đủ tương phản, co được trong hàng flex để không tràn ngang', async () => {
    const { container } = await openCoupons();
    const inputs = [...container.querySelector('[data-testid="coupon-create-form"]')!.querySelectorAll('input, select')];
    expect(inputs).toHaveLength(9);
    for (const el of inputs) {
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('border-stone-450');
      expect(el.className).toContain('min-w-0');
    }
  });

  it('Tạo voucher khoá tới khi có mã, gửi đúng dữ liệu; thành công báo success, lỗi báo danger', async () => {
    const { container } = await openCoupons();
    const create = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Tạo voucher')!;
    expect(create.disabled).toBe(true);
    expect(create.className).toContain('bg-forest-600');
    expect(create.className).toContain('min-h-[44px]');
    typeInto(container.querySelector('input[placeholder^="Mã"]'), 'WELCOME30');
    expect(create.disabled).toBe(false);

    mocks.createCoupon.mockResolvedValueOnce({});
    act(() => create.click());
    await flush();
    expect(mocks.createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WELCOME30', type: 'PERCENT', value: 10, perUserLimit: 1, scope: 'PUBLIC' }),
    );
    const ok = [...container.querySelectorAll('p')].find((p) => p.textContent === 'Đã tạo voucher!')!;
    expect(ok.className).toContain('text-success-fg');

    mocks.createCoupon.mockRejectedValueOnce(new Error('Mã đã tồn tại'));
    act(() => create.click());
    await flush();
    const bad = [...container.querySelectorAll('p')].find((p) => p.textContent === 'Mã đã tồn tại')!;
    expect(bad.className).toContain('text-danger-fg');
  });

  it('ADMINOPS-7: ô Mã tự đổi chữ HOA và bỏ khoảng trắng (khách luôn gửi mã dạng HOA)', async () => {
    const { container } = await openCoupons();
    const codeInput = container.querySelector<HTMLInputElement>('input[placeholder^="Mã"]')!;
    typeInto(codeInput, ' summer 10 ');
    expect(codeInput.value).toBe('SUMMER10');
    mocks.createCoupon.mockResolvedValueOnce({});
    act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Tạo voucher')!.click());
    await flush();
    expect(mocks.createCoupon).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUMMER10' }));
  });
});

const btn = (root: ParentNode, label: RegExp | string) =>
  [...root.querySelectorAll('button')].find((b) =>
    typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''),
  ) as HTMLButtonElement;
const para = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('p, span')].find((p) => p.textContent === text) as HTMLElement;

describe('admin/page — tab Nhãn hàng', () => {
  const BRAND = {
    id: 'b1',
    slug: 'dua-ben-tre',
    name: 'Dừa Bến Tre',
    tagline: 'Ngọt thanh',
    logoUrl: null,
    coverUrl: null,
    story: null,
    origin: 'Bến Tre',
    certifications: [{ code: 'ORG', label: 'Hữu cơ', proofUrl: 'https://p.test/x', verified: true }],
    isVerified: true,
    isPublished: false,
    followerCount: 5,
  };
  const openBrands = async () => {
    window.history.replaceState(null, '', '/admin?tab=brands');
    return mount();
  };
  const openRow = async (container: HTMLElement) => {
    click(btn(container, 'Quản lý'));
    await flush();
  };

  it('form tạo nhãn: ô nhập/nút cao 44px, khoá tới khi có tên, gửi đúng dữ liệu', async () => {
    const { container } = await openBrands();
    const create = btn(container, 'Tạo nhãn');
    expect(create.disabled).toBe(true);
    expect(create.className).toContain('bg-forest-600');
    expect(create.className).toContain('min-h-[44px]');
    const name = container.querySelector('input[placeholder^="Tên nhãn"]')!;
    const tagline = container.querySelector('input[placeholder="Tagline"]')!;
    for (const el of [name, tagline]) {
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('border-stone-450');
    }
    typeInto(name, '  Dừa Bến Tre ');
    expect(create.disabled).toBe(false);
    mocks.createBrand.mockResolvedValueOnce({});
    click(create);
    await flush();
    expect(mocks.createBrand).toHaveBeenCalledWith({ name: 'Dừa Bến Tre', tagline: undefined });
  });

  it('hàng nhãn: Chính hãng có biểu tượng thay dấu chữ và tông success, Nháp tông trung tính', async () => {
    mocks.brands = [BRAND];
    const { container } = await openBrands();
    const verified = [...container.querySelectorAll('span')].find((e) => e.textContent?.includes('Chính hãng'))!;
    expect(verified.querySelector('svg')).not.toBeNull();
    expect(verified.textContent).not.toContain('✓');
    expect(verified.className).toContain('bg-success-bg');
    expect(verified.className).toContain('text-success-fg');
    const draft = para(container, 'Nháp');
    expect(draft.className).toContain('bg-stone-100');
    expect(container.textContent).toContain('/dua-ben-tre · 5 theo dõi');
    const manage = btn(container, 'Quản lý');
    expect(manage.className).toContain('min-h-[44px]');
    expect(manage.className).toContain('text-forest-700');
  });

  it('mở Quản lý: nút nghiệp vụ gọi đúng API, gán chủ nhãn khoá tới khi chọn người', async () => {
    mocks.brands = [BRAND];
    mocks.brandProducts = [{ id: 'p1', name: 'Dừa sáp', slug: 'dua-sap', thumbnail: null, brand: 'Dừa Bến Tre', isActive: true }];
    const { container } = await openBrands();
    await openRow(container);
    expect(btn(container, 'Thu gọn')).toBeTruthy();

    const publish = btn(container, 'Đăng (publish)');
    expect(publish.className).toContain('min-h-[44px]');
    mocks.updateBrand.mockResolvedValue({});
    click(publish);
    await flush();
    expect(mocks.updateBrand).toHaveBeenCalledWith('b1', { isPublished: true });

    const verify = btn(container, /Bỏ chính hãng/);
    mocks.verifyBrand.mockResolvedValue({});
    click(verify);
    await flush();
    expect(mocks.verifyBrand).toHaveBeenCalledWith('b1', false);

    const link = btn(container, 'Gán SP theo tên nhãn');
    expect(link.className).toContain('bg-forest-600');
    expect(link.className).toContain('min-h-[44px]');

    const assign = btn(container, 'Gán chủ nhãn');
    expect(assign.disabled).toBe(true);
    expect(assign.className).toContain('min-h-[44px]');
    expect(assign.className).toContain('border-stone-450');

    const detach = btn(container, 'Gỡ');
    expect(detach.className).toContain('text-danger-fg');
    expect(detach.className).toContain('min-h-[44px]');
    mocks.detachBrandProducts.mockResolvedValue({});
    click(detach);
    await flush();
    expect(mocks.detachBrandProducts).toHaveBeenCalledWith('b1', ['p1']);
  });

  it('nút Cấp chính hãng dùng biểu tượng, nhãn nút khi chưa xác minh vẫn đọc là "Cấp chính hãng"', async () => {
    mocks.brands = [{ ...BRAND, isVerified: false }];
    const { container } = await openBrands();
    await openRow(container);
    const grant = btn(container, /^Cấp\s+chính hãng$/);
    expect(grant.querySelector('svg')).not.toBeNull();
    expect(grant.textContent).not.toContain('✓');
    mocks.verifyBrand.mockResolvedValue({});
    click(grant);
    await flush();
    expect(mocks.verifyBrand).toHaveBeenCalledWith('b1', true);
  });

  it('khuyến mãi: thêm khoá tới khi có tiêu đề, xoá gọi đúng API, ô nhập cao 44px', async () => {
    mocks.brands = [BRAND];
    mocks.promotions = [{ id: 'pm1', title: 'MUA 2 TẶNG 1', subtitle: 'Hè', startAt: '', endAt: '', isActive: true }];
    const { container } = await openBrands();
    await openRow(container);
    expect(container.textContent).toContain('MUA 2 TẶNG 1 · Hè');
    const add = btn(container, 'Thêm KM');
    expect(add.disabled).toBe(true);
    expect(add.className).toContain('bg-forest-600');
    const title = container.querySelector('input[placeholder^="Tiêu đề (MUA"]')!;
    expect(title.className).toContain('min-h-[44px]');
    for (const d of container.querySelectorAll('input[type="date"]')) expect(d.className).toContain('min-h-[44px]');
    typeInto(title, 'Freeship');
    expect(add.disabled).toBe(false);
    mocks.createPromotion.mockResolvedValue({});
    click(add);
    await flush();
    expect(mocks.createPromotion).toHaveBeenCalledWith('b1', expect.objectContaining({ title: 'Freeship', subtitle: undefined }));

    const row = [...container.querySelectorAll('span')].find((e) => e.textContent === 'MUA 2 TẶNG 1 · Hè')!.parentElement!;
    const del = btn(row, 'Xoá');
    expect(del.className).toContain('text-danger-fg');
    mocks.deletePromotion.mockResolvedValue({});
    click(del);
    await flush();
    expect(mocks.deletePromotion).toHaveBeenCalledWith('pm1');
  });

  it('thông tin nhãn: lưu gửi đúng dữ liệu, thông báo thành công dùng biểu tượng + success, lỗi báo danger', async () => {
    mocks.brands = [BRAND];
    const { container } = await openBrands();
    await openRow(container);
    const panel = btn(container, 'Lưu thông tin').parentElement!.parentElement!;
    expect(panel.className).toContain('bg-stone-50');
    const tagline = panel.querySelector('input[placeholder="Tagline"]') as HTMLInputElement;
    expect(tagline.className).toContain('min-h-[44px]');
    typeInto(tagline, 'Ngọt đậm');
    mocks.updateBrand.mockResolvedValueOnce({});
    click(btn(container, 'Lưu thông tin'));
    await flush();
    expect(mocks.updateBrand).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        tagline: 'Ngọt đậm',
        certifications: [{ code: 'ORG', label: 'Hữu cơ', proofUrl: 'https://p.test/x', verified: true }],
      }),
    );
    const ok = [...container.querySelectorAll('span')].find((e) => e.textContent?.startsWith('Đã lưu'))!;
    expect(ok.className).toContain('text-success-fg');
    expect(ok.querySelector('svg')).not.toBeNull();
    expect(ok.textContent).not.toContain('✓');

    mocks.updateBrand.mockRejectedValueOnce(new Error('Slug trùng'));
    click(btn(container, 'Lưu thông tin'));
    await flush();
    expect(para(container, 'Slug trùng').className).toContain('text-danger-fg');
  });

  it('chứng nhận: dòng nhập cao 44px, Xoá/Thêm chứng nhận là nút chữ 44px', async () => {
    mocks.brands = [BRAND];
    const { container } = await openBrands();
    await openRow(container);
    const code = container.querySelector('input[placeholder="Mã (ORG)"]')!;
    expect(code.className).toContain('min-h-[44px]');
    const add = btn(container, '+ Thêm chứng nhận');
    expect(add.className).toContain('text-forest-700');
    expect(add.className).toContain('min-h-[44px]');
    const checkbox = container.querySelector('input[type="checkbox"]')!;
    expect(checkbox.className).toContain('accent-forest-600');
    expect(checkbox.closest('label')!.className).toContain('min-h-[44px]');
  });

  it('chương trình đại lý: tiêu đề dùng biểu tượng thay emoji, thêm/xoá gọi đúng API', async () => {
    mocks.rewards = [
      { id: 'r1', brandId: null, type: 'TOUR', title: 'Tour Phú Quốc', description: null, threshold: 50_000_000, period: 'QUARTER', isActive: true },
    ];
    const { container } = await openBrands();
    const heading = [...container.querySelectorAll('div')].find((d) => d.textContent === 'Chương trình đại lý (thưởng doanh số)')!;
    expect(heading.querySelector('svg')).not.toBeNull();
    expect(heading.className).toContain('font-display');
    const section = heading.parentElement!;
    expect(section.className).toContain('rounded-card');

    const del = btn(section, 'Xoá');
    expect(del.className).toContain('text-danger-fg');
    mocks.deleteDealerReward.mockResolvedValue({});
    click(del);
    await flush();
    expect(mocks.deleteDealerReward).toHaveBeenCalledWith('r1');

    const add = btn(section, 'Thêm');
    expect(add.disabled).toBe(true);
    expect(add.className).toContain('bg-forest-600');
    for (const el of section.querySelectorAll('input, select')) expect(el.className).toContain('min-h-[44px]');
    typeInto(section.querySelector('input[placeholder^="Tiêu đề"]'), 'Tour Đà Lạt');
    mocks.createDealerReward.mockResolvedValue({});
    click(add);
    await flush();
    expect(mocks.createDealerReward).toHaveBeenCalledWith({
      type: 'TOUR',
      title: 'Tour Đà Lạt',
      description: undefined,
      threshold: 50_000_000,
      period: 'QUARTER',
    });
  });
});

const labelledInput = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))?.querySelector('input') as HTMLInputElement;

describe('admin/page — tab Flash Sale', () => {
  const SALE = {
    id: 's1',
    title: 'Flash Sale cuối tuần',
    startAt: '2026-10-17T01:00:00.000Z',
    endAt: '2026-10-18T16:00:00.000Z',
    isActive: true,
    items: [{ id: 'i1', variationId: 'v1', flashPrice: 99000, quota: 20, soldCount: 3, perUserLimit: 2 }],
  };
  const openSales = async () => {
    window.history.replaceState(null, '', '/admin?tab=flashSales');
    return mount();
  };

  it('form tạo đợt: ô nhập/nút 44px, khoá tới khi đủ tên + 2 mốc giờ, gửi mốc giờ ISO; báo success/danger', async () => {
    const { container } = await openSales();
    const heading = container.querySelector('h2')!;
    expect(heading.className).toContain('font-display');
    const inputs = [...container.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    for (const el of inputs) {
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('border-stone-450');
    }
    expect(labelledInput(container, 'Tên đợt')).toBe(inputs[0]);
    expect(labelledInput(container, 'Bắt đầu lúc')).toBe(inputs[1]);
    expect(labelledInput(container, 'Kết thúc lúc')).toBe(inputs[2]);
    const create = btn(container, 'Tạo đợt');
    expect(create.className).toContain('bg-forest-600');
    expect(create.disabled).toBe(true);
    typeInto(inputs[0]!, 'Đợt mới');
    typeInto(inputs[1]!, '2026-10-20T08:00');
    expect(create.disabled).toBe(true);
    typeInto(inputs[2]!, '2026-10-21T08:00');
    expect(create.disabled).toBe(false);

    mocks.createFlashSale.mockResolvedValueOnce({});
    click(create);
    await flush();
    expect(mocks.createFlashSale).toHaveBeenCalledWith({
      title: 'Đợt mới',
      startAt: new Date('2026-10-20T08:00').toISOString(),
      endAt: new Date('2026-10-21T08:00').toISOString(),
    });
    expect(para(container, 'Đã tạo đợt flash sale!').className).toContain('text-success-fg');

    typeInto(inputs[0]!, 'Đợt hai');
    typeInto(inputs[1]!, '2026-10-20T08:00');
    typeInto(inputs[2]!, '2026-10-21T08:00');
    mocks.createFlashSale.mockRejectedValueOnce(new Error('Trùng khung giờ'));
    click(create);
    await flush();
    expect(para(container, 'Trùng khung giờ').className).toContain('text-danger-fg');
  });

  it('hàng đợt: huy hiệu bật/tắt theo tông success/trung tính, nút Tắt gọi đúng API, cao 44px', async () => {
    mocks.flashSales = [SALE, { ...SALE, id: 's2', title: 'Đợt cũ', isActive: false, items: [] }];
    const { container } = await openSales();
    const on = para(container, 'Đang bật');
    expect(on.className).toContain('bg-success-bg');
    const off = para(container, 'Đang tắt');
    expect(off.className).toContain('bg-stone-100');
    const toggle = btn(container, 'Tắt');
    expect(toggle.className).toContain('min-h-[44px]');
    expect(toggle.className).toContain('border-stone-450');
    mocks.updateFlashSale.mockResolvedValue({});
    click(toggle);
    await flush();
    expect(mocks.updateFlashSale).toHaveBeenCalledWith('s1', { isActive: false });
    expect(btn(container, 'Bật')).toBeTruthy();
    expect(container.textContent).toContain('Chưa có sản phẩm nào trong đợt này.');
  });

  it('sản phẩm trong đợt: dòng ngắt chữ được, Xoá là nút chữ danger 44px, thêm SP khoá tới khi chọn biến thể', async () => {
    mocks.flashSales = [SALE];
    const { container } = await openSales();
    expect(container.textContent).toContain('đã bán 3/20 · giới hạn 2/khách');
    const del = btn(container, 'Xoá');
    expect(del.className).toContain('text-danger-fg');
    expect(del.className).toContain('min-h-[44px]');
    mocks.deleteFlashSaleItem.mockResolvedValue({});
    click(del);
    await flush();
    expect(mocks.deleteFlashSaleItem).toHaveBeenCalledWith('i1');

    const add = btn(container, 'Thêm SP');
    expect(add.disabled).toBe(true);
    expect(add.className).toContain('bg-forest-600');
    for (const label of ['Giá flash (đ)', 'Số lượng bán (quota)', 'Giới hạn mỗi khách']) {
      const el = labelledInput(container, label);
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('min-w-0');
    }
    const hint = para(container, 'Gõ tên sản phẩm (không cần dấu) hoặc SKU rồi chọn đúng biến thể.');
    expect(hint.className).toContain('text-stone-500');
  });
});

describe('admin/page — tab Flash Sale: nhập liệu rõ ràng, sửa và xoá đợt (R2-ENGAGE-13)', () => {
  const upcoming = (over: Record<string, unknown> = {}) => ({
    id: 's9',
    title: 'Đợt sắp tới',
    startAt: new Date(Date.now() + 3 * 864e5).toISOString(),
    endAt: new Date(Date.now() + 4 * 864e5).toISOString(),
    isActive: true,
    items: [],
    ...over,
  });
  const openSales = async () => {
    window.history.replaceState(null, '', '/admin?tab=flashSales');
    return mount();
  };
  const localInput = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const pickVariation = async (container: HTMLElement) => {
    mocks.productSearch = [
      { id: 'p1', name: 'Nước rửa chén', brand: 'Tubu', isActive: true, variations: [{ id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', price: 80_000, stock: 50, isActive: true }] },
    ];
    typeInto(container.querySelector('input[type="search"]'), 'nuoc');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await flush();
    click(container.querySelector('[role="option"]'));
  };

  it('ô thêm sản phẩm có nhãn Giá flash / Số lượng bán (quota) / Giới hạn mỗi khách và bắt đầu RỖNG, không phải 0', async () => {
    mocks.flashSales = [upcoming()];
    const { container } = await openSales();
    for (const label of ['Giá flash (đ)', 'Số lượng bán (quota)', 'Giới hạn mỗi khách']) {
      const el = labelledInput(container, label);
      expect(el, label).toBeTruthy();
      expect(el.value).toBe('');
    }
  });

  it('Thêm SP khoá tới khi chọn biến thể và nhập giá flash + quota > 0; gửi đúng số, giới hạn bỏ trống = mặc định', async () => {
    mocks.flashSales = [upcoming()];
    const { container } = await openSales();
    const add = btn(container, 'Thêm SP');
    await pickVariation(container);
    expect(add.disabled).toBe(true);
    typeInto(labelledInput(container, 'Giá flash (đ)'), '59000');
    expect(add.disabled).toBe(true);
    typeInto(labelledInput(container, 'Số lượng bán (quota)'), '20');
    expect(add.disabled).toBe(false);
    mocks.addFlashSaleItem.mockResolvedValue({});
    click(add);
    await flush();
    expect(mocks.addFlashSaleItem).toHaveBeenCalledWith('s9', { variationId: 'v1', flashPrice: 59000, quota: 20, perUserLimit: undefined });
    expect(labelledInput(container, 'Giá flash (đ)').value).toBe('');
    expect(labelledInput(container, 'Số lượng bán (quota)').value).toBe('');
  });

  it('Sửa đợt: điền sẵn tên + giờ, chỉ gửi trường đã đổi (sửa tên không đụng tới giờ)', async () => {
    const sale = upcoming();
    mocks.flashSales = [sale];
    const { container } = await openSales();
    click(btn(container, 'Sửa đợt'));
    const title = labelledInput(container, 'Tên đợt (sửa)');
    expect(title.value).toBe('Đợt sắp tới');
    expect(labelledInput(container, 'Bắt đầu lúc (sửa)').value).toBe(localInput(sale.startAt));
    expect(labelledInput(container, 'Kết thúc lúc (sửa)').value).toBe(localInput(sale.endAt));
    expect(btn(container, 'Lưu thay đổi').disabled).toBe(true);
    typeInto(title, 'Đợt sắp tới (đã sửa)');
    mocks.updateFlashSale.mockResolvedValue({});
    click(btn(container, 'Lưu thay đổi'));
    await flush();
    expect(mocks.updateFlashSale).toHaveBeenCalledWith('s9', { title: 'Đợt sắp tới (đã sửa)' });
  });

  it('Sửa đợt: đổi giờ bắt đầu gửi mốc ISO; Huỷ đóng form không gọi API', async () => {
    mocks.flashSales = [upcoming()];
    const { container } = await openSales();
    click(btn(container, 'Sửa đợt'));
    typeInto(labelledInput(container, 'Bắt đầu lúc (sửa)'), '2031-01-02T08:30');
    mocks.updateFlashSale.mockResolvedValue({});
    click(btn(container, 'Lưu thay đổi'));
    await flush();
    expect(mocks.updateFlashSale).toHaveBeenCalledWith('s9', { startAt: new Date('2031-01-02T08:30').toISOString() });

    click(btn(container, 'Sửa đợt'));
    click(btn(container, 'Huỷ sửa'));
    expect(labelledInput(container, 'Tên đợt (sửa)')).toBeFalsy();
    expect(mocks.updateFlashSale).toHaveBeenCalledTimes(1);
  });

  it('Sửa đợt đang chạy: khoá ô giờ bắt đầu (API từ chối), vẫn sửa được tên và giờ kết thúc (R3-UI-5)', async () => {
    mocks.flashSales = [upcoming({ id: 's1', title: 'Đợt đang chạy', startAt: new Date(Date.now() - 3600e3).toISOString() })];
    const { container } = await openSales();
    click(btn(container, 'Sửa đợt'));
    expect(labelledInput(container, 'Bắt đầu lúc (sửa)').disabled).toBe(true);
    expect(container.textContent).toContain('Đợt đã bắt đầu: không đổi được giờ bắt đầu');
    expect(labelledInput(container, 'Kết thúc lúc (sửa)').disabled).toBe(false);
    typeInto(labelledInput(container, 'Tên đợt (sửa)'), 'Đợt đang chạy (đổi tên)');
    mocks.updateFlashSale.mockResolvedValue({});
    click(btn(container, 'Lưu thay đổi'));
    await flush();
    expect(mocks.updateFlashSale).toHaveBeenCalledWith('s1', { title: 'Đợt đang chạy (đổi tên)' });
  });

  it('Sửa đợt chưa bắt đầu: ô giờ bắt đầu mở, không có lời nhắc khoá', async () => {
    mocks.flashSales = [upcoming()];
    const { container } = await openSales();
    click(btn(container, 'Sửa đợt'));
    expect(labelledInput(container, 'Bắt đầu lúc (sửa)').disabled).toBe(false);
    expect(container.textContent).not.toContain('không đổi được giờ bắt đầu');
  });

  it('Xoá đợt: chỉ có với đợt CHƯA bắt đầu, hỏi xác nhận rồi mới gọi API', async () => {
    mocks.flashSales = [upcoming(), upcoming({ id: 's1', title: 'Đợt đang chạy', startAt: new Date(Date.now() - 3600e3).toISOString() })];
    const { container } = await openSales();
    const deletes = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Xoá đợt');
    expect(deletes).toHaveLength(1);
    mocks.deleteFlashSale.mockResolvedValue({ ok: true });
    click(deletes[0]!);
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Đợt sắp tới');
    expect(mocks.deleteFlashSale).not.toHaveBeenCalled();
    act(() => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Xoá đợt')!.click());
    await flush();
    expect(mocks.deleteFlashSale).toHaveBeenCalledWith('s9');
  });

  it('Xoá đợt: bấm Giữ lại ở hộp xác nhận thì không xoá', async () => {
    mocks.flashSales = [upcoming()];
    const { container } = await openSales();
    click(btn(container, 'Xoá đợt'));
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    act(() => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Giữ lại')!.click());
    await flush();
    expect(mocks.deleteFlashSale).not.toHaveBeenCalled();
  });
});

describe('admin/page — tab Câu hỏi thường gặp', () => {
  const FAQ = { id: 'f1', category: 'Vận chuyển', question: 'Ship bao lâu?', answer: '2-3 ngày', sortOrder: 2, isActive: true };
  const openFaqs = async () => {
    window.history.replaceState(null, '', '/admin?tab=faqs');
    return mount();
  };

  it('form thêm: tiêu đề font-display, ghi chú stone-500, ô nhập 44px, khoá tới khi có câu hỏi + trả lời, gửi đúng dữ liệu', async () => {
    const { container } = await openFaqs();
    expect(container.querySelector('h2')!.className).toContain('font-display');
    expect(para(container, 'Nội dung này cũng được nạp vào ngữ cảnh của AI tư vấn để trả lời nhất quán.').className).toContain('text-stone-500');
    const fields = [...container.querySelectorAll('input')];
    expect(fields).toHaveLength(3);
    for (const el of fields) {
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('border-stone-450');
    }
    const add = btn(container, 'Thêm câu hỏi');
    expect(add.className).toContain('bg-forest-600');
    expect(add.disabled).toBe(true);
    typeInto(container.querySelector('input[placeholder="Câu hỏi"]'), ' Đổi trả thế nào? ');
    expect(add.disabled).toBe(true);
    typeInto(container.querySelector('textarea'), '7 ngày');
    expect(add.disabled).toBe(false);
    mocks.createFaq.mockResolvedValueOnce({});
    click(add);
    await flush();
    expect(mocks.createFaq).toHaveBeenCalledWith({ category: undefined, question: 'Đổi trả thế nào?', answer: '7 ngày', sortOrder: 0 });
    expect(para(container, 'Đã thêm câu hỏi thường gặp!').className).toContain('text-success-fg');

    typeInto(container.querySelector('input[placeholder="Câu hỏi"]'), 'Q');
    typeInto(container.querySelector('textarea'), 'A');
    mocks.createFaq.mockRejectedValueOnce(new Error('Trùng câu hỏi'));
    click(add);
    await flush();
    expect(para(container, 'Trùng câu hỏi').className).toContain('text-danger-fg');
  });

  it('hàng câu hỏi: chip nhóm trung tính, huy hiệu hiện/ẩn theo tông, ba nút chữ 44px gọi đúng API', async () => {
    mocks.faqs = [FAQ];
    const { container } = await openFaqs();
    const chip = para(container, 'Vận chuyển');
    expect(chip.className).toContain('bg-stone-100');
    expect(para(container, 'Đang hiện').className).toContain('bg-success-bg');
    expect(para(container, 'thứ tự 2').className).toContain('text-stone-500');

    const edit = btn(container, 'Sửa');
    const hide = btn(container, 'Ẩn');
    const del = btn(container, 'Xoá');
    for (const b of [edit, hide, del]) expect(b.className).toContain('min-h-[44px]');
    expect(edit.className).toContain('text-forest-700');
    expect(hide.className).toContain('text-stone-600');
    expect(del.className).toContain('text-danger-fg');

    mocks.updateFaq.mockResolvedValue({});
    click(hide);
    await flush();
    expect(mocks.updateFaq).toHaveBeenCalledWith('f1', { isActive: false });
    mocks.deleteFaq.mockResolvedValue({ ok: true });
    click(del);
    await flush();
    expect(mocks.deleteFaq).toHaveBeenCalledWith('f1');
  });

  it('form sửa: mở bằng Sửa, ô nhập 44px, Lưu gửi đúng dữ liệu, lỗi báo danger', async () => {
    mocks.faqs = [FAQ];
    const { container } = await openFaqs();
    click(btn(container, 'Sửa'));
    expect(btn(container, 'Đóng')).toBeTruthy();
    const q = container.querySelector('input[value="Ship bao lâu?"]') as HTMLInputElement;
    expect(q.className).toContain('min-h-[44px]');
    expect(container.querySelector('textarea')!.className).toContain('border-stone-450');
    typeInto(q, 'Ship mấy ngày?');
    const save = btn(container, 'Lưu');
    expect(save.className).toContain('bg-forest-600');
    mocks.updateFaq.mockRejectedValueOnce(new Error('Lỗi lưu'));
    click(save);
    await flush();
    expect(mocks.updateFaq).toHaveBeenCalledWith('f1', { category: 'Vận chuyển', question: 'Ship mấy ngày?', answer: '2-3 ngày', sortOrder: 2 });
    expect(para(container, 'Lỗi lưu').className).toContain('text-danger-fg');
  });
});

describe('admin/page — tab CSKH mẫu tin nhanh', () => {
  const QR = {
    id: 'q1',
    category: 'Vận chuyển',
    keywords: ['ship', 'phí vận chuyển'],
    title: 'Hỏi phí ship',
    content: 'Phí ship 25k',
    isGreeting: true,
    isActive: false,
  };
  const openQuick = async () => {
    window.history.replaceState(null, '', '/admin?tab=quickReplies');
    return mount();
  };

  it('form thêm: ô nhập/nút 44px, từ khoá khoá khi bật lời chào, công tắc cao 44px, gửi đúng dữ liệu', async () => {
    const { container } = await openQuick();
    expect(container.querySelector('h2')!.className).toContain('font-display');
    const hint = [...container.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Dùng để auto-reply'))!;
    expect(hint.className).toContain('text-stone-500');
    const inputs = [...container.querySelectorAll('input:not([type="checkbox"])')];
    expect(inputs).toHaveLength(3);
    for (const el of inputs) {
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('border-stone-450');
    }
    const add = btn(container, 'Thêm mẫu tin');
    expect(add.className).toContain('bg-forest-600');
    expect(add.disabled).toBe(true);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.className).toContain('accent-forest-600');
    expect(checkbox.closest('label')!.className).toContain('min-h-[44px]');

    typeInto(container.querySelector('input[placeholder="Tên nội bộ"]'), 'Phí ship');
    typeInto(container.querySelector('textarea'), 'Phí ship 25k');
    expect(add.disabled).toBe(false);
    typeInto(container.querySelector('input[placeholder^="Từ khoá kích hoạt"]'), 'ship, , phí vận chuyển');
    mocks.createQuickReply.mockResolvedValueOnce({});
    click(add);
    await flush();
    expect(mocks.createQuickReply).toHaveBeenCalledWith({
      category: undefined,
      keywords: ['ship', 'phí vận chuyển'],
      title: 'Phí ship',
      content: 'Phí ship 25k',
      isGreeting: false,
    });
    expect(para(container, 'Đã thêm mẫu tin nhanh!').className).toContain('text-success-fg');

    click(checkbox);
    expect((container.querySelector('input[placeholder^="Từ khoá kích hoạt"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('hàng mẫu tin: chip nhóm/Lời chào/trạng thái theo tông, nút chữ 44px gọi đúng API', async () => {
    mocks.quickReplies = [QR];
    const { container } = await openQuick();
    expect(para(container, 'Vận chuyển').className).toContain('bg-stone-100');
    expect(para(container, 'Lời chào').className).toContain('bg-warning-bg');
    expect(para(container, 'Đang tắt').className).toContain('bg-stone-100');
    expect(container.textContent).toContain('Từ khoá: ship, phí vận chuyển');

    const edit = btn(container, 'Sửa');
    const on = btn(container, 'Bật');
    const del = btn(container, 'Xoá');
    for (const b of [edit, on, del]) expect(b.className).toContain('min-h-[44px]');
    expect(on.className).toContain('text-stone-600');
    expect(del.className).toContain('text-danger-fg');

    mocks.updateQuickReply.mockResolvedValue({});
    click(on);
    await flush();
    expect(mocks.updateQuickReply).toHaveBeenCalledWith('q1', { isActive: true });
    mocks.deleteQuickReply.mockResolvedValue({});
    click(del);
    await flush();
    expect(mocks.deleteQuickReply).toHaveBeenCalledWith('q1');
  });

  it('form sửa: ô nhập 44px, từ khoá khoá khi là lời chào, Lưu gửi đúng dữ liệu, lỗi báo danger', async () => {
    mocks.quickReplies = [QR];
    const { container } = await openQuick();
    click(btn(container, 'Sửa'));
    const kw = container.querySelector('input[placeholder="Từ khoá, cách nhau bằng dấu phẩy"]') as HTMLInputElement;
    expect(kw.disabled).toBe(true);
    expect(kw.className).toContain('min-h-[44px]');
    expect(container.querySelector('textarea')!.className).toContain('border-stone-450');
    const save = btn(container, 'Lưu');
    expect(save.className).toContain('bg-forest-600');
    mocks.updateQuickReply.mockRejectedValueOnce(new Error('Trùng từ khoá'));
    click(save);
    await flush();
    expect(mocks.updateQuickReply).toHaveBeenCalledWith('q1', {
      category: 'Vận chuyển',
      keywords: ['ship', 'phí vận chuyển'],
      title: 'Hỏi phí ship',
      content: 'Phí ship 25k',
      isGreeting: true,
    });
    expect(para(container, 'Trùng từ khoá').className).toContain('text-danger-fg');
  });
});

describe('admin/page — tab Content Kit CTV', () => {
  const openKit = async () => {
    window.history.replaceState(null, '', '/admin?tab=contentKit');
    return mount();
  };
  const pickAndLoad = async (container: HTMLElement) => {
    typeInto(container.querySelector('input[type="search"]'), 'dừa');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    await flush();
    click(container.querySelector('button[role="option"]'));
    click(btn(container, 'Tải'));
    await flush();
  };

  it('thẻ chọn sản phẩm: tiêu đề font-display, ghi chú stone-500 vẫn có {ten_ctv}/{link}, nút Tải khoá tới khi chọn', async () => {
    const { container } = await openKit();
    expect(container.querySelector('h2')!.className).toContain('font-display');
    const hint = container.querySelector('p')!;
    expect(hint.className).toContain('text-stone-500');
    expect([...hint.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['{ten_ctv}', '{link}']);
    const load = btn(container, 'Tải');
    expect(load.disabled).toBe(true);
    expect(load.className).toContain('bg-forest-600');
    expect(load.className).toContain('min-h-[44px]');
  });

  it('trình soạn: ô nhập viền đủ tương phản, placeholder mẫu giữ nguyên (kể cả 🌿), Lưu gửi đúng dữ liệu', async () => {
    mocks.kit = {
      id: 'k1',
      productId: 'p1',
      captions: ['Caption 1'],
      usps: ['USP 1', 'USP 2'],
      faqs: [{ q: 'Bảo quản?', a: 'Nơi khô ráo' }],
      videoUrls: [],
      updatedAt: '',
    };
    const { container } = await openKit();
    await pickAndLoad(container);
    expect(container.textContent).toContain('Sản phẩm: p1');
    const areas = [...container.querySelectorAll('textarea')];
    expect(areas).toHaveLength(3);
    for (const a of areas) expect(a.className).toContain('border-stone-450');
    expect(areas[0]!.placeholder).toBe('Mình đang dùng sản phẩm này, ưng lắm! Mua qua {link} nhé {ten_ctv} \u{1F33F}');

    const faqInputs = container.querySelectorAll('input[placeholder="Câu hỏi"], input[placeholder="Câu trả lời"]');
    expect(faqInputs).toHaveLength(2);
    for (const el of faqInputs) expect(el.className).toContain('min-h-[44px]');
    const del = btn(container, 'Xoá');
    expect(del.className).toContain('text-danger-fg');
    expect(del.className).toContain('min-h-[44px]');
    const add = btn(container, '+ Thêm FAQ');
    expect(add.className).toContain('text-forest-700');

    typeInto(areas[2]!, 'https://v.test/1\n\n https://v.test/2 ');
    const save = btn(container, 'Lưu Content Kit');
    expect(save.className).toContain('bg-forest-600');
    mocks.saveContentKit.mockResolvedValueOnce({});
    click(save);
    await flush();
    expect(mocks.saveContentKit).toHaveBeenCalledWith('p1', {
      captions: ['Caption 1'],
      usps: ['USP 1', 'USP 2'],
      videoUrls: ['https://v.test/1', 'https://v.test/2'],
      faqs: [{ q: 'Bảo quản?', a: 'Nơi khô ráo' }],
    });
    expect(para(container, 'Đã lưu Content Kit!').className).toContain('text-success-fg');

    mocks.saveContentKit.mockRejectedValueOnce(new Error('Quá dài'));
    click(save);
    await flush();
    expect(para(container, 'Quá dài').className).toContain('text-danger-fg');
  });
});

describe('admin/page — tab Academy', () => {
  const COURSE = {
    id: 'c1',
    title: 'Bán hàng 101',
    description: 'Khoá nhập môn',
    coverUrl: null,
    sortOrder: 1,
    isPublished: false,
    lessons: [
      { id: 'l1', courseId: 'c1', title: 'Giới thiệu', contentType: 'VIDEO', videoUrl: 'https://v.test/1', body: null, sortOrder: 1 },
    ],
  };
  const openAcademy = async () => {
    window.history.replaceState(null, '', '/admin?tab=academy');
    return mount();
  };
  const openCourse = async (container: HTMLElement) => {
    click(btn(container, 'Quản lý'));
    await flush();
  };

  it('form tạo khoá: tiêu đề font-display, ô nhập/nút 44px, khoá tới khi có tiêu đề, gửi đúng dữ liệu', async () => {
    const { container } = await openAcademy();
    expect(container.querySelector('h2')!.className).toContain('font-display');
    const inputs = [...container.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    for (const el of inputs) {
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('border-stone-450');
    }
    const create = btn(container, 'Tạo khoá học');
    expect(create.className).toContain('bg-forest-600');
    expect(create.disabled).toBe(true);
    typeInto(container.querySelector('input[placeholder="Tiêu đề khoá học"]'), ' Khoá mới ');
    expect(create.disabled).toBe(false);
    mocks.createAcademyCourse.mockResolvedValueOnce({});
    click(create);
    await flush();
    expect(mocks.createAcademyCourse).toHaveBeenCalledWith({ title: 'Khoá mới', description: undefined, coverUrl: undefined, sortOrder: 0 });
    expect(para(container, 'Đã tạo khoá học!').className).toContain('text-success-fg');

    typeInto(container.querySelector('input[placeholder="Tiêu đề khoá học"]'), 'Lỗi');
    mocks.createAcademyCourse.mockRejectedValueOnce(new Error('Trùng tên khoá'));
    click(create);
    await flush();
    expect(para(container, 'Trùng tên khoá').className).toContain('text-danger-fg');
  });

  it('hàng khoá học: huy hiệu Đã đăng/Nháp theo tông, nút Quản lý 44px, Đăng/Xoá khoá gọi đúng API', async () => {
    mocks.courses = [COURSE];
    const { container } = await openAcademy();
    expect(para(container, 'Nháp').className).toContain('bg-stone-100');
    expect(container.textContent).toContain('1 bài học · thứ tự 1');
    const manage = btn(container, 'Quản lý');
    expect(manage.className).toContain('min-h-[44px]');
    expect(manage.className).toContain('text-forest-700');
    await openCourse(container);
    expect(btn(container, 'Thu gọn')).toBeTruthy();

    const publish = btn(container, 'Đăng (publish)');
    expect(publish.className).toContain('border-stone-450');
    mocks.updateAcademyCourse.mockResolvedValue({});
    click(publish);
    await flush();
    expect(mocks.updateAcademyCourse).toHaveBeenCalledWith('c1', { isPublished: true });

    const del = btn(container, 'Xoá khoá học');
    expect(del.className).toContain('border-danger-fg');
    expect(del.className).toContain('text-danger-fg');
    expect(del.className).toContain('min-h-[44px]');
    mocks.deleteAcademyCourse.mockResolvedValue({ ok: true });
    click(del);
    await flush();
    expect(mocks.deleteAcademyCourse).toHaveBeenCalledWith('c1');
  });

  it('thông tin khoá: khung stone-50, lưu gửi đúng dữ liệu, thông báo đã lưu có biểu tượng + success', async () => {
    mocks.courses = [{ ...COURSE, isPublished: true }];
    const { container } = await openAcademy();
    expect(para(container, 'Đã đăng').className).toContain('bg-success-bg');
    await openCourse(container);
    const save = btn(container, 'Lưu thông tin');
    expect(save.className).toContain('bg-forest-600');
    expect(save.parentElement!.className).toContain('bg-stone-50');
    typeInto(save.parentElement!.querySelector('input[placeholder="Cover URL"]'), 'https://c.test/x.png');
    mocks.updateAcademyCourse.mockResolvedValue({});
    click(save);
    await flush();
    expect(mocks.updateAcademyCourse).toHaveBeenCalledWith('c1', {
      title: 'Bán hàng 101',
      description: 'Khoá nhập môn',
      coverUrl: 'https://c.test/x.png',
      sortOrder: 1,
    });
    const ok = [...container.querySelectorAll('span')].find((e) => e.textContent?.startsWith('Đã lưu'))!;
    expect(ok.className).toContain('text-success-fg');
    expect(ok.querySelector('svg')).not.toBeNull();
    expect(ok.textContent).not.toContain('✓');
  });

  it('thêm bài học: ô nhập 44px, khoá tới khi có tiêu đề, gửi đúng dữ liệu theo loại nội dung', async () => {
    mocks.courses = [COURSE];
    const { container } = await openAcademy();
    await openCourse(container);
    const add = btn(container, 'Thêm bài học');
    expect(add.disabled).toBe(true);
    expect(add.className).toContain('bg-forest-600');
    const title = container.querySelector('input[placeholder="Tiêu đề bài học"]')!;
    expect(title.className).toContain('min-h-[44px]');
    typeInto(title, 'Bài 2');
    typeInto(container.querySelector('textarea[placeholder="Nội dung bài viết"]'), ' Nội dung ');
    expect(add.disabled).toBe(false);
    mocks.addAcademyLesson.mockResolvedValue({});
    click(add);
    await flush();
    expect(mocks.addAcademyLesson).toHaveBeenCalledWith('c1', {
      title: 'Bài 2',
      contentType: 'ARTICLE',
      videoUrl: undefined,
      body: 'Nội dung',
      sortOrder: 0,
    });
  });

  it('dòng bài học: nút chữ 44px, Xoá/Sửa gọi đúng API, form sửa ô nhập 44px', async () => {
    mocks.courses = [COURSE];
    const { container } = await openAcademy();
    await openCourse(container);
    expect(container.textContent).toContain('[Video] Giới thiệu · thứ tự 1');
    const edit = btn(container, 'Sửa');
    const del = btn(container, 'Xoá');
    expect(edit.className).toContain('min-h-[44px]');
    expect(edit.className).toContain('text-forest-700');
    expect(del.className).toContain('text-danger-fg');

    click(edit);
    const url = container.querySelector('input[placeholder="Video URL"][value="https://v.test/1"]') as HTMLInputElement;
    expect(url.className).toContain('min-h-[44px]');
    const save = btn(container, 'Lưu');
    expect(save.className).toContain('bg-forest-600');
    typeInto(container.querySelector('input[placeholder="Tiêu đề"][value="Giới thiệu"]'), 'Giới thiệu mới');
    mocks.updateAcademyLesson.mockResolvedValue({});
    click(save);
    await flush();
    expect(mocks.updateAcademyLesson).toHaveBeenCalledWith('l1', {
      title: 'Giới thiệu mới',
      contentType: 'VIDEO',
      videoUrl: 'https://v.test/1',
      body: undefined,
      sortOrder: 1,
    });

    mocks.deleteAcademyLesson.mockResolvedValue({ ok: true });
    click(btn(container, 'Xoá'));
    await flush();
    expect(mocks.deleteAcademyLesson).toHaveBeenCalledWith('l1');
  });
});

// PF-4 (axe select-name/label): mọi select và ô ngày giờ phải có tên truy cập; ô chữ chỉ có placeholder thì axe cho qua.
describe('admin/page — nhãn truy cập của ô nhập (axe select-name, label)', () => {
  const TABS_WITH_FIELDS = [
    'dealers', 'orders', 'returns', 'users', 'coupons', 'brands', 'flashSales', 'faqs', 'quickReplies', 'contentKit', 'academy', 'config',
  ];
  it.each(TABS_WITH_FIELDS)('tab %s: không có select/ô ngày thiếu nhãn', async (tab) => {
    window.history.replaceState(null, '', `/admin?tab=${tab}`);
    const { container } = await mount();
    await flush();
    expect(unlabeledFields(container)).toEqual([]);
  });

  it('tab Academy: select loại bài học của form thêm bài và form sửa bài có nhãn', async () => {
    mocks.courses = [
      {
        id: 'c1',
        title: 'Bán hàng cơ bản',
        description: null,
        level: 'BEGINNER',
        sortOrder: 1,
        isActive: true,
        lessons: [{ id: 'l1', title: 'Giới thiệu', contentType: 'VIDEO', videoUrl: 'https://v.test/1', body: null, sortOrder: 1 }],
      },
    ];
    window.history.replaceState(null, '', '/admin?tab=academy');
    const { container } = await mount();
    click(btn(container, /Quản lý|Sửa/));
    await flush();
    click(btn(container, 'Sửa'));
    await flush();
    expect(container.querySelectorAll('select').length).toBeGreaterThan(0);
    expect(unlabeledFields(container)).toEqual([]);
  });
});

// PF-4 (axe target-size, WCAG 2.5.8): nút chữ xếp dọc trong hàng FAQ/mẫu tin nhanh chỉ cách nhau 4px; ở màn máy tính
// cao tối thiểu 24px thì mới đạt, nên lớp `sm:min-h-0` không được để chiều cao rơi về chiều cao dòng chữ.
describe('admin/page — vùng chạm tối thiểu 24px ở màn máy tính (axe target-size)', () => {
  it('hàng câu hỏi thường gặp: ba nút chữ xếp dọc có sm:min-h-6', async () => {
    mocks.faqs = [{ id: 'f1', category: 'Vận chuyển', question: 'Ship bao lâu?', answer: '2-3 ngày', sortOrder: 2, isActive: true }];
    window.history.replaceState(null, '', '/admin?tab=faqs');
    const { container } = await mount();
    for (const label of ['Sửa', 'Ẩn', 'Xoá']) {
      const b = [...container.querySelectorAll('button')].find((x) => x.textContent === label)!;
      expect(b, label).toBeDefined();
      expect(b.className, label).toContain('sm:min-h-6');
      expect(b.className, label).not.toContain('sm:min-h-0');
    }
  });

  it('hàng mẫu tin nhanh: các nút chữ có sm:min-h-6', async () => {
    mocks.quickReplies = [
      { id: 'q1', category: null, title: 'Chào khách', content: 'Xin chào', keywords: ['chào'], isGreeting: false, sortOrder: 1, isActive: true },
    ];
    window.history.replaceState(null, '', '/admin?tab=quickReplies');
    const { container } = await mount();
    const row = [...container.querySelectorAll('button')].filter((x) => ['Sửa', 'Tắt', 'Xoá'].includes(x.textContent ?? ''));
    expect(row.map((x) => x.textContent)).toEqual(['Sửa', 'Tắt', 'Xoá']);
    for (const b of row) expect(b.className).toContain('sm:min-h-6');
  });
});

// PF-4 (axe scrollable-region-focusable): khung cuộn ngang bọc bảng không có phần tử focus được bên trong thì bàn phím
// không cuộn tới phần bị che; khung phải tự nhận tab.
describe('admin/page — khung cuộn bảng focus được bằng bàn phím', () => {
  it('tab Tổng quan (đơn gần đây) và tab Người dùng: khung bọc bảng có tabindex=0, role=region, aria-label', async () => {
    window.history.replaceState(null, '', '/admin?tab=dashboard');
    const dash = await mount();
    expect(dash.container.querySelector('table')).not.toBeNull();
    expect(scrollRegionProblems(dash.container)).toEqual([]);
    dash.unmount();
    mounted = mounted.filter((m) => m !== dash);

    window.history.replaceState(null, '', '/admin?tab=users');
    const users = await mount();
    expect(users.container.querySelector('table')).not.toBeNull();
    expect(scrollRegionProblems(users.container)).toEqual([]);
  });

  it('tab Đơn hàng: bảng đơn có khung cuộn focus được', async () => {
    mocks.orders = [
      { id: 'o1', code: 'TT1', total: 100000, status: 'CONFIRMED', paymentMethod: 'COD', createdAt: '2026-10-01T03:00:00.000Z', user: { fullName: 'Khách', phone: '0900000000' }, items: [] },
    ];
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    expect(container.querySelector('table')).not.toBeNull();
    expect(scrollRegionProblems(container)).toEqual([]);
  });
});

// PG-3 (axe heading-order): tiêu đề form của các tab sau h1 "Quản trị Tubu Tree" phải là h2, không nhảy h1 -> h3.
describe('admin/page — thứ bậc heading của các tab', () => {
  it.each(['config', 'flashSales', 'faqs', 'quickReplies', 'contentKit', 'academy', 'users', 'orders', 'inbox', 'opsHealth', 'waste', 'attendance'])(
    'tab %s: không nhảy cấp heading',
    async (tab) => {
      window.history.replaceState(null, '', `/admin?tab=${tab}`);
      const { container } = await mount();
      await flush();
      expect(headingProblems(container)).toEqual([]);
    },
  );
});

describe('admin/page — KPI doanh thu (ADMINOPS-14)', () => {
  it('thẻ doanh thu là tiền đã thu, tách giá trị đơn còn hiệu lực và COD chưa thu; thẻ đơn hiện đơn trả + tiền đã hoàn', async () => {
    window.history.replaceState(null, '', '/admin?tab=dashboard');
    const { container } = await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Doanh thu đã thu');
    expect(text).toContain('Đã thanh toán hoặc COD Tubu đã thu; trừ đơn huỷ/trả, tiền hoàn, đơn ghi công nợ và COD gian hàng tự giao');
    const dl = container.querySelector('[data-kpi-revenue-breakdown]')!;
    expect(dl.textContent).toContain('Giá trị đơn còn hiệu lực1.500.000');
    expect(dl.textContent).toContain('COD chưa thu400.000');
    expect(dl.textContent).toContain('Công nợ đại lý chưa thu2.500.000');
    expect(text).toContain('2 đã trả hàng');
    const refunds = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Đã hoàn khi trả hàng'))!;
    expect(refunds.textContent).toContain('120.000');
    expect(refunds.textContent).toContain('3 yêu cầu chờ duyệt');
    click(refunds);
    await flush();
    expect(window.location.search).toBe('?tab=returns');
  });
});

describe('admin/page — nhân viên theo nhóm việc (ADMINOPS-10)', () => {
  const navItems = (c: HTMLElement) =>
    [...c.querySelectorAll('nav[aria-label="Mục quản trị"] button')].map((b) => b.textContent);

  it('nhân viên KHO chỉ thấy mục của mình, không gọi API chỉ dành cho ADMIN', async () => {
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: ['KHO'] };
    const { container } = await mount();
    expect(navItems(container)).toEqual(['Việc cần xử lý', 'Đơn hàng', 'Đổi / Trả', 'Đổi rác']);
    expect(mocks.refundsCalls).toBe(0);
    expect(mocks.inbox).toHaveBeenCalled();
  });

  it('nhân viên không có nhóm việc: chỉ còn Đổi rác; link tới mục không được phép rơi về mục đầu tiên', async () => {
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: [] };
    window.history.replaceState(null, '', '/admin?tab=config');
    const { container } = await mount();
    expect(navItems(container)).toEqual(['Đổi rác']);
    expect(container.textContent).toContain('Đổi rác lấy quà');
    expect(container.textContent).not.toContain('Tất cả tham số');
  });

  it('CSKH ở tab Người dùng: xem chi tiết được, không có nút khoá, cấp quyền hay xuất CSV', async () => {
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: ['CSKH'] };
    window.history.replaceState(null, '', '/admin?tab=users');
    const { container } = await mount();
    expect(navItems(container)).toContain('Người dùng');
    expect(navItems(container)).toContain('CSKH mẫu tin nhanh');
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain('Khoá');
    expect(labels).not.toContain('Cấp quyền');
    expect(labels.some((l) => l?.includes('Xuất CSV'))).toBe(false);
    expect(container.textContent).toContain('Đang hoạt động');
    expect(container.querySelector('button[aria-label="Xem chi tiết Nguyễn An"]')).not.toBeNull();
  });

  it('nhân viên ở tab Đơn hàng: không có nút Xuất CSV', async () => {
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: ['KHO'] };
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('Xuất CSV'))).toBe(false);
  });

  it('CSKH mở chi tiết đơn: không có thao tác kho (đẩy lại Pancake) mà API chỉ mở cho KHO; KHO thì có', async () => {
    const failed = {
      id: 'o9',
      code: 'TB9',
      status: 'CONFIRMED',
      total: 100000,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      fulfiller: 'TUBU',
      pancakePushStatus: 'FAILED',
      pancakePushAttempts: 3,
      pancakeSyncError: 'HTTP 500',
      createdAt: '2026-10-14T01:00:00.000Z',
      items: [],
      allowedTransitions: ['PACKED'],
    };
    const openDetail = async (perms: string[]) => {
      mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
      mocks.access = { role: 'STAFF', staffPermissions: perms };
      mocks.orders = [failed];
      window.history.replaceState(null, '', '/admin?tab=orders');
      const { container } = await mount();
      act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Xem & Sửa')!.click());
      await flush();
      const labels = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
      return labels;
    };
    const cskh = await openDetail(['CSKH']);
    expect(cskh.some((l) => l.includes('Đẩy lại Pancake'))).toBe(false);
    expect(cskh).toContain('Đã đóng gói');
    const kho = await openDetail(['KHO']);
    expect(kho.some((l) => l.includes('Đẩy lại Pancake'))).toBe(true);
  });

  it('nhân viên mở đơn chuyển khoản chưa trả: không có nút "Đã nhận tiền" (API chỉ cho ADMIN); ADMIN thì có', async () => {
    const unpaid = {
      id: 'o10',
      code: 'TB10',
      status: 'PENDING_PAYMENT',
      total: 250000,
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      fulfiller: 'TUBU',
      createdAt: '2026-10-14T01:00:00.000Z',
      items: [],
      allowedTransitions: ['CANCELLED'],
      canConfirmPayment: true,
    };
    const openDetail = async (role: 'STAFF' | 'ADMIN', perms: string[]) => {
      mocks.auth = { user: { role }, status: 'authenticated', initialized: true };
      mocks.access = { role, staffPermissions: perms };
      mocks.orders = [unpaid];
      window.history.replaceState(null, '', '/admin?tab=orders');
      const { container } = await mount();
      act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Xem & Sửa')!.click());
      await flush();
      return container;
    };
    for (const perms of [['CSKH'], ['KHO'], ['CSKH', 'KHO']]) {
      const c = await openDetail('STAFF', perms);
      expect([...c.querySelectorAll('button')].some((b) => b.textContent === 'Đã nhận tiền')).toBe(false);
      expect(c.querySelector('section[aria-label="Xác nhận đã nhận tiền"]')).toBeNull();
    }
    const admin = await openDetail('ADMIN', []);
    expect([...admin.querySelectorAll('button')].some((b) => b.textContent === 'Đã nhận tiền')).toBe(true);
  });
});

// D1-05: marketing và kế toán là nhân viên (STAFF) có nhóm việc riêng, không cấp ADMIN. Mục ẩn chỉ là giao diện; API tự chặn.
describe('admin/page — nhóm việc MARKETING và KE_TOAN (D1-05)', () => {
  const navItems = (c: HTMLElement) =>
    [...c.querySelectorAll('nav[aria-label="Mục quản trị"] button')].map((b) => b.textContent);
  const asStaff = (perms: string[]) => {
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: perms };
  };

  it('MARKETING: voucher, flash sale, nội dung, cộng đồng, báo cáo — không có đơn hàng, tiền, người dùng, cấu hình', async () => {
    asStaff(['MARKETING']);
    const { container } = await mount();
    expect(navItems(container)).toEqual([
      'Việc cần xử lý',
      'Báo cáo',
      'Cộng đồng',
      'Đổi rác',
      'Voucher',
      'Flash Sale',
      'Câu hỏi thường gặp',
      'Content Kit CTV',
      'Academy',
      'Mẫu thông báo',
    ]);
    expect(mocks.refundsCalls).toBe(0);
  });

  it('KE_TOAN (B18): đơn hàng, báo cáo, đối soát, hoàn tiền khách và sàn ngoài, thưởng và công nợ đại lý, rút tiền — không có voucher, người dùng, cấu hình, hoa hồng', async () => {
    asStaff(['KE_TOAN']);
    const { container } = await mount();
    expect(navItems(container)).toEqual([
      'Việc cần xử lý',
      'Báo cáo',
      'Đơn hàng',
      'Đơn đối tác & đối soát',
      'Hoàn tiền khách',
      'Hoàn tiền sàn ngoài',
      'Thưởng đại lý',
      'Đại lý & công nợ',
      'Duyệt yêu cầu rút tiền',
      'Đổi rác',
    ]);
    expect(mocks.refundsCalls).toBeGreaterThan(0);
  });

  it('KE_TOAN ở tab Đơn hàng: có Xuất CSV và nút "Đã nhận tiền", KHÔNG có nút trạng thái nào (huỷ, đóng gói…) hay thao tác kho', async () => {
    const unpaid = {
      id: 'o11',
      code: 'TB11',
      status: 'PENDING_PAYMENT',
      total: 250000,
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      fulfiller: 'TUBU',
      createdAt: '2026-10-14T01:00:00.000Z',
      items: [],
      allowedTransitions: [],
      canConfirmPayment: true,
    };
    asStaff(['KE_TOAN']);
    mocks.orders = [unpaid];
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Xem & Sửa')!.click());
    await flush();
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('Xuất CSV'))).toBe(true);
    expect(labels).toContain('Đã nhận tiền');
    for (const bad of ['Hủy đơn', 'Đã đóng gói', 'Giao vận', 'Đã giao hàng', 'Xác nhận']) expect(labels).not.toContain(bad);
    expect(labels.some((l) => l.includes('Đẩy lại Pancake'))).toBe(false);
  });

  it('KE_TOAN mở link ?tab=config hay ?tab=coupons: rơi về mục đầu, không hiện cấu hình', async () => {
    asStaff(['KE_TOAN']);
    for (const tab of ['config', 'coupons', 'users', 'commissionRates']) {
      window.history.replaceState(null, '', `/admin?tab=${tab}`);
      const r = await mount();
      expect(r.container.textContent).not.toContain('Tất cả tham số');
      expect(r.container.querySelector('nav[aria-label="Mục quản trị"] button[aria-current="page"]')!.textContent).toBe('Việc cần xử lý');
      r.unmount();
      mounted = [];
    }
  });
});

describe('admin/page — Việc cần xử lý (ADMINOPS-13)', () => {
  it('thẻ có việc hiện số và mở đúng hàng đợi; mục đang trống gom thành chip', async () => {
    const { container } = await mount();
    const card = container.querySelector('[data-inbox="pancakeAttention"]')!;
    expect(card.textContent).toContain('2');
    expect(card.textContent).toContain('Cần xử lý Pancake');
    expect(container.querySelector('[data-inbox="returnsPending"]')!.textContent).toContain('Yêu cầu đổi / trả chờ duyệt');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Đổi vỏ chai chờ duyệt · 0')).toBe(true);
    click(card);
    await flush();
    expect(window.location.search).toBe('?tab=orders&pancake=attention');
  });

  // R4-ADMIN-3: thẻ đếm chờ đối soát + chờ chuyển khoản + đang chuyển khoản; bấm vào trước đây mở bộ lọc chỉ "Chờ chuyển khoản".
  it('thẻ Hoàn tiền khách nêu đủ ba loại việc, bấm vào mở hàng đợi lọc "Đang mở" (cùng tập với số trên thẻ và huy hiệu tab)', async () => {
    const { container } = await mount();
    const card = container.querySelector('[data-inbox="customerRefunds"]')!;
    expect(card.textContent).toContain('4');
    expect(card.textContent).toContain('Chờ đối soát, chờ chuyển khoản hoặc đang chuyển khoản');
    const badgeCalls = mocks.refundsArgs.filter((a) => a[2] === 1);
    expect(badgeCalls.length).toBeGreaterThan(0);
    for (const a of badgeCalls) expect(a[0]).toBe('OPEN');
    mocks.refundsArgs = [];
    click(card);
    await flush();
    expect(window.location.search).toBe('?tab=customerRefunds');
    expect(mocks.refundsArgs.some((a) => a[0] === 'OPEN' && a[2] === 20)).toBe(true);
    const selected = container.querySelector('[role="tablist"][aria-label="Lọc theo trạng thái"] [aria-selected="true"]')!;
    expect(selected.textContent).toBe('Đang mở');
  });
});

describe('admin/page — thẻ "Hàng trả chờ nhận về kho" mở đúng danh sách (R2-ADMINOPS-4)', () => {
  const returnsFilter = (c: HTMLElement) =>
    c.querySelector<HTMLSelectElement>('select[aria-label="Lọc yêu cầu đổi/trả theo trạng thái"]')!;

  it('bấm thẻ → tab Đổi/Trả lọc "Chờ nhận hàng về", không phải danh sách chờ duyệt', async () => {
    const { container } = await mount();
    click(container.querySelector('[data-inbox="returnsToReceive"]')!);
    await flush();
    expect(returnsFilter(container).value).toBe('TO_RECEIVE');
    expect(returnsFilter(container).selectedOptions[0]!.textContent).toBe('Chờ nhận hàng về');
    expect(mocks.returnsArgs.at(-1)).toEqual(['TO_RECEIVE', 1, undefined, 'asc']);
  });

  it('thẻ "chờ duyệt" vẫn mở danh sách REQUESTED', async () => {
    const { container } = await mount();
    click(container.querySelector('[data-inbox="returnsPending"]')!);
    await flush();
    expect(returnsFilter(container).value).toBe('REQUESTED');
    expect(mocks.returnsArgs.at(-1)).toEqual(['REQUESTED', 1, undefined, 'asc']);
  });

  it('nhân viên chỉ có nhóm KHO mở tab Đổi/Trả: mặc định danh sách chờ nhận hàng về', async () => {
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: ['KHO'] };
    window.history.replaceState(null, '', '/admin?tab=returns');
    const { container } = await mount();
    expect(returnsFilter(container).value).toBe('TO_RECEIVE');
    expect(mocks.returnsArgs.every((a) => a[0] === 'TO_RECEIVE')).toBe(true);
  });
});

describe('admin/page — Đơn hàng: xuất CSV đầy đủ, lọc ngày, gian hàng tự giao, chi tiết trên điện thoại', () => {
  const merchantOrder = {
    id: 'o5',
    code: 'TF5',
    status: 'CONFIRMED',
    total: 230000,
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    fulfiller: 'MERCHANT',
    fulfillerStorefront: { title: 'Mật ong Linh' },
    createdAt: '2026-10-02T03:00:00.000Z',
    user: { fullName: 'Khách C', phone: '0933333333' },
    items: [{ id: 'i1', productName: 'Mật ong rừng', variationName: '500ml', unitPrice: 230000, quantity: 1, total: 230000 }],
  };

  it('Xuất CSV gửi đủ bộ lọc kể cả khoảng ngày (ADMINOPS-12), báo đã tải mọi đơn khớp lọc', async () => {
    window.history.replaceState(null, '', '/admin?tab=orders&pancake=unsynced');
    const { container } = await mount();
    const dates = container.querySelectorAll('input[type="date"]');
    typeInto(dates[0]!, '2026-10-01');
    typeInto(dates[1]!, '2026-10-14');
    await flush();
    expect(mocks.listOrders).toHaveBeenLastCalledWith(1, undefined, undefined, undefined, 20, undefined, 'unsynced', '2026-10-01', '2026-10-14', {});
    click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Xuất CSV'))!);
    await flush();
    expect(mocks.downloadOrders).toHaveBeenCalledWith({
      status: undefined,
      search: undefined,
      recycling: undefined,
      invoice: undefined,
      pancake: 'unsynced',
      from: '2026-10-01',
      to: '2026-10-14',
    });
    expect(container.textContent).toContain('mọi đơn khớp bộ lọc, không chỉ trang đang xem');
  });

  it('bộ lọc loại đơn / thanh toán / thứ tự gửi xuống danh sách và file CSV (CSV không nhận thứ tự)', async () => {
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    const sel = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    selectValue(sel('Lọc đơn theo loại đơn'), 'dealer');
    selectValue(sel('Lọc đơn theo tình trạng thanh toán'), 'UNPAID');
    selectValue(sel('Thứ tự sắp xếp theo ngày đặt'), 'asc');
    await flush();
    expect(mocks.listOrders).toHaveBeenLastCalledWith(1, undefined, undefined, undefined, 20, undefined, undefined, undefined, undefined, {
      kind: 'dealer',
      payment: 'UNPAID',
      order: 'asc',
    });
    click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Xuất CSV'))!);
    await flush();
    const sent = mocks.downloadOrders.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ kind: 'dealer', payment: 'UNPAID' });
    expect(sent).not.toHaveProperty('order');
  });

  it('đổi bộ lọc mới đưa danh sách về trang 1', async () => {
    window.history.replaceState(null, '', '/admin?tab=orders');
    mocks.orders = Array.from({ length: 3 }, (_, i) => ({ ...merchantOrder, id: `o${i}`, code: `TF${i}` }));
    const { container } = await mount();
    selectValue(container.querySelector<HTMLSelectElement>('select[aria-label="Lọc đơn theo nền tảng đặt"]'), 'web');
    await flush();
    expect(mocks.listOrders.mock.calls.at(-1)![0]).toBe(1);
    expect(mocks.listOrders.mock.calls.at(-1)![9]).toEqual({ platform: 'web' });
  });

  it('khoảng ngày ngược: báo lỗi, không gọi API với khoảng đó, khoá nút xuất', async () => {
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    const dates = container.querySelectorAll('input[type="date"]');
    typeInto(dates[0]!, '2026-10-14');
    typeInto(dates[1]!, '2026-10-01');
    await flush();
    expect(container.textContent).toContain('Ngày bắt đầu phải trước ngày kết thúc.');
    expect(mocks.listOrders).not.toHaveBeenCalledWith(1, undefined, undefined, undefined, 20, undefined, undefined, '2026-10-14', '2026-10-01', {});
    const exp = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Xuất CSV')) as HTMLButtonElement;
    expect(exp.disabled).toBe(true);
  });

  it('đơn gian hàng tự giao có huy hiệu "Gian hàng tự giao" ở danh sách', async () => {
    mocks.orders = [merchantOrder];
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    const badge = [...container.querySelectorAll('span')].find((x) => x.textContent === 'Gian hàng tự giao')!;
    expect(badge.getAttribute('title')).toBe('Mật ong Linh');
    expect(badge.className).toContain('bg-info-bg');
  });

  it('390px: bấm vào dòng mở ngăn kéo chi tiết đơn thay vì mở rộng trong bảng cuộn ngang', async () => {
    const mm = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.matchMedia = mm as unknown as typeof window.matchMedia;
    try {
      mocks.orders = [merchantOrder];
      window.history.replaceState(null, '', '/admin?tab=orders');
      const { container } = await mount();
      act(() => (container.querySelector('tbody tr') as HTMLElement).click());
      await flush();
      const dialog = document.body.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('Đơn TF5');
      expect(dialog.textContent).toContain('Sản phẩm trong đơn');
      expect(dialog.textContent).toContain('Mật ong rừng');
      expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
      act(() => (dialog.querySelector('button[aria-label="Đóng"]') as HTMLButtonElement).click());
      await flush();
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();

      const heads = [...container.querySelectorAll('thead th')];
      for (const label of ['Thanh toán', 'Trạng thái', 'Ngày đặt', 'Chi tiết / Cập nhật']) {
        expect([...heads.find((h) => h.textContent === label)!.classList]).toEqual(expect.arrayContaining(['hidden', 'md:table-cell']));
      }
      const firstCell = container.querySelector('tbody td')!;
      expect(firstCell.querySelector('.md\\:hidden')!.textContent).toContain('Đã xác nhận');
      const codeBtn = firstCell.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement;
      expect(codeBtn.textContent).toBe('TF5');
      act(() => codeBtn.click());
      await flush();
      expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('Đơn TF5');
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe('admin/page — chi tiết người dùng (ADMINOPS-11)', () => {
  const DETAIL = {
    user: {
      id: 'u1',
      fullName: 'Nguyễn An',
      phone: '0944444444',
      email: null,
      role: 'STAFF',
      staffPermissions: ['CSKH'],
      referralCode: 'AN1',
      pointsBalance: 12,
      pointsConvertedBalance: 0,
      walletBalance: 50000,
      isBlocked: false,
      blockedAt: null,
      blockedReason: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      tier: null,
    },
    orders: {
      items: [{ id: 'o1', code: 'TT1', status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'PAID', total: 120000, createdAt: '2026-10-01T00:00:00.000Z', fulfiller: 'TUBU' }],
      total: 1,
    },
    wallet: [{ id: 'w1', delta: 50000, balanceAfter: 50000, type: 'REFUND', refType: null, refId: null, reason: 'Hoàn đơn TT0', createdAt: '2026-10-02T00:00:00.000Z' }],
    points: [{ id: 'p1', delta: 12, reason: 'ORDER_DELIVERED:TT1', refType: null, refId: null, lot: 'STANDARD', expiresAt: null, createdAt: '2026-10-02T00:00:00.000Z' }],
    roleHistory: [{ id: 'e1', kind: 'ROLE', fromValue: 'CUSTOMER', toValue: 'STAFF', reason: null, actorId: 'a1', actorName: 'Chủ shop', createdAt: '2026-10-03T00:00:00.000Z' }],
    blockHistory: [{ id: 'e2', kind: 'BLOCK', fromValue: null, toValue: null, reason: 'bom hàng', actorId: 'a1', actorName: 'Chủ shop', createdAt: '2026-10-04T00:00:00.000Z' }],
    grants: [],
  };

  it('bấm tên mở ngăn kéo: đơn, sổ ví, Điểm Xanh, lịch sử vai trò và khoá; ADMIN thấy ô nhóm việc của nhân viên', async () => {
    mocks.userDetail.mockResolvedValue(DETAIL);
    window.history.replaceState(null, '', '/admin?tab=users');
    const { container } = await mount();
    click(container.querySelector('button[aria-label="Xem chi tiết Nguyễn An"]'));
    await flush();
    expect(mocks.userDetail).toHaveBeenCalledWith('u1');
    const dialog = document.body.querySelector('[role="dialog"]')!;
    const text = dialog.textContent ?? '';
    expect(text).toContain('TT1');
    expect(text).toContain('Hoàn đơn TT0');
    expect(text).toContain('Tích điểm từ đơn hàng · TT1');
    expect(text).toContain('Vai trò Khách hàng → Nhân viên');
    expect(text).toContain('Khoá tài khoản');
    expect(text).toContain('bom hàng');
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    // CSKH, Kho, Marketing, Kế toán (D1-05).
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false, false]);
  });

  it('Xuất CSV người dùng tải mọi người khớp tìm kiếm qua API', async () => {
    window.history.replaceState(null, '', '/admin?tab=users');
    const { container } = await mount();
    click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Xuất CSV người dùng'))!);
    await flush();
    expect(mocks.downloadUsers).toHaveBeenCalledWith(undefined);
    expect(container.textContent).toContain('mọi người dùng khớp tìm kiếm');
  });
});

// R4-ADMIN-1 / R4-ADMIN-2: đơn huỷ chọn nhận về ngân hàng lật REFUNDED ngay, tiền còn ở hàng đợi chuyển khoản tay. Danh sách,
// chi tiết và ngăn kéo 390px phải nói "Đang hoàn tiền" như khách thấy, kèm khoản hoàn và nơi nhận.
describe('admin/page — trạng thái hoàn tiền thật của đơn', () => {
  const refundOrder = (code: string, refundStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED') => ({
    id: `id-${code}`,
    code,
    status: 'CANCELLED',
    type: 'RETAIL',
    total: 178000,
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'REFUNDED',
    createdAt: '2026-10-14T13:52:00.000Z',
    user: { fullName: 'Khách Hoàn', phone: '0933333333' },
    items: [],
    customerRefunds: [
      {
        id: `r-${code}`,
        kind: 'CANCEL',
        method: 'MANUAL_TRANSFER',
        status: refundStatus,
        amount: 178000,
        createdAt: '2026-10-14T13:53:00.000Z',
        completedAt: refundStatus === 'COMPLETED' ? '2026-10-14T15:00:00.000Z' : null,
      },
    ],
  });

  it('cột Thanh toán: "Đang hoàn tiền" (tông cảnh báo) khi khoản chuyển khoản Chờ/Đang chuyển, "Đã hoàn tiền" khi đã chuyển', async () => {
    mocks.orders = [refundOrder('TUBU1', 'PENDING'), refundOrder('TUBU2', 'PROCESSING'), refundOrder('TUBU3', 'COMPLETED')];
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    const rows = [...container.querySelectorAll('tbody tr')];
    const cell = (i: number) => rows[i]!.querySelector('td.md\\:table-cell [data-payment-short]')!;
    expect(cell(0).textContent).toBe('Đang hoàn tiền');
    expect(cell(0).className).toContain('text-warning-fg');
    expect(cell(1).textContent).toBe('Đang hoàn tiền');
    expect(cell(2).textContent).toBe('Đã hoàn tiền');
    expect(cell(2).className).not.toContain('text-warning-fg');
  });

  it('mở chi tiết: dòng Thanh toán + khoản hoàn (loại, số tiền, trạng thái, nơi nhận), không lộ tài khoản ngân hàng', async () => {
    mocks.orders = [refundOrder('TUBU1', 'PENDING')];
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Xem & Sửa')!);
    await flush();
    const box = container.querySelector('[data-order-payment]')!;
    expect(box.textContent).toContain('Thanh toán:');
    expect(box.querySelector('[data-payment-status]')!.textContent).toBe('Đang hoàn tiền');
    const refund = box.querySelector('[data-order-refund="PENDING"]')!;
    expect(refund.textContent).toContain('Khoản hoàn (Huỷ đơn)');
    expect(refund.textContent).toContain('178.000');
    expect(refund.textContent).toContain('Chờ chuyển khoản');
    expect(refund.textContent).toContain('về tài khoản ngân hàng');
    expect(box.textContent).toContain('Hoàn tiền khách');
  });

  it('390px: dòng đơn hiện tình trạng thanh toán dưới mã đơn, ngăn kéo có dòng Thanh toán và khoản hoàn; ô tìm có nhãn và gợi ý ngắn', async () => {
    const mm = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.matchMedia = mm as unknown as typeof window.matchMedia;
    try {
      mocks.orders = [refundOrder('TUBU2', 'PROCESSING')];
      window.history.replaceState(null, '', '/admin?tab=orders');
      const { container } = await mount();
      const narrowBlock = container.querySelector('tbody td .md\\:hidden')!;
      expect(narrowBlock.querySelector('[data-payment-short]')!.textContent).toBe('Đang hoàn tiền');
      const search = container.querySelector('form input[type="text"]') as HTMLInputElement;
      expect(search.getAttribute('aria-label')).toContain('tên người nhận');
      expect(search.placeholder.length).toBeLessThanOrEqual(20);

      act(() => (container.querySelector('tbody tr') as HTMLElement).click());
      await flush();
      const dialog = document.body.querySelector('[role="dialog"]')!;
      expect(dialog.querySelector('[data-payment-status]')!.textContent).toBe('Đang hoàn tiền');
      expect(dialog.querySelector('[data-order-refund="PROCESSING"]')!.textContent).toContain('Đang chuyển khoản');
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('cột Khách hàng hiện người nhận khi khác tên tài khoản, để kết quả tìm theo tên người nhận đọc được', async () => {
    mocks.orders = [
      { ...refundOrder('TUBU1', 'PENDING'), shippingAddress: { recipient: 'Nguyễn Thị Mẹ Chồng', phone: '0911222333' } },
      { ...refundOrder('TUBU2', 'PENDING'), shippingAddress: { recipient: ' Khách Hoàn ', phone: '0933333333' } },
      { ...refundOrder('TUBU3', 'PENDING'), shippingAddress: null },
    ];
    window.history.replaceState(null, '', '/admin?tab=orders');
    const { container } = await mount();
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows[0]!.querySelector('[data-order-recipient]')!.textContent).toBe('Nhận: Nguyễn Thị Mẹ Chồng · 0911222333');
    expect(rows[1]!.querySelector('[data-order-recipient]')).toBeNull();
    expect(rows[2]!.querySelector('[data-order-recipient]')).toBeNull();
  });
});

describe('admin/page — Cộng đồng và hoá đơn VAT trên "Việc cần xử lý" (launch review D1-08, D1-17)', () => {
  const stubFeed = () => {
    const api = mockFetch({
      '/feed/admin/pending': { body: [{ id: 'p1', kind: 'SHOWCASE', title: 'Ban công', body: 'Khoe vườn', images: [], author: 'Lan', category: null, createdAt: '2026-10-17T03:00:00.000Z' }] },
      '/feed/admin/unanswered': { body: [{ id: 'q1', title: 'Cây khô lá', excerpt: 'Khô lá', createdAt: '2026-10-15T03:00:00.000Z', author: 'Bình', category: null, waitingHours: 52 }] },
      '/feed/admin/published': { body: { items: [], nextCursor: null } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    return api;
  };
  afterEach(() => vi.unstubAllGlobals());

  const navItems = (c: HTMLElement) => [...c.querySelectorAll('nav[aria-label="Mục quản trị"] button')].map((b) => b.textContent);
  const activeChip = (c: HTMLElement) => c.querySelector('[role="group"][aria-label="Mục kiểm duyệt cộng đồng"] [aria-pressed="true"]')!.textContent;

  it('thẻ bài chờ duyệt mở tab Cộng đồng ở danh sách chờ duyệt', async () => {
    stubFeed();
    const { container } = await mount();
    const card = container.querySelector('[data-inbox="communityPending"]')!;
    expect(card.textContent).toContain('3');
    expect(card.textContent).toContain('Bài cộng đồng chờ duyệt');

    click(card);
    await flush();

    expect(window.location.search).toBe('?tab=community');
    expect(activeChip(container)).toBe('Chờ duyệt');
    expect(container.textContent).toContain('Ban công');
  });

  it('thẻ câu hỏi chưa ai trả lời mở thẳng danh sách "Chưa trả lời"', async () => {
    stubFeed();
    const { container } = await mount();

    click(container.querySelector('[data-inbox="communityUnanswered"]')!);
    await flush();

    expect(window.location.search).toBe('?tab=community');
    expect(activeChip(container)).toBe('Chưa trả lời');
    expect(container.textContent).toContain('Cây khô lá');
  });

  it('thẻ hoá đơn VAT chờ xuất mở tab Đơn hàng với bộ lọc "VAT chờ xuất" đã chọn', async () => {
    const { container } = await mount();
    const card = container.querySelector('[data-inbox="invoicePending"]')!;
    expect(card.textContent).toContain('Hoá đơn VAT chờ xuất');

    click(card);
    await flush();

    expect(window.location.search).toBe('?tab=orders');
    expect(mocks.listOrders.mock.lastCall![5]).toBe('pending');
    expect(container.querySelector('[role="tablist"][aria-label="Lọc đơn yêu cầu hoá đơn VAT"] [aria-selected="true"]')!.textContent).toContain('VAT chờ xuất');
  });

  it('mục Đơn ngoài app: ADMIN và CSKH mở được từ link ?tab=externalOrders (ADMIN có nút xem payload), KHO thì không', async () => {
    const api = mockFetch({
      '/admin/external-orders/sources': { body: { sources: [], truncated: false } },
      '/admin/external-orders?': {
        body: {
          data: [{ id: 'x1', pancakeOrderId: '910001', source: 'MARKETPLACE', channel: 'shopee', sourceKey: '-3|a|-3', trackingCode: 'SPXVN0123456789', trackingCodes: [], marketplaceOrderSn: null, phone: null, goodsValue: 1000, pancakeStatus: 3, status: 'DELIVERED', pancakeUpdatedAt: null, deliveredAt: null, firstSeenAt: '2026-10-13T08:31:00.000Z' }],
          meta: { page: 1, limit: 20, total: 1 },
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    window.history.replaceState(null, '', '/admin?tab=externalOrders');
    const admin = await mount();
    expect(navItems(admin.container)).toContain('Đơn ngoài app');
    expect(admin.container.querySelector('h2')!.textContent).toBe('Đơn ngoài app');
    expect([...admin.container.querySelectorAll('button')].some((b) => b.textContent === 'Xem payload Pancake')).toBe(true);
    admin.unmount();
    mounted = [];

    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: ['CSKH'] };
    window.history.replaceState(null, '', '/admin?tab=externalOrders');
    const cskh = await mount();
    expect(navItems(cskh.container)).toContain('Đơn ngoài app');
    expect(cskh.container.querySelector('h2')!.textContent).toBe('Đơn ngoài app');
    expect([...cskh.container.querySelectorAll('button')].some((b) => b.textContent === 'Xem payload Pancake')).toBe(false);
    cskh.unmount();
    mounted = [];

    mocks.access = { role: 'STAFF', staffPermissions: ['KHO'] };
    window.history.replaceState(null, '', '/admin?tab=externalOrders');
    const kho = await mount();
    expect(navItems(kho.container)).not.toContain('Đơn ngoài app');
    expect(kho.container.textContent).not.toContain('Nguồn đã thấy');
  });

  it('CSKH có mục Cộng đồng và vào được từ link ?tab=community; KHO thì không (link rơi về mục đầu)', async () => {
    stubFeed();
    mocks.auth = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    mocks.access = { role: 'STAFF', staffPermissions: ['CSKH'] };
    window.history.replaceState(null, '', '/admin?tab=community');
    const cskh = await mount();
    expect(navItems(cskh.container)).toContain('Cộng đồng');
    expect(cskh.container.querySelector('h2')!.textContent).toBe('Cộng đồng');
    cskh.unmount();
    mounted = [];

    mocks.access = { role: 'STAFF', staffPermissions: ['KHO'] };
    window.history.replaceState(null, '', '/admin?tab=community');
    const kho = await mount();
    expect(navItems(kho.container)).not.toContain('Cộng đồng');
    expect(kho.container.querySelector('[aria-label="Mục kiểm duyệt cộng đồng"]')).toBeNull();
  });
});
