import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function makePrisma(walletBalance: number, decCount = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count: decCount });
  const payoutCreate = jest.fn().mockResolvedValue({ id: 'payout-1' });
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', walletBalance }), updateMany },
    payout: { create: payoutCreate },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return { prisma, updateMany, payoutCreate };
}

describe('WalletService.withdraw', () => {
  it('dưới mức tối thiểu → BadRequest, không trừ tiền', async () => {
    const { prisma, updateMany } = makePrisma(1_000_000);
    await expect(new WalletService(prisma, config).withdraw('u1', 10_000, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('số dư không đủ (check sớm) → BadRequest', async () => {
    const { prisma, updateMany } = makePrisma(30_000);
    await expect(new WalletService(prisma, config).withdraw('u1', 60_000, {})).rejects.toThrow('không đủ');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('hợp lệ → trừ tiền ATOMIC (where gte) + tạo payout REQUESTED', async () => {
    const { prisma, updateMany, payoutCreate } = makePrisma(100_000);
    const r = await new WalletService(prisma, config).withdraw('u1', 60_000, { bank: 'VCB' });
    expect(r.status).toBe('REQUESTED');
    // điều kiện gte amount để chống overdraft
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'u1', walletBalance: { gte: 60_000 } });
    expect(updateMany.mock.calls[0][0].data.walletBalance).toEqual({ decrement: 60_000 });
    expect(payoutCreate).toHaveBeenCalled();
  });

  it('race overdraft: updateMany count=0 (số dư đã đổi) → BadRequest, KHÔNG tạo payout', async () => {
    // check sớm pass (đọc số dư cũ đủ) nhưng atomic decrement thất bại → chặn
    const { prisma, payoutCreate } = makePrisma(100_000, 0);
    await expect(new WalletService(prisma, config).withdraw('u1', 60_000, {})).rejects.toThrow('không đủ');
    expect(payoutCreate).not.toHaveBeenCalled();
  });
});
