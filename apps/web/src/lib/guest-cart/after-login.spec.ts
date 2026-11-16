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

import { takeReturnTo } from '@/lib/return-to';
import { GUEST_MERGE_NOTE_KEY, mergeGuestCartAfterLogin, takeGuestMergeNote } from './after-login';
import { guestCartFlagNow, guestCartOn } from './flag';
import { resetGuestMergeForTest } from './merge';
import { addGuestLine, readGuestCart } from './store';

const clientWith = (cfg: Record<string, unknown> | null) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cfg) qc.setQueryData(['public-config'], { freeshipThreshold: 199_000, ...cfg });
  return qc;
};

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

  it('có dòng hỏng hay bị giảm: để lời báo; takeGuestMergeNote đọc một lần rồi null', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 4 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    m.getProductStock.mockImplementation(async (slug: string) => (slug === 'sp-1' ? { v1: 2 } : { v2: 0 }));

    await mergeGuestCartAfterLogin(clientWith({ webGuestCartEnabled: true }));

    expect(m.addToCart.mock.calls).toEqual([['v1', 2]]);
    expect(takeGuestMergeNote()).toEqual({ failedLines: 1, reduced: 1 });
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

  it('không bao giờ ném: mọi lời gọi mạng đều lỗi thì vẫn xong, dòng lỗi được báo', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    m.getCart.mockRejectedValue(new Error('network'));
    m.getProductStock.mockRejectedValue(new Error('network'));
    m.addToCart.mockRejectedValue(new Error('500'));
    await expect(mergeGuestCartAfterLogin(clientWith({ webGuestCartEnabled: true }))).resolves.toBeUndefined();
    expect(takeGuestMergeNote()).toEqual({ failedLines: 1, reduced: 0 });
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
});

describe('takeGuestMergeNote', () => {
  const put = (v: unknown) => sessionStorage.setItem(GUEST_MERGE_NOTE_KEY, typeof v === 'string' ? v : JSON.stringify(v));
  const NOW = 1_800_000_000_000;

  it('lời báo quá 10 phút, có mốc ở tương lai, hỏng hay không có số nào: null và đã xoá', () => {
    put({ failedLines: 1, reduced: 0, at: NOW - 10 * 60_000 - 1 });
    expect(takeGuestMergeNote(NOW)).toBeNull();
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();

    put({ failedLines: 1, reduced: 0, at: NOW + 1 });
    expect(takeGuestMergeNote(NOW)).toBeNull();

    put('{hỏng');
    expect(takeGuestMergeNote(NOW)).toBeNull();
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();

    put({ failedLines: 0, reduced: -2, at: NOW });
    expect(takeGuestMergeNote(NOW)).toBeNull();

    put({ failedLines: 2, reduced: 1 });
    expect(takeGuestMergeNote(NOW)).toBeNull();
  });

  it('lời báo còn hạn: đọc đúng số, bỏ số không phải nguyên dương', () => {
    put({ failedLines: 2, reduced: 1.5, at: NOW - 60_000 });
    expect(takeGuestMergeNote(NOW)).toEqual({ failedLines: 2, reduced: 0 });
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ freeshipThreshold: 1, webGuestCartEnabled: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const qc = clientWith(null);
    expect(await guestCartFlagNow(qc, 1_000)).toBe(true);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/config/public');
    expect(qc.getQueryData(['public-config'])).toMatchObject({ webGuestCartEnabled: true });
  });

  it('máy chủ lỗi: tắt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'x' }), { status: 500, headers: { 'Content-Type': 'application/json' } })));
    expect(await guestCartFlagNow(clientWith(null), 1_000)).toBe(false);
  });

  it('máy chủ chậm quá waitMs: tắt (giữ hành vi cũ)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    expect(await guestCartFlagNow(clientWith(null), 20)).toBe(false);
  });
});
