// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerClaimsTab, ClaimRow } from './dealer-claims-tab';
import { OrderInvoicePanel, OrderStatusHistory } from './order-detail-extras';
import { RecyclingBadge, RecyclingPanel } from './recycling-panel';
import { PosCreditsTab } from './pos-credits-tab';
import { PosScreen } from './pos-screen';
import { AccountDeletionPanel, type AdminDeletionRequest } from './account-deletion-panel';
import { ReviewsTab, ReviewStars } from './reviews-tab';
import { SubscriptionsTab } from './subscriptions-tab';
import { CashbackTab } from './cashback-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminDealerRewardClaim, AdminOrder } from '@/lib/admin-client';

// C-097 (Q-25/Q-29): các khối admin còn lại chuyển sang token DS v2 và nút chạm được ở 390px. Chỉ kiểm phần trình
// bày; hành vi nghiệp vụ của từng khối đã có spec riêng.
let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const claim = (over: Partial<AdminDealerRewardClaim> = {}): AdminDealerRewardClaim => ({
  id: 'c1',
  userId: 'u1',
  rewardId: 'r1',
  periodKey: 'Q3/2026',
  rewardTitle: 'Tour Phú Quốc',
  rewardType: 'TOUR',
  rewardPeriod: 'QUARTER',
  threshold: 50_000_000,
  volumeAtClaim: 52_000_000,
  note: null,
  status: 'PENDING',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  adminNote: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  dealer: { id: 'u1', fullName: 'Nguyễn A', phone: '0901234567', businessName: 'Đại lý Xanh' },
  ...over,
});

describe('ClaimRow / DealerClaimsTab — DS v2', () => {
  it('yêu cầu chờ duyệt: "Duyệt" forest, "Từ chối" viền danger, cả hai cao 44px', () => {
    const { container } = mount(<ClaimRow claim={claim()} />);
    const approve = byText(container, 'button', 'Duyệt');
    const reject = byText(container, 'button', 'Từ chối');
    expect(approve?.className).toContain('bg-forest-600');
    expect(approve?.className).toContain('min-h-[44px]');
    expect(reject?.className).toContain('border-danger-fg');
    expect(reject?.className).toContain('min-h-[44px]');
  });

  it('đã duyệt: "Đã trao thưởng" 44px; đã từ chối: "Mở lại yêu cầu" 44px, lý do từ chối tô danger-fg', () => {
    const a = mount(<ClaimRow claim={claim({ status: 'APPROVED' })} />);
    expect(byText(a.container, 'button', 'Đã trao thưởng')?.className).toContain('min-h-[44px]');
    const r = mount(<ClaimRow claim={claim({ status: 'REJECTED', rejectionReason: 'Nhầm kỳ' })} />);
    expect(byText(r.container, 'button', 'Mở lại yêu cầu')?.className).toContain('min-h-[44px]');
    expect(byText(r.container, 'span', 'Nhầm kỳ')?.className).toContain('text-danger-fg');
  });

  it('thanh lọc trạng thái: chip 44px, chip đang chọn nền forest, mặc định lọc PENDING', async () => {
    const api = mockFetch({ '/admin/dealer-reward-claims': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerClaimsTab />);
    await flush();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
    for (const t of tabs) expect(t.className).toContain('min-h-[44px]');
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.className).toContain('bg-forest-600');
    expect(api.calls[0]!.url).toContain('status=PENDING');
  });
});

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-500',
  status: 'DELIVERED',
  total: 300_000,
  paymentMethod: 'COD',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('order-detail-extras — DS v2', () => {
  it('lịch sử trạng thái: nút mở dùng icon chevron (không ký tự ▲▼), lỗi tô danger-fg, "Thử lại" cao 44px', async () => {
    const bad = mockFetch({ '/status-history': { status: 500, body: { message: 'Lỗi máy chủ' } } });
    vi.stubGlobal('fetch', vi.fn(bad.fn));
    const { container } = mount(<OrderStatusHistory order={order()} />);
    const toggle = byText(container, 'button', 'Lịch sử trạng thái')!;
    expect(toggle.textContent).not.toMatch(/[▲▼]/);
    expect(toggle.querySelector('svg')).not.toBeNull();
    click(toggle);
    await flush();
    expect(container.querySelector('[role="alert"]')?.className).toContain('text-danger-fg');
    expect(byText(container, 'button', 'Thử lại')?.className).toContain('min-h-[44px]');
  });

  it('hoá đơn VAT: ô link và nút "Đã xuất hoá đơn" cao 44px, nút chính forest', () => {
    const { container } = mount(
      <OrderInvoicePanel
        order={order({
          invoiceStatus: 'REQUESTED',
          invoiceRequest: { taxCode: '0312345678', companyName: 'Công ty ABC', address: '1 Lê Lợi', email: 'a@b.vn' },
        })}
      />,
    );
    expect(container.querySelector('input[type="url"]')?.className).toContain('min-h-[44px]');
    const btn = byText(container, 'button', 'Đã xuất hoá đơn');
    expect(btn?.className).toContain('min-h-[44px]');
    expect(btn?.className).toContain('bg-forest-600');
  });
});

describe('RecyclingPanel — DS v2', () => {
  const recyclingOrder = (over: Partial<AdminOrder> = {}) =>
    order({ hasRecyclingPickup: true, status: 'CONFIRMED', gomdonStatus: 'FAILED', ...over });

  it('nút tạo lại/huỷ vận đơn, ô ghi chú và "Đã xử lý tay" cao 44px; ô tích xác nhận có nhãn chạm 44px', () => {
    const { container } = mount(<RecyclingPanel order={recyclingOrder()} />);
    for (const label of ['Tạo lại vận đơn Gomdon', 'Đã xử lý tay']) {
      expect(byText(container, 'button', label)?.className).toContain('min-h-[44px]');
    }
    expect(container.querySelector('input[aria-label="Ghi chú đã xử lý tay"]')?.className).toContain('min-h-[44px]');
    expect(container.querySelector('label')?.className).toContain('min-h-[44px]');
    expect(container.querySelector('input[type="checkbox"]')?.className).toContain('accent-forest-600');
    expect(byText(container, 'button', 'Tạo lại vận đơn Gomdon')?.className).toContain('bg-forest-600');
  });

  it('"Huỷ vận đơn Gomdon" viền danger, cao 44px', () => {
    const { container } = mount(
      <RecyclingPanel order={recyclingOrder({ gomdonStatus: '1', gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1' })} />,
    );
    const btn = byText(container, 'button', 'Huỷ vận đơn Gomdon');
    expect(btn?.className).toContain('border-danger-fg');
    expect(btn?.className).toContain('min-h-[44px]');
  });

  it('huy hiệu danh sách: "cần xử lý" tông danger, bình thường tông success', () => {
    const a = mount(<RecyclingBadge order={recyclingOrder()} />);
    expect(a.container.querySelector('span')?.className).toContain('bg-danger-bg');
    const b = mount(<RecyclingBadge order={recyclingOrder({ gomdonStatus: '1', gomdonOrderId: 'g1' })} />);
    expect(b.container.querySelector('span')?.className).toContain('bg-success-bg');
  });
});

describe('PosCreditsTab — DS v2', () => {
  const CREDIT = {
    id: 'c1',
    receiptId: 'HD-001',
    orderTotal: 250_000,
    points: 25,
    multiplier: 2,
    note: null,
    dayKey: '2026-10-10',
    createdAt: '2026-10-10T03:00:00.000Z',
    staff: { id: 'staff1', name: 'Thu Hà', phone: '0900000002' },
    member: { id: 'mem1', name: 'Nguyễn An', phone: '0900000001', memberCode: 'TB-AN01' },
  };

  it('liên kết "Mở màn thu ngân" cao 44px; nút lọc theo người trong bảng cao 44px; điểm tô forest', async () => {
    const api = mockFetch({ '/admin/loyalty/pos-credits': { body: [CREDIT] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PosCreditsTab />);
    await flush();
    const link = container.querySelector('a[href="/admin/pos"]');
    expect(link?.className).toContain('min-h-[44px]');
    expect(byText(container, 'button', 'Nguyễn An')?.className).toContain('min-h-[44px]');
    expect(byText(container, 'button', 'Thu Hà')?.className).toContain('min-h-[44px]');
    expect(byText(container, 'button', 'Xoá lọc')?.className).toContain('min-h-[44px]');
    expect(container.querySelector('td.text-forest-700')?.textContent).toContain('+25');
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('lỗi tải tô danger-fg', async () => {
    const api = mockFetch({ '/admin/loyalty/pos-credits': { status: 500, body: { message: 'Lỗi máy chủ' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PosCreditsTab />);
    await flush();
    expect(container.querySelector('p.text-danger-fg')?.textContent).toContain('Lỗi máy chủ');
  });
});

describe('PosScreen — DS v2 (màn thu ngân, chạm trên điện thoại)', () => {
  const member = { id: 'm1', memberCode: 'TUBUABCD1234', name: 'Trần B', phone: '090****567', tier: 'Mầm Xanh', pointsBalance: 120 };

  it('ô mã thành viên và nút "Tra cứu" cao 44px; sau khi tra: ô nhập, nút "Tích điểm" 44px, thẻ thành viên theo forest', async () => {
    const api = mockFetch({
      '/me/loyalty/member-card': { body: { posCreditEnabled: true } },
      '/loyalty/staff/scan-member': { body: { member } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<PosScreen />);
    await flush();
    expect(container.querySelector('input[aria-label="Mã thành viên"]')?.className).toContain('min-h-[44px]');
    typeInto(container.querySelector('input[aria-label="Mã thành viên"]'), 'TUBUABCD1234');
    expect(byText(container, 'button', 'Tra cứu')?.className).toContain('min-h-[44px]');
    click(byText(container, 'button', 'Tra cứu'));
    await flush();
    for (const label of ['Tổng tiền hoá đơn', 'Mã hoá đơn POS', 'Ghi chú']) {
      expect(container.querySelector(`input[aria-label="${label}"]`)?.className).toContain('min-h-[44px]');
    }
    expect(byText(container, 'button', 'Tích điểm')?.className).toContain('min-h-[44px]');
    expect(container.querySelector('[aria-label="Thành viên"]')?.className).toContain('bg-forest-50');
    expect(container.querySelector('h2')?.className).toContain('font-display');
  });
});

describe('AccountDeletionPanel — DS v2', () => {
  const deletion = (over: Partial<AdminDeletionRequest> = {}): AdminDeletionRequest => ({
    id: 'r1',
    userId: 'u1',
    reason: 'Không dùng nữa',
    status: 'PENDING',
    adminNote: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-10-01T03:00:00.000Z',
    user: { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0912345678', role: 'CUSTOMER', walletBalance: 0, pointsConvertedBalance: 0, cashbackPending: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    blockers: [],
    ...over,
  });

  it('chip lọc 44px (đang chọn nền forest); nút "Xử lý (ẩn danh)" tông danger đặc, cao 44px', async () => {
    const api = mockFetch({ '/admin/account-deletion-requests': { body: [deletion()] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(tabs).toHaveLength(3);
    for (const t of tabs) expect(t.className).toContain('min-h-[44px]');
    expect(tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.className).toContain('bg-forest-600');
    const run = byText(container, 'button', 'Xử lý (ẩn danh)');
    expect(run?.className).toContain('bg-danger-fg');
    expect(run?.className).toContain('min-h-11');
  });

  it('lý do chặn nằm trong khối tông warning và khoá nút xử lý', async () => {
    const api = mockFetch({
      '/admin/account-deletion-requests': { body: [deletion({ blockers: [{ code: 'WALLET_BALANCE', message: 'Ví còn tiền' }] })] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(byText(container, 'li', 'Ví còn tiền')?.closest('div')?.className).toContain('bg-warning-bg');
    expect((byText(container, 'button', 'Xử lý (ẩn danh)') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ReviewsTab / SubscriptionsTab / CashbackTab — DS v2', () => {
  const REVIEW = {
    id: 'r1',
    rating: 4,
    comment: 'Dùng tốt',
    images: [],
    videoUrl: 'https://cdn.example.com/v.mp4',
    isVisible: true,
    isVerified: true,
    createdAt: '2026-10-01T03:00:00.000Z',
    user: { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001' },
    product: { id: 'p1', name: 'Nước rửa chén Lá Sả', slug: 'nuoc-rua-chen' },
  };
  const page = <T,>(data: T[]) => ({ data, meta: { page: 1, limit: 20, total: data.length } });

  it('ReviewStars vẽ đủ 5 icon, số sao đầy theo điểm (kẹp 0..5), không dùng ký tự ★☆', () => {
    const { container } = mount(
      <>
        <ReviewStars rating={4} />
        <ReviewStars rating={9} />
        <ReviewStars rating={0} />
      </>,
    );
    const groups = Array.from(container.querySelectorAll('[role="img"]'));
    expect(groups.map((g) => g.querySelectorAll('svg').length)).toEqual([5, 5, 5]);
    expect(groups.map((g) => g.querySelectorAll('svg.fill-current').length)).toEqual([4, 5, 0]);
    expect(container.textContent).not.toMatch(/[★☆]/);
    expect(groups[0]!.getAttribute('aria-label')).toBe('4 sao');
  });

  it('đánh giá: chip lọc/ô chọn sao/nút ẩn/liên kết video đều 44px; nút "Ẩn đánh giá" viền danger', async () => {
    const api = mockFetch({ '/admin/reviews': { body: page([REVIEW]) } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<ReviewsTab />);
    await flush();
    for (const t of Array.from(container.querySelectorAll('[role="tab"]'))) expect(t.className).toContain('min-h-[44px]');
    expect(container.querySelector('select')?.className).toContain('min-h-[44px]');
    const hide = byText(container, 'button', 'Ẩn đánh giá');
    expect(hide?.className).toContain('border-danger-fg');
    expect(hide?.className).toContain('min-h-[44px]');
    expect(container.querySelector('a[href="https://cdn.example.com/v.mp4"]')?.className).toContain('min-h-[44px]');
  });

  it('gói định kỳ: chip trạng thái 44px, chip đang chọn nền forest', async () => {
    const api = mockFetch({ '/admin/subscriptions': { body: page([]) } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(tabs).toHaveLength(4);
    for (const t of tabs) expect(t.className).toContain('min-h-[44px]');
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')[0]!.className).toContain('bg-forest-600');
  });

  it('hoàn tiền sàn ngoài: "Duyệt hoàn tiền" forest, "Từ chối" viền danger, chip lọc đang chọn forest, tất cả 44px', async () => {
    const TXN = {
      id: 't1',
      userId: 'u1',
      provider: 'accesstrade',
      merchantOrderId: 'SP-9001',
      orderAmount: 500_000,
      commission: 25_000,
      userReward: 12_000,
      status: 'PENDING',
      confirmedAt: null,
      paidAt: null,
      user: { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001' },
      merchant: { name: 'Shopee', slug: 'shopee' },
    };
    const api = mockFetch({ '/admin/cashback': { body: [TXN] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<CashbackTab />);
    await flush();
    const approve = byText(container, 'button', 'Duyệt hoàn tiền')!;
    const reject = byText(container, 'button', 'Từ chối')!;
    expect(approve.className).toContain('bg-forest-600');
    expect(approve.className).toContain('min-h-[44px]');
    expect(reject.className).toContain('border-danger-fg');
    expect(reject.className).toContain('min-h-[44px]');
    const pending = byText(container, 'button', 'Chờ duyệt')!;
    expect(pending.className).toContain('bg-forest-600');
    expect(pending.className).toContain('min-h-[44px]');
  });
});
