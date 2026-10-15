import { partialRevokeDue, partialRevokeTarget, referralGrantDue, type ReferralGrant } from './referral-reward';
import { returnedGoods, type AllocOrder } from '../orders/refund-allocation';

const points = (amount: number): ReferralGrant => ({ amount, ledger: 'POINTS' });
const xu = (amount: number): ReferralGrant => ({ amount, ledger: 'COIN' });

describe('thu hồi thưởng giới thiệu theo tỷ lệ khi trả một phần — phần tính thuần', () => {
  it('mục tiêu luỹ kế làm tròn xuống theo tiền hàng đã trả / tiền hàng của đơn', () => {
    expect(partialRevokeTarget(points(100), 100_000, 300_000)).toBe(33);
    expect(partialRevokeTarget(points(100), 200_000, 300_000)).toBe(66);
    expect(partialRevokeTarget(points(5), 1, 300_000)).toBe(0);
    expect(partialRevokeTarget(points(100), 150_000, 300_000)).toBe(50);
  });

  it('trả hết tiền hàng (hoặc hơn) = cả khoản; không có tiền hàng / chưa trả gì = 0', () => {
    expect(partialRevokeTarget(points(100), 300_000, 300_000)).toBe(100);
    expect(partialRevokeTarget(points(100), 400_000, 300_000)).toBe(100);
    expect(partialRevokeTarget(points(100), 0, 300_000)).toBe(0);
    expect(partialRevokeTarget(points(100), 50_000, 0)).toBe(0);
  });

  it('thưởng xu cũ: quy ra điểm (legacyXuToPoints) trước rồi làm tròn xuống theo điểm, không thu dư', () => {
    expect(partialRevokeTarget(xu(5000), 100_000, 300_000)).toBe(1); // floor(5 × 1/3)
    expect(partialRevokeTarget(xu(5000), 200_000, 300_000)).toBe(3); // floor(5 × 2/3)
    expect(partialRevokeTarget(xu(5000), 3_000, 300_000)).toBe(0); // 1%: floor(0.05), không ceil lên 1
    expect(partialRevokeTarget(xu(5000), 300_000, 300_000)).toBe(5);
    expect(partialRevokeTarget(xu(4500), 300_000, 300_000)).toBe(5); // trả hết = đúng referralGrantDue
    expect(partialRevokeTarget(xu(4500), 299_999, 300_000)).toBe(4);
    expect(referralGrantDue(xu(5000))).toBe(5);
    expect(referralGrantDue(points(100))).toBe(100);
  });

  it('mỗi lần thu = mục tiêu luỹ kế − đã thu cho đơn: cộng các lần đúng bằng mục tiêu cuối, không trôi', () => {
    const grant = points(100);
    let revoked = 0;
    const steps: number[] = [];
    for (let q = 1; q <= 5; q++) {
      const due = partialRevokeDue({
        grantDue: 100,
        target: partialRevokeTarget(grant, q * 50_000, 300_000),
        revokedForOrder: revoked,
        revokedTotal: revoked,
      });
      steps.push(due);
      revoked += due;
    }
    expect(steps).toEqual([16, 17, 17, 16, 17]);
    expect(revoked).toBe(Math.floor((100 * 5) / 6));
  });

  it('hai đơn cùng trả một phần: tổng không vượt thưởng', () => {
    const a = partialRevokeDue({ grantDue: 100, target: 66, revokedForOrder: 0, revokedTotal: 0 });
    const b = partialRevokeDue({ grantDue: 100, target: 66, revokedForOrder: 0, revokedTotal: a });
    expect([a, b]).toEqual([66, 34]);
    expect(partialRevokeDue({ grantDue: 100, target: 99, revokedForOrder: 34, revokedTotal: 100 })).toBe(0);
  });

  it('không bao giờ âm (mục tiêu nhỏ hơn phần đã thu)', () => {
    expect(partialRevokeDue({ grantDue: 100, target: 10, revokedForOrder: 20, revokedTotal: 20 })).toBe(0);
  });

  describe('returnedGoods: cùng cơ sở tiền hàng với computeReturnShares', () => {
    const order = (over: Partial<AllocOrder> = {}): AllocOrder => ({
      total: 315_000,
      shippingFee: 15_000,
      pointsUsed: 0,
      pointsUsedConverted: 0,
      pointsEarned: 0,
      items: [
        { id: 'x', total: 200_000, quantity: 2, paidTotal: 180_000 },
        { id: 'y', total: 120_000, quantity: 3, paidTotal: 120_000 },
      ],
      ...over,
    });

    it('tiền hàng thực trả từng dòng (paidTotal), không tính phí ship', () => {
      expect(returnedGoods(order(), new Map([['x', 1]]))).toEqual({ returned: 90_000, goods: 300_000 });
      expect(returnedGoods(order(), new Map([['x', 1], ['y', 1]]))).toEqual({ returned: 130_000, goods: 300_000 });
    });

    it('đơn cũ không có paidTotal: theo tỉ lệ giá trị dòng', () => {
      const legacy = order({ items: [{ id: 'x', total: 200_000, quantity: 2 }, { id: 'y', total: 100_000, quantity: 1 }] });
      expect(returnedGoods(legacy, new Map([['x', 1]]))).toEqual({ returned: 100_000, goods: 300_000 });
    });
  });
});
