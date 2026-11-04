import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ConflictException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminService } from './admin.service';
import { AdminController, ResolvePaymentUnlinkedDto } from './admin.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import type { PrismaService } from '../../prisma/prisma.service';

function mkAdmin(prisma: Record<string, unknown>) {
  const none = {} as never;
  const admin = new AdminService(prisma as unknown as PrismaService, none, none, none, none, none, none, none, none, none);
  jest.spyOn((admin as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
  return admin;
}

const SEEN = '2026-11-04T10:00:00.000Z';
const order = (over: Record<string, unknown> = {}) => ({ id: 'o1', code: 'TUBU1', status: 'CANCELLED', reversalEffectsAt: new Date(), ...over });

describe('AdminService.resolvePaymentUnlinked ("Đã đối chiếu" khoản Pancake báo đã thanh toán)', () => {
  it('gỡ cờ bằng CAS theo đúng mốc paymentUnlinkedAt người bấm đã thấy (seenAt) rồi ghi một dòng lịch sử cùng trạng thái kèm ghi chú đã trim', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const history = jest.fn().mockResolvedValue({});
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order()), updateMany }, orderStatusHistory: { create: history } };
    const res = await mkAdmin(prisma).resolvePaymentUnlinked('admin1', 'TUBU1', '  đã ghi tiền về muộn  ', SEEN);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'o1', paymentUnlinkedAt: new Date(SEEN) }, data: { paymentUnlinkedAt: null, paymentUnlinkedFirstAt: null } });
    expect(history).toHaveBeenCalledWith({
      data: {
        orderId: 'o1',
        fromStatus: 'CANCELLED',
        toStatus: 'CANCELLED',
        actorType: 'ADMIN',
        actorId: 'admin1',
        note: 'Đã đối chiếu khoản Pancake báo đã thanh toán — đã ghi tiền về muộn',
      },
    });
    expect(res).toMatchObject({ ok: true, message: expect.stringContaining('TUBU1') });
  });

  it('không còn cờ (updateMany 0: bên kia đã đóng hoặc Kế toán đã bấm "Đã nhận tiền") → 400 đúng lời, không ghi lịch sử', async () => {
    const history = jest.fn();
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order()), updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue({ paymentUnlinkedAt: null }) },
      orderStatusHistory: { create: history },
    };
    const err = await mkAdmin(prisma).resolvePaymentUnlinked('admin1', 'TUBU1', 'ok ok', SEEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe('Đơn TUBU1 không còn khoản Pancake báo đã thanh toán chờ đối chiếu.');
    expect(history).not.toHaveBeenCalled();
  });

  it('cờ còn nhưng mốc đã đổi (khoản Pancake mới tới sau khi người bấm mở đơn) → 409 nêu có khoản mới, cờ giữ, không ghi lịch sử', async () => {
    const history = jest.fn();
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(order()),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ paymentUnlinkedAt: new Date('2026-11-04T11:00:00.000Z') }),
      },
      orderStatusHistory: { create: history },
    };
    const err = await mkAdmin(prisma).resolvePaymentUnlinked('admin1', 'TUBU1', 'ok ok', SEEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Có khoản Pancake mới báo đã thanh toán cho đơn TUBU1 — tải lại để xem trước khi đóng.');
    expect(history).not.toHaveBeenCalled();
  });

  it('đơn đóng thiếu reversalEffectsAt: resolve vẫn để lại dòng lịch sử (không còn bỏ qua)', async () => {
    const history = jest.fn().mockResolvedValue({});
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order({ reversalEffectsAt: null })), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      orderStatusHistory: { create: history },
    };
    await mkAdmin(prisma).resolvePaymentUnlinked('admin1', 'TUBU1', 'ok ok', SEEN);
    expect(history).toHaveBeenCalledTimes(1);
  });

  it('đơn không có → 404, không ghi gì', async () => {
    const updateMany = jest.fn();
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(null), updateMany } };
    await expect(mkAdmin(prisma).resolvePaymentUnlinked('admin1', 'x', 'ok ok', SEEN)).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('ghi lịch sử lỗi không làm hỏng việc đã đóng', async () => {
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order()), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      orderStatusHistory: { create: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    await expect(mkAdmin(prisma).resolvePaymentUnlinked('admin1', 'TUBU1', 'ok ok', SEEN)).resolves.toMatchObject({ ok: true });
  });
});

describe('POST /admin/orders/:id/payment-unlinked/resolve', () => {
  it('route POST, chỉ ADMIN (không @AllowStaff, không @Roles riêng), chuyển adminId + id + note', async () => {
    const admin = { resolvePaymentUnlinked: jest.fn().mockResolvedValue({ ok: true, message: 'ok' }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.resolvePaymentUnlinked('admin-1', 'o1', { note: 'đã đối chiếu', seenAt: SEEN });
    expect(admin.resolvePaymentUnlinked).toHaveBeenCalledWith('admin-1', 'o1', 'đã đối chiếu', SEEN);
    const handler = AdminController.prototype.resolvePaymentUnlinked;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('orders/:id/payment-unlinked/resolve');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  const check = async (body: Record<string, unknown>) => {
    const dto = plainToInstance(ResolvePaymentUnlinkedDto, body);
    return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
  };

  it('ghi chú bắt buộc, trim rồi ≥ 3 ký tự, ≤ 500; chặn field lạ', async () => {
    expect((await check({ note: 'abc' })).errors).not.toHaveLength(0);
    expect((await check({ note: 'abc', seenAt: 'hôm qua' })).errors).not.toHaveLength(0);
    expect((await check({ note: 'abc', seenAt: 5 })).errors).not.toHaveLength(0);
    expect((await check({ seenAt: SEEN })).errors).not.toHaveLength(0);
    expect((await check({ note: '  ab  ', seenAt: SEEN })).errors).not.toHaveLength(0);
    expect((await check({ note: 'x'.repeat(501), seenAt: SEEN })).errors).not.toHaveLength(0);
    expect((await check({ note: 5, seenAt: SEEN })).errors).not.toHaveLength(0);
    expect((await check({ note: 'ok', seenAt: SEEN, extra: 1 })).errors).not.toHaveLength(0);
    const ok = await check({ note: '  abc  ', seenAt: SEEN });
    expect(ok.errors).toHaveLength(0);
    expect(ok.dto.note).toBe('abc');
  });
});
