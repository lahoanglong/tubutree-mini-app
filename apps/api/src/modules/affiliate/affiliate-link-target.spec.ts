import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  attachLinkTargets,
  LINK_CATEGORY_GONE,
  LINK_PRODUCT_GONE,
  LINK_PRODUCT_NO_COMMISSION,
  LINK_TARGET_ID_REQUIRED,
  resolveLinkTargetForCreate,
} from './affiliate-link-target';
import { CreateLinkDto } from './affiliate.controller';

const dbOf = (opts: { product?: unknown; category?: unknown; products?: unknown[]; categories?: unknown[] } = {}) => ({
  product: { findFirst: jest.fn().mockResolvedValue(opts.product ?? null), findMany: jest.fn().mockResolvedValue(opts.products ?? []) },
  category: { findUnique: jest.fn().mockResolvedValue(opts.category ?? null), findMany: jest.fn().mockResolvedValue(opts.categories ?? []) },
});
type Db = Parameters<typeof resolveLinkTargetForCreate>[0];

describe('resolveLinkTargetForCreate', () => {
  it.each(['HOMEPAGE', 'DEAL'])('%s: không cần đích, bỏ targetId client gửi kèm, không đọc DB', async (type) => {
    const db = dbOf();
    await expect(resolveLinkTargetForCreate(db as unknown as Db, type, 'x')).resolves.toEqual({ targetType: type, targetId: null });
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(db.category.findUnique).not.toHaveBeenCalled();
  });

  it.each(['PRODUCT', 'CATEGORY'])('%s thiếu targetId (hoặc toàn khoảng trắng) → 400', async (type) => {
    await expect(resolveLinkTargetForCreate(dbOf() as unknown as Db, type)).rejects.toThrow(new BadRequestException(LINK_TARGET_ID_REQUIRED));
    await expect(resolveLinkTargetForCreate(dbOf() as unknown as Db, type, '   ')).rejects.toThrow(LINK_TARGET_ID_REQUIRED);
  });

  it('PRODUCT: chỉ nhận sản phẩm đang hiện công khai (isActive + APPROVED)', async () => {
    const db = dbOf({ product: { id: 'p1', affiliateBlocked: false } });
    await expect(resolveLinkTargetForCreate(db as unknown as Db, 'PRODUCT', ' p1 ')).resolves.toEqual({ targetType: 'PRODUCT', targetId: 'p1' });
    expect(db.product.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', isActive: true, approvalStatus: 'APPROVED' }, select: { id: true, affiliateBlocked: true } });
  });

  it('PRODUCT không còn hiện → 404; bị chặn hoa hồng → 400', async () => {
    await expect(resolveLinkTargetForCreate(dbOf() as unknown as Db, 'PRODUCT', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(resolveLinkTargetForCreate(dbOf() as unknown as Db, 'PRODUCT', 'p1')).rejects.toThrow(LINK_PRODUCT_GONE);
    const blocked = dbOf({ product: { id: 'p1', affiliateBlocked: true } });
    await expect(resolveLinkTargetForCreate(blocked as unknown as Db, 'PRODUCT', 'p1')).rejects.toThrow(new BadRequestException(LINK_PRODUCT_NO_COMMISSION));
  });

  it('CATEGORY: có thì nhận, không có thì 404', async () => {
    const ok = dbOf({ category: { id: 'c1' } });
    await expect(resolveLinkTargetForCreate(ok as unknown as Db, 'CATEGORY', 'c1')).resolves.toEqual({ targetType: 'CATEGORY', targetId: 'c1' });
    await expect(resolveLinkTargetForCreate(dbOf() as unknown as Db, 'CATEGORY', 'c1')).rejects.toThrow(new NotFoundException(LINK_CATEGORY_GONE));
  });

  it('loại lạ (lọt qua DTO) → 400', async () => {
    await expect(resolveLinkTargetForCreate(dbOf() as unknown as Db, 'STORE', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('attachLinkTargets', () => {
  const link = (id: string, targetType: string, targetId: string | null) => ({ id, shortCode: `s${id}`, targetType, targetId, clicks: 1 });

  it('gom một truy vấn sản phẩm + một truy vấn danh mục cho cả trang, id trùng chỉ hỏi một lần', async () => {
    const db = dbOf({
      products: [
        { id: 'p1', slug: 'nuoc-rua-chen', name: 'Nước rửa chén', isActive: true, approvalStatus: 'APPROVED', affiliateBlocked: false },
        { id: 'p2', slug: 'tam-ngung', name: 'Tạm ngưng', isActive: false, approvalStatus: 'APPROVED', affiliateBlocked: false },
        { id: 'p3', slug: 'tat-hoa-hong', name: 'Tắt hoa hồng', isActive: true, approvalStatus: 'APPROVED', affiliateBlocked: true },
      ],
      categories: [{ id: 'c1', slug: 'nha-bep', name: 'Nhà bếp' }],
    });
    const rows = await attachLinkTargets(db as unknown as Db, [
      link('1', 'PRODUCT', 'p1'),
      link('2', 'PRODUCT', 'p1'),
      link('3', 'PRODUCT', 'p2'),
      link('4', 'PRODUCT', 'p9'),
      link('9', 'PRODUCT', 'p3'),
      link('5', 'CATEGORY', 'c1'),
      link('6', 'CATEGORY', 'c9'),
      link('7', 'HOMEPAGE', null),
      link('8', 'DEAL', null),
    ]);
    expect(db.product.findMany).toHaveBeenCalledTimes(1);
    expect(db.product.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['p1', 'p2', 'p9', 'p3'] } });
    expect(db.category.findMany).toHaveBeenCalledTimes(1);
    expect(db.category.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['c1', 'c9'] } });
    expect(rows.map((r) => [r.id, r.targetSlug, r.targetLabel, r.targetAvailable, r.targetCommissionBlocked])).toEqual([
      ['1', 'nuoc-rua-chen', 'Nước rửa chén', true, false],
      ['2', 'nuoc-rua-chen', 'Nước rửa chén', true, false],
      ['3', 'tam-ngung', 'Tạm ngưng', false, false],
      ['4', null, null, false, false],
      ['9', 'tat-hoa-hong', 'Tắt hoa hồng', true, true],
      ['5', 'nha-bep', 'Nhà bếp', true, false],
      ['6', null, null, false, false],
      ['7', null, null, true, false],
      ['8', null, null, true, false],
    ]);
    expect(rows[0]).toMatchObject({ shortCode: 's1', clicks: 1 });
  });

  it('trang chỉ có Trang chủ/Giờ vàng: không truy vấn DB', async () => {
    const db = dbOf();
    await attachLinkTargets(db as unknown as Db, [link('1', 'HOMEPAGE', null), link('2', 'DEAL', null)]);
    expect(db.product.findMany).not.toHaveBeenCalled();
    expect(db.category.findMany).not.toHaveBeenCalled();
  });
});

describe('CreateLinkDto', () => {
  const errorsOf = async (body: Record<string, unknown>) => (await validate(plainToInstance(CreateLinkDto, body))).map((e) => e.property);

  it('nhận đủ 4 loại đích; loại lạ bị chặn', async () => {
    for (const targetType of ['HOMEPAGE', 'PRODUCT', 'CATEGORY', 'DEAL']) expect(await errorsOf({ targetType, targetId: 'p1' })).toEqual([]);
    expect(await errorsOf({ targetType: 'STORE' })).toEqual(['targetType']);
  });

  it('targetId dài quá 64 ký tự bị chặn trước khi tới DB', async () => {
    expect(await errorsOf({ targetType: 'PRODUCT', targetId: 'x'.repeat(65) })).toEqual(['targetId']);
  });
});
