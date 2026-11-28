// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Thẻ gợi ý sau khi quét (web, w55-01): cùng chữ và luật với Mini components/loyalty/post-scan-offer.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  cfg: { isLoaded: true, loyalty: { vndPerPointRedeem: 1 } } as Record<string, unknown>,
  feedback: vi.fn(),
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/cart-feedback', () => ({ playCartFeedback: mocks.feedback }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: vi.fn() }));

import PostScanOffer from './post-scan-offer';

const refill = (id: string, price: number) => ({
  productId: `p-${id}`, slug: `refill-${id}`, name: `Túi Refill ${id} 2L`, thumbnail: null, variationId: `v-${id}`, price, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true,
});
const bottle = (id: string) => ({ productId: `b-${id}`, slug: `chai-${id}`, name: `Nước rửa chén ${id} 500ml`, thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true });
const pair = (id: string, price: number) => ({ bottle: bottle(id), refill: refill(id, price), savingPct: 20 });

let landing: unknown;
let mounted: Rendered[] = [];
const mount = async (points: number | null) => {
  const r = render(<PostScanOffer points={points} />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const value = (c: Element) => c.querySelector('[data-testid="post-scan-value"]');
const rows = (c: Element) => [...c.querySelectorAll('[data-testid="post-scan-offer-row"]')];
const buttonNamed = (c: Element, name: string) =>
  [...c.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name) as HTMLButtonElement | undefined;

beforeEach(() => {
  mocks.cfg = { isLoaded: true, loyalty: { vndPerPointRedeem: 1 } };
  mocks.feedback.mockReset();
  landing = { enabled: true, pairs: [pair('a', 200_000), pair('b', 230_000), pair('c', 250_000)] };
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/catalog/refill-pairs/landing') return landing;
    throw new Error(`chưa mock ${path}`);
  });
  mocks.post.mockReset().mockResolvedValue({ items: [{ id: 'ci1' }] });
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

describe('PostScanOffer (web)', () => {
  it('đơn 199.000đ tích 0,2% = 398 điểm = 398đ (1 Điểm Xanh = 1đ): một dòng giá trị + đúng hai gói, mỗi gói một nút "Thêm", chạm 44px', async () => {
    const c = await mount(398);
    expect(c.querySelector('section')?.getAttribute('aria-label')).toBe('Gợi ý sau khi tích điểm');
    expect(value(c)?.textContent).toBe('≈ 398đ giảm cho lần mua sau');
    expect(rows(c)).toHaveLength(2);
    expect(rows(c)[0]!.textContent).toContain('Túi Refill a 2L');
    expect(rows(c)[0]!.textContent).toContain('200.000đ');
    expect(buttonNamed(c, 'Thêm Túi Refill a 2L vào giỏ')).toBeTruthy();
    expect(buttonNamed(c, 'Thêm Túi Refill b 2L vào giỏ')).toBeTruthy();
    expect(c.textContent).not.toContain('Túi Refill c 2L');
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });

  it('số đồng theo cấu hình đổi điểm: 299.000đ tích 0,2% = 598 điểm; cấu hình 100đ/điểm thì 59.800đ', async () => {
    mocks.cfg = { isLoaded: true, loyalty: { vndPerPointRedeem: 100 } };
    expect(value(await mount(598))?.textContent).toBe('≈ 59.800đ giảm cho lần mua sau');
  });

  it('thêm một chạm: POST /cart/items đúng phân loại, SL 1, không nguồn riêng; chạm đúp một lệnh; nút thành "Đã thêm" và khoá; báo nổi trong thẻ', async () => {
    let resolve!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount(398);
    const add = buttonNamed(c, 'Thêm Túi Refill a 2L vào giỏ')!;
    await act(async () => {
      add.click();
      add.click();
    });
    await flush(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/cart/items');
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ variationId: 'v-a', quantity: 1 });
    expect(mocks.post.mock.calls[0]![1]).not.toHaveProperty('addSource');
    await act(async () => resolve({ items: [{ id: 'ci1' }] }));
    await flush(3);
    const done = buttonNamed(c, 'Đã thêm')!;
    expect(done.disabled).toBe(true);
    expect(c.textContent).toContain('Đã thêm vào giỏ!');
    expect(buttonNamed(c, 'Thêm Túi Refill b 2L vào giỏ')!.disabled).toBe(false);
  });

  it('thêm giỏ lỗi (hết hàng, mạng): nút vẫn là "Thêm" để chạm lại, không hiện "Đã thêm", có thông báo lỗi', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const c = await mount(398);
    const add = buttonNamed(c, 'Thêm Túi Refill a 2L vào giỏ')!;
    await act(async () => add.click());
    await flush(3);
    expect(buttonNamed(c, 'Đã thêm')).toBeUndefined();
    expect(buttonNamed(c, 'Thêm Túi Refill a 2L vào giỏ')!.disabled).toBe(false);
    expect(c.textContent).not.toContain('Đã thêm vào giỏ!');
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('chưa có điểm (REVIEW, points null) vẫn có gói gợi ý nhưng không có dòng giá trị', async () => {
    const c = await mount(null);
    expect(rows(c)).toHaveLength(2);
    expect(value(c)).toBeNull();
  });

  it('cờ Refill tắt hay lỗi mạng: chỉ còn dòng giá trị điểm, không có hàng gói', async () => {
    landing = { enabled: false, pairs: [] };
    const off = await mount(398);
    expect(value(off)).not.toBeNull();
    expect(rows(off)).toHaveLength(0);
    mocks.get.mockRejectedValue(new Error('offline'));
    const failed = await mount(398);
    expect(value(failed)).not.toBeNull();
    expect(rows(failed)).toHaveLength(0);
  });

  it('không điểm và không gói để nói: không vẽ gì', async () => {
    landing = { enabled: false, pairs: [] };
    expect((await mount(null)).innerHTML).toBe('');
  });
});
