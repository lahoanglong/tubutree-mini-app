import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  track: vi.fn(),
  copy: vi.fn(),
  share: vi.fn(),
  snack: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.snack }),
}));
vi.mock('../../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ referralViralEnabled: true }),
}));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copy }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../share-sheet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useShareWithFallback: () => mocks.share,
}));

import GreenCardBlock from './green-card';

const CARD = {
  referralCode: 'LAN123',
  album: { seen: 12, total: 40 },
  wasteItems: 7,
  firstOrderReward: { points: 100, minOrderAmount: 199_000 },
  earnsPoints: true,
};

function mount(actions: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GreenCardBlock actions={actions} />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.clearAllMocks());

describe('GreenCardBlock Mini (tubu-w8-02)', () => {
  it('Sổ tay Xanh: số thẻ, số vỏ, thưởng; chia sẻ gửi link ?ref=<mã> và đo method=share', async () => {
    mocks.get.mockResolvedValue(CARD);
    mocks.share.mockResolvedValue(undefined);
    mount(true);
    await screen.findByTestId('green-card');
    expect(screen.getByTestId('green-card').textContent).toContain(
      '12 thẻ xanh đã mở · 7 vỏ đã đổi',
    );
    expect(screen.getByTestId('green-card').textContent).toContain('cả hai nhận +100 Điểm Xanh');
    await userEvent.click(screen.getByRole('button', { name: /Zalo/ }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
    expect(mocks.share.mock.calls[0]?.[0].path).toBe('/?ref=LAN123');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', 'miniapp', { method: 'share' });
  });

  it('sao chép: chép link có mã rồi báo snackbar', async () => {
    mocks.get.mockResolvedValue(CARD);
    mocks.copy.mockResolvedValue(true);
    mount(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Sao chép link' }));
    await waitFor(() => expect(mocks.snack).toHaveBeenCalledTimes(1));
    expect(mocks.copy.mock.calls[0]?.[0]).toContain('LAN123');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', 'miniapp', { method: 'copy' });
  });

  it('khối mời ở Cá nhân: chỉ một dòng, không có nút', async () => {
    mocks.get.mockResolvedValue(CARD);
    mount(false);
    expect((await screen.findByTestId('green-card-stats')).textContent).toContain('7 vỏ đã đổi');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('API lỗi (cờ tắt trả 404): không vẽ gì', async () => {
    mocks.get.mockRejectedValue(new Error('404'));
    const { container } = mount(true);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
