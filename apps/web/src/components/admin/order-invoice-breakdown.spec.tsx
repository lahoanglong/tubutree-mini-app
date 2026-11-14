// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { OrderInvoiceBreakdown } from './order-detail-extras';
import { render, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-700',
  type: 'DEALER',
  status: 'CONFIRMED',
  total: 80_000,
  paymentMethod: 'BANK_TRANSFER',
  createdAt: '2026-11-10T00:00:00.000Z',
  ...over,
});

const rowText = (root: ParentNode, key: string) => root.querySelector(`[data-invoice-row="${key}"]`)?.textContent ?? null;

describe('OrderInvoiceBreakdown: chiết khấu thương mại ghi thẳng trên hoá đơn', () => {
  it('hàng 100.000đ, CK thương mại 20.000đ → dòng hàng nguyên giá, dòng giảm riêng, tổng hoá đơn 80.000đ', () => {
    const { container } = mount(<OrderInvoiceBreakdown order={order({ subtotal: 100_000, discount: 20_000, total: 80_000 })} />);
    expect(rowText(container, 'goods')).toBe('Tổng tiền hàng100.000đ');
    expect(rowText(container, 'trade')).toContain('-20.000đ');
    expect(rowText(container, 'total')).toBe('Tổng cộng hoá đơn80.000đ');
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('Hoá đơn bán hàng');
  });

  it('không có chiết khấu → dòng CK thương mại 0đ, tổng hoá đơn bằng tiền hàng', () => {
    const { container } = mount(<OrderInvoiceBreakdown order={order({ subtotal: 100_000, discount: 0, total: 100_000 })} />);
    expect(rowText(container, 'trade')).not.toContain('-');
    expect(rowText(container, 'total')).toBe('Tổng cộng hoá đơn100.000đ');
  });

  it('phí giao hàng cộng vào tổng; không có phí thì không hiện dòng', () => {
    const withShip = mount(<OrderInvoiceBreakdown order={order({ subtotal: 100_000, discount: 20_000, shippingFee: 30_000, total: 110_000 })} />);
    expect(rowText(withShip.container, 'ship')).toContain('30.000đ');
    expect(rowText(withShip.container, 'total')).toBe('Tổng cộng hoá đơn110.000đ');
    const noShip = mount(<OrderInvoiceBreakdown order={order({ subtotal: 100_000, discount: 20_000, total: 80_000 })} />);
    expect(rowText(noShip.container, 'ship')).toBeNull();
  });

  it('Điểm Xanh hiện thành dòng riêng, không bị gộp vào CK thương mại', () => {
    const { container } = mount(
      <OrderInvoiceBreakdown order={order({ type: 'RETAIL', subtotal: 100_000, discount: 25_000, couponDiscount: 10_000, pointsDiscount: 5_000, tierDiscount: 10_000, total: 75_000 })} />,
    );
    expect(rowText(container, 'trade')).toContain('-20.000đ');
    expect(rowText(container, 'points')).toContain('-5.000đ');
    expect(rowText(container, 'total')).toBe('Tổng cộng hoá đơn75.000đ');
  });

  it('đơn lẻ CŨ (bốn cột giảm đều 0) có dùng Điểm Xanh: tiền điểm hiện dòng riêng, CK thương mại chỉ còn phần voucher', () => {
    const { container } = mount(
      <OrderInvoiceBreakdown order={order({ type: 'RETAIL', subtotal: 100_000, discount: 30_000, pointsUsed: 10_000, total: 70_000 })} />,
    );
    expect(rowText(container, 'trade')).toContain('-20.000đ');
    expect(rowText(container, 'points')).toContain('-10.000đ');
    expect(rowText(container, 'total')).toBe('Tổng cộng hoá đơn70.000đ');
  });

  it('đơn lẻ CŨ chỉ có voucher (không dùng điểm): không có dòng Điểm Xanh, CK thương mại giữ trọn tổng giảm', () => {
    const { container } = mount(<OrderInvoiceBreakdown order={order({ type: 'RETAIL', subtotal: 100_000, discount: 30_000, pointsUsed: 0, total: 70_000 })} />);
    expect(rowText(container, 'trade')).toContain('-30.000đ');
    expect(rowText(container, 'points')).toBeNull();
  });

  it('chiết khấu thanh toán không bao giờ là dòng của hoá đơn; chú thích chỉ sang khối Công nợ đại lý', () => {
    const { container } = mount(<OrderInvoiceBreakdown order={order({ subtotal: 100_000, discount: 20_000 })} />);
    const labels = Array.from(container.querySelectorAll('dt')).map((d) => d.textContent);
    expect(labels).not.toContain('Chiết khấu thanh toán');
    expect(container.textContent).toContain('Chiết khấu thanh toán');
    expect(container.textContent).toContain('không giảm hoá đơn');
    expect(container.textContent).toContain('Công nợ đại lý');
  });

  it('API cũ không trả subtotal → không dựng hoá đơn, không hiện số sai', () => {
    const { container } = mount(<OrderInvoiceBreakdown order={order({ discount: 20_000 })} />);
    expect(container.textContent).toBe('');
  });

  it('dl hợp lệ cho axe: con trực tiếp chỉ là div gói dt/dd', () => {
    const { container } = mount(<OrderInvoiceBreakdown order={order({ subtotal: 100_000, discount: 20_000, shippingFee: 15_000 })} />);
    for (const dl of Array.from(container.querySelectorAll('dl'))) {
      for (const c of Array.from(dl.children)) {
        expect(c.tagName).toBe('DIV');
        expect(Array.from(c.children).every((k) => k.tagName === 'DT' || k.tagName === 'DD')).toBe(true);
      }
    }
  });
});
