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

  it('idempotent theo order_id → update, không tạo mới / không cộng pending lần nữa', async () => {
    const create = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn();
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue({ id: 'tx1', confirmedAt: null }), create, update },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    await new CashbackService(prisma, config).handlePostback(payload());
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
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
});
