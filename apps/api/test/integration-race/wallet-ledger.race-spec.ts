import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WalletLedgerService, type WalletDeltaInput } from '../../src/modules/wallet/wallet-ledger.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-060: sổ cái Ví Tubu trên Postgres thật. Nhiều biến động song song trên CÙNG một ví phải cho
 * số dư == tổng sổ, không âm, mỗi (userId, type, refId) đúng một dòng, và chuỗi balanceAfter liền
 * mạch (mỗi dòng nối tiếp đúng một dòng trước nó).
 */
describe('WalletLedgerService.applyDelta (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ledger: WalletLedgerService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [WalletLedgerService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    ledger = moduleRef.get(WalletLedgerService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const apply = (input: WalletDeltaInput) => prisma.$transaction((tx) => ledger.applyDelta(tx, input));

  async function newWallet(opening: number) {
    const user = await createUser(prisma);
    if (opening !== 0) await apply({ userId: user.id, delta: opening, type: 'OPENING', refType: 'OPENING', refId: 'OPENING' });
    return user;
  }

  async function snapshot(userId: string) {
    const [user, rows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.walletTransaction.findMany({ where: { userId } }),
    ]);
    return { balance: user.walletBalance, rows, sum: rows.reduce((s, r) => s + r.delta, 0) };
  }

  /** Mỗi dòng: balanceAfter - delta phải là balanceAfter của đúng một dòng khác (hoặc 0 cho dòng đầu). */
  function expectContiguousChain(rows: { delta: number; balanceAfter: number }[], finalBalance: number) {
    let cur = 0;
    let walked = 0;
    const remaining = [...rows];
    while (remaining.length > 0) {
      const idx = remaining.findIndex((r) => r.balanceAfter - r.delta === cur);
      expect(idx).toBeGreaterThanOrEqual(0);
      cur = remaining[idx]!.balanceAfter;
      remaining.splice(idx, 1);
      walked += 1;
    }
    expect(walked).toBe(rows.length);
    expect(cur).toBe(finalBalance);
  }

  it('20 lệnh trừ song song vượt số dư → đúng 10 thành công, số dư về 0, không âm, sổ khớp', async () => {
    const user = await newWallet(50_000);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        apply({ userId: user.id, delta: -5_000, type: 'WITHDRAW', refType: 'PAYOUT', refId: `p-${i}` }),
      ),
    );
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(10);
    expect(s.rejected).toHaveLength(10);
    expect(s.errors.every((e) => e.includes('Số dư ví không đủ'))).toBe(true);

    const snap = await snapshot(user.id);
    expect(snap.balance).toBe(0);
    expect(snap.sum).toBe(snap.balance);
    expect(snap.rows.every((r) => r.balanceAfter >= 0)).toBe(true);
    expect(snap.rows.filter((r) => r.type === 'WITHDRAW')).toHaveLength(10);
    expectContiguousChain(snap.rows, snap.balance);
  });

  it('cùng (type, refId) gọi song song 10 lần → cộng đúng 1 lần, 1 dòng sổ, không ai lỗi', async () => {
    const user = await newWallet(10_000);
    const refId = `order-${randCode(6)}`;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        apply({ userId: user.id, delta: 30_000, type: 'ORDER_REFUND', refType: 'ORDER', refId }),
      ),
    );
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled.filter((r) => r.value.applied)).toHaveLength(1);

    const snap = await snapshot(user.id);
    expect(snap.balance).toBe(40_000);
    expect(snap.sum).toBe(snap.balance);
    expect(snap.rows.filter((r) => r.type === 'ORDER_REFUND' && r.refId === refId)).toHaveLength(1);
    // Kẻ thua nhận lại đúng dòng đã ghi, không phải id rác.
    const winnerId = s.fulfilled.find((r) => r.value.applied)!.value.entryId;
    expect(new Set(s.fulfilled.map((r) => r.value.entryId))).toEqual(new Set([winnerId]));
  });

  it('rút tiền + hoàn tiền + cộng hoa hồng/cashback xen kẽ song song → số dư == tổng sổ, chuỗi liền mạch', async () => {
    const user = await newWallet(100_000);
    const ops: WalletDeltaInput[] = [];
    for (let i = 0; i < 8; i += 1) {
      ops.push({ userId: user.id, delta: -30_000, type: 'WITHDRAW', refType: 'PAYOUT', refId: `w-${i}` });
      ops.push({ userId: user.id, delta: 30_000, type: 'WITHDRAW_REFUND', refType: 'PAYOUT', refId: `w-${i}` });
      ops.push({ userId: user.id, delta: 7_000 + i, type: 'CASHBACK', refType: 'CASHBACK', refId: `cb-${i}` });
      ops.push({ userId: user.id, delta: -12_000, type: 'ORDER_PAY', refType: 'ORDER', refId: `o-${i}` });
    }
    // Mỗi lệnh 2 lần để kiểm luôn chống ghi trùng khi xen với biến động khác.
    const results = await Promise.allSettled([...ops, ...ops].map((op) => apply(op)));
    const s = summarize(results);
    expect(s.errors.filter((e) => !e.includes('Số dư ví không đủ'))).toEqual([]);

    const snap = await snapshot(user.id);
    expect(snap.sum).toBe(snap.balance);
    expect(snap.balance).toBeGreaterThanOrEqual(0);
    expect(snap.rows.every((r) => r.balanceAfter >= 0)).toBe(true);
    const keys = snap.rows.map((r) => `${r.type}|${r.refId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(s.fulfilled.filter((r) => r.value.applied)).toHaveLength(snap.rows.length - 1);
    expectContiguousChain(snap.rows, snap.balance);
  });

  it('tx của caller lỗi sau applyDelta → số dư và sổ cùng rollback', async () => {
    const user = await newWallet(20_000);
    await expect(
      prisma.$transaction(async (tx) => {
        await ledger.applyDelta(tx, { userId: user.id, delta: -15_000, type: 'ORDER_PAY', refType: 'ORDER', refId: 'o-rb' });
        throw new Error('nghiệp vụ phía sau thất bại');
      }),
    ).rejects.toThrow('nghiệp vụ phía sau thất bại');

    const snap = await snapshot(user.id);
    expect(snap.balance).toBe(20_000);
    expect(snap.rows).toHaveLength(1);
    expect(snap.sum).toBe(snap.balance);
  });
});
