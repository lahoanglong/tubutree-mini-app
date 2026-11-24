import 'reflect-metadata';
import { PassThrough } from 'stream';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  RESTOCK_NO_SUPPLIER,
  RESTOCK_PLAN_ROWS_MAX,
  buildRestockPlan,
  comparePurchaseRows,
  planRow,
  plannedRows,
  type RestockPlanInput,
} from './restock-planner';
import { RESTOCK_PO_CSV_HEADERS, restockPoCsvRow, restockReason } from './restock-planner-csv';
import { RESTOCK_EXPORT_PER_MINUTE, RestockPlanQuery, RestockPlannerController } from './restock-planner.controller';
import { RESTOCK_PLAN_VARIATION_SELECT, RESTOCK_PLAN_VARIATION_WHERE, RestockPlannerService, supplierName } from './restock-planner.service';

const NOW = new Date('2026-11-24T03:00:00.000Z');

const v = (sku: string, over: Partial<RestockPlanInput> = {}): RestockPlanInput => ({
  variationId: `var-${sku}`,
  productId: `prod-${sku}`,
  productName: `Nước giặt ${sku}`,
  variationName: '1L',
  sku,
  supplier: 'Tubu Tree',
  stock: 10,
  sold: 0,
  waiting: 0,
  backordered: 0,
  ...over,
});

describe('planRow: công thức đề xuất nhập', () => {
  it('nhu cầu = ⌈bán 14 ngày × số ngày muốn đủ bán ÷ 14⌉, trừ tồn bán được', () => {
    // 14 cái / 14 ngày = 1/ngày; đủ bán 30 ngày cần 30, còn 10 → nhập 20; còn đủ bán 10 ngày.
    const r = planRow(v('A', { sold: 14, stock: 10 }), 30);
    expect([r.perDay, r.coverDays, r.suggestedQty, r.urgency]).toEqual([1, 10, 20, 'OK']);
    // 7 cái / 14 ngày × 30 = 15 đúng, không làm tròn lên 16 vì sai số dấu phẩy động.
    expect(planRow(v('B', { sold: 7, stock: 0 }), 30).suggestedQty).toBe(15);
    // 1 cái / 14 ngày × 21 = 1,5 → 2.
    expect(planRow(v('C', { sold: 1, stock: 0 }), 21).suggestedQty).toBe(2);
  });

  it('khách chờ chuông và đại lý đặt trước cộng vào đề xuất; hàng hết cả cửa sổ thì chuông là tín hiệu duy nhất', () => {
    const r = planRow(v('A', { sold: 0, stock: 0, waiting: 3 }), 30);
    expect([r.suggestedQty, r.coverDays, r.urgency]).toEqual([3, 0, 'OUT']);
    expect(planRow(v('B', { sold: 14, stock: 5, waiting: 2, backordered: 4 }), 14).suggestedQty).toBe(14 + 2 + 4 - 5);
  });

  it('tồn âm (bán quá) làm đề xuất tăng đúng phần thiếu; tồn đủ thì đề xuất 0, không âm', () => {
    expect(planRow(v('A', { sold: 14, stock: -3 }), 14).suggestedQty).toBe(14 + 3);
    expect(planRow(v('B', { sold: 14, stock: 100 }), 30).suggestedQty).toBe(0);
  });

  it('"đủ bán N ngày" tính trên phần tồn chưa thuộc đơn đặt trước; hết phần đó là OUT, dưới 7 ngày là LOW, không bán gì mà còn hàng là null', () => {
    expect(planRow(v('A', { sold: 28, stock: 10 }), 30)).toMatchObject({ perDay: 2, coverDays: 5, urgency: 'LOW' });
    expect(planRow(v('B', { sold: 14, stock: 7 }), 30)).toMatchObject({ coverDays: 7, urgency: 'OK' });
    expect(planRow(v('C', { sold: 14, stock: 4, backordered: 4 }), 30)).toMatchObject({ coverDays: 0, urgency: 'OUT' });
    expect(planRow(v('D', { sold: 0, stock: 4 }), 30)).toMatchObject({ coverDays: null, urgency: 'OK', suggestedQty: 0 });
    expect(planRow(v('E', { sold: 3, stock: 1 }), 30).perDay).toBe(0.21);
  });
});

describe('plannedRows / buildRestockPlan', () => {
  const inputs = [
    v('OK1', { sold: 14, stock: 100 }),
    v('LOW', { sold: 28, stock: 10, supplier: 'Kokomi' }),
    v('OUTW', { sold: 0, stock: 0, waiting: 5, productName: 'Nước rửa chén' }),
    v('OUT', { sold: 14, stock: 0 }),
    v('SLOW', { sold: 1, stock: 1, supplier: RESTOCK_NO_SUPPLIER }),
  ];

  it('chỉ dòng có đề xuất > 0; gấp trước: hết hàng (nhiều khách chờ trước) → sắp hết → còn lại', () => {
    const r = buildRestockPlan(inputs, { targetDays: 30 }, NOW);
    expect(r.rows.map((x) => x.sku)).toEqual(['OUTW', 'OUT', 'LOW', 'SLOW']);
    expect(r.counts).toEqual({ scanned: 5, needReorder: 4, outOfStock: 2, waiting: 5, units: 5 + 30 + 2 + 50 });
    expect(r).toMatchObject({ generatedAt: NOW.toISOString(), windowDays: 14, targetDays: 30, q: '', supplier: null, truncated: false });
  });

  it('nhà cung cấp: danh sách theo ô tìm (không theo bộ lọc nhà cung cấp), nhiều đơn vị trước; lọc nhà cung cấp thu hẹp bảng và số đếm', () => {
    const all = buildRestockPlan(inputs, { targetDays: 30 }, NOW);
    expect(all.suppliers).toEqual([
      { name: 'Kokomi', rows: 1, units: 50 },
      { name: 'Tubu Tree', rows: 2, units: 35 },
      { name: RESTOCK_NO_SUPPLIER, rows: 1, units: 2 },
    ]);
    const kokomi = buildRestockPlan(inputs, { targetDays: 30, supplier: ' Kokomi ' }, NOW);
    expect(kokomi.rows.map((x) => x.sku)).toEqual(['LOW']);
    expect(kokomi.counts).toMatchObject({ scanned: 1, needReorder: 1, units: 50 });
    expect(kokomi.supplier).toBe('Kokomi');
    expect(kokomi.suppliers).toEqual(all.suppliers);
  });

  it('ô tìm không dấu theo SKU, tên hoặc nhà cung cấp; số đếm chỉ tính dòng khớp', () => {
    expect(buildRestockPlan(inputs, { targetDays: 30, q: ' nuoc rua ' }, NOW).rows.map((x) => x.sku)).toEqual(['OUTW']);
    const k = buildRestockPlan(inputs, { targetDays: 30, q: 'kokomi' }, NOW);
    expect([k.q, k.counts.scanned, k.rows.map((x) => x.sku)]).toEqual(['kokomi', 1, ['LOW']]);
  });

  it('cắt bảng ở trần dòng nhưng số đếm vẫn đủ', () => {
    const many = Array.from({ length: RESTOCK_PLAN_ROWS_MAX + 5 }, (_, i) => v(`M${String(i).padStart(3, '0')}`, { sold: 14, stock: 0 }));
    const r = buildRestockPlan(many, { targetDays: 14 }, NOW);
    expect([r.rows.length, r.counts.needReorder, r.truncated]).toEqual([RESTOCK_PLAN_ROWS_MAX, RESTOCK_PLAN_ROWS_MAX + 5, true]);
  });

  it('file đặt hàng xếp theo nhà cung cấp (nhóm chưa ghi cuối), rồi tên sản phẩm', () => {
    const { need } = plannedRows(inputs, { targetDays: 30 });
    expect([...need].sort(comparePurchaseRows).map((x) => `${x.supplier}/${x.sku}`)).toEqual([
      'Kokomi/LOW',
      'Tubu Tree/OUT',
      'Tubu Tree/OUTW',
      `${RESTOCK_NO_SUPPLIER}/SLOW`,
    ]);
  });
});

describe('CSV đặt hàng nhà cung cấp', () => {
  it('năm cột đầu là phần gửi nhà cung cấp; số là số, SKU toàn số giữ số 0 đầu, ghi chú theo nhãn màn', () => {
    expect(RESTOCK_PO_CSV_HEADERS.slice(0, 5)).toEqual(['Nhà cung cấp', 'SKU', 'Sản phẩm', 'Phân loại', 'Số lượng đặt']);
    expect(RESTOCK_PO_CSV_HEADERS).toContain('Bán 14 ngày');
    const r = planRow(v('00123', { sold: 0, stock: 0, waiting: 3, backordered: 2 }), 30);
    expect(restockPoCsvRow(r)).toBe('Tubu Tree,"=""00123""",Nước giặt 00123,1L,5,0,0,0,3,2,Hết hàng · 3 khách chờ hàng về · Đại lý chờ 2\r\n');
    expect(restockReason(planRow(v('L', { sold: 28, stock: 10 }), 30))).toBe('Còn đủ bán 5 ngày');
    // Không bán gì trong cửa sổ: ô "Đủ bán" trống.
    expect(restockPoCsvRow(planRow(v('N', { sold: 0, stock: 2, waiting: 4 }), 30)).split(',')[7]).toBe('');
  });

  it('chặn công thức: tên mở đầu bằng = + - @ bị thêm dấu nháy đơn; phân loại trùng tên sản phẩm thì bỏ trống', () => {
    const r = planRow(v('X', { productName: '=HYPERLINK("x")', variationName: '=HYPERLINK("x")', supplier: '@evil', stock: 0, waiting: 1 }), 30);
    const line = restockPoCsvRow(r);
    expect(line.startsWith("'@evil,X,\"'=HYPERLINK(\"\"x\"\")\",,1,")).toBe(true);
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

describe('RestockPlannerService', () => {
  it('đọc biến thể bán được của hàng kho Tubu, ghép số bán / khách chờ / đặt trước theo biến thể; không lộ cột Pancake', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'v1', sku: 'A', name: '1L', stock: 3, product: { id: 'p1', name: 'Nước giặt', brand: 'cũ', brandRef: { name: 'Tubu Tree' } } },
      { id: 'v2', sku: 'B', name: '2L', stock: 0, product: { id: 'p2', name: 'Xà phòng', brand: '  ', brandRef: null } },
    ]);
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        { variationId: 'v1', n: 9 },
        { variationId: 'merchant-var', n: 50 },
      ])
      .mockResolvedValueOnce([{ variationId: 'v2', n: 4 }])
      .mockResolvedValueOnce([{ variationId: 'v1', n: 2 }]);
    const svc = new RestockPlannerService({ variation: { findMany }, $queryRaw: queryRaw } as never);
    const out = await svc.inputs(NOW);
    expect(findMany).toHaveBeenCalledWith({ where: RESTOCK_PLAN_VARIATION_WHERE, select: RESTOCK_PLAN_VARIATION_SELECT, orderBy: { sku: 'asc' } });
    expect(RESTOCK_PLAN_VARIATION_WHERE).toEqual({ isActive: true, product: { isActive: true, approvalStatus: 'APPROVED', fulfilment: 'TUBU' } });
    expect(JSON.stringify(RESTOCK_PLAN_VARIATION_SELECT)).not.toMatch(/pancake/i);
    expect(out).toEqual([
      { variationId: 'v1', productId: 'p1', productName: 'Nước giặt', variationName: '1L', sku: 'A', supplier: 'Tubu Tree', stock: 3, sold: 9, waiting: 0, backordered: 2 },
      { variationId: 'v2', productId: 'p2', productName: 'Xà phòng', variationName: '2L', sku: 'B', supplier: RESTOCK_NO_SUPPLIER, stock: 0, sold: 0, waiting: 4, backordered: 0 },
    ]);
    // Cửa sổ 14 ngày tính từ `now`, đơn thử Giờ G đã dọn bị loại, dòng quà không tính.
    const soldSql = queryRaw.mock.calls[0]!;
    const text = (soldSql[0] as TemplateStringsArray).join('?');
    expect(text).toMatch(/"isGift" = false/);
    expect(text).toMatch(/IN \('CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'\)/);
    const params = soldSql.slice(1);
    expect(params[0]).toEqual(new Date(NOW.getTime() - 14 * 86_400_000));
    expect(params[1]).toEqual(NOW);
    expect(JSON.stringify(params[2])).toContain('GOLIVE_PILOT_CLEANUP');
    expect((queryRaw.mock.calls[1]![0] as TemplateStringsArray).join('?')).toMatch(/"notifiedAt" IS NULL/);
    expect((queryRaw.mock.calls[2]![0] as TemplateStringsArray).join('?')).toMatch(/"backorderedQty" > 0[\s\S]*NOT IN \('CANCELLED', 'RETURNED'\)/);
  });

  it('tên nhà cung cấp: thương hiệu liên kết trước, chuỗi thương hiệu sau, trống thì nhóm "chưa ghi"', () => {
    expect(supplierName({ brand: 'Cũ', brandRef: { name: ' Mới ' } })).toBe('Mới');
    expect(supplierName({ brand: ' Cũ ', brandRef: null })).toBe('Cũ');
    expect(supplierName({ brand: '', brandRef: null })).toBe(RESTOCK_NO_SUPPLIER);
  });
});

describe('RestockPlannerController', () => {
  const inputs = [v('A', { sold: 14, stock: 0, waiting: 2 }), v('B', { sold: 14, stock: 100 }), v('C', { sold: 0, stock: 0, waiting: 1, supplier: 'Kokomi' })];
  const make = (create = jest.fn().mockResolvedValue({})) => {
    const svc = { inputs: jest.fn().mockResolvedValue(inputs) };
    return { ctrl: new RestockPlannerController(svc as never, { adminExportLog: { create } } as never), svc, create };
  };

  it('bảng: mặc định đủ bán 30 ngày; nhận số ngày, ô tìm, nhà cung cấp', async () => {
    const { ctrl } = make();
    const r = await ctrl.report({});
    expect([r.targetDays, r.rows.map((x) => [x.sku, x.suggestedQty])]).toEqual([
      30,
      [
        ['A', 32],
        ['C', 1],
      ],
    ]);
    expect((await ctrl.report({ days: 14, brand: 'Kokomi' })).rows.map((x) => x.sku)).toEqual(['C']);
    expect((await ctrl.report({ q: 'kokomi' })).rows.map((x) => x.sku)).toEqual(['C']);
  });

  it('xuất CSV: BOM UTF-8, mọi dòng cần nhập theo nhà cung cấp, tên file có giờ VN, ghi nhật ký đúng số dòng', async () => {
    const { ctrl, create } = make();
    const out = fakeRes();
    await ctrl.export({ days: 14 }, out.res as never, 'admin-1');
    const body = out.body();
    expect(body.startsWith('﻿Nhà cung cấp,SKU,Sản phẩm,Phân loại,Số lượng đặt,')).toBe(true);
    expect(out.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(out.headers['Content-Disposition']).toMatch(/^attachment; filename="dat-hang-nha-cung-cap-\d{8}-\d{4}\.csv"$/);
    expect(
      body
        .trim()
        .split('\r\n')
        .slice(1)
        .map((l) => l.split(',').slice(0, 2).join('/')),
    ).toEqual(['Kokomi/C', 'Tubu Tree/A']);
    expect(create).toHaveBeenCalledWith({ data: { actorId: 'admin-1', route: 'restock-planner/export', filters: { days: 14 }, rowCount: 2 } });
  });

  it('ghi nhật ký lỗi không làm hỏng file đã gửi', async () => {
    const { ctrl } = make(jest.fn().mockRejectedValue(new Error('db down')));
    const out = fakeRes();
    await expect(ctrl.export({ brand: 'Kokomi' }, out.res as never, 'kho-1')).resolves.toBeUndefined();
    expect(out.body().trim().split('\r\n')).toHaveLength(2);
  });

  it('xuất CSV có trần riêng 6 lượt/phút mỗi người; GET bảng không gắn trần riêng', () => {
    const proto = RestockPlannerController.prototype;
    expect(RESTOCK_EXPORT_PER_MINUTE).toBe(6);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.export)).toBe(RESTOCK_EXPORT_PER_MINUTE);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', proto.export)).toBe(60_000);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.report)).toBeUndefined();
  });

  it('số ngày chỉ nhận các mốc có sẵn; từ khoá ≤ 100 ký tự, nhà cung cấp ≤ 200 ký tự, cả hai được cắt khoảng trắng', () => {
    const errs = (q: object) => validateSync(plainToInstance(RestockPlanQuery, q)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(errs({ days: '45', q: 'nước', brand: 'Tubu Tree' })).toEqual([]);
    expect(errs({ days: '20' })).toContain('Số ngày phải là một trong 14, 21, 30, 45, 60.');
    expect(errs({ q: 'x'.repeat(101) })).toContain('Từ khoá tối đa 100 ký tự.');
    expect(errs({ brand: 'x'.repeat(201) })).toContain('Tên nhà cung cấp tối đa 200 ký tự.');
    const t = plainToInstance(RestockPlanQuery, { q: '  abc ', brand: ' Kokomi ', days: '21' });
    expect([t.q, t.brand, t.days]).toEqual(['abc', 'Kokomi', 21]);
  });

  it('RolesGuard thật: ADMIN và KHO vào được cả bảng lẫn file; CSKH, KE_TOAN, MARKETING, nhân viên chưa có nhóm, khách bị 403', () => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of [RestockPlannerController.prototype.report, RestockPlannerController.prototype.export]) {
      const can = (user: object) => {
        const ctx = {
          switchToHttp: () => ({ getRequest: () => ({ user }) }),
          getHandler: () => handler,
          getClass: () => RestockPlannerController,
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
    }
  });
});
