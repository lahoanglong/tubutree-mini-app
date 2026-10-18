import type { HttpException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
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
});
