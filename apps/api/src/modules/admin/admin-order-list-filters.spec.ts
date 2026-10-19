import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminService } from './admin.service';
import { AdminController, ExportOrdersQuery, ListOrdersQuery } from './admin.controller';
import type { PrismaService } from '../../prisma/prisma.service';

const VIEWER = { sub: 'admin-1', role: 'ADMIN' as const };

function mkAdmin(prisma: unknown) {
  return new AdminService(
    prisma as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function listPrisma(storefrontRow: { id: string } | null = null) {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const storefrontFind = jest.fn().mockResolvedValue(storefrontRow);
  const prisma = {
    order: { findMany, count },
    storefront: { findFirst: storefrontFind },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };
  return { prisma, findMany, count, storefrontFind };
}

describe('AdminService.listOrders — bộ lọc mới của danh sách đơn (D1-17)', () => {
  it('kind/payment/platform/referrer đẩy xuống where của cả findMany lẫn count; mặc định mới nhất trước', async () => {
    const { prisma, findMany, count } = listPrisma();
    await mkAdmin(prisma).listOrders(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, VIEWER, {
      kind: 'dealer',
      payment: 'UNPAID',
      platform: 'web',
      referrerUserId: 'ctv-1',
    });
    const where = {
      AND: [{ type: 'DEALER' }, { paymentStatus: 'UNPAID' }, { platform: 'web' }, { referrerUserId: 'ctv-1' }],
    };
    expect(findMany.mock.calls[0][0].where).toEqual(where);
    expect(count.mock.calls[0][0].where).toEqual(where);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('order=asc đổi thứ tự sắp xếp theo ngày đặt, count không đổi', async () => {
    const { prisma, findMany } = listPrisma();
    await mkAdmin(prisma).listOrders(2, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, VIEWER, { order: 'asc' });
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
    expect(findMany.mock.calls[0][0].skip).toBe(20);
  });

  it('storefront (slug hoặc subdomain, không phân biệt hoa thường) đổi sang storefrontId trước khi lọc', async () => {
    const { prisma, findMany, storefrontFind } = listPrisma({ id: 'sf-1' });
    await mkAdmin(prisma).listOrders(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, VIEWER, {
      storefront: '  Tubu-Hoa ',
    });
    expect(storefrontFind.mock.calls[0][0].where).toEqual({
      OR: [
        { slug: { equals: 'tubu-hoa', mode: 'insensitive' } },
        { subdomain: { equals: 'tubu-hoa', mode: 'insensitive' } },
      ],
    });
    expect(findMany.mock.calls[0][0].where).toEqual({ storefrontId: 'sf-1' });
  });

  it('storefront không tồn tại → danh sách rỗng, không bỏ lọc (không lộ mọi đơn)', async () => {
    const { prisma, findMany } = listPrisma(null);
    await mkAdmin(prisma).listOrders(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, VIEWER, {
      storefront: 'khong-co',
    });
    const where = findMany.mock.calls[0][0].where as { storefrontId: string };
    expect(typeof where.storefrontId).toBe('string');
    expect(where.storefrontId).not.toBe('');
    expect(where.storefrontId).not.toMatch(/^c[a-z0-9]{24}$/);
  });

  it('storefront chỉ có khoảng trắng → coi như không lọc, không tra gian hàng', async () => {
    const { prisma, findMany, storefrontFind } = listPrisma();
    await mkAdmin(prisma).listOrders(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, VIEWER, {
      storefront: '   ',
    });
    expect(storefrontFind).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });

  it('file CSV dùng đúng bộ lọc mới (cùng một tập đơn với danh sách)', async () => {
    const { prisma, storefrontFind } = listPrisma({ id: 'sf-1' });
    const where = await mkAdmin(prisma).adminOrderWhere({ kind: 'storefront', storefront: 'tubu-hoa', payment: 'PAID' });
    expect(storefrontFind).toHaveBeenCalledTimes(1);
    expect(where).toEqual({
      AND: [
        { type: 'RETAIL', placedForCustomer: false, storefrontId: { not: null } },
        { paymentStatus: 'PAID' },
        { storefrontId: 'sf-1' },
      ],
    });
  });
});

describe('Controller + DTO — bộ lọc mới của GET /admin/orders (D1-17)', () => {
  it('chuyển các bộ lọc mới xuống listOrders qua tham số cuối', async () => {
    const admin = { listOrders: jest.fn().mockResolvedValue({ data: [] }) };
    const ctl = new AdminController(admin as never, {} as never);
    await ctl.orders(
      Object.assign(new ListOrdersQuery(), {
        page: 1,
        limit: 20,
        kind: 'ctv',
        payment: 'PAID',
        platform: 'miniapp',
        referrerUserId: 'u1',
        storefront: 'tubu-hoa',
        order: 'asc',
      }),
      VIEWER,
    );
    expect(admin.listOrders).toHaveBeenCalledWith(1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, VIEWER, {
      kind: 'ctv',
      payment: 'PAID',
      platform: 'miniapp',
      referrerUserId: 'u1',
      storefront: 'tubu-hoa',
      order: 'asc',
    });
  });

  it('giá trị lạ bị 400 (không lọt xuống Prisma): kind, payment, platform, order, id quá dài', async () => {
    const ok = await validate(
      plainToInstance(ListOrdersQuery, { kind: 'dealer', payment: 'REFUNDED', platform: 'web', order: 'desc', referrerUserId: 'abc', storefront: 'x' }),
    );
    expect(ok).toHaveLength(0);
    for (const bad of [{ kind: 'vip' }, { payment: 'paid' }, { platform: 'zalo' }, { order: 'up' }, { referrerUserId: 'a'.repeat(65) }, { storefront: 'a'.repeat(101) }]) {
      const errs = await validate(plainToInstance(ListOrdersQuery, bad));
      expect(errs.map((e) => e.property)).toEqual([Object.keys(bad)[0]]);
    }
  });

  it('ExportOrdersQuery nhận cùng bộ lọc (CSV = đúng tập đang xem) và chặn giá trị lạ', async () => {
    expect(
      await validate(plainToInstance(ExportOrdersQuery, { kind: 'retail', payment: 'FAILED', platform: 'miniapp', referrerUserId: 'u1', storefront: 'a' })),
    ).toHaveLength(0);
    const errs = await validate(plainToInstance(ExportOrdersQuery, { kind: 'vip' }));
    expect(errs.map((e) => e.property)).toEqual(['kind']);
  });

  it('GET /admin/orders/export chuyển bộ lọc mới xuống orderCsv', async () => {
    const orderCsv = jest.fn().mockResolvedValue((async function* () {})());
    const ctl = new AdminController({ orderCsv } as never, {} as never);
    const res = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn(), on: jest.fn(), once: jest.fn(), writableEnded: false } as never;
    await ctl.exportOrders(Object.assign(new ExportOrdersQuery(), { kind: 'dealer', payment: 'PAID' }), 'ADMIN', res).catch(() => undefined);
    expect(orderCsv).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dealer', payment: 'PAID' }), { maskPhones: false });
  });
});
