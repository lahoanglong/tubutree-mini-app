import { diffPointsBalances } from './points-reconcile';

describe('diffPointsBalances (đối soát pointsBalance theo sổ cái PointsTransaction)', () => {
  it('không lệch → không có correction, tổng chênh = 0', () => {
    const r = diffPointsBalances([
      { userId: 'u1', pointsBalance: 100, ledgerSum: 100 },
      { userId: 'u2', pointsBalance: 0, ledgerSum: 0 },
    ]);
    expect(r.corrections).toEqual([]);
    expect(r.affectedCount).toBe(0);
    expect(r.totalDrift).toBe(0);
  });

  it('cộng dư (balance > ledger) → correction hạ về ledgerSum, drift âm', () => {
    // Đúng kịch bản bug double-credit: 2 ORDER_DELIVERED cộng +10 mỗi cái = balance 20,
    // sau dedup chỉ còn 1 transaction → ledgerSum 10. Phải hạ balance về 10.
    const r = diffPointsBalances([{ userId: 'u1', pointsBalance: 20, ledgerSum: 10 }]);
    expect(r.corrections).toEqual([{ userId: 'u1', from: 20, to: 10, drift: -10 }]);
    expect(r.affectedCount).toBe(1);
    expect(r.totalDrift).toBe(-10);
  });

  it('thiếu (balance < ledger) → correction nâng lên ledgerSum, drift dương', () => {
    const r = diffPointsBalances([{ userId: 'u1', pointsBalance: 5, ledgerSum: 30 }]);
    expect(r.corrections).toEqual([{ userId: 'u1', from: 5, to: 30, drift: 25 }]);
    expect(r.totalDrift).toBe(25);
  });

  it('balance > 0 nhưng không có giao dịch (ledgerSum 0) → hạ về 0', () => {
    const r = diffPointsBalances([{ userId: 'u1', pointsBalance: 50, ledgerSum: 0 }]);
    expect(r.corrections).toEqual([{ userId: 'u1', from: 50, to: 0, drift: -50 }]);
  });

  it('nhiều user lẫn lộn → chỉ gom user lệch, tổng đúng', () => {
    const r = diffPointsBalances([
      { userId: 'ok', pointsBalance: 100, ledgerSum: 100 },
      { userId: 'over', pointsBalance: 20, ledgerSum: 10 },
      { userId: 'under', pointsBalance: 5, ledgerSum: 30 },
    ]);
    expect(r.affectedCount).toBe(2);
    expect(r.corrections.map((c) => c.userId).sort()).toEqual(['over', 'under']);
    // tổng chênh ròng: -10 + 25 = 15
    expect(r.totalDrift).toBe(15);
    // tổng giá trị tuyệt đối để thấy quy mô sai lệch
    expect(r.totalAbsDrift).toBe(35);
  });
});
