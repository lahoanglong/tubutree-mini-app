import { computeOrderEcoImpact, ecoImpactEligible, refillBottlesPerPack, type EcoImpactLine } from './order-eco-impact';

const line = (over: Partial<EcoImpactLine> = {}): EcoImpactLine => ({
  productId: 'refill-10l',
  variationId: 'v-refill-10l',
  slug: 'refill-nuoc-rua-chen-fuwa3e-10l',
  name: 'Refill Nước rửa chén Fuwa3e 10L',
  netQty: 1,
  ...over,
});

describe('ecoImpactEligible', () => {
  const base = { type: 'RETAIL', placedForCustomer: false };
  it('đơn đã giao luôn hiện, kể cả COD', () => {
    expect(ecoImpactEligible({ ...base, status: 'DELIVERED', paymentStatus: 'UNPAID' })).toBe(true);
  });
  it('đơn chưa giao chỉ hiện khi đã thanh toán', () => {
    expect(ecoImpactEligible({ ...base, status: 'CONFIRMED', paymentStatus: 'PAID' })).toBe(true);
    expect(ecoImpactEligible({ ...base, status: 'SHIPPING', paymentStatus: 'PAID' })).toBe(true);
    expect(ecoImpactEligible({ ...base, status: 'CONFIRMED', paymentStatus: 'UNPAID' })).toBe(false);
  });
  it('đơn chờ thanh toán, huỷ, hoàn không hiện', () => {
    for (const status of ['PENDING_PAYMENT', 'CANCELLED', 'RETURNED']) {
      expect(ecoImpactEligible({ ...base, status, paymentStatus: 'PAID' })).toBe(false);
    }
  });
  it('đơn CTV lên hộ khách và đơn đại lý không phải hàng của người xem', () => {
    expect(ecoImpactEligible({ status: 'DELIVERED', paymentStatus: 'PAID', type: 'RETAIL', placedForCustomer: true })).toBe(false);
    expect(ecoImpactEligible({ status: 'DELIVERED', paymentStatus: 'PAID', type: 'DEALER', placedForCustomer: false })).toBe(false);
  });
});

describe('refillBottlesPerPack', () => {
  it('gói 10L thay chai 500ml: 20 chai', () => {
    expect(refillBottlesPerPack('Refill Nước rửa chén 10L', ['Nước rửa chén 500ml'])).toBe(20);
  });
  it('nhiều chai cùng ghép một gói: lấy chai lớn nhất (ít chai nhất, không thổi số)', () => {
    expect(refillBottlesPerPack('Refill Nước giặt 10L', ['Nước giặt 500ml', 'Nước giặt 3,8L'])).toBeCloseTo(10 / 3.8);
  });
  it('không đọc được lượng, khác chiều, hay gói nhỏ hơn chai: mỗi gói một chai', () => {
    expect(refillBottlesPerPack('Refill Nước rửa chén', ['Nước rửa chén 500ml'])).toBe(1);
    expect(refillBottlesPerPack('Refill Bột giặt 2kg', ['Nước giặt 500ml'])).toBe(1);
    expect(refillBottlesPerPack('Túi Refill 400ml', ['Chai 500ml'])).toBe(1);
    expect(refillBottlesPerPack('Refill 10L', [])).toBe(1);
  });
});

describe('computeOrderEcoImpact', () => {
  const pairs = new Map([
    ['bottle-500', 'refill-10l'],
    ['bottle-3800', 'refill-10l-giat'],
  ]);
  const names = new Map([
    ['bottle-500', 'Nước rửa chén Fuwa3e 500ml'],
    ['bottle-3800', 'Nước giặt Fuwa3e 3,8L'],
  ]);
  const ctx = { pairs, names, facts: [] };

  it('chai nhựa bớt = số gói × lượng gói / lượng chai ghép, làm tròn xuống', () => {
    const r = computeOrderEcoImpact(
      [
        line({ netQty: 2 }),
        line({ productId: 'refill-10l-giat', variationId: 'v2', slug: 'refill-nuoc-giat-10l', name: 'Refill Nước giặt Fuwa3e 10L', netQty: 1 }),
      ],
      ctx,
    );
    // 2 × 20 + floor(1 × 10 / 3,8) = 40 + 2
    expect(r).toEqual({ bottlesSaved: 42, refillPacks: 3, plasticGrams: 0 });
  });

  it('gói Refill chưa ghép cặp vẫn bớt ít nhất một chai mỗi gói', () => {
    const r = computeOrderEcoImpact([line({ productId: 'refill-lone', slug: 'refill-xa-phong', name: 'Refill Xà phòng 1L', netQty: 3 })], ctx);
    expect(r.bottlesSaved).toBe(3);
    expect(r.refillPacks).toBe(3);
  });

  it('dòng đã trả hết (netQty 0) và chai thường không tính chai bớt', () => {
    const r = computeOrderEcoImpact(
      [line({ netQty: 0 }), line({ productId: 'bottle-500', slug: 'nuoc-rua-chen-500ml', name: 'Nước rửa chén Fuwa3e 500ml', netQty: 4 })],
      ctx,
    );
    expect(r).toEqual({ bottlesSaved: 0, refillPacks: 0, plasticGrams: 0 });
  });

  it('nhựa bớt (gram) lấy từ sự thật đã duyệt, theo phân loại, nhân số lượng còn giữ', () => {
    const r = computeOrderEcoImpact(
      [
        line({ productId: 'soap', variationId: 'v-soap-a', slug: 'xa-phong-thanh', name: 'Xà phòng thanh', netQty: 2 }),
        line({ productId: 'soap', variationId: 'v-soap-b', slug: 'xa-phong-thanh', name: 'Xà phòng thanh', netQty: 1 }),
      ],
      {
        ...ctx,
        facts: [
          { productId: 'soap', variationId: null, kind: 'PLASTIC_AVOIDED', valueGrams: 30 },
          { productId: 'soap', variationId: 'v-soap-b', kind: 'PLASTIC_AVOIDED', valueGrams: 50 },
          { productId: 'soap', variationId: null, kind: 'CERTIFICATION', valueGrams: null },
        ],
      },
    );
    expect(r.plasticGrams).toBe(2 * 30 + 50);
    expect(r.bottlesSaved).toBe(0);
  });
});
