import { HttpException, Logger } from '@nestjs/common';
import { tick } from '../../../../test/fakes/race-db.fake';
import { createWasteRaceDb, user, warehouse, type WasteRaceOptions } from '../../../../test/fakes/waste-race.harness';
import { RewardPointsService } from '../../wallet/reward-points.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

/**
 * Lượt đổi quà hiện vật (READY) bị nhiều bên giành cùng lúc: hai admin huỷ, admin huỷ với quầy trao quà, admin huỷ với cron quá hạn nhận
 * (Postgres READ COMMITTED, test/fakes/race-db.fake.ts). Điểm hoàn (GIFT_REFUND) và tồn kho chỉ được trả lại đúng một lần, và lượt đã trao
 * hoặc đã huỷ không bị ghi đè. Dùng WasteGiftRedemptionsService, WasteAccessService và RewardPointsService THẬT; chỉ thông báo là giả.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);
const SWEEP = Array.from({ length: 81 }, (_, i) => i - 40);

const COST = 30_000;
const OVERDUE_AT = new Date('2026-11-01T00:00:00Z');
const OPEN_UNTIL = new Date('2099-12-16T00:00:00Z');
const NOW = new Date('2026-11-10T03:00:00Z');

function setup(opts: WasteRaceOptions & { claimExpiresAt?: Date } = {}) {
  const { db, prisma } = createWasteRaceDb(opts);
  db.seed('user', [
    user('u1', '0900000001', { pointsBalance: 0 }),
    user('s1', '0900000002', { role: 'STAFF' }),
    user('a1', '0900000004', { role: 'ADMIN' }),
    user('a2', '0900000005', { role: 'ADMIN' }),
  ]);
  db.seed('wastePoint', [warehouse]);
  db.seed('wasteGift', [{ id: 'g1', kind: 'GIFT', name: 'Túi vải Tubu', pointsCost: COST, status: 'ACTIVE', stock: 4 }]);
  db.seed('wasteGiftRedemption', [
    {
      id: 'd1',
      userId: 'u1',
      giftId: 'g1',
      giftKind: 'GIFT',
      giftName: 'Túi vải Tubu',
      pointsCost: COST,
      status: 'READY',
      code: 'QG-ABCDEFGH',
      couponId: null,
      idempotencyKey: 'k1',
      claimExpiresAt: opts.claimExpiresAt ?? OPEN_UNTIL,
      fulfilledAt: null,
      cancelledAt: null,
      cancelReason: null,
      refundedPoints: null,
      createdAt: new Date('2026-10-17T00:00:00Z'),
    },
  ]);

  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const notifier = { giftCancelled: jest.fn().mockResolvedValue(undefined), giftExpired: jest.fn().mockResolvedValue(undefined) };
  const svc = new WasteGiftRedemptionsService(prisma, new WasteAccessService(prisma), { snapshot: async () => ({ enabled: true }) } as never, new RewardPointsService(prisma, config as never), notifier as never);

  const cancel = (admin = 'a1', body: { reason: string; refundPoints?: boolean } = { reason: 'Hết quà thật' }) => svc.cancel(admin, 'd1', body as never);
  const fulfil = (staff = 's1', via: 'id' | 'code' = 'id') =>
    via === 'id' ? svc.fulfilById(staff, 'd1', { code: 'QG-ABCDEFGH' }) : svc.fulfilAtDesk(staff, { pointId: 'wh', code: 'QG-ABCDEFGH' });
  const expire = () => svc.expireOverdue(NOW);
  const redemption = () => db.row('wasteGiftRedemption', 'd1')!;
  const stock = () => db.row('wasteGift', 'g1')!.stock as number;
  const balance = () => db.row('user', 'u1')!.pointsBalance as number;
  const refunds = () => db.rows('pointsTransaction').filter((t) => t.refType === 'GIFT_REFUND');
  const events = (kind: string) => db.rows('wasteEvent').filter((e) => e.kind === kind);
  return { db, cancel, fulfil, expire, redemption, stock, balance, refunds, events, notifier };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Đổi quà hiện vật — huỷ, trao và quá hạn nhận đua nhau', () => {
  it('hai admin huỷ cùng một lượt đổi (quét thời điểm): hoàn điểm và trả tồn kho đúng MỘT lần, bên thua nhận 409', async () => {
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const first = async () => (await delay(Math.max(skew, 0)), h.cancel('a1'));
      const second = async () => (await delay(Math.max(-skew, 0)), h.cancel('a2'));
      const [a, b] = await Promise.allSettled([first(), second()]);
      const label = `skew ${skew}`;
      is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
      is(label, httpStatus(a.status === 'fulfilled' ? b : a), 409);
      is(label, h.redemption().status, 'CANCELLED');
      is(label, h.redemption().cancelledByUserId, a.status === 'fulfilled' ? 'a1' : 'a2');
      is(label, h.redemption().refundedPoints, COST);
      is(label, h.balance(), COST);
      is(label, h.refunds().length, 1);
      is(label, h.stock(), 5);
      is(label, h.events('GIFT_CANCELLED').length, 1);
      is(label, h.notifier.giftCancelled.mock.calls.length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it.each(['id', 'code'] as const)('admin huỷ chen với quầy trao quà theo %s (quét thời điểm): hoặc FULFILLED không hoàn điểm, hoặc CANCELLED hoàn đúng một lần; trạng thái cuối không bị ghi đè', async (via) => {
    const seen = new Set<string>();
    let waits = 0;
    for (const skew of SWEEP) {
      const h = setup();
      const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel('a1'));
      const fulfilling = async () => (await delay(Math.max(-skew, 0)), h.fulfil('s1', via));
      const [c, f] = await Promise.allSettled([cancelling(), fulfilling()]);
      const label = `skew ${skew}`;
      is(label, [c.status, f.status].filter((s) => s === 'fulfilled').length, 1);
      if (c.status === 'fulfilled') {
        is(label, h.redemption().status, 'CANCELLED');
        is(label, h.redemption().fulfilledAt ?? null, null);
        is(label, h.balance(), COST);
        is(label, h.refunds().length, 1);
        is(label, h.stock(), 5);
        is(label, httpStatus(f), 409);
        is(label, h.events('GIFT_FULFILLED').length, 0);
      } else {
        is(label, h.redemption().status, 'FULFILLED');
        is(label, h.redemption().cancelledAt ?? null, null);
        is(label, h.balance(), 0);
        is(label, h.refunds().length, 0);
        is(label, h.stock(), 4);
        is(label, httpStatus(c), 409);
        is(label, h.events('GIFT_CANCELLED').length, 0);
        is(label, h.notifier.giftCancelled.mock.calls.length, 0);
      }
      seen.add(h.redemption().status as string);
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['CANCELLED', 'FULFILLED']));
    expect(waits).toBeGreaterThan(0);
  });

  it('admin huỷ chen với cron quá hạn nhận (quét thời điểm): hoàn điểm và trả tồn kho đúng MỘT lần dù cả hai cùng thấy lượt READY quá hạn', async () => {
    let waits = 0;
    const winners = new Set<string>();
    for (const skew of SWEEP) {
      const h = setup({ claimExpiresAt: OVERDUE_AT });
      const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel('a1'));
      const expiring = async () => (await delay(Math.max(-skew, 0)), h.expire());
      const [c, e] = await Promise.allSettled([cancelling(), expiring()]);
      const label = `skew ${skew}`;
      is(label, e.status, 'fulfilled');
      is(label, h.redemption().status, 'CANCELLED');
      is(label, h.balance(), COST);
      is(label, h.refunds().length, 1);
      is(label, h.stock(), 5);
      const cron = (e as PromiseFulfilledResult<{ expired: number }>).value.expired;
      is(label, (c.status === 'fulfilled' ? 1 : 0) + cron, 1);
      if (c.status === 'rejected') is(label, httpStatus(c), 409);
      is(label, h.events('GIFT_CANCELLED').length + h.events('GIFT_EXPIRED').length, 1);
      winners.add(c.status === 'fulfilled' ? 'admin' : 'cron');
      waits += h.db.stats.lockWaits;
    }
    expect(winners).toEqual(new Set(['admin', 'cron']));
    expect(waits).toBeGreaterThan(0);
  });

  it.each(['FULFILLED', 'CANCELLED'])('lượt đã %s không bị huỷ hay trao lại: 409, không hoàn điểm, không đổi trạng thái', async (status) => {
    const h = setup();
    h.db.seed('wasteGiftRedemption', [{ ...h.redemption(), status }]);
    const settled = await Promise.allSettled([h.cancel('a1'), h.cancel('a2'), h.fulfil('s1'), h.expire()]);
    expect(settled.slice(0, 3).every((s) => s.status === 'rejected' && httpStatus(s) === 409)).toBe(true);
    expect(h.redemption().status).toBe(status);
    expect(h.balance()).toBe(0);
    expect(h.refunds()).toHaveLength(0);
    expect(h.stock()).toBe(4);
  });

  describe('chỉ CAS (bỏ unique GIFT_REFUND của sổ điểm)', () => {
    const casOnly = { ledgerUnique: false } satisfies WasteRaceOptions;

    it('hai admin huỷ cùng lúc vẫn hoàn điểm và trả tồn kho đúng một lần', async () => {
      for (const skew of SWEEP) {
        const h = setup(casOnly);
        const first = async () => (await delay(Math.max(skew, 0)), h.cancel('a1'));
        const second = async () => (await delay(Math.max(-skew, 0)), h.cancel('a2'));
        const [a, b] = await Promise.allSettled([first(), second()]);
        const label = `skew ${skew}`;
        is(label, [a.status, b.status].filter((s) => s === 'fulfilled').length, 1);
        is(label, h.balance(), COST);
        is(label, h.refunds().length, 1);
        is(label, h.stock(), 5);
      }
    });

    it('huỷ chen với trao quà không ghi đè trạng thái cuối của nhau và không hoàn điểm cho lượt đã trao', async () => {
      const seen = new Set<string>();
      for (const skew of SWEEP) {
        const h = setup(casOnly);
        const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel('a1'));
        const fulfilling = async () => (await delay(Math.max(-skew, 0)), h.fulfil('s1'));
        const [c, f] = await Promise.allSettled([cancelling(), fulfilling()]);
        const label = `skew ${skew}`;
        is(label, [c.status, f.status].filter((s) => s === 'fulfilled').length, 1);
        const status = h.redemption().status;
        is(label, status, c.status === 'fulfilled' ? 'CANCELLED' : 'FULFILLED');
        is(label, h.balance(), status === 'CANCELLED' ? COST : 0);
        is(label, h.refunds().length, status === 'CANCELLED' ? 1 : 0);
        seen.add(status as string);
      }
      expect(seen).toEqual(new Set(['CANCELLED', 'FULFILLED']));
    });

    it('admin huỷ chen với cron quá hạn vẫn hoàn điểm đúng một lần', async () => {
      for (const skew of SWEEP) {
        const h = setup({ ...casOnly, claimExpiresAt: OVERDUE_AT });
        const cancelling = async () => (await delay(Math.max(skew, 0)), h.cancel('a1'));
        const expiring = async () => (await delay(Math.max(-skew, 0)), h.expire());
        await Promise.allSettled([cancelling(), expiring()]);
        const label = `skew ${skew}`;
        is(label, h.redemption().status, 'CANCELLED');
        is(label, h.balance(), COST);
        is(label, h.refunds().length, 1);
        is(label, h.stock(), 5);
      }
    });
  });
});
