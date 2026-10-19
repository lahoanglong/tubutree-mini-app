import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { createUser, deleteItData, randCode, setConfig, summarize, warmPool } from './helpers';

const PRICE = 100_000;

/**
 * D2-01 / D2-05 trên Postgres THẬT: item flash của nhân viên cộng chung ngân sách ngày với mã giảm giá (một truy vấn, một
 * khoá theo người tạo), hai lần thêm song song không cùng lọt, nhân viên không đụng đợt của quản trị viên.
 */
describe('Flash sale do nhân viên tạo (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let flash: FlashSaleService;
  const created = { userIds: [] as string[], productIds: [] as string[], flashSaleIds: [] as string[], couponIds: [] as string[] };
  let savedBudget: unknown;

  const staffUser = async () => {
    const u = await createUser(prisma, { role: 'STAFF', staffPermissions: ['MARKETING'], phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, zaloId: `z-${randCode(8)}` });
    created.userIds.push(u.id);
    return u;
  };
  const variations = async (n: number) => {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itfs-p-${tag}`, brand: 'IT', slug: `itfs-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: PRICE },
    });
    created.productIds.push(product.id);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const v = await prisma.variation.create({
        data: { pancakeId: `itfs-v-${tag}-${i}`, productId: product.id, sku: `ITFS-${tag}-${i}`, name: `Loai ${i}`, attributes: {}, retailPrice: PRICE, stock: 1_000 },
      });
      out.push(v.id);
    }
    return out;
  };
  const sale = async (createdBy: string) => {
    const s = await prisma.flashSale.create({
      data: { title: `IT ${randCode(4)}`, startAt: new Date(Date.now() + 3_600_000), endAt: new Date(Date.now() + 7_200_000), createdBy },
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
        { provide: NotificationsService, useValue: {} },
        { provide: LifecycleService, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    flash = moduleRef.get(FlashSaleService);
    savedBudget = (await prisma.systemConfig.findUnique({ where: { key: 'coupon.staff_daily_budget_vnd' } }))?.value;
    await setConfig(prisma, 'coupon.staff_daily_budget_vnd', 10_000_000);
  });

  afterAll(async () => {
    if (prisma) {
      if (savedBudget === undefined) await prisma.systemConfig.deleteMany({ where: { key: 'coupon.staff_daily_budget_vnd' } });
      else await setConfig(prisma, 'coupon.staff_daily_budget_vnd', savedBudget as number);
      await prisma.coupon.deleteMany({ where: { id: { in: created.couponIds } } });
      await deleteItData(prisma, created);
    }
    await moduleRef?.close();
  });

  it('hai lần thêm song song 6.000.000đ mỗi lần: ngân sách ngày 10.000.000đ chỉ cho một lần lọt', async () => {
    const staff = await staffUser();
    const s = await sale(staff.id);
    const [a, b] = await variations(2);
    // (100.000 − 80.000) × 300 = 6.000.000đ
    const add = (variationId: string) => flash.addItem(s.id, { variationId, flashPrice: 80_000, quota: 300, perUserLimit: 1 }, { id: staff.id, staff: true });
    const r = summarize(await Promise.allSettled([add(a!), add(b!)]));
    expect(r.fulfilled).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.errors[0]).toContain('Vượt ngân sách');
    expect(await prisma.flashSaleItem.count({ where: { flashSaleId: s.id } })).toBe(1);
  });

  it('hai nhân viên cùng thêm vào đợt của A: ngân sách tính theo A (người tạo đợt), nên chỉ một lần 6.000.000đ lọt', async () => {
    const a = await staffUser();
    const b = await staffUser();
    const s = await sale(a.id);
    const [v1, v2, v3] = await variations(3);
    const add = (variationId: string, id: string) => flash.addItem(s.id, { variationId, flashPrice: 80_000, quota: 300, perUserLimit: 1 }, { id, staff: true });
    const r = summarize(await Promise.allSettled([add(v1!, a.id), add(v2!, b.id)]));
    expect(r.fulfilled).toHaveLength(1);
    expect(r.errors[0]).toContain('Vượt ngân sách');
    // B chưa từng tạo gì trong ngày nhưng vẫn không thêm tiếp được: phần đã dùng là của A.
    await expect(add(v3!, b.id)).rejects.toThrow('Vượt ngân sách');
    expect(await prisma.flashSaleItem.count({ where: { flashSaleId: s.id } })).toBe(1);
  });

  it('ngân sách chung với mã: đã tạo mã có thể giảm 5.000.000đ trong ngày thì flash 6.000.000đ bị chặn, 4.000.000đ được', async () => {
    const staff = await staffUser();
    const coupon = await prisma.coupon.create({
      data: {
        code: `ITFS${randCode(6).toUpperCase()}`,
        type: 'AMOUNT',
        value: 50_000,
        startAt: new Date(),
        endAt: new Date(Date.now() + 864e5),
        usageLimit: 100,
        perUserLimit: 1,
        scope: 'PUBLIC',
        createdById: staff.id,
      },
    });
    created.couponIds.push(coupon.id);
    const s = await sale(staff.id);
    const [a, b] = await variations(2);
    const actor = { id: staff.id, staff: true };
    await expect(flash.addItem(s.id, { variationId: a!, flashPrice: 80_000, quota: 300, perUserLimit: 1 }, actor)).rejects.toThrow(BadRequestException);
    await flash.addItem(s.id, { variationId: a!, flashPrice: 80_000, quota: 200, perUserLimit: 1 }, actor);
    // 5.000.000 + 4.000.000 đã dùng: thêm 2.000.000đ nữa vượt 10.000.000đ
    await expect(flash.addItem(s.id, { variationId: b!, flashPrice: 80_000, quota: 100, perUserLimit: 1 }, actor)).rejects.toThrow('Vượt ngân sách');
  });

  it('ADMIN thêm 90% không bị trần; nhân viên không sửa, xoá, thêm item vào đợt của ADMIN', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, zaloId: `z-${randCode(8)}` });
    created.userIds.push(admin.id);
    const staff = await staffUser();
    const s = await sale(admin.id);
    const [a, b] = await variations(2);
    const item = await flash.addItem(s.id, { variationId: a!, flashPrice: 10_000, quota: 1_000, perUserLimit: 200 }, { id: admin.id, staff: false });
    const actor = { id: staff.id, staff: true };
    await expect(flash.updateSale(s.id, { isActive: false }, actor)).rejects.toThrow(ForbiddenException);
    await expect(flash.addItem(s.id, { variationId: b!, flashPrice: 90_000, quota: 5, perUserLimit: 1 }, actor)).rejects.toThrow(ForbiddenException);
    await expect(flash.removeItem(item.id, actor)).rejects.toThrow(ForbiddenException);
    await expect(flash.deleteSale(s.id, actor)).rejects.toThrow(ForbiddenException);
    expect((await prisma.flashSale.findUniqueOrThrow({ where: { id: s.id } })).isActive).toBe(true);
    expect(await prisma.flashSaleItem.count({ where: { flashSaleId: s.id } })).toBe(1);
  });

  it('người tạo đợt mua: không có giá flash; khách khác có', async () => {
    const staff = await staffUser();
    const customer = await createUser(prisma, { role: 'CUSTOMER', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, zaloId: `z-${randCode(8)}` });
    created.userIds.push(customer.id);
    const [a] = await variations(1);
    const s = await prisma.flashSale.create({
      data: { title: `IT ${randCode(4)}`, startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 3_600_000), createdBy: staff.id },
    });
    created.flashSaleIds.push(s.id);
    await prisma.flashSaleItem.create({ data: { flashSaleId: s.id, variationId: a!, flashPrice: 80_000, quota: 10, perUserLimit: 2 } });
    expect((await flash.resolveEffective([a!], new Date(), staff.id)).has(a!)).toBe(false);
    expect((await flash.resolveEffective([a!], new Date(), customer.id)).get(a!)).toMatchObject({ flashPrice: 80_000, allowance: 2 });
  });

  it('ADMIN tạo đợt rồi tự mua vẫn có giá flash', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, zaloId: `z-${randCode(8)}` });
    created.userIds.push(admin.id);
    const [a] = await variations(1);
    const s = await prisma.flashSale.create({
      data: { title: `IT ${randCode(4)}`, startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 3_600_000), createdBy: admin.id },
    });
    created.flashSaleIds.push(s.id);
    await prisma.flashSaleItem.create({ data: { flashSaleId: s.id, variationId: a!, flashPrice: 80_000, quota: 10, perUserLimit: 2 } });
    expect((await flash.resolveEffective([a!], new Date(), admin.id)).get(a!)).toMatchObject({ flashPrice: 80_000, allowance: 2 });
  });
});
