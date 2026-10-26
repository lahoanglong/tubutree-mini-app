import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ProductAdminController, UpdateProductDto } from './product-admin.controller';
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

function setup(current: ReturnType<typeof row> | null = row(), categories = 1) {
  const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }));
  const prisma = {
    product: { findUnique: jest.fn().mockResolvedValue(current), update },
    category: { count: jest.fn().mockResolvedValue(categories) },
  };
  return { svc: new ProductAdminService(prisma as never), update, prisma };
}

describe('ProductAdminService — sửa sản phẩm', () => {
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
    await svc.update('a1', 'p1', { images: [] });
    expect(update.mock.calls[1][0].data).toEqual({ images: [], thumbnail: null });
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
    expect(prisma.category.count).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } } });
    expect(update.mock.calls[0][0].data).toEqual({ description: 'Mô tả mới', shortDesc: null, isFeatured: true, categoryIds: ['c1'] });
  });

  it('danh mục không tồn tại → 400, không ghi', async () => {
    const { svc, update } = setup(row(), 0);
    await expect(svc.update('a1', 'p1', { categoryIds: ['ghost'] })).rejects.toBeInstanceOf(BadRequestException);
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
