// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      data: [],
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
