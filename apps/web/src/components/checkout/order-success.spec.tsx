// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderDTO as ShopOrderDTO } from '@/lib/shop-client';

type OrderDTO = ShopOrderDTO & { pointsEarned?: number };
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Màn "Đặt hàng thành công" của web ở điện thoại = OrderSuccess của Mini App (cùng chữ, cùng điều kiện hiện từng dòng).

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const copyText = vi.hoisted(() => vi.fn());
vi.mock('@/lib/copy-text', () => ({ copyText }));

import { OrderSuccess } from './order-success';

const order = (over: Partial<OrderDTO> = {}): OrderDTO =>
  ({
    id: 'o1', code: 'TB-9', status: 'CONFIRMED', subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0,
    paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', createdAt: '2026-10-19T00:00:00Z', items: [], ...over,
  }) as OrderDTO;

let mounted: Rendered[] = [];
const mount = (o: OrderDTO, etaLabel: string | null = null) => {
  const r = render(<OrderSuccess order={o} etaLabel={etaLabel} />);
  mounted.push(r);
  return r.container.querySelector<HTMLElement>('[data-testid="order-success-mobile"]')!;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  copyText.mockReset();
  push.mockReset();
});

describe('OrderSuccess khổ điện thoại', () => {
  it('lời cảm ơn, mã đơn, tổng thanh toán và hai nút như Mini App', () => {
    const m = mount(order());
    expect(m.querySelector('h1')?.textContent).toBe('Cảm ơn bạn đã chọn Tubu');
    expect(m.textContent).toContain('Đơn hàng của bạn đã được ghi nhận');
    expect(m.textContent).toContain('Mã đơn hàng');
    expect(m.textContent).toContain('TB-9');
    expect(m.textContent).toContain('Tổng thanh toán');
    expect(m.textContent).toContain('130.000');
    click(byText(m, 'button', 'Theo dõi đơn'));
    expect(push).toHaveBeenLastCalledWith('/tai-khoan/don-hang/TB-9');
    click(byText(m, 'button', 'Tiếp tục mua sắm'));
    expect(push).toHaveBeenLastCalledWith('/');
  });

  it('3 bước tiếp theo', () => {
    const m = mount(order());
    for (const t of ['Tiếp theo', 'Xác nhận đơn', 'Đóng gói', 'Giao hàng']) expect(m.textContent).toContain(t);
  });

  it('COD: nhắc chuẩn bị tiền mặt; chuyển khoản thì không', () => {
    expect(mount(order({ paymentMethod: 'COD' })).textContent).toContain('Chuẩn bị tiền mặt khi nhận hàng');
    expect(mount(order()).textContent).not.toContain('Chuẩn bị tiền mặt');
  });

  it('Điểm Xanh sẽ nhận chỉ khi pointsEarned > 0', () => {
    expect(mount(order()).textContent).not.toContain('Điểm Xanh sẽ nhận');
    const m = mount(order({ pointsEarned: 1300 }));
    expect(m.textContent).toContain('Điểm Xanh sẽ nhận');
    expect(m.textContent).toContain('+1.300 điểm');
    expect(m.textContent).toContain('1.300 Điểm Xanh sẽ về tay khi đơn giao thành công');
  });

  it('Giao dự kiến chỉ khi có nhãn ngày', () => {
    expect(mount(order()).textContent).not.toContain('Giao dự kiến');
    const m = mount(order(), '02/10 – 04/10');
    expect(m.textContent).toContain('Giao dự kiến');
    expect(m.textContent).toContain('02/10 – 04/10');
  });

  it('đơn tách: đủ mã, tổng cả lần đặt, điểm cộng dồn, từng đơn dẫn tới chi tiết', () => {
    const m = mount(
      order({
        total: 100000, pointsEarned: 100,
        splitOrders: [
          { code: 'TB-1', total: 100000, fulfillerName: 'Tubu', pointsEarned: 100 },
          { code: 'TB-2', total: 50000, fulfillerName: 'Shop A', pointsEarned: 50 },
        ],
      } as unknown as Partial<OrderDTO>),
    );
    expect(m.textContent).toContain('Tổng 2 đơn');
    expect(m.textContent).toContain('150.000');
    expect(m.textContent).toContain('+150 điểm');
    expect(m.textContent).toContain('Hàng do 2 nơi giao nên được tách thành 2 đơn');
    expect(m.textContent).toContain('Mỗi đơn có mã, phí giao và lộ trình riêng.');
    const row = m.querySelector<HTMLElement>('button[aria-label="Xem đơn TB-2, Shop A giao, 50.000đ"]');
    expect(row).not.toBeNull();
    click(row);
    expect(push).toHaveBeenLastCalledWith('/tai-khoan/don-hang/TB-2');
  });

  it('sao chép mã: báo đã chép, hoặc báo mã để khách tự chép khi trình duyệt chặn', async () => {
    copyText.mockResolvedValueOnce(true);
    const m = mount(order());
    click(m.querySelector('button[aria-label="Sao chép mã đơn"]'));
    await flush();
    expect(copyText).toHaveBeenCalledWith('TB-9');
    expect(m.textContent).toContain('Đã sao chép mã đơn');
    copyText.mockResolvedValueOnce(false);
    click(m.querySelector('button[aria-label="Sao chép mã đơn"]'));
    await flush();
    expect(m.textContent).toContain('Không sao chép được — mã đơn: TB-9');
    expect(byText(m, 'button', 'Sao chép mã đơn')).toBeNull();
  });
});

describe('OrderSuccess từ md giữ màn máy tính, thêm các dòng thông tin', () => {
  it('tiêu đề cũ, nút cũ, kèm dòng tiền mặt, điểm và Giao dự kiến', () => {
    const r = render(<OrderSuccess order={order({ paymentMethod: 'COD', pointsEarned: 20 })} etaLabel="02/10" />);
    mounted.push(r);
    const d = r.container.querySelector<HTMLElement>('[data-testid="order-success-desktop"]')!;
    expect(d.querySelector('h2')?.textContent).toBe('Đặt hàng thành công!');
    expect(d.querySelector('a[href="/tai-khoan/don-hang/TB-9"]')?.textContent).toBe('Xem chi tiết đơn');
    expect(d.textContent).toContain('Chuẩn bị tiền mặt khi nhận hàng');
    expect(d.textContent).toContain('+20 điểm');
    expect(d.textContent).toContain('Giao dự kiến');
    expect(d.textContent).toContain('02/10');
  });
});
