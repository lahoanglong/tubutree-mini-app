import type { PrismaService } from '../../prisma/prisma.service';
import { CATALOG_AUDIT_MAX, CatalogAuditService } from './catalog-audit.service';
import { VARIATION_ORDER_BY } from './variation-order';

const variation = (over: Record<string, unknown> = {}) => ({ id: 'v1', pancakeId: 'pv1', sku: 'SKU1', name: '100ml', stock: 5, retailPrice: 50_000, isActive: true, ...over });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  slug: 'dau-goi',
  name: 'Dầu gội',
  pancakeId: 'pk1',
  isActive: true,
  thumbnail: 'https://img/a.jpg',
  description: 'Mô tả',
  shortDesc: null,
  ingredients: null,
  variations: [variation()],
  ...over,
});

function make(rows: unknown[]) {
  const findMany = jest.fn(async () => rows);
  const svc = new CatalogAuditService({ product: { findMany } } as unknown as PrismaService);
  return { svc, findMany };
}

describe('CatalogAuditService.audit', () => {
  it('chỉ hỏi sản phẩm Tubu (storefrontId null) nhưng KHÔNG lọc isActive/pancakeHold; kèm mọi biến thể theo VARIATION_ORDER_BY; chỉ select cột cần', async () => {
    const { svc, findMany } = make([]);
    await svc.audit();
    const arg = (findMany.mock.calls[0] as unknown as [{ where: object; take: number; select: Record<string, unknown> & { variations: { where?: unknown; orderBy: unknown } } }])[0];
    expect(arg.where).toEqual({ storefrontId: null });
    expect(arg.take).toBe(CATALOG_AUDIT_MAX + 1);
    expect(arg.select.variations.where).toBeUndefined();
    expect(arg.select.variations.orderBy).toBe(VARIATION_ORDER_BY);
    expect(arg.select).not.toHaveProperty('images');
    expect(arg.select).not.toHaveProperty('storefrontId');
  });

  it('SKU ẩn (isActive false, đang bị giữ) vẫn có mặt, biến thể tắt vẫn nằm trong danh sách và không tính còn hàng', async () => {
    const { svc } = make([
      row({ id: 'hidden', isActive: false, variations: [variation({ id: 'vh', isActive: true, stock: 9, retailPrice: 0 })] }),
      row({ id: 'off', variations: [variation({ id: 'vo', isActive: false, stock: 9 }), variation({ id: 'vz', stock: 0 })] }),
    ]);
    const { products, truncated } = await svc.audit();
    expect(truncated).toBe(false);
    expect(products.map((p) => p.id)).toEqual(['hidden', 'off']);
    expect(products[0]).toMatchObject({ isActive: false, inStock: false });
    expect(products[1]!.variations.map((v) => v.id)).toEqual(['vo', 'vz']);
    expect(products[1]!.inStock).toBe(false);
  });

  it('inStock: sản phẩm đang bán và có biến thể đang bán còn hàng', async () => {
    const { svc } = make([row({ id: 'a' }), row({ id: 'b', variations: [variation({ stock: 0 }), variation({ id: 'v2', stock: 3 })] })]);
    expect((await svc.audit()).products.map((p) => p.inStock)).toEqual([true, true]);
  });

  it('hasIngredients: mảng {name}, chuỗi tách dấu phẩy; null, rỗng, tên trống và "[object Object]" là không có', async () => {
    const { svc } = make([
      row({ id: 'arr', ingredients: [{ name: 'Bơ' }] }),
      row({ id: 'str', ingredients: 'Bơ, Gấc' }),
      row({ id: 'nul', ingredients: null }),
      row({ id: 'emp', ingredients: [] }),
      row({ id: 'blank', ingredients: [{ name: ' ' }] }),
      row({ id: 'obj', ingredients: [{ name: '[object Object]' }] }),
    ]);
    expect((await svc.audit()).products.map((p) => [p.id, p.hasIngredients])).toEqual([
      ['arr', true],
      ['str', true],
      ['nul', false],
      ['emp', false],
      ['blank', false],
      ['obj', false],
    ]);
  });

  it('trả đúng các trường của hợp đồng, không lộ cột nội bộ', async () => {
    const { svc } = make([row({ description: '<p></p>', shortDesc: 'ngắn', ingredients: 'Bơ' })]);
    expect((await svc.audit()).products[0]).toEqual({
      id: 'p1',
      slug: 'dau-goi',
      name: 'Dầu gội',
      pancakeId: 'pk1',
      isActive: true,
      thumbnail: 'https://img/a.jpg',
      description: '<p></p>',
      shortDesc: 'ngắn',
      hasIngredients: true,
      inStock: true,
      variations: [{ id: 'v1', pancakeId: 'pv1', sku: 'SKU1', name: '100ml', stock: 5, retailPrice: 50_000, isActive: true }],
    });
  });

  it('thumbnail base64 đi ra dưới dạng đường dẫn ảnh, thiếu thì null', async () => {
    const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64')}`;
    const { svc } = make([row({ id: 'b64', thumbnail: png }), row({ id: 'none', thumbnail: null })]);
    const { products } = await svc.audit();
    expect(products[0]!.thumbnail).toMatch(/^\/public-image\/product\/b64\/thumb\?v=/);
    expect(products[1]!.thumbnail).toBeNull();
  });

  it('truncated: đọc dư một dòng để biết còn nữa, chỉ trả tối đa CATALOG_AUDIT_MAX', async () => {
    const many = Array.from({ length: CATALOG_AUDIT_MAX + 1 }, (_, i) => row({ id: `p${i}` }));
    const { products, truncated } = await make(many).svc.audit();
    expect(truncated).toBe(true);
    expect(products).toHaveLength(CATALOG_AUDIT_MAX);
    expect(products.at(-1)!.id).toBe(`p${CATALOG_AUDIT_MAX - 1}`);

    const exact = await make(many.slice(0, CATALOG_AUDIT_MAX)).svc.audit();
    expect(exact.truncated).toBe(false);
    expect(exact.products).toHaveLength(CATALOG_AUDIT_MAX);
  });
});
