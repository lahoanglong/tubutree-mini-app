import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrderDTO } from '@tubutree/shared-types';
import type * as ZmpUi from 'zmp-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  httpGet: vi.fn(),
  share: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock('../../utils/features', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), SUBSCRIPTIONS_IN_MINIAPP: false }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => vi.fn(),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({ fetchProduct: vi.fn(), getPublicConfig: mocks.getPublicConfig }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.httpGet } }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../share-sheet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useShareWithFallback: () => mocks.share,
}));
vi.mock('../../store/storefront-context', () => ({
  useStorefrontContext: (sel: (s: { slug: null; kind: null }) => unknown) => sel({ slug: null, kind: null }),
}));

import { greenCardQuery } from '@tubutree/app-core/referral/green-card';
import { coreHttp } from '../../services/core-http';
import { OrderSuccess } from './order-success';

const ORDER = {
  id: 'o1', code: 'TUBU-COD-12345', status: 'CONFIRMED', total: 249000, pointsEarned: 24, paymentMethod: 'COD', fulfiller: 'TUBU',
  items: [{ id: 'i1', variationId: 'var-1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 249000, quantity: 1, total: 249000, backorderedQty: 0 }],
} as unknown as OrderDTO;
const CONFIG = { freeshipThreshold: 199000, subscribeDiscountPct: 0.12, affiliateWalletMultiplier: 1.5, cashbackHoldDays: 30 };
const CARD = (over: Record<string, unknown> = {}) => ({
  referralCode: 'LAN2026',
  album: null,
  wasteItems: 0,
  firstOrderReward: { points: 100, minOrderAmount: 199000 },
  earnsPoints: true,
  ...over,
});

function renderSuccess(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <OrderSuccess order={ORDER} onTrack={vi.fn()} onContinue={vi.fn()} />
    </QueryClientProvider>,
  );
}

const greenCardCalls = () => mocks.httpGet.mock.calls.filter((c) => c[0] === '/me/green-card');

describe('OrderSuccess: lời mời bạn sau khi đặt (cờ growth.referral_viral_enabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, referralViralEnabled: true });
    mocks.httpGet.mockImplementation(async (path: string) => (path === '/me/green-card' ? CARD() : undefined));
    mocks.share.mockResolvedValue(undefined);
  });

  it('cờ bật, tài khoản nhận thưởng đơn đầu: một dòng mời nằm dưới các nút chính, đọc thưởng của máy chủ', async () => {
    renderSuccess();
    const row = await screen.findByTestId('order-invite-nudge');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveClass('touch-target');
    expect(row).toHaveTextContent('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
    expect(row).toHaveTextContent('Chia sẻ qua Zalo');
    const track = screen.getByRole('button', { name: 'Theo dõi đơn' });
    expect(track.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('order-invite-nudge')).toHaveLength(1);
  });

  it('chạm: mở hộp chia sẻ Zalo với link mời ?ref= và lời mời thưởng, ghi green_card_shared (surface order); đang mở thì chạm lần hai bị bỏ', async () => {
    let finish!: () => void;
    mocks.share.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    renderSuccess();
    const row = await screen.findByTestId('order-invite-nudge');
    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute('aria-busy', 'true'));
    expect(row).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(row);
    expect(mocks.share).toHaveBeenCalledTimes(1);
    const [params, fallback] = mocks.share.mock.calls[0]!;
    expect(params).toEqual({
      title: 'Tubu Tree: trồng cây, nhận quà',
      description: 'Tặng bạn trải nghiệm thuần khiết — nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ',
      path: '/?ref=LAN2026',
    });
    expect(fallback).toMatch(/^Sống xanh cùng mình nhé, vào Tubu Tree bằng link này: .*LAN2026/);
    expect(mocks.trackEvent).toHaveBeenCalledWith('green_card_shared', 'miniapp', { method: 'share', surface: 'order' });
    await act(async () => finish());
    await waitFor(() => expect(row).not.toHaveAttribute('aria-busy'));
  });

  it('CTV (earnsPoints false) hay Admin tắt thưởng (0 điểm): không có dòng mời, không hứa', async () => {
    mocks.httpGet.mockImplementation(async (path: string) => (path === '/me/green-card' ? CARD({ earnsPoints: false }) : undefined));
    const { unmount } = renderSuccess();
    await waitFor(() => expect(greenCardCalls()).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByTestId('order-invite-nudge')).toBeNull();
    unmount();

    mocks.httpGet.mockImplementation(async (path: string) => (path === '/me/green-card' ? CARD({ firstOrderReward: { points: 0, minOrderAmount: 0 } }) : undefined));
    renderSuccess();
    await waitFor(() => expect(greenCardCalls()).toHaveLength(2));
    await act(async () => {});
    expect(screen.queryByTestId('order-invite-nudge')).toBeNull();
  });

  it('thẻ trong bộ nhớ (trước khi đặt) còn hứa, máy chủ nay báo hết nhận thưởng: đọc lại khi màn mở, không còn dòng mời', async () => {
    mocks.httpGet.mockImplementation(async (path: string) => (path === '/me/green-card' ? CARD({ earnsPoints: false }) : undefined));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(greenCardQuery(coreHttp).queryKey, CARD());
    renderSuccess(qc);
    await waitFor(() => expect(greenCardCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('order-invite-nudge')).toBeNull());
  });

  it('cờ tắt hay API cũ chưa trả cờ: không gọi /me/green-card, không có dòng', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, referralViralEnabled: false });
    renderSuccess();
    await screen.findByRole('button', { name: 'Theo dõi đơn' });
    await act(async () => {});
    expect(greenCardCalls()).toHaveLength(0);
    expect(screen.queryByTestId('order-invite-nudge')).toBeNull();
  });

  it('/me/green-card hỏng dạng: không có dòng', async () => {
    mocks.httpGet.mockImplementation(async (path: string) => (path === '/me/green-card' ? { referralCode: 'x y' } : undefined));
    renderSuccess();
    await waitFor(() => expect(greenCardCalls()).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByTestId('order-invite-nudge')).toBeNull();
  });
});
