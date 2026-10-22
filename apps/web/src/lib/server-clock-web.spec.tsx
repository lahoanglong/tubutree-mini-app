// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { act } from 'react';
import { render } from '@/test-utils/dom';
import { syncServerClock } from '@tubutree/app-core/server-clock';

const mocks = vi.hoisted(() => ({ get: vi.fn(), apiFetch: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('./client-api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), apiFetch: mocks.apiFetch }));

import { FlashSale } from '@/components/home/flash-sale';
import { getActiveFlashSales, getBankQr } from './shop-client';
import { useCountdown } from './use-countdown';
import { useRemaining } from './use-remaining';

// Điện thoại nhanh 10 phút so với máy chủ: hết giờ vàng và hạn chuyển khoản phải tính theo giờ máy chủ.
const PHONE_NOW = new Date('2026-10-18T10:00:00.000Z');
const SERVER_NOW = new Date(PHONE_NOW.getTime() - 10 * 60_000);
const endAtServerPlus = (min: number) => new Date(SERVER_NOW.getTime() + min * 60_000).toISOString();
const item = (endAt: string) => ({
  itemId: 'i1', variationId: 'v1', productSlug: 'p1', productName: 'Nước rửa chén', thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, salePrice: null, quota: 10, soldCount: 2, endAt, serverNow: SERVER_NOW.toISOString(),
});

describe('Đồng hồ máy chủ cho giờ vàng và hạn chuyển khoản', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(PHONE_NOW);
    syncServerClock(PHONE_NOW.toISOString());
    mocks.get.mockReset();
    mocks.apiFetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('điện thoại nhanh 10 phút, suất còn 8 phút theo máy chủ: useCountdown vẫn hiện "0h 08m"', async () => {
    mocks.apiFetch.mockResolvedValue([item(endAtServerPlus(8))]);
    await getActiveFlashSales();
    expect(renderHook(() => useCountdown(endAtServerPlus(8))).result.current).toBe('0h 08m');
  });

  it('điện thoại chậm 10 phút, suất đã hết theo máy chủ: không còn đếm', async () => {
    vi.setSystemTime(new Date(SERVER_NOW.getTime() - 10 * 60_000));
    const endAt = new Date(SERVER_NOW.getTime() - 5 * 60_000).toISOString();
    mocks.apiFetch.mockResolvedValue([item(endAt)]);
    await getActiveFlashSales();
    expect(renderHook(() => useCountdown(endAt)).result.current).toBe('');
  });

  it('hạn chuyển khoản (useRemaining) tính theo giờ máy chủ khi bank-qr trả serverNow', async () => {
    mocks.apiFetch.mockResolvedValue({ orderCode: 'T1', serverNow: SERVER_NOW.toISOString() });
    await getBankQr('T1');
    const { result } = renderHook(() => useRemaining(endAtServerPlus(8)));
    expect(result.current).toEqual({ text: 'Còn 8 phút', expired: false });
  });

  it('API cũ không trả serverNow: giữ đồng hồ máy như trước', async () => {
    const { serverNow: _omit, ...legacy } = item(new Date(PHONE_NOW.getTime() + 8 * 60_000).toISOString());
    mocks.apiFetch.mockResolvedValue([legacy]);
    await getActiveFlashSales();
    expect(renderHook(() => useCountdown(legacy.endAt)).result.current).toBe('0h 08m');
  });

  it('thẻ giờ vàng ở trang chủ: suất còn 8 phút theo máy chủ vẫn có đồng hồ khi điện thoại nhanh 10 phút', async () => {
    mocks.get.mockResolvedValue([item(endAtServerPlus(8))]);
    const r = render(<FlashSale />);
    for (let i = 0; i < 4; i += 1) await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(r.container.querySelector('[role="timer"]')?.getAttribute('aria-label')).toBe('Còn 0h 08m');
    r.unmount();
  });
});
