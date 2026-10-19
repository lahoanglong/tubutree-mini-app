import type { PrismaService } from '../../prisma/prisma.service';
import { EXPORT_BATCH } from './admin-export';
import { ORDER_ITEM_CSV_HEADERS, orderItemCsvChunks } from './admin-order-items-export';

async function collect(gen: AsyncGenerator<string>) {
  let out = '';
  for await (const c of gen) out += c;
  return out;
}

function item(i: number, over: Record<string, unknown> = {}) {
  return { productName: `SP ${i}`, variationName: 'Chai 500ml', variationId: `v${i}`, quantity: 2, unitPrice: 50_000, total: 100_000, paidTotal: 90_000, ...over };
}

function order(i: number, items: Record<string, unknown>[], over: Record<string, unknown> = {}) {
  return {
    id: `o${String(i).padStart(5, '0')}`,
    code: `TB${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 3, 0, 0) - i * 60_000),
    status: 'DELIVERED',
    type: 'RETAIL',
    platform: 'miniapp',
    source: 'storefront',
    referrerUserId: null,
    storefront: { title: 'Shop Lan' },
    items,
    ...over,
  };
}

function fakePrisma(orders: Record<string, unknown>[], skus: Record<string, string>, users: Record<string, unknown>[] = []) {
  const orderFind = jest.fn(async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
    const start = args.cursor ? orders.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
    return orders.slice(start, start + args.take);
  });
  const variationFind = jest.fn(async (args: { where: { id: { in: string[] } } }) =>
    args.where.id.in.filter((id) => skus[id]).map((id) => ({ id, sku: skus[id] })),
  );
  const userFind = jest.fn(async (args: { where: { id: { in: string[] } } }) => users.filter((u) => args.where.id.in.includes(u.id as string)));
  return {
    prisma: { order: { findMany: orderFind }, variation: { findMany: variationFind }, user: { findMany: userFind } } as unknown as PrismaService,
    orderFind,
    variationFind,
  };
}

describe('orderItemCsvChunks (D1-04a: CSV theo dòng hàng)', () => {
  const col = (name: string) => ORDER_ITEM_CSV_HEADERS.indexOf(name);

  it('mỗi dòng hàng một dòng CSV, mang nguồn đơn và SKU; đơn nhiều dòng lặp mã đơn', async () => {
    const { prisma } = fakePrisma(
      [
        order(0, [item(1), item(2, { quantity: 1, total: 50_000, paidTotal: null })]),
        order(1, [item(3)], { source: 'ctv_assisted', platform: null, storefront: null, referrerUserId: 'c1' }),
      ],
      { v1: 'MAT-500', v2: 'TRA-100', v3: '=SKU' },
      [{ id: 'c1', fullName: 'Lan CTV', phone: '0987654321' }],
    );
    const lines = (await collect(orderItemCsvChunks(prisma, {}))).trimEnd().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(ORDER_ITEM_CSV_HEADERS.join(','));
    const r1 = lines[1]!.split(',');
    const r2 = lines[2]!.split(',');
    const r3 = lines[3]!.split(',');
    expect(r1[col('Mã đơn')]).toBe('TB0');
    expect(r2[col('Mã đơn')]).toBe('TB0');
    expect(r1[col('Nguồn đơn')]).toBe('Gian hàng (khách tự mua)');
    expect(r1[col('SKU')]).toBe('MAT-500');
    expect(r1[col('Số lượng')]).toBe('2');
    expect(r1[col('Thành tiền dòng (VNĐ)')]).toBe('100000');
    expect(r1[col('Khách trả cho dòng (VNĐ)')]).toBe('90000');
    expect(r2[col('Khách trả cho dòng (VNĐ)')]).toBe('');
    expect(r3[col('Nguồn đơn')]).toBe('CTV lên đơn hộ');
    expect(r3[col('CTV giới thiệu')]).toBe('Lan CTV');
    expect(r3[col('SKU')]).toBe("'=SKU");
    expect(r3[col('Nền tảng')]).toBe('Không rõ');
  });

  it('đọc theo lô: tra SKU và CTV mỗi lô một lần, xuất đủ mọi đơn', async () => {
    const n = EXPORT_BATCH + 7;
    const orders = Array.from({ length: n }, (_, i) => order(i, [item(i)], { referrerUserId: i % 2 ? 'c1' : null }));
    const { prisma, orderFind, variationFind } = fakePrisma(orders, {}, [{ id: 'c1', fullName: 'C', phone: null }]);
    const lines = (await collect(orderItemCsvChunks(prisma, { status: 'DELIVERED' }))).trimEnd().split('\r\n');
    expect(lines).toHaveLength(n + 1);
    expect(orderFind).toHaveBeenCalledTimes(2);
    expect(orderFind.mock.calls[0]![0]).toMatchObject({ where: { status: 'DELIVERED' }, take: EXPORT_BATCH });
    expect(variationFind).toHaveBeenCalledTimes(2);
  });

  it('đơn không có dòng hàng không sinh dòng nào', async () => {
    const { prisma } = fakePrisma([order(0, [])], {});
    expect((await collect(orderItemCsvChunks(prisma, {}))).trimEnd().split('\r\n')).toHaveLength(1);
  });
});
