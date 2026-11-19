import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminService } from './admin.service';
import { AdminController, ExportOrdersQuery, ListOrdersQuery, OrderOpsCountsQuery, OrderStatusCountsQuery } from './admin.controller';
import {
  BANK_TRANSFER_OVERDUE_CANCELLED_WHERE,
  BANK_TRANSFER_TO_CONFIRM_WHERE,
  buildAdminOrderWhere,
  GUEST_WEB_ORDER_WHERE,
  OVERDUE_CANCELLED_ID_CAP,
} from './admin-order-filter';
import { findOverdueCancelledIds, latestCancellations, orderGuestSource } from './admin-order-ops';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const ADMIN = { role: 'ADMIN' as const };
const KE_TOAN = { role: 'STAFF' as const, staffPermissions: ['KE_TOAN'] };

function mkAdmin(prisma: unknown, ttlHours: unknown = 24) {
  const config = { get: jest.fn((key: string, fallback?: unknown) => Promise.resolve(key === 'orders.pending_payment_ttl_hours' ? ttlHours : fallback)) };
  const Ctor = AdminService as unknown as new (...args: unknown[]) => AdminService;
  return new Ctor(prisma as PrismaService, config as unknown as SystemConfigService, ...Array.from({ length: 8 }, () => ({})));
}

describe('buildAdminOrderWhere — bộ lọc vận hành (w7-03)', () => {
  it('guest=web lọc đơn có guestPhone (cả đơn đã gộp Zalo)', () => {
    expect(buildAdminOrderWhere({ guest: 'web' })).toEqual(GUEST_WEB_ORDER_WHERE);
    expect(GUEST_WEB_ORDER_WHERE).toEqual({ guestPhone: { not: null } });
  });

  it('queue=bank_transfer_overdue_cancelled: đơn lẻ CK đã huỷ VÀ nằm trong tập id tra trước; thiếu tập id thì rỗng, không lộ mọi đơn huỷ', () => {
    expect(buildAdminOrderWhere({ queue: 'bank_transfer_overdue_cancelled', overdueCancelledIds: ['o1', 'o2'] })).toEqual({
      AND: [BANK_TRANSFER_OVERDUE_CANCELLED_WHERE, { id: { in: ['o1', 'o2'] } }],
    });
    expect(buildAdminOrderWhere({ queue: 'bank_transfer_overdue_cancelled' })).toEqual({
      AND: [BANK_TRANSFER_OVERDUE_CANCELLED_WHERE, { id: { in: [] } }],
    });
  });

  it('ghép được với vãng lai và khoảng ngày', () => {
    const w = buildAdminOrderWhere({ guest: 'web', queue: 'bank_transfer_to_confirm', from: '2026-11-19', to: '2026-11-19' }) as { AND: unknown[] };
    expect(w.AND).toEqual(expect.arrayContaining([BANK_TRANSFER_TO_CONFIRM_WHERE, GUEST_WEB_ORDER_WHERE]));
  });
});

describe('findOverdueCancelledIds — tập id đơn tự huỷ quá hạn chuyển khoản', () => {
  const sqlOf = (q: jest.Mock) => {
    const [strings, ...vals] = q.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const s = Prisma.sql(strings, ...vals);
    return { text: s.sql.replace(/\s+/g, ' '), values: s.values };
  };

  it('chỉ lấy dòng lịch sử SYSTEM PENDING_PAYMENT → CANCELLED của đơn lẻ chuyển khoản, mới nhất trước, có trần', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ id: 'o2' }, { id: 'o1' }]);
    expect(await findOverdueCancelledIds({ $queryRaw } as never)).toEqual(['o2', 'o1']);
    const { text, values } = sqlOf($queryRaw);
    expect(text).toContain(`o.status = 'CANCELLED' AND o."paymentMethod" = 'BANK_TRANSFER' AND o.type = 'RETAIL'`);
    expect(text).toContain(`h."toStatus" = 'CANCELLED' AND h."fromStatus" = 'PENDING_PAYMENT' AND h."actorType" = 'SYSTEM'`);
    expect(text).toContain('ORDER BY o."createdAt" DESC');
    expect(text).not.toContain('>=');
    expect(values).toEqual([OVERDUE_CANCELLED_ID_CAP]);
  });

  it('khoảng ngày giờ VN đổi về mốc UTC, so với cột timestamp không múi giờ', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([]);
    await findOverdueCancelledIds({ $queryRaw } as never, '2026-11-19', '2026-11-19');
    const { text, values } = sqlOf($queryRaw);
    expect(text).toContain(`o."createdAt" >= (?::timestamptz AT TIME ZONE 'UTC')`);
    expect(text).toContain(`o."createdAt" < (?::timestamptz AT TIME ZONE 'UTC')`);
    expect(values).toEqual(['2026-11-18T17:00:00.000Z', '2026-11-19T17:00:00.000Z', OVERDUE_CANCELLED_ID_CAP]);
  });
});

describe('orderGuestSource — badge nguồn khách', () => {
  it.each([
    [{ guestPhone: '0901234567', user: { phone: null, zaloId: 'guest_h_abc' } }, 'guest'],
    [{ guestPhone: '0901234567', user: { phone: '0901234567', zaloId: 'z1' } }, 'merged'],
    [{ guestPhone: '0901234567', user: { phone: null, zaloId: '123456789' } }, 'merged'],
    [{ guestPhone: null, user: { phone: null, zaloId: 'guest_h_abc' } }, 'guest'],
    [{ guestPhone: null, user: { phone: '0901234567', zaloId: 'guest_h_abc' } }, null],
    [{ guestPhone: null, user: { phone: null, zaloId: '123' } }, null],
    [{ guestPhone: null, user: null }, null],
  ])('%j → %s', (o, expected) => {
    expect(orderGuestSource(o)).toBe(expected);
  });
});

describe('latestCancellations — lý do huỷ và lúc nhả kho', () => {
  it('lấy dòng huỷ mới nhất của mỗi đơn; overdue chỉ khi SYSTEM huỷ từ PENDING_PAYMENT', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { orderId: 'o1', createdAt: new Date('2026-11-19T03:00:00Z'), note: 'Tự huỷ: quá 24 giờ chưa thanh toán', actorType: 'SYSTEM', fromStatus: 'PENDING_PAYMENT' },
      { orderId: 'o1', createdAt: new Date('2026-11-18T03:00:00Z'), note: 'cũ', actorType: 'ADMIN', fromStatus: 'CONFIRMED' },
      { orderId: 'o2', createdAt: new Date('2026-11-19T02:00:00Z'), note: 'Khách đổi ý', actorType: 'CUSTOMER', fromStatus: 'PENDING_PAYMENT' },
    ]);
    const m = await latestCancellations({ orderStatusHistory: { findMany } } as never, ['o1', 'o2']);
    expect(findMany.mock.calls[0][0].where).toEqual({ orderId: { in: ['o1', 'o2'] }, toStatus: 'CANCELLED' });
    expect(m.get('o1')).toEqual({ at: '2026-11-19T03:00:00.000Z', note: 'Tự huỷ: quá 24 giờ chưa thanh toán', actorType: 'SYSTEM', overdue: true });
    expect(m.get('o2')?.overdue).toBe(false);
  });

  it('không có đơn huỷ trong trang thì không hỏi DB', async () => {
    const findMany = jest.fn();
    expect((await latestCancellations({ orderStatusHistory: { findMany } } as never, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('AdminService.listOrders — dòng đơn cho màn vận hành', () => {
  const created = new Date('2026-11-18T01:00:00Z');
  const rows = () => [
    {
      id: 'o1',
      code: 'TB1',
      type: 'RETAIL',
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total: 100_000,
      createdAt: created,
      autoCancelBlockedAt: null,
      guestPhone: '0901234567',
      guestTokenHash: 'tokenhash',
      guestIpHash: 'iphash',
      items: [],
      customerRefunds: [],
      user: { id: 'u1', phone: null, fullName: null, zaloId: 'guest_h_x' },
    },
    {
      id: 'o2',
      code: 'TB2',
      type: 'RETAIL',
      status: 'CANCELLED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total: 50_000,
      createdAt: created,
      autoCancelBlockedAt: null,
      guestPhone: null,
      guestTokenHash: null,
      guestIpHash: null,
      items: [],
      customerRefunds: [],
      user: { id: 'u2', phone: '0912345678', fullName: 'Lan', zaloId: 'z2' },
    },
  ];
  const prismaFor = () => ({
    order: { findMany: jest.fn().mockResolvedValue(rows()), count: jest.fn().mockResolvedValue(2) },
    orderStatusHistory: {
      findMany: jest.fn().mockResolvedValue([
        { orderId: 'o2', createdAt: new Date('2026-11-19T01:00:00Z'), note: 'Tự huỷ: quá 24 giờ chưa thanh toán, gọi 0912345678', actorType: 'SYSTEM', fromStatus: 'PENDING_PAYMENT' },
      ]),
    },
    orderCustomerRefund: { findMany: jest.fn().mockResolvedValue([]) },
    storefront: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  });
  type Row = { code: string; guestSource: string | null; paymentDeadline: string | null; cancellation: { note: string | null; overdue: boolean } | null; guestPhone: string | null; user: Record<string, unknown> | null } & Record<string, unknown>;
  const list = async (viewer: object) =>
    ((await mkAdmin(prismaFor()).listOrders(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, viewer as never)) as unknown as { data: Row[] }).data;

  it('ADMIN: nguồn khách, hạn chuyển khoản (TTL 24 giờ), lý do huỷ; không trả băm khoá theo dõi/IP, không trả zaloId', async () => {
    const [o1, o2] = await list(ADMIN);
    expect(o1!.guestSource).toBe('guest');
    expect(o1!.paymentDeadline).toBe('2026-11-19T01:00:00.000Z');
    expect(o1!.guestPhone).toBe('0901234567');
    expect(o1).not.toHaveProperty('guestTokenHash');
    expect(o1).not.toHaveProperty('guestIpHash');
    expect(o1!.user).toEqual({ id: 'u1', phone: null, fullName: null });
    expect(o2!.guestSource).toBeNull();
    expect(o2!.paymentDeadline).toBeNull();
    expect(o2!.cancellation).toEqual({ at: '2026-11-19T01:00:00.000Z', note: 'Tự huỷ: quá 24 giờ chưa thanh toán, gọi 0912345678', actorType: 'SYSTEM', overdue: true });
  });

  it('Kế toán (bị che SĐT): SĐT vãng lai và SĐT trong lý do huỷ đều bị che', async () => {
    const [o1, o2] = await list(KE_TOAN);
    expect(o1!.guestPhone).not.toBe('0901234567');
    expect(o1!.guestPhone).toMatch(/567$/);
    expect(o2!.cancellation!.note).not.toContain('0912345678');
  });
});

describe('AdminService.orderOpsCounts — KPI đầu tab Đơn hàng', () => {
  const run = async (f: Record<string, unknown>, viewer: object = ADMIN) => {
    const count = jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(4).mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(6);
    const $queryRaw = jest.fn().mockResolvedValue([{ id: 'c1' }]);
    const prisma = { order: { count }, storefront: { findFirst: jest.fn(), findMany: jest.fn() }, $queryRaw };
    const now = new Date('2026-11-19T12:00:00Z');
    const r = await mkAdmin(prisma, 24).orderOpsCounts(f as never, viewer as never, now);
    return { r, where: (i: number) => count.mock.calls[i][0].where, $queryRaw };
  };

  it('trả 5 số + TTL; mỗi số đúng where của ô đó', async () => {
    const { r, where, $queryRaw } = await run({});
    expect(r).toEqual({ guestWeb: 9, guestWebUnmerged: 4, bankTransferPending: 3, bankTransferOverdue: 1, overdueCancelled: 6, ttlHours: 24 });
    expect(where(0)).toEqual(GUEST_WEB_ORDER_WHERE);
    expect(where(1)).toEqual({ AND: [GUEST_WEB_ORDER_WHERE, { user: { phone: null, zaloId: { startsWith: 'guest_' } } }] });
    expect(where(2)).toEqual({ AND: [{}, BANK_TRANSFER_TO_CONFIRM_WHERE] });
    expect(where(3)).toEqual({ AND: [{}, BANK_TRANSFER_TO_CONFIRM_WHERE, { createdAt: { lt: new Date('2026-11-18T12:00:00Z') }, autoCancelBlockedAt: null }] });
    expect(where(4)).toEqual({ AND: [BANK_TRANSFER_OVERDUE_CANCELLED_WHERE, { id: { in: ['c1'] } }] });
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('số vãng lai đếm theo trạng thái + hàng đợi đang chọn (bấm ô giữ chúng); số CK và tự huỷ bỏ chúng nhưng tính trong đơn vãng lai khi đang lọc', async () => {
    const { where } = await run({ guest: 'web', queue: 'bank_transfer_to_confirm', status: 'PENDING_PAYMENT', kind: 'retail' });
    const kind = { type: 'RETAIL', placedForCustomer: false, storefrontId: null, referrerUserId: null };
    expect(where(0)).toEqual({ AND: [{ status: 'PENDING_PAYMENT' }, kind, BANK_TRANSFER_TO_CONFIRM_WHERE, GUEST_WEB_ORDER_WHERE] });
    expect(where(2)).toEqual({ AND: [{ AND: [kind, GUEST_WEB_ORDER_WHERE] }, BANK_TRANSFER_TO_CONFIRM_WHERE] });
    expect(where(4)).toEqual({ AND: [kind, BANK_TRANSFER_OVERDUE_CANCELLED_WHERE, { id: { in: ['c1'] } }, GUEST_WEB_ORDER_WHERE] });
  });

  it('TTL cấu hình 48 giờ: mốc quá hạn lùi 48 giờ và trả về để web ghi đúng nhãn', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { order: { count }, storefront: { findFirst: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([]) };
    const r = await mkAdmin(prisma, 48).orderOpsCounts({}, ADMIN as never, new Date('2026-11-19T12:00:00Z'));
    expect(r.ttlHours).toBe(48);
    expect(count.mock.calls[3][0].where.AND[2]).toEqual({ createdAt: { lt: new Date('2026-11-17T12:00:00Z') }, autoCancelBlockedAt: null });
  });
});

describe('Controller + DTO — guest và hàng đợi tự huỷ quá hạn', () => {
  const errs = async (cls: new () => object, q: object) => (await validate(plainToInstance(cls, q))).map((e) => e.property);

  it('guest chỉ nhận "web"; queue nhận bank_transfer_overdue_cancelled (danh sách, CSV, số đếm)', async () => {
    for (const cls of [ListOrdersQuery, ExportOrdersQuery, OrderStatusCountsQuery, OrderOpsCountsQuery]) {
      expect(await errs(cls, { guest: 'web', queue: 'bank_transfer_overdue_cancelled' })).toEqual([]);
      expect(await errs(cls, { guest: 'zalo' })).toEqual(['guest']);
      expect(await errs(cls, { queue: 'overdue' })).toEqual(['queue']);
    }
  });

  it('GET orders chuyển guest xuống listOrders', async () => {
    const listOrders = jest.fn().mockResolvedValue({});
    const ctl = new AdminController({ listOrders } as never, {} as never);
    await ctl.orders(Object.assign(new ListOrdersQuery(), { guest: 'web', queue: 'bank_transfer_overdue_cancelled' }), { sub: 'a', role: 'ADMIN' } as never);
    expect(listOrders.mock.calls[0][10]).toEqual(expect.objectContaining({ guest: 'web', queue: 'bank_transfer_overdue_cancelled' }));
  });

  it('GET orders/ops-counts cùng quyền với danh sách đơn, đi qua orderOpsCounts', async () => {
    expect(Reflect.getMetadata('path', AdminController.prototype.orderOpsCounts)).toBe('orders/ops-counts');
    expect(Reflect.getMetadata('staffPermissions', AdminController.prototype.orderOpsCounts)).toEqual(
      Reflect.getMetadata('staffPermissions', AdminController.prototype.orders),
    );
    const orderOpsCounts = jest.fn().mockResolvedValue({});
    const ctl = new AdminController({ orderOpsCounts } as never, {} as never);
    const viewer = { sub: 's', role: 'STAFF', staffPermissions: ['KE_TOAN'] };
    await ctl.orderOpsCounts(Object.assign(new OrderOpsCountsQuery(), { guest: 'web', status: 'CANCELLED' }), viewer as never);
    expect(orderOpsCounts).toHaveBeenCalledWith(expect.objectContaining({ guest: 'web', status: 'CANCELLED' }), viewer);
    expect(await errs(OrderOpsCountsQuery, { status: 'NOPE' })).toEqual(['status']);
  });
});
