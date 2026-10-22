// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { OrderCard } from './order-card';
import { canPayNow, orderUnitCount } from './order-rules';

// Mini App order-card.spec.tsx: ảnh SP đầu, số món, tổng, trạng thái, Mua lại, Thanh toán ngay + hạn.

const ORDER = {
  id: 'o1', code: 'TUBU1', status: 'DELIVERED', subtotal: 149000, discount: 0, shippingFee: 0, total: 149000, paymentMethod: 'COD',
  paymentStatus: 'PAID', createdAt: '2026-09-20T03:00:00Z',
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', variationName: 'Chanh', unitPrice: 50000, quantity: 2, total: 100000, thumbnail: 'https://img.test/a.jpg' },
    { id: 'i2', variationId: 'v2', productName: 'Xà phòng', variationName: '', unitPrice: 49000, quantity: 1, total: 49000, thumbnail: null },
  ],
} as never;

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('OrderCard', () => {
  it('ảnh SP đầu, tên + "+1", "3 món", ngày, tổng tiền, trạng thái', () => {
    const c = mount(<OrderCard order={ORDER} />);
    expect(c.querySelector('img')?.getAttribute('src')).toBe('https://img.test/a.jpg');
    expect(c.textContent).toContain('Nước rửa chén +1');
    expect(c.textContent).toContain('3 món · 20/09/2026');
    expect(c.textContent).toContain('149.000đ');
    expect(c.textContent).toContain('Giao thành công');
  });

  it('mã đơn là liên kết tới chi tiết đơn, có mô tả là tóm tắt (món, ngày, tổng)', () => {
    const c = mount(<OrderCard order={ORDER} />);
    const link = c.querySelector<HTMLAnchorElement>('a[href="/tai-khoan/don-hang/TUBU1"]')!;
    expect(link.textContent).toBe('TUBU1');
    expect(link.getAttribute('aria-label')).toBe('Đơn TUBU1');
    const desc = document.getElementById(link.getAttribute('aria-describedby')!)?.textContent ?? '';
    expect(desc).toMatch(/Nước rửa chén \+1.*3 món.*149\.000đ/);
  });

  it('"Mua lại" gọi onReorder (không điều hướng); chỉ ở đơn đã xong', () => {
    const onReorder = vi.fn();
    const c = mount(<OrderCard order={ORDER} onReorder={onReorder} />);
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Mua lại') ?? null);
    expect(onReorder).toHaveBeenCalledTimes(1);

    const shipping = mount(<OrderCard order={{ ...(ORDER as object), status: 'SHIPPING' } as never} onReorder={onReorder} />);
    expect(Array.from(shipping.querySelectorAll('button')).some((b) => b.textContent === 'Mua lại')).toBe(false);
  });

  it('không truyền onReorder → không có "Mua lại" dù đơn đã giao; không ảnh → icon thay thế', () => {
    const c = mount(<OrderCard order={{ ...(ORDER as object), items: [(ORDER as { items: unknown[] }).items[1]] } as never} />);
    expect(Array.from(c.querySelectorAll('button')).some((b) => b.textContent === 'Mua lại')).toBe(false);
    expect(c.querySelector('img')).toBeNull();
  });

  it('nút và liên kết đủ tên, vùng chạm >= 44px', () => {
    const c = mount(<OrderCard order={ORDER} onReorder={() => undefined} />);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });

  describe('đơn chờ thanh toán', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-21T08:00:00.000Z') }));
    const PENDING = {
      ...(ORDER as object), status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: '2026-09-21T10:30:00.000Z',
    } as never;
    const payLink = (c: HTMLElement) => Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Thanh toán ngay');

    it('chuyển khoản chờ tiền: "Thanh toán ngay" dẫn tới trang chuyển khoản của đơn, kèm hạn giờ VN', () => {
      const c = mount(<OrderCard order={PENDING} onReorder={() => undefined} />);
      expect(payLink(c)?.getAttribute('href')).toBe('/thanh-toan/chuyen-khoan/TUBU1');
      expect(c.textContent).toContain('Hạn 17:30 21/09/2026');
    });

    it('không có "Mua lại" ở đơn chờ thanh toán', () => {
      const c = mount(<OrderCard order={PENDING} onReorder={() => undefined} />);
      expect(Array.from(c.querySelectorAll('button')).some((b) => b.textContent === 'Mua lại')).toBe(false);
    });

    it('COD/Ví hoặc manualHandling → không có nút thanh toán và không in "Hạn"', () => {
      for (const over of [{ paymentMethod: 'COD' }, { paymentMethod: 'WALLET' }, { manualHandling: true }]) {
        const c = mount(<OrderCard order={{ ...(PENDING as object), ...over } as never} />);
        expect(payLink(c)).toBeUndefined();
        expect(c.textContent).not.toContain('Hạn ');
      }
    });

    it('quá hạn thanh toán: không còn nút và không in "Hạn" đã qua', () => {
      const c = mount(<OrderCard order={{ ...(PENDING as object), paymentDeadline: '2026-09-21T07:59:00.000Z' } as never} />);
      expect(payLink(c)).toBeUndefined();
      expect(c.textContent).not.toContain('Hạn ');
    });

    it('thiếu hạn thì chỉ có nút, không có chữ "Hạn"', () => {
      const c = mount(<OrderCard order={{ ...(PENDING as object), paymentDeadline: null } as never} />);
      expect(payLink(c)).toBeTruthy();
      expect(c.textContent).not.toContain('Hạn ');
    });
  });
});

describe('order-rules', () => {
  it('orderUnitCount cộng số lượng, không đếm số dòng', () => {
    expect(orderUnitCount([{ quantity: 2 }, { quantity: 1 }])).toBe(3);
  });

  it('canPayNow: chỉ chuyển khoản đang chờ, chưa xử lý tay, chưa quá hạn; hạn hỏng thì giữ như cũ', () => {
    const base = { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' };
    const now = Date.parse('2026-09-21T08:00:00Z');
    expect(canPayNow({ ...base }, now)).toBe(true);
    expect(canPayNow({ ...base, paymentDeadline: 'không phải ngày' }, now)).toBe(true);
    expect(canPayNow({ ...base, paymentDeadline: '2026-09-21T07:00:00Z' }, now)).toBe(false);
    expect(canPayNow({ ...base, manualHandling: true }, now)).toBe(false);
    expect(canPayNow({ ...base, status: 'CONFIRMED' }, now)).toBe(false);
  });
});
