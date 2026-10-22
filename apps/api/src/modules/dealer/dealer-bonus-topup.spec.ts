import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Q8 (D11-03): thưởng quý chốt ngày 10 tháng sau quý, nên đơn của quý chốt muộn hơn (đặt trước chờ hàng, tiền về muộn)
 * từng mất thưởng vĩnh viễn. Chủ chọn trả bù trong 60 ngày sau ngày cuối quý. Bước trả bù chạy hằng ngày, chỉ trả
 * phần chênh giữa thưởng theo doanh số đã chốt hiện tại và phần đã giữ (QUARTER_BONUS + QUARTER_BONUS_TOPUP + ADJ).
 */

const TIERS = [
  { min: 50_000_000, pct: 2 },
  { min: 100_000_000, pct: 3 },
  { min: 200_000_000, pct: 4 },
];

type TopUpResult = { toppedUp: number; quarters: string[] };
type WithTopUp = { topUpQuarterlyBonuses(now: Date): Promise<TopUpResult> };

const makeConfig = (values: Record<string, unknown> = {}): SystemConfigService =>
  ({ get: async <T>(key: string, fb?: T): Promise<T> => (key in values ? values[key] : fb) as T }) as unknown as SystemConfigService;

type Ledger = { userId: string; delta: number; refType: string; refId: string | null; note: string | null; createdAt?: Date };
type OrderRow = { id: string; total: number; status: string; paymentStatus: string; createdAt: Date; paidAt: Date | null };

/** prisma giả: 1 đại lý d1, sổ công nợ và đơn nằm trong bộ nhớ; transaction chạy thẳng trên chính nó. */
function makePrisma(orders: OrderRow[], ledger: Ledger[] = []) {
  const snapshots = new Map<string, { quarter: string; tiers: unknown }>();
  const snapshotModel = {
    findUnique: jest.fn(async ({ where }: { where: { quarter: string } }) => snapshots.get(where.quarter) ?? null),
    createMany: jest.fn(async ({ data }: { data: { quarter: string; tiers: unknown }[] }) => {
      for (const d of data) if (!snapshots.has(d.quarter)) snapshots.set(d.quarter, d);
      return { count: data.length };
    }),
  };
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    order: { findMany: jest.fn(async () => orders) },
    orderStatusHistory: { findMany: jest.fn(async () => []) },
    dealerCreditLedger: {
      findMany: jest.fn(async ({ where }: { where: { refType?: unknown } }) =>
        where.refType === 'ORDER' ? [] : ledger.filter((l) => l.refType.startsWith('QUARTER_BONUS')),
      ),
      create: jest.fn(async ({ data }: { data: Ledger }) => {
        ledger.push({ ...data, note: data.note ?? null, createdAt: data.createdAt ?? new Date() });
        return data;
      }),
    },
  };
  const prisma = {
    user: { findMany: jest.fn(async () => [{ id: 'd1' }]) },
    dealerQuarterBonusTier: snapshotModel,
    dealerCreditLedger: { findFirst: jest.fn(async ({ where }: { where: Where }) => ledger.find((l) => matches(l, where)) ?? null) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { prisma, tx, ledger };
}

type Where = {
  userId?: string;
  refType?: string | { in: string[] };
  refId?: string | { startsWith: string };
  OR?: Where[];
};

/** Bộ lọc Prisma tối thiểu (userId, refType, refId, OR) đủ cho các truy vấn sổ công nợ ở đây. */
function matches(l: Ledger, w: Where): boolean {
  if (w.OR) return w.OR.some((o) => matches(l, o));
  if (w.userId && l.userId !== w.userId) return false;
  if (typeof w.refType === 'string' && l.refType !== w.refType) return false;
  if (w.refType && typeof w.refType === 'object' && !w.refType.in.includes(l.refType)) return false;
  if (typeof w.refId === 'string' && l.refId !== w.refId) return false;
  if (w.refId && typeof w.refId === 'object' && !(l.refId ?? '').startsWith(w.refId.startsWith)) return false;
  return true;
}

/** `settledAt` = lúc tiền về (paidAt); không truyền = chốt ngay lúc tạo đơn. Đơn chốt muộn = settledAt sau lần trả thưởng. */
const order = (id: string, total: number, createdAt: string, settledAt: string = createdAt): OrderRow => ({
  id,
  total,
  status: 'DELIVERED',
  paymentStatus: 'PAID',
  createdAt: new Date(createdAt),
  paidAt: new Date(settledAt),
});

const svc = (prisma: unknown, cfg: Record<string, unknown> = {}, notify = jest.fn().mockResolvedValue(undefined)) =>
  ({
    service: new DealerService(prisma as PrismaService, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS, ...cfg }), { notify } as never) as unknown as WithTopUp,
    notify,
  });

describe('DealerService.topUpQuarterlyBonuses — cửa sổ trả bù', () => {
  it('cửa sổ = 0 ngày → tắt hẳn, không đụng DB', async () => {
    const { prisma } = makePrisma([]);
    const r = await svc(prisma, { 'dealer.bonus_topup_window_days': 0 }).service.topUpQuarterlyBonuses(new Date('2026-05-01T03:00:00Z'));
    expect(r).toEqual({ toppedUp: 0, quarters: [] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trước ngày chốt 10 của tháng sau quý → chưa trả bù (lần trả đầu còn chưa chạy)', async () => {
    const { prisma } = makePrisma([order('a', 120_000_000, '2026-03-10T03:00:00Z')]);
    const r = await svc(prisma).service.topUpQuarterlyBonuses(new Date('2026-04-05T03:00:00Z'));
    expect(r.quarters).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('quá 60 ngày sau ngày cuối quý → hết hạn, không trả bù', async () => {
    const { prisma } = makePrisma([order('a', 120_000_000, '2026-03-10T03:00:00Z')]);
    // Q1/2026 kết thúc 31/3; 60 ngày sau = 30/5 (hết ngày). 1/6 đã quá.
    const r = await svc(prisma).service.topUpQuarterlyBonuses(new Date('2026-06-01T03:00:00Z'));
    expect(r.quarters).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trong cửa sổ và chỉ quý Q1/2026 (Q4/2025 đã hết hạn) → quét đúng 1 quý', async () => {
    const { prisma } = makePrisma([]);
    const r = await svc(prisma).service.topUpQuarterlyBonuses(new Date('2026-05-30T03:00:00Z'));
    expect(r.quarters).toEqual(['Q1/2026']);
  });

  it('đổi cửa sổ bằng cấu hình: 20 ngày thì ngày 25/4 đã hết hạn của Q1', async () => {
    const { prisma } = makePrisma([]);
    const r = await svc(prisma, { 'dealer.bonus_topup_window_days': 20 }).service.topUpQuarterlyBonuses(new Date('2026-04-25T03:00:00Z'));
    expect(r.quarters).toEqual([]);
  });
});

describe('DealerService.topUpQuarterlyBonuses — số tiền bù', () => {
  const NOW = new Date('2026-04-20T03:00:00Z');
  const A = order('a', 120_000_000, '2026-03-10T03:00:00Z');
  const D = order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-04-12T03:00:00Z');
  const paid: Ledger = {
    userId: 'd1',
    delta: -3_600_000,
    refType: 'QUARTER_BONUS',
    refId: 'Q1/2026',
    note: 'Thưởng doanh số Q1/2026',
    createdAt: new Date('2026-04-09T21:00:00Z'), // 04:00 ngày 10/4 giờ VN
  };

  it('đơn chốt muộn đẩy doanh số lên bậc cao hơn → ghi đúng phần chênh, có ghi chú "trả bù quý" và báo đại lý', async () => {
    const { prisma, ledger } = makePrisma([A, D], [{ ...paid }]);
    const { service, notify } = svc(prisma);
    const r = await service.topUpQuarterlyBonuses(NOW);

    expect(r).toEqual({ toppedUp: 1, quarters: ['Q1/2026'] });
    const row = ledger.find((l) => l.refType === 'QUARTER_BONUS_TOPUP')!;
    expect(row).toMatchObject({ userId: 'd1', delta: -4_800_000, refId: 'Q1/2026:topup:1' });
    expect(row.note).toContain('Trả bù thưởng quý Q1/2026');
    expect(notify).toHaveBeenCalledWith('d1', 'DEALER_BONUS_TOPUP', expect.objectContaining({ quarter: 'Q1/2026', amount: (4_800_000).toLocaleString('vi-VN') }));
  });

  it('chạy lại ngay sau đó (không có đơn mới) → không bù lần hai', async () => {
    const { prisma, ledger } = makePrisma([A, D], [{ ...paid }]);
    const { service } = svc(prisma);
    await service.topUpQuarterlyBonuses(NOW);
    const again = await service.topUpQuarterlyBonuses(NOW);
    expect(again.toppedUp).toBe(0);
    expect(ledger.filter((l) => l.refType === 'QUARTER_BONUS_TOPUP')).toHaveLength(1);
  });

  it('không có đơn nào chốt thêm sau lần trả → thưởng theo doanh số hiện tại bằng phần đang giữ → không ghi gì', async () => {
    const { prisma, ledger } = makePrisma([A], [{ ...paid }]);
    const r = await svc(prisma).service.topUpQuarterlyBonuses(NOW);
    expect(r.toppedUp).toBe(0);
    expect(ledger).toHaveLength(1);
  });

  it('thưởng đã bị thu hồi một phần (ADJ) thì phần bù tính trên số còn giữ, không bù lại phần đã thu', async () => {
    // Đã trả 3,6tr, thu hồi 1,8tr do trả đơn 30tr. Giữ 1,8tr. Doanh số hiện còn 90tr (2% = 1,8tr) → không bù.
    const adj: Ledger = { userId: 'd1', delta: 1_800_000, refType: 'QUARTER_BONUS_ADJ', refId: 'Q1/2026:ox', note: null };
    const { prisma, ledger } = makePrisma([order('a', 90_000_000, '2026-03-10T03:00:00Z')], [{ ...paid }, adj]);
    const r = await svc(prisma).service.topUpQuarterlyBonuses(NOW);
    expect(r.toppedUp).toBe(0);
    expect(ledger).toHaveLength(2);
  });

  it('lần đầu dưới bậc (chưa có dòng thưởng), đơn chốt muộn đưa lên bậc 2% → bù trọn 1,2tr', async () => {
    // Lần trả ngày 10 không ghi gì vì lúc đó mới 30tr (dưới bậc); đơn d chốt 12/4 đưa doanh số lên 60tr.
    const { prisma, ledger } = makePrisma([order('a', 30_000_000, '2026-03-10T03:00:00Z'), order('d', 30_000_000, '2026-03-28T03:00:00Z', '2026-04-12T03:00:00Z')]);
    const r = await svc(prisma).service.topUpQuarterlyBonuses(NOW);
    expect(r.toppedUp).toBe(1);
    expect(ledger[0]).toMatchObject({ delta: -1_200_000, refType: 'QUARTER_BONUS_TOPUP', refId: 'Q1/2026:topup:1' });
  });

  it('lần trả bù thứ hai lấy số thứ tự kế tiếp, chỉ bù phần chênh còn thiếu', async () => {
    const first: Ledger = { userId: 'd1', delta: -4_800_000, refType: 'QUARTER_BONUS_TOPUP', refId: 'Q1/2026:topup:1', note: null, createdAt: new Date('2026-04-15T03:00:00Z') };
    // Doanh số 120 + 90 + 110 = 320tr × 4% = 12,8tr; đã giữ 3,6 + 4,8 = 8,4tr → bù 4,4tr.
    const { prisma, ledger } = makePrisma([A, D, order('e', 110_000_000, '2026-03-30T03:00:00Z', '2026-04-18T03:00:00Z')], [{ ...paid }, first]);
    const r = await svc(prisma).service.topUpQuarterlyBonuses(NOW);
    expect(r.toppedUp).toBe(1);
    expect(ledger[ledger.length - 1]).toMatchObject({ delta: -4_400_000, refId: 'Q1/2026:topup:2' });
  });
});

describe('DealerService.topUpQuarterlyBonuses — chỉ bù phần do đơn chốt muộn', () => {
  const NOW = new Date('2026-04-20T03:00:00Z');
  const paid: Ledger = {
    userId: 'd1',
    delta: -3_600_000,
    refType: 'QUARTER_BONUS',
    refId: 'Q1/2026',
    note: 'Thưởng doanh số Q1/2026',
    createdAt: new Date('2026-04-09T21:00:00Z'),
  };
  const A = order('a', 120_000_000, '2026-03-10T03:00:00Z');

  it('admin đổi bậc thưởng sau ngày 10, không có đơn chốt muộn → không trả bù chênh do đổi bậc', async () => {
    const { prisma, ledger } = makePrisma([A], [{ ...paid }]);
    const newTiers = [{ min: 50_000_000, pct: 3 }, { min: 100_000_000, pct: 5 }];
    const r = await svc(prisma, { 'dealer.quarterly_bonus_tiers': newTiers }).service.topUpQuarterlyBonuses(NOW);
    expect(r.toppedUp).toBe(0);
    expect(ledger).toHaveLength(1);
  });

  it('đổi bậc VÀ có đơn chốt muộn → chỉ bù phần biên của đơn muộn theo bậc mới, không bù chênh bậc của đơn cũ', async () => {
    const late = order('d', 30_000_000, '2026-03-28T03:00:00Z', '2026-04-12T03:00:00Z');
    const { prisma, ledger } = makePrisma([A, late], [{ ...paid }]);
    const newTiers = [{ min: 50_000_000, pct: 3 }, { min: 100_000_000, pct: 5 }];
    // bonus(150tr)=7,5tr; bonus(120tr)=6tr → biên 1,5tr. Còn thiếu so với đang giữ = 7,5 − 3,6 = 3,9tr nhưng 2,4tr trong đó do đổi bậc.
    await svc(prisma, { 'dealer.quarterly_bonus_tiers': newTiers }).service.topUpQuarterlyBonuses(NOW);
    expect(ledger[ledger.length - 1]).toMatchObject({ refType: 'QUARTER_BONUS_TOPUP', delta: -1_500_000 });
  });

  it('đơn chốt ngày cuối cửa sổ sau 05:00: lượt chạy kế tiếp (sau khi hết hạn) vẫn bù, còn đơn chốt sau hạn thì không tính', async () => {
    // Hết cửa sổ lúc 00:00 31/5 giờ VN (= 30/5 17:00Z). Đơn d chốt 30/5 06:00 VN (23:00Z 29/5) — sau cron 05:00 ngày 30/5.
    // Đơn e chốt 31/5 01:00 VN: đã quá hạn, không được tính.
    const d = order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-05-29T23:00:00Z');
    const e = order('e', 500_000_000, '2026-03-28T03:00:00Z', '2026-05-30T18:00:00Z');
    const { prisma, ledger } = makePrisma([A, d, e], [{ ...paid }]);
    const r = await svc(prisma).service.topUpQuarterlyBonuses(new Date('2026-05-30T22:00:00Z')); // 05:00 ngày 31/5 giờ VN
    expect(r.quarters).toEqual(['Q1/2026']);
    expect(ledger[ledger.length - 1]).toMatchObject({ refType: 'QUARTER_BONUS_TOPUP', delta: -4_800_000 });
  });

  it('cửa sổ cấu hình 1–9 ngày ngắn hơn ngày chốt 10 → tính năng tắt, không quý nào được quét', async () => {
    const { prisma } = makePrisma([A], [{ ...paid }]);
    const r = await svc(prisma, { 'dealer.bonus_topup_window_days': 5 }).service.topUpQuarterlyBonuses(new Date('2026-04-12T03:00:00Z'));
    expect(r.quarters).toEqual([]);
  });

  it('lần trả ngày 10 chưa chạy được (đã đạt bậc từ trước ngày 10) → trả trọn với ghi chú trung tính và báo như thưởng thường', async () => {
    const { prisma, ledger } = makePrisma([A]);
    const { service, notify } = svc(prisma);
    const r = await service.topUpQuarterlyBonuses(NOW);
    expect(r.toppedUp).toBe(1);
    const row = ledger[0]!;
    expect(row).toMatchObject({ delta: -3_600_000, refType: 'QUARTER_BONUS', refId: 'Q1/2026' });
    expect(row.note).not.toContain('đơn chốt sau');
    expect(notify).toHaveBeenCalledWith('d1', 'DEALER_BONUS_PAID', expect.objectContaining({ quarter: 'Q1/2026' }));
    expect(notify).not.toHaveBeenCalledWith('d1', 'DEALER_BONUS_TOPUP', expect.anything());
  });
});

describe('DealerService.topUpQuarterlyBonuses — mốc createdAt của dòng ghi = mốc doanh số đã tính', () => {
  // Hết cửa sổ Q1/2026 lúc 00:00 31/5 giờ VN (= 30/5 17:00Z); lượt quét thêm chạy 05:00 31/5 giờ VN (= 30/5 22:00Z).
  const EXPIRES_AT = new Date('2026-05-30T17:00:00Z');
  const LATE_RUN = new Date('2026-05-30T22:00:00Z');
  const paid: Ledger = {
    userId: 'd1',
    delta: -3_600_000,
    refType: 'QUARTER_BONUS',
    refId: 'Q1/2026',
    note: 'Thưởng doanh số Q1/2026',
    createdAt: new Date('2026-04-09T21:00:00Z'),
  };
  const A = order('a', 120_000_000, '2026-03-10T03:00:00Z');
  const d = order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-05-29T23:00:00Z');

  it('lượt quét sau hạn: dòng QUARTER_BONUS_TOPUP có createdAt = hạn cửa sổ, không phải giờ chạy thật', async () => {
    const { prisma, ledger } = makePrisma([A, d], [{ ...paid }]);
    await svc(prisma).service.topUpQuarterlyBonuses(LATE_RUN);
    const row = ledger.find((l) => l.refType === 'QUARTER_BONUS_TOPUP')!;
    expect(row.createdAt).toEqual(EXPIRES_AT);
  });

  it('lượt quét sau hạn, lần trả ngày 10 không chạy: dòng QUARTER_BONUS "trả muộn" cũng có createdAt = hạn cửa sổ', async () => {
    const { prisma, ledger } = makePrisma([A]);
    await svc(prisma).service.topUpQuarterlyBonuses(LATE_RUN);
    const row = ledger.find((l) => l.refType === 'QUARTER_BONUS')!;
    expect(row.createdAt).toEqual(EXPIRES_AT);
  });

  it('lượt quét trong cửa sổ: để mặc định giờ DB (không ép createdAt)', async () => {
    const { prisma, tx } = makePrisma([A, d], [{ ...paid }]);
    await svc(prisma).service.topUpQuarterlyBonuses(new Date('2026-05-20T03:00:00Z'));
    const data = (tx.dealerCreditLedger.create.mock.calls[0] as unknown as [{ data: Ledger }])[0].data;
    expect(data.createdAt).toBeUndefined();
  });
});

describe('DealerService.payoutQuarterlyBonuses khi quý đã có khoản trả bù', () => {
  it('đã có QUARTER_BONUS_TOPUP của quý (lần trả đầu thất bại rồi chạy tay) → không trả trọn thưởng lần nữa', async () => {
    const ledger: Ledger[] = [{ userId: 'd1', delta: -3_600_000, refType: 'QUARTER_BONUS_TOPUP', refId: 'Q1/2026:topup:1', note: null }];
    const { prisma, tx } = makePrisma([order('a', 120_000_000, '2026-03-10T03:00:00Z')], ledger);
    const findFirst = jest.fn(async ({ where }: { where: Where }) => ledger.find((l) => matches(l, where)) ?? null);
    (tx.dealerCreditLedger as unknown as { findFirst: unknown }).findFirst = findFirst;
    const { service } = svc(prisma);
    const r = await (service as unknown as DealerService).payoutQuarterlyBonuses(new Date('2026-04-12T03:00:00Z'));
    expect(r.paid).toBe(0);
    expect(tx.dealerCreditLedger.create).not.toHaveBeenCalled();
  });
});
