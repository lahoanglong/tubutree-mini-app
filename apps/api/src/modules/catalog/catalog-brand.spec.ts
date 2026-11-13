import { inferCatalogBrandFromTitle } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import { PROD_CATALOG_2026_11_12 as ALL } from '../../../../../packages/app-core/src/commerce/prod-catalog-full.fixture';
import { CatalogService } from './catalog.service';

/** Mọi SKU trên PROD 12/11/2026 đang ghi "Tubu Tree": đúng dữ liệu mà `/api/brands` phải tách được. */
const GENERIC_ROWS = ALL.map((r, i) => ({ id: `p${String(i).padStart(3, '0')}`, name: r.name, slug: r.slug, brand: 'Tubu Tree' }));
const idsOf = (brand: string) => GENERIC_ROWS.filter((r) => inferCatalogBrandFromTitle(r.name, r.slug, r.brand) === brand).map((r) => r.id);

type Out = { brand: string; count: number; slug: string | null }[];

function brandsService(groupRows: { brand: string; _count: { _all: number } }[], indexRows: unknown[], published: { name: string; slug: string }[] = []) {
  const groupBy = jest.fn().mockResolvedValue(groupRows);
  const findMany = jest.fn().mockResolvedValue(indexRows);
  const brandFindMany = jest.fn().mockResolvedValue(published);
  const prisma = { product: { groupBy, findMany }, brand: { findMany: brandFindMany } } as unknown as PrismaService;
  return { svc: new CatalogService(prisma), groupBy, findMany, brandFindMany };
}

describe('CatalogService.brands — nhãn suy từ tên khi cột brand còn "Tubu Tree"', () => {
  it('111 SKU PROD cùng ghi "Tubu Tree" → tách đúng số theo từng nhãn, tổng vẫn 111', async () => {
    const { svc } = brandsService([{ brand: 'Tubu Tree', _count: { _all: 111 } }], GENERIC_ROWS);
    const out = (await svc.brands()) as Out;
    expect(Object.fromEntries(out.map((b) => [b.brand, b.count]))).toEqual({
      Fuwa3e: 44,
      'Pơ Lang': 14,
      'BH.Nong': 12,
      Sokfarm: 10,
      Visante: 7,
      Hector: 7,
      Pineboo: 6,
      'Le Plateau Coffee': 2,
      'Tubu Tree': 9,
    });
    expect(out.reduce((n, b) => n + b.count, 0)).toBe(111);
    expect(new Set(out.map((b) => b.brand)).size).toBe(out.length);
  });

  it('đọc thêm đúng phần "Tubu Tree"/rỗng của sản phẩm công khai, sắp theo id để thứ tự ổn định', async () => {
    const { svc, findMany } = brandsService([{ brand: 'Tubu Tree', _count: { _all: 111 } }], GENERIC_ROWS);
    await svc.brands();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ isActive: true, approvalStatus: 'APPROVED', brand: { in: ['', 'Tubu Tree'] } }),
      select: { id: true, name: true, slug: true, brand: true },
      orderBy: { id: 'asc' },
    });
  });

  it('nhãn đã công khai khớp theo tên nhãn hiệu lực để có slug; nhãn chưa công khai thì null', async () => {
    const { svc, brandFindMany } = brandsService([{ brand: 'Tubu Tree', _count: { _all: 111 } }], GENERIC_ROWS, [{ name: 'Hector', slug: 'hector' }]);
    const out = (await svc.brands()) as Out;
    expect(out.find((b) => b.brand === 'Hector')).toEqual({ brand: 'Hector', count: 7, slug: 'hector' });
    expect(out.find((b) => b.brand === 'Fuwa3e')?.slug).toBeNull();
    const asked = (brandFindMany.mock.calls[0]![0] as { where: { name: { in: string[] } } }).where.name.in;
    // Sokfarm hỏi cả chính tả cũ: bản ghi Brand tạo từ "Sokfram" vẫn gắn được slug.
    expect([...asked].sort()).toEqual(['BH.Nong', 'Fuwa3e', 'Hector', 'Le Plateau Coffee', 'Pineboo', 'Pơ Lang', 'Sokfarm', 'Sokfram', 'Tubu Tree', 'Visante']);
  });

  it('cột brand còn "Sokfram" (mọi kiểu hoa thường) cộng dồn vào "Sokfarm", không thành hai dòng', async () => {
    const { svc } = brandsService(
      [
        { brand: 'Sokfram', _count: { _all: 3 } },
        { brand: 'Sokfarm', _count: { _all: 2 } },
        { brand: 'SOKFRAM', _count: { _all: 1 } },
        { brand: 'Fuwa3e', _count: { _all: 4 } },
      ],
      [],
    );
    const out = (await svc.brands()) as Out;
    expect(Object.fromEntries(out.map((b) => [b.brand, b.count]))).toEqual({ Sokfarm: 6, Fuwa3e: 4 });
    expect(out.some((b) => /sokfram/i.test(b.brand))).toBe(false);
  });

  it('slug của nhãn công khai: bản ghi Brand tên cũ "Sokfram" gắn vào "Sokfarm", tên chuẩn thắng khi có cả hai', async () => {
    const rows = [{ brand: 'Sokfram', _count: { _all: 3 } }];
    const legacyOnly = (await brandsService(rows, [], [{ name: 'Sokfram', slug: 'sokfram-cu' }]).svc.brands()) as Out;
    expect(legacyOnly).toEqual([{ brand: 'Sokfarm', count: 3, slug: 'sokfram-cu' }]);
    const both = (await brandsService(rows, [], [{ name: 'Sokfarm', slug: 'sokfarm' }, { name: 'Sokfram', slug: 'sokfram-cu' }]).svc.brands()) as Out;
    expect(both).toEqual([{ brand: 'Sokfarm', count: 3, slug: 'sokfarm' }]);
    const bothReversed = (await brandsService(rows, [], [{ name: 'Sokfram', slug: 'sokfram-cu' }, { name: 'Sokfarm', slug: 'sokfarm' }]).svc.brands()) as Out;
    expect(bothReversed).toEqual([{ brand: 'Sokfarm', count: 3, slug: 'sokfarm' }]);
  });

  it('nhãn Admin đã gán cộng dồn với nhãn suy được, không bị đè', async () => {
    const rows = [
      { id: 'a', name: 'Nước giặt Fuwa3e 500ml', slug: 'a', brand: 'Tubu Tree' },
      { id: 'b', name: 'Quà tặng Tết', slug: 'b', brand: 'Tubu Tree' },
    ];
    const { svc } = brandsService(
      [
        { brand: 'Tubu Tree', _count: { _all: 2 } },
        { brand: 'Fuwa3e', _count: { _all: 3 } },
        { brand: 'Gốm Bát Tràng', _count: { _all: 1 } },
      ],
      rows,
    );
    const out = (await svc.brands()) as Out;
    expect(Object.fromEntries(out.map((b) => [b.brand, b.count]))).toEqual({ Fuwa3e: 4, 'Gốm Bát Tràng': 1, 'Tubu Tree': 1 });
  });

  it('brand rỗng cũng là chưa gán nhãn', async () => {
    const { svc, findMany } = brandsService([{ brand: '', _count: { _all: 1 } }], [{ id: 'a', name: 'Xịt tràm Pineboo 150ml', slug: 'a', brand: '' }]);
    expect(await svc.brands()).toEqual([{ brand: 'Pineboo', count: 1, slug: null }]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('không còn hàng "Tubu Tree" (đã đồng bộ lại) thì không đọc thêm gì', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ brand: 'Fuwa3e', _count: { _all: 44 } }]);
    // Thiếu product.findMany: gọi tới là lỗi.
    const prisma = { product: { groupBy }, brand: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    expect(await new CatalogService(prisma).brands()).toEqual([{ brand: 'Fuwa3e', count: 44, slug: null }]);
  });

  it('chỉ "Tubu Tree" mà không tên nào nói nhãn thì vẫn một dòng "Tubu Tree"', async () => {
    const { svc } = brandsService([{ brand: 'Tubu Tree', _count: { _all: 2 } }], [
      { id: 'a', name: 'Cà phê muối túi 50x16g', slug: 'a', brand: 'Tubu Tree' },
      { id: 'b', name: 'Socola CHOCO-OKE', slug: 'b', brand: 'Tubu Tree' },
    ]);
    expect(await svc.brands()).toEqual([{ brand: 'Tubu Tree', count: 2, slug: null }]);
  });
});

describe('CatalogService — hiển thị và "cùng nhãn" với cột brand còn chính tả cũ "Sokfram"', () => {
  const baseCard = (brand: string) => ({
    id: 'p1', slug: 'p1', brand, name: 'Mật hoa dừa Sokfarm', thumbnail: null, images: [], basePrice: 1000, salePrice: null, isFeatured: false,
    ratingAvg: 0, reviewCount: 0, soldExternal: 0, soldApp: 0,
    variations: [{ id: 'p1-v', sku: 'p1-sku', retailPrice: 1000, salePrice: null, stock: 5 }],
  });

  it('related: sản phẩm mang "Sokfram" tìm anh em ở cả hai cách ghi; nhãn thường vẫn lọc bằng đúng chuỗi brand', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue({ id: 'self', brand: 'Sokfram' }), findMany } } as unknown as PrismaService;
    await new CatalogService(prisma).related('mat-hoa-dua');
    expect(findMany.mock.calls[0]![0].where).toEqual({
      isActive: true,
      approvalStatus: 'APPROVED',
      id: { not: 'self' },
      OR: [{ brand: { equals: 'Sokfarm', mode: 'insensitive' } }, { brand: { equals: 'Sokfram', mode: 'insensitive' } }],
    });
  });

  it('thẻ sản phẩm ghi "Sokfarm" dù cột brand còn "Sokfram"; nhãn khác nguyên văn', async () => {
    const mk = (brand: string) =>
      ({
        product: { findMany: jest.fn().mockResolvedValue([baseCard(brand)]), count: jest.fn().mockResolvedValue(1) },
        $transaction: jest.fn().mockResolvedValue([[baseCard(brand)], 1]),
      }) as unknown as PrismaService;
    for (const [stored, shown] of [['Sokfram', 'Sokfarm'], ['SOKFRAM', 'Sokfarm'], ['Sokfarm', 'Sokfarm'], ['Fuwa3e', 'Fuwa3e'], ['Tubu Tree', 'Tubu Tree']] as const) {
      const out = (await new CatalogService(mk(stored)).list({ page: 1, limit: 10 })) as unknown as { data: { brand: string }[] };
      expect({ stored, shown: out.data[0]!.brand }).toEqual({ stored, shown });
    }
  });
});

describe('CatalogService.list ?brand= — lọc theo nhãn hiệu lực', () => {
  const card = (id: string) => ({
    id, slug: id, brand: 'Tubu Tree', name: id, thumbnail: null, images: [], basePrice: 1000, salePrice: null, isFeatured: false,
    ratingAvg: 0, reviewCount: 0, soldExternal: 0, soldApp: 0,
    variations: [{ id: `${id}-v`, sku: `${id}-sku`, retailPrice: 1000, salePrice: null, stock: 5 }],
  });
  type Args = { where: Record<string, unknown>; select?: object };
  /** Câu đọc chỉ mục nhãn chọn {id, name, slug, brand}; câu lấy thẻ chọn CARD_PRODUCT_SELECT (có `variations`). */
  const isIndexQuery = (a: Args) => Boolean(a.select) && 'name' in a.select! && !('variations' in a.select!);

  function listService(indexRows: unknown[]) {
    // Một mock findMany cho cả hai truy vấn: chỉ mục nhãn (select có `name`) và trang sản phẩm.
    const findMany = jest.fn(async (args: Args) => (isIndexQuery(args) ? indexRows : [card('p1')]));
    const prisma = {
      product: { findMany, count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn().mockResolvedValue([[card('p1')], 1]),
    } as unknown as PrismaService;
    const pageWhere = () => {
      return findMany.mock.calls.map((c) => c[0] as Args).find((a) => !isIndexQuery(a))!.where;
    };
    return { svc: new CatalogService(prisma), findMany, pageWhere };
  }

  it('?brand=Fuwa3e → sản phẩm có cột brand "Fuwa3e" HOẶC sản phẩm "Tubu Tree" mà tên nói Fuwa3e (44 SKU PROD)', async () => {
    const { svc, pageWhere } = listService(GENERIC_ROWS);
    await svc.list({ page: 1, limit: 10, brand: 'Fuwa3e' });
    const where = pageWhere();
    expect(where.brand).toBeUndefined();
    const ids = idsOf('Fuwa3e');
    expect(ids).toHaveLength(44);
    expect(where.AND).toEqual([{ OR: [{ OR: [{ brand: 'Fuwa3e' }, { id: { in: ids } }] }] }]);
  });

  it('?brand=Sokfram, Pineboo, Le Plateau Coffee → mỗi nhãn một nhánh với đúng id của nó (10, 6, 2)', async () => {
    const { svc, pageWhere } = listService(GENERIC_ROWS);
    await svc.list({ page: 1, limit: 10, brand: 'Sokfram, Pineboo, Le Plateau Coffee' });
    const or = (pageWhere().AND as { OR: { OR: [unknown, { id: { in: string[] } }] }[] }[])[0]!.OR;
    expect(or.map((b) => b.OR[1].id.in.length)).toEqual([10, 6, 2]);
  });

  const sokfarmColumn = {
    OR: [{ brand: { equals: 'Sokfarm', mode: 'insensitive' } }, { brand: { equals: 'Sokfram', mode: 'insensitive' } }],
  };

  it('?brand=Sokfram (link cũ), ?brand=sokfarm, ?brand=SOKFRAM ra cùng một điều kiện: cột brand mọi cách ghi HOẶC SKU "Tubu Tree" tên Sokfarm (10 SKU PROD)', async () => {
    const ids = idsOf('Sokfarm');
    expect(ids).toHaveLength(10);
    for (const asked of ['Sokfram', 'Sokfarm', 'sokfarm', 'SOKFRAM', ' Sokfram ']) {
      const { svc, pageWhere } = listService(GENERIC_ROWS);
      await svc.list({ page: 1, limit: 10, brand: asked });
      const where = pageWhere();
      expect({ asked, brand: where.brand }).toEqual({ asked, brand: undefined });
      expect({ asked, and: where.AND }).toEqual({ asked, and: [{ OR: [{ OR: [sokfarmColumn, { id: { in: ids } }] }] }] });
    }
  });

  it('?brand=Sokfram khi không SKU nào đang được suy nhãn: vẫn khớp cả hai cách ghi trong cột brand, không lọc theo chuỗi "Sokfram" trần', async () => {
    const { svc, pageWhere } = listService([{ id: 'a', name: 'Cà phê muối túi 50x16g', slug: 'a', brand: 'Tubu Tree' }]);
    await svc.list({ page: 1, limit: 10, brand: 'Sokfram' });
    const where = pageWhere();
    expect(where.brand).toBeUndefined();
    expect(where.AND).toEqual([{ OR: [sokfarmColumn] }]);
  });

  it('?brand=Sokfram cùng nhãn khác không suy được: nhánh Sokfarm khớp mọi cách ghi, nhánh kia lọc cột brand như cũ', async () => {
    const { svc, pageWhere } = listService([{ id: 'a', name: 'Cà phê muối túi 50x16g', slug: 'a', brand: 'Tubu Tree' }]);
    await svc.list({ page: 1, limit: 10, brand: 'Sokfram, Gốm Bát Tràng' });
    expect(pageWhere().AND).toEqual([{ OR: [sokfarmColumn, { brand: 'Gốm Bát Tràng' }] }]);
  });

  it('?brand=Tubu Tree → chỉ phần chưa nhận ra nhãn nào (loại 102 SKU đã suy ra nhãn), khớp số đếm của /brands', async () => {
    const { svc, pageWhere } = listService(GENERIC_ROWS);
    await svc.list({ page: 1, limit: 10, brand: 'Tubu Tree' });
    const or = (pageWhere().AND as { OR: { brand: string; id: { notIn: string[] } }[] }[])[0]!.OR;
    expect(or).toHaveLength(1);
    expect(or[0]!.brand).toBe('Tubu Tree');
    expect(or[0]!.id.notIn).toHaveLength(102);
    expect(GENERIC_ROWS.length - or[0]!.id.notIn.length).toBe(9);
  });

  it('nhãn Admin đặt riêng đi cùng nhãn suy được: nhánh riêng chỉ lọc theo cột brand', async () => {
    const { svc, pageWhere } = listService(GENERIC_ROWS);
    await svc.list({ page: 1, limit: 10, brand: 'Hector, Gốm Bát Tràng' });
    const or = (pageWhere().AND as { OR: unknown[] }[])[0]!.OR;
    expect(or[1]).toEqual({ brand: 'Gốm Bát Tràng' });
  });

  it('nhãn không suy được thì lọc bằng cột brand như cũ và không đọc chỉ mục', async () => {
    const { svc, findMany, pageWhere } = listService(GENERIC_ROWS);
    await svc.list({ page: 1, limit: 10, brand: 'Gốm Bát Tràng' });
    expect(pageWhere().brand).toBe('Gốm Bát Tràng');
    expect(findMany.mock.calls.filter((c) => isIndexQuery(c[0] as Args))).toHaveLength(0);
  });

  it('không sản phẩm nào đang được suy nhãn (đã đồng bộ lại) → lọc bằng cột brand như cũ', async () => {
    const { svc, pageWhere } = listService([{ id: 'a', name: 'Cà phê muối túi 50x16g', slug: 'a', brand: 'Tubu Tree' }]);
    await svc.list({ page: 1, limit: 10, brand: 'Fuwa3e' });
    const where = pageWhere();
    expect(where.brand).toBe('Fuwa3e');
    expect(where.AND).toBeUndefined();
  });

  it('chỉ mục nhãn nhớ 60 giây: hai lần lọc liên tiếp chỉ đọc một lần', async () => {
    const { svc, findMany } = listService(GENERIC_ROWS);
    await svc.list({ page: 1, limit: 10, brand: 'Fuwa3e' });
    await svc.list({ page: 1, limit: 10, brand: 'Hector' });
    expect(findMany.mock.calls.filter((c) => isIndexQuery(c[0] as Args))).toHaveLength(1);
  });
});
