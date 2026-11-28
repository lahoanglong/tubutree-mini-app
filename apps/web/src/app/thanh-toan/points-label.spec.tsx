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

// Hàng Điểm Xanh một dòng (w47-01): câu "Dùng N Điểm Xanh (-Xđ)" + nút ⓘ + công tắc; lưu ý (trần, đối tác, quy đổi, đang giữ, đơn sàn) nằm trong tấm ⓘ.
const row = (r: Rendered) => r.container.querySelector<HTMLElement>('[data-testid="checkout-points"]')!;
const rowText = (r: Rendered) => row(r).querySelector('.tubu-points-row-text')!.textContent ?? '';
const toggle = (r: Rendered) => row(r).querySelector<HTMLInputElement>('input[role="switch"]');
async function infoText(r: Rendered): Promise<string> {
  click(row(r).querySelector('button[aria-label="Cách dùng Điểm Xanh"]'));
  await flush(2);
  const sheet = document.querySelector('[data-testid="checkout-points-info"]');
  expect(sheet).not.toBeNull();
  return sheet!.textContent ?? '';
}

describe('/thanh-toan — nhãn dùng Điểm Xanh', () => {
  it('chưa bật: "Dùng 500 Điểm Xanh (-500đ)"; bật xong: đúng 20 điểm thật trừ, không còn ghi 500', async () => {
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(rowText(r)).toBe('Dùng 500 Điểm Xanh (-500đ)');
    expect(toggle(r)!.getAttribute('aria-labelledby')).toBe(row(r).querySelector('.tubu-points-row-text')!.id);

    click(toggle(r));
    await flush(8);
    expect(calls.pointsToUse).toContain(500);
    expect(rowText(r)).toBe('Dùng 20 Điểm Xanh (-20.000đ)');
    expect(toggle(r)!.checked).toBe(true);
  });

  it('R4-BUYER-2: giỏ chỉ hàng Tubu, trần của đơn thấp hơn số dư → câu chưa bật kẹp theo trần, tấm ⓘ nêu trần', async () => {
    calls.extra = { pointsMax: 20, pointsPartnerNote: null };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(rowText(r)).toBe('Dùng 20 Điểm Xanh (-20đ)');
    expect(await infoText(r)).toContain('Đơn này dùng tối đa 20 Điểm Xanh, tính theo giá trị hàng của đơn');
  });

  it('R4-BUYER-2: trần của đơn không thấp hơn số dư dùng được → không thêm dòng trần', async () => {
    calls.extra = { pointsMax: 500, pointsPartnerNote: null };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(rowText(r)).toBe('Dùng 500 Điểm Xanh (-500đ)');
    expect(await infoText(r)).not.toContain('Đơn này dùng tối đa');
  });

  it('Q8 S7: giỏ có hàng của gian hàng đối tác → tấm ⓘ nêu trần của đơn và câu giải thích, công tắc vẫn bật được', async () => {
    calls.extra = { pointsMax: 12, pointsPartnerNote: NOTE };
    calls.used = 12;
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    const info = await infoText(r);
    expect(info).toContain('Đơn này dùng tối đa 12 Điểm Xanh');
    expect(info).toContain(NOTE);
    expect(toggle(r)!.disabled).toBe(false);
    click(toggle(r));
    await flush(8);
    expect(rowText(r)).toBe('Dùng 12 Điểm Xanh (-12.000đ)');
  });

  it('trần 0 mà không có câu đối tác: không có công tắc, hàng ghi số dư như Mini ("Bạn đang có"), không "Dùng được"; lý do là dòng phụ, tấm ⓘ không lặp', async () => {
    calls.extra = { pointsMax: 0, pointsPartnerNote: null };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(toggle(r)).toBeNull();
    expect(row(r).querySelector('input[type="checkbox"]')).toBeNull();
    expect(rowText(r)).toContain('Bạn đang có 500 điểm');
    expect(rowText(r)).not.toContain('Dùng được');
    expect(row(r).querySelector('[data-points-reason="cap"]')!.textContent).toBe('Đơn này chưa dùng được Điểm Xanh');
    expect(await infoText(r)).not.toContain('Đơn này chưa dùng được Điểm Xanh');
  });

  it('trần 0 và một phần điểm còn bị giữ: chỉ ghi số dư, không mâu thuẫn với câu chưa dùng được', async () => {
    calls.extra = { pointsMax: 0, pointsPartnerNote: null, redeemablePoints: 300 };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(rowText(r)).toContain('Bạn đang có 500 điểm');
    expect(rowText(r)).not.toContain('Dùng được');
  });

  it('Q8 S7: giỏ chỉ hàng của gian hàng đối tác → không có công tắc, câu giải thích là dòng phụ (không trong tấm ⓘ), không gửi điểm; hàng không mờ', async () => {
    calls.extra = { pointsMax: 0, pointsPartnerNote: NOTE };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(toggle(r)).toBeNull();
    for (let el: HTMLElement | null = row(r); el && el !== r.container; el = el.parentElement) {
      expect(el.className.split(/\s+/), el.className).not.toContain('opacity-60');
      expect(el.className.split(/\s+/), el.className).not.toContain('max-md:opacity-60');
    }
    expect(row(r).querySelector('[data-points-reason="partner"]')!.textContent).toBe(NOTE);
    const info = await infoText(r);
    expect(info).not.toContain(NOTE);
    expect(info).not.toContain('Đơn này dùng tối đa');
    await flush(4);
    expect(calls.pointsToUse.every((p) => p === 0)).toBe(true);
  });

  describe('dòng điểm từ đơn sàn (W43)', () => {
    // 100.000đ hàng (trần 20% = 20.000đ): 30.000 điểm sàn + 50.000 điểm quy đổi. Máy chủ: pointsMax 70.000, phần sàn 20.000.
    const MARKET = {
      pointsBalance: 0, redeemablePoints: 0, pointsConvertedBalance: 50_000, redeemableConvertedPoints: 50_000,
      pointsMarketplaceBalance: 30_000, redeemableMarketplacePoints: 30_000, pointsMax: 70_000, pointsMaxMarketplace: 20_000, pointsPartnerNote: null,
    };
    const line = (n: string) => `Gồm ${n} điểm từ đơn sàn, giảm ngay`;

    it('chưa bật: số máy chủ kẹp (20.000), không phải số dư lô sàn (30.000); bật xong: số máy chủ trừ từ lô sàn', async () => {
      calls.extra = { ...MARKET, pointsUsedMarketplace: 20_000 };
      calls.used = 70_000;
      const r = render(<CheckoutPage />);
      mounted.push(r);
      await flush(8);
      const before = await infoText(r);
      expect(before).toContain(line('20.000'));
      expect(before).not.toContain(line('30.000'));
      expect(document.querySelectorAll('[data-points-note="marketplace"]')).toHaveLength(1);
      click(toggle(r));
      await flush(8);
      expect(calls.pointsToUse).toContain(80_000);
      expect(toggle(r)!.checked).toBe(true);
      expect(document.querySelector('[data-testid="checkout-points-info"]')!.textContent).toContain(line('20.000'));
    });

    it('API cũ chưa trả pointsMaxMarketplace: không đoán từ số dư', async () => {
      const { pointsMaxMarketplace: _omit, ...oldApi } = MARKET;
      calls.extra = oldApi;
      const r = render(<CheckoutPage />);
      mounted.push(r);
      await flush(8);
      expect(rowText(r)).toContain('Điểm Xanh');
      expect(await infoText(r)).not.toContain('từ đơn sàn, giảm ngay');
    });

    it('hàng Điểm Xanh khoá hoặc không có lô sàn: không có dòng nhắc', async () => {
      calls.extra = { ...MARKET, pointsMax: 0, pointsMaxMarketplace: 0, pointsPartnerNote: NOTE };
      const locked = render(<CheckoutPage />);
      mounted.push(locked);
      await flush(8);
      expect(await infoText(locked)).not.toContain('từ đơn sàn, giảm ngay');
      locked.unmount();
      mounted = [];
      calls.extra = { pointsMax: 10_000, pointsMaxMarketplace: 0, pointsPartnerNote: null };
      const none = render(<CheckoutPage />);
      mounted.push(none);
      await flush(8);
      expect(await infoText(none)).not.toContain('từ đơn sàn, giảm ngay');
    });
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
      const info = await infoText(r);
      expect(info).toContain(NOTE);
      expect(info).toContain('trong đó 300 điểm không hết hạn');
      expect(info).not.toContain('trả tới 100% giá trị hàng');
    });

    it('giỏ chỉ hàng Tubu bị trần theo giá trị hàng: cũng không hứa 100%', async () => {
      calls.extra = { ...CONVERTED, pointsMax: 50, pointsPartnerNote: null };
      const r = render(<CheckoutPage />);
      mounted.push(r);
      await flush(8);
      const info = await infoText(r);
      expect(info).toContain('Đơn này dùng tối đa 50 Điểm Xanh');
      expect(info).toContain('trong đó 300 điểm không hết hạn');
      expect(info).not.toContain('trả tới 100% giá trị hàng');
    });

    it('đơn không bị trần: giữ câu "trả tới 100% giá trị hàng" như trước', async () => {
      calls.extra = { ...CONVERTED, pointsMax: 393, pointsPartnerNote: null };
      const r = render(<CheckoutPage />);
      mounted.push(r);
      await flush(8);
      expect(await infoText(r)).toContain('trong đó 300 điểm không hết hạn, trả tới 100% giá trị hàng');
    });
  });
});
