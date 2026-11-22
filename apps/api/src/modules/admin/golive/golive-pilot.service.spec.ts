import { BadRequestException } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { PILOT_CANCEL_NOTE, PILOT_CLEANUP_ACTION, PILOT_CONFIRM_TEXT, PILOT_WINDOW_DAYS, type PilotOrderShape } from './golive-pilot';
import { GoLivePilotService } from './golive-pilot.service';

const NOW = new Date('2026-11-21T05:00:00Z');
const actor = { sub: 'admin-1', role: 'ADMIN' } as JwtPayload;

function order(patch: Partial<PilotOrderShape> & { code: string }): PilotOrderShape & { id: string } {
  return {
    id: `id-${patch.code}`,
    type: 'RETAIL',
    status: 'CONFIRMED',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    total: 64_000,
    createdAt: new Date('2026-11-20T03:00:00Z'),
    note: null,
    guestPhone: null,
    placedForCustomer: false,
    pancakePaidReported: null,
    paymentUnlinkedAt: null,
    user: { phone: '0987000111' },
    ...patch,
  };
}

/**
 * Đơn thử T1 (COD chưa giao, có [PILOT]), T2 (đã giao, có [PILOT], đặt bằng SĐT người thử), T4 (chỉ khớp SĐT người thử, không [PILOT]),
 * T5 (đã trả tiền), đơn CTV đặt hộ khách thật bằng SĐT người thử, và một đơn khách thật cùng ngày.
 */
const T1 = order({ code: 'TBPILOT1', note: 'Đơn thử T1 [PILOT]' });
const T2 = order({ code: 'TBPILOT2', note: '[PILOT] T2', status: 'DELIVERED', user: { phone: '0901234567' } });
const T4 = order({ code: 'TBPHONE4', user: { phone: '0901234567' } });
const T5 = order({ code: 'TBPILOT5', note: '[pilot] T5', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
const CTV = order({ code: 'TBCTV001', user: { phone: '0901234567' }, placedForCustomer: true });
const REAL = order({ code: 'TBREAL01', note: 'Giao giờ hành chính', user: { phone: '0977555444' } });

function setup(rows = [T1, T2, T4, T5, CTV, REAL], auditTargets: string[][] = [], fresh: Record<string, Partial<PilotOrderShape>> = {}) {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) => {
        const row = rows.find((r) => r.code === where.code);
        return row ? { ...row, ...fresh[where.code] } : null;
      }),
    },
    adminAuditLog: {
      findMany: jest.fn().mockResolvedValue(auditTargets.map((targetIds) => ({ targetIds }))),
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
  const admin = { updateOrderStatus: jest.fn().mockResolvedValue({}) };
  return { prisma, admin, svc: new GoLivePilotService(prisma as never, admin as never) };
}

describe('GoLivePilotService.list', () => {
  it('chỉ liệt kê đơn có [PILOT] hoặc khớp SĐT người thử; đơn khách thật và đơn CTV đặt hộ khách trả về từ DB vẫn bị lọc bỏ', async () => {
    const { svc, prisma } = setup();
    const view = await svc.list(['0901 234 567'], NOW);
    expect(view.orders.map((o) => [o.code, o.matchedBy, o.action])).toEqual([
      ['TBPILOT1', ['NOTE_MARKER'], 'CANCEL'],
      ['TBPILOT2', ['NOTE_MARKER', 'TEST_PHONE'], 'ARCHIVE'],
      ['TBPHONE4', ['TEST_PHONE'], 'MANUAL'],
      ['TBPILOT5', ['NOTE_MARKER'], 'MANUAL'],
    ]);
    expect(view.counts).toEqual({ CANCEL: 1, ARCHIVE: 1, MANUAL: 2, DONE: 0 });
    expect(view.orders[1]!.phone).toBe('090***4567');
    const where = prisma.order.findMany.mock.calls[0]![0].where;
    expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - PILOT_WINDOW_DAYS * 86_400_000));
    expect(where.OR).toEqual([
      { note: { contains: '[PILOT]', mode: 'insensitive' } },
      { placedForCustomer: false, user: { phone: { in: ['0901234567'] } } },
      { placedForCustomer: false, guestPhone: { in: ['0901234567'] } },
    ]);
  });

  it('SĐT người thử sai dạng: 400, không đọc DB', async () => {
    const { svc, prisma } = setup();
    await expect(svc.list(['12345'], NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('đơn đã có trong sổ dọn của lượt trước hiện DONE', async () => {
    const { svc, prisma } = setup([T1, T2], [['TBPILOT2']]);
    const view = await svc.list(['0901234567'], NOW);
    expect(view.orders.map((o) => [o.code, o.action])).toEqual([
      ['TBPILOT1', 'CANCEL'],
      ['TBPILOT2', 'DONE'],
    ]);
    expect(prisma.adminAuditLog.findMany.mock.calls[0]![0].where).toEqual({ action: PILOT_CLEANUP_ACTION, targetIds: { hasSome: ['TBPILOT1', 'TBPILOT2'] } });
  });
});

describe('GoLivePilotService.cleanup', () => {
  it('mặc định là xem trước: liệt kê đúng mã và số bản ghi sẽ đổi, không huỷ, không ghi sổ', async () => {
    const { svc, prisma, admin } = setup();
    const r = await svc.cleanup(actor, { phones: ['0901234567'] }, NOW);
    expect(r.dryRun).toBe(true);
    expect(r.cancelled).toEqual(['TBPILOT1']);
    expect(r.archived).toEqual(['TBPILOT2']);
    expect(r.affected).toEqual({ ordersCancelled: 1, statusHistoryRows: 1, ordersArchived: 1, auditLogRows: 1 });
    expect(admin.updateOrderStatus).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('dryRun=false thiếu hoặc sai câu xác nhận: 400 trước khi đọc DB, không đơn nào bị đụng', async () => {
    for (const confirmText of [undefined, '', 'xoa don thu', 'XOA DON']) {
      const { svc, prisma, admin } = setup();
      await expect(svc.cleanup(actor, { dryRun: false, confirmText, codes: ['TBPILOT1'] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
      expect(admin.updateOrderStatus).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    }
  });

  it('dọn thật mà không gửi danh sách mã đã xem: 400', async () => {
    const { svc, admin } = setup();
    await expect(svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT }, NOW)).rejects.toThrow('danh sách mã');
    expect(admin.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('có mã đơn khách thật trong danh sách: từ chối cả lượt (kể cả mã đơn thử đi kèm), không huỷ, không ghi sổ', async () => {
    const { svc, prisma, admin } = setup();
    await expect(svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPILOT1', 'TBREAL01'] }, NOW)).rejects.toThrow('TBREAL01');
    await expect(svc.cleanup(actor, { dryRun: true, codes: ['TBREAL01'] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(admin.updateOrderStatus).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('đơn chỉ khớp SĐT người thử: không gửi SĐT thì từ chối cả lượt; gửi SĐT thì vẫn chỉ bỏ qua (làm tay), không huỷ; đơn CTV đặt hộ bị từ chối', async () => {
    const { svc, admin } = setup();
    await expect(svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPHONE4'] }, NOW)).rejects.toThrow('TBPHONE4');
    await expect(svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBCTV001'], phones: ['0901234567'] }, NOW)).rejects.toThrow('TBCTV001');
    const r = await svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPHONE4'], phones: ['0901234567'] }, NOW);
    expect(r.cancelled).toEqual([]);
    expect(r.skipped.map((s) => s.code)).toEqual(['TBPHONE4']);
    expect(admin.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('đơn chỉ khớp SĐT được quản trị viên tick (optInCodes): huỷ qua AdminService, sổ ghi optIn; đơn CTV đặt hộ vẫn bị từ chối', async () => {
    const { svc, admin, prisma } = setup();
    const dry = await svc.cleanup(actor, { dryRun: true, codes: ['TBPHONE4'], optInCodes: ['TBPHONE4'], phones: ['0901234567'] }, NOW);
    expect(dry.cancelled).toEqual(['TBPHONE4']);
    expect(admin.updateOrderStatus).not.toHaveBeenCalled();
    await expect(
      svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBCTV001'], optInCodes: ['TBCTV001'], phones: ['0901234567'] }, NOW),
    ).rejects.toThrow('TBCTV001');
    const r = await svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPHONE4'], optInCodes: ['TBPHONE4'], phones: ['0901234567'] }, NOW);
    expect(r.cancelled).toEqual(['TBPHONE4']);
    expect(admin.updateOrderStatus).toHaveBeenCalledWith({ ...actor, id: 'admin-1' }, 'TBPHONE4', 'CANCELLED', PILOT_CANCEL_NOTE);
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data.payload).toMatchObject({ optIn: ['TBPHONE4'] });
  });

  it('optInCodes có mã ngoài danh sách dọn: 400, không huỷ', async () => {
    const { svc, admin } = setup();
    await expect(
      svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPILOT1'], optInCodes: ['TBPHONE4'], phones: ['0901234567'] }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(admin.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('đơn tick chọn được trả tiền giữa lúc xem trước và lúc dọn: đọc lại, bỏ qua, không huỷ', async () => {
    const { svc, admin } = setup([T4], [], { TBPHONE4: { paymentStatus: 'PAID' } });
    const r = await svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPHONE4'], optInCodes: ['TBPHONE4'], phones: ['0901234567'] }, NOW);
    expect(r.cancelled).toEqual([]);
    expect(r.skipped.map((s) => s.code)).toEqual(['TBPHONE4']);
    expect(admin.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('đơn được trả tiền giữa lúc xem trước và lúc dọn: đọc lại trước khi huỷ, bỏ qua, không huỷ', async () => {
    const T3 = order({ code: 'TBPILOT3', note: '[PILOT] T3', paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT' });
    const { svc, admin } = setup([T1, T3], [], { TBPILOT3: { paymentStatus: 'PAID', status: 'CONFIRMED' } });
    const r = await svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPILOT1', 'TBPILOT3'] }, NOW);
    expect(r.cancelled).toEqual(['TBPILOT1']);
    expect(r.skipped).toEqual([{ code: 'TBPILOT3', reason: expect.stringContaining('Đơn đổi giữa lúc xem trước và lúc dọn') }]);
    expect(admin.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(admin.updateOrderStatus.mock.calls[0]![1]).toBe('TBPILOT1');
  });

  it('ghi sổ admin_audit_logs lỗi sau khi đã huỷ: không ném 500, trả đúng đơn đã huỷ kèm auditError (không lộ chi tiết kết nối)', async () => {
    const { svc, prisma } = setup([T1]);
    prisma.adminAuditLog.create.mockRejectedValueOnce(Object.assign(new Error('connect postgres://u:secret@db/x'), { code: 'P1001' }));
    const r = await svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPILOT1'] }, NOW);
    expect(r).toMatchObject({ cancelled: ['TBPILOT1'], auditLogId: null });
    expect(r.auditError).toContain('P1001');
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('dọn thật: huỷ qua AdminService (đúng đường nút Huỷ), ghi sổ đơn xong, bỏ qua đơn có tiền, ghi một dòng admin_audit_logs', async () => {
    const { svc, prisma, admin } = setup();
    const r = await svc.cleanup(actor, { dryRun: false, confirmText: ` ${PILOT_CONFIRM_TEXT} `, codes: ['TBPILOT1', 'TBPILOT2', 'TBPILOT5'], phones: ['0901234567'] }, NOW);
    expect(admin.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(admin.updateOrderStatus).toHaveBeenCalledWith({ ...actor, id: 'admin-1' }, 'TBPILOT1', 'CANCELLED', PILOT_CANCEL_NOTE);
    expect(r).toMatchObject({ dryRun: false, cancelled: ['TBPILOT1'], archived: ['TBPILOT2'], failed: [], auditLogId: 'audit-1', auditError: null });
    expect(r.skipped.map((s) => s.code)).toEqual(['TBPILOT5']);
    expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.adminAuditLog.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ actorId: 'admin-1', action: PILOT_CLEANUP_ACTION, targetType: 'ORDER', targetIds: ['TBPILOT1', 'TBPILOT2'] });
    expect(data.payload).toMatchObject({ requested: ['TBPILOT1', 'TBPILOT2', 'TBPILOT5'], cancelled: ['TBPILOT1'], archived: ['TBPILOT2'], phones: ['090***4567'] });
    expect(JSON.stringify(data.payload)).not.toContain('0901234567');
  });

  it('một đơn huỷ lỗi (vd đã bàn giao kho giữa chừng): ghi vào failed, đơn khác vẫn chạy, sổ vẫn ghi', async () => {
    const T3 = order({ code: 'TBPILOT3', note: '[PILOT] T3' });
    const { svc, prisma, admin } = setup([T1, T3]);
    admin.updateOrderStatus.mockRejectedValueOnce(new BadRequestException('Đơn đã bàn giao vận chuyển, không huỷ được.'));
    const r = await svc.cleanup(actor, { dryRun: false, confirmText: PILOT_CONFIRM_TEXT, codes: ['TBPILOT1', 'TBPILOT3'] }, NOW);
    expect(r.cancelled).toEqual(['TBPILOT3']);
    expect(r.failed).toEqual([{ code: 'TBPILOT1', message: 'Đơn đã bàn giao vận chuyển, không huỷ được.' }]);
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data.targetIds).toEqual(['TBPILOT3']);
  });
});
