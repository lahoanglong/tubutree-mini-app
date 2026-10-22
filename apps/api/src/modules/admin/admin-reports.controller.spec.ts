import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { RolesGuard } from '../../common/guards/roles.guard';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminReportsController, PayoutExportQuery, RefundExportQuery, ReportRangeQuery } from './admin-reports.controller';

describe('AdminReportsController', () => {
  // Doanh thu và file tài chính: ADMIN + KE_TOAN; bảng nguồn khách: ADMIN + MARKETING. CSKH/KHO không vào route nào.
  const ACCESS: Record<string, string[]> = {
    revenue: ['KE_TOAN'],
    sources: ['MARKETING'],
    exportOrderItems: ['KE_TOAN'],
    exportTax: ['KE_TOAN'],
    exportPayouts: ['KE_TOAN'],
    exportRefunds: ['KE_TOAN'],
  };

  it('@Roles ADMIN ở lớp; mỗi route mở đúng một nhóm việc (@AllowStaff) theo bảng', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminReportsController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, AdminReportsController)).toBeUndefined();
    const methods = Object.getOwnPropertyNames(AdminReportsController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(Object.keys(ACCESS).sort());
    for (const m of methods) {
      expect(Reflect.getMetadata(ROLES_KEY, AdminReportsController.prototype[m as keyof AdminReportsController])).toBeUndefined();
      expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, AdminReportsController.prototype[m as keyof AdminReportsController])).toEqual(ACCESS[m]);
    }
  });

  it('RolesGuard thật: ADMIN qua; KE_TOAN chỉ doanh thu và file tài chính, MARKETING chỉ nguồn khách; CSKH/KHO, khách bị chặn', () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = (m: string, user: object) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => AdminReportsController.prototype[m as keyof AdminReportsController],
        getClass: () => AdminReportsController,
      }) as unknown as ExecutionContext;
    const can = (m: string, user: object) => {
      try {
        return guard.canActivate(ctx(m, user));
      } catch (e) {
        if (e instanceof ForbiddenException) return false;
        throw e;
      }
    };
    for (const m of Object.keys(ACCESS)) {
      expect(can(m, { role: 'ADMIN' })).toBe(true);
      for (const user of [{ role: 'CUSTOMER' }, { role: 'AFFILIATE' }, { role: 'DEALER' }, { role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] }, { role: 'STAFF', staffPermissions: [] }]) {
        expect(can(m, user)).toBe(false);
      }
      expect(can(m, { role: 'STAFF', staffPermissions: ['KE_TOAN'] })).toBe(ACCESS[m]!.includes('KE_TOAN'));
      expect(can(m, { role: 'STAFF', staffPermissions: ['MARKETING'] })).toBe(ACCESS[m]!.includes('MARKETING'));
    }
  });

  it('CSV dòng hàng dùng đúng bộ lọc đơn của file CSV đơn (cùng tập đơn)', async () => {
    const adminOrderWhere = jest.fn().mockResolvedValue({ status: 'DELIVERED' });
    const orderFind = jest.fn().mockResolvedValue([]);
    const ctrl = new AdminReportsController({ order: { findMany: orderFind } } as never, { adminOrderWhere } as never, {} as never);
    const out = new PassThrough();
    const res = Object.assign(out, { setHeader: jest.fn() }) as unknown as Response;
    let body = '';
    out.on('data', (c: Buffer) => (body += c.toString('utf8')));
    await ctrl.exportOrderItems({ status: 'DELIVERED', from: '2026-10-01', to: '2026-10-07' }, res, 'ADMIN');
    await new Promise((r) => setImmediate(r));
    expect(adminOrderWhere).toHaveBeenCalledWith({ status: 'DELIVERED', from: '2026-10-01', to: '2026-10-07' }, { exactPhoneOnly: false });
    expect(orderFind.mock.calls[0]![0]).toMatchObject({ where: { status: 'DELIVERED' } });
    expect(body.startsWith('﻿Mã đơn,')).toBe(true);
  });

  it('CSV dòng hàng: nhân viên (kế toán) chỉ tìm SĐT khi gõ đủ số, như file CSV đơn che SĐT (D2-04)', async () => {
    const adminOrderWhere = jest.fn().mockResolvedValue({});
    const ctrl = new AdminReportsController({ order: { findMany: jest.fn().mockResolvedValue([]) } } as never, { adminOrderWhere } as never, {} as never);
    const out = new PassThrough();
    const res = Object.assign(out, { setHeader: jest.fn() }) as unknown as Response;
    out.resume();
    await ctrl.exportOrderItems({ search: '0901' }, res, 'STAFF');
    expect(adminOrderWhere).toHaveBeenCalledWith({ search: '0901' }, { exactPhoneOnly: true });
  });

  it('GET revenue chuyển khoảng ngày cho báo cáo', async () => {
    const revenueReport = jest.fn().mockResolvedValue({ ok: true });
    const ctrl = new AdminReportsController({} as never, {} as never, { revenueReport } as never);
    await expect(ctrl.revenue({ from: '2026-10-01', to: '2026-10-07' })).resolves.toEqual({ ok: true });
    expect(revenueReport).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-07' });
  });

  it('GET sources chuyển khoảng ngày cho báo cáo nguồn', async () => {
    const sourceReport = jest.fn().mockResolvedValue({ rows: [] });
    const ctrl = new AdminReportsController({} as never, {} as never, { sourceReport } as never);
    await expect(ctrl.sources({ from: '2026-10-01' })).resolves.toEqual({ rows: [] });
    expect(sourceReport).toHaveBeenCalledWith({ from: '2026-10-01' });
  });

  it.each([
    ['ngày không có thật', { from: '2026-02-31' }],
    ['không phải ngày', { to: 'hôm nay' }],
    ['trường lạ', { days: '7' }],
  ])('ReportRangeQuery từ chối: %s', (_l, body) => {
    expect(validateSync(plainToInstance(ReportRangeQuery, body), { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
  });

  it('ReportRangeQuery nhận from/to hợp lệ hoặc để trống', () => {
    expect(validateSync(plainToInstance(ReportRangeQuery, { from: '2026-10-01', to: '2026-10-18' }))).toEqual([]);
    expect(validateSync(plainToInstance(ReportRangeQuery, {}))).toEqual([]);
  });

  describe('file xuất cho kế toán (D1-14)', () => {
    function stream() {
      const out = new PassThrough();
      const headers: Record<string, string> = {};
      const res = Object.assign(out, { setHeader: (k: string, v: string) => (headers[k] = v) }) as unknown as Response;
      let body = '';
      out.on('data', (c: Buffer) => (body += c.toString('utf8')));
      return { res, headers, body: async () => (await new Promise((r) => setImmediate(r)), body) };
    }

    it('thuế TNCN: khoảng ngày giờ VN thành [start, end), tên file có khoảng ngày, mở đầu BOM', async () => {
      const queryRaw = jest.fn().mockResolvedValue([]);
      const ctrl = new AdminReportsController({ $queryRaw: queryRaw } as never, {} as never, {} as never);
      const s = stream();
      await ctrl.exportTax({ from: '2026-10-01', to: '2026-10-31' }, s.res);
      expect(s.headers['Content-Disposition']).toBe('attachment; filename="thue-tncn-ctv-2026-10-01-2026-10-31.csv"');
      expect((await s.body()).startsWith('\uFEFFMã người dùng,')).toBe(true);
      const values = (queryRaw.mock.calls[0]![0] as { values: unknown[] }).values;
      expect(values).toEqual(expect.arrayContaining([new Date('2026-09-30T17:00:00Z'), new Date('2026-10-31T17:00:00Z')]));
    });

    it('rút tiền và hoàn tiền: truyền bộ lọc xuống truy vấn', async () => {
      const payoutFind = jest.fn().mockResolvedValue([]);
      const refundFind = jest.fn().mockResolvedValue([]);
      const ctrl = new AdminReportsController({ payout: { findMany: payoutFind }, orderCustomerRefund: { findMany: refundFind } } as never, {} as never, {} as never);
      await ctrl.exportPayouts({ from: '2026-10-01', to: '2026-10-31', status: 'PAID' }, stream().res);
      expect(payoutFind.mock.calls[0]![0].where).toEqual({ requestedAt: { gte: new Date('2026-09-30T17:00:00Z'), lt: new Date('2026-10-31T17:00:00Z') }, status: 'PAID' });
      await ctrl.exportRefunds({ from: '2026-10-01', to: '2026-10-31', status: 'OPEN', kind: 'RETURN' }, stream().res, { sub: 'a1', role: 'ADMIN' } as never);
      expect(refundFind.mock.calls[0]![0].where).toMatchObject({ status: { in: ['UNVERIFIED', 'PENDING', 'PROCESSING'] }, kind: 'RETURN' });
    });

    it('hoàn tiền: ADMIN thấy SĐT đủ, KE_TOAN một mình thấy 3 số cuối, KE_TOAN kiêm CSKH thấy đủ', async () => {
      const row = {
        id: 'r1', orderCode: 'TB1', kind: 'RETURN', reason: 'RETURNED', method: 'MANUAL_TRANSFER', status: 'PENDING', amount: 1, recipientName: 'A',
        phone: '0911222333', bankName: 'MB', bankAccountNo: '0099887766', bankAccountName: 'A', createdAt: new Date(), completedAt: null, bankRef: null, adminNote: null,
      };
      const csv = async (viewer: object) => {
        const ctrl = new AdminReportsController({ orderCustomerRefund: { findMany: jest.fn().mockResolvedValue([row]) } } as never, {} as never, {} as never);
        const s = stream();
        await ctrl.exportRefunds({ from: '2026-10-01', to: '2026-10-31' }, s.res, viewer as never);
        return s.body();
      };
      expect(await csv({ sub: 'a1', role: 'ADMIN' })).toContain('0911222333');
      const ketoan = await csv({ sub: 's1', role: 'STAFF', staffPermissions: ['KE_TOAN'] });
      expect(ketoan).not.toContain('0911222333');
      expect(ketoan).toContain('*******333');
      expect(ketoan).toContain('0099887766');
      expect(await csv({ sub: 's2', role: 'STAFF', staffPermissions: ['KE_TOAN', 'CSKH'] })).toContain('0911222333');
    });

    it('khoảng ngày quá 366 ngày bị từ chối trước khi ghi byte nào', async () => {
      const ctrl = new AdminReportsController({} as never, {} as never, {} as never);
      const s = stream();
      await expect(ctrl.exportTax({ from: '2025-01-01', to: '2026-10-31' }, s.res)).rejects.toThrow(/tối đa 366 ngày/);
      expect(await s.body()).toBe('');
    });

    it.each<[string, new () => object, Record<string, string>]>([
      ['trạng thái lệnh rút lạ', PayoutExportQuery, { status: 'DONE' }],
      ['trạng thái hoàn tiền lạ', RefundExportQuery, { status: 'PAID' }],
      ['loại khoản lạ', RefundExportQuery, { kind: 'X' }],
      ['ngày sai', PayoutExportQuery, { from: '31/10/2026' }],
    ])('từ chối: %s', (_l, Cls, body) => {
      expect(validateSync(plainToInstance(Cls, body), { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
    });

    it('nhận bộ lọc hợp lệ', () => {
      expect(validateSync(plainToInstance(RefundExportQuery, { from: '2026-10-01', status: 'OPEN', kind: 'CANCEL' }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
      expect(validateSync(plainToInstance(PayoutExportQuery, { status: 'REJECTED' }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    });
  });
});
