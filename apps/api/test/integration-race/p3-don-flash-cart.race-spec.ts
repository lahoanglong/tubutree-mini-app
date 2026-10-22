import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { FlashSaleService, FLASH_ITEM_CLASH_MSG } from '../../src/modules/flash-sale/flash-sale.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { createUser, deleteItData, randCode, summarize, warmPool } from './helpers';

const HOUR = 3_600_000;
const PRICE = 100_000;

/**
 * Trên Postgres THẬT:
 * - kiểm trùng biến thể giữa các đợt flash chạy dưới khoá cùng giao dịch với lần ghi: addItem song song, hay addItem song song với
 *   PATCH dời giờ, không thể cùng lọt rồi để một biến thể nằm trong hai đợt trùng giờ;
 * - PATCH đợt của nhân viên đã vượt trần 100.000đ/đơn từ trước (admin thêm dòng) không làm tăng mức giảm thì không bị chặn;
 * - addItems với topUp (mua lại) gộp phần bù vào đúng một transaction và một sự kiện add_to_cart, lỗi giữa chừng không để lại gì.
 */
describe('Đơn P3: flash sale dưới khoá, mua lại một lần ghi (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let flash: FlashSaleService;
  let cart: CartService;
  let analytics: AnalyticsEventsService;
  const created = { userIds: [] as string[], productIds: [] as string[], flashSaleIds: [] as string[] };

  const user = async (role: 'ADMIN' | 'STAFF' | 'CUSTOMER') => {
    const u = await createUser(prisma, {
      role,
      ...(role === 'STAFF' ? { staffPermissions: ['MARKETING'] } : {}),
      phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      zaloId: `z-${randCode(8)}`,
    });
    created.userIds.push(u.id);
    return u;
  };
  const variations = async (n: number, stock = 1_000) => {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itpd-p-${tag}`, brand: 'IT', slug: `itpd-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const v = await prisma.variation.create({
        data: { pancakeId: `itpd-v-${tag}-${i}`, productId: product.id, sku: `ITPD-${tag}-${i}`, name: `Loai ${i}`, attributes: {}, retailPrice: PRICE, stock },
      });
      out.push(v.id);
    }
    return out;
  };
  const sale = async (createdBy: string, fromHour: number, toHour: number) => {
    const s = await prisma.flashSale.create({
      data: { title: `IT ${randCode(4)}`, startAt: new Date(Date.now() + fromHour * HOUR), endAt: new Date(Date.now() + toHour * HOUR), createdBy },
    });
    created.flashSaleIds.push(s.id);
    return s;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        FlashSaleService,
        CartService,
        ComboService,
        AnalyticsEventsService,
        { provide: CouponsService, useValue: { validateAndCompute: jest.fn() } },
        { provide: NotificationsService, useValue: {} },
        { provide: LifecycleService, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    flash = moduleRef.get(FlashSaleService);
    cart = moduleRef.get(CartService);
    analytics = moduleRef.get(AnalyticsEventsService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.analyticsEvent.deleteMany({ where: { userId: { in: created.userIds } } });
      await deleteItData(prisma, created);
    }
    await moduleRef?.close();
  });

  describe('trùng biến thể giữa các đợt flash', () => {
    const ROUNDS = 6;

    it('hai addItem song song cùng một biến thể vào hai đợt trùng giờ của quản trị viên: đúng một lần lọt', async () => {
      const admin = await user('ADMIN');
      const actor = { id: admin.id, staff: false };
      for (let i = 0; i < ROUNDS; i++) {
        const a = await sale(admin.id, 1, 3);
        const b = await sale(admin.id, 2, 4);
        const [v] = await variations(1);
        const add = (saleId: string) => flash.addItem(saleId, { variationId: v!, flashPrice: 80_000, quota: 5, perUserLimit: 1 }, actor);
        const r = summarize(await Promise.allSettled([add(a.id), add(b.id)]));
        expect(r.fulfilled).toHaveLength(1);
        expect(r.errors[0]).toContain(FLASH_ITEM_CLASH_MSG);
        expect(await prisma.flashSaleItem.count({ where: { variationId: v! } })).toBe(1);
      }
    });

    it('addItem song song với PATCH dời đợt kia chồng giờ: không bao giờ cùng lọt', async () => {
      const admin = await user('ADMIN');
      const actor = { id: admin.id, staff: false };
      for (let i = 0; i < ROUNDS; i++) {
        const a = await sale(admin.id, 1, 2);
        const b = await sale(admin.id, 3, 4);
        const [v] = await variations(1);
        await flash.addItem(a.id, { variationId: v!, flashPrice: 80_000, quota: 5, perUserLimit: 1 }, actor);
        const [w] = await variations(1);
        await flash.addItem(b.id, { variationId: w!, flashPrice: 80_000, quota: 5, perUserLimit: 1 }, actor);
        // B nhận thêm v (đợt B chưa trùng A) song song với việc dời B về chồng A: một trong hai phải bị chặn.
        const r = summarize(
          await Promise.allSettled([
            flash.addItem(b.id, { variationId: v!, flashPrice: 80_000, quota: 5, perUserLimit: 1 }, actor),
            flash.updateSale(b.id, { startAt: new Date(Date.now() + 1.5 * HOUR).toISOString() }, actor),
          ]),
        );
        expect(r.fulfilled).toHaveLength(1);
        expect(r.errors[0]).toContain(FLASH_ITEM_CLASH_MSG);
        const sales = await prisma.flashSaleItem.findMany({ where: { variationId: v! }, include: { flashSale: true } });
        const overlapping = sales.length === 2 && sales[0]!.flashSale.startAt < sales[1]!.flashSale.endAt && sales[1]!.flashSale.startAt < sales[0]!.flashSale.endAt;
        expect(overlapping).toBe(false);
      }
    });
  });

  describe('trần mỗi đơn của nhân viên khi PATCH đợt đã vượt trần từ trước', () => {
    it('thu hẹp giờ và sửa tiêu đề vẫn được; kéo dài hay dời sang khung khác khi đã vượt trần thì bị chặn', async () => {
      const staff = await user('STAFF');
      const s1 = await sale(staff.id, 1, 3);
      const s2 = await sale(staff.id, 2, 4);
      const [a, b] = await variations(2);
      // Quản trị viên thêm dòng vào đợt của nhân viên (không qua trần): 20.000đ × 4 suất = 80.000đ mỗi đợt, chồng giờ 2h–3h → 160.000đ.
      await prisma.flashSaleItem.create({ data: { flashSaleId: s1.id, variationId: a!, flashPrice: 80_000, quota: 10, perUserLimit: 4 } });
      await prisma.flashSaleItem.create({ data: { flashSaleId: s2.id, variationId: b!, flashPrice: 80_000, quota: 10, perUserLimit: 4 } });
      const actor = { id: staff.id, staff: true };
      await flash.updateSale(s1.id, { endAt: new Date(Date.now() + 2.5 * HOUR).toISOString() }, actor);
      await flash.updateSale(s2.id, { title: 'Đổi tên', isActive: false }, actor);
      // Kéo dài đợt đã vượt trần (kể cả khi tổng không tăng) cũng bị chặn: chỉ thu hẹp mới gỡ được.
      await expect(flash.updateSale(s1.id, { endAt: new Date(Date.now() + 4 * HOUR).toISOString() }, actor)).rejects.toThrow(/Một đơn mua đủ/);
      // Đợt tách khỏi nhau (đợt 1 chỉ còn 1h–1.9h) rồi kéo lại chồng thì mức giảm tăng từ 80.000đ lên 160.000đ: chặn.
      await flash.updateSale(s1.id, { endAt: new Date(Date.now() + 1.9 * HOUR).toISOString() }, actor);
      await expect(flash.updateSale(s1.id, { endAt: new Date(Date.now() + 3 * HOUR).toISOString() }, actor)).rejects.toThrow(/Một đơn mua đủ/);
    });
  });

  describe('trần mỗi đơn của nhân viên khi PATCH kéo dài đợt đã kết thúc', () => {
    it('đợt S đã hết giờ + đợt T đang chạy cùng người tạo: kéo S sống lại làm hai đợt chồng nhau vượt trần thì bị chặn', async () => {
      const staff = await user('STAFF');
      const s = await sale(staff.id, -3, -1);
      const t = await sale(staff.id, -2.5, 24);
      const [a, b] = await variations(2);
      // 20.000đ × 3 suất = 60.000đ mỗi đợt: riêng lẻ dưới trần 100.000đ, chồng giờ thì 120.000đ.
      await prisma.flashSaleItem.create({ data: { flashSaleId: s.id, variationId: a!, flashPrice: 80_000, quota: 10, perUserLimit: 3 } });
      await prisma.flashSaleItem.create({ data: { flashSaleId: t.id, variationId: b!, flashPrice: 80_000, quota: 10, perUserLimit: 3 } });
      const actor = { id: staff.id, staff: true };
      await expect(flash.updateSale(s.id, { endAt: new Date(Date.now() + HOUR).toISOString() }, actor)).rejects.toThrow(/Một đơn mua đủ/);
      expect((await prisma.flashSale.findUniqueOrThrow({ where: { id: s.id } })).endAt.getTime()).toBeLessThan(Date.now());
    });
  });

  describe('trần mỗi đơn của nhân viên khi dời giờ sang khung khác', () => {
    it('dời đợt S sang khung đợt T1 làm tổng giảm một đơn 110.000đ > 100.000đ: bị chặn dù mức "trước" của khung cũ bị các đợt rời nhau thổi phồng', async () => {
      const staff = await user('STAFF');
      const actor = { id: staff.id, staff: true };
      const [a, b, c, d] = await variations(4);
      const s = await sale(staff.id, 1, 5);
      const t2a = await sale(staff.id, 1, 2);
      const t2b = await sale(staff.id, 3, 4);
      const t1 = await sale(staff.id, 10, 11);
      // Mọi bước qua addItem của nhân viên (giá 100.000đ): 20.000đ×1, 25.000đ×2, 25.000đ×2, 30.000đ×3.
      await flash.addItem(s.id, { variationId: a!, flashPrice: 80_000, quota: 10, perUserLimit: 1 }, actor);
      await flash.addItem(t2a.id, { variationId: b!, flashPrice: 75_000, quota: 10, perUserLimit: 2 }, actor);
      await flash.addItem(t2b.id, { variationId: c!, flashPrice: 75_000, quota: 10, perUserLimit: 2 }, actor);
      await flash.addItem(t1.id, { variationId: d!, flashPrice: 70_000, quota: 10, perUserLimit: 3 }, actor);
      const newStart = new Date(Date.now() + 10 * HOUR);
      const newEnd = new Date(Date.now() + 11 * HOUR);
      await expect(flash.updateSale(s.id, { startAt: newStart.toISOString(), endAt: newEnd.toISOString() }, actor)).rejects.toThrow(/Một đơn mua đủ/);
      const after = await prisma.flashSale.findUniqueOrThrow({ where: { id: s.id } });
      expect(after.startAt.getTime()).toBeLessThan(Date.now() + 2 * HOUR);
    });
  });

  describe('addItems với topUp (mua lại một lần ghi)', () => {
    it('phần bù gộp vào dòng gốc: một dòng giỏ, một sự kiện add_to_cart với số lượng gộp; phần bù vượt tồn bị bỏ', async () => {
      const customer = await user('CUSTOMER');
      const [v] = await variations(1, 3);
      const out = await cart.addItems(customer.id, [{ variationId: v!, quantity: 1, addSource: 'repurchase' }], { topUp: () => [{ index: 0, quantity: 2 }] });
      expect(out).toEqual([{ ok: true, toppedUp: 2 }]);
      const items = await prisma.cartItem.findMany({ where: { cart: { userId: customer.id } } });
      expect(items.map((i) => [i.variationId, i.quantity])).toEqual([[v, 3]]);
      const events = await prisma.analyticsEvent.findMany({ where: { userId: customer.id, eventName: 'add_to_cart' } });
      expect(events).toHaveLength(1);
      expect(events[0]!.props).toMatchObject({ variationId: v, quantity: 3, addSource: 'repurchase' });

      const [w] = await variations(1, 3);
      const over = await cart.addItems(customer.id, [{ variationId: w!, quantity: 1 }], { topUp: () => [{ index: 0, quantity: 3 }] });
      expect(over).toEqual([{ ok: true }]);
      expect((await prisma.cartItem.findFirstOrThrow({ where: { variationId: w!, cart: { userId: customer.id } } })).quantity).toBe(1);
    });

    it('lỗi hạ tầng khi ghi sự kiện: không dòng giỏ nào lọt, không sự kiện nào', async () => {
      const customer = await user('CUSTOMER');
      const [v, w] = await variations(2, 10);
      const spy = jest.spyOn(analytics, 'recordMany').mockRejectedValueOnce(new Error('connection reset'));
      try {
        await expect(
          cart.addItems(customer.id, [{ variationId: v!, quantity: 1 }, { variationId: w!, quantity: 1 }], { topUp: () => [{ index: 0, quantity: 1 }] }),
        ).rejects.toThrow('connection reset');
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.cartItem.count({ where: { cart: { userId: customer.id } } })).toBe(0);
      expect(await prisma.analyticsEvent.count({ where: { userId: customer.id, eventName: 'add_to_cart' } })).toBe(0);
    });
  });
});
