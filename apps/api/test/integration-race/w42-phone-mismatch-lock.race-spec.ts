import type { HttpException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { ExternalClaimsAdminService, ATTACH_PHONE_MISMATCH_REASON } from '../../src/modules/external-points/external-claims-admin.service';
import { releaseClaim, SCAN_NO_MEMBER_PHONE_REASON, SCAN_PHONE_CHANGED_REASON } from '../../src/modules/external-points/external-claim-release';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { vnDateKey } from '../../src/common/vn-time';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;
const ADMIN = { id: 'adm-w42', role: 'ADMIN' };

/**
 * W42: đơn sàn che SĐT. Người cầm mã của người khác (SĐT lệch) bị từ chối PHONE_MISMATCH, mỗi lần tính vào khoá 24h như mã không tìm thấy
 * (gửi song song cũng không vượt được ngưỡng vì khoá advisory theo khách); gắn tay khi lệch cần ghi chú và vào REVIEW; khách đổi SĐT trước
 * lúc cộng thì claim về REVIEW, không cộng điểm.
 */
describe('W42: SĐT che trên đơn sàn, khoá thử và cộng điểm (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const notify = jest.fn(async () => undefined);
  const lookup = { lookupAndIngest: jest.fn(async () => false) };
  const cfg = () => new SystemConfigService(prisma);
  const svc = () => new ExternalClaimService(prisma, cfg(), lookup as never, { notify, notifySafe: notify } as never);
  const adm = () => new ExternalClaimsAdminService(prisma, cfg(), { notify, notifySafe: notify } as never, svc());

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    restore.push(await pinConfig(prisma, 'loyalty.marketplace_claim_enabled', true));
    restore.push(await pinConfig(prisma, 'loyalty.point_expire_months', 12));
    restore.push(await pinConfig(prisma, 'loyalty.marketplace_earn_pct', 5));
  });
  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, userIds)).toEqual([]);
  });
  afterAll(async () => {
    for (const r of restore.reverse()) await r();
    const claimIds = (await prisma.externalPointsClaim.findMany({ where: { OR: [{ userId: { in: userIds } }, { externalOrderId: { in: orderIds } }] }, select: { id: true } })).map((c) => c.id);
    await prisma.externalClaimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalClaimAttempt.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { id: { in: claimIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  /** Khách có SĐT đuôi `tail` (8 số đầu ngẫu nhiên để không trùng unique). */
  async function mkUser(tail: string) {
    const u = await createUser(prisma, { phone: `09${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}${tail}`, zaloId: `z_${randCode(10)}` });
    userIds.push(u.id);
    return u;
  }
  /** Đơn sàn che SĐT `******<tail>`. */
  async function mkOrder(tail: string, over: Record<string, unknown> = {}) {
    const code = `IT${randCode(10)}`;
    const now = new Date();
    const o = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `EXTW42${randCode(10)}`, source: 'MARKETPLACE', channel: 'shopee', sourceKey: '-3|it|-3', trackingCode: code, trackingCodes: [code],
        goodsValue: 200_000, pancakeStatus: 2, status: 'OPEN', pancakeInsertedAt: new Date(now.getTime() - DAY), pancakeUpdatedAt: now, lastPayload: {}, phoneMask: `******${tail}`, ...over,
      },
    });
    orderIds.push(o.id);
    return { ...o, code };
  }
  const codeOf = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return 'OK';
    } catch (e) {
      const r = (e as HttpException).getResponse() as { code?: string };
      return r.code ?? `HTTP_${(e as HttpException).getStatus()}`;
    }
  };

  // W46: khách tự gửi mã lệch SĐT nhận PHONE_CONFIRM_REQUIRED thay cho PHONE_MISMATCH, vẫn tính vào khoá 24h y như cũ.
  it('6 lần gửi mã lệch SĐT song song → đúng 5 PHONE_CONFIRM_REQUIRED (403) + 1 LOCKED; lần sau vẫn LOCKED, không claim nào', async () => {
    const user = await mkUser('11');
    const orders = await Promise.all(Array.from({ length: 6 }, () => mkOrder('78')));
    const results = await Promise.allSettled(orders.map((o) => svc().submit(user.id, o.code)));
    const codes = await Promise.all(results.map((r) => codeOf(r.status === 'fulfilled' ? Promise.resolve(r.value) : Promise.reject(r.reason))));
    expect(codes.sort()).toEqual(['LOCKED', 'PHONE_CONFIRM_REQUIRED', 'PHONE_CONFIRM_REQUIRED', 'PHONE_CONFIRM_REQUIRED', 'PHONE_CONFIRM_REQUIRED', 'PHONE_CONFIRM_REQUIRED']);
    const forbidden = results.find((r) => r.status === 'rejected' && (r.reason as HttpException).getStatus() === 403);
    expect(forbidden).toBeDefined();
    // Thông báo không bao giờ lộ số nhìn thấy trên đơn.
    expect(JSON.stringify((forbidden as PromiseRejectedResult).reason.getResponse())).not.toContain('78');
    expect(await prisma.externalClaimAttempt.count({ where: { userId: user.id, result: 'REJECTED_PHONE_CONFIRM_REQUIRED' } })).toBe(5);
    expect(await codeOf(svc().submit(user.id, (await mkOrder('11')).code))).toBe('LOCKED');
    expect(await prisma.externalPointsClaim.count({ where: { userId: user.id } })).toBe(0);
  });

  it('lần thử lệch SĐT tính vào trần lần thử trong ngày: đủ 10 lần thì DAILY_ATTEMPTS dù mã khớp', async () => {
    const user = await mkUser('22');
    for (let i = 0; i < 4; i++) expect(await codeOf(svc().submit(user.id, (await mkOrder('78')).code))).toBe('PHONE_CONFIRM_REQUIRED');
    await prisma.externalClaimAttempt.createMany({
      data: Array.from({ length: 6 }, () => ({ userId: user.id, code: `IT${randCode(10)}`, result: 'REJECTED_CLOSED', dayKey: vnDateKey(new Date()) })),
    });
    expect(await codeOf(svc().submit(user.id, (await mkOrder('22')).code))).toBe('DAILY_ATTEMPTS');
  });

  it('gắn tay đơn lệch SĐT: thiếu ghi chú → NOTE_REQUIRED; có ghi chú → REVIEW với lý do lệch SĐT', async () => {
    const user = await mkUser('33');
    const order = await mkOrder('78');
    const attempt = await prisma.externalClaimAttempt.create({ data: { userId: user.id, code: order.code, result: 'UNMATCHED', dayKey: vnDateKey(new Date()) } });
    expect(await codeOf(adm().attach(attempt.id, order.pancakeOrderId, ADMIN, undefined))).toBe('NOTE_REQUIRED');
    const res = await adm().attach(attempt.id, order.pancakeOrderId, ADMIN, 'khách đổi số, đã đối chiếu ảnh đơn');
    expect(res.state).toBe('REVIEW');
    const claim = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: res.claimId } });
    expect(claim.reviewReason).toContain(ATTACH_PHONE_MISMATCH_REASON);
  });

  it('khách đổi SĐT trước lúc cộng: releaseClaim ×3 song song → REVIEW, không cộng; SĐT khớp → cộng đúng một lần vào lô MARKETPLACE có hạn', async () => {
    const changed = await mkUser('44');
    const kept = await mkUser('55');
    const delivered = { status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) };
    const o1 = await mkOrder('44', delivered);
    const o2 = await mkOrder('55', delivered);
    const r1 = await svc().submit(changed.id, o1.code);
    const r2 = await svc().submit(kept.id, o2.code);
    expect([r1.status, r2.status]).toEqual(['CLAIMED', 'CLAIMED']);
    const c1 = await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: changed.id } });
    const c2 = await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: kept.id } });
    expect([c1.state, c2.state]).toEqual(['PENDING', 'PENDING']);
    await prisma.user.update({ where: { id: changed.id }, data: { phone: `09${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}99` } });

    const runs = await Promise.allSettled([
      ...Array.from({ length: 3 }, () => releaseClaim(prisma, c1.id, { pendingDays: 14, expiryMonths: 12 })),
      ...Array.from({ length: 3 }, () => releaseClaim(prisma, c2.id, { pendingDays: 14, expiryMonths: 12 })),
    ]);
    expect(runs.every((r) => r.status === 'fulfilled')).toBe(true);
    const outcomes = runs.map((r) => (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome);
    expect(outcomes.slice(0, 3).filter((o) => o === 'TO_REVIEW')).toHaveLength(1);
    expect(outcomes.slice(3).filter((o) => o === 'CREDITED')).toHaveLength(1);

    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c1.id } })).toMatchObject({ state: 'REVIEW', reviewReason: SCAN_PHONE_CHANGED_REASON, pointsTxId: null });
    expect(await prisma.pointsTransaction.count({ where: { userId: changed.id } })).toBe(0);
    const credit = await prisma.pointsTransaction.findMany({ where: { userId: kept.id } });
    expect(credit).toHaveLength(1);
    expect(credit[0]).toMatchObject({ lot: 'MARKETPLACE', delta: 10_000, refType: 'EXTERNAL_ORDER', refId: c2.id });
    expect(credit[0]!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ pointsBalance: 0, pointsMarketplaceBalance: 10_000 });
  });

  it('khách gỡ SĐT trước lúc cộng: releaseClaim ×2 song song → REVIEW đúng một lần với lý do thiếu SĐT, không cộng', async () => {
    const user = await mkUser('66');
    const o = await mkOrder('66', { status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) });
    expect((await svc().submit(user.id, o.code)).status).toBe('CLAIMED');
    const c = await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.user.update({ where: { id: user.id }, data: { phone: null } });

    const runs = await Promise.allSettled(Array.from({ length: 2 }, () => releaseClaim(prisma, c.id, { pendingDays: 14, expiryMonths: 12 })));
    expect(runs.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(runs.map((r) => (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome).filter((x) => x === 'TO_REVIEW')).toHaveLength(1);
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ state: 'REVIEW', reviewReason: SCAN_NO_MEMBER_PHONE_REASON, pointsTxId: null });
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id } })).toBe(0);
  });
});
