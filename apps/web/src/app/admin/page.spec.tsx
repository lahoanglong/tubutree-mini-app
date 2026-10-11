// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import AdminPage from './page';
import { click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  auth: { user: { role: 'ADMIN' } as { role: string } | null, status: 'authenticated', initialized: true },
  recycling: 0,
  claims: 0,
  payouts: 0,
  orders: [] as unknown[],
  setUserRole: vi.fn(),
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
  createFlashSale: vi.fn(),
  updateFlashSale: vi.fn(),
  addFlashSaleItem: vi.fn(),
  deleteFlashSaleItem: vi.fn(),
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
    listDealerRewardClaims: async () => ({ data: [], meta: { total: mocks.claims, page: 1, limit: 1 } }),
    listPayouts: async () => ({ data: [], meta: { total: mocks.payouts, page: 1, limit: 1 } }),
    listOrders: async () => ({
      data: mocks.orders,
      meta: { total: 60, page: 1, limit: 20 },
    }),
    listDealerApps: async () => ({
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
    listReturnRequests: async () => ({
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
    listUsers: async () => ({
      data: [
        { id: 'u1', fullName: 'Nguyễn An', phone: '0944444444', role: 'CUSTOMER', pointsBalance: 12, createdAt: '2026-09-01T00:00:00.000Z' },
      ],
      meta: { total: 45, page: 1, limit: 20 },
    }),
    setUserRole: (...args: unknown[]) => mocks.setUserRole(...args),
    createCoupon: (...args: unknown[]) => mocks.createCoupon(...args),
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
  mocks.claims = 0;
  mocks.payouts = 0;
  mocks.orders = [];
  mocks.setUserRole.mockReset();
  mocks.createCoupon.mockReset();
  mocks.config = [];
  mocks.configFails = false;
  mocks.brands = [];
  mocks.brandProducts = [];
  mocks.promotions = [];
  mocks.rewards = [];
  mocks.flashSales = [];
  for (const fn of [
    mocks.createFlashSale, mocks.updateFlashSale, mocks.addFlashSaleItem, mocks.deleteFlashSaleItem,
    mocks.createBrand, mocks.updateBrand, mocks.verifyBrand, mocks.detachBrandProducts,
    mocks.createPromotion, mocks.deletePromotion, mocks.createDealerReward, mocks.deleteDealerReward,
  ]) fn.mockReset();
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

  it('thanh tab cuộn ngang trong khung riêng, mỗi tab cao 44px ở điện thoại và tab đang chọn tô forest', async () => {
    const { container } = await mount();
    const tabs = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Tổng quan KPI');
    const bar = tabs[0]!.parentElement!;
    expect(bar.className).toContain('overflow-x-auto');
    const all = [...bar.querySelectorAll('button')];
    expect(all).toHaveLength(21);
    for (const b of all) expect(b.className).toContain('min-h-[44px]');
    expect(tabs[0]!.className).toContain('border-forest-600');
    expect(all[1]!.className).not.toContain('border-forest-600');
  });

  it('liên kết Màn thu ngân vẫn trỏ /admin/pos và cao 44px ở điện thoại', async () => {
    const { container } = await mount();
    const pos = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/admin/pos')!;
    expect(pos.textContent).toContain('Màn thu ngân');
    expect(pos.className).toContain('min-h-[44px]');
  });
});

describe('admin/page — tab Tổng quan', () => {
  const BADGE: [string, string, string][] = [
    ['Chờ thanh toán', 'bg-warning-bg', 'text-warning-fg'],
    ['Đã xác nhận', 'bg-info-bg', 'text-info-fg'],
    ['Đã đóng gói', 'bg-sage-100', 'text-sage-700'],
    ['Đang vận chuyển', 'bg-forest-100', 'text-forest-800'],
    ['Đã giao hàng', 'bg-success-bg', 'text-success-fg'],
    ['Đã hủy', 'bg-danger-bg', 'text-danger-fg'],
    ['Đã trả hàng', 'bg-promo-bg', 'text-promo-fg'],
  ];

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
  it('nút Xem & Sửa cao 44px ở điện thoại, mở rộng thì hiện sản phẩm + huy hiệu đặt trước theo token và đổi nhãn Đóng ▲', async () => {
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
    const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Xem & Sửa ▼')!;
    expect(toggle.className).toContain('min-h-[44px]');
    expect(container.textContent).toContain('Đại lý · công nợ');
    const dealerNote = [...container.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Đại lý ·'))!;
    expect(dealerNote.className).toContain('text-warning-fg');
    act(() => toggle.click());
    await flush();
    expect(toggle.textContent).toBe('Đóng ▲');
    const pill = [...container.querySelectorAll('span')].find((x) => x.textContent === 'Đặt trước 2')!;
    expect(pill.className).toContain('bg-warning-bg');
    expect(container.textContent).toContain('Ghi chú từ khách: Giao giờ hành chính');
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
    expect(cells.map((c) => c.textContent)).toEqual(['Nguyễn An', '0944444444', 'CUSTOMER', '12', new Date('2026-09-01T00:00:00.000Z').toLocaleDateString('vi-VN')]);
    for (const c of cells) expect(c.className).toContain('px-3');
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
    const h3 = [...container.querySelectorAll('h3')].find((h) => h.textContent === 'Tất cả tham số (JSON)')!;
    expect(h3.className).toContain('font-display');
    expect(h3.nextElementSibling!.className).toContain('text-stone-500');
    expect(container.textContent).toContain('shipping.freeThreshold');
  });

  it('lỗi tải cấu hình báo bằng màu danger và không dựng các thẻ cấu hình', async () => {
    mocks.configFails = true;
    const { container } = await openConfig();
    const err = [...container.querySelectorAll('p')].find((p) => p.textContent === 'Không tải được danh sách cấu hình.')!;
    expect(err.className).toContain('text-danger-fg');
    expect(container.querySelector('h3')).toBeNull();
  });
});

describe('admin/page — tab Voucher', () => {
  const openCoupons = async () => {
    window.history.replaceState(null, '', '/admin?tab=coupons');
    return mount();
  };

  it('ô nhập cao 44px ở điện thoại với viền đủ tương phản, co được trong hàng flex để không tràn ngang', async () => {
    const { container } = await openCoupons();
    const inputs = [...container.querySelectorAll('input, select')];
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
    const heading = container.querySelector('h3')!;
    expect(heading.className).toContain('font-display');
    const inputs = [...container.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    for (const el of inputs) {
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('border-stone-450');
    }
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
    for (const ph of ['Giá flash', 'Quota', 'Giới hạn/khách']) {
      const el = container.querySelector(`input[placeholder="${ph}"]`)!;
      expect(el.className).toContain('min-h-[44px]');
      expect(el.className).toContain('min-w-0');
    }
    const hint = para(container, 'Gõ tên sản phẩm (không cần dấu) hoặc SKU rồi chọn đúng biến thể.');
    expect(hint.className).toContain('text-stone-500');
  });
});
