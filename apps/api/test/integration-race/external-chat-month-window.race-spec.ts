import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { linkClaimsByPhone } from '../../src/modules/external-points/external-chat.claim';
import { releaseDueClaims } from '../../src/modules/external-points/external-claim-release';
import { ingestAndApply } from '../../src/modules/external-points/external-order.sync';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;

/** Trần tháng của claim chờ duyệt chỉ tính trong THÁNG TẠO claim đó, không lẫn claim các tháng sau, trên Postgres THẬT. */
describe('Trần tháng có cận trên theo tháng tạo claim (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const tierIds: string[] = [];
  const notify = jest.fn(async (..._args: unknown[]) => undefined);
  const MAP = { marketplaceIds: { '-3': 'shopee' }, chatSources: ['ITCHAT|itacc|'] };

  const freshConfig = () => new SystemConfigService(prisma);
  const deps = () => ({ config: freshConfig(), notifier: { notify } as never });
  const pin = async (key: string, value: Prisma.InputJsonValue) => restore.push(await pinConfig(prisma, key, value));

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });
  beforeEach(async () => {
    notify.mockClear();
    await pin('loyalty.chat_order_points_enabled', true);
    await pin('loyalty.point_expire_months', 12);
    await pin('loyalty.earn_pct', 2);
    await pin('loyalty.chat_order_earn_pct', null);
    await pin('loyalty.chat_order_monthly_points_cap', 200_000);
    await pin('loyalty.chat_order_review_above_vnd', 5_000_000);
    await pin('loyalty.chat_order_require_carrier', true);
    await pin('loyalty.chat_unclaimed_hold_days', 30);
    await pin('loyalty.external_pending_days', 14);
    await pin('loyalty.external_since', null);
  });
  afterEach(async () => {
    for (const r of restore.splice(0).reverse()) await r();
  });
  afterAll(async () => {
    const claimIds = (await prisma.externalPointsClaim.findMany({ where: { OR: [{ userId: { in: userIds } }, { externalOrderId: { in: orderIds } }] }, select: { id: true } })).map((c) => c.id);
    await prisma.externalClaimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { id: { in: claimIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma.membershipTier.deleteMany({ where: { id: { in: tierIds } } });
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function mkUser(over: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    const u = await createUser(prisma, { phone: phone(), phoneVerifiedAt: new Date(), zaloId: `zalo_${randCode(10)}`, ...over });
    userIds.push(u.id);
    return u;
  }
  async function mkTier(multiplier: number, over: Partial<Prisma.MembershipTierUncheckedCreateInput> = {}) {
    const t = await prisma.membershipTier.create({
      data: { id: `ITR1_${randCode(8)}`, name: `x${multiplier}`, sortOrder: 60, minPoints: 2_000_000_000, minSpending: 2_000_000_000, discountPct: 0, pointMultiplier: multiplier, perks: {}, ...over },
    });
    tierIds.push(t.id);
    return t;
  }

  function payload(o: { id?: string; phone?: string; goods?: number; status?: number; deliveredDaysAgo?: number; extendCode?: string | null; updatedAt?: Date; creator?: { id: string; name: string } } = {}) {
    const goods = o.goods ?? 500_000;
    const now = new Date();
    const delivered = o.deliveredDaysAgo !== undefined ? new Date(now.getTime() - o.deliveredDaysAgo * DAY) : null;
    return {
      id: o.id ?? `CHAT${randCode(10)}`,
      status: o.status ?? (delivered ? 3 : 1),
      order_sources: 'ITCHAT',
      account: 'itacc',
      bill_phone_number: o.phone ?? phone(),
      items: [{ quantity: 1, variation_info: { retail_price: goods } }],
      total_price: goods,
      inserted_at: new Date(now.getTime() - 20 * DAY).toISOString(),
      updated_at: (o.updatedAt ?? now).toISOString(),
      ...(o.extendCode === null ? {} : { partner: { extend_code: o.extendCode ?? `GHN${randCode(9)}` } }),
      ...(delivered ? { status_history: [{ status: 3, updated_at: delivered.toISOString() }] } : {}),
      ...(o.creator ? { creator: o.creator } : {}),
    };
  }
  async function ingest(p: Record<string, unknown>, tiers?: Awaited<ReturnType<typeof prisma.membershipTier.findMany>>) {
    const l = new LoyaltyService(prisma, freshConfig());
    await ingestAndApply(prisma, { ...deps(), recalcTier: (id) => l.recalcTier(id, tiers) }, p, MAP);
    const order = await prisma.externalOrder.findUnique({ where: { pancakeOrderId: String(p['id']) } });
    if (order && !orderIds.includes(order.id)) orderIds.push(order.id);
    return order;
  }
  const claimOf = (id: string) => prisma.externalPointsClaim.findFirst({ where: { externalOrder: { pancakeOrderId: id } } });
  const adminSvc = () =>
    new ExternalClaimsAdminService(prisma, freshConfig(), { notify } as never, new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never));

  it('duyệt claim REVIEW tạo từ tháng trước: claim đầy trần tháng NÀY không được tính vào trần tháng của nó', async () => {
    await pin('loyalty.chat_order_monthly_points_cap', 100_000);
    const user = await mkUser();
    const admin = await mkUser({ role: 'ADMIN' });
    const a = `CHAT${randCode(10)}`;
    await ingest(payload({ id: a, phone: user.phone!, goods: 5_500_000, deliveredDaysAgo: 20 }));
    const claimA = (await claimOf(a))!;
    expect(claimA.state).toBe('REVIEW');
    await prisma.externalPointsClaim.update({ where: { id: claimA.id }, data: { createdAt: new Date(Date.now() - 45 * DAY), points: 0 } });

    const b = `CHAT${randCode(10)}`;
    await ingest(payload({ id: b, phone: user.phone!, goods: 4_000_000, deliveredDaysAgo: 20 }));
    const claimB = (await claimOf(b))!;
    await prisma.externalPointsClaim.update({ where: { id: claimB.id }, data: { points: 100_000 } });

    await adminSvc().approve(claimA.id, admin.id, new Date(), 'đã xác nhận người nhận qua điện thoại');
    expect(await claimOf(a)).toMatchObject({ state: 'PENDING', points: 100_000 });
  });

  const PAST = () => new Date(Date.now() - 45 * DAY);
  const claimSvc = () => new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never);
  async function mkScanOrder(over: Record<string, unknown> = {}) {
    const code = `IT${randCode(10)}`;
    const now = new Date();
    const o = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `EXTMW${randCode(10)}`, source: 'MARKETPLACE', channel: 'shopee', sourceKey: 'x', trackingCode: code, trackingCodes: [code],
        goodsValue: 200_000, pancakeStatus: 2, status: 'OPEN', pancakeInsertedAt: new Date(now.getTime() - DAY), pancakeUpdatedAt: now, lastPayload: {}, ...over,
      },
    });
    orderIds.push(o.id);
    return { ...o, code };
  }
  const fillerScan = async (userId: string, points: number) =>
    prisma.externalPointsClaim.create({
      data: { externalOrderId: (await mkScanOrder()).id, userId, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points, claimedCode: `FILL${randCode(8)}`, dayKey: '2026-10-20' },
    });

  describe('các nơi khác tính cửa sổ tháng từ createdAt của claim', () => {
    it('SCAN duyệt: claim REVIEW từ tháng trước không bị trần đầy của tháng này chặn', async () => {
      await pin('loyalty.marketplace_claim_enabled', true);
      await pin('loyalty.marketplace_claim_monthly_points_cap', 20_000);
      const user = await mkUser();
      const admin = await mkUser({ role: 'ADMIN' });
      const o = await mkScanOrder({ goodsValue: null });
      const r = await claimSvc().submit(user.id, o.code);
      expect(r.status).toBe('REVIEW');
      await prisma.externalPointsClaim.update({ where: { id: r.claimId! }, data: { createdAt: PAST() } });
      await fillerScan(user.id, 20_000);
      await prisma.externalOrder.update({ where: { id: o.id }, data: { goodsValue: 3_000_000 } });
      await adminSvc().approve(r.claimId!, admin.id);
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'PENDING', points: 20_000 });
    });

    it('SCAN cộng điểm: tiền hàng tăng, claim tạo tháng trước được chốt theo trần tháng của nó, không theo tháng này', async () => {
      await pin('loyalty.marketplace_claim_enabled', true);
      await pin('loyalty.marketplace_claim_monthly_points_cap', 20_000);
      await pin('loyalty.marketplace_claim_review_above_vnd', 5_000_000);
      const user = await mkUser();
      const o = await mkScanOrder({ goodsValue: 200_000 });
      const r = await claimSvc().submit(user.id, o.code);
      expect(r.status).toBe('CLAIMED');
      await prisma.externalPointsClaim.update({ where: { id: r.claimId! }, data: { createdAt: PAST() } });
      await fillerScan(user.id, 20_000);
      await prisma.externalOrder.update({ where: { id: o.id }, data: { goodsValue: 1_000_000, status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) } });
      await releaseDueClaims(prisma, freshConfig(), { notify });
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'CREDITED', points: 10_000 });
    });

    it('chat liên kết: điểm chốt (chatMonthPoints) chỉ tính tháng tạo claim', async () => {
      await pin('loyalty.chat_order_monthly_points_cap', 100_000);
      const ph = phone();
      const tier = await mkTier(2);
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: ph, goods: 2_500_000, deliveredDaysAgo: 20 }));
      const claimA = (await claimOf(id))!;
      expect(claimA).toMatchObject({ userId: null, points: 50_000 });
      await prisma.externalPointsClaim.update({ where: { id: claimA.id }, data: { createdAt: PAST() } });
      const user = await mkUser({ phone: ph, tierId: tier.id });
      const other = await ingest(payload({ phone: phone(), goods: 500_000, deliveredDaysAgo: 20 }));
      await prisma.externalPointsClaim.deleteMany({ where: { externalOrderId: other!.id } });
      await prisma.externalPointsClaim.create({
        data: { externalOrderId: other!.id, userId: user.id, kind: 'PHONE', state: 'CREDITED', ratePct: 2, multiplier: 1, points: 100_000, orderPhone: ph, dayKey: '2026-10-20' },
      });
      await linkClaimsByPhone(prisma, deps(), user);
      expect(await claimOf(id)).toMatchObject({ userId: user.id, points: 100_000 });
    });

    it('chat liên kết: trần theo người tạo (creatorMonthPoints) chỉ tính tháng tạo claim', async () => {
      await pin('loyalty.chat_order_creator_monthly_points', 100_000);
      const creator = { id: `pc-${randCode(6)}`, name: 'Nhan Vien A' };
      const ph = phone();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: ph, goods: 2_500_000, deliveredDaysAgo: 20, creator }));
      const claimA = (await claimOf(id))!;
      expect(claimA.creatorRef).toBe(creator.id);
      await prisma.externalPointsClaim.update({ where: { id: claimA.id }, data: { createdAt: PAST() } });
      const other = await ingest(payload({ phone: phone(), goods: 500_000, deliveredDaysAgo: 20 }));
      await prisma.externalPointsClaim.deleteMany({ where: { externalOrderId: other!.id } });
      await prisma.externalPointsClaim.create({
        data: { externalOrderId: other!.id, userId: null, kind: 'PHONE', state: 'CREDITED', ratePct: 2, multiplier: 1, points: 100_000, orderPhone: phone(), creatorRef: creator.id, dayKey: '2026-10-20' },
      });
      const user = await mkUser({ phone: ph });
      await linkClaimsByPhone(prisma, deps(), user);
      expect(await claimOf(id)).toMatchObject({ userId: user.id, state: 'PENDING' });
    });
  });
});
