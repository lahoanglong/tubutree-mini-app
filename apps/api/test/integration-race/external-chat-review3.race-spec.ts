import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { linkClaimsByPhone } from '../../src/modules/external-points/external-chat.claim';
import { loadChatConfig } from '../../src/modules/external-points/external-chat.config';
import { releaseClaim } from '../../src/modules/external-points/external-claim-release';
import { ingestAndApply } from '../../src/modules/external-points/external-order.sync';
import { createOrder, createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Sửa sau review Opus lượt 2 của chatpts, trên Postgres THẬT: SĐT xác minh đã cũ không được làm claim mất chủ (B1), trần người tạo đơn
 * không bị vượt khi tiền hàng tăng lúc cộng (B2), hai lần liên kết song song không khoá người tạo ngược chiều (N-B), liên kết gặp SKIP
 * thì REVIEW (N-C), claim mất chủ lẫn SĐT không HELD rồi LAPSED (nhỏ).
 */
describe('Điểm đơn chat sau review lượt 3 (real Postgres)', () => {
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
  const old = () => new Date(Date.now() - 60_000);
  const claimOf = (id: string) => prisma.externalPointsClaim.findFirst({ where: { externalOrder: { pancakeOrderId: id } } });
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).pointsBalance;
  const eventsOf = (claimId: string) => prisma.externalClaimEvent.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } });
  const releaseOpts = async () => ({ pendingDays: 14, expiryMonths: 12, chat: await loadChatConfig(freshConfig()) });
  const adminSvc = () =>
    new ExternalClaimsAdminService(prisma, freshConfig(), { notify } as never, new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never));

  describe('L1: điểm đã chốt ở lần kiểm gần nhất là điểm được cộng, không quay vòng REVIEW', () => {
    it('R5: hạng tăng x2 sau khi claim qua kiểm: cộng đúng điểm đã kiểm, không vào REVIEW', async () => {
      const tier = await mkTier(2);
      const m = await mkUser();
      const p = payload({ phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(c).toMatchObject({ state: 'PENDING', points: 10_000 });
      await prisma.user.update({ where: { id: m.id }, data: { tierId: tier.id } });
      const r = await releaseClaim(prisma, c.id, await releaseOpts());
      expect(r).toMatchObject({ outcome: 'CREDITED', points: 10_000 });
      expect(await balanceOf(m.id)).toBe(10_000);
    });

    it('R6: claim bị chốt trần lúc liên kết (100.000 dù hạng x2 tính 200.000): cộng 100.000, không REVIEW', async () => {
      const tier = await mkTier(2);
      const P = phone();
      const a = payload({ phone: P, goods: 5_000_000, deliveredDaysAgo: 20 });
      const b = payload({ phone: P, goods: 5_000_000, deliveredDaysAgo: 20 });
      await ingest(a);
      await ingest(b);
      const u = await mkUser({ phone: P, tierId: tier.id });
      await linkClaimsByPhone(prisma, deps(), u);
      for (const p of [a, b]) {
        const c = (await claimOf(String(p.id)))!;
        expect(c).toMatchObject({ state: 'PENDING', points: 100_000 });
        expect(await releaseClaim(prisma, c.id, await releaseOpts())).toMatchObject({ outcome: 'CREDITED', points: 100_000 });
      }
      expect(await balanceOf(u.id)).toBe(200_000);
    });

    it('tiền hàng và hạng cùng tăng: REVIEW đúng một lần, duyệt rồi cộng theo điểm đã duyệt', async () => {
      const tier = await mkTier(2);
      const m = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20, updatedAt: old() }));
      const c = (await claimOf(id))!;
      await prisma.user.update({ where: { id: m.id }, data: { tierId: tier.id } });
      await ingest(payload({ id, phone: m.phone!, goods: 900_000, deliveredDaysAgo: 20 }));
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      const admin = await mkUser({ role: 'ADMIN' });
      await adminSvc().approve(c.id, admin.id);
      expect(await claimOf(id)).toMatchObject({ state: 'PENDING', points: 36_000 });
      expect(await releaseClaim(prisma, c.id, await releaseOpts())).toMatchObject({ outcome: 'CREDITED', points: 36_000 });
      expect((await eventsOf(c.id)).filter((e) => e.action === 'TO_REVIEW')).toHaveLength(1);
      expect(await balanceOf(m.id)).toBe(36_000);
    });

    it('tiền hàng tăng SAU khi đã duyệt: REVIEW đúng một lần nữa, duyệt lại thì cộng', async () => {
      const m = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20, updatedAt: old() }));
      const c = (await claimOf(id))!;
      const admin = await mkUser({ role: 'ADMIN' });
      await ingest(payload({ id, phone: m.phone!, goods: 900_000, deliveredDaysAgo: 20, updatedAt: new Date(Date.now() - 30_000) }));
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      await adminSvc().approve(c.id, admin.id);
      await ingest(payload({ id, phone: m.phone!, goods: 1_200_000, deliveredDaysAgo: 20 }));
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('SKIPPED');
      await adminSvc().approve(c.id, admin.id);
      expect(await releaseClaim(prisma, c.id, await releaseOpts())).toMatchObject({ outcome: 'CREDITED', points: 24_000 });
      expect((await eventsOf(c.id)).filter((e) => e.action === 'TO_REVIEW')).toHaveLength(2);
      expect((await claimOf(id))!.creditedGoodsValue).toBe(1_200_000);
    });

    it('tiền hàng giảm sau khi kiểm: cộng theo tiền hàng mới (không quá điểm đã kiểm), creditedGoodsValue là số đã cộng', async () => {
      const m = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20, updatedAt: old() }));
      const c = (await claimOf(id))!;
      expect(c.creditedGoodsValue).toBe(500_000);
      await ingest(payload({ id, phone: m.phone!, goods: 300_000, deliveredDaysAgo: 20 }));
      expect(await releaseClaim(prisma, c.id, await releaseOpts())).toMatchObject({ outcome: 'CREDITED', points: 6_000 });
      expect((await claimOf(id))!.creditedGoodsValue).toBe(300_000);
    });
  });

  describe('L2: danh sách và chi tiết admin có thông tin để kiểm người nhận, duyệt claim SĐT cũ phải có ghi chú', () => {
    async function staleClaim() {
      const m = await mkUser({ phoneVerifiedAt: new Date(Date.now() - 200 * DAY), fullName: 'Chi Lan' });
      const p = payload({ phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p);
      return { m, c: (await claimOf(String(p.id)))! };
    }

    it('list và detail trả mốc xác minh, tên, ngày tạo tài khoản, số đơn app đã giao, cờ cũ; claim không có chủ thì rỗng', async () => {
      const { m, c } = await staleClaim();
      await createOrder(prisma, { userId: m.id, status: 'DELIVERED', deliveredAt: new Date() });
      await createOrder(prisma, { userId: m.id, status: 'DELIVERED', deliveredAt: new Date() });
      await createOrder(prisma, { userId: m.id, status: 'CANCELLED' });
      const noOwner = payload({ phone: phone(), goods: 500_000 });
      await ingest(noOwner);
      const list = await adminSvc().list({ page: 1, limit: 50, kind: 'PHONE', state: 'REVIEW' });
      const row = list.data.find((r) => r.id === c.id)!;
      expect(row).toMatchObject({ memberDeliveredAppOrders: 2, memberPhoneStale: true, userName: 'Chi Lan' });
      expect(row.memberPhoneVerifiedAt).toBe((await prisma.user.findUniqueOrThrow({ where: { id: m.id } })).phoneVerifiedAt!.toISOString());
      expect(row.memberCreatedAt).toBe((await prisma.user.findUniqueOrThrow({ where: { id: m.id } })).createdAt.toISOString());
      const det = await adminSvc().detail(c.id);
      expect(det).toMatchObject({ memberDeliveredAppOrders: 2, memberPhoneStale: true });
      const other = (await adminSvc().list({ page: 1, limit: 50, kind: 'PHONE', q: String(noOwner.bill_phone_number) })).data[0]!;
      expect(other).toMatchObject({ userId: null, memberPhoneVerifiedAt: null, memberCreatedAt: null, memberDeliveredAppOrders: null, memberPhoneStale: false });
    });

    it('duyệt claim có lý do SĐT cũ mà mốc vẫn cũ: thiếu ghi chú thì 400, có ghi chú thì duyệt và cộng được', async () => {
      const { m, c } = await staleClaim();
      const admin = await mkUser({ role: 'ADMIN' });
      await expect(adminSvc().approve(c.id, admin.id)).rejects.toMatchObject({ status: 400 });
      await expect(adminSvc().approve(c.id, admin.id, new Date(), '   ')).rejects.toMatchObject({ status: 400 });
      expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
      await adminSvc().approve(c.id, admin.id, new Date(), 'Đã gọi khách xác nhận số');
      expect(await releaseClaim(prisma, c.id, await releaseOpts())).toMatchObject({ outcome: 'CREDITED', points: 10_000 });
      expect(await balanceOf(m.id)).toBe(10_000);
      expect((await eventsOf(c.id)).find((e) => e.action === 'APPROVE')!.note).toContain('Đã gọi khách xác nhận số');
    });

    it('claim REVIEW vì lý do khác, mốc SĐT còn mới: duyệt không cần ghi chú', async () => {
      const m = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20, updatedAt: old() }));
      const c = (await claimOf(id))!;
      await ingest(payload({ id, phone: m.phone!, goods: 900_000, deliveredDaysAgo: 20 }));
      await releaseClaim(prisma, c.id, await releaseOpts());
      const admin = await mkUser({ role: 'ADMIN' });
      await expect(adminSvc().approve(c.id, admin.id)).resolves.toMatchObject({ state: 'PENDING' });
    });
  });

  describe('L3a: lúc cộng kiểm lại mốc xác minh SĐT của thành viên', () => {
    it('mốc xác minh cũ đi trong lúc chờ: lúc cộng vào REVIEW với lý do SĐT cũ; duyệt kèm ghi chú thì cộng, không vòng lại', async () => {
      const m = await mkUser();
      const p = payload({ phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(c.state).toBe('PENDING');
      await prisma.user.update({ where: { id: m.id }, data: { phoneVerifiedAt: new Date(Date.now() - 200 * DAY) } });
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      expect((await claimOf(String(p.id)))!.reviewReason).toContain('xác minh đã cũ');
      expect(await balanceOf(m.id)).toBe(0);
      const admin = await mkUser({ role: 'ADMIN' });
      await adminSvc().approve(c.id, admin.id, new Date(), 'Khách xác nhận qua điện thoại');
      expect(await releaseClaim(prisma, c.id, await releaseOpts())).toMatchObject({ outcome: 'CREDITED', points: 10_000 });
      expect(await balanceOf(m.id)).toBe(10_000);
    });
  });

  describe('lượt 4: ghi chú khi duyệt claim có chủ mà SĐT xác minh vẫn cũ', () => {
    const staleMember = () => mkUser({ phoneVerifiedAt: new Date(Date.now() - 200 * DAY) });
    async function staleClaim() {
      const m = await staleMember();
      const p = payload({ phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p);
      return { m, c: (await claimOf(String(p.id)))! };
    }

    it.each([['chỉ ký tự vô hình', '\u200b\u200d\ufeff\u2060  '], ['dưới 3 ký tự', ' ab '], ['soft hyphen, Hangul và Braille trống', '\u00ad\u3164\u2800\u200e\u034f']])('M1: ghi chú %s bị NOTE_REQUIRED', async (_n, note) => {
      const { c } = await staleClaim();
      const admin = await mkUser({ role: 'ADMIN' });
      await expect(adminSvc().approve(c.id, admin.id, new Date(), note)).rejects.toMatchObject({ status: 400, response: { code: 'NOTE_REQUIRED' } });
      expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
    });

    it('M2 (R9): REVIEW vì vượt ngưỡng mà SĐT đã cũ lúc duyệt: bắt ghi chú, duyệt một lần là cộng, không quay lại REVIEW', async () => {
      const m = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: m.phone!, goods: 6_000_000, deliveredDaysAgo: 20 }));
      const c = (await claimOf(id))!;
      expect(c).toMatchObject({ state: 'REVIEW' });
      expect(c.reviewReason).not.toContain('xác minh đã cũ');
      await prisma.user.update({ where: { id: m.id }, data: { phoneVerifiedAt: new Date(Date.now() - 200 * DAY) } });
      const admin = await mkUser({ role: 'ADMIN' });
      await expect(adminSvc().approve(c.id, admin.id)).rejects.toMatchObject({ status: 400 });
      await adminSvc().approve(c.id, admin.id, new Date(), 'Đã gọi khách xác nhận số');
      expect(await releaseClaim(prisma, c.id, await releaseOpts())).toMatchObject({ outcome: 'CREDITED', points: 120_000 });
      expect((await eventsOf(c.id)).filter((e) => e.action === 'TO_REVIEW')).toHaveLength(0);
      expect(await balanceOf(m.id)).toBe(120_000);
    });

    it('M4: SĐT đầy đủ trong ghi chú bị che trước khi lưu (giữ 3 số cuối)', async () => {
      const { c } = await staleClaim();
      const admin = await mkUser({ role: 'ADMIN' });
      await adminSvc().approve(c.id, admin.id, new Date(), 'Gọi khách 0912 345 678 xác nhận');
      const note = (await eventsOf(c.id)).find((e) => e.action === 'APPROVE')!.note!;
      expect(note).toContain('678');
      expect(note).not.toContain('0912');
      expect(note).not.toContain('345');
    });
  });
});
