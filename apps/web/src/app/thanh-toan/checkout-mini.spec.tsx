// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Thanh toán ở khổ điện thoại phải là Mini App (apps/miniapp/src/pages/checkout.tsx): thứ tự khối, dải phẳng, thẻ địa chỉ,
// khối "Sản phẩm", thẻ mã, thanh dính đáy một nút. jsdom không có media query nên kiểm bằng lớp `max-md:`.

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
const quoteFail = vi.hoisted(() => ({ error: null as Error | null }));
const cartExtra = vi.hoisted(() => ({ coupon: null as string | null, discount: 0, second: false }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [
      { id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 150000, quantity: 2, stock: 5, total: 300000 },
      ...(cartExtra.second
        ? [{ id: 'i2', variationId: 'v2', productName: 'Xà phòng', variationName: '100g', slug: 'xa-phong', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }]
        : []),
    ],
    couponCode: cartExtra.coupon, subtotal: 300000, discount: cartExtra.discount, freeship: false, freeshipThreshold: 500000, itemCount: 2,
  }),
  getMe: async () => ({ pointsBalance: 500, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: '84_VNp', districtCode: '', wardCode: 'w', isDefault: true },
    { id: 'a2', recipient: 'Bình', phone: '0987654321', province: 'Huế', district: 'A', ward: 'B', street: '2 Lê Lợi', provinceCode: '46', districtCode: 'd', wardCode: '00', isDefault: false },
  ],
  checkoutQuote: async () => {
    if (quoteFail.error) throw quoteFail.error;
    return {
    subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
    pointsBalance: 500, redeemablePoints: 500,
    };
  },
  placeOrder: async () => ({ code: 'TT0001', total: 330000 }),
}));

import { ApiError } from '@/lib/client-api';
import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
beforeEach(() => {
  sessionStorage.clear();
  quoteFail.error = null;
  cartExtra.coupon = null;
  cartExtra.discount = 0;
  cartExtra.second = false;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — khối xếp như Mini App ở điện thoại', () => {
  it('Địa chỉ → Sản phẩm → Mã giảm giá → Mã người giới thiệu → Phương thức → Điểm → Ghi chú → VAT → Tóm tắt', async () => {
    const c = await mount();
    const blocks = Array.from(c.querySelectorAll<HTMLElement>('[data-mini-block]'))
      .map((el) => ({ name: el.dataset.miniBlock!, order: Number(/max-md:order-(\d+)/.exec(el.className)?.[1]) }))
      .sort((a, b) => a.order - b.order)
      .map((b) => b.name);
    expect(blocks).toEqual(['address', 'items', 'coupon', 'referral', 'payment', 'points', 'note', 'invoice', 'summary']);
  });

  it('mỗi phần là dải phẳng tràn ngang (không bo góc/viền/bóng) và tiêu đề chữ không chân', async () => {
    const c = await mount();
    const payment = c.querySelector<HTMLElement>('[data-mini-block="payment"]')!;
    expect(payment.className).toMatch(/\bmax-md:rounded-none\b/);
    expect(payment.className).toMatch(/\bmax-md:border-0\b/);
    expect(payment.className).toMatch(/\bmax-md:shadow-none\b/);
    expect(payment.querySelector('h2')!.className).toMatch(/\bmax-md:font-ui\b/);
  });
});

describe('/thanh-toan — thẻ địa chỉ như Mini App', () => {
  it('địa chỉ mặc định có huy hiệu "Mặc định"; nút radio chỉ còn cho trình đọc màn hình ở điện thoại', async () => {
    const c = await mount();
    const card = c.querySelector<HTMLElement>('[data-mini-block="address"] label')!;
    expect(card.textContent).toContain('Mặc định');
    expect(card.querySelector('input[type="radio"]')!.className).toMatch(/\bmax-md:sr-only\b/);
  });

  it('"Thêm địa chỉ mới" không có dấu +, "Quản lý sổ địa chỉ" ẩn ở điện thoại, "Sửa" chỉ hiện với địa chỉ địa giới cũ', async () => {
    const c = await mount();
    const add = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Thêm địa chỉ mới'))!;
    expect(add.textContent?.trim()).toBe('Thêm địa chỉ mới');
    expect(c.querySelector('a[href="/tai-khoan/dia-chi"]')!.className).toMatch(/\bmax-md:hidden\b/);
    expect(c.querySelector('button[aria-label="Sửa địa chỉ của An"]')!.className).toMatch(/\bmax-md:hidden\b/);
    expect(c.querySelector('button[aria-label="Sửa địa chỉ của Bình"]')!.className).not.toMatch(/\bmax-md:hidden\b/);
  });
});

describe('/thanh-toan — khối Sản phẩm và thẻ mã', () => {
  it('"Sản phẩm (2)" liệt kê món: tên, phân loại, đơn giá × số lượng, thành tiền', async () => {
    const c = await mount();
    const items = c.querySelector<HTMLElement>('[data-mini-block="items"]')!;
    expect(items.textContent).toContain('Sản phẩm (2)');
    expect(items.textContent).toContain('Dầu gội bồ kết');
    expect(items.textContent).toContain('500ml');
    expect(items.textContent).toContain('150.000đ × 2');
    expect(items.textContent).toContain('300.000đ');
  });

  it('thẻ mã giảm giá riêng, chữ "Chọn mã"', async () => {
    const c = await mount();
    const coupon = c.querySelector<HTMLElement>('[data-mini-block="coupon"]')!;
    expect(coupon.textContent).toContain('Chọn hoặc nhập mã giảm giá');
    expect(coupon.textContent).toContain('Chọn mã');
  });
});

describe('/thanh-toan — ô chọn Điểm Xanh', () => {
  it('dấu tick nằm trong khung 24px bọc đúng ô chọn, không bám góc dòng', async () => {
    const c = await mount();
    const input = c.querySelector<HTMLInputElement>('[data-mini-block="points"] input[type="checkbox"]')!;
    const box = input.parentElement!;
    expect(box.tagName).toBe('SPAN');
    expect(box.className).toMatch(/\brelative\b/);
    expect(box.querySelector('svg')).not.toBeNull();
  });
});

describe('/thanh-toan — thanh dính đáy một nút', () => {
  it('chỉ nút "Đặt hàng · số tiền" toàn chiều ngang, không có khối Tổng cộng', async () => {
    const c = await mount();
    const bar = c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!;
    expect(bar.textContent).not.toContain('Tổng cộng');
    const btn = bar.querySelector<HTMLButtonElement>('button')!;
    expect(btn.textContent).toBe('Đặt hàng · 330.000đ');
    expect(btn.className).toMatch(/\bw-full\b/);
  });
});

// D7-33: Mini App chỉ cho đặt khi báo giá thành công; địa chỉ địa giới cũ làm báo giá trả ADDRESS_OUTDATED nên nút khoá ở cả hai nơi.
describe('/thanh-toan — địa chỉ địa giới cũ', () => {
  it('báo giá ADDRESS_OUTDATED: nút Đặt hàng khoá và nói rõ phải sửa địa chỉ', async () => {
    quoteFail.error = new ApiError('Địa chỉ giao hàng chưa theo địa giới mới.', 400, 'ADDRESS_OUTDATED');
    const c = await mount();
    const btn = c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!.querySelector('button')!;
    expect(btn.disabled).toBe(true);
    expect(c.textContent).toContain('Hãy bấm Sửa ở địa chỉ đó');
  });

  it('phường sai tỉnh (địa chỉ mã mới, không phải địa giới cũ): báo giá ADDRESS_OUTDATED thì địa chỉ đang chọn vẫn có nút Sửa ở điện thoại', async () => {
    quoteFail.error = new ApiError('Phường không thuộc tỉnh.', 400, 'ADDRESS_OUTDATED');
    const c = await mount();
    expect(c.querySelector('button[aria-label="Sửa địa chỉ của An"]')!.className).not.toMatch(/\bmax-md:hidden\b/);
  });
});

describe('/thanh-toan — số giảm ở thẻ mã khi chưa có báo giá', () => {
  it('mua một phần giỏ mà báo giá lỗi: thẻ mã không ghi số giảm của cả giỏ', async () => {
    cartExtra.coupon = 'XANH10';
    cartExtra.discount = 57800;
    cartExtra.second = true;
    sessionStorage.setItem('tubu_checkout_selection', JSON.stringify({ itemIds: ['i1'] }));
    quoteFail.error = new ApiError('Địa chỉ giao hàng chưa theo địa giới mới.', 400, 'ADDRESS_OUTDATED');
    const c = await mount();
    const card = c.querySelector<HTMLElement>('[data-mini-block="coupon"]')!;
    expect(card.textContent).toContain('XANH10');
    expect(card.textContent).not.toMatch(/-\s?57\.800/);
    expect(card.textContent).not.toMatch(/-\d/);
  });
});
