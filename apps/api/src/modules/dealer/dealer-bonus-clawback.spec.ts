import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Thu hồi thưởng doanh số quý khi đơn đại lý bị huỷ/trả SAU ngày trả thưởng (cron ngày 10 tháng đầu
 * quý kế tiếp). Trước đây thưởng tính trên doanh số đã chốt lúc cron chạy rồi giữ nguyên mãi: đặt
 * đơn to (trả tiền + đóng gói) cuối quý → nhận thưởng ngày 10 → yêu cầu trả hàng → hoàn tiền về ví,
 * còn khoản thưởng tính trên chính đơn đó vẫn nằm trong công nợ (delta âm).
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

/** Đơn đại lý Q1/2026 (giờ VN) vừa bị huỷ. */
const ORDER = {
  id: 'o9',
  code: 'DLR9',
  userId: 'd1',
  type: 'DEALER',
  createdAt: new Date('2026-03-20T03:00:00Z'),
};

/**
 * tx giả: `bonusDelta` = dòng QUARTER_BONUS (null = quý chưa trả thưởng), `remaining` = các đơn còn
 * lại của quý SAU khi đơn bị huỷ đã lật trạng thái (dealerVolume đọc trong cùng tx), `adjRows` = các
 * dòng QUARTER_BONUS_ADJ đã ghi (mutable — createMany thêm vào để mô phỏng gọi lặp).
 */
function makeTx(opts: { bonusDelta: number | null; remaining: number[]; adjRows?: { delta: number; refId: string }[] }) {
  const adjRows = opts.adjRows ?? [];
  const tx = {
    $queryRaw: jest.fn(async () => (opts.bonusDelta === null ? [] : [{ id: 'qb1', delta: opts.bonusDelta }])),
    order: {
      findMany: jest.fn(async () =>
        opts.remaining.map((total, i) => ({ id: `r${i}`, total, status: 'DELIVERED', paymentStatus: 'PAID' })),
      ),
    },
    dealerCreditLedger: {
      findMany: jest.fn(async ({ where }: { where: { refType: string } }) =>
        where.refType === 'QUARTER_BONUS_ADJ' ? adjRows.map((r) => ({ delta: r.delta })) : [],
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

const service = () =>
  new DealerService({} as PrismaService, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS }));

describe('DealerService.clawbackQuarterBonusForOrder', () => {
  it('quý đã trả thưởng, doanh số rơi xuống bậc thấp hơn → ghi 1 dòng thu hồi đúng phần chênh', async () => {
    // Đã trả 120tr × 3% = 3.6tr. Huỷ đơn 30tr → còn 90tr × 2% = 1.8tr → thu hồi 1.8tr.
    const { tx } = makeTx({ bonusDelta: -3_600_000, remaining: [90_000_000] });
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
    // Khoá dòng thưởng (FOR UPDATE) để 2 đơn cùng quý huỷ đồng thời không cùng thu hồi 1 khoản.
    const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]);
    expect(sql[0].join('?')).toMatch(/FOR UPDATE/);
    expect(sql.slice(1)).toEqual(['d1', 'Q1/2026']);
  });

  it('quý CHƯA trả thưởng (không có dòng QUARTER_BONUS) → no-op, không đọc doanh số', async () => {
    const { tx } = makeTx({ bonusDelta: null, remaining: [10_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r).toEqual({ quarter: 'Q1/2026', clawedBack: 0 });
    expect(tx.order.findMany).not.toHaveBeenCalled();
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it('thưởng tính lại KHÔNG thấp hơn (đơn huỷ chưa từng được tính vào doanh số đã chốt) → no-op', async () => {
    // Đã trả 120tr × 3%; doanh số đã chốt hiện vẫn 120tr (đơn bị huỷ lúc trả thưởng còn chờ).
    const { tx } = makeTx({ bonusDelta: -3_600_000, remaining: [120_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(0);
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it('không bao giờ điều chỉnh TĂNG (doanh số hiện cao hơn lúc trả thưởng) → no-op', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, remaining: [250_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(0);
    expect(tx.dealerCreditLedger.createMany).not.toHaveBeenCalled();
  });

  it('cùng bậc nhưng doanh số giảm → chỉ thu hồi phần thưởng tính trên đơn đã huỷ (cùng công thức payout)', async () => {
    // 120tr × 3% = 3.6tr; huỷ 10tr → 110tr × 3% = 3.3tr → thu hồi 300k.
    const { tx } = makeTx({ bonusDelta: -3_600_000, remaining: [110_000_000] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(300_000);
  });

  it('rơi dưới mốc thấp nhất → thu hồi toàn bộ phần thưởng còn giữ', async () => {
    const { tx } = makeTx({ bonusDelta: -1_200_000, remaining: [20_000_000] }); // đã trả 60tr × 2%
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(1_200_000);
  });

  it('gọi lặp cho cùng đơn → chỉ thu hồi 1 lần (tính trên phần thưởng CÒN GIỮ sau các lần điều chỉnh)', async () => {
    const { tx, adjRows } = makeTx({ bonusDelta: -3_600_000, remaining: [90_000_000] });
    const svc = service();
    await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    const again = await svc.clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(again.clawedBack).toBe(0);
    expect(adjRows).toHaveLength(1);
    expect(tx.dealerCreditLedger.createMany).toHaveBeenCalledTimes(1);
  });

  it('đơn thứ 2 cùng quý huỷ sau → chỉ thu hồi PHẦN CÒN LẠI, không trừ lại phần đã thu hồi', async () => {
    // Đơn 1 đã thu hồi 1.8tr (3.6tr → 1.8tr). Đơn 2 huỷ → còn 40tr, dưới mốc → thu hồi nốt 1.8tr.
    const { tx } = makeTx({
      bonusDelta: -3_600_000,
      remaining: [40_000_000],
      adjRows: [{ delta: 1_800_000, refId: 'Q1/2026:o1' }],
    });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, id: 'o2' });
    expect(r.clawedBack).toBe(1_800_000);
  });

  it('dòng thu hồi đã tồn tại (unique userId+refType+refId, race) → createMany bỏ qua, trả 0', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, remaining: [90_000_000] });
    tx.dealerCreditLedger.createMany.mockResolvedValueOnce({ count: 0 });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, ORDER);
    expect(r.clawedBack).toBe(0);
  });

  it('quý theo giờ VN của createdAt: 31/03 18:00 UTC = 01/04 01:00 VN → Q2/2026', async () => {
    const { tx } = makeTx({ bonusDelta: null, remaining: [] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, {
      ...ORDER,
      createdAt: new Date('2026-03-31T18:00:00Z'),
    });
    expect(r.quarter).toBe('Q2/2026');
  });

  it('đơn không phải DEALER → no-op, không truy vấn gì', async () => {
    const { tx } = makeTx({ bonusDelta: -3_600_000, remaining: [0] });
    const r = await service().clawbackQuarterBonusForOrder(tx as never, { ...ORDER, type: 'RETAIL' });
    expect(r).toEqual({ quarter: null, clawedBack: 0 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
