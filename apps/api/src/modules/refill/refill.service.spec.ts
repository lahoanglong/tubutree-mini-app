import { BadRequestException } from '@nestjs/common';
import { RefillService } from './refill.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

function makeNotifications(): NotificationsService {
  return {
    notify: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    gameProfile: { upsert: jest.fn().mockResolvedValue({}) },
    bottleReturn: {
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'br1', createdAt: new Date(), ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'br1', userId: 'u1', quantity: 3, seedsAwarded: 150, status: 'PENDING' }),
      update: jest.fn().mockResolvedValue({ id: 'br1', status: 'APPROVED' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    notificationLog: {
      create: jest.fn().mockResolvedValue({ id: 'nl1' }),
    },
  };
  base.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(base) : Promise.all(arg as unknown[]),
    );
  return { ...base, ...over } as unknown as PrismaService;
}

describe('RefillService.returnBottles', () => {
  it('số vỏ <= 0 → throw', async () => {
    const prisma = makePrisma();
    const svc = new RefillService(prisma, makeConfig(), makeNotifications());
    await expect(svc.returnBottles('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bottleReturn.create).not.toHaveBeenCalled();
  });

  it('vượt trần tháng → throw', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 18 } });
    const svc = new RefillService(prisma, makeConfig({ 'refill.monthly_cap_bottles': 20 }), makeNotifications());
    await expect(svc.returnBottles('u1', 5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gửi đổi vỏ hợp lệ → tạo đơn PENDING (chưa cộng 💧 ngay)', async () => {
    const prisma = makePrisma();
    const svc = new RefillService(prisma, makeConfig({ 'refill.seeds_per_bottle': 50, 'refill.monthly_cap_bottles': 20 }), makeNotifications());
    const r = await svc.returnBottles('u1', 3);
    expect(r.seedsAwarded).toBe(150);
    expect(r.quantity).toBe(3);
    expect(r.status).toBe('PENDING');
    expect(r.monthlyRemaining).toBe(17);
    expect(prisma.gameProfile.upsert).not.toHaveBeenCalled(); // chưa cộng 💧 ngay
    const created = (prisma.bottleReturn.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ userId: 'u1', quantity: 3, seedsAwarded: 150, status: 'PENDING' });
  });
});

describe('RefillService.approveReturn', () => {
  it('duyệt đơn PENDING → chuyển APPROVED + cộng 💧 + tạo notificationLog', async () => {
    const prisma = makePrisma();
    const svc = new RefillService(prisma, makeConfig(), makeNotifications());
    const r = await svc.approveReturn('br1');
    expect(r.status).toBe('APPROVED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const up = (prisma.gameProfile.upsert as jest.Mock).mock.calls[0][0];
    expect(up.where).toEqual({ userId: 'u1' });
    expect(up.update.totalSeeds).toEqual({ increment: 150 });
  });
});
