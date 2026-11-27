import type { HttpException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { PHONE_CONFIRM_RESULTS, PHONE_CONFIRMED_NOTE } from '../../src/modules/external-points/external-claim.rules';
import { releaseClaim } from '../../src/modules/external-points/external-claim-release';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;

/**
 * W46 (PO A1): SĐT tài khoản khác SĐT trên đơn sàn thì khách xác nhận bằng 4 số cuối SĐT người nhận. Chạy trên Postgres thật: lần thử ghi
 * đúng kết quả, khoá 3 lần sai theo (khách, đơn) giữ được khi khách bấm song song (khoá advisory theo khách), claim xác nhận đúng vào
 * PENDING và tới hạn thì được cộng (không bị đưa về REVIEW vì SĐT lệch).
 */
describe('W46: xác nhận 4 số cuối SĐT người nhận (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const notify = jest.fn(async () => undefined);
  const lookup = { lookupAndIngest: jest.fn(async () => false) };
  const svc = () => new ExternalClaimService(prisma, new SystemConfigService(prisma), lookup as never, { notify, notifySafe: notify } as never);

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

  /** Khách có SĐT Zalo đã xác minh, đuôi `tail` (phần đầu ngẫu nhiên để không trùng unique). */
  async function mkUser(tail: string) {
    const u = await createUser(prisma, { phone: `09${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}${tail}`, zaloId: `z_${randCode(10)}` });
    userIds.push(u.id);
    return u;
  }
  async function mkOrder(over: Record<string, unknown>) {
    const code = `IT${randCode(10)}`;
    const now = new Date();
    const o = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `EXTW46${randCode(10)}`, source: 'MARKETPLACE', channel: 'shopee', sourceKey: '-3|it|-3', trackingCode: code, trackingCodes: [code],
        goodsValue: 200_000, pancakeStatus: 2, status: 'OPEN', pancakeInsertedAt: new Date(now.getTime() - DAY), pancakeUpdatedAt: now, lastPayload: {}, ...over,
      },
    });
    orderIds.push(o.id);
    return { ...o, code };
  }
  const outcome = async (p: Promise<unknown>): Promise<{ code: string; status: number; body: Record<string, unknown> }> => {
    try {
      const r = (await p) as { status: string };
      return { code: r.status, status: 200, body: r as unknown as Record<string, unknown> };
    } catch (e) {
      const body = (e as HttpException).getResponse() as Record<string, unknown>;
      return { code: String(body.code), status: (e as HttpException).getStatus(), body };
    }
  };

  it('1. SĐT khớp: PENDING ngay, chỉ một lần thử MATCHED', async () => {
    const user = await mkUser('26');
    const o = await mkOrder({ phoneMask: `0*${user.phone!.slice(-2)}` });
    expect((await outcome(svc().submit(user.id, o.code, 'scan'))).code).toBe('CLAIMED');
    expect(await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ state: 'PENDING', reviewReason: null });
    expect((await prisma.externalClaimAttempt.findMany({ where: { userId: user.id }, select: { result: true } })).map((a) => a.result)).toEqual(['MATCHED']);
  });

  it('2 + 3. Shopee 0*26, SĐT khách đuôi 11: REQUIRED (403, kèm shopee, không lộ số) → nhập 8326 → PENDING; lượt REQUIRED thôi tính khoá', async () => {
    const user = await mkUser('11');
    const o = await mkOrder({ phoneMask: '0*26' });
    const first = await outcome(svc().submit(user.id, o.code, 'scan'));
    expect(first).toMatchObject({ code: 'PHONE_CONFIRM_REQUIRED', status: 403, body: { channel: 'shopee', requiredDigits: 4 } });
    expect(JSON.stringify(first.body)).not.toContain('26');

    const second = await outcome(svc().submit(user.id, o.code, 'scan', '8326'));
    expect(second.code).toBe('CLAIMED');
    const claim = await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: user.id } });
    expect(claim).toMatchObject({ state: 'PENDING', reviewReason: null, externalOrderId: o.id });
    expect(await prisma.externalClaimEvent.findFirstOrThrow({ where: { claimId: claim.id } })).toMatchObject({ action: 'CLAIM_CREATED', note: PHONE_CONFIRMED_NOTE });
    const attempts = await prisma.externalClaimAttempt.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' }, select: { result: true, resolvedAt: true } });
    expect(attempts.map((a) => a.result)).toEqual([PHONE_CONFIRM_RESULTS.confirmed, 'MATCHED']);
    expect(attempts[0]!.resolvedAt).not.toBeNull();
  });

  it('4. Lazada số đầy đủ 0987654321: 9921 → WRONG còn 2 lượt; 4321 → PENDING', async () => {
    const user = await mkUser('33');
    const o = await mkOrder({ channel: 'lazada', sourceKey: '-4|it|-4', phone: '0987654321' });
    expect(await outcome(svc().submit(user.id, o.code, 'typed', '9921'))).toMatchObject({
      code: 'PHONE_CONFIRM_WRONG',
      status: 403,
      body: { channel: 'lazada', requiredDigits: 4, remainingAttempts: 2 },
    });
    expect((await outcome(svc().submit(user.id, o.code, 'typed', '4321'))).code).toBe('CLAIMED');
    expect(await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ state: 'PENDING', reviewReason: null });
  });

  it('5. 5 lần nhập sai song song cho một đơn: đúng 3 lần ghi sai (còn 2, còn 1, LOCKED), 2 lần LOCKED không ghi sai; lần thứ 6 nhập đúng vẫn LOCKED', async () => {
    const user = await mkUser('44');
    const o = await mkOrder({ channel: 'lazada', sourceKey: '-4|it|-4', phone: '0987654321' });
    const runs = await Promise.all(['1111', '2222', '3333', '5555', '6666'].map((d) => outcome(svc().submit(user.id, o.code, 'typed', d))));
    expect(runs.map((r) => r.code).sort()).toEqual(['PHONE_CONFIRM_LOCKED', 'PHONE_CONFIRM_LOCKED', 'PHONE_CONFIRM_LOCKED', 'PHONE_CONFIRM_WRONG', 'PHONE_CONFIRM_WRONG']);
    expect(runs.filter((r) => r.code === 'PHONE_CONFIRM_WRONG').map((r) => r.body.remainingAttempts).sort()).toEqual([1, 2]);
    expect(runs.filter((r) => r.code === 'PHONE_CONFIRM_LOCKED').every((r) => r.status === 429)).toBe(true);
    expect(await prisma.externalClaimAttempt.count({ where: { userId: user.id, externalOrderId: o.id, result: PHONE_CONFIRM_RESULTS.wrong } })).toBe(3);
    expect(await prisma.externalClaimAttempt.count({ where: { userId: user.id, externalOrderId: o.id, result: PHONE_CONFIRM_RESULTS.locked } })).toBe(2);

    expect((await outcome(svc().submit(user.id, o.code, 'typed', '4321'))).code).toBe('PHONE_CONFIRM_LOCKED');
    expect(await prisma.externalPointsClaim.count({ where: { userId: user.id } })).toBe(0);
  });

  it('khoá theo (khách, đơn): đơn khác của cùng khách vẫn xác nhận được; khách khác cùng đơn không bị khoá', async () => {
    const user = await mkUser('55');
    const other = await mkUser('66');
    const locked = await mkOrder({ channel: 'lazada', sourceKey: '-4|it|-4', phone: '0987654321' });
    for (const d of ['1111', '2222', '3333']) await outcome(svc().submit(user.id, locked.code, 'typed', d));
    expect((await outcome(svc().submit(user.id, locked.code, 'typed', '4321'))).code).toBe('PHONE_CONFIRM_LOCKED');
    const free = await mkOrder({ phoneMask: '0*26' });
    expect((await outcome(svc().submit(user.id, free.code, 'scan', '0026'))).code).toBe('CLAIMED');
    expect((await outcome(svc().submit(other.id, locked.code, 'typed', '4321'))).code).toBe('CLAIMED');
  });

  it('claim xác nhận bằng 4 số tới hạn thì được cộng vào lô MARKETPLACE, không bị đưa về REVIEW vì SĐT lệch', async () => {
    const user = await mkUser('77');
    const o = await mkOrder({ phoneMask: '0*26', status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) });
    await outcome(svc().submit(user.id, o.code, 'scan'));
    expect((await outcome(svc().submit(user.id, o.code, 'scan', '1226'))).code).toBe('CLAIMED');
    const claim = await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: user.id } });
    const runs = await Promise.allSettled(Array.from({ length: 2 }, () => releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 })));
    expect(runs.map((r) => (r as PromiseFulfilledResult<{ outcome: string }>).value.outcome).filter((x) => x === 'CREDITED')).toHaveLength(1);
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'CREDITED' });
    expect(await prisma.pointsTransaction.findMany({ where: { userId: user.id } })).toEqual([expect.objectContaining({ lot: 'MARKETPLACE', delta: 10_000, refId: claim.id })]);
  });

  it('claim SĐT lệch không có ghi chú xác nhận (khớp lúc gửi, khách đổi SĐT sau) vẫn về REVIEW lúc cộng như W42', async () => {
    const user = await mkUser('88');
    const o = await mkOrder({ phoneMask: `0*${user.phone!.slice(-2)}`, status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - 20 * DAY) });
    expect((await outcome(svc().submit(user.id, o.code, 'scan'))).code).toBe('CLAIMED');
    await prisma.user.update({ where: { id: user.id }, data: { phone: `09${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}99` } });
    const claim = await prisma.externalPointsClaim.findFirstOrThrow({ where: { userId: user.id } });
    expect((await releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 })).outcome).toBe('TO_REVIEW');
  });
});
