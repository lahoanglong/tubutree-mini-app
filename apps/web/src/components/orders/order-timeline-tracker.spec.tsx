// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrderTimelineSteps } from '@tubutree/app-core/commerce/order-timeline';
import { byText, click, flush } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { mount } from '@/components/mini/harness';

const mocks = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('@/lib/copy-text', () => ({ copyText: (t: string) => mocks.copyText(t) }));

import { OrderTimelineTracker } from './order-timeline-tracker';

const NOW = Date.parse('2026-10-05T05:00:00Z');
const STAMPS = {
  createdAt: '2026-10-01T01:00:00.000Z',
  confirmedAt: '2026-10-01T01:05:00.000Z',
  shippingAt: '2026-10-02T02:30:00.000Z',
  deliveredAt: '2026-10-03T03:00:00.000Z',
};

const steps = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('li[data-step]'));

beforeEach(() => {
  mocks.copyText.mockReset();
  mocks.copyText.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('OrderTimelineTracker (web)', () => {
  it('bốn bước đúng chữ, bước hiện tại có aria-current="step" và chữ đọc thêm', () => {
    const { container } = mount(<OrderTimelineTracker steps={buildOrderTimelineSteps('CONFIRMED', STAMPS)} now={NOW} />);
    expect(container.querySelector('ol[aria-label="Tiến trình đơn hàng"]')).not.toBeNull();
    expect(steps(container).map((li) => li.dataset.step)).toEqual(['received', 'preparing', 'shipping', 'delivered']);
    const current = steps(container).filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Đang chuẩn bị');
    expect(current[0]!.textContent).toContain('hiện tại');
    expect(steps(container)[0]!.textContent).toContain('đã qua');
    expect(steps(container)[3]!.textContent).not.toContain('đã qua');
  });

  it('giờ của bước đã tới dùng số đều (tabular-nums); bước chưa tới không có giờ', () => {
    const { container } = mount(<OrderTimelineTracker steps={buildOrderTimelineSteps('CONFIRMED', STAMPS)} now={NOW} />);
    const time = byText(container, 'span', '08:05 01/10');
    expect(time).not.toBeNull();
    expect(time!.style.fontVariantNumeric).toBe('tabular-nums');
    expect(container.textContent).not.toMatch(/02\/10/);
    expect(container.textContent).not.toMatch(/03\/10/);
  });

  it('đơn huỷ rẽ nhánh: chỉ Đã tiếp nhận rồi Đã huỷ, không bước nào đang diễn ra', () => {
    const { container } = mount(
      <OrderTimelineTracker steps={buildOrderTimelineSteps('CANCELLED', { createdAt: STAMPS.createdAt, cancelledAt: '2026-10-01T02:00:00.000Z' })} now={NOW} />,
    );
    expect(steps(container).map((li) => li.dataset.state)).toEqual(['completed', 'cancelled']);
    expect(steps(container)[1]!.textContent).toContain('Đã huỷ');
    expect(steps(container).some((li) => li.getAttribute('aria-current') === 'step')).toBe(false);
  });

  it('không có shareText thì không có nút sao chép', () => {
    const { container } = mount(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('chạm "Sao chép thông tin đơn": chép đúng đoạn tóm tắt, đổi nhãn "Đã sao chép", 2 giây sau trả nhãn cũ', async () => {
    vi.useFakeTimers();
    const { container } = mount(
      <OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} shareText={'Đơn hàng Tubu Tree X1\nTổng tiền: 10.000đ'} />,
    );
    const label = () => container.querySelector('button')?.textContent;
    expect(label()).toBe('Sao chép thông tin đơn');
    await act(async () => {
      click(container.querySelector('button'));
    });
    expect(mocks.copyText).toHaveBeenCalledWith('Đơn hàng Tubu Tree X1\nTổng tiền: 10.000đ');
    expect(label()).toBe('Đã sao chép');
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(label()).toBe('Đã sao chép');
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(label()).toBe('Sao chép thông tin đơn');
  });

  it('chép không được: giữ nhãn cũ và nói cách chép tay', async () => {
    mocks.copyText.mockResolvedValue(false);
    const { container } = mount(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} shareText="x" />);
    click(container.querySelector('button'));
    await flush();
    expect(container.textContent).toContain('Không sao chép được, hãy chép thủ công.');
    expect(container.querySelector('button')?.textContent).toBe('Sao chép thông tin đơn');
  });

  it('vùng báo kết quả là aria-live nhưng không mang role="status"', () => {
    const { container } = mount(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} shareText="x" />);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('nút có tên và đủ vùng chạm 44px', () => {
    const { container } = mount(<OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING', STAMPS)} now={NOW} shareText="x" />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});

describe('thanh tiến trình web: CSS', () => {
  const css = readFileSync(resolve(__dirname, '../mini/mini.css'), 'utf8');

  it('nhấp nhô chỉ nằm trong media no-preference; giảm chuyển động thì viền sáng đứng yên', () => {
    const at = css.indexOf('animation: order-step-glow');
    expect(at).toBeGreaterThan(0);
    const before = css.slice(0, at);
    expect(before.lastIndexOf('@media (prefers-reduced-motion: no-preference)')).toBeGreaterThan(before.lastIndexOf('}\n}'));
    expect(css.match(/animation: order-step-glow/g)).toHaveLength(1);
    expect(css).toMatch(/\.order-timeline__step\[data-state='current'\] \.order-timeline__dot \{[^}]*box-shadow: 0 0 0 4px/);
  });
});
