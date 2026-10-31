import { WasteGiftExpiryCron } from './waste-gift-expiry.cron';

const NOW = new Date('2026-11-20T01:00:00Z');

function setup(o: { locked?: boolean } = {}) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: o.locked ?? true }]) };
  const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
  const gifts = { expireOverdue: jest.fn().mockResolvedValue({ expired: 2, failed: 0, held: 0 }) };
  const cron = new WasteGiftExpiryCron(prisma as never, gifts as never);
  return { cron, prisma, gifts };
}

describe('WasteGiftExpiryCron', () => {
  it('runs the sweep under the advisory lock with the given clock', async () => {
    const h = setup();
    expect(await h.cron.run(NOW)).toEqual({ expired: 2, failed: 0, held: 0 });
    expect(h.gifts.expireOverdue).toHaveBeenCalledWith(NOW);
  });

  it('does not read the programme flag: gifts expire even while waste.enabled is off', async () => {
    const h = setup();
    expect(await h.cron.run(NOW)).toEqual({ expired: 2, failed: 0, held: 0 });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('another replica holds the lock: skips', async () => {
    const h = setup({ locked: false });
    expect(await h.cron.run(NOW)).toEqual({ expired: 0, failed: 0, held: 0 });
    expect(h.gifts.expireOverdue).not.toHaveBeenCalled();
  });

  it('an overlapping run in the same process is skipped', async () => {
    const h = setup();
    let release!: () => void;
    h.gifts.expireOverdue.mockReturnValue(new Promise((r) => { release = () => r({ expired: 0, failed: 0, held: 0 }); }));
    const first = h.cron.run(NOW);
    await new Promise((r) => setImmediate(r));
    expect(await h.cron.run(NOW)).toEqual({ expired: 0, failed: 0, held: 0 });
    release();
    await first;
    expect(h.gifts.expireOverdue).toHaveBeenCalledTimes(1);
  });

  it('handleCron swallows a thrown error', async () => {
    const h = setup();
    h.gifts.expireOverdue.mockRejectedValue(new Error('db down'));
    await expect(h.cron.handleCron()).resolves.toBeUndefined();
  });
});
