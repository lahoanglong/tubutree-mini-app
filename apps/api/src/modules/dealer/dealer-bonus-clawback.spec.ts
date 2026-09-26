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

type Row = { id: string; total: number; status: string; paymentStatus: string };

/**
 * tx giả: `bonusDelta` = dòng QUARTER_BONUS (null = quý chưa trả thưởng); `others` = các đơn KHÁC
 * của quý (đơn bị huỷ đã lật trạng thái trong cùng tx nên không nằm trong đây — dealerVolume còn
 * loại hẳn theo id); `adjRows` = các dòng QUARTER_BONUS_ADJ đã ghi (mutable — createMany thêm vào);
 * `creditOrderIds` = đơn "Ghi công nợ" (có dòng ledger refType=ORDER).
 */
function makeTx(opts: {
  bonusDelta: number | null;
  others: number[] | Row[];
  adjRows?: { delta: number; refId: string }[];
  creditOrderIds?: string[];
}) {
  const adjRows = opts.adjRows ?? [];
  const credit = new Set(opts.creditOrderIds ?? []);
  const rows: Row[] = (opts.others as (number | Row)[]).map((o, i) =>
    typeof o === 'number' ? { id: `r${i}`, total: o, status: 'DELIVERED', paymentStatus: 'PAID' } : o,
  );
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => (opts.bonusDelta === null ? [] : [{ id: 'qb1', delta: opts.bonusDelta }])),
    order: {
      findMany: jest.fn(async ({ where }: { where: { id?: { not?: string }; status?: { notIn?: string[] } } }) =>
        rows.filter(
          (r) => r.id !== where.id?.not && !(where.status?.notIn ?? []).includes(r.status),
        ),
      ),
    },
    dealerCreditLedger: {
      findMany: jest.fn(async ({ where }: { where: { refType: string; refId?: { in?: string[] } } }) => {
        if (where.refType === 'QUARTER_BONUS_ADJ') return adjRows.map((r) => ({ delta: r.delta }));
        if (where.refType === 'ORDER') return (where.refId?.in ?? []).filter((id) => credit.has(id)).map((refId) => ({ refId }));
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
    expect(sel.slice(1)).toEqual(['d1', 'Q1/2026']);
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
