import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { EcoFactsAdminService } from './eco-facts-admin.service';
import { approvalBlockers } from './eco-facts.rules';
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
      createMany: jest.fn().mockImplementation(({ data }) => Promise.resolve({ count: data.length })),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(dbRow(data))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }), findMany: jest.fn().mockResolvedValue([]) },
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

describe('EcoFactsAdminService.approveBatch', () => {
  const T1 = new Date('2026-11-18T02:00:00Z');
  const body = (...ids: [string, Date][]) => ({ items: ids.map(([id, at]) => ({ id, expectedUpdatedAt: at.toISOString() })) });

  it('duyệt đúng các dòng Nháp đủ điều kiện, ghi có điều kiện updatedAt + status DRAFT, cùng một mốc giờ', async () => {
    const prisma = makePrisma();
    prisma.productEcoFact.findMany.mockResolvedValue([dbRow({ id: 'a' }), dbRow({ id: 'b', kind: 'REFILL_PACK', valueGrams: null, updatedAt: T1 })]);
    const out = await svcOf(prisma).approveBatch('admin1', body(['a', T0], ['b', T1]));
    expect(out).toEqual({ approved: ['a', 'b'], skipped: [] });
    const calls = prisma.productEcoFact.updateMany.mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ where: { id: 'a', updatedAt: T0, status: 'DRAFT' }, data: { status: 'APPROVED', approvedById: 'admin1', approvedAt: expect.any(Date) } });
    expect(calls[1].where).toEqual({ id: 'b', updatedAt: T1, status: 'DRAFT' });
    expect(calls[0].data.approvedAt).toBe(calls[1].data.approvedAt);
  });

  it('dòng còn blocker (chưa cân, thiếu nguồn) KHÔNG bao giờ được duyệt; dòng khác trong lô vẫn duyệt', async () => {
    const prisma = makePrisma();
    prisma.productEcoFact.findMany.mockResolvedValue([
      dbRow({ id: 'ok' }),
      dbRow({ id: 'chua-can', valueGrams: null }),
      dbRow({ id: 'thieu-nguon', kind: 'REFILL_PACK', sourceUrl: '', sourceNote: '' }),
      dbRow({ id: 'chu-cam', baselineText: 'chữa bệnh hiệu quả' }),
    ]);
    const out = await svcOf(prisma).approveBatch('admin1', body(['ok', T0], ['chua-can', T0], ['thieu-nguon', T0], ['chu-cam', T0]));
    expect(out.approved).toEqual(['ok']);
    expect(out.skipped.map((s) => [s.id, s.reason])).toEqual([
      ['chua-can', 'blocked'],
      ['thieu-nguon', 'blocked'],
      ['chu-cam', 'blocked'],
    ]);
    expect(out.skipped[0]!.message).toBe('Giảm nhựa cần số gam lớn hơn 0.');
    expect(prisma.productEcoFact.updateMany).toHaveBeenCalledTimes(1);
  });

  it('chỉ duyệt dòng Nháp: đã duyệt hay ngừng dùng bị bỏ; không tìm thấy, bản cũ cũng bị bỏ kèm lý do', async () => {
    const prisma = makePrisma();
    prisma.productEcoFact.findMany.mockResolvedValue([dbRow({ id: 'done', status: 'APPROVED' }), dbRow({ id: 'off', status: 'RETIRED' }), dbRow({ id: 'stale' })]);
    const out = await svcOf(prisma).approveBatch('admin1', body(['done', T0], ['off', T0], ['stale', T1], ['ghost', T0]));
    expect(out.approved).toEqual([]);
    expect(out.skipped.map((s) => [s.id, s.reason])).toEqual([
      ['done', 'not_draft'],
      ['off', 'not_draft'],
      ['stale', 'conflict'],
      ['ghost', 'not_found'],
    ]);
    expect(prisma.productEcoFact.updateMany).not.toHaveBeenCalled();
  });

  it('có người ghi chen giữa (updateMany count 0) thì dòng đó bị bỏ, không tính là đã duyệt', async () => {
    const prisma = makePrisma();
    prisma.productEcoFact.findMany.mockResolvedValue([dbRow({ id: 'a' }), dbRow({ id: 'b' })]);
    prisma.productEcoFact.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const out = await svcOf(prisma).approveBatch('admin1', body(['a', T0], ['b', T0]));
    expect(out.approved).toEqual(['b']);
    expect(out.skipped).toEqual([{ id: 'a', reason: 'conflict', message: 'Dòng này vừa đổi. Tải lại, xem lại rồi duyệt.' }]);
  });

  it('thân sai: rỗng, quá 50 dòng, thiếu expectedUpdatedAt đều 400, không chạm bảng; id lặp chỉ tính một lần', async () => {
    const prisma = makePrisma();
    const svc = svcOf(prisma);
    await expect(svc.approveBatch('a', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.approveBatch('a', { items: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.approveBatch('a', { items: Array.from({ length: 51 }, (_, i) => ({ id: `x${i}`, expectedUpdatedAt: T0.toISOString() })) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.approveBatch('a', { items: [{ id: 'a' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.productEcoFact.findMany).not.toHaveBeenCalled();
    prisma.productEcoFact.findMany.mockResolvedValue([dbRow({ id: 'a' })]);
    const out = await svc.approveBatch('a', body(['a', T0], ['a', T0]));
    expect(out.approved).toEqual(['a']);
    expect(prisma.productEcoFact.updateMany).toHaveBeenCalledTimes(1);
  });

  it('không đọc hay ghi cấu hình hệ thống: cờ eco.product_badges_enabled giữ nguyên', async () => {
    const prisma = { ...makePrisma(), systemConfig: { upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() } };
    prisma.productEcoFact.findMany.mockResolvedValue([dbRow({ id: 'a' })]);
    await svcOf(prisma as unknown as ReturnType<typeof makePrisma>).approveBatch('admin1', body(['a', T0]));
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    expect(prisma.systemConfig.update).not.toHaveBeenCalled();
    expect(prisma.systemConfig.updateMany).not.toHaveBeenCalled();
  });
});

describe('EcoFactsAdminService.createRefillDrafts', () => {
  const product = (over: Record<string, unknown>) => ({ id: 'p1', slug: 'refill-nuoc-giat-fuwa3e-10l-aa', name: 'Refill nước giặt Fuwa3e 10L', isCombo: false, variations: [{ id: 'v1' }], ...over });

  it('mỗi gói Refill nhận Can refill + Giảm nhựa ở cấp sản phẩm; bỏ chai thường và combo; đều NHÁP, không số gam, không chữ', async () => {
    const prisma = makePrisma();
    prisma.product.findMany.mockResolvedValue([
      product({}),
      product({ id: 'p2', slug: 'nuoc-giat-fuwa3e-3-8l', name: 'Nước giặt Fuwa3e 3,8L' }),
      product({ id: 'p3', slug: 'combo-refill', name: 'Combo Refill 2 can', isCombo: true }),
      product({ id: 'p4', slug: 'x-yz', name: 'Refill Nước rửa chén Fuwa3e 10L' }),
    ]);
    const out = await svcOf(prisma).createRefillDrafts({});
    expect(out).toEqual({ refillProducts: 2, created: 4, skippedExisting: 0 });
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ isActive: true, approvalStatus: 'APPROVED' });
    const { data, skipDuplicates } = prisma.productEcoFact.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toEqual([
      { productId: 'p1', variationId: null, kind: 'REFILL_PACK', status: 'DRAFT', sourceUrl: '', sourceNote: '' },
      { productId: 'p1', variationId: null, kind: 'PLASTIC_AVOIDED', status: 'DRAFT', sourceUrl: '', sourceNote: '' },
      { productId: 'p4', variationId: null, kind: 'REFILL_PACK', status: 'DRAFT', sourceUrl: '', sourceNote: '' },
      { productId: 'p4', variationId: null, kind: 'PLASTIC_AVOIDED', status: 'DRAFT', sourceUrl: '', sourceNote: '' },
    ]);
    for (const d of data) {
      expect(d).not.toHaveProperty('valueGrams');
      expect(d).not.toHaveProperty('approvedAt');
    }
  });

  it('không dòng nào sinh ra duyệt được, kể cả khi đã gắn phiếu cân nội bộ: Giảm nhựa thiếu gam, Can refill thiếu nguồn riêng', async () => {
    const prisma = makePrisma();
    prisma.product.findMany.mockResolvedValue([product({})]);
    await svcOf(prisma).createRefillDrafts({ sheetUrl: 'https://tubutree.com/phieu-can/refill-10l', sourceNote: 'Phiếu cân dòng 3' });
    const { data } = prisma.productEcoFact.createMany.mock.calls[0][0];
    const plastic = data.find((d: { kind: string }) => d.kind === 'PLASTIC_AVOIDED');
    const pack = data.find((d: { kind: string }) => d.kind === 'REFILL_PACK');
    expect(plastic).toMatchObject({ sourceUrl: 'https://tubutree.com/phieu-can/refill-10l', sourceNote: 'Phiếu cân dòng 3' });
    expect(approvalBlockers(plastic)).toEqual(['value_grams']);
    expect(pack).toMatchObject({ sourceUrl: '', sourceNote: '' });
    expect(approvalBlockers(pack)).toEqual(['source_url', 'source_note']);
    for (const d of data) expect(approvalBlockers(d)).not.toEqual([]);
  });

  it('gói có từ 2 phân loại đang bán: Giảm nhựa theo từng phân loại, Can refill vẫn một dòng cấp sản phẩm', async () => {
    const prisma = makePrisma();
    prisma.product.findMany.mockResolvedValue([product({ variations: [{ id: 'v5' }, { id: 'v10' }] })]);
    const out = await svcOf(prisma).createRefillDrafts({});
    expect(out.created).toBe(3);
    const { data } = prisma.productEcoFact.createMany.mock.calls[0][0];
    expect(data.map((d: { kind: string; variationId: string | null }) => [d.kind, d.variationId])).toEqual([
      ['REFILL_PACK', null],
      ['PLASTIC_AVOIDED', 'v5'],
      ['PLASTIC_AVOIDED', 'v10'],
    ]);
  });

  it('chạy lại không tạo trùng và không đụng dòng đã có (mọi trạng thái); dòng cấp sản phẩm che cả phân loại', async () => {
    const prisma = makePrisma();
    prisma.product.findMany.mockResolvedValue([product({}), product({ id: 'p2', slug: 'refill-b', name: 'Refill B 10L', variations: [{ id: 'v1' }, { id: 'v2' }] })]);
    prisma.productEcoFact.findMany.mockResolvedValue([
      { productId: 'p1', variationId: null, kind: 'REFILL_PACK' },
      { productId: 'p2', variationId: null, kind: 'PLASTIC_AVOIDED' },
      { productId: 'p2', variationId: 'v2', kind: 'REFILL_PACK' },
    ]);
    const out = await svcOf(prisma).createRefillDrafts({});
    expect(out).toEqual({ refillProducts: 2, created: 1, skippedExisting: 4 });
    expect(prisma.productEcoFact.createMany.mock.calls[0][0].data).toEqual([{ productId: 'p1', variationId: null, kind: 'PLASTIC_AVOIDED', status: 'DRAFT', sourceUrl: '', sourceNote: '' }]);
    expect(prisma.productEcoFact.updateMany).not.toHaveBeenCalled();
  });

  it('không có gói Refill hay mọi dòng đã có: không gọi createMany', async () => {
    const none = makePrisma();
    expect(await svcOf(none).createRefillDrafts(undefined)).toEqual({ refillProducts: 0, created: 0, skippedExisting: 0 });
    expect(none.productEcoFact.createMany).not.toHaveBeenCalled();
    const full = makePrisma();
    full.product.findMany.mockResolvedValue([product({})]);
    full.productEcoFact.findMany.mockResolvedValue([
      { productId: 'p1', variationId: null, kind: 'REFILL_PACK' },
      { productId: 'p1', variationId: null, kind: 'PLASTIC_AVOIDED' },
    ]);
    expect(await svcOf(full).createRefillDrafts({})).toEqual({ refillProducts: 1, created: 0, skippedExisting: 2 });
    expect(full.productEcoFact.createMany).not.toHaveBeenCalled();
  });

  it('link phiếu cân phải là trang tubutree.com; nguồn ngoài, http hay chữ lạ đều 400 và không tạo gì', async () => {
    for (const sheetUrl of ['https://pannature.org/a', 'http://tubutree.com/phieu-can', 'https://tubutree.com.evil.org/x', 42]) {
      const prisma = makePrisma();
      prisma.product.findMany.mockResolvedValue([product({})]);
      await expect(svcOf(prisma).createRefillDrafts({ sheetUrl })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.productEcoFact.createMany).not.toHaveBeenCalled();
    }
    const prisma = makePrisma();
    await expect(svcOf(prisma).createRefillDrafts({ sourceNote: 'x'.repeat(301) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('khoảng trắng link phiếu cân được cắt; dạng chuẩn hoá giống nhập tay', async () => {
    const prisma = makePrisma();
    prisma.product.findMany.mockResolvedValue([product({})]);
    await svcOf(prisma).createRefillDrafts({ sheetUrl: '  https://TubuTree.com/phieu-can/a  ' });
    const rows = prisma.productEcoFact.createMany.mock.calls[0][0].data as { kind: string; sourceUrl: string }[];
    expect(rows.find((d) => d.kind === 'PLASTIC_AVOIDED')!.sourceUrl).toBe('https://tubutree.com/phieu-can/a');
  });
});

describe('nguồn nội bộ trên thẻ admin', () => {
  it('view gắn sourceKind: phiếu cân nội bộ, nguồn ngoài, hoặc null khi chưa có link', async () => {
    const mk = async (sourceUrl: string) => {
      const prisma = makePrisma(dbRow({ sourceUrl }));
      return (await svcOf(prisma).create({ productSlug: 'nuoc-giat', kind: 'REFILL_PACK', sourceUrl: sourceUrl || undefined })).sourceKind;
    };
    expect(await mk('https://tubutree.com/phieu-can/a')).toBe('internal_sheet');
    expect(await mk('https://pannature.org/a')).toBe('external');
    expect(await mk('')).toBeNull();
  });
});
