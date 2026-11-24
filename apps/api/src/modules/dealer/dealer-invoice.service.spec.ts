import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DealerInvoiceService, DEALER_INVOICE_REQUEST_DAYS, savedInvoiceOf } from './dealer-invoice.service';
import { DealerInvoiceRequestDto, DealerOrderDto, DEALER_INVOICE_BATCH_MAX } from './dto/dealer.dto';
import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const INVOICE = { taxCode: '0312345678', companyName: 'Công ty TNHH Hoa Mai', address: '5 Trần Phú, Đà Nẵng', email: 'ketoan@hoamai.vn' };
const NOW = new Date('2026-11-24T04:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function makePrisma(opts: {
  user?: Record<string, unknown> | null;
  application?: Record<string, unknown> | null;
  orders?: Record<string, unknown>[];
  updateCount?: number | ((where: Record<string, unknown>) => number);
  lockedRow?: Record<string, unknown> | null;
} = {}) {
  const user = opts.user === undefined ? { role: 'DEALER', email: 'chu@hoamai.vn', metadata: { dealerTierId: 'DEALER_1' } } : opts.user;
  const updateMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) => ({
    count: typeof opts.updateCount === 'function' ? opts.updateCount(where) : (opts.updateCount ?? 1),
  }));
  const userUpdate = jest.fn().mockResolvedValue({});
  const queryRaw = jest.fn().mockResolvedValue(
    opts.lockedRow === null ? [] : [opts.lockedRow ?? { role: 'DEALER', metadata: { dealerTierId: 'DEALER_1', segments: ['a'] } }],
  );
  const base: Record<string, unknown> = {
    user: { findUnique: jest.fn().mockResolvedValue(user), update: userUpdate },
    dealerApplication: { findFirst: jest.fn().mockResolvedValue(opts.application ?? null) },
    order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []), updateMany },
    $queryRaw: queryRaw,
  };
  base.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(base));
  return { prisma: base as unknown as PrismaService, updateMany, userUpdate, queryRaw, base };
}

const order = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  code,
  status: 'DELIVERED',
  invoiceStatus: 'NOT_REQUESTED',
  createdAt: new Date(NOW.getTime() - 3 * DAY),
  ...over,
});

describe('savedInvoiceOf', () => {
  it('chỉ nhận thông tin đủ 4 ô và MST đúng dạng', () => {
    expect(savedInvoiceOf({ dealerInvoice: { ...INVOICE, savedAt: 'x' } })).toEqual(INVOICE);
    expect(savedInvoiceOf({ dealerInvoice: { ...INVOICE, taxCode: '123' } })).toBeNull();
    expect(savedInvoiceOf({ dealerInvoice: { ...INVOICE, email: '' } })).toBeNull();
    expect(savedInvoiceOf({ dealerInvoice: 'abc' })).toBeNull();
    expect(savedInvoiceOf(null)).toBeNull();
  });
});

describe('DealerInvoiceService.profile', () => {
  it('đã lưu → trả thông tin đã lưu, saved=true, không đọc hồ sơ đăng ký', async () => {
    const { prisma, base } = makePrisma({ user: { role: 'DEALER', email: 'x@y.vn', metadata: { dealerInvoice: INVOICE } } });
    expect(await new DealerInvoiceService(prisma).profile('d1')).toEqual({ ...INVOICE, saved: true });
    expect((base.dealerApplication as { findFirst: jest.Mock }).findFirst).not.toHaveBeenCalled();
  });

  it('chưa lưu → điền từ hồ sơ đại lý đã duyệt gần nhất + email tài khoản', async () => {
    const { prisma, base } = makePrisma({ application: { businessName: 'Hoa Mai', taxCode: '0312345678-001', address: '5 Trần Phú' } });
    expect(await new DealerInvoiceService(prisma).profile('d1')).toEqual({
      saved: false,
      taxCode: '0312345678-001',
      companyName: 'Hoa Mai',
      address: '5 Trần Phú',
      email: 'chu@hoamai.vn',
    });
    expect((base.dealerApplication as { findFirst: jest.Mock }).findFirst.mock.calls[0]![0].where).toEqual({ userId: 'd1', status: 'APPROVED' });
  });

  it('hồ sơ không có MST hợp lệ, tài khoản không có email → ô trống', async () => {
    const { prisma } = makePrisma({
      user: { role: 'DEALER', email: null, metadata: null },
      application: { businessName: 'Hoa Mai', taxCode: null, address: '5 Trần Phú' },
    });
    expect(await new DealerInvoiceService(prisma).profile('d1')).toMatchObject({ saved: false, taxCode: '', email: '' });
  });

  it('không phải đại lý → Forbidden', async () => {
    const { prisma } = makePrisma({ user: { role: 'CUSTOMER', email: null, metadata: null } });
    await expect(new DealerInvoiceService(prisma).profile('u1')).rejects.toThrow('Tài khoản chưa được duyệt làm đại lý.');
  });
});

describe('DealerInvoiceService.saveProfile', () => {
  it('khoá dòng users rồi gộp vào metadata đang có, giữ dealerTierId và các khoá khác', async () => {
    const { prisma, userUpdate, queryRaw } = makePrisma();
    const r = await new DealerInvoiceService(prisma).saveProfile('d1', INVOICE as never);
    expect(r).toEqual({ ...INVOICE, saved: true });
    expect((queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain('FOR NO KEY UPDATE');
    const data = userUpdate.mock.calls[0]![0].data.metadata;
    expect(data).toMatchObject({ dealerTierId: 'DEALER_1', segments: ['a'], dealerInvoice: INVOICE });
    expect(typeof data.dealerInvoice.savedAt).toBe('string');
  });

  it('metadata không phải object (null, mảng) → bắt đầu từ {}', async () => {
    for (const metadata of [null, ['x']]) {
      const { prisma, userUpdate } = makePrisma({ lockedRow: { role: 'DEALER', metadata } });
      await new DealerInvoiceService(prisma).saveProfile('d1', INVOICE as never);
      expect(Object.keys(userUpdate.mock.calls[0]![0].data.metadata)).toEqual(['dealerInvoice']);
    }
  });

  it('tên công ty hoặc địa chỉ chỉ có khoảng trắng (DTO cắt thành rỗng) → 400, không khoá, không ghi', async () => {
    for (const blank of [{ companyName: '' }, { address: '  ' }]) {
      const { prisma, userUpdate, queryRaw } = makePrisma();
      await expect(new DealerInvoiceService(prisma).saveProfile('d1', { ...INVOICE, ...blank } as never)).rejects.toThrow(
        'Nhập tên công ty và địa chỉ xuất hoá đơn.',
      );
      expect(queryRaw).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
    }
  });

  it('dòng đã khoá không còn là đại lý → Forbidden, không ghi', async () => {
    const { prisma, userUpdate } = makePrisma({ lockedRow: { role: 'CUSTOMER', metadata: null } });
    await expect(new DealerInvoiceService(prisma).saveProfile('d1', INVOICE as never)).rejects.toThrow('Tài khoản chưa được duyệt làm đại lý.');
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('DealerInvoiceService.requestInvoices', () => {
  it('ghi yêu cầu cho đơn đủ điều kiện, bỏ đơn không đủ kèm lý do, giữ thứ tự gửi và bỏ mã trùng', async () => {
    const { prisma, updateMany, base } = makePrisma({
      orders: [
        order('DL1'),
        order('DL2', { invoiceStatus: null }),
        order('DL3', { status: 'CANCELLED' }),
        order('DL4', { invoiceStatus: 'REQUESTED' }),
        order('DL5', { invoiceStatus: 'ISSUED' }),
        order('DL6', { createdAt: new Date(NOW.getTime() - (DEALER_INVOICE_REQUEST_DAYS + 1) * DAY) }),
      ],
    });
    const r = await new DealerInvoiceService(prisma).requestInvoices(
      'd1',
      { orderCodes: ['DL1', ' DL2 ', 'DL1', 'DL3', 'DL4', 'DL5', 'DL6', 'KHAC'], invoice: INVOICE as never },
      NOW,
    );
    expect(r.requested).toEqual(['DL1', 'DL2']);
    expect(r.skipped).toEqual([
      { code: 'DL3', reason: 'Đơn đã huỷ hoặc trả hàng.' },
      { code: 'DL4', reason: 'Đơn đã có yêu cầu hoá đơn.' },
      { code: 'DL5', reason: 'Đơn đã có hoá đơn.' },
      { code: 'DL6', reason: 'Đơn đặt quá 30 ngày, bạn liên hệ Tubu Tree để xuất hoá đơn.' },
      { code: 'KHAC', reason: 'Không tìm thấy đơn đại lý này.' },
    ]);
    expect(r.profile).toBeNull();
    // Chỉ đọc đơn đại lý của chính người gửi.
    expect((base.order as { findMany: jest.Mock }).findMany.mock.calls[0]![0].where).toMatchObject({ userId: 'd1', type: 'DEALER' });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0]![0]).toEqual({
      where: {
        id: 'id-DL1',
        userId: 'd1',
        type: 'DEALER',
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        OR: [{ invoiceStatus: null }, { invoiceStatus: 'NOT_REQUESTED' }],
      },
      data: { invoiceRequest: INVOICE, invoiceStatus: 'REQUESTED' },
    });
  });

  it('lệnh ghi có điều kiện không trúng (vừa có yêu cầu khác / vừa huỷ) → báo bỏ qua, không báo đã gửi', async () => {
    const { prisma } = makePrisma({ orders: [order('DL1'), order('DL2')], updateCount: (w) => (w.id === 'id-DL2' ? 0 : 1) });
    const r = await new DealerInvoiceService(prisma).requestInvoices('d1', { orderCodes: ['DL1', 'DL2'], invoice: INVOICE as never }, NOW);
    expect(r.requested).toEqual(['DL1']);
    expect(r.skipped).toEqual([{ code: 'DL2', reason: 'Đơn vừa đổi trạng thái, bạn tải lại để xem.' }]);
  });

  it('thông tin thiếu tên công ty → 400, không ghi đơn nào', async () => {
    const { prisma, updateMany } = makePrisma({ orders: [order('DL1')] });
    await expect(
      new DealerInvoiceService(prisma).requestInvoices('d1', { orderCodes: ['DL1'], invoice: { ...INVOICE, companyName: '' } as never }, NOW),
    ).rejects.toThrow('Nhập tên công ty và địa chỉ xuất hoá đơn.');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('save=true → lưu thông tin làm mặc định và trả hồ sơ mới', async () => {
    const { prisma, userUpdate } = makePrisma({ orders: [order('DL1')] });
    const r = await new DealerInvoiceService(prisma).requestInvoices('d1', { orderCodes: ['DL1'], invoice: INVOICE as never, save: true }, NOW);
    expect(r.profile).toEqual({ ...INVOICE, saved: true });
    expect(userUpdate.mock.calls[0]![0].data.metadata.dealerInvoice).toMatchObject(INVOICE);
  });

  it('không phải đại lý → Forbidden, không đọc/ghi đơn', async () => {
    const { prisma, updateMany } = makePrisma({ user: { role: 'CUSTOMER', email: null, metadata: null } });
    await expect(
      new DealerInvoiceService(prisma).requestInvoices('u1', { orderCodes: ['DL1'], invoice: INVOICE as never }, NOW),
    ).rejects.toThrow('Tài khoản chưa được duyệt làm đại lý.');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('DTO hoá đơn đại lý', () => {
  const errorsOf = async (cls: new () => object, body: unknown) =>
    (await validate(plainToInstance(cls, body) as object)).map((e) => e.property);

  it('DealerInvoiceRequestDto: cần 1..50 mã đơn và thông tin hoá đơn hợp lệ', async () => {
    expect(await errorsOf(DealerInvoiceRequestDto, { orderCodes: ['DL1'], invoice: INVOICE, save: true })).toEqual([]);
    expect(await errorsOf(DealerInvoiceRequestDto, { orderCodes: [], invoice: INVOICE })).toEqual(['orderCodes']);
    const tooMany = Array.from({ length: DEALER_INVOICE_BATCH_MAX + 1 }, (_, i) => `DL${i}`);
    expect(await errorsOf(DealerInvoiceRequestDto, { orderCodes: tooMany, invoice: INVOICE })).toEqual(['orderCodes']);
    expect(await errorsOf(DealerInvoiceRequestDto, { orderCodes: ['DL1'], invoice: { ...INVOICE, taxCode: '12345' } })).toEqual(['invoice']);
    expect(await errorsOf(DealerInvoiceRequestDto, { orderCodes: ['DL1'], invoice: { ...INVOICE, email: 'sai' } })).toEqual(['invoice']);
  });

  it('DealerOrderDto: invoiceRequest tuỳ chọn, có thì phải hợp lệ', async () => {
    const order = { items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: 'PREPAID' };
    expect(await errorsOf(DealerOrderDto, order)).toEqual([]);
    expect(await errorsOf(DealerOrderDto, { ...order, invoiceRequest: INVOICE })).toEqual([]);
    expect(await errorsOf(DealerOrderDto, { ...order, invoiceRequest: { ...INVOICE, companyName: undefined } })).toEqual(['invoiceRequest']);
  });
});

describe('DealerService.placeOrder — yêu cầu hoá đơn VAT', () => {
  const RULES_OFF: Record<string, unknown> = {
    'dealer.min_order_value_vnd': 0,
    'dealer.shipping_fee_below_threshold_vnd': 0,
    'dealer.block_credit_when_overdue': false,
  };
  const config = { get: async <T>(key: string, fb?: T): Promise<T> => (key in RULES_OFF ? RULES_OFF[key] : fb) as T } as unknown as SystemConfigService;

  function prismaForOrder() {
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const base: Record<string, unknown> = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: null }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
      variation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v1', isActive: true, retailPrice: 100000, dealerPrices: null, name: '500ml', product: { name: 'SP', isActive: true, approvalStatus: 'APPROVED' } },
        ]),
      },
      order: { create: orderCreate, findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', items: [] }) },
      dealerCreditLedger: { aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }), create: jest.fn().mockResolvedValue({}) },
      address: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'a1', recipient: 'A', phone: '0911111111', street: '1', ward: 'P', district: '', province: 'ĐN', provinceCode: 'x', districtCode: '', wardCode: 'y',
        }),
      },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn(async (_s: unknown, ...vals: unknown[]) => [{ reserved: (vals.find((v) => typeof v === 'number') as number | undefined) ?? 0 }]),
    };
    base.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(base));
    return { prisma: base as unknown as PrismaService, orderCreate };
  }

  it('có invoiceRequest → đơn lưu yêu cầu và vào hàng chờ xuất hoá đơn (REQUESTED)', async () => {
    const { prisma, orderCreate } = prismaForOrder();
    await new DealerService(prisma, config).placeOrder('d1', {
      items: [{ variationId: 'v1', quantity: 1 }],
      paymentMethod: 'PREPAID',
      invoiceRequest: INVOICE,
    } as never);
    expect(orderCreate.mock.calls[0]![0].data).toMatchObject({ invoiceRequest: INVOICE, invoiceStatus: 'REQUESTED' });
  });

  it('invoiceRequest thiếu địa chỉ → 400, không tạo đơn', async () => {
    const { prisma, orderCreate } = prismaForOrder();
    await expect(
      new DealerService(prisma, config).placeOrder('d1', {
        items: [{ variationId: 'v1', quantity: 1 }],
        paymentMethod: 'PREPAID',
        invoiceRequest: { ...INVOICE, address: '' },
      } as never),
    ).rejects.toThrow('Nhập tên công ty và địa chỉ xuất hoá đơn.');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('không có invoiceRequest → không ghi hai cột hoá đơn (giữ mặc định NOT_REQUESTED)', async () => {
    const { prisma, orderCreate } = prismaForOrder();
    await new DealerService(prisma, config).placeOrder('d1', { items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: 'PREPAID' } as never);
    const data = orderCreate.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('invoiceRequest');
    expect(data).not.toHaveProperty('invoiceStatus');
  });
});
