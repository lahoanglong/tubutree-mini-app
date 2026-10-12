import type { Prisma } from '@prisma/client';
import { applyPointsDelta } from './points-ledger';

function fakeTx(opts: { updateManyCount?: number; createdRows?: number } = {}) {
  const user = {
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
  };
  const pointsTransaction = {
    create: jest.fn().mockResolvedValue({ id: 'ptx1' }),
    createManyAndReturn: jest
      .fn()
      .mockResolvedValue(Array.from({ length: opts.createdRows ?? 1 }, (_, i) => ({ id: `ptx_m${i}` }))),
  };
  return { tx: { user, pointsTransaction } as unknown as Prisma.TransactionClient, user, pointsTransaction };
}

describe('applyPointsDelta (ghi sổ Điểm Xanh theo lô)', () => {
  it('cộng lô STANDARD → tăng pointsBalance, dòng sổ lot STANDARD giữ expiresAt', async () => {
    const { tx, user, pointsTransaction } = fakeTx();
    const exp = new Date('2027-10-01T00:00:00Z');
    const r = await applyPointsDelta(tx, { userId: 'u1', delta: 5, lot: 'STANDARD', reason: 'R', refType: 'T', refId: 'x', expiresAt: exp });
    expect(r).toEqual({ applied: true, entryId: 'ptx1' });
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsBalance: { increment: 5 } } });
    expect(pointsTransaction.create.mock.calls[0][0].data).toEqual({
      userId: 'u1', delta: 5, lot: 'STANDARD', reason: 'R', refType: 'T', refId: 'x', expiresAt: exp,
    });
  });

  it('cộng lô CONVERTED → tăng pointsConvertedBalance, không đụng pointsBalance, expiresAt NULL', async () => {
    const { tx, user, pointsTransaction } = fakeTx();
    await applyPointsDelta(tx, { userId: 'u1', delta: 3, lot: 'CONVERTED', reason: 'R' });
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 3 } } });
    expect(pointsTransaction.create.mock.calls[0][0].data).toMatchObject({ lot: 'CONVERTED', expiresAt: null });
  });

  it('trừ có guard gte trên đúng cột của lô; không đủ → applied:false và KHÔNG ghi dòng sổ', async () => {
    const ok = fakeTx({ updateManyCount: 1 });
    await applyPointsDelta(ok.tx, { userId: 'u1', delta: -4, lot: 'CONVERTED', reason: 'SPEND' });
    expect(ok.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', pointsConvertedBalance: { gte: 4 } },
      data: { pointsConvertedBalance: { decrement: 4 } },
    });
    expect(ok.pointsTransaction.create).toHaveBeenCalledTimes(1);

    const short = fakeTx({ updateManyCount: 0 });
    const r = await applyPointsDelta(short.tx, { userId: 'u1', delta: -4, lot: 'STANDARD', reason: 'SPEND' });
    expect(r).toEqual({ applied: false, entryId: null });
    expect(short.user.updateMany.mock.calls[0][0].where).toEqual({ id: 'u1', pointsBalance: { gte: 4 } });
    expect(short.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('dòng CONVERTED có hạn, delta 0 / lẻ / quá lớn → ném lỗi, không ghi gì', async () => {
    const { tx, user, pointsTransaction } = fakeTx();
    await expect(
      applyPointsDelta(tx, { userId: 'u1', delta: 1, lot: 'CONVERTED', reason: 'R', expiresAt: new Date() }),
    ).rejects.toThrow(/không hết hạn/);
    for (const delta of [0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      await expect(applyPointsDelta(tx, { userId: 'u1', delta, lot: 'STANDARD', reason: 'R' })).rejects.toThrow(/không hợp lệ/);
    }
    expect(user.update).not.toHaveBeenCalled();
    expect(user.updateMany).not.toHaveBeenCalled();
    expect(pointsTransaction.create).not.toHaveBeenCalled();
  });

  it('skipDuplicates: dòng đã có (khoá partial unique) → applied:false, số dư KHÔNG đổi', async () => {
    const dup = fakeTx({ createdRows: 0 });
    const r = await applyPointsDelta(dup.tx, {
      userId: 'u1', delta: 7, lot: 'CONVERTED', reason: 'ORDER_REFUND_CONVERTED:C1', refType: 'ORDER', refId: 'o1', skipDuplicates: true,
    });
    expect(r).toEqual({ applied: false, entryId: null });
    expect(dup.pointsTransaction.createManyAndReturn.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    expect(dup.user.update).not.toHaveBeenCalled();

    const fresh = fakeTx({ createdRows: 1 });
    const r2 = await applyPointsDelta(fresh.tx, {
      userId: 'u1', delta: 7, lot: 'CONVERTED', reason: 'ORDER_REFUND_CONVERTED:C1', refType: 'ORDER', refId: 'o1', skipDuplicates: true,
    });
    expect(r2).toEqual({ applied: true, entryId: 'ptx_m0' });
    expect(fresh.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 7 } } });
  });

  it('skipDuplicates chỉ dùng cho lệnh cộng', async () => {
    const { tx } = fakeTx();
    await expect(
      applyPointsDelta(tx, { userId: 'u1', delta: -1, lot: 'STANDARD', reason: 'R', skipDuplicates: true }),
    ).rejects.toThrow(/chỉ dùng cho lệnh cộng/);
  });
});
