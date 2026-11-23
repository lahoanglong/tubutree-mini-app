// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_DRAFT_KEY } from '@tubutree/app-core/commerce/checkout-draft';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { accessibleName } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';

/**
 * /thanh-toan (tubu-w22-03): địa chỉ và ghi chú giữ qua một lần sang giỏ sửa hàng (WCAG 2.2 3.3.7) và dòng phụ dưới mỗi cách thanh toán.
 * Lối "Về giỏ hàng để sửa" ghi địa chỉ, ghi chú; mở lại màn thì lấy lại (địa chỉ chỉ khi còn trong sổ), đọc xong là xoá. Cách trả tiền
 * không giữ (như nháp của khách chưa đăng nhập): tổng đã đổi ở giỏ, Ví trừ tiền ngay nên khách tự chọn lại.
 */
const A1 = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const A2 = { ...A1, id: 'a2', recipient: 'Bình', street: '9 Hàng Bài', isDefault: false };
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
const KEY = `${CHECKOUT_DRAFT_KEY}:u`;

const m = vi.hoisted(() => ({ addresses: [] as unknown[], quote: vi.fn(), placeOrder: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => m.addresses,
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(10);
  return r;
};
const unmountAll = () => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
};
const placeButton = (r: Rendered) => byText(r.container, 'button', /^Đặt hàng/) as HTMLButtonElement;
const radio = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;
const noteBox = (r: Rendered) => r.container.querySelector('textarea') as HTMLTextAreaElement;
const sentBody = (call = 0) => m.placeOrder.mock.calls[call]![0] as { addressId: string; note?: string; paymentMethod: string };
const seedDraft = (draft: Record<string, unknown>) => sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ...draft }));
const describedText = (el: Element) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? null;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.addresses = [A1, A2];
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset().mockReturnValue(new Promise(() => undefined));
});
afterEach(unmountAll);

describe('/thanh-toan — giữ lựa chọn qua một lần sang giỏ sửa hàng', () => {
  it('quay lại từ giỏ: địa chỉ đã chọn (không phải mặc định) và ghi chú còn nguyên; bản nháp bị xoá sau khi đọc', async () => {
    seedDraft({ addressId: 'a2', note: 'Giao giờ hành chính' });
    const r = await mount();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(noteBox(r).value).toBe('Giao giờ hành chính');
    expect(r.container.textContent).toContain('9 Hàng Bài');
    click(placeButton(r));
    await flush(4);
    expect(sentBody()).toMatchObject({ addressId: 'a2', note: 'Giao giờ hành chính', paymentMethod: 'COD' });
  });

  it('địa chỉ trong bản nháp đã bị xoá ở nơi khác: dùng địa chỉ mặc định, ghi chú vẫn giữ', async () => {
    seedDraft({ addressId: 'gone', note: 'Gọi trước khi giao' });
    const r = await mount();
    expect(noteBox(r).value).toBe('Gọi trước khi giao');
    click(placeButton(r));
    await flush(4);
    expect(sentBody()).toMatchObject({ addressId: 'a1', paymentMethod: 'COD' });
  });

  it('không có bản nháp (mở màn bình thường): địa chỉ mặc định, COD, ghi chú trống', async () => {
    const r = await mount();
    expect(noteBox(r).value).toBe('');
    expect(radio(r, 'Thanh toán khi nhận hàng').checked).toBe(true);
    click(placeButton(r));
    await flush(4);
    expect(sentBody()).toMatchObject({ addressId: 'a1', paymentMethod: 'COD' });
  });

  it('đặt lỗi vì giỏ (FLASH_LIMIT) rồi bấm "Về giỏ hàng để sửa": địa chỉ và ghi chú được ghi; mở lại màn thì lấy lại, cách trả tiền về COD để khách tự chọn lại', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.', 400, 'FLASH_LIMIT'));
    seedDraft({ addressId: 'a2', note: '' });
    const r = await mount();
    typeInto(noteBox(r), 'Để ở bảo vệ');
    click(radio(r, 'Chuyển khoản ngân hàng'));
    click(placeButton(r));
    await flush(8);
    const back = r.container.querySelector<HTMLAnchorElement>('[data-testid="checkout-cart-issue"] a')!;
    expect(back.getAttribute('href')).toBe('/gio-hang');
    // jsdom không chuyển trang: chặn điều hướng mặc định ở pha bắt, onClick của lối vẫn chạy.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('click', stop, { capture: true });
    click(back);
    document.removeEventListener('click', stop, { capture: true });
    const saved = JSON.parse(sessionStorage.getItem(KEY)!) as Record<string, unknown>;
    expect(saved).toMatchObject({ addressId: 'a2', note: 'Để ở bảo vệ' });
    expect(saved).not.toHaveProperty('payment');

    unmountAll();
    m.placeOrder.mockReset().mockReturnValue(new Promise(() => undefined));
    const again = await mount();
    expect(noteBox(again).value).toBe('Để ở bảo vệ');
    expect(radio(again, 'Thanh toán khi nhận hàng').checked).toBe(true);
    click(placeButton(again));
    await flush(4);
    expect(sentBody()).toMatchObject({ addressId: 'a2', note: 'Để ở bảo vệ', paymentMethod: 'COD' });
  });

  it('bản nháp của tài khoản khác trên cùng tab không được dùng', async () => {
    sessionStorage.setItem(`${CHECKOUT_DRAFT_KEY}:other`, JSON.stringify({ addressId: 'a2', note: 'của người khác', at: Date.now() }));
    const r = await mount();
    expect(noteBox(r).value).toBe('');
    click(placeButton(r));
    await flush(4);
    expect(sentBody()).toMatchObject({ addressId: 'a1' });
  });
});

describe('/thanh-toan — dòng phụ dưới mỗi cách thanh toán', () => {
  it('COD và chuyển khoản: tên radio giữ ngắn, dòng phụ là mô tả (aria-describedby)', async () => {
    const r = await mount();
    const cod = radio(r, 'Thanh toán khi nhận hàng');
    const bank = radio(r, 'Chuyển khoản ngân hàng');
    expect(accessibleName(cod)).toBe('Thanh toán khi nhận hàng (COD)');
    expect(accessibleName(bank)).toBe('Chuyển khoản ngân hàng');
    expect(describedText(cod)).toBe(fillCopy('checkout.payCueCod'));
    expect(describedText(bank)).toBe(fillCopy('checkout.payCueBank'));
  });

  it('cách bị máy chủ khoá: lý do khoá thay dòng phụ (không hiện cả hai)', async () => {
    const reason = 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ.';
    m.quote.mockResolvedValue({ ...QUOTE, blockedPaymentMethods: { COD: reason } });
    const r = await mount();
    const cod = radio(r, 'Thanh toán khi nhận hàng');
    expect(describedText(cod)).toBe(reason);
    expect(cod.closest('label')!.textContent).not.toContain(fillCopy('checkout.payCueCod'));
  });
});
