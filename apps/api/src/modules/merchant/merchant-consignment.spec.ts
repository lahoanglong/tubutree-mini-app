import {
  consignmentPartialReversals,
  consignmentRefKey,
  consignmentReturnRefKey,
  consignmentSaleLines,
  consignmentWholeReversal,
  linkedAtOrder,
  paidGoodsByLine,
} from './merchant-consignment';

const DAY = 86_400_000;
const LINKED = new Date('2026-09-01T00:00:00Z');
const ORDERED = new Date('2026-10-01T03:00:00Z');
const DELIVERED = new Date('2026-10-03T03:00:00Z');

/**
 * Ví dụ tính tay dùng chung với race spec: gian hàng phí sàn 10%, phí Tubu giao hộ 2% + 3.400đ/đơn.
 * Đơn kho Tubu: A (giao hộ) 2 × 60.000 = 120.000, B (giao hộ) 1 × 50.000, C (hàng Tubu) 1 × 30.000 → tiền hàng 200.000;
 * mã giảm 20.000 + Điểm Xanh 10.000; phí giao 25.000 (Tubu giữ) → khách trả 195.000, tiền hàng thực trả 170.000 (85%).
 *   A: 120.000 × 85% = 102.000; phí sàn 10.200; phí giao hộ 2.040 + 3.400 × 102.000/144.500 (= 2.400) = 4.440 → 87.360
 *   B:  50.000 × 85% =  42.500; phí sàn  4.250; phí giao hộ   850 + 3.400 ×  42.500/144.500 (= 1.000) = 1.850 → 36.400
 */
const LINKS = [
  { variationId: 'vA', linkedAt: LINKED, unlinkedAt: null },
  { variationId: 'vB', linkedAt: LINKED, unlinkedAt: null },
];
const TERMS = { commissionPct: 0.1, feePct: 0.02, feeFixed: 3_400 };
const ORDER = {
  id: 'o1',
  code: 'TUBU1',
  total: 195_000,
  shippingFee: 25_000,
  createdAt: ORDERED,
  deliveredAt: DELIVERED,
  items: [
    { id: 'iC', variationId: 'vC', productName: 'Nước rửa chén', variationName: 'Chai', quantity: 1, total: 30_000 },
    { id: 'iA', variationId: 'vA', productName: 'Mật ong', variationName: 'Hũ 500g', quantity: 2, total: 120_000 },
    { id: 'iB', variationId: 'vB', productName: 'Xà bông', variationName: 'Bánh', quantity: 1, total: 50_000 },
  ],
};

describe('linkedAtOrder — dùng khoảng liên kết lúc đặt đơn, không phải liên kết hiện tại', () => {
  const links = [
    { variationId: 'v', linkedAt: new Date('2026-09-01'), unlinkedAt: new Date('2026-09-20') },
    { variationId: 'v', linkedAt: new Date('2026-10-05'), unlinkedAt: null },
  ];
  it('trong [linkedAt, unlinkedAt) mới tính; đúng mốc gỡ là đã gỡ', () => {
    expect(linkedAtOrder(links, 'v', new Date('2026-09-01'))).toBe(true);
    expect(linkedAtOrder(links, 'v', new Date('2026-09-19T23:59:59Z'))).toBe(true);
    expect(linkedAtOrder(links, 'v', new Date('2026-09-20'))).toBe(false);
    expect(linkedAtOrder(links, 'v', new Date('2026-10-01'))).toBe(false);
    expect(linkedAtOrder(links, 'v', new Date('2026-10-06'))).toBe(true);
    expect(linkedAtOrder(links, 'other', new Date('2026-10-06'))).toBe(false);
  });
});

describe('paidGoodsByLine — tiền hàng khách thực trả từng dòng (cùng tỉ lệ với hoàn tiền)', () => {
  it('chia tiền hàng thực trả theo giá trị dòng, cộng lại đúng bằng tổng − phí giao', () => {
    expect(paidGoodsByLine(ORDER)).toEqual([25_500, 102_000, 42_500]);
  });
  it('không giảm gì → đúng tiền dòng; phí giao không bao giờ vào tiền hàng', () => {
    expect(paidGoodsByLine({ total: 230_000, shippingFee: 30_000, items: [{ total: 150_000 }, { total: 50_000 }] })).toEqual([150_000, 50_000]);
  });
  it('lẻ đồng: phần dư cho phần lẻ lớn nhất, tổng khớp tuyệt đối', () => {
    const shares = paidGoodsByLine({ total: 100_000, shippingFee: 0, items: [{ total: 33_333 }, { total: 33_333 }, { total: 33_335 }] });
    expect(shares.reduce((s, v) => s + v, 0)).toBe(100_000);
  });
});

describe('consignmentSaleLines — mỗi dòng hàng giao hộ một dòng SALE', () => {
  it('ví dụ tính tay: A 87.360, B 36.400; dòng hàng Tubu không vào; phí giao 0, COD 0', () => {
    const lines = consignmentSaleLines(ORDER, LINKS, TERMS);
    expect(lines).toEqual([
      expect.objectContaining({
        orderId: 'o1',
        orderCode: 'TUBU1',
        kind: 'SALE',
        refKey: 'ITEM:iA',
        orderItemId: 'iA',
        goodsAmount: 102_000,
        shippingFee: 0,
        commissionAmount: 10_200,
        opsFeeAmount: 4_440,
        codCollected: 0,
        netAmount: 87_360,
        deliveredAt: DELIVERED,
        item: { productName: 'Mật ong', variationName: 'Hũ 500g', quantity: 2 },
      }),
      expect.objectContaining({
        refKey: 'ITEM:iB',
        orderItemId: 'iB',
        goodsAmount: 42_500,
        commissionAmount: 4_250,
        opsFeeAmount: 1_850,
        netAmount: 36_400,
      }),
    ]);
    expect(lines.reduce((s, l) => s + l.netAmount, 0)).toBe(123_760);
  });

  it('phí cố định mỗi đơn chia đủ, không lệch đồng nào vì làm tròn (lần lượt theo id dòng)', () => {
    const lines = consignmentSaleLines(ORDER, LINKS, { commissionPct: 0, feePct: 0, feeFixed: 5_000 });
    expect(lines.map((l) => l.opsFeeAmount)).toEqual([3_529, 1_471]);
  });

  it('mặc định không phí giao hộ: chỉ trừ phí sàn', () => {
    const lines = consignmentSaleLines(ORDER, LINKS, { commissionPct: 0.15, feePct: 0, feeFixed: 0 });
    expect(lines.map((l) => [l.goodsAmount, l.commissionAmount, l.opsFeeAmount, l.netAmount])).toEqual([
      [102_000, 15_300, 0, 86_700],
      [42_500, 6_375, 0, 36_125],
    ]);
  });

  it('đơn đặt trước khi liên kết hoặc sau khi gỡ → không có dòng', () => {
    expect(consignmentSaleLines({ ...ORDER, createdAt: new Date(LINKED.getTime() - DAY) }, LINKS, TERMS)).toEqual([]);
    const unlinked = LINKS.map((l) => ({ ...l, unlinkedAt: new Date(ORDERED.getTime() - DAY) }));
    expect(consignmentSaleLines(ORDER, unlinked, TERMS)).toEqual([]);
  });

  it('thứ tự dòng hàng trong đơn không làm đổi số (cùng một đơn luôn ra cùng các dòng)', () => {
    const shuffled = { ...ORDER, items: [...ORDER.items].reverse() };
    expect(consignmentSaleLines(shuffled, LINKS, { ...TERMS, feeFixed: 5_000 })).toEqual(
      consignmentSaleLines(ORDER, LINKS, { ...TERMS, feeFixed: 5_000 }),
    );
  });
});

describe('dòng đảo hàng giao hộ (trả một phần / cả đơn)', () => {
  const [saleA, saleB] = consignmentSaleLines(ORDER, LINKS, TERMS);
  const sale = (l: NonNullable<typeof saleA>) => ({ ...l, orderItemId: l.orderItemId!, quantity: l.item!.quantity });

  it('khoá dòng: SALE/đảo cả đơn ITEM:<dòng>, trả một phần RETURN:<yêu cầu>:ITEM:<dòng>', () => {
    expect(consignmentRefKey('iA')).toBe('ITEM:iA');
    expect(consignmentReturnRefKey('rr1', 'iA')).toBe('RETURN:rr1:ITEM:iA');
  });

  it('trả 1/2 hũ A → REVERSAL −51.000 tiền hàng, +5.100 phí sàn, +2.220 phí giao hộ = −43.680', () => {
    const out = consignmentPartialReversals(sale(saleA!), [{ id: 'rr1', reviewedAt: DELIVERED, quantity: 1 }]);
    expect(out).toEqual([
      expect.objectContaining({
        kind: 'REVERSAL',
        refKey: 'RETURN:rr1:ITEM:iA',
        orderItemId: 'iA',
        goodsAmount: -51_000,
        shippingFee: 0,
        commissionAmount: -5_100,
        opsFeeAmount: -2_220,
        codCollected: 0,
        netAmount: -43_680,
        deliveredAt: null,
      }),
    ]);
  });

  it('trả từng hũ (2 lần) cộng lại đúng bằng cả dòng; lần sau tính theo thứ tự duyệt', () => {
    const odd = { ...sale(saleA!), goodsAmount: 101_999, commissionAmount: 10_200, opsFeeAmount: 4_441, netAmount: 87_358 };
    const out = consignmentPartialReversals(odd, [
      { id: 'rr2', reviewedAt: new Date(DELIVERED.getTime() + 2 * DAY), quantity: 1 },
      { id: 'rr1', reviewedAt: new Date(DELIVERED.getTime() + DAY), quantity: 1 },
    ]);
    expect(out.map((l) => l.refKey)).toEqual(['RETURN:rr1:ITEM:iA', 'RETURN:rr2:ITEM:iA']);
    expect(out.reduce((s, l) => s + l.goodsAmount, 0)).toBe(-101_999);
    expect(out.reduce((s, l) => s + l.opsFeeAmount, 0)).toBe(-4_441);
    expect(out.reduce((s, l) => s + l.netAmount, 0)).toBe(-87_358);
  });

  it('đơn bị trả cả đơn sau khi đã đối soát: chỉ đảo phần còn lại sau các lần trả một phần → tổng của dòng = 0', () => {
    const partials = consignmentPartialReversals(sale(saleA!), [{ id: 'rr1', reviewedAt: DELIVERED, quantity: 1 }]);
    const whole = consignmentWholeReversal(sale(saleA!), partials)!;
    expect(whole).toEqual(
      expect.objectContaining({ kind: 'REVERSAL', refKey: 'ITEM:iA', goodsAmount: -51_000, commissionAmount: -5_100, opsFeeAmount: -2_220, netAmount: -43_680 }),
    );
    expect(saleA!.netAmount + partials[0]!.netAmount + whole.netAmount).toBe(0);
    expect(consignmentWholeReversal(sale(saleB!), [])!.netAmount).toBe(-36_400);
  });

  it('đã trả hết bằng các lần trả một phần → không còn gì để đảo cả đơn', () => {
    const partials = consignmentPartialReversals(sale(saleB!), [{ id: 'rr1', reviewedAt: DELIVERED, quantity: 1 }]);
    expect(consignmentWholeReversal(sale(saleB!), partials)).toBeNull();
  });
});
