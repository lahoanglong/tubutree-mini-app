import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), cfg: { isLoaded: true, loyalty: { vndPerPointRedeem: 1000 } } as Record<string, unknown> }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../store/auth', () => {
  const state = () => ({ user: { id: 'u1', fullName: 'Lan', pointsBalance: 100, pointsConvertedBalance: 20 } });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: () => state() });
  return { useAuthStore };
});
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { OffersPointsStrip, type PointsStripQuery } from './offers-points-strip';

const loaded = (over: Partial<PointsStripQuery> = {}): PointsStripQuery => ({
  data: { pointsBalance: 100, pointsConvertedBalance: 20, tier: { name: 'Mầm Xanh' }, nextTier: null } as PointsStripQuery['data'],
  isError: false,
  refetch: vi.fn(),
  ...over,
});

describe('OffersPointsStrip — dải Điểm Xanh gọn ở trang Ưu đãi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vùng tên "Điểm Xanh", hạng, nút tên đọc có hạng và số điểm, bấm tới /loyalty', async () => {
    render(<OffersPointsStrip loyalty={loaded()} />);
    expect(screen.getByRole('region', { name: /Điểm Xanh/ })).toBeInTheDocument();
    expect(screen.getByText('Mầm Xanh')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Hạng và lịch sử điểm/ });
    await waitFor(() => expect(btn).toHaveAccessibleName(/Mầm Xanh, 120 điểm/));
    fireEvent.click(btn);
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
  });

  it('lối vào chi tiết điểm chỉ có một nút (cả khối bấm được), chữ "Hạng và lịch sử điểm" hiện đúng một lần', () => {
    render(<OffersPointsStrip loyalty={loaded()} />);
    expect(screen.getAllByText('Hạng và lịch sử điểm')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Hạng và lịch sử điểm/ })).toHaveLength(1);
  });

  it('có thanh tiến độ lên hạng kế; chưa tải được hạng thì không đoán hạng, báo lỗi và "Thử lại" gọi lại', () => {
    const refetch = vi.fn();
    const { rerender } = render(<OffersPointsStrip loyalty={loaded()} />);
    expect(screen.getByRole('progressbar', { name: 'Tiến độ lên hạng kế' })).toBeInTheDocument();
    rerender(<OffersPointsStrip loyalty={loaded({ data: undefined, isError: true, refetch })} />);
    expect(screen.getByText('Chưa tải được hạng và điểm')).toBeInTheDocument();
    expect(screen.queryByText('Mầm Xanh')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
