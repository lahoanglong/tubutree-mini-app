import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderStatusService } from '../orders/order-status.service';

function mkAdmin(order: unknown, resync = jest.fn().mockResolvedValue({ outcome: 'DONE', pointsCredited: true, commissionsLocked: 1 })) {
  const none = {} as never;
  const prisma = {
    order: { findFirst: jest.fn().mockResolvedValue(order) },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const orderStatus = { resyncDeliveredEffects: resync } as unknown as OrderStatusService;
  const svc = new AdminService(prisma as unknown as PrismaService, none, none, none, none, none, orderStatus, none, none, none);
  return { svc, prisma, resync };
}

function contextFor(role: string, staffPermissions: string[] = []): ExecutionContext {
  return {
    getHandler: () => AdminController.prototype.resyncDeliveredEffects,
    getClass: () => AdminController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u1', role, staffPermissions } }) }),
  } as unknown as ExecutionContext;
}

describe('POST /admin/orders/:id/resync-delivered-effects', () => {
  it('route POST, chỉ ADMIN: nhân viên (cả CSKH/KHO) và khách bị 403', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminController.prototype.resyncDeliveredEffects)).toBe('orders/:id/resync-delivered-effects');
    expect(Reflect.getMetadata(METHOD_METADATA, AdminController.prototype.resyncDeliveredEffects)).toBe(RequestMethod.POST);
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(contextFor('ADMIN'))).toBe(true);
    expect(() => guard.canActivate(contextFor('STAFF', ['CSKH', 'KHO']))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor('CUSTOMER'))).toThrow(ForbiddenException);
  });

  it('controller chuyển adminId + id xuống AdminService', async () => {
    const admin = { resyncDeliveredEffects: jest.fn().mockResolvedValue({ outcome: 'DONE' }) };
    const ctrl = new AdminController(admin as never, {} as never);
    await ctrl.resyncDeliveredEffects('admin-1', 'TUBU1');
    expect(admin.resyncDeliveredEffects).toHaveBeenCalledWith('admin-1', 'TUBU1');
  });

  it('đơn không có → 404; đơn chưa/không còn DELIVERED → 400, không chạy gì', async () => {
    await expect(mkAdmin(null).svc.resyncDeliveredEffects('a', 'X')).rejects.toBeInstanceOf(NotFoundException);
    const { svc, resync, prisma } = mkAdmin({ id: 'o1', code: 'TUBU1', status: 'RETURNED' });
    await expect(svc.resyncDeliveredEffects('a', 'TUBU1')).rejects.toBeInstanceOf(BadRequestException);
    expect(resync).not.toHaveBeenCalled();
    expect(prisma.orderStatusHistory.create).not.toHaveBeenCalled();
  });

  it('đơn DELIVERED (kể cả quá cửa sổ cron) → chạy lại theo id, trả kết quả; đơn đã xong trả ALREADY_DONE (idempotent)', async () => {
    const { svc, resync } = mkAdmin({ id: 'o1', code: 'TUBU1', status: 'DELIVERED' });
    await expect(svc.resyncDeliveredEffects('a', 'TUBU1')).resolves.toEqual({
      orderId: 'o1',
      code: 'TUBU1',
      outcome: 'DONE',
      pointsCredited: true,
      commissionsLocked: 1,
    });
    expect(resync).toHaveBeenCalledWith('o1');
    resync.mockResolvedValueOnce({ outcome: 'ALREADY_DONE' });
    await expect(svc.resyncDeliveredEffects('a', 'TUBU1')).resolves.toMatchObject({ outcome: 'ALREADY_DONE' });
  });

  it('mỗi lần chạy lại để lại một dòng lịch sử đơn (admin, kết quả) — không đổi trạng thái đơn', async () => {
    const { svc, prisma, resync } = mkAdmin({ id: 'o1', code: 'TUBU1', status: 'DELIVERED' });
    await svc.resyncDeliveredEffects('admin-9', 'TUBU1');
    resync.mockResolvedValueOnce({ outcome: 'ALREADY_DONE' });
    await svc.resyncDeliveredEffects('admin-9', 'TUBU1');
    expect(prisma.orderStatusHistory.create.mock.calls.map((c) => c[0].data)).toEqual([
      {
        orderId: 'o1',
        fromStatus: 'DELIVERED',
        toStatus: 'DELIVERED',
        actorType: 'ADMIN',
        actorId: 'admin-9',
        note: 'Admin chạy lại việc sau giao: DONE (cộng điểm: có, khoá hoa hồng: 1)',
      },
      {
        orderId: 'o1',
        fromStatus: 'DELIVERED',
        toStatus: 'DELIVERED',
        actorType: 'ADMIN',
        actorId: 'admin-9',
        note: 'Admin chạy lại việc sau giao: ALREADY_DONE',
      },
    ]);
  });
});
