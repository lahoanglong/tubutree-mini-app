import 'reflect-metadata';
import { BadRequestException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminService } from './admin.service';
import { AdminController, IssueInvoiceDto, ListOrdersQuery } from './admin.controller';
import { buildAdminOrderWhere } from './admin-order-filter';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * C-094 (A1-039): đơn yêu cầu hoá đơn VAT được ghi nhận lúc thanh toán (invoiceStatus REQUESTED) nhưng không
 * màn nào xử lý nốt; việc "đã xuất" chỉ đến từ webhook Pancake. Admin cần danh sách đơn VAT + nút xuất.
 */

const REQUEST = { taxCode: '0312345678', companyName: 'Cty ABC', address: '1 Lê Lợi, Q1', email: 'ketoan@abc.vn' };

function mkAdmin(prisma: unknown, notify = jest.fn().mockResolvedValue(undefined)) {
  const svc = new AdminService(
    prisma as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    { notify } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, notify };
}

type FakeOrder = {
  id: string;
  code: string;
  userId: string;
  status: string;
  invoiceRequest: unknown;
  invoiceStatus: string | null;
  invoiceUrl: string | null;
};
const baseOrder = (over: Partial<FakeOrder> = {}): FakeOrder => ({
  id: 'o1',
  code: 'TB-900',
  userId: 'u1',
  status: 'DELIVERED',
  invoiceRequest: REQUEST,
  invoiceStatus: 'REQUESTED',
  invoiceUrl: null,
  ...over,
});

/** Fake order.findFirst/updateMany bám đúng guard `invoiceStatus` như DB thật. */
function fakePrisma(order: FakeOrder | null, opts: { updateCount?: number } = {}) {
  const findFirst = jest.fn(async (_args: unknown) => (order ? { ...order } : null));
  const updateMany = jest.fn(async ({ where, data }: { where: { id: string; OR?: { invoiceStatus: unknown }[] }; data: Partial<FakeOrder> }) => {
    if (!order || where.id !== order.id) return { count: 0 };
    if (opts.updateCount !== undefined) return { count: opts.updateCount };
    if (order.invoiceStatus === 'ISSUED') return { count: 0 };
    Object.assign(order, data);
    return { count: 1 };
  });
  return { prisma: { order: { findFirst, updateMany } }, findFirst, updateMany };
}

describe('buildAdminOrderWhere — lọc đơn yêu cầu hoá đơn VAT', () => {
  it('pending = REQUESTED + FAILED; issued = ISSUED; all = cả ba', () => {
    expect(buildAdminOrderWhere({ invoice: 'pending' })).toEqual({ invoiceStatus: { in: ['REQUESTED', 'FAILED'] } });
    expect(buildAdminOrderWhere({ invoice: 'issued' })).toEqual({ invoiceStatus: 'ISSUED' });
    expect(buildAdminOrderWhere({ invoice: 'all' })).toEqual({ invoiceStatus: { in: ['REQUESTED', 'ISSUED', 'FAILED'] } });
  });

  it('không có bộ lọc → không thêm điều kiện hoá đơn; ghép AND với trạng thái đơn', () => {
    expect(buildAdminOrderWhere({})).toEqual({});
    expect(buildAdminOrderWhere({ status: 'DELIVERED', invoice: 'pending' })).toEqual({
      AND: [{ status: 'DELIVERED' }, { invoiceStatus: { in: ['REQUESTED', 'FAILED'] } }],
    });
  });
});

describe('AdminService.listOrders — tham số invoice', () => {
  it('đẩy bộ lọc xuống where cho cả findMany lẫn count', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { order: { findMany, count }, $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)) };
    const { svc } = mkAdmin(prisma);
    await svc.listOrders(1, 20, undefined, undefined, undefined, 'pending');
    expect(findMany.mock.calls[0][0].where).toEqual({ invoiceStatus: { in: ['REQUESTED', 'FAILED'] } });
    expect(count.mock.calls[0][0].where).toEqual({ invoiceStatus: { in: ['REQUESTED', 'FAILED'] } });
  });
});

describe('AdminService.issueOrderInvoice', () => {
  it('đơn không tồn tại → NotFound', async () => {
    const { prisma } = fakePrisma(null);
    await expect(mkAdmin(prisma).svc.issueOrderInvoice('a1', 'nope', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đơn không có yêu cầu VAT → BadRequest, không ghi gì', async () => {
    const { prisma, updateMany } = fakePrisma(baseOrder({ invoiceRequest: null, invoiceStatus: 'NOT_REQUESTED' }));
    await expect(mkAdmin(prisma).svc.issueOrderInvoice('a1', 'o1', {})).rejects.toThrow(/chưa có yêu cầu/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('hoá đơn đã phát hành → BadRequest (không đè lại, không báo khách lần hai)', async () => {
    const { prisma, updateMany } = fakePrisma(baseOrder({ invoiceStatus: 'ISSUED', invoiceUrl: 'https://hd.vn/1' }));
    const { svc, notify } = mkAdmin(prisma);
    await expect(svc.issueOrderInvoice('a1', 'o1', { invoiceUrl: 'https://hd.vn/2' })).rejects.toThrow(/đã được phát hành/);
    expect(updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('đơn đã huỷ/trả → BadRequest', async () => {
    for (const status of ['CANCELLED', 'RETURNED']) {
      const { prisma, updateMany } = fakePrisma(baseOrder({ status }));
      await expect(mkAdmin(prisma).svc.issueOrderInvoice('a1', 'o1', {})).rejects.toThrow(/huỷ|trả/);
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('xuất kèm link: REQUESTED → ISSUED bằng updateMany có guard, lưu invoiceUrl, báo khách INVOICE_ISSUED', async () => {
    const order = baseOrder();
    const { prisma, updateMany } = fakePrisma(order);
    const { svc, notify } = mkAdmin(prisma);
    const out = await svc.issueOrderInvoice('admin1', 'o1', { invoiceUrl: 'https://hoadon.example.vn/abc' });
    const call = updateMany.mock.calls[0]![0];
    expect(call.where.id).toBe('o1');
    expect(JSON.stringify(call.where)).toContain('ISSUED'); // guard loại đơn đã ISSUED
    expect(call.data).toEqual({ invoiceStatus: 'ISSUED', invoiceUrl: 'https://hoadon.example.vn/abc' });
    expect(order).toMatchObject({ invoiceStatus: 'ISSUED', invoiceUrl: 'https://hoadon.example.vn/abc' });
    expect(notify).toHaveBeenCalledWith('u1', 'INVOICE_ISSUED', { order_code: 'TB-900' });
    expect(out).toMatchObject({ ok: true, order: { code: 'TB-900', invoiceStatus: 'ISSUED', invoiceUrl: 'https://hoadon.example.vn/abc' } });
  });

  it('xuất không link: giữ invoiceUrl cũ (giống webhook Pancake thiếu invoice_url), vẫn ISSUED + báo khách', async () => {
    const order = baseOrder({ invoiceUrl: 'https://cu.example.vn/x' });
    const { prisma, updateMany } = fakePrisma(order);
    const { svc, notify } = mkAdmin(prisma);
    await svc.issueOrderInvoice('admin1', 'o1', {});
    expect(updateMany.mock.calls[0]![0].data).toEqual({ invoiceStatus: 'ISSUED' });
    expect(order.invoiceUrl).toBe('https://cu.example.vn/x');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('FAILED cũng xuất được; tìm theo mã đơn hoặc id', async () => {
    const { prisma, findFirst } = fakePrisma(baseOrder({ invoiceStatus: 'FAILED' }));
    await mkAdmin(prisma).svc.issueOrderInvoice('a1', 'TB-900', {});
    expect(findFirst.mock.calls[0]![0]).toMatchObject({ where: { OR: [{ id: 'TB-900' }, { code: 'TB-900' }] } });
  });

  it('race: hai admin cùng bấm — updateMany count=0 → BadRequest, không báo khách lần hai', async () => {
    const { prisma } = fakePrisma(baseOrder(), { updateCount: 0 });
    const { svc, notify } = mkAdmin(prisma);
    await expect(svc.issueOrderInvoice('a1', 'o1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(notify).not.toHaveBeenCalled();
  });

  it('báo khách lỗi KHÔNG làm hỏng việc đã ghi', async () => {
    const order = baseOrder();
    const { prisma } = fakePrisma(order);
    const { svc } = mkAdmin(prisma, jest.fn().mockRejectedValue(new Error('zns down')));
    const out = await svc.issueOrderInvoice('a1', 'o1', {});
    expect(out.ok).toBe(true);
    expect(order.invoiceStatus).toBe('ISSUED');
  });
});

describe('Controller + DTO — issue-invoice / lọc invoice', () => {
  it('POST /admin/orders/:id/issue-invoice chuyển đúng tham số xuống service', async () => {
    const admin = { issueOrderInvoice: jest.fn().mockResolvedValue({ ok: true }) };
    const ctl = new AdminController(admin as never, {} as never);
    await ctl.issueInvoice('admin1', 'o1', Object.assign(new IssueInvoiceDto(), { invoiceUrl: 'https://hd.vn/1' }));
    expect(admin.issueOrderInvoice).toHaveBeenCalledWith('admin1', 'o1', { invoiceUrl: 'https://hd.vn/1' });
    const proto = AdminController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(METHOD_METADATA, proto.issueInvoice!)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, proto.issueInvoice!)).toBe('orders/:id/issue-invoice');
  });

  it('GET /admin/orders nhận ?invoice=pending|issued|all và chuyển xuống listOrders', async () => {
    const admin = { listOrders: jest.fn().mockResolvedValue({ data: [] }) };
    const ctl = new AdminController(admin as never, {} as never);
    await ctl.orders(Object.assign(new ListOrdersQuery(), { page: 1, limit: 20, invoice: 'pending' }));
    expect(admin.listOrders).toHaveBeenCalledWith(1, 20, undefined, undefined, undefined, 'pending');
    expect(await validate(plainToInstance(ListOrdersQuery, { invoice: 'all' }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListOrdersQuery, { invoice: 'hack' }))).some((e) => e.property === 'invoice')).toBe(true);
  });

  it('IssueInvoiceDto: link tuỳ chọn nhưng phải là https hợp lệ, ≤ 500 ký tự (chặn javascript:/http)', async () => {
    expect(await validate(plainToInstance(IssueInvoiceDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(IssueInvoiceDto, { invoiceUrl: 'https://hoadon.example.vn/abc?x=1' }))).toHaveLength(0);
    for (const bad of ['javascript:alert(1)', 'http://hd.vn/1', 'không phải link', `https://hd.vn/${'a'.repeat(500)}`]) {
      const errs = await validate(plainToInstance(IssueInvoiceDto, { invoiceUrl: bad }));
      expect(errs.some((e) => e.property === 'invoiceUrl')).toBe(true);
    }
  });
});
