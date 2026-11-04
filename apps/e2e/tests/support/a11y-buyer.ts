import type { Locator, Page } from '@playwright/test';
import { reply, type MockApi } from './mock-api';

/** Khách đã đăng nhập + giỏ nhiều dòng, đủ để dựng các màn mua sắm/tài khoản của web khách mà không cần DB (dùng cho a11y-wcag22 và a11y-shop). */
export const BUYER = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER', avatarUrl: null, email: null, dob: null,
  onboarded: true, segments: [], pointsBalance: 120, pointsConvertedBalance: 0, walletBalance: 50_000,
};
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
export const ADDRESS = {
  id: 'a1', recipient: 'Nguyễn Văn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình',
  street: '12 Phố Huế', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
export const ADDRESS_2 = { ...ADDRESS, id: 'a2', recipient: 'Trần Thị Bình', street: '34 Hàng Bạc', isDefault: false };

export const cartLines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `i${i + 1}`, variationId: `v${i + 1}`, productName: `Sản phẩm số ${i + 1}`, variationName: '500ml', slug: `sp-${i + 1}`, thumbnail: null,
    unitPrice: 50_000, quantity: 1, stock: 8, weight: 300, total: 50_000, fulfiller: TUBU,
  }));

export interface BuyerOptions {
  lines?: number;
  /** /me/loyalty trả 500: hero Tài khoản hiện nút "Thử lại". */
  loyaltyFails?: boolean;
}

export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
}

export function mockBuyer(api: MockApi, opts: BuyerOptions = {}): void {
  const items = cartLines(opts.lines ?? 2);
  const subtotal = items.reduce((s, l) => s + l.total, 0);
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: BUYER }));
  api.get('/me', () => BUYER);
  api.get('/auth/me', () => ({ ...BUYER, ownsBrand: false }));
  api.get('/me/addresses', [ADDRESS, ADDRESS_2]);
  api.get('/me/coupons', []);
  api.get('/me/wishlist/ids', []);
  api.get('/me/notifications', []);
  api.get('/me/purchased-items', { items: [], nextCursor: null });
  api.get('/me/new-customer-offer', { isNewCustomer: false, welcomeVoucher: null });
  api.get('/dealer/me', { status: 'NONE', isDealer: false });
  api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
  api.get('/products', { data: [], meta: { page: 1, limit: 30, total: 0 } });
  api.get('/config/public', { freeshipThreshold: 500_000, aiAdvisorEnabled: false, support: { hotline: '0984606774', email: 'tubutree@gmail.com' }, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } });
  api.get('/flash-sales/active', []);
  api.get('/cart', { items, couponCode: null, subtotal, discount: 0, freeship: false, freeshipThreshold: 500_000, itemCount: items.length });
  api.post('/checkout/quote', {
    subtotal, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30_000, total: subtotal + 30_000, pointsEarned: 0, pointsBalance: 120, redeemablePoints: 120,
  });
  api.post('/checkout/coupon-previews', { previews: [] });
  if (opts.loyaltyFails) api.get('/me/loyalty', reply(500, { message: 'lỗi giả lập' }));
  else api.get('/me/loyalty', { tier: { name: 'Hạt Giống' }, pointsBalance: 120, pointsConvertedBalance: 0 });
  api.allowUnmocked('POST /coupons/preview', 'GET /coupons/available');
}

export interface RingMeasure {
  /** Màu viền focus tính ra (rgb) và độ dày. */
  ring: string;
  width: number;
  style: string;
  /** Tỉ lệ tương phản thấp nhất giữa viền và nền gần nhất không trong suốt (nền gradient: lấy màu tối nhất/sáng nhất xấu nhất). */
  ratio: number;
  background: string;
}

/**
 * Focus bằng bàn phím (Tab trước để bật chế độ `:focus-visible`) rồi đo viền focus so với nền đặc gần nhất đi lên cây cha.
 * Nền gradient: đo với từng màu dừng và lấy tỉ lệ thấp nhất. Dùng canvas để đổi mọi cú pháp màu (color-mix, oklch...) về rgb.
 */
export async function measureFocusRing(target: Locator, opts: { alreadyFocused?: boolean } = {}): Promise<RingMeasure> {
  if (!opts.alreadyFocused) {
    await target.page().keyboard.press('Tab');
    await target.focus();
  }
  return target.evaluate((el) => {
    const toRgba = (css: string): [number, number, number, number] => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const cs = getComputedStyle(el);
    const ring = toRgba(cs.outlineColor);
    let backgrounds: number[][] = [[255, 255, 255]];
    let shown = 'canvas';
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      const stops = s.backgroundImage.includes('gradient') ? (s.backgroundImage.match(/(?:rgba?|color)\([^)]*\)/g) ?? []) : [];
      if (stops.length > 0) {
        backgrounds = stops.map((c) => toRgba(c).slice(0, 3));
        shown = s.backgroundImage;
        break;
      }
      const c = toRgba(s.backgroundColor);
      if (c[3] === 1) {
        backgrounds = [c.slice(0, 3)];
        shown = s.backgroundColor;
        break;
      }
    }
    return {
      ring: cs.outlineColor,
      width: parseFloat(cs.outlineWidth),
      style: cs.outlineStyle,
      ratio: Math.min(...backgrounds.map((b) => ratio(ring.slice(0, 3), b))),
      background: shown,
    };
  });
}
