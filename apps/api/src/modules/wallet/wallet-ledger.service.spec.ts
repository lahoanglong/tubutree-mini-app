import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { WalletLedgerService } from './wallet-ledger.service';

function makeTx(opts: { balance?: number | null; existing?: { id: string } | null } = {}) {
  const balance = opts.balance === undefined ? 100_000 : opts.balance;
  const calls: string[] = [];
  const queryRaw = jest.fn().mockImplementation(async () => {
    calls.push('lock');
    return balance === null ? [] : [{ walletBalance: balance }];
  });
  const findUnique = jest.fn().mockImplementation(async () => {
    calls.push('findUnique');
    return opts.existing ?? null;
  });
  const userUpdate = jest.fn().mockImplementation(async (args: { data: { walletBalance: { increment: number } } }) => {
    calls.push('update');
    return { walletBalance: (balance ?? 0) + args.data.walletBalance.increment };
  });
  const create = jest.fn().mockImplementation(async () => {
    calls.push('create');
    return { id: 'wtx-1' };
  });
  const tx = {
    $queryRaw: queryRaw,
    user: { update: userUpdate },
    walletTransaction: { findUnique, create },
  } as unknown as Prisma.TransactionClient;
  return { tx, calls, queryRaw, findUnique, userUpdate, create };
}

describe('WalletLedgerService.applyDelta', () => {
  const svc = new WalletLedgerService();

  it('cộng ví: khoá dòng user trước, tăng số dư rồi ghi đúng 1 dòng sổ có balanceAfter', async () => {
    const m = makeTx({ balance: 100_000 });
    const r = await svc.applyDelta(m.tx, {
      userId: 'u1',
      delta: 25_000,
      type: 'CASHBACK',
      refType: 'CASHBACK',
      refId: 'cb-1',
      reason: 'Cashback đơn Shopee',
    });
    expect(r).toEqual({ applied: true, balanceAfter: 125_000, entryId: 'wtx-1' });
    expect(m.calls).toEqual(['lock', 'findUnique', 'update', 'create']);
    expect(m.userUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: 'u1' },
      data: { walletBalance: { increment: 25_000 } },
    });
    expect(m.create.mock.calls[0][0].data).toEqual({
      userId: 'u1',
      delta: 25_000,
      balanceAfter: 125_000,
      type: 'CASHBACK',
      refType: 'CASHBACK',
      refId: 'cb-1',
      reason: 'Cashback đơn Shopee',
    });
  });

  it('trừ ví quá số dư → BadRequest, không đổi số dư, không ghi sổ', async () => {
    const m = makeTx({ balance: 50_000 });
    await expect(
      svc.applyDelta(m.tx, { userId: 'u1', delta: -50_001, type: 'WITHDRAW', refType: 'PAYOUT', refId: 'p1' }),
    ).rejects.toThrow(new BadRequestException('Số dư ví không đủ.'));
    expect(m.userUpdate).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('trừ ví đúng bằng số dư → về 0', async () => {
    const m = makeTx({ balance: 50_000 });
    const r = await svc.applyDelta(m.tx, { userId: 'u1', delta: -50_000, type: 'ORDER_PAY', refType: 'ORDER', refId: 'o1' });
    expect(r.balanceAfter).toBe(0);
    expect(m.create.mock.calls[0][0].data).toMatchObject({ delta: -50_000, balanceAfter: 0, type: 'ORDER_PAY' });
  });

  it('đã có dòng cùng (userId, type, refId) → applied=false, không đổi số dư, không ghi thêm', async () => {
    const m = makeTx({ balance: 70_000, existing: { id: 'wtx-old' } });
    const r = await svc.applyDelta(m.tx, { userId: 'u1', delta: 30_000, type: 'ORDER_REFUND', refType: 'ORDER', refId: 'o9' });
    expect(r).toEqual({ applied: false, balanceAfter: 70_000, entryId: 'wtx-old' });
    expect(m.findUnique.mock.calls[0][0]).toEqual({
      where: { userId_type_refId: { userId: 'u1', type: 'ORDER_REFUND', refId: 'o9' } },
      select: { id: true },
    });
    expect(m.userUpdate).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('không có refId (hoặc refId rỗng) → không tra trùng, refId lưu null', async () => {
    const m = makeTx({ balance: 0 });
    await svc.applyDelta(m.tx, { userId: 'u1', delta: 10_000, type: 'ADJUST', refId: '   ', reason: 'Bù tay' });
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.create.mock.calls[0][0].data).toMatchObject({ refId: null, refType: null, reason: 'Bù tay' });
  });

  it('cộng vào ví đang âm (dữ liệu cũ) vẫn được — chỉ chặn trừ làm âm', async () => {
    const m = makeTx({ balance: -500 });
    const r = await svc.applyDelta(m.tx, { userId: 'u1', delta: 1_000, type: 'ADJUST' });
    expect(r.balanceAfter).toBe(500);
  });

  it('user không tồn tại → NotFound', async () => {
    const m = makeTx({ balance: null });
    await expect(svc.applyDelta(m.tx, { userId: 'nope', delta: 1_000, type: 'ADJUST' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(m.userUpdate).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('delta=%p không hợp lệ → BadRequest, không chạm DB', async (delta) => {
    const m = makeTx();
    await expect(svc.applyDelta(m.tx, { userId: 'u1', delta, type: 'ADJUST' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(m.queryRaw).not.toHaveBeenCalled();
  });
});
