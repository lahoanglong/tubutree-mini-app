// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Chép ý nghĩa new-customer-gift.spec của Mini App (D2-07b): khối "Quà khách mới".
const mocks = vi.hoisted(() => ({ get: vi.fn(), phase: 'authenticated', restoring: false }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => mocks.restoring }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { NewCustomerGift } from './new-customer-gift';

// Số cố ý KHÁC mọi mặc định trong mã: nếu khối còn viết cứng 30.000đ/199.000đ/10.000đ/12% thì test đỏ.
const CONFIG = {
  freeshipThreshold: 350_000,
  subscribeDiscountPct: 0.17,
  affiliateWalletMultiplier: 1,
  affiliateMinWithdrawBank: 50_000,
  cashbackHoldDays: 30,
  newCustomer: {
    welcomeVoucher: { amount: 25_000, minOrder: 150_000 },
    firstOrderFreeShip: { enabled: false, minSubtotal: 0 },
  },
  loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000 },
};
const VOUCHER = { code: 'WELCOME-U1', type: 'AMOUNT' as const, value: 25_000, minOrder: 150_000, endAt: '2026-11-17T10:00:00.000Z' };
const OFFER = { isNewCustomer: true, welcomeVoucher: VOUCHER };

let config: unknown;
let offer: unknown;
const never = () => new Promise(() => undefined);
const failure = () => Promise.reject(new Error('boom'));
const paths = () => mocks.get.mock.calls.map(([p]) => p as string);

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<NewCustomerGift />);
  await flush(8);
  return mounted.container;
};
const region = (c: HTMLElement) => c.querySelector('section[aria-label="Quà khách mới"]');

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.restoring = false;
  config = CONFIG;
  offer = OFFER;
  mocks.get.mockReset().mockImplementation((path: string) => {
    const v = path === '/config/public' ? config : path === '/me/new-customer-offer' ? offer : undefined;
    if (v === undefined) return Promise.reject(new Error(`đường dẫn lạ ${path}`));
    return typeof v === 'function' ? (v as () => Promise<unknown>)() : Promise.resolve(v);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('NewCustomerGift — khối "Quà khách mới" ở Trang chủ (D2-07b)', () => {
  it('khách chưa có đơn + có voucher: hiện voucher (mức, đơn tối thiểu, hạn) và 3 lợi ích, số đọc từ cấu hình', async () => {
    const text = region(await mount())!.textContent!;
    expect(text).toContain('Mã giảm giá chào mừng 25.000đ');
    expect(text).toContain('Cho đơn từ 150.000đ');
    expect(text).toContain('Dùng đến 17/11/2026');
    expect(text).toContain('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(text).toContain('Mỗi đơn tích 2% tiền hàng thành Điểm Xanh, 1 điểm = 1.000đ');
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
    expect(text).not.toMatch(/30\.000|199\.000|10\.000đ|12%/);
  });

  it('voucher theo phần trăm và miễn phí giao', async () => {
    offer = { isNewCustomer: true, welcomeVoucher: { ...VOUCHER, type: 'PERCENT', value: 15 } };
    expect(region(await mount())!.textContent).toContain('Mã giảm giá chào mừng 15%');
    mounted!.unmount();
    offer = { isNewCustomer: true, welcomeVoucher: { ...VOUCHER, type: 'FREESHIP' } };
    expect(region(await mount())!.textContent).toContain('Mã miễn phí giao hàng chào mừng');
  });

  it('freeship đơn đầu bật → lợi ích giao hàng nói đơn đầu (kèm ngưỡng nếu có), thay cho ngưỡng freeship thường', async () => {
    config = { ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 0 } } };
    let text = region(await mount())!.textContent!;
    expect(text).toContain('Miễn phí giao hàng cho đơn đầu tiên');
    expect(text).not.toContain('đơn từ 350.000đ');
    mounted!.unmount();
    config = { ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 99_000 } } };
    text = region(await mount())!.textContent!;
    expect(text).toContain('Miễn phí giao hàng cho đơn đầu tiên từ 99.000đ');
  });

  it('voucher không có đơn tối thiểu → không in "Cho đơn từ 0đ"', async () => {
    offer = { isNewCustomer: true, welcomeVoucher: { ...VOUCHER, minOrder: null } };
    const text = region(await mount())!.textContent!;
    expect(text).toContain('Mã giảm giá chào mừng 25.000đ');
    expect(text).not.toContain('Cho đơn từ');
  });

  it('khách mới nhưng chưa có voucher: chỉ còn 3 lợi ích, không có dòng voucher', async () => {
    offer = { isNewCustomer: true, welcomeVoucher: null };
    const text = region(await mount())!.textContent!;
    expect(text).not.toContain('Mã giảm giá chào mừng');
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('khách đã có đơn (theo API) → không hiện gì', async () => {
    offer = { isNewCustomer: false, welcomeVoucher: null };
    const c = await mount();
    expect(paths()).toContain('/me/new-customer-offer');
    expect(c.textContent).toBe('');
  });

  it('đang tải ưu đãi hoặc cấu hình: không vẽ gì, kể cả khung chờ (để trang không nhảy với khách đã có đơn)', async () => {
    offer = never;
    expect((await mount()).textContent).toBe('');
    mounted!.unmount();
    offer = OFFER;
    config = never;
    expect((await mount()).textContent).toBe('');
  });

  it('lỗi tải ưu đãi hoặc cấu hình → ẩn khối (khối quảng bá phụ, không đáng một thẻ lỗi), không bịa số', async () => {
    offer = failure;
    expect((await mount()).textContent).toBe('');
    mounted!.unmount();
    offer = OFFER;
    config = failure;
    expect((await mount()).textContent).toBe('');
  });

  it('API cũ chưa trả loyalty/newCustomer → lợi ích thiếu số bị bỏ, không bịa', async () => {
    const { loyalty: _l, newCustomer: _n, ...old } = CONFIG;
    config = old;
    const text = region(await mount())!.textContent!;
    expect(text).not.toContain('Điểm Xanh');
    expect(text).toContain('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('chưa đăng nhập: không gọi API khách, vẫn hiện 3 lợi ích (không có voucher)', async () => {
    mocks.phase = 'guest';
    const text = region(await mount())!.textContent!;
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
    expect(text).not.toContain('Mã giảm giá chào mừng');
    expect(paths()).not.toContain('/me/new-customer-offer');
  });

  it('đang khôi phục phiên hoặc mất mạng lúc khôi phục: không hiện bản khách vãng lai rồi biến mất, không gọi API', async () => {
    for (const [phase, restoring] of [['loading', true], ['unavailable', false]] as const) {
      mocks.phase = phase;
      mocks.restoring = restoring;
      expect((await mount()).textContent).toBe('');
      mounted!.unmount();
    }
    expect(paths()).not.toContain('/me/new-customer-offer');
  });

  it('chưa biết phiên nhưng KHÔNG có cờ phiên (khách vãng lai ở HTML server): vẫn hiện 3 lợi ích, không gọi API khách', async () => {
    mocks.phase = 'loading';
    mocks.restoring = false;
    const text = (await mount()).textContent ?? '';
    expect(text).toContain('Đặt định kỳ giảm 17% mỗi đơn');
    expect(paths()).not.toContain('/me/new-customer-offer');
  });

  it('nút "Chọn sản phẩm" mở trang mua sắm /san-pham', async () => {
    const c = await mount();
    const link = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Chọn sản phẩm')!;
    expect(link.getAttribute('href')).toBe('/san-pham');
  });
});
