import type { PrismaService } from '../../prisma/prisma.service';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { csvCell, csvText, orderCsvChunks, ORDER_CSV_HEADERS, streamCsv, userCsvChunks, EXPORT_BATCH } from './admin-export';
import { BANK_REFUND_IN_PROGRESS } from '../orders/refund-queue';

/** ADMINOPS-12: file CSV cho kế toán phải có MỌI đơn khớp bộ lọc, không chỉ 20 đơn của trang đang xem. */
function fakeOrders(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `o${String(i).padStart(5, '0')}`,
    code: `TB${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 3, 0, 0) - i * 60_000),
    status: 'DELIVERED',
    type: 'RETAIL',
    fulfiller: 'TUBU',
    paymentMethod: 'COD',
    paymentStatus: 'PAID',
    subtotal: 100_000,
    discount: 0,
    shippingFee: 20_000,
    pointsUsed: 0,
    total: 120_000,
    shippingCode: null,
    shippingPartner: null,
    pancakeOrderId: null,
    note: i === 0 ? '=HYPERLINK("http://x")' : null,
    hasRecyclingPickup: false,
    gomdonStatus: null,
    gomdonPartnerCode: null,
    deliveredAt: null,
    shippingAddress: { recipient: 'A, B', phone: '0900000000' },
    user: { fullName: 'Khách "Một"', phone: '0911111111' },
    fulfillerStorefront: null,
    items: [{ quantity: 2 }, { quantity: 1 }],
    _count: { customerRefunds: 0 },
  }));
}

function cursorPrisma(rows: ({ id: string } & Record<string, unknown>)[], model: 'order' | 'user') {
  const findMany = jest.fn(async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
    const start = args.cursor ? rows.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
    return rows.slice(start, start + args.take);
  });
  return { prisma: { [model]: { findMany } } as unknown as PrismaService, findMany };
}

async function collect(gen: AsyncGenerator<string>) {
  let out = '';
  for await (const c of gen) out += c;
  return out;
}

describe('orderCsvChunks', () => {
  it('xuất đủ mọi đơn qua nhiều lô (không dừng ở trang 20), mỗi đơn đúng một dòng', async () => {
    const n = EXPORT_BATCH * 2 + 37;
    const { prisma, findMany } = cursorPrisma(fakeOrders(n), 'order');
    const csv = await collect(orderCsvChunks(prisma, { status: 'DELIVERED' }));
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(n + 1);
    expect(lines[0]).toContain('Mã đơn');
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { status: 'DELIVERED' }, take: EXPORT_BATCH });
    expect(new Set(lines.slice(1).map((l) => l.split(',')[0])).size).toBe(n);
  });

  it('ô bắt đầu bằng = bị vô hiệu hoá công thức, dấu phẩy/nháy được bao đúng', async () => {
    const { prisma } = cursorPrisma(fakeOrders(1), 'order');
    const csv = await collect(orderCsvChunks(prisma, {}));
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('"Khách ""Một"""');
    expect(csv).toContain('"A, B"');
  });
});

// R3-UI-3: đơn COD đã giao giữ paymentStatus UNPAID (chốt hoàn tiền một lần) nhưng bưu tá đã thu tiền: CSV phải ghi như giao diện
// ("Đã thu COD"), không ghi "Chưa thanh toán" làm kế toán đòi lại tiền đã thu.
describe('cột Trạng thái TT trong CSV đơn hàng (R3-UI-3)', () => {
  const PAYMENT_STATUS_COL = ORDER_CSV_HEADERS.indexOf('Trạng thái TT');
  async function statusCell(over: Record<string, unknown>) {
    const [o] = fakeOrders(1);
    const { prisma } = cursorPrisma([{ ...o!, ...over }], 'order');
    const line = (await collect(orderCsvChunks(prisma, {}))).split('\r\n')[1]!;
    return line.split(',')[PAYMENT_STATUS_COL + 1];
  }

  // Ô người nhận "A, B" của đơn mẫu có dấu phẩy trong nháy nên lệch một cột khi tách bằng split(',').
  it('COD đã giao còn UNPAID → "Đã thu COD"', async () => {
    expect(await statusCell({ paymentMethod: 'COD', status: 'DELIVERED', paymentStatus: 'UNPAID' })).toBe('Đã thu COD');
  });

  it.each([
    ['COD chưa giao', { paymentMethod: 'COD', status: 'SHIPPING', paymentStatus: 'UNPAID' }, 'Chưa thanh toán'],
    ['COD đã giao nhưng đã lật hoàn tiền', { paymentMethod: 'COD', status: 'DELIVERED', paymentStatus: 'REFUNDED' }, 'Đã hoàn tiền'],
    ['chuyển khoản chưa trả', { paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }, 'Chưa thanh toán'],
    ['chuyển khoản đã giao mà chưa trả (không phải COD)', { paymentMethod: 'BANK_TRANSFER', status: 'DELIVERED', paymentStatus: 'UNPAID' }, 'Chưa thanh toán'],
    ['đã thanh toán', { paymentMethod: 'WALLET', status: 'DELIVERED', paymentStatus: 'PAID' }, 'Đã thanh toán'],
    ['thanh toán lỗi', { paymentMethod: 'ZALOPAY', status: 'CANCELLED', paymentStatus: 'FAILED' }, 'Thanh toán lỗi'],
  ])('%s → %s', async (_name, over, expected) => {
    expect(await statusCell(over)).toBe(expected);
  });

  // R4-ADMIN-1: huỷ đơn chuyển khoản, khách chọn nhận về ngân hàng → đơn lật REFUNDED ngay nhưng tiền còn nằm ở hàng đợi
  // chuyển khoản tay. CSV ghi "Đã hoàn tiền" thì kế toán/CSKH báo khách đã hoàn trong khi chưa ai chuyển.
  it.each([
    ['còn khoản chuyển khoản Chờ/Đang chuyển', 1, 'Đang hoàn tiền'],
    ['mọi khoản đã chuyển xong (hoặc hoàn vào Ví)', 0, 'Đã hoàn tiền'],
  ])('REFUNDED, %s → %s', async (_name, inProgress, expected) => {
    expect(
      await statusCell({ paymentMethod: 'BANK_TRANSFER', status: 'CANCELLED', paymentStatus: 'REFUNDED', _count: { customerRefunds: inProgress } }),
    ).toBe(expected);
  });

  it('khoản còn chờ chỉ đổi chữ của đơn đã lật REFUNDED: đơn đã trả tiền (trả một phần về ngân hàng) vẫn "Đã thanh toán"', async () => {
    expect(
      await statusCell({ paymentMethod: 'BANK_TRANSFER', status: 'DELIVERED', paymentStatus: 'PAID', _count: { customerRefunds: 1 } }),
    ).toBe('Đã thanh toán');
  });

  it('đếm đúng khoản chuyển khoản Chờ/Đang chuyển của đơn (không đếm Ví, đã chuyển, chờ đối soát, bỏ qua)', async () => {
    const { prisma, findMany } = cursorPrisma(fakeOrders(1), 'order');
    await collect(orderCsvChunks(prisma, {}));
    const select = (findMany.mock.calls[0]![0] as unknown as { select: { _count: unknown } }).select;
    expect(select._count).toEqual({ select: { customerRefunds: { where: BANK_REFUND_IN_PROGRESS } } });
    expect(BANK_REFUND_IN_PROGRESS).toEqual({ method: 'MANUAL_TRANSFER', status: { in: ['PENDING', 'PROCESSING'] } });
  });
});

describe('cột SĐT / mã số giữ nguyên số 0 đầu khi mở bằng Excel (R2-ADMINOPS-7)', () => {
  it('SĐT khách, SĐT người nhận, mã vận đơn và mã Pancake dạng số được xuất là văn bản ="…"', async () => {
    const [o] = fakeOrders(1);
    const { prisma } = cursorPrisma([{ ...o!, shippingCode: '0123456789', pancakeOrderId: '00981' }], 'order');
    const cells = (await collect(orderCsvChunks(prisma, {}))).split('\r\n')[1]!;
    expect(cells).toContain('"=""0911111111"""');
    expect(cells).toContain('"=""0900000000"""');
    expect(cells).toContain('"=""0123456789"""');
    expect(cells).toContain('"=""00981"""');
  });

  it('file người dùng: cột SĐT là văn bản', async () => {
    const { prisma } = cursorPrisma(
      [{ id: 'u1', fullName: 'A', phone: '0910039595', role: 'CUSTOMER', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0, isBlocked: false, createdAt: new Date() }],
      'user',
    );
    expect(await collect(userCsvChunks(prisma, undefined))).toContain(',"=""0910039595""",');
  });

  it.each([
    ['0910087109', '"=""0910087109"""'],
    ['+84910087109', '"=""+84910087109"""'],
    ['SPX0900456', 'SPX0900456'],
    ['=cmd|1', "'=cmd|1"],
    [null, ''],
    ['', ''],
  ])('csvText(%p) → %p', (v, out) => {
    expect(csvText(v)).toBe(out);
  });
});

describe('userCsvChunks', () => {
  it('xuất đủ mọi người dùng qua nhiều lô', async () => {
    const rows = Array.from({ length: EXPORT_BATCH + 5 }, (_, i) => ({
      id: `u${String(i).padStart(5, '0')}`,
      fullName: `U${i}`,
      phone: null,
      role: 'CUSTOMER',
      pointsBalance: 1,
      pointsConvertedBalance: 2,
      walletBalance: 0,
      isBlocked: false,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    }));
    const { prisma } = cursorPrisma(rows, 'user');
    const csv = await collect(userCsvChunks(prisma, undefined));
    expect(csv.trimEnd().split('\r\n')).toHaveLength(rows.length + 1);
  });
});

describe('csvCell', () => {
  it.each([
    [null, ''],
    [12, '12'],
    ['+84', "'+84"],
    ['-1', "'-1"],
    ['a\nb', '"a\nb"'],
  ])('%p → %p', (v, out) => {
    expect(csvCell(v)).toBe(out);
  });
});

describe('streamCsv', () => {
  it('đặt header tải file, mở đầu bằng BOM, ghi mọi đoạn rồi đóng', async () => {
    const out = new PassThrough();
    const headers: Record<string, string> = {};
    const res = Object.assign(out, { setHeader: (k: string, v: string) => (headers[k] = v) }) as unknown as Response;
    let body = '';
    out.on('data', (c: Buffer) => (body += c.toString('utf8')));
    async function* gen() {
      yield 'a,b\r\n';
      yield '1,2\r\n';
      yield '3,4\r\n';
    }
    await streamCsv(res, 'don-hang.csv', gen());
    await new Promise((r) => setImmediate(r));
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(headers['Content-Disposition']).toBe('attachment; filename="don-hang.csv"');
    expect(body).toBe('\uFEFFa,b\r\n1,2\r\n3,4\r\n');
  });
});
