import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { GameOrderWaterService } from '../../src/modules/game/game-order-water.service';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { GameService } from '../../src/modules/game/game.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Nước thưởng đơn giao (B-81) trên Postgres THẬT: mỗi đơn đúng một lần dù gọi lại / cron chạy lại / chạy song song, trần tuần giờ
 * VN không bị vượt khi nhiều đơn của một khách giao cùng lúc, và qua mốc 00:00 thứ Hai VN thì được tính lại.
 */
describe('GameOrderWaterService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let water: GameOrderWaterService;
  let orderStatus: OrderStatusService;
  let game: GameService;
  let economy: GameEconomyService;
  let auth: AuthService;
  let zaloIdForNextCall = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        GameOrderWaterService,
        AnalyticsEventsService,
        GameService,
        GameEconomyService,
        SeasonPassService,
        { provide: RewardPointsService, useValue: { grantPoints: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: AffiliateService,
          useValue: { lockCommissionsForOrder: jest.fn().mockResolvedValue(0), grantReferralReward: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'game.order_seeds', 100);
    await setConfig(prisma, 'game.order_seeds_weekly_cap', 300);
    await setConfig(prisma, 'game.tank_capacity', 1000);
    water = moduleRef.get(GameOrderWaterService);
    orderStatus = moduleRef.get(OrderStatusService);
    game = moduleRef.get(GameService);
    economy = moduleRef.get(GameEconomyService);
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = { getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }), resolvePhoneNumber: async () => null } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const realUser = () => createUser(prisma, { zaloId: `z_${randCode(10)}` });
  // Người đã mở game (có hồ sơ): grantForOrder không bao giờ tạo hồ sơ hộ.
  const player = async () => {
    const u = await realUser();
    await prisma.gameProfile.create({ data: { userId: u.id, totalSeeds: 0 } });
    return u;
  };
  const delivered = (userId: string) => createOrder(prisma, { userId, status: 'DELIVERED', deliveredAt: new Date(), deliveredEffectsAt: null });
  const seedsOf = async (userId: string) => (await prisma.gameProfile.findUnique({ where: { userId } }))?.totalSeeds ?? null;
  const eventsOf = (userId: string) => prisma.gameWaterEvent.findMany({ where: { userId } });

  it('khách chưa từng mở game: KHÔNG tạo hồ sơ, đơn ghi chờ; mở game lần đầu mới cộng và báo claimedNow', async () => {
    const u = await realUser();
    const o = await delivered(u.id);
    await expect(water.grantForOrder(o.id)).resolves.toEqual({ granted: 0, pending: true });
    expect(await seedsOf(u.id)).toBeNull();
    expect(await prisma.gameWaterEvent.findMany({ where: { userId: u.id, pending: true } })).toHaveLength(1);
    const first = (await game.getProfile(u.id)) as unknown as { totalSeeds: number; orderWater: { claimedNow: number } };
    expect(first.orderWater.claimedNow).toBe(100);
    expect(await seedsOf(u.id)).toBe(100);
    const second = (await game.getProfile(u.id)) as unknown as { orderWater: { claimedNow: number } };
    expect(second.orderWater.claimedNow).toBe(0);
    expect(await seedsOf(u.id)).toBe(100);
  });

  it('nhiều đơn chờ + mở game song song: trần tuần 300 không vượt, đơn tuần trước không được cộng', async () => {
    const u = await realUser();
    const now = new Date();
    const last = new Date(now.getTime() - 8 * 86_400_000);
    const old = await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: last, deliveredEffectsAt: null });
    await water.grantForOrder(old.id, last);
    const orders = await Promise.all(Array.from({ length: 5 }, () => delivered(u.id)));
    for (const o of orders) await water.grantForOrder(o.id);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => game.getProfile(u.id)));
    expect(summarize(results).errors).toEqual([]);
    expect(await seedsOf(u.id)).toBe(300);
    const events = await eventsOf(u.id);
    expect(events.filter((e) => e.pending)).toHaveLength(0);
    expect(events.find((e) => e.refId === old.id)?.delta).toBe(0);
  });

  it('nước đơn vượt bể: checkIn và tưới nước sau đó không cắt phần vượt', async () => {
    const u = await player();
    await prisma.gameProfile.update({ where: { userId: u.id }, data: { totalSeeds: 950 } });
    const o = await delivered(u.id);
    await expect(water.grantForOrder(o.id)).resolves.toEqual({ granted: 100 });
    expect(await seedsOf(u.id)).toBe(1050);
    await economy.checkIn(u.id);
    await economy.collectDew(u.id).catch(() => undefined);
    expect((await seedsOf(u.id))!).toBeGreaterThanOrEqual(1050);
  });

  it('gộp tài khoản: guest đã chơi chuyển sang người mua chưa chơi (có nước đơn), cộng dồn nước', async () => {
    const target = await realUser();
    const o = await delivered(target.id);
    await water.grantForOrder(o.id);
    await game.getProfile(target.id).catch(() => undefined);
    // hồ sơ target chỉ có nước đơn, chưa chơi: ép về trạng thái "chưa chơi" như khi vừa nhận từ đơn
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khach' });
    await prisma.refreshToken.create({ data: { userId: guest.id, tokenHash: `it-${randCode(16)}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.gameProfile.create({
      data: { userId: guest.id, totalSeeds: 420, streakDays: 6, longestStreak: 6, lastCheckInAt: new Date(), ecoImpact: { progress: 10, target: 300, treeType: 't', treesPlanted: 2, sproutRewarded: true } },
    });
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    const t = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: target.id } });
    expect(t.streakDays).toBe(6);
    expect(t.totalSeeds).toBe(420 + 100);
    expect((t.ecoImpact as { treesPlanted: number }).treesPlanted).toBe(2);
    expect(await prisma.gameProfile.findUnique({ where: { userId: guest.id } })).toBeNull();
  });

  it('gộp tài khoản: người mua chỉ có đơn chờ (chưa có hồ sơ) nhận vườn guest, mở game sau đó mới cộng nước đơn', async () => {
    const target = await realUser();
    const o = await delivered(target.id);
    await expect(water.grantForOrder(o.id)).resolves.toEqual({ granted: 0, pending: true });
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, fullName: 'Khach' });
    await prisma.refreshToken.create({ data: { userId: guest.id, tokenHash: `it-${randCode(16)}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.gameProfile.create({
      data: { userId: guest.id, totalSeeds: 420, streakDays: 6, longestStreak: 6, lastCheckInAt: new Date(), ecoImpact: { progress: 10, target: 300, treeType: 't', treesPlanted: 2, sproutRewarded: true } },
    });
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guest.id, 'code', 'access');
    expect(await seedsOf(target.id)).toBe(420);
    const first = (await game.getProfile(target.id)) as unknown as { orderWater: { claimedNow: number } };
    expect(first.orderWater.claimedNow).toBe(100);
    expect(await seedsOf(target.id)).toBe(520);
  });

  it('gọi lại và 10 lần song song cho cùng một đơn: chỉ cộng đúng 100 một lần, một dòng sổ', async () => {
    const u = await player();
    const o = await delivered(u.id);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => water.grantForOrder(o.id)));
    const { errors } = summarize(results);
    expect(errors).toEqual([]);
    await water.grantForOrder(o.id);
    expect(await seedsOf(u.id)).toBe(100);
    const events = await eventsOf(u.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ delta: 100, reason: 'ORDER_DELIVERED', refId: o.id });
  });

  it('việc sau giao chạy song song (cron + request): vẫn đúng 100 giọt, mốc xong việc được ghi', async () => {
    const u = await player();
    const o = await delivered(u.id);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => orderStatus.resyncDeliveredEffects(o.id)));
    expect(summarize(results).errors).toEqual([]);
    expect(await seedsOf(u.id)).toBe(100);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).deliveredEffectsAt).not.toBeNull();
  });

  it('6 đơn của một khách giao cùng lúc: tổng đúng 300 giọt (trần tuần), không vượt', async () => {
    const u = await player();
    const orders = await Promise.all(Array.from({ length: 6 }, () => delivered(u.id)));
    const results = await Promise.allSettled(orders.map((o) => water.grantForOrder(o.id)));
    expect(summarize(results).errors).toEqual([]);
    expect(await seedsOf(u.id)).toBe(300);
    const events = await eventsOf(u.id);
    expect(events).toHaveLength(6);
    expect(events.reduce((s, e) => s + e.delta, 0)).toBe(300);
    expect(events.every((e) => e.delta >= 0 && e.delta <= 100)).toBe(true);
  });

  it('còn 40 giọt trong trần: cộng phần còn lại 40', async () => {
    const u = await player();
    const [a, b, c, d] = await Promise.all([delivered(u.id), delivered(u.id), delivered(u.id), delivered(u.id)]);
    await water.grantForOrder(a!.id);
    await water.grantForOrder(b!.id);
    await prisma.gameWaterEvent.updateMany({ where: { userId: u.id, refId: b!.id }, data: { delta: 160 } });
    await expect(water.grantForOrder(c!.id)).resolves.toEqual({ granted: 40 });
    await expect(water.grantForOrder(d!.id)).resolves.toEqual({ granted: 0 });
  });

  it('qua mốc tuần VN: Chủ nhật 23:59 hết trần, thứ Hai 00:00 được cộng lại; đơn đã xét không cộng bù', async () => {
    const u = await player();
    const sunday = new Date('2026-10-25T16:59:59Z'); // Chủ nhật 23:59:59 giờ VN
    const monday = new Date('2026-10-25T17:00:00Z'); // thứ Hai 00:00:00 giờ VN
    const orders = await Promise.all(Array.from({ length: 5 }, () => delivered(u.id)));
    for (const o of orders.slice(0, 3)) await expect(water.grantForOrder(o.id, sunday)).resolves.toEqual({ granted: 100 });
    await expect(water.grantForOrder(orders[3]!.id, sunday)).resolves.toEqual({ granted: 0 });
    await expect(water.grantForOrder(orders[4]!.id, monday)).resolves.toEqual({ granted: 100 });
    await expect(water.grantForOrder(orders[3]!.id, monday)).resolves.toMatchObject({ granted: 0, skipped: 'ALREADY_GRANTED' });
    expect(await seedsOf(u.id)).toBe(400);
    await expect(water.summary(u.id, 0, monday)).resolves.toEqual({ perOrder: 100, weeklyCap: 300, weeklyGranted: 100, claimedNow: 0 });
    await expect(water.summary(u.id, 0, sunday)).resolves.toEqual({ perOrder: 100, weeklyCap: 300, weeklyGranted: 300, claimedNow: 0 });
  });

  it('khách vãng lai (guest_) và đơn CTV lên hộ không nhận', async () => {
    const guest = await createUser(prisma, { zaloId: `guest_${randCode(8)}` });
    const go = await delivered(guest.id);
    await expect(water.grantForOrder(go.id)).resolves.toMatchObject({ skipped: 'NOT_ELIGIBLE' });
    const ctv = await realUser();
    const co = await createOrder(prisma, { userId: ctv.id, status: 'DELIVERED', deliveredAt: new Date(), deliveredEffectsAt: null, placedForCustomer: true });
    await expect(water.grantForOrder(co.id)).resolves.toMatchObject({ skipped: 'NOT_ELIGIBLE' });
    expect(await seedsOf(guest.id)).toBeNull();
    expect(await seedsOf(ctv.id)).toBeNull();
  });
});
