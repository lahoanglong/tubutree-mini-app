// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Nhãn ô "dùng Điểm Xanh" phải khớp số điểm backend thật sự trừ (đã áp trần % giá trị hàng), không phải
// số dư: khách 500 điểm thường, hàng 100.000đ, trần 20% → trừ 20 điểm chứ không phải 500.

const SUBTOTAL = 100000;
const calls = vi.hoisted(() => ({ pointsToUse: [] as number[], extra: { pointsMax: 10_000 } as Record<string, unknown>, used: 20 }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [
      { id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: SUBTOTAL, quantity: 1, stock: 5, total: SUBTOTAL },
    ],
    couponCode: null, subtotal: SUBTOTAL, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
  ],
  checkoutQuote: async (_addr: string, pointsToUse: number) => {
    calls.pointsToUse.push(pointsToUse);
    const used = pointsToUse > 0 ? calls.used : 0;
    return {
      subtotal: SUBTOTAL, discount: 0, pointsUsed: used, pointsDiscount: used * 1000, shippingFee: 30000,
      total: SUBTOTAL - used * 1000 + 30000, pointsEarned: 0, pointsBalance: 500, redeemablePoints: 500,
      ...calls.extra,
    };
  },
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  calls.pointsToUse = [];
  calls.extra = { pointsMax: 10_000 };
  calls.used = 20;
});

const NOTE = 'Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác';

describe('/thanh-toan — nhãn dùng Điểm Xanh', () => {
  it('chưa tick: "Dùng 500 điểm, giảm 500đ"; tick xong: đúng 20 điểm thật trừ, không còn ghi 500', async () => {
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    const pointsLabel = () =>
      [...r.container.querySelectorAll('label')].find((l) => l.querySelector('input[type="checkbox"]') && /Điểm Xanh/.test(l.textContent ?? ''))!;
    const label = () => pointsLabel().textContent ?? '';
    expect(label()).toContain('Dùng 500 điểm, giảm 500đ');

    click(pointsLabel().querySelector<HTMLInputElement>('input')!);
    await flush(8);
    expect(calls.pointsToUse).toContain(500);
    expect(label()).toContain('Dùng 20 điểm, giảm 20.000đ');
    expect(label()).not.toContain('500');
  });

  it('R4-BUYER-2: giỏ chỉ hàng Tubu, trần của đơn thấp hơn số dư → nêu trần ngay khi chưa tick', async () => {
    calls.extra = { pointsMax: 20, pointsPartnerNote: null };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Dùng 20 điểm, giảm 20đ');
    expect(r.container.textContent).toContain('Đơn này dùng tối đa 20 Điểm Xanh, tính theo giá trị hàng của đơn');
  });

  it('R4-BUYER-2: trần của đơn không thấp hơn số dư dùng được → không thêm dòng trần', async () => {
    calls.extra = { pointsMax: 500, pointsPartnerNote: null };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Dùng 500 điểm, giảm 500đ');
    expect(r.container.textContent).not.toContain('Đơn này dùng tối đa');
  });

  it('Q8 S7: giỏ có hàng của gian hàng đối tác → ô Điểm Xanh nêu trần của đơn và câu giải thích', async () => {
    calls.extra = { pointsMax: 12, pointsPartnerNote: NOTE };
    calls.used = 12;
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Đơn này dùng tối đa 12 Điểm Xanh');
    expect(r.container.textContent).toContain(NOTE);
    const box = [...r.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => /Điểm Xanh/.test(i.closest('label')?.textContent ?? ''))!;
    expect(box.disabled).toBe(false);
    click(box);
    await flush(8);
    expect(box.closest('label')!.textContent).toContain('Dùng 12 điểm, giảm 12.000đ');
  });

  it('trần 0 mà không có câu đối tác: ô khoá ghi số dư như Mini ("Bạn đang có"), không lặp "Dùng được" cạnh câu chưa dùng được', async () => {
    calls.extra = { pointsMax: 0, pointsPartnerNote: null };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    const label = [...r.container.querySelectorAll('label')].find((l) => l.querySelector('input[type="checkbox"]') && /Điểm Xanh/.test(l.textContent ?? ''))!;
    expect(label.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(label.textContent).toContain('Bạn đang có 500 điểm');
    expect(label.textContent).not.toContain('Dùng được');
    expect(r.container.textContent).toContain('Đơn này chưa dùng được Điểm Xanh');
  });

  it('trần 0 và một phần điểm còn bị giữ: ghi "Dùng được X/Y điểm" như Mini', async () => {
    calls.extra = { pointsMax: 0, pointsPartnerNote: null, redeemablePoints: 300 };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    const label = [...r.container.querySelectorAll('label')].find((l) => l.querySelector('input[type="checkbox"]') && /Điểm Xanh/.test(l.textContent ?? ''))!;
    expect(label.textContent).toContain('Dùng được 300/500 điểm');
  });

  it('Q8 S7: giỏ chỉ hàng của gian hàng đối tác → ô Điểm Xanh bị tắt, kèm câu giải thích', async () => {
    calls.extra = { pointsMax: 0, pointsPartnerNote: NOTE };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    const box = [...r.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => /Điểm Xanh/.test(i.closest('label')?.textContent ?? ''))!;
    expect(box.disabled).toBe(true);
    expect(r.container.textContent).toContain(NOTE);
    expect(r.container.textContent).not.toContain('Đơn này dùng tối đa');
    click(box);
    await flush(8);
    expect(calls.pointsToUse.every((p) => p === 0)).toBe(true);
  });

  // R5-CHECKOUT-5: bản sửa R4-BUYER-2 ở Mini App (8aea1a0d) chưa sang web — web vẫn hứa lô quy đổi "trả tới 100% giá trị hàng"
  // ngay dưới câu Điểm Xanh không dùng cho hàng của gian hàng đối tác.
  describe('dòng điểm quy đổi (R5-CHECKOUT-5)', () => {
    const CONVERTED = { pointsBalance: 93, redeemablePoints: 93, pointsConvertedBalance: 300, redeemableConvertedPoints: 300 };

    it('giỏ có hàng của gian hàng đối tác: nói phần không hết hạn, không hứa "trả tới 100% giá trị hàng"', async () => {
      calls.extra = { ...CONVERTED, pointsMax: 393, pointsPartnerNote: NOTE };
      const r = render(<CheckoutPage />);
      mounted.push(r);
      await flush(8);
      expect(r.container.textContent).toContain(NOTE);
      expect(r.container.textContent).toContain('trong đó 300 điểm không hết hạn');
      expect(r.container.textContent).not.toContain('trả tới 100% giá trị hàng');
    });

    it('giỏ chỉ hàng Tubu bị trần theo giá trị hàng: cũng không hứa 100%', async () => {
      calls.extra = { ...CONVERTED, pointsMax: 50, pointsPartnerNote: null };
      const r = render(<CheckoutPage />);
      mounted.push(r);
      await flush(8);
      expect(r.container.textContent).toContain('Đơn này dùng tối đa 50 Điểm Xanh');
      expect(r.container.textContent).toContain('trong đó 300 điểm không hết hạn');
      expect(r.container.textContent).not.toContain('trả tới 100% giá trị hàng');
    });

    it('đơn không bị trần: giữ câu "trả tới 100% giá trị hàng" như trước', async () => {
      calls.extra = { ...CONVERTED, pointsMax: 393, pointsPartnerNote: null };
      const r = render(<CheckoutPage />);
      mounted.push(r);
      await flush(8);
      expect(r.container.textContent).toContain('trong đó 300 điểm không hết hạn, trả tới 100% giá trị hàng');
    });
  });
});
