import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { GOODWILL_DAILY_CAP_PER_ADMIN, GOODWILL_GIFT_LABEL, GOODWILL_MAX_PER_GRANT } from '@tubutree/shared-types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { GOODWILL_AUDIT_ACTION, GoodwillCreditService } from '../../src/modules/loyalty/goodwill-credit.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { OrderStaffNoteService, ORDER_STAFF_NOTE_AUDIT_ACTION } from '../../src/modules/admin/order-staff-note.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

const key = () => `it-${randCode(16)}`;

describe('Tặng thiện chí Điểm Xanh / Ví và ghi chú nội bộ đơn (w51-01, real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let goodwill: GoodwillCreditService;
  let notes: OrderStaffNoteService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService, GoodwillCreditService, OrderStaffNoteService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    goodwill = moduleRef.get(GoodwillCreditService);
    notes = moduleRef.get(OrderStaffNoteService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Số dư Ví == tổng sổ Ví, và không lô điểm nào lệch sổ (findPointsLotDrift rỗng). */
  async function expectLedgersBalanced(userId: string) {
    const [u, walletSum] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.walletTransaction.aggregate({ where: { userId }, _sum: { delta: true } }),
    ]);
    expect(u.walletBalance).toBe(walletSum._sum.delta ?? 0);
    expect(await findPointsLotDrift(prisma, [userId])).toEqual([]);
  }

  it('cùng Idempotency-Key bắn song song 6 lần: đúng một dòng sổ Ví, một dòng audit, các lần sau trả replayed với cùng entryId', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const customer = await createUser(prisma);
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => goodwill.grant(admin.id, customer.id, { kind: 'WALLET', amount: 50_000, reason: 'Giao trễ 3 ngày, xin lỗi khách' }, k)),
    );
    expect(new Set(results.map((r) => r.entryId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const [u, tx, audits] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: customer.id }, select: { walletBalance: true } }),
      prisma.walletTransaction.findMany({ where: { userId: customer.id } }),
      prisma.adminAuditLog.findMany({ where: { actorId: admin.id, action: GOODWILL_AUDIT_ACTION } }),
    ]);
    expect(u.walletBalance).toBe(50_000);
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: 'ADJUST', refType: 'GOODWILL', delta: 50_000, reason: GOODWILL_GIFT_LABEL });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ idempotencyKey: k, userId: customer.id, kind: 'WALLET', amount: 50_000, reason: 'Giao trễ 3 ngày, xin lỗi khách', entryId: tx[0]!.id });
    expect(audits[0]!.targetIds).toEqual([customer.id]);
    await expectLedgersBalanced(customer.id);
  });

  it('Điểm Xanh vào lô STANDARD có hạn, gắn mã đơn của khách; sổ điểm không lệch; lý do nội bộ không nằm ở dòng sổ khách thấy', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const customer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: customer.id, status: 'DELIVERED', code: `IT${randCode(8)}` });
    const r = await goodwill.grant(admin.id, customer.id, { kind: 'POINTS', amount: 30_000, reason: 'Hàng móp hộp, tặng bù điểm', orderCode: order.code }, key());
    expect(r).toMatchObject({ kind: 'POINTS', amount: 30_000, orderCode: order.code, replayed: false });
    const [u, rows, audit] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: customer.id }, select: { pointsBalance: true, pointsConvertedBalance: true, pointsMarketplaceBalance: true } }),
      prisma.pointsTransaction.findMany({ where: { userId: customer.id } }),
      prisma.adminAuditLog.findUniqueOrThrow({ where: { id: r.id } }),
    ]);
    expect(u).toEqual({ pointsBalance: 30_000, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lot: 'STANDARD', delta: 30_000, reason: `GOODWILL:${order.code}`, refType: 'GOODWILL' });
    expect(rows[0]!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 300 * 864e5);
    expect(rows[0]!.reason).not.toContain('móp');
    expect(audit.targetIds).toEqual([customer.id, order.id]);
    await expectLedgersBalanced(customer.id);
  });

  it('cùng khoá nhưng khác số tiền: 409, không ghi thêm', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const customer = await createUser(prisma);
    const k = key();
    await goodwill.grant(admin.id, customer.id, { kind: 'WALLET', amount: 10_000, reason: 'Khách chờ hàng lâu, xin lỗi' }, k);
    await expect(goodwill.grant(admin.id, customer.id, { kind: 'WALLET', amount: 20_000, reason: 'Khách chờ hàng lâu, xin lỗi' }, k)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.walletTransaction.count({ where: { userId: customer.id } })).toBe(1);
  });

  it('trần ngày theo người tặng: cộng điểm và tiền chung; bắn song song không vượt trần; người tặng khác vẫn tặng được', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const other = await createUser(prisma, { role: 'ADMIN' });
    const customer = await createUser(prisma);
    const per = GOODWILL_MAX_PER_GRANT;
    const attempts = Math.floor(GOODWILL_DAILY_CAP_PER_ADMIN / per) + 3;
    const settled = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        goodwill.grant(admin.id, customer.id, { kind: i % 2 ? 'POINTS' : 'WALLET', amount: per, reason: `Đền bù sự cố lần ${i + 1}` }, key()),
      ),
    );
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(ok).toHaveLength(GOODWILL_DAILY_CAP_PER_ADMIN / per);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((r.reason as Error).message).toContain('Vượt trần tặng trong ngày');
    }
    const audits = await prisma.adminAuditLog.findMany({ where: { actorId: admin.id, action: GOODWILL_AUDIT_ACTION }, select: { payload: true } });
    expect(audits.reduce((s, a) => s + (a.payload as { amount: number }).amount, 0)).toBe(GOODWILL_DAILY_CAP_PER_ADMIN);
    await expect(goodwill.grant(other.id, customer.id, { kind: 'WALLET', amount: 1_000, reason: 'Quản trị viên khác bù thêm' }, key())).resolves.toMatchObject({ replayed: false });
    const list = await goodwill.list(admin.id, customer.id);
    expect(list.dailyUsed).toBe(GOODWILL_DAILY_CAP_PER_ADMIN);
    expect(list.items).toHaveLength(GOODWILL_DAILY_CAP_PER_ADMIN / per + 1);
    expect(list.items[0]).toMatchObject({ actorId: other.id, amount: 1_000, reason: 'Quản trị viên khác bù thêm' });
    await expectLedgersBalanced(customer.id);
  });

  it('chặn: quá trần một lần, lý do ngắn, tự tặng, tặng nhân viên/quản trị, đơn của người khác; không ghi gì', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const staff = await createUser(prisma, { role: 'STAFF', staffPermissions: ['CSKH'] });
    const customer = await createUser(prisma);
    const stranger = await createUser(prisma);
    const foreignOrder = await createOrder(prisma, { userId: stranger.id, code: `IT${randCode(8)}` });
    const reason = 'Lý do đủ dài để qua kiểm';
    await expect(goodwill.grant(admin.id, customer.id, { kind: 'WALLET', amount: GOODWILL_MAX_PER_GRANT + 1, reason }, key())).rejects.toBeInstanceOf(BadRequestException);
    await expect(goodwill.grant(admin.id, customer.id, { kind: 'WALLET', amount: 1_000, reason: 'ngắn' }, key())).rejects.toBeInstanceOf(BadRequestException);
    await expect(goodwill.grant(admin.id, admin.id, { kind: 'WALLET', amount: 1_000, reason }, key())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(goodwill.grant(admin.id, staff.id, { kind: 'POINTS', amount: 1_000, reason }, key())).rejects.toBeInstanceOf(BadRequestException);
    await expect(goodwill.grant(admin.id, customer.id, { kind: 'POINTS', amount: 1_000, reason, orderCode: foreignOrder.code }, key())).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.adminAuditLog.count({ where: { actorId: admin.id, action: GOODWILL_AUDIT_ACTION } })).toBe(0);
    expect(await prisma.walletTransaction.count({ where: { userId: { in: [customer.id, staff.id, admin.id] } } })).toBe(0);
    expect(await prisma.pointsTransaction.count({ where: { userId: { in: [customer.id, staff.id, admin.id] } } })).toBe(0);
  });

  it('ghi chú nội bộ: hai người lưu cùng lúc trên cùng mốc → một người được, người kia 409; xoá chữ là xoá dòng; mỗi lần đổi một dòng audit', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const cskh = await createUser(prisma, { role: 'STAFF', staffPermissions: ['CSKH'] });
    const customer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: customer.id, status: 'CONFIRMED', code: `IT${randCode(8)}`, note: 'Giao giờ hành chính' });
    const settled = await Promise.allSettled([
      notes.save(admin.id, order.code, 'Gói thêm xốp, khách báo lần trước vỡ', null),
      notes.save(cskh.id, order.id, 'Gọi khách trước khi giao', null),
    ]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const lost = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(lost?.reason).toBeInstanceOf(ConflictException);
    const saved = await prisma.orderStaffNote.findUniqueOrThrow({ where: { orderId: order.id } });
    // Lời khách giữ nguyên ở orders.note.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { note: true } })).note).toBe('Giao giờ hành chính');

    const same = await notes.save(admin.id, order.id, saved.note, saved.updatedAt.toISOString());
    expect(same.changed).toBe(false);
    const cleared = await notes.save(admin.id, order.id, '', saved.updatedAt.toISOString());
    expect(cleared).toMatchObject({ changed: true, staffNote: null });
    expect(await prisma.orderStaffNote.count({ where: { orderId: order.id } })).toBe(0);
    const audits = await prisma.adminAuditLog.findMany({ where: { action: ORDER_STAFF_NOTE_AUDIT_ACTION, targetIds: { has: order.id } }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => (a.payload as { after: string | null }).after)).toEqual([saved.note, null]);
  });

  it('ghi chú nội bộ: đơn đã giao bị từ chối', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const customer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: customer.id, status: 'DELIVERED', code: `IT${randCode(8)}` });
    await expect(notes.save(admin.id, order.id, 'Muộn rồi', null)).rejects.toBeInstanceOf(BadRequestException);
  });
});
