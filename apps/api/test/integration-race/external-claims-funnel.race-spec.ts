import { randomUUID } from 'node:crypto';
import type { ExternalClaimKind, ExternalClaimState, OrderStatus, OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PHONE_MISMATCH_REVIEW_REASON } from '../../src/modules/external-points/external-claim.rules';
import { ATTACH_PHONE_MISMATCH_REASON } from '../../src/modules/external-points/external-claims-admin.service';
import { loadExternalClaimFunnel } from '../../src/modules/external-points/external-claims-funnel';
import { createOrder, createUser, deleteItData, randCode, warmPool } from './helpers';

const DAY = 864e5;
const HOUR = 36e5;

/**
 * Phễu đơn sàn → điểm → mua lại (GET /admin/external-claims/funnel) trên Postgres THẬT. Phễu đếm toàn bảng trong một kỳ, nên mỗi ca dựng
 * dữ liệu trong một kỳ riêng ở quá khứ xa (năm 2000–2009, cách nhau 200 ngày): dữ liệu của spec khác (quanh giờ chạy) và của ca khác không
 * lọt vào số đếm.
 */
describe('Phễu tích điểm đơn sàn (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const eventIds: string[] = [];
  const base = Date.UTC(2000 + Math.floor(Math.random() * 3), 0, 15, 5);
  let slot = 0;
  /** Lúc tính của ca tiếp theo: mỗi ca một kỳ 30 ngày riêng, không chồng nhau. */
  const nextNow = () => new Date(base + ++slot * 200 * DAY);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });
  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.externalClaimAttempt.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { externalOrderId: { in: orderIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { mergedIntoId: null } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  async function mkUser(over: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    const u = await createUser(prisma, { zaloId: `zalo_${randCode(10)}`, ...over });
    userIds.push(u.id);
    return u;
  }

  async function claim(o: {
    userId: string | null;
    at: Date;
    kind?: ExternalClaimKind;
    state?: ExternalClaimState;
    points?: number;
    creditedAt?: Date | null;
    reviewReason?: string | null;
  }) {
    const code = `SPX${randCode(10)}`;
    const ext = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `FUN${randCode(12)}`,
        source: o.kind === 'PHONE' ? 'CHAT' : 'MARKETPLACE',
        channel: o.kind === 'PHONE' ? null : 'shopee',
        sourceKey: o.kind === 'PHONE' ? 'ITCHAT|itacc|' : '-3',
        trackingCode: code,
        trackingCodes: [code],
        goodsValue: 300_000,
        status: 'DELIVERED',
        lastPayload: {},
      },
    });
    orderIds.push(ext.id);
    const state = o.state ?? 'PENDING';
    return prisma.externalPointsClaim.create({
      data: {
        externalOrderId: ext.id,
        userId: o.userId,
        kind: o.kind ?? 'SCAN',
        state,
        ratePct: 5,
        multiplier: 1,
        points: o.points ?? 1_500,
        creditedAt: o.creditedAt === undefined ? (state === 'CREDITED' || state === 'REVERSED' ? o.at : null) : o.creditedAt,
        reviewReason: o.reviewReason ?? null,
        dayKey: o.at.toISOString().slice(0, 10),
        createdAt: o.at,
      },
    });
  }

  async function submitted(userId: string, at: Date, props: Record<string, unknown>) {
    const eventId = randomUUID();
    eventIds.push(eventId);
    await prisma.analyticsEvent.create({
      data: { eventId, eventName: 'ext_claim_submitted', userId, platform: 'system', occurredAt: at, props: props as Prisma.InputJsonValue },
    });
  }

  async function attempt(userId: string, at: Date, result: string) {
    await prisma.externalClaimAttempt.create({
      data: { userId, code: `SPX${randCode(10)}`, result, dayKey: at.toISOString().slice(0, 10), createdAt: at },
    });
  }

  async function order(userId: string, at: Date, o: { total?: number; status?: OrderStatus; platform?: string | null; type?: OrderType } = {}) {
    const row = await createOrder(prisma, {
      userId,
      createdAt: at,
      total: o.total ?? 400_000,
      status: o.status ?? 'CONFIRMED',
      type: o.type ?? 'RETAIL',
      platform: o.platform === undefined ? 'miniapp' : o.platform,
    });
    return row;
  }

  it('1. đếm đúng từng nhóm của phễu (lượt gửi, đơn khớp, SĐT lệch, chưa thấy đơn, chờ cộng, đã cộng, mua lại)', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const a = await mkUser();
    const b = await mkUser();
    const c = await mkUser();

    await submitted(a.id, t(20), { via: 'scan', result: 'CLAIMED' });
    await submitted(a.id, t(19), { via: 'scan', result: 'REVIEW' });
    await submitted(b.id, t(18), { via: 'typed', result: 'CLAIMED' });
    await submitted(b.id, t(17), { via: 'typed', result: 'REJECT_PHONE_MISMATCH' });
    await submitted(c.id, t(16), { result: 'SEARCHING' });

    await claim({ userId: a.id, at: t(20), state: 'CREDITED', points: 2_000, creditedAt: t(10) });
    await claim({ userId: a.id, at: t(19), state: 'REVIEW', points: 700, reviewReason: `${PHONE_MISMATCH_REVIEW_REASON}; Đơn giá trị lớn` });
    await claim({ userId: b.id, at: t(18), state: 'PENDING', points: 1_300 });
    await claim({ userId: b.id, at: t(18), state: 'CREDITED', points: 900, creditedAt: t(5), reviewReason: ATTACH_PHONE_MISMATCH_REASON });
    await claim({ userId: c.id, at: t(15), state: 'VOIDED', points: 400 });

    await attempt(c.id, t(16), 'UNMATCHED');
    await attempt(c.id, t(14), 'NOT_FOUND');
    await attempt(c.id, t(13), 'MATCHED');
    await attempt(b.id, t(17), 'REJECTED_PHONE_MISMATCH');

    await order(a.id, t(8), { total: 350_000, platform: 'miniapp' });
    await order(a.id, t(2), { total: 150_000, status: 'DELIVERED', platform: 'web' });
    await order(b.id, t(1), { total: 520_000, status: 'SHIPPING', platform: 'web' });
    await order(c.id, t(1), { total: 999_000 });

    const f = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f).toEqual({
      period: '30d',
      from: new Date(now.getTime() - 30 * DAY).toISOString(),
      to: now.toISOString(),
      submissions: { total: 5, scan: 2, typed: 2 },
      matchedOrders: 5,
      phoneMismatch: { rejected: 1, review: 2 },
      unmatched: 2,
      pending: { claims: 2, points: 2_000 },
      credited: { claims: 2, points: 2_900, users: 2 },
      converted: { users: 2, orders: 3, gmv: 1_020_000, rate: 1 },
    });
  });

  it('2. đơn đặt trước lần cộng đầu không tính là mua lại; đơn sau lần cộng đầu thì tính', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const u = await mkUser();
    await claim({ userId: u.id, at: t(20), state: 'CREDITED', creditedAt: t(10) });
    await claim({ userId: u.id, at: t(20), state: 'CREDITED', creditedAt: t(3) });
    await order(u.id, t(12));
    await order(u.id, new Date(t(10).getTime() - HOUR));
    await order(u.id, new Date(t(10).getTime() + HOUR), { total: 210_000 });

    const f = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f.credited).toEqual({ claims: 2, points: 3_000, users: 1 });
    expect(f.converted).toEqual({ users: 1, orders: 1, gmv: 210_000, rate: 1 });
  });

  it('3. đơn CANCELLED, RETURNED, PENDING_PAYMENT không tính; CONFIRMED/PACKED/SHIPPING/DELIVERED thì tính', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const u = await mkUser();
    const v = await mkUser();
    await claim({ userId: u.id, at: t(20), state: 'CREDITED', creditedAt: t(15) });
    await claim({ userId: v.id, at: t(20), state: 'CREDITED', creditedAt: t(15) });
    for (const status of ['CANCELLED', 'RETURNED', 'PENDING_PAYMENT'] as const) await order(v.id, t(5), { status, total: 777_000 });
    for (const status of ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const) await order(u.id, t(5), { status, total: 100_000 });

    const f = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f.credited.users).toBe(2);
    expect(f.converted).toEqual({ users: 1, orders: 4, gmv: 400_000, rate: 0.5 });
  });

  it('4. đơn đại lý và đơn chưa rõ nền tảng (platform NULL) không tính', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const u = await mkUser();
    await claim({ userId: u.id, at: t(20), state: 'CREDITED', creditedAt: t(15) });
    await order(u.id, t(5), { type: 'DEALER', platform: 'web' });
    await order(u.id, t(5), { platform: null });
    await order(u.id, t(5), { platform: 'pos' });

    const f = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f.credited.users).toBe(1);
    expect(f.converted).toEqual({ users: 0, orders: 0, gmv: 0, rate: 0 });
  });

  it('5. claim PHONE (đơn chat) không vào phễu ở bất kỳ nhóm nào', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const u = await mkUser();
    await claim({ userId: u.id, at: t(20), kind: 'PHONE', state: 'CREDITED', creditedAt: t(15) });
    await claim({ userId: u.id, at: t(20), kind: 'PHONE', state: 'PENDING' });
    await claim({ userId: u.id, at: t(20), kind: 'PHONE', state: 'REVIEW', reviewReason: PHONE_MISMATCH_REVIEW_REASON });
    await order(u.id, t(5));

    const f = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f.matchedOrders).toBe(0);
    expect(f.pending).toEqual({ claims: 0, points: 0 });
    expect(f.phoneMismatch.review).toBe(0);
    expect(f.credited).toEqual({ claims: 0, points: 0, users: 0 });
    expect(f.converted).toEqual({ users: 0, orders: 0, gmv: 0, rate: 0 });
  });

  it('6. tài khoản đã gộp chỉ đếm một lần; đơn của tài khoản cũ vẫn tính cho tài khoản đích', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const target = await mkUser();
    const merged = await mkUser({ mergedIntoId: target.id });
    const merged2 = await mkUser({ mergedIntoId: target.id });
    await claim({ userId: merged.id, at: t(25), state: 'CREDITED', creditedAt: t(20) });
    await claim({ userId: target.id, at: t(20), state: 'CREDITED', creditedAt: t(12) });
    await order(merged.id, t(18), { total: 120_000 });
    await order(target.id, t(6), { total: 80_000 });
    await order(merged2.id, t(4), { total: 50_000 });

    const f = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f.credited).toEqual({ claims: 2, points: 3_000, users: 1 });
    expect(f.converted).toEqual({ users: 1, orders: 3, gmv: 250_000, rate: 1 });
  });

  it('7. dữ liệu ngoài kỳ (trước mốc đầu, từ mốc cuối trở đi) không tính; đổi kỳ 90 ngày thì vào', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const u = await mkUser();
    const old = t(31);
    await submitted(u.id, old, { via: 'scan', result: 'REJECT_PHONE_MISMATCH' });
    await claim({ userId: u.id, at: old, state: 'CREDITED', creditedAt: old });
    await claim({ userId: u.id, at: old, state: 'PENDING' });
    await attempt(u.id, old, 'UNMATCHED');
    await order(u.id, t(5));
    // Đúng mốc cuối (không gồm): không tính ở kỳ nào.
    await submitted(u.id, now, { via: 'typed', result: 'CLAIMED' });
    await claim({ userId: u.id, at: now, state: 'CREDITED', creditedAt: now });
    await attempt(u.id, now, 'NOT_FOUND');

    const f30 = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f30).toMatchObject({
      submissions: { total: 0, scan: 0, typed: 0 },
      matchedOrders: 0,
      phoneMismatch: { rejected: 0, review: 0 },
      unmatched: 0,
      pending: { claims: 0, points: 0 },
      credited: { claims: 0, points: 0, users: 0 },
      converted: { users: 0, orders: 0, gmv: 0, rate: 0 },
    });

    const f90 = await loadExternalClaimFunnel(prisma, '90d', now);
    expect(f90).toMatchObject({
      period: '90d',
      submissions: { total: 1, scan: 1, typed: 0 },
      matchedOrders: 2,
      phoneMismatch: { rejected: 1, review: 0 },
      unmatched: 1,
      pending: { claims: 1, points: 1_500 },
      credited: { claims: 1, points: 1_500, users: 1 },
      converted: { users: 1, orders: 1, gmv: 400_000, rate: 1 },
    });
  });

  it('8. claim đã đảo (REVERSED) không tính là đã cộng, khách của nó không vào nhóm mua lại', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const u = await mkUser();
    const v = await mkUser();
    await claim({ userId: u.id, at: t(20), state: 'REVERSED', creditedAt: t(15) });
    await claim({ userId: v.id, at: t(20), state: 'CREDITED', creditedAt: t(15), points: 800 });
    await order(u.id, t(5), { total: 900_000 });
    await order(v.id, t(5), { total: 300_000 });

    const f = await loadExternalClaimFunnel(prisma, '30d', now);
    expect(f.matchedOrders).toBe(2);
    expect(f.credited).toEqual({ claims: 1, points: 800, users: 1 });
    expect(f.converted).toEqual({ users: 1, orders: 1, gmv: 300_000, rate: 1 });
  });

  it('9. lượt bị từ chối vì SĐT lệch đếm từ sự kiện phân tích (không tạo claim, không cần dòng attempt)', async () => {
    const now = nextNow();
    const t = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const u = await mkUser();
    const v = await mkUser();
    await submitted(u.id, t(3), { via: 'scan', result: 'REJECT_PHONE_MISMATCH', channel: 'shopee' });
    await submitted(u.id, t(2), { via: 'typed', result: 'REJECT_PHONE_MISMATCH', channel: 'tiktok' });
    await submitted(v.id, t(2), { via: 'scan', result: 'REJECT_CLOSED' });
    await submitted(v.id, t(1), { result: 'REJECT_PHONE_MISMATCH' });

    const f = await loadExternalClaimFunnel(prisma, '7d', now);
    expect(f.submissions).toEqual({ total: 4, scan: 2, typed: 1 });
    expect(f.phoneMismatch).toEqual({ rejected: 3, review: 0 });
    expect(f.matchedOrders).toBe(0);
    expect(f.unmatched).toBe(0);
  });
});
