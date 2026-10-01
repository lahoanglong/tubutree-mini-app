import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import type { ProductQuery } from '../../src/modules/catalog/dto/product-query.dto';
import { SQL_WHITESPACE_RE, VN_FOLD_FROM, VN_FOLD_TO, foldVietnamese } from '../../src/modules/catalog/search-text';
import { randCode, warmPool } from './helpers';

/**
 * Dự án 4b trên Postgres THẬT: tìm không dấu bằng translate() (khớp hàm TS kể cả chữ HOA dưới
 * collation của DB, tên dạng NFD, NBSP và các khoảng trắng Unicode), LIKE không có ký tự đại diện
 * ngoài ý muốn, bộ lọc giá/tồn/đánh giá, "Bán chạy" phân trang ổn định khi hoà (kể cả kết hợp với
 * từ khoá và bộ lọc), productCount của danh mục. DB dùng chung giữa các lần chạy → mỗi test dùng
 * brand/tag/id riêng.
 *
 * Khoảng hở đã biết (không pin): U+0085 (NEL) — `[[:space:]]` của DB coi là khoảng trắng còn `\s` của
 * JS thì không, nên tên SP chứa NEL được gấp ở SQL nhưng từ khoá chứa NEL thì không. Khách không gõ
 * được ký tự này và tên Pancake không có → bỏ qua, ghi trong báo cáo Task 7.
 */
describe('Buy-flow 4b — tìm kiếm & bộ lọc catalog (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let catalog: CatalogService;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Spy trên prototype để bắt cả cảnh báo "lùi về contains" của logger mà service tự tạo.
    warnSpy = jest.spyOn(Logger.prototype, 'warn');
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [CatalogService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    catalog = moduleRef.get(CatalogService);
  });

  beforeEach(() => warnSpy.mockClear()); // lỗi chỉ gán cho đúng test gây ra

  afterEach(() => {
    // SQL tìm không dấu phải chạy THẬT trên Postgres: lùi về `contains` (cảnh báo này) sẽ che lỗi
    // cú pháp/hàm của câu lệnh ứng viên mà các assert kết quả có thể vẫn "vô tình" qua.
    const fallbacks = warnSpy.mock.calls.filter((c) => String(c[0]).includes('Tìm không dấu lỗi'));
    expect(fallbacks).toEqual([]);
  });

  afterAll(async () => {
    warnSpy.mockRestore();
    await moduleRef?.close();
  });

  const newBrand = () => `IT4B ${randCode(6)}`;
  /** id chỉ gồm [a-z0-9] cùng độ dài → thứ tự `id ASC` của DB (mọi collation) trùng thứ tự so sánh chuỗi của JS. */
  const idPrefix = () => `it4b${randCode(8).toLowerCase()}`;

  async function createProduct(
    brand: string,
    over: {
      name: string; id?: string; basePrice?: number; salePrice?: number | null; stock?: number; variationActive?: boolean;
      ratingAvg?: number; soldApp?: number; soldExternal?: number; categoryIds?: string[]; isActive?: boolean;
      approvalStatus?: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED'; tags?: string[];
    },
  ) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        ...(over.id ? { id: over.id } : {}),
        pancakeId: `it4b-p-${tag}`,
        brand,
        slug: `it4b-${tag.toLowerCase()}`,
        name: over.name,
        description: 'IT',
        basePrice: over.basePrice ?? 100_000,
        salePrice: over.salePrice ?? null,
        ratingAvg: over.ratingAvg ?? 0,
        soldApp: over.soldApp ?? 0,
        soldExternal: over.soldExternal ?? 0,
        categoryIds: over.categoryIds ?? [],
        tags: over.tags ?? [],
        isActive: over.isActive ?? true,
        approvalStatus: over.approvalStatus ?? 'APPROVED',
      },
    });
    await prisma.variation.create({
      data: {
        pancakeId: `it4b-v-${tag}`,
        productId: product.id,
        sku: `IT4B-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: over.basePrice ?? 100_000,
        stock: over.stock ?? 5,
        isActive: over.variationActive ?? true,
      },
    });
    return product;
  }

  const listIds = async (brand: string, q: Partial<ProductQuery>) =>
    (await catalog.list({ page: 1, limit: 50, brand, ...q })).data.map((c) => c.id).sort();

  /** Cùng biểu thức gấp dấu với catalog.service.ts (translate → lower → gom khoảng trắng → btrim). */
  const dbFold = async (s: string) => {
    const [row] = await prisma.$queryRaw<{ f: string }[]>`
      SELECT btrim(regexp_replace(lower(translate(${s}, ${VN_FOLD_FROM}, ${VN_FOLD_TO})), ${SQL_WHITESPACE_RE}, ' ', 'g')) AS f`;
    return row!.f;
  };

  // Mọi ký tự mà `\s` của JS coi là khoảng trắng (`trim()` dùng cùng bộ này).
  const jsWhitespace = Array.from({ length: 0x10000 }, (_, i) => String.fromCharCode(i)).filter((c) => /\s/.test(c));

  it('translate() + lower() của DB gấp dấu GIỐNG HỆT foldVietnamese (chữ HOA, NFD, NBSP, khoảng trắng thừa)', async () => {
    const samples = [
      'Nước Rửa Chén', 'NƯỚC RỬA CHÉN ĐẬU', 'Xà  phòng   thảo mộc', `${'Nước'.normalize('NFD')} ${'rửa'.normalize('NFD')}`,
      'ƯỚC RỬA ĐẬU ỔI'.normalize('NFD'), 'Kem chống nắng Rau Má 50ml', 'Ổi Ửng Ỹ Ỵ ữ Đà Lạt',
      'Nước rửa  chén', ' Dầu gội ', 'abcdefghijklmnopqrstuvwxyz0123456789',
    ];
    for (const s of samples) expect(await dbFold(s)).toBe(foldVietnamese(s));
  });

  it('thứ tự đối số translate(from, to): MỌI chữ có dấu/HOA/dấu kết hợp gấp ra đúng chữ gốc (đảo from/to sẽ vỡ)', async () => {
    expect(await dbFold(VN_FOLD_FROM)).toBe(foldVietnamese(VN_FOLD_FROM));
    expect(await dbFold('ê')).toBe('e');
    expect(await dbFold('Ê')).toBe('e');
    expect(await dbFold('ê')).toBe('e'); // e + dấu mũ rời (NFD)
    // chữ không dấu giữ nguyên, không bị ánh xạ ngược sang chữ có dấu
    expect(await dbFold('aeiouyd')).toBe('aeiouyd');
    expect(await dbFold('NHÀ')).toBe('nha');
  });

  it('mọi khoảng trắng Unicode mà JS coi là khoảng trắng (NBSP, U+2000–200A, U+3000, U+FEFF…) gom thành MỘT dấu cách như phía TS', async () => {
    const missed: string[] = [];
    for (const c of jsWhitespace) {
      const s = `nước${c}${c}rửa`;
      if ((await dbFold(s)) !== foldVietnamese(s)) missed.push(`U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    }
    expect(missed).toEqual([]);
  });

  it('GET /products?q=: không dấu, chữ hoa, tên NFD, NBSP đều khớp; % và _ không thành ký tự đại diện', async () => {
    const brand = newBrand();
    const tag = randCode(6).toLowerCase();
    const nrc = await createProduct(brand, { name: `Nước Rửa Chén Hương Chanh ${tag}` });
    const nfd = await createProduct(brand, { name: `${'Nước rửa'.normalize('NFD')} bình sữa ${tag}` });
    const nbsp = await createProduct(brand, { name: `Nước Rửa Tay ${tag}` });
    await createProduct(brand, { name: `Xà phòng ${tag}` });

    expect(await listIds(brand, { q: 'nuoc rua' })).toEqual([nrc.id, nfd.id, nbsp.id].sort());
    expect(await listIds(brand, { q: 'NƯỚC RỬA chén' })).toEqual([nrc.id]);
    expect(await listIds(brand, { q: 'nuoc   rua   chen' })).toEqual([nrc.id]);
    expect(await listIds(brand, { q: 'nuoc rua tay' })).toEqual([nbsp.id]); // khách gõ NBSP
    expect(await listIds(brand, { q: 'nước rửa tay' })).toEqual([nbsp.id]); // tên NBSP, từ khoá dấu cách thường
    expect(await listIds(brand, { q: 'NƯỚC'.normalize('NFD') })).toEqual([nrc.id, nfd.id, nbsp.id].sort());
    expect(await listIds(brand, { q: '%' })).toEqual([]);
    expect(await listIds(brand, { q: '_' })).toEqual([]);
    expect(await listIds(brand, { q: '   ' })).toHaveLength(4); // chỉ khoảng trắng = không lọc từ khoá
  });

  it('LIKE: % _ ! \\ khách gõ khớp đúng nghĩa đen (a_b không khớp axb, % không là "mọi thứ")', async () => {
    const brand = newBrand();
    const tag = randCode(6).toLowerCase();
    const under = await createProduct(brand, { name: `a_b ${tag}` });
    const other = await createProduct(brand, { name: `axb ${tag}` });
    const pct = await createProduct(brand, { name: `giảm 50% ${tag}` });
    await createProduct(brand, { name: `giảm 50 độ ${tag}` });
    const bang = await createProduct(brand, { name: `hot!deal ${tag}` });
    await createProduct(brand, { name: `hotxdeal ${tag}` });
    const slash = await createProduct(brand, { name: `a\\b ${tag}` });

    expect(await listIds(brand, { q: `a_b ${tag}` })).toEqual([under.id]);
    expect(await listIds(brand, { q: 'a_b' })).toEqual([under.id]);
    expect(await listIds(brand, { q: 'axb' })).toEqual([other.id]);
    expect(await listIds(brand, { q: '50%' })).toEqual([pct.id]);
    expect(await listIds(brand, { q: '50% ' })).toEqual([pct.id]);
    expect(await listIds(brand, { q: 'hot!deal' })).toEqual([bang.id]);
    expect(await listIds(brand, { q: 'hot!' })).toEqual([bang.id]);
    expect(await listIds(brand, { q: 'a\\b' })).toEqual([slash.id]);
    // ký tự đặc biệt đứng một mình chỉ khớp SP có đúng ký tự đó, không phải "mọi SP"
    expect(await listIds(brand, { q: '%' })).toEqual([pct.id]);
    expect(await listIds(brand, { q: '_' })).toEqual([under.id]);
    expect(await listIds(brand, { q: '!' })).toEqual([bang.id]);
  });

  it('tag khớp đúng nguyên văn (chữ thường) song song với tên', async () => {
    const brand = newBrand();
    const tag = randCode(6).toLowerCase();
    const tagged = await createProduct(brand, { name: 'IT tagged', tags: [`tag${tag}`] });
    await createProduct(brand, { name: 'IT untagged', tags: [] });
    expect(await listIds(brand, { q: `TAG${tag.toUpperCase()}` })).toEqual([tagged.id]);
  });

  it('GET /search/suggest dùng cùng cách khớp không dấu', async () => {
    const brand = newBrand();
    const tag = randCode(6).toLowerCase();
    const p = await createProduct(brand, { name: `Dầu Gội Bưởi ${tag}` });
    const slugs = (await catalog.suggest(`dau goi buoi ${tag}`)).map((s) => s.slug);
    expect(slugs).toEqual([p.slug]);
    expect((await catalog.suggest(`DẦU GỘI BƯỞI ${tag}`)).map((s) => s.slug)).toEqual([p.slug]);
  });

  it('SP chưa duyệt / bị loại / đã tắt không lọt vào kết quả tìm kiếm (điều kiện lặp trong SQL ứng viên)', async () => {
    const brand = newBrand();
    const tag = randCode(6).toLowerCase();
    const ok = await createProduct(brand, { name: `Sữa tắm ${tag}` });
    await createProduct(brand, { name: `Sữa tắm chờ duyệt ${tag}`, approvalStatus: 'PENDING_REVIEW' });
    await createProduct(brand, { name: `Sữa tắm bị loại ${tag}`, approvalStatus: 'REJECTED' });
    await createProduct(brand, { name: `Sữa tắm đã tắt ${tag}`, isActive: false });
    expect(await listIds(brand, { q: 'sua tam' })).toEqual([ok.id]);
    expect((await catalog.suggest(`sua tam ${tag}`)).map((s) => s.slug)).toEqual([ok.slug]);
  });

  it('bộ lọc: giá ĐANG BÁN (cả hai đầu gồm biên), chỉ còn hàng (phân loại đang bán), từ 4★; total khớp', async () => {
    const brand = newBrand();
    const onSale = await createProduct(brand, { name: 'IT sale', basePrice: 300_000, salePrice: 150_000, ratingAvg: 4.5 });
    const cheap = await createProduct(brand, { name: 'IT cheap', basePrice: 120_000, ratingAvg: 3.9 });
    const pricey = await createProduct(brand, { name: 'IT pricey', basePrice: 600_000, ratingAvg: 4.0 });
    const soldOut = await createProduct(brand, { name: 'IT sold out', basePrice: 150_000, stock: 0, ratingAvg: 5 });
    const hiddenVar = await createProduct(brand, { name: 'IT hidden variation', basePrice: 150_000, stock: 9, variationActive: false });
    // giá niêm yết 150k trong khoảng nhưng giá ĐANG BÁN 90k nằm ngoài → không lọt "100k–200k"
    const deepSale = await createProduct(brand, { name: 'IT deep sale', basePrice: 150_000, salePrice: 90_000 });
    const edgeLo = await createProduct(brand, { name: 'IT edge lo', basePrice: 100_000 });
    const edgeHi = await createProduct(brand, { name: 'IT edge hi', basePrice: 200_000 });

    const inRange = [onSale.id, cheap.id, soldOut.id, hiddenVar.id, edgeLo.id, edgeHi.id].sort();
    expect(await listIds(brand, { minPrice: 100_000, maxPrice: 200_000 })).toEqual(inRange);
    expect(await listIds(brand, { minPrice: 200_000, maxPrice: 100_000 })).toEqual(inRange); // min > max đổi chỗ
    expect(await listIds(brand, { maxPrice: 100_000 })).toEqual([deepSale.id, edgeLo.id].sort());
    expect(await listIds(brand, { minPrice: 300_000 })).toEqual([pricey.id]);
    expect(await listIds(brand, { minPrice: 100_000, maxPrice: 200_000, inStock: true })).toEqual(
      [onSale.id, cheap.id, edgeLo.id, edgeHi.id].sort(),
    );
    expect(await listIds(brand, { minRating: 4 })).toEqual([onSale.id, pricey.id, soldOut.id].sort());

    const r = await catalog.list({ page: 1, limit: 1, brand, inStock: true });
    expect(r.data).toHaveLength(1);
    expect(r.meta.total).toBe(6); // tất cả trừ soldOut và hiddenVar
  });

  it('best_seller: soldApp + soldExternal giảm dần, hoà thì id tăng dần, qua 2 trang không trùng/sót', async () => {
    const brand = newBrand();
    const prefix = idPrefix();
    const id = (s: string) => `${prefix}${s}`;
    await createProduct(brand, { id: id('a'), name: 'IT a', soldApp: 5, soldExternal: 10 });
    await createProduct(brand, { id: id('b'), name: 'IT b', soldApp: 20 });
    await createProduct(brand, { id: id('c'), name: 'IT c', soldExternal: 15 });
    await createProduct(brand, { id: id('d'), name: 'IT d' });

    const p1 = await catalog.list({ page: 1, limit: 2, brand, sort: 'best_seller' });
    const p2 = await catalog.list({ page: 2, limit: 2, brand, sort: 'best_seller' });
    expect(p1.data.map((c) => c.id)).toEqual([id('b'), id('a')]);
    expect(p2.data.map((c) => c.id)).toEqual([id('c'), id('d')]);
    expect(p1.meta.total).toBe(4);
    expect(p1.data[0]!.sold).toBe(20);
  });

  /** Duyệt MỌI trang ở nhiều cỡ limit: mỗi SP khớp đúng một lần, đúng thứ tự `expected`, total = số khớp. */
  async function expectPagesCover(brand: string, q: Partial<ProductQuery>, expected: string[]) {
    expect(expected.length).toBeGreaterThan(3); // chống test rỗng: phải có đủ SP để phân trang
    for (const limit of [1, 2, 3, 5, 50]) {
      const ids: string[] = [];
      const pages = Math.ceil(expected.length / limit);
      for (let page = 1; page <= pages + 1; page++) {
        const r = await catalog.list({ page, limit, brand, ...q });
        expect(r.meta.total).toBe(expected.length);
        if (page > pages) expect(r.data).toEqual([]);
        ids.push(...r.data.map((c) => c.id));
      }
      expect({ limit, ids }).toEqual({ limit, ids: expected });
    }
  }

  it('best_seller KẾT HỢP từ khoá + bộ lọc giá/tồn: mọi SP khớp đúng một lần, (điểm giảm, id tăng), total = số khớp', async () => {
    const brand = newBrand();
    const prefix = idPrefix();
    const tag = randCode(6).toLowerCase();
    type Spec = { n: string; name: string; sold: number; ext?: number; price?: number; sale?: number; stock?: number };
    const specs: Spec[] = [
      { n: '01', name: `Nước rửa chén ${tag}`, sold: 7 },
      { n: '02', name: `NƯỚC RỬA TAY ${tag}`, sold: 7, ext: 3 }, // điểm 10
      { n: '03', name: `${'Nước rửa'.normalize('NFD')} kính ${tag}`, sold: 10 }, // hoà 10 với 02
      { n: '04', name: `Nước rửa sàn ${tag}`, sold: 0, ext: 4 },
      { n: '05', name: `Nước rửa bình ${tag}`, sold: 4 }, // hoà 4 với 04
      { n: '06', name: `Nước rửa xe ${tag}`, sold: 1, price: 900_000 }, // ngoài khoảng giá
      { n: '07', name: `Nước rửa mặt ${tag}`, sold: 50, stock: 0 }, // hết hàng
      { n: '08', name: `Nước rửa rau ${tag}`, sold: 0 },
      { n: '09', name: `Nước rửa bát ${tag}`, sold: 2, price: 500_000, sale: 120_000 }, // giá đang bán 120k
      { n: '10', name: `Xà phòng ${tag}`, sold: 99 }, // không khớp từ khoá
      { n: '11', name: `Nước giặt ${tag}`, sold: 98 }, // không khớp "nuoc rua"
    ];
    for (const s of specs) {
      await createProduct(brand, {
        id: `${prefix}${s.n}`, name: s.name, soldApp: s.sold, soldExternal: s.ext ?? 0,
        basePrice: s.price ?? 150_000, salePrice: s.sale ?? null, stock: s.stock ?? 5,
      });
    }
    const matchesText = (s: Spec) => foldVietnamese(s.name).includes('nuoc rua');
    const inPriceRange = (s: Spec) => {
      const shown = s.sale ?? s.price ?? 150_000;
      return shown >= 100_000 && shown <= 200_000;
    };
    const inStock = (s: Spec) => (s.stock ?? 5) > 0;
    const rank = (list: Spec[]) =>
      [...list]
        .sort((a, b) => b.sold + (b.ext ?? 0) - (a.sold + (a.ext ?? 0)) || (a.n < b.n ? -1 : 1))
        .map((s) => `${prefix}${s.n}`);

    // 1) chỉ từ khoá
    await expectPagesCover(brand, { sort: 'best_seller', q: 'nuoc rua' }, rank(specs.filter(matchesText)));
    // 2) từ khoá (viết hoa, có dấu) + khoảng giá đang bán
    await expectPagesCover(
      brand,
      { sort: 'best_seller', q: 'NƯỚC RỬA', minPrice: 100_000, maxPrice: 200_000 },
      rank(specs.filter((s) => matchesText(s) && inPriceRange(s))),
    );
    // 3) từ khoá + khoảng giá + còn hàng
    await expectPagesCover(
      brand,
      { sort: 'best_seller', q: 'nuoc rua', minPrice: 100_000, maxPrice: 200_000, inStock: true },
      rank(specs.filter((s) => matchesText(s) && inPriceRange(s) && inStock(s))),
    );
    // 4) chỉ bộ lọc giá + còn hàng (không từ khoá) — gồm cả SP không khớp từ khoá
    await expectPagesCover(
      brand,
      { sort: 'best_seller', minPrice: 100_000, maxPrice: 200_000, inStock: true },
      rank(specs.filter((s) => inPriceRange(s) && inStock(s))),
    );
  });

  it('sắp mặc định với nhiều SP hoà nhau: các trang phủ đúng mỗi SP một lần, theo id tăng dần', async () => {
    const brand = newBrand();
    const prefix = idPrefix();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = `${prefix}${String(i).padStart(2, '0')}`;
      ids.push(id);
      await createProduct(brand, { id, name: `IT tie ${i}` });
    }
    await expectPagesCover(brand, {}, ids);
    // các trang gọi ĐỒNG THỜI cũng không trùng/sót
    const pages = await Promise.all([1, 2, 3, 4].map((page) => catalog.list({ page, limit: 2, brand })));
    expect(pages.flatMap((p) => p.data.map((c) => c.id))).toEqual(ids);
  });

  it('GET /categories: productCount đếm SP đang bán MỘT lần cho mỗi danh mục (SP 2 danh mục, chưa duyệt, đã tắt, danh mục trống)', async () => {
    const mk = async (name: string) => {
      const id = `it4b-cat-${randCode(8).toLowerCase()}`;
      await prisma.category.create({ data: { id, name, slug: id, sortOrder: 999 } });
      return id;
    };
    const catA = await mk('IT Danh mục A');
    const catB = await mk('IT Danh mục B');
    const catEmpty = await mk('IT Danh mục trống');
    const catOnlyHidden = await mk('IT Danh mục chỉ SP ẩn');
    const brand = newBrand();
    await createProduct(brand, { name: 'IT a1', categoryIds: [catA] });
    await createProduct(brand, { name: 'IT a2', categoryIds: [catA] });
    await createProduct(brand, { name: 'IT ab (hai danh mục)', categoryIds: [catA, catB] });
    await createProduct(brand, { name: 'IT a trùng id', categoryIds: [catA, catA] }); // id lặp chỉ tính một lần
    await createProduct(brand, { name: 'IT a đã tắt', categoryIds: [catA], isActive: false });
    await createProduct(brand, { name: 'IT ab chờ duyệt', categoryIds: [catA, catB], approvalStatus: 'PENDING_REVIEW' });
    await createProduct(brand, { name: 'IT a bị loại', categoryIds: [catA], approvalStatus: 'REJECTED' });
    await createProduct(brand, { name: 'IT hidden only', categoryIds: [catOnlyHidden], isActive: false });
    await createProduct(brand, { name: 'IT hidden only 2', categoryIds: [catOnlyHidden], approvalStatus: 'PENDING_REVIEW' });

    const fresh = new CatalogService(prisma); // cache 60s theo instance — instance mới để đọc số thật
    const cats = await fresh.categories();
    const count = (id: string) => cats.find((c) => c.id === id)?.productCount;
    expect(count(catA)).toBe(4); // a1, a2, ab, a trùng id
    expect(count(catB)).toBe(1); // chỉ ab
    expect(count(catEmpty)).toBe(0);
    expect(count(catOnlyHidden)).toBe(0);
    // danh mục đếm 0 vẫn có trong danh sách (miniapp tự ẩn danh mục 0)
    expect(cats.some((c) => c.id === catEmpty)).toBe(true);
    // lọc GET /products?category= ra đúng tập mà productCount đếm
    expect((await catalog.list({ page: 1, limit: 50, category: catA })).meta.total).toBe(4);
  });
});
