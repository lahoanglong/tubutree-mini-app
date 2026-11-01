// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của pages/vouchers.spec.tsx (Mini App): ba tab Nhận mã / Mã của tôi / Đã dùng–hết hạn trên URL, chip lọc, nhận mã qua
// useClaimCoupon (khách chưa đăng nhập đi tới đăng nhập, không 401), trạng thái rỗng/lỗi, lưới 3 cột từ lg.

const nav = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replaces: [] as string[],
  listeners: new Set<() => void>(),
}));
vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => '/ma-giam-gia',
    useRouter: () => ({
      push: nav.push,
      replace: (url: string) => {
        nav.replaces.push(url);
        nav.search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
        nav.listeners.forEach((l) => l());
      },
    }),
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          (cb) => {
            nav.listeners.add(cb);
            return () => nav.listeners.delete(cb);
          },
          () => nav.search,
          () => nav.search,
        ),
      ),
  };
});

const mocks = vi.hoisted(() => ({ phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'unavailable', get: vi.fn(), post: vi.fn(), use: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-coupon-use', () => ({ useCouponUse: () => ({ copy: vi.fn(), use: mocks.use, notice: null, cancel: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, retrySession: vi.fn(), sessionRateLimited: false }) }));

import { ApiError } from '@/lib/client-api';
import VouchersView from './vouchers-view';

const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const collectable = (code: string, over: Record<string, unknown> = {}) => ({
  code, title: null, type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null, startAt: iso(-DAY), endAt: iso(20 * DAY),
  newCustomerOnly: false, claimedCount: 0, usageLimit: null, ...over,
});
const wallet = (code: string, over: Record<string, unknown> = {}) => ({
  code, type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null, endAt: iso(20 * DAY), ...over,
});

let responses: Record<string, unknown>;
const callsTo = (path: string) => mocks.get.mock.calls.filter(([p]) => p === path);
let mounted: Rendered | null = null;
const mount = () => {
  mounted = render(<VouchersView />);
  return mounted;
};
const text = () => document.body.textContent ?? '';
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name) ?? null;
const buttons = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === name);
const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="tablist"][aria-label="Nhóm mã giảm giá"] [role="tab"]')].find((t) => t.textContent === name) ?? null;
const groups = () => [...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));

beforeEach(() => {
  localStorage.clear();
  nav.search = '';
  nav.replaces = [];
  nav.push.mockReset();
  mocks.phase = 'authenticated';
  mocks.post.mockReset().mockResolvedValue({ code: 'NEW10', alreadyClaimed: false });
  mocks.use.mockReset();
  responses = {
    '/coupons/collectable': [collectable('NEW10', { title: 'Chào bạn mới' }), collectable('SHIP', { type: 'FREESHIP', value: 0 })],
    '/coupons/collectable/mine': { claimed: [], newCustomerOnly: [] },
    '/me/coupons': [],
    '/me/coupons/history': [],
  };
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    const r = responses[path];
    if (r instanceof Error) throw r;
    return r;
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('VouchersView (web)', () => {
  it('khách chưa đăng nhập: tab Nhận mã gọi kho công khai, không gọi ví; thấy thẻ và nút Lưu mã', async () => {
    mocks.phase = 'guest';
    mount();
    await flush();
    expect(text()).toContain('Giảm 30k');
    expect(callsTo('/coupons/collectable')).toHaveLength(1);
    expect(callsTo('/me/coupons')).toHaveLength(0);
    expect(callsTo('/me/coupons/history')).toHaveLength(0);
    expect(callsTo('/coupons/collectable/mine')).toHaveLength(0);
    expect(buttons('Lưu mã')).toHaveLength(2);
    expect(tab('Nhận mã')!.getAttribute('aria-selected')).toBe('true');
  });

  it('khách chưa đăng nhập bấm Lưu mã: chuyển tới đăng nhập kèm returnTo, không gọi POST claim', async () => {
    mocks.phase = 'guest';
    mount();
    await flush();
    click(buttons('Lưu mã')[0]!);
    await flush();
    expect(nav.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fma-giam-gia');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('đã đăng nhập bấm Lưu mã: gọi claim đúng mã, dòng báo "Đã lưu vào Mã của tôi" (role=status), rồi thẻ thành Dùng ngay', async () => {
    mount();
    await flush();
    responses['/me/coupons'] = [wallet('NEW10')];
    click(buttons('Lưu mã')[0]!);
    await flush();
    expect(mocks.post).toHaveBeenCalledWith('/coupons/claim', { code: 'NEW10' });
    expect(document.querySelector('[role="status"]')!.textContent).toContain('Đã lưu vào Mã của tôi');
    expect(buttons('Dùng ngay')).toHaveLength(1);
    expect(buttons('Lưu mã')).toHaveLength(1);
  });

  it('mã đã có trong ví hiện Dùng ngay từ đầu; bấm gọi use đúng mã', async () => {
    responses['/me/coupons'] = [wallet('NEW10')];
    mount();
    await flush();
    click(button('Dùng ngay'));
    expect(mocks.use).toHaveBeenCalledWith('NEW10');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('claim lỗi hết lượt: dòng role=alert có câu máy chủ, tải lại kho, thẻ chuyển Đã hết lượt', async () => {
    mount();
    await flush();
    mocks.post.mockRejectedValue(new ApiError('Mã giảm giá đã hết lượt nhận.', 400));
    responses['/coupons/collectable'] = [
      collectable('NEW10', { title: 'Chào bạn mới', usageLimit: 1, claimedCount: 1 }),
      collectable('SHIP', { type: 'FREESHIP', value: 0 }),
    ];
    click(buttons('Lưu mã')[0]!);
    await flush();
    const alert = [...document.querySelectorAll('[role="alert"]')].find((n) => n.textContent?.includes('Mã giảm giá đã hết lượt nhận.'));
    expect(alert).toBeTruthy();
    expect(callsTo('/coupons/collectable').length).toBeGreaterThanOrEqual(2);
    // Route kho có max-age=15: lần tải lại sau lỗi phải đổi khoá cache HTTP, không thì lấy lại bản cũ.
    expect(callsTo('/coupons/collectable').some(([, opts]) => typeof (opts as { query?: { fresh?: unknown } } | undefined)?.query?.fresh === 'number')).toBe(true);
    expect(text()).toContain('Đã hết lượt');
    expect(buttons('Lưu mã')).toHaveLength(1);
  });

  it('mã đã nhận mà đã dùng hết lượt cá nhân (ví không còn): không có nút Lưu mã, thẻ ghi Đã dùng, mã chưa nhận vẫn Lưu được', async () => {
    responses['/coupons/collectable/mine'] = { claimed: ['NEW10'], newCustomerOnly: [] };
    mount();
    await flush();
    expect(text()).toContain('Đã dùng');
    expect(buttons('Lưu mã')).toHaveLength(1);
    expect(button('Dùng ngay')).toBeNull();
    expect(callsTo('/coupons/collectable/mine')).toHaveLength(1);
  });

  it('mã chỉ dành khách mới mà khách đã có đơn: ghi lý do, không có nút Lưu mã', async () => {
    responses['/coupons/collectable'] = [collectable('NEWONLY', { newCustomerOnly: true }), collectable('SHIP', { type: 'FREESHIP', value: 0 })];
    responses['/coupons/collectable/mine'] = { claimed: [], newCustomerOnly: ['NEWONLY'] };
    mount();
    await flush();
    expect(text()).toContain('Chỉ dành cho khách đặt đơn đầu tiên');
    expect(buttons('Lưu mã')).toHaveLength(1);
  });

  it('mã khách-mới đã nhận mà khách đã có đơn (claimedIneligible): ghi "không còn áp dụng", không ghi Đã dùng, không có nút Lưu mã hay Dùng ngay', async () => {
    responses['/coupons/collectable'] = [collectable('NEWONLY', { newCustomerOnly: true }), collectable('SHIP', { type: 'FREESHIP', value: 0 })];
    responses['/coupons/collectable/mine'] = { claimed: ['NEWONLY'], newCustomerOnly: [], claimedIneligible: ['NEWONLY'] };
    mount();
    await flush();
    expect(text()).toContain('Chỉ dành cho khách đặt đơn đầu tiên, nên không còn áp dụng');
    // Nhãn tab "Đã dùng–hết hạn" cũng chứa chữ này: chỉ dấu trên thẻ mới tính.
    expect(document.querySelector('[data-testid="voucher-stamp"]')).toBeNull();
    expect(buttons('Lưu mã')).toHaveLength(1);
    expect(button('Dùng ngay')).toBeNull();
  });

  it('ví tải lỗi: mã đã nhận không bị ghi Đã dùng, không có nút Dùng ngay, có dải báo lỗi và Thử lại tải lại ví', async () => {
    responses['/coupons/collectable/mine'] = { claimed: ['NEW10'], newCustomerOnly: [] };
    responses['/me/coupons'] = new ApiError('x', 500);
    mount();
    await flush(8);
    expect(text()).toContain('Chưa tải được mã bạn đã lưu');
    // Nhãn tab "Đã dùng–hết hạn" cũng chứa chữ này: chỉ dấu trên thẻ mới tính.
    expect(document.querySelector('[data-testid="voucher-stamp"]')).toBeNull();
    expect(button('Dùng ngay')).toBeNull();
    expect(buttons('Lưu mã')).toHaveLength(1);
    const before = callsTo('/me/coupons').length;
    responses['/me/coupons'] = [wallet('NEW10')];
    click(button('Thử lại'));
    await flush(8);
    expect(callsTo('/me/coupons').length).toBeGreaterThan(before);
    expect(button('Dùng ngay')).not.toBeNull();
    expect(text()).not.toContain('Chưa tải được mã bạn đã lưu');
  });

  it('phần riêng của khách lỗi mạng: vẫn vẽ kho như cũ (máy chủ từ chối lúc nhận)', async () => {
    responses['/coupons/collectable/mine'] = new ApiError('x', 500);
    mount();
    await flush(8);
    expect(buttons('Lưu mã')).toHaveLength(2);
  });

  it('mã còn ít lượt hiện "Còn n lượt"; tên admin đặt ở hàng riêng; có chữ "Mỗi đơn dùng 1 mã"', async () => {
    responses['/coupons/collectable'] = [collectable('NEW10', { title: 'Chào bạn mới', usageLimit: 5, claimedCount: 2 })];
    mount();
    await flush();
    expect(text()).toContain('Còn 3 lượt');
    expect(document.querySelector('[data-testid="voucher-name"]')!.textContent).toBe('Chào bạn mới');
    expect(document.querySelector('[data-testid="voucher-meta"]')!.textContent).toBe('Đơn từ 199k · NEW10');
    expect(text()).toContain('Mỗi đơn dùng 1 mã');
  });

  it('chip Miễn phí giao hàng chỉ giữ mã freeship, aria-pressed đổi; không có chip Của shop; bỏ lọc quay lại', async () => {
    mount();
    await flush();
    expect(button('Của shop')).toBeNull();
    const chip = button('Miễn phí giao hàng')!;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(groups()).toEqual(['Miễn phí giao hàng']);
    click(button('Tất cả'));
    expect(groups()).toHaveLength(2);
  });

  it('bộ lọc không có mã nào khớp: chữ "Không có mã nào ở mục này"', async () => {
    responses['/coupons/collectable'] = [collectable('NEW10')];
    mount();
    await flush();
    click(button('Miễn phí giao hàng'));
    expect(text()).toContain('Không có mã nào ở mục này');
  });

  it('đổi tab ghi ?tab= bằng replace, về Nhận mã thì bỏ tham số, và đặt lại bộ lọc', async () => {
    responses['/me/coupons'] = [wallet('OWN')];
    mount();
    await flush();
    click(button('Miễn phí giao hàng'));
    click(tab('Mã của tôi'));
    await flush();
    expect(nav.replaces).toEqual(['/ma-giam-gia?tab=mine']);
    expect(button('Tất cả')!.getAttribute('aria-pressed')).toBe('true');
    click(tab('Nhận mã'));
    await flush();
    expect(nav.replaces.at(-1)).toBe('/ma-giam-gia');
  });

  it('Mã của tôi, khách chưa đăng nhập: lời mời đăng nhập có liên kết quay lại đúng tab, không gọi ví', async () => {
    mocks.phase = 'guest';
    nav.search = 'tab=mine';
    mount();
    await flush();
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.getAttribute('href')?.startsWith('/dang-nhap'));
    expect(link!.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fma-giam-gia%3Ftab%3Dmine');
    expect(callsTo('/me/coupons')).toHaveLength(0);
  });

  it('Mã của tôi, đã đăng nhập: thẻ ví có Dùng ngay và chữ "Còn 2 ngày"', async () => {
    nav.search = 'tab=mine';
    responses['/me/coupons'] = [wallet('OWN', { endAt: iso(2 * DAY) })];
    mount();
    await flush();
    expect(buttons('Dùng ngay')).toHaveLength(1);
    expect(text()).toContain('Còn 2 ngày');
  });

  it('chấm đỏ Ưu đãi: tab Mã của tôi ghi các mã sắp hết hạn đang vẽ vào danh sách đã xem; tab Nhận mã thì không ghi gì', async () => {
    responses['/me/coupons'] = [wallet('A', { endAt: iso(2 * DAY) }), wallet('B', { endAt: iso(DAY) }), wallet('C', { endAt: iso(2 * DAY) }), wallet('D', { endAt: iso(2 * DAY) }), wallet('LATE', { endAt: iso(20 * DAY) })];
    mount();
    await flush();
    expect(localStorage.getItem('tubu_offers_seen_coupons')).toBeNull();
    click(tab('Mã của tôi'));
    await flush();
    const items = (JSON.parse(localStorage.getItem('tubu_offers_seen_coupons')!) as { items: string[] }).items;
    expect(items.map((k) => k.split('@')[0]).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('Đã dùng–hết hạn: gọi lịch sử, thẻ đã dùng và hết hạn không có nút', async () => {
    nav.search = 'tab=history';
    responses['/me/coupons/history'] = [
      { code: 'USED1', title: null, type: 'AMOUNT', value: 20_000, minOrder: null, maxDiscount: null, endAt: iso(5 * DAY), state: 'used', usedAt: iso(-3600_000) },
      { code: 'OLD1', title: null, type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: iso(-2 * DAY), state: 'expired', usedAt: null },
    ];
    mount();
    await flush();
    expect(text()).toContain('Đã dùng');
    expect(text()).toContain('Đã hết hạn');
    expect(callsTo('/me/coupons/history')).toHaveLength(1);
    expect(buttons('Lưu mã')).toHaveLength(0);
    expect(buttons('Dùng ngay')).toHaveLength(0);
  });

  it('kho lỗi 500: khối lỗi tại chỗ có Thử lại, bấm thì gọi lại và vẽ được danh sách', async () => {
    responses['/coupons/collectable'] = new ApiError('Lỗi máy chủ', 500);
    mount();
    await flush();
    expect(text()).toContain('Chưa tải được mã giảm giá');
    responses['/coupons/collectable'] = [collectable('NEW10')];
    click(button('Thử lại'));
    await flush();
    expect(text()).toContain('Giảm 30k');
    expect(callsTo('/coupons/collectable')).toHaveLength(2);
  });

  it('mọi tab rỗng đều có chữ rỗng riêng, không chip lọc', async () => {
    responses['/coupons/collectable'] = [];
    mount();
    await flush();
    expect(text()).toContain('Hôm nay chưa có mã mới');
    click(tab('Mã của tôi'));
    await flush();
    expect(text()).toContain('Bạn chưa có mã nào dùng được');
    click(tab('Đã dùng–hết hạn'));
    await flush();
    expect(text()).toContain('Chưa có mã đã dùng hoặc hết hạn');
    expect(button('Tất cả')).toBeNull();
  });

  it('danh sách xếp lưới: một cột ở điện thoại, hai ở md, ba từ lg', async () => {
    mount();
    await flush();
    const grid = document.querySelector('[data-testid="voucher-grid"]')!;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('md:grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-3');
  });

  it('có đúng một h1 "Mã giảm giá" và tiêu đề phụ nhắc mỗi đơn dùng 1 mã', async () => {
    mount();
    await flush();
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe('Mã giảm giá');
    expect(byText(document.body, 'header', 'Mỗi đơn dùng 1 mã')).toBeTruthy();
  });
});
