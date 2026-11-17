import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { EcoFactsReader } from '../../src/modules/eco-impact/eco-facts.reader';
import { EcoPassportService } from '../../src/modules/eco-impact/eco-passport.service';
import { createOrder, createUser, deleteItData, randCode } from './helpers';

/**
 * Hộ chiếu Xanh trên Postgres thật, 3 khách: chỉ đơn đã giao, chỉ sự thật ĐÃ DUYỆT, sự thật của phân loại chỉ áp cho phân loại đó, trừ món
 * đang/đã trả (yêu cầu bị từ chối thì không trừ), số của khách này không lẫn khách kia; cờ tắt thì 404. Cờ đọc qua SystemConfigService giả
 * để không đụng cache 60 giây của bản thật và không để lại khoá cấu hình trên DB dùng chung.
 */
describe('Hộ chiếu Xanh: cộng số theo khách (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let passport: EcoPassportService;
  let reader: EcoFactsReader;
  const flags: Record<string, unknown> = {};
  const userIds: string[] = [];
  const productIds: string[] = [];
  const ids = {} as { c1: string; c2: string; c3: string; v500: string; v10l: string; pA: string; pB: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        EcoFactsReader,
        EcoPassportService,
        { provide: SystemConfigService, useValue: { get: async (key: string, fallback: unknown) => (key in flags ? flags[key] : fallback) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    passport = moduleRef.get(EcoPassportService);
    reader = moduleRef.get(EcoFactsReader);

    const tag = randCode(6).toLowerCase();
    const pA = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `it-eco-a-${tag}`,
        name: 'Nước giặt IT',
        description: 'IT',
        basePrice: 100_000,
        variations: {
          create: [
            { sku: `ITECO-500-${tag}`, name: '500ml', attributes: {}, retailPrice: 100_000, stock: 50 },
            { sku: `ITECO-10L-${tag}`, name: 'Can 10L', attributes: {}, retailPrice: 900_000, stock: 50 },
          ],
        },
      },
      include: { variations: true },
    });
    const pB = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `it-eco-b-${tag}`,
        name: 'Xà bông IT',
        description: 'IT',
        basePrice: 50_000,
        variations: { create: { sku: `ITECO-B-${tag}`, name: 'Bánh', attributes: {}, retailPrice: 50_000, stock: 50 } },
      },
      include: { variations: true },
    });
    productIds.push(pA.id, pB.id);
    ids.pA = pA.id;
    ids.pB = pB.id;
    ids.v500 = pA.variations.find((v) => v.name === '500ml')!.id;
    ids.v10l = pA.variations.find((v) => v.name === 'Can 10L')!.id;
    const vB = pB.variations[0]!.id;

    const src = { sourceUrl: 'https://pannature.org/it', sourceNote: 'IT' };
    await prisma.productEcoFact.createMany({
      data: [
        { productId: pA.id, kind: 'PLASTIC_AVOIDED', valueGrams: 100, status: 'APPROVED', ...src },
        { productId: pA.id, variationId: ids.v10l, kind: 'PLASTIC_AVOIDED', valueGrams: 600, baselineText: 'so với 20 chai 500ml', status: 'APPROVED', ...src },
        { productId: pA.id, variationId: ids.v10l, kind: 'REFILL_PACK', status: 'APPROVED', ...src },
        { productId: pA.id, kind: 'RETURNABLE_PACKAGING', status: 'RETIRED', ...src },
        { productId: pB.id, kind: 'PLASTIC_AVOIDED', valueGrams: 5000, status: 'DRAFT', ...src },
        { productId: pB.id, kind: 'REFILL_PACK', status: 'RETIRED', ...src },
      ],
    });

    const [c1, c2, c3] = await Promise.all([createUser(prisma), createUser(prisma), createUser(prisma)]);
    userIds.push(c1.id, c2.id, c3.id);
    Object.assign(ids, { c1: c1.id, c2: c2.id, c3: c3.id });
    const line = (variationId: string, quantity: number) => ({ variationId, productName: 'IT', variationName: 'IT', unitPrice: 1000, quantity, total: 1000 * quantity });

    // Khách 1: đơn giao (2 can 10L + 3 chai 500ml), đang xin trả 1 can; một đơn chưa giao; 2 cây (1 đã trồng).
    const o1 = await createOrder(prisma, {
      userId: c1.id,
      status: 'DELIVERED',
      deliveredAt: new Date('2026-10-05T03:00:00Z'),
      items: { create: [line(ids.v10l, 2), line(ids.v500, 3)] },
    });
    const o1can = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o1.id, variationId: ids.v10l } });
    await prisma.returnRequest.create({ data: { orderId: o1.id, userId: c1.id, reason: 'IT', status: 'REQUESTED', items: { create: { orderItemId: o1can.id, quantity: 1 } } } });
    await createOrder(prisma, { userId: c1.id, status: 'CONFIRMED', items: { create: [line(ids.v10l, 5)] } });
    // Đơn của người khác dưới tên khách 1: CTV đặt hộ khách và đơn đại lý, đều đã giao, không cộng vào hộ chiếu.
    await createOrder(prisma, { userId: c1.id, status: 'DELIVERED', placedForCustomer: true, deliveredAt: new Date('2026-09-01T03:00:00Z'), items: { create: [line(ids.v10l, 7)] } });
    await createOrder(prisma, { userId: c1.id, status: 'DELIVERED', type: 'DEALER', deliveredAt: new Date('2026-09-02T03:00:00Z'), items: { create: [line(ids.v10l, 9)] } });
    await prisma.plantedTree.createMany({
      data: [
        { userId: c1.id, certificateCode: `IT-${randCode(10)}`, status: 'PLANTED' },
        { userId: c1.id, certificateCode: `IT-${randCode(10)}` },
      ],
    });

    // Khách 2: đơn giao 1 chai 500ml; yêu cầu trả bị từ chối (không trừ).
    const o2 = await createOrder(prisma, { userId: c2.id, status: 'DELIVERED', deliveredAt: new Date('2026-11-02T03:00:00Z'), items: { create: [line(ids.v500, 1)] } });
    const o2item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o2.id } });
    await prisma.returnRequest.create({ data: { orderId: o2.id, userId: c2.id, reason: 'IT', status: 'REJECTED', items: { create: { orderItemId: o2item.id, quantity: 1 } } } });

    // Khách 3: chỉ mua món có sự thật nháp / ngừng dùng.
    await createOrder(prisma, { userId: c3.id, status: 'DELIVERED', deliveredAt: new Date('2026-11-03T03:00:00Z'), items: { create: [line(vB, 4)] } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.plantedTree.deleteMany({ where: { userId: { in: userIds } } });
      await deleteItData(prisma, { userIds, productIds });
    }
    await moduleRef?.close();
  });

  const NOW = new Date('2026-11-18T05:00:00Z');

  it('cờ eco.passport_enabled tắt: 404', async () => {
    flags['eco.passport_enabled'] = false;
    await expect(passport.passport(ids.c1, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bật: mỗi khách đúng số của mình', async () => {
    flags['eco.passport_enabled'] = true;
    const [p1, p2, p3] = await Promise.all([passport.passport(ids.c1, NOW), passport.passport(ids.c2, NOW), passport.passport(ids.c3, NOW)]);

    // Khách 1: 1 can giữ lại × 600 g (dòng phân loại thắng dòng cả sản phẩm) + 3 chai × 100 g; 1 can refill; đơn chưa giao, đơn CTV đặt hộ
    // và đơn đại lý không tính (firstOrderAt vẫn là đơn tự mua 05/10, không phải đơn tháng 9).
    expect(p1).toMatchObject({ firstOrderAt: '2026-10-05T03:00:00.000Z', plasticAvoidedGrams: 900, refillPacks: 1, co2Grams: null, trees: { pledged: 2, planted: 1 } });
    expect(p1.monthly.find((m) => m.month === '2026-10')?.actions).toBe(1);
    expect(p1.monthly.find((m) => m.month === '2026-09')?.actions).toBe(0);
    expect(p1.stamps.filter((s) => s.reached).map((s) => s.id)).toEqual(['first_order', 'tree_1']);

    // Khách 2: yêu cầu trả bị từ chối nên món vẫn tính.
    expect(p2).toMatchObject({ plasticAvoidedGrams: 100, refillPacks: 0, trees: { pledged: 0, planted: 0 } });

    // Khách 3: có đơn giao nhưng sự thật nháp / ngừng dùng không cộng, đơn không là việc xanh.
    expect(p3).toMatchObject({ firstOrderAt: '2026-11-03T03:00:00.000Z', plasticAvoidedGrams: 0, refillPacks: 0 });
    expect(p3.monthly.every((m) => m.actions === 0)).toBe(true);
  });

  it('thẻ và trang sản phẩm chỉ thấy sự thật đã duyệt; cờ nhãn xanh tắt thì không có gì', async () => {
    flags['eco.product_badges_enabled'] = false;
    expect((await reader.cardFactsFor([{ id: ids.pA, repVariationId: ids.v10l }])).size).toBe(0);
    expect(await reader.productFacts(ids.pA)).toBeNull();

    flags['eco.product_badges_enabled'] = true;
    const cards = await reader.cardFactsFor([
      { id: ids.pA, repVariationId: ids.v10l },
      { id: ids.pB, repVariationId: null },
    ]);
    expect(cards.get(ids.pA)?.map((f) => [f.kind, f.valueGrams])).toEqual([
      ['REFILL_PACK', null],
      ['PLASTIC_AVOIDED', 600],
    ]);
    expect(cards.has(ids.pB)).toBe(false);
    const pdp = await reader.productFacts(ids.pA);
    expect(pdp?.map((f) => f.kind).sort()).toEqual(['PLASTIC_AVOIDED', 'PLASTIC_AVOIDED', 'REFILL_PACK']);
    expect(await reader.productFacts(ids.pB)).toEqual([]);
    const counts = await reader.factCounts([
      { productId: ids.pA, variationId: ids.v500 },
      { productId: ids.pB, variationId: null },
    ]);
    expect(counts?.get(ids.pA)).toBe(1);
    expect(counts?.get(ids.pB)).toBe(0);
  });
});
