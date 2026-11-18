import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteMeDTO } from '@tubutree/shared-types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getWasteMe: vi.fn(),
  getReturnPackaging: vi.fn(),
  trackRecycleStep: vi.fn(),
  cfg: { isLoaded: true, isPending: false, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as {
    isLoaded: boolean;
    isPending: boolean;
    waste: { enabled: boolean; dropoff: boolean; mailin: boolean; pickup: boolean };
    returnPackagingNudgeEnabled?: boolean;
  },
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../services/waste-api', () => ({
  WASTE_QUERY_KEYS: { me: ['waste', 'me'], returnPackaging: (code: string) => ['waste', 'return-packaging', code] },
  getWasteMe: mocks.getWasteMe,
  getReturnPackaging: mocks.getReturnPackaging,
}));
vi.mock('../../services/recycle-funnel', () => ({ trackRecycleStep: mocks.trackRecycleStep }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SecondOrderInvite } from './second-order-invite';

const delivered = { status: 'DELIVERED', type: 'RETAIL', source: 'checkout', deliveredAt: new Date(Date.now() - 86_400_000).toISOString() };
const me = (patch: Partial<WasteMeDTO> = {}): WasteMeDTO =>
  ({
    programmeEnabled: true,
    eligibility: 'OK',
    blocked: false,
    shipLockedAt: null,
    laneFlags: { dropoff: true, mailin: true, pickup: true },
    thresholds: { mailinMinPoints: 0, pickupMinPoints: 0, maxOpenRequests: 2 },
    openRequests: [],
    ...patch,
  }) as unknown as WasteMeDTO;

function renderInvite(order: Parameters<typeof SecondOrderInvite>[0]['order'] = delivered) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SecondOrderInvite order={order} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cfg = { isLoaded: true, isPending: false, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  mocks.getWasteMe.mockResolvedValue(me());
  mocks.getReturnPackaging.mockResolvedValue({ suggestion: null });
});

describe('SecondOrderInvite — thẻ mời ở chi tiết đơn đã giao (Mini App)', () => {
  it('đơn đã giao đủ điều kiện: một thẻ, một nút, ghi bước second_order_shown đúng một lần', async () => {
    const { rerender } = renderInvite();
    expect(await screen.findByText('Giữ bao bì gửi kèm đơn sau')).toBeInTheDocument();
    expect(screen.getByText(/Miễn ship 100%/)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(mocks.trackRecycleStep).toHaveBeenCalledTimes(1);
    expect(mocks.trackRecycleStep).toHaveBeenCalledWith('second_order_shown', 'PICKUP');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SecondOrderInvite order={delivered} />
      </QueryClientProvider>,
    );
    expect(mocks.trackRecycleStep.mock.calls.filter(([step]) => step === 'second_order_shown')).toHaveLength(1);
  });

  it('chạm thẻ: ghi second_order_click rồi mở màn tạo yêu cầu với đường kèm đơn chọn sẵn', async () => {
    renderInvite();
    fireEvent.click(await screen.findByRole('button'));
    expect(mocks.trackRecycleStep).toHaveBeenCalledWith('second_order_click', 'PICKUP');
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new?method=PICKUP');
  });

  it('đơn chưa giao / đã kèm rác / đơn đại lý: không hiện và không gọi /waste/me', async () => {
    for (const order of [{ ...delivered, status: 'SHIPPING' }, { ...delivered, hasRecyclingPickup: true }, { ...delivered, type: 'DEALER' }]) {
      const view = renderInvite(order);
      await new Promise((r) => setTimeout(r, 30));
      expect(view.container.textContent).toBe('');
      view.unmount();
    }
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    expect(mocks.trackRecycleStep).not.toHaveBeenCalled();
  });

  it('chạm trần 2 yêu cầu đang mở (W179): ẩn hẳn, không ghi second_order_shown', async () => {
    const open = (method: string) => ({ id: method, method });
    mocks.getWasteMe.mockResolvedValue(me({ openRequests: [open('DROP_OFF'), open('MAIL_IN')] as unknown as WasteMeDTO['openRequests'] }));
    const { container } = renderInvite();
    await waitFor(() => expect(mocks.getWasteMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
    expect(mocks.trackRecycleStep).not.toHaveBeenCalled();
  });

  it('đường kèm đơn tắt ở cấu hình công khai: ẩn và không gọi /waste/me', async () => {
    mocks.cfg = { ...mocks.cfg, waste: { ...mocks.cfg.waste, pickup: false } };
    const { container } = renderInvite();
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('cấu hình công khai chưa về: chưa gọi /waste/me, chưa hiện', async () => {
    mocks.cfg = { ...mocks.cfg, isLoaded: false };
    const { container } = renderInvite();
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('/waste/me lỗi: ẩn lặng lẽ, không ném lỗi', async () => {
    mocks.getWasteMe.mockRejectedValue(new Error('boom'));
    const { container } = renderInvite();
    await waitFor(() => expect(mocks.getWasteMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });
});

describe('SecondOrderInvite — dòng thay thế khi thẻ không hiện', () => {
  const renderWith = (order: Parameters<typeof SecondOrderInvite>[0]['order']) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SecondOrderInvite order={order} fallback={<p>dòng mời bạn</p>} />
      </QueryClientProvider>,
    );

  it('thẻ hiện thì không có dòng thay thế', async () => {
    renderWith(delivered);
    expect(await screen.findByText('Giữ bao bì gửi kèm đơn sau')).toBeInTheDocument();
    expect(screen.queryByText('dòng mời bạn')).toBeNull();
  });

  it('thẻ không hiện (đường kèm đơn tắt): dòng thay thế hiện ở chỗ thẻ', async () => {
    mocks.cfg = { ...mocks.cfg, waste: { ...mocks.cfg.waste, pickup: false } };
    renderWith(delivered);
    expect(await screen.findByText('dòng mời bạn')).toBeInTheDocument();
  });

  it('chưa biết chắc (cấu hình chưa về hoặc /waste/me đang tải): chưa hiện gì, tránh nhảy từ dòng sang thẻ', async () => {
    mocks.cfg = { ...mocks.cfg, isLoaded: false };
    const first = renderWith(delivered);
    expect(screen.queryByText('dòng mời bạn')).toBeNull();
    first.unmount();
    mocks.cfg = { ...mocks.cfg, isLoaded: true };
    let resolve: (v: WasteMeDTO) => void = () => undefined;
    mocks.getWasteMe.mockReturnValue(new Promise<WasteMeDTO>((r) => (resolve = r)));
    renderWith(delivered);
    expect(screen.queryByText('dòng mời bạn')).toBeNull();
    resolve(me({ blocked: true } as Partial<WasteMeDTO>));
    await waitFor(() => expect(screen.getByText('dòng mời bạn')).toBeInTheDocument());
  });
});

describe('SecondOrderInvite — bao bì của đơn (cờ checkout.return_packaging_nudge_enabled)', () => {
  const PACKAGING = {
    orderCodes: ['TT123'],
    lines: [
      { itemId: 'wi-carton', code: 'CARTON', name: 'Thùng carton cũ', unitLabel: 'thùng', qty: 1, unitsPerPoint: 1, pointsPerGroup: 1000 },
      { itemId: 'wi-tubu-bottle', code: 'TUBU_BOTTLE', name: 'Vỏ chai, hộp Tubu Tree', unitLabel: 'vỏ', qty: 2, unitsPerPoint: 1, pointsPerGroup: 2000 },
    ],
    estimatedPoints: 5000,
    minPoints: 3000,
  };
  const withCode = { ...delivered, code: 'TT123' };

  it('cờ bật, đơn có bao bì: thẻ nêu đúng món và điểm, chạm vào thì màn tạo yêu cầu điền sẵn từ đơn này', async () => {
    mocks.cfg = { ...mocks.cfg, returnPackagingNudgeEnabled: true };
    mocks.getReturnPackaging.mockResolvedValue({ suggestion: PACKAGING });
    renderInvite(withCode);
    expect(await screen.findByText('1 thùng carton, 2 vỏ chai Tubu Tree: miễn ship, +5.000 Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('Giữ bao bì gửi kèm đơn sau')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(mocks.getReturnPackaging).toHaveBeenCalledWith('TT123');
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new?method=PICKUP&from=TT123');
  });

  it('bao bì chưa đủ ngưỡng: không hứa miễn ship, nói rõ ngưỡng', async () => {
    mocks.cfg = { ...mocks.cfg, returnPackagingNudgeEnabled: true };
    mocks.getReturnPackaging.mockResolvedValue({ suggestion: { ...PACKAGING, lines: [PACKAGING.lines[0]], estimatedPoints: 1000 } });
    renderInvite(withCode);
    expect(await screen.findByText('1 thùng carton: +1.000 Điểm Xanh, đủ 3.000 điểm thì miễn ship')).toBeInTheDocument();
  });

  it('cờ bật nhưng đơn không còn bao bì (hoặc lỗi): chữ cũ, đường cũ', async () => {
    mocks.cfg = { ...mocks.cfg, returnPackagingNudgeEnabled: true };
    mocks.getReturnPackaging.mockRejectedValue(new Error('boom'));
    renderInvite(withCode);
    fireEvent.click(await screen.findByRole('button'));
    expect(screen.getByText('Giữ bao bì gửi kèm đơn sau')).toBeInTheDocument();
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new?method=PICKUP');
  });

  it('cờ tắt: không gọi API bao bì', async () => {
    renderInvite(withCode);
    expect(await screen.findByText('Giữ bao bì gửi kèm đơn sau')).toBeInTheDocument();
    expect(mocks.getReturnPackaging).not.toHaveBeenCalled();
  });
});
