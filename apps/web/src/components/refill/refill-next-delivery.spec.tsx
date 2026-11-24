// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';

// Thẻ "Kỳ Refill tới" (web) cùng luật với Mini components/refill/refill-next-delivery: ngày giao kỳ tới, giá định kỳ so giá lẻ, dời +7 ngày một chạm.
const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), phase: 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));

import { RefillNextDelivery } from './refill-next-delivery';

/** 12h00 ngày 20/10/2026 giờ VN. */
const NOW = new Date('2026-10-20T05:00:00.000Z');

const LANDING = {
  enabled: true,
  pairs: [
    {
      bottle: { productId: 'b1', slug: 'chai-a', name: 'Chai a', thumbnail: null, price: 100_000, compareAt: null, sizeLabel: '1L', inStock: true },
      refill: { productId: 'r1', slug: 'refill-a', name: 'Túi Refill a', thumbnail: null, variationId: 'v1', price: 189_000, compareAt: null, sizeLabel: '3L', inStock: true, tubu: true },
      savingPct: 20,
    },
  ],
};

const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-11-02T17:00:00.000Z', productName: 'Túi Refill a 3L', variationName: 'Túi 3L',
  thumbnail: null, slug: 'refill-a', unitPrice: 189_000, effectiveDiscountPct: 0.12, cycleSubtotal: 378_000, cycleDiscount: 45_360, cycleGoods: 332_640, ...over,
});

let subs: unknown[] = [];
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RefillNextDelivery landing={LANDING} />);
  mounted.push(r);
  await flush(4);
  return r.container;
};
const subsCalls = () => mocks.get.mock.calls.filter((c) => c[0] === '/me/subscriptions').length;
const button = (c: Element) => c.querySelector<HTMLButtonElement>('[data-testid="refill-next-postpone"]')!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mocks.phase = 'authenticated';
  subs = [sub()];
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/me/subscriptions' ? subs : null));
  mocks.patch.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('RefillNextDelivery (web, tubu-w27-01)', () => {
  it('ngày giao kỳ tới kèm thứ, món và số lượng, giá định kỳ gạch giá lẻ, nút +7 ngày nói rõ ngày mới; lối vào tab Định kỳ', async () => {
    const c = await mount();
    const card = c.querySelector('[data-testid="refill-next-delivery"]')!;
    expect(card.querySelector('h2')!.textContent).toBe('Kỳ Refill tới');
    expect(c.querySelector('[data-testid="refill-next-date"]')!.textContent).toBe('Thứ Ba, 03/11/2026');
    expect(card.textContent).toContain('Túi Refill a 3L · SL 2');
    const price = c.querySelector('[data-testid="refill-next-price"]')!;
    expect(price.textContent).toContain('332.640đ');
    expect(price.textContent).toContain('378.000đ');
    expect(card.textContent).toContain('Giá định kỳ −12%, rẻ hơn giá lẻ 45.360đ');
    expect(button(c).textContent).toContain('Dời lịch kỳ tới (+7 ngày)');
    expect(button(c).getAttribute('aria-label')).toBe('Dời lịch kỳ tới 7 ngày, sang Thứ Ba, 10/11/2026');
    const manage = card.querySelector<HTMLAnchorElement>('a[href="/tai-khoan/don-hang?tab=subscriptions"]')!;
    expect(manage.textContent).toBe('Quản lý gói định kỳ');
    expect(manage.className).toMatch(/\btubu-hit-44\b/);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });

  it('dời một chạm: PATCH ngày mới kèm nextRunAt thẻ đang hiện, bấm đúp chỉ một lệnh, báo ngày mới trong thẻ, tải lại danh sách rồi ngày trên thẻ đổi', async () => {
    let resolve!: (v: unknown) => void;
    mocks.patch.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount();
    click(button(c));
    click(button(c));
    await flush(2);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith('/me/subscriptions/s1', { nextRunDate: '2026-11-10', expectedNextRunAt: '2026-11-02T17:00:00.000Z' });
    expect(button(c).getAttribute('aria-busy')).toBe('true');
    expect(button(c).getAttribute('aria-disabled')).toBe('true');
    subs = [sub({ nextRunAt: '2026-11-09T17:00:00.000Z' })];
    await act(async () => resolve(sub({ nextRunAt: '2026-11-09T17:00:00.000Z' })));
    await flush(6);
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Đã dời kỳ tới sang Thứ Ba, 10/11/2026');
    expect(c.querySelector('[data-testid="refill-next-date"]')!.textContent).toBe('Thứ Ba, 10/11/2026');
    expect(subsCalls()).toBe(2);
  });

  it('lịch vừa đổi (409): báo lời máy chủ, tải lại danh sách; lỗi 5xx thì không tải lại', async () => {
    mocks.patch.mockRejectedValueOnce(new ApiError('Lịch giao vừa thay đổi, bạn xem lại nhé.', 409));
    const c = await mount();
    click(button(c));
    await flush(6);
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Lịch giao vừa thay đổi, bạn xem lại nhé.');
    expect(subsCalls()).toBe(2);

    mocks.patch.mockRejectedValueOnce(new ApiError('Hệ thống đang bận, bạn thử lại sau nhé.', 503));
    click(button(c));
    await flush(6);
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Máy chủ đang bận, thử lại nhé.');
    expect(c.querySelector('[role="status"]')!.textContent).toBe('');
    expect(subsCalls()).toBe(2);
  });

  it('hai gói Refill: dời gói tới trước xong, thẻ giữ gói đó dù gói kia giờ tới trước, bấm lần hai vẫn dời gói đó', async () => {
    subs = [sub(), sub({ id: 's2', productName: 'Túi Refill b 3L', nextRunAt: '2026-11-05T17:00:00.000Z' })];
    mocks.patch.mockImplementation(async (path: string, body: { nextRunDate: string }) => {
      const moved = `${body.nextRunDate.slice(0, 8)}${String(Number(body.nextRunDate.slice(8)) - 1).padStart(2, '0')}T17:00:00.000Z`;
      subs = subs.map((x) => ((x as { id: string }).id === path.split('/').pop() ? { ...(x as object), nextRunAt: moved } : x));
      return subs.find((x) => (x as { id: string }).id === path.split('/').pop());
    });
    const c = await mount();
    expect(c.querySelector('[data-testid="refill-next-date"]')!.textContent).toBe('Thứ Ba, 03/11/2026');
    click(button(c));
    await flush(8);
    expect(c.querySelector('[data-testid="refill-next-date"]')!.textContent).toBe('Thứ Ba, 10/11/2026');
    expect(c.textContent).toContain('Túi Refill a 3L · SL 2');
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Đã dời kỳ tới sang Thứ Ba, 10/11/2026');
    click(button(c));
    await flush(8);
    expect(mocks.patch.mock.calls.map((x) => x[0])).toEqual(['/me/subscriptions/s1', '/me/subscriptions/s1']);
    expect(mocks.patch.mock.calls[1]![1]).toEqual({ nextRunDate: '2026-11-17', expectedNextRunAt: '2026-11-09T17:00:00.000Z' });
  });

  it('gói vừa huỷ ở máy khác (400): tải lại thì thẻ thôi vẽ nhưng lời báo ở lại', async () => {
    mocks.patch.mockImplementationOnce(async () => {
      subs = [sub({ status: 'CANCELLED' })];
      throw new ApiError('Gói định kỳ đã huỷ.', 400);
    });
    const c = await mount();
    click(button(c));
    await flush(8);
    expect(subsCalls()).toBe(2);
    expect(c.querySelector('[data-testid="refill-next-delivery"]')).toBeNull();
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Gói định kỳ đã huỷ.');
  });

  it('+7 ngày vượt 90 ngày tới: nút aria-disabled, nói ngày xa nhất, bấm không gửi gì', async () => {
    subs = [sub({ nextRunAt: '2027-01-14T17:00:00.000Z' })];
    const c = await mount();
    expect(button(c).getAttribute('aria-disabled')).toBe('true');
    expect(button(c).disabled).toBe(true);
    expect(c.textContent).toContain('Chỉ dời được tới Thứ Hai, 18/01/2027');
    click(button(c));
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập: không gọi /me/subscriptions, không vẽ; gói tạm dừng hay không phải Refill: không vẽ', async () => {
    mocks.phase = 'guest';
    let c = await mount();
    expect(c.innerHTML).toBe('');
    expect(subsCalls()).toBe(0);

    mocks.phase = 'authenticated';
    subs = [sub({ status: 'PAUSED' }), sub({ id: 's2', slug: 'chai-a' })];
    c = await mount();
    expect(subsCalls()).toBe(1);
    expect(c.innerHTML).toBe('');
  });
});
