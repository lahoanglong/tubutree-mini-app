import { VouchersService } from './vouchers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(key: string, fallback?: T): Promise<T> =>
      (key in values ? values[key] : fallback) as T,
  } as unknown as SystemConfigService;
}

interface GrantOpts {
  userId: string;
  reason: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number;
  validDays: number;
  templateCode: string;
}

describe('VouchersService.grant', () => {
  const baseOpts: GrantOpts = {
    userId: 'user123456789',
    reason: 'WELCOME',
    type: 'AMOUNT',
    value: 30000,
    minOrder: 199000,
    validDays: 30,
    templateCode: 'WELCOME_VOUCHER',
  };

  it('không cấp lại khi đã có coupon cùng reason cho user (findUnique theo code)', async () => {
    const prisma = {
      coupon: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }), create: jest.fn() },
    } as unknown as PrismaService;
    const notify = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const svc = new VouchersService(prisma, makeConfig(), notify);

    const result = await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant(baseOpts);

    expect(result).toBe(false);
    expect((prisma.coupon.create as jest.Mock)).not.toHaveBeenCalled();
    expect((notify.notify as jest.Mock)).not.toHaveBeenCalled();
  });

  it('cấp coupon cá nhân (USER_GROUP, usageLimit 1) + code deterministic + notify', async () => {
    const prisma = {
      coupon: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notify = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const svc = new VouchersService(prisma, makeConfig(), notify);

    const result = await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant(baseOpts);

    expect(result).toBe(true);
    expect((prisma.coupon.create as jest.Mock)).toHaveBeenCalledTimes(1);
    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(data.scope).toBe('USER_GROUP');
    expect(data.usageLimit).toBe(1);
    expect(data.perUserLimit).toBe(1);
    expect(data.type).toBe('AMOUNT');
    expect(data.value).toBe(30000);
    // code deterministic theo reason + full userId (chốt idempotency qua @unique)
    expect(data.code).toBe(`WELCOME-${baseOpts.userId}`.toUpperCase());
    expect(data.scopeMeta).toMatchObject({ userId: baseOpts.userId, reason: 'WELCOME' });
    expect((notify.notify as jest.Mock)).toHaveBeenCalledWith(
      baseOpts.userId,
      'WELCOME_VOUCHER',
      expect.objectContaining({ value: '30000' }),
    );
  });

  it('race multi-instance: create ném P2002 → coi như đã cấp (false), không notify', async () => {
    const prisma = {
      coupon: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })),
      },
    } as unknown as PrismaService;
    const notify = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const svc = new VouchersService(prisma, makeConfig(), notify);

    const result = await (svc as unknown as { grant(o: GrantOpts): Promise<boolean> }).grant(baseOpts);

    expect(result).toBe(false);
    expect((notify.notify as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('VouchersService.milestoneVouchers (§6.6)', () => {
  function setup(rows: { userId: string; spent: bigint }[]) {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(rows),
      coupon: { findUnique: jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    const notify = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    return { svc: new VouchersService(prisma, makeConfig(), notify), create };
  }

  it('cấp voucher mốc CAO NHẤT đạt được (3tr → 100k)', async () => {
    const { svc, create } = setup([{ userId: 'u1', spent: BigInt(3_500_000) }]);
    await svc.milestoneVouchers();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.value).toBe(100000); // mốc 3tr
  });

  it('chi tiêu dưới mốc thấp nhất (1tr) → không cấp', async () => {
    const { svc, create } = setup([{ userId: 'u1', spent: BigInt(500_000) }]);
    await svc.milestoneVouchers();
    expect(create).not.toHaveBeenCalled();
  });

  it('đạt mốc cao nhất (5tr → 200k)', async () => {
    const { svc, create } = setup([{ userId: 'u1', spent: BigInt(6_000_000) }]);
    await svc.milestoneVouchers();
    expect(create.mock.calls[0][0].data.value).toBe(200000);
  });
});
