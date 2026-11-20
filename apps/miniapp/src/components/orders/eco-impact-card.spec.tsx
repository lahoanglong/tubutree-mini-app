import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderEcoImpact } from '@tubutree/app-core/eco/order-impact';

const mocks = vi.hoisted(() => ({ track: vi.fn(), copy: vi.fn(), share: vi.fn(), snack: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.snack }),
}));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ referralViralEnabled: true }) }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copy }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../share-sheet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useShareWithFallback: () => mocks.share,
}));

import OrderEcoImpactCard from './eco-impact-card';

const IMPACT: OrderEcoImpact = {
  orderCode: 'TT001',
  bottlesSaved: 5,
  plasticGrams: 0,
  refillPacks: 2,
  points: 120,
  pointsCredited: false,
  referralCode: 'LAN123',
  inviteReward: null,
};
afterEach(() => vi.clearAllMocks());

describe('OrderEcoImpactCard Mini (tubu-w11-03)', () => {
  it('số chai, điểm chờ nhận hàng, câu mời chung khi không hứa thưởng', () => {
    render(<OrderEcoImpactCard impact={IMPACT} />);
    const card = screen.getByTestId('order-eco-impact');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần');
    expect(card.textContent).toContain('+120 Điểm Xanh khi nhận hàng');
    expect(card.textContent).toContain('Gửi link mời để bạn bè sống xanh cùng bạn');
  });

  it('chia sẻ Zalo: mở Mini App ở ?ref=<mã>, mô tả kể số chai, chữ dự phòng có link; đo surface=order', async () => {
    mocks.share.mockResolvedValue(undefined);
    render(<OrderEcoImpactCard impact={IMPACT} />);
    await userEvent.click(screen.getByRole('button', { name: /Zalo/ }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
    const [payload, fallback] = mocks.share.mock.calls[0] as [{ path: string; description: string }, string];
    expect(payload.path).toBe('/?ref=LAN123');
    expect(payload.description).toBe('Mình vừa giảm 5 chai nhựa dùng 1 lần nhờ mua Refill ở Tubu Tree 🌱');
    expect(fallback).toContain('LAN123');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', 'miniapp', { method: 'share', surface: 'order' });
  });

  it('sao chép: chép link có mã rồi báo snackbar', async () => {
    mocks.copy.mockResolvedValue(true);
    render(<OrderEcoImpactCard impact={IMPACT} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép link' }));
    await waitFor(() => expect(mocks.snack).toHaveBeenCalledTimes(1));
    expect(mocks.copy.mock.calls[0]?.[0]).toContain('LAN123');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', 'miniapp', { method: 'copy', surface: 'order' });
  });
});
