import { diffWalletBalances } from './wallet-reconcile';

describe('diffWalletBalances (đối soát Ví Tubu vs sổ cái, C-060)', () => {
  it('mọi user khớp sổ → không có lệch', () => {
    const r = diffWalletBalances([
      { userId: 'a', walletBalance: 50_000, ledgerSum: 50_000, entries: 3 },
      { userId: 'b', walletBalance: 0, ledgerSum: 0, entries: 0 },
    ]);
    expect(r).toEqual({ drifts: [], affectedCount: 0, totalDrift: 0, totalAbsDrift: 0 });
  });

  it('báo user có số dư khác tổng sổ, chênh = số dư − tổng sổ (dương = ví đang nhiều hơn sổ)', () => {
    const r = diffWalletBalances([
      { userId: 'a', walletBalance: 120_000, ledgerSum: 100_000, entries: 2 },
      { userId: 'b', walletBalance: 30_000, ledgerSum: 30_000, entries: 1 },
      { userId: 'c', walletBalance: 0, ledgerSum: 5_000, entries: 1 },
      { userId: 'd', walletBalance: 7_000, ledgerSum: 0, entries: 0 },
    ]);
    expect(r.drifts).toEqual([
      { userId: 'a', walletBalance: 120_000, ledgerSum: 100_000, drift: 20_000, entries: 2 },
      { userId: 'c', walletBalance: 0, ledgerSum: 5_000, drift: -5_000, entries: 1 },
      { userId: 'd', walletBalance: 7_000, ledgerSum: 0, drift: 7_000, entries: 0 },
    ]);
    expect(r.affectedCount).toBe(3);
    expect(r.totalDrift).toBe(22_000);
    expect(r.totalAbsDrift).toBe(32_000);
  });

  it('chuẩn hoá giá trị bigint/chuỗi do SUM của Postgres trả về', () => {
    const r = diffWalletBalances([
      { userId: 'a', walletBalance: 10, ledgerSum: BigInt(4) as unknown as number, entries: BigInt(1) as unknown as number },
      { userId: 'b', walletBalance: 10, ledgerSum: '10' as unknown as number, entries: 2 },
    ]);
    expect(r.drifts).toEqual([{ userId: 'a', walletBalance: 10, ledgerSum: 4, drift: 6, entries: 1 }]);
  });
});
