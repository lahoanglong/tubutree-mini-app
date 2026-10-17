import 'reflect-metadata';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { AdminReportsController } from './admin-reports.controller';

describe('AdminReportsController', () => {
  it('chỉ ADMIN: không route nào mở cho nhân viên (@AllowStaff)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminReportsController)).toEqual(['ADMIN']);
    const methods = Object.getOwnPropertyNames(AdminReportsController.prototype).filter((m) => m !== 'constructor');
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) {
      expect(Reflect.getMetadata(ROLES_KEY, AdminReportsController.prototype[m as keyof AdminReportsController])).toBeUndefined();
      expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, AdminReportsController.prototype[m as keyof AdminReportsController])).toBeUndefined();
    }
  });

  it('CSV dòng hàng dùng đúng bộ lọc đơn của file CSV đơn (cùng tập đơn)', async () => {
    const adminOrderWhere = jest.fn().mockResolvedValue({ status: 'DELIVERED' });
    const orderFind = jest.fn().mockResolvedValue([]);
    const ctrl = new AdminReportsController({ order: { findMany: orderFind } } as never, { adminOrderWhere } as never);
    const out = new PassThrough();
    const res = Object.assign(out, { setHeader: jest.fn() }) as unknown as Response;
    let body = '';
    out.on('data', (c: Buffer) => (body += c.toString('utf8')));
    await ctrl.exportOrderItems({ status: 'DELIVERED', from: '2026-10-01', to: '2026-10-07' }, res);
    await new Promise((r) => setImmediate(r));
    expect(adminOrderWhere).toHaveBeenCalledWith({ status: 'DELIVERED', from: '2026-10-01', to: '2026-10-07' });
    expect(orderFind.mock.calls[0]![0]).toMatchObject({ where: { status: 'DELIVERED' } });
    expect(body.startsWith('﻿Mã đơn,')).toBe(true);
  });
});
