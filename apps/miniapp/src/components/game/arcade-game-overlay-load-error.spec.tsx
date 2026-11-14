import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loads: 0, phase: 'authenticated' }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../store/auth', () => {
  const state = () =>
    mocks.phase === 'authenticated'
      ? { status: 'authenticated', user: { id: 'u1', phone: '0900000001', zaloId: 'zalo-1' } }
      : mocks.phase === 'device'
        ? { status: 'authenticated', user: { id: 'g1', phone: null, zaloId: 'guest_abc' } }
        : { status: 'idle', user: null };
  return { useAuthStore: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) };
});
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => vi.fn() }));
vi.mock('../../services/arcade-api', () => ({
  arcadeStatusQuery: { queryKey: ['game', 'arcade'], queryFn: vi.fn() },
  submitArcadeRun: vi.fn(),
  submitHomeQuiz: vi.fn(),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@tubutree/app-core/arcade/arcade-canvas', () => {
  mocks.loads += 1;
  throw new Error('Không tải được gói game');
});

import { ArcadeGameOverlay } from './arcade-game-overlay';

function mountOverlay(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ArcadeGameOverlay gameId="refill_rush" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  document.body.style.overflow = '';
});

describe('ArcadeGameOverlay: gói game không tải được (mạng yếu)', () => {
  it('thay nút Chơi bằng thông báo lỗi có Thử lại; vẫn đóng được lớp phủ; không dựng canvas chơi', async () => {
    const onClose = mountOverlay();
    const cover = await screen.findByTestId('arcade-ready');
    await waitFor(() => expect(within(cover).getByRole('button', { name: /Thử lại/ })).toBeInTheDocument());
    expect(within(cover).queryByRole('button', { name: /^Chơi/ })).toBeNull();
    expect(screen.getByTestId('arcade-overlay').dataset.phase).toBe('ready');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Thử lại gọi nạp lại, không văng lỗi chưa bắt; lớp phủ vẫn ở màn bắt đầu', async () => {
    mountOverlay();
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    fireEvent.click(retry);
    await screen.findByRole('button', { name: /Thử lại/ });
    expect(screen.getByTestId('arcade-overlay').dataset.phase).toBe('ready');
    expect(mocks.loads).toBeGreaterThanOrEqual(1);
  });
});
