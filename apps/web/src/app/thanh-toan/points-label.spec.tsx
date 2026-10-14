// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Nhãn ô "dùng Điểm Xanh" phải khớp số điểm backend thật sự trừ (đã áp trần % giá trị hàng), không phải
// số dư: khách 500 điểm thường, hàng 100.000đ, trần 20% → trừ 20 điểm chứ không phải 500.

const SUBTOTAL = 100000;
const calls = vi.hoisted(() => ({ pointsToUse: [] as number[], extra: {} as Record<string, unknown>, used: 20 }));

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
  getPublicConfig: async () => ({ recyclingEnabled: false }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  calls.pointsToUse = [];
  calls.extra = {};
  calls.used = 20;
});

const NOTE = 'Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác';

describe('/thanh-toan — nhãn dùng Điểm Xanh', () => {
  it('chưa tick: "Bạn có 500 Điểm Xanh"; tick xong: đúng 20 điểm thật trừ, không còn ghi 500', async () => {
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    const pointsLabel = () =>
      [...r.container.querySelectorAll('label')].find((l) => l.querySelector('input[type="checkbox"]') && /Điểm Xanh/.test(l.textContent ?? ''))!;
    const label = () => pointsLabel().textContent ?? '';
    expect(label()).toContain('Bạn có 500 Điểm Xanh');

    click(pointsLabel().querySelector<HTMLInputElement>('input')!);
    await flush(8);
    expect(calls.pointsToUse).toContain(500);
    expect(label()).toContain('Dùng 20 Điểm Xanh — giảm 20.000đ');
    expect(label()).not.toContain('500');
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
    expect(box.closest('label')!.textContent).toContain('Dùng 12 Điểm Xanh — giảm 12.000đ');
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
});
