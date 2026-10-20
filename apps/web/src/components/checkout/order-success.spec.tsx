// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderDTO as ShopOrderDTO } from '@/lib/shop-client';

type OrderDTO = ShopOrderDTO & { pointsEarned?: number };
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Màn "Đặt hàng thành công" của web ở điện thoại = OrderSuccess của Mini App (cùng chữ, cùng điều kiện hiện từng dòng).

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client-api')>()), apiFetch }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.12, isLoaded: true }) }));
vi.mock('@/app/san-pham/[slug]/subscribe-sheet', () => ({
  SubscribeSheet: (p: { visible: boolean; variationId: string; quantity: number }) =>
    p.visible ? <div data-testid="sub-sheet" data-variation={p.variationId} data-qty={p.quantity} /> : null,
}));
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
const mount = (o: OrderDTO, etaLabel: string | null = null, continueHref = '/') => {
  const r = render(<OrderSuccess order={o} etaLabel={etaLabel} continueHref={continueHref} />);
  mounted.push(r);
  return r.container.querySelector<HTMLElement>('[data-testid="order-success-mobile"]')!;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  copyText.mockReset();
  push.mockReset();
  replace.mockReset();
  apiFetch.mockReset();
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
    expect(replace).toHaveBeenLastCalledWith('/tai-khoan/don-hang/TB-9');
    click(byText(m, 'button', 'Tiếp tục mua sắm'));
    expect(replace).toHaveBeenLastCalledWith('/');
    expect(push).not.toHaveBeenCalled();
  });

  it('Tiếp tục mua sắm về đúng gian hàng khách đã vào (CTV, nhãn hàng) hoặc trang chủ', () => {
    click(byText(mount(order(), null, '/s/abc'), 'button', 'Tiếp tục mua sắm'));
    expect(replace).toHaveBeenLastCalledWith('/s/abc');
    click(byText(mount(order(), null, '/brand/xyz'), 'button', 'Tiếp tục mua sắm'));
    expect(replace).toHaveBeenLastCalledWith('/brand/xyz');
  });

  it('khối mobile chỉ ẩn bằng class md:hidden, không có display inline đè lên', () => {
    const m = mount(order());
    expect(m.className).toContain('md:hidden');
    expect(m.style.display).toBe('');
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
    expect(replace).toHaveBeenLastCalledWith('/tai-khoan/don-hang/TB-2');
  });

  it('đơn tách thiếu pointsEarned ở một đơn thì dùng điểm của cả lần đặt, không cộng thiếu', () => {
    const m = mount(
      order({
        pointsEarned: 100,
        splitOrders: [
          { code: 'TB-1', total: 100000, fulfillerName: 'Tubu', pointsEarned: 100 },
          { code: 'TB-2', total: 50000, fulfillerName: 'Shop A' },
        ],
      } as unknown as Partial<OrderDTO>),
    );
    expect(m.textContent).toContain('+100 điểm');
    expect(m.textContent).not.toContain('+150 điểm');
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
  const desktop = (o: OrderDTO, etaLabel: string | null = null) => {
    const r = render(<OrderSuccess order={o} etaLabel={etaLabel} continueHref="/" />);
    mounted.push(r);
    return r.container.querySelector<HTMLElement>('[data-testid="order-success-desktop"]')!;
  };

  it('chữ giống Mini App, kèm dòng tiền mặt, điểm và Giao dự kiến', () => {
    const d = desktop(order({ paymentMethod: 'COD', pointsEarned: 20 }), '02/10');
    expect(d.querySelector('h2')?.textContent).toBe('Cảm ơn bạn đã chọn Tubu');
    expect(d.textContent).toContain('Đơn hàng của bạn đã được ghi nhận');
    expect(d.textContent).toContain('Mã đơn hàng');
    expect(d.textContent).toContain('Tổng thanh toán');
    expect(d.querySelector('a[href="/tai-khoan/don-hang/TB-9"]')?.textContent).toBe('Theo dõi đơn');
    expect(d.textContent).toContain('Chuẩn bị tiền mặt khi nhận hàng');
    expect(d.textContent).toContain('+20 điểm');
    expect(d.textContent).toContain('Giao dự kiến');
    expect(d.textContent).toContain('02/10');
  });

  it('đơn tách dùng chữ Mini App', () => {
    const d = desktop(
      order({ splitOrders: [{ code: 'TB-1', total: 1, fulfillerName: 'Tubu' }, { code: 'TB-2', total: 2, fulfillerName: 'A' }] } as unknown as Partial<OrderDTO>),
    );
    expect(d.textContent).toContain('Hàng do 2 nơi giao nên được tách thành 2 đơn');
    expect(d.textContent).toContain('Mỗi đơn có mã, phí giao và lộ trình riêng.');
  });

  it('Tiếp tục mua sắm theo gian hàng', () => {
    const r = render(<OrderSuccess order={order()} etaLabel={null} continueHref="/s/abc" />);
    mounted.push(r);
    const d = r.container.querySelector<HTMLElement>('[data-testid="order-success-desktop"]')!;
    expect(byText(d, 'a', 'Tiếp tục mua sắm')?.getAttribute('href')).toBe('/s/abc');
  });
});

describe('OrderSuccess gợi ý Đặt định kỳ', () => {
  const withItems = (items: unknown[]) => order({ items } as unknown as Partial<OrderDTO>);
  const item = (slug: string, variationId = 'v1') => ({ productSlug: slug, variationId, quantity: 2, productName: `SP ${slug}` });
  const product = (over: Record<string, unknown> = {}) => ({ variations: [{ id: 'v1', stock: 5 }], ...over });

  it('món còn hàng, không phải hàng đối tác: hiện thẻ với đúng phần trăm và mở sheet đúng biến thể', async () => {
    apiFetch.mockResolvedValue(product());
    const m = mount(withItems([item('a')]));
    await flush();
    expect(m.textContent).toContain('Đặt định kỳ SP a');
    expect(m.textContent).toContain('Tự động giao lại theo chu kỳ, tiết kiệm 12% mỗi đơn.');
    click(byText(m, 'button', 'Đặt định kỳ'));
    const sheet = document.querySelector('[data-testid="sub-sheet"]');
    expect(sheet?.getAttribute('data-variation')).toBe('v1');
    expect(sheet?.getAttribute('data-qty')).toBe('2');
  });

  it('hàng chỉ bán lẻ thì ẩn', async () => {
    apiFetch.mockResolvedValue(product({ partnerOwned: true }));
    const m = mount(withItems([item('a')]));
    await flush();
    expect(m.textContent).not.toContain('Đặt định kỳ');
  });

  it('biến thể hết hàng thì ẩn', async () => {
    apiFetch.mockResolvedValue(product({ variations: [{ id: 'v1', stock: 0 }] }));
    const m = mount(withItems([item('a')]));
    await flush();
    expect(m.textContent).not.toContain('Đặt định kỳ');
  });
});
