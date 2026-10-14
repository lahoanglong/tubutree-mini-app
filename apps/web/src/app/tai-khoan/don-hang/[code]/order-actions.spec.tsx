// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// BUYERWEB-13: chi tiết đơn trên web chỉ có dòng gọi hotline — không timeline/hành trình, không hủy, đổi trả, mua lại
// dù API đã có sẵn (Mini App có đủ).

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as Record<string, unknown> | null,
  order: null as Record<string, unknown> | null,
  push: vi.fn(),
  cancel: vi.fn(),
  repurchase: vi.fn(),
  requestReturn: vi.fn(),
  returns: [] as unknown[],
  returnsError: false,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: mocks.user, status: 'authenticated', initialized: true }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'TB-9' }),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0899 149 229', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => mocks.order,
  cancelOrder: mocks.cancel,
  repurchaseOrder: mocks.repurchase,
  requestReturn: mocks.requestReturn,
  fetchMyReturns: async () => {
    if (mocks.returnsError) throw new Error('boom');
    return mocks.returns;
  },
  getBankQr: async () => ({
    orderCode: 'TB-9', amount: 1, paymentStatus: 'UNPAID',
    bank: { bin: '1', name: 'B', accountNo: '1', accountName: 'A' }, memo: 'TB-9', qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
  }),
}));

import OrderDetailPage from './page';

const BASE = {
  id: 'o9', code: 'TB-9', status: 'CONFIRMED', subtotal: 300000, discount: 0, shippingFee: 0, total: 300000,
  paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-10-01T03:00:00Z', deliveredAt: null,
  items: [{ productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null }],
  shippingAddress: null, shippingPartner: null, shippingCode: null, trackingLink: null, shippingHistory: null,
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const btn = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  mocks.user = { id: 'u1' };
  mocks.order = { ...BASE };
  mocks.push.mockReset();
  mocks.cancel.mockReset().mockResolvedValue({ ...BASE, status: 'CANCELLED' });
  mocks.repurchase.mockReset();
  mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
  mocks.returns = [];
  mocks.returnsError = false;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('chi tiết đơn — hành trình đơn (BUYERWEB-13)', () => {
  it('hiện 5 bước, bước hiện tại có aria-current="step"', async () => {
    mocks.order = { ...BASE, status: 'PACKED' };
    const { container } = await mount();
    const steps = Array.from(container.querySelectorAll('ol[class=""] li, section[aria-labelledby="order-timeline-title"] li'));
    expect(steps.map((s) => s.textContent?.replace(/ — (đã qua|hiện tại)/, ''))).toEqual([
      'Đã đặt hàng', 'Đã xác nhận', 'Đang đóng gói', 'Đang giao', 'Đã giao',
    ]);
    expect(steps.map((s) => s.getAttribute('aria-current'))).toEqual([null, null, 'step', null, null]);
  });

  it('đơn đã hủy/hoàn: không dựng hành trình', async () => {
    mocks.order = { ...BASE, status: 'CANCELLED' };
    const { container } = await mount();
    expect(container.querySelector('#order-timeline-title')).toBeNull();
  });

  it('hành trình vận chuyển: mới nhất trước, nhãn tiếng Việt, kèm giờ giờ VN, mã lạ không in thô', async () => {
    mocks.order = {
      ...BASE, status: 'SHIPPING', shippingPartner: 'BestExpress', shippingCode: 'BE1',
      shippingHistory: [
        { at: '2026-10-01T03:00:00Z', status: 'created', code: 'BE1' },
        { at: '2026-10-02T03:00:00Z', status: 'delivering', code: 'BE1' },
        { at: '2026-10-02T05:00:00Z', status: 'WEIRD_42', code: 'BE1' },
      ],
    };
    const { container } = await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Hành trình vận chuyển');
    expect(text.indexOf('Đang cập nhật')).toBeLessThan(text.indexOf('Đang giao hàng'));
    expect(text.indexOf('Đang giao hàng')).toBeLessThan(text.indexOf('Đã tạo vận đơn'));
    expect(text).toContain('10:00 01/10/2026');
    expect(text).not.toContain('WEIRD_42');
  });
});

describe('chi tiết đơn — hủy đơn (BUYERWEB-13)', () => {
  it('đơn Đã xác nhận có nút Hủy đơn; bấm phải xác nhận, "Giữ đơn" thì không gọi API', async () => {
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    click(btn(container, 'Giữ đơn')!);
    await flush();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('xác nhận hủy: gọi API đúng mã đơn rồi báo đã hủy', async () => {
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(Array.from(container.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Hủy đơn') ?? null);
    await flush(8);
    expect(mocks.cancel).toHaveBeenCalledWith('TB-9');
    expect(container.textContent).toContain('Đã hủy đơn hàng');
  });

  it('BE từ chối (đơn vừa vào quy trình giao): hiện nguyên văn lời BE', async () => {
    mocks.cancel.mockRejectedValue(new Error('Đơn đã vào quy trình giao, vui lòng liên hệ Zalo OA để được hỗ trợ.'));
    const { container } = await mount();
    click(btn(container, 'Hủy đơn')!);
    click(Array.from(container.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Hủy đơn') ?? null);
    await flush(8);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('đã vào quy trình giao');
  });

  it.each([['PACKED'], ['SHIPPING']])('đơn %s: không có nút Hủy đơn (vẫn còn dòng hotline)', async (status) => {
    mocks.order = { ...BASE, status };
    const { container } = await mount();
    expect(btn(container, 'Hủy đơn')).toBeUndefined();
    expect(container.textContent).toContain('Cần hủy hoặc đổi đơn?');
  });

  it('đơn CTV lên hộ khách đã trả tiền: CTV không thấy nút Hủy đơn', async () => {
    mocks.order = { ...BASE, placedForCustomer: true, paymentStatus: 'PAID', referrerUserId: 'u1' };
    const { container } = await mount();
    expect(btn(container, 'Hủy đơn')).toBeUndefined();
  });
});

describe('chi tiết đơn — mua lại (BUYERWEB-13)', () => {
  const delivered = { ...BASE, status: 'DELIVERED', deliveredAt: '2026-10-05T00:00:00Z' };

  it('chỉ đơn đã kết thúc có "Mua lại đơn này"', async () => {
    const open = await mount();
    expect(btn(open.container, 'Mua lại đơn này')).toBeUndefined();
    mocks.order = delivered;
    const done = await mount();
    expect(btn(done.container, 'Mua lại đơn này')).toBeDefined();
  });

  it('thêm đủ: chuyển sang giỏ hàng', async () => {
    mocks.order = delivered;
    mocks.repurchase.mockResolvedValue({ cart: { items: [], itemCount: 2 }, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] });
    const { container } = await mount();
    click(btn(container, 'Mua lại đơn này')!);
    await flush(8);
    expect(mocks.repurchase).toHaveBeenCalledWith('TB-9');
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('thêm được một phần: ở lại trang, nói rõ bao nhiêu dòng chưa thêm được và có lối vào giỏ', async () => {
    mocks.order = delivered;
    mocks.repurchase.mockResolvedValue({
      cart: { items: [], itemCount: 1 },
      results: [{ orderItemId: 'a', status: 'added', addedQuantity: 1 }, { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 }],
    });
    const { container } = await mount();
    click(btn(container, 'Mua lại đơn này')!);
    await flush(8);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Đã thêm 1 sản phẩm vào giỏ. 1 sản phẩm đã hết hàng');
    expect(container.querySelector('a[href="/gio-hang"]')).not.toBeNull();
  });

  it('không thêm được dòng nào: báo hết hàng/ngừng bán, không chuyển trang', async () => {
    mocks.order = delivered;
    mocks.repurchase.mockResolvedValue({ cart: { items: [], itemCount: 0 }, results: [{ orderItemId: 'b', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 }] });
    const { container } = await mount();
    click(btn(container, 'Mua lại đơn này')!);
    await flush(8);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('đã hết hàng hoặc ngừng bán');
  });
});

describe('chi tiết đơn — yêu cầu đổi/trả (BUYERWEB-13)', () => {
  const delivered = { ...BASE, status: 'DELIVERED', deliveredAt: '2026-10-05T00:00:00Z' };

  it('đơn chưa giao không có nút đổi/trả', async () => {
    const { container } = await mount();
    expect(btn(container, 'Yêu cầu đổi/trả')).toBeUndefined();
  });

  it('lý do dưới 5 ký tự: không gửi được; đủ thì gửi đúng mã đơn + lý do đã cắt khoảng trắng', async () => {
    mocks.order = delivered;
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    const textarea = container.querySelector('textarea')!;
    expect(btn(container, 'Gửi yêu cầu')!.disabled).toBe(true);
    typeInto(textarea, 'ab');
    expect(btn(container, 'Gửi yêu cầu')!.disabled).toBe(true);
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    typeInto(textarea, '  Bao bì bị rách khi nhận  ');
    expect(btn(container, 'Gửi yêu cầu')!.disabled).toBe(false);
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(mocks.requestReturn).toHaveBeenCalledWith('TB-9', 'Bao bì bị rách khi nhận');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('BE từ chối (quá hạn đổi/trả): giữ form và hiện nguyên văn lời BE', async () => {
    mocks.order = delivered;
    mocks.requestReturn.mockRejectedValue(new Error('Quá hạn đổi/trả (7 ngày từ khi nhận hàng).'));
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    typeInto(container.querySelector('textarea'), 'Hàng bị lỗi nhà sản xuất');
    click(btn(container, 'Gửi yêu cầu')!);
    await flush(8);
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.textContent).toContain('Quá hạn đổi/trả (7 ngày từ khi nhận hàng).');
  });

  it.each([
    ['REQUESTED', 'đang được xử lý'],
    ['APPROVED', 'đã được duyệt'],
    ['REJECTED', 'bị từ chối: Ảnh không rõ'],
  ])('đã có yêu cầu %s: hiện trạng thái thay cho nút gửi lại', async (status, expected) => {
    mocks.order = delivered;
    mocks.returns = [{ id: 'r1', orderId: 'o9', status, reason: 'x', adminNote: status === 'REJECTED' ? 'Ảnh không rõ' : null, createdAt: '2026-10-06T00:00:00Z' }];
    const { container } = await mount();
    expect(btn(container, 'Yêu cầu đổi/trả')).toBeUndefined();
    expect(container.textContent).toContain(expected);
  });

  it('không tải được danh sách yêu cầu cũ: vẫn cho gửi (BE chặn trùng bằng lời rõ ràng)', async () => {
    mocks.order = delivered;
    mocks.returnsError = true;
    const { container } = await mount();
    expect(btn(container, 'Yêu cầu đổi/trả')).toBeDefined();
  });
});

describe('chi tiết đơn — truy cập', () => {
  it('đủ h1/h2/h3 không nhảy cấp, mọi điều khiển có tên, vùng chạm 44px (đơn đã giao, form đổi/trả mở)', async () => {
    mocks.order = { ...BASE, status: 'DELIVERED', deliveredAt: '2026-10-05T00:00:00Z', shippingHistory: [{ at: '2026-10-02T03:00:00Z', status: 'delivered', code: 'X' }] };
    const { container } = await mount();
    click(btn(container, 'Yêu cầu đổi/trả')!);
    await flush();
    expect(byText(container, 'h3', 'Yêu cầu đổi/trả')).not.toBeNull();
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});
