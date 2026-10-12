import { diffPointsBalances, POINTS_LOT_BALANCE_COLUMN } from './points-reconcile';

const std = (userId: string, balance: number, ledgerSum: number) => ({ userId, lot: 'STANDARD' as const, balance, ledgerSum });
const conv = (userId: string, balance: number, ledgerSum: number) => ({ userId, lot: 'CONVERTED' as const, balance, ledgerSum });

describe('diffPointsBalances (đối soát số dư Điểm Xanh theo sổ cái PointsTransaction, từng lô)', () => {
  it('không lệch → không có correction, tổng chênh = 0', () => {
    const r = diffPointsBalances([std('u1', 100, 100), std('u2', 0, 0), conv('u1', 7, 7)]);
    expect(r.corrections).toEqual([]);
    expect(r.affectedCount).toBe(0);
    expect(r.totalDrift).toBe(0);
  });

  it('cộng dư (balance > ledger) → correction hạ về ledgerSum, drift âm', () => {
    // Đúng kịch bản bug double-credit: 2 ORDER_DELIVERED cộng +10 mỗi cái = balance 20,
    // sau dedup chỉ còn 1 transaction → ledgerSum 10. Phải hạ balance về 10.
    const r = diffPointsBalances([std('u1', 20, 10)]);
    expect(r.corrections).toEqual([{ userId: 'u1', lot: 'STANDARD', from: 20, to: 10, drift: -10 }]);
    expect(r.affectedCount).toBe(1);
    expect(r.totalDrift).toBe(-10);
  });

  it('thiếu (balance < ledger) → correction nâng lên ledgerSum, drift dương', () => {
    const r = diffPointsBalances([std('u1', 5, 30)]);
    expect(r.corrections).toEqual([{ userId: 'u1', lot: 'STANDARD', from: 5, to: 30, drift: 25 }]);
    expect(r.totalDrift).toBe(25);
  });

  it('balance > 0 nhưng không có giao dịch (ledgerSum 0) → hạ về 0', () => {
    const r = diffPointsBalances([std('u1', 50, 0)]);
    expect(r.corrections).toEqual([{ userId: 'u1', lot: 'STANDARD', from: 50, to: 0, drift: -50 }]);
  });

  it('nhiều user lẫn lộn → chỉ gom user lệch, tổng đúng', () => {
    const r = diffPointsBalances([std('ok', 100, 100), std('over', 20, 10), std('under', 5, 30)]);
    expect(r.affectedCount).toBe(2);
    expect(r.corrections.map((c) => c.userId).sort()).toEqual(['over', 'under']);
    // tổng chênh ròng: -10 + 25 = 15
    expect(r.totalDrift).toBe(15);
    // tổng giá trị tuyệt đối để thấy quy mô sai lệch
    expect(r.totalAbsDrift).toBe(35);
  });

  it('PD-3: mỗi lô đối soát riêng; lệch ở lô quy đổi không bị lô thường bù trừ', () => {
    // Tổng hai lô khớp (10 + 5 = 15 = 12 + 3) nhưng từng lô lệch: phải báo cả hai.
    const r = diffPointsBalances([std('u1', 10, 12), conv('u1', 5, 3)]);
    expect(r.corrections).toEqual([
      { userId: 'u1', lot: 'STANDARD', from: 10, to: 12, drift: 2 },
      { userId: 'u1', lot: 'CONVERTED', from: 5, to: 3, drift: -2 },
    ]);
    expect(r.byLot.STANDARD).toEqual({ affectedCount: 1, totalDrift: 2, totalAbsDrift: 2 });
    expect(r.byLot.CONVERTED).toEqual({ affectedCount: 1, totalDrift: -2, totalAbsDrift: 2 });
  });

  it('PD-3: lô nào ứng với cột số dư nào', () => {
    expect(POINTS_LOT_BALANCE_COLUMN).toEqual({ STANDARD: 'pointsBalance', CONVERTED: 'pointsConvertedBalance' });
  });
});
