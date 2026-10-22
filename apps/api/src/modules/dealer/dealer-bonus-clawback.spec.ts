import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Thu hồi thưởng doanh số quý khi đơn đại lý bị huỷ/trả SAU ngày trả thưởng (cron ngày 10 tháng đầu
 * quý kế tiếp). Trước đây thưởng tính trên doanh số đã chốt lúc cron chạy rồi giữ nguyên mãi: đặt
 * đơn to (trả tiền + đóng gói) cuối quý → nhận thưởng ngày 10 → yêu cầu trả hàng → hoàn tiền về ví,
 * còn khoản thưởng tính trên chính đơn đó vẫn nằm trong công nợ (delta âm).
 *
 * Thu hồi theo PHẦN BIÊN của chính đơn bị huỷ (không tính lại cả quý): quý trả thưởng theo quy tắc
 * CŨ (mọi đơn chưa huỷ đều tính) mà tính lại cả quý theo quy tắc mới thì lần huỷ đầu tiên thu hồi
 * luôn phần chênh giữa 2 quy tắc — tức phạt đại lý vì một thay đổi chính sách, không vì đơn bị huỷ.
 *   clawback = min(thưởng còn giữ, bonus(Vtrước) − bonus(Vtrước − đơn)), Vtrước = doanh số đã chốt
 *   ngay trước lần huỷ (gồm đơn này) — CHỈ khi đơn đó đang được tính vào doanh số đã chốt.
 */

const TIERS = [
  { min: 50_000_000, pct: 2 },
  { min: 100_000_000, pct: 3 },
  { min: 200_000_000, pct: 4 },
];

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(key: string, fb?: T): Promise<T> => (key in values ? values[key] : fb) as T,
  } as unknown as SystemConfigService;
}

/** Ảnh chụp đơn đại lý Q1/2026 (giờ VN) NGAY TRƯỚC lần huỷ/trả — như caller truyền vào. */
const ORDER = {
  id: 'o9',
  code: 'DLR9',
  userId: 'd1',
  type: 'DEALER',
  createdAt: new Date('2026-03-20T03:00:00Z'),
  total: 30_000_000,
  status: 'DELIVERED',
  paymentStatus: 'PAID',
};

type Row = {
  id: string;
  total: number;
  status: string;
  paymentStatus: string;
  createdAt?: Date;
  paidAt?: Date | null;
  /** Lúc đơn lên PACKED (dòng order_status_history); không có → coi như chốt ngay lúc tạo. */
  packedAt?: Date;
};

/** Lúc cron trả thưởng Q1/2026 ghi dòng QUARTER_BONUS (10/4, giờ VN). */
const PAYOUT_AT = new Date('2026-04-10T02:00:00Z');

/**
 * tx giả: `bonusDelta` = dòng QUARTER_BONUS (null = quý chưa trả thưởng); `others` = các đơn KHÁC
 * của quý (đơn bị huỷ đã lật trạng thái trong cùng tx nên không nằm trong đây — dealerVolume còn
 * loại hẳn theo id); `adjRows` = các dòng QUARTER_BONUS_ADJ đã ghi (mutable — createMany thêm vào);
 * `creditOrderIds` = đơn "Ghi công nợ" (có dòng ledger refType=ORDER); `reversed` = mốc chốt của chính đơn
 * bị huỷ/trả (paidAt, lúc lên PACKED); `payoutAt` = createdAt của dòng QUARTER_BONUS.
 */
function makeTx(opts: {
  bonusDelta: number | null;
  others: number[] | Row[];
  adjRows?: { delta: number; refId: string }[];
  creditOrderIds?: string[];
  reversed?: { paidAt?: Date | null; packedAt?: Date };
  payoutAt?: Date;
  /** Dòng QUARTER_BONUS_TOPUP (trả bù) đã ghi sau lần trả thưởng đầu; createdAt = mốc doanh số của lần trả bù. */
  topups?: { delta: number; createdAt: Date }[];
}) {
  const adjRows = opts.adjRows ?? [];
  const credit = new Set(opts.creditOrderIds ?? []);
  const rows: Row[] = (opts.others as (number | Row)[]).map((o, i) =>
    typeof o === 'number' ? { id: `r${i}`, total: o, status: 'DELIVERED', paymentStatus: 'PAID' } : o,
  ).map((r) => ({ createdAt: new Date('2026-03-10T03:00:00Z'), paidAt: null, ...r }));
  const packedOf = new Map<string, Date>(rows.filter((r) => r.packedAt).map((r) => [r.id, r.packedAt!]));
  if (opts.reversed?.packedAt) packedOf.set('o9', opts.reversed.packedAt);
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    dealerQuarterBonusTier: { findUnique: jest.fn(async () => null) },
    $queryRaw: jest.fn(async () =>
      [
        ...(opts.bonusDelta === null ? [] : [{ id: 'qb1', delta: opts.bonusDelta, createdAt: opts.payoutAt ?? PAYOUT_AT }]),
        ...(opts.topups ?? []).map((t, i) => ({ id: `tu${i}`, ...t })),
      ],
    ),
    orderStatusHistory: {
      findMany: jest.fn(async ({ where }: { where: { orderId: { in: string[] } } }) =>
        where.orderId.in.filter((id) => packedOf.has(id)).map((orderId) => ({ orderId, createdAt: packedOf.get(orderId)! })),
      ),
    },
    order: {
      findUnique: jest.fn(async () => ({ paidAt: opts.reversed?.paidAt ?? null })),
      findMany: jest.fn(async ({ where }: { where: { id?: { not?: string }; status?: { notIn?: string[] } } }) =>
        rows.filter(
          (r) => r.id !== where.id?.not && !(where.status?.notIn ?? []).includes(r.status),
        ),
      ),
    },
    dealerCreditLedger: {
      findMany: jest.fn(async ({ where }: { where: { refType: string; refId?: { in?: string[] } } }) => {
        if (where.refType === 'QUARTER_BONUS_ADJ') return adjRows.map((r) => ({ delta: r.delta }));
        if (where.refType === 'ORDER') {
          return (where.refId?.in ?? []).filter((id) => credit.has(id)).map((refId) => ({ refId, createdAt: new Date('2026-03-01T00:00:00Z') }));
        }
        return [];
      }),
      findFirst: jest.fn(async ({ where }: { where: { refType: string; refId: string } }) =>
        where.refType === 'ORDER' && credit.has(where.refId) ? { id: `led-${where.refId}` } : null,
      ),
      createMany: jest.fn(async ({ data }: { data: { delta: number; refId: string }[]; skipDuplicates?: boolean }) => {
        const fresh = data.filter((d) => !adjRows.some((r) => r.refId === d.refId));
        adjRows.push(...fresh);
        return { count: fresh.length };
      }),
    },
  };
  return { tx, adjRows };
}

const service = () => new DealerService({} as PrismaService, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS }));

describe('DealerService.clawbackQuarterBonusForOrder (thu hồi theo phần biên của đơn bị huỷ)', () => {
  it('đơn đang được tính rơi làm tụt bậc → thu hồi đúng phần biên bonus(Vtrước) − bonus(Vtrước − đơn)', async () => {
    // Đã trả 120tr × 3% = 3.6tr. Huỷ đơn 30tr → còn 90tr × 2% = 1.8tr → thu hồi 1.8tr.
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);

    expect(r).toEqual({ quarter: 'Q1/2026', clawedBack: 1_800_000 });
    expect(tx.dealerCreditLedger.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.dealerCreditLedger.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    // delta DƯƠNG = tăng lại công nợ, ngược dấu đúng cách payout đã ghi (delta âm).
    expect(arg.data).toEqual([
      expect.objectContaining({ userId: 'd1', delta: 1_800_000, refType: 'QUARTER_BONUS_ADJ', refId: 'Q1/2026:o9' }),
    ]);
    expect(arg.skipDuplicates).toBe(true);
    // Doanh số "các đơn khác" loại hẳn chính đơn bị huỷ theo id (không phụ thuộc thứ tự lật trạng thái).
    expect(tx.order.findMany.mock.calls[0]![0].where).toMatchObject({ id: { not: 'o9' } });
  });

  it('quý trả thưởng theo QUY TẮC CŨ (đã trả thừa) → lần huỷ đầu KHÔNG thu luôn phần chênh giữa 2 quy tắc', async () => {
    // Quy tắc cũ tính cả đơn chưa trả tiền: trả 250tr × 4% = 10tr. Doanh số ĐÃ CHỐT thật chỉ 120tr
    // (gồm đơn này 30tr). Tính lại cả quý sẽ thu 10tr − 1.8tr = 8.2tr; đúng ra chỉ phần biên 1.8tr.
    const { tx } = makeTx({ bonusDelta: -10_000_000, others: [90_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(1_800_000);
  });

  it('cùng bậc → chỉ thu phần thưởng tính trên đơn bị huỷ', async () => {
    // Vtrước 140tr (3% = 4.2tr) → còn 110tr (3% = 3.3tr) → thu 900k.
    const { tx } = makeTx({ bonusDelta: -4_200_000, others: [110_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(900_000);
  });

  it('thu hồi không vượt thưởng CÒN GIỮ (sau các lần điều chỉnh trước)', async () => {
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      others: [90_000_000],
      adjRows: [{ delta: 2_600_000, refId: 'Q1/2026:o1' }], // còn giữ 1tr
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(1_000_000);
  });

  it('thưởng còn giữ = 0 → no-op (không bao giờ điều chỉnh TĂNG)', async () => {
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      others: [0],
      adjRows: [{ delta: 3_600_000, refId: 'Q1/2026:o1' }],
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(0);
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['CONFIRMED + PAID (đại lý còn tự huỷ được)', { status: 'CONFIRMED', paymentStatus: 'PAID' }],
    ['PENDING_PAYMENT', { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }],
    ['PACKED nhưng trả trước CHƯA thanh toán', { status: 'PACKED', paymentStatus: 'UNPAID' }],
    ['đã REFUNDED từ trước', { status: 'DELIVERED', paymentStatus: 'REFUNDED' }],
  ])('đơn KHÔNG được tính vào doanh số đã chốt ngay trước lần huỷ (%s) → không thu hồi, không đọc doanh số', async (_l, snap) => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, ...snap });
    expect(r.clawedBack).toBe(0);
    expect(tx.order.findMany).not.toHaveBeenCalled();
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it('đơn "Ghi công nợ" (UNPAID + có dòng ledger ORDER) đã đóng gói → được tính → thu hồi phần biên', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000], creditOrderIds: ['o9'] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, status: 'SHIPPING', paymentStatus: 'UNPAID' });
    expect(r.clawedBack).toBe(1_800_000);
  });

  it('caller báo paidBeforeReversal=false (guard hoàn tiền thấy đơn đã không còn PAID) → coi như không được tính', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER, { paidBeforeReversal: false });
    expect(r.clawedBack).toBe(0);
  });

  it('2 đơn cùng quý huỷ lần lượt → tổng thu hồi = bonus(V) − bonus(V − a − b) (telescoping, không trừ trùng)', async () => {
    // Trả 3.6tr trên 120tr = o1 30tr + o2 30tr + khác 60tr.
    const adjRows: { delta: number; refId: string }[] = [];
    const first = makeTx({ bonusDelta: -3_600_000, others: [30_000_000, 60_000_000], adjRows });
    const r1 = await service().clawbackQuarterBonusForOrder(first.tx as never, { ...ORDER, id: 'o1' });
    // o1 đã huỷ và commit → lượt o2 thấy các đơn khác = 60tr.
    const second = makeTx({ bonusDelta: -3_600_000, others: [60_000_000], adjRows });
    const r2 = await service().clawbackQuarterBonusForOrder(second.tx as never, { ...ORDER, id: 'o2' });
    expect(r1.clawedBack).toBe(1_800_000); // 3.6tr → 1.8tr
    expect(r2.clawedBack).toBe(600_000); // 90tr × 2% = 1.8tr → 60tr × 2% = 1.2tr
    expect(r1.clawedBack + r2.clawedBack).toBe(3_600_000 - 1_200_000);
  });

  it('gọi lặp cho cùng đơn → chỉ thu hồi 1 lần (unique refId, createMany skipDuplicates)', async () => {
    const { tx, adjRows } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    const svc = service();
    await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    const again = await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(again.clawedBack).toBe(0);
    expect(adjRows).toHaveLength(1);
  });

  it('dòng thu hồi đã tồn tại (race) → createMany bỏ qua, trả 0', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    tx.dealerCreditLedger.createMany.mockResolvedValueOnce({ count: 0 });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(0);
  });

  it('khoá advisory (userId:quý) TRƯỚC khi đọc dòng thưởng FOR UPDATE — xếp hàng với payout và lần huỷ khác', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    const lock = tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(lock[0].join('?')).toMatch(/pg_advisory_xact_lock\(hashtext\(/);
    expect(lock.slice(1)).toEqual(['d1:Q1/2026']);
    const sel = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(sel[0].join('?')).toMatch(/FOR UPDATE/);
    expect(sel.slice(1)).toEqual(['d1', 'Q1/2026', 'Q1/2026:topup:%']);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]!);
  });

  it('quý CHƯA trả thưởng (không có dòng QUARTER_BONUS) → no-op, không đọc doanh số', async () => {
    const { tx } = makeTx({ bonusDelta: null, others: [10_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r).toEqual({ quarter: 'Q1/2026', clawedBack: 0 });
    expect(tx.order.findMany).not.toHaveBeenCalled();
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it('quý theo giờ VN của createdAt: 31/03 18:00 UTC = 01/04 01:00 VN → Q2/2026', async () => {
    const { tx } = makeTx({ bonusDelta: null, others: [] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, {
      ...ORDER,
      createdAt: new Date('2026-03-31T18:00:00Z'),
    });
    expect(r.quarter).toBe('Q2/2026');
  });

  it('đơn không phải DEALER → no-op, không truy vấn/khoá gì', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [0] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, type: 'RETAIL' });
    expect(r).toEqual({ quarter: null, clawedBack: 0 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('Thu hồi theo doanh số ĐÃ TÍNH lúc trả thưởng (đơn chốt muộn không kéo theo thưởng của đơn khác)', () => {
  const AFTER_PAYOUT = new Date('2026-04-16T03:00:00Z');
  const A: Row = { id: 'oA', total: 120_000_000, status: 'DELIVERED', paymentStatus: 'PAID', createdAt: new Date('2026-02-05T03:00:00Z'), paidAt: new Date('2026-02-05T04:00:00Z'), packedAt: new Date('2026-02-08T03:00:00Z') };
  const B = { ...ORDER, code: 'DLRB', total: 90_000_000, createdAt: new Date('2026-03-28T03:00:00Z') };

  it('D11-02: đơn B chỉ lên PACKED sau ngày trả thưởng rồi bị trả → thu 0 (trước đây thu 3.6tr thưởng của đơn A)', async () => {
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      others: [A],
      reversed: { paidAt: new Date('2026-03-28T04:00:00Z'), packedAt: AFTER_PAYOUT },
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, B);
    expect(r).toEqual({ quarter: 'Q1/2026', clawedBack: 0 });
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it('đơn B đã PACKED từ trước nhưng kế toán xác nhận tiền sau ngày trả thưởng → cũng chưa được tính, thu 0', async () => {
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      others: [A],
      reversed: { paidAt: new Date('2026-04-12T03:00:00Z'), packedAt: new Date('2026-03-30T03:00:00Z') },
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, B);
    expect(r.clawedBack).toBe(0);
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it('D11-02 ca 2: A 120tr + A2 60tr đã tính (5.4tr), C 30tr chốt muộn; trả A2 → thu 1.8tr (không phải 3.9tr)', async () => {
    const C: Row = { id: 'oC', total: 30_000_000, status: 'DELIVERED', paymentStatus: 'PAID', createdAt: new Date('2026-03-29T03:00:00Z'), paidAt: new Date('2026-03-29T04:00:00Z'), packedAt: AFTER_PAYOUT };
    const { tx } = makeTx({
      bonusDelta: -5_400_000,
      others: [A, C],
      reversed: { paidAt: new Date('2026-03-01T04:00:00Z'), packedAt: new Date('2026-03-05T03:00:00Z') },
    });
    const a2 = { ...ORDER, id: 'o9', total: 60_000_000, createdAt: new Date('2026-03-01T03:00:00Z') };
    const r = await service().clawbackQuarterBonusForOrder(tx as never, a2);
    expect(r).toEqual({ quarter: 'Q1/2026', clawedBack: 1_800_000 });
    expect(tx.dealerCreditLedger.createMany.mock.calls[0]![0].data).toEqual([
      expect.objectContaining({ delta: 1_800_000, refId: 'Q1/2026:o9' }),
    ]);
  });

  it('đơn bị trả đã được tính lúc trả thưởng, thu xong lần 2 cùng đơn → không thu thêm (idempotent)', async () => {
    const { tx, adjRows } = makeTx({
      bonusDelta: -3_600_000,
      others: [90_000_000],
      reversed: { paidAt: new Date('2026-03-01T04:00:00Z'), packedAt: new Date('2026-03-05T03:00:00Z') },
    });
    const svc = service();
    const first = await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    const again = await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(first.clawedBack).toBe(1_800_000);
    expect(again.clawedBack).toBe(0);
    expect(adjRows).toHaveLength(1);
  });

  it('đơn chốt đúng lúc trả thưởng (packedAt = payoutAt) vẫn tính là đã nằm trong doanh số', async () => {
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      others: [90_000_000],
      reversed: { paidAt: new Date('2026-03-01T04:00:00Z'), packedAt: PAYOUT_AT },
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(1_800_000);
  });
});

describe('Thu hồi thưởng khi quý đã được trả bù (QUARTER_BONUS_TOPUP) — Q8', () => {
  const TOPUP_AT = new Date('2026-04-20T02:00:00Z');
  const A = { id: 'a1', total: 120_000_000, status: 'DELIVERED', paymentStatus: 'PAID' };

  it('đơn chốt muộn đã được lần trả bù tính (chốt trước mốc trả bù) → thu hồi phần biên của nó, thưởng còn giữ gồm cả khoản bù', async () => {
    // Trả đầu 120tr × 3% = 3,6tr; đơn D 90tr chốt 18/4 → trả bù 4,8tr lúc 20/4 (210tr × 4% = 8,4tr). Trả D: 8,4 − 3,6 = 4,8tr.
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      others: [A],
      topups: [{ delta: -4_800_000, createdAt: TOPUP_AT }],
      reversed: { packedAt: new Date('2026-04-18T02:00:00Z') },
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, total: 90_000_000 });
    expect(r).toEqual({ quarter: 'Q1/2026', clawedBack: 4_800_000 });
  });

  it('đơn chốt SAU lần trả bù cuối chưa từng góp vào khoản nào đã trả → không thu hồi', async () => {
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      others: [A],
      topups: [{ delta: -4_800_000, createdAt: TOPUP_AT }],
      reversed: { packedAt: new Date('2026-04-25T02:00:00Z') },
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, total: 90_000_000 });
    expect(r.clawedBack).toBe(0);
  });

  it('lần trả đầu chưa có thưởng (dưới bậc), chỉ có khoản trả bù → vẫn thu hồi theo doanh số lúc trả bù', async () => {
    // A 30tr + D 30tr = 60tr → 2% = 1,2tr trả bù. Trả D: bonus(60tr) − bonus(30tr) = 1,2tr.
    const { tx } = makeTx({
      bonusDelta: null,
      others: [{ id: 'a1', total: 30_000_000, status: 'DELIVERED', paymentStatus: 'PAID' }],
      topups: [{ delta: -1_200_000, createdAt: TOPUP_AT }],
      reversed: { packedAt: new Date('2026-04-18T02:00:00Z') },
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r).toEqual({ quarter: 'Q1/2026', clawedBack: 1_200_000 });
  });
});

describe('Thu hồi sau lượt trả bù quét thêm một ngày (mốc ghi = hạn cửa sổ, đơn chốt sau hạn chưa được tính)', () => {
  // Lượt quét thêm ghi dòng bù với createdAt = hạn cửa sổ 00:00 31/5 giờ VN (30/5 17:00Z), dù chạy thật lúc 05:00 ngày 31/5.
  const EXPIRES_AT = new Date('2026-05-30T17:00:00Z');
  const A = { id: 'a', total: 120_000_000, status: 'DELIVERED', paymentStatus: 'PAID', paidAt: new Date('2026-03-10T03:00:00Z') };
  const D = { id: 'd', total: 90_000_000, status: 'DELIVERED', paymentStatus: 'PAID', paidAt: new Date('2026-05-29T23:00:00Z') };
  const Z = { id: 'z', total: 500_000_000, status: 'DELIVERED', paymentStatus: 'PAID', paidAt: new Date('2026-05-30T18:00:00Z') };
  const base = { bonusDelta: -3_600_000, payoutAt: new Date('2026-04-09T21:00:00Z'), topups: [{ delta: -4_800_000, createdAt: EXPIRES_AT }] };

  it('đơn Z chốt 01:00 ngày 31/5 (sau hạn) rồi bị trả → thu 0, vì lượt bù đã loại Z', async () => {
    const { tx } = makeTx({ ...base, others: [A, D], reversed: { paidAt: Z.paidAt } });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, id: 'z', code: 'DLRZ', total: Z.total, createdAt: new Date('2026-03-28T03:00:00Z') });
    expect(r.clawedBack).toBe(0);
  });

  it('đơn d (được lượt bù tính) bị trả khi còn đơn Z chốt sau hạn → thu 4,8tr, Z không làm phình "các đơn khác"', async () => {
    const { tx } = makeTx({ ...base, others: [A, Z], reversed: { paidAt: D.paidAt } });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, id: 'd', code: 'DLRD', total: D.total, createdAt: new Date('2026-03-28T03:00:00Z') });
    expect(r.clawedBack).toBe(4_800_000);
  });
});

describe('Thông báo DEALER_BONUS_ADJUSTED cho đại lý (chỉ SAU KHI lần huỷ đã commit)', () => {
  afterEach(() => jest.useRealTimers());

  function svcWith(findFirst: jest.Mock) {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const prisma = { dealerCreditLedger: { findFirst } } as unknown as PrismaService;
    const svc = new DealerService(prisma, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS }), notifications as never);
    return { svc, notifications };
  }

  it('dòng điều chỉnh đã commit (đọc được NGOÀI tx) → báo đại lý đúng 1 lần kèm số tiền, quý, mã đơn, thưởng còn lại', async () => {
    jest.useFakeTimers();
    const findFirst = jest.fn().mockResolvedValue({ id: 'adj1' });
    const { svc, notifications } = svcWith(findFirst);
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(notifications.notify).not.toHaveBeenCalled(); // chưa gửi khi tx còn mở
    await jest.advanceTimersByTimeAsync(60_000);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ userId: 'd1', refType: 'QUARTER_BONUS_ADJ', refId: 'Q1/2026:o9' });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith('d1', 'DEALER_BONUS_ADJUSTED', {
      quarter: 'Q1/2026',
      amount: (1_800_000).toLocaleString('vi-VN'),
      order_code: 'DLR9',
      remaining: (1_800_000).toLocaleString('vi-VN'),
    });
  });

  it('transaction huỷ đơn rollback (dòng điều chỉnh không bao giờ xuất hiện) → KHÔNG báo', async () => {
    jest.useFakeTimers();
    const findFirst = jest.fn().mockResolvedValue(null);
    const { svc, notifications } = svcWith(findFirst);
    const { tx } = makeTx({ bonusDelta: -3_600_000, others: [90_000_000] });
    await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(findFirst.mock.calls.length).toBeGreaterThan(1); // đã thử lại vài lần
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('không thu hồi gì → không lên lịch báo', async () => {
    jest.useFakeTimers();
    const findFirst = jest.fn().mockResolvedValue({ id: 'x' });
    const { svc, notifications } = svcWith(findFirst);
    const { tx } = makeTx({ bonusDelta: null, others: [] });
    await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(findFirst).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
