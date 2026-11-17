// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của components/offers/offers-collect.spec.tsx (Mini App): 3 mã đầu, "Tất cả n mã" mở tại chỗ, chip lọc, lỗi tại chỗ, giữ chỗ theo gợi ý.
type Notice = { code: string; text: string; error: boolean } | null;
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  push: vi.fn(),
  claim: vi.fn(),
  claimReturnTo: vi.fn(),
  use: vi.fn(),
  state: {
    pendingCode: null as string | null,
    usingCode: null as string | null,
    notice: null as Notice,
    useNotice: null as Notice,
    phase: 'guest' as 'authenticated' | 'guest' | 'loading',
  },
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.state.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/use-claim-coupon', () => ({
  useClaimCoupon: (returnTo: string) => {
    mocks.claimReturnTo(returnTo);
    return { claim: mocks.claim, pendingCode: mocks.state.pendingCode, notice: mocks.state.notice };
  },
}));
vi.mock('@/lib/use-coupon-use', () => ({ useCouponUse: () => ({ use: mocks.use, notice: mocks.state.useNotice, usingCode: mocks.state.usingCode }) }));

import { COLLECT_HINT_KEY } from '@tubutree/app-core/home-layout';
import { ApiError } from '@/lib/client-api';
import { OffersCollect, type OffersWallet } from './offers-collect';

const DAY = 86_400_000;
const coupon = (code: string, over: Record<string, unknown> = {}) => ({
  code, title: null, type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null,
  startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + 20 * DAY).toISOString(),
  newCustomerOnly: false, claimedCount: 0, usageLimit: null, ...over,
});

const inWallet = (code: string) => ({ code, type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null, endAt: new Date(Date.now() + 20 * DAY).toISOString() });
const walletOf = (codes: string[], over: Partial<OffersWallet> = {}): OffersWallet => ({
  data: codes.map(inWallet) as OffersWallet['data'],
  isError: false,
  isLoading: false,
  error: null,
  refetch: vi.fn(async () => undefined),
  ...over,
});

let collectable: unknown;
let mine: unknown;
const MINE_PATH = '/coupons/collectable/mine';
const mineCalls = () => mocks.get.mock.calls.filter(([p]) => p === MINE_PATH);
let mounted: Rendered | null = null;
const mount = async (walletCodes: string[] = [], walletLoading = false, openAll = false, wallet?: OffersWallet) => {
  mounted = render(<OffersCollect wallet={wallet ?? walletOf(walletCodes, { isLoading: walletLoading })} openAll={openAll} />);
  await flush(8);
  return mounted.container;
};
const buttons = (root: ParentNode, name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === name);

beforeEach(() => {
  localStorage.clear();
  mocks.push.mockReset();
  mocks.claim.mockReset();
  mocks.claimReturnTo.mockReset();
  mocks.use.mockReset();
  mocks.state.pendingCode = null;
  mocks.state.usingCode = null;
  mocks.state.notice = null;
  mocks.state.useNotice = null;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.state.phase = 'guest';
  collectable = [];
  mine = { claimed: [], newCustomerOnly: [] };
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === MINE_PATH) return mine;
    if (collectable instanceof Error) throw collectable;
    return collectable;
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OffersCollect (web) — khối Nhận mã ở trang Ưu đãi', () => {
  it('5 mã chưa nhận: chỉ 3 thẻ đầu, "Lưu mã" gọi claim, "Tất cả (5)" mở cả kho ngay tại chỗ (không sang trang khác)', async () => {
    collectable = ['A', 'B', 'C', 'D', 'E'].map((c, i) => coupon(c, { endAt: new Date(Date.now() + (i + 2) * DAY).toISOString() }));
    const c = await mount();
    const region = c.querySelector('section[aria-labelledby]')!;
    expect(region.querySelectorAll('[role="group"]')).toHaveLength(3);
    click(buttons(region, 'Lưu mã')[0]!);
    expect(mocks.claim).toHaveBeenCalledWith('A');
    const all = region.querySelector<HTMLButtonElement>('button[aria-label="Tất cả (5) Mã giảm giá"]')!;
    expect(all.textContent).toContain('Tất cả (5)');
    expect(mocks.claimReturnTo).toHaveBeenLastCalledWith('/uu-dai');
    click(all);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(region.querySelectorAll('[role="group"]')).toHaveLength(5);
    // Khách chưa đăng nhập bấm Lưu mã ở khối mở: đăng nhập xong quay lại đúng khối mở.
    expect(mocks.claimReturnTo).toHaveBeenLastCalledWith('/uu-dai?codes=all');
  });

  it('mã đã có trong ví hoặc đã hết lượt không chiếm chỗ: chỉ mã nhận được ngay; nhãn đếm đủ số thẻ khối mở sẽ vẽ', async () => {
    collectable = [coupon('MINE'), coupon('FULL', { usageLimit: 3, claimedCount: 3 }), coupon('OPEN')];
    const c = await mount(['MINE']);
    expect(c.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(c.textContent).toContain('OPEN');
    // Khối mở vẽ cả mã đã lưu và mã hết lượt: 3 thẻ, không phải 1.
    expect(c.querySelector('button[aria-label="Tất cả (3) Mã giảm giá"]')!.textContent).toContain('Tất cả (3)');
  });

  it('khách chưa đăng nhập không gọi phần riêng của khách', async () => {
    collectable = [coupon('A')];
    await mount();
    expect(mineCalls()).toHaveLength(0);
  });

  it('mã khách đã nhận mà ví không còn (đã dùng hết lượt cá nhân) không chiếm chỗ và không có nút Lưu mã', async () => {
    mocks.state.phase = 'authenticated';
    collectable = [coupon('USED', { usageLimit: 100, claimedCount: 10 }), coupon('OPEN')];
    mine = { claimed: ['USED'], newCustomerOnly: [] };
    const c = await mount();
    expect(c.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(c.textContent).toContain('OPEN');
    expect(c.textContent).not.toContain('USED');
    expect(c.querySelector('button[aria-label="Tất cả (2) Mã giảm giá"]')!.textContent).toContain('Tất cả (2)');
  });

  it('mã chỉ dành khách mới mà khách đã có đơn không chiếm chỗ; chỉ còn mã ấy thì ẩn cả khối', async () => {
    mocks.state.phase = 'authenticated';
    collectable = [coupon('NEWONLY', { newCustomerOnly: true })];
    mine = { claimed: [], newCustomerOnly: ['NEWONLY'] };
    const c = await mount();
    expect(mineCalls()).toHaveLength(1);
    expect(c.innerHTML).toBe('');
  });

  it('phần riêng của khách chưa tải xong thì chưa vẽ thẻ Lưu mã (khỏi nháy rồi biến mất)', async () => {
    mocks.state.phase = 'authenticated';
    collectable = [coupon('USED'), coupon('OPEN')];
    let release: (v: unknown) => void = () => undefined;
    mocks.get.mockImplementation(async (path: string) => (path === MINE_PATH ? new Promise((r) => (release = r)) : collectable));
    const c = await mount();
    expect(buttons(c, 'Lưu mã')).toHaveLength(0);
    release({ claimed: ['USED'], newCustomerOnly: [] });
    await flush(6);
    expect(buttons(c, 'Lưu mã')).toHaveLength(1);
  });

  it('không có mã nào nhận được: không vẽ gì', async () => {
    collectable = [coupon('MINE')];
    const c = await mount(['MINE']);
    expect(c.innerHTML).toBe('');
  });

  it('tải lỗi: khối lỗi tại chỗ có "Thử lại", bấm thì gọi lại và vẽ được mã', async () => {
    collectable = new ApiError('x', 500);
    const c = await mount();
    expect(c.textContent).toContain('Chưa tải được mã giảm giá');
    collectable = [coupon('A')];
    click(buttons(c, 'Thử lại')[0]!);
    await flush(6);
    expect(buttons(c, 'Lưu mã')).toHaveLength(1);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('"Thử lại" trả Promise tải lại: hai cú bấm cùng khung hình chỉ tải lại một lần, nút báo bận tới khi xong, xong thì vẽ được mã', async () => {
    // Truy vấn phải ĐÃ có dữ liệu (rỗng) rồi mới lỗi: chưa có dữ liệu thì lần tải thứ hai tự gộp vào lần đang chạy và đếm API không chứng minh được khoá.
    collectable = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted = render(<OffersCollect wallet={walletOf([])} />, qc);
    await flush(6);
    collectable = new ApiError('x', 500);
    await act(async () => {
      await qc.refetchQueries();
    });
    await flush(2);
    const c = mounted.container;
    expect(c.textContent).toContain('Chưa tải được mã giảm giá');
    const retry = buttons(c, 'Thử lại')[0]!;
    const before = mocks.get.mock.calls.length;

    let finish!: (v: unknown) => void;
    collectable = new Promise((resolve) => { finish = resolve; });
    await act(async () => {
      click(retry);
      click(retry);
    });
    expect(mocks.get.mock.calls.length - before).toBe(1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.disabled).toBe(false);

    await act(async () => finish([coupon('A')]));
    await flush(4);
    expect(buttons(c, 'Lưu mã')).toHaveLength(1);
    expect(mocks.get.mock.calls.length - before).toBe(1);
  });

  it('đang nhận một mã: nút của mã đó báo bận (aria-busy)', async () => {
    collectable = [coupon('A'), coupon('B')];
    mocks.state.pendingCode = 'A';
    const c = await mount();
    const [first, second] = buttons(c, 'Lưu mã');
    expect(first!.getAttribute('aria-busy')).toBe('true');
    expect(second!.getAttribute('aria-busy')).toBeNull();
  });

  it('kết quả nhận mã in một dòng ngay dưới tiêu đề: thành công role=status, lỗi role=alert', async () => {
    collectable = [coupon('A')];
    mocks.state.notice = { code: 'A', text: 'Đã lưu vào Mã của tôi', error: false };
    let c = await mount();
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Đã lưu vào Mã của tôi');
    mounted!.unmount();
    mocks.state.notice = { code: 'A', text: 'Mã giảm giá đã hết lượt nhận.', error: true };
    c = await mount();
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Mã giảm giá đã hết lượt nhận.');
  });

  it('nhớ số mã lần trước để giữ chỗ lúc tải: gợi ý 2 thì khung chờ có tiêu đề 44px + 2 ô cao 88px trong cùng lưới, chưa nhớ thì im lặng', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.get.mockImplementation(() => new Promise((r) => (release = r)));
    localStorage.setItem(COLLECT_HINT_KEY, '2');
    mounted = render(<OffersCollect wallet={walletOf([])} />);
    await flush(2);
    const frame = mounted.container.querySelector<HTMLElement>('[data-testid="offers-collect-loading"]')!;
    expect((frame.firstElementChild as HTMLElement).style.height).toBe('44px');
    const grid = frame.lastElementChild as HTMLElement;
    expect(grid.className).toContain('lg:grid-cols-3');
    expect([...grid.children].map((s) => (s as HTMLElement).style.height)).toEqual(['88px', '88px']);
    release([]);
    await flush(6);
    expect(mounted.container.innerHTML).toBe('');
    expect(localStorage.getItem(COLLECT_HINT_KEY)).toBe('0');
    mounted.unmount();
    localStorage.clear();
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    mounted = render(<OffersCollect wallet={walletOf([])} />);
    await flush(2);
    expect(mounted.container.innerHTML).toBe('');
  });

  it('ghi gợi ý số thẻ đã vẽ (tối đa 3) sau khi tải xong', async () => {
    collectable = ['A', 'B', 'C', 'D'].map((c) => coupon(c));
    await mount();
    expect(localStorage.getItem(COLLECT_HINT_KEY)).toBe('3');
  });

  it('lưới của khối: một cột ở điện thoại, hai ở md, ba từ lg', async () => {
    collectable = [coupon('A')];
    const c = await mount();
    const grid = c.querySelector('[data-testid="offers-collect-grid"]')!;
    for (const cls of ['grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3']) expect(grid.className).toContain(cls);
  });
});

describe('OffersCollect (web) — kho mã mở tại chỗ (thay trang /ma-giam-gia cũ)', () => {
  const section = (c: ParentNode) => c.querySelector<HTMLElement>('section[aria-labelledby]')!;
  const groups = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[role="group"]')];
  const expandAll = async (c: ParentNode) => {
    click(section(c).querySelector<HTMLButtonElement>('button[aria-label^="Tất cả ("]'));
    await waitFrame();
    return section(c);
  };
  // Focus dời bằng requestAnimationFrame: chờ qua một khung hình.
  const waitFrame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

  it('mở: vẽ MỌI mã kể cả đã lưu (Dùng ngay gọi luồng dùng mã), đã dùng hết lượt cá nhân (Đã dùng), hết lượt; câu "Mỗi đơn dùng 1 mã"; focus vào chip Tất cả', async () => {
    mocks.state.phase = 'authenticated';
    collectable = [coupon('OPEN'), coupon('SAVED'), coupon('SPENT', { usageLimit: 100, claimedCount: 3 }), coupon('FULL', { usageLimit: 3, claimedCount: 3 })];
    mine = { claimed: ['SAVED', 'SPENT'], newCustomerOnly: [] };
    const c = await mount(['SAVED']);
    const region = await expandAll(c);
    expect(groups(region)).toHaveLength(4);
    expect(region.textContent).toContain('Mỗi đơn dùng 1 mã');
    expect(buttons(region, 'Lưu mã')).toHaveLength(1);
    expect(region.textContent).toContain('Đã dùng');
    expect(region.textContent).toContain('Đã hết lượt');
    click(buttons(region, 'Dùng ngay')[0]!);
    expect(mocks.use).toHaveBeenCalledWith('SAVED');
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons(region, 'Tất cả')[0]);
    expect(region.querySelector('button[aria-label^="Tất cả ("]')).toBeNull();
  });

  it('đang dùng một mã: nút Dùng ngay của mã đó báo bận, mã khác tạm khoá; dòng kết quả dùng mã hiện dưới tiêu đề', async () => {
    mocks.state.phase = 'authenticated';
    collectable = [coupon('S1'), coupon('S2')];
    mine = { claimed: ['S1', 'S2'], newCustomerOnly: [] };
    mocks.state.usingCode = 'S1';
    mocks.state.useNotice = { code: 'S1', text: 'Đơn chưa đủ tối thiểu', error: true };
    const c = await mount(['S1', 'S2'], false, true);
    const [first, second] = buttons(section(c), 'Dùng ngay');
    expect(first!.getAttribute('aria-busy')).toBe('true');
    expect(second!.getAttribute('aria-disabled')).toBe('true');
    expect(section(c).querySelector('[role="alert"]')!.textContent).toBe('Đơn chưa đủ tối thiểu');
  });

  it('chỉ dành khách mới mà khách đã có đơn: ghi lý do; đã nhận mà không còn áp dụng: ghi "không còn áp dụng", không Đã dùng, không nút', async () => {
    mocks.state.phase = 'authenticated';
    collectable = [coupon('OPEN'), coupon('NEWONLY', { newCustomerOnly: true }), coupon('LAPSED', { newCustomerOnly: true })];
    mine = { claimed: ['LAPSED'], newCustomerOnly: ['NEWONLY'], claimedIneligible: ['LAPSED'] };
    const c = await mount([], false, true);
    const region = section(c);
    expect(region.textContent).toContain('Chỉ dành cho khách đặt đơn đầu tiên, nên không còn áp dụng');
    expect(region.textContent).not.toContain('Đã dùng');
    expect(buttons(region, 'Lưu mã')).toHaveLength(1);
    expect(buttons(region, 'Dùng ngay')).toHaveLength(0);
  });

  it('chip Miễn phí giao hàng chỉ giữ mã freeship (aria-pressed đổi); bộ lọc rỗng có "Xem tất cả mã" đặt lại về Tất cả và trả focus', async () => {
    collectable = [coupon('NEW10'), coupon('SHIP', { type: 'FREESHIP', value: 0 })];
    let c = await mount([], false, true);
    let region = section(c);
    expect(buttons(region, 'Của shop')).toHaveLength(0);
    const ship = buttons(region, 'Miễn phí giao hàng')[0]!;
    expect(ship.getAttribute('aria-pressed')).toBe('false');
    click(ship);
    expect(ship.getAttribute('aria-pressed')).toBe('true');
    expect(groups(region).map((g) => g.getAttribute('aria-label'))).toEqual(['Miễn phí giao hàng']);
    mounted!.unmount();

    collectable = [coupon('NEW10')];
    c = await mount([], false, true);
    region = section(c);
    click(buttons(region, 'Miễn phí giao hàng')[0]!);
    expect(region.textContent).toContain('Không có mã nào ở mục này');
    click(buttons(region, 'Xem tất cả mã')[0]!);
    await waitFrame();
    expect(groups(region)).toHaveLength(1);
    const all = buttons(region, 'Tất cả')[0]!;
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(all);
  });

  it('Sắp hết hạn: mã đã dùng hết lượt cá nhân dù hạn còn trong 3 ngày không lọt vào chip', async () => {
    mocks.state.phase = 'authenticated';
    const soon = new Date(Date.now() + DAY).toISOString();
    collectable = [coupon('OPEN', { title: 'Mã còn nhận', endAt: soon }), coupon('SPENT', { title: 'Mã đã dùng hết', endAt: soon })];
    mine = { claimed: ['SPENT'], newCustomerOnly: [] };
    const c = await mount([], false, true);
    const region = section(c);
    click(buttons(region, 'Sắp hết hạn')[0]!);
    expect(region.textContent).toContain('Mã còn nhận');
    expect(region.textContent).not.toContain('Mã đã dùng hết');
  });

  it('ví tải lỗi: mã đã nhận không bị ghi Đã dùng, không Dùng ngay; dải "Chưa tải được mã bạn đã lưu" có Thử lại (trả Promise) tải lại ví', async () => {
    mocks.state.phase = 'authenticated';
    collectable = [coupon('NEW10'), coupon('OPEN')];
    mine = { claimed: ['NEW10'], newCustomerOnly: [] };
    const wallet = walletOf([], { data: undefined, isError: true, error: new ApiError('x', 500) });
    const c = await mount([], false, true, wallet);
    const region = section(c);
    expect(region.textContent).toContain('Chưa tải được mã bạn đã lưu');
    expect(region.textContent).not.toContain('Đã dùng');
    expect(buttons(region, 'Dùng ngay')).toHaveLength(0);
    expect(buttons(region, 'Lưu mã')).toHaveLength(1);
    await act(async () => click(buttons(region, 'Thử lại')[0]!));
    expect(wallet.refetch).toHaveBeenCalledTimes(1);
  });

  it('"Thu gọn" (aria-expanded, trỏ vào danh sách) về 3 mã, đặt lại bộ lọc, trả focus về "Tất cả (n)"', async () => {
    collectable = ['A', 'B', 'C', 'D', 'E'].map((code) => coupon(code));
    const c = await mount();
    const region = await expandAll(c);
    click(buttons(region, 'Miễn phí giao hàng')[0]!);
    const collapse = buttons(region, 'Thu gọn')[0]!;
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(collapse.getAttribute('aria-controls')!)).not.toBeNull();
    click(collapse);
    await waitFrame();
    expect(groups(region)).toHaveLength(3);
    expect(buttons(region, 'Thu gọn')).toHaveLength(0);
    const all = region.querySelector<HTMLButtonElement>('button[aria-label="Tất cả (5) Mã giảm giá"]')!;
    expect(document.activeElement).toBe(all);
    click(all);
    expect(buttons(region, 'Tất cả')[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(groups(region)).toHaveLength(5);
  });

  it('mở sẵn (?codes=all): lúc tải giữ chỗ 3 ô kể cả chưa có gợi ý; vào chỗ thì cuộn tới khối đúng một lần', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.get.mockImplementation((path: string) => (path === MINE_PATH ? Promise.resolve(mine) : new Promise((r) => (release = r))));
    mounted = render(<OffersCollect wallet={walletOf([])} openAll />);
    await flush(2);
    const frame = mounted.container.querySelector<HTMLElement>('[data-testid="offers-collect-loading"]')!;
    expect((frame.lastElementChild as HTMLElement).children).toHaveLength(3);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    release([coupon('A'), coupon('B')]);
    await flush(6);
    const region = section(mounted.container);
    expect(groups(region)).toHaveLength(2);
    expect(buttons(region, 'Thu gọn')).toHaveLength(1);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    click(buttons(region, 'Miễn phí giao hàng')[0]!);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('đang ở Ưu đãi mà bấm lối tắt Mã giảm giá (?codes=all): khối mở cả kho tại chỗ và cuộn tới', async () => {
    collectable = [coupon('A'), coupon('B'), coupon('C'), coupon('D')];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted = render(<OffersCollect wallet={walletOf([])} />, client);
    await flush(8);
    expect(buttons(section(mounted.container), 'Thu gọn')).toHaveLength(0);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    const r = mounted;
    act(() => r.root.render(<QueryClientProvider client={client}><OffersCollect wallet={walletOf([])} openAll /></QueryClientProvider>));
    await flush(4);
    expect(groups(section(mounted.container))).toHaveLength(4);
    expect(buttons(section(mounted.container), 'Thu gọn')).toHaveLength(1);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('mở sẵn mà kho trống: khối vẫn hiện "Hôm nay chưa có mã mới", không chip, không "Thu gọn"', async () => {
    collectable = [];
    const c = await mount([], false, true);
    expect(section(c).textContent).toContain('Hôm nay chưa có mã mới');
    expect(section(c).querySelectorAll('button')).toHaveLength(0);
  });

  it('gập (không có ?codes=all) thì không cuộn trang', async () => {
    collectable = [coupon('A')];
    await mount();
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
