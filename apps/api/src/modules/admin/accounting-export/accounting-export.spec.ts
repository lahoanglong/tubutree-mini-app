import 'reflect-metadata';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ACCOUNTING_CSV_HEADERS, countsAsRevenue, discountColumns, refundSumsFor, type AccountingOrder } from './accounting-export';
import { PILOT_CLEANUP_ACTION } from '../golive/golive-pilot';
import { AccountingExportController } from './accounting-export.controller';

function order(code: string, patch: Partial<AccountingOrder> = {}): AccountingOrder {
  return {
    id: `id-${code}`,
    code,
    createdAt: new Date('2026-11-20T03:15:00Z'),
    type: 'RETAIL',
    status: 'DELIVERED',
    fulfiller: 'TUBU',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    subtotal: 300_000,
    discount: 0,
    couponDiscount: 0,
    comboDiscount: 0,
    tierDiscount: 0,
    pointsDiscount: 0,
    pointsUsed: 0,
    shippingFee: 0,
    total: 300_000,
    customerRefunds: [],
    ...patch,
  } as AccountingOrder;
}

/** Đơn mẫu đủ loại: COD đã giao (có giảm), chuyển khoản đã trả rồi trả hàng một phần, đơn huỷ đã hoàn Ví, đơn huỷ còn nợ khách, đơn đại lý. */
const ORDERS = [
  order('TB1001', { subtotal: 320_000, discount: 45_000, couponDiscount: 20_000, comboDiscount: 10_000, tierDiscount: 0, pointsDiscount: 15_000, shippingFee: 30_000, total: 305_000 }),
  order('TB1002', { paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', subtotal: 500_000, total: 500_000 }),
  order('TB1003', { status: 'CANCELLED', paymentMethod: 'WALLET', paymentStatus: 'REFUNDED', subtotal: 199_000, shippingFee: 25_000, total: 224_000 }),
  order('TB1004', {
    status: 'CANCELLED',
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'REFUNDED',
    subtotal: 120_000,
    total: 120_000,
    customerRefunds: [{ method: 'MANUAL_TRANSFER', kind: 'CANCEL', status: 'PENDING' }],
  }),
  order('TB1005', { type: 'DEALER', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', subtotal: 1_000_000, discount: 200_000, tierDiscount: 200_000, total: 800_000 }),
  order('TB1006', { status: 'RETURNED', subtotal: 260_000, total: 260_000 }),
];
const REFUND_GROUPS = [
  { orderId: 'id-TB1002', status: 'COMPLETED', kind: 'RETURN', _sum: { amount: 50_000 } },
  { orderId: 'id-TB1002', status: 'COMPLETED', kind: 'OVERPAYMENT', _sum: { amount: 20_000 } },
  { orderId: 'id-TB1003', status: 'COMPLETED', kind: 'CANCEL', _sum: { amount: 224_000 } },
  { orderId: 'id-TB1004', status: 'PENDING', kind: 'CANCEL', _sum: { amount: 120_000 } },
  // Hoàn trả hàng COD chờ Kế toán đối soát (Pancake "Đã hoàn" khi chưa rõ hãng thu COD) và tiền dư Pancake báo chưa đối chiếu sao kê.
  { orderId: 'id-TB1006', status: 'UNVERIFIED', kind: 'RETURN', _sum: { amount: 260_000 } },
  { orderId: 'id-TB1006', status: 'UNVERIFIED', kind: 'OVERPAYMENT', _sum: { amount: 15_000 } },
];
const RETURNS = [{ orderId: 'id-TB1002', refundAmount: 45_000, shippingRefund: 5_000 }];

function parseCsv(body: string): string[][] {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  return rows;
}

function setup(orders: AccountingOrder[] = ORDERS, opts: { pilotLogs?: { targetIds: string[] }[] } = {}) {
  const orderFind = jest.fn().mockResolvedValueOnce(orders).mockResolvedValue([]);
  const groupBy = jest.fn().mockResolvedValue(REFUND_GROUPS);
  const returnFind = jest.fn().mockResolvedValue(RETURNS);
  const auditFind = jest.fn().mockResolvedValue(opts.pilotLogs ?? []);
  const prisma = { order: { findMany: orderFind }, orderCustomerRefund: { groupBy }, returnRequest: { findMany: returnFind }, adminAuditLog: { findMany: auditFind } };
  const recordExport = jest.fn().mockResolvedValue(undefined);
  const ctrl = new AccountingExportController(prisma as never, { recordExport } as never);
  return { ctrl, orderFind, groupBy, returnFind, auditFind, recordExport };
}

async function download(ctrl: AccountingExportController, q: { from?: string; to?: string }) {
  const out = new PassThrough();
  const headers: Record<string, string> = {};
  const res = Object.assign(out, { setHeader: (k: string, val: string) => (headers[k] = val) }) as unknown as Response;
  let body = '';
  out.on('data', (c: Buffer) => (body += c.toString('utf8')));
  await ctrl.exportAccounting(q, res, 'kt-1');
  await new Promise((r) => setImmediate(r));
  return { body, headers };
}

const col = (name: (typeof ACCOUNTING_CSV_HEADERS)[number]) => ACCOUNTING_CSV_HEADERS.indexOf(name);
const sum = (rows: string[][], name: (typeof ACCOUNTING_CSV_HEADERS)[number]) => rows.reduce((s, r) => s + Number(r[col(name)]), 0);

describe('GET /admin/reports/accounting-export', () => {
  it('CSV UTF-8 có BOM, CRLF, tên file theo khoảng ngày, đúng thứ tự cột; truy vấn theo ngày đặt giờ VN', async () => {
    const { ctrl, orderFind, groupBy, returnFind, auditFind } = setup();
    const { body, headers } = await download(ctrl, { from: '2026-11-01', to: '2026-11-21' });
    expect(body.startsWith('﻿')).toBe(true);
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(headers['Content-Disposition']).toBe('attachment; filename="doi-soat-ke-toan-2026-11-01-2026-11-21.csv"');
    const rows = parseCsv(body.slice(1));
    expect(rows[0]).toEqual([...ACCOUNTING_CSV_HEADERS]);
    expect(rows).toHaveLength(1 + ORDERS.length);
    expect(orderFind.mock.calls[0]![0].where).toEqual({ createdAt: { gte: new Date('2026-10-31T17:00:00.000Z'), lt: new Date('2026-11-21T17:00:00.000Z') } });
    expect(groupBy.mock.calls[0]![0].where).toEqual({ orderId: { in: ORDERS.map((o) => o.id) }, status: { in: ['COMPLETED', 'PENDING', 'PROCESSING', 'UNVERIFIED'] } });
    expect(groupBy.mock.calls[0]![0].by).toEqual(['orderId', 'status', 'kind']);
    expect(returnFind.mock.calls[0]![0].where).toEqual({ orderId: { in: ORDERS.map((o) => o.id) }, status: 'APPROVED' });
    expect(auditFind.mock.calls[0]![0].where).toEqual({ action: PILOT_CLEANUP_ACTION, targetIds: { hasSome: ORDERS.map((o) => o.code) } });
  });

  it('từng dòng: Tiền hàng − CK thương mại − voucher − Điểm Xanh + Phí giao = Khách trả; ngày giờ VN, nhãn tiếng Việt', async () => {
    const { ctrl } = setup();
    const rows = parseCsv((await download(ctrl, { from: '2026-11-01', to: '2026-11-21' })).body.slice(1)).slice(1);
    expect(rows[0]).toEqual(['TB1001', '10:15 20/11/2026', 'Bán lẻ', 'Đã giao hàng', 'COD (Tiền mặt)', 'Đã thu COD', '320000', '10000', '20000', '15000', '30000', '305000', '0', '0', '0', '0', '305000']);
    for (const r of rows) {
      const n = (h: (typeof ACCOUNTING_CSV_HEADERS)[number]) => Number(r[col(h)]);
      expect(n('Tiền hàng (VNĐ)') - n('CK thương mại (VNĐ)') - n('Giảm voucher (VNĐ)') - n('Giảm Điểm Xanh (VNĐ)') + n('Phí giao (VNĐ)')).toBe(n('Khách trả sau giảm (VNĐ)'));
    }
    expect(rows[4]!.slice(0, 4)).toEqual(['TB1005', '10:15 20/11/2026', 'Đại lý', 'Đã xác nhận']);
    expect(rows[4]![col('CK thương mại (VNĐ)')]).toBe('200000');
  });

  it('tổng cột khớp số liệu nguồn: Khách trả = Σ total; Đã hoàn = Σ khoản hoàn COMPLETED của đơn; Hoàn đang chờ = Σ PENDING/PROCESSING; hoàn trả hàng chưa xác minh = Σ RETURN UNVERIFIED; tiền thừa cột riêng; Doanh thu = định nghĩa báo cáo Doanh thu', async () => {
    const { ctrl } = setup();
    const rows = parseCsv((await download(ctrl, {})).body.slice(1)).slice(1);
    expect(sum(rows, 'Khách trả sau giảm (VNĐ)')).toBe(ORDERS.reduce((s, o) => s + o.total, 0));
    expect(sum(rows, 'Đã hoàn khách (VNĐ)')).toBe(50_000 + 224_000);
    expect(sum(rows, 'Hoàn đang chờ chi (VNĐ)')).toBe(120_000);
    expect(sum(rows, 'Hoàn trả hàng chưa xác minh (VNĐ)')).toBe(260_000);
    // Tiền dư Pancake báo còn UNVERIFIED chưa đối chiếu sao kê: không vào cột tiền thừa, không vào cột hoàn trả hàng.
    expect(sum(rows, 'Trả lại tiền chuyển thừa/về muộn (VNĐ)')).toBe(20_000);
    // Doanh thu: TB1001 COD kho Tubu đã giao, TB1002 đã trả trừ phần trả hàng đã duyệt (45.000 + 5.000), TB1005 đại lý đã trả; hai đơn huỷ không tính.
    expect(sum(rows, 'Doanh thu ghi nhận (VNĐ)')).toBe(305_000 + (500_000 - 50_000) + 800_000);
    const byCode = Object.fromEntries(rows.map((r) => [r[0], r]));
    expect(byCode.TB1003![col('Trạng thái TT')]).toBe('Đã hoàn tiền');
    expect(byCode.TB1004![col('Trạng thái TT')]).toBe('Đang hoàn tiền');
    expect(byCode.TB1004![col('Doanh thu ghi nhận (VNĐ)')]).toBe('0');
    expect(byCode.TB1006![col('Hoàn trả hàng chưa xác minh (VNĐ)')]).toBe('260000');
    expect(byCode.TB1006![col('Hoàn đang chờ chi (VNĐ)')]).toBe('0');
    expect(byCode.TB1006![col('Doanh thu ghi nhận (VNĐ)')]).toBe('0');
    // Đơn còn tính doanh thu: Khách trả − Đã hoàn − Hoàn đang chờ = Doanh thu (doanh thu đã trừ phần trả hàng, không trừ thêm lần nữa).
    const n = (code: string, h: (typeof ACCOUNTING_CSV_HEADERS)[number]) => Number(byCode[code]![col(h)]);
    for (const code of ['TB1001', 'TB1002', 'TB1005']) {
      expect(n(code, 'Khách trả sau giảm (VNĐ)') - n(code, 'Đã hoàn khách (VNĐ)') - n(code, 'Hoàn đang chờ chi (VNĐ)')).toBe(n(code, 'Doanh thu ghi nhận (VNĐ)'));
    }
  });

  it('ô chữ mở đầu bằng = + - @ (mã đơn lạ từ nguồn ngoài, phương thức chưa có nhãn) được thêm dấu nháy, không thành công thức', async () => {
    const evil = [
      order('=HYPERLINK("http://x.example","bấm")'),
      order('+84901234567'),
      order('-2+3'),
      order('@SUM(A1:A9)'),
      order('TB2005', { paymentMethod: '=1+1' as never }),
    ];
    const { ctrl } = setup(evil);
    const { body } = await download(ctrl, {});
    const rows = parseCsv(body.slice(1)).slice(1);
    expect(rows.map((r) => r[0])).toEqual([`'=HYPERLINK("http://x.example","bấm")`, "'+84901234567", "'-2+3", "'@SUM(A1:A9)", 'TB2005']);
    expect(rows[4]![col('Phương thức TT')]).toBe("'=1+1");
    expect(body).not.toMatch(/(^|,)[=+\-@]/m);
  });

  it('tiêu đề cột mới đi qua csvCell và đứng ngay sau "Hoàn đang chờ chi", trước tiền chuyển thừa và Doanh thu ghi nhận', async () => {
    const { ctrl } = setup();
    const header = parseCsv((await download(ctrl, {})).body.slice(1))[0]!;
    expect(header.slice(12, 17)).toEqual([
      'Đã hoàn khách (VNĐ)',
      'Hoàn đang chờ chi (VNĐ)',
      'Hoàn trả hàng chưa xác minh (VNĐ)',
      'Trả lại tiền chuyển thừa/về muộn (VNĐ)',
      'Doanh thu ghi nhận (VNĐ)',
    ]);
  });

  it('đơn thử Giờ G đã dọn (ARCHIVE: đã giao, đã thu) góp 0đ Doanh thu ghi nhận, ghi rõ ở Loại đơn; đơn thật cùng lô vẫn tính', async () => {
    const archived = order('TB3001', { paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 450_000, subtotal: 450_000 });
    const archivedCod = order('TB3002', { total: 199_000, subtotal: 199_000 });
    const real = order('TB3003', { total: 299_000, subtotal: 299_000 });
    const { ctrl, auditFind } = setup([archived, archivedCod, real], {
      pilotLogs: [{ targetIds: ['TB3001', 'TB9999'] }, { targetIds: ['TB3002'] }],
    });
    const rows = parseCsv((await download(ctrl, {})).body.slice(1)).slice(1);
    const byCode = Object.fromEntries(rows.map((r) => [r[0], r]));
    expect(auditFind.mock.calls[0]![0].where).toEqual({ action: PILOT_CLEANUP_ACTION, targetIds: { hasSome: ['TB3001', 'TB3002', 'TB3003'] } });
    expect(byCode.TB3001![col('Doanh thu ghi nhận (VNĐ)')]).toBe('0');
    expect(byCode.TB3002![col('Doanh thu ghi nhận (VNĐ)')]).toBe('0');
    expect(byCode.TB3001![col('Loại đơn')]).toBe('Bán lẻ (đơn thử đã dọn)');
    expect(byCode.TB3003![col('Loại đơn')]).toBe('Bán lẻ');
    expect(byCode.TB3001![col('Khách trả sau giảm (VNĐ)')]).toBe('450000');
    expect(sum(rows, 'Doanh thu ghi nhận (VNĐ)')).toBe(299_000);
  });

  it('ghi nhật ký xuất với người xuất, route, khoảng ngày và số dòng dữ liệu', async () => {
    const { ctrl, recordExport } = setup();
    await download(ctrl, { from: '2026-11-01', to: '2026-11-21' });
    expect(recordExport).toHaveBeenCalledWith('kt-1', 'reports/accounting-export', { from: '2026-11-01', to: '2026-11-21' }, ORDERS.length);
  });

  it('khoảng ngày quá 366 ngày hoặc ngược thì 400, không truy vấn', async () => {
    const { ctrl, orderFind } = setup();
    await expect(download(ctrl, { from: '2025-01-01', to: '2026-11-21' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(download(ctrl, { from: '2026-11-21', to: '2026-11-01' })).rejects.toBeInstanceOf(BadRequestException);
    expect(orderFind).not.toHaveBeenCalled();
  });

  it('RolesGuard thật: chỉ ADMIN và KE_TOAN; CSKH, KHO, MARKETING (kể cả gộp), nhân viên chưa có nhóm, khách bị 403', () => {
    const guard = new RolesGuard(new Reflector());
    const can = (user: object) => {
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => AccountingExportController.prototype.exportAccounting,
        getClass: () => AccountingExportController,
      } as unknown as ExecutionContext;
      try {
        return guard.canActivate(ctx);
      } catch (e) {
        if (e instanceof ForbiddenException) return false;
        throw e;
      }
    };
    expect(can({ role: 'ADMIN' })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['KE_TOAN'] })).toBe(true);
    expect(can({ role: 'STAFF', staffPermissions: ['CSKH', 'KHO', 'MARKETING'] })).toBe(false);
    expect(can({ role: 'STAFF', staffPermissions: [] })).toBe(false);
    for (const role of ['CUSTOMER', 'AFFILIATE', 'DEALER', 'MERCHANT']) expect(can({ role, staffPermissions: ['KE_TOAN'] })).toBe(false);
  });
});

describe('quy tắc cột tiền', () => {
  it('ba cột giảm luôn cộng lại bằng tổng giảm, kể cả đơn cũ chỉ có tổng discount', () => {
    const cases = [
      { subtotal: 300_000, discount: 45_000, couponDiscount: 20_000, comboDiscount: 10_000, tierDiscount: 0, pointsDiscount: 15_000, pointsUsed: 15_000, shippingFee: 0 },
      { subtotal: 300_000, discount: 30_000, couponDiscount: 0, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 12_000, shippingFee: 0 },
      { subtotal: 300_000, discount: 10_000, couponDiscount: 25_000, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 0, shippingFee: 0 },
    ];
    for (const c of cases) {
      const d = discountColumns(c);
      expect(d.commercial + d.voucher + d.points).toBe(c.discount);
      expect(Math.min(d.commercial, d.voucher, d.points)).toBeGreaterThanOrEqual(0);
    }
    expect(discountColumns(cases[1]!)).toEqual({ commercial: 18_000, voucher: 0, points: 12_000 });
  });

  it('doanh thu ghi nhận theo đúng REVENUE_ORDER_WHERE', () => {
    const base = { status: 'DELIVERED', paymentStatus: 'UNPAID', paymentMethod: 'COD', fulfiller: 'TUBU' } as const;
    expect(countsAsRevenue(base)).toBe(true);
    expect(countsAsRevenue({ ...base, fulfiller: 'MERCHANT' })).toBe(false);
    expect(countsAsRevenue({ ...base, status: 'SHIPPING' })).toBe(false);
    expect(countsAsRevenue({ ...base, status: 'SHIPPING', paymentStatus: 'PAID', paymentMethod: 'BANK_TRANSFER' })).toBe(true);
    expect(countsAsRevenue({ ...base, paymentStatus: 'PAID', status: 'RETURNED' })).toBe(false);
    expect(countsAsRevenue({ ...base, paymentStatus: 'REFUNDED', status: 'CONFIRMED' })).toBe(false);
    expect(countsAsRevenue(base, true)).toBe(false);
    expect(countsAsRevenue({ ...base, status: 'SHIPPING', paymentStatus: 'PAID', paymentMethod: 'BANK_TRANSFER' }, true)).toBe(false);
  });

  it('refundSumsFor: RETURN UNVERIFIED vào cột chưa xác minh; OVERPAYMENT UNVERIFIED không vào cột nào; COMPLETED/PENDING như cũ', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { orderId: 'o1', status: 'UNVERIFIED', kind: 'RETURN', _sum: { amount: 100_000 } },
      { orderId: 'o1', status: 'COMPLETED', kind: 'RETURN', _sum: { amount: 30_000 } },
      { orderId: 'o2', status: 'UNVERIFIED', kind: 'OVERPAYMENT', _sum: { amount: 5_000 } },
      { orderId: 'o2', status: 'PROCESSING', kind: 'LATE_PAYMENT', _sum: { amount: 7_000 } },
    ]);
    const m = await refundSumsFor({ orderCustomerRefund: { groupBy } } as never, ['o1', 'o2']);
    expect(m.get('o1')).toEqual({ completed: 30_000, pending: 0, unverified: 100_000, extra: 0 });
    expect(m.get('o2')).toEqual({ completed: 0, pending: 0, unverified: 0, extra: 7_000 });
  });
});
