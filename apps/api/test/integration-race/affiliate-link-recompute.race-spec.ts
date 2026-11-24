import { randomBytes } from 'node:crypto';
import { ConflictException, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AffiliateLinkLedgerService, LINK_RECOMPUTE_ACTION, LINK_RECOMPUTE_LOCK_KEY } from '../../src/modules/affiliate/affiliate-link-ledger.service';
import { creditLinkForCommission, debitLinkForRejectedCommission, LINK_STATS_INT4_MAX } from '../../src/modules/affiliate/affiliate-link-stats';
import { createOrder, createUser, uniquePhone, warmPool } from './helpers';

const linkCode = () => `w29${randomBytes(5).toString('base64url')}`;

/**
 * Tính lại số đơn/doanh số link CTV từ sổ hoa hồng (tubu-w29-02) trên Postgres thật: xem trước không ghi, áp sửa đúng và gọi lại không ghi gì,
 * khoá advisory chặn lượt chồng (409), dòng link đang bị giao dịch khác giữ thì bỏ qua (BUSY) chứ không chờ, chạy song song với các giao dịch
 * cộng/trừ link thật (tạo hoa hồng, đảo hoa hồng) mà không mất lượt hay đếm đôi, và link chạm trần int4 được kẹp + báo.
 */
describe('Tính lại số link CTV từ sổ hoa hồng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ledger: AffiliateLinkLedgerService;
  let admin: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [AffiliateLinkLedgerService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    ledger = moduleRef.get(AffiliateLinkLedgerService);
    admin = await createUser(prisma, { role: 'ADMIN' });
    // DB dùng chung: spec khác để lại link lệch (đặt số tay). Dọn một lượt để các ca dưới chỉ thấy lệch của chính chúng.
    await ledger.recompute(admin.id, { dryRun: false });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function ctvWithLink() {
    const user = await createUser(prisma, { role: 'AFFILIATE', phone: uniquePhone('097') });
    const link = await prisma.affiliateLink.create({ data: { userId: user.id, shortCode: linkCode(), targetType: 'HOMEPAGE' } });
    return { user, link };
  }

  /** Đơn mang mã link + dòng hoa hồng (không đụng số link: dựng sổ trước, số link đặt riêng). */
  async function commission(ctvId: string, code: string, base: number, status: 'PENDING' | 'REJECTED' = 'PENDING') {
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, referrerUserId: ctvId, affiliateLinkCode: code, total: base });
    const c = await prisma.commission.create({
      data: { affiliateUserId: ctvId, orderId: order.id, orderTotal: base, commissionableTotal: base, rate: 10, amount: Math.floor(base / 10), status },
    });
    return { order, c };
  }

  /** Bất biến của affiliate-link-stats.ts: số link = đếm và cộng nền doanh số các dòng hoa hồng chưa REJECTED của đơn mang mã link, kẹp trần int4. */
  async function expectLinkMatchesLedger(linkId: string) {
    const link = await prisma.affiliateLink.findUniqueOrThrow({ where: { id: linkId } });
    const live = await prisma.commission.findMany({
      where: { affiliateUserId: link.userId, status: { not: 'REJECTED' }, order: { affiliateLinkCode: link.shortCode } },
      select: { commissionableTotal: true },
    });
    expect({ conversions: link.conversions, revenue: link.revenue }).toEqual({
      conversions: live.length,
      revenue: Math.min(live.reduce((s, c) => s + Math.max(0, c.commissionableTotal), 0), LINK_STATS_INT4_MAX),
    });
    return link;
  }

  it('xem trước: báo đúng số cũ → số đúng, không ghi gì; áp: sửa, ghi sổ thao tác; gọi lại: không còn gì để sửa', async () => {
    const { user, link } = await ctvWithLink();
    await commission(user.id, link.shortCode, 200_000);
    await commission(user.id, link.shortCode, 150_000);
    await commission(user.id, link.shortCode, 90_000, 'REJECTED');
    // Rollback image cũ: đơn huỷ đổi hoa hồng REJECTED mà không trừ link → link thừa 1 đơn / 90.000đ (và lệch thêm do sửa tay).
    await prisma.affiliateLink.update({ where: { id: link.id }, data: { conversions: 3, revenue: 440_000 } });

    const preview = await ledger.recompute(admin.id);
    expect(preview.dryRun).toBe(true);
    expect(preview.rows.find((r) => r.shortCode === link.shortCode)).toEqual({
      shortCode: link.shortCode,
      userId: user.id,
      conversions: { from: 3, to: 2 },
      revenue: { from: 440_000, to: 350_000 },
      trueRevenue: 350_000,
      saturated: false,
      status: 'WILL_FIX',
    });
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({ conversions: 3, revenue: 440_000 });

    const applied = await ledger.recompute(admin.id, { dryRun: false });
    expect(applied.rows.find((r) => r.shortCode === link.shortCode)).toMatchObject({ status: 'FIXED', conversions: { from: 3, to: 2 } });
    await expectLinkMatchesLedger(link.id);
    const audit = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: applied.auditLogId! } });
    expect(audit).toMatchObject({ actorId: admin.id, action: LINK_RECOMPUTE_ACTION, targetType: 'AFFILIATE_LINK' });
    expect(audit.targetIds).toContain(link.shortCode);

    const again = await ledger.recompute(admin.id, { dryRun: false });
    expect(again.rows.find((r) => r.shortCode === link.shortCode)).toBeUndefined();
    await expectLinkMatchesLedger(link.id);
  });

  it('link của CTV khác cùng mã đơn không được tính: chỉ dòng hoa hồng của đúng chủ link', async () => {
    const a = await ctvWithLink();
    const b = await ctvWithLink();
    // Đơn mang mã link của A nhưng hoa hồng ghi cho B (giả link chéo lọt qua dữ liệu cũ): không cộng vào link A.
    await commission(b.user.id, a.link.shortCode, 500_000);
    await prisma.affiliateLink.update({ where: { id: a.link.id }, data: { conversions: 1, revenue: 500_000 } });
    await ledger.recompute(admin.id, { dryRun: false });
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: a.link.id } })).toMatchObject({ conversions: 0, revenue: 0 });
  });

  it('lượt khác đang giữ khoá advisory → 409, không ghi gì', async () => {
    const { user, link } = await ctvWithLink();
    await commission(user.id, link.shortCode, 100_000);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LINK_RECOMPUTE_LOCK_KEY}))`;
      await expect(ledger.recompute(admin.id, { dryRun: false })).rejects.toBeInstanceOf(ConflictException);
    });
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({ conversions: 0, revenue: 0 });
    await ledger.recompute(admin.id, { dryRun: false });
    await expectLinkMatchesLedger(link.id);
  });

  it('dòng link đang bị giao dịch khác giữ: BUSY, không chờ và không ghi dòng đó; nhả khoá rồi chạy lại thì sửa', async () => {
    const { user, link } = await ctvWithLink();
    await commission(user.id, link.shortCode, 120_000);
    const started = Date.now();
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "affiliate_links" WHERE "id" = ${link.id} FOR UPDATE`;
        const res = await ledger.recompute(admin.id, { dryRun: false });
        expect(res.rows.find((r) => r.shortCode === link.shortCode)).toMatchObject({ status: 'BUSY' });
        expect(res.busy).toBeGreaterThanOrEqual(1);
      },
      { timeout: 20_000 },
    );
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({ conversions: 0, revenue: 0 });
    const res = await ledger.recompute(admin.id, { dryRun: false });
    expect(res.rows.find((r) => r.shortCode === link.shortCode)).toMatchObject({ status: 'FIXED' });
    await expectLinkMatchesLedger(link.id);
  });

  it('chạy song song với 10 giao dịch tạo hoa hồng + 4 giao dịch đảo hoa hồng và 3 lượt tính lại: không mất lượt, không đếm đôi', async () => {
    const { user, link } = await ctvWithLink();
    const toReverse = [];
    for (let i = 0; i < 4; i++) toReverse.push(await commission(user.id, link.shortCode, 80_000 + i * 1_000));
    // Số link lệch sẵn (như sau rollback) để lượt tính lại có việc làm giữa lúc các giao dịch kia chạy.
    await prisma.affiliateLink.update({ where: { id: link.id }, data: { conversions: 9, revenue: 9_999 } });
    const buyers = await Promise.all(Array.from({ length: 10 }, () => createUser(prisma)));
    const orders = await Promise.all(buyers.map((b, i) => createOrder(prisma, { userId: b.id, referrerUserId: user.id, affiliateLinkCode: link.shortCode, total: 100_000 + i })));

    // Như checkout: chèn dòng hoa hồng rồi mới cộng link trong cùng tx; nghỉ ngắn ở giữa để lượt tính lại chen vào đúng khe đó.
    const sale = (orderId: string, base: number) =>
      prisma.$transaction(async (tx) => {
        await tx.commission.create({ data: { affiliateUserId: user.id, orderId, orderTotal: base, commissionableTotal: base, rate: 10, amount: Math.floor(base / 10), status: 'PENDING' } });
        await tx.$executeRaw`SELECT pg_sleep(0.05)`;
        await creditLinkForCommission(tx, { orderId, affiliateUserId: user.id, commissionableTotal: base, affiliateLinkCode: link.shortCode });
      });
    // Như huỷ đơn: đổi REJECTED dưới khoá dòng hoa hồng rồi mới trừ link.
    const reverse = (c: { id: string; orderId: string; commissionableTotal: number }) =>
      prisma.$transaction(async (tx) => {
        await tx.commission.update({ where: { id: c.id }, data: { status: 'REJECTED' } });
        await tx.$executeRaw`SELECT pg_sleep(0.05)`;
        await debitLinkForRejectedCommission(tx, { orderId: c.orderId, affiliateUserId: user.id, commissionableTotal: c.commissionableTotal, affiliateLinkCode: link.shortCode });
      });

    const results = await Promise.allSettled([
      ...orders.slice(0, 5).map((o, i) => sale(o.id, 100_000 + i)),
      ledger.recompute(admin.id, { dryRun: false }),
      ...toReverse.slice(0, 2).map(({ c }) => reverse(c)),
      ledger.recompute(admin.id, { dryRun: false }),
      ...orders.slice(5).map((o, i) => sale(o.id, 100_005 + i)),
      ...toReverse.slice(2).map(({ c }) => reverse(c)),
      ledger.recompute(admin.id, { dryRun: false }),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    }
    expect(results.filter((r) => r.status === 'rejected').length).toBeLessThanOrEqual(2);

    // Lượt tính lại nào bị 409 hay gặp dòng bận thì số lệch ban đầu có thể còn: chạy thêm một lượt khi mọi giao dịch đã xong.
    await ledger.recompute(admin.id, { dryRun: false });
    const final = await expectLinkMatchesLedger(link.id);
    expect(final.conversions).toBe(10);
    expect(final.revenue).toBe(Array.from({ length: 10 }, (_, i) => 100_000 + i).reduce((s, n) => s + n, 0));
    const preview = await ledger.recompute(admin.id);
    expect(preview.rows.find((r) => r.shortCode === link.shortCode)).toBeUndefined();
  });

  it('giao dịch tạo hoa hồng commit đúng khe giữa lúc đọc lệch và lúc khoá dòng: số ghi lại vẫn gồm phần của nó (đọc lại sau khoá)', async () => {
    const { user, link } = await ctvWithLink();
    await commission(user.id, link.shortCode, 100_000);
    await prisma.affiliateLink.update({ where: { id: link.id }, data: { conversions: 5, revenue: 5 } });
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, referrerUserId: user.id, affiliateLinkCode: link.shortCode, total: 70_000 });
    const sale = () =>
      prisma.$transaction(async (tx) => {
        await tx.commission.create({ data: { affiliateUserId: user.id, orderId: order.id, orderTotal: 70_000, commissionableTotal: 70_000, rate: 10, amount: 7_000, status: 'PENDING' } });
        await creditLinkForCommission(tx, { orderId: order.id, affiliateUserId: user.id, commissionableTotal: 70_000, affiliateLinkCode: link.shortCode });
      });
    // Chen giao dịch kia vào ngay trước câu khoá dòng của lượt áp (nó commit trên kết nối khác, dòng link chưa bị khoá).
    const realTx = prisma.$transaction.bind(prisma) as (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => Promise<unknown>;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, opts?: unknown) =>
      realTx(
        async (tx) =>
          fn(
            new Proxy(tx as object, {
              get(target, key) {
                const t = target as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> };
                if (key !== '$queryRaw') return Reflect.get(target, key);
                return async (strings: TemplateStringsArray, ...vals: unknown[]) => {
                  if (strings.join('?').includes('SKIP LOCKED')) await sale();
                  return t.$queryRaw(strings, ...vals);
                };
              },
            }),
          ),
        opts,
      )) as never);
    try {
      const res = await ledger.recompute(admin.id, { dryRun: false });
      expect(res.rows.find((r) => r.shortCode === link.shortCode)).toMatchObject({ status: 'FIXED', conversions: { from: 6, to: 2 }, revenue: { to: 170_000 } });
    } finally {
      spy.mockRestore();
    }
    expect(await expectLinkMatchesLedger(link.id)).toMatchObject({ conversions: 2, revenue: 170_000 });
  });

  it('chỉ giao dịch cộng/trừ (không tính lại) chạy song song trên cùng link: 12 lần cộng từ 12 đơn khác nhau không mất lượt', async () => {
    const { user, link } = await ctvWithLink();
    const buyers = await Promise.all(Array.from({ length: 12 }, () => createUser(prisma)));
    const orders = await Promise.all(buyers.map((b) => createOrder(prisma, { userId: b.id, referrerUserId: user.id, affiliateLinkCode: link.shortCode, total: 50_000 })));
    await Promise.all(
      orders.map((o) =>
        prisma.$transaction(async (tx) => {
          await tx.commission.create({ data: { affiliateUserId: user.id, orderId: o.id, orderTotal: 50_000, commissionableTotal: 50_000, rate: 10, amount: 5_000, status: 'PENDING' } });
          await creditLinkForCommission(tx, { orderId: o.id, affiliateUserId: user.id, commissionableTotal: 50_000, affiliateLinkCode: link.shortCode });
        }),
      ),
    );
    expect(await expectLinkMatchesLedger(link.id)).toMatchObject({ conversions: 12, revenue: 600_000 });
  });

  it('doanh số thật vượt trần int4: cộng link kẹp ở trần và cảnh báo ops; tính lại ghi trần, báo chạm trần, lượt sau AT_CAP không ghi', async () => {
    const { user, link } = await ctvWithLink();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const first = await commission(user.id, link.shortCode, 1_500_000_000);
      await prisma.$transaction((tx) => creditLinkForCommission(tx, { orderId: first.order.id, affiliateUserId: user.id, commissionableTotal: 1_500_000_000, affiliateLinkCode: link.shortCode }));
      const second = await commission(user.id, link.shortCode, 1_500_000_000);
      await prisma.$transaction((tx) => creditLinkForCommission(tx, { orderId: second.order.id, affiliateUserId: user.id, commissionableTotal: 1_500_000_000, affiliateLinkCode: link.shortCode }));
      expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({ conversions: 2, revenue: LINK_STATS_INT4_MAX });
      expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes(link.shortCode) && m.includes('vượt trần int4'))).toBe(true);

      // Trừ trên số đã kẹp làm số link thấp hơn thật (giảm cả phần không có trong cột): tính lại đưa về trần.
      await prisma.affiliateLink.update({ where: { id: link.id }, data: { revenue: 1_000_000_000 } });
      const fixed = await ledger.recompute(admin.id, { dryRun: false });
      expect(fixed.rows.find((r) => r.shortCode === link.shortCode)).toMatchObject({
        status: 'FIXED',
        saturated: true,
        trueRevenue: 3_000_000_000,
        revenue: { from: 1_000_000_000, to: LINK_STATS_INT4_MAX },
      });
      const again = await ledger.recompute(admin.id, { dryRun: false });
      expect(again.rows.find((r) => r.shortCode === link.shortCode)).toMatchObject({ status: 'AT_CAP', saturated: true });
      expect(await prisma.affiliateLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({ conversions: 2, revenue: LINK_STATS_INT4_MAX });
    } finally {
      warn.mockRestore();
    }
  });
});
