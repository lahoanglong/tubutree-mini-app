import { GameOrderWaterService } from './game-order-water.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { startOfVnWeek, startOfNextVnWeek } from '../../common/vn-time';

type Cfg = Record<string, unknown>;

function make(opts: { cfg?: Cfg; order?: Record<string, unknown> | null; user?: Record<string, unknown>; used?: number; total?: number; existing?: boolean } = {}) {
  const cfg: Cfg = { 'game.order_seeds': 100, 'game.order_seeds_weekly_cap': 300, 'game.tank_capacity': 500, ...(opts.cfg ?? {}) };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ totalSeeds: opts.total ?? 0 }]),
    gameWaterEvent: {
      findUnique: jest.fn().mockResolvedValue(opts.existing ? { id: 'e' } : null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { delta: opts.used ?? 0 } }),
      create: jest.fn().mockResolvedValue({}),
    },
    gameProfile: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(opts.order === undefined ? { id: 'o1', userId: 'u1', status: 'DELIVERED', placedForCustomer: false } : opts.order) },
    user: { findUnique: jest.fn().mockResolvedValue(opts.user ?? { zaloId: 'z123', phone: null }) },
    gameProfile: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1' }) },
    gameWaterEvent: tx.gameWaterEvent,
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const config = { get: jest.fn(async (k: string, d: unknown) => (k in cfg ? cfg[k] : d)) };
  const svc = new GameOrderWaterService(prisma as unknown as PrismaService, config as unknown as SystemConfigService);
  return { svc, tx, prisma };
}

describe('GameOrderWaterService.grantForOrder', () => {
  it('đơn giao cộng 100 giọt và ghi sổ theo đơn', async () => {
    const { svc, tx } = make();
    await expect(svc.grantForOrder('o1')).resolves.toEqual({ granted: 100 });
    expect(tx.gameWaterEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u1', delta: 100, reason: 'ORDER_DELIVERED', refId: 'o1' }) });
    expect(tx.gameProfile.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { totalSeeds: { increment: 100 } } });
  });

  it('đã có dòng sổ của đơn: không cộng lần nữa', async () => {
    const { svc, tx } = make({ existing: true });
    await expect(svc.grantForOrder('o1')).resolves.toEqual({ granted: 0, skipped: 'ALREADY_GRANTED' });
    expect(tx.gameWaterEvent.create).not.toHaveBeenCalled();
    expect(tx.gameProfile.update).not.toHaveBeenCalled();
  });

  it('còn 40 giọt trong trần tuần: cộng 40, hết trần: ghi dòng 0 và không cộng', async () => {
    const a = make({ used: 260 });
    await expect(a.svc.grantForOrder('o1')).resolves.toEqual({ granted: 40 });
    const b = make({ used: 300 });
    await expect(b.svc.grantForOrder('o1')).resolves.toEqual({ granted: 0 });
    expect(b.tx.gameWaterEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ delta: 0 }) });
    expect(b.tx.gameProfile.update).not.toHaveBeenCalled();
    const c = make({ used: 999 });
    await expect(c.svc.grantForOrder('o1')).resolves.toEqual({ granted: 0 });
  });

  it('cửa sổ đếm là tuần giờ VN chứa thời điểm cộng', async () => {
    const now = new Date('2026-10-25T17:30:00Z'); // 00:30 thứ Hai 26/10 giờ VN
    const { svc, tx } = make();
    await svc.grantForOrder('o1', now);
    expect(tx.gameWaterEvent.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: startOfVnWeek(now), lt: startOfNextVnWeek(now) } }) }),
    );
    expect(startOfVnWeek(now).toISOString()).toBe('2026-10-25T17:00:00.000Z');
  });

  it('bình gần đầy: chỉ cộng phần còn chỗ, không bao giờ âm', async () => {
    const a = make({ total: 450 });
    await expect(a.svc.grantForOrder('o1')).resolves.toEqual({ granted: 50 });
    const b = make({ total: 800 });
    await expect(b.svc.grantForOrder('o1')).resolves.toEqual({ granted: 0 });
  });

  it('công tắc 0 (số giọt hoặc trần tuần) tắt hẳn, không đụng DB', async () => {
    for (const cfg of [{ 'game.order_seeds': 0 }, { 'game.order_seeds_weekly_cap': 0 }]) {
      const { svc, prisma } = make({ cfg });
      await expect(svc.grantForOrder('o1')).resolves.toEqual({ granted: 0, skipped: 'DISABLED' });
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    }
  });

  it('đổi cấu hình: 50 giọt mỗi đơn, trần 120', async () => {
    const { svc } = make({ cfg: { 'game.order_seeds': 50, 'game.order_seeds_weekly_cap': 120 }, used: 100 });
    await expect(svc.grantForOrder('o1')).resolves.toEqual({ granted: 20 });
  });

  it('đơn chưa giao, đơn CTV lên hộ, tài khoản khách vãng lai: không cộng', async () => {
    const notDelivered = make({ order: { id: 'o1', userId: 'u1', status: 'SHIPPING', placedForCustomer: false } });
    await expect(notDelivered.svc.grantForOrder('o1')).resolves.toMatchObject({ skipped: 'NOT_DELIVERED' });
    const ctv = make({ order: { id: 'o1', userId: 'u1', status: 'DELIVERED', placedForCustomer: true } });
    await expect(ctv.svc.grantForOrder('o1')).resolves.toMatchObject({ skipped: 'NOT_ELIGIBLE' });
    const guest = make({ user: { zaloId: 'guest_abc', phone: null } });
    await expect(guest.svc.grantForOrder('o1')).resolves.toMatchObject({ skipped: 'NOT_ELIGIBLE' });
    for (const m of [notDelivered, ctv, guest]) expect(m.tx.gameProfile.update).not.toHaveBeenCalled();
  });
});

describe('GameOrderWaterService.summary', () => {
  it('trả số giọt mỗi đơn, trần tuần và phần đã nhận trong tuần', async () => {
    const { svc } = make({ used: 200 });
    await expect(svc.summary('u1')).resolves.toEqual({ perOrder: 100, weeklyCap: 300, weeklyGranted: 200 });
  });
});
