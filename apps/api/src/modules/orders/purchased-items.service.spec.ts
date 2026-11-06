import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { PurchasedItemsService, decodePurchasedCursor, encodePurchasedCursor } from './purchased-items.service';

const AT = new Date('2026-09-10T03:00:00.123Z');
const row = (variationId: string, timesBought = 1, at: Date = AT) => ({ variationId, timesBought, lastPurchasedAt: at });
const variation = (id: string, over: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => ({
  id, name: `Loại ${id}`, retailPrice: 65000, salePrice: null, stock: 4, pancakeId: `PK-${id}`, ...over,
  product: { id: `p-${id}`, slug: `sp-${id}`, name: `Sản phẩm ${id}`, brand: 'Tubu', thumbnail: `https://img.test/${id}.jpg`, images: [], fulfilment: 'TUBU', storefrontId: null, ...product },
});

function setup(rows: ReturnType<typeof row>[], variations: ReturnType<typeof variation>[], flashSale?: { resolveEffective: jest.Mock }) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const findMany = jest.fn().mockResolvedValue(variations);
  const prisma = { $queryRaw: queryRaw, variation: { findMany } } as unknown as PrismaService;
  return { svc: new PurchasedItemsService(prisma, flashSale as never), queryRaw, findMany };
}
const sqlOf = (m: jest.Mock) => m.mock.calls[0]![0] as Prisma.Sql;

describe('PurchasedItemsService.list — tồn ảo', () => {
  it('tồn ảo 99.999.988 bị kẹp ở 100.000, tồn thật trên 20 là 99, tồn âm về 0 và vẫn báo hết hàng (W31)', async () => {
    const { svc } = setup([row('v1'), row('v2'), row('v3')], [variation('v1', { stock: 99_999_988 }), variation('v2', { stock: -3 }), variation('v3', { stock: 64 })]);
    const page = await svc.list('u1');
    expect(page.items.map((i) => [i.variationId, i.stock, i.inStock])).toEqual([['v1', 100_000, true], ['v2', 0, false], ['v3', 99, true]]);
  });
});

describe('PurchasedItemsService.list', () => {
  it('trả item theo đúng thứ tự SQL (mới mua trước), đủ trường cho kệ Mua lại', async () => {
    const { svc } = setup([row('v2', 3), row('v1')], [variation('v1'), variation('v2', { salePrice: 59000, stock: 0 })]);
    const page = await svc.list('u1');
    expect(page.items.map((i) => i.variationId)).toEqual(['v2', 'v1']);
    expect(page.items[0]).toEqual({
      variationId: 'v2', productId: 'p-v2', slug: 'sp-v2', productName: 'Sản phẩm v2', variationName: 'Loại v2',
      brand: 'Tubu', thumbnail: 'https://img.test/v2.jpg', price: 65000, salePrice: 59000, stock: 0, inStock: false,
      timesBought: 3, lastPurchasedAt: '2026-09-10T03:00:00.123Z', retailOnly: false, flashPrice: null, flashAllowance: null,
    });
    expect(page.nextCursor).toBeNull();
  });

  // Rail "Mua lại" mở cùng sheet với đơn cũ: sheet phải hiện giá giỏ sẽ tính, gồm giá Giờ vàng còn suất của chính khách này.
  describe('giá Giờ vàng giỏ sẽ tính (flashPrice, flashAllowance)', () => {
    const offer = (over: Record<string, unknown> = {}) => ({ flashPrice: 45000, itemId: 'fi1', endAt: new Date(), soldCount: 2, quota: 10, quotaLeft: 8, perUserLeft: 2, allowance: 2, ...over });
    const resolver = (entries: Record<string, unknown>) => ({ resolveEffective: jest.fn().mockResolvedValue(new Map(Object.entries(entries))) });

    it('tra một lần cho cả trang theo khách đang xem; biến thể có suất mở mang giá và số suất, biến thể khác null', async () => {
      const flashSale = resolver({ v2: offer() });
      const { svc } = setup([row('v1'), row('v2')], [variation('v1'), variation('v2')], flashSale);
      const page = await svc.list('u1');
      expect(flashSale.resolveEffective).toHaveBeenCalledTimes(1);
      expect(flashSale.resolveEffective).toHaveBeenCalledWith(['v1', 'v2'], expect.any(Date), 'u1');
      expect(page.items.map((i) => [i.variationId, i.flashPrice, i.flashAllowance])).toEqual([['v1', null, null], ['v2', 45000, 2]]);
    });

    it('giá Giờ vàng cao hơn giá đang bán thì lấy giá đang bán; hết suất của khách: allowance 0', async () => {
      const flashSale = resolver({ v1: offer({ flashPrice: 70000 }), v2: offer({ perUserLeft: 0, allowance: 0 }) });
      const { svc } = setup([row('v1'), row('v2')], [variation('v1', { salePrice: 59000 }), variation('v2')], flashSale);
      const page = await svc.list('u1');
      expect(page.items.map((i) => [i.flashPrice, i.flashAllowance])).toEqual([[59000, 2], [45000, 0]]);
    });

    it('không có bộ tra Giờ vàng (call site cũ): cả hai null', async () => {
      const { svc } = setup([row('v1')], [variation('v1')]);
      expect((await svc.list('u1')).items[0]).toMatchObject({ flashPrice: null, flashAllowance: null });
    });

    it('trang rỗng: không tra Giờ vàng', async () => {
      const flashSale = resolver({});
      const { svc } = setup([], [], flashSale);
      await svc.list('u1');
      expect(flashSale.resolveEffective).not.toHaveBeenCalled();
    });
  });

  it('retailOnly: hàng do đối tác tự giao (fulfilment MERCHANT) hoặc của gian hàng đối tác (có storefrontId) thì true, hàng Tubu thì false', async () => {
    const { svc } = setup(
      [row('a'), row('b'), row('c')],
      [variation('a', {}, { fulfilment: 'MERCHANT' }), variation('b', {}, { storefrontId: 'sf1' }), variation('c')],
    );
    const page = await svc.list('u1');
    expect(page.items.map((i) => i.retailOnly)).toEqual([true, true, false]);
  });

  it('retailOnly: mã Pancake thiếu, rỗng hoặc mã giả MCH_ thì true (không giao định kỳ được), mã thật thì false', async () => {
    const { svc } = setup(
      [row('a'), row('b'), row('c'), row('d')],
      [variation('a', { pancakeId: null }), variation('b', { pancakeId: '  ' }), variation('c', { pancakeId: 'MCH_123' }), variation('d')],
    );
    const page = await svc.list('u1');
    expect(page.items.map((i) => i.retailOnly)).toEqual([true, true, true, false]);
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

describe('PurchasedItemsService.list: không kéo cột images của sản phẩm (D3)', () => {
  const { images: _images, ...bare } = variation('v1').product;

  it('select sản phẩm không có images; thumbnail có sẵn thì không truy vấn ảnh đầu', async () => {
    const { svc, queryRaw, findMany } = setup([row('v1')], [{ ...variation('v1'), product: bare } as never]);
    const page = await svc.list('u1');
    expect(findMany.mock.calls[0]![0].select.product.select).not.toHaveProperty('images');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(page.items[0]!.thumbnail).toBe('https://img.test/v1.jpg');
  });

  it('sản phẩm không có thumbnail: dự phòng bằng đúng phần tử đầu của images (một câu SQL images[1])', async () => {
    const { svc, queryRaw } = setup([row('v1')], [{ ...variation('v1'), product: { ...bare, thumbnail: null } } as never]);
    queryRaw.mockResolvedValueOnce([row('v1')]).mockResolvedValueOnce([{ id: 'p-v1', cover: 'https://res.cloudinary.com/x/first.jpg' }]);
    const page = await svc.list('u1');
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect((queryRaw.mock.calls[1]![0] as string[]).join('?')).toContain('"images"[1]');
    expect(page.items[0]!.thumbnail).toBe('https://res.cloudinary.com/x/first.jpg');
  });
});
