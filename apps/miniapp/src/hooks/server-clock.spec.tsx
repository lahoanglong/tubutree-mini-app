import { act, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../services/api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), api: { get: mocks.get } }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'guest' }) }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));

import { fetchActiveFlashSales } from '../services/shop-api';
import { FlashSale } from '../components/flash-sale';
import { useCountdown } from './use-countdown';
import { useRemaining } from './use-remaining';
import { syncServerClock } from '../utils/server-clock';

// D14-05: đồng hồ điện thoại nhanh 10 phút so với máy chủ. Hết giờ vàng phải tính theo giờ máy chủ.
const PHONE_NOW = new Date('2026-10-18T10:00:00.000Z');
const SERVER_NOW = new Date(PHONE_NOW.getTime() - 10 * 60_000);
const endAtServerPlus = (min: number) => new Date(SERVER_NOW.getTime() + min * 60_000).toISOString();

const item = (endAt: string) => ({
  itemId: 'i1', variationId: 'v1', productSlug: 'p1', productName: 'Nước rửa chén', thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, salePrice: null, quota: 10, soldCount: 2, endAt, serverNow: SERVER_NOW.toISOString(),
});

describe('Đồng hồ máy chủ cho giờ vàng (D14-05)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(PHONE_NOW);
    syncServerClock(PHONE_NOW.toISOString());
    mocks.get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('điện thoại nhanh 10 phút, suất còn 8 phút theo máy chủ: useCountdown vẫn hiện "0h 08m", không rỗng', async () => {
    mocks.get.mockResolvedValue({ data: [item(endAtServerPlus(8))] });
    await fetchActiveFlashSales();
    const { result } = renderHook(() => useCountdown(endAtServerPlus(8)));
    expect(result.current).toBe('0h 08m');
  });

  it('điện thoại chậm 10 phút, suất đã hết theo máy chủ: không còn đếm "0h 05m"', async () => {
    const slowPhone = new Date(SERVER_NOW.getTime() - 10 * 60_000);
    vi.setSystemTime(slowPhone);
    const endAt = new Date(SERVER_NOW.getTime() - 5 * 60_000).toISOString();
    mocks.get.mockResolvedValue({ data: [{ ...item(endAt), serverNow: SERVER_NOW.toISOString() }] });
    await fetchActiveFlashSales();
    const { result } = renderHook(() => useCountdown(endAt));
    expect(result.current).toBe('');
  });

  it('useRemaining (hạn chuyển khoản) cũng tính theo giờ máy chủ', async () => {
    mocks.get.mockResolvedValue({ data: [item(endAtServerPlus(8))] });
    await fetchActiveFlashSales();
    const { result } = renderHook(() => useRemaining(endAtServerPlus(8)));
    expect(result.current.expired).toBe(false);
    expect(result.current.text).toBe('Còn 8 phút');
  });

  it('thẻ giờ vàng ở Trang chủ: suất còn 8 phút theo máy chủ vẫn có đồng hồ khi điện thoại nhanh 10 phút', async () => {
    mocks.get.mockResolvedValue({ data: [item(endAtServerPlus(8))] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FlashSale />
      </QueryClientProvider>,
    );
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(screen.getByRole('timer')).toHaveTextContent('0h 08m');
  });

  it('API cũ không trả serverNow: giữ đồng hồ điện thoại như trước', async () => {
    const { serverNow: _omit, ...legacy } = item(new Date(PHONE_NOW.getTime() + 8 * 60_000).toISOString());
    mocks.get.mockResolvedValue({ data: [legacy] });
    await fetchActiveFlashSales();
    const { result } = renderHook(() => useCountdown(legacy.endAt));
    expect(result.current).toBe('0h 08m');
  });
});
