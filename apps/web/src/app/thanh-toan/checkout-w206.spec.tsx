// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// w2-06: địa chỉ một dòng + tấm chọn (đổi trong 2 chạm), giữ báo giá cũ khi đang tính lại, thẻ xem trước chuyển khoản sau cờ,
// gọi QR song song với việc chuyển sang trang QR.

const A1 = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const A2 = { ...A1, id: 'a2', recipient: 'Bình', phone: '0987654321', street: '2 Lê Lợi', isDefault: false };
const A3 = { ...A1, id: 'a3', recipient: 'Chi', phone: '0901111222', street: '3 Trần Phú', isDefault: false };
const quoteFor = (fee: number) => ({ subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: fee, total: 100000 + fee, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 });

const m = vi.hoisted(() => ({
  addresses: [] as unknown[],
  quote: vi.fn(),
  placeOrder: vi.fn(),
  bankQr: vi.fn(),
  preview: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  events: [] as [string, unknown][],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn(), prefetch: m.prefetch }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackWebEvent: (name: string, props: unknown) => m.events.push([name, props]),
}));
vi.mock('@tubutree/app-core/api/payment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/api/payment')>()),
  getTransferPreview: () => m.preview(),
}));
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
  getBankQr: (code: string) => m.bankQr(code),
}));

import CheckoutPage from './page';

import { loadCheckoutPanels } from '@/components/checkout/checkout-panels-load';

// Ô VAT, thẻ chuyển khoản, form địa chỉ và màn đặt xong tải lười (`checkout-panels-lazy`): nạp sẵn như trình duyệt đã tải lúc rảnh, để các khối dựng ngay ở lần vẽ đầu.
beforeAll(() => loadCheckoutPanels());

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const row = (r: Rendered) => r.container.querySelector<HTMLElement>('[data-testid="checkout-address-row"]')!;
const openSheet = async (r: Rendered) => {
  click(row(r).querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!);
  await flush(2);
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
};
const sheetRadios = (dlg: HTMLElement) => Array.from(dlg.querySelectorAll<HTMLElement>('[role="radio"]'));
const placeButton = (r: Rendered) => [...r.container.querySelectorAll('button')].find((b) => /^Đặt hàng/.test(b.textContent ?? ''))!;
const totalSpan = (r: Rendered) => r.container.querySelector<HTMLElement>('[data-ds="checkout-summary-total"]')!.lastElementChild as HTMLElement;
const payRadio = (r: Rendered, label: string) => [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  m.addresses = [A1, A2];
  m.quote.mockReset().mockImplementation(async (addressId: string) => quoteFor(addressId === 'a1' ? 30000 : 20000));
  m.placeOrder.mockReset();
  m.bankQr.mockReset().mockReturnValue(new Promise(() => undefined));
  m.preview.mockReset().mockResolvedValue({ enabled: true, bank: { name: 'Vietcombank', accountName: 'CONG TY TUBU' } });
  m.replace.mockReset();
  m.prefetch.mockReset();
  m.events = [];
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — đổi địa chỉ qua tấm chọn (w2-06)', () => {
  it('2 chạm: mở tấm, chọn địa chỉ khác → tấm đóng, dòng đổi, báo giá theo địa chỉ mới, ghi sự kiện không có dữ liệu cá nhân', async () => {
    const r = await mount();
    expect(row(r).textContent).toContain('An · 091****678');
    const dlg = await openSheet(r);
    click(sheetRadios(dlg).find((x) => x.textContent?.includes('Bình'))!);
    await flush(4);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(row(r).textContent).toContain('Bình · 098****321');
    expect(m.quote.mock.calls.at(-1)![0]).toBe('a2');
    expect(m.events).toContainEqual(['checkout_address_switched', { from: 'sheet' }]);
    expect(totalSpan(r).textContent).toBe('120.000đ');
  });

  it('chọn lại đúng địa chỉ đang dùng: chỉ đóng tấm, không tính lại, không ghi sự kiện', async () => {
    const r = await mount();
    const calls = m.quote.mock.calls.length;
    const dlg = await openSheet(r);
    click(sheetRadios(dlg).find((x) => x.getAttribute('aria-checked') === 'true')!);
    await flush(4);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(m.quote.mock.calls.length).toBe(calls);
    expect(m.events.filter(([n]) => n === 'checkout_address_switched')).toEqual([]);
  });

  it('thứ tự trong tấm: mặc định trước, rồi địa chỉ dùng gần nhất của đúng tài khoản; "Thêm địa chỉ mới" ở cuối', async () => {
    m.addresses = [A2, A3, A1];
    localStorage.setItem('tubu_recent_address_ids:u', JSON.stringify(['a3']));
    const r = await mount();
    const dlg = await openSheet(r);
    expect(sheetRadios(dlg).map((x) => x.textContent?.split(' · ')[0])).toEqual(['An', 'Chi', 'Bình']);
    const buttons = Array.from(dlg.querySelectorAll('button')).filter((b) => b.textContent?.trim());
    expect(buttons.at(-1)!.textContent?.trim()).toBe('Thêm địa chỉ mới');
  });

  it('đang tính lại: tổng cũ giữ nguyên nhưng mờ, nút Đặt hàng khoá, có chữ cho trình đọc; báo giá mới về thì mở', async () => {
    let resolveA2!: (v: unknown) => void;
    m.quote.mockImplementation((addressId: string) =>
      addressId === 'a1' ? Promise.resolve(quoteFor(30000)) : new Promise((res) => (resolveA2 = res)),
    );
    const r = await mount();
    expect(totalSpan(r).textContent).toBe('130.000đ');
    const dlg = await openSheet(r);
    click(sheetRadios(dlg).find((x) => x.textContent?.includes('Bình'))!);
    await flush(3);
    expect(totalSpan(r).textContent).toBe('130.000đ');
    expect(totalSpan(r).className).toMatch(/\bopacity-50\b/);
    expect(placeButton(r).disabled).toBe(true);
    expect(Array.from(r.container.querySelectorAll('[role="status"]')).some((s) => s.textContent === 'Đang tính lại…')).toBe(true);
    resolveA2(quoteFor(20000));
    await flush(4);
    expect(totalSpan(r).textContent).toBe('120.000đ');
    expect(totalSpan(r).className).not.toMatch(/\bopacity-50\b/);
    expect(placeButton(r).disabled).toBe(false);
  });

  it('báo giá địa chỉ mới lỗi: giữ địa chỉ mới, không giữ số cũ, có Thử lại', async () => {
    m.quote.mockImplementation(async (addressId: string) => {
      if (addressId === 'a1') return quoteFor(30000);
      throw new ApiError('Lỗi máy chủ', 500);
    });
    const r = await mount();
    const dlg = await openSheet(r);
    click(sheetRadios(dlg).find((x) => x.textContent?.includes('Bình'))!);
    await flush(6);
    expect(row(r).textContent).toContain('Bình');
    expect(r.container.textContent).toContain('Không tính được phí ship/tổng tiền.');
    expect([...r.container.querySelectorAll('button')].some((b) => b.textContent === 'Thử lại')).toBe(true);
    expect(totalSpan(r).textContent).not.toBe('130.000đ');
    expect(placeButton(r).disabled).toBe(true);
  });

  it('đặt đơn xong: địa chỉ vừa dùng được nhớ theo tài khoản để lên đầu tấm lần sau', async () => {
    m.placeOrder.mockResolvedValue({ id: 'o1', code: 'TB-1', total: 120000, status: 'CONFIRMED', paymentMethod: 'COD' });
    const r = await mount();
    const dlg = await openSheet(r);
    click(sheetRadios(dlg).find((x) => x.textContent?.includes('Bình'))!);
    await flush(4);
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ addressId: 'a2', expectedTotal: 120000 });
    expect(JSON.parse(localStorage.getItem('tubu_recent_address_ids:u')!)).toEqual(['a2']);
  });
});

describe('/thanh-toan — thẻ xem trước chuyển khoản (cờ checkout.transfer_preview_enabled)', () => {
  it('cờ bật: chọn Chuyển khoản thì hiện ngân hàng, chủ tài khoản, số tiền theo báo giá và lời hẹn QR; không có ảnh QR', async () => {
    const r = await mount();
    expect(r.container.querySelector('[data-testid="transfer-preview"]')).toBeNull();
    click(payRadio(r, 'Chuyển khoản'));
    await flush(4);
    const card = r.container.querySelector<HTMLElement>('[data-testid="transfer-preview"]')!;
    expect(card.textContent).toContain('Vietcombank');
    expect(card.textContent).toContain('CONG TY TUBU');
    expect(card.textContent).toContain('130.000đ');
    expect(card.textContent).toContain('Mã QR đúng số tiền và nội dung hiện ngay sau khi bạn bấm Đặt hàng.');
    expect(r.container.querySelector('img[alt="VietQR"]')).toBeNull();
    expect(m.events).toContainEqual(['transfer_preview_shown', {}]);
    expect(m.prefetch).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/_');
  });

  it('cờ tắt hoặc thiếu cấu hình ngân hàng: không có thẻ, không ghi sự kiện', async () => {
    m.preview.mockResolvedValue({ enabled: false, bank: null });
    const r = await mount();
    click(payRadio(r, 'Chuyển khoản'));
    await flush(4);
    expect(r.container.querySelector('[data-testid="transfer-preview"]')).toBeNull();
    expect(m.events.filter(([n]) => n === 'transfer_preview_shown')).toEqual([]);
  });

  it('đặt đơn chuyển khoản: gọi QR của đúng mã đơn ngay (dùng chung khoá với trang QR) rồi chuyển trang', async () => {
    m.placeOrder.mockResolvedValue({ id: 'o9', code: 'TB-9', total: 130000, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' });
    const r = await mount();
    click(payRadio(r, 'Chuyển khoản'));
    await flush(2);
    click(placeButton(r));
    await flush(6);
    expect(m.bankQr).toHaveBeenCalledTimes(1);
    expect(m.bankQr).toHaveBeenCalledWith('TB-9');
    expect(m.replace).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TB-9');
  });
});
