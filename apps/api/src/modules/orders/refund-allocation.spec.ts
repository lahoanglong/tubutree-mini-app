import { computeReturnShares, distributeByWeight, type AllocOrder } from './refund-allocation';

const order = (over: Partial<AllocOrder> = {}): AllocOrder => ({
  total: 214_000,
  shippingFee: 20_000,
  pointsUsed: 53,
  pointsUsedConverted: 0,
  pointsEarned: 21,
  items: [
    { id: 'a', total: 3 * 89_000, quantity: 3 },
  ],
  ...over,
});

describe('computeReturnShares (D3)', () => {
  it('MONEY-7: trả 1/3 chai chỉ hoàn phần của 1 chai sau phân bổ giảm giá/điểm, không hoàn phí ship', () => {
    const r = computeReturnShares(order(), new Map(), new Map([['a', 1]]), { shopFault: false, priorShipping: 0 });
    // Tiền hàng thực trả = 214.000 − 20.000 = 194.000 → 1/3 = 64.667.
    expect(r.goods).toBe(64_667);
    expect(r.shipping).toBe(0);
    expect(r.isFull).toBe(false);
    expect(r.pointsUsedBack).toBe(18);
    expect(r.pointsEarnedBack).toBe(7);
    expect(r.lines).toEqual([{ orderItemId: 'a', quantity: 1, refundAmount: 64_667 }]);
  });

  it('lỗi do shop: hoàn cả phí ship dù chỉ trả một phần, và chỉ hoàn phí ship một lần', () => {
    const first = computeReturnShares(order(), new Map(), new Map([['a', 1]]), { shopFault: true, priorShipping: 0 });
    expect(first.shipping).toBe(20_000);
    const second = computeReturnShares(order(), new Map([['a', 1]]), new Map([['a', 1]]), {
      shopFault: true,
      priorShipping: first.shipping,
    });
    expect(second.shipping).toBe(0);
  });

  it('trả nhiều lần cộng lại đúng bằng cả đơn (kể cả ship ở lần trả nốt), điểm cũng vậy', () => {
    const o = order();
    const a = computeReturnShares(o, new Map(), new Map([['a', 1]]), { shopFault: false, priorShipping: 0 });
    const b = computeReturnShares(o, new Map([['a', 1]]), new Map([['a', 1]]), { shopFault: false, priorShipping: 0 });
    const c = computeReturnShares(o, new Map([['a', 2]]), new Map([['a', 1]]), { shopFault: false, priorShipping: 0 });
    expect(c.isFull).toBe(true);
    expect(a.goods + b.goods + c.goods + c.shipping).toBe(o.total);
    expect(a.pointsUsedBack + b.pointsUsedBack + c.pointsUsedBack).toBe(53);
    expect(a.pointsEarnedBack + b.pointsEarnedBack + c.pointsEarnedBack).toBe(21);
  });

  it('nhiều dòng: chia theo giá trị dòng, dòng rẻ nhận phần nhỏ', () => {
    const o = order({
      total: 150_000,
      shippingFee: 0,
      pointsUsed: 0,
      pointsEarned: 0,
      items: [
        { id: 'x', total: 100_000, quantity: 1 },
        { id: 'y', total: 100_000, quantity: 2 },
      ],
    });
    const r = computeReturnShares(o, new Map(), new Map([['y', 1]]), { shopFault: false, priorShipping: 0 });
    // Giảm 25% cả đơn → 1 đơn vị y (50.000) thành 37.500.
    expect(r.goods).toBe(37_500);
    expect(r.lines).toEqual([{ orderItemId: 'y', quantity: 1, refundAmount: 37_500 }]);
  });

  it('phần lô quy đổi không vượt tổng điểm hoàn và cộng dồn đúng bằng pointsUsedConverted', () => {
    const o = order({ pointsUsed: 10, pointsUsedConverted: 7 });
    const a = computeReturnShares(o, new Map(), new Map([['a', 1]]), { shopFault: false, priorShipping: 0 });
    const b = computeReturnShares(o, new Map([['a', 1]]), new Map([['a', 2]]), { shopFault: false, priorShipping: 0 });
    expect(a.convertedBack).toBeLessThanOrEqual(a.pointsUsedBack);
    expect(a.convertedBack + b.convertedBack).toBe(7);
    expect(a.pointsUsedBack + b.pointsUsedBack).toBe(10);
  });

  it('dòng 0đ (quà tặng) vẫn tính đủ lượng trả để biết đã trả hết đơn', () => {
    const o = order({
      total: 100_000,
      shippingFee: 0,
      items: [
        { id: 'p', total: 100_000, quantity: 1 },
        { id: 'gift', total: 0, quantity: 1 },
      ],
    });
    const r = computeReturnShares(o, new Map([['p', 1]]), new Map([['gift', 1]]), { shopFault: false, priorShipping: 0 });
    expect(r.isFull).toBe(true);
    expect(r.goods).toBe(0);
  });

  it('đơn không có dòng hàng (dữ liệu cũ) → coi là trả cả đơn, hoàn đủ tiền hàng và ship', () => {
    const r = computeReturnShares(order({ items: [] }), new Map(), new Map(), { shopFault: false, priorShipping: 0 });
    expect(r.isFull).toBe(true);
    expect(r.goods + r.shipping).toBe(order().total);
  });
});

describe('distributeByWeight', () => {
  it('chia phần dư lớn nhất để tổng khớp tuyệt đối', () => {
    expect(distributeByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distributeByWeight(0, [5, 5])).toEqual([0, 0]);
    expect(distributeByWeight(10, [0, 0])).toEqual([10, 0]);
  });
});

describe('computeReturnShares — đơn có tiền thực trả từng dòng (OrderItem.paidTotal, Q8 review M1)', () => {
  // T 2 × 100.000 có mã 50.000 riêng cho T; C 100.000 không có mã; phí giao 30.000 → khách trả 280.000.
  const o = order({
    total: 280_000,
    shippingFee: 30_000,
    pointsUsed: 0,
    pointsEarned: 0,
    items: [
      { id: 't', total: 200_000, quantity: 2, paidTotal: 150_000 },
      { id: 'c', total: 100_000, quantity: 1, paidTotal: 100_000 },
    ],
  });

  it('trả C hoàn đúng 100.000 khách đã trả cho C (trước: chia theo giá trị dòng 83.333)', () => {
    const r = computeReturnShares(o, new Map(), new Map([['c', 1]]), { shopFault: false, priorShipping: 0 });
    expect(r.goods).toBe(100_000);
    expect(r.lines).toEqual([{ orderItemId: 'c', quantity: 1, refundAmount: 100_000 }]);
  });

  it('trả 1 × T hoàn 75.000, trả nốt khép đúng tiền hàng thực trả', () => {
    const first = computeReturnShares(o, new Map(), new Map([['t', 1]]), { shopFault: false, priorShipping: 0 });
    expect(first.goods).toBe(75_000);
    const rest = computeReturnShares(o, new Map([['t', 1]]), new Map([['t', 1], ['c', 1]]), { shopFault: false, priorShipping: 0 });
    expect(rest.isFull).toBe(true);
    expect(first.goods + rest.goods).toBe(250_000);
    expect(rest.lines).toEqual([
      { orderItemId: 't', quantity: 1, refundAmount: 75_000 },
      { orderItemId: 'c', quantity: 1, refundAmount: 100_000 },
    ]);
  });

  it('paidTotal thiếu ở một dòng hoặc không cộng ra tiền hàng thực trả → chia theo giá trị dòng như đơn cũ', () => {
    const legacy = order({ ...o, items: [{ id: 't', total: 200_000, quantity: 2, paidTotal: 150_000 }, { id: 'c', total: 100_000, quantity: 1, paidTotal: null }] });
    expect(computeReturnShares(legacy, new Map(), new Map([['c', 1]]), { shopFault: false, priorShipping: 0 }).goods).toBe(83_333);
  });
});
