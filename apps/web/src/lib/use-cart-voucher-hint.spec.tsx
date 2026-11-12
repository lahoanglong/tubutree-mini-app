// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

const state = vi.hoisted(() => ({
  coupons: [] as unknown[],
  previews: vi.fn<(p: unknown) => Promise<unknown[]>>(),
  apply: vi.fn<(code: string) => Promise<unknown>>(),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMyCoupons: async () => state.coupons,
  getCouponPreviews: (p: unknown) => state.previews(p),
  applyCoupon: (code: string) => state.apply(code),
}));

import { useCartVoucherHint } from './use-cart-voucher-hint';

const coupon = (code: string, over: Record<string, unknown> = {}) => ({
  code, type: 'AMOUNT', value: 20000, minOrder: null, maxDiscount: null, endAt: '2030-01-01T00:00:00Z', ...over,
});
const usable = (code: string, discount: number) => ({ code, eligible: true, discount });
const lacking = (code: string, shortfall: number) => ({ code, eligible: false, discount: 0, reason: 'Đơn tối thiểu 300.000đ để dùng mã này.', shortfall });
const cartOf = (couponCode: string) => ({ items: [], couponCode, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });

type Opts = Parameters<typeof useCartVoucherHint>[0];
const BASE: Opts = { currentCode: null, subtotal: 250000, preview: { storefrontSlug: undefined, itemIds: undefined }, previewKey: 'a:1:250000' };

function Probe({ opts, go = 'giam45' }: { opts: Opts; go?: string }) {
  const s = useCartVoucherHint(opts);
  return (
    <div
      data-testid="probe"
      data-apply={s.hint?.apply?.code ?? ''}
      data-unlock={s.hint?.unlock?.code ?? ''}
      data-missing={s.hint?.unlock?.missing ?? ''}
      data-applying={String(s.applying)}
      data-error={s.error ?? ''}
      data-note={s.appliedNote ?? ''}
    >
      <button data-testid="go" onClick={() => s.apply(go)} />
      <button data-testid="go-other" onClick={() => s.apply('khac30')} />
    </div>
  );
}

let mounted: Rendered[] = [];
let qc: QueryClient;
async function mount(opts: Opts = BASE) {
  const r = render(<Probe opts={opts} />, qc);
  mounted.push(r);
  await flush(8);
  return {
    probe: () => r.container.querySelector<HTMLElement>('[data-testid="probe"]')!,
    go: () => r.container.querySelector<HTMLElement>('[data-testid="go"]')!,
    goOther: () => r.container.querySelector<HTMLElement>('[data-testid="go-other"]')!,
    rerender: async (next: Opts) => {
      act(() => r.root.render(<QueryClientProvider client={qc}><Probe opts={next} /></QueryClientProvider>));
      await flush(8);
    },
  };
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.coupons = [];
  state.previews.mockReset();
  state.apply.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('useCartVoucherHint (web)', () => {
  it('ví không có mã nào: không hỏi xem trước, không có gợi ý', async () => {
    const { probe } = await mount();
    expect(state.previews).not.toHaveBeenCalled();
    expect(probe().dataset.apply).toBe('');
    expect(probe().dataset.unlock).toBe('');
  });

  it('có mã đủ điều kiện: hint.apply theo số của máy chủ', async () => {
    state.coupons = [coupon('GIAM45')];
    state.previews.mockResolvedValue([usable('GIAM45', 45000)]);
    const { probe } = await mount();
    expect(state.previews).toHaveBeenCalledTimes(1);
    expect(probe().dataset.apply).toBe('GIAM45');
  });

  it('mã gần đủ đơn tối thiểu: hint.unlock mang số còn thiếu của máy chủ', async () => {
    state.coupons = [coupon('GIAM80', { value: 80000, minOrder: 300000 })];
    state.previews.mockResolvedValue([lacking('GIAM80', 30000)]);
    const { probe } = await mount();
    expect(probe().dataset.apply).toBe('');
    expect(probe().dataset.unlock).toBe('GIAM80');
    expect(probe().dataset.missing).toBe('30000');
  });

  it('giỏ đã có mã hoặc chưa chọn món nào: không hỏi xem trước và không có gợi ý', async () => {
    state.coupons = [coupon('GIAM45')];
    state.previews.mockResolvedValue([usable('GIAM45', 45000)]);
    const withCode = await mount({ ...BASE, currentCode: 'DACO' });
    expect(withCode.probe().dataset.apply).toBe('');
    const none = await mount({ ...BASE, preview: undefined });
    expect(none.probe().dataset.apply).toBe('');
    expect(state.previews).not.toHaveBeenCalled();
  });

  it('áp thành công: gọi applyCoupon với mã in hoa, ghi giỏ vào cache, làm mới báo giá, hiện "Đã áp dụng mã …"', async () => {
    state.coupons = [coupon('GIAM45')];
    state.previews.mockResolvedValue([usable('GIAM45', 45000)]);
    const cart = cartOf('GIAM45');
    state.apply.mockResolvedValue(cart);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { probe, go } = await mount();
    click(go());
    await flush(8);
    expect(state.apply).toHaveBeenCalledWith('GIAM45');
    expect(qc.getQueryData(['cart', null])).toBe(cart);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['quote'] });
    expect(probe().dataset.note).toBe('Đã áp dụng mã GIAM45');
    expect(probe().dataset.error).toBe('');
  });

  it('lời "Đã áp dụng mã …" tự tắt sau 4 giây', async () => {
    state.coupons = [coupon('GIAM45')];
    state.previews.mockResolvedValue([usable('GIAM45', 45000)]);
    state.apply.mockResolvedValue(cartOf('GIAM45'));
    const { probe, go } = await mount();
    vi.useFakeTimers();
    click(go());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(probe().dataset.note).toBe('Đã áp dụng mã GIAM45');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(probe().dataset.note).toBe('');
  });

  it('áp lỗi: lời báo của máy chủ hiện cho đúng mã đang mời; đổi sang mã khác thì không hiện lỗi của mã cũ', async () => {
    state.coupons = [coupon('GIAM45')];
    state.previews.mockResolvedValue([usable('GIAM45', 45000)]);
    state.apply.mockRejectedValue(new Error('Mã giảm giá đã hết lượt dùng.'));
    const { probe, go, rerender } = await mount();
    click(go());
    await flush(8);
    expect(probe().dataset.error).toBe('Mã giảm giá đã hết lượt dùng.');
    expect(probe().dataset.note).toBe('');
    // Mã bị từ chối: hỏi lại xem trước (lần thứ hai) để dải không giữ câu "đủ điều kiện" đã sai.
    expect(state.previews).toHaveBeenCalledTimes(2);

    state.coupons = [coupon('KHAC30')];
    state.previews.mockResolvedValue([usable('KHAC30', 30000)]);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['my-coupons'] });
    });
    await rerender({ ...BASE, previewKey: 'a:2:250000' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    await flush(8);
    expect(probe().dataset.apply).toBe('KHAC30');
    expect(probe().dataset.error).toBe('');
  });

  it('đang áp: applying=true và cú chạm thứ hai không gọi máy chủ lần nữa', async () => {
    state.coupons = [coupon('GIAM45')];
    state.previews.mockResolvedValue([usable('GIAM45', 45000)]);
    let release: (v: unknown) => void = () => {};
    state.apply.mockImplementation(() => new Promise((r) => { release = r; }));
    const { probe, go } = await mount();
    click(go());
    await flush(4);
    expect(probe().dataset.applying).toBe('true');
    click(go());
    expect(state.apply).toHaveBeenCalledTimes(1);
    await act(async () => release(cartOf('GIAM45')));
    await flush(8);
    expect(probe().dataset.applying).toBe('false');
  });
});

describe('useCartVoucherHint (web): khoá đồng bộ chống chạm đúp', () => {
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  // Hai cú chạm trong CÙNG một act: React chưa vẽ lại giữa chúng nên `isPending` vẫn false ở cả hai.
  const twice = (a: HTMLElement, b: HTMLElement = a) =>
    act(() => {
      a.click();
      b.click();
    });

  beforeEach(() => {
    state.coupons = [coupon('GIAM45'), coupon('KHAC30')];
    state.previews.mockResolvedValue([usable('GIAM45', 45000), usable('KHAC30', 30000)]);
  });

  it('hai cú chạm cùng một khung hình: chỉ gọi applyCoupon một lần', async () => {
    const call = pending<unknown>();
    state.apply.mockReturnValue(call.promise);
    const { probe, go } = await mount();
    twice(go());
    await flush(2);
    expect(state.apply).toHaveBeenCalledTimes(1);
    expect(probe().dataset.applying).toBe('true');
    await act(async () => call.resolve(cartOf('GIAM45')));
    await flush(8);
    expect(probe().dataset.applying).toBe('false');
  });

  it('hai mã khác nhau liền nhau: giỏ chỉ có một mã nên chỉ mã chạm trước được gửi', async () => {
    const call = pending<unknown>();
    state.apply.mockReturnValue(call.promise);
    const { go, goOther } = await mount();
    twice(go(), goOther());
    await flush(2);
    expect(state.apply).toHaveBeenCalledTimes(1);
    expect(state.apply).toHaveBeenCalledWith('GIAM45');
    await act(async () => call.resolve(cartOf('GIAM45')));
    await flush(8);
  });

  it('lệnh bị từ chối thì nhả khoá: lời báo lỗi hiện và chạm lại gọi được lần hai', async () => {
    state.apply.mockRejectedValueOnce(new Error('Mã đã hết lượt dùng.')).mockResolvedValue(cartOf('GIAM45'));
    const { probe, go } = await mount();
    click(go());
    await flush(8);
    expect(probe().dataset.error).toBe('Mã đã hết lượt dùng.');
    click(go());
    await flush(8);
    expect(state.apply).toHaveBeenCalledTimes(2);
    expect(probe().dataset.error).toBe('');
  });

  it.each([400, 404, 409, 422])('W121: máy chủ từ chối %i (mã hết lượt, màn đã cũ): lời báo hiện, nút giữ khoá tới khi số xem trước tải lại xong; chạm lần hai không gửi', async (status) => {
    state.apply.mockRejectedValueOnce(new ApiError('Mã đã hết lượt dùng.', status)).mockResolvedValue(cartOf('GIAM45'));
    const { probe, go } = await mount();
    const reload = pending<unknown[]>();
    state.previews.mockReset();
    state.previews.mockReturnValue(reload.promise);
    click(go());
    await flush(8);
    expect(state.previews).toHaveBeenCalledTimes(1);
    expect(probe().dataset.applying).toBe('true');
    twice(go());
    await flush(2);
    expect(state.apply).toHaveBeenCalledTimes(1);
    await act(async () => reload.resolve([usable('GIAM45', 45000), usable('KHAC30', 30000)]));
    await flush(8);
    expect(probe().dataset.applying).toBe('false');
    expect(probe().dataset.error).toBe('Mã đã hết lượt dùng.');
    click(go());
    await flush(8);
    expect(state.apply).toHaveBeenCalledTimes(2);
  });

  it('lệnh thành công thì nhả khoá: áp mã khác sau đó vẫn gọi được', async () => {
    state.apply.mockResolvedValue(cartOf('GIAM45'));
    const { go, goOther } = await mount();
    click(go());
    await flush(8);
    click(goOther());
    await flush(8);
    expect(state.apply).toHaveBeenCalledTimes(2);
    expect(state.apply).toHaveBeenLastCalledWith('KHAC30');
  });
});
