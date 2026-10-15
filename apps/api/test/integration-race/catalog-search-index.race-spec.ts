import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService, textMatchSql } from '../../src/modules/catalog/catalog.service';
import { VN_FOLD_FROM, foldVietnamese } from '../../src/modules/catalog/search-text';
import { randCode, warmPool } from './helpers';

/**
 * C-038 trên Postgres THẬT: tìm không dấu đọc cột `products."nameSearch"` (trigger giữ đồng bộ với
 * `name`, cùng phép gấp với `foldVietnamese`) có index trigram GIN, thay vì tính translate()+
 * regexp_replace() trên từng dòng mỗi lần tìm (quét tuần tự). Kết quả tìm giữ nguyên: các test
 * tiếng Việt/HOA/NFD/escape của buy-flow-4b.race-spec.ts chạy lại trên đường mới.
 */
describe('C-038 — tìm không dấu có index (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let catalog: CatalogService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [CatalogService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    catalog = moduleRef.get(CatalogService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function createProduct(name: string, tags: string[] = []) {
    const tag = randCode(8);
    return prisma.product.create({
      data: {
        pancakeId: `itsi-p-${tag}`,
        brand: `ITSI ${tag}`,
        slug: `itsi-${tag.toLowerCase()}`,
        name,
        description: 'IT',
        basePrice: 100_000,
        tags,
      },
    });
  }

  const nameSearchOf = async (id: string) => {
    const [row] = await prisma.$queryRaw<{ s: string }[]>`SELECT "nameSearch" AS s FROM products WHERE id = ${id}`;
    return row!.s;
  };

  it('hàm vn_search_fold của DB gấp GIỐNG HỆT foldVietnamese (cả bảng ký tự, NFD, mọi khoảng trắng JS)', async () => {
    const jsWhitespace = Array.from({ length: 0x10000 }, (_, i) => String.fromCharCode(i)).filter((c) => /\s/.test(c));
    const samples = [
      VN_FOLD_FROM, 'NƯỚC RỬA CHÉN ĐẬU', `${'Nước'.normalize('NFD')} ${'rửa'.normalize('NFD')}`,
      '  Xà  phòng   thảo mộc ', 'a_b 50% hot!deal a\\b', ...jsWhitespace.map((c) => `nước${c}${c}rửa${c}`),
    ];
    const [row] = await prisma.$queryRaw<{ f: string[] }[]>`
      SELECT array_agg(vn_search_fold(s) ORDER BY i) AS f FROM unnest(${samples}::text[]) WITH ORDINALITY AS t(s, i)`;
    expect(row!.f).toEqual(samples.map(foldVietnamese));
  });

  it('trigger: cột nameSearch = foldVietnamese(name) khi tạo, khi đổi tên qua Prisma lẫn SQL tay; không ghi đè được', async () => {
    const p = await createProduct(`Dầu Gội ${'Bưởi'.normalize('NFD')}  Tóc`);
    expect(await nameSearchOf(p.id)).toBe('dau goi buoi toc');

    await prisma.product.update({ where: { id: p.id }, data: { name: 'NƯỚC RỬA CHÉN' } });
    expect(await nameSearchOf(p.id)).toBe('nuoc rua chen');

    await prisma.$executeRaw`UPDATE products SET name = ${'Xà phòng'}, "nameSearch" = ${'rác'} WHERE id = ${p.id}`;
    expect(await nameSearchOf(p.id)).toBe('xa phong');
  });

  it('backfill: không SP nào có nameSearch lệch với tên', async () => {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM products WHERE "nameSearch" IS DISTINCT FROM vn_search_fold(name)`;
    expect(Number(row!.n)).toBe(0);
  });

  it('index trigram tồn tại và câu tìm của service dùng được nó (BitmapOr tên + tag), không quét tuần tự', async () => {
    const [idx] = await prisma.$queryRaw<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes WHERE tablename = 'products' AND indexname = 'products_nameSearch_trgm_idx'`;
    expect(idx?.def).toMatch(/USING gin \("nameSearch" gin_trgm_ops\)/);

    // DB test nhỏ (~100 SP) → planner chọn Seq Scan hoặc index approvalStatus vì rẻ hơn. Để chứng minh
    // câu lệnh THẬT của service "đi được" index tìm kiếm: tắt seqscan và tạm bỏ 2 index lọc trạng thái
    // trong một transaction rồi ROLLBACK (ném lỗi mang plan ra ngoài) — schema không đổi sau test.
    class Rollback extends Error {
      constructor(readonly plan: string) {
        super('rollback');
      }
    }
    const text = await prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
        await tx.$executeRaw`DROP INDEX "products_approvalStatus_idx"`;
        await tx.$executeRaw`DROP INDEX "products_isActive_isFeatured_idx"`;
        const rows = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${textMatchSql('nước rửa chén')}`);
        throw new Rollback(rows.map((r) => r['QUERY PLAN']).join('\n'));
      })
      .then(
        () => '',
        (err: unknown) => {
          if (err instanceof Rollback) return err.plan;
          throw err;
        },
      );
    expect(text).toMatch(/BitmapOr/);
    expect(text).toContain('products_nameSearch_trgm_idx');
    expect(text).toContain('products_tags_gin');
    expect(text).not.toMatch(/Seq Scan on products/);
    const [still] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_indexes
      WHERE tablename = 'products' AND indexname IN ('products_approvalStatus_idx', 'products_isActive_isFeatured_idx')`;
    expect(Number(still!.n)).toBe(2);
  });

  it('tìm qua service khớp theo cột mới (không dấu / HOA / tag) và không lùi về contains', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      const tag = randCode(6).toLowerCase();
      const p = await createProduct(`Kem Chống Nắng Rau Má ${tag}`, [`tag${tag}`]);
      const ids = async (q: string) => (await catalog.list({ page: 1, limit: 50, brand: p.brand, q })).data.map((c) => c.id);
      expect(await ids('kem chong nang')).toEqual([p.id]);
      expect(await ids('RAU MÁ')).toEqual([p.id]);
      expect(await ids(`TAG${tag.toUpperCase()}`)).toEqual([p.id]);
      expect(await ids('rau ma xyz')).toEqual([]);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('Tìm không dấu lỗi'))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  // R5-BUYER-5: tên thương hiệu có dấu chấm ("BH.Nong") mà khách gõ tự nhiên "bh nong" thì trước đây không ra gì.
  it('khoảng trắng của từ khoá khớp cả dấu chấm/gạch trong tên: "bh nong" ra "BH.Nong", tìm và gợi ý đều vậy', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      const tag = randCode(6).toLowerCase();
      const p = await createProduct(`Mật ong rừng BH.Nong ${tag}`);
      const ids = async (q: string) => (await catalog.list({ page: 1, limit: 50, brand: p.brand, q })).data.map((c) => c.id);
      expect(await ids('bh.nong')).toEqual([p.id]);
      expect(await ids('BH.Nong')).toEqual([p.id]);
      expect(await ids('bh nong')).toEqual([p.id]);
      expect(await ids('mat ong rung bh nong')).toEqual([p.id]);
      expect(await ids('bh xnong')).toEqual([]);
      expect(await ids('bhnong')).toEqual([]);
      expect((await catalog.suggest(`bh nong ${tag}`)).map((s) => s.slug)).toEqual([p.slug]);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('Tìm không dấu lỗi'))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('khoảng trắng của từ khoá không thành ký tự đại diện rộng hơn một ký tự: "bh  nong" (nhiều dấu cách) vẫn chỉ ra SP đúng', async () => {
    const tag = randCode(6).toLowerCase();
    const p = await createProduct(`Gạo lứt BH.Nong ${tag}`);
    const other = await createProduct(`Gạo lứt BH..Nong ${tag}`);
    const ids = async (q: string) => (await catalog.list({ page: 1, limit: 50, q: `${q} ${tag}` })).data.map((c) => c.id).sort();
    expect(await ids('bh   nong')).toEqual([p.id]);
    expect(await ids('bh nong')).not.toContain(other.id);
  });

  it('suggest: từ khoá dưới 2 ký tự (sau gấp) → [] không chạm DB', async () => {
    const spy = jest.spyOn(prisma, '$queryRaw');
    try {
      await expect(catalog.suggest('a')).resolves.toEqual([]);
      await expect(catalog.suggest(' Ư ')).resolves.toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
