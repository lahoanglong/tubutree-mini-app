import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ login: vi.fn(), coreGet: vi.fn() }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
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
    expect(screen.getByText('Freeship đơn từ 99k')).toBeInTheDocument();
    expect(screen.getByText('Điểm x1,2')).toBeInTheDocument();
    expect(mocks.coreGet).toHaveBeenCalledWith('/loyalty/preview');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để đổi' }));
    expect(mocks.login).toHaveBeenCalled();
  });
});
