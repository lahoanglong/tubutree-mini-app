import type { HttpException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { applyStatusToClaim } from '../../src/modules/external-points/external-claim-status';
import { releaseClaim, releaseDueClaims } from '../../src/modules/external-points/external-claim-release';
import { advisoryUserLock } from '../../src/modules/external-points/external-claim.service';
import { externalPointsAttentionCount } from '../../src/modules/external-points/external-points-attention';
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
  const releaseOpts = (monthlyPointsCap: number) => ({ pendingDays: 14, expiryMonths: 12, reviewAboveVnd: 2_000_000, monthlyPointsCap });
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
    it('điểm tính lại vượt trần tháng còn lại: cộng ở mức chốt 3.000 (không REVIEW)', async () => {
      const restoreCap = await pinConfig(prisma, 'loyalty.marketplace_claim_monthly_points_cap', 3_000);
      try {
        const user = await mkUser();
        const order = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 200_000 });
        const claim = await prisma.externalPointsClaim.create({
          data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: order.code, dayKey: '2026-10-20' },
        });
        await prisma.externalOrder.update({ where: { id: order.id }, data: { goodsValue: 400_000 } });
        await releaseDueClaims(prisma, cfg(), { notify });
        expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'CREDITED', points: 3_000 });
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

  describe('review lượt 2', () => {
    it('N1: CSKH mở lại claim của C rồi tự duyệt claim của người quen F: F vào REVIEW (kể cả đơn không có 3 số cuối) và X không duyệt được', async () => {
      const c = await mkUser();
      const f = await mkUser();
      const order = await mkOrder();
      const first = await svc().submit(c.id, order.code);
      await adm().voidClaim(first.claimId!, 'cskh-x', 'nhầm khách', true);
      const again = await svc().submit(f.id, order.code);
      expect(again.status).toBe('REVIEW');
      const claim = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: first.claimId! } });
      expect(claim).toMatchObject({ state: 'REVIEW', userId: f.id });
      expect(claim.reviewReason).toContain('mở lại');
      expect(await codeOf(adm().approve(claim.id, 'cskh-x'))).toBe('SAME_INTRODUCER');
      expect(await codeOf(adm().approve(claim.id, 'cskh-y'))).toBe('OK');
    });
    it('N2: gửi mã hoặc gắn vào đơn PARTIAL_RETURN thì claim vào REVIEW, duyệt đặt releaseAt', async () => {
      const u = await mkUser();
      const o = await mkOrder({ status: 'PARTIAL_RETURN', pancakeStatus: 15, deliveredAt: new Date(Date.now() - 30 * DAY) });
      const r = await svc().submit(u.id, o.code);
      expect(r.status).toBe('REVIEW');
      expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { externalOrderId: o.id } })).state).toBe('REVIEW');
      const u2 = await mkUser();
      const o2 = await mkOrder({ status: 'PARTIAL_RETURN', pancakeStatus: 15 });
      const att = await unmatchedAttempt(u2.id, o2.code);
      expect((await adm().attach(att.id, o2.pancakeOrderId, STAFF, undefined)).state).toBe('REVIEW');
      await adm().approve(r.claimId!, ADMIN.id);
      expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).releaseAt).not.toBeNull();
    });
    it('N2: lưới an toàn: claim PENDING không bao giờ tới hạn (đơn kẹt RETURNING quá 60 ngày, DELIVERED thiếu deliveredAt, PARTIAL_RETURN không ai duyệt) hiện ở Cần xử lý', async () => {
      const before = await externalPointsAttentionCount(prisma, new Date());
      const shapes: Record<string, unknown>[] = [
        { status: 'RETURNING', pancakeStatus: 4 },
        { status: 'DELIVERED', pancakeStatus: 3, deliveredAt: null },
        { status: 'PARTIAL_RETURN', pancakeStatus: 15 },
      ];
      for (const shape of shapes) {
        const u = await mkUser();
        const o = await mkOrder(shape);
        await prisma.externalPointsClaim.create({
          data: { externalOrderId: o.id, userId: u.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: o.code, dayKey: '2026-08-01', createdAt: new Date(Date.now() - 70 * DAY) },
        });
      }
      expect((await externalPointsAttentionCount(prisma, new Date())) - before).toBe(3);
    });
    it('N3: tiền hàng tăng làm vượt trần tháng: cộng ở mức chốt min(mới, đã kiểm + phần trần còn lại), có nhật ký', async () => {
      const r1 = await pinConfig(prisma, 'loyalty.marketplace_claim_monthly_points_cap', 20_000);
      const r2 = await pinConfig(prisma, 'loyalty.marketplace_claim_review_above_vnd', 5_000_000);
      try {
        const u = await mkUser();
        const o = await mkOrder({ goodsValue: 1_900_000 });
        const r = await svc().submit(u.id, o.code);
        expect(r.status).toBe('CLAIMED');
        await prisma.externalOrder.update({ where: { id: o.id }, data: { goodsValue: 2_100_000, status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) } });
        await releaseDueClaims(prisma, cfg(), { notify });
        expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'CREDITED', points: 20_000 });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pointsBalance).toBe(20_000);
        const credit = (await events(r.claimId!)).find((e) => e.action === 'CREDIT');
        expect(credit?.note).toContain('trần');
      } finally {
        await r2();
        await r1();
      }
    });
    it('N3: duyệt ở mức chốt thay vì ném MONTHLY_CAP; hết chỗ trần thì mới từ chối', async () => {
      const r1 = await pinConfig(prisma, 'loyalty.marketplace_claim_monthly_points_cap', 20_000);
      try {
        const u = await mkUser();
        const o = await mkOrder({ goodsValue: null });
        const r = await svc().submit(u.id, o.code);
        expect(r.status).toBe('REVIEW');
        await prisma.externalOrder.update({ where: { id: o.id }, data: { goodsValue: 3_000_000 } });
        await adm().approve(r.claimId!, ADMIN.id);
        expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'PENDING', points: 20_000, creditedGoodsValue: 3_000_000 });
        await prisma.externalOrder.update({ where: { id: o.id }, data: { status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) } });
        const released = await releaseClaim(prisma, r.claimId!, releaseOpts(20_000));
        expect(released).toMatchObject({ outcome: 'CREDITED', points: 20_000, userId: u.id });
        expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'CREDITED', points: 20_000 });
        expect((await prisma.pointsTransaction.findMany({ where: { userId: u.id, refId: r.claimId! } })).map((t) => t.delta)).toEqual([20_000]);
        const u2 = await mkUser();
        const full = await mkOrder({ goodsValue: null });
        await prisma.externalPointsClaim.create({
          data: { externalOrderId: (await mkOrder()).id, userId: u2.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 20_000, claimedCode: 'FILL1', dayKey: '2026-10-20' },
        });
        const r2 = await svc().submit(u2.id, full.code);
        await prisma.externalOrder.update({ where: { id: full.id }, data: { goodsValue: 200_000 } });
        expect(await codeOf(adm().approve(r2.claimId!, ADMIN.id))).toBe('MONTHLY_CAP');
      } finally {
        await r1();
      }
    });
    it('N3: tiền hàng tăng cao hơn mức đã duyệt trước khi cộng: về REVIEW đúng một lần, duyệt lại thì cộng', async () => {
      const r1 = await pinConfig(prisma, 'loyalty.marketplace_claim_monthly_points_cap', 20_000);
      try {
        const u = await mkUser();
        const o = await mkOrder({ goodsValue: null });
        const r = await svc().submit(u.id, o.code);
        expect(r.status).toBe('REVIEW');
        await prisma.externalOrder.update({ where: { id: o.id }, data: { goodsValue: 3_000_000, status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) } });
        await adm().approve(r.claimId!, ADMIN.id);
        await prisma.externalOrder.update({ where: { id: o.id }, data: { goodsValue: 4_000_000 } });
        expect(await releaseClaim(prisma, r.claimId!, releaseOpts(20_000))).toMatchObject({ outcome: 'TO_REVIEW', points: 0 });
        expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'REVIEW', reviewReason: 'Tiền hàng tăng vượt ngưỡng tự duyệt' });
        await adm().approve(r.claimId!, ADMIN.id);
        expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'PENDING', creditedGoodsValue: 4_000_000 });
        expect(await releaseClaim(prisma, r.claimId!, releaseOpts(20_000))).toMatchObject({ outcome: 'CREDITED', points: 20_000 });
        expect((await events(r.claimId!)).filter((e) => e.action === 'TO_REVIEW')).toHaveLength(1);
      } finally {
        await r1();
      }
    });
    it('N3: claim đơn sàn chưa từng được duyệt (không có mốc tiền hàng đã duyệt): tiền hàng tăng vượt ngưỡng vẫn về REVIEW như trước', async () => {
      const u = await mkUser();
      const o = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 200_000 });
      const claim = await prisma.externalPointsClaim.create({
        data: { externalOrderId: o.id, userId: u.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: o.code, dayKey: '2026-10-20', decidedById: ADMIN.id },
      });
      await prisma.externalOrder.update({ where: { id: o.id }, data: { goodsValue: 3_000_000 } });
      expect(await releaseClaim(prisma, claim.id, releaseOpts(200_000))).toMatchObject({ outcome: 'TO_REVIEW' });
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'REVIEW', reviewReason: 'Tiền hàng tăng vượt ngưỡng tự duyệt', creditedGoodsValue: null });
    });
    it('C5: hai đơn sàn khác order_sn dùng chung một vận đơn: đơn thứ hai không bị chặn nhầm', async () => {
      const u = await mkUser();
      const shared = `SH${randCode(10)}`;
      const sn1 = `SN${randCode(10)}`;
      const sn2 = `SN${randCode(10)}`;
      await mkOrder({ trackingCode: shared, trackingCodes: [shared, sn1], marketplaceOrderSn: sn1 });
      await mkOrder({ trackingCode: shared, trackingCodes: [shared, sn2], marketplaceOrderSn: sn2 });
      expect(await codeOf(svc().submit(u.id, sn1))).toBe('OK');
      expect(await codeOf(svc().submit(u.id, sn2))).toBe('OK');
    });
    it('forbidSelf quy qua mergedIntoId: người làm là user gốc của chủ claim cũng bị chặn', async () => {
      const root = await mkUser();
      const merged = await createUser(prisma, { phone: phone(), zaloId: `z_${randCode(10)}`, mergedIntoId: root.id });
      userIds.push(merged.id);
      const order = await mkOrder({ goodsValue: 3_000_000 });
      const r = await svc().submit(merged.id, order.code);
      expect(await codeOf(adm().voidClaim(r.claimId!, root.id, 'x', false))).toBe('SELF_ACTION');
      expect(await codeOf(adm().approve(r.claimId!, root.id))).toBe('SELF_ACTION');
    });
  });

  describe('review lượt 3', () => {
    it('R3: claim duyệt lúc đơn còn DELIVERED, sau đó đơn thành hoàn một phần: về REVIEW, cron không cộng', async () => {
      const u = await mkUser();
      const o = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 3_000_000 });
      const r = await svc().submit(u.id, o.code);
      expect(r.status).toBe('REVIEW');
      await adm().approve(r.claimId!, ADMIN.id);
      await prisma.externalOrder.update({ where: { id: o.id }, data: { status: 'PARTIAL_RETURN', pancakeStatus: 15 } });
      expect(await applyStatusToClaim(prisma, { notify }, cfg(), o.pancakeOrderId)).toBe('TO_REVIEW');
      await releaseDueClaims(prisma, cfg(), { notify }, new Date(Date.now() + 30 * DAY));
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'REVIEW' });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pointsBalance).toBe(0);
      // Duyệt lại lúc đơn đã hoàn một phần mới là quyết định cho đơn hoàn một phần: cộng được.
      await adm().approve(r.claimId!, 'cskh-z');
      await releaseDueClaims(prisma, cfg(), { notify }, new Date(Date.now() + 30 * DAY));
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'CREDITED' });
    });
    it('R3: webhook chưa tới mà cron chạy: claim duyệt trước khi hoàn một phần được kiểm lại, chuyển REVIEW thay vì cộng', async () => {
      const u = await mkUser();
      const o = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 3_000_000 });
      const r = await svc().submit(u.id, o.code);
      await adm().approve(r.claimId!, ADMIN.id);
      await prisma.externalOrder.update({ where: { id: o.id }, data: { status: 'PARTIAL_RETURN', pancakeStatus: 15 } });
      await releaseDueClaims(prisma, cfg(), { notify }, new Date(Date.now() + 30 * DAY));
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: r.claimId! } })).toMatchObject({ state: 'REVIEW' });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pointsBalance).toBe(0);
    });
    it('Nhỏ 1: cron cộng và duyệt chạy song song không chốt vượt trần tháng (40 vòng)', async () => {
      const restoreCap = await pinConfig(prisma, 'loyalty.marketplace_claim_monthly_points_cap', 20_000);
      try {
        const bad: string[] = [];
        for (let i = 0; i < 40; i++) {
          const u = await mkUser();
          const a = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 150_000 });
          const claimA = await prisma.externalPointsClaim.create({
            data: { externalOrderId: a.id, userId: u.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 10_000, claimedCode: a.code, dayKey: '2026-10-20' },
          });
          const b = await mkOrder({ goodsValue: 1_000_000 });
          const claimB = await prisma.externalPointsClaim.create({
            data: { externalOrderId: b.id, userId: u.id, kind: 'SCAN', state: 'REVIEW', ratePct: 1, multiplier: 1, points: 5_000, claimedCode: b.code, dayKey: '2026-10-20', reviewReason: 'x' },
          });
          const delay = i % 3;
          await Promise.all([
            releaseClaim(prisma, claimA.id, { pendingDays: 14, expiryMonths: 12, reviewAboveVnd: 2_000_000, monthlyPointsCap: 20_000 }),
            new Promise((r) => setTimeout(r, delay)).then(() => adm().approve(claimB.id, `cskh-${i}`)),
          ]);
          const rows = await prisma.externalPointsClaim.findMany({ where: { id: { in: [claimA.id, claimB.id] } } });
          const total = rows.reduce((n, c) => n + c.points, 0);
          if (total > 20_000) bad.push(`vòng ${i}: tổng ${total}`);
        }
        expect(bad).toEqual([]);
      } finally {
        await restoreCap();
      }
    });
    it('Nhỏ 1: releaseClaim chờ khoá advisory của khách (đang bị đường duyệt giữ) rồi mới cộng', async () => {
      const u = await mkUser();
      const a = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY), goodsValue: 100_000 });
      const claim = await prisma.externalPointsClaim.create({
        data: { externalOrderId: a.id, userId: u.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 1_000, claimedCode: a.code, dayKey: '2026-10-20' },
      });
      const holder = prisma.$transaction(async (tx) => {
        await advisoryUserLock(tx, u.id);
        await new Promise((r) => setTimeout(r, 1500));
      });
      await new Promise((r) => setTimeout(r, 300));
      const rel = releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 });
      const first = await Promise.race([rel.then(() => 'done'), new Promise((r) => setTimeout(() => r('blocked'), 800))]);
      expect(first).toBe('blocked');
      await holder;
      expect((await rel).outcome).toBe('CREDITED');
    });
    it('Nhỏ 3: danh sách admin lọc attention=closed_credited và stale đúng các dòng "Cần xử lý" đếm', async () => {
      const u1 = await mkUser();
      const o1 = await mkOrder({ status: 'CANCELLED', pancakeStatus: 6 });
      const closed = await prisma.externalPointsClaim.create({
        data: { externalOrderId: o1.id, userId: u1.id, kind: 'SCAN', state: 'CREDITED', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: o1.code, dayKey: '2026-10-20', creditedAt: new Date() },
      });
      const u2 = await mkUser();
      const o2 = await mkOrder({ status: 'RETURNING', pancakeStatus: 4 });
      const stale = await prisma.externalPointsClaim.create({
        data: { externalOrderId: o2.id, userId: u2.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: o2.code, dayKey: '2026-08-01', createdAt: new Date(Date.now() - 70 * DAY) },
      });
      const ids = async (attention: 'closed_credited' | 'stale') => (await adm().list({ page: 1, limit: 200, attention })).data.map((r) => r.id);
      expect(await ids('closed_credited')).toContain(closed.id);
      expect(await ids('closed_credited')).not.toContain(stale.id);
      expect(await ids('stale')).toContain(stale.id);
      expect(await ids('stale')).not.toContain(closed.id);
    });
  });
});
