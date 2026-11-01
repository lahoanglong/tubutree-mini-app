// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của components/offers/offers-collect.spec.tsx (Mini App): 3 mã đầu, "Tất cả n mã", lỗi tại chỗ, giữ chỗ theo gợi ý.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  push: vi.fn(),
  claim: vi.fn(),
  state: { pendingCode: null as string | null, notice: null as { code: string; text: string; error: boolean } | null },
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/use-claim-coupon', () => ({ useClaimCoupon: () => ({ claim: mocks.claim, pendingCode: mocks.state.pendingCode, notice: mocks.state.notice }) }));

import { COLLECT_HINT_KEY } from '@tubutree/app-core/home-layout';
import { ApiError } from '@/lib/client-api';
import { OffersCollect } from './offers-collect';

const DAY = 86_400_000;
const coupon = (code: string, over: Record<string, unknown> = {}) => ({
  code, title: null, type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null,
  startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + 20 * DAY).toISOString(),
  newCustomerOnly: false, claimedCount: 0, usageLimit: null, ...over,
});

let collectable: unknown;
let mounted: Rendered | null = null;
const mount = async (walletCodes: string[] = [], walletLoading = false) => {
  mounted = render(<OffersCollect walletCodes={new Set(walletCodes)} walletLoading={walletLoading} />);
  await flush(8);
  return mounted.container;
};
const buttons = (root: ParentNode, name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === name);

beforeEach(() => {
  localStorage.clear();
  mocks.push.mockReset();
  mocks.claim.mockReset();
  mocks.state.pendingCode = null;
  mocks.state.notice = null;
  collectable = [];
  mocks.get.mockReset().mockImplementation(async () => {
    if (collectable instanceof Error) throw collectable;
    return collectable;
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OffersCollect (web) — khối Nhận mã ở trang Ưu đãi', () => {
  it('5 mã chưa nhận: chỉ 3 thẻ đầu, "Lưu mã" gọi claim, "Tất cả 5 mã" tới /ma-giam-gia', async () => {
    collectable = ['A', 'B', 'C', 'D', 'E'].map((c, i) => coupon(c, { endAt: new Date(Date.now() + (i + 2) * DAY).toISOString() }));
    const c = await mount();
    const region = c.querySelector('section[aria-labelledby]')!;
    expect(region.querySelectorAll('[role="group"]')).toHaveLength(3);
    click(buttons(region, 'Lưu mã')[0]!);
    expect(mocks.claim).toHaveBeenCalledWith('A');
    const all = region.querySelector<HTMLButtonElement>('button[aria-label="Xem tất cả Mã giảm giá"]')!;
    expect(all.textContent).toContain('Tất cả 5 mã');
    click(all);
    expect(mocks.push).toHaveBeenCalledWith('/ma-giam-gia');
  });

  it('mã đã có trong ví hoặc đã hết lượt không chiếm chỗ: chỉ mã nhận được ngay', async () => {
    collectable = [coupon('MINE'), coupon('FULL', { usageLimit: 3, claimedCount: 3 }), coupon('OPEN')];
    const c = await mount(['MINE']);
    expect(c.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(c.textContent).toContain('OPEN');
    expect(c.querySelector('button[aria-label="Xem tất cả Mã giảm giá"]')!.textContent).toContain('Tất cả 1 mã');
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
    mounted = render(<OffersCollect walletCodes={new Set()} walletLoading={false} />);
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
    mounted = render(<OffersCollect walletCodes={new Set()} walletLoading={false} />);
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
