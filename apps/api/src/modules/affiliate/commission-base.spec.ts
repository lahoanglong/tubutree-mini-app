import { paidLineTotals } from './commission-base';

describe('paidLineTotals — nền hoa hồng từng dòng', () => {
  it('đơn có tiền thực trả từng dòng (OrderItem.paidTotal) → dùng đúng số đó', () => {
    const items = [
      { total: 200_000, paidTotal: 150_000 },
      { total: 100_000, paidTotal: 100_000 },
    ];
    expect(paidLineTotals({ total: 280_000, shippingFee: 30_000 }, items)).toEqual([150_000, 100_000]);
  });
  it('đơn cũ không có paidTotal → chia giảm giá theo giá trị dòng như trước', () => {
    expect(paidLineTotals({ total: 280_000, shippingFee: 30_000 }, [{ total: 200_000 }, { total: 100_000 }])).toEqual([166_666, 83_333]);
  });
});
