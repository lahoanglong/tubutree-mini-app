import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PassThrough } from 'stream';
import { RECONCILE_VARIATION_SELECT, buildReport, classifyVariation, expectedLocalStock, foldSearch, matchesSearch, type ReconcileVariation } from './pancake-reconcile';
import { RECONCILE_CSV_HEADERS, RECONCILE_FLAG_LABELS, RECONCILE_TRIAGE, reconcileCsvRow } from './pancake-reconcile-csv';
import {
  PancakeReconcileController,
  PancakeReconcileExportQuery,
  PancakeReconcileQuery,
  RECONCILE_EXPORT_PER_MINUTE,
  reconcileFileStamp,
} from './pancake-reconcile.controller';

const SYNC = new Date('2026-11-21T03:00:00Z');
const HOOK = new Date('2026-11-21T04:30:00Z');

function v(sku: string, patch: Partial<Omit<ReconcileVariation, 'product'>> & { productActive?: boolean } = {}): ReconcileVariation {
  const { productActive = true, ...rest } = patch;
  return {
    id: `var-${sku}`,
    sku,
    name: `Biến thể ${sku}`,
    stock: 10,
    reservedStock: 0,
    pancakeId: `pk-${sku}`,
    pancakeStock: 10,
    pancakeStockSyncReadAt: SYNC,
    pancakeStockWebhookReceivedAt: null,
    product: { id: `prod-${sku}`, name: `Sản phẩm ${sku}`, isActive: productActive },
    ...rest,
  };
}

describe('classifyVariation: so tồn cửa hàng với số Pancake lần đồng bộ gần nhất', () => {
  it('tồn khớp công thức đồng bộ (Pancake − giữ chỗ) thì không cờ nào, kể cả khi hết hàng vì giữ chỗ', () => {
    expect(expectedLocalStock(10, 3)).toBe(7);
    expect(expectedLocalStock(2, 5)).toBe(0);
    expect(classifyVariation(v('A', { stock: 7, reservedStock: 3, pancakeStock: 10 }), 3).flags).toEqual([]);
    expect(classifyVariation(v('B', { stock: 0, reservedStock: 2, pancakeStock: 2 }), 3).flags).toEqual([]);
  });

  it('lệch quá ngưỡng thì DRIFT; lệch đúng bằng ngưỡng thì chưa báo', () => {
    const over = classifyVariation(v('C', { stock: 14, pancakeStock: 10 }), 3);
    expect(over).toMatchObject({ expectedStock: 10, drift: 4, flags: ['DRIFT'] });
    expect(classifyVariation(v('D', { stock: 13, pancakeStock: 10 }), 3).flags).toEqual([]);
    expect(classifyVariation(v('E', { stock: 2, pancakeStock: 10 }), 3)).toMatchObject({ drift: -8, flags: ['DRIFT'] });
  });

  it('cửa hàng âm hoặc bằng 0 mà Pancake còn hàng chưa ai giữ: cờ riêng, xếp nặng hơn DRIFT', () => {
    expect(classifyVariation(v('F', { stock: -2, pancakeStock: 5 }), 3).flags).toEqual(['NEGATIVE_LOCAL', 'ZERO_LOCAL_PANCAKE_POSITIVE', 'DRIFT']);
    expect(classifyVariation(v('G', { stock: 0, pancakeStock: 2 }), 3).flags).toEqual(['ZERO_LOCAL_PANCAKE_POSITIVE']);
  });

  it('chưa gắn Pancake: báo UNLINKED khi sản phẩm đang bán, sản phẩm đang ẩn thì thôi; đã gắn mà chưa có số thì NEVER_SYNCED', () => {
    expect(classifyVariation(v('H', { pancakeId: null, pancakeStock: null }), 3)).toMatchObject({ linked: false, flags: ['UNLINKED'], expectedStock: null, drift: null });
    expect(classifyVariation(v('I', { pancakeId: null, pancakeStock: null, productActive: false }), 3).flags).toEqual([]);
    expect(classifyVariation(v('J', { pancakeStock: null, pancakeStockSyncReadAt: null }), 3)).toMatchObject({ flags: ['NEVER_SYNCED'], lastSyncedAt: null });
    // Biến thể chưa gắn mà còn sót số Pancake cũ: không so với số đó.
    expect(classifyVariation(v('K', { pancakeId: null, pancakeStock: 99, stock: 1 }), 3)).toMatchObject({ pancakeStock: null, drift: null, flags: ['UNLINKED'] });
  });

  it('mốc đồng bộ là lần áp muộn nhất giữa lượt đồng bộ và webhook', () => {
    expect(classifyVariation(v('L', { pancakeStockWebhookReceivedAt: HOOK }), 3).lastSyncedAt).toBe(HOOK.toISOString());
  });
});

describe('buildReport', () => {
  const rows = [
    v('OK1'),
    v('DRIFT_SMALL', { stock: 15, pancakeStock: 10 }),
    v('DRIFT_BIG', { stock: 40, pancakeStock: 10, pancakeStockWebhookReceivedAt: HOOK }),
    v('NEG', { stock: -1, pancakeStock: 0 }),
    v('UNLINKED', { pancakeId: null, pancakeStock: null }),
    v('NEVER', { pancakeStock: null }),
  ];

  it('đếm theo cờ trên mọi biến thể, xếp dòng nặng trước rồi lệch nhiều trước, bỏ dòng không có cờ', () => {
    const r = buildReport(rows, 3, SYNC);
    expect(r.counts).toEqual({ scanned: 6, linked: 5, withIssues: 5, NEGATIVE_LOCAL: 1, ZERO_LOCAL_PANCAKE_POSITIVE: 0, DRIFT: 2, UNLINKED: 1, NEVER_SYNCED: 1 });
    expect(r.rows.map((x) => x.sku)).toEqual(['NEG', 'DRIFT_BIG', 'DRIFT_SMALL', 'UNLINKED', 'NEVER']);
    expect(r.lastSyncedAt).toBe(HOOK.toISOString());
    expect(r.truncated).toBe(false);
    expect(r.minDrift).toBe(3);
  });

  it('cắt bảng ở trần dòng nhưng số đếm vẫn đủ', () => {
    const r = buildReport(rows, 3, SYNC, 2);
    expect(r.rows.map((x) => x.sku)).toEqual(['NEG', 'DRIFT_BIG']);
    expect(r.truncated).toBe(true);
    expect(r.counts.withIssues).toBe(5);
  });
});

describe('tìm theo SKU / tên sản phẩm', () => {
  it('không phân biệt hoa thường, dấu tiếng Việt (cả đ), mọi từ phải có mặt theo thứ tự tuỳ ý', () => {
    expect(foldSearch('  Nước  RỬA Chén Đậu ')).toBe('nuoc rua chen dau');
    const x = { sku: 'TB-NRC-500', name: 'Chai 500ml', product: { name: 'Nước rửa chén bồ hòn' } };
    expect(matchesSearch(x, '')).toBe(true);
    expect(matchesSearch(x, 'nrc-500')).toBe(true);
    expect(matchesSearch(x, 'bo hon nuoc')).toBe(true);
    expect(matchesSearch(x, '500ML')).toBe(true);
    expect(matchesSearch(x, 'nuoc giat')).toBe(false);
  });

  it('báo cáo đếm và xếp chỉ trên biến thể khớp ô tìm, trả lại chuỗi đã cắt khoảng trắng', () => {
    const rows = [v('AAA-1', { stock: 40, pancakeStock: 10 }), v('BBB-2', { stock: -1, pancakeStock: 0 }), v('AAA-3', { pancakeId: null, pancakeStock: null })];
    const r = buildReport(rows, 3, SYNC, undefined, ' aaa ');
    expect(r.q).toBe('aaa');
    expect(r.counts).toMatchObject({ scanned: 2, withIssues: 2, NEGATIVE_LOCAL: 0, DRIFT: 1, UNLINKED: 1 });
    expect(r.rows.map((x) => x.sku)).toEqual(['AAA-1', 'AAA-3']);
    expect(buildReport(rows, 3, SYNC).q).toBe('');
  });
});

describe('CSV đối soát tồn', () => {
  it('một dòng: SKU toàn số giữ số 0 đầu, lệch là số, cờ và cách xử lý theo nhãn màn, giờ VN', () => {
    const line = reconcileCsvRow(classifyVariation(v('00123', { stock: -2, pancakeStock: 5 }), 3));
    expect(line.startsWith('"=""00123""",Sản phẩm 00123,Biến thể 00123,Có,Có,-2,0,5,5,-7,')).toBe(true);
    expect(line).toContain('Tồn âm | Hết ở cửa hàng, Pancake còn | Lệch tồn');
    expect(line).toContain('Hết hàng"" oan');
    expect(line).toContain('10:00 21/11/2026');
    expect(line.endsWith('\r\n')).toBe(true);
  });

  it('UNLINKED: ô Pancake trống, cách xử lý nói rõ gắn mã trên Pancake POS', () => {
    const line = reconcileCsvRow(classifyVariation(v('U1', { pancakeId: null, pancakeStock: null, pancakeStockSyncReadAt: null }), 3));
    expect(line).toContain(',Có,Chưa,10,0,,,,Chưa gắn Pancake,');
    expect(line).toContain('Pancake POS');
  });

  it('chặn công thức: tên mở đầu bằng = + - @ tab bị thêm dấu nháy đơn', () => {
    for (const evil of ['=HYPERLINK(1)', '+1+1', '-2+3', '@SUM(A1)', '\tcmd']) {
      const r = { ...classifyVariation(v('S1', { stock: 20, pancakeStock: 10 }), 3), productName: evil };
      const cell = reconcileCsvRow(r).split(',')[1]!;
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('mọi cờ đều có nhãn và cách xử lý; tiêu đề và tên file cố định', () => {
    for (const f of ['NEGATIVE_LOCAL', 'ZERO_LOCAL_PANCAKE_POSITIVE', 'DRIFT', 'UNLINKED', 'NEVER_SYNCED'] as const) {
      expect(RECONCILE_FLAG_LABELS[f]).toBeTruthy();
      expect(RECONCILE_TRIAGE[f]).toBeTruthy();
    }
    expect(RECONCILE_CSV_HEADERS[0]).toBe('SKU');
    expect(RECONCILE_CSV_HEADERS).toContain('Cách xử lý');
    expect(reconcileFileStamp(SYNC)).toBe('20261121-1000');
  });
});

/** Response giả đủ cho streamCsv: ghi vào PassThrough rồi đọc lại cả file. */
function fakeRes() {
  const sink = new PassThrough();
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res = Object.assign(sink, {
    setHeader: (k: string, val: string) => {
      headers[k] = val;
    },
  });
  sink.on('data', (c: Buffer | string) => chunks.push(c.toString()));
  return { res, headers, body: () => chunks.join('') };
}

describe('PancakeReconcileController', () => {
  const SECRETS = { PANCAKE_API_KEY: 'pk_live_SECRET_9f8e7d6c', PANCAKE_WEBHOOK_SECRET: 'whsec_TOPSECRET_123', PANCAKE_SHOP_ID: 'shop-777001' };
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [k, val] of Object.entries(SECRETS)) {
      saved[k] = process.env[k];
      process.env[k] = val;
    }
  });
  afterAll(() => {
    for (const k of Object.keys(SECRETS)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('chỉ đọc biến thể đang bán của hàng kho Tubu, đúng bộ cột đã duyệt, rồi dựng báo cáo theo ngưỡng', async () => {
    const findMany = jest.fn().mockResolvedValue([v('A', { stock: 20, pancakeStock: 10 }), v('B', { pancakeId: null, pancakeStock: null })]);
    const ctrl = new PancakeReconcileController({ variation: { findMany } } as never);
    const r = await ctrl.report({ minDrift: 5 });
    expect(findMany).toHaveBeenCalledWith({ where: { isActive: true, product: { fulfilment: 'TUBU' } }, select: RECONCILE_VARIATION_SELECT, orderBy: { sku: 'asc' } });
    expect(Object.keys(RECONCILE_VARIATION_SELECT).sort()).toEqual(
      ['id', 'name', 'pancakeId', 'pancakeStock', 'pancakeStockSyncReadAt', 'pancakeStockWebhookReceivedAt', 'product', 'reservedStock', 'sku', 'stock'].sort(),
    );
    expect(r.rows.map((x) => [x.sku, x.flags])).toEqual([
      ['A', ['DRIFT']],
      ['B', ['UNLINKED']],
    ]);
    expect((await ctrl.report({})).minDrift).toBe(3);
  });

  it('không lộ khoá, mã cửa hàng hay mã biến thể Pancake: không giá trị bí mật, không trường token/secret/apiKey/pancakeId nào trong phản hồi', async () => {
    const findMany = jest.fn().mockResolvedValue([v('A', { stock: 20, pancakeStock: 10 }), v('B', { pancakeStock: null })]);
    const ctrl = new PancakeReconcileController({ variation: { findMany } } as never);
    const json = JSON.stringify(await ctrl.report({ minDrift: 0 }));
    for (const val of Object.values(SECRETS)) expect(json).not.toContain(val);
    expect(json).not.toMatch(/token|secret|apikey|api_key|password|pancakeId|pk-A|pk-B/i);
  });

  it('ô tìm chuyển xuống bảng: chỉ dòng khớp', async () => {
    const findMany = jest.fn().mockResolvedValue([v('AAA', { stock: 20, pancakeStock: 10 }), v('BBB', { pancakeId: null, pancakeStock: null })]);
    const ctrl = new PancakeReconcileController({ variation: { findMany } } as never);
    const r = await ctrl.report({ q: 'bbb' });
    expect(r.rows.map((x) => x.sku)).toEqual(['BBB']);
    expect(r.counts.scanned).toBe(1);
  });

  it('xuất CSV: BOM UTF-8, MỌI dòng có cờ (không cắt ở 300), lọc theo cờ + ô tìm, ghi nhật ký đúng số dòng, không lộ mã Pancake', async () => {
    const many = Array.from({ length: 305 }, (_, i) => v(`D${String(i).padStart(3, '0')}`, { stock: 50, pancakeStock: 10 }));
    const findMany = jest.fn().mockResolvedValue([...many, v('UNL', { pancakeId: null, pancakeStock: null }), v('OK')]);
    const recordExport = jest.fn().mockResolvedValue(undefined);
    const ctrl = new PancakeReconcileController({ variation: { findMany } } as never, { recordExport } as never);

    const all = fakeRes();
    await ctrl.export({}, all.res as never, 'admin-1');
    const body = all.body();
    expect(body.startsWith('﻿SKU,Sản phẩm,')).toBe(true);
    expect(all.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(all.headers['Content-Disposition']).toMatch(/^attachment; filename="doi-soat-ton-pancake-\d{8}-\d{4}\.csv"$/);
    expect(body.trim().split('\r\n')).toHaveLength(1 + 306);
    expect(body).not.toMatch(/pk-D000|pk-UNL|pancakeId/);
    expect(recordExport).toHaveBeenCalledWith('admin-1', 'pancake-reconcile/export', { minDrift: 3, q: undefined, flag: undefined }, 306);

    const unl = fakeRes();
    await ctrl.export({ flag: 'UNLINKED', minDrift: 5 }, unl.res as never, 'admin-1');
    expect(unl.body().trim().split('\r\n').slice(1).map((l) => l.split(',')[0])).toEqual(['UNL']);

    const found = fakeRes();
    await ctrl.export({ q: 'd30' }, found.res as never, 'admin-1');
    expect(found.body().trim().split('\r\n').slice(1).map((l) => l.split(',')[0])).toEqual(['D300', 'D301', 'D302', 'D303', 'D304']);
  });

  it('xuất CSV có trần riêng 6 lượt/phút mỗi người (w22-04 MINOR 4); GET bảng không gắn trần riêng', () => {
    const proto = PancakeReconcileController.prototype;
    expect(RECONCILE_EXPORT_PER_MINUTE).toBe(6);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.export)).toBe(RECONCILE_EXPORT_PER_MINUTE);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', proto.export)).toBe(60_000);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.report)).toBeUndefined();
  });

  it('từ khoá tối đa 100 ký tự và được cắt khoảng trắng; loại lệch thuộc danh sách', () => {
    const errs = (q: object) => validateSync(plainToInstance(PancakeReconcileExportQuery, q)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(errs({ q: 'nước', flag: 'UNLINKED', minDrift: '0' })).toEqual([]);
    expect(errs({ q: 'x'.repeat(101) })).toContain('Từ khoá tối đa 100 ký tự.');
    expect(errs({ flag: 'pancakeId' })).toContain('Loại lệch không hợp lệ.');
    expect(plainToInstance(PancakeReconcileQuery, { q: '  abc  ' }).q).toBe('abc');
  });

  it('ngưỡng là số nguyên 0..10000', () => {
    const errs = (q: object) => validateSync(plainToInstance(PancakeReconcileQuery, q)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(errs({ minDrift: '5' })).toEqual([]);
    expect(errs({ minDrift: '-1' })).toContain('Ngưỡng lệch không được âm.');
    expect(errs({ minDrift: '2.5' })).toContain('Ngưỡng lệch phải là số nguyên.');
    expect(errs({ minDrift: '10001' })).toContain('Ngưỡng lệch tối đa 10000.');
  });

  it('RolesGuard thật: ADMIN và KHO vào được; CSKH, KE_TOAN, MARKETING, nhân viên chưa có nhóm, khách bị 403', () => {
    const guard = new RolesGuard(new Reflector());
    let handler: unknown = PancakeReconcileController.prototype.report;
    const can = (user: object) => {
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => handler,
        getClass: () => PancakeReconcileController,
      } as unknown as ExecutionContext;
      try {
        return guard.canActivate(ctx);
      } catch (e) {
        if (e instanceof ForbiddenException) return false;
        throw e;
      }
    };
    expect(can({ role: 'ADMIN' })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['KHO'] })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['CSKH', 'KE_TOAN', 'MARKETING'] })).toBe(false);
    expect(can({ role: 'STAFF', staffPermissions: [] })).toBe(false);
    expect(can({ role: 'CUSTOMER', staffPermissions: ['KHO'] })).toBe(false);
    // File CSV: cùng quyền với bảng.
    handler = PancakeReconcileController.prototype.export;
    expect(can({ role: 'ADMIN' })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['KHO'] })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['CSKH', 'KE_TOAN', 'MARKETING'] })).toBe(false);
    expect(can({ role: 'CUSTOMER', staffPermissions: ['KHO'] })).toBe(false);
  });
});
