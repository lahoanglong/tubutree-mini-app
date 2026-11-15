import { writeWasteEvent } from '../core/waste-events';
import { WasteGiftAttachService } from './waste-gift-attach.service';

jest.mock('../core/waste-events', () => ({
  ...jest.requireActual('../core/waste-events'),
  writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev-1' }),
}));

const writeEvent = writeWasteEvent as unknown as jest.Mock;

// 10:00 giờ VN ngày 20/11; đầu ngày VN = 19/11 17:00 UTC.
const NOW = new Date('2026-11-20T03:00:00Z');

type Row = {
  id: string; userId: string; giftId: string; giftKind: 'GIFT' | 'SEED_PACK' | 'VOUCHER'; giftName: string; code: string | null; pointsCost: number;
  status: 'READY' | 'FULFILLED' | 'CANCELLED'; claimExpiresAt: Date | null; attachedOrderId: string | null; fulfilledAt: Date | null; createdAt: Date;
};
type Where = Record<string, unknown>;

const row = (id: string, o: Partial<Row> = {}): Row => ({
  id, userId: 'u1', giftId: 'g1', giftKind: 'GIFT', giftName: `Quà ${id}`, code: `QG-${id.toUpperCase()}`, pointsCost: 12_000, status: 'READY',
  claimExpiresAt: new Date('2026-12-30T00:00:00Z'), attachedOrderId: null, fulfilledAt: null, createdAt: new Date('2026-11-01T00:00:00Z'), ...o,
});

/** Bộ dựng DB giả đủ cho các điều kiện where mà service dùng; lọc theo đúng ngữ nghĩa Prisma để test kiểm hành vi, không chỉ kiểm lời gọi. */
function makeDb(rows: Row[], orders: Record<string, string>) {
  const cmp = (value: unknown, cond: unknown): boolean => {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
      return value === cond;
    }
    const c = cond as Record<string, unknown>;
    return Object.entries(c).every(([op, arg]) => {
      if (op === 'in') return (arg as unknown[]).includes(value);
      if (op === 'not') return value !== arg;
      if (op === 'gte') return value instanceof Date && value >= (arg as Date);
      if (op === 'lt') return value instanceof Date && value < (arg as Date);
      throw new Error(`fake db: operator ${op} chưa hỗ trợ`);
    });
  };
  const matches = (r: Row, where: Where): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Where[]).some((w) => matches(r, w));
      if (key === 'AND') return (cond as Where[]).every((w) => matches(r, w));
      if (key === 'attachedOrder') {
        const status = r.attachedOrderId ? orders[r.attachedOrderId] : undefined;
        if (status === undefined) return false;
        return cmp(status, (cond as { is: { status: unknown } }).is.status);
      }
      return cmp((r as unknown as Record<string, unknown>)[key], cond);
    });

  let beforeUpdate: (() => void) | null = null;
  const self: { tx: unknown } = { tx: undefined };
  const db = {
    wasteGiftRedemption: {
      findMany: jest.fn(async (a: { where: Where; select?: Record<string, unknown>; orderBy?: unknown; take?: number }) => {
        let found = rows.filter((r) => matches(r, a.where));
        const order = Array.isArray(a.orderBy) ? a.orderBy : a.orderBy ? [a.orderBy] : [];
        found = [...found].sort((x, y) => {
          for (const o of order as Record<string, 'asc' | 'desc'>[]) {
            const [k, dir] = Object.entries(o)[0]!;
            const xv = (x as unknown as Record<string, unknown>)[k] as string | Date;
            const yv = (y as unknown as Record<string, unknown>)[k] as string | Date;
            if (xv < yv) return dir === 'asc' ? -1 : 1;
            if (xv > yv) return dir === 'asc' ? 1 : -1;
          }
          return 0;
        });
        if (a.take) found = found.slice(0, a.take);
        return found.map((r) => ({ ...r, attachedOrder: r.attachedOrderId ? { status: orders[r.attachedOrderId] } : null }));
      }),
      updateMany: jest.fn(async (a: { where: Where; data: Partial<Row> }) => {
        beforeUpdate?.();
        const hit = rows.filter((r) => matches(r, a.where));
        hit.forEach((r) => Object.assign(r, a.data));
        return { count: hit.length };
      }),
    },
    // $queryRaw nhận Prisma.Sql: values = [userId, ...ids, đầu ngày VN]; hàm lọc lặp lại đúng các điều kiện của câu SQL.
    $queryRaw: jest.fn(async (sql: { strings: string[]; values: unknown[] }) => {
      const [userId, ...rest] = sql.values;
      const claimStart = rest[rest.length - 1] as Date;
      const ids = rest.slice(0, -1);
      return rows
        .filter((r) => r.userId === userId && ids.includes(r.id) && r.status === 'READY' && r.attachedOrderId === null && (r.giftKind === 'GIFT' || r.giftKind === 'SEED_PACK') && (r.claimExpiresAt === null || r.claimExpiresAt >= claimStart))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((r) => ({ id: r.id }));
    }),
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(self.tx)),
  };
  self.tx = db;
  return { db, rows, orders, onBeforeUpdate: (fn: (() => void) | null) => { beforeUpdate = fn; } };
}

function setup(rows: Row[], orders: Record<string, string> = {}) {
  const f = makeDb(rows, orders);
  const svc = new WasteGiftAttachService(f.db as never);
  return { ...f, svc };
}

const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
  writeEvent.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('WasteGiftAttachService.listPending', () => {
  it('chỉ trả quà hiện vật READY, chưa gắn đơn, còn hạn, của đúng khách; sắp theo createdAt tăng dần', async () => {
    const rows = [
      row('late', { createdAt: new Date('2026-11-05T00:00:00Z') }),
      row('early', { giftKind: 'SEED_PACK', giftName: 'Gói hạt giống', createdAt: new Date('2026-11-02T00:00:00Z') }),
      row('no-deadline', { claimExpiresAt: null, createdAt: new Date('2026-11-03T00:00:00Z') }),
      row('deadline-today', { claimExpiresAt: new Date('2026-11-20T02:00:00Z'), createdAt: new Date('2026-11-04T00:00:00Z') }),
      row('expired', { claimExpiresAt: new Date('2026-11-19T10:00:00Z') }),
      row('other-user', { userId: 'u2' }),
      row('fulfilled', { status: 'FULFILLED' }),
      row('cancelled', { status: 'CANCELLED' }),
      row('attached', { attachedOrderId: 'o-live' }),
      row('voucher', { giftKind: 'VOUCHER' }),
    ];
    const h = setup(rows, { 'o-live': 'PENDING_PAYMENT' });

    const res = await h.svc.listPending('u1');

    expect(res.map((r) => r.id)).toEqual(['early', 'no-deadline', 'deadline-today', 'late']);
    expect(res[0]).toEqual({ id: 'early', code: 'QG-EARLY', giftName: 'Gói hạt giống', kind: 'SEED_PACK', pointsCost: 12_000 });
    expect(res[1]!.kind).toBe('GIFT');
  });

  it('dùng client truyền vào (trong transaction của đơn) thay vì prisma gốc', async () => {
    const own = setup([row('a')]);
    const other = setup([row('b')]);
    const res = await own.svc.listPending('u1', other.db as never);
    expect(res.map((r) => r.id)).toEqual(['b']);
    expect(own.db.wasteGiftRedemption.findMany).not.toHaveBeenCalled();
  });
});

describe('WasteGiftAttachService.attachInTx', () => {
  it('gắn đúng các quà hợp lệ, bỏ qua id sai chủ, đã gắn đơn khác, đã trao/huỷ, quá hạn hoặc không phải hàng hiện vật, không ném lỗi', async () => {
    const rows = [
      row('ok1', { createdAt: new Date('2026-11-02T00:00:00Z') }),
      row('ok2', { giftKind: 'SEED_PACK', createdAt: new Date('2026-11-03T00:00:00Z') }),
      row('other-user', { userId: 'u2' }),
      row('taken', { attachedOrderId: 'o-other' }),
      row('fulfilled', { status: 'FULFILLED' }),
      row('cancelled', { status: 'CANCELLED' }),
      row('expired', { claimExpiresAt: new Date('2026-11-19T10:00:00Z') }),
      row('voucher', { giftKind: 'VOUCHER' }),
      row('untouched'),
    ];
    const h = setup(rows, { 'o-other': 'CONFIRMED' });

    const res = await h.svc.attachInTx(h.db as never, 'u1', ['ok2', 'ok1', 'other-user', 'taken', 'fulfilled', 'cancelled', 'expired', 'voucher', 'khong-ton-tai'], 'o-new');

    expect(res.map((r) => r.id)).toEqual(['ok1', 'ok2']);
    expect(res[1]).toEqual({ id: 'ok2', code: 'QG-OK2', giftName: 'Quà ok2', kind: 'SEED_PACK', pointsCost: 12_000 });
    expect(rows.filter((r) => r.attachedOrderId === 'o-new').map((r) => r.id).sort()).toEqual(['ok1', 'ok2']);
    expect(byId(rows, 'other-user').attachedOrderId).toBeNull();
    expect(byId(rows, 'taken').attachedOrderId).toBe('o-other');
    expect(byId(rows, 'fulfilled').attachedOrderId).toBeNull();
    expect(byId(rows, 'cancelled').attachedOrderId).toBeNull();
    expect(byId(rows, 'expired').attachedOrderId).toBeNull();
    expect(byId(rows, 'voucher').attachedOrderId).toBeNull();
    expect(byId(rows, 'untouched').attachedOrderId).toBeNull();
    // Quà gắn rồi vẫn READY: chỉ giao đơn thành công mới chuyển FULFILLED.
    expect(byId(rows, 'ok1').status).toBe('READY');
  });

  it('khoá hàng bằng SELECT ... FOR UPDATE theo id trước khi ghi, đúng chủ và danh sách id', async () => {
    const h = setup([row('a'), row('b')]);
    await h.svc.attachInTx(h.db as never, 'u1', ['b', 'a'], 'o1');

    const sql = h.db.$queryRaw.mock.calls[0]![0] as unknown as { strings: string[]; values: unknown[] };
    const text = sql.strings.join('?');
    expect(text).toContain('FROM "waste_gift_redemptions"');
    expect(text).toContain('"attachedOrderId" IS NULL');
    expect(text).toContain(`"status" = 'READY'`);
    expect(text).toMatch(/ORDER BY "id"\s+FOR UPDATE/);
    expect(sql.values).toEqual(['u1', 'b', 'a', new Date('2026-11-19T17:00:00Z')]);
    expect(h.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.db.wasteGiftRedemption.updateMany.mock.invocationCallOrder[0]!);
  });

  it('không bao giờ gắn trùng: đơn thứ hai xin cùng quà nhận về rỗng và quà vẫn thuộc đơn thứ nhất', async () => {
    const h = setup([row('a')]);
    const first = await h.svc.attachInTx(h.db as never, 'u1', ['a'], 'o1');
    const second = await h.svc.attachInTx(h.db as never, 'u1', ['a'], 'o2');

    expect(first.map((r) => r.id)).toEqual(['a']);
    expect(second).toEqual([]);
    expect(byId(h.rows, 'a').attachedOrderId).toBe('o1');
  });

  it('khoá đọc bị lỗi thời (đơn khác gắn chen giữa khoá và ghi): updateMany có guard attachedOrderId null nên không ghi đè, kết quả rỗng', async () => {
    const h = setup([row('a')]);
    h.onBeforeUpdate(() => { byId(h.rows, 'a').attachedOrderId = 'o-winner'; });

    const res = await h.svc.attachInTx(h.db as never, 'u1', ['a'], 'o-loser');

    expect(res).toEqual([]);
    expect(byId(h.rows, 'a').attachedOrderId).toBe('o-winner');
  });

  it('danh sách rỗng hoặc id lặp: rỗng thì không chạm DB, lặp thì chỉ khoá một lần mỗi id', async () => {
    const h = setup([row('a')]);
    expect(await h.svc.attachInTx(h.db as never, 'u1', [], 'o1')).toEqual([]);
    expect(h.db.$queryRaw).not.toHaveBeenCalled();

    const res = await h.svc.attachInTx(h.db as never, 'u1', ['a', 'a', 'a'], 'o1');
    expect(res.map((r) => r.id)).toEqual(['a']);
    expect((h.db.$queryRaw.mock.calls[0]![0] as { values: unknown[] }).values).toEqual(['u1', 'a', new Date('2026-11-19T17:00:00Z')]);
  });
});

describe('WasteGiftAttachService.onOrderDelivered', () => {
  it('quà gắn đơn đã giao: READY thành FULFILLED, ghi fulfilledAt và một event GIFT_FULFILLED SYSTEM mỗi quà; quà của đơn khác không đổi', async () => {
    const rows = [row('a', { attachedOrderId: 'o1' }), row('b', { attachedOrderId: 'o1', giftId: 'g2' }), row('c', { attachedOrderId: 'o2' }), row('free')];
    const h = setup(rows, { o1: 'DELIVERED', o2: 'SHIPPING' });

    expect(await h.svc.onOrderDelivered('o1')).toBe(2);

    expect(byId(rows, 'a')).toMatchObject({ status: 'FULFILLED', fulfilledAt: NOW, attachedOrderId: 'o1' });
    expect(byId(rows, 'b')).toMatchObject({ status: 'FULFILLED', fulfilledAt: NOW });
    expect(byId(rows, 'c').status).toBe('READY');
    expect(byId(rows, 'free').status).toBe('READY');
    expect(writeEvent).toHaveBeenCalledTimes(2);
    expect(writeEvent).toHaveBeenCalledWith(h.db, {
      kind: 'GIFT_FULFILLED',
      actorUserId: null,
      actorRole: 'SYSTEM',
      giftRedemptionId: 'a',
      meta: { giftId: 'g1', subjectUserId: 'u1', orderId: 'o1', via: 'ORDER_DELIVERED', before: { status: 'READY' }, after: { status: 'FULFILLED' } },
    });
  });

  it('chạy lại (hook lặp hoặc quét bù chồng): trả 0 và không ghi thêm event', async () => {
    const h = setup([row('a', { attachedOrderId: 'o1' })], { o1: 'DELIVERED' });
    expect(await h.svc.onOrderDelivered('o1')).toBe(1);
    writeEvent.mockClear();
    expect(await h.svc.onOrderDelivered('o1')).toBe(0);
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('chỉ khi đơn thật sự DELIVERED: đơn đang giao hoặc đã huỷ thì quà giữ nguyên READY', async () => {
    const rows = [row('a', { attachedOrderId: 'o-ship' }), row('b', { attachedOrderId: 'o-cancel' })];
    const h = setup(rows, { 'o-ship': 'SHIPPING', 'o-cancel': 'CANCELLED' });
    expect(await h.svc.onOrderDelivered('o-ship')).toBe(0);
    expect(await h.svc.onOrderDelivered('o-cancel')).toBe(0);
    expect(rows.map((r) => r.status)).toEqual(['READY', 'READY']);
  });

  it('quà đã bị admin huỷ trong lúc đơn đi: không bị kéo lại thành FULFILLED', async () => {
    const rows = [row('a', { attachedOrderId: 'o1', status: 'CANCELLED' })];
    const h = setup(rows, { o1: 'DELIVERED' });
    expect(await h.svc.onOrderDelivered('o1')).toBe(0);
    expect(rows[0]!.status).toBe('CANCELLED');
  });
});

describe('WasteGiftAttachService.onOrderReleased', () => {
  it.each(['CANCELLED', 'RETURNED'])('đơn %s: bỏ gắn đơn nhưng quà vẫn READY và hiện lại cho đơn kế tiếp', async (status) => {
    const rows = [row('a', { attachedOrderId: 'o1' }), row('b', { attachedOrderId: 'o2' })];
    const h = setup(rows, { o1: status, o2: 'CONFIRMED' });

    expect(await h.svc.onOrderReleased('o1')).toBe(1);

    expect(byId(rows, 'a')).toMatchObject({ status: 'READY', attachedOrderId: null });
    expect(byId(rows, 'b').attachedOrderId).toBe('o2');
    expect((await h.svc.listPending('u1')).map((r) => r.id)).toEqual(['a']);
  });

  it('chạy lại không đổi gì', async () => {
    const h = setup([row('a', { attachedOrderId: 'o1' })], { o1: 'CANCELLED' });
    expect(await h.svc.onOrderReleased('o1')).toBe(1);
    expect(await h.svc.onOrderReleased('o1')).toBe(0);
  });

  it('đơn chưa huỷ (hook gọi nhầm lúc đơn còn sống) hoặc đã giao: không nhả quà; quà FULFILLED giữ dấu đơn đã mang nó', async () => {
    const rows = [row('live', { attachedOrderId: 'o-live' }), row('done', { attachedOrderId: 'o-done', status: 'FULFILLED', fulfilledAt: NOW })];
    const h = setup(rows, { 'o-live': 'SHIPPING', 'o-done': 'DELIVERED' });
    expect(await h.svc.onOrderReleased('o-live')).toBe(0);
    expect(await h.svc.onOrderReleased('o-done')).toBe(0);
    expect(byId(rows, 'live').attachedOrderId).toBe('o-live');
    expect(byId(rows, 'done')).toMatchObject({ status: 'FULFILLED', attachedOrderId: 'o-done' });
  });
});

describe('WasteGiftAttachService vòng đời', () => {
  it('gắn đơn 1, đơn 1 huỷ nên nhả, gắn đơn 2, đơn 2 giao nên FULFILLED; không hiện lại sau đó', async () => {
    const rows = [row('a')];
    const orders: Record<string, string> = { o1: 'CONFIRMED', o2: 'CONFIRMED' };
    const h = setup(rows, orders);

    expect((await h.svc.listPending('u1')).map((r) => r.id)).toEqual(['a']);
    await h.svc.attachInTx(h.db as never, 'u1', ['a'], 'o1');
    expect(await h.svc.listPending('u1')).toEqual([]);

    orders.o1 = 'CANCELLED';
    await h.svc.onOrderReleased('o1');
    expect((await h.svc.listPending('u1')).map((r) => r.id)).toEqual(['a']);

    await h.svc.attachInTx(h.db as never, 'u1', ['a'], 'o2');
    orders.o2 = 'DELIVERED';
    expect(await h.svc.onOrderDelivered('o2')).toBe(1);
    expect(await h.svc.listPending('u1')).toEqual([]);
    expect(byId(rows, 'a')).toMatchObject({ status: 'FULFILLED', attachedOrderId: 'o2' });
  });
});

describe('WasteGiftAttachService.reconcile', () => {
  it('quét bù: quà còn gắn đơn đã giao thì hoàn tất, đơn đã huỷ/trả thì nhả, đơn còn sống thì để yên', async () => {
    const rows = [
      row('del', { attachedOrderId: 'o-del' }),
      row('can', { attachedOrderId: 'o-can' }),
      row('ret', { attachedOrderId: 'o-ret' }),
      row('live', { attachedOrderId: 'o-live' }),
      row('free'),
    ];
    const h = setup(rows, { 'o-del': 'DELIVERED', 'o-can': 'CANCELLED', 'o-ret': 'RETURNED', 'o-live': 'SHIPPING' });

    expect(await h.svc.reconcile()).toEqual({ fulfilled: 1, released: 2 });

    expect(byId(rows, 'del')).toMatchObject({ status: 'FULFILLED', attachedOrderId: 'o-del' });
    expect(byId(rows, 'can')).toMatchObject({ status: 'READY', attachedOrderId: null });
    expect(byId(rows, 'ret')).toMatchObject({ status: 'READY', attachedOrderId: null });
    expect(byId(rows, 'live')).toMatchObject({ status: 'READY', attachedOrderId: 'o-live' });
    expect(await h.svc.reconcile()).toEqual({ fulfilled: 0, released: 0 });
  });

  it('một đơn lỗi không chặn các đơn còn lại', async () => {
    const rows = [row('a', { attachedOrderId: 'o-a' }), row('b', { attachedOrderId: 'o-b' })];
    const h = setup(rows, { 'o-a': 'CANCELLED', 'o-b': 'CANCELLED' });
    const real = h.db.wasteGiftRedemption.updateMany.getMockImplementation()!;
    h.db.wasteGiftRedemption.updateMany.mockImplementationOnce(async () => { throw new Error('db down'); });
    h.db.wasteGiftRedemption.updateMany.mockImplementation(real);

    expect(await h.svc.reconcile()).toEqual({ fulfilled: 0, released: 1 });
    expect(rows.filter((r) => r.attachedOrderId === null)).toHaveLength(1);
  });
});
