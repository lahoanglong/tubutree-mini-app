// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getCart: vi.fn(),
  addToCart: vi.fn(),
  getProductStock: vi.fn(),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: m.getCart,
  addToCart: m.addToCart,
  getProductStock: m.getProductStock,
}));

import { ApiError, NetworkError } from '@/lib/client-api';
import { rememberReturnTo, takeReturnTo } from '@/lib/return-to';
import { GUEST_MERGE_NOTE_KEY, mergeGuestCartAfterLogin, runGuestMerge, takeGuestMergeNote } from './after-login';
import { guestCartFlagNow, guestCartOn } from './flag';
import { resetGuestMergeForTest } from './merge';
import { addGuestLine, readGuestCart } from './store';

const CONFIG = { freeshipThreshold: 199_000 };
const clientWith = (cfg: Record<string, unknown> | null) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cfg) qc.setQueryData(['public-config'], { ...CONFIG, ...cfg });
  return qc;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetGuestMergeForTest();
  m.getCart.mockReset().mockResolvedValue({ items: [] });
  m.addToCart.mockReset().mockImplementation(async (variationId: string, quantity: number) => ({ items: [{ variationId, quantity }] }));
  m.getProductStock.mockReset().mockResolvedValue({ v1: 5, v2: 5 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('mergeGuestCartAfterLogin', () => {
  it('cờ tắt (webGuestCartEnabled:false trong cache): không gộp, giỏ khách và returnTo giữ nguyên', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 2 });
    const before = readGuestCart();
    const qc = clientWith({ webGuestCartEnabled: false });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    await mergeGuestCartAfterLogin(qc);

    expect(m.getCart).not.toHaveBeenCalled();
    expect(m.getProductStock).not.toHaveBeenCalled();
    expect(m.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart()).toBe(before);
    expect(takeReturnTo()).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(['/', '/uu-dai'])('cờ tắt: returnTo đã lưu (%s) không bị đổi', async (stored) => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 2 });
    rememberReturnTo(stored);
    await mergeGuestCartAfterLogin(clientWith({ webGuestCartEnabled: false }));
    expect(takeReturnTo()).toBe(stored);
  });

  it('API cũ không trả cờ: coi như tắt', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 2 });
    await mergeGuestCartAfterLogin(clientWith({}));
    expect(m.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart()).toHaveLength(1);
  });

  it('cờ bật: gộp vào giỏ máy chủ, quay về /gio-hang, tải lại giỏ; gộp đủ thì không để lời báo', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 2 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    const qc = clientWith({ webGuestCartEnabled: true });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    await mergeGuestCartAfterLogin(qc);

    expect(m.addToCart.mock.calls).toEqual([
      ['v1', 2],
      ['v2', 1],
    ]);
    expect(m.getProductStock).toHaveBeenCalledWith('sp-1');
    expect(readGuestCart()).toEqual([]);
    expect(takeReturnTo()).toBe('/gio-hang');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();
    expect(takeGuestMergeNote()).toBeNull();
  });

  it.each([
    [null, '/gio-hang'],
    ['/', '/gio-hang'],
    ['/gio-hang', '/gio-hang'],
    ['/uu-dai', '/uu-dai'],
    ['/san-pham/dau-goi', '/san-pham/dau-goi'],
  ])('cờ bật: returnTo đã lưu %s → %s (chỉ Trang chủ, giỏ hay chưa có mới đổi sang giỏ)', async (stored, expected) => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    if (stored) rememberReturnTo(stored);
    await mergeGuestCartAfterLogin(clientWith({ webGuestCartEnabled: true }));
    expect(takeReturnTo()).toBe(expected);
    expect(m.addToCart).toHaveBeenCalledTimes(1);
  });

  it('có dòng hỏng, bị giảm hay chưa gộp được: để lời báo đủ ba số; takeGuestMergeNote đọc một lần rồi null', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 4 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    addGuestLine({ variationId: 'v3', slug: 'sp-3', quantity: 1 });
    m.getProductStock.mockImplementation(async (slug: string) => ({ 'sp-1': { v1: 2 }, 'sp-2': { v2: 0 }, 'sp-3': { v3: 5 } })[slug]);
    m.addToCart.mockImplementation(async (variationId: string, quantity: number) => {
      if (variationId === 'v3') throw new ApiError('Bảo trì', 503);
      return { items: [{ variationId, quantity }] };
    });

    await mergeGuestCartAfterLogin(clientWith({ webGuestCartEnabled: true }));

    expect(m.addToCart.mock.calls).toEqual([
      ['v1', 2],
      ['v3', 1],
    ]);
    expect(readGuestCart().map((l) => l.variationId)).toEqual(['v3']);
    expect(takeGuestMergeNote()).toEqual({ failedLines: 1, reduced: 1, kept: 1 });
    expect(takeGuestMergeNote()).toBeNull();
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();
  });

  it('giỏ khách trống: không đọc cờ, không đặt returnTo', async () => {
    const qc = clientWith({ webGuestCartEnabled: true });
    const read = vi.spyOn(qc, 'getQueryData');
    await mergeGuestCartAfterLogin(qc);
    expect(read).not.toHaveBeenCalled();
    expect(m.getCart).not.toHaveBeenCalled();
    expect(takeReturnTo()).toBeNull();
  });

  it('không bao giờ ném: không tải được giỏ máy chủ thì giữ cả giỏ khách và báo "chưa chuyển được"', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    m.getCart.mockRejectedValue(new NetworkError(false));
    await expect(mergeGuestCartAfterLogin(clientWith({ webGuestCartEnabled: true }))).resolves.toBeUndefined();
    expect(m.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart().map((l) => l.variationId)).toEqual(['v1']);
    expect(takeGuestMergeNote()).toEqual({ failedLines: 0, reduced: 0, kept: 1 });
  });

  it('không bao giờ ném: QueryClient ném khi đọc cờ', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    const qc = clientWith(null);
    vi.spyOn(qc, 'getQueryData').mockImplementation(() => {
      throw new Error('hỏng');
    });
    await expect(mergeGuestCartAfterLogin(qc)).resolves.toBeUndefined();
    expect(readGuestCart()).toHaveLength(1);
  });

  it('gộp chậm hơn waitMs: trả về đúng hạn (không chặn đăng nhập); gộp xong sau đó vẫn tải lại giỏ', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    const slow = deferred<{ items: { variationId: string; quantity: number }[] }>();
    m.addToCart.mockReturnValueOnce(slow.promise);
    const qc = clientWith({ webGuestCartEnabled: true });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    await mergeGuestCartAfterLogin(qc, 20);

    expect(m.addToCart).toHaveBeenCalledTimes(1);
    expect(takeReturnTo()).toBe('/gio-hang');
    expect(invalidate).not.toHaveBeenCalled();
    slow.resolve({ items: [{ variationId: 'v1', quantity: 1 }] });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] }));
  });

  it('cấu hình chưa có trong cache (trang callback mới tải): chờ cờ tới waitMs, không bỏ cuộc sau 1,5 giây', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/config/public')
          ? new Promise<Response>((resolve) => setTimeout(() => resolve(json({ ...CONFIG, webGuestCartEnabled: true })), 3_000))
          : Promise.resolve(json({})),
      ),
    );

    const done = mergeGuestCartAfterLogin(clientWith(null));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(m.getCart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_100);
    await done;

    expect(m.addToCart.mock.calls).toEqual([['v1', 1]]);
    expect(takeReturnTo()).toBe('/gio-hang');
  });

  it('cờ không về trong waitMs: không gộp, không đổi returnTo, giỏ khách còn nguyên cho trang giỏ gộp sau', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/config/public')
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : Promise.resolve(json({})),
      ),
    );

    await mergeGuestCartAfterLogin(clientWith(null), 60);
    expect(m.getCart).not.toHaveBeenCalled();
    expect(takeReturnTo()).toBeNull();

    answer(json({ ...CONFIG, webGuestCartEnabled: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(m.getCart).not.toHaveBeenCalled();
    expect(takeReturnTo()).toBeNull();
    expect(readGuestCart().map((l) => l.variationId)).toEqual(['v1']);
  });
});

describe('runGuestMerge', () => {
  it('gộp, ghi lời báo khi có dòng chưa đủ, tải lại giỏ; trả kết quả', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 9 });
    const qc = clientWith(null);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    expect(await runGuestMerge(qc)).toEqual({ lines: 1, merged: 1, reduced: 1, failedLines: 0, kept: 0 });
    expect(m.addToCart.mock.calls).toEqual([['v1', 5]]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    expect(takeGuestMergeNote()).toEqual({ failedLines: 0, reduced: 1, kept: 0 });
  });

  it('không có gì để gộp: null, không tải lại giỏ, không lời báo', async () => {
    const qc = clientWith(null);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    expect(await runGuestMerge(qc)).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    expect(takeGuestMergeNote()).toBeNull();
  });
});

describe('takeGuestMergeNote', () => {
  const put = (v: unknown) => sessionStorage.setItem(GUEST_MERGE_NOTE_KEY, typeof v === 'string' ? v : JSON.stringify(v));
  const NOW = 1_800_000_000_000;

  it('lời báo quá 10 phút, có mốc ở tương lai, hỏng hay không có số nào: null và đã xoá', () => {
    put({ failedLines: 1, reduced: 0, kept: 0, at: NOW - 10 * 60_000 - 1 });
    expect(takeGuestMergeNote(NOW)).toBeNull();
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();

    put({ failedLines: 1, reduced: 0, kept: 0, at: NOW + 1 });
    expect(takeGuestMergeNote(NOW)).toBeNull();

    put('{hỏng');
    expect(takeGuestMergeNote(NOW)).toBeNull();
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();

    put({ failedLines: 0, reduced: -2, kept: 0, at: NOW });
    expect(takeGuestMergeNote(NOW)).toBeNull();

    put({ failedLines: 2, reduced: 1, kept: 1 });
    expect(takeGuestMergeNote(NOW)).toBeNull();
  });

  it('lời báo còn hạn: đọc đúng số, bỏ số không phải nguyên dương; lời báo cũ thiếu kept thì kept 0', () => {
    put({ failedLines: 2, reduced: 1.5, kept: 3, at: NOW - 60_000 });
    expect(takeGuestMergeNote(NOW)).toEqual({ failedLines: 2, reduced: 0, kept: 3 });
    put({ failedLines: 0, reduced: 1, at: NOW });
    expect(takeGuestMergeNote(NOW)).toEqual({ failedLines: 0, reduced: 1, kept: 0 });
    put({ failedLines: 0, reduced: 0, kept: 1, at: NOW });
    expect(takeGuestMergeNote(NOW)).toEqual({ failedLines: 0, reduced: 0, kept: 1 });
  });
});

describe('guestCartFlagNow / guestCartOn', () => {
  it('chỉ đúng boolean true mới bật', () => {
    expect(guestCartOn({ webGuestCartEnabled: true })).toBe(true);
    expect(guestCartOn({ webGuestCartEnabled: false })).toBe(false);
    expect(guestCartOn({ webGuestCartEnabled: 'true' as unknown as boolean })).toBe(false);
    expect(guestCartOn({})).toBe(false);
    expect(guestCartOn(null)).toBe(false);
  });

  it('chưa có cấu hình trong cache: hỏi máy chủ, bật khi máy chủ trả true', async () => {
    const fetchMock = vi.fn(async () => json({ ...CONFIG, webGuestCartEnabled: true }));
    vi.stubGlobal('fetch', fetchMock);
    const qc = clientWith(null);
    expect(await guestCartFlagNow(qc, 1_000)).toBe(true);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/config/public');
    expect(qc.getQueryData(['public-config'])).toMatchObject({ webGuestCartEnabled: true });
  });

  it('máy chủ lỗi: tắt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'x' }, 500)));
    expect(await guestCartFlagNow(clientWith(null), 1_000)).toBe(false);
  });

  it('máy chủ chậm quá waitMs: tắt (giữ hành vi cũ)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    expect(await guestCartFlagNow(clientWith(null), 20)).toBe(false);
  });
});
