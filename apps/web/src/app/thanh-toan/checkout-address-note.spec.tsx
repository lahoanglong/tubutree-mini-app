// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { NetworkError } from '@/lib/client-api';

// BUYERWEB-14 (sửa địa chỉ ngay tại thanh toán), BUYERWEB-20 (phí ship/tổng khi chưa có địa chỉ, ô ghi chú đơn),
// BUYERWEB-12 (mất mạng lúc đặt đơn).

const SUBTOTAL = 300000;
const mocks = vi.hoisted(() => ({
  addresses: [] as Record<string, unknown>[],
  placeCalls: [] as { body: Record<string, unknown>; key: string }[],
  placeImpl: null as null | (() => Promise<unknown>),
  updateAddress: vi.fn(),
  quoteCalls: 0,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: SUBTOTAL, quantity: 1, stock: 5, total: SUBTOTAL }],
    couponCode: null, subtotal: SUBTOTAL, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => mocks.addresses,
  updateAddress: mocks.updateAddress,
  checkoutQuote: async () => {
    mocks.quoteCalls += 1;
    return { subtotal: SUBTOTAL, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: SUBTOTAL + 30000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
  },
  placeOrder: async (body: Record<string, unknown>, key: string) => {
    mocks.placeCalls.push({ body, key });
    if (mocks.placeImpl) return mocks.placeImpl();
    return { id: 'o1', code: 'TB-1', total: SUBTOTAL + 30000, status: 'CONFIRMED', paymentMethod: 'COD' };
  },
}));

import CheckoutPage from './page';

const ADDR = {
  id: 'a1', recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_001', isDefault: true,
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const btn = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name) as HTMLButtonElement | undefined;
const rowValue = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('div.flex')).find((d) => d.firstElementChild?.textContent === label)?.lastElementChild?.textContent;

beforeEach(() => {
  mocks.addresses = [ADDR];
  mocks.placeCalls = [];
  mocks.placeImpl = null;
  mocks.quoteCalls = 0;
  mocks.updateAddress.mockReset().mockResolvedValue(ADDR);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — khách chưa có địa chỉ (BUYERWEB-20)', () => {
  it('phí vận chuyển nhắc nhập địa chỉ thay vì "…", tổng ghi "Chưa tính", nút Đặt hàng khoá', async () => {
    mocks.addresses = [];
    const c = await mount();
    expect(rowValue(c, 'Phí vận chuyển')).toBe('Nhập địa chỉ để tính phí');
    expect(c.textContent).toContain('Chưa tính');
    expect(c.textContent).not.toContain('…');
    expect(btn(c, 'Đặt hàng')!.disabled).toBe(true);
  });

  it('có địa chỉ: hiện phí ship và tổng thật', async () => {
    const c = await mount();
    expect(rowValue(c, 'Phí vận chuyển')).toBe('30.000đ');
    expect(c.textContent).toContain('330.000đ');
  });
});

describe('/thanh-toan — ghi chú đơn hàng (BUYERWEB-20)', () => {
  it('ghi chú đi cùng đơn đã cắt khoảng trắng, giới hạn 500 ký tự như Mini App', async () => {
    const c = await mount();
    const note = c.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(note.maxLength).toBe(500);
    typeInto(note, '  Gọi trước khi giao, gửi ở bảo vệ  ');
    expect(c.textContent).toContain('36/500 ký tự');
    click(btn(c, 'Đặt hàng')!);
    await flush(8);
    expect(mocks.placeCalls).toHaveLength(1);
    expect(mocks.placeCalls[0]!.body.note).toBe('Gọi trước khi giao, gửi ở bảo vệ');
  });

  it('không nhập ghi chú: body không có khoá note', async () => {
    const c = await mount();
    typeInto(c.querySelector('textarea'), '   ');
    click(btn(c, 'Đặt hàng')!);
    await flush(8);
    expect('note' in mocks.placeCalls[0]!.body).toBe(false);
  });
});

describe('/thanh-toan — mất mạng lúc đặt đơn (BUYERWEB-12)', () => {
  it('báo lỗi mạng, giải thích có thể đã ghi nhận + không tạo đơn trùng, dẫn tới Đơn của tôi; bấm lại dùng cùng khoá chống trùng', async () => {
    mocks.placeImpl = () => Promise.reject(new NetworkError(false));
    const c = await mount();
    click(btn(c, 'Đặt hàng')!);
    await flush(8);
    const alert = c.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Mất kết nối');
    expect(alert.textContent).toContain('không tạo thêm đơn');
    expect(alert.querySelector('a[href="/tai-khoan/don-hang"]')).not.toBeNull();
    expect(btn(c, 'Đặt hàng')!.disabled).toBe(false);
    click(btn(c, 'Đặt hàng')!);
    await flush(8);
    expect(mocks.placeCalls).toHaveLength(2);
    expect(mocks.placeCalls[1]!.key).toBe(mocks.placeCalls[0]!.key);
  });

  it('lỗi nghiệp vụ của BE không kèm lời giải thích mất mạng', async () => {
    mocks.placeImpl = () => Promise.reject(new Error('Sản phẩm đã hết hàng.'));
    const c = await mount();
    click(btn(c, 'Đặt hàng')!);
    await flush(8);
    const alert = c.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('Sản phẩm đã hết hàng.');
  });
});

describe('/thanh-toan — sửa địa chỉ ngay tại chỗ (BUYERWEB-14)', () => {
  it('có nút Sửa cạnh mỗi địa chỉ và lối vào Sổ địa chỉ', async () => {
    const c = await mount();
    expect(btn(c, 'Sửa địa chỉ của Nguyễn An')).toBeDefined();
    expect(c.querySelector('a[href="/tai-khoan/dia-chi"]')?.textContent).toBe('Quản lý sổ địa chỉ');
  });

  it('sửa SĐT: PATCH đúng id, form đóng và báo giá được tính lại', async () => {
    const c = await mount();
    const before = mocks.quoteCalls;
    click(btn(c, 'Sửa địa chỉ của Nguyễn An')!);
    await flush(4);
    const phone = Array.from(c.querySelectorAll('form label')).find((l) => l.textContent?.includes('Số điện thoại'))!.querySelector('input')!;
    expect(phone.value).toBe('0912345678');
    typeInto(phone, '0911 222 333');
    click(btn(c, 'Lưu thay đổi')!);
    await flush(8);
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    expect(mocks.updateAddress.mock.calls[0]![0]).toBe('a1');
    expect(mocks.updateAddress.mock.calls[0]![1]).toMatchObject({ phone: '0911222333' });
    expect(c.querySelector('form')).toBeNull();
    expect(mocks.quoteCalls).toBeGreaterThan(before);
  });

  it('SĐT sai: không gọi PATCH, ô được đánh dấu và có lời nhắc', async () => {
    const c = await mount();
    click(btn(c, 'Sửa địa chỉ của Nguyễn An')!);
    await flush(4);
    const phone = Array.from(c.querySelectorAll('form label')).find((l) => l.textContent?.includes('Số điện thoại'))!.querySelector('input')!;
    typeInto(phone, '091');
    click(btn(c, 'Lưu thay đổi')!);
    await flush(4);
    expect(mocks.updateAddress).not.toHaveBeenCalled();
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(c.textContent).toContain('Số điện thoại chưa đúng');
  });
});
