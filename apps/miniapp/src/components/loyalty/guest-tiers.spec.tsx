import { act, render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import type * as ReactQuery from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ login: vi.fn(), coreGet: vi.fn(), refetch: vi.fn() }));
// Đếm số lần màn gọi `refetch` (không phải số lần gọi API): query chưa có dữ liệu tự gộp các lần tải chồng nên chỉ đếm API không phân biệt được.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const orig = await importOriginal<typeof ReactQuery>();
  return {
    ...orig,
    useQuery: ((...args: unknown[]) => {
      const result = (orig.useQuery as (...a: unknown[]) => UseQueryResult)(...args);
      return { ...result, refetch: (...a: Parameters<UseQueryResult['refetch']>) => { mocks.refetch(); return result.refetch(...a); } };
    }) as typeof orig.useQuery,
  };
});
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'), getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { login: mocks.login };
    return sel ? sel(state) : state;
  },
}));

import { GuestTiers } from './guest-tiers';

describe('GuestTiers (khách xem hạng thành viên)', () => {
  it('liệt kê hạng, điều kiện, quyền lợi; nút "Đăng nhập để đổi" gọi login', async () => {
    mocks.coreGet.mockResolvedValue({
      rewards: [], giftClaimDays: 60, claimPoint: null, rates: {}, pointExpireMonths: 12,
      tiers: [
        { id: 'MAM_XANH', name: 'Mầm Xanh', minPoints: 0, minSpending: null, multiplier: 1, perks: ['Tích Điểm Xanh mỗi đơn'] },
        { id: 'LOC_BIEC', name: 'Lộc Biếc', minPoints: 2500, minSpending: 5_000_000, multiplier: 1.2, perks: ['Freeship đơn từ 99k'] },
      ],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <GuestTiers />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Lộc Biếc')).toBeInTheDocument();
    expect(screen.getByText('Hạng khởi đầu')).toBeInTheDocument();
    expect(screen.getByText('Chi tiêu từ 5 triệu trong 12 tháng')).toBeInTheDocument();
    expect(screen.getByText('Freeship đơn từ 99k')).toBeInTheDocument();
    expect(screen.getByText('Điểm ×1,2')).toBeInTheDocument();
    expect(mocks.coreGet).toHaveBeenCalledWith('/loyalty/preview');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để đổi' }));
    expect(mocks.login).toHaveBeenCalled();
  });
});

describe('GuestTiers — "Thử lại" khi tải hạng lỗi (W82A)', () => {
  it('trả Promise tải lại: hai cú chạm cùng nhịp chỉ tải lại một lần, tải xong thì hiện hạng', async () => {
    mocks.refetch.mockClear();
    mocks.coreGet.mockRejectedValueOnce(new Error('Mất mạng'));
    let finish!: (v: unknown) => void;
    mocks.coreGet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <GuestTiers />
      </QueryClientProvider>,
    );
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    await act(async () => finish({ rewards: [], giftClaimDays: 60, claimPoint: null, rates: {}, pointExpireMonths: 12, tiers: [{ id: 'MAM_XANH', name: 'Mầm Xanh', minPoints: 0, minSpending: null, multiplier: 1, perks: [] }] }));
    expect(await screen.findByText('Mầm Xanh')).toBeInTheDocument();
  });
});
