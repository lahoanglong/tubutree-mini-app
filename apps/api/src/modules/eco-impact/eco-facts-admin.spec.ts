import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { EcoFactsAdminService } from './eco-facts-admin.service';
import { EcoFactsReader } from './eco-facts.reader';
import { EcoFactBodyDto, parseEcoFactInput } from './eco-facts.input';
import { createValidationPipe } from '../../common/validation-pipe';

const T0 = new Date('2026-11-18T01:00:00Z');

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  productId: 'p1',
  variationId: null,
  kind: 'PLASTIC_AVOIDED',
  valueGrams: 1200,
  baselineText: 'so với 20 chai 500ml',
  label: null,
  co2Grams: null,
  sourceUrl: 'https://pannature.org/a',
  sourceNote: 'Bảng 2',
  status: 'DRAFT',
  approvedById: null,
  approvedAt: null,
  updatedAt: T0,
  product: { name: 'Nước giặt', slug: 'nuoc-giat' },
  variation: null,
  ...over,
});

function makePrisma(row: Record<string, unknown> | null = dbRow()) {
  return {
    productEcoFact: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(row),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(dbRow(data))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }) },
    variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', productId: 'p1' }) },
  };
}
const svcOf = (prisma: ReturnType<typeof makePrisma>) => new EcoFactsAdminService(prisma as unknown as PrismaService);

describe('EcoFactsAdminService', () => {
  it('thêm luôn là nháp, kèm lý do chưa duyệt được', async () => {
    const prisma = makePrisma();
    const out = await svcOf(prisma).create({ productSlug: 'nuoc-giat', kind: 'REFILL_PACK', sourceUrl: 'http://x.org' });
    expect(prisma.productEcoFact.create.mock.calls[0][0].data).toMatchObject({ productId: 'p1', variationId: null, kind: 'REFILL_PACK', status: 'DRAFT' });
    expect(out.blockers.map((b) => b.code)).toEqual(['source_url', 'source_note']);
    expect(out.blockers[0]!.message).toBe('Thiếu link nguồn https.');
  });

  it('SKU không thuộc sản phẩm thì báo lỗi, không tạo', async () => {
    const prisma = makePrisma();
    prisma.variation.findUnique.mockResolvedValue({ id: 'v9', productId: 'p-other' });
    await expect(svcOf(prisma).create({ productSlug: 'nuoc-giat', variationSku: 'SKU9', kind: 'REFILL_PACK' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.productEcoFact.create).not.toHaveBeenCalled();
  });

  it('duyệt: đúng bản đang xem, ghi có điều kiện updatedAt, ghi người duyệt', async () => {
    const prisma = makePrisma();
    await svcOf(prisma).approve('f1', 'admin1', { expectedUpdatedAt: T0.toISOString() });
    expect(prisma.productEcoFact.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', updatedAt: T0, status: { not: 'APPROVED' } },
      data: { status: 'APPROVED', approvedById: 'admin1', approvedAt: expect.any(Date) },
    });
  });

  it('duyệt bị chặn khi thiếu điều kiện, khi bản đã đổi, hay khi có người ghi chen giữa', async () => {
    const blocked = makePrisma(dbRow({ valueGrams: null, sourceNote: '' }));
    await expect(svcOf(blocked).approve('f1', 'a', { expectedUpdatedAt: T0.toISOString() })).rejects.toBeInstanceOf(BadRequestException);
    expect(blocked.productEcoFact.updateMany).not.toHaveBeenCalled();

    const stale = makePrisma();
    await expect(svcOf(stale).approve('f1', 'a', { expectedUpdatedAt: '2026-11-17T00:00:00.000Z' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svcOf(stale).approve('f1', 'a', {})).rejects.toBeInstanceOf(ConflictException);

    const raced = makePrisma();
    raced.productEcoFact.updateMany.mockResolvedValue({ count: 0 });
    await expect(svcOf(raced).approve('f1', 'a', { expectedUpdatedAt: T0.toISOString() })).rejects.toBeInstanceOf(ConflictException);
  });

  it('sửa nội dung dòng đã duyệt đưa về nháp; sản phẩm, phân loại, loại không đổi được; khoá không gửi giữ giá trị cũ', async () => {
    const prisma = makePrisma(dbRow({ status: 'APPROVED', approvedById: 'a', approvedAt: T0 }));
    await svcOf(prisma).update('f1', { valueGrams: 900, kind: 'REFILL_PACK', productSlug: 'khac', expectedUpdatedAt: T0.toISOString() });
    const call = prisma.productEcoFact.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'f1', updatedAt: T0 });
    expect(call.data).toEqual({
      valueGrams: 900,
      baselineText: 'so với 20 chai 500ml',
      label: null,
      co2Grams: null,
      sourceUrl: 'https://pannature.org/a',
      sourceNote: 'Bảng 2',
      status: 'DRAFT',
      approvedById: null,
      approvedAt: null,
    });
    expect(call.data).not.toHaveProperty('kind');
    expect(call.data).not.toHaveProperty('productId');
  });

  it('sửa không đổi gì thì không ghi (dòng đã duyệt giữ nguyên)', async () => {
    const prisma = makePrisma(dbRow({ status: 'APPROVED' }));
    await svcOf(prisma).update('f1', { valueGrams: 1200 });
    expect(prisma.productEcoFact.updateMany).not.toHaveBeenCalled();
  });

  it('ngừng dùng: chỉ đổi trạng thái, gọi lại không lỗi', async () => {
    const prisma = makePrisma(dbRow({ status: 'APPROVED' }));
    await svcOf(prisma).retire('f1');
    expect(prisma.productEcoFact.updateMany).toHaveBeenCalledWith({ where: { id: 'f1', status: { not: 'RETIRED' } }, data: { status: 'RETIRED' } });
  });

  it('nhập CSV: dòng mới tạo nháp, dòng đã duyệt bỏ qua, lỗi từng dòng không chặn dòng khác', async () => {
    const prisma = makePrisma();
    prisma.productEcoFact.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'f2', status: 'APPROVED' })
      .mockResolvedValueOnce({ id: 'f3', status: 'RETIRED' });
    const csv = [
      'productSlug,variationSku,kind,valueGrams,sourceUrl,sourceNote',
      'nuoc-giat,,REFILL_PACK,,https://x.org/a,Bảng 1',
      'nuoc-giat,,PLASTIC_AVOIDED,500,https://x.org/a,Bảng 1',
      'nuoc-giat,,CERTIFICATION,,https://x.org/a,Bảng 1',
      'nuoc-giat,,BAMBOO,,,',
    ].join('\n');
    const out = await svcOf(prisma).importCsv({ csv });
    expect(out).toEqual({ created: 1, updated: 1, skippedApproved: 1, errors: [{ line: 5, message: 'Loại sự thật không có trong danh sách.' }] });
    expect(prisma.productEcoFact.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'f3', status: { not: 'APPROVED' } }, data: { status: 'DRAFT', approvedById: null, approvedAt: null } });
  });
});

function makeReader(on: boolean, rows: unknown[] = []) {
  const prisma = { productEcoFact: { findMany: jest.fn().mockResolvedValue(rows) } };
  const config = { get: jest.fn().mockResolvedValue(on) };
  return { prisma, config, reader: new EcoFactsReader(prisma as unknown as PrismaService, config as unknown as SystemConfigService) };
}

const fact = (over: Record<string, unknown>) => ({ productId: 'p1', kind: 'REFILL_PACK', variationId: null, valueGrams: null, baselineText: null, label: null, co2Grams: null, sourceUrl: 'https://x.org/a', ...over });

describe('EcoFactsReader', () => {
  it('cờ eco.product_badges_enabled tắt: thẻ, trang sản phẩm, bảng so sánh không có gì và không chạm bảng', async () => {
    const { prisma, config, reader } = makeReader(false, [fact({})]);
    expect((await reader.cardFactsFor([{ id: 'p1' }])).size).toBe(0);
    expect(await reader.productFacts('p1')).toBeNull();
    expect(await reader.factCounts([{ productId: 'p1', variationId: null }])).toBeNull();
    expect(prisma.productEcoFact.findMany).not.toHaveBeenCalled();
    expect(config.get).toHaveBeenCalledWith('eco.product_badges_enabled', false);
  });

  it('cờ chỉ bật khi giá trị đúng là true', async () => {
    const { reader } = makeReader('true' as unknown as boolean);
    expect(await reader.badgesOn()).toBe(false);
  });

  it('bật: chỉ đọc dòng đã duyệt; thẻ theo phân loại đại diện; sản phẩm không có sự thật không có khoá', async () => {
    const { prisma, reader } = makeReader(true, [fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 300, variationId: 'v2' }), fact({ kind: 'INGREDIENT_ORIGIN', label: 'Đà Lạt' })]);
    const cards = await reader.cardFactsFor([
      { id: 'p1', repVariationId: 'v2' },
      { id: 'p2', repVariationId: null },
    ]);
    expect(prisma.productEcoFact.findMany.mock.calls[0][0].where).toEqual({ status: 'APPROVED', productId: { in: ['p1', 'p2'] } });
    expect(cards.get('p1')).toEqual([{ kind: 'PLASTIC_AVOIDED', valueGrams: 300, label: null }]);
    expect(cards.has('p2')).toBe(false);
  });

  it('bảng so sánh: đếm loại của cả sản phẩm cộng phân loại so sánh', async () => {
    const { reader } = makeReader(true, [fact({}), fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 1, variationId: 'v2' }), fact({ kind: 'CERTIFICATION', label: 'x', variationId: 'v3' })]);
    const counts = await reader.factCounts([{ productId: 'p1', variationId: 'v2' }]);
    expect(counts?.get('p1')).toBe(2);
  });

  it('trang sản phẩm không lộ ghi chú nguồn hay người duyệt', async () => {
    const { reader } = makeReader(true, [fact({ sourceNote: 'nội bộ', approvedById: 'a1' })]);
    const out = await reader.productFacts('p1');
    expect(out?.[0]).not.toHaveProperty('sourceNote');
    expect(out?.[0]).not.toHaveProperty('approvedById');
    expect(out?.[0]).not.toHaveProperty('productId');
  });
});

describe('thân POST/PATCH /admin/eco-facts qua ValidationPipe toàn cục', () => {
  const pipe = createValidationPipe();
  const meta = { type: 'body' as const, metatype: EcoFactBodyDto, data: undefined };
  const form = {
    productSlug: 'nuoc-giat-refill',
    variationSku: null,
    kind: 'PLASTIC_AVOIDED',
    valueGrams: 1200,
    baselineText: 'so với 20 chai 500ml',
    label: null,
    co2Grams: null,
    sourceUrl: 'https://pannature.org/a',
    sourceNote: 'Bảng 2',
    expectedUpdatedAt: '2026-11-18T01:00:00.000Z',
  };

  it('đúng khoá admin gửi: giữ nguyên mọi trường (kể cả null), bộ đọc tay đọc được', async () => {
    const out = (await pipe.transform(form, meta)) as Record<string, unknown>;
    expect({ ...out }).toEqual(form);
    expect(parseEcoFactInput(out)).toMatchObject({ ok: true, value: { productSlug: 'nuoc-giat-refill', valueGrams: 1200, label: null } });
  });

  it('khoá lạ: 400 tiếng Việt, không tới dịch vụ', async () => {
    await expect(pipe.transform({ ...form, status: 'APPROVED' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
