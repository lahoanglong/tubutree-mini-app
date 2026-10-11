// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import AdminPage from './page';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  auth: { user: { role: 'ADMIN' } as { role: string } | null, status: 'authenticated', initialized: true },
  recycling: 0,
  claims: 0,
  payouts: 0,
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
    listDealerTiers: async () => [{ id: 't1', name: 'Bạc', minOrderVolume: 0, creditLimit: 0, paymentTerms: null }],
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
