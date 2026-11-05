// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orderActionPlan, orderHeadline, orderTrack, type TrackOrder } from '@tubutree/app-core/commerce/order-tracking';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
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

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('OrderTrack (web)', () => {
  it('một bước aria-current, giờ ngắn theo giờ Việt Nam, mốc hãng mới nhất trên cùng dưới bước Đang giao', () => {
    const track = orderTrack(order(), { etaLabel: '06/11 – 08/11' })!;
    const { container } = mount(<OrderTrack track={track} now={NOW} />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Đang giao');
    expect(container.textContent).toContain('13:00 03/11');
    const events = Array.from(container.querySelectorAll('ul[aria-label="Mốc vận chuyển"] > li')).map((li) => li.querySelector('div')?.textContent);
    expect(events).toEqual(['Đang giao hàng', 'Đã lấy hàng']);
    expect(container.textContent).toContain('Dự kiến giao 06/11 – 08/11');
  });

  it('đã giao: mọi bước "đã xong", không bước nào "đang diễn ra" và không có aria-current', () => {
    const track = orderTrack(order({ status: 'DELIVERED', statusTimes: { CONFIRMED: '2026-11-03T06:00:00Z', PACKED: '2026-11-03T09:00:00Z', SHIPPING: '2026-11-04T02:00:00Z', DELIVERED: '2026-11-05T02:00:00Z' } }))!;
    const { container } = mount(<OrderTrack track={track} now={NOW} />);
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-state="done"]')).toHaveLength(4);
    expect(container.textContent).toContain('Giao thành công, đã xong');
    expect(container.textContent).not.toContain('đang diễn ra');
  });
});

describe('OrderShipping (web)', () => {
  it('hiện hãng và mã; "Chép mã" chép đúng mã và báo thành công', async () => {
    const { container } = mount(<OrderShipping partner="Giao Hàng Nhanh" code="GHN123" status="Đang giao hàng" />);
    expect(container.textContent).toContain('Giao Hàng Nhanh');
    expect(container.textContent).toContain('GHN123');
    click(byText(container, 'button', 'Chép mã'));
    await act(async () => undefined);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('GHN123');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã sao chép mã vận đơn');
  });

  it('trình duyệt chặn clipboard thì nhắc chép tay', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('chặn')) } });
    const { container } = mount(<OrderShipping code="GHN123" />);
    click(byText(container, 'button', 'Chép mã'));
    await act(async () => undefined);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('hãy chép mã thủ công');
  });

  it('liên kết tra cứu mở tab mới; không có gì để hiện thì không dựng', () => {
    const { container } = mount(<OrderShipping code="GHN123" trackingHref="https://hang.example/GHN123" />);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    const empty = mount(<OrderShipping />);
    expect(empty.container.innerHTML).toBe('');
  });

  it('vùng chạm 44px và mọi điều khiển có tên', () => {
    const { container } = mount(<OrderShipping partner="GHN" code="GHN123" trackingHref="https://hang.example/x" />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});

describe('OrderStatusHero (web)', () => {
  const tone = { bg: 'var(--color-status-info-bg)', fg: 'var(--color-status-info-fg)' };

  it('trạng thái, một câu, mốc và bước kế tiếp', () => {
    const headline = orderHeadline(order(), { now: NOW, etaLabel: '06/11 – 08/11', returnDays: 7 });
    const { container } = mount(<OrderStatusHero headline={headline} statusLabel="Đang giao" stamp={{ label: 'Đặt lúc', at: '2026-11-03T05:00:00Z' }} tone={tone} />);
    expect(container.querySelector('h2')?.textContent).toBe('Đang giao');
    expect(container.textContent).toContain('Đơn đang trên đường giao đến bạn.');
    expect(container.querySelector('[data-testid="order-milestone"]')?.textContent).toBe('Dự kiến giao 06/11 – 08/11');
    expect(container.querySelector('[data-testid="order-next"]')?.textContent).toContain('không huỷ được');
  });
});

describe('OrderActionBar (web)', () => {
  it('nút chính gọi onAction; menu liệt kê nút phụ', () => {
    const onAction = vi.fn();
    const plan = orderActionPlan(order({ status: 'DELIVERED', deliveredAt: '2026-11-04T05:00:00Z', items: [{ id: 'l1', productSlug: 'a' }] }), { now: NOW });
    const { container } = mount(<OrderActionBar plan={plan} onAction={onAction} />);
    click(byText(container, 'button', 'Đánh giá sản phẩm'));
    expect(onAction).toHaveBeenLastCalledWith('review');
    click(container.querySelector('button[aria-label="Thêm thao tác"]'));
    const rows = Array.from(document.body.querySelectorAll('[role="group"] [role="button"]'));
    expect(rows.map((r) => r.textContent?.trim())).toEqual(['Mua lại đơn này', 'Yêu cầu đổi/trả', 'Liên hệ Tubu']);
    click(rows[1] ?? null);
    expect(onAction).toHaveBeenLastCalledWith('return');
  });

  it('busy khoá nút chính; không có nút phụ thì không có nút "Thêm thao tác"; ghi chú hiện trên nút chính', () => {
    const onAction = vi.fn();
    const plan = orderActionPlan(order(), { now: NOW });
    const { container } = mount(<OrderActionBar plan={plan} busy note="Còn 2 giờ để thanh toán" onAction={onAction} />);
    expect(container.querySelector('button[aria-label="Thêm thao tác"]')).toBeNull();
    expect((byText(container, 'button', 'Liên hệ Tubu') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-testid="order-action-note"]')?.textContent).toBe('Còn 2 giờ để thanh toán');
  });

  it('đủ vùng chạm 44px, có tên, nằm dưới md dính đáy (lớp fixed) và trong luồng từ md', () => {
    const plan = orderActionPlan(order({ status: 'DELIVERED', deliveredAt: '2026-11-04T05:00:00Z' }), { now: NOW });
    const { container } = mount(<OrderActionBar plan={plan} onAction={vi.fn()} />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
    const bar = container.querySelector('[data-testid="order-action-bar"]')!;
    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('md:static');
  });
});
