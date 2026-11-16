import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteMeDTO } from '@tubutree/shared-types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getWasteMe: vi.fn(),
  trackRecycleStep: vi.fn(),
  cfg: { isLoaded: true, isPending: false, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../services/waste-api', () => ({ WASTE_QUERY_KEYS: { me: ['waste', 'me'] }, getWasteMe: mocks.getWasteMe }));
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
