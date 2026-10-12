// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// C-025 (A1-014): web thanh toán không có chỗ nhập/chọn Mã giảm giá — khách có mã trong ví mà mua trên web
// vẫn trả nguyên giá. Mã áp vào GIỎ (server tính lại tổng ở /checkout/quote và lúc đặt), nên ở thanh toán
// chỉ cần ô nhập/danh sách mã và tải lại báo giá sau khi đổi mã.

const state = vi.hoisted(() => ({
  couponCode: null as string | null,
  applied: [] as string[],
  removed: 0,
  quoteCalls: 0,
  applyError: null as Error | null,
  quoteError: null as Error | null,
  /** Giữ placeOrder đang bay để quan sát trạng thái "đang đặt hàng". */
  placeGate: null as Promise<void> | null,
  /** Body mà trang gửi cho placeOrder. */
  placedBodies: [] as Record<string, unknown>[],
  /** Báo giá 0đ (điểm quy đổi phủ hết hàng + freeship). */
  zeroQuote: false,
  coupons: [] as unknown[],
  /** Giữ phản hồi của applyCoupon/checkoutQuote cho tới khi test cho chạy, để quan sát trạng thái "đang tính". */
  gate: null as Promise<void> | null,
}));
const SUBTOTAL = 300000;
const discountOf = () => (state.couponCode ? 90000 : 0);
const cartNow = () => ({
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 150000, quantity: 2, stock: 5, total: SUBTOTAL },
  ],
  couponCode: state.couponCode,
  subtotal: SUBTOTAL,
  discount: discountOf(),
  freeship: false,
  freeshipThreshold: 500000,
  itemCount: 2,
});

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => cartNow(),
  getMyCoupons: async () => state.coupons,
  applyCoupon: async (code: string) => {
    await state.gate;
    if (state.applyError) throw state.applyError;
    state.applied.push(code);
    state.couponCode = code;
    return cartNow();
  },
  removeCoupon: async () => {
    state.removed += 1;
    state.couponCode = null;
    return cartNow();
  },
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
  ],
  checkoutQuote: async () => {
    state.quoteCalls += 1;
    if (state.quoteError) throw state.quoteError;
    if (state.couponCode) await state.gate;
    if (state.zeroQuote) {
      return {
        subtotal: SUBTOTAL, discount: 0, pointsUsed: 300, pointsUsedConverted: 300, pointsDiscount: SUBTOTAL, shippingFee: 0,
        total: 0, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0, pointsConvertedBalance: 300, redeemableConvertedPoints: 300,
      };
    }
    return {
      subtotal: SUBTOTAL, discount: discountOf(), pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000,
      total: SUBTOTAL - discountOf() + 30000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
    };
  },
  getPublicConfig: async () => ({ recyclingEnabled: false }),
  placeOrder: async (body: Record<string, unknown>) => {
    state.placedBodies.push(body);
    await state.placeGate;
    return { code: 'TT0001', total: SUBTOTAL - discountOf() + 30000 };
  },
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const btn = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[name="coupon-code"]');
const COUPON = { code: 'WELCOME30', type: 'PERCENT', value: 30, minOrder: null, maxDiscount: null, endAt: '2030-01-01T00:00:00Z' };

beforeEach(() => {
  state.couponCode = null;
  state.applied = [];
  state.removed = 0;
  state.quoteCalls = 0;
  state.applyError = null;
  state.quoteError = null;
  state.placeGate = null;
  state.placedBodies = [];
  state.zeroQuote = false;
  state.coupons = [COUPON];
  state.gate = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — Mã giảm giá (C-025)', () => {
  it('có ô "Mã giảm giá" có nhãn và danh sách mã trong ví để chọn', async () => {
    const { container } = await mount();
    const field = input(container);
    expect(field).not.toBeNull();
    expect(container.querySelector(`label[for="${field!.id}"]`)?.textContent).toBe('Mã giảm giá');
    expect(btn(container, 'WELCOME30')).toBeDefined();
    expect(btn(container, 'Áp dụng')!.disabled).toBe(true);
  });

  it('chọn mã trong ví: áp vào giỏ, báo giá tính lại và hiện dòng giảm giá kèm tổng mới', async () => {
    const { container } = await mount();
    const before = state.quoteCalls;
    expect(container.textContent).toContain('330.000đ');
    click(btn(container, 'WELCOME30')!);
    await flush(8);
    expect(state.applied).toEqual(['WELCOME30']);
    expect(state.quoteCalls).toBeGreaterThan(before);
    expect(container.textContent).toContain('Giảm giá (WELCOME30)');
    expect(container.textContent).toContain('-90.000đ');
    expect(container.textContent).toContain('240.000đ');
    expect(container.textContent).not.toContain('330.000đ');
  });

  it('nhập tay: mã được viết hoa và cắt khoảng trắng trước khi gửi', async () => {
    const { container } = await mount();
    typeInto(input(container), '  welcome30 ');
    expect(btn(container, 'Áp dụng')!.disabled).toBe(false);
    click(btn(container, 'Áp dụng')!);
    await flush(8);
    expect(state.applied).toEqual(['WELCOME30']);
    expect(input(container)).toBeNull();
  });

  it('mã bị từ chối: hiện lý do của server (role=alert), không đổi giá', async () => {
    state.applyError = new Error('Mã giảm giá đã hết lượt dùng.');
    const { container } = await mount();
    typeInto(input(container), 'HETLUOT');
    click(btn(container, 'Áp dụng')!);
    await flush(8);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Mã giảm giá đã hết lượt dùng.');
    expect(container.textContent).toContain('330.000đ');
    expect(container.textContent).not.toContain('Giảm giá (');
  });

  it('bỏ mã: gọi xoá mã khỏi giỏ, báo giá trở về nguyên giá', async () => {
    state.couponCode = 'WELCOME30';
    const { container } = await mount();
    expect(container.textContent).toContain('240.000đ');
    const drop = container.querySelector<HTMLButtonElement>('button[aria-label="Bỏ mã giảm giá WELCOME30"]');
    expect(drop).not.toBeNull();
    click(drop);
    await flush(8);
    expect(state.removed).toBe(1);
    expect(container.textContent).toContain('330.000đ');
    expect(container.textContent).not.toContain('Giảm giá (');
    expect(input(container)).not.toBeNull();
  });

  it('mã đòi đơn tối thiểu cao hơn tạm tính bị khoá và nói rõ lý do', async () => {
    state.coupons = [{ ...COUPON, code: 'BIGSPEND', minOrder: 500000 }];
    const { container } = await mount();
    const chip = btn(container, 'BIGSPEND')!;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe('Cần đơn tối thiểu 500.000đ');
  });

  it('đang tính lại báo giá sau khi đổi mã thì chưa cho đặt hàng (tránh đặt khi con số trên màn hình đã cũ)', async () => {
    const { container } = await mount();
    expect(btn(container, 'Đặt hàng')!.disabled).toBe(false);
    let release!: () => void;
    state.gate = new Promise<void>((r) => {
      release = r;
    });
    click(btn(container, 'WELCOME30')!);
    await flush(3);
    // Mã chưa áp xong rồi tới báo giá mới chưa về: nút đặt hàng phải khoá.
    expect(btn(container, 'Đặt hàng')!.disabled).toBe(true);
    release();
    await flush(10);
    expect(btn(container, 'Đặt hàng')!.disabled).toBe(false);
    expect(container.textContent).toContain('240.000đ');
  });

  // React Query giữ `data` cũ khi refetch lỗi: nếu chỉ khoá nút lúc đang fetch thì sau khi bỏ mã mà báo giá
  // mới không về, màn hình còn 240.000đ (có mã) trong khi server đã bỏ mã và thu 330.000đ.
  it('báo giá tính lại sau khi đổi mã bị lỗi: không hiện số tiền cũ và khoá nút đặt hàng', async () => {
    state.couponCode = 'WELCOME30';
    const { container } = await mount();
    expect(container.textContent).toContain('240.000đ');
    state.quoteError = new Error('mất mạng');
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Bỏ mã giảm giá WELCOME30"]'));
    await flush(10);
    expect(state.removed).toBe(1);
    expect(container.textContent).toContain('Không tính được phí ship/tổng tiền');
    expect(container.textContent).not.toContain('240.000đ');
    expect(btn(container, 'Đặt hàng')!.disabled).toBe(true);
    // Thử lại thành công thì mở khoá và hiện đúng số tiền server sẽ thu.
    state.quoteError = null;
    click(btn(container, 'Thử lại')!);
    await flush(10);
    expect(container.textContent).toContain('330.000đ');
    expect(btn(container, 'Đặt hàng')!.disabled).toBe(false);
  });

  // Server đọc mã từ giỏ lúc tạo đơn: đổi/bỏ mã khi đơn đang bay làm đơn lấy mã khác con số khách đã thấy.
  it('đang đặt hàng thì không đổi/bỏ được Mã giảm giá', async () => {
    state.couponCode = 'WELCOME30';
    const { container } = await mount();
    let release!: () => void;
    state.placeGate = new Promise<void>((r) => {
      release = r;
    });
    click(btn(container, 'Đặt hàng')!);
    await flush(3);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Bỏ mã giảm giá WELCOME30"]')!.disabled).toBe(true);
    release();
    await flush(6);
    expect(container.textContent).toContain('Đặt hàng thành công');
  });

  it('đang đặt hàng thì chip mã trong ví và nút Áp dụng bị khoá', async () => {
    const { container } = await mount();
    typeInto(input(container), 'WELCOME30');
    expect(btn(container, 'Áp dụng')!.disabled).toBe(false);
    let release!: () => void;
    state.placeGate = new Promise<void>((r) => {
      release = r;
    });
    click(btn(container, 'Đặt hàng')!);
    await flush(3);
    expect(btn(container, 'Áp dụng')!.disabled).toBe(true);
    expect(btn(container, 'WELCOME30')!.disabled).toBe(true);
    release();
    await flush(4);
  });

  it('review C2: đơn 0đ gửi COD kèm quotedZeroTotal (BE từ chối nếu lúc đặt không còn 0đ); đơn có tiền không gửi cờ', async () => {
    const paid = await mount();
    click(btn(paid.container, 'Đặt hàng')!);
    await flush(6);
    expect(state.placedBodies).toHaveLength(1);
    expect(state.placedBodies[0]).not.toHaveProperty('quotedZeroTotal');

    state.zeroQuote = true;
    state.placedBodies = [];
    const free = await mount();
    expect(free.container.textContent).toContain('Đơn đã được trả đủ bằng Điểm Xanh');
    click(btn(free.container, 'Đặt hàng')!);
    await flush(6);
    expect(state.placedBodies[0]).toMatchObject({ paymentMethod: 'COD', quotedZeroTotal: true });
  });

  it('truy cập: một h1, mọi điều khiển có tên, vùng chạm 44px', async () => {
    const { container } = await mount();
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});
