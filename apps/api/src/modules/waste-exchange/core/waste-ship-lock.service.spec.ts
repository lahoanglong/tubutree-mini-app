import type { PrismaService } from '../../../prisma/prisma.service';
import type { WasteNotifierService } from './waste-notifier.service';
import { WasteShipLockService } from './waste-ship-lock.service';

describe('WasteShipLockService.shouldLock', () => {
  it('passes pct and streak as int parameters of the 15.6 query and reads should_lock', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ should_lock: true }]);
    const svc = new WasteShipLockService({} as PrismaService, {} as WasteNotifierService);
    await expect(svc.shouldLock({ $queryRaw } as never, 'u1', 50, 3)).resolves.toBe(true);
    const [strings, ...values] = $queryRaw.mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
    expect(values).toEqual(expect.arrayContaining(['u1', 50, 3]));
    expect(strings.join('?')).toContain('"closeReason" = \'PICKUP_NO_SHOW\'');
  });
  it.each([[[]], [[{ should_lock: null }]], [[{ should_lock: false }]]])('rows %j -> false', async (rows) => {
    const svc = new WasteShipLockService({} as PrismaService, {} as WasteNotifierService);
    await expect(svc.shouldLock({ $queryRaw: jest.fn().mockResolvedValue(rows) } as never, 'u1', 50, 3)).resolves.toBe(false);
  });
});

describe('WasteShipLockService.evaluateAndLock order (spec 15.6, 10.2)', () => {
  it('writes the lock and its event inside step 1, notifies after commit, then runs step 2', async () => {
    const order: string[] = [];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ should_lock: true }]),
      wasteUserFlags: { createMany: jest.fn().mockResolvedValue({ count: 1 }), updateMany: jest.fn(async () => { order.push('flags update'); return { count: 1 }; }) },
      wasteEvent: { create: jest.fn(async () => { order.push('event'); return { id: 'e1' }; }) },
      wasteRequest: { updateMany: jest.fn(async () => { order.push('cancel'); return { count: 1 }; }) },
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ should_lock: true }]),
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => { const r = await fn(tx); order.push('tx end'); return r; }),
      wasteRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
    };
    const notifier = { shipLocked: jest.fn(async () => { order.push('notify'); }) };
    const svc = new WasteShipLockService(prisma as never, notifier as never);
    await expect(svc.evaluateAndLock('u1', { shortfallLockPct: 50, shortfallLockStreak: 3 })).resolves.toMatchObject({ locked: true, cancelledRequestIds: ['p1'] });
    expect(order.indexOf('event')).toBeLessThan(order.indexOf('tx end'));
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('notify'));
    expect(order.indexOf('notify')).toBeLessThan(order.indexOf('cancel'));
  });
});
