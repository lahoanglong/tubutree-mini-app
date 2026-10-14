import { merchantLineBase, paidGoodsByLine } from './merchant-line-base';

describe('merchantLineBase — nền tiền hàng từng dòng của đơn đối tác (tự giao và Tubu giao hộ)', () => {
  const order = {
    total: 280_000,
    shippingFee: 30_000,
    items: [
      { id: 'iB', total: 100_000 },
      { id: 'iA', total: 200_000 },
    ],
  };

  it('tiền hàng khách thực trả (sau mã giảm giá, Điểm Xanh) chia theo giá trị dòng, cộng lại đúng bằng số khách trả cho hàng', () => {
    expect(merchantLineBase(order)).toEqual([83_333, 166_667]);
    expect(merchantLineBase(order).reduce((s, v) => s + v, 0)).toBe(250_000);
  });

  it('không phụ thuộc thứ tự dòng trả về từ DB (phần dư chia theo id dòng)', () => {
    const tie = { total: 100_001, shippingFee: 0, items: [{ id: 'x2', total: 50_000 }, { id: 'x1', total: 50_000 }, { id: 'x3', total: 50_000 }] };
    const a = merchantLineBase(tie);
    const b = merchantLineBase({ ...tie, items: [...tie.items].reverse() });
    expect([...b].reverse()).toEqual(a);
  });

  it('không giảm giá → đúng tổng dòng; phí giao không bao giờ tính vào tiền hàng', () => {
    expect(merchantLineBase({ total: 330_000, shippingFee: 30_000, items: [{ id: 'a', total: 200_000 }, { id: 'b', total: 100_000 }] })).toEqual([200_000, 100_000]);
    expect(paidGoodsByLine({ total: 230_000, shippingFee: 30_000, items: [{ total: 150_000 }, { total: 50_000 }] })).toEqual([150_000, 50_000]);
  });

  it('đơn có tiền thực trả từng dòng (OrderItem.paidTotal, chia theo dòng được hưởng lúc đặt) → dùng đúng số đó', () => {
    // (a) T 200.000 có mã 50.000 riêng cho T, C 100.000: C giữ đủ 100.000 (chia đều theo giá trị dòng: 83.333).
    const items = [
      { id: 'iT', total: 200_000, paidTotal: 150_000 },
      { id: 'iC', total: 100_000, paidTotal: 100_000 },
    ];
    expect(merchantLineBase({ total: 280_000, shippingFee: 30_000, items })).toEqual([150_000, 100_000]);
    expect(merchantLineBase({ total: 280_000, shippingFee: 30_000, items: items.map(({ paidTotal: _p, ...it }) => it) })).toEqual([166_667, 83_333]);
  });

  it('paidTotal thiếu ở một dòng hoặc không cộng ra tiền hàng thực trả → chia như đơn cũ', () => {
    const items = [
      { id: 'iT', total: 200_000, paidTotal: 150_000 },
      { id: 'iC', total: 100_000, paidTotal: null },
    ];
    expect(merchantLineBase({ total: 280_000, shippingFee: 30_000, items })).toEqual([166_667, 83_333]);
    const drift = items.map((it) => ({ ...it, paidTotal: 120_000 }));
    expect(merchantLineBase({ total: 280_000, shippingFee: 30_000, items: drift })).toEqual([166_667, 83_333]);
  });
});
