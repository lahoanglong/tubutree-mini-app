import { CashbackService } from './cashback.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T, // dùng default 0.7
} as unknown as SystemConfigService;

const payload = (over: Partial<Record<string, unknown>> = {}) => ({
  utm_content: 'click-1',
  order_id: 'AT-ORDER-1',
  amount: 500000,
  commission: 50000,
  status: 'approved' as const,
  ...over,
});

describe('CashbackService.handlePostback', () => {
  it('postback không khớp click → ok:false, không tạo giao dịch', async () => {
    const create = jest.fn();
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue(null) },
      cashbackTransaction: { findFirst: jest.fn(), create },
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config).handlePostback(payload());
    expect(r).toEqual({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('approved mới → userReward = 70% commission, cộng cashbackPending', async () => {
    const create = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    await new CashbackService(prisma, config).handlePostback(payload());
    const data = create.mock.calls[0][0].data;
    expect(data.userReward).toBe(35000); // floor(50000 * 0.7)
    expect(data.status).toBe('CONFIRMED');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
  });

  it('pending → tạo giao dịch nhưng KHÔNG cộng cashbackPending', async () => {
    const create = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn();
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    await new CashbackService(prisma, config).handlePostback(payload({ status: 'pending' }));
    expect(create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  // ── transition existing (idempotent + chuyển trạng thái) ──
  function updateBranchPrisma(existing: Record<string, unknown>) {
    const update = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn().mockReturnValue({ __op: 'user.update' });
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn(), update },
      user: { update: userUpdate },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    return { prisma, update, userUpdate };
  }

  it('duplicate APPROVED (đã CONFIRMED) → update, KHÔNG cộng pending lần nữa', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config).handlePostback(payload({ status: 'approved' }));
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('PENDING → APPROVED → CỘNG cashbackPending (fix bug mất cashback)', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config).handlePostback(payload({ status: 'approved' }));
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
  });

  it('CONFIRMED → REJECTED → TRỪ cashbackPending', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config).handlePostback(payload({ status: 'rejected' }));
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { decrement: 35000 } } }),
    );
  });

  it('đã PAID → postback không đụng số dư (đã về Ví)', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PAID', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config).handlePostback(payload({ status: 'rejected' }));
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('CashbackService.settleConfirmed', () => {
  function settlePrisma(due: Record<string, unknown>[], markCount = 1) {
    const updateMany = jest.fn().mockResolvedValue({ count: markCount });
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackTransaction: { findMany: jest.fn().mockResolvedValue(due), updateMany },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
    return { prisma, updateMany, userUpdate };
  }

  it('CONFIRMED quá hold → set PAID atomic + chuyển pending→Ví', async () => {
    const { prisma, updateMany, userUpdate } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }]);
    await new CashbackService(prisma, config).settleConfirmed();
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'tx1', status: 'CONFIRMED' });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { decrement: 35000 }, walletBalance: { increment: 35000 } } }),
    );
  });

  it('multi-instance race: updateMany count=0 → KHÔNG cộng ví lần nữa', async () => {
    const { prisma, userUpdate } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }], 0);
    await new CashbackService(prisma, config).settleConfirmed();
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
