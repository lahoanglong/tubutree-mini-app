import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import {
  FlashSaleService,
  type FlashQuotaLine,
  type FlashQuotaOutcome,
} from '../../src/modules/flash-sale/flash-sale.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';

const ROUNDS = 6;

/**
 * Trừ suất Giờ vàng dưới tranh chấp (Postgres thật), gọi thẳng FlashSaleService.consumeQuotas trong transaction như checkout làm.
 * Điều Mini dựa vào khi nhận PRICE_CHANGED / FLASH_LIMIT rồi tải lại giỏ: máy chủ không bao giờ bán quá suất của đợt, không bao
 * giờ cho một khách vượt giới hạn, soldCount luôn khớp tổng số đã mua (hoàn lại phần vừa trừ khi vượt giới hạn), hoàn suất (huỷ
 * đơn) song song với mua không làm lệch hai bộ đếm, và hai phiên cùng khách đảo thứ tự dòng không chờ vòng nhau (40P01).
 */
describe('Giờ vàng: consumeQuotas / restore dưới tranh chấp (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let flash: FlashSaleService;
  const created = { userIds: [] as string[], productIds: [] as string[], flashSaleIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        FlashSaleService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    flash = moduleRef.get(FlashSaleService);
  });

  afterAll(async () => {
    if (prisma) await deleteItData(prisma, created);
    await moduleRef?.close();
  });

  async function customer() {
    const u = await createUser(prisma, { role: 'CUSTOMER' });
    created.userIds.push(u.id);
    return u;
  }

  /** Một đợt đang chạy với `specs.length` món; mỗi món có suất `quota`, giới hạn `perUserLimit`, đã bán `soldCount`. */
  async function sale(specs: { quota: number; perUserLimit: number; soldCount?: number }[]) {
    const now = Date.now();
    const s = await prisma.flashSale.create({
      data: { title: `Đợt IT ${randCode(4)}`, startAt: new Date(now - 3_600_000), endAt: new Date(now + 3_600_000), createdBy: 'it' },
    });
    created.flashSaleIds.push(s.id);
    const items = [];
    for (const spec of specs) {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `itfq-p-${tag}`, brand: 'IT', slug: `itfq-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
      });
      created.productIds.push(product.id);
      const v = await prisma.variation.create({
        data: { pancakeId: `itfq-v-${tag}`, productId: product.id, sku: `ITFQ-${tag}`, name: 'Chai', attributes: {}, retailPrice: 100_000, stock: 100 },
      });
      items.push(
        await prisma.flashSaleItem.create({
          data: { flashSaleId: s.id, variationId: v.id, flashPrice: 60_000, quota: spec.quota, soldCount: spec.soldCount ?? 0, perUserLimit: spec.perUserLimit },
        }),
      );
    }
    return { sale: s, items };
  }

  type Attempt = { status: 'ok'; outcomes: FlashQuotaOutcome[] } | { status: 'error'; error: unknown };
  const consume = (userId: string, lines: FlashQuotaLine[]): Promise<Attempt> =>
    prisma
      .$transaction((tx) => flash.consumeQuotas(tx, userId, lines))
      .then((outcomes): Attempt => ({ status: 'ok', outcomes }))
      .catch((error: unknown): Attempt => ({ status: 'error', error }));

  const sold = async (itemId: string) => (await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: itemId } })).soldCount;
  const bought = async (itemId: string) =>
    (await prisma.flashSalePurchase.aggregate({ where: { flashSaleItemId: itemId }, _sum: { quantity: true } }))._sum.quantity ?? 0;
  const describeAll = (attempts: Attempt[]) =>
    attempts.map((a) => (a.status === 'ok' ? a.outcomes.join(',') : `lỗi ${(a.error as Error).name}: ${(a.error as Error).message}`)).join(' | ');

  it(`một khách đã có dòng mua (2/3), bốn lượt song song mỗi lượt 1 suất (${ROUNDS} vòng): đúng một lượt OK, ba lượt OVER_LIMIT, soldCount hoàn lại phần vượt`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const u = await customer();
      const { items } = await sale([{ quota: 100, perUserLimit: 3, soldCount: 2 }]);
      const item = items[0]!;
      await prisma.flashSalePurchase.create({ data: { flashSaleItemId: item.id, userId: u.id, quantity: 2 } });

      const attempts = await Promise.all(Array.from({ length: 4 }, () => consume(u.id, [{ flashSaleItemId: item.id, quantity: 1 }])));
      const ctx = `vòng ${round}: ${describeAll(attempts)}`;
      const outcomes = attempts.flatMap((a) => (a.status === 'ok' ? a.outcomes : [`ERR`]));
      expect({ ctx, ok: outcomes.filter((o) => o === 'OK').length, over: outcomes.filter((o) => o === 'OVER_LIMIT').length }).toEqual({ ctx, ok: 1, over: 3 });
      expect({ ctx, sold: await sold(item.id), bought: await bought(item.id) }).toEqual({ ctx, sold: 3, bought: 3 });
    }
  });

  it(`quota 5 chia cho 12 khách khác nhau song song, mỗi người 1 suất (${ROUNDS} vòng): đúng 5 OK, 7 SOLD_OUT, soldCount = 5 = tổng đã mua`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const users = await Promise.all(Array.from({ length: 12 }, () => customer()));
      const { items } = await sale([{ quota: 5, perUserLimit: 2 }]);
      const item = items[0]!;

      const attempts = await Promise.all(users.map((u) => consume(u.id, [{ flashSaleItemId: item.id, quantity: 1 }])));
      const ctx = `vòng ${round}: ${describeAll(attempts)}`;
      const outcomes = attempts.flatMap((a) => (a.status === 'ok' ? a.outcomes : [`ERR`]));
      expect({ ctx, ok: outcomes.filter((o) => o === 'OK').length, soldOut: outcomes.filter((o) => o === 'SOLD_OUT').length }).toEqual({ ctx, ok: 5, soldOut: 7 });
      expect({ ctx, sold: await sold(item.id), bought: await bought(item.id) }).toEqual({ ctx, sold: 5, bought: 5 });
    }
  });

  it(`quota 5, bốn khách mỗi người 2 suất song song (${ROUNDS} vòng): đúng hai người OK (4 suất), hai người SOLD_OUT dù còn dư 1 suất lẻ`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const users = await Promise.all(Array.from({ length: 4 }, () => customer()));
      const { items } = await sale([{ quota: 5, perUserLimit: 4 }]);
      const item = items[0]!;

      const attempts = await Promise.all(users.map((u) => consume(u.id, [{ flashSaleItemId: item.id, quantity: 2 }])));
      const ctx = `vòng ${round}: ${describeAll(attempts)}`;
      const outcomes = attempts.flatMap((a) => (a.status === 'ok' ? a.outcomes : [`ERR`]));
      expect({ ctx, ok: outcomes.filter((o) => o === 'OK').length, soldOut: outcomes.filter((o) => o === 'SOLD_OUT').length }).toEqual({ ctx, ok: 2, soldOut: 2 });
      expect({ ctx, sold: await sold(item.id), bought: await bought(item.id) }).toEqual({ ctx, sold: 4, bought: 4 });
    }
  });

  it(`hoàn suất (huỷ đơn) ‖ mua khi khách đang kịch giới hạn (${ROUNDS} vòng): hai bộ đếm luôn khớp nhau, OK khi và chỉ khi hoàn xong trước`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const u = await customer();
      const { items } = await sale([{ quota: 100, perUserLimit: 3, soldCount: 3 }]);
      const item = items[0]!;
      await prisma.flashSalePurchase.create({ data: { flashSaleItemId: item.id, userId: u.id, quantity: 3 } });

      const [attempt] = await Promise.all([
        consume(u.id, [{ flashSaleItemId: item.id, quantity: 1 }]),
        prisma.$transaction((tx) => flash.restore(tx, item.id, u.id, 1)),
      ]);
      const ctx = `vòng ${round}: ${describeAll([attempt])}`;
      expect(attempt.status).toBe('ok');
      const outcome = attempt.status === 'ok' ? attempt.outcomes[0] : 'ERR';
      const finalSold = await sold(item.id);
      const finalBought = await bought(item.id);
      expect({ ctx, same: finalSold === finalBought }).toEqual({ ctx, same: true });
      expect({ ctx, outcome, sold: finalSold }).toEqual(outcome === 'OK' ? { ctx, outcome: 'OK', sold: 3 } : { ctx, outcome: 'OVER_LIMIT', sold: 2 });
    }
  });

  it(`cùng khách mua lần đầu ba lượt song song, giới hạn 2, chưa có dòng nào (${ROUNDS} vòng): khoá dòng suất xếp hàng ba lượt nên đúng hai OK và một OVER_LIMIT, không lỗi nào, soldCount = tổng đã mua`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const u = await customer();
      const { items } = await sale([{ quota: 100, perUserLimit: 2 }]);
      const item = items[0]!;

      const attempts = await Promise.all(Array.from({ length: 3 }, () => consume(u.id, [{ flashSaleItemId: item.id, quantity: 1 }])));
      const ctx = `vòng ${round}: ${describeAll(attempts)}`;
      const outcomes = attempts.flatMap((a) => (a.status === 'ok' ? a.outcomes : [`ERR`]));
      expect({ ctx, ok: outcomes.filter((o) => o === 'OK').length, over: outcomes.filter((o) => o === 'OVER_LIMIT').length, err: outcomes.filter((o) => o === 'ERR').length }).toEqual({ ctx, ok: 2, over: 1, err: 0 });
      expect({ ctx, sold: await sold(item.id), bought: await bought(item.id) }).toEqual({ ctx, sold: 2, bought: 2 });
    }
  });

  it(`hai phiên cùng khách đảo thứ tự hai món (${ROUNDS} vòng): cả hai OK, không chờ vòng nhau (40P01), bộ đếm đủ`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const u = await customer();
      const { items } = await sale([
        { quota: 100, perUserLimit: 5 },
        { quota: 100, perUserLimit: 5 },
      ]);
      const [a, b] = items as [(typeof items)[number], (typeof items)[number]];
      await prisma.flashSalePurchase.createMany({
        data: [
          { flashSaleItemId: a.id, userId: u.id, quantity: 1 },
          { flashSaleItemId: b.id, userId: u.id, quantity: 1 },
        ],
      });
      await prisma.flashSaleItem.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { soldCount: 1 } });

      const attempts = await Promise.all([
        consume(u.id, [{ flashSaleItemId: a.id, quantity: 1 }, { flashSaleItemId: b.id, quantity: 1 }]),
        consume(u.id, [{ flashSaleItemId: b.id, quantity: 1 }, { flashSaleItemId: a.id, quantity: 1 }]),
      ]);
      const ctx = `vòng ${round}: ${describeAll(attempts)}`;
      expect({ ctx, outcomes: attempts.map((x) => (x.status === 'ok' ? x.outcomes.join(',') : 'ERR')) }).toEqual({ ctx, outcomes: ['OK,OK', 'OK,OK'] });
      expect({ ctx, a: [await sold(a.id), await bought(a.id)], b: [await sold(b.id), await bought(b.id)] }).toEqual({ ctx, a: [3, 3], b: [3, 3] });
    }
  });
});
