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

  describe('mốc vận chuyển dài (W50B)', () => {
    const hops = [
      { at: '2026-11-04T02:00:00Z', status: 'Chờ lấy hàng' },
      { at: '2026-11-04T05:00:00Z', status: 'Đã lấy hàng' },
      { at: '2026-11-04T09:00:00Z', status: 'Nhập kho trung chuyển' },
      { at: '2026-11-05T01:00:00Z', status: 'Đang vận chuyển' },
      { at: '2026-11-05T03:00:00Z', status: 'Đang giao hàng' },
    ];
    const labels = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('ul[aria-label="Mốc vận chuyển"] > li')).map((li) => li.querySelector('div')?.textContent);
    const toggleOf = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('[data-testid="track-events-toggle"]');

    it('đúng 3 mốc hoặc ít hơn: hiện đủ, không có nút mở rộng', () => {
      for (const n of [1, 2, 3]) {
        const track = orderTrack(order({ shippingHistory: hops.slice(5 - n) }))!;
        const { container } = mount(<OrderTrack track={track} now={NOW} />);
        expect(labels(container)).toHaveLength(n);
        expect(toggleOf(container)).toBeNull();
      }
    });

    it('5 mốc: mặc định 3 mốc mới nhất, nút "Xem thêm 2 mốc vận chuyển" mở đủ 5 rồi thu về 3', () => {
      const track = orderTrack(order({ shippingHistory: hops }))!;
      const { container } = mount(<OrderTrack track={track} now={NOW} />);
      expect(labels(container)).toEqual(['Đang giao hàng', 'Đang vận chuyển', 'Nhập kho trung chuyển']);
      const toggle = toggleOf(container)!;
      expect(toggle.textContent).toBe('Xem thêm 2 mốc vận chuyển');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(container.querySelector('ul[aria-label="Mốc vận chuyển"]')!.id);
      expect(toggle.style.fontVariantNumeric).toBe('tabular-nums');
      click(toggle);
      expect(labels(container)).toEqual(['Đang giao hàng', 'Đang vận chuyển', 'Nhập kho trung chuyển', 'Đã lấy hàng', 'Chờ lấy hàng']);
      expect(toggleOf(container)!.textContent).toBe('Thu gọn mốc vận chuyển');
      expect(toggleOf(container)!.getAttribute('aria-expanded')).toBe('true');
      click(toggleOf(container));
      expect(labels(container)).toHaveLength(3);
      expect(toggleOf(container)!.textContent).toBe('Xem thêm 2 mốc vận chuyển');
      expect(toggleOf(container)!.getAttribute('aria-expanded')).toBe('false');
    });

    it('mốc mới nhất giữ data-latest khi thu gọn và mở; nút cao tối thiểu 44px và có tên', () => {
      const track = orderTrack(order({ shippingHistory: hops }))!;
      const { container } = mount(<OrderTrack track={track} now={NOW} />);
      const latest = () => Array.from(container.querySelectorAll('ul[aria-label="Mốc vận chuyển"] > li[data-latest="true"]')).map((li) => li.querySelector('div')?.textContent);
      expect(latest()).toEqual(['Đang giao hàng']);
      click(toggleOf(container));
      expect(latest()).toEqual(['Đang giao hàng']);
      expect(unnamedControls(container)).toEqual([]);
      expect(smallTouchTargets(container)).toEqual([]);
      expect(toggleOf(container)!.className).toContain('min-h-11');
    });
  });
});

describe('OrderShipping (web)', () => {
  const trail = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ label: `Mốc ${n - i}`, at: `2026-11-0${Math.min(9, n - i)}T02:00:00Z`, latest: i === 0 }));

  it('nút chép mã có tên truy cập nêu mã vận đơn, chữ hiện vẫn là "Chép mã"', () => {
    const { container } = mount(<OrderShipping code="GHN123" />);
    const button = byText(container, 'button', 'Chép mã')!;
    expect(button.getAttribute('aria-label')).toBe('Sao chép mã vận đơn GHN123');
  });

  it('mốc mới nhất có data-latest="true", các mốc còn lại không có', () => {
    const { container } = mount(<OrderShipping code="GHN123" events={trail(3)} />);
    const items = Array.from(container.querySelectorAll('ul[aria-label="Mốc vận chuyển"] > li'));
    expect(items.map((li) => li.getAttribute('data-latest'))).toEqual(['true', null, null]);
  });

  it('5 mốc: mặc định 3 mốc đầu, nút "Xem thêm 2 mốc vận chuyển" mở đủ 5 rồi thu về 3; 3 mốc thì không có nút', () => {
    const { container } = mount(<OrderShipping code="GHN123" events={trail(5)} />);
    const count = () => container.querySelectorAll('ul[aria-label="Mốc vận chuyển"] > li').length;
    const toggle = () => container.querySelector<HTMLButtonElement>('[data-testid="track-events-toggle"]');
    expect(count()).toBe(3);
    expect(toggle()!.textContent).toBe('Xem thêm 2 mốc vận chuyển');
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    click(toggle());
    expect(count()).toBe(5);
    expect(toggle()!.textContent).toBe('Thu gọn mốc vận chuyển');
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
    click(toggle());
    expect(count()).toBe(3);
    const short = mount(<OrderShipping code="GHN123" events={trail(3)} />);
    expect(short.container.querySelector('[data-testid="track-events-toggle"]')).toBeNull();
    expect(short.container.querySelectorAll('ul[aria-label="Mốc vận chuyển"] > li')).toHaveLength(3);
  });

  it('hiện hãng và mã; "Chép mã" chép đúng mã và báo thành công', async () => {
    const { container } = mount(<OrderShipping partner="Giao Hàng Nhanh" code="GHN123" status="Đang giao hàng" />);
    expect(container.textContent).toContain('Giao Hàng Nhanh');
    expect(container.textContent).toContain('GHN123');
    click(byText(container, 'button', 'Chép mã'));
    await act(async () => undefined);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('GHN123');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã sao chép mã vận đơn');
  });

  it('trình duyệt chặn clipboard thì nhắc chép tay, lời nhắc là role="alert" còn vùng báo thành công để trống', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('chặn')) } });
    const { container } = mount(<OrderShipping code="GHN123" />);
    click(byText(container, 'button', 'Chép mã'));
    await act(async () => undefined);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Không sao chép được — hãy chép mã thủ công.');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  describe('sao chép dùng chung copyText của web (có phương án hai như Mini App)', () => {
    const execCommand = vi.fn();
    beforeEach(() => {
      execCommand.mockReset().mockReturnValue(true);
      Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
    });
    afterEach(() => {
      delete (document as { execCommand?: unknown }).execCommand;
    });

    it('webview không có navigator.clipboard: rơi xuống execCommand("copy") và vẫn báo đã sao chép', async () => {
      vi.stubGlobal('navigator', {});
      const { container } = mount(<OrderShipping code="GHN123" />);
      click(byText(container, 'button', 'Chép mã'));
      await act(async () => undefined);
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã sao chép mã vận đơn');
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('clipboard từ chối và execCommand cũng không chép được: mới nhắc chép tay', async () => {
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('chặn')) } });
      execCommand.mockReturnValue(false);
      const { container } = mount(<OrderShipping code="GHN123" />);
      click(byText(container, 'button', 'Chép mã'));
      await act(async () => undefined);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('hãy chép mã thủ công');
      expect(container.querySelector('[role="status"]')?.textContent).toBe('');
    });
  });

  it('mỗi lần chạm đều có phản hồi mới: lời báo được dựng lại nên trình đọc màn hình đọc lại cả khi chữ không đổi', async () => {
    const { container } = mount(<OrderShipping code="GHN123" />);
    const tap = async () => {
      click(byText(container, 'button', 'Chép mã'));
      await act(async () => undefined);
    };
    await tap();
    const first = container.querySelector('[role="status"] > *');
    expect(first?.textContent).toBe('Đã sao chép mã vận đơn');
    await tap();
    const second = container.querySelector('[role="status"] > *');
    expect(second?.textContent).toBe('Đã sao chép mã vận đơn');
    expect(second).not.toBe(first);
    expect(first!.isConnected).toBe(false);
  });

  it('tông màu theo kết quả: thành công màu thành công, lỗi màu nguy hiểm', async () => {
    const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('chặn'));
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    const { container } = mount(<OrderShipping code="GHN123" />);
    click(byText(container, 'button', 'Chép mã'));
    await act(async () => undefined);
    expect((container.querySelector('[role="status"]')!.firstElementChild as HTMLElement).style.color).toBe('var(--color-text-success)');
    click(byText(container, 'button', 'Chép mã'));
    await act(async () => undefined);
    expect((container.querySelector('[role="alert"]')!.firstElementChild as HTMLElement).style.color).toBe('var(--color-text-danger)');
  });

  it('chép lỗi rồi chép được: lời nhắc chép tay biến mất; chép được rồi lỗi: lời "Đã sao chép" biến mất', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('chặn')).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('chặn'));
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    const { container } = mount(<OrderShipping code="GHN123" />);
    const tap = async () => {
      click(byText(container, 'button', 'Chép mã'));
      await act(async () => undefined);
    };
    await tap();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await tap();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã sao chép mã vận đơn');
    await tap();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('chép lỗi hai lần liền: lời nhắc cũng được dựng lại', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('chặn')) } });
    const { container } = mount(<OrderShipping code="GHN123" />);
    const tap = async () => {
      click(byText(container, 'button', 'Chép mã'));
      await act(async () => undefined);
    };
    await tap();
    const first = container.querySelector('[role="alert"]');
    await tap();
    const second = container.querySelector('[role="alert"]');
    expect(second?.textContent).toContain('hãy chép mã thủ công');
    expect(second).not.toBe(first);
  });

  it('vùng báo kết quả chép có sẵn từ đầu (rỗng) và chỉ đổi chữ, để trình đọc màn hình đọc được', async () => {
    const { container } = mount(<OrderShipping code="GHN123" />);
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe('');
    click(byText(container, 'button', 'Chép mã'));
    await act(async () => undefined);
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region!.textContent).toBe('Đã sao chép mã vận đơn');
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

  it('đơn huỷ có lý do từ API: một dòng riêng ngay dưới câu "Đơn đã huỷ.", trước bước kế tiếp; không có lý do thì không dựng dòng', () => {
    const head = (cancelReason?: string | null) => orderHeadline(order({ status: 'CANCELLED', cancelReason }), { now: NOW });
    const props = { statusLabel: 'Đã huỷ', stamp: { label: 'Huỷ lúc', at: '2026-11-03T05:00:00Z' }, tone };
    const withReason = mount(<OrderStatusHero headline={head('Tubu Tree đã huỷ đơn này. Cần biết thêm, bạn liên hệ CSKH.')} {...props} />);
    const reason = withReason.container.querySelector('[data-testid="order-cancel-reason"]')!;
    expect(reason.textContent).toBe('Tubu Tree đã huỷ đơn này. Cần biết thêm, bạn liên hệ CSKH.');
    expect(reason.previousElementSibling?.textContent).toBe('Đơn đã huỷ.');
    expect(reason.nextElementSibling).toBe(withReason.container.querySelector('[data-testid="order-next"]'));
    const without = mount(<OrderStatusHero headline={head(null)} {...props} />);
    expect(without.container.querySelector('[data-testid="order-cancel-reason"]')).toBeNull();
  });

  it('lý do huỷ là chuỗi dài không dấu cách (link, số tài khoản): được ngắt dòng, không bị body overflow-x: clip cắt mất cuối', () => {
    const props = { statusLabel: 'Đã huỷ', stamp: { label: 'Huỷ lúc', at: '2026-11-03T05:00:00Z' }, tone };
    const long = `Bạn đã huỷ: Lý do khác. https://example.com/${'a'.repeat(80)}`;
    const { container } = mount(<OrderStatusHero headline={orderHeadline(order({ status: 'CANCELLED', cancelReason: long }), { now: NOW })} {...props} />);
    expect(container.querySelector<HTMLElement>('[data-testid="order-cancel-reason"]')!.style.overflowWrap).toBe('anywhere');
    expect(container.querySelector<HTMLElement>('[data-testid="order-next"]')!.style.overflowWrap).toBe('anywhere');
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
