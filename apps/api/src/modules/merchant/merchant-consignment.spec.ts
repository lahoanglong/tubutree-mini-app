import {
  consignmentPartialReversals,
  consignmentRefKey,
  consignmentReturnRefKey,
  consignmentSaleLines,
  consignmentWholeReversal,
  termsAt,
} from './merchant-consignment';
import { merchantLineBase, paidGoodsByLine } from './merchant-line-base';

const DAY = 86_400_000;
const ORDERED = new Date('2026-10-01T03:00:00Z');
const DELIVERED = new Date('2026-10-03T03:00:00Z');

/**
 * Ví dụ tính tay dùng chung với race spec: gian hàng phí sàn 10%, phí Tubu giao hộ 2% + 3.400đ/đơn.
 * Đơn kho Tubu: A (giao hộ) 2 × 60.000 = 120.000, B (giao hộ) 1 × 50.000, C (hàng Tubu) 1 × 30.000 → tiền hàng 200.000;
 * mã giảm 30.000; phí giao 25.000 (Tubu giữ) → khách trả 195.000, tiền hàng thực trả 170.000 (85%).
 *   A: 120.000 × 85% = 102.000; phí sàn 10.200; phí giao hộ 2.040 + 3.400 × 102.000/144.500 (= 2.400) = 4.440 → 87.360
 *   B:  50.000 × 85% =  42.500; phí sàn  4.250; phí giao hộ   850 + 3.400 ×  42.500/144.500 (= 1.000) = 1.850 → 36.400
 */
const MINE = (it: { variationId: string }) => it.variationId === 'vA' || it.variationId === 'vB';
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

describe('termsAt — mức phí chốt theo lúc đặt đơn', () => {
  const current = { commissionPct: 0.2, feePct: 0.05, feeFixed: 9_000 };
  const history = [
    { effectiveFrom: new Date('2026-09-01'), commissionPct: 0.1, feePct: 0.02, feeFixed: 3_400 },
    { effectiveFrom: new Date('2026-10-10'), commissionPct: 0.2, feePct: 0.05, feeFixed: 9_000 },
  ];
  it('lấy dòng mới nhất có hiệu lực <= lúc đặt; đúng mốc đổi là mức mới', () => {
    expect(termsAt(history, current, new Date('2026-10-01'))).toEqual({ commissionPct: 0.1, feePct: 0.02, feeFixed: 3_400 });
    expect(termsAt(history, current, new Date('2026-10-10'))).toEqual(current);
    expect(termsAt([...history].reverse(), current, new Date('2026-10-09'))).toEqual({ commissionPct: 0.1, feePct: 0.02, feeFixed: 3_400 });
  });
  it('đơn trước mọi dòng lịch sử → mức hiện tại', () => {
    expect(termsAt(history, current, new Date('2026-08-01'))).toEqual(current);
    expect(termsAt([], current, new Date('2026-08-01'))).toEqual(current);
  });
});

describe('paidGoodsByLine — tiền hàng khách thực trả từng dòng (cùng tỉ lệ với hoàn tiền)', () => {
  it('chia tiền hàng thực trả theo giá trị dòng, cộng lại đúng bằng tổng − phí giao', () => {
    expect(paidGoodsByLine(ORDER)).toEqual([25_500, 102_000, 42_500]);
  });
  it('nền tính tiền của dòng giao hộ đi qua hàm dùng chung với đơn tự giao', () => {
    expect(merchantLineBase(ORDER)).toEqual(paidGoodsByLine(ORDER));
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
    const lines = consignmentSaleLines(ORDER, MINE, TERMS);
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
    const lines = consignmentSaleLines(ORDER, MINE, { commissionPct: 0, feePct: 0, feeFixed: 5_000 });
    expect(lines.map((l) => l.opsFeeAmount)).toEqual([3_529, 1_471]);
  });

  it('mặc định không phí giao hộ: chỉ trừ phí sàn', () => {
    const lines = consignmentSaleLines(ORDER, MINE, { commissionPct: 0.15, feePct: 0, feeFixed: 0 });
    expect(lines.map((l) => [l.goodsAmount, l.commissionAmount, l.opsFeeAmount, l.netAmount])).toEqual([
      [102_000, 15_300, 0, 86_700],
      [42_500, 6_375, 0, 36_125],
    ]);
  });

  it('không dòng nào của gian hàng → không có dòng', () => {
    expect(consignmentSaleLines(ORDER, () => false, TERMS)).toEqual([]);
  });

  it('phí cố định không làm dòng âm: phần cố định bị chặn ở tiền hàng − phí sàn − phí %', () => {
    const cheap = { ...ORDER, total: 25_000 + 1_700, items: [{ id: 'iA', variationId: 'vA', productName: 'Kẹo', variationName: null, quantity: 1, total: 2_000 }] };
    const [line] = consignmentSaleLines(cheap, MINE, { commissionPct: 0.1, feePct: 0.02, feeFixed: 3_400 });
    // 1.700 khách trả; phí sàn 170, phí % 34 → phần cố định tối đa 1.496.
    expect(line).toMatchObject({ goodsAmount: 1_700, commissionAmount: 170, opsFeeAmount: 34 + 1_496, netAmount: 0 });
  });

  it('món 0đ (giảm hết) → không gánh phí cố định, không dồn vào dòng đầu', () => {
    const free = { ...ORDER, total: 25_000 };
    const lines = consignmentSaleLines(free, MINE, { commissionPct: 0.1, feePct: 0, feeFixed: 3_400 });
    expect(lines.map((l) => [l.goodsAmount, l.opsFeeAmount, l.netAmount])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it('thứ tự dòng hàng trong đơn không làm đổi số (cùng một đơn luôn ra cùng các dòng)', () => {
    const shuffled = { ...ORDER, items: [...ORDER.items].reverse() };
    expect(consignmentSaleLines(shuffled, MINE, { ...TERMS, feeFixed: 5_000 })).toEqual(
      consignmentSaleLines(ORDER, MINE, { ...TERMS, feeFixed: 5_000 }),
    );
  });
});

describe('dòng đảo hàng giao hộ (trả một phần / cả đơn)', () => {
  const [saleA, saleB] = consignmentSaleLines(ORDER, MINE, TERMS);
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

  it('R4-PARTNER-2: dòng đảo mang SỐ ĐƠN VỊ trả (không phải số lượng cả dòng hàng): trả 1/2 → units 1; trả nốt cả đơn → units phần còn lại', () => {
    const partials = consignmentPartialReversals(sale(saleA!), [{ id: 'rr1', reviewedAt: DELIVERED, quantity: 1 }]);
    expect(partials[0]!.units).toBe(1);
    expect(partials[0]!.item).toMatchObject({ quantity: 2 });
    expect(consignmentWholeReversal(sale(saleA!), partials)!.units).toBe(1);
    expect(consignmentWholeReversal(sale(saleA!), [])!.units).toBe(2);
  });

  it('R4-PARTNER-2: yêu cầu trả vượt số còn lại bị chặn ở phần còn lại; trả hai lần mỗi lần 1 đơn vị → units 1 và 1', () => {
    const odd = sale(saleA!);
    const out = consignmentPartialReversals(odd, [
      { id: 'rr1', reviewedAt: DELIVERED, quantity: 1 },
      { id: 'rr2', reviewedAt: new Date(DELIVERED.getTime() + DAY), quantity: 5 },
    ]);
    expect(out.map((l) => l.units)).toEqual([1, 1]);
    expect(consignmentWholeReversal(odd, out)).toBeNull();
  });

  it('đã trả hết bằng các lần trả một phần → không còn gì để đảo cả đơn', () => {
    const partials = consignmentPartialReversals(sale(saleB!), [{ id: 'rr1', reviewedAt: DELIVERED, quantity: 1 }]);
    expect(consignmentWholeReversal(sale(saleB!), partials)).toBeNull();
  });
});

describe('Hàng giao hộ trên đơn có tiền thực trả từng dòng (Q8 review M1)', () => {
  const base = { id: 'o', code: 'TUBU', total: 280_000, shippingFee: 30_000, createdAt: ORDERED, deliveredAt: DELIVERED };
  const T = { id: 'iT', variationId: 'vT', productName: 'Hàng Tubu', variationName: null, quantity: 1, total: 200_000 };
  const C = { id: 'iC', variationId: 'vA', productName: 'Mật ong', variationName: 'Hũ', quantity: 1, total: 100_000 };
  const terms = { commissionPct: 0.1, feePct: 0, feeFixed: 0 };
  const onlyC = (it: { id: string }) => it.id === 'iC';

  it('(a) mã 50.000 chỉ cho T: C tính trên 100.000 → phí sàn 10.000, thực nhận 90.000 (trước: 83.333 / 75.000)', () => {
    const now = consignmentSaleLines({ ...base, items: [{ ...T, paidTotal: 150_000 }, { ...C, paidTotal: 100_000 }] }, onlyC, terms);
    expect(now.map((l) => [l.goodsAmount, l.commissionAmount, l.netAmount])).toEqual([[100_000, 10_000, 90_000]]);
    const legacy = consignmentSaleLines({ ...base, items: [T, C] }, onlyC, terms);
    expect(legacy.map((l) => [l.goodsAmount, l.netAmount])).toEqual([[83_333, 75_000]]);
  });

  it('(b) C mua giá flash 100.000, mã 20% (40.000) chỉ trên T: C tính trên 100.000 (trước: 86.667)', () => {
    const order = { ...base, total: 290_000, items: [{ ...T, paidTotal: 160_000 }, { ...C, paidTotal: 100_000 }] };
    expect(consignmentSaleLines(order, onlyC, terms).map((l) => l.goodsAmount)).toEqual([100_000]);
    expect(consignmentSaleLines({ ...order, items: [T, C] }, onlyC, terms).map((l) => l.goodsAmount)).toEqual([86_667]);
  });
});

describe('Phí sàn 50% + phí giao hộ 50% trên tiền hàng lẻ (Q8 review nit)', () => {
  it('làm tròn không đẩy thực nhận xuống âm: hàng 3đ → phí sàn 2đ, phí giao hộ 1đ, thực nhận 0đ', () => {
    const order = { id: 'o', code: 'T', total: 3, shippingFee: 0, createdAt: ORDERED, deliveredAt: DELIVERED, items: [{ id: 'i', variationId: 'v', productName: 'Kẹo', variationName: null, quantity: 1, total: 3 }] };
    const [line] = consignmentSaleLines(order, () => true, { commissionPct: 0.5, feePct: 0.5, feeFixed: 0 });
    expect([line!.goodsAmount, line!.commissionAmount, line!.opsFeeAmount, line!.netAmount]).toEqual([3, 2, 1, 0]);
    for (let goods = 0; goods <= 50; goods++) {
      const [l] = consignmentSaleLines({ ...order, total: goods, items: [{ ...order.items[0]!, total: goods }] }, () => true, { commissionPct: 0.5, feePct: 0.5, feeFixed: 1_000 });
      expect(l!.netAmount).toBeGreaterThanOrEqual(0);
    }
  });
});
