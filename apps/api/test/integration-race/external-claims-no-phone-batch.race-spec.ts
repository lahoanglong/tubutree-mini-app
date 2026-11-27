import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { NO_PHONE_REVIEW_REASON } from '../../src/modules/external-points/external-claim.rules';
import { EXTERNAL_PENDING_DAYS_KEY, loadClaimConfig, MARKETPLACE_CLAIM_MONTHLY_CAP_KEY, MARKETPLACE_CLAIM_REVIEW_ABOVE_KEY } from '../../src/modules/external-points/external-claim.config';
import {
  ExternalClaimsNoPhoneBatchService,
  NO_PHONE_BATCH_AUDIT_ACTION,
  NO_PHONE_BATCH_NOTE,
  noPhoneOnlyBlock,
} from '../../src/modules/external-points/external-claims-no-phone-batch.service';
import { ingestAndApply } from '../../src/modules/external-points/external-order.sync';
import { createOrder, createUser, deleteItData, pinConfig, randCode, summarize, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Nút "Duyệt nhanh đơn Lazada đủ điều kiện" (W45) trên Postgres THẬT: đơn nạp qua `ingestAndApply` (lưu dấu vân tay tên người nhận, không
 * lưu tên), claim SCAN chờ duyệt chỉ vì đơn không có SĐT; màn admin đọc giỏ hàng và kết luận tên bằng toán tử JSON trong DB; bấm đúp chỉ
 * duyệt một lần; khách mới, tên lệch, đơn Shopee không qua; mỗi claim duyệt có dấu lượt trong nhật ký và một dòng sổ thao tác.
 */
describe('Duyệt nhanh claim Lazada thiếu SĐT (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const notify = jest.fn(async (..._args: unknown[]) => undefined);
  const MAP = { marketplaceIds: { '-3': 'shopee', '-4': 'lazada' }, chatSources: [] };

  const freshConfig = () => new SystemConfigService(prisma);
  const adminSvc = () =>
    new ExternalClaimsAdminService(prisma, freshConfig(), { notify, notifySafe: notify } as never, new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify, notifySafe: notify } as never));
  const batch = () => new ExternalClaimsNoPhoneBatchService(prisma, freshConfig(), adminSvc());
  const pin = async (key: string, value: Prisma.InputJsonValue) => restore.push(await pinConfig(prisma, key, value));

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });
  beforeEach(async () => {
    notify.mockClear();
    await pin(MARKETPLACE_CLAIM_MONTHLY_CAP_KEY, 200_000);
    await pin(MARKETPLACE_CLAIM_REVIEW_ABOVE_KEY, 2_000_000);
    await pin(EXTERNAL_PENDING_DAYS_KEY, 14);
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

  /** Đơn sàn nạp như webhook: SĐT người nhận bị sàn che hết, tên người nhận đầy đủ. */
  async function ingestOrder(o: { channelId?: '-3' | '-4'; recipient?: string; goods?: number }) {
    const now = new Date();
    const goods = o.goods ?? 250_000;
    const id = `${o.channelId === '-3' ? 'SPE' : 'LZD'}${randCode(12)}`;
    const p = {
      id,
      status: 3,
      marketplace_id: Number(o.channelId ?? '-4'),
      shipping_address: { full_name: o.recipient ?? 'Nguyễn Thị Lan', phone_number: '******' },
      bill_full_name: o.recipient ?? 'Nguyễn Thị Lan',
      items: [
        { quantity: 2, variation_info: { retail_price: goods / 2 - 10_000 } },
        { quantity: 1, variation_info: { retail_price: 20_000 } },
      ],
      total_price: goods,
      inserted_at: new Date(now.getTime() - 5 * DAY).toISOString(),
      updated_at: now.toISOString(),
      partner: { extend_code: `LZ${randCode(11)}` },
      status_history: [{ status: 3, updated_at: new Date(now.getTime() - DAY).toISOString() }],
    };
    const l = new LoyaltyService(prisma, freshConfig());
    await ingestAndApply(prisma, { config: freshConfig(), notifier: { notify, notifySafe: notify } as never, recalcTier: (uid) => l.recalcTier(uid) }, p, MAP);
    const order = await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: id } });
    orderIds.push(order.id);
    return order;
  }

  /** Claim SCAN chờ duyệt chỉ vì đơn thiếu SĐT, đúng như luồng gửi mã tạo (sự kiện CLAIM_CREATED ghi lý do). */
  async function noPhoneClaim(o: { member?: { fullName?: string; delivered?: number }; channelId?: '-3' | '-4'; recipient?: string; goods?: number } = {}) {
    const m = await mkUser({ fullName: o.member?.fullName ?? 'Nguyễn Thị Lan' });
    for (let i = 0; i < (o.member?.delivered ?? 1); i++) await createOrder(prisma, { userId: m.id, status: 'DELIVERED', deliveredAt: new Date() });
    const order = await ingestOrder(o);
    expect(order).toMatchObject({ source: 'MARKETPLACE', phone: null, status: 'DELIVERED' });
    const c = await prisma.externalPointsClaim.create({
      data: {
        externalOrderId: order.id,
        userId: m.id,
        kind: 'SCAN',
        state: 'REVIEW',
        ratePct: 5,
        multiplier: 1,
        points: Math.floor((order.goodsValue ?? 0) * 0.05),
        claimedCode: order.trackingCode,
        reviewReason: NO_PHONE_REVIEW_REASON,
        dayKey: new Date().toISOString().slice(0, 10),
      },
    });
    await prisma.externalClaimEvent.create({ data: { claimId: c.id, action: 'CLAIM_CREATED', actorId: m.id, toState: 'REVIEW', userIdAfter: m.id, note: NO_PHONE_REVIEW_REASON } });
    return { m, c, order };
  }
  const approveEvents = (claimId: string) => prisma.externalClaimEvent.findMany({ where: { claimId, action: 'APPROVE' } });

  it('bản lưu đơn chỉ có mã băm tên người nhận; màn admin đọc giỏ hàng và kết luận tên từ DB', async () => {
    const { c, order } = await noPhoneClaim();
    const stored = JSON.stringify(order.lastPayload);
    expect(stored).toContain('tubu_recipient');
    expect(stored).not.toMatch(/Lan|Nguy/);
    const row = await adminSvc().detail(c.id);
    expect(row).toMatchObject({
      phoneMatch: 'NO_DATA',
      recipientNameMatch: 'MATCH',
      itemSummary: '3 sản phẩm, 2 dòng: 2 × 115.000đ, 1 × 20.000đ',
      memberDeliveredAppOrders: 1,
      memberCreditedMarketplaceClaims: 0,
      memberPhoneStale: false,
    });
    expect(row.memberPhoneVerifiedAt).not.toBeNull();
    const list = await adminSvc().list({ page: 1, limit: 20, q: c.id });
    expect(list.data[0]).toMatchObject({ id: c.id, recipientNameMatch: 'MATCH', itemSummary: row.itemSummary });
  });

  it('xem trước không đổi gì; duyệt thật: PENDING, một APPROVE có dấu lượt, một dòng sổ thao tác', async () => {
    const { c } = await noPhoneClaim();
    const cskh = await mkUser({ role: 'STAFF' });
    const dry = await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] });
    expect(dry.results[0]).toMatchObject({ outcome: 'READY', deliveredAppOrders: 1, recipientNameMatch: 'MATCH' });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');

    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: true, outcome: 'APPROVED' });
    const after = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ state: 'PENDING', reviewReason: null, decidedById: cskh.id });
    expect(after.releaseAt).not.toBeNull();
    const ev = await approveEvents(c.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.note).toContain(NO_PHONE_BATCH_NOTE);
    expect(ev[0]!.actorId).toBe(cskh.id);
    const log = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: res.auditLogId! } });
    expect(log).toMatchObject({ action: NO_PHONE_BATCH_AUDIT_ACTION, targetType: 'EXTERNAL_POINTS_CLAIM', targetIds: [c.id], actorId: cskh.id });
  });

  it('bấm đúp (hai lượt cùng lúc): đúng một lần duyệt, lượt kia bỏ qua', async () => {
    const { c } = await noPhoneClaim();
    const [a, b] = [await mkUser({ role: 'STAFF' }), await mkUser({ role: 'STAFF' })];
    const s = summarize(await Promise.allSettled([batch().run(a.id, { dryRun: false, claimIds: [c.id] }), batch().run(b.id, { dryRun: false, claimIds: [c.id] })]));
    expect(s.errors.join()).not.toMatch(/40P01|P2034/);
    expect(s.rejected).toHaveLength(0);
    expect(s.fulfilled.map((f) => f.value.results[0]!.outcome).sort()).toEqual(['APPROVED', 'SKIPPED']);
    expect(await approveEvents(c.id)).toHaveLength(1);
  });

  it('khách mới (chưa đơn app, chưa đơn sàn đã cộng): không duyệt nhanh; có một claim đơn sàn khác đã cộng thì được', async () => {
    const { m, c } = await noPhoneClaim({ member: { delivered: 0 } });
    const cskh = await mkUser({ role: 'STAFF' });
    expect((await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] })).results[0]).toMatchObject({ ok: false, reason: expect.stringContaining('chưa nhận đơn app nào') });
    const credited = (orderId: string) =>
      prisma.externalPointsClaim.create({
        data: { externalOrderId: orderId, userId: m.id, kind: 'SCAN', state: 'CREDITED', ratePct: 5, multiplier: 1, points: 1_000, creditedAt: new Date(), dayKey: '2026-11-01', createdAt: new Date(Date.now() - 30 * DAY) },
      });
    // Claim đã cộng mà đơn sau đó bị huỷ (lẽ ra phải đảo điểm) không làm thành viên thành khách quen.
    const cancelled = await ingestOrder({});
    await prisma.externalOrder.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    await credited(cancelled.id);
    expect((await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] })).results[0]).toMatchObject({ ok: false, creditedClaims: 0 });
    expect((await adminSvc().detail(c.id)).memberCreditedMarketplaceClaims).toBe(0);
    const other = await ingestOrder({});
    const standing = await credited(other.id);
    expect((await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] })).results[0]).toMatchObject({ ok: true, creditedClaims: 1 });
    expect((await adminSvc().detail(c.id)).memberCreditedMarketplaceClaims).toBe(1);
    // Dòng của chính claim đã cộng không tự đếm mình.
    expect((await adminSvc().detail(standing.id)).memberCreditedMarketplaceClaims).toBe(0);
  });

  it('webhook sau có giỏ hàng nhưng thiếu tên người nhận: giữ dấu vân tay tên đã lưu, tên lệch vẫn chặn duyệt nhanh', async () => {
    const { c, order } = await noPhoneClaim({ recipient: 'Trần Văn Hùng' });
    const l = new LoyaltyService(prisma, freshConfig());
    await ingestAndApply(
      prisma,
      { config: freshConfig(), notifier: { notify, notifySafe: notify } as never, recalcTier: (uid) => l.recalcTier(uid) },
      { id: order.pancakeOrderId, status: 3, marketplace_id: -4, items: [{ quantity: 1, variation_info: { retail_price: 250_000 } }], total_price: 250_000, updated_at: new Date(Date.now() + 60_000).toISOString() },
      MAP,
    );
    const after = await prisma.externalOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.goodsValue).toBe(250_000);
    expect(JSON.stringify(after.lastPayload)).toContain('tubu_recipient');
    expect((await adminSvc().detail(c.id)).recipientNameMatch).toBe('MISMATCH');
    const cskh = await mkUser({ role: 'STAFF' });
    expect((await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] })).results[0]).toMatchObject({ ok: false, recipientNameMatch: 'MISMATCH' });
  });

  it('tên người nhận khác hẳn tên thành viên: không duyệt nhanh, claim vẫn chờ', async () => {
    const { c } = await noPhoneClaim({ recipient: 'Trần Văn Hùng' });
    const cskh = await mkUser({ role: 'STAFF' });
    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: false, outcome: 'FAILED', recipientNameMatch: 'MISMATCH', reason: expect.stringContaining('Tên người nhận') });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
    expect(await approveEvents(c.id)).toHaveLength(0);
  });

  it('đơn Shopee thiếu SĐT: xem trước không liệt kê, gửi id thẳng cũng bị chặn', async () => {
    const { c } = await noPhoneClaim({ channelId: '-3' });
    const cskh = await mkUser({ role: 'STAFF' });
    const dry = await batch().run(cskh.id, { dryRun: true });
    expect(dry.results.map((r) => r.id)).not.toContain(c.id);
    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: false, reason: expect.stringContaining('Chỉ duyệt nhanh đơn Lazada') });
  });

  it('đơn chuyển sang đang hoàn giữa xem trước và duyệt: không duyệt', async () => {
    const { c, order } = await noPhoneClaim();
    const cskh = await mkUser({ role: 'STAFF' });
    expect((await batch().run(cskh.id, { dryRun: true, claimIds: [c.id] })).okCount).toBe(1);
    await prisma.externalOrder.update({ where: { id: order.id }, data: { status: 'RETURNING' } });
    const res = await batch().run(cskh.id, { dryRun: false, claimIds: [c.id] });
    expect(res.results[0]).toMatchObject({ ok: false, outcome: 'FAILED' });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
  });

  it('khoá trong lượt duyệt: guard dưới khoá chặn khi thành viên bị khoá ngay trước lúc duyệt', async () => {
    const { m, c } = await noPhoneClaim();
    const cskh = await mkUser({ role: 'STAFF' });
    const svc = adminSvc();
    await prisma.user.update({ where: { id: m.id }, data: { isBlocked: true } });
    const cfg = await loadClaimConfig(freshConfig());
    await expect(svc.approve(c.id, cskh.id, new Date(), undefined, { guard: (tx, lc) => noPhoneOnlyBlock(tx, lc, { now: new Date(), cfg }), eventNote: NO_PHONE_BATCH_NOTE })).rejects.toMatchObject({
      status: 409,
    });
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('REVIEW');
  });
});
