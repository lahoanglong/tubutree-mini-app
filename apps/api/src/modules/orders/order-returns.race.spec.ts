import { HttpException, Logger } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { pgLikeClient } from '../../../test/fakes/race-db-client';
import { OrderReturnsService } from './order-returns.service';

/**
 * Yêu cầu đổi/trả của một đơn DELIVERED bị nhiều bên giành (xem test/fakes/race-db.fake.ts):
 *  - khách gửi yêu cầu song song: guard thật là unique một phần `orderId WHERE status = 'REQUESTED'` (migration return_request_open_unique);
 *  - admin duyệt / từ chối / duyệt hai lần cùng một yêu cầu: chỉ một bên chuyển được REQUESTED, hàm đảo tiền/điểm chạy đúng một lần;
 *  - đơn rời DELIVERED (huỷ/trả do admin hoặc webhook) chen giữa lúc duyệt: khoá dòng đơn quyết định ai trước;
 *  - xác nhận nhận hàng về hai lần: kho chỉ cộng một lần.
 * Dùng OrderReturnsService THẬT. Các hàm đảo tiền/điểm/kho của OrderReversalService là stub ghi dấu vào bảng của DB giả TRONG transaction, nên
 * transaction rollback thì dấu cũng mất: "đảo đúng một lần" nghĩa là đúng một dòng dấu còn lại sau cùng, không chỉ số lần gọi.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const message = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as Error).message : null);
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);
const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'fulfilled');

const DUP_OPEN = 'Đơn đang có yêu cầu đổi/trả chờ xử lý.';
const HANDLED = 'Yêu cầu đã được xử lý.';
const NOT_RECEIVABLE = 'Yêu cầu chưa được duyệt hoặc đã ghi nhận nhận hàng trước đó.';
const ORDER_MOVED = /^Đơn không ở trạng thái có thể trả/;
const REJECT_NOTE = 'Hàng đã qua sử dụng';
const DAY = 864e5;

type Shape = 'full' | 'partial';
/** Đơn có hai dòng: a ×3 (270k) và b ×1 (30k). `full` trả hết, `partial` chỉ trả 1 cái của dòng a. */
const LINES: Record<Shape, { orderItemId: string; quantity: number }[]> = {
  full: [
    { orderItemId: 'ia', quantity: 3 },
    { orderItemId: 'ib', quantity: 1 },
  ],
  partial: [{ orderItemId: 'ia', quantity: 1 }],
};

/** Giá trị mặc định cột của ReturnRequest (như @default trong schema); seed không tự áp nên dùng lại khi dựng dòng. */
const REQUEST_DEFAULTS = {
  status: 'REQUESTED',
  refundMethod: 'WALLET',
  fullReturn: false,
  refundAmount: null,
  shippingRefund: 0,
  pointsRefunded: 0,
  convertedPointsRefunded: 0,
  pointsReversed: 0,
  commissionReversed: 0,
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  receivedAt: null,
  receivedBy: null,
  shopFault: null,
  images: [] as string[],
  createdAt: new Date(),
};

const TABLES = {
  user: {},
  storefront: {},
  order: { relations: { fulfillerStorefront: { table: 'storefront', fk: 'fulfillerStorefrontId' } } },
  orderItem: {},
  orderStatusHistory: {},
  returnRequest: { defaults: REQUEST_DEFAULTS, unique: [{ fields: ['orderId'], when: (r: any) => r.status === 'REQUESTED' }] },
  returnRequestItem: {},
  reversalLedger: {},
  restockLedger: {},
};

/** Quan hệ một-nhiều mà RaceDb chưa nối (`include/select: { items }`): nạp từ bảng dòng con trong cùng client nên cùng tầm nhìn transaction. */
const CHILD: Record<string, { table: string; fk: string }> = {
  returnRequest: { table: 'returnRequestItem', fk: 'returnRequestId' },
  order: { table: 'orderItem', fk: 'orderId' },
};
const FINDERS = ['findMany', 'findFirst', 'findUnique', 'findUniqueOrThrow', 'findFirstOrThrow'];

/**
 * Bộ chuyển cho ba kiểu truy vấn Prisma mà RaceDb chưa có: nối dòng con `items`, `select` quan hệ (`fulfillerStorefront`) và tạo lồng
 * `items: { create }` (Prisma ghi cha và con trong một transaction; ở đây cũng vậy nên unique đụng thì dòng con không bị mồ côi).
 */
function adapt(client: any): any {
  const out: any = { ...client };
  for (const [table, model] of Object.entries<any>(client)) {
    if (!model || typeof model.findMany !== 'function') continue;
    const child = CHILD[table];
    const wrapped: any = { ...model };
    for (const finder of FINDERS) {
      wrapped[finder] = async (args?: any) => {
        const call = args?.select?.fulfillerStorefront ? { ...args, include: { ...args.include, fulfillerStorefront: true } } : args;
        const result = await model[finder](call);
        if (!child || !result || !(args?.include?.items || args?.select?.items)) return result;
        for (const row of Array.isArray(result) ? result : [result]) row.items = await client[child.table].findMany({ where: { [child.fk]: row.id } });
        return result;
      };
    }
    if (table === 'returnRequest') {
      wrapped.create = async (args: any) => {
        const { items, ...data } = args.data;
        const insert = async (c: any) => {
          const row = await c.returnRequest.create({ ...args, data });
          const made: any[] = [];
          for (const it of items?.create ?? []) made.push(await c.returnRequestItem.create({ data: { returnRequestId: row.id, ...it } }));
          return { ...row, items: made };
        };
        return typeof client.$transaction === 'function' ? client.$transaction(insert) : insert(client);
      };
    }
    out[table] = wrapped;
  }
  if (typeof client.$transaction === 'function') out.$transaction = (fn: (tx: any) => Promise<unknown>) => client.$transaction((tx: any) => fn(adapt(tx)));
  return out;
}

function setup(opts: { merchant?: boolean } = {}) {
  const db = new RaceDb(TABLES);
  db.seed('user', [
    { id: 'u1', fullName: 'An', phone: '0900000001' },
    { id: 'admin1', fullName: 'Admin 1', phone: '0900000002' },
    { id: 'admin2', fullName: 'Admin 2', phone: '0900000003' },
    { id: 'shop-owner', fullName: 'Chủ shop', phone: '0900000004' },
  ]);
  db.seed('storefront', [{ id: 'sf1', ownerUserId: 'shop-owner', type: 'MERCHANT', isPartner: true, title: 'Vườn Bà Năm' }]);
  db.seed('order', [
    {
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      type: 'RETAIL',
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      placedForCustomer: false,
      total: 300_000,
      shippingFee: 0,
      pointsUsed: 0,
      pointsUsedConverted: 0,
      pointsEarned: 0,
      pancakeOrderId: null,
      reversalEffectsAt: null,
      deliveredAt: new Date(Date.now() - 2 * DAY),
      updatedAt: new Date(),
      createdAt: new Date(Date.now() - 5 * DAY),
      fulfiller: opts.merchant ? 'MERCHANT' : 'TUBU',
      fulfillerStorefrontId: opts.merchant ? 'sf1' : null,
    },
  ]);
  const item = (id: string, quantity: number, total: number) => ({
    id,
    orderId: 'o1',
    variationId: `v-${id}`,
    productName: `SP ${id}`,
    variationName: 'Mặc định',
    unitPrice: total / quantity,
    quantity,
    total,
    paidTotal: total,
    pointsDiscount: 0,
    flashSaleItemId: null,
    backorderedQty: 0,
  });
  db.seed('orderItem', [item('ia', 3, 270_000), item('ib', 1, 30_000)]);

  // Khoá đơn chỉ có hiệu lực khi chính câu SQL còn FOR UPDATE (RawContext.locking): sửa mã nguồn bỏ nó thì khoá biến mất theo.
  db.handlers.push(
    { match: /UPDATE "orders" SET "pancakeAttention" = NULL/, run: () => 0 },
    { match: /unnest\(rr\."images"\)/, run: () => [] },
    {
      match: /FROM "orders" WHERE "id" = \?/,
      run: async (c) => {
        if (c.locking) await c.lockRow('order', c.params[0] as string);
        return [{ id: c.params[0] }];
      },
    },
  );
  const raw = pgLikeClient(db);
  const client = adapt(raw);

  const reversal = {
    reverseFinancials: jest.fn(async (tx: any, _order: any, opts2: any) => {
      await tx.reversalLedger.create({ data: { requestId: opts2.returnRequestId, kind: 'FULL' } });
      return { refund: { amount: 300_000, to: 'WALLET' }, referralNotices: [] };
    }),
    reversePartialReturn: jest.fn(async (tx: any, _order: any, opts2: any) => {
      await tx.reversalLedger.create({ data: { requestId: opts2.requestId, kind: 'PARTIAL' } });
      return {
        refund: { amount: opts2.shares.goods + opts2.shares.shipping, to: 'WALLET' },
        pointsBack: 0,
        commissionCut: 0,
        commissionCutBy: [],
        commissionDebited: [],
        commissionManual: [],
        referralNotices: [],
      };
    }),
    restockReturnedItems: jest.fn(async (tx: any, _order: any, lines: any[]) => {
      const requestId = lines[0]?.returnRequestId;
      const [req] = await tx.returnRequest.findMany({ where: { id: requestId } });
      // Sổ ghi đúng dòng và số lượng được giao cho hàm cộng kho: "cộng một lần" phải đúng cả phần được trả, không chỉ số lần gọi.
      const restocked = lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })).sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
      await tx.restockLedger.create({ data: { requestId, statusAtRestock: req?.status, lines: restocked } });
      return lines.reduce((s, l) => s + l.quantity, 0);
    }),
  };
  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const loyalty = { pointsExpiresAt: jest.fn(async () => new Date()), reverseOrderPoints: jest.fn(async () => undefined) };
  const affiliate = { alertPaidCommissionOfReversedOrder: jest.fn(async () => undefined), reverseCommissionsForOrder: jest.fn(async () => undefined) };
  const gameWater = { reverseForOrder: jest.fn(async () => undefined) };
  const notifications = { notify: jest.fn(async () => undefined), notifySafe: jest.fn(async () => true) };
  const svc = new OrderReturnsService(client as never, config as never, reversal as never, loyalty as never, affiliate as never, notifications as never, gameWater as never);

  const seedRequest = (id: string, status: string, shape: Shape, over: Record<string, unknown> = {}) => {
    db.seed('returnRequest', [{ ...REQUEST_DEFAULTS, id, orderId: 'o1', userId: 'u1', reason: 'Sản phẩm lỗi, hỏng', reasonCode: 'DEFECTIVE', status, ...over }]);
    db.seed('returnRequestItem', LINES[shape].map((l) => ({ returnRequestId: id, ...l, refundAmount: null })));
  };

  /** Việc khác đổi đơn khỏi DELIVERED (admin đổi trạng thái / webhook vận chuyển): khoá dòng đơn rồi đổi có điều kiện, ghi lại nó thấy gì. */
  const moveOrder = async (to: string) => {
    const seen = { reversals: -1, moved: false };
    await raw.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${'o1'} FOR UPDATE`;
      seen.reversals = (await tx.reversalLedger.findMany({})).length;
      const r = await tx.order.updateMany({ where: { id: 'o1', status: 'DELIVERED' }, data: { status: to } });
      seen.moved = r.count === 1;
    });
    return seen;
  };

  const reversalCalls = () => reversal.reverseFinancials.mock.calls.length + reversal.reversePartialReturn.mock.calls.length;
  return {
    db,
    svc,
    reversal,
    notifications,
    seedRequest,
    moveOrder,
    reversalCalls,
    request: () => db.row('returnRequest', 'r1')!,
    order: () => db.row('order', 'o1')!,
    reversals: () => db.rows('reversalLedger'),
    restocks: () => db.rows('restockLedger'),
    open: () => db.rows('returnRequest').filter((r) => r.status === 'REQUESTED'),
  };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('OrderReturnsService.request — race', () => {
  it('5 lần gửi song song cho cùng một đơn DELIVERED: đúng MỘT yêu cầu REQUESTED (cùng các dòng trả), 4 lần còn lại nhận 400 "đang có yêu cầu chờ xử lý"', async () => {
    const h = setup();
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => h.svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE' })));
    expect(fulfilled(settled)).toHaveLength(1);
    const lost = settled.filter((s) => s.status === 'rejected');
    expect(lost).toHaveLength(4);
    for (const s of lost) {
      expect(httpStatus(s)).toBe(400);
      expect(message(s)).toBe(DUP_OPEN);
    }
    const winner = (fulfilled(settled)[0] as PromiseFulfilledResult<any>).value;
    expect(h.db.rows('returnRequest')).toHaveLength(1);
    expect(h.open()).toHaveLength(1);
    expect(h.open()[0]!.id).toBe(winner.id);
    expect(h.db.rows('returnRequestItem').map((i) => `${i.returnRequestId}:${i.orderItemId}:${i.quantity}`).sort()).toEqual([`${winner.id}:ia:3`, `${winner.id}:ib:1`]);
    expect(h.notifications.notifySafe.mock.calls.filter((c: any[]) => c[1] === 'RETURN_REQUESTED')).toHaveLength(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('gửi lần hai sau khi lần một đã xong: bị chặn ở bước kiểm trước, vẫn 400 cùng câu và chỉ một dòng', async () => {
    const h = setup();
    await h.svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE' });
    await expect(h.svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE' })).rejects.toThrow(DUP_OPEN);
    expect(h.db.rows('returnRequest')).toHaveLength(1);
  });

  it('quét độ lệch giữa hai lần gửi: lần nào cũng đúng một yêu cầu mở và một lần thua 400', async () => {
    const seen = new Set<string>();
    for (let skew = -25; skew <= 25; skew++) {
      const h = setup();
      const send = (wait: number) => async () => (await delay(wait), h.svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE' }));
      const settled = await Promise.allSettled([send(Math.max(skew, 0))(), send(Math.max(-skew, 0))()]);
      const label = `skew ${skew}`;
      is(label, fulfilled(settled).length, 1);
      is(label, h.open().length, 1);
      is(label, h.db.rows('returnRequest').length, 1);
      is(label, h.db.rows('returnRequestItem').length, 2);
      const lost = settled.find((s) => s.status === 'rejected')!;
      is(label, [httpStatus(lost), message(lost)], [400, DUP_OPEN]);
      seen.add(h.db.stats.lockWaits > 0 ? 'đụng khoá unique' : 'tuần tự');
    }
    expect(seen).toEqual(new Set(['đụng khoá unique', 'tuần tự']));
  });

  it.each(['REJECTED', 'APPROVED'])('yêu cầu cũ đã %s thì tạo được yêu cầu mới; gửi ba lần song song vẫn chỉ thêm đúng một yêu cầu mở', async (prior) => {
    const h = setup();
    h.seedRequest('old', prior, 'partial', { fullReturn: false });
    const settled = await Promise.allSettled(Array.from({ length: 3 }, () => h.svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE' })));
    expect(fulfilled(settled)).toHaveLength(1);
    expect(h.db.rows('returnRequest')).toHaveLength(2);
    expect(h.open()).toHaveLength(1);
    expect(h.db.row('returnRequest', 'old')!.status).toBe(prior);
    for (const s of settled.filter((x) => x.status === 'rejected')) expect(message(s)).toBe(DUP_OPEN);
  });
});

describe('OrderReturnsService.review — race', () => {
  it.each(['full', 'partial'] as Shape[])('duyệt vs từ chối cùng một yêu cầu (%s), quét độ lệch: đúng một bên thắng, đảo tiền/điểm khớp bên thắng, bên thua nhận 400 "đã được xử lý"', async (shape) => {
    const seen = new Set<string>();
    let waits = 0;
    for (let skew = -30; skew <= 30; skew++) {
      const h = setup();
      h.seedRequest('r1', 'REQUESTED', shape);
      const approve = async () => (await delay(Math.max(skew, 0)), h.svc.review('admin1', 'r1', { approve: true }));
      const reject = async () => (await delay(Math.max(-skew, 0)), h.svc.review('admin2', 'r1', { approve: false, note: REJECT_NOTE }));
      const [a, r] = await Promise.allSettled([approve(), reject()]);
      const label = `${shape} skew ${skew}`;
      is(label, [a, r].filter((s) => s.status === 'fulfilled').length, 1);
      is(label, h.reversalCalls(), h.reversals().length);
      if (a.status === 'fulfilled') {
        is(label, h.request().status, 'APPROVED');
        is(label, h.request().reviewedBy, 'admin1');
        is(label, h.reversals().length, 1);
        is(label, h.order().status, shape === 'full' ? 'RETURNED' : 'DELIVERED');
        is(label, [httpStatus(r), message(r)], [400, HANDLED]);
        is(label, h.notifications.notifySafe.mock.calls.filter((c: any[]) => c[1] === 'RETURN_REJECTED').length, 0);
        seen.add('duyệt thắng');
      } else {
        is(label, h.request().status, 'REJECTED');
        is(label, h.request().reviewedBy, 'admin2');
        is(label, h.request().adminNote, REJECT_NOTE);
        is(label, h.reversals().length, 0);
        is(label, h.order().status, 'DELIVERED');
        is(label, [httpStatus(a), message(a)], [400, HANDLED]);
        is(label, h.notifications.notifySafe.mock.calls.filter((c: any[]) => c[1] === 'RETURN_APPROVED_DETAIL').length, 0);
        seen.add('từ chối thắng');
      }
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['duyệt thắng', 'từ chối thắng']));
    expect(waits).toBeGreaterThan(0);
  });

  it.each(['full', 'partial'] as Shape[])('ba admin cùng duyệt một yêu cầu (%s): đảo tiền đúng MỘT lần, hai bên thua nhận 400', async (shape) => {
    const h = setup();
    h.seedRequest('r1', 'REQUESTED', shape);
    const settled = await Promise.allSettled(['admin1', 'admin2', 'admin3'].map((id) => h.svc.review(id, 'r1', { approve: true })));
    expect(fulfilled(settled)).toHaveLength(1);
    for (const s of settled.filter((x) => x.status === 'rejected')) expect([httpStatus(s), message(s)]).toEqual([400, HANDLED]);
    expect(h.reversals()).toHaveLength(1);
    expect(h.reversalCalls()).toBe(1);
    expect(h.request().status).toBe('APPROVED');
    expect(h.order().status).toBe(shape === 'full' ? 'RETURNED' : 'DELIVERED');
    expect(h.db.rows('returnRequestItem').filter((i) => i.returnRequestId === 'r1')).toHaveLength(LINES[shape].length);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it.each(['full', 'partial'] as Shape[])('duyệt hai lần quét độ lệch rồi duyệt lại khi đã duyệt (%s): đảo tiền vẫn đúng một lần', async (shape) => {
    let waits = 0;
    for (let skew = -20; skew <= 20; skew++) {
      const h = setup();
      h.seedRequest('r1', 'REQUESTED', shape);
      const approve = (admin: string, wait: number) => async () => (await delay(wait), h.svc.review(admin, 'r1', { approve: true }));
      const settled = await Promise.allSettled([approve('admin1', Math.max(skew, 0))(), approve('admin2', Math.max(-skew, 0))()]);
      const label = `${shape} skew ${skew}`;
      is(label, fulfilled(settled).length, 1);
      is(label, h.reversals().length, 1);
      is(label, h.reversalCalls(), 1);
      await expect(h.svc.review('admin3', 'r1', { approve: true })).rejects.toThrow(HANDLED);
      is(label, h.reversals().length, 1);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it.each([
    ['full', 'CANCELLED'],
    ['full', 'RETURNED'],
    ['partial', 'CANCELLED'],
    ['partial', 'RETURNED'],
  ] as [Shape, string][])('duyệt chen với việc đơn rời DELIVERED (%s, đơn sang %s), quét độ lệch: hoặc duyệt xong trước, hoặc đơn đổi trước và duyệt rollback; không bao giờ vừa đảo tiền vừa huỷ trên số liệu cũ', async (shape, to) => {
    const seen = new Set<string>();
    let waits = 0;
    for (let skew = -30; skew <= 30; skew++) {
      const h = setup();
      h.seedRequest('r1', 'REQUESTED', shape);
      const approve = async () => (await delay(Math.max(skew, 0)), h.svc.review('admin1', 'r1', { approve: true }));
      const mover = async () => (await delay(Math.max(-skew, 0)), h.moveOrder(to));
      const [a, m] = await Promise.allSettled([approve(), mover()]);
      const label = `${shape}→${to} skew ${skew}`;
      is(label, m.status, 'fulfilled');
      const moved = (m as PromiseFulfilledResult<{ reversals: number; moved: boolean }>).value;
      is(label, h.reversalCalls(), h.reversals().length);
      if (a.status === 'fulfilled') {
        is(label, h.reversals().length, 1);
        is(label, h.request().status, 'APPROVED');
        if (shape === 'full') {
          // Trả cả đơn lật đơn sang RETURNED ngay trong lần duyệt: việc đổi đơn sau đó không còn thấy DELIVERED.
          is(label, h.order().status, 'RETURNED');
          is(label, moved.moved, false);
        } else {
          // Chỉ được đổi đơn SAU khi lần duyệt đã commit (đã thấy dấu đảo): đổi trên số liệu cũ là hoàn tiền rồi còn huỷ đơn.
          is(label, moved.moved, true);
          is(label, moved.reversals, 1);
          is(label, h.order().status, to);
        }
        seen.add('duyệt xong trước');
      } else {
        is(label, httpStatus(a), 400);
        expect({ label, message: message(a) }).toEqual({ label, message: expect.stringMatching(ORDER_MOVED) });
        is(label, h.reversals().length, 0);
        is(label, h.request().status, 'REQUESTED');
        is(label, h.request().reviewedBy, null);
        is(label, h.order().status, to);
        is(label, moved.moved, true);
        is(label, h.db.rows('orderStatusHistory').length, 0);
        seen.add('đơn đổi trước');
      }
      waits += h.db.stats.lockWaits;
    }
    expect(seen).toEqual(new Set(['duyệt xong trước', 'đơn đổi trước']));
    expect(waits).toBeGreaterThan(0);
  });
});

describe('OrderReturnsService.markReceived — race', () => {
  it('ba lần xác nhận nhận hàng song song: kho cộng đúng MỘT lần, receivedBy là người thắng, hai bên thua nhận 400', async () => {
    const h = setup();
    h.seedRequest('r1', 'APPROVED', 'partial', { reviewedBy: 'admin1' });
    const admins = ['admin1', 'admin2', 'admin3'];
    const settled = await Promise.allSettled(admins.map((id) => h.svc.markReceived(id, 'r1')));
    expect(fulfilled(settled)).toHaveLength(1);
    for (const s of settled.filter((x) => x.status === 'rejected')) expect([httpStatus(s), message(s)]).toEqual([400, NOT_RECEIVABLE]);
    const winner = admins[settled.findIndex((s) => s.status === 'fulfilled')];
    expect(h.reversal.restockReturnedItems).toHaveBeenCalledTimes(1);
    expect(h.restocks()).toHaveLength(1);
    expect(h.restocks()[0]).toMatchObject({ requestId: 'r1', statusAtRestock: 'APPROVED', lines: LINES.partial });
    expect(h.request()).toMatchObject({ status: 'APPROVED', receivedBy: winner });
    expect(h.request().receivedAt).toBeInstanceOf(Date);
    expect(h.notifications.notifySafe.mock.calls.filter((c: any[]) => c[1] === 'RETURN_RECEIVED')).toHaveLength(1);
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('quét độ lệch giữa hai lần xác nhận: lần nào cũng đúng một lần cộng kho và receivedAt chỉ ghi một lần', async () => {
    let waits = 0;
    for (let skew = -20; skew <= 20; skew++) {
      const h = setup();
      h.seedRequest('r1', 'APPROVED', 'full', { reviewedBy: 'admin1' });
      const recv = (admin: string, wait: number) => async () => (await delay(wait), h.svc.markReceived(admin, 'r1'));
      const settled = await Promise.allSettled([recv('admin1', Math.max(skew, 0))(), recv('admin2', Math.max(-skew, 0))()]);
      const label = `skew ${skew}`;
      is(label, fulfilled(settled).length, 1);
      is(label, h.restocks().length, 1);
      is(label, h.restocks()[0]!.lines, LINES.full);
      is(label, h.reversal.restockReturnedItems.mock.calls.length, 1);
      const lost = settled.find((s) => s.status === 'rejected')!;
      is(label, [httpStatus(lost), message(lost)], [400, NOT_RECEIVABLE]);
      const won = (fulfilled(settled)[0] as PromiseFulfilledResult<any>).value;
      // Bên thắng đọc lại yêu cầu sau khi commit: mốc nhận hàng nó thấy phải chính là mốc còn lại trong DB (không bị bên thua ghi đè).
      is(label, new Date(won.receivedAt).getTime(), h.request().receivedAt.getTime());
      is(label, h.request().receivedBy, won.receivedBy);
      waits += h.db.stats.lockWaits;
    }
    expect(waits).toBeGreaterThan(0);
  });

  it('gian hàng đối tác xác nhận nhận hàng hai lần song song: kho gian hàng cộng một lần, bên thua 400; admin Tubu không nhận hàng của gian hàng', async () => {
    const h = setup({ merchant: true });
    h.seedRequest('r1', 'APPROVED', 'partial', { reviewedBy: 'admin1' });
    const settled = await Promise.allSettled([
      h.svc.markReceivedByMerchant('shop-owner', 'r1'),
      h.svc.markReceivedByMerchant('shop-owner', 'r1'),
      h.svc.markReceived('admin1', 'r1'),
    ]);
    expect(fulfilled(settled)).toHaveLength(1);
    expect(settled[0]!.status === 'fulfilled' || settled[1]!.status === 'fulfilled').toBe(true);
    expect(settled[2]!.status).toBe('rejected');
    expect(message(settled[2]!)).toMatch(/không về kho Tubu/);
    const lostMerchant = settled.slice(0, 2).find((s) => s.status === 'rejected')!;
    expect([httpStatus(lostMerchant), message(lostMerchant)]).toEqual([400, NOT_RECEIVABLE]);
    const view = (settled.slice(0, 2).find((s) => s.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    expect(view).toMatchObject({ id: 'r1', status: 'APPROVED', orderCode: 'TUBU1' });
    expect(view.receivedAt).toBeInstanceOf(Date);
    expect(h.restocks()).toHaveLength(1);
    expect(h.request().receivedBy).toBe('shop-owner');
    expect(h.db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('yêu cầu chưa duyệt (REQUESTED) mà bấm nhận hàng: 400, kho không đổi, receivedAt vẫn trống', async () => {
    const h = setup();
    h.seedRequest('r1', 'REQUESTED', 'partial');
    await expect(h.svc.markReceived('admin1', 'r1')).rejects.toThrow(NOT_RECEIVABLE);
    expect(h.restocks()).toHaveLength(0);
    expect(h.request().receivedAt).toBeNull();
  });

  it('duyệt chen với nhận hàng, quét độ lệch: kho chỉ cộng khi yêu cầu đã APPROVED lúc cộng, và không bao giờ cộng khi receivedAt trống', async () => {
    const seen = new Set<string>();
    for (let skew = -40; skew <= 40; skew++) {
      const h = setup();
      h.seedRequest('r1', 'REQUESTED', 'partial');
      const approve = async () => (await delay(Math.max(skew, 0)), h.svc.review('admin1', 'r1', { approve: true }));
      const receive = async () => (await delay(Math.max(-skew, 0)), h.svc.markReceived('admin2', 'r1'));
      const [a, r] = await Promise.allSettled([approve(), receive()]);
      const label = `skew ${skew}`;
      is(label, a.status, 'fulfilled');
      is(label, h.request().status, 'APPROVED');
      is(label, h.reversals().length, 1);
      if (r.status === 'fulfilled') {
        is(label, h.restocks().length, 1);
        is(label, h.restocks()[0]!.statusAtRestock, 'APPROVED');
        is(label, h.request().receivedBy, 'admin2');
        seen.add('nhận sau khi duyệt');
      } else {
        is(label, [httpStatus(r), message(r)], [400, NOT_RECEIVABLE]);
        is(label, h.restocks().length, 0);
        is(label, h.request().receivedAt, null);
        seen.add('nhận trước khi duyệt');
      }
    }
    expect(seen).toEqual(new Set(['nhận sau khi duyệt', 'nhận trước khi duyệt']));
  });
});
