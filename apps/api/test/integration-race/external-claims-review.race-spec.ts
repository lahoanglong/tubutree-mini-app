import type { HttpException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { applyStatusToClaim } from '../../src/modules/external-points/external-claim-status';
import { releaseDueClaims } from '../../src/modules/external-points/external-claim-release';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;
const ADMIN = { id: 'adm-1', role: 'ADMIN' };
const STAFF = { id: 'staff-1', role: 'STAFF' };

/** Sửa sau review lượt 1 (A1 gắn đơn và nhật ký, B1 hoàn một phần, B2 giữ điểm, B3 tính lại lúc cộng) trên Postgres thật. */
describe('Điểm đơn ngoài app: gắn đơn, duyệt, nhật ký, hoàn một phần (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const notify = jest.fn(async () => undefined);
  const lookup = { lookupAndIngest: jest.fn(async () => false) };
  const cfg = () => new SystemConfigService(prisma);
  const svc = () => new ExternalClaimService(prisma, cfg(), lookup as never, { notify } as never);
  const adm = () => new ExternalClaimsAdminService(prisma, cfg(), { notify } as never, svc());

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    restore.push(await pinConfig(prisma, 'loyalty.marketplace_claim_enabled', true));
    restore.push(await pinConfig(prisma, 'loyalty.point_expire_months', 12));
  });
  afterAll(async () => {
    for (const r of restore.reverse()) await r();
    const claimIds = (await prisma.externalPointsClaim.findMany({ where: { OR: [{ userId: { in: userIds } }, { externalOrderId: { in: orderIds } }] }, select: { id: true } })).map((c) => c.id);
    await prisma.externalClaimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.externalClaimAttempt.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { id: { in: claimIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });
  beforeEach(() => notify.mockClear());

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function mkUser(role: 'CUSTOMER' | 'STAFF' = 'CUSTOMER') {
    const u = await createUser(prisma, { phone: phone(), zaloId: `z_${randCode(10)}`, role });
    userIds.push(u.id);
    return u;
  }
  async function mkOrder(over: Record<string, unknown> = {}) {
    const code = `IT${randCode(10)}`;
    const now = new Date();
    const o = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `EXTRV${randCode(10)}`, source: 'MARKETPLACE', channel: 'shopee', sourceKey: 'x', trackingCode: code, trackingCodes: [code],
        goodsValue: 200_000, pancakeStatus: 2, status: 'OPEN', pancakeInsertedAt: new Date(now.getTime() - DAY), pancakeUpdatedAt: now, lastPayload: {}, ...over,
      },
    });
    orderIds.push(o.id);
    return { ...o, code };
  }
  async function unmatchedAttempt(userId: string, code: string) {
    return prisma.externalClaimAttempt.create({ data: { userId, code, result: 'UNMATCHED', dayKey: new Date().toISOString().slice(0, 10) } });
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
  const events = (claimId: string) => prisma.externalClaimEvent.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } });

  describe('A1: gắn đơn', () => {
    it('mã khách gửi không trùng mã trên đơn: nhân viên bị chặn, ADMIN thiếu ghi chú bị chặn, ADMIN có ghi chú gắn được và có nhật ký', async () => {
      const user = await mkUser();
      const order = await mkOrder();
      const attempt = await unmatchedAttempt(user.id, `OTHER${randCode(8)}`);
      expect(await codeOf(adm().attach(attempt.id, order.pancakeOrderId, STAFF, 'có'))).toBe('ATTACH_ADMIN_ONLY');
      expect(await codeOf(adm().attach(attempt.id, order.pancakeOrderId, ADMIN, undefined))).toBe('NOTE_REQUIRED');
      expect(await prisma.externalPointsClaim.count({ where: { externalOrderId: order.id } })).toBe(0);
      const res = await adm().attach(attempt.id, order.pancakeOrderId, ADMIN, 'khách gửi mã sàn, đã đối chiếu ảnh');
      expect(res.state).toBe('PENDING');
      const ev = await events(res.claimId);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ action: 'ATTACH', actorId: ADMIN.id, toState: 'PENDING', userIdAfter: user.id });
      expect(ev[0]!.note).toContain('đối chiếu');
    });
    it('mã trùng mã trên đơn: nhân viên CSKH gắn được không cần ghi chú', async () => {
      const user = await mkUser();
      const order = await mkOrder();
      const attempt = await unmatchedAttempt(user.id, order.code);
      expect((await adm().attach(attempt.id, order.pancakeOrderId, STAFF, undefined)).state).toBe('PENDING');
    });
    it('đơn nguồn UNKNOWN: chỉ ADMIN có ghi chú, và dòng đơn KHÔNG bị đổi sang MARKETPLACE', async () => {
      const user = await mkUser();
      const order = await mkOrder({ source: 'UNKNOWN' });
      const attempt = await unmatchedAttempt(user.id, order.code);
      expect(await codeOf(adm().attach(attempt.id, order.pancakeOrderId, STAFF, 'x'))).toBe('ATTACH_ADMIN_ONLY');
      expect(await codeOf(adm().attach(attempt.id, order.pancakeOrderId, ADMIN, undefined))).toBe('NOTE_REQUIRED');
      expect((await adm().attach(attempt.id, order.pancakeOrderId, ADMIN, 'đã hỏi khách là đơn Shopee')).claimId).toBeTruthy();
      expect((await prisma.externalOrder.findUniqueOrThrow({ where: { id: order.id } })).source).toBe('UNKNOWN');
    });
    it('đơn chat không gắn theo mã; đơn quá tuổi, trước mốc, vượt trần tháng bị từ chối như lúc gửi mã', async () => {
      const user = await mkUser();
      const chat = await mkOrder({ source: 'CHAT' });
      expect(await codeOf(adm().attach((await unmatchedAttempt(user.id, chat.code)).id, chat.pancakeOrderId, ADMIN, 'x'))).toBe('CHAT_ORDER');
      const old = await mkOrder({ pancakeInsertedAt: new Date(Date.now() - 90 * DAY) });
      expect(await codeOf(adm().attach((await unmatchedAttempt(user.id, old.code)).id, old.pancakeOrderId, ADMIN, 'x'))).toBe('TOO_OLD');
      const restoreCap = await pinConfig(prisma, 'loyalty.marketplace_claim_monthly_points_cap', 1_000);
      try {
        const big = await mkOrder({ goodsValue: 200_000 });
        expect(await codeOf(adm().attach((await unmatchedAttempt(user.id, big.code)).id, big.pancakeOrderId, ADMIN, 'x'))).toBe('MONTHLY_CAP');
      } finally {
        await restoreCap();
      }
    });
    it('đơn giá trị lớn hoặc khách là nhân viên: vào REVIEW (không tự thành PENDING), và người gắn không tự duyệt được', async () => {
      const user = await mkUser();
      const big = await mkOrder({ goodsValue: 3_000_000 });
      const res = await adm().attach((await unmatchedAttempt(user.id, big.code)).id, big.pancakeOrderId, STAFF, undefined);
      expect(res.state).toBe('REVIEW');
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: res.claimId } })).toMatchObject({ state: 'REVIEW', decidedById: null });
      expect(await codeOf(adm().approve(res.claimId, STAFF.id))).toBe('SAME_INTRODUCER');
      expect((await adm().approve(res.claimId, 'other-staff')).state).toBe('PENDING');
    });
    it('nhân viên (STAFF) tự gửi mã của mình: REVIEW với lý do riêng', async () => {
      const staff = await mkUser('STAFF');
      const order = await mkOrder();
      const r = await svc().submit(staff.id, order.code);
      expect(r.status).toBe('REVIEW');
      expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).reviewReason).toContain('nhân viên');
    });
  });

  describe('không tự xử lý claim của chính mình', () => {
    it('attach, approve, void, void-and-reopen, reverse đều bị chặn khi người làm là chủ claim', async () => {
      const owner = await mkUser();
      const order = await mkOrder({ goodsValue: 3_000_000 });
      const attempt = await unmatchedAttempt(owner.id, order.code);
      expect(await codeOf(adm().attach(attempt.id, order.pancakeOrderId, { id: owner.id, role: 'ADMIN' }, 'x'))).toBe('SELF_ACTION');
      const r = await svc().submit(owner.id, order.code);
      expect(await codeOf(adm().approve(r.claimId!, owner.id))).toBe('SELF_ACTION');
      expect(await codeOf(adm().voidClaim(r.claimId!, owner.id, 'x', false))).toBe('SELF_ACTION');
      expect(await codeOf(adm().voidClaim(r.claimId!, owner.id, 'x', true))).toBe('SELF_ACTION');
      expect(await codeOf(adm().reverse(r.claimId!, owner.id, 'x'))).toBe('SELF_ACTION');
      expect(await codeOf(adm().keepPoints(r.claimId!, owner.id, 'x'))).toBe('SELF_ACTION');
    });
  });

  describe('nhật ký chỉ-thêm', () => {
    it('trigger chặn UPDATE; void-and-reopen giữ dấu vết chủ cũ và người nhận lại', async () => {
      const a = await mkUser();
      const c = await mkUser();
      const order = await mkOrder();
      const first = await svc().submit(a.id, order.code);
      await adm().voidClaim(first.claimId!, ADMIN.id, 'nghi gian lận', true);
      const again = await svc().submit(c.id, order.code);
      expect(again.claimId).toBe(first.claimId);
      const ev = await events(first.claimId!);
      expect(ev.map((e) => e.action)).toEqual(['CLAIM_CREATED', 'VOID_REOPEN', 'REOPEN_CLAIM']);
      expect(ev[1]).toMatchObject({ actorId: ADMIN.id, userIdBefore: a.id, toState: 'VOIDED' });
      expect(ev[2]).toMatchObject({ actorId: c.id, userIdBefore: a.id, userIdAfter: c.id });
      await expect(prisma.externalClaimEvent.update({ where: { id: ev[0]!.id }, data: { note: 'sửa lén' } })).rejects.toThrow();
    });
  });

  describe('B1: duyệt claim của đơn hoàn một phần', () => {
    it('approve đặt releaseAt hợp lệ; cron cộng theo tiền hàng mới nhất', async () => {
      const user = await mkUser();
      const order = await mkOrder({ status: 'PARTIAL_RETURN', pancakeStatus: 16, goodsValue: 3_000_000 });
      const r = await svc().submit(user.id, order.code);
      expect(r.status).toBe('REVIEW');
      const t0 = new Date();
      await adm().approve(r.claimId!, ADMIN.id, t0);
      const claim = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } });
      expect(claim.state).toBe('PENDING');
      expect(claim.releaseAt?.getTime()).toBe(t0.getTime() + 14 * DAY);
      await prisma.externalOrder.update({ where: { id: order.id }, data: { goodsValue: 150_000 } });
      expect((await releaseDueClaims(prisma, cfg(), { notify }, new Date(t0.getTime() + 13 * DAY))).credited).toBe(0);
      await releaseDueClaims(prisma, cfg(), { notify }, new Date(t0.getTime() + 15 * DAY));
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'CREDITED', points: 1_500 });
      expect((await events(r.claimId!)).map((e) => e.action)).toEqual(['CLAIM_CREATED', 'APPROVE', 'CREDIT']);
    });
    it('claim PENDING của đơn hoàn một phần chưa ai duyệt thì cron KHÔNG cộng', async () => {
      const user = await mkUser();
      const order = await mkOrder({ status: 'PARTIAL_RETURN', pancakeStatus: 16 });
      const claim = await prisma.externalPointsClaim.create({
        data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: order.code, dayKey: '2026-10-20', releaseAt: new Date(Date.now() - DAY) },
      });
      await releaseDueClaims(prisma, cfg(), { notify });
      expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).state).toBe('PENDING');
    });
  });

  describe('B2: giữ điểm, gỡ cờ', () => {
    it('claim đã cộng bị cờ hoàn một phần: giữ điểm gỡ cờ, có nhật ký, không bị gắn cờ lại; claim không cờ thì 409', async () => {
      const user = await mkUser();
      const order = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) });
      const claim = await prisma.externalPointsClaim.create({
        data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: order.code, dayKey: '2026-10-20' },
      });
      await releaseDueClaims(prisma, cfg(), { notify });
      expect(await codeOf(adm().keepPoints(claim.id, ADMIN.id, 'x'))).toBe('NOT_FLAGGED');
      await prisma.externalOrder.update({ where: { id: order.id }, data: { status: 'PARTIAL_RETURN', pancakeStatus: 16 } });
      await applyStatusToClaim(prisma, { notify }, cfg(), order.pancakeOrderId);
      expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).reviewReason).not.toBeNull();
      await adm().keepPoints(claim.id, ADMIN.id, 'khách giữ hàng, hoàn phần nhỏ');
      await applyStatusToClaim(prisma, { notify }, cfg(), order.pancakeOrderId);
      const after = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(after).toMatchObject({ state: 'CREDITED', reviewReason: null });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(2_000);
      const ev = await events(claim.id);
      expect(ev.map((e) => e.action)).toEqual(['CREDIT', 'FLAG_PARTIAL', 'KEEP_POINTS']);
      expect(ev[2]).toMatchObject({ actorId: ADMIN.id });
    });
  });

  describe('B3: tính lại lúc cộng', () => {
    it('tiền hàng tăng vượt ngưỡng REVIEW sau khi claim tự duyệt: chuyển REVIEW, không cộng', async () => {
      const user = await mkUser();
      const order = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 200_000 });
      const claim = await prisma.externalPointsClaim.create({
        data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: order.code, dayKey: '2026-10-20' },
      });
      await prisma.externalOrder.update({ where: { id: order.id }, data: { goodsValue: 5_000_000 } });
      const res = await releaseDueClaims(prisma, cfg(), { notify });
      expect(res.credited).toBe(0);
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'REVIEW' });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(0);
    });
    it('điểm tính lại vượt trần tháng còn lại: chuyển REVIEW', async () => {
      const restoreCap = await pinConfig(prisma, 'loyalty.marketplace_claim_monthly_points_cap', 3_000);
      try {
        const user = await mkUser();
        const order = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 200_000 });
        const claim = await prisma.externalPointsClaim.create({
          data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: order.code, dayKey: '2026-10-20' },
        });
        await prisma.externalOrder.update({ where: { id: order.id }, data: { goodsValue: 400_000 } });
        await releaseDueClaims(prisma, cfg(), { notify });
        expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).state).toBe('REVIEW');
      } finally {
        await restoreCap();
      }
    });
  });

  describe('C5: một mã, một lần tích dù Pancake tách thành nhiều dòng đơn', () => {
    it('đơn thứ hai cùng mã vận đơn bị ALREADY_CLAIMED khi dòng đầu đã có claim; claim bị huỷ thường thì cũng không mở được lại bằng dòng kia', async () => {
      const a = await mkUser();
      const b = await mkUser();
      const first = await mkOrder();
      const second = await mkOrder({ trackingCode: first.code, trackingCodes: [first.code] });
      await svc().submit(a.id, first.code);
      const claimed = await prisma.externalPointsClaim.findFirstOrThrow({ where: { externalOrderId: { in: [first.id, second.id] } } });
      const other = claimed.externalOrderId === first.id ? second : first;
      expect(await codeOf(svc().submit(b.id, first.code))).toBe('ALREADY_CLAIMED');
      const attempt = await unmatchedAttempt(b.id, first.code);
      expect(await codeOf(adm().attach(attempt.id, other.pancakeOrderId, ADMIN, 'x'))).toBe('ALREADY_CLAIMED');
      expect(await prisma.externalPointsClaim.count({ where: { externalOrderId: { in: [first.id, second.id] } } })).toBe(1);
    });
  });
});
