import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { buildOrderTimelineSteps } from '@tubutree/app-core/commerce/order-timeline';
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
});
