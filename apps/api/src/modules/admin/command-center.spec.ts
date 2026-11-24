import { COMMAND_CENTER_LOW_STOCK_LIST, COMMAND_CENTER_LOW_STOCK_MAX, loadCommandCenter } from './command-center';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../affiliate/affiliate-auto-transfer-config';

type SqlArg = { strings: readonly string[]; values: unknown[] };
const sqlText = (q: SqlArg) => q.strings.join('?');

interface Rows {
  orders?: { bucket: string; n: number; amount: bigint | null }[];
  lowCount?: { n: number; out: number }[];
  lowItems?: { sku: string; product_name: string; variation_name: string; stock: number }[];
  commissions?: { status: string; amount: bigint | null; ctvs: number }[];
}

function fakeDb(rows: Rows) {
  const queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const s = strings.join('?');
    if (s.includes('GROUP BY t.bucket')) return rows.orders ?? [];
    if (s.includes('FILTER (WHERE v.stock <= 0)')) return rows.lowCount ?? [];
    if (s.includes('ORDER BY v.stock ASC')) return rows.lowItems ?? [];
    if (s.includes('FROM commissions c')) return rows.commissions ?? [];
    throw new Error(`truy vấn lạ: ${s} ${JSON.stringify(values)}`);
  });
  return { db: { $queryRaw: queryRaw } as never, queryRaw };
}

/** Lời gọi `$queryRaw` tagged template có đoạn SQL chứa `marker`; mảnh Prisma.sql lồng (LOW_STOCK_SQL) nằm nguyên trong `values`. */
const callOf = (queryRaw: jest.Mock, marker: string) => {
  const call = queryRaw.mock.calls.find((c) => (c[0] as TemplateStringsArray).join('?').includes(marker))!;
  return { strings: call[0] as TemplateStringsArray, values: call.slice(1) as unknown[] };
};
/** SQL đầy đủ của lời gọi, gồm cả mảnh Prisma.sql lồng. */
const fullSql = (q: { strings: readonly string[]; values: unknown[] }) =>
  q.strings.reduce((acc, s, i) => {
    const v = q.values[i];
    const inner = v && typeof v === 'object' && 'strings' in v ? sqlText(v as SqlArg) : i < q.values.length ? '?' : '';
    return acc + s + inner;
  }, '');
const nestedValues = (q: { values: unknown[] }) => q.values.flatMap((v) => (v && typeof v === 'object' && 'values' in v ? (v as SqlArg).values : [v]));

const config = (value: unknown) => {
  const mock = jest.fn(async (_key: string, _fallback?: unknown) => value);
  return { get: mock as unknown as <T>(key: string, fallback?: T) => Promise<T>, mock };
};
// 08:00 giờ VN ngày 24/11/2026.
const NOW = new Date('2026-11-24T01:00:00Z');

describe('loadCommandCenter (thẻ điều phối trang Hôm nay)', () => {
  it('đơn hôm nay chia theo nhóm tiền, tổng = cộng các nhóm; nhóm lạ từ DB rơi vào "other"', async () => {
    const { db } = fakeDb({
      orders: [
        { bucket: 'paid', n: 3, amount: 900_000n },
        { bucket: 'bankTransferUnpaid', n: 2, amount: 400_000n },
        { bucket: 'cod', n: 5, amount: 1_250_000n },
        { bucket: 'cancelled', n: 1, amount: 199_000n },
        { bucket: 'other', n: 1, amount: 100_000n },
        { bucket: 'zzz', n: 2, amount: null },
      ],
    });
    const r = await loadCommandCenter(db, config(true), NOW);
    expect(r.generatedAt).toBe(NOW.toISOString());
    expect(r.ordersToday).toEqual({
      total: 14,
      paid: { count: 3, amount: 900_000 },
      bankTransferUnpaid: { count: 2, amount: 400_000 },
      cod: { count: 5, amount: 1_250_000 },
      cancelled: { count: 1, amount: 199_000 },
      other: { count: 3, amount: 100_000 },
    });
  });

  it('khung ngày theo giờ VN: từ 00:00 hôm nay tới 00:00 hôm sau; luật nhóm xét huỷ/hoàn trước, rồi COD, rồi đã thanh toán, rồi chuyển khoản chưa nhận', async () => {
    const { db, queryRaw } = fakeDb({});
    await loadCommandCenter(db, config(true), NOW);
    const q = callOf(queryRaw, 'GROUP BY t.bucket');
    expect(q.values).toEqual([new Date('2026-11-23T17:00:00Z'), new Date('2026-11-24T17:00:00Z')]);
    const s = sqlText(q);
    const order = ["'cancelled'", "'cod'", "'paid'", "'bankTransferUnpaid'", "'other'"].map((k) => s.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(s).toContain(`o.status IN ('CANCELLED', 'RETURNED') OR o."paymentStatus" IN ('REFUNDED', 'FAILED')`);
    expect(s).toContain(`o."paymentMethod" = 'BANK_TRANSFER' AND o."paymentStatus" = 'UNPAID'`);
  });

  it('hàng sắp hết: chỉ biến thể đang bán của kho Tubu, tồn ≤ 5, tồn thấp nhất trước, liệt kê tối đa 5 tên', async () => {
    const { db, queryRaw } = fakeDb({
      lowCount: [{ n: 9, out: 4 }],
      lowItems: [
        { sku: 'SKU-0', product_name: 'Nước giặt', variation_name: 'Can 5L', stock: 0 },
        { sku: 'SKU-3', product_name: 'Xà phòng', variation_name: 'Hộp', stock: 3 },
      ],
    });
    const r = await loadCommandCenter(db, config(true), NOW);
    expect(r.lowStock).toEqual({
      threshold: COMMAND_CENTER_LOW_STOCK_MAX,
      count: 9,
      outOfStock: 4,
      items: [
        { sku: 'SKU-0', productName: 'Nước giặt', variationName: 'Can 5L', stock: 0 },
        { sku: 'SKU-3', productName: 'Xà phòng', variationName: 'Hộp', stock: 3 },
      ],
    });
    for (const marker of ['FILTER (WHERE v.stock <= 0)', 'ORDER BY v.stock ASC']) {
      const q = callOf(queryRaw, marker);
      const s = fullSql(q);
      expect(s).toContain(`v."isActive" = true`);
      expect(s).toContain(`p."isActive" = true`);
      expect(s).toContain(`p."approvalStatus" = 'APPROVED'`);
      expect(s).toContain(`p.fulfilment = 'TUBU'`);
      expect(s).toContain('v.stock <= ?');
      expect(nestedValues(q)).toContain(COMMAND_CENTER_LOW_STOCK_MAX);
    }
    expect(callOf(queryRaw, 'ORDER BY v.stock ASC').values).toContain(COMMAND_CENTER_LOW_STOCK_LIST);
  });

  it('hoa hồng CTV chưa chi: đã duyệt (đơn đã giao, ngoài lệnh rút cũ), đang giữ, chưa giao; cờ tự chuyển Ví chỉ bật khi đúng true', async () => {
    const { db, queryRaw } = fakeDb({
      commissions: [
        { status: 'APPROVED', amount: 450_000n, ctvs: 3 },
        { status: 'LOCKED', amount: 120_000n, ctvs: 2 },
        { status: 'PENDING', amount: 80_000n, ctvs: 1 },
      ],
    });
    const cfg = config('true');
    const r = await loadCommandCenter(db, cfg, NOW);
    expect(r.ctvPayouts).toEqual({ approvedAmount: 450_000, approvedCtvs: 3, holdingAmount: 120_000, pendingAmount: 80_000, autoWalletTransfer: false });
    expect(cfg.mock).toHaveBeenCalledWith(AFFILIATE_AUTO_WALLET_TRANSFER_KEY, true);
    const s = sqlText(callOf(queryRaw, 'FROM commissions c'));
    expect(s).toContain(`c.status = 'APPROVED' AND c."payoutBatchId" IS NULL AND o.status = 'DELIVERED'`);
    expect(s).toContain(`c.status IN ('PENDING', 'LOCKED')`);
    expect((await loadCommandCenter(db, config(true), NOW)).ctvPayouts.autoWalletTransfer).toBe(true);
  });

  it('DB trống: mọi số bằng 0, không có tên hàng', async () => {
    const { db } = fakeDb({});
    const r = await loadCommandCenter(db, config(false), NOW);
    expect(r.ordersToday.total).toBe(0);
    expect(r.ordersToday.cod).toEqual({ count: 0, amount: 0 });
    expect(r.lowStock).toEqual({ threshold: 5, count: 0, outOfStock: 0, items: [] });
    expect(r.ctvPayouts).toEqual({ approvedAmount: 0, approvedCtvs: 0, holdingAmount: 0, pendingAmount: 0, autoWalletTransfer: false });
  });
});
