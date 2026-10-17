import type { PrismaService } from '../../prisma/prisma.service';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { csvCell, csvText, orderCsvChunks, ORDER_CSV_HEADERS, streamCsv, userCsvChunks, EXPORT_BATCH } from './admin-export';
import { BANK_REFUND_IN_PROGRESS, OPEN_REFUND_FOR_EXPORT } from '../orders/refund-queue';

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
    customerRefunds: [],
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
  const bank = { method: 'MANUAL_TRANSFER', kind: 'CANCEL' };
  it.each([
    ['còn khoản chuyển khoản Chờ/Đang chuyển', [bank], 'Đang hoàn tiền'],
    ['mọi khoản đã chuyển xong (hoặc hoàn vào Ví)', [], 'Đã hoàn tiền'],
  ])('REFUNDED, %s → %s', async (_name, openRefunds, expected) => {
    expect(
      await statusCell({ paymentMethod: 'BANK_TRANSFER', status: 'CANCELLED', paymentStatus: 'REFUNDED', customerRefunds: openRefunds }),
    ).toBe(expected);
  });

  it('khoản còn chờ chỉ đổi chữ của đơn đã lật REFUNDED: đơn đã trả tiền (trả một phần về ngân hàng) vẫn "Đã thanh toán"', async () => {
    expect(
      await statusCell({ paymentMethod: 'BANK_TRANSFER', status: 'DELIVERED', paymentStatus: 'PAID', customerRefunds: [{ method: 'MANUAL_TRANSFER', kind: 'RETURN' }] }),
    ).toBe('Đã thanh toán');
  });

  // R6-ADMIN-2: đơn huỷ còn UNPAID nhưng khách đã chuyển tiền về muộn, khoản hoàn đang chờ: không phải "Chưa thanh toán".
  it.each([
    ['LATE_PAYMENT', 'CANCELLED', 'UNPAID', 'Đang hoàn tiền'],
    ['OVERPAYMENT', 'CANCELLED', 'UNPAID', 'Đang hoàn tiền'],
    ['OVERPAYMENT', 'DELIVERED', 'PAID', 'Đã thanh toán'],
  ])('khoản %s đang chờ hoàn, đơn %s/%s → %s', async (kind, status, paymentStatus, expected) => {
    expect(
      await statusCell({ paymentMethod: 'BANK_TRANSFER', status, paymentStatus, customerRefunds: [{ method: 'MANUAL_TRANSFER', kind }] }),
    ).toBe(expected);
  });

  it('chỉ lấy khoản Chờ/Đang chuyển: chuyển khoản Tubu, hoặc tiền về muộn/chuyển dư', async () => {
    const { prisma, findMany } = cursorPrisma(fakeOrders(1), 'order');
    await collect(orderCsvChunks(prisma, {}));
    const select = (findMany.mock.calls[0]![0] as unknown as { select: { customerRefunds: unknown } }).select;
    expect(select.customerRefunds).toEqual({ where: OPEN_REFUND_FOR_EXPORT, select: { method: true, kind: true } });
    expect(BANK_REFUND_IN_PROGRESS).toEqual({ method: 'MANUAL_TRANSFER', status: { in: ['PENDING', 'PROCESSING'] } });
    expect(OPEN_REFUND_FOR_EXPORT).toEqual({
      OR: [BANK_REFUND_IN_PROGRESS, { kind: { in: ['LATE_PAYMENT', 'OVERPAYMENT'] }, status: { in: ['PENDING', 'PROCESSING'] } }],
    });
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

// D1-04a: kế toán/marketing phải thấy đơn đến từ nền tảng nào, kênh nào, CTV nào, gian hàng nào ngay trong file CSV.
describe('cột nguồn đơn trong CSV đơn hàng (D1-04a)', () => {
  const cell = (name: string) => ORDER_CSV_HEADERS.indexOf(name);

  /** Tách một dòng CSV (ô trong nháy kép có thể chứa dấu phẩy và nháy lồng `""`). */
  function parseLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function twoModelPrisma(orders: Record<string, unknown>[], users: Record<string, unknown>[]) {
    const orderFind = jest.fn(async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
      const start = args.cursor ? orders.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
      return orders.slice(start, start + args.take);
    });
    const userFind = jest.fn(async (args: { where: { id: { in: string[] } } }) => users.filter((u) => args.where.id.in.includes(u.id as string)));
    return { prisma: { order: { findMany: orderFind }, user: { findMany: userFind } } as unknown as PrismaService, userFind };
  }

  it('thêm cột Nền tảng, Nguồn đơn, CTV giới thiệu, SĐT CTV, Gian hàng vào CUỐI file (không dịch cột cũ)', () => {
    expect(ORDER_CSV_HEADERS.slice(-5)).toEqual(['Nền tảng', 'Nguồn đơn', 'CTV giới thiệu', 'SĐT CTV', 'Gian hàng']);
    expect(ORDER_CSV_HEADERS.indexOf('Ghi chú')).toBe(ORDER_CSV_HEADERS.length - 6);
  });

  it('đơn gian hàng do khách tự mua qua link CTV: nền tảng, nguồn, CTV, gian hàng, mỗi lô chỉ tra CTV một lần', async () => {
    const base = fakeOrders(3).map((o) => ({ ...o, note: null }));
    const orders = [
      { ...base[0]!, platform: 'miniapp', source: 'storefront', referrerUserId: 'ctv1', storefront: { title: 'Shop Lan' } },
      { ...base[1]!, platform: 'web', source: 'ctv_assisted', referrerUserId: 'ctv1', storefront: { title: 'Shop Lan' } },
      { ...base[2]!, platform: null, source: null, referrerUserId: null, storefront: null },
    ];
    const { prisma, userFind } = twoModelPrisma(orders, [{ id: 'ctv1', fullName: 'Lan CTV', phone: '0987654321' }]);
    const lines = (await collect(orderCsvChunks(prisma, {}))).trimEnd().split('\r\n');
    const r0 = parseLine(lines[1]!);
    const r1 = parseLine(lines[2]!);
    const r2 = parseLine(lines[3]!);
    expect(r0[cell('Nền tảng')]).toBe('Mini App');
    expect(r0[cell('Nguồn đơn')]).toBe('Gian hàng (khách tự mua)');
    expect(r0[cell('CTV giới thiệu')]).toBe('Lan CTV');
    expect(r0[cell('SĐT CTV')]).toBe('="0987654321"');
    expect(r0[cell('Gian hàng')]).toBe('Shop Lan');
    expect(r1[cell('Nền tảng')]).toBe('Web');
    expect(r1[cell('Nguồn đơn')]).toBe('CTV lên đơn hộ');
    expect(r2[cell('Nền tảng')]).toBe('Không rõ');
    expect(r2[cell('Nguồn đơn')]).toBe('Không rõ');
    expect(r2[cell('CTV giới thiệu')]).toBe('');
    expect(r2[cell('Gian hàng')]).toBe('');
    expect(userFind).toHaveBeenCalledTimes(1);
    expect(userFind.mock.calls[0]![0]).toMatchObject({ where: { id: { in: ['ctv1'] } } });
  });

  it('không có đơn nào có CTV thì không tra bảng người dùng', async () => {
    const orders = fakeOrders(2).map((o) => ({ ...o, platform: 'miniapp', source: 'checkout', referrerUserId: null, storefront: null }));
    const { prisma, userFind } = twoModelPrisma(orders, []);
    await collect(orderCsvChunks(prisma, {}));
    expect(userFind).not.toHaveBeenCalled();
  });

  it('tên CTV bắt đầu bằng = bị vô hiệu hoá công thức; mã nguồn lạ in nguyên văn', async () => {
    const [o] = fakeOrders(1);
    const orders = [{ ...o!, platform: 'miniapp', source: 'abc', referrerUserId: 'c', storefront: { title: '=SUM(1)' } }];
    const { prisma } = twoModelPrisma(orders, [{ id: 'c', fullName: '@evil', phone: null }]);
    const csv = await collect(orderCsvChunks(prisma, {}));
    expect(csv).toContain(",abc,'@evil,,'=SUM(1)");
  });
});
