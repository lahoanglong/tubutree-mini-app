import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InviteShareStat } from '@tubutree/app-core/referral/share-card';

// Thẻ chia sẻ ở khối "Mời bạn sống xanh" của Cá nhân (Mini App): cùng web `components/referral/invite-share-card.tsx`.

const mocks = vi.hoisted(() => ({ get: vi.fn(), track: vi.fn(), copy: vi.fn(), share: vi.fn(), snack: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.snack }),
}));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.track }));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copy }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../share-sheet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useShareWithFallback: () => mocks.share,
}));

import { InviteShareCard } from './invite-share-card';

const CARD = { referralCode: 'LAN1', album: null, wasteItems: 0, firstOrderReward: { points: 100, minOrderAmount: 199_000 }, earnsPoints: true };
const STATS: InviteShareStat[] = [
  { key: 'friends', value: '12', label: 'Bạn bè đã mời' },
  { key: 'points', value: '5.000', label: 'Điểm Xanh đã nhận' },
];
const URL = 'https://zalo.me/s/1/?ref=LAN1';

function mount(o: { viral?: boolean; stats?: InviteShareStat[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InviteShareCard code="LAN1" shareUrl={() => URL} fallbackText="Tubu Tree tặng khách mới mã giảm giá cho đơn đầu" viral={o.viral ?? true} stats={o.stats ?? STATS}>
        <p data-testid="slot">dòng tiến độ</p>
      </InviteShareCard>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/me/green-card') return CARD;
    throw new Error(`đường dẫn lạ ${path}`);
  });
  mocks.copy.mockResolvedValue(true);
  mocks.share.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe('InviteShareCard (Mini App)', () => {
  it('lời mời đọc đúng số máy chủ: +100 Điểm Xanh, đơn đầu từ 199.000đ', async () => {
    mount();
    expect(await screen.findByRole('heading', { level: 3, name: 'Tặng bạn trải nghiệm thuần khiết' })).toBeTruthy();
    expect(screen.getByTestId('invite-share-offer').textContent).toBe('Nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ');
  });

  it('tài khoản không nhận thưởng: không hứa; cờ tắt: không gọi /me/green-card', async () => {
    mocks.get.mockResolvedValue({ ...CARD, earnsPoints: false });
    const { unmount } = mount();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/me/green-card'));
    expect(screen.queryByTestId('invite-share-offer')).toBeNull();
    unmount();
    mocks.get.mockClear();
    mount({ viral: false });
    expect(screen.getByRole('button', { name: 'Chia sẻ qua Zalo' })).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('ô số canh cột (tabular-nums), dòng tiến độ nằm trong thẻ; không có số thì không có ô', async () => {
    const { unmount } = mount();
    const stats = screen.getByTestId('invite-share-stats');
    expect(within(stats).getAllByRole('definition').map((d) => d.textContent)).toEqual(['12', '5.000']);
    expect(within(stats).getAllByRole('term').map((d) => d.textContent)).toEqual(['Bạn bè đã mời', 'Điểm Xanh đã nhận']);
    expect(stats.style.fontVariantNumeric).toBe('tabular-nums');
    expect(within(screen.getByTestId('invite-share-card')).getByTestId('slot')).toBeTruthy();
    unmount();
    mount({ stats: [] });
    expect(screen.queryByTestId('invite-share-stats')).toBeNull();
  });

  it('sao chép một chạm: chép link, snackbar báo đã chép, ghi sự kiện chép ở Cá nhân', async () => {
    mount();
    expect(screen.getByText(/Mã của bạn/).textContent).toBe('Mã của bạn: LAN1');
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép link mời bạn' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(URL));
    await waitFor(() => expect(mocks.snack).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text: 'Đã sao chép link mời bạn' })));
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', 'miniapp', { method: 'copy', surface: 'account' });
  });

  it('chép lỗi: snackbar nêu mã để tự chép', async () => {
    mocks.copy.mockResolvedValue(false);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép link mời bạn' }));
    await waitFor(() => expect(mocks.snack).toHaveBeenCalledWith(expect.objectContaining({ text: 'Không sao chép được. Mã của bạn: LAN1' })));
  });

  it('chia sẻ Zalo: hộp chia sẻ nhận lời mời thưởng thật, đường lùi chép lời mời kèm link; ghi sự kiện chia sẻ', async () => {
    mount();
    await screen.findByTestId('invite-share-offer');
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ qua Zalo' }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
    expect(mocks.share).toHaveBeenCalledWith(
      {
        title: 'Tubu Tree: trồng cây, nhận quà',
        description: 'Tặng bạn trải nghiệm thuần khiết — nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ',
        path: '/?ref=LAN1',
      },
      `Sống xanh cùng mình nhé, vào Tubu Tree bằng link này: ${URL}`,
    );
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', 'miniapp', { method: 'share', surface: 'account' });
  });

  it('cờ tắt: chia sẻ dùng lời mời mã chào mừng', async () => {
    mount({ viral: false });
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ qua Zalo' }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
    expect(mocks.share.mock.calls[0]![0].description).toBe('Tubu Tree tặng khách mới mã giảm giá cho đơn đầu');
  });
});
