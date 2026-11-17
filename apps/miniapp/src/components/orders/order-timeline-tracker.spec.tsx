import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { buildOrderJourney, buildOrderTimelineSteps } from '@tubutree/app-core/commerce/order-timeline';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../../utils/clipboard', () => ({ copyText: (t: string) => mocks.copyText(t) }));

import { OrderTimelineTracker } from './order-timeline-tracker';

const NOW = Date.parse('2026-10-05T05:00:00Z');
const STAMPS = {
  createdAt: '2026-10-01T01:00:00.000Z',
  confirmedAt: '2026-10-01T01:05:00.000Z',
  shippingAt: '2026-10-02T02:30:00.000Z',
  deliveredAt: '2026-10-03T03:00:00.000Z',
};

const items = () => screen.getAllByRole('listitem');

beforeEach(() => {
  mocks.copyText.mockReset();
  mocks.copyText.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('OrderTimelineTracker', () => {
  it('bốn bước đúng chữ, bước hiện tại có aria-current="step" và chữ đọc thêm', () => {
    render(<OrderTimelineTracker steps={buildOrderTimelineSteps('CONFIRMED', STAMPS)} now={NOW} />);
    const list = screen.getByRole('list', { name: 'Tiến trình đơn hàng' });
    expect(list).toBeInTheDocument();
    expect(items().map((li) => li.getAttribute('data-step'))).toEqual(['received', 'preparing', 'shipping', 'delivered']);
    const current = items().filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Đang chuẩn bị');
    expect(current[0]).toHaveTextContent('hiện tại');
    expect(items()[0]).toHaveTextContent('đã qua');
    expect(items()[3]).not.toHaveTextContent('đã qua');
  });

  it('giờ của bước đã tới dùng số đều (tabular-nums); bước chưa tới không có giờ', () => {
    render(<OrderTimelineTracker steps={buildOrderTimelineSteps('CONFIRMED', STAMPS)} now={NOW} />);
    const time = screen.getByText('08:05 01/10');
    expect(time).toHaveStyle({ fontVariantNumeric: 'tabular-nums' });
    expect(screen.queryByText(/02\/10/)).toBeNull();
    expect(screen.queryByText(/03\/10/)).toBeNull();
  });

  it('đơn huỷ rẽ nhánh: chỉ Đã tiếp nhận rồi Đã huỷ, không bước nào đang diễn ra', () => {
    render(<OrderTimelineTracker steps={buildOrderTimelineSteps('CANCELLED', { createdAt: STAMPS.createdAt, cancelledAt: '2026-10-01T02:00:00.000Z' })} now={NOW} />);
    expect(items().map((li) => li.getAttribute('data-state'))).toEqual(['completed', 'cancelled']);
    expect(items()[1]).toHaveTextContent('Đã huỷ');
    expect(items().some((li) => li.getAttribute('aria-current') === 'step')).toBe(false);
  });

  it('không có shareText thì không có nút sao chép', () => {
    render(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('chạm "Sao chép thông tin đơn": chép đúng đoạn tóm tắt, đổi nhãn "Đã sao chép", 2 giây sau trả nhãn cũ', async () => {
    vi.useFakeTimers();
    render(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} shareText={'Đơn hàng Tubu Tree X1\nTổng tiền: 10.000đ'} />);
    const button = screen.getByRole('button', { name: 'Sao chép thông tin đơn' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(mocks.copyText).toHaveBeenCalledWith('Đơn hàng Tubu Tree X1\nTổng tiền: 10.000đ');
    expect(screen.getByRole('button', { name: 'Đã sao chép' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByRole('button', { name: 'Đã sao chép' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByRole('button', { name: 'Sao chép thông tin đơn' })).toBeInTheDocument();
  });

  it('chép không được: giữ nhãn cũ và nói cách chép tay', async () => {
    mocks.copyText.mockResolvedValue(false);
    render(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} shareText="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sao chép thông tin đơn' }));
    });
    expect(screen.getByText('Không sao chép được, hãy chép thủ công.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đã sao chép' })).toBeNull();
  });

  it('vùng báo kết quả là aria-live nhưng không mang role="status" (trang đã có dòng báo kết quả riêng)', () => {
    const { container } = render(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} shareText="x" />);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

const shippingOrder = {
  status: 'SHIPPING',
  createdAt: STAMPS.createdAt,
  statusTimes: { CONFIRMED: STAMPS.confirmedAt, SHIPPING: STAMPS.shippingAt },
  shippingHistory: [
    { status: 'picked', at: '2026-10-02T03:00:00.000Z' },
    { status: 'transporting', at: '2026-10-02T06:00:00.000Z' },
    { status: 'sorting', at: '2026-10-02T09:00:00.000Z' },
    { status: 'delivering', at: '2026-10-03T01:00:00.000Z' },
  ],
  notices: [{ event: 'order.shipping', channel: 'ZALO', at: '2026-10-02T07:02:00.000Z' }],
};
const stepOf = (key: string) => items().find((li) => li.getAttribute('data-step') === key)!;

describe('OrderTimelineTracker layout="journey" (cờ orders.timeline_v2_enabled)', () => {
  it('danh sách dọc 4 bước; mốc hãng dưới "Đang giao hàng", mở sẵn 2 mốc mới nhất, nút "Xem đủ 4 mốc vận chuyển"', () => {
    const { container } = render(<OrderTimelineTracker steps={buildOrderJourney(shippingOrder, { now: NOW }).steps} layout="journey" now={NOW} />);
    expect(container.querySelector('ol.order-timeline--journey')).not.toBeNull();
    const shipping = stepOf('shipping');
    expect(shipping.getAttribute('aria-current')).toBe('step');
    expect(shipping.querySelectorAll('ul[aria-label="Mốc vận chuyển"] li')).toHaveLength(2);
    const toggle = screen.getByTestId('track-events-toggle');
    expect(toggle).toHaveTextContent('Xem đủ 4 mốc vận chuyển');
    fireEvent.click(toggle);
    expect(shipping.querySelectorAll('ul[aria-label="Mốc vận chuyển"] li')).toHaveLength(4);
  });

  it('dòng "Đã báo qua Zalo · 14:02" dưới bước đã báo; dự kiến giao ở bước hiện tại', () => {
    render(<OrderTimelineTracker steps={buildOrderJourney(shippingOrder, { now: NOW, etaLabel: '04/10 – 06/10' }).steps} layout="journey" now={NOW} />);
    expect(stepOf('shipping')).toHaveTextContent('Đã báo qua Zalo · 14:02');
    expect(stepOf('shipping')).toHaveTextContent('04/10 – 06/10');
    expect(stepOf('received')).not.toHaveTextContent('Đã báo qua');
  });

  it('hãng im quá số giờ cấu hình: dòng "Đang chờ hãng vận chuyển cập nhật"', () => {
    render(<OrderTimelineTracker steps={buildOrderJourney({ ...shippingOrder, trackingStaleHours: 24 }, { now: NOW }).steps} layout="journey" now={NOW} />);
    expect(stepOf('shipping')).toHaveTextContent('Đang chờ hãng vận chuyển cập nhật');
  });

  it('bản thanh ngang (cờ tắt) giữ đúng cấu trúc cũ: không có lớp journey hay khối body', () => {
    const { container } = render(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} />);
    expect(container.querySelector('.order-timeline--journey, .order-timeline__body')).toBeNull();
    expect(items()[0]!.children).toHaveLength(3);
  });
});

describe('thanh tiến trình: CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');

  it('nhấp nhô chỉ nằm trong media no-preference; giảm chuyển động thì viền sáng đứng yên', () => {
    const at = css.indexOf('animation: order-step-glow');
    expect(at).toBeGreaterThan(0);
    const before = css.slice(0, at);
    expect(before.lastIndexOf('@media (prefers-reduced-motion: no-preference)')).toBeGreaterThan(before.lastIndexOf('}\n}'));
    expect(css.match(/animation: order-step-glow/g)).toHaveLength(1);
    expect(css).toMatch(/\.order-timeline__step\[data-state='current'\] \.order-timeline__dot \{[^}]*box-shadow: 0 0 0 4px/);
  });

  it('bản dọc: vạch nối chạy từ đáy chấm xuống bước sau, bước cuối không có vạch', () => {
    expect(css).toMatch(/\.order-timeline--journey \{[^}]*flex-direction: column/);
    expect(css).toMatch(/\.order-timeline--journey \.order-timeline__step:last-child::before \{[^}]*display: none/);
  });
});
