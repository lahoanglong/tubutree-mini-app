import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { OrderStaffNoteController, SaveOrderStaffNoteDto } from './order-staff-note.controller';
import { ORDER_STAFF_NOTE_AUDIT_ACTION, OrderStaffNoteService } from './order-staff-note.service';

const T0 = new Date('2026-11-28T14:00:00.000Z');
const T1 = new Date('2026-11-28T14:05:00.000Z');

function setup(opts: { status?: string; txStatus?: string; current?: { note: string; updatedAt: Date; updatedById: string } | null; order?: null } = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ status: opts.txStatus ?? opts.status ?? 'CONFIRMED' }]),
    orderStaffNote: {
      findUnique: jest.fn().mockResolvedValue(opts.current ?? null),
      upsert: jest.fn().mockImplementation(({ create }: { create: { note: string; updatedById: string } }) => Promise.resolve({ note: create.note, updatedAt: T1, updatedById: create.updatedById })),
      delete: jest.fn().mockResolvedValue({}),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({ id: 'log1' }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'cskh1', fullName: 'Lan CSKH' }]) },
  };
  const prisma = {
    order: { findFirst: jest.fn().mockResolvedValue(opts.order === null ? null : { id: 'o1', code: 'TB1', status: opts.status ?? 'CONFIRMED' }) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { svc: new OrderStaffNoteService(prisma as never), prisma, tx };
}

describe('OrderStaffNoteService — ghi chú nội bộ cho kho (w51-01)', () => {
  it('lưu ghi chú mới: upsert + một dòng audit chữ cũ/mới, trả tên người lưu', async () => {
    const { svc, tx } = setup();
    const r = await svc.save('cskh1', 'TB1', 'Gọi khách trước khi giao', null);
    expect(r).toEqual({
      orderId: 'o1',
      code: 'TB1',
      changed: true,
      staffNote: { note: 'Gọi khách trước khi giao', updatedAt: T1.toISOString(), updatedById: 'cskh1', updatedByName: 'Lan CSKH' },
    });
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'cskh1',
        action: ORDER_STAFF_NOTE_AUDIT_ACTION,
        targetType: 'ORDER',
        targetIds: ['o1'],
        payload: { code: 'TB1', status: 'CONFIRMED', before: null, after: 'Gọi khách trước khi giao' },
      },
    });
  });

  it('mốc người sửa đang thấy đã cũ: 409, không ghi gì', async () => {
    const { svc, tx } = setup({ current: { note: 'Bản của người khác', updatedAt: T1, updatedById: 'a2' } });
    await expect(svc.save('cskh1', 'TB1', 'Bản của tôi', T0.toISOString())).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.save('cskh1', 'TB1', 'Bản của tôi', null)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.orderStaffNote.upsert).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('chữ rỗng xoá ghi chú và ghi audit after = null', async () => {
    const { svc, tx } = setup({ current: { note: 'Cũ', updatedAt: T0, updatedById: 'a2' } });
    const r = await svc.save('cskh1', 'o1', '', T0.toISOString());
    expect(r).toMatchObject({ changed: true, staffNote: null });
    expect(tx.orderStaffNote.delete).toHaveBeenCalledWith({ where: { orderId: 'o1' } });
    expect(tx.adminAuditLog.create.mock.calls[0][0].data.payload).toMatchObject({ before: 'Cũ', after: null });
  });

  it('chữ không đổi: không ghi, không audit', async () => {
    const { svc, tx } = setup({ current: { note: 'Giữ nguyên', updatedAt: T0, updatedById: 'cskh1' } });
    const r = await svc.save('cskh1', 'o1', 'Giữ nguyên', T0.toISOString());
    expect(r.changed).toBe(false);
    expect(tx.orderStaffNote.upsert).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it.each(['DELIVERED', 'CANCELLED', 'RETURNED'])('đơn %s đã đóng: 400 trước khi mở transaction', async (status) => {
    const { svc, prisma } = setup({ status });
    await expect(svc.save('cskh1', 'o1', 'Muộn', null)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('kho đóng đơn đúng lúc đang lưu (trạng thái đọc lại trong transaction đã DELIVERED): 400, không ghi, không audit', async () => {
    const { svc, tx } = setup({ status: 'SHIPPING', txStatus: 'DELIVERED' });
    await expect(svc.save('cskh1', 'o1', 'Muộn', null)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.orderStaffNote.upsert).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('audit ghi trạng thái đọc lại trong transaction, không phải bản đọc trước khoá', async () => {
    const { svc, tx } = setup({ status: 'CONFIRMED', txStatus: 'PACKED' });
    await svc.save('cskh1', 'o1', 'Gói kỹ', null);
    expect(tx.adminAuditLog.create.mock.calls[0][0].data.payload).toMatchObject({ status: 'PACKED' });
  });

  it('không có đơn: 404', async () => {
    const { svc } = setup({ order: null });
    await expect(svc.save('cskh1', 'x', 'a', null)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrderStaffNoteController', () => {
  it('ADMIN và nhân viên CSKH (không KHO, Kế toán, Marketing)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, OrderStaffNoteController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, OrderStaffNoteController.prototype.save)).toEqual(['CSKH']);
  });

  it('DTO: baseUpdatedAt bắt buộc gửi (null hoặc ISO), ghi chú tối đa 500 ký tự', () => {
    const errs = (b: object) => validateSync(plainToInstance(SaveOrderStaffNoteDto, b)).length;
    expect(errs({ note: 'Gói kỹ', baseUpdatedAt: null })).toBe(0);
    expect(errs({ note: '', baseUpdatedAt: T0.toISOString() })).toBe(0);
    expect(errs({ note: 'Gói kỹ' })).toBeGreaterThan(0);
    expect(errs({ note: 'Gói kỹ', baseUpdatedAt: 'hôm qua' })).toBeGreaterThan(0);
    expect(errs({ note: 'x'.repeat(501), baseUpdatedAt: null })).toBeGreaterThan(0);
  });
});
