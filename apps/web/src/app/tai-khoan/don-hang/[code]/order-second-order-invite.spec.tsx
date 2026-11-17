// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteMeDTO } from '@tubutree/shared-types';
import { flush, render } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  getWasteMe: vi.fn(),
  trackRecycleStep: vi.fn(),
  routeReady: true,
  cfgReads: vi.fn(),
  cfg: { isLoaded: true, isPending: false, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@tubutree/app-core/api/waste', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), getWasteMe: mocks.getWasteMe }));
vi.mock('@/lib/route-map', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isWebRouteReady: () => mocks.routeReady }));
vi.mock('@/lib/recycle-funnel', () => ({ trackRecycleStep: mocks.trackRecycleStep }));
vi.mock('@/lib/use-public-config', () => ({
  usePublicConfig: () => {
    mocks.cfgReads();
    return mocks.cfg;
  },
}));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { oa: { available: false }, storage: {} } }));

import { OrderSecondOrderInvite } from './order-extras';

const delivered = { id: 'o1', code: 'TB-9', status: 'DELIVERED', type: 'RETAIL', source: 'checkout', deliveredAt: new Date(Date.now() - 86_400_000).toISOString() } as unknown as Parameters<typeof OrderSecondOrderInvite>[0]['order'];
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeReady = true;
  mocks.cfg = { isLoaded: true, isPending: false, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  mocks.getWasteMe.mockResolvedValue(me());
});

describe('OrderSecondOrderInvite — thẻ mời ở chi tiết đơn đã giao (web)', () => {
  it('đơn đã giao đủ điều kiện: một liên kết tới /doi-rac/tao?method=PICKUP, ghi second_order_shown một lần', async () => {
    const view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    const links = view.container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/doi-rac/tao?method=PICKUP');
    expect(view.container.textContent).toContain('Giữ bao bì gửi kèm đơn sau');
    expect(view.container.textContent).toContain('Miễn ship 100%');
    expect(mocks.trackRecycleStep.mock.calls.filter(([step]) => step === 'second_order_shown')).toEqual([['second_order_shown', 'PICKUP']]);
    view.unmount();
  });

  it('bấm thẻ ghi second_order_click', async () => {
    const view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    view.container.addEventListener('click', (e) => e.preventDefault());
    act(() => {
      view.container.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(mocks.trackRecycleStep).toHaveBeenCalledWith('second_order_click', 'PICKUP');
    view.unmount();
  });

  it.each([
    ['đơn đang giao', { status: 'SHIPPING' }],
    ['đơn đã kèm rác', { hasRecyclingPickup: true }],
    ['đơn đại lý', { type: 'DEALER' }],
    ['đơn CTV lên hộ', { source: 'ctv_assisted' }],
    ['giao quá 14 ngày', { deliveredAt: new Date(Date.now() - 15 * 86_400_000).toISOString() }],
  ])('%s: không hiện và không gọi /waste/me', async (_name, patch) => {
    const view = render(<OrderSecondOrderInvite order={{ ...delivered, ...patch } as typeof delivered} />);
    await flush();
    expect(view.container.textContent).toBe('');
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    expect(mocks.trackRecycleStep).not.toHaveBeenCalled();
    view.unmount();
  });

  it('chạm trần 2 yêu cầu đang mở (W179): ẩn hẳn', async () => {
    const open = (method: string) => ({ id: method, method });
    mocks.getWasteMe.mockResolvedValue(me({ openRequests: [open('DROP_OFF'), open('MAIL_IN')] as unknown as WasteMeDTO['openRequests'] }));
    const view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    expect(mocks.getWasteMe).toHaveBeenCalled();
    expect(view.container.textContent).toBe('');
    expect(mocks.trackRecycleStep).not.toHaveBeenCalled();
    view.unmount();
  });

  it('trang /doi-rac/tao chưa sẵn sàng, đường kèm đơn tắt, hoặc cấu hình chưa về: ẩn', async () => {
    mocks.routeReady = false;
    let view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    expect(view.container.textContent).toBe('');
    view.unmount();

    mocks.routeReady = true;
    mocks.cfg = { ...mocks.cfg, waste: { ...mocks.cfg.waste, pickup: false } };
    view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    expect(view.container.textContent).toBe('');
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    view.unmount();

    mocks.cfg = { ...mocks.cfg, isLoaded: false, waste: { ...mocks.cfg.waste, pickup: true } };
    mocks.getWasteMe.mockClear();
    view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    expect(view.container.textContent).toBe('');
    view.unmount();
  });

  it('/waste/me lỗi: ẩn lặng lẽ', async () => {
    mocks.getWasteMe.mockRejectedValue(new Error('boom'));
    const view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    expect(view.container.textContent).toBe('');
    view.unmount();
  });

  it('đơn chưa giao: không đọc /config/public và không hỏi /waste/me (cổng đơn đứng ngoài thẻ)', async () => {
    const shipping = { ...delivered, status: 'SHIPPING', deliveredAt: null } as typeof delivered;
    const view = render(<OrderSecondOrderInvite order={shipping} />);
    await flush();
    expect(view.container.querySelector('a')).toBeNull();
    expect(mocks.cfgReads).not.toHaveBeenCalled();
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    view.unmount();
  });

  it('trang đích chưa sẵn sàng: không vẽ thẻ và cũng không ghi second_order_shown', async () => {
    mocks.routeReady = false;
    const view = render(<OrderSecondOrderInvite order={delivered} />);
    await flush();
    expect(view.container.querySelector('a')).toBeNull();
    expect(mocks.trackRecycleStep).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('OrderSecondOrderInvite — dòng thay thế khi thẻ không hiện (web)', () => {
  const fallback = <p data-testid="fb">dòng mời bạn</p>;

  it('thẻ hiện thì không có dòng thay thế', async () => {
    const view = render(<OrderSecondOrderInvite order={delivered} fallback={fallback} />);
    await flush();
    expect(view.container.textContent).toContain('Giữ bao bì gửi kèm đơn sau');
    expect(view.container.querySelector('[data-testid="fb"]')).toBeNull();
    view.unmount();
  });

  it('đơn ngoài cổng (đang giao) hoặc đường kèm đơn tắt: dòng thay thế ở chỗ thẻ', async () => {
    const shipping = render(<OrderSecondOrderInvite order={{ ...delivered, status: 'SHIPPING' }} fallback={fallback} />);
    expect(shipping.container.querySelector('[data-testid="fb"]')).not.toBeNull();
    shipping.unmount();
    mocks.cfg = { ...mocks.cfg, waste: { ...mocks.cfg.waste, pickup: false } };
    const off = render(<OrderSecondOrderInvite order={delivered} fallback={fallback} />);
    await flush();
    expect(off.container.querySelector('[data-testid="fb"]')).not.toBeNull();
    off.unmount();
  });

  it('cấu hình chưa về hoặc /waste/me đang tải: chưa hiện gì', async () => {
    mocks.cfg = { ...mocks.cfg, isLoaded: false };
    const a = render(<OrderSecondOrderInvite order={delivered} fallback={fallback} />);
    await flush();
    expect(a.container.innerHTML).toBe('');
    a.unmount();
    mocks.cfg = { ...mocks.cfg, isLoaded: true };
    mocks.getWasteMe.mockReturnValue(new Promise(() => undefined));
    const b = render(<OrderSecondOrderInvite order={delivered} fallback={fallback} />);
    await flush();
    expect(b.container.innerHTML).toBe('');
    b.unmount();
  });
});
