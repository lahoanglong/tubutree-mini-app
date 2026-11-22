import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { ExternalClaimsStaleBatchService, STALE_BATCH_AUDIT_ACTION } from '../../src/modules/external-points/external-claims-stale-batch.service';
import { PHONE_STALE_REASON } from '../../src/modules/external-points/external-chat.rules';
import { ingestAndApply } from '../../src/modules/external-points/external-order.sync';
import { createOrder, createUser, deleteItData, pinConfig, randCode, summarize, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Nút "Duyệt nhanh đơn chat SĐT đã từng nhận app" trên Postgres THẬT: chỉ claim REVIEW vướng duy nhất SĐT cũ, thành viên đã nhận đơn app, SĐT
 * vẫn trỏ đúng thành viên; bấm đúp chỉ duyệt một lần; claim vướng thêm luật khác hoặc của chính người bấm không qua.
 */
describe('Duyệt nhanh claim SĐT cũ (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const notify = jest.fn(async (..._args: unknown[]) => undefined);
  const MAP = { marketplaceIds: { '-3': 'shopee' }, chatSources: ['ITCHAT|itacc|'] };

  const freshConfig = () => new SystemConfigService(prisma);
  const deps = () => ({ config: freshConfig(), notifier: { notify, notifySafe: notify } as never });
  const pin = async (key: string, value: Prisma.InputJsonValue) => restore.push(await pinConfig(prisma, key, value));
  const adminSvc = () =>
    new ExternalClaimsAdminService(prisma, freshConfig(), { notify, notifySafe: notify } as never, new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify, notifySafe: notify } as never));
  const batch = () => new ExternalClaimsStaleBatchService(prisma, freshConfig(), adminSvc());

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
    await prisma.adminAuditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.externalClaimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { id: { in: claimIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function mkUser(over: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    const u = await createUser(prisma, { phone: phone(), phoneVerifiedAt: new Date(), zaloId: `zalo_${randCode(10)}`, ...over });
    userIds.push(u.id);
    return u;
  }
  function payload(o: { phone: string; goods?: number }) {
    const now = new Date();
    const delivered = new Date(now.getTime() - 20 * DAY);
    const goods = o.goods ?? 500_000;
    return {
      id: `CHAT${randCode(10)}`,
      status: 3,
      order_sources: 'ITCHAT',
      account: 'itacc',
      bill_phone_number: o.phone,
      items: [{ quantity: 1, variation_info: { retail_price: goods } }],
      total_price: goods,
      inserted_at: new Date(now.getTime() - 25 * DAY).toISOString(),
      updated_at: now.toISOString(),
      partner: { extend_code: `GHN${randCode(9)}` },
      status_history: [{ status: 3, updated_at: delivered.toISOString() }],
    };
  }
  async function ingest(p: Record<string, unknown>) {
    const l = new LoyaltyService(prisma, freshConfig());
    await ingestAndApply(prisma, { ...deps(), recalcTier: (id) => l.recalcTier(id) }, p, MAP);
    const order = await prisma.externalOrder.findUnique({ where: { pancakeOrderId: String(p['id']) } });
    if (order && !orderIds.includes(order.id)) orderIds.push(order.id);
    return prisma.externalPointsClaim.findFirstOrThrow({ where: { externalOrderId: order!.id } });
  }
  /** Thành viên SĐT xác minh 200 ngày trước, `delivered` đơn app đã giao, một đơn chat `goods` đồng. */
  async function staleClaim(o: { delivered?: number; goods?: number } = {}) {
    const m = await mkUser({ phoneVerifiedAt: new Date(Date.now() - 200 * DAY), fullName: 'Chi Lan' });
    for (let i = 0; i < (o.delivered ?? 1); i++) await createOrder(prisma, { userId: m.id, status: 'DELIVERED', deliveredAt: new Date() });
    const c = await ingest(payload({ phone: m.phone!, goods: o.goods }));
    return { m, c };
  }
  const approveEvents = async (claimId: string) => (await prisma.externalClaimEvent.findMany({ where: { claimId, action: 'APPROVE' } })).length;

  it('xem trước không đổi gì, liệt kê claim duyệt nhanh được', async () => {
    const { c } = await staleClaim();
    expect(c).toMatchObject({ state: 'REVIEW', reviewReason: PHONE_STALE_REASON });
    const cskh = await mkUser({ role: 'STAFF' });
    const res = await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] });
    expect(res).toMatchObject({ dryRun: true, okCount: 1, auditLogId: null });
    expect(res.results[0]).toMatchObject({ outcome: 'READY', deliveredAppOrders: 1, userName: 'Chi Lan' });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
  });

  it('duyệt thật: claim sang PENDING, một sự kiện APPROVE có ghi chú, một dòng sổ thao tác', async () => {
    const { c } = await staleClaim();
    const cskh = await mkUser({ role: 'STAFF' });
    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: true, outcome: 'APPROVED' });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('PENDING');
    const ev = await prisma.externalClaimEvent.findMany({ where: { claimId: c.id, action: 'APPROVE' } });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.note).toContain('Duyệt nhanh');
    const log = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: res.auditLogId! } });
    expect(log).toMatchObject({ action: STALE_BATCH_AUDIT_ACTION, targetType: 'EXTERNAL_POINTS_CLAIM', targetIds: [c.id] });
  });

  it('bấm đúp (hai lượt cùng lúc): đúng một lần duyệt, lượt kia bỏ qua', async () => {
    const { c } = await staleClaim();
    const [a, b] = [await mkUser({ role: 'STAFF' }), await mkUser({ role: 'STAFF' })];
    const s = summarize(await Promise.allSettled([batch().run(a.id, { dryRun: false, claimIds: [c.id] }), batch().run(b.id, { dryRun: false, claimIds: [c.id] })]));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(s.fulfilled.map((f) => f.value.results[0]!.outcome).sort()).toEqual(['APPROVED', 'SKIPPED']);
    expect(await approveEvents(c.id)).toBe(1);
  });

  it('thành viên chưa nhận đơn app nào: không duyệt nhanh', async () => {
    const { c } = await staleClaim({ delivered: 0 });
    const cskh = await mkUser({ role: 'STAFF' });
    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: false, outcome: 'FAILED', reason: expect.stringContaining('chưa nhận đơn app') });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
    expect(await approveEvents(c.id)).toBe(0);
  });

  it('tubu-w18-01: đơn CTV đặt hộ và đơn đại lý đã giao không tính là "đơn app đã nhận"', async () => {
    const { m, c } = await staleClaim({ delivered: 0 });
    await createOrder(prisma, { userId: m.id, status: 'DELIVERED', deliveredAt: new Date(), placedForCustomer: true, endCustomerKey: '0912345678' });
    await createOrder(prisma, { userId: m.id, status: 'DELIVERED', deliveredAt: new Date(), type: 'DEALER' });
    const cskh = await mkUser({ role: 'STAFF' });
    const dry = await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] });
    expect(dry.results[0]).toMatchObject({ ok: false, deliveredAppOrders: 0, reason: expect.stringContaining('chưa nhận đơn app') });
    await createOrder(prisma, { userId: m.id, status: 'DELIVERED', deliveredAt: new Date() });
    const res = await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: true, outcome: 'READY', deliveredAppOrders: 1 });
  });

  it('claim vướng thêm ngưỡng tiền: không duyệt nhanh', async () => {
    const { c } = await staleClaim({ goods: 6_000_000 });
    expect(c).toMatchObject({ state: 'REVIEW', reviewReason: PHONE_STALE_REASON });
    const cskh = await mkUser({ role: 'STAFF' });
    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: false, outcome: 'FAILED', reason: expect.stringContaining('Còn vướng') });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
  });

  it('claim của chính người bấm: không duyệt', async () => {
    const { m, c } = await staleClaim();
    await prisma.user.update({ where: { id: m.id }, data: { role: 'STAFF' } });
    const res = await batch().run(m.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: false, outcome: 'FAILED', reason: expect.stringContaining('chính mình') });
    expect(await approveEvents(c.id)).toBe(0);
  });

  it('SĐT đổi chủ giữa xem trước và duyệt: khoá trong lượt duyệt chặn lại', async () => {
    const { m, c } = await staleClaim();
    const cskh = await mkUser({ role: 'STAFF' });
    expect((await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] })).okCount).toBe(1);
    await prisma.user.update({ where: { id: m.id }, data: { isBlocked: true } });
    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: false, outcome: 'FAILED' });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
  });

  it('lượt thật không kèm danh sách: 400', async () => {
    const cskh = await mkUser({ role: 'STAFF' });
    await expect(batch().run(cskh.id, { dryRun: false })).rejects.toMatchObject({ status: 400 });
  });
});
