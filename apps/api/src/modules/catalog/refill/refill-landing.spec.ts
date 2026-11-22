import { compareRefillLandingPairs, refillSavingPct } from './refill-landing';

describe('refillSavingPct (trang Tiết kiệm với Refill)', () => {
  it('can 10L 250.000đ thay chai 3,8L 129.000đ: 10L mua bằng chai là 339.473đ, gói rẻ hơn 26,35% → 26 (làm tròn xuống)', () => {
    expect(refillSavingPct({ name: 'Nước rửa chén Fuwa3e 3,8L', price: 129_000 }, { name: 'Refill Nước rửa chén Fuwa3e 10L', price: 250_000 })).toBe(26);
  });

  it('cùng số với công thức computeRefillValueComparison của thẻ ở trang chi tiết chai, trên các dạng tên cặp thường gặp', () => {
    const cases: [string, number, string, number, number | null][] = [
      ['Nước giặt Tubu 500ml', 89_000, 'Túi Refill Nước giặt Tubu 2L', 249_000, 30],
      ['Sữa tắm 1L', 150_000, 'Refill Sữa tắm 1L', 120_000, 20],
      ['Bột giặt 1kg', 100_000, 'Refill Bột giặt 3kg', 240_000, 20],
      // Không rẻ hơn mỗi lít.
      ['Nước lau sàn 1,5L', 90_000, 'Can Refill Nước lau sàn 5L', 300_000, null],
      // Gói nhỏ hơn một chai: không thay được chai nào.
      ['Nước rửa tay 500ml', 50_000, 'Refill Nước rửa tay 250ml', 20_000, null],
      // Khác chiều (lít với kg).
      ['Nước giặt 1L', 100_000, 'Refill Nước giặt 3kg', 200_000, null],
    ];
    for (const [bottle, bp, refill, rp, want] of cases) {
      expect([bottle, refillSavingPct({ name: bottle, price: bp }, { name: refill, price: rp })]).toEqual([bottle, want]);
    }
  });

  it('không ghi lượng, gói nhiều món, giá không dương: null (không hứa số)', () => {
    expect(refillSavingPct({ name: 'Nước giặt', price: 100_000 }, { name: 'Refill Nước giặt 2L', price: 100_000 })).toBeNull();
    expect(refillSavingPct({ name: 'Nước giặt 1L', price: 100_000 }, { name: 'Combo 2 túi Refill 2L', price: 100_000 })).toBeNull();
    expect(refillSavingPct({ name: 'Nước giặt 1L', price: 0 }, { name: 'Refill Nước giặt 2L', price: 100_000 })).toBeNull();
    expect(refillSavingPct({ name: 'Nước giặt 1L', price: 100_000 }, { name: 'Refill Nước giặt 2L', price: -1 })).toBeNull();
  });
});

describe('compareRefillLandingPairs', () => {
  const row = (name: string, inStock: boolean, savingPct: number | null) => ({ bottle: { name }, refill: { inStock }, savingPct });

  it('còn hàng trước, rồi rẻ hơn nhiều nhất trước, không so được cuối, cùng mức theo tên', () => {
    const rows = [row('Bột giặt', true, null), row('Sữa tắm', false, 50), row('Nước giặt', true, 20), row('Ấm', true, 20), row('Lau sàn', true, 35)];
    expect(rows.sort(compareRefillLandingPairs).map((r) => r.bottle.name)).toEqual(['Lau sàn', 'Ấm', 'Nước giặt', 'Bột giặt', 'Sữa tắm']);
  });
});
