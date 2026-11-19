// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, chooseGeo, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { act } from 'react';
import { ApiError } from '@/lib/client-api';

/**
 * /thanh-toan khi chưa đăng nhập (tubu-w4-01): cờ web.guest_checkout_enabled tắt thì y như cũ (mời đăng nhập, không gọi đường khách);
 * cờ bật thì một biểu mẫu, đúng một nút Đặt hàng mỗi khổ, đặt xong sang trang theo dõi có khoá ở phần #.
 */
const m = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  /** /config/public của trình duyệt treo (mạng chậm): trang chỉ còn bản máy chủ đọc sẵn ở layout. */
  configPending: false,
  quote: vi.fn(),
  place: vi.fn(),
  replace: vi.fn(),
  clear: vi.fn(),
  flash: false,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/thanh-toan' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, status: 'idle', initialized: true, startZaloLogin: vi.fn() }) }));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: vi.fn(async () => {
    throw new Error('không gọi giỏ tài khoản khi chưa đăng nhập');
  }),
  getAddresses: vi.fn(async () => []),
  getMe: vi.fn(async () => {
    throw new Error('không gọi /users/me khi chưa đăng nhập');
  }),
  getPublicConfig: () => (m.configPending ? new Promise<never>(() => undefined) : Promise.resolve(m.config)),
}));
vi.mock('@/lib/guest-cart/use-guest-cart', () => ({
  useGuestCartLines: () => [{ variationId: 'v1', slug: 'dau-goi', quantity: 2, addedAt: 1 }],
}));
vi.mock('@/lib/guest-cart/products', () => ({ useGuestCartProducts: () => new Map() }));
vi.mock('@/lib/use-flash-sales', () => ({ useRunningFlash: () => ({ flash: m.flash ? [{}] : [], now: 0 }) }));
vi.mock('@/lib/guest-cart/view', () => ({
  guestCartView: (_l: unknown, _p: unknown, flash: unknown[]) => ({
    rows: [
      {
        variationId: 'v1', slug: 'dau-goi', quantity: 2, state: 'ok', productName: 'Dầu gội', variationName: 'Chai 500ml', thumbnail: null,
        unitPrice: flash.length > 0 ? 99_000 : 120_000, compareAt: null, isFlash: flash.length > 0, total: flash.length > 0 ? 198_000 : 240_000, stock: 9, maxQty: 9, tubu: true, blockedText: null,
      },
    ],
    subtotal: flash.length > 0 ? 198_000 : 240_000,
    tubuSubtotal: 240_000,
    hasMerchant: false,
    settled: true,
  }),
}));
vi.mock('@/lib/guest-cart/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/guest-cart/store')>()),
  clearGuestCart: () => m.clear(),
}));
vi.mock('@/lib/guest-checkout/api', () => ({
  guestQuote: (...a: unknown[]) => m.quote(...a),
  guestPlaceOrder: (...a: unknown[]) => m.place(...a),
  guestTrackOrder: vi.fn(),
  guestBankQr: vi.fn(),
  claimGuestOrdersRequest: vi.fn(),
}));

import CheckoutPage from './page';
import { ServerGuestConfigProvider } from '@/components/checkout/server-guest-config';

// Form đặt không đăng nhập là chunk tải lười (next/dynamic): nạp sẵn để lần dựng đầu của tệp không phụ thuộc thời gian biên dịch mô-đun của vitest.
beforeAll(async () => {
  await import('@/components/checkout/guest-checkout');
});

const QUOTE = {
  flashNotice: false,
  blockedPaymentMethods: {},
  codMax: 500_000,
  subtotal: 240_000,
  discount: 0,
  comboDiscount: 0,
  shippingFee: 0,
  total: 240_000,
  items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: 'Chai 500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 120_000, quantity: 2, total: 240_000 }],
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const field = (r: Rendered, label: string) => {
  const l = Array.from(r.container.querySelectorAll('label')).find((x) => x.textContent?.trim() === label);
  return document.getElementById(l!.htmlFor) as HTMLInputElement;
};
async function fillForm(r: Rendered, phone = '+84 912 345 678') {
  typeInto(field(r, 'Họ tên người nhận'), 'Lan');
  typeInto(field(r, 'Số điện thoại'), phone);
  // React nghe focusout (nổi bọt), không nghe blur.
  act(() => {
    field(r, 'Số điện thoại').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  chooseGeo(r.container, 'Tỉnh/Thành phố', '84_VN01');
  await flush(4);
  chooseGeo(r.container, 'Phường/Xã', '84_VN01_001');
  typeInto(field(r, 'Số nhà, tên đường'), '12 Ngõ 5');
  // Báo giá chờ khách ngừng gõ 600ms.
  await new Promise((res) => setTimeout(res, 700));
  await flush(6);
}
const placeButtons = (r: Rendered) => Array.from(r.container.ownerDocument.querySelectorAll<HTMLButtonElement>('[data-testid="guest-place-order"]'));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  m.config = { webGuestCheckoutEnabled: true, newCustomer: { welcomeVoucher: { amount: 30_000, minOrder: 0 } } };
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.place.mockReset();
  m.replace.mockReset();
  m.clear.mockReset();
  m.flash = false;
  m.configPending = false;
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan chưa đăng nhập, cờ web.guest_checkout_enabled tắt', () => {
  it.each([[{}], [{ webGuestCheckoutEnabled: false }], [{ webGuestCheckoutEnabled: 'true' }]])('cấu hình %j: mời đăng nhập như cũ, không có biểu mẫu, không gọi đường khách', async (cfg) => {
    m.config = cfg;
    const r = await mount();
    expect(r.container.textContent).toContain('Đăng nhập để thanh toán đơn hàng.');
    expect(r.container.querySelector('[data-testid="guest-checkout"]')).toBeNull();
    expect(placeButtons(r)).toHaveLength(0);
    expect(m.quote).not.toHaveBeenCalled();
    expect(m.place).not.toHaveBeenCalled();
  });
});

describe('/thanh-toan chưa đăng nhập, cờ bật', () => {
  it('một biểu mẫu có autocomplete name/tel/street-address, dòng mời đăng nhập ghi 30.000đ, đúng một nút Đặt hàng mỗi khổ (lg trong khung, dưới lg ở thanh đáy)', async () => {
    const r = await mount();
    expect(r.container.querySelector('[data-testid="guest-checkout"]')).not.toBeNull();
    expect(field(r, 'Họ tên người nhận').autocomplete).toBe('name');
    expect(field(r, 'Số điện thoại').autocomplete).toBe('tel');
    expect(field(r, 'Số điện thoại').inputMode).toBe('tel');
    expect(field(r, 'Số nhà, tên đường').autocomplete).toBe('street-address');
    expect(r.container.querySelector('[data-testid="guest-login-link"]')?.textContent).toBe(
      'Đã có tài khoản? Đăng nhập Zalo để dùng mã, Điểm Xanh và quà đơn đầu 30.000đ',
    );
    const buttons = placeButtons(r);
    expect(buttons).toHaveLength(2);
    expect(buttons.filter((b) => b.closest('.hidden.lg\\:block'))).toHaveLength(1);
    expect(buttons.filter((b) => !b.closest('.hidden.lg\\:block'))).toHaveLength(1);
    expect(r.container.textContent).not.toContain('Đăng nhập để thanh toán đơn hàng.');
  });

  it('cấu hình không có quà đơn đầu: ẩn dòng mời đăng nhập', async () => {
    m.config = { webGuestCheckoutEnabled: true };
    const r = await mount();
    expect(r.container.querySelector('[data-testid="guest-login-link"]')).toBeNull();
  });

  it('giỏ có món Giờ vàng: dòng giỏ ghi giá Giờ vàng như khách đăng nhập, không mời đăng nhập để có giá (tubu-w6-01 P1-b)', async () => {
    m.flash = true;
    const r = await mount();
    expect(r.container.textContent).toContain('198.000');
    expect(r.container.textContent).not.toContain('Đăng nhập Zalo để mua giá Giờ vàng');
    expect(r.container.querySelector('[data-testid="guest-flash-limit"]')).toBeNull();
  });

  it('báo giá nói SĐT này đã hết suất Giờ vàng: một dòng "phần vượt tính giá thường"', async () => {
    m.flash = true;
    m.quote.mockResolvedValue({ ...QUOTE, flashNotice: true });
    const r = await mount();
    await fillForm(r);
    expect(m.quote).toHaveBeenCalled();
    expect(r.container.querySelector('[data-testid="guest-flash-limit"]')?.textContent).toBe('Hết suất Giờ vàng: phần vượt tính giá thường');
  });

  it('bấm Đặt hàng khi còn trống: lỗi ngay dưới từng ô, không gọi báo giá hay đặt đơn', async () => {
    const r = await mount();
    click(placeButtons(r)[0]!);
    await flush(2);
    expect(r.container.textContent).toContain('Bạn nhập họ tên người nhận nhé.');
    expect(r.container.textContent).toContain('Số di động gồm 10 số');
    expect(field(r, 'Họ tên người nhận').getAttribute('aria-invalid')).toBe('true');
    expect(m.quote).not.toHaveBeenCalled();
    expect(m.place).not.toHaveBeenCalled();
  });

  it('SĐT sai khuôn (số bàn): báo lỗi, không báo giá', async () => {
    const r = await mount();
    await fillForm(r, '024 3123 4567');
    expect(r.container.textContent).toContain('Số di động gồm 10 số');
    expect(m.quote).not.toHaveBeenCalled();
  });

  it('điền đủ: báo giá với SĐT chuẩn 0xxxxxxxxx; Đặt hàng gửi COD, khoá theo dõi 43 ký tự, Idempotency-Key, rồi sang /don/<mã>#k=<khoá> và xoá giỏ khách', async () => {
    m.place.mockResolvedValue({ code: 'TB123', status: 'PENDING', paymentMethod: 'COD', total: 240_000, codes: ['TB123'], keyAccepted: true });
    const r = await mount();
    await fillForm(r);
    expect(m.quote).toHaveBeenCalledTimes(1);
    const q = m.quote.mock.calls[0]![0] as { lines: unknown; address: { phone: string; recipient: string } };
    expect(q.lines).toEqual([{ variationId: 'v1', quantity: 2 }]);
    expect(q.address).toMatchObject({ phone: '0912345678', recipient: 'Lan', provinceCode: '84_VN01', wardCode: '84_VN01_001', street: '12 Ngõ 5' });
    const btn = placeButtons(r)[0]!;
    expect(btn.textContent).toContain('240.000đ');
    click(btn);
    await flush(6);
    expect(m.place).toHaveBeenCalledTimes(1);
    const [body, idem] = m.place.mock.calls[0]! as [Record<string, unknown>, string];
    expect(body).toMatchObject({ paymentMethod: 'COD', expectedTotal: 240_000, website: '' });
    expect(body.trackingKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(typeof body.fillMs).toBe('number');
    expect(idem).toMatch(/.{8,}/);
    expect(m.replace).toHaveBeenCalledWith(`/don/TB123#k=${body.trackingKey as string}`);
    expect(m.clear).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('tubu.guestCheckout.orders')!)).toHaveProperty('TB123');
  });

  it('tổng trên mức COD: COD khoá kèm một dòng lý do, tự chuyển sang chuyển khoản; đặt xong sang trang QR có khoá', async () => {
    const reason = 'Đơn trên 500.000đ khi chưa đăng nhập cần chuyển khoản trước. Bạn chọn Chuyển khoản nhé.';
    m.quote.mockResolvedValue({ ...QUOTE, total: 620_000, subtotal: 620_000, blockedPaymentMethods: { COD: reason } });
    m.place.mockResolvedValue({ code: 'TB9', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', total: 620_000, codes: ['TB9'], keyAccepted: true });
    const r = await mount();
    await fillForm(r);
    expect(r.container.querySelector('[data-testid="guest-pay-blocked-COD"]')?.textContent).toBe(reason);
    const radios = Array.from(r.container.querySelectorAll<HTMLInputElement>('input[name="guest-pay"]'));
    expect(radios[0]!.disabled).toBe(true);
    expect(radios[1]!.checked).toBe(true);
    click(placeButtons(r)[0]!);
    await flush(6);
    const [body] = m.place.mock.calls[0]! as [Record<string, unknown>];
    expect(body.paymentMethod).toBe('BANK_TRANSFER');
    expect(m.replace).toHaveBeenCalledWith(`/thanh-toan/chuyen-khoan/TB9#k=${body.trackingKey as string}`);
  });

  it('bấm lại sau lỗi mạng: cùng Idempotency-Key và cùng khoá theo dõi', async () => {
    m.place.mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ code: 'TB5', status: 'PENDING', paymentMethod: 'COD', total: 240_000, codes: ['TB5'], keyAccepted: true });
    const r = await mount();
    await fillForm(r);
    click(placeButtons(r)[0]!);
    await flush(6);
    click(placeButtons(r)[0]!);
    await flush(6);
    expect(m.place).toHaveBeenCalledTimes(2);
    const [a, b] = m.place.mock.calls as [Record<string, unknown>, string][];
    expect(a![1]).toBe(b![1]);
    expect(a![0].trackingKey).toBe(b![0].trackingKey);
  });

  it('vượt trần: hiện câu của máy chủ kèm lối Đăng nhập Zalo, ở lại biểu mẫu', async () => {
    m.place.mockRejectedValue(new ApiError('Hiện chưa đặt thêm được đơn khi chưa đăng nhập. Bạn đăng nhập Zalo để đặt tiếp và theo dõi đơn ở một nơi nhé.', 403, 'GUEST_LIMIT'));
    const r = await mount();
    await fillForm(r);
    click(placeButtons(r)[0]!);
    await flush(6);
    const alert = r.container.querySelector('[data-testid="guest-place-error"]');
    expect(alert?.textContent).toContain('Hiện chưa đặt thêm được đơn khi chưa đăng nhập.');
    expect(byText(alert!, 'a', 'Đăng nhập Zalo')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fthanh-toan');
    expect(m.replace).not.toHaveBeenCalled();
  });
});

describe('/thanh-toan chưa đăng nhập: không giữ khung chờ khi máy chủ đã đọc sẵn cờ (P2-6)', () => {
  const mountWith = async (server: Record<string, unknown> | undefined) => {
    const r = render(
      <ServerGuestConfigProvider value={server}>
        <CheckoutPage />
      </ServerGuestConfigProvider>,
    );
    mounted.push(r);
    await flush(8);
    return r;
  };

  it('máy chủ không có cờ và /config/public chưa về: vẫn khung chờ như trước, chưa mời đăng nhập hay hiện form', async () => {
    m.configPending = true;
    const r = await mountWith(undefined);
    expect(r.container.textContent).not.toContain('Đăng nhập để thanh toán đơn hàng.');
    expect(r.container.querySelector('[data-testid="guest-checkout"]')).toBeNull();
  });

  it('máy chủ đọc cờ tắt, /config/public treo: mời đăng nhập ngay, không khung chờ', async () => {
    m.configPending = true;
    const r = await mountWith({ webGuestCheckoutEnabled: false, newCustomer: { welcomeVoucher: null } });
    expect(r.container.textContent).toContain('Đăng nhập để thanh toán đơn hàng.');
    expect(r.container.querySelector('[data-testid="guest-checkout"]')).toBeNull();
  });

  it('máy chủ đọc cờ bật, /config/public treo: form đặt không đăng nhập ngay, dòng mời ghi đúng quà đơn đầu', async () => {
    m.configPending = true;
    const r = await mountWith({ webGuestCheckoutEnabled: true, newCustomer: { welcomeVoucher: { amount: 30_000 } } });
    expect(r.container.querySelector('[data-testid="guest-checkout"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="guest-login-link"]')?.textContent).toContain('30.000đ');
    expect(r.container.textContent).not.toContain('Đăng nhập để thanh toán đơn hàng.');
  });

  it('bản của trình duyệt về thì theo bản đó (máy chủ còn cờ cũ đã tắt, trình duyệt thấy bật)', async () => {
    const r = await mountWith({ webGuestCheckoutEnabled: false, newCustomer: { welcomeVoucher: null } });
    expect(r.container.querySelector('[data-testid="guest-checkout"]')).not.toBeNull();
    expect(r.container.textContent).not.toContain('Đăng nhập để thanh toán đơn hàng.');
  });
});
