import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { PurchasedItemsService, decodePurchasedCursor, encodePurchasedCursor } from './purchased-items.service';

const AT = new Date('2026-09-10T03:00:00.123Z');
const row = (variationId: string, timesBought = 1, at: Date = AT) => ({ variationId, timesBought, lastPurchasedAt: at });
const variation = (id: string, over: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => ({
  id, name: `Loại ${id}`, retailPrice: 65000, salePrice: null, stock: 4, ...over,
  product: { id: `p-${id}`, slug: `sp-${id}`, name: `Sản phẩm ${id}`, brand: 'Tubu', thumbnail: `https://img.test/${id}.jpg`, images: [], ...product },
});

function setup(rows: ReturnType<typeof row>[], variations: ReturnType<typeof variation>[]) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const findMany = jest.fn().mockResolvedValue(variations);
  const prisma = { $queryRaw: queryRaw, variation: { findMany } } as unknown as PrismaService;
  return { svc: new PurchasedItemsService(prisma), queryRaw, findMany };
}
const sqlOf = (m: jest.Mock) => m.mock.calls[0]![0] as Prisma.Sql;

describe('PurchasedItemsService.list', () => {
  it('trả item theo đúng thứ tự SQL (mới mua trước), đủ trường cho kệ Mua lại', async () => {
    const { svc } = setup([row('v2', 3), row('v1')], [variation('v1'), variation('v2', { salePrice: 59000, stock: 0 })]);
    const page = await svc.list('u1');
    expect(page.items.map((i) => i.variationId)).toEqual(['v2', 'v1']);
    expect(page.items[0]).toEqual({
      variationId: 'v2', productId: 'p-v2', slug: 'sp-v2', productName: 'Sản phẩm v2', variationName: 'Loại v2',
      brand: 'Tubu', thumbnail: 'https://img.test/v2.jpg', price: 65000, salePrice: 59000, stock: 0, inStock: false,
      timesBought: 3, lastPurchasedAt: '2026-09-10T03:00:00.123Z',
    });
    expect(page.nextCursor).toBeNull();
  });

  it('SQL chỉ lấy đơn DELIVERED của CHÍNH user và loại SP ngừng bán / chưa duyệt', async () => {
    const { svc, queryRaw } = setup([], []);
    await svc.list('u1');
    const sql = sqlOf(queryRaw);
    expect(sql.values).toContain('u1');
    expect(sql.sql).toContain(`o.status::text = 'DELIVERED'`);
    expect(sql.sql).toContain('v."isActive" = true');
    expect(sql.sql).toContain('p."isActive" = true');
    expect(sql.sql).toContain(`p."approvalStatus"::text = 'APPROVED'`);
  });

  it('không có dòng nào → không truy vấn variation', async () => {
    const { svc, findMany } = setup([], []);
    await expect(svc.list('u1')).resolves.toEqual({ items: [], nextCursor: null });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lấy limit+1 để biết còn trang sau; nextCursor mã hoá mốc của item cuối trang', async () => {
    const { svc, queryRaw } = setup([row('v3'), row('v2'), row('v1')], [variation('v3'), variation('v2'), variation('v1')]);
    const page = await svc.list('u1', { limit: 2 });
    expect(sqlOf(queryRaw).values).toContain(3);
    expect(page.items.map((i) => i.variationId)).toEqual(['v3', 'v2']);
    expect(decodePurchasedCursor(page.nextCursor!)).toEqual({ ms: AT.getTime(), variationId: 'v2' });
  });

  it('limit bị kẹp 1..50', async () => {
    const a = setup([], []);
    await a.svc.list('u1', { limit: 500 });
    expect(sqlOf(a.queryRaw).values).toContain(51);
    const b = setup([], []);
    await b.svc.list('u1', { limit: 0 });
    expect(sqlOf(b.queryRaw).values).toContain(2);
  });

  it('cursor → điều kiện HAVING theo (epoch ms, variationId)', async () => {
    const { svc, queryRaw } = setup([], []);
    await svc.list('u1', { cursor: encodePurchasedCursor(1700000000000, 'v9') });
    const sql = sqlOf(queryRaw);
    expect(sql.sql).toContain('HAVING');
    expect(sql.values).toEqual(expect.arrayContaining([1700000000000, 'v9']));
  });

  it('cursor hỏng → 400', async () => {
    const { svc } = setup([], []);
    await expect(svc.list('u1', { cursor: 'không-phải-cursor' })).rejects.toBeInstanceOf(BadRequestException);
  });

  // `MXwA` = base64url("1|\0"): variationId chứa NUL làm Postgres ném 22021 → 500 nếu lọt tới SQL.
  it.each([
    ['MXwA', 'NUL trong variationId'],
    [Buffer.from('1|abc def', 'utf8').toString('base64url'), 'khoảng trắng trong variationId'],
    [Buffer.from(`1|${'a'.repeat(65)}`, 'utf8').toString('base64url'), 'variationId dài quá 64 ký tự'],
    [Buffer.from("1|x';--", 'utf8').toString('base64url'), 'ký tự ngoài [A-Za-z0-9_-]'],
  ])('cursor %s (%s) → 400, không chạm DB', async (cursor) => {
    const { svc, queryRaw } = setup([], []);
    await expect(svc.list('u1', { cursor })).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('lọc variationId (tra nhanh cho thông báo nhắc mua lại)', async () => {
    const { svc, queryRaw } = setup([], []);
    await svc.list('u1', { variationId: 'v7' });
    expect(sqlOf(queryRaw).values).toContain('v7');
    expect(sqlOf(queryRaw).sql).toContain('oi."variationId" =');
  });

  it('thumbnail rơi về images[0]; variation biến mất giữa 2 truy vấn → bỏ qua', async () => {
    const { svc } = setup([row('v1'), row('gone')], [variation('v1', {}, { thumbnail: null, images: ['https://img.test/a.jpg'] })]);
    const page = await svc.list('u1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.thumbnail).toBe('https://img.test/a.jpg');
  });
});
