import { BadRequestException, GoneException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';
import { applyWalletDelta } from './wallet-ledger.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

// Sổ cái thật (khoá dòng + ghi wallet_transactions) được kiểm trên Postgres ở
// test/integration-race/wallet-ledger*.race-spec.ts; ở đây chỉ cần biết service gọi nó đúng.
jest.mock('./wallet-ledger.service', () => ({ applyWalletDelta: jest.fn() }));
const ledger = applyWalletDelta as jest.MockedFunction<typeof applyWalletDelta>;

// config trả default → dùng đúng default thiết kế: withdraw_min 100k, withdraw_fee 3k.
const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function makePrisma(walletBalance: number, decCount = 1) {
  ledger.mockReset();
  if (decCount === 0) ledger.mockRejectedValue(new BadRequestException('Số dư Ví không đủ.'));
  else ledger.mockResolvedValue({ applied: true, balanceAfter: 0, entryId: 'wtx-1' });
  const debit = ledger;
  const userUpdate = jest.fn().mockResolvedValue({});
  const payoutCreate = jest.fn().mockResolvedValue({ id: 'payout-1' });
  const payoutFindUnique = jest.fn().mockResolvedValue(null);
  const coinCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', walletBalance }), update: userUpdate },
    payout: { create: payoutCreate, findUnique: payoutFindUnique },
    coinTransaction: { create: coinCreate, findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return { prisma, debit, userUpdate, payoutCreate, payoutFindUnique, coinCreate, coinFindFirst: (prisma as unknown as { coinTransaction: { findFirst: jest.Mock } }).coinTransaction.findFirst };
}

describe('WalletService.withdraw (Ví → ngân hàng, min 100k, phí 3k)', () => {
  it('dưới mức tối thiểu 100k → BadRequest, không trừ tiền', async () => {
    const { prisma, debit } = makePrisma(1_000_000);
    await expect(new WalletService(prisma, config).withdraw('u1', 99_999, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(debit).not.toHaveBeenCalled();
  });

  it('số dư không đủ (check sớm) → BadRequest', async () => {
    const { prisma, debit } = makePrisma(50_000);
    await expect(new WalletService(prisma, config).withdraw('u1', 100_000, {})).rejects.toThrow('không đủ');
    expect(debit).not.toHaveBeenCalled();
  });

  it('rút 100k hợp lệ → trừ ví 100k ATOMIC, Payout thực nhận 97k + phí 3k', async () => {
    const { prisma, debit, payoutCreate } = makePrisma(200_000);
    const r = await new WalletService(prisma, config).withdraw('u1', 100_000, { bank: 'VCB' });
    expect(r).toMatchObject({ status: 'REQUESTED', fee: 3000, net: 97_000, withdrawn: 100_000 });
    expect(debit.mock.calls[0]![1]).toMatchObject({
      userId: 'u1',
      delta: -100_000,
      type: 'WITHDRAW',
      refType: 'PAYOUT',
      refId: 'payout-1',
    });
    expect(payoutCreate.mock.calls[0][0].data).toMatchObject({ amount: 97_000, fee: 3000, method: 'BANK', status: 'REQUESTED' });
  });

  it('race overdraft: sổ cái báo không đủ → BadRequest thoát ra khỏi tx (Payout vừa tạo rollback theo)', async () => {
    const { prisma } = makePrisma(200_000, 0);
    await expect(new WalletService(prisma, config).withdraw('u1', 100_000, {})).rejects.toThrow('không đủ');
  });

  it('cấu hình sai (phí ≥ tiền rút) → net ≤ 0 bị chặn, KHÔNG trừ ví/ tạo payout âm', async () => {
    // min=2000, fee=3000 → withdraw 2000 qua được check min nhưng net = -1000.
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        (k === 'wallet.withdraw_min' ? 2000 : k === 'wallet.withdraw_fee' ? 3000 : fb) as T,
    } as unknown as SystemConfigService;
    const { prisma, debit, payoutCreate } = makePrisma(200_000);
    await expect(new WalletService(prisma, cfg).withdraw('u1', 2000, {})).rejects.toThrow();
    expect(debit).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('idempotency: key đã có payout → trả lại payout cũ, KHÔNG trừ ví / tạo payout mới', async () => {
    const { prisma, debit, payoutCreate, payoutFindUnique } = makePrisma(200_000);
    payoutFindUnique.mockResolvedValue({ id: 'payout-old', userId: 'u1', status: 'REQUESTED', amount: 97_000, fee: 3000 });
    const r = await new WalletService(prisma, config).withdraw('u1', 100_000, {}, 'idk-1');
    expect(r).toMatchObject({ payoutId: 'payout-old', net: 97_000, fee: 3000, withdrawn: 100_000 });
    expect(debit).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('Idempotency-Key rỗng/khoảng trắng → coi như KHÔNG có key (không pre-check, payout key=undefined)', async () => {
    const { prisma, payoutCreate, payoutFindUnique } = makePrisma(200_000);
    await new WalletService(prisma, config).withdraw('u1', 100_000, {}, '   ');
    expect(payoutFindUnique).not.toHaveBeenCalled(); // không tra cứu theo key rỗng
    expect(payoutCreate.mock.calls[0][0].data.idempotencyKey).toBeUndefined();
  });

  it('idempotency race: create ăn P2002 → trả payout của kẻ thắng, không ném lỗi', async () => {
    const { prisma, payoutCreate, payoutFindUnique } = makePrisma(200_000);
    // lần đầu findUnique (pre-check) = null → đi tiếp; create ném P2002; findUnique lần 2 thấy payout kẻ thắng.
    payoutFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'payout-winner', userId: 'u1', status: 'REQUESTED', amount: 97_000, fee: 3000,
    });
    payoutCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );
    const r = await new WalletService(prisma, config).withdraw('u1', 100_000, {}, 'idk-2');
    expect(r).toMatchObject({ payoutId: 'payout-winner', net: 97_000 });
  });

  it('idempotency key trùng nhưng thuộc user khác → BadRequest, KHÔNG trả payout của người khác', async () => {
    const { prisma, debit, payoutCreate, payoutFindUnique } = makePrisma(200_000);
    payoutFindUnique.mockResolvedValue({ id: 'payout-other', userId: 'u2', status: 'REQUESTED', amount: 97_000, fee: 3000 });
    await expect(new WalletService(prisma, config).withdraw('u1', 100_000, {}, 'idk-3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(debit).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });
});

// PD-3 (Q-03, spec 5, T18): bỏ đổi Ví → xu. Route giữ lại trả 410 cho client cũ; không mở tx, không trừ ví.
describe('WalletService.convertToXu — đã ngừng (PD-3)', () => {
  it('mọi lệnh đổi → GoneException, không đọc/ghi gì (không trừ ví, không cộng xu)', async () => {
    const { prisma, debit, userUpdate, coinCreate, coinFindFirst } = makePrisma(200_000);
    const svc = new WalletService(prisma, config);
    const err = await svc.convertToXu().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoneException);
    expect((err as GoneException).getStatus()).toBe(410);
    expect((await svc.convertToXu().catch((e: Error) => e.message))).toMatch(/Ví Tubu vẫn rút được/);
    expect(debit).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(coinCreate).not.toHaveBeenCalled();
    expect(coinFindFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('WalletService.getWallet (PD-3: không còn số dư xu / hệ số đổi xu)', () => {
  it('payload không có coinsBalance, xuConvertMultiplier', async () => {
    const { prisma } = makePrisma(50_000);
    (prisma as unknown as { commission: unknown }).commission = { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) };
    const w = await new WalletService(prisma, config).getWallet('u1');
    expect(w).toMatchObject({ walletBalance: 50_000, withdrawMin: 100000, withdrawFee: 3000 });
    expect(w).not.toHaveProperty('coinsBalance');
    expect(w).not.toHaveProperty('xuConvertMultiplier');
  });
});

describe('WalletService.getTransactions (sao kê Ví, C-060)', () => {
  function makeLedgerPrisma(rows: Record<string, unknown>[], total: number) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const count = jest.fn().mockResolvedValue(total);
    const prisma = { walletTransaction: { findMany, count } } as unknown as PrismaService;
    return { prisma, findMany, count };
  }

  const at = new Date('2026-10-01T03:00:00Z');

  it('chỉ đọc sổ của chính user, mới nhất trước, phân trang skip/take + meta.total', async () => {
    const { prisma, findMany, count } = makeLedgerPrisma([], 45);
    const r = await new WalletService(prisma, config).getTransactions('u1', 3, 20);
    const args = findMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      where: { userId: 'u1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 40,
      take: 20,
    });
    expect(count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(r.meta).toEqual({ page: 3, limit: 20, total: 45 });
  });

  it('chỉ lộ mã đơn với dòng tham chiếu ORDER; mã payout/user bên kia (gộp phiên) không trả ra', async () => {
    const { prisma } = makeLedgerPrisma(
      [
        { id: 'w3', delta: 100_000, balanceAfter: 150_000, type: 'ORDER_REFUND', refType: 'ORDER', refId: 'ord-1', reason: 'Hoàn tiền đơn', createdAt: at },
        { id: 'w2', delta: 20_000, balanceAfter: 50_000, type: 'MERGE_IN', refType: 'USER', refId: 'guest-9', reason: null, createdAt: at },
        { id: 'w1', delta: -103_000, balanceAfter: 30_000, type: 'WITHDRAW', refType: 'PAYOUT', refId: 'po-1', reason: null, createdAt: at },
      ],
      3,
    );
    const r = await new WalletService(prisma, config).getTransactions('u1', 1, 20);
    expect(r.data).toEqual([
      { id: 'w3', delta: 100_000, balanceAfter: 150_000, type: 'ORDER_REFUND', reason: 'Hoàn tiền đơn', orderId: 'ord-1', createdAt: at },
      { id: 'w2', delta: 20_000, balanceAfter: 50_000, type: 'MERGE_IN', reason: null, orderId: null, createdAt: at },
      { id: 'w1', delta: -103_000, balanceAfter: 30_000, type: 'WITHDRAW', reason: null, orderId: null, createdAt: at },
    ]);
    expect(JSON.stringify(r.data)).not.toContain('guest-9');
  });
});
