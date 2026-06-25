import { BadRequestException } from '@nestjs/common';
import { RefillService } from './refill.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    gameProfile: { upsert: jest.fn().mockResolvedValue({}) },
    bottleReturn: {
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'br1', createdAt: new Date(), ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
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
  it('số vỏ <= 0 → throw, không cộng nước/không tạo record', async () => {
    const prisma = makePrisma();
    const svc = new RefillService(prisma, makeConfig());
    await expect(svc.returnBottles('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameProfile.upsert).not.toHaveBeenCalled();
    expect(prisma.bottleReturn.create).not.toHaveBeenCalled();
  });

  it('vượt trần tháng → throw, không cộng nước', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 18 } }); // đã đổi 18
    const svc = new RefillService(prisma, makeConfig({ 'refill.monthly_cap_bottles': 20 }));
    await expect(svc.returnBottles('u1', 5)).rejects.toBeInstanceOf(BadRequestException); // 18+5 > 20
    expect(prisma.gameProfile.upsert).not.toHaveBeenCalled();
  });

  it('đổi hợp lệ → cộng 💧 ATOMIC (increment) + tạo record + trả seedsAwarded', async () => {
    const prisma = makePrisma();
    const svc = new RefillService(prisma, makeConfig({ 'refill.seeds_per_bottle': 50, 'refill.monthly_cap_bottles': 20 }));
    const r = await svc.returnBottles('u1', 3);
    expect(r.seedsAwarded).toBe(150); // 3 × 50
    expect(r.quantity).toBe(3);
    expect(r.monthlyRemaining).toBe(17); // 20 − 3
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const up = (prisma.gameProfile.upsert as jest.Mock).mock.calls[0][0];
    expect(up.where).toEqual({ userId: 'u1' });
    expect(up.update.totalSeeds).toEqual({ increment: 150 });
    const created = (prisma.bottleReturn.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ userId: 'u1', quantity: 3, seedsAwarded: 150 });
  });
});

describe('RefillService.getSummary', () => {
  it('trả perBottle/cap/used/remaining/totalRecycled/history', async () => {
    const prisma = makePrisma();
    (prisma.bottleReturn.aggregate as jest.Mock)
      .mockResolvedValueOnce({ _sum: { quantity: 7 } }) // usedThisMonth
      .mockResolvedValueOnce({ _sum: { quantity: 42 } }); // totalRecycled
    (prisma.bottleReturn.findMany as jest.Mock).mockResolvedValue([
      { id: 'br1', quantity: 3, seedsAwarded: 150, createdAt: new Date() },
    ]);
    const svc = new RefillService(prisma, makeConfig({ 'refill.seeds_per_bottle': 50, 'refill.monthly_cap_bottles': 20 }));
    const r = await svc.getSummary('u1');
    expect(r.perBottle).toBe(50);
    expect(r.monthlyCap).toBe(20);
    expect(r.monthlyUsed).toBe(7);
    expect(r.monthlyRemaining).toBe(13);
    expect(r.totalRecycled).toBe(42);
    expect(r.history).toHaveLength(1);
  });
});
