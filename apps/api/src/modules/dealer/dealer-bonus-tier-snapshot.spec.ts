import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * Q8b: thưởng quý trả ngày 10 theo bảng bậc lúc đó. Trả bù (60 ngày sau quý) và thu hồi của quý đó phải dùng đúng bảng ấy,
 * không phải bảng hiện hành: admin đổi bậc cho quý mới thì quý cũ không bị trả thừa/thiếu. Bản chụp bảng bậc lưu theo khoá
 * quý, tạo một lần ở lần tính thưởng đầu tiên của quý.
 */

const OLD_TIERS = [
  { min: 50_000_000, pct: 2 },
  { min: 100_000_000, pct: 3 },
  { min: 200_000_000, pct: 4 },
];
const NEW_TIERS = [
  { min: 50_000_000, pct: 3 },
  { min: 100_000_000, pct: 5 },
  { min: 200_000_000, pct: 6 },
];

type Ledger = { userId: string; delta: number; refType: string; refId: string | null; note?: string | null; createdAt: Date };
type OrderRow = { id: string; total: number; shippingFee: number; status: string; paymentStatus: string; createdAt: Date; paidAt: Date | null };
type Where = { userId?: string; refType?: string | { in: string[] }; refId?: string | { startsWith?: string; in?: string[] }; OR?: Where[] };

function matches(l: Ledger, w: Where): boolean {
  if (w.OR) return w.OR.some((o) => matches(l, o));
  if (w.userId && l.userId !== w.userId) return false;
  if (typeof w.refType === 'string' && l.refType !== w.refType) return false;
  if (w.refType && typeof w.refType === 'object' && !w.refType.in.includes(l.refType)) return false;
  if (typeof w.refId === 'string' && l.refId !== w.refId) return false;
  if (w.refId && typeof w.refId === 'object') {
    if (w.refId.startsWith !== undefined && !(l.refId ?? '').startsWith(w.refId.startsWith)) return false;
    if (w.refId.in && !w.refId.in.includes(l.refId ?? '')) return false;
  }
  return true;
}

const order = (id: string, total: number, createdAt: string, settledAt: string = createdAt): OrderRow => ({
  id,
  total,
  shippingFee: 0,
  status: 'DELIVERED',
  paymentStatus: 'PAID',
  createdAt: new Date(createdAt),
  paidAt: new Date(settledAt),
});

/** DB giả trong bộ nhớ: 1 đại lý d1; `clock` là giờ mô phỏng gán cho createdAt của dòng ghi mới. */
function makeWorld(orders: OrderRow[], tiersConfig: { value: unknown }, configOverride?: SystemConfigService) {
  const state = { clock: new Date('2026-04-09T21:00:00Z') };
  const ledger: Ledger[] = [];
  const snapshots = new Map<string, { quarter: string; tiers: unknown; createdAt: Date }>();
  const snapshotModel = {
    findUnique: jest.fn(async ({ where }: { where: { quarter: string } }) => snapshots.get(where.quarter) ?? null),
    createMany: jest.fn(async ({ data }: { data: { quarter: string; tiers: unknown }[] }) => {
      let count = 0;
      for (const d of data) {
        if (snapshots.has(d.quarter)) continue;
        snapshots.set(d.quarter, { ...d, createdAt: state.clock });
        count += 1;
      }
      return { count };
    }),
  };
  const ledgerModel = {
    findMany: jest.fn(async ({ where }: { where: Where }) =>
      ledger.filter((l) => matches(l, where)).map((l) => ({ ...l })),
    ),
    findFirst: jest.fn(async ({ where }: { where: Where }) => ledger.find((l) => matches(l, where)) ?? null),
    create: jest.fn(async ({ data }: { data: Omit<Ledger, 'createdAt'> & { createdAt?: Date } }) => {
      ledger.push({ ...data, createdAt: data.createdAt ?? state.clock });
      return data;
    }),
    createMany: jest.fn(async ({ data }: { data: (Omit<Ledger, 'createdAt'> & { createdAt?: Date })[] }) => {
      for (const d of data) ledger.push({ ...d, createdAt: d.createdAt ?? state.clock });
      return { count: data.length };
    }),
  };
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    order: {
      findMany: jest.fn(async ({ where }: { where: { id?: { not?: string }; status?: { notIn?: string[] } } }) =>
        orders.filter((o) => o.id !== where.id?.not && !(where.status?.notIn ?? []).includes(o.status)),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ paidAt: orders.find((o) => o.id === where.id)?.paidAt ?? null })),
    },
    orderStatusHistory: { findMany: jest.fn(async () => []) },
    dealerCreditLedger: ledgerModel,
    dealerQuarterBonusTier: snapshotModel,
    $queryRaw: jest.fn(async () =>
      ledger
        .filter((l) => l.refType === 'QUARTER_BONUS' || l.refType === 'QUARTER_BONUS_TOPUP')
        .map((l, i) => ({ id: `led${i}`, delta: l.delta, createdAt: l.createdAt })),
    ),
  };
  const prisma = {
    user: { findMany: jest.fn(async () => [{ id: 'd1' }]) },
    order: tx.order,
    orderStatusHistory: tx.orderStatusHistory,
    dealerCreditLedger: ledgerModel,
    dealerQuarterBonusTier: snapshotModel,
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const config =
    configOverride ??
    ({ get: async <T>(key: string, fb?: T): Promise<T> => (key === 'dealer.quarterly_bonus_tiers' ? tiersConfig.value : fb) as T } as unknown as SystemConfigService);
  const notify = jest.fn().mockResolvedValue(undefined);
  const service = new DealerService(prisma as unknown as PrismaService, config, { notify } as never);
  return { service, ledger, snapshots, tx, state };
}

type Api = {
  payoutQuarterlyBonuses(now: Date): Promise<{ paid: number; quarter: string }>;
  topUpQuarterlyBonuses(now: Date): Promise<{ toppedUp: number; quarters: string[] }>;
  clawbackQuarterBonusForOrder(tx: unknown, order: Record<string, unknown>): Promise<{ quarter: string | null; clawedBack: number }>;
};

const PAYOUT_DAY = new Date('2026-04-10T03:00:00Z');
const TOPUP_DAY = new Date('2026-04-20T03:00:00Z');

describe('Bản chụp bảng bậc thưởng theo quý', () => {
  it('trả bù theo bảng bậc lúc trả ngày 10 dù admin đã đổi bảng trong cửa sổ', async () => {
    const tiersConfig = { value: OLD_TIERS as unknown };
    // a (120tr) chốt trước ngày 10; d (90tr) đặt cuối quý nhưng chỉ chốt 12/4, sau lần trả.
    const orders = [order('a', 120_000_000, '2026-03-10T03:00:00Z')];
    const w = makeWorld(orders, tiersConfig);
    const svc = w.service as unknown as Api;

    await svc.payoutQuarterlyBonuses(PAYOUT_DAY);
    expect(w.ledger).toHaveLength(1);
    expect(w.ledger[0]).toMatchObject({ refType: 'QUARTER_BONUS', delta: -3_600_000 });

    orders.push(order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-04-12T03:00:00Z'));
    tiersConfig.value = NEW_TIERS;
    w.state.clock = TOPUP_DAY;
    await svc.topUpQuarterlyBonuses(TOPUP_DAY);

    // 210tr theo 2/3/4% = 8,4tr, đã giữ 3,6tr → bù 4,8tr. Theo bảng mới sẽ thành 6,6tr.
    const row = w.ledger.find((l) => l.refType === 'QUARTER_BONUS_TOPUP')!;
    expect(row.delta).toBe(-4_800_000);
  });

  it('payout chạy lại sau khi admin đổi bảng vẫn dùng bản chụp (không trả thêm, bản chụp không bị ghi đè)', async () => {
    const tiersConfig = { value: OLD_TIERS as unknown };
    const w = makeWorld([order('a', 120_000_000, '2026-03-10T03:00:00Z')], tiersConfig);
    const svc = w.service as unknown as Api;
    await svc.payoutQuarterlyBonuses(PAYOUT_DAY);
    tiersConfig.value = NEW_TIERS;
    await svc.payoutQuarterlyBonuses(PAYOUT_DAY);
    expect(w.ledger).toHaveLength(1);
    expect(w.snapshots.get('Q1/2026')!.tiers).toEqual(OLD_TIERS);
  });

  it('payout ghi đúng một bản chụp cho quý, theo bảng đã sắp xếp', async () => {
    const unsorted = [OLD_TIERS[2], OLD_TIERS[0], OLD_TIERS[1]];
    const w = makeWorld([order('a', 120_000_000, '2026-03-10T03:00:00Z')], { value: unsorted });
    await (w.service as unknown as Api).payoutQuarterlyBonuses(PAYOUT_DAY);
    expect(w.snapshots.size).toBe(1);
    expect(w.snapshots.get('Q1/2026')!.tiers).toEqual(OLD_TIERS);
  });

  it('thu hồi khi huỷ đơn đã tính: phần biên theo bảng bậc lúc trả, không theo bảng mới', async () => {
    const tiersConfig = { value: OLD_TIERS as unknown };
    // a 50tr + x 70tr = 120tr → 3% = 3,6tr.
    const a = order('a', 50_000_000, '2026-03-10T03:00:00Z');
    const x = order('x', 70_000_000, '2026-03-20T03:00:00Z');
    const w = makeWorld([a, x], tiersConfig);
    const svc = w.service as unknown as Api;
    await svc.payoutQuarterlyBonuses(PAYOUT_DAY);
    expect(w.ledger[0]).toMatchObject({ delta: -3_600_000 });

    tiersConfig.value = NEW_TIERS;
    w.state.clock = TOPUP_DAY;
    // Đơn x bị huỷ: tx giả đã lật x (không còn trong doanh số các đơn khác nhờ id.not).
    const r = await svc.clawbackQuarterBonusForOrder(w.tx, {
      id: 'x',
      code: 'X',
      userId: 'd1',
      type: 'DEALER',
      createdAt: x.createdAt,
      total: x.total,
      shippingFee: 0,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
    });
    // bonus(120tr)=3,6tr − bonus(50tr)=1tr = 2,6tr theo 2/3/4%. Theo 3/5/6% là 4,5tr, kẹp ở 3,6tr.
    expect(r.clawedBack).toBe(2_600_000);
  });

  it('quý chưa có bản chụp (đã trả trước bản này): trả bù và thu hồi dùng bảng hiện hành như cũ', async () => {
    const tiersConfig = { value: NEW_TIERS as unknown };
    const a = order('a', 120_000_000, '2026-03-10T03:00:00Z');
    const d = order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-04-12T03:00:00Z');
    const w = makeWorld([a, d], tiersConfig);
    // Thưởng đã trả trước bản này theo bảng 3/5/6: 120tr × 5% = 6tr; không có dòng bản chụp.
    w.ledger.push({ userId: 'd1', delta: -6_000_000, refType: 'QUARTER_BONUS', refId: 'Q1/2026', createdAt: new Date('2026-04-09T21:00:00Z') });
    w.state.clock = TOPUP_DAY;
    await (w.service as unknown as Api).topUpQuarterlyBonuses(TOPUP_DAY);
    // 210tr × 6% = 12,6tr; giữ 6tr; bù = min(12,6−6, 12,6−6) = 6,6tr theo bảng hiện hành.
    expect(w.ledger.find((l) => l.refType === 'QUARTER_BONUS_TOPUP')!.delta).toBe(-6_600_000);
    expect(w.snapshots.has('Q1/2026')).toBe(false);
  });

  it('quý chưa có bản chụp: thu hồi dùng bảng hiện hành 3/5/6%', async () => {
    const tiersConfig = { value: NEW_TIERS as unknown };
    const a = order('a', 120_000_000, '2026-03-10T03:00:00Z');
    const d = order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-04-12T03:00:00Z');
    const w = makeWorld([a, d], tiersConfig);
    w.ledger.push({ userId: 'd1', delta: -6_000_000, refType: 'QUARTER_BONUS', refId: 'Q1/2026', createdAt: new Date('2026-04-09T21:00:00Z') });
    w.state.clock = TOPUP_DAY;
    const svc = w.service as unknown as Api;
    await svc.topUpQuarterlyBonuses(TOPUP_DAY);
    const r = await svc.clawbackQuarterBonusForOrder(w.tx, {
      id: 'd',
      code: 'D',
      userId: 'd1',
      type: 'DEALER',
      createdAt: d.createdAt,
      total: d.total,
      shippingFee: 0,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
    });
    // bonus(210tr)=12,6tr − bonus(120tr)=6tr = 6,6tr theo 3/5/6%; theo 2/3/4% sẽ là 4,8tr. Còn giữ 12,6tr nên không bị kẹp.
    expect(r.clawedBack).toBe(6_600_000);
    expect(w.snapshots.has('Q1/2026')).toBe(false);
  });

  it('payout chụp ngay sau lần đọc đầu của trả bù (TOCTOU): trả bù đọc lại bản chụp, không rơi về bảng hiện hành', async () => {
    const tiersConfig = { value: NEW_TIERS as unknown };
    const a = order('a', 120_000_000, '2026-03-10T03:00:00Z');
    const d = order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-04-12T03:00:00Z');
    const w = makeWorld([a, d], tiersConfig);
    // Lúc trả bù đọc lần 1 chưa có bản chụp; ngay sau đó payout chụp C0 (2/3/4%) và ghi QUARTER_BONUS 3,6tr.
    w.snapshots.set('Q1/2026', { quarter: 'Q1/2026', tiers: OLD_TIERS, createdAt: new Date('2026-04-09T21:00:00Z') });
    w.ledger.push({ userId: 'd1', delta: -3_600_000, refType: 'QUARTER_BONUS', refId: 'Q1/2026', createdAt: new Date('2026-04-09T21:00:00Z') });
    const prisma = (w.service as unknown as { prisma: { dealerQuarterBonusTier: { findUnique: jest.Mock } } }).prisma;
    prisma.dealerQuarterBonusTier.findUnique.mockImplementationOnce(async () => null);
    w.state.clock = TOPUP_DAY;
    await (w.service as unknown as Api).topUpQuarterlyBonuses(TOPUP_DAY);
    // 210tr theo 2/3/4% = 8,4tr, giữ 3,6tr → bù 4,8tr. Theo bảng hiện hành 3/5/6% sẽ là 6,6tr.
    expect(w.ledger.find((l) => l.refType === 'QUARTER_BONUS_TOPUP')!.delta).toBe(-4_800_000);
  });

  it('trả bù ghi bản chụp trùng khoá với payout: bản của payout (C0) thắng, số bù theo C0', async () => {
    const tiersConfig = { value: NEW_TIERS as unknown };
    const w = makeWorld([order('a', 120_000_000, '2026-03-10T03:00:00Z')], tiersConfig);
    // Payout đã chụp C0 nhưng chưa ghi dòng thưởng; trả bù đọc lần 1 vẫn thấy null rồi tự chụp C1 → trùng khoá.
    w.snapshots.set('Q1/2026', { quarter: 'Q1/2026', tiers: OLD_TIERS, createdAt: new Date('2026-04-09T21:00:00Z') });
    const prisma = (w.service as unknown as { prisma: { dealerQuarterBonusTier: { findUnique: jest.Mock } } }).prisma;
    prisma.dealerQuarterBonusTier.findUnique.mockImplementationOnce(async () => null);
    w.state.clock = TOPUP_DAY;
    await (w.service as unknown as Api).topUpQuarterlyBonuses(TOPUP_DAY);
    expect(w.ledger).toHaveLength(1);
    // 120tr theo C0 2/3/4% = 3,6tr; theo C1 3/5/6% sẽ là 6tr.
    expect(w.ledger[0]).toMatchObject({ refType: 'QUARTER_BONUS', delta: -3_600_000 });
    expect(w.snapshots.get('Q1/2026')!.tiers).toEqual(OLD_TIERS);
  });

  it('lần ngày 10 không chạy: trả muộn đầu tiên của bước bù chụp bảng bậc, rồi đổi cấu hình không làm lệch lần bù sau', async () => {
    const tiersConfig = { value: OLD_TIERS as unknown };
    const a = order('a', 120_000_000, '2026-03-10T03:00:00Z');
    const orders = [a];
    const w = makeWorld(orders, tiersConfig);
    const svc = w.service as unknown as Api;
    w.state.clock = new Date('2026-04-12T03:00:00Z');
    await svc.topUpQuarterlyBonuses(new Date('2026-04-12T03:00:00Z'));
    expect(w.ledger[0]).toMatchObject({ refType: 'QUARTER_BONUS', delta: -3_600_000 });
    expect(w.snapshots.get('Q1/2026')!.tiers).toEqual(OLD_TIERS);

    orders.push(order('d', 90_000_000, '2026-03-28T03:00:00Z', '2026-04-15T03:00:00Z'));
    tiersConfig.value = NEW_TIERS;
    w.state.clock = TOPUP_DAY;
    await svc.topUpQuarterlyBonuses(TOPUP_DAY);
    expect(w.ledger.find((l) => l.refType === 'QUARTER_BONUS_TOPUP')!.delta).toBe(-4_800_000);
  });

  // U3-B03: bảng bậc đi qua đúng đường ghi của admin (SystemConfigService.set, có luật hình dạng) rồi mới tới cron.
  it('admin đổi bậc qua luật ghi: quý đã chụp giữ bản chụp, quý chưa chụp dùng bảng mới', async () => {
    const store = new Map<string, unknown>([['dealer.quarterly_bonus_tiers', OLD_TIERS]]);
    const tx = {
      systemConfig: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)),
        upsert: jest.fn(async ({ where, update }: { where: { key: string }; update: { value: unknown } }) => {
          store.set(where.key, update.value);
        }),
      },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const realConfig = new SystemConfigService({
      systemConfig: tx.systemConfig,
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    } as never);

    const orders = [order('a', 120_000_000, '2026-03-10T03:00:00Z')];
    const w = makeWorld(orders, { value: null }, realConfig);
    const svc = w.service as unknown as Api;

    await svc.payoutQuarterlyBonuses(PAYOUT_DAY);
    expect(w.snapshots.get('Q1/2026')!.tiers).toEqual(OLD_TIERS);

    await realConfig.set('dealer.quarterly_bonus_tiers', NEW_TIERS, 'admin-1');
    await expect(realConfig.set('dealer.quarterly_bonus_tiers', [{ min: 100, pct: 0 }], 'admin-1')).rejects.toThrow(/lớn hơn 0/);

    await svc.payoutQuarterlyBonuses(PAYOUT_DAY);
    expect(w.snapshots.get('Q1/2026')!.tiers).toEqual(OLD_TIERS);
    expect(w.ledger.filter((l) => l.refId === 'Q1/2026')).toHaveLength(1);

    // DB giả không lọc theo ngày: thay bằng đơn của quý 2.
    orders.splice(0, orders.length, order('b', 120_000_000, '2026-06-10T03:00:00Z'));
    const julyPayout = new Date('2026-07-10T03:00:00Z');
    w.state.clock = julyPayout;
    await svc.payoutQuarterlyBonuses(julyPayout);
    expect(w.snapshots.get('Q2/2026')!.tiers).toEqual(NEW_TIERS);
    // 120tr theo bảng mới 3/5/6% = 6tr; theo bảng cũ 2/3/4% sẽ là 3,6tr.
    expect(w.ledger.find((l) => l.refId === 'Q2/2026')).toMatchObject({ delta: -6_000_000 });
  });
});
