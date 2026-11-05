import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderActionPlan, orderHeadline, orderTrack, type TrackOrder } from '@tubutree/app-core/commerce/order-tracking';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), copyText: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { OrderActionBar } from './order-action-bar';
import { OrderShipping } from './order-shipping';
import { OrderStatusHero } from './order-status-hero';
import { OrderTrack } from './order-track';

const NOW = Date.parse('2026-11-05T05:00:00Z');
const order = (over: Partial<TrackOrder> = {}): TrackOrder => ({
  status: 'SHIPPING',
  createdAt: '2026-11-03T05:00:00Z',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  statusTimes: { CONFIRMED: '2026-11-03T06:00:00Z', PACKED: '2026-11-03T09:00:00Z', SHIPPING: '2026-11-04T02:00:00Z' },
  shippingHistory: [
    { at: '2026-11-04T02:00:00Z', status: 'Đã lấy hàng' },
    { at: '2026-11-05T01:00:00Z', status: 'Đang giao hàng' },
  ],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('OrderTrack', () => {
  it('một bước aria-current, giờ ngắn theo giờ Việt Nam, mốc hãng mới nhất trên cùng dưới bước Đang giao', () => {
    const track = orderTrack(order(), { etaLabel: '06/11 – 08/11' })!;
    render(<OrderTrack track={track} now={NOW} />);
    const list = screen.getByRole('list', { name: 'Hành trình đơn hàng' });
    const current = list.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Đang giao');
    expect(screen.getByText('13:00 03/11')).toBeInTheDocument();
    const events = within(screen.getByRole('list', { name: 'Mốc vận chuyển' })).getAllByRole('listitem');
    expect(events.map((e) => e.querySelector('div')?.textContent)).toEqual(['Đang giao hàng', 'Đã lấy hàng']);
    expect(events[0]!.getAttribute('data-latest')).toBe('true');
    expect(screen.getByText('Dự kiến giao 06/11 – 08/11')).toBeInTheDocument();
  });

  it('đã giao: mọi bước "đã xong", không bước nào "đang diễn ra" và không có aria-current', () => {
    const track = orderTrack(order({ status: 'DELIVERED', statusTimes: { CONFIRMED: '2026-11-03T06:00:00Z', PACKED: '2026-11-03T09:00:00Z', SHIPPING: '2026-11-04T02:00:00Z', DELIVERED: '2026-11-05T02:00:00Z' } }))!;
    render(<OrderTrack track={track} now={NOW} />);
    const list = screen.getByRole('list', { name: 'Hành trình đơn hàng' });
    expect(list.querySelectorAll('[aria-current]')).toHaveLength(0);
    expect(list.querySelectorAll('[data-state="done"]')).toHaveLength(4);
    expect(list.textContent).toContain('Giao thành công, đã xong');
    expect(list.textContent).not.toContain('đang diễn ra');
  });

  it('bước chưa tới không có giờ', () => {
    const track = orderTrack(order({ status: 'CONFIRMED', shippingHistory: [] }))!;
    render(<OrderTrack track={track} now={NOW} />);
    const upcoming = screen.getByRole('list').querySelectorAll('[data-state="upcoming"]');
    expect(upcoming.length).toBe(3);
    for (const li of Array.from(upcoming)) expect(li.textContent).not.toMatch(/\d\d:\d\d/);
  });
});

describe('OrderShipping', () => {
  it('không có hãng, mã, mốc nào thì không dựng gì', () => {
    const { container } = render(<OrderShipping />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hiện hãng và mã; "Chép mã" chép đúng mã và báo thành công, lỗi thì nhắc chép tay', async () => {
    mocks.copyText.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<OrderShipping partner="Giao Hàng Nhanh" code="GHN123" status="Đang giao hàng" />);
    expect(screen.getByText('Giao Hàng Nhanh')).toBeInTheDocument();
    expect(screen.getByText('GHN123')).toBeInTheDocument();
    expect(screen.getByText('Đang giao hàng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chép mã' }));
    expect(mocks.copyText).toHaveBeenCalledWith('GHN123');
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép mã vận đơn', type: 'success' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chép mã' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenLastCalledWith({ text: 'Không sao chép được — hãy chép mã thủ công.', type: 'error' }));
  });

  it('có mốc truyền riêng (đơn đã hoàn) thì liệt kê mới nhất trên cùng', () => {
    render(
      <OrderShipping
        events={[
          { label: 'Giao hàng thành công', at: '2026-11-04T02:00:00Z', latest: true },
          { label: 'Đã lấy hàng', at: '2026-11-03T02:00:00Z', latest: false },
        ]}
      />,
    );
    const items = within(screen.getByRole('list', { name: 'Mốc vận chuyển' })).getAllByRole('listitem');
    expect(items.map((i) => i.querySelector('div')?.textContent)).toEqual(['Giao hàng thành công', 'Đã lấy hàng']);
  });
});

describe('OrderStatusHero', () => {
  const tone = { bg: 'var(--color-status-info-bg)', fg: 'var(--color-status-info-fg)' };

  it('trạng thái, một câu, mốc và bước kế tiếp; không dựng dòng rỗng', () => {
    const headline = orderHeadline(order(), { now: NOW, etaLabel: '06/11 – 08/11', returnDays: 7 });
    render(<OrderStatusHero headline={headline} statusLabel="Đang giao" stamp={{ label: 'Đặt lúc', at: '2026-11-03T05:00:00Z' }} tone={tone} />);
    expect(screen.getByRole('heading', { name: 'Đang giao' })).toBeInTheDocument();
    expect(screen.getByText('Đơn đang trên đường giao đến bạn.')).toBeInTheDocument();
    expect(screen.getByTestId('order-milestone')).toHaveTextContent('Dự kiến giao 06/11 – 08/11');
    expect(screen.getByTestId('order-next')).toHaveTextContent('không huỷ được');
    expect(screen.getByText('12:00 03/11')).toBeInTheDocument();
  });

  it('đơn huỷ không có mốc', () => {
    const headline = orderHeadline(order({ status: 'CANCELLED' }), { now: NOW });
    render(<OrderStatusHero headline={headline} statusLabel="Đã huỷ" stamp={{ label: 'Huỷ lúc', at: '2026-11-03T05:00:00Z' }} tone={tone} />);
    expect(screen.queryByTestId('order-milestone')).toBeNull();
  });
});

describe('OrderActionBar', () => {
  it('nút chính gọi onAction; menu liệt kê nút phụ và đóng sau khi chọn', () => {
    const onAction = vi.fn();
    const plan = orderActionPlan(order({ status: 'DELIVERED', deliveredAt: '2026-11-04T05:00:00Z', items: [{ id: 'l1', productSlug: 'a' }] }), { now: NOW });
    render(<OrderActionBar plan={plan} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đánh giá sản phẩm' }));
    expect(onAction).toHaveBeenLastCalledWith('review');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu đổi/trả' }));
    expect(onAction).toHaveBeenLastCalledWith('return');
  });

  it('không có nút phụ thì không có nút "Thêm thao tác"; ghi chú hiện trên nút chính', () => {
    const plan = orderActionPlan(order(), { now: NOW });
    render(<OrderActionBar plan={plan} note="Còn 2 giờ để thanh toán" onAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Thêm thao tác' })).toBeNull();
    expect(screen.getByTestId('order-action-note')).toHaveTextContent('Còn 2 giờ để thanh toán');
  });
});
