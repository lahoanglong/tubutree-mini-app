import type { HttpException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Gửi mã đơn sàn khi mã đó đang có người khác chờ (extsearch), trên Postgres THẬT: người gửi sau không được nghe "đang tìm" vì mã của họ
 * không bao giờ được tìm tiếp (chỉ lần chờ của người gửi trước được tìm lại).
 */
describe('Gửi mã khi người khác đang chờ cùng mã (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const lookup = { lookupAndIngest: jest.fn(async () => false) };
  const service = () => new ExternalClaimService(prisma, new SystemConfigService(prisma), lookup as never, { notify: jest.fn(async () => undefined) } as never);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });
  beforeEach(async () => {
    restore.push(await pinConfig(prisma, 'loyalty.marketplace_claim_enabled', true));
    restore.push(await pinConfig(prisma, 'loyalty.point_expire_months', 12));
  });
  afterEach(async () => {
    for (const r of restore.splice(0).reverse()) await r();
  });
  afterAll(async () => {
    const claimIds = (await prisma.externalPointsClaim.findMany({ where: { OR: [{ userId: { in: userIds } }, { externalOrderId: { in: orderIds } }] }, select: { id: true } })).map((c) => c.id);
    await prisma.externalClaimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.externalClaimAttempt.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { id: { in: claimIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function mkUser() {
    const u = await createUser(prisma, { phone: phone(), zaloId: `zalo_${randCode(10)}` });
    userIds.push(u.id);
    return u;
  }
  const codeOf = (e: unknown) => ((e as HttpException).getResponse() as { code: string }).code;
  const rejectCode = async (p: Promise<unknown>): Promise<string | null> => {
    try {
      await p;
      return null;
    } catch (e) {
      return codeOf(e);
    }
  };

  it('A chờ mã X (chưa có đơn), B gửi cùng mã: B nhận CLAIMED_BY_OTHER, không lộ A, có attempt NOT_FOUND để CSKH thấy; A gửi lại vẫn SEARCHING', async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const code = `EXS${randCode(10)}`;
    expect((await service().submit(a.id, code)).status).toBe('SEARCHING');
    const res = await service().submit(b.id, code);
    expect(res.status).toBe('CLAIMED_BY_OTHER');
    expect(res.claimId).toBeNull();
    expect(res.message).toContain('một tài khoản khác');
    expect(res.message).not.toContain(a.id);
    expect(res.message).not.toContain(a.phone!);
    const attempts = await prisma.externalClaimAttempt.findMany({ where: { code }, orderBy: { createdAt: 'asc' } });
    expect(attempts.map((x) => [x.userId, x.result])).toEqual([[a.id, 'UNMATCHED'], [b.id, 'NOT_FOUND']]);
    expect((await service().submit(a.id, code)).status).toBe('SEARCHING');
    expect(await prisma.externalClaimAttempt.count({ where: { code } })).toBe(2);
  });

  it('B gửi lại mã đang chờ của A nhiều lần: vẫn CLAIMED_BY_OTHER mỗi lần', async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const code = `EXS${randCode(10)}`;
    await service().submit(a.id, code);
    expect((await service().submit(b.id, code)).status).toBe('CLAIMED_BY_OTHER');
    expect((await service().submit(b.id, code)).status).toBe('CLAIMED_BY_OTHER');
  });

  it('A đã có claim (đơn đã khớp, PENDING hoặc CREDITED): B bị từ chối ALREADY_CLAIMED, không phải SEARCHING (hành vi sẵn có)', async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const code = `EXS${randCode(10)}`;
    const now = new Date();
    const order = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `EXS${randCode(10)}`, source: 'MARKETPLACE', channel: 'shopee', sourceKey: '-3|it|-3', trackingCode: code, trackingCodes: [code],
        goodsValue: 200_000, pancakeStatus: 3, status: 'DELIVERED', deliveredAt: new Date(now.getTime() - DAY), pancakeInsertedAt: new Date(now.getTime() - 3 * DAY), pancakeUpdatedAt: now, lastPayload: {},
      },
    });
    orderIds.push(order.id);
    expect((await service().submit(a.id, code)).status).toBe('CLAIMED');
    expect(await rejectCode(service().submit(b.id, code))).toBe('ALREADY_CLAIMED');
    await prisma.externalPointsClaim.updateMany({ where: { externalOrderId: order.id }, data: { state: 'CREDITED', creditedAt: now } });
    expect(await rejectCode(service().submit(b.id, code))).toBe('ALREADY_CLAIMED');
  });

  const adminSvc = () => new ExternalClaimsAdminService(prisma, new SystemConfigService(prisma), { notify: jest.fn(async () => undefined) } as never, service());
  const ageAttempts = (code: string, userId: string, days: number) =>
    prisma.externalClaimAttempt.updateMany({ where: { code, userId }, data: { createdAt: new Date(Date.now() - days * DAY) } });
  const openAttempts = (code: string) => prisma.externalClaimAttempt.findMany({ where: { code, result: 'UNMATCHED', resolvedAt: null } });

  describe('review: nguồn UNKNOWN, CSKH thấy người gửi sau, lượt chờ quá hạn, khe đua', () => {
    async function unknownOrder(code: string) {
      const now = new Date();
      const o = await prisma.externalOrder.create({
        data: {
          pancakeOrderId: `EXU${randCode(10)}`, source: 'UNKNOWN', channel: null, sourceKey: 'x|y|z', trackingCode: code, trackingCodes: [code],
          goodsValue: 200_000, pancakeStatus: 3, status: 'DELIVERED', deliveredAt: new Date(now.getTime() - DAY), pancakeInsertedAt: new Date(now.getTime() - 3 * DAY), pancakeUpdatedAt: now, lastPayload: {},
        } as never,
      });
      orderIds.push(o.id);
    }

    it('N1: đơn nguồn UNKNOWN, A đang chờ, B gửi cùng mã: B nhận CLAIMED_BY_OTHER, không phải REVIEW "không cần làm gì"', async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const code = `EXU${randCode(10)}`;
      await unknownOrder(code);
      expect((await service().submit(a.id, code)).status).toBe('REVIEW');
      const res = await service().submit(b.id, code);
      expect(res.status).toBe('CLAIMED_BY_OTHER');
      expect(res.message).not.toContain('không cần làm gì');
    });

    it('N2: dòng chờ của A trong danh sách admin có otherSubmitters (tên, SĐT che, giờ gửi) và số lượng; B không có dòng riêng', async () => {
      const a = await mkUser();
      const b = await createUser(prisma, { phone: phone(), zaloId: `zalo_${randCode(10)}`, fullName: 'Chi Bich' });
      userIds.push(b.id);
      const code = `EXU${randCode(10)}`;
      await unknownOrder(code);
      await service().submit(a.id, code);
      await service().submit(b.id, code);
      const list = await adminSvc().listAttempts(1, 200);
      const rowA = list.data.find((r) => r.userId === a.id)!;
      expect(rowA.otherSubmittersCount).toBe(1);
      expect(rowA.otherSubmitters).toHaveLength(1);
      expect(rowA.otherSubmitters![0]).toMatchObject({ userId: b.id, userName: 'Chi Bich', userPhoneMasked: `${b.phone!.slice(0, 3)}****${b.phone!.slice(-3)}` });
      expect(typeof rowA.otherSubmitters![0]!.createdAt).toBe('string');
      expect(list.data.some((r) => r.userId === b.id)).toBe(false);
    });

    it('N3a: A gửi lại khi lượt chờ đã quá 3 ngày: lượt cũ đóng, mở lượt mới, trả SEARCHING', async () => {
      const a = await mkUser();
      const code = `EXS${randCode(10)}`;
      await service().submit(a.id, code);
      await ageAttempts(code, a.id, 4);
      const old = (await openAttempts(code))[0]!;
      expect((await service().submit(a.id, code)).status).toBe('SEARCHING');
      const open = await openAttempts(code);
      expect(open).toHaveLength(1);
      expect(open[0]!.id).not.toBe(old.id);
      const closed = await prisma.externalClaimAttempt.findUniqueOrThrow({ where: { id: old.id } });
      expect(closed.resolvedAt).not.toBeNull();
    });

    it('C1: B gửi khi lượt chờ của A đã quá hạn: B nhận CLAIMED_BY_OTHER, lượt A vẫn mở và nằm trong "Cần xử lý" kèm B ở otherSubmitters', async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const code = `EXS${randCode(10)}`;
      await service().submit(a.id, code);
      await ageAttempts(code, a.id, 4);
      expect((await service().submit(b.id, code)).status).toBe('CLAIMED_BY_OTHER');
      const open = await openAttempts(code);
      expect(open.map((x) => x.userId)).toEqual([a.id]);
      const attempts = await prisma.externalClaimAttempt.findMany({ where: { code, userId: b.id } });
      expect(attempts.map((x) => x.result)).toEqual(['NOT_FOUND']);
      const list = (await adminSvc().listAttempts(1, 500)).data;
      const rowA = list.find((r) => r.userId === a.id)!;
      expect(rowA.otherSubmitters!.map((x) => x.userId)).toEqual([b.id]);
      expect(list.some((r) => r.userId === b.id)).toBe(false);
      expect((await service().submit(b.id, code)).status).toBe('CLAIMED_BY_OTHER');
    });

    it('Q1: đơn về sau khi B gửi (sàn che SĐT): claim không được ghép cho B, lượt của A không biến mất, B không được báo', async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const code = `EXH${randCode(10)}`;
      await service().submit(a.id, code);
      await ageAttempts(code, a.id, 4);
      await service().submit(b.id, code);
      const now = new Date();
      const o = await prisma.externalOrder.create({
        data: {
          pancakeOrderId: `EXO${randCode(10)}`, source: 'MARKETPLACE', channel: 'shopee', sourceKey: '-3|it|-3', trackingCode: code, trackingCodes: [code],
          goodsValue: 200_000, pancakeStatus: 3, status: 'DELIVERED', deliveredAt: new Date(now.getTime() - DAY), pancakeInsertedAt: new Date(now.getTime() - 5 * DAY), pancakeUpdatedAt: now,
          lastPayload: {}, phone: null, phoneLast3: null,
        } as never,
      });
      orderIds.push(o.id);
      await service().rematchUnmatched(new Date());
      expect(await prisma.externalPointsClaim.count({ where: { externalOrderId: o.id, userId: b.id } })).toBe(0);
      expect((await openAttempts(code)).map((x) => x.userId)).toEqual([a.id]);
      expect((await adminSvc().listAttempts(1, 500)).data.some((r) => r.userId === a.id)).toBe(true);
    });
  });
});
