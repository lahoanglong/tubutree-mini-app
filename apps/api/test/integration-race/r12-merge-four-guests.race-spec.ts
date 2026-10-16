import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const REWARD = 100;
const UNIT = 50_000;
const DAY = 864e5;

/**
 * Bốn thiết bị khách cùng đăng nhập vào MỘT tài khoản Zalo cùng lúc (UAT vòng 6 'Chưa kiểm'): bốn lần gộp xếp hàng sau khoá
 * `auth.merge_guest`, không 40P01, không mất dòng đơn/điểm, quan hệ giới thiệu giữa các khách và với người ngoài chuyển đúng,
 * tổng sổ điểm của mọi tài khoản = pointsBalance.
 */
describe('Gộp đồng thời 4 khách vào một tài khoản (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rewards: RewardPointsService;
  let auth: AuthService;
  let zaloIdForNextCall = '';
  const CONFIG_KEYS = ['referral.referrer_reward_points', 'referral.window_days', 'referral.min_order_amount', 'referral.milestones_points'];
  let savedConfig: { key: string; value: unknown }[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, RewardPointsService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    rewards = moduleRef.get(RewardPointsService);
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', 100_000);
    await setConfig(prisma, 'referral.milestones_points', []);

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-r12', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30, JWT_REFRESH_REUSE_GRACE_SECONDS: 60 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  async function deliveredOrder(userId: string, daysAgo: number) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it4g-p-${tag}`, brand: 'IT', slug: `it4g-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it4g-v-${tag}`, productId: product.id, sku: `IT4G-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
    const total = 3 * UNIT;
    return createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: total,
      total,
      createdAt: new Date(Date.now() - daysAgo * DAY),
      deliveredAt: new Date(),
      items: { create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: 3, total, paidTotal: total }] },
    });
  }

  const merge = (guestId: string) => auth.ensurePhoneForCurrentUser(guestId, 'code', 'access');

  async function ledgerMatches(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    return u.pointsBalance;
  }

  /**
   * T có 30 điểm riêng. G1..G4 mỗi khách một đơn đã giao và 10·i điểm; G2 được G1 mời, G4 được G3 mời (quan hệ giữa các khách
   * cùng gộp); C (người ngoài) được G3 mời và đã đủ điều kiện nên G3 nhận 100 điểm thưởng giới thiệu.
   */
  async function seed() {
    const t = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}` });
    await rewards.grant(t.id, 30, `IT4G_T:${t.id}`, 'IT');
    const g1 = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}` });
    const g2 = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, referredById: g1.id });
    const g3 = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}` });
    const g4 = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}`, referredById: g3.id });
    const guests = [g1, g2, g3, g4];
    const orders = [];
    for (const [i, g] of guests.entries()) {
      orders.push(await deliveredOrder(g.id, 2));
      await rewards.grant(g.id, 10 * (i + 1), `IT4G_G:${g.id}`, 'IT');
    }
    const c = await createUser(prisma, { referredById: g3.id });
    await deliveredOrder(c.id, 9);
    await deliveredOrder(c.id, 4);
    expect(await rewards.grantReferralOrderReward(c.id)).toBe(true);
    zaloIdForNextCall = t.zaloId!;
    return { t, guests, orders, c };
  }

  async function snapshot(ids: string[]) {
    const [rows, sum, orders] = await Promise.all([
      prisma.pointsTransaction.count({ where: { userId: { in: ids } } }),
      prisma.pointsTransaction.aggregate({ where: { userId: { in: ids }, lot: 'STANDARD' }, _sum: { delta: true } }),
      prisma.order.count({ where: { userId: { in: ids } } }),
    ]);
    return { rows, sum: sum._sum.delta ?? 0, orders };
  }

  async function expectMerged(ctx: Awaited<ReturnType<typeof seed>>, before: Awaited<ReturnType<typeof snapshot>>) {
    const { t, guests, orders, c } = ctx;
    const ids = [t.id, ...guests.map((g) => g.id)];
    for (const g of guests) {
      const row = await prisma.user.findUniqueOrThrow({ where: { id: g.id }, select: { mergedIntoId: true } });
      expect(row.mergedIntoId).toBe(t.id);
      expect(await ledgerMatches(g.id)).toBe(0);
      expect(await prisma.pointsTransaction.count({ where: { userId: g.id } })).toBe(0);
    }
    // 30 + 10 + 20 + 30 + 40 + 100 (thưởng mời C của G3)
    expect(await ledgerMatches(t.id)).toBe(230);
    const moved = await prisma.order.findMany({ where: { id: { in: orders.map((o) => o.id) } }, select: { userId: true } });
    expect(moved.map((o) => o.userId)).toEqual([t.id, t.id, t.id, t.id]);
    expect(await prisma.order.count({ where: { userId: t.id } })).toBe(4);
    const grant = await prisma.pointsTransaction.findFirstOrThrow({ where: { reason: `REFERRAL_ORDER2:${c.id}` } });
    expect(grant.userId).toBe(t.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).referredById).toBe(t.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.id } })).referredById).toBeNull();
    // Không mất dòng sổ nào, không sinh dòng thu hồi: tổng và số dòng của cả nhóm giữ nguyên.
    expect(await snapshot(ids)).toEqual(before);
  }

  it('4 lần gộp cùng lúc (3 vòng): không lỗi, không 40P01, đơn/điểm/giới thiệu về T đúng một lần', async () => {
    for (let round = 0; round < 3; round++) {
      const ctx = await seed();
      const before = await snapshot([ctx.t.id, ...ctx.guests.map((g) => g.id)]);
      expect(before).toEqual({ rows: 6, sum: 230, orders: 4 });
      const res = summarize(await Promise.allSettled(ctx.guests.map((g) => merge(g.id))));
      expect(res.errors).toEqual([]);
      for (const r of res.fulfilled) expect((r.value as { user: { id: string } }).user.id).toBe(ctx.t.id);
      await expectMerged(ctx, before);
    }
  });

  it('gộp lại lần hai bằng token khách cũ (4 thiết bị bấm lại cùng lúc) không nhân đôi điểm hay đơn', async () => {
    const ctx = await seed();
    const before = await snapshot([ctx.t.id, ...ctx.guests.map((g) => g.id)]);
    expect(summarize(await Promise.allSettled(ctx.guests.map((g) => merge(g.id)))).errors).toEqual([]);
    const again = summarize(await Promise.allSettled(ctx.guests.map((g) => merge(g.id))));
    expect(again.errors).toEqual([]);
    await expectMerged(ctx, before);
  });
});
