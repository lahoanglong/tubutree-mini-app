import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { CATEGORY_MSG } from './category-tree';
import { ProductAdminController, UpdateProductDto } from './product-admin.controller';
import { createValidationPipe } from '../../common/validation-pipe';
import { ProductAdminService } from './product-admin.service';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Tinh dầu sả',
  slug: 'tinh-dau-sa',
  brand: 'Tubu Tree',
  pancakeId: 'pc-1',
  storefrontId: null,
  approvalStatus: 'APPROVED',
  pancakeHold: null,
  isActive: true,
  isFeatured: false,
  description: 'Mô tả cũ',
  shortDesc: null,
  images: [],
  thumbnail: null,
  categoryIds: [],
  basePrice: 120000,
  salePrice: null,
  ...over,
});

function setup(current: ReturnType<typeof row> | null = row(), alive: string[] | 'all' = 'all', sellableVariations = 1, parents: { name: string }[] = []) {
  const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }));
  const prisma = {
    product: { findUnique: jest.fn().mockResolvedValue(current), update },
    category: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] }; children?: unknown } }) =>
        Promise.resolve(where.children ? parents : where.id.in.filter((i) => alive === 'all' || alive.includes(i)).map((id) => ({ id }))),
      ),
    },
    variation: { count: jest.fn().mockResolvedValue(sellableVariations) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const imageResize = { invalidateRegistry: jest.fn() };
  return { svc: new ProductAdminService(prisma as never, imageResize as never), update, prisma, imageResize };
}

describe('ProductAdminService — sửa sản phẩm', () => {
  it('lưu ảnh thì báo làm mới danh sách URL ảnh; sửa trường khác thì không', async () => {
    const { svc, imageResize } = setup();
    await svc.update('a1', 'p1', { isFeatured: true });
    expect(imageResize.invalidateRegistry).not.toHaveBeenCalled();
    await svc.update('a1', 'p1', { images: ['https://cdn.example.com/a.jpg'] });
    expect(imageResize.invalidateRegistry).toHaveBeenCalledTimes(1);
  });


  it('chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ProductAdminController)).toEqual(['ADMIN']);
  });

  it('xem: nói rõ hàng Pancake và lý do chưa bật bán lại được', async () => {
    const { svc } = setup(row({ pancakeHold: 'REMOVED', isActive: false }));
    expect(await svc.get('p1')).toMatchObject({ managedByPancake: true, partnerOwned: false, cannotShowReason: expect.stringContaining('Pancake') });
    const seed = setup(row({ pancakeId: 'seed-1' }));
    expect(await seed.svc.get('p1')).toMatchObject({ managedByPancake: false, cannotShowReason: null });
    await expect(setup(null).svc.get('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đặt ảnh: ảnh đầu thành ảnh đại diện, xoá hết ảnh thì ảnh đại diện về trống', async () => {
    const { svc, update } = setup();
    await svc.update('a1', 'p1', { images: ['https://cdn.example.com/a.jpg', PNG] });
    expect(update.mock.calls[0][0].data).toEqual({ images: ['https://cdn.example.com/a.jpg', PNG], thumbnail: 'https://cdn.example.com/a.jpg' });
    await svc.update('a1', 'p1', { images: [PNG] });
    const stored = update.mock.calls[1][0].data as { images: string[]; thumbnail: string };
    expect(stored.images).toEqual([PNG]);
    expect(stored.thumbnail).toMatch(/^\/public-image\/product\/p1\/0\?v=[0-9a-f]{16}$/);
    expect(stored.thumbnail).not.toContain('data:');
    await svc.update('a1', 'p1', { images: [] });
    expect(update.mock.calls[2][0].data).toEqual({ images: [], thumbnail: null });
  });

  it.each([
    ['http thường', ['http://x/a.jpg']],
    ['SVG', ['data:image/svg+xml;base64,PHN2Zz4=']],
    ['javascript', ['javascript:alert(1)']],
    ['dòng rỗng', ['   ']],
    ['quá 8 ảnh', Array.from({ length: 9 }, (_, i) => `https://x/${i}.jpg`)],
  ])('từ chối ảnh: %s', async (_l, images) => {
    const { svc, update } = setup();
    await expect(svc.update('a1', 'p1', { images })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('mô tả, mô tả ngắn, nổi bật và danh mục: cắt khoảng trắng, bỏ trùng, kiểm danh mục tồn tại', async () => {
    const { svc, update, prisma } = setup();
    await svc.update('a1', 'p1', { description: '  Mô tả mới  ', shortDesc: '   ', isFeatured: true, categoryIds: ['c1', 'c1'] });
    expect(prisma.category.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['c1'] } });
    expect(update.mock.calls[0][0].data).toEqual({ description: 'Mô tả mới', shortDesc: null, isFeatured: true, categoryIds: ['c1'] });
  });

  it('mô tả 5400 ký tự và mô tả ngắn 350 ký tự (Pancake ghi không cắt) lưu được: trần duy nhất là của DTO (6000 và 400)', async () => {
    const { svc, update } = setup();
    const description = 'a'.repeat(5400);
    const shortDesc = 'b'.repeat(350);
    await svc.update('a1', 'p1', { description, shortDesc });
    expect(update.mock.calls[0][0].data).toEqual({ description, shortDesc });
  });

  it('mọi trường chữ của UpdateProductDto lưu được ở đúng trần @MaxLength: service không giữ trần riêng thấp hơn DTO', async () => {
    const caps = (getMetadataStorage() as unknown as { getTargetValidationMetadatas: (t: unknown, s: unknown, a: boolean, b: boolean) => Array<{ propertyName: string; name?: string; each?: boolean; constraints?: number[] }> })
      .getTargetValidationMetadatas(UpdateProductDto, null, false, false)
      .filter((m) => m.name === 'maxLength' && !m.each)
      .map((m) => [m.propertyName, m.constraints![0]!] as const);
    expect(caps.map(([f]) => f)).toEqual(expect.arrayContaining(['description', 'shortDesc']));
    for (const [field, max] of caps) {
      const { svc, update } = setup();
      await svc.update('a1', 'p1', { [field]: 'a'.repeat(max) });
      expect(update.mock.calls[0][0].data).toEqual({ [field]: 'a'.repeat(max) });
    }
  });

  it('mô tả 6000 ký tự có khoảng trắng hai đầu qua pipe và được cắt khoảng trắng (đo sau trim như mô tả ngắn); 6001 ký tự thật vẫn bị chặn', async () => {
    const pipe = createValidationPipe();
    const run = (body: object) => pipe.transform(body, { type: 'body', metatype: UpdateProductDto, data: undefined }).then((v) => v as UpdateProductDto, (e: { response: { message: string[] } }) => e.response.message);
    const core = 'a'.repeat(6000);
    expect(await run({ description: `  ${core}\n ` })).toMatchObject({ description: core });
    expect(await run({ description: `  ${core}b ` })).toEqual(['Mô tả không được dài quá 6000 ký tự.']);
  });

  it('pipe chặn mô tả 6001 ký tự và mô tả ngắn 401 ký tự bằng câu tiếng Việt', async () => {
    const pipe = createValidationPipe();
    const run = (body: object) => pipe.transform(body, { type: 'body', metatype: UpdateProductDto, data: undefined }).then(() => null, (e: { response: { message: string[] } }) => e.response.message);
    expect(await run({ description: 'a'.repeat(6001) })).toEqual(['Mô tả không được dài quá 6000 ký tự.']);
    expect(await run({ shortDesc: 'b'.repeat(401) })).toEqual(['Mô tả ngắn không được dài quá 400 ký tự.']);
  });

  it('thêm danh mục có mục con vào sản phẩm → 400 nêu tên, không ghi; kiểm lá chỉ với id mới thêm', async () => {
    const { svc, update, prisma } = setup(row({ categoryIds: ['cu'] }), 'all', 1, [{ name: 'Gia dụng' }]);
    await expect(svc.update('a1', 'p1', { categoryIds: ['cu', 'cha'] })).rejects.toThrow(CATEGORY_MSG.notLeaf('Gia dụng'));
    expect(update).not.toHaveBeenCalled();
    // `cu` đã có sẵn trên sản phẩm nên không bị hỏi lại (dữ liệu gán vào cha từ trước vẫn giữ được khi sửa trường khác).
    expect(prisma.category.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['cha'] }, children: { some: {} } });
  });

  it('giữ nguyên danh mục cũ (kể cả cha có con) khi sửa: không kiểm lá, không lỗi', async () => {
    const { svc, update, prisma } = setup(row({ categoryIds: ['cha'] }), 'all', 1, [{ name: 'Gia dụng' }]);
    await svc.update('a1', 'p1', { categoryIds: ['cha'] });
    expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalled();
  });

  it('danh mục không tồn tại → 400, không ghi', async () => {
    const { svc, update } = setup(row(), []);
    await expect(svc.update('a1', 'p1', { categoryIds: ['ghost'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('ghi danh mục trong transaction giữ khoá cây, rồi mới kiểm và ghi', async () => {
    const order: string[] = [];
    const { svc, prisma } = setup();
    prisma.$executeRaw.mockImplementation((async () => void order.push('lock')) as never);
    prisma.category.findMany.mockImplementation((async ({ where }: { where: { children?: unknown } }) => (where.children ? [] : (order.push('check'), [{ id: 'c1' }]))) as never);
    prisma.product.update.mockImplementation((async ({ data }: { data: object }) => (order.push('write'), { ...row(), ...data })) as never);
    await svc.update('a1', 'p1', { categoryIds: ['c1'] });
    expect(order).toEqual(['lock', 'check', 'write']);
  });

  it('danh mục ma đã nằm trên sản phẩm (bị xoá từ trước) được bỏ khi lưu, không chặn mãi mãi', async () => {
    const { svc, update } = setup(row({ categoryIds: ['ghost', 'c1'] }), ['c1', 'c2']);
    await svc.update('a1', 'p1', { categoryIds: ['ghost', 'c1', 'c2'] });
    expect(update.mock.calls[0][0].data.categoryIds).toEqual(['c1', 'c2']);
  });

  it('danh mục ma mới thêm vào vẫn bị chặn', async () => {
    const { svc, update } = setup(row({ categoryIds: ['c1'] }), ['c1']);
    await expect(svc.update('a1', 'p1', { categoryIds: ['c1', 'ghost'] })).rejects.toThrow(/không còn tồn tại/);
    expect(update).not.toHaveBeenCalled();
  });

  it('trần 10 danh mục chỉ chặn khi số danh mục tăng; đang quá trần (do gán hàng loạt cũ) mà bỏ bớt thì lưu được', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `c${i}`);
    const down = setup(row({ categoryIds: eleven }));
    await down.svc.update('a1', 'p1', { categoryIds: eleven.slice(0, 10) });
    expect(down.update.mock.calls[0][0].data.categoryIds).toHaveLength(10);
    const stillOver = setup(row({ categoryIds: eleven }));
    await stillOver.svc.update('a1', 'p1', { categoryIds: eleven.slice(0, 11) });
    expect(stillOver.update).toHaveBeenCalled();
    const ten = eleven.slice(0, 10);
    const up = setup(row({ categoryIds: ten }));
    await expect(up.svc.update('a1', 'p1', { categoryIds: [...ten, 'c10'] })).rejects.toThrow(/Tối đa 10 danh mục/);
    expect(up.update).not.toHaveBeenCalled();
  });

  it('trần 10 tính trên danh mục còn sống đã có, không tính danh mục ma: 10 sống + 3 ma, thêm 2 mới thì bị chặn', async () => {
    const live = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const stored = [...live, 'g1', 'g2', 'g3'];
    const { svc, update } = setup(row({ categoryIds: stored }), [...live, 'n1', 'n2']);
    await expect(svc.update('a1', 'p1', { categoryIds: [...stored, 'n1', 'n2'] })).rejects.toThrow(/Tối đa 10 danh mục/);
    expect(update).not.toHaveBeenCalled();
  });

  it('ẩn sản phẩm luôn được; bật lại bị chặn khi Pancake đang giữ hoặc chưa duyệt', async () => {
    const held = setup(row({ isActive: false, pancakeHold: 'NO_PRICE' }));
    await expect(held.svc.update('a1', 'p1', { isActive: true })).rejects.toBeInstanceOf(ConflictException);
    const pending = setup(row({ isActive: false, approvalStatus: 'PENDING' }));
    await expect(pending.svc.update('a1', 'p1', { isActive: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(held.update).not.toHaveBeenCalled();
    const hide = setup(row({ pancakeHold: 'NO_PRICE' }));
    await hide.svc.update('a1', 'p1', { isActive: false });
    expect(hide.update.mock.calls[0][0].data).toEqual({ isActive: false });
    const show = setup(row({ isActive: false }));
    await show.svc.update('a1', 'p1', { isActive: true });
    expect(show.update.mock.calls[0][0].data).toEqual({ isActive: true });
  });

  it('sản phẩm của đối tác: không sửa ảnh/mô tả được, vẫn ẩn/hiện, nổi bật, danh mục', async () => {
    const { svc, update } = setup(row({ storefrontId: 'sf1', pancakeId: null }));
    await expect(svc.update('a1', 'p1', { description: 'x' })).rejects.toThrow('đối tác tự sửa');
    await expect(svc.update('a1', 'p1', { images: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    await svc.update('a1', 'p1', { isFeatured: true });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('hàng đối tác: bật hay tắt đều bị chặn ở đây (đi qua luồng gian hàng/duyệt), gửi lại đúng trạng thái hiện tại thì không sao', async () => {
    const off = setup(row({ storefrontId: 'sf1', pancakeId: null, isActive: false }));
    await expect(off.svc.update('a1', 'p1', { isActive: true })).rejects.toThrow('qua gian hàng');
    const on = setup(row({ storefrontId: 'sf1', pancakeId: null, isActive: true }));
    await expect(on.svc.update('a1', 'p1', { isActive: false })).rejects.toThrow('qua gian hàng');
    expect(on.update).not.toHaveBeenCalled();
    await on.svc.update('a1', 'p1', { isActive: true, isFeatured: true });
    expect(on.update.mock.calls[0][0].data).toEqual({ isFeatured: true });
  });

  it('bật sản phẩm không còn biến thể nào đang bán (ví dụ đã chuyển hết sang đối tác) → 400, không ghi', async () => {
    const { svc, update, prisma } = setup(row({ isActive: false }), 'all', 0);
    await expect(svc.update('a1', 'p1', { isActive: true })).rejects.toThrow('không còn biến thể');
    expect(prisma.variation.count).toHaveBeenCalledWith({ where: { productId: 'p1', isActive: true } });
    expect(update).not.toHaveBeenCalled();
  });

  it('không có gì đổi thì không ghi; tên và giá không có đường nào để sửa', async () => {
    const { svc, update } = setup();
    await svc.update('a1', 'p1', {});
    expect(update).not.toHaveBeenCalled();
    const body = { name: 'Tên khác', basePrice: 1, salePrice: 1, pancakeId: 'x' };
    const dto = plainToInstance(UpdateProductDto, body);
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length).toBe(4);
  });

  it('báo ngay khi sản phẩm không tồn tại', async () => {
    await expect(setup(null).svc.update('a1', 'zz', { isFeatured: true })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdateProductDto', () => {
  const bad = (b: object) => validateSync(plainToInstance(UpdateProductDto, b), { whitelist: true, forbidNonWhitelisted: true }).length;
  it('nhận body hợp lệ và shortDesc null', () => {
    expect(bad({ images: ['https://x/a.jpg'], description: 'a', shortDesc: null, isActive: false, isFeatured: true, categoryIds: ['c'] })).toBe(0);
  });
  it.each([
    ['description không phải chuỗi', { description: 5 }],
    ['isActive không phải boolean', { isActive: 'yes' }],
    ['quá 8 ảnh', { images: Array.from({ length: 9 }, () => 'https://x/a.jpg') }],
    ['mô tả quá dài', { description: 'x'.repeat(6001) }],
    ['images null', { images: null }],
  ])('từ chối: %s', (_l, b) => expect(bad(b)).toBeGreaterThan(0));
});

describe('ProductAdminService — câu chuyện sản phẩm (storyConfig)', () => {
  const story = {
    version: 1,
    enabled: true,
    scenes: [{ kind: 'variant_arc', items: [{ label: '300ml', ambient: 'leaf' }] }],
  };

  it('lưu storyConfig hợp lệ, không đụng thumbnail', async () => {
    const { svc, update } = setup();
    await svc.update('a1', 'p1', { storyConfig: story });
    const data = update.mock.calls[0][0].data;
    expect(data.storyConfig).toEqual(story);
    expect(data).not.toHaveProperty('thumbnail');
  });

  it('null xoá storyConfig', async () => {
    const { svc, update } = setup(row({ storyConfig: story }));
    await svc.update('a1', 'p1', { storyConfig: null });
    expect(update.mock.calls[0][0].data.storyConfig).toBeDefined();
    expect(update.mock.calls[0][0].data.storyConfig).not.toEqual(story);
  });

  it('từ chối storyConfig sai bằng 400 và không ghi', async () => {
    const { svc, update } = setup();
    const bad = { ...story, scenes: [{ kind: 'ingredient_assembly', steps: [{ title: 't', body: 'b', layers: [{ id: 'l', imageUrl: 'javascript:alert(1)', label: 'x', from: 'top', xPct: 1, yPct: 1, scale: 1, rotateDeg: 0 }] }] }] };
    await expect(svc.update('a1', 'p1', { storyConfig: bad })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('hàng đối tác vẫn được admin gắn storyConfig (khác ảnh và mô tả)', async () => {
    const { svc, update } = setup(row({ storefrontId: 'sf1' }));
    await svc.update('a1', 'p1', { storyConfig: story });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('xem trả storyConfig, thiếu thì null', async () => {
    expect(await setup(row({ storyConfig: story })).svc.get('p1')).toMatchObject({ storyConfig: story });
    expect(await setup().svc.get('p1')).toMatchObject({ storyConfig: null });
  });

  it('DTO nhận object và null, từ chối chuỗi', () => {
    const bad = (b: object) => validateSync(plainToInstance(UpdateProductDto, b), { whitelist: true, forbidNonWhitelisted: true }).length;
    expect(bad({ storyConfig: story })).toBe(0);
    expect(bad({ storyConfig: null })).toBe(0);
    expect(bad({ storyConfig: 'x' })).toBeGreaterThan(0);
  });
});

describe('ProductAdminService — dữ liệu cho Story Studio', () => {
  it('xem trả thành phần, chứng nhận và biến thể (id, tên) để tự sinh kịch bản', async () => {
    const ingredients = [{ name: 'Bồ kết', benefit: 'Làm sạch dịu nhẹ' }];
    const { svc } = setup(row({ ingredients, certifications: ['Vegan'], variations: [{ id: 'v1', name: '300ml' }, { id: 'v2', name: '500ml' }] }));
    expect(await svc.get('p1')).toMatchObject({
      ingredients,
      certifications: ['Vegan'],
      variations: [{ id: 'v1', name: '300ml' }, { id: 'v2', name: '500ml' }],
    });
  });

  it('thiếu thì trả null, mảng rỗng, mảng rỗng', async () => {
    expect(await setup().svc.get('p1')).toMatchObject({ ingredients: null, certifications: [], variations: [] });
  });

  it('GET chỉ đọc biến thể đang bán, theo thứ tự ổn định', async () => {
    const { svc, prisma } = setup();
    await svc.get('p1');
    const select = (prisma.product.findUnique as jest.Mock).mock.calls[0][0].select;
    expect(select.variations).toMatchObject({ where: { isActive: true }, select: { id: true, name: true } });
  });
});
