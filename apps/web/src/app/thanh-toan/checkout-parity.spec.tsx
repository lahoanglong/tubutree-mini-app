// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';
import { rememberCheckoutSelection, recallCheckoutSelection } from '@/lib/checkout-selection';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// R2-BUYERWEB-2/6/11: checkout web phải ngang Mini App — Ví Tubu, mua một phần giỏ, hoá đơn VAT, mã giới thiệu,
// ghi chú 500 ký tự, chặn hết hàng ngay ở thanh toán.

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const line = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, variationId: `v-${id}`, productName: name, variationName: null, slug: id, thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000, ...over,
});
const quote = (over: Record<string, unknown> = {}) => ({
  subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0, ...over,
});

const m = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  wallet: 50000,
  quote: vi.fn(),
  placeOrder: vi.fn(),
  touch: vi.fn(),
  ctx: { slug: null as string | null, referralCode: null as string | null, kind: null as string | null },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/storefront-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storefront-context')>()),
  getStorefrontContext: () => m.ctx,
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => {
    const subtotal = m.items.reduce((s, it) => s + (it.total as number), 0);
    return { items: m.items, couponCode: null, subtotal, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: m.items.length };
  },
  getMe: async () => ({ pointsBalance: 0, walletBalance: m.wallet }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
  recordReferralTouch: (...args: unknown[]) => m.touch(...args),
  getPublicConfig: async () => ({ recyclingEnabled: true }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const placeButton = (r: Rendered) => byText(r.container, 'button', 'Đặt hàng') as HTMLButtonElement;
const radio = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))?.querySelector('input') as HTMLInputElement | undefined;
const checkbox = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input[type="checkbox"]') as HTMLInputElement;
const field = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input') as HTMLInputElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.items = [line('i1', 'Dầu gội')];
  m.wallet = 50000;
  m.ctx = { slug: null, referralCode: null, kind: null };
  m.quote.mockReset().mockResolvedValue(quote());
  m.placeOrder.mockReset().mockReturnValue(new Promise(() => undefined));
  m.touch.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — Ví Tubu (R2-BUYERWEB-2)', () => {
  it('liệt kê Ví Tubu kèm số dư; đủ tiền thì chọn được và đặt đơn gửi WALLET', async () => {
    m.quote.mockResolvedValue(quote({ total: 40000 }));
    const r = await mount();
    const wallet = radio(r, 'Ví Tubu')!;
    expect(r.container.textContent).toContain('Ví Tubu (50.000đ)');
    expect(wallet.disabled).toBe(false);
    click(wallet);
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'WALLET' });
  });

  it('thiếu tiền: mờ kèm lý do thiếu bao nhiêu, không chọn được', async () => {
    const r = await mount();
    const wallet = radio(r, 'Ví Tubu')!;
    expect(wallet.disabled).toBe(true);
    expect(r.container.querySelector(`#${wallet.getAttribute('aria-describedby')}`)!.textContent).toBe('Số dư chưa đủ — cần thêm 80.000đ');
  });

  it('đang chọn Ví mà tổng đơn tăng vượt số dư (bỏ dùng điểm) → tự về COD', async () => {
    m.quote.mockImplementation(async (_addr: string, points: number) =>
      points > 0
        ? quote({ total: 40000, pointsUsed: 500, pointsDiscount: 90000, pointsBalance: 500, redeemablePoints: 500 })
        : quote({ total: 130000, pointsBalance: 500, redeemablePoints: 500 }),
    );
    const r = await mount();
    click(checkbox(r, 'Điểm Xanh'));
    await flush(4);
    click(radio(r, 'Ví Tubu')!);
    expect(radio(r, 'Ví Tubu')!.checked).toBe(true);
    click(checkbox(r, 'Điểm Xanh'));
    await flush(4);
    expect(radio(r, 'Ví Tubu')!.disabled).toBe(true);
    expect(radio(r, 'Ví Tubu')!.checked).toBe(false);
    expect(radio(r, 'Thanh toán khi nhận hàng')!.checked).toBe(true);
  });

  it('giỏ có hàng đối tác tự giao: chuyển khoản bị khoá nhưng Ví vẫn dùng được (D4)', async () => {
    m.quote.mockResolvedValue(quote({ total: 40000, blockedPaymentMethods: { BANK_TRANSFER: 'Chỉ COD hoặc Ví Tubu.' } }));
    const r = await mount();
    expect(radio(r, 'Chuyển khoản ngân hàng')!.disabled).toBe(true);
    expect(radio(r, 'Ví Tubu')!.disabled).toBe(false);
  });

  it('R-28: số dư 0đ (kể cả chưa lấy được số dư) ẩn dòng Ví Tubu, không crash', async () => {
    m.wallet = 0;
    const r = await mount();
    expect(radio(r, 'Ví Tubu')).toBeUndefined();
    expect(r.container.textContent).not.toContain('Số dư chưa đủ');
  });
});

describe('/thanh-toan — mua một phần giỏ (R2-BUYERWEB-6)', () => {
  beforeEach(() => {
    m.items = [line('i1', 'Dầu gội'), line('i2', 'Xà phòng', { total: 60000, unitPrice: 60000 })];
  });

  it('không có lựa chọn nhớ: báo giá và đặt đơn cho toàn giỏ (không gửi itemIds)', async () => {
    const r = await mount();
    expect(m.quote.mock.calls[0]![3]).toBeUndefined();
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0].itemIds).toBeUndefined();
  });

  it('lựa chọn từ giỏ: chỉ liệt kê, báo giá và đặt đơn cho dòng đã chọn', async () => {
    rememberCheckoutSelection(['i2']);
    const r = await mount();
    const region = r.container.querySelector('[aria-label="Sản phẩm trong đơn"]')!;
    expect(region.textContent).toContain('Xà phòng');
    expect(region.textContent).not.toContain('Dầu gội');
    expect(m.quote.mock.calls[0]![3]).toEqual(['i2']);
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ itemIds: ['i2'] });
    expect(r.container.textContent).toContain('Đang thanh toán 1/2 sản phẩm trong giỏ');
    expect(byText(r.container, 'a', 'Đổi lựa chọn')?.getAttribute('href')).toBe('/gio-hang');
  });

  it('lựa chọn nhắc dòng đã bị xoá khỏi giỏ → bỏ dòng đó; hết dòng → toàn giỏ', async () => {
    rememberCheckoutSelection(['gone']);
    const r = await mount();
    expect(m.quote.mock.calls[0]![3]).toBeUndefined();
    expect(r.container.querySelector('[aria-label="Sản phẩm trong đơn"]')!.textContent).toContain('Dầu gội');
  });

  it('đặt xong dọn lựa chọn để đơn sau không dính', async () => {
    rememberCheckoutSelection(['i2']);
    m.placeOrder.mockResolvedValue({ code: 'TB1', status: 'CONFIRMED', total: 90000, paymentMethod: 'COD', items: [] });
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    expect(recallCheckoutSelection()).toBeUndefined();
  });
});

describe('/thanh-toan — hoá đơn VAT (R2-BUYERWEB-6)', () => {
  it('mặc định không gửi invoiceRequest', async () => {
    const r = await mount();
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0].invoiceRequest).toBeUndefined();
  });

  it('bật yêu cầu: khoá đặt hàng tới khi đủ MST, tên, địa chỉ, email đúng; rồi gửi kèm đơn', async () => {
    const r = await mount();
    click(checkbox(r, 'Yêu cầu xuất hoá đơn VAT'));
    await flush(1);
    expect(placeButton(r).disabled).toBe(true);
    expect(r.container.textContent).toContain('Vui lòng điền đủ MST, tên công ty, địa chỉ và email hợp lệ.');
    typeInto(field(r, 'Mã số thuế'), ' 0312345678 ');
    typeInto(field(r, 'Tên công ty'), 'Công ty A');
    typeInto(field(r, 'Địa chỉ xuất hoá đơn'), '1 Phố Huế, Hà Nội');
    typeInto(field(r, 'Email nhận hoá đơn'), 'ketoan@');
    expect(placeButton(r).disabled).toBe(true);
    typeInto(field(r, 'Email nhận hoá đơn'), 'ketoan@a.vn');
    expect(placeButton(r).disabled).toBe(false);
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0].invoiceRequest).toEqual({
      taxCode: '0312345678', companyName: 'Công ty A', address: '1 Phố Huế, Hà Nội', email: 'ketoan@a.vn',
    });
  });

  it('nhớ thông tin hoá đơn cho lần sau sau khi đặt xong', async () => {
    m.placeOrder.mockResolvedValue({ code: 'TB1', status: 'CONFIRMED', total: 130000, paymentMethod: 'COD', items: [] });
    const r = await mount();
    click(checkbox(r, 'Yêu cầu xuất hoá đơn VAT'));
    typeInto(field(r, 'Mã số thuế'), '0312345678');
    typeInto(field(r, 'Tên công ty'), 'Công ty A');
    typeInto(field(r, 'Địa chỉ xuất hoá đơn'), '1 Phố Huế');
    typeInto(field(r, 'Email nhận hoá đơn'), 'ketoan@a.vn');
    click(placeButton(r));
    await flush(6);
    expect(JSON.parse(localStorage.getItem('tubu_invoice:u')!)).toMatchObject({ taxCode: '0312345678' });
    expect(localStorage.getItem('tubu_invoice')).toBeNull();
  });

  it('thông tin hoá đơn của tài khoản khác trên cùng trình duyệt không được điền sẵn', async () => {
    localStorage.setItem('tubu_invoice', JSON.stringify({ taxCode: '0100000001', companyName: 'Cũ', address: 'x', email: 'cu@a.vn' }));
    localStorage.setItem('tubu_invoice:other', JSON.stringify({ taxCode: '0100000002', companyName: 'Người khác', address: 'y', email: 'k@a.vn' }));
    localStorage.setItem('tubu_invoice:u', JSON.stringify({ taxCode: '0312345678', companyName: 'Công ty A', address: '1 Phố Huế', email: 'ketoan@a.vn' }));
    const r = await mount();
    click(checkbox(r, 'Yêu cầu xuất hoá đơn VAT'));
    expect(field(r, 'Mã số thuế').value).toBe('0312345678');
    expect(field(r, 'Tên công ty').value).toBe('Công ty A');
  });
});

describe('/thanh-toan — mã giới thiệu CTV (R2-BUYERWEB-6)', () => {
  it('nhập mã, máy chủ xác nhận → gửi kèm đơn dạng chữ hoa không khoảng trắng', async () => {
    const r = await mount();
    click(byText(r.container, 'button', 'Nhập mã'));
    typeInto(r.container.querySelector('input[aria-label="Mã người giới thiệu"]'), ' ctv 01 ');
    click(byText(r.container.querySelector('section[aria-label="Mã người giới thiệu"]')!, 'button', 'Áp dụng'));
    await flush(4);
    expect(m.touch).toHaveBeenCalledWith({ referralCode: 'CTV01', kind: 'ctv' });
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ referralCode: 'CTV01' });
  });

  it('mã không tồn tại hoặc là mã của chính mình → báo lỗi, không gửi mã', async () => {
    m.touch.mockResolvedValue({ ok: false });
    const r = await mount();
    click(byText(r.container, 'button', 'Nhập mã'));
    typeInto(r.container.querySelector('input[aria-label="Mã người giới thiệu"]'), 'SAI');
    click(byText(r.container.querySelector('section[aria-label="Mã người giới thiệu"]')!, 'button', 'Áp dụng'));
    await flush(4);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Không tìm thấy mã này');
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0].referralCode).toBeUndefined();
  });

  it('đang mua qua link giới thiệu: hiện mã gắn sẵn, không cho nhập đè và vẫn gửi kèm đơn', async () => {
    m.ctx = { slug: 'ctv-an', referralCode: 'AN123', kind: 'CTV' };
    const r = await mount();
    expect(r.container.textContent).toContain('AN123');
    expect(r.container.textContent).toContain('Bạn đang mua qua link giới thiệu');
    expect(byText(r.container, 'button', 'Nhập mã')).toBeNull();
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ referralCode: 'AN123' });
  });
});

describe('/thanh-toan — ghi chú (BUYERWEB-20)', () => {
  it('cho nhập tới 500 ký tự như Mini App và API', async () => {
    const r = await mount();
    const note = r.container.querySelector('textarea')!;
    expect(note.maxLength).toBe(500);
    expect(r.container.textContent).toContain('0/500 ký tự');
  });
});

describe('/thanh-toan — hết hàng (R2-BUYERWEB-11)', () => {
  it('vào thẳng khi có dòng hết hàng: cảnh báo ngay, khoá đặt hàng, có nút về giỏ', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    const r = await mount();
    const alert = r.container.querySelector('[data-testid="checkout-cart-issue"]')!;
    expect(alert.textContent).toContain('Dầu gội');
    expect(alert.textContent).toContain('đã hết hàng');
    expect(alert.querySelector('a[href="/gio-hang"]')?.textContent).toBe('Về giỏ hàng để sửa');
    expect(placeButton(r).disabled).toBe(true);
  });

  it('vượt tồn kho: nói còn bao nhiêu', async () => {
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 2 })];
    const r = await mount();
    expect(r.container.querySelector('[data-testid="checkout-cart-issue"]')!.textContent).toContain('chỉ còn 2');
    expect(placeButton(r).disabled).toBe(true);
  });

  it('chỉ kiểm các dòng đang thanh toán: dòng hết hàng ngoài lựa chọn không chặn', async () => {
    m.items = [line('i1', 'Dầu gội'), line('i2', 'Mật ong', { stock: 0 })];
    rememberCheckoutSelection(['i1']);
    const r = await mount();
    expect(r.container.querySelector('[data-testid="checkout-cart-issue"]')).toBeNull();
    expect(placeButton(r).disabled).toBe(false);
  });

  it('BE từ chối vì không đủ tồn kho lúc đặt → lỗi kèm nút về giỏ và tải lại giỏ', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('Sản phẩm "Dầu gội" không đủ tồn kho.', 400));
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    const alert = r.container.querySelector('[data-testid="checkout-cart-issue"]')!;
    expect(alert.textContent).toContain('không đủ tồn kho');
    expect(alert.querySelector('a[href="/gio-hang"]')).not.toBeNull();
  });

  it('lỗi khác không kèm nút về giỏ', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('Địa chỉ không hợp lệ.', 400));
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    expect(r.container.querySelector('[data-testid="checkout-cart-issue"]')).toBeNull();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Địa chỉ không hợp lệ.');
  });
});

describe('/thanh-toan — COD theo từng đơn, báo giá quyết định phương thức dùng được (R4-CHECKOUT-2)', () => {
  const COD_OVER =
    'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.000đ. Vui lòng chuyển khoản hoặc trả bằng Ví Tubu.';
  const COD_SPLIT_OVER =
    'Thanh toán khi nhận hàng (COD) chỉ nhận mỗi đơn tối đa 5.000.000đ, mà đơn do Tubu Tree giao là 5.400.000đ. Bạn có thể trả bằng Ví Tubu nếu số dư đủ, hoặc đặt riêng phần hàng Tubu Tree giao để chuyển khoản.';
  const SPLIT = 'Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.';
  const BOTH_BLOCKED = { total: 5600000, blockedPaymentMethods: { COD: COD_SPLIT_OVER, BANK_TRANSFER: SPLIT } };

  it('COD bị khoá: dòng COD mờ kèm đúng lý do máy chủ, tự chọn chuyển khoản, đặt hàng gửi BANK_TRANSFER', async () => {
    m.quote.mockResolvedValue(quote({ total: 5400000, blockedPaymentMethods: { COD: COD_OVER } }));
    const r = await mount();
    const cod = radio(r, 'Thanh toán khi nhận hàng')!;
    expect(cod.disabled).toBe(true);
    expect(cod.checked).toBe(false);
    expect(r.container.querySelector(`#${cod.getAttribute('aria-describedby')}`)!.textContent).toBe(COD_OVER);
    expect(radio(r, 'Chuyển khoản ngân hàng')!.checked).toBe(true);
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'BANK_TRANSFER' });
  });

  it('COD và chuyển khoản đều khoá, Ví thiếu: không chọn gì, nút Đặt hàng khoá, nói rõ chưa có cách thanh toán', async () => {
    m.wallet = 1000;
    m.quote.mockResolvedValue(quote(BOTH_BLOCKED));
    const r = await mount();
    for (const label of ['Thanh toán khi nhận hàng', 'Chuyển khoản ngân hàng', 'Ví Tubu']) {
      expect(radio(r, label)!.disabled).toBe(true);
      expect(radio(r, label)!.checked).toBe(false);
    }
    expect(r.container.textContent).toContain('Đơn này chưa có cách thanh toán dùng được. Xem hướng dẫn dưới từng cách thanh toán ở trên.');
    expect(placeButton(r).disabled).toBe(true);
  });

  it('COD và chuyển khoản đều khoá, Ví đủ: không tự trừ Ví, nhắc chọn; khách chọn Ví thì đặt được và gửi WALLET', async () => {
    m.wallet = 9000000;
    m.quote.mockResolvedValue(quote(BOTH_BLOCKED));
    const r = await mount();
    expect(radio(r, 'Ví Tubu')!.checked).toBe(false);
    expect(r.container.textContent).toContain('Chọn một cách thanh toán cho đơn này để đặt hàng.');
    expect(placeButton(r).disabled).toBe(true);
    click(radio(r, 'Ví Tubu')!);
    await flush(2);
    expect(r.container.textContent).not.toContain('Chọn một cách thanh toán cho đơn này để đặt hàng.');
    expect(placeButton(r).disabled).toBe(false);
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'WALLET' });
  });
});

describe('/thanh-toan — web không còn công tắc thu gom cũ (§12.2, §13.2)', () => {
  it('API cũ còn trả recyclingEnabled: true vẫn không hiện công tắc, không có lời mời "pin, quần áo cũ", đặt đơn không gửi trường thu gom', async () => {
    const r = await mount();
    expect(r.container.querySelector('#checkout-recycling')).toBeNull();
    expect(r.container.textContent).not.toContain('Gửi lại vật liệu tái chế');
    expect(r.container.textContent).not.toContain('quần áo cũ');
    click(placeButton(r));
    await flush(4);
    const body = m.placeOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('hasRecyclingPickup');
    expect(body).not.toHaveProperty('recyclingNote');
    expect(body).not.toHaveProperty('wasteRequestId');
  });

  it('mã web khách không còn nhắc recyclingEnabled (trừ cấu hình Gomdon của admin)', () => {
    const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(n)) out.push(p);
      }
      return out;
    };
    const offenders = walk(SRC)
      .filter((f) => !f.includes(`${join('components', 'admin')}`) && !f.endsWith(join('lib', 'admin-client.ts')) && !f.endsWith('checkout-parity.spec.tsx'))
      .filter((f) => readFileSync(f, 'utf-8').includes('recyclingEnabled'));
    expect(offenders).toEqual([]);
  });
});
