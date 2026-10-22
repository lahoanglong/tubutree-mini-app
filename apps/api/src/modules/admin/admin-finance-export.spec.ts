import type { PrismaService } from '../../prisma/prisma.service';
import { EXPORT_BATCH } from './admin-export';
import {
  PAYOUT_CSV_HEADERS,
  PIT_CSV_HEADERS,
  REFUND_CSV_HEADERS,
  payoutCsvChunks,
  payoutExportWhere,
  pitCsvChunks,
  refundCsvChunks,
  refundExportWhere,
} from './admin-finance-export';

async function collect(gen: AsyncGenerator<string>) {
  let out = '';
  for await (const c of gen) out += c;
  return out;
}

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

function cursorModel(rows: ({ id: string } & Record<string, unknown>)[]) {
  return jest.fn(async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
    const start = args.cursor ? rows.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
    return rows.slice(start, start + args.take);
  });
}

const RANGE = { start: new Date('2026-09-30T17:00:00Z'), end: new Date('2026-10-31T17:00:00Z') };

describe('pitCsvChunks (TNCN CTV, D1-14)', () => {
  const col = (name: string) => PIT_CSV_HEADERS.indexOf(name);

  it('mỗi người nhận một dòng với đúng cột của bảng trên màn; MST/SĐT giữ số 0 đầu; thiếu MST khi có khấu trừ thì ghi chú', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { user_id: 'u1', full_name: 'Lan, CTV', phone: '0987654321', tax_id: '001203004005', payout_count: 3, gross: 3_000_000n, tax_withheld: 300_000n, net: 2_700_000n },
      { user_id: 'u2', full_name: '=Evil', phone: null, tax_id: null, payout_count: 1, gross: 2_500_000n, tax_withheld: 250_000n, net: 2_250_000n },
      { user_id: 'u3', full_name: null, phone: null, tax_id: null, payout_count: 1, gross: 500_000n, tax_withheld: 0n, net: 500_000n },
    ]);
    const lines = (await collect(pitCsvChunks({ $queryRaw: queryRaw } as unknown as PrismaService, RANGE))).trimEnd().split('\r\n');
    expect(lines[0]).toBe(PIT_CSV_HEADERS.join(','));
    expect(lines).toHaveLength(4);
    const r1 = parseLine(lines[1]!);
    expect(r1[col('Người nhận')]).toBe('Lan, CTV');
    expect(r1[col('SĐT')]).toBe('="0987654321"');
    expect(r1[col('MST/CCCD')]).toBe('="001203004005"');
    expect(r1[col('Số lần chi')]).toBe('3');
    expect(r1[col('Thu nhập (VNĐ)')]).toBe('3000000');
    expect(r1[col('Thuế TNCN đã khấu trừ (VNĐ)')]).toBe('300000');
    expect(r1[col('Thực nhận (VNĐ)')]).toBe('2700000');
    expect(r1[col('Ghi chú')]).toBe('');
    const r2 = parseLine(lines[2]!);
    expect(r2[col('Người nhận')]).toBe("'=Evil");
    expect(r2[col('Ghi chú')]).toBe('Thiếu MST/CCCD');
    expect(parseLine(lines[3]!)[col('Ghi chú')]).toBe('');
  });

  it('truy vấn gộp theo người nhận trong [start, end), chỉ lệnh đã chi có thu nhập gộp', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    await collect(pitCsvChunks({ $queryRaw: queryRaw } as unknown as PrismaService, RANGE));
    const strings = (queryRaw.mock.calls[0]![0] as { strings: string[] }).strings.join('?');
    expect(strings).toContain(`p.status = 'PAID'`);
    expect(strings).toContain('"grossAmount" IS NOT NULL');
    expect(strings).toContain('GROUP BY');
    // Thuế thực giữ = taxWithheld − taxRefunded; thu nhập = thuế thực giữ + thực nhận nên phần đã hoàn về Ví cộng vào thực nhận.
    expect(strings).toContain('SUM(p."taxWithheld" - p."taxRefunded")');
    expect(strings).toContain('SUM(p.amount + p."taxRefunded")');
    expect((queryRaw.mock.calls[0]![0] as { values: unknown[] }).values).toEqual(expect.arrayContaining([RANGE.start, RANGE.end]));
  });
});

describe('payoutExportWhere / payoutCsvChunks (danh sách rút tiền, D1-14)', () => {
  it('lọc theo ngày yêu cầu [start, end) và trạng thái nếu có', () => {
    expect(payoutExportWhere(RANGE)).toEqual({ requestedAt: { gte: RANGE.start, lt: RANGE.end } });
    expect(payoutExportWhere(RANGE, 'PAID')).toEqual({ requestedAt: { gte: RANGE.start, lt: RANGE.end }, status: 'PAID' });
  });

  const payout = (i: number, over: Record<string, unknown> = {}) => ({
    id: `p${String(i).padStart(5, '0')}`,
    userId: 'u1',
    amount: 900_000,
    fee: 10_000,
    grossAmount: 1_000_000,
    taxWithheld: 90_000,
    taxRefunded: 0,
    taxId: '0123456789',
    method: 'BANK',
    bankInfo: { bankName: 'Vietcombank', accountNumber: '0011223344', accountName: 'NGUYEN VAN LAN' },
    status: 'PAID',
    requestedAt: new Date('2026-10-05T03:00:00Z'),
    reviewedAt: new Date('2026-10-05T04:00:00Z'),
    paidAt: new Date('2026-10-06T03:00:00Z'),
    bankRef: 'FT26280001',
    rejectionReason: null,
    adminNote: '=cmd|x',
    user: { fullName: 'Lan CTV', phone: '0987654321' },
    ...over,
  });

  it('mỗi lệnh một dòng đủ số tiền, tài khoản nhận, mã giao dịch; rút ví (không có thu nhập gộp) ghi loại riêng; ô công thức bị vô hiệu', async () => {
    const findMany = cursorModel([payout(1), payout(2, { grossAmount: null, taxWithheld: 0, taxId: null, bankInfo: null, status: 'REJECTED', paidAt: null, rejectionReason: 'Sai STK', bankRef: null })]);
    const csv = await collect(payoutCsvChunks({ payout: { findMany } } as unknown as PrismaService, {}));
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(PAYOUT_CSV_HEADERS.join(','));
    const col = (n: string) => PAYOUT_CSV_HEADERS.indexOf(n);
    const a = parseLine(lines[1]!);
    expect(a[col('Mã lệnh')]).toBe('p00001');
    expect(a[col('Loại')]).toBe('Hoa hồng CTV');
    expect(a[col('Thu nhập gộp (VNĐ)')]).toBe('1000000');
    expect(a[col('Thuế TNCN (VNĐ)')]).toBe('90000');
    expect(a[col('Thuế đã hoàn về Ví (VNĐ)')]).toBe('0');
    expect(a[col('Phí chuyển khoản (VNĐ)')]).toBe('10000');
    expect(a[col('Thực nhận (VNĐ)')]).toBe('900000');
    expect(a[col('Trạng thái')]).toBe('Đã chuyển khoản');
    expect(a[col('Số tài khoản')]).toBe('="0011223344"');
    expect(a[col('Ngân hàng')]).toBe('Vietcombank');
    expect(a[col('Mã giao dịch ngân hàng')]).toBe('FT26280001');
    expect(a[col('Ghi chú admin')]).toBe("'=cmd|x");
    expect(a[col('Ngày yêu cầu')]).toBe('10:00 05/10/2026');
    expect(a[col('Ngày chuyển khoản')]).toBe('10:00 06/10/2026');
    const b = parseLine(lines[2]!);
    expect(b[col('Loại')]).toBe('Rút Ví Tubu hoặc lệnh cũ');
    expect(b[col('Thu nhập gộp (VNĐ)')]).toBe('');
    expect(b[col('Trạng thái')]).toBe('Bị từ chối (đã hoàn)');
    expect(b[col('Lý do từ chối')]).toBe('Sai STK');
    expect(b[col('Số tài khoản')]).toBe('');
  });

  it('lệnh đã được hoàn thuế giữ dư: cột Thuế TNCN là thuế thực giữ, số đã hoàn ghi riêng, thực nhận vẫn là số đã chuyển khoản', async () => {
    const findMany = cursorModel([payout(1, { taxWithheld: 250_000, taxRefunded: 250_000, amount: 750_000, fee: 0, grossAmount: 1_000_000 })]);
    const csv = await collect(payoutCsvChunks({ payout: { findMany } } as unknown as PrismaService, {}));
    const a = parseLine(csv.trimEnd().split('\r\n')[1]!);
    const col = (n: string) => PAYOUT_CSV_HEADERS.indexOf(n);
    expect(a[col('Thuế TNCN (VNĐ)')]).toBe('0');
    expect(a[col('Thuế đã hoàn về Ví (VNĐ)')]).toBe('250000');
    expect(a[col('Thực nhận (VNĐ)')]).toBe('750000');
  });

  it('đọc theo lô con trỏ, không dựng cả file trong bộ nhớ', async () => {
    const n = EXPORT_BATCH + 3;
    const findMany = cursorModel(Array.from({ length: n }, (_, i) => payout(i)));
    const csv = await collect(payoutCsvChunks({ payout: { findMany } } as unknown as PrismaService, { status: 'PAID' }));
    expect(csv.trimEnd().split('\r\n')).toHaveLength(n + 1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { status: 'PAID' }, take: EXPORT_BATCH });
  });
});

describe('refundExportWhere / refundCsvChunks (danh sách hoàn tiền, D1-14)', () => {
  it('lọc theo ngày tạo khoản hoàn; "Đang mở" = ba trạng thái còn việc; loại khoản nếu có', () => {
    const created = { gte: RANGE.start, lt: RANGE.end };
    expect(refundExportWhere(RANGE)).toEqual({ createdAt: created });
    expect(refundExportWhere(RANGE, 'COMPLETED')).toEqual({ createdAt: created, status: 'COMPLETED' });
    expect(refundExportWhere(RANGE, 'OPEN', 'RETURN')).toEqual({ createdAt: created, status: { in: ['UNVERIFIED', 'PENDING', 'PROCESSING'] }, kind: 'RETURN' });
  });

  const refund = (i: number, over: Record<string, unknown> = {}) => ({
    id: `r${String(i).padStart(5, '0')}`,
    orderCode: `TB${i}`,
    kind: 'RETURN',
    reason: 'RETURNED',
    method: 'MANUAL_TRANSFER',
    status: 'PENDING',
    amount: 250_000,
    recipientName: 'Khách A',
    phone: '0911222333',
    bankName: 'MB',
    bankAccountNo: '0099887766',
    bankAccountName: 'KHACH A',
    createdAt: new Date('2026-10-05T03:00:00Z'),
    completedAt: null,
    bankRef: null,
    adminNote: null,
    ...over,
  });

  it('mỗi khoản một dòng: loại, cách hoàn, trạng thái, số tiền, tài khoản nhận; khoản vào ví ghi "Đã hoàn vào ví"', async () => {
    const findMany = cursorModel([
      refund(1),
      refund(2, { kind: 'CANCEL', reason: 'CANCELLED', method: 'WALLET', status: 'COMPLETED', bankName: null, bankAccountNo: null, bankAccountName: null, completedAt: new Date('2026-10-05T03:01:00Z') }),
      refund(3, { kind: 'LATE_PAYMENT', status: 'UNVERIFIED', recipientName: null, phone: null }),
    ]);
    const lines = (await collect(refundCsvChunks({ orderCustomerRefund: { findMany } } as unknown as PrismaService, {}))).trimEnd().split('\r\n');
    const col = (n: string) => REFUND_CSV_HEADERS.indexOf(n);
    expect(lines[0]).toBe(REFUND_CSV_HEADERS.join(','));
    const a = parseLine(lines[1]!);
    expect(a[col('Mã đơn')]).toBe('TB1');
    expect(a[col('Loại khoản')]).toBe('Trả hàng');
    expect(a[col('Cách hoàn')]).toBe('Chuyển khoản');
    expect(a[col('Trạng thái')]).toBe('Chờ chuyển khoản');
    expect(a[col('Số tiền (VNĐ)')]).toBe('250000');
    expect(a[col('SĐT người nhận')]).toBe('="0911222333"');
    expect(a[col('Số tài khoản')]).toBe('="0099887766"');
    const b = parseLine(lines[2]!);
    expect(b[col('Loại khoản')]).toBe('Huỷ đơn');
    expect(b[col('Cách hoàn')]).toBe('Ví Tubu');
    expect(b[col('Trạng thái')]).toBe('Đã hoàn vào ví');
    expect(b[col('Ngày hoàn xong')]).toBe('10:01 05/10/2026');
    const c = parseLine(lines[3]!);
    expect(c[col('Loại khoản')]).toBe('Tiền về muộn');
    expect(c[col('Trạng thái')]).toBe('Chờ đối soát');
  });

  it('maskPhones: SĐT người nhận chỉ còn 3 số cuối, số tài khoản và tên chủ tài khoản vẫn đủ (kế toán cần để chuyển tiền)', async () => {
    const run = async (opts?: { maskPhones: boolean }) => {
      const findMany = cursorModel([refund(1, { adminNote: 'Khách gọi 0988 777 666' })]);
      const lines = (await collect(refundCsvChunks({ orderCustomerRefund: { findMany } } as unknown as PrismaService, {}, opts))).trimEnd().split('\r\n');
      return parseLine(lines[1]!);
    };
    const col = (n: string) => REFUND_CSV_HEADERS.indexOf(n);
    const masked = await run({ maskPhones: true });
    expect(masked[col('SĐT người nhận')]).toBe('*******333');
    expect(masked[col('Số tài khoản')]).toBe('="0099887766"');
    expect(masked[col('Chủ tài khoản')]).toBe('KHACH A');
    expect(masked[col('Ghi chú admin')]).not.toContain('0988 777 666');
    expect(masked[col('Ghi chú admin')]).toContain('666');
    expect((await run())[col('SĐT người nhận')]).toBe('="0911222333"');
    expect((await run())[col('Ghi chú admin')]).toContain('0988 777 666');
  });

  it('maskPhones: ghi chú giữ số tiền và mã FT…, chỉ che SĐT', async () => {
    const note = 'xác nhận 10.000.000đ/12.500.000đ mã FT26270123456789, gọi 0988 777 666 hoặc 0912345678';
    const findMany = cursorModel([refund(1, { adminNote: note })]);
    const lines = (await collect(refundCsvChunks({ orderCustomerRefund: { findMany } } as unknown as PrismaService, {}, { maskPhones: true }))).trimEnd().split('\r\n');
    const masked = parseLine(lines[1]!)[REFUND_CSV_HEADERS.indexOf('Ghi chú admin')]!;
    expect(masked).toContain('10.000.000đ/12.500.000đ');
    expect(masked).toContain('FT26270123456789');
    expect(masked).not.toContain('0988 777');
    expect(masked).not.toContain('0912345');
    expect(masked).toContain('666');
    expect(masked).toContain('678');
  });
});
