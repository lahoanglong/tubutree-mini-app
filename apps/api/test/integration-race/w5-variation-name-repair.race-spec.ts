import { PrismaService } from '../../src/prisma/prisma.service';
import { randCode, warmPool } from './helpers';
import { readApiSql } from './sql-script';

/** Chạy CHÍNH file migration 20261105230000 trên Postgres thật: dòng tên "[object Object]" được dựng lại, mọi dòng khác đứng yên. */
describe('migration 20261105230000 sửa tên biến thể "[object Object]" (real Postgres)', () => {
  const SQL = readApiSql('prisma/migrations/20261105230000_w5_variation_name_repair/migration.sql');
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seed() {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `w5vn-p-${tag}`, brand: `W5${tag}`, slug: `w5vn-${tag.toLowerCase()}`, name: `Nước rửa chén ${tag}`, description: 'IT', basePrice: 50_000 },
    });
    const mk = (key: string, name: string, attributes: unknown) =>
      prisma.variation.create({
        data: { pancakeId: `w5vn-v-${tag}-${key}`, productId: p.id, sku: `W5VN-${tag}-${key}`, name, attributes: attributes as never, retailPrice: 50_000, salePrice: 45_000, stock: 7, weight: 300 },
      });
    const broken = {
      one: await mk('one', '[object Object]', [{ id: 'ecbe456a-1111-4222-8333-444455556666', name: 'PHÂN LOẠI', value: '1 chai', keyValue: '1 CHAI' }]),
      two: await mk('two', '[object Object] - [object Object]', [
        { id: 'a', name: 'MÀU', value: 'Đỏ', keyValue: 'ĐỎ' },
        { id: 'b', name: 'SIZE', value: 'L', keyValue: 'L' },
        { id: 'c', name: 'CHẤT LIỆU', value: 'Tre', keyValue: 'TRE' },
      ]),
      mixed: await mk('mixed', '[object Object]', [null, { name: 'A', value: '  ' }, { name: 'B', value: 6 }, 'cuối', { name: 'C', value: '[object Object]' }, { value: { x: 1 } }]),
      objectShape: await mk('obj', '[object Object]', { size: '100ml' }),
      empty: await mk('empty', '[object Object]', []),
      scalar: await mk('scalar', '[object Object]', 'không phải mảng'),
      embedded: await mk('emb', 'Chai [object Object]', [{ name: 'X', value: '500ml' }]),
    };
    const untouched = {
      good: await mk('good', '500ml', [{ id: 'z', name: 'PHÂN LOẠI', value: '500ml', keyValue: '500ML' }]),
      adminEdited: await mk('adm', 'Chai 500ml (admin đặt)', [{ name: 'PHÂN LOẠI', value: '1 chai' }]),
      seedShape: await mk('seed', '100ml', { size: '100ml' }),
      mac: await mk('mac', 'Mặc định', {}),
    };
    return { p, broken, untouched };
  }

  const read = (ids: string[]) => prisma.variation.findMany({ where: { id: { in: ids } }, orderBy: { sku: 'asc' } });

  it('dựng lại tên từ attributes mảng theo thứ tự Pancake, rơi về tên sản phẩm khi không dựng được, chỉ đổi dòng sai', async () => {
    const { p, broken, untouched } = await seed();
    const brokenIds = Object.values(broken).map((v) => v.id);
    const untouchedIds = Object.values(untouched).map((v) => v.id);
    const beforeUntouched = await read(untouchedIds);
    const beforeBroken = await read(brokenIds);

    const changed = await prisma.$executeRawUnsafe(SQL);
    expect(changed).toBe(brokenIds.length);

    const name = async (v: { id: string }) => (await prisma.variation.findUniqueOrThrow({ where: { id: v.id } })).name;
    expect(await name(broken.one)).toBe('1 chai');
    expect(await name(broken.two)).toBe('Đỏ - L - Tre');
    expect(await name(broken.mixed)).toBe('6 - cuối');
    expect(await name(broken.objectShape)).toBe(p.name);
    expect(await name(broken.empty)).toBe(p.name);
    expect(await name(broken.scalar)).toBe(p.name);
    expect(await name(broken.embedded)).toBe('500ml');

    expect(await read(untouchedIds)).toEqual(beforeUntouched);
    const afterBroken = await read(brokenIds);
    expect(afterBroken.every((v) => !v.name.includes('[object Object]'))).toBe(true);
    // Chỉ cột name đổi: giá, tồn, attributes, mã đều nguyên.
    expect(afterBroken.map(({ name: _n, ...rest }) => rest)).toEqual(beforeBroken.map(({ name: _n, ...rest }) => rest));
  });

  it('chạy lại lần hai không đổi gì', async () => {
    const { broken, untouched } = await seed();
    const ids = [...Object.values(broken), ...Object.values(untouched)].map((v) => v.id);
    await prisma.$executeRawUnsafe(SQL);
    const afterFirst = await read(ids);

    expect(await prisma.$executeRawUnsafe(SQL)).toBe(0);
    expect(await read(ids)).toEqual(afterFirst);
  });
});
