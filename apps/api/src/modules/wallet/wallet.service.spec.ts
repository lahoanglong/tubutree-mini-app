import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

// config trả default → dùng đúng default thiết kế: withdraw_min 100k, withdraw_fee 3k, ×1.2.
const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function makePrisma(walletBalance: number, decCount = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count: decCount });
  const userUpdate = jest.fn().mockResolvedValue({});
  const payoutCreate = jest.fn().mockResolvedValue({ id: 'payout-1' });
  const payoutFindUnique = jest.fn().mockResolvedValue(null);
  const coinCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', walletBalance }), updateMany, update: userUpdate },
    payout: { create: payoutCreate, findUnique: payoutFindUnique },
    coinTransaction: { create: coinCreate, findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return { prisma, updateMany, userUpdate, payoutCreate, payoutFindUnique, coinCreate, coinFindFirst: (prisma as unknown as { coinTransaction: { findFirst: jest.Mock } }).coinTransaction.findFirst };
}

describe('WalletService.withdraw (Ví → ngân hàng, min 100k, phí 3k)', () => {
  it('dưới mức tối thiểu 100k → BadRequest, không trừ tiền', async () => {
    const { prisma, updateMany } = makePrisma(1_000_000);
    await expect(new WalletService(prisma, config).withdraw('u1', 99_999, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('số dư không đủ (check sớm) → BadRequest', async () => {
    const { prisma, updateMany } = makePrisma(50_000);
    await expect(new WalletService(prisma, config).withdraw('u1', 100_000, {})).rejects.toThrow('không đủ');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rút 100k hợp lệ → trừ ví 100k ATOMIC, Payout thực nhận 97k + phí 3k', async () => {
    const { prisma, updateMany, payoutCreate } = makePrisma(200_000);
    const r = await new WalletService(prisma, config).withdraw('u1', 100_000, { bank: 'VCB' });
    expect(r).toMatchObject({ status: 'REQUESTED', fee: 3000, net: 97_000, withdrawn: 100_000 });
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'u1', walletBalance: { gte: 100_000 } });
    expect(updateMany.mock.calls[0][0].data.walletBalance).toEqual({ decrement: 100_000 });
    expect(payoutCreate.mock.calls[0][0].data).toMatchObject({ amount: 97_000, fee: 3000, method: 'BANK', status: 'REQUESTED' });
  });

  it('race overdraft: updateMany count=0 → BadRequest, KHÔNG tạo payout', async () => {
    const { prisma, payoutCreate } = makePrisma(200_000, 0);
    await expect(new WalletService(prisma, config).withdraw('u1', 100_000, {})).rejects.toThrow('không đủ');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('cấu hình sai (phí ≥ tiền rút) → net ≤ 0 bị chặn, KHÔNG trừ ví/ tạo payout âm', async () => {
    // min=2000, fee=3000 → withdraw 2000 qua được check min nhưng net = -1000.
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        (k === 'wallet.withdraw_min' ? 2000 : k === 'wallet.withdraw_fee' ? 3000 : fb) as T,
    } as unknown as SystemConfigService;
    const { prisma, updateMany, payoutCreate } = makePrisma(200_000);
    await expect(new WalletService(prisma, cfg).withdraw('u1', 2000, {})).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('idempotency: key đã có payout → trả lại payout cũ, KHÔNG trừ ví / tạo payout mới', async () => {
    const { prisma, updateMany, payoutCreate, payoutFindUnique } = makePrisma(200_000);
    payoutFindUnique.mockResolvedValue({ id: 'payout-old', userId: 'u1', status: 'REQUESTED', amount: 97_000, fee: 3000 });
    const r = await new WalletService(prisma, config).withdraw('u1', 100_000, {}, 'idk-1');
    expect(r).toMatchObject({ payoutId: 'payout-old', net: 97_000, fee: 3000, withdrawn: 100_000 });
    expect(updateMany).not.toHaveBeenCalled();
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
    const { prisma, updateMany, payoutCreate, payoutFindUnique } = makePrisma(200_000);
    payoutFindUnique.mockResolvedValue({ id: 'payout-other', userId: 'u2', status: 'REQUESTED', amount: 97_000, fee: 3000 });
    await expect(new WalletService(prisma, config).withdraw('u1', 100_000, {}, 'idk-3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });
});

describe('WalletService.convertToXu (Ví → TubuXu ×1.2)', () => {
  it('đổi 100.000đ → nhận 120.000 xu, trừ ví đúng, ghi CoinTransaction', async () => {
    const { prisma, updateMany, userUpdate, coinCreate } = makePrisma(200_000);
    const r = await new WalletService(prisma, config).convertToXu('u1', 100_000);
    expect(r).toEqual({ spent: 100_000, received: 120_000, multiplier: 1.2 });
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'u1', walletBalance: { gte: 100_000 } },
      data: { walletBalance: { decrement: 100_000 } },
    });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { coinsBalance: { increment: 120_000 } } }),
    );
    expect(coinCreate.mock.calls[0][0].data).toMatchObject({ userId: 'u1', delta: 120_000, reason: 'CONVERT_FROM_WALLET', refType: 'CONVERT' });
  });

  it('ví không đủ (count 0) → throw, không cộng xu', async () => {
    const { prisma, userUpdate } = makePrisma(200_000, 0);
    await expect(new WalletService(prisma, config).convertToXu('u1', 100_000)).rejects.toThrow('Số dư Ví');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('số tiền <= 0 hoặc không nguyên → throw', async () => {
    const svc = new WalletService(makePrisma(200_000).prisma, config);
    await expect(svc.convertToXu('u1', 0)).rejects.toThrow();
    await expect(svc.convertToXu('u1', -5)).rejects.toThrow();
    await expect(svc.convertToXu('u1', 1.5)).rejects.toThrow();
  });

  // P2 (docs/2026-09-08-review-progress.md): đây là endpoint tiền DUY NHẤT không có
  // Idempotency-Key, trong khi chiều đổi là MỘT CHIỀU — xu không rút được, không có đường về
  // ví. Double-tap "Đổi ngay" (react-query không tự dedupe, `disabled` chỉ có tác dụng sau
  // khi re-render) là mất vĩnh viễn phần tiền rút được đã đổi dư.
  it('cùng Idempotency-Key lần 2 → KHÔNG trừ ví lần 2, trả lại kết quả lần đầu', async () => {
    const { prisma, updateMany, userUpdate, coinFindFirst } = makePrisma(200_000);
    coinFindFirst.mockResolvedValue({ id: 'ct1', userId: 'u1', delta: 120_000, refId: 'key-1' });
    const r = await new WalletService(prisma, config).convertToXu('u1', 100_000, 'key-1');
    expect(r).toEqual({ spent: 100_000, received: 120_000, multiplier: 1.2 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('có Idempotency-Key (lần đầu) → lưu key vào CoinTransaction.refId để lần sau nhận ra', async () => {
    const { prisma, coinCreate } = makePrisma(200_000);
    await new WalletService(prisma, config).convertToXu('u1', 100_000, 'key-1');
    expect(coinCreate.mock.calls[0][0].data).toMatchObject({ refType: 'CONVERT', refId: 'key-1' });
  });

  it('key rỗng/khoảng trắng → coi như không có key (không ghi refId rỗng gây đụng unique)', async () => {
    const { prisma, coinCreate, coinFindFirst } = makePrisma(200_000);
    await new WalletService(prisma, config).convertToXu('u1', 100_000, '   ');
    expect(coinFindFirst).not.toHaveBeenCalled();
    expect(coinCreate.mock.calls[0][0].data.refId ?? null).toBeNull();
  });

  it('key trùng nhưng của user KHÁC → từ chối, không trả giao dịch người khác ra ngoài', async () => {
    const { prisma, coinFindFirst } = makePrisma(200_000);
    coinFindFirst.mockResolvedValue({ id: 'ct1', userId: 'nguoi-khac', delta: 120_000, refId: 'key-1' });
    await expect(new WalletService(prisma, config).convertToXu('u1', 100_000, 'key-1')).rejects.toThrow(
      'Idempotency-Key',
    );
  });
});
