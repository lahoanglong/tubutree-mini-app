import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { LifecycleService } from '../lifecycle/lifecycle.service';

const cfg = (over: Record<string, unknown> = {}) =>
  ({ get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? over[k] : fb) as T }) as unknown as SystemConfigService;
const notifications = { notify: jest.fn() } as unknown as NotificationsService;
const lifecycle = {} as unknown as LifecycleService;

// 13:00 giờ VN ngày 1/11/2026
const NOW = new Date('2026-11-01T06:00:00Z');

function setup(existing: Date[] = []) {
  const prisma = {
    flashSale: {
      findMany: jest.fn().mockResolvedValue(existing.map((startAt) => ({ startAt }))),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  } as any;
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const svc = (config: SystemConfigService = cfg()) => new FlashSaleService(prisma as PrismaService, config, notifications, lifecycle);
  return { prisma, svc };
}

const createdRows = (prisma: any): { title: string; startAt: Date; endAt: Date; createdBy: string }[] => prisma.flashSale.createMany.mock.calls[0][0].data;

describe('FlashSaleService.generateSlots (khung mặc định flashsale.slots)', () => {
  it('không cấu hình: dùng 12:00 và 20:00 giờ VN, 2 ngày ra 4 khung 2 giờ, tên "Giờ vàng HH:MM", ghi người tạo', async () => {
    const { prisma, svc } = setup();
    await expect(svc().generateSlots('a1', 2, NOW)).resolves.toEqual({ created: 4, skipped: 0 });
    const rows = createdRows(prisma);
    expect(rows.map((r) => r.title)).toEqual(['Giờ vàng 12:00', 'Giờ vàng 20:00', 'Giờ vàng 12:00', 'Giờ vàng 20:00']);
    expect(rows.map((r) => r.startAt.toISOString())).toEqual([
      '2026-11-01T05:00:00.000Z',
      '2026-11-01T13:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
      '2026-11-02T13:00:00.000Z',
    ]);
    expect(rows.every((r) => r.endAt.getTime() - r.startAt.getTime() === 120 * 60e3 && r.createdBy === 'a1')).toBe(true);
  });

  it('theo cấu hình ["09:30"]: khung 09:30, không phải mặc định', async () => {
    const { prisma, svc } = setup();
    // 05:00 giờ VN: khung 09:30 hôm nay còn phía trước
    const early = new Date('2026-10-31T22:00:00Z');
    await expect(svc(cfg({ 'flashsale.slots': ['09:30'] })).generateSlots('a1', 1, early)).resolves.toEqual({ created: 1, skipped: 0 });
    const rows = createdRows(prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Giờ vàng 09:30');
    expect(rows[0]!.startAt.toISOString()).toBe('2026-11-01T02:30:00.000Z');
  });

  it('khoá cấu hình hỏng thì về mặc định, không sinh khung rác', async () => {
    const { prisma, svc } = setup();
    await svc(cfg({ 'flashsale.slots': 'tối nay' })).generateSlots('a1', 1, NOW);
    expect(createdRows(prisma).map((r) => r.title)).toEqual(['Giờ vàng 12:00', 'Giờ vàng 20:00']);
  });

  it('mốc đã kết thúc bị bỏ: 14:00 giờ VN thì khung 12:00 hôm nay không tạo', async () => {
    const { prisma, svc } = setup();
    await expect(svc().generateSlots('a1', 1, new Date('2026-11-01T07:00:00Z'))).resolves.toEqual({ created: 1, skipped: 0 });
    expect(createdRows(prisma).map((r) => r.startAt.toISOString())).toEqual(['2026-11-01T13:00:00.000Z']);
  });

  it('chạy lần hai: mốc đã có đợt cùng giờ bắt đầu được bỏ qua, không tạo trùng', async () => {
    const { prisma, svc } = setup([new Date('2026-11-01T13:00:00Z'), new Date('2026-11-02T05:00:00Z')]);
    await expect(svc().generateSlots('a1', 2, NOW)).resolves.toEqual({ created: 2, skipped: 2 });
    expect(createdRows(prisma).map((r) => r.startAt.toISOString())).toEqual(['2026-11-01T05:00:00.000Z', '2026-11-02T13:00:00.000Z']);
  });

  it('mọi mốc đã có: không gọi createMany', async () => {
    const all = [
      new Date('2026-11-01T05:00:00Z'),
      new Date('2026-11-01T13:00:00Z'),
    ];
    const { prisma, svc } = setup(all);
    await expect(svc().generateSlots('a1', 1, NOW)).resolves.toEqual({ created: 0, skipped: 2 });
    expect(prisma.flashSale.createMany).not.toHaveBeenCalled();
  });

  it('tra trùng và ghi cùng một giao dịch, dưới khoá riêng (hai admin bấm cùng lúc)', async () => {
    const { prisma, svc } = setup();
    await svc().generateSlots('a1', 1, NOW);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it.each([0, 8, 1.5, -1, Number.NaN])('days=%s → 400, không đụng DB', async (days) => {
    const { prisma, svc } = setup();
    await expect(svc().generateSlots('a1', days, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
