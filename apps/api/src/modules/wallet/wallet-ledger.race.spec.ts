import { BadRequestException } from '@nestjs/common';
import { RaceDb } from '../../../test/fakes/race-db.fake';
import { applyWalletDelta } from './wallet-ledger.service';

/**
 * Hai request chạm Ví cùng lúc (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts): sổ cái và số dư phải khớp nhau, không trừ quá số dư,
 * không ghi hai lần cùng (userId, type, refId). Khoá dòng user (FOR NO KEY UPDATE) là thứ tuần tự hoá việc tra trùng + đọc số dư + ghi.
 */
function setup(balance: number) {
  const db = new RaceDb({
    user: {},
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
  });
  db.seed('user', [{ id: 'u1', walletBalance: balance }]);
  db.handlers.push({
    match: /SELECT "walletBalance" FROM "users"/,
    run: async (c) => {
      // Khoá TRƯỚC khi đọc: tới lượt mình thì đọc số dư mới nhất của người trước đã commit.
      if (c.locking) await c.lockRow('user', c.params[0] as string);
      const u = c.rows('user').find((r) => r.id === c.params[0]);
      return u ? [{ walletBalance: u.walletBalance }] : [];
    },
  });
  const run = (input: Parameters<typeof applyWalletDelta>[1]) => db.client.$transaction((tx: never) => applyWalletDelta(tx, input));
  const ledger = () => db.rows('walletTransaction');
  const balanceNow = () => db.row('user', 'u1')!.walletBalance as number;
  return { db, run, ledger, balanceNow };
}

describe('applyWalletDelta — race', () => {
  it('hai lần cộng cùng (userId, type, refId) song song: Ví cộng đúng MỘT lần, bên thua nhận applied=false thay vì lỗi', async () => {
    const { db, run, ledger, balanceNow } = setup(0);
    const credit = () => run({ userId: 'u1', delta: 50_000, type: 'ORDER_REFUND', refType: 'CUSTOMER_REFUND', refId: 'refund-1' });
    const results = await Promise.all([credit(), credit()]);
    expect(results.map((r) => r.applied).sort()).toEqual([false, true]);
    expect(ledger()).toHaveLength(1);
    expect(balanceNow()).toBe(50_000);
    expect(db.stats.lockWaits).toBeGreaterThan(0); // hai request thật sự chạm nhau ở khoá dòng
    expect(results[0]!.entryId).toBe(results[1]!.entryId);
  });

  it('hai lệnh trừ cùng đòi quá số dư song song: chỉ một lệnh qua, Ví không âm, bên thua nhận đúng câu "Số dư ví không đủ."', async () => {
    const { db, run, ledger, balanceNow } = setup(100_000);
    const pay = (refId: string) => run({ userId: 'u1', delta: -60_000, type: 'ORDER_PAY', refType: 'ORDER', refId });
    const settled = await Promise.allSettled([pay('o1'), pay('o2')]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(BadRequestException);
    expect((failed[0]!.reason as Error).message).toBe('Số dư ví không đủ.');
    expect(balanceNow()).toBe(40_000);
    expect(ledger()).toHaveLength(1);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('nhiều lệnh cộng/trừ song song: số dư luôn bằng tổng sổ cái và balanceAfter của dòng cuối bằng số dư', async () => {
    const { run, ledger, balanceNow } = setup(100_000);
    const settled = await Promise.allSettled([
      run({ userId: 'u1', delta: -30_000, type: 'ORDER_PAY', refId: 'o1' }),
      run({ userId: 'u1', delta: 20_000, type: 'ORDER_REFUND', refId: 'r1' }),
      run({ userId: 'u1', delta: -90_000, type: 'ORDER_PAY', refId: 'o2' }),
      run({ userId: 'u1', delta: 5_000, type: 'CASHBACK', refId: 'c1' }),
    ]);
    expect(settled.every((s) => s.status === 'fulfilled' || (s.reason as Error).message === 'Số dư ví không đủ.')).toBe(true);
    const rows = ledger();
    expect(100_000 + rows.reduce((s, r) => s + r.delta, 0)).toBe(balanceNow());
    expect(balanceNow()).toBeGreaterThanOrEqual(0);
    expect(rows.map((r) => r.balanceAfter)).toContain(balanceNow());
    expect(new Set(rows.map((r) => `${r.type}:${r.refId}`)).size).toBe(rows.length);
  });
});
