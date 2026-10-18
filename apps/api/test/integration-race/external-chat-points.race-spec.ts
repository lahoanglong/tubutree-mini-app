import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { ExternalChatService } from '../../src/modules/external-points/external-chat.service';
import { backfillChatClaims, ensureChatClaim, lapseExpiredChatClaims, linkClaimsByPhone, linkWaitingClaims } from '../../src/modules/external-points/external-chat.claim';
import { applyStatusToClaim } from '../../src/modules/external-points/external-claim-status';
import { releaseClaim, releaseDueClaims } from '../../src/modules/external-points/external-claim-release';
import { ingestAndApply } from '../../src/modules/external-points/external-order.sync';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';
import { chatMonthPoints } from '../../src/modules/external-points/external-chat.claim';
import { startOfVnMonth } from '../../src/common/vn-time';

const DAY = 864e5;

/**
 * Điểm đơn chat/điện thoại (B9, chatpts) trên Postgres THẬT: nạp đơn CHAT tự lên claim PHONE, liên kết theo SĐT chạy song song với nạp đơn
 * và với nhau, trần tháng theo SĐT dưới song song, giữ điểm HELD_NO_MEMBER rồi LAPSED, cron cộng song song với webhook hoàn, hạng lên khi
 * cộng và xuống khi đảo, lô EXTERNAL:<refId> không trừ hai lần.
 */
describe('Điểm đơn chat/điện thoại: tạo, liên kết, giữ, cộng, đảo (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const tierIds: string[] = [];
  const notify = jest.fn(async (..._args: unknown[]) => undefined);
  const MAP = { marketplaceIds: { '-3': 'shopee' }, chatSources: ['ITCHAT|itacc|'] };

  const freshConfig = () => new SystemConfigService(prisma);
  const deps = () => ({ config: freshConfig(), notifier: { notify } as never });
  const loyalty = () => new LoyaltyService(prisma, freshConfig());

  async function pin(key: string, value: Prisma.InputJsonValue) {
    restore.push(await pinConfig(prisma, key, value));
  }

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

  /** Payload Pancake của một đơn chat: có vận đơn (extend_code), tiền hàng `goods`, SĐT khách, và (tuỳ chọn) đã giao `deliveredDaysAgo` ngày. */
  function payload(over: { id?: string; phone?: string | null; goods?: number; status?: number; deliveredDaysAgo?: number; extendCode?: string | null; creator?: { id: string; name: string } } = {}) {
    const goods = over.goods ?? 500_000;
    const now = new Date();
    const delivered = over.deliveredDaysAgo !== undefined ? new Date(now.getTime() - over.deliveredDaysAgo * DAY) : null;
    return {
      id: over.id ?? `CHAT${randCode(10)}`,
      status: over.status ?? (delivered ? 3 : 1),
      order_sources: 'ITCHAT',
      account: 'itacc',
      ...(over.phone === null ? {} : { bill_phone_number: over.phone ?? phone() }),
      items: [{ quantity: 1, variation_info: { retail_price: goods } }],
      total_price: goods,
      inserted_at: new Date(now.getTime() - 20 * DAY).toISOString(),
      updated_at: now.toISOString(),
      ...(over.extendCode === null ? {} : { partner: { extend_code: over.extendCode ?? `GHN${randCode(9)}` } }),
      ...(delivered ? { status_history: [{ status: 3, updated_at: delivered.toISOString() }] } : {}),
      ...(over.creator ? { creator: over.creator } : {}),
    };
  }

  async function ingest(p: Record<string, unknown>, tierSet?: Awaited<ReturnType<typeof prisma.membershipTier.findMany>>) {
    const l = loyalty();
    const out = await ingestAndApply(prisma, { ...deps(), recalcTier: (id) => l.recalcTier(id, tierSet) }, p, MAP);
    const order = await prisma.externalOrder.findUnique({ where: { pancakeOrderId: String(p['id']) } });
    if (order && !orderIds.includes(order.id)) orderIds.push(order.id);
    return { out, order };
  }
  const claimOf = async (pancakeOrderId: string) =>
    prisma.externalPointsClaim.findFirst({ where: { externalOrder: { pancakeOrderId } } });
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).pointsBalance;
  const ledger = (userId: string, prefix: string) => prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: prefix } } });
  const eventsOf = (claimId: string) => prisma.externalClaimEvent.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } });
  async function noDrift() {
    expect(await findPointsLotDrift(prisma, userIds)).toEqual([]);
  }
  const chatCfg = async () => (await import('../../src/modules/external-points/external-chat.config')).loadChatConfig(freshConfig());
  const releaseOpts = async () => ({ pendingDays: 14, expiryMonths: 12, chat: await chatCfg() });

  describe('nạp đơn: tạo claim PHONE', () => {
    it('đã có thành viên (đăng nhập Zalo, SĐT xác minh): claim PENDING gắn userId, hệ số hạng hiện tại, tính vào xét hạng', async () => {
      const tag = randCode(6);
      const tier = await prisma.membershipTier.create({ data: { id: `ITCH_${tag}_g`, name: 'Vàng', sortOrder: 50, minPoints: 1_000_000_000, minSpending: 5_000_000, discountPct: 0, pointMultiplier: 1.5, perks: {} } });
      tierIds.push(tier.id);
      const user = await mkUser({ tierId: tier.id });
      const p = payload({ phone: user.phone!, goods: 500_000 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(c).toMatchObject({ kind: 'PHONE', state: 'PENDING', userId: user.id, countsForTier: true, claimedCode: null });
      expect(Number(c.multiplier)).toBe(1.5);
      expect(Number(c.ratePct)).toBe(2);
      expect(c.points).toBe(15_000);
      expect((await eventsOf(c.id)).map((e) => e.action)).toEqual(['CLAIM_CREATED']);
    });

    it('chưa là thành viên: claim userId null, hệ số 1', async () => {
      const p = payload({ goods: 500_000 });
      await ingest(p);
      expect(await claimOf(String(p.id))).toMatchObject({ kind: 'PHONE', state: 'PENDING', userId: null, points: 10_000, countsForTier: true });
    });

    it('loyalty.chat_order_earn_pct đặt thì thắng loyalty.earn_pct', async () => {
      await pin('loyalty.chat_order_earn_pct', 3);
      const p = payload({ goods: 500_000 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(c.points).toBe(15_000);
      expect(Number(c.ratePct)).toBe(3);
    });

    it('CỜ TẮT: không đường nào tạo hay cộng claim PHONE (ingest, liên kết, backfill, cron cộng)', async () => {
      await pin('loyalty.chat_order_points_enabled', false);
      const user = await mkUser();
      const p = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p);
      expect(await claimOf(String(p.id))).toBeNull();
      expect(await backfillChatClaims(prisma, deps())).toBe(0);
      expect(await claimOf(String(p.id))).toBeNull();

      // Claim dựng sẵn lúc cờ còn bật rồi tắt: không liên kết, không giữ, không cộng.
      await pin('loyalty.chat_order_points_enabled', true);
      const p2 = payload({ goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p2);
      const unlinked = (await claimOf(String(p2.id)))!;
      const p3 = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p3);
      const linkedClaim = (await claimOf(String(p3.id)))!;
      expect(linkedClaim.userId).toBe(user.id);
      await pin('loyalty.chat_order_points_enabled', false);
      const off = new SystemConfigService(prisma);
      const r = await releaseDueClaims(prisma, off, undefined);
      expect(r).toMatchObject({ credited: 0, toReview: 0, held: 0 });
      expect((await releaseClaim(prisma, linkedClaim.id, { pendingDays: 14, expiryMonths: 12 })).outcome).toBe('SKIPPED');
      const u2 = await mkUser({ phone: (await prisma.externalOrder.findFirstOrThrow({ where: { id: unlinked.externalOrderId } })).phone });
      expect((await linkClaimsByPhone(prisma, { config: off }, u2)).linked).toBe(0);
      expect(await lapseExpiredChatClaims(prisma, off)).toBe(0);
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: linkedClaim.id } })).toMatchObject({ state: 'PENDING' });
      expect(await balanceOf(user.id)).toBe(0);
    });

    it('không có SĐT hoặc không có vận đơn: không tạo; có vận đơn ở webhook sau thì tạo', async () => {
      const noPhone = payload({ phone: null });
      await ingest(noPhone);
      expect(await claimOf(String(noPhone.id))).toBeNull();

      const ph = phone();
      const noCarrier = payload({ phone: ph, extendCode: null });
      await ingest(noCarrier);
      expect(await claimOf(String(noCarrier.id))).toBeNull();
      await ingest({ ...noCarrier, partner: { extend_code: `GHN${randCode(9)}` }, updated_at: new Date(Date.now() + 1000).toISOString() });
      expect(await claimOf(String(noCarrier.id))).toMatchObject({ kind: 'PHONE', state: 'PENDING' });
    });

    it('tắt loyalty.chat_order_require_carrier thì đơn không vận đơn cũng được tạo', async () => {
      await pin('loyalty.chat_order_require_carrier', false);
      const p = payload({ extendCode: null });
      await ingest(p);
      expect(await claimOf(String(p.id))).toMatchObject({ kind: 'PHONE' });
    });

    it('status 16 (đã thu tiền) đủ điều kiện dù không có extend_code', async () => {
      const p = payload({ extendCode: null, status: 16, deliveredDaysAgo: 1 });
      await ingest(p);
      expect(await claimOf(String(p.id))).toMatchObject({ kind: 'PHONE' });
    });

    it('đơn đã huỷ: không tạo; webhook huỷ sau khi có claim thì claim VOIDED, không ghi sổ', async () => {
      const p = payload();
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      await ingest({ ...p, status: 6, updated_at: new Date(Date.now() + 1000).toISOString() });
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ state: 'VOIDED' });
      const p2 = payload({ status: 6 });
      await ingest(p2);
      expect(await claimOf(String(p2.id))).toBeNull();
    });

    it('ingest lặp (hai webhook song song cùng đơn): đúng một claim', async () => {
      const p = payload();
      await Promise.all(Array.from({ length: 6 }, () => ingest({ ...p })));
      expect(await prisma.externalPointsClaim.count({ where: { externalOrder: { pancakeOrderId: String(p.id) } } })).toBe(1);
    });
  });

  describe('chống nhân viên tạo đơn giả', () => {
    it('đơn lớn hơn 5.000.000: REVIEW', async () => {
      const p = payload({ goods: 5_000_100 });
      await ingest(p);
      expect(await claimOf(String(p.id))).toMatchObject({ state: 'REVIEW' });
    });

    it('thành viên là STAFF hoặc ADMIN: REVIEW kể cả khi đã có claim chờ rồi liên kết', async () => {
      const staff = await mkUser({ role: 'STAFF' });
      const p = payload({ phone: staff.phone!, goods: 300_000 });
      await ingest(p);
      expect(await claimOf(String(p.id))).toMatchObject({ state: 'REVIEW', userId: staff.id });

      // Chưa là thành viên lúc nạp, nhân viên đăng nhập sau: liên kết đưa vào REVIEW.
      const ph = phone();
      const p2 = payload({ phone: ph, goods: 300_000 });
      await ingest(p2);
      expect(await claimOf(String(p2.id))).toMatchObject({ state: 'PENDING', userId: null });
      const admin = await mkUser({ phone: ph, role: 'ADMIN' });
      await linkClaimsByPhone(prisma, deps(), admin);
      expect(await claimOf(String(p2.id))).toMatchObject({ state: 'REVIEW', userId: admin.id });
    });

    it('SĐT đơn trùng grant nhân viên còn hiệu lực (nhân viên chưa là thành viên): REVIEW', async () => {
      const ph = phone();
      const grant = await prisma.roleGrant.create({ data: { phone: ph, role: 'STAFF', grantedBy: 'it' } });
      try {
        const p = payload({ phone: ph });
        await ingest(p);
        expect(await claimOf(String(p.id))).toMatchObject({ state: 'REVIEW', userId: null });
      } finally {
        await prisma.roleGrant.delete({ where: { id: grant.id } });
      }
    });

    it('người tạo đơn trên Pancake không tự duyệt; người khác duyệt được', async () => {
      const creator = await mkUser({ role: 'STAFF', fullName: 'Nguyễn Thị Lan' });
      const other = await mkUser({ role: 'STAFF', fullName: 'Trần Văn Bình' });
      const p = payload({ goods: 5_500_000, creator: { id: 'pc-1', name: 'Nguyen Thi Lan' } });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(c.state).toBe('REVIEW');
      const admin = new ExternalClaimsAdminService(prisma, freshConfig(), { notify } as never, new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never));
      await expect(admin.approve(c.id, creator.id)).rejects.toMatchObject({ response: { code: 'PANCAKE_CREATOR_SELF' } });
      await expect(admin.approve(c.id, other.id)).resolves.toMatchObject({ state: 'PENDING' });
      const after = (await claimOf(String(p.id)))!;
      expect(after).toMatchObject({ state: 'PENDING', decidedById: other.id });
      expect(after.points).toBe(110_000);
    });
  });

  describe('trần tháng theo SĐT', () => {
    it('6 đơn cùng SĐT nạp song song với trần 15.000: đúng một claim PENDING, còn lại REVIEW (không vượt trần dù song song)', async () => {
      await pin('loyalty.chat_order_monthly_points_cap', 15_000);
      const ph = phone();
      const ps = Array.from({ length: 6 }, () => payload({ phone: ph, goods: 500_000 }));
      await Promise.all(ps.map((p) => ingest(p)));
      const claims = await Promise.all(ps.map((p) => claimOf(String(p.id))));
      expect(claims.filter((c) => c?.state === 'PENDING')).toHaveLength(1);
      expect(claims.filter((c) => c?.state === 'REVIEW')).toHaveLength(5);
    });

    it('cộng vượt trần tháng khi tiền hàng tăng: điểm chốt theo phần trần còn lại (không dưới điểm đã kiểm)', async () => {
      await pin('loyalty.chat_order_monthly_points_cap', 20_000);
      const user = await mkUser();
      const p1 = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p1);
      const c1 = (await claimOf(String(p1.id)))!;
      const p2 = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p2);
      const c2 = (await claimOf(String(p2.id)))!;
      expect([c1.state, c2.state]).toEqual(['PENDING', 'PENDING']);
      // Hai claim 10.000 + 10.000 = đúng trần 20.000. Đơn 2 tăng tiền hàng lên 700.000 (14.000 điểm): chốt = max(10.000, 20.000 - 10.000) = 10.000.
      await prisma.externalOrder.update({ where: { id: c2.externalOrderId }, data: { goodsValue: 700_000 } });
      const [r1, r2] = [await releaseClaim(prisma, c1.id, await releaseOpts()), await releaseClaim(prisma, c2.id, await releaseOpts())];
      expect([r1.outcome, r2.outcome]).toEqual(['CREDITED', 'CREDITED']);
      expect(r2.points).toBe(10_000);
      expect(await balanceOf(user.id)).toBe(20_000);
      await noDrift();
    });

    it('chatMonthPoints không đếm đôi claim đã liên kết và claim chưa liên kết của cùng SĐT', async () => {
      const ph = phone();
      const pa = payload({ phone: ph, goods: 500_000 });
      await ingest(pa);
      const user = await mkUser({ phone: ph });
      await linkClaimsByPhone(prisma, deps(), user);
      const pb = payload({ phone: ph, goods: 500_000 });
      await ingest(pb);
      expect(await chatMonthPoints(prisma, { phone: ph, userId: user.id, since: startOfVnMonth(new Date()) })).toBe(20_000);
    });
  });

  describe('liên kết theo SĐT (song song)', () => {
    it('ingest CHAT chạy song song với linkByPhone: luôn đúng một claim và claim thuộc thành viên (10 vòng)', async () => {
      for (let i = 0; i < 10; i++) {
        const user = await mkUser();
        const p = payload({ phone: user.phone!, goods: 500_000 });
        await Promise.all([ingest(p), linkClaimsByPhone(prisma, deps(), user), linkClaimsByPhone(prisma, deps(), user)]);
        await linkClaimsByPhone(prisma, deps(), user);
        const rows = await prisma.externalPointsClaim.findMany({ where: { externalOrder: { pancakeOrderId: String(p.id) } } });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ userId: user.id, state: 'PENDING', kind: 'PHONE' });
      }
    });

    it('hai lần liên kết đồng thời (hai phiên đăng nhập) + cron quét: mỗi claim gắn đúng một lần, thông báo đúng một lần', async () => {
      const ph = phone();
      const ps = [payload({ phone: ph, goods: 500_000 }), payload({ phone: ph, goods: 300_000 })];
      for (const p of ps) await ingest(p);
      const user = await mkUser({ phone: ph });
      notify.mockClear();
      const results = await Promise.all([
        linkClaimsByPhone(prisma, deps(), user),
        linkClaimsByPhone(prisma, deps(), user),
        new ExternalChatService(prisma, freshConfig(), { notify } as never).sweep(),
        linkWaitingClaims(prisma, deps()),
      ]);
      expect(results).toHaveLength(4);
      const claims = await Promise.all(ps.map((p) => claimOf(String(p.id))));
      expect(claims.map((c) => c?.userId)).toEqual([user.id, user.id]);
      for (const c of claims) expect((await eventsOf(c!.id)).filter((e) => e.action === 'LINK_PHONE')).toHaveLength(1);
      const linked = notify.mock.calls.filter((c) => c[0] === user.id && c[1] === 'CHAT_ORDER_POINTS_LINKED');
      expect(linked).toHaveLength(1);
      expect(linked[0]![2]).toMatchObject({ points: '16.000', count: '2' });
    });

    it('SĐT chưa xác minh bị bỏ qua: khách vãng lai, tài khoản khoá, tài khoản đã gộp không nhận điểm của số đó', async () => {
      const ph = phone();
      const p = payload({ phone: ph });
      await ingest(p);
      const guest = await mkUser({ phone: ph, zaloId: `guest_${randCode(8)}` });
      expect((await linkClaimsByPhone(prisma, deps(), guest)).linked).toBe(0);
      await prisma.user.update({ where: { id: guest.id }, data: { zaloId: `zalo_${randCode(8)}`, isBlocked: true } });
      expect((await linkClaimsByPhone(prisma, deps(), { ...guest, zaloId: 'z', isBlocked: true })).linked).toBe(0);
      expect(await claimOf(String(p.id))).toMatchObject({ userId: null });
      // Cron cũng không gắn cho tài khoản khoá.
      expect(await linkWaitingClaims(prisma, deps())).toBe(0);
      expect(await claimOf(String(p.id))).toMatchObject({ userId: null });
    });

    it('thành viên đã gộp: claim đi theo tài khoản gốc (mergedIntoId), không khoá', async () => {
      const ph = phone();
      const root = await mkUser();
      const merged = await mkUser({ phone: ph, mergedIntoId: root.id });
      void merged;
      const p = payload({ phone: ph, goods: 500_000 });
      await ingest(p);
      expect(await claimOf(String(p.id))).toMatchObject({ userId: root.id, state: 'PENDING' });
    });
  });

  describe('giữ điểm HELD_NO_MEMBER và LAPSED', () => {
    it('tới hạn mà chưa có thành viên: HELD_NO_MEMBER, holdUntil = mốc cộng + 30 ngày, không ghi sổ', async () => {
      const p = payload({ goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      const r = await releaseDueClaims(prisma, freshConfig(), undefined);
      expect(r.held).toBeGreaterThanOrEqual(1);
      const held = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id }, include: { externalOrder: true } });
      expect(held.state).toBe('HELD_NO_MEMBER');
      const releaseAt = held.externalOrder.deliveredAt!.getTime() + 14 * DAY;
      expect(held.holdUntil!.getTime()).toBe(releaseAt + 30 * DAY);
      expect(await prisma.pointsTransaction.count({ where: { refType: 'EXTERNAL_ORDER', refId: c.id } })).toBe(0);
      expect((await eventsOf(c.id)).map((e) => e.action)).toEqual(['CLAIM_CREATED', 'HOLD_NO_MEMBER']);
    });

    it('khách liên kết trong hạn giữ: PENDING rồi cron cộng, thông báo điểm chờ và điểm đã cộng', async () => {
      const ph = phone();
      const p = payload({ phone: ph, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      await releaseClaim(prisma, c.id, await releaseOpts());
      expect((await claimOf(String(p.id)))!.state).toBe('HELD_NO_MEMBER');
      const user = await mkUser({ phone: ph });
      notify.mockClear();
      expect((await linkClaimsByPhone(prisma, deps(), user)).linked).toBe(1);
      expect(await claimOf(String(p.id))).toMatchObject({ state: 'PENDING', userId: user.id, holdUntil: null });
      expect(notify).toHaveBeenCalledWith(user.id, 'CHAT_ORDER_POINTS_LINKED', { points: '10.000', count: '1' }, expect.anything());
      const res = await releaseClaim(prisma, c.id, await releaseOpts());
      expect(res).toMatchObject({ outcome: 'CREDITED', points: 10_000, kind: 'PHONE' });
      expect(await balanceOf(user.id)).toBe(10_000);
      const rows = await ledger(user.id, 'PANCAKE_CHAT_ORDER:');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ refType: 'EXTERNAL_ORDER', refId: c.id, delta: 10_000 });
      await noDrift();
    });

    it('quá hạn giữ: LAPSED, không ghi sổ, có nhật ký; liên kết sau đó không lấy lại được', async () => {
      const ph = phone();
      const p = payload({ phone: ph, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      await releaseClaim(prisma, c.id, await releaseOpts());
      await prisma.externalPointsClaim.update({ where: { id: c.id }, data: { holdUntil: new Date(Date.now() - 1000) } });
      expect(await lapseExpiredChatClaims(prisma, freshConfig())).toBeGreaterThanOrEqual(1);
      expect(await claimOf(String(p.id))).toMatchObject({ state: 'LAPSED' });
      expect((await eventsOf(c.id)).map((e) => e.action)).toEqual(['CLAIM_CREATED', 'HOLD_NO_MEMBER', 'LAPSE']);
      const user = await mkUser({ phone: ph });
      expect((await linkClaimsByPhone(prisma, deps(), user)).linked).toBe(0);
      expect(await balanceOf(user.id)).toBe(0);
      expect(await prisma.pointsTransaction.count({ where: { refType: 'EXTERNAL_ORDER', refId: c.id } })).toBe(0);
    });

    it('liên kết và hết hạn giữ đồng thời: hoặc nhận điểm hoặc mất điểm, không bao giờ cả hai (15 vòng)', async () => {
      for (let i = 0; i < 15; i++) {
        const ph = phone();
        const p = payload({ phone: ph, goods: 500_000, deliveredDaysAgo: 15 });
        await ingest(p);
        const c = (await claimOf(String(p.id)))!;
        await releaseClaim(prisma, c.id, await releaseOpts());
        // Còn đúng ~1 giây hạn: lapse và link xen kẽ quanh ranh giới.
        await prisma.externalPointsClaim.update({ where: { id: c.id }, data: { holdUntil: new Date(Date.now() + 150) } });
        const user = await mkUser({ phone: ph });
        await Promise.all([
          linkClaimsByPhone(prisma, deps(), user),
          (async () => {
            await new Promise((r) => setTimeout(r, 150));
            return lapseExpiredChatClaims(prisma, freshConfig());
          })(),
        ]);
        const final = (await claimOf(String(p.id)))!;
        expect(['PENDING', 'LAPSED']).toContain(final.state);
        if (final.state === 'PENDING') expect(final.userId).toBe(user.id);
        else expect(final.userId).toBeNull();
        expect(await prisma.pointsTransaction.count({ where: { refType: 'EXTERNAL_ORDER', refId: c.id } })).toBe(0);
      }
    });
  });

  describe('cộng điểm, hạng, đảo', () => {
    async function tierSetup() {
      const tag = randCode(6);
      const base = await prisma.membershipTier.create({ data: { id: `ITCH_${tag}_b`, name: 'Cơ bản', sortOrder: 40, minPoints: 0, minSpending: null, discountPct: 0, pointMultiplier: 1, perks: {} } });
      const gold = await prisma.membershipTier.create({ data: { id: `ITCH_${tag}_g`, name: 'Vàng', sortOrder: 41, minPoints: 1_000_000_000, minSpending: 5_000_000, discountPct: 0, pointMultiplier: 1.5, perks: {} } });
      tierIds.push(base.id, gold.id);
      return { base, gold, set: [base, gold] };
    }

    it('cộng: một dòng sổ PANCAKE_CHAT_ORDER, hệ số hạng LÚC CỘNG, thông báo CHAT_ORDER_POINTS_CREDITED; hạng lên khi cộng, xuống khi đảo', async () => {
      const t = await tierSetup();
      const user = await mkUser({ tierId: t.base.id });
      const p = payload({ phone: user.phone!, goods: 6_000_000, deliveredDaysAgo: 15 });
      // Vượt ngưỡng 5.000.000 nên REVIEW; người khác duyệt.
      await ingest(p);
      const staff = await mkUser({ role: 'STAFF', fullName: 'Duyệt Viên' });
      const claimsSvc = new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never);
      const admin = new ExternalClaimsAdminService(prisma, freshConfig(), { notify } as never, claimsSvc, loyalty());
      const c0 = (await claimOf(String(p.id)))!;
      expect(c0.state).toBe('REVIEW');
      await admin.approve(c0.id, staff.id);

      const l = loyalty();
      const hook = { recalcTier: (id: string) => l.recalcTier(id, t.set) };
      notify.mockClear();
      const res = await releaseDueClaims(prisma, freshConfig(), { notify } as never, new Date(), hook);
      expect(res.credited).toBeGreaterThanOrEqual(1);
      const c = (await claimOf(String(p.id)))!;
      expect(c.state).toBe('CREDITED');
      expect(Number(c.multiplier)).toBe(1); // hạng cơ bản lúc cộng
      expect(c.points).toBe(120_000);
      expect(await balanceOf(user.id)).toBe(120_000);
      expect(notify).toHaveBeenCalledWith(user.id, 'CHAT_ORDER_POINTS_CREDITED', expect.objectContaining({ points: '120.000' }), { dedupeKey: `chat-credit:${c.id}` });
      // 6.000.000 chi tiêu từ đơn chat ≥ mốc 5.000.000 của hạng Vàng: lên hạng ngay khi cộng.
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierId).toBe(t.gold.id);

      // Đảo: đơn hoàn → claim REVERSED, thu hồi điểm, hạng được tính lại ngay. Rớt hạng theo chính sách ân hạn sẵn có (decideTier):
      // lần đầu phát hiện chỉ đặt tierGraceUntil, hết ân hạn thì lần tính lại sau áp hạng thấp.
      await prisma.externalOrder.update({ where: { id: c.externalOrderId }, data: { status: 'RETURNED', pancakeStatus: 5, closedAt: new Date() } });
      const l2 = new LoyaltyService(prisma, freshConfig());
      expect(await applyStatusToClaim(prisma, { notify } as never, freshConfig(), String(p.id), { recalcTier: (id) => l2.recalcTier(id, t.set) })).toBe('REVERSE');
      expect(await claimOf(String(p.id))).toMatchObject({ state: 'REVERSED' });
      expect(await balanceOf(user.id)).toBe(0);
      const afterReverse = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(afterReverse.tierGraceUntil).not.toBeNull();
      await prisma.user.update({ where: { id: user.id }, data: { tierGraceUntil: new Date(Date.now() - 1000) } });
      await new LoyaltyService(prisma, freshConfig()).recalcTier(user.id, t.set);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ tierId: t.base.id, tierGraceUntil: null });
      const rev = await ledger(user.id, 'PANCAKE_CHAT_ORDER_REVERSED:');
      expect(rev).toHaveLength(1);
      expect(rev[0]).toMatchObject({ delta: -120_000, refId: c.id });
      await noDrift();
    });

    it('đảo mà khách đã tiêu hết điểm (không có dòng sổ đảo): hạng vẫn xuống vì claim REVERSED', async () => {
      const t = await tierSetup();
      const user = await mkUser({ tierId: t.base.id });
      await pin('loyalty.chat_order_review_above_vnd', 50_000_000);
      const p = payload({ phone: user.phone!, goods: 6_000_000, deliveredDaysAgo: 15 });
      await ingest(p);
      const l = loyalty();
      await releaseDueClaims(prisma, freshConfig(), undefined, new Date(), { recalcTier: (id) => l.recalcTier(id, t.set) });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierId).toBe(t.gold.id);
      await prisma.$transaction([
        prisma.pointsTransaction.create({ data: { userId: user.id, delta: -120_000, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' } }),
        prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { decrement: 120_000 } } }),
      ]);
      const c = (await claimOf(String(p.id)))!;
      await prisma.externalOrder.update({ where: { id: c.externalOrderId }, data: { status: 'CANCELLED', pancakeStatus: 6, closedAt: new Date() } });
      await applyStatusToClaim(prisma, undefined, freshConfig(), String(p.id), { recalcTier: (id) => l.recalcTier(id, t.set) });
      expect(await ledger(user.id, 'PANCAKE_CHAT_ORDER_REVERSED:')).toHaveLength(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierGraceUntil).not.toBeNull();
      await prisma.user.update({ where: { id: user.id }, data: { tierGraceUntil: new Date(Date.now() - 1000) } });
      await l.recalcTier(user.id, t.set);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierId).toBe(t.base.id);
      const since = new Date(Date.now() - 365 * DAY);
      const tierPoints = await (loyalty() as unknown as { tierPoints: (u: string, s: Date) => Promise<number> }).tierPoints(user.id, since);
      expect(tierPoints).toBe(0);
    });

    it('whitelist tierPoints có PANCAKE_CHAT_ORDER: điểm đơn chat đã cộng vào điểm xét hạng; đảo thì bị loại', async () => {
      const user = await mkUser();
      await pin('loyalty.chat_order_review_above_vnd', 50_000_000);
      const p = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(p);
      await releaseDueClaims(prisma, freshConfig(), undefined);
      const since = new Date(Date.now() - 365 * DAY);
      const tp = () => (loyalty() as unknown as { tierPoints: (u: string, s: Date) => Promise<number> }).tierPoints(user.id, since);
      expect(await tp()).toBe(10_000);
      const c = (await claimOf(String(p.id)))!;
      await prisma.externalOrder.update({ where: { id: c.externalOrderId }, data: { status: 'RETURNED', pancakeStatus: 5, closedAt: new Date() } });
      await applyStatusToClaim(prisma, undefined, freshConfig(), String(p.id));
      expect(await tp()).toBe(0);
    });

    it('cron cộng chạy song song hai lần: đúng một dòng sổ', async () => {
      const user = await mkUser();
      const p = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(p);
      const results = await Promise.all([
        releaseDueClaims(prisma, freshConfig(), { notify } as never),
        releaseDueClaims(prisma, freshConfig(), { notify } as never),
        releaseClaim(prisma, (await claimOf(String(p.id)))!.id, await releaseOpts()),
        releaseClaim(prisma, (await claimOf(String(p.id)))!.id, await releaseOpts()),
      ]);
      expect(results).toBeDefined();
      expect(await ledger(user.id, 'PANCAKE_CHAT_ORDER:')).toHaveLength(1);
      expect(await balanceOf(user.id)).toBe(10_000);
      await noDrift();
    });

    it('cron cộng song song với webhook hoàn (25 vòng): không bao giờ còn claim CREDITED mà đơn đã đóng, sổ cân', async () => {
      for (let i = 0; i < 25; i++) {
        const user = await mkUser();
        const p = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 15 });
        await ingest(p);
        const c = (await claimOf(String(p.id)))!;
        await Promise.all([
          releaseClaim(prisma, c.id, await releaseOpts()),
          (async () => {
            await prisma.externalOrder.update({ where: { id: c.externalOrderId }, data: { status: i % 2 ? 'RETURNED' : 'CANCELLED', pancakeStatus: i % 2 ? 5 : 6, closedAt: new Date() } });
            return applyStatusToClaim(prisma, undefined, freshConfig(), String(p.id));
          })(),
        ]);
        await applyStatusToClaim(prisma, undefined, freshConfig(), String(p.id));
        const final = (await claimOf(String(p.id)))!;
        expect(['VOIDED', 'REVERSED']).toContain(final.state);
        expect(await balanceOf(user.id)).toBe(0);
        const credits = await ledger(user.id, 'PANCAKE_CHAT_ORDER:');
        const reversals = await ledger(user.id, 'PANCAKE_CHAT_ORDER_REVERSED:');
        expect(credits.reduce((s, r) => s + r.delta, 0) + reversals.reduce((s, r) => s + r.delta, 0)).toBe(0);
      }
      await noDrift();
    });

    it('lô EXTERNAL:<refId> đã hết hạn và cron đã trừ: đảo không trừ lần hai; đảo trước rồi hết hạn: cron không trừ lô đã thu hồi', async () => {
      const a = await mkUser();
      const pa = payload({ phone: a.phone!, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(pa);
      await releaseDueClaims(prisma, freshConfig(), undefined);
      expect(await balanceOf(a.id)).toBe(10_000);
      await prisma.$executeRaw`
        UPDATE "points_transactions" SET "createdAt" = "createdAt" - interval '13 months', "expiresAt" = "expiresAt" - interval '13 months' WHERE "userId" = ${a.id}`;
      await new LoyaltyExpiryService(prisma, freshConfig(), { notify } as never).expirePoints();
      expect(await balanceOf(a.id)).toBe(0);
      const ca = (await claimOf(String(pa.id)))!;
      await prisma.externalOrder.update({ where: { id: ca.externalOrderId }, data: { status: 'RETURNED', pancakeStatus: 5, closedAt: new Date() } });
      await applyStatusToClaim(prisma, undefined, freshConfig(), String(pa.id));
      expect(await ledger(a.id, 'PANCAKE_CHAT_ORDER_REVERSED:')).toHaveLength(0);
      expect(await balanceOf(a.id)).toBe(0);

      const b = await mkUser();
      const pb = payload({ phone: b.phone!, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(pb);
      await releaseDueClaims(prisma, freshConfig(), undefined);
      await prisma.$transaction([
        prisma.pointsTransaction.create({ data: { userId: b.id, delta: 1_000, lot: 'STANDARD', reason: 'IT_OLD_LOT', refType: 'GAME', expiresAt: null } }),
        prisma.user.update({ where: { id: b.id }, data: { pointsBalance: { increment: 1_000 } } }),
      ]);
      const cb = (await claimOf(String(pb.id)))!;
      await prisma.externalOrder.update({ where: { id: cb.externalOrderId }, data: { status: 'RETURNED', pancakeStatus: 5, closedAt: new Date() } });
      await applyStatusToClaim(prisma, undefined, freshConfig(), String(pb.id));
      expect(await balanceOf(b.id)).toBe(1_000);
      await prisma.$executeRaw`
        UPDATE "points_transactions" SET "createdAt" = "createdAt" - interval '13 months', "expiresAt" = "expiresAt" - interval '13 months' WHERE "userId" = ${b.id}`;
      await new LoyaltyExpiryService(prisma, freshConfig(), { notify } as never).expirePoints();
      expect(await ledger(b.id, 'POINTS_EXPIRED')).toHaveLength(0);
      expect(await balanceOf(b.id)).toBe(1_000);
      await noDrift();
    });

    it('SĐT trên đơn đổi sang số khác sau khi tạo claim: không cộng cho thành viên của số cũ (REVIEW)', async () => {
      const user = await mkUser();
      const p = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      await prisma.externalOrder.update({ where: { id: c.externalOrderId }, data: { phone: phone() } });
      const r = await releaseClaim(prisma, c.id, await releaseOpts());
      expect(r.outcome).toBe('TO_REVIEW');
      expect(await balanceOf(user.id)).toBe(0);
    });

    it('thành viên thành nhân viên sau khi tạo claim: tới hạn vào REVIEW, không tự cộng', async () => {
      const user = await mkUser();
      const p = payload({ phone: user.phone!, goods: 500_000, deliveredDaysAgo: 15 });
      await ingest(p);
      await prisma.user.update({ where: { id: user.id }, data: { role: 'STAFF' } });
      const c = (await claimOf(String(p.id)))!;
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      expect(await balanceOf(user.id)).toBe(0);
    });
  });

  describe('backfill và danh sách', () => {
    it('đơn nạp lúc cờ tắt được tạo bù khi cờ bật', async () => {
      await pin('loyalty.chat_order_points_enabled', false);
      const p = payload({ goods: 500_000 });
      await ingest(p);
      expect(await claimOf(String(p.id))).toBeNull();
      await pin('loyalty.chat_order_points_enabled', true);
      expect(await backfillChatClaims(prisma, deps())).toBeGreaterThanOrEqual(1);
      expect(await claimOf(String(p.id))).toMatchObject({ kind: 'PHONE', state: 'PENDING' });
    });

    it('ensureChatClaim idempotent: gọi lại không tạo thêm, claim đã VOIDED không bao giờ được tạo lại', async () => {
      const p = payload();
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(await ensureChatClaim(prisma, deps(), String(p.id))).toBe('EXISTS');
      await prisma.externalPointsClaim.update({ where: { id: c.id }, data: { state: 'VOIDED' } });
      expect(await ensureChatClaim(prisma, deps(), String(p.id))).toBe('EXISTS');
      expect(await prisma.externalPointsClaim.count({ where: { externalOrderId: c.externalOrderId } })).toBe(1);
    });

    it('admin lọc theo kind: PHONE chỉ ra claim chat, SCAN không lẫn chat; SĐT chỉ ở dạng che', async () => {
      const ph = phone();
      const p = payload({ phone: ph, goods: 500_000 });
      await ingest(p);
      const admin = new ExternalClaimsAdminService(prisma, freshConfig(), { notify } as never, new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never));
      const phoneRes = await admin.list({ page: 1, limit: 50, kind: 'PHONE', q: ph });
      expect(phoneRes.data).toHaveLength(1);
      expect(phoneRes.data[0]).toMatchObject({ kind: 'PHONE', userId: null, state: 'PENDING' });
      expect(JSON.stringify(phoneRes)).not.toContain(ph);
      expect(phoneRes.data[0]!.orderPhoneMasked).toMatch(/\*/);
      const scan = await admin.list({ page: 1, limit: 50, kind: 'SCAN', q: ph });
      expect(scan.data).toHaveLength(0);
    });

    it('khách xem đơn chat của mình qua kind=PHONE, mặc định vẫn chỉ SCAN, không lộ SĐT', async () => {
      const user = await mkUser();
      const p = payload({ phone: user.phone!, goods: 500_000 });
      await ingest(p);
      const svc = new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never);
      const chat = await svc.listMine(user.id, 1, 20, 'PHONE');
      expect(chat.data).toHaveLength(1);
      expect(chat.data[0]).toMatchObject({ kind: 'PHONE', state: 'PENDING', points: 10_000, holdUntil: null });
      expect(JSON.stringify(chat)).not.toContain(user.phone!);
      expect((await svc.listMine(user.id, 1, 20)).data).toHaveLength(0);
    });
  });
});
