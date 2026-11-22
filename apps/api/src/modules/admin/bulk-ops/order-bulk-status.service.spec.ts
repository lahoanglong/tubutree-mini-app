import 'reflect-metadata';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { OrderStatus } from '@prisma/client';
import type { JwtPayload } from '@tubutree/shared-types';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { BulkOpsController, BulkOrderStatusDto } from './bulk-ops.controller';
import { BULK_STATUS_ACTION, BULK_STATUS_MAX, type BulkOrder } from './order-bulk-status';
import { OrderBulkStatusService } from './order-bulk-status.service';

const ADMIN = { sub: 'admin-1', role: 'ADMIN' } as JwtPayload;
const KHO = { sub: 'kho-1', role: 'STAFF', staffPermissions: ['KHO'] } as JwtPayload;
const CSKH = { sub: 'cskh-1', role: 'STAFF', staffPermissions: ['CSKH'] } as JwtPayload;

function order(code: string, patch: Partial<BulkOrder> = {}): BulkOrder {
  return {
    id: `id-${code}`,
    code,
    status: 'CONFIRMED',
    type: 'RETAIL',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    fulfiller: 'TUBU',
    pancakeOrderId: `pk-${code}`,
    shippingCode: null,
    shippingPartner: null,
    shippedAt: null,
    hasRecyclingPickup: false,
    gomdonStatus: null,
    gomdonOrderId: null,
    gomdonPartnerCode: null,
    ...patch,
  } as BulkOrder;
}

/** Bộ đơn cố định: mỗi đơn chạm một luật của bảng chuyển trạng thái. */
const OK1 = order('TB0001');
const OK2 = order('TB0002');
const PACKED = order('TB0003', { status: 'PACKED' });
const DELIVERED = order('TB0004', { status: 'DELIVERED' });
const WAYBILL = order('TB0005', { shippingCode: 'GHN123', shippingPartner: 'GHN' });
const UNPAID_PREPAID = order('TB0006', { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
const DEALER_CREDIT = order('TB0007', { status: 'PENDING_PAYMENT', type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
const ALL = [OK1, OK2, PACKED, DELIVERED, WAYBILL, UNPAID_PREPAID, DEALER_CREDIT];

function setup(rows: BulkOrder[] = ALL, opts: { auditFails?: boolean; credit?: string[]; changedMeanwhile?: Record<string, OrderStatus> } = {}) {
  const prisma = {
    order: {
      findMany: jest.fn(async ({ where }: { where: { OR: [{ id: { in: string[] } }, { code: { in: string[] } }] } }) => {
        const keys = new Set([...where.OR[0].id.in, ...where.OR[1].code.in]);
        return rows.filter((r) => keys.has(r.id) || keys.has(r.code));
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? { status: opts.changedMeanwhile?.[row.code] ?? row.status } : null;
      }),
    },
    dealerCreditLedger: { findMany: jest.fn().mockResolvedValue((opts.credit ?? []).map((refId) => ({ refId }))) },
    adminAuditLog: {
      create: opts.auditFails ? jest.fn().mockRejectedValue(new Error('db down')) : jest.fn().mockResolvedValue({ id: 'audit-7' }),
    },
  };
  const admin = { changeOrderStatus: jest.fn().mockResolvedValue({ order: {}, changed: true }) };
  return { prisma, admin, svc: new OrderBulkStatusService(prisma as never, admin as never) };
}

const dtoErrors = (plain: object) =>
  validateSync(plainToInstance(BulkOrderStatusDto, plain), { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) => Object.values(e.constraints ?? {}));

describe('BulkOrderStatusDto: trần 50 mã và chỉ hai đích an toàn', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `TB${String(i).padStart(4, '0')}`);

  it('50 mã qua, 51 mã bị chặn 400 với câu tiếng Việt', () => {
    expect(BULK_STATUS_MAX).toBe(50);
    expect(dtoErrors({ orderIds: ids(50), targetStatus: 'PACKED' })).toEqual([]);
    expect(dtoErrors({ orderIds: ids(51), targetStatus: 'PACKED' })).toContain('Mỗi lượt tối đa 50 đơn.');
  });

  it('danh sách rỗng và đích ngoài PACKED/CANCELLED (Đang giao, Đã giao, Chờ thanh toán) bị chặn', () => {
    expect(dtoErrors({ orderIds: [], targetStatus: 'PACKED' })).toContain('Chọn ít nhất một đơn.');
    for (const targetStatus of ['SHIPPING', 'DELIVERED', 'PENDING_PAYMENT', 'RETURNED', 'CONFIRMED']) {
      expect(dtoErrors({ orderIds: ['TB0001'], targetStatus })).toContain('Đổi hàng loạt chỉ nhận «Đã đóng gói» hoặc «Đã huỷ».');
    }
    expect(dtoErrors({ orderIds: ['TB0001'], targetStatus: 'CANCELLED', dryRun: true, note: 'Hết hàng' })).toEqual([]);
  });
});

describe('OrderBulkStatusService', () => {
  it('service tự chặn quá 50 mã khác nhau (gọi thẳng không qua DTO), mã trùng tính một lần', async () => {
    const { svc, prisma } = setup();
    const many = Array.from({ length: 51 }, (_, i) => `X${i}`);
    await expect(svc.run(ADMIN, { orderIds: many, targetStatus: 'PACKED' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    const dup = [...Array.from({ length: 50 }, () => 'TB0001'), ' TB0001 '];
    const r = await svc.run(ADMIN, { orderIds: dup, targetStatus: 'PACKED', dryRun: true });
    expect(r.total).toBe(1);
  });

  it('xem trước: áp đủ luật bảng chuyển trạng thái cho từng đơn, không đổi đơn nào, không ghi sổ', async () => {
    const { svc, prisma, admin } = setup();
    const r = await svc.run(ADMIN, {
      orderIds: ['TB0001', 'TB0003', 'TB0004', 'TB0005', 'TB0006', 'NOPE'],
      targetStatus: 'CANCELLED',
      dryRun: true,
    });
    expect(r.dryRun).toBe(true);
    expect(admin.changeOrderStatus).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by.TB0001).toMatchObject({ ok: true, outcome: 'READY', reason: null, code: 'TB0001', from: 'CONFIRMED' });
    expect(by.TB0003).toMatchObject({ ok: true });
    expect(by.TB0004!.ok).toBe(false);
    expect(by.TB0004!.reason).toContain('không chuyển sang «Đã huỷ»');
    expect(by.TB0005!.ok).toBe(false);
    expect(by.TB0005!.reason).toContain('đã bàn giao vận chuyển');
    expect(by.TB0006).toMatchObject({ ok: true });
    expect(by.NOPE).toEqual({ id: 'NOPE', code: null, from: null, ok: false, outcome: 'FAILED', reason: 'Không tìm thấy đơn hàng.' });
    expect([r.okCount, r.skippedCount, r.failedCount, r.total]).toEqual([3, 0, 3, 6]);
    expect([r.auditLogId, r.auditError]).toEqual([null, null]);
  });

  it('PACKED: đơn trả trước chưa trả tiền không rời Chờ thanh toán; đơn đại lý ghi công nợ thì được; đơn đã ở PACKED là bỏ qua (không phải lỗi)', async () => {
    const { svc } = setup(ALL, { credit: ['id-TB0007'] });
    const r = await svc.run(ADMIN, { orderIds: ['TB0006', 'TB0007', 'TB0003'], targetStatus: 'PACKED', dryRun: true });
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by.TB0006!.ok).toBe(false);
    expect(by.TB0006!.reason).toContain('Đã nhận tiền');
    expect(by.TB0007).toMatchObject({ ok: true });
    expect(by.TB0003).toMatchObject({ ok: false, outcome: 'SKIPPED' });
    expect(by.TB0003!.reason).toContain('không cần đổi');
    expect(by.TB0006!.outcome).toBe('FAILED');
    expect([r.okCount, r.skippedCount, r.failedCount, r.total]).toEqual([1, 1, 1, 3]);
  });

  it('nhóm việc: KHO chỉ đóng gói, CSKH chỉ huỷ — mỗi đơn trả lý do 403 riêng, không làm hỏng cả lượt', async () => {
    const { svc } = setup();
    const kho = await svc.run(KHO, { orderIds: ['TB0001', 'TB0002'], targetStatus: 'CANCELLED', dryRun: true });
    expect(kho.results.every((x) => !x.ok && x.reason!.includes('KHO chỉ đánh dấu Đã đóng gói'))).toBe(true);
    const cskh = await svc.run(CSKH, { orderIds: ['TB0001'], targetStatus: 'PACKED', dryRun: true });
    expect(cskh.results[0]!.ok).toBe(false);
    expect(cskh.results[0]!.reason).toContain('CSKH chỉ huỷ đơn');
    expect((await svc.run(KHO, { orderIds: ['TB0001'], targetStatus: 'PACKED', dryRun: true })).okCount).toBe(1);
    expect((await svc.run(CSKH, { orderIds: ['TB0001'], targetStatus: 'CANCELLED', dryRun: true })).okCount).toBe(1);
  });

  it('đổi thật: đơn hợp lệ đi qua changeOrderStatus từng đơn; đơn lỗi giữa chừng không chặn đơn sau; ghi một dòng admin_audit_logs', async () => {
    const { svc, prisma, admin } = setup();
    admin.changeOrderStatus.mockImplementation(async (_a: unknown, id: string) => {
      if (id === 'id-TB0002') throw new BadRequestException('Đơn TB0002 vừa chuyển sang Đang giao.');
      return { order: {}, changed: true };
    });
    const r = await svc.run(KHO, { orderIds: ['TB0002', 'TB0001', 'TB0004', 'TB0003', 'id-TB0001'], targetStatus: 'PACKED', note: '  Đóng ca sáng  ' });
    expect(admin.changeOrderStatus.mock.calls.map((c) => [c[1], c[2], c[3]])).toEqual([
      ['id-TB0002', 'PACKED', 'Đóng ca sáng'],
      ['id-TB0001', 'PACKED', 'Đóng ca sáng'],
    ]);
    expect(admin.changeOrderStatus.mock.calls[0]![0]).toMatchObject({ id: 'kho-1', role: 'STAFF', staffPermissions: ['KHO'] });
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by.TB0001).toMatchObject({ ok: true, outcome: 'UPDATED', reason: null });
    expect(by.TB0002).toMatchObject({ ok: false, outcome: 'FAILED', reason: 'Đơn TB0002 vừa chuyển sang Đang giao.' });
    expect(by.TB0004!.outcome).toBe('FAILED');
    expect(by.TB0003!.outcome).toBe('SKIPPED');
    expect(by['id-TB0001']!.reason).toContain('đã có ở dòng trên');
    expect([r.okCount, r.skippedCount, r.failedCount]).toEqual([1, 1, 3]);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.adminAuditLog.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ actorId: 'kho-1', action: BULK_STATUS_ACTION, targetType: 'ORDER', targetIds: ['TB0001'] });
    expect(data.payload).toMatchObject({
      targetStatus: 'PACKED',
      note: 'Đóng ca sáng',
      actorRole: 'STAFF',
      staffPermissions: ['KHO'],
      requested: ['TB0002', 'TB0001', 'TB0004', 'TB0003', 'id-TB0001'],
      changed: ['TB0001'],
    });
    expect(data.payload.failed.map((f: { code: string }) => f.code)).toEqual(['TB0002', 'TB0004', 'TB0001']);
    expect(data.payload.skipped).toEqual([{ id: 'TB0003', code: 'TB0003', from: 'PACKED', reason: expect.stringContaining('không cần đổi') }]);
    expect(r.auditLogId).toBe('audit-7');
  });

  it('đơn bị webhook/người khác đổi sau lúc đọc lô: không gọi changeOrderStatus; sang đúng đích là bỏ qua, sang trạng thái khác là lỗi; không ghi công vào sổ', async () => {
    const { svc, prisma, admin } = setup(ALL, { changedMeanwhile: { TB0001: 'CANCELLED', TB0003: 'SHIPPING' } });
    const r = await svc.run(ADMIN, { orderIds: ['TB0001', 'TB0002', 'TB0003'], targetStatus: 'CANCELLED' });
    expect(admin.changeOrderStatus.mock.calls.map((c) => c[1])).toEqual(['id-TB0002']);
    expect(r.results[0]).toMatchObject({ id: 'TB0001', ok: false, outcome: 'SKIPPED', reason: 'Đơn TB0001 vừa được thao tác khác đổi sang «Đã huỷ», lượt này không đổi.' });
    expect(r.results[2]).toMatchObject({ id: 'TB0003', ok: false, outcome: 'FAILED', reason: 'Đơn TB0003 vừa được đổi sang «Đang giao» bởi thao tác khác, lượt này không đổi.' });
    expect([r.okCount, r.skippedCount, r.failedCount]).toEqual([1, 1, 1]);
    const data = prisma.adminAuditLog.create.mock.calls[0]![0].data;
    expect(data.targetIds).toEqual(['TB0002']);
    expect(data.payload.skipped.map((x: { code: string }) => x.code)).toEqual(['TB0001']);
    expect(data.payload.failed.map((x: { code: string }) => x.code)).toEqual(['TB0003']);
  });

  it('changeOrderStatus báo changed = false (admin khác thắng câu đổi có điều kiện): đơn là bỏ qua, không vào changed/targetIds của sổ', async () => {
    const { svc, prisma, admin } = setup();
    admin.changeOrderStatus.mockImplementation(async (_a: unknown, id: string) => ({ order: {}, changed: id !== 'id-TB0001' }));
    const r = await svc.run(CSKH, { orderIds: ['TB0001', 'TB0002'], targetStatus: 'CANCELLED', note: 'Hết hàng' });
    expect(r.results.map((x) => [x.id, x.ok, x.outcome])).toEqual([
      ['TB0001', false, 'SKIPPED'],
      ['TB0002', true, 'UPDATED'],
    ]);
    expect(r.results[0]!.reason).toBe('Đơn TB0001 vừa được thao tác khác đổi sang «Đã huỷ», lượt này không đổi.');
    expect([r.okCount, r.skippedCount, r.failedCount, r.total]).toEqual([1, 1, 0, 2]);
    const data = prisma.adminAuditLog.create.mock.calls[0]![0].data;
    expect(data.targetIds).toEqual(['TB0002']);
    expect(data.payload.changed).toEqual(['TB0002']);
    expect(data.payload.skipped).toEqual([{ id: 'TB0001', code: 'TB0001', from: 'CONFIRMED', reason: r.results[0]!.reason }]);
    expect(data.payload.failed).toEqual([]);
  });

  it('hai lượt cùng lúc trên cùng một đơn (đổi dòng đơn nguyên tử): đúng một lượt UPDATED ghi sổ changed, lượt kia SKIPPED', async () => {
    const status = new Map<string, OrderStatus>([['id-TB0001', 'CONFIRMED']]);
    const audit: { targetIds: string[]; payload: { changed: string[]; skipped: { code: string }[] } }[] = [];
    const prisma = {
      order: {
        findMany: jest.fn(async () => [{ ...OK1, status: status.get(OK1.id)! }]),
        findUnique: jest.fn(async () => ({ status: status.get(OK1.id)! })),
      },
      dealerCreditLedger: { findMany: jest.fn().mockResolvedValue([]) },
      adminAuditLog: { create: jest.fn(async ({ data }: { data: (typeof audit)[number] }) => (audit.push(data), { id: `audit-${audit.length}` })) },
    };
    // Như câu updateMany có điều kiện status = trạng thái đã đọc: chỉ lần gọi gặp CONFIRMED mới đổi dòng.
    const admin = {
      changeOrderStatus: jest.fn(async (_a: unknown, id: string, to: OrderStatus) => {
        await new Promise((resolve) => setImmediate(resolve));
        const won = status.get(id) === 'CONFIRMED';
        if (won) status.set(id, to);
        return { order: {}, changed: won };
      }),
    };
    const svc = new OrderBulkStatusService(prisma as never, admin as never);
    const [a, b] = await Promise.all([
      svc.run(ADMIN, { orderIds: ['TB0001'], targetStatus: 'CANCELLED' }),
      svc.run({ ...ADMIN, sub: 'admin-2' }, { orderIds: ['TB0001'], targetStatus: 'CANCELLED' }),
    ]);
    expect(admin.changeOrderStatus).toHaveBeenCalledTimes(2);
    expect([a.results[0]!.outcome, b.results[0]!.outcome].sort()).toEqual(['SKIPPED', 'UPDATED']);
    expect(audit).toHaveLength(2);
    expect(audit.filter((l) => l.targetIds.includes('TB0001'))).toHaveLength(1);
    expect(audit.filter((l) => l.payload.changed.includes('TB0001'))).toHaveLength(1);
    expect(audit.filter((l) => l.payload.skipped.some((x) => x.code === 'TB0001'))).toHaveLength(1);
  });

  it('ghi sổ lỗi sau khi đã đổi đơn: trả auditError để chụp làm bằng chứng, không ném 500', async () => {
    const { svc, admin } = setup(ALL, { auditFails: true });
    const r = await svc.run(ADMIN, { orderIds: ['TB0001'], targetStatus: 'CANCELLED', note: 'Khách đổi ý' });
    expect(admin.changeOrderStatus).toHaveBeenCalledTimes(1);
    expect(r.okCount).toBe(1);
    expect(r.auditLogId).toBeNull();
    expect(r.auditError).toContain('Chưa ghi được sổ thao tác quản trị');
  });
});

describe('BulkOpsController RBAC', () => {
  const guard = new RolesGuard(new Reflector());
  const can = (user: object) => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => BulkOpsController.prototype.bulkOrderStatus,
      getClass: () => BulkOpsController,
    } as unknown as ExecutionContext;
    try {
      return guard.canActivate(ctx);
    } catch (e) {
      if (e instanceof ForbiddenException) return false;
      throw e;
    }
  };

  it('ADMIN, CSKH, KHO vào được; KE_TOAN, MARKETING, nhân viên chưa có nhóm, khách, CTV, đại lý bị 403', () => {
    expect(can({ role: 'ADMIN' })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['CSKH'] })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['KHO'] })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['KE_TOAN', 'MARKETING'] })).toBe(false);
    expect(can({ role: 'STAFF', staffPermissions: [] })).toBe(false);
    for (const role of ['CUSTOMER', 'AFFILIATE', 'DEALER', 'MERCHANT']) expect(can({ role, staffPermissions: ['CSKH', 'KHO'] })).toBe(false);
  });

  it('controller chuyển nguyên người bấm và body sang service', async () => {
    const run = jest.fn().mockResolvedValue({ ok: 1 });
    const ctrl = new BulkOpsController({ run } as never);
    await ctrl.bulkOrderStatus(KHO, { orderIds: ['TB0001'], targetStatus: 'PACKED', dryRun: true });
    expect(run).toHaveBeenCalledWith(KHO, { orderIds: ['TB0001'], targetStatus: 'PACKED', dryRun: true });
  });
});
