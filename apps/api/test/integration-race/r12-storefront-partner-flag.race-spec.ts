import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { OrderStatus, StorefrontType, UserRole } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 86_400_000;

/**
 * POST /admin/storefronts/:id/partner: admin gỡ cờ isPartner bị kẹt (cấp DEALER bằng setUserRole rồi đổi lại) hoặc bật lại. Không
 * cho tắt khi gian hàng còn dữ liệu đối tác sẽ mồ côi; không bật cho gian hàng BRAND; bấm lại không ghi thêm sổ.
 */
describe('Admin bật/tắt cờ gian hàng đối tác (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: MerchantFulfilmentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    svc = new MerchantFulfilmentService(prisma, {} as never, undefined, moduleRef.get(SystemConfigService));
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function store(o: { role?: UserRole; type?: StorefrontType; isPartner?: boolean } = {}) {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const owner = await createUser(prisma, { role: o.role ?? 'AFFILIATE' });
    const sf = await prisma.storefront.create({
      data: {
        type: o.type ?? 'CTV',
        isPartner: o.isPartner ?? true,
        slug: `it-pf-${randCode(8).toLowerCase()}`,
        ownerUserId: owner.id,
        title: 'Gian hàng IT',
      },
    });
    const buyer = await createUser(prisma);
    const selfShip = (status: OrderStatus, extra: { deliveredAt?: Date; paymentStatus?: 'PAID' | 'UNPAID' } = {}) =>
      createOrder(prisma, {
        userId: buyer.id, status, fulfiller: 'MERCHANT', fulfillerStorefrontId: sf.id, storefrontSlug: sf.slug,
        paymentStatus: extra.paymentStatus ?? 'UNPAID', ...(extra.deliveredAt ? { deliveredAt: extra.deliveredAt } : {}),
      });
    const events = () => prisma.userAdminEvent.findMany({ where: { userId: owner.id, kind: 'STOREFRONT_PARTNER' } });
    const flag = async () => (await prisma.storefront.findUniqueOrThrow({ where: { id: sf.id } })).isPartner;
    return { admin, owner, sf, buyer, selfShip, events, flag };
  }

  async function conflictMessage(p: Promise<unknown>) {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    return (err as ConflictException).message;
  }

  it('tắt cờ của gian hàng CTV không còn dữ liệu đối tác (chủ đã về CTV): tắt, ghi sổ một dòng; bấm lại không ghi thêm', async () => {
    const { admin, owner, sf, selfShip, events, flag } = await store();
    await selfShip('CANCELLED');
    await selfShip('RETURNED');
    await expect(svc.setStorePartner(admin.id, sf.id, false)).resolves.toEqual({ id: sf.id, isPartner: false });
    expect(await flag()).toBe(false);
    await expect(svc.setStorePartner(admin.id, sf.id, false)).resolves.toEqual({ id: sf.id, isPartner: false });
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ userId: owner.id, fromValue: 'true', toValue: 'false', actorId: admin.id, reason: sf.id });
  });

  it('bật lại cờ cho gian hàng CTV: bật, ghi sổ; bấm lại idempotent', async () => {
    const { admin, sf, events, flag } = await store({ isPartner: false });
    await expect(svc.setStorePartner(admin.id, sf.id, true)).resolves.toEqual({ id: sf.id, isPartner: true });
    await svc.setStorePartner(admin.id, sf.id, true);
    expect(await flag()).toBe(true);
    expect((await events()).map((e) => [e.fromValue, e.toValue])).toEqual([['false', 'true']]);
  });

  it('404 khi không có gian hàng', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    await expect(svc.setStorePartner(admin.id, 'khong-co', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không bật cho gian hàng BRAND; không tắt được gian hàng loại MERCHANT (luôn là đối tác)', async () => {
    const brand = await store({ type: 'BRAND', isPartner: false });
    await expect(svc.setStorePartner(brand.admin.id, brand.sf.id, true)).rejects.toBeInstanceOf(BadRequestException);
    expect(await brand.flag()).toBe(false);
    const merchant = await store({ type: 'MERCHANT', isPartner: true, role: 'DEALER' });
    await expect(svc.setStorePartner(merchant.admin.id, merchant.sf.id, false)).rejects.toBeInstanceOf(BadRequestException);
    expect(await merchant.flag()).toBe(true);
    expect(await brand.events()).toHaveLength(0);
  });

  it('409 liệt kê từng vướng mắc: chủ còn là đại lý, đơn tự giao đang xử lý, khoản chờ đối soát, phiếu chờ, liên kết giao hộ, yêu cầu trả', async () => {
    const { admin, owner, sf, buyer, selfShip, events, flag } = await store({ role: 'DEALER' });
    await selfShip('CONFIRMED');
    await selfShip('SHIPPING');
    await selfShip('PENDING_PAYMENT');
    const delivered = await selfShip('DELIVERED', { deliveredAt: new Date(Date.now() - 20 * DAY), paymentStatus: 'PAID' });
    await prisma.returnRequest.create({ data: { orderId: delivered.id, userId: buyer.id, reason: 'IT', status: 'REQUESTED' } });
    await prisma.merchantPayout.create({ data: { storefrontId: sf.id, amount: 1000, createdBy: admin.id } });
    const product = (fulfilment: 'MERCHANT' | 'TUBU', isActive = true) =>
      prisma.product.create({
        data: {
          storefrontId: sf.id, fulfilment, isActive, brand: 'IT', slug: `it-pf-p-${randCode(8).toLowerCase()}`, name: 'SP IT', description: 'IT',
          basePrice: 1000,
          variations: { create: [{ sku: `ITPF-${randCode(8)}`, pancakeId: `itpf-${randCode(8)}`, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
        },
        include: { variations: true },
      });
    await product('MERCHANT');
    await product('MERCHANT', false);
    const consigned = await product('TUBU');
    await prisma.merchantPancakeLink.create({ data: { productId: consigned.id, storefrontId: sf.id, variationId: consigned.variations[0]!.id } });
    await prisma.merchantPancakeLink.create({
      data: { productId: consigned.id, storefrontId: sf.id, variationId: consigned.variations[0]!.id, unlinkedAt: new Date() },
    });

    const msg = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg).toContain('chủ gian hàng vẫn là đại lý');
    expect(msg).toContain('3 đơn tự giao chưa xong');
    expect(msg).toContain('khoản chờ đối soát');
    expect(msg).toContain('1 phiếu đối soát chưa chuyển');
    expect(msg).toContain('1 liên kết hàng Tubu giao hộ');
    expect(msg).toContain('1 yêu cầu trả hàng chờ xử lý');
    expect(msg).toContain('1 sản phẩm tự giao đang bán');
    expect(await flag()).toBe(true);
    expect(await events()).toHaveLength(0);

    await prisma.user.update({ where: { id: owner.id }, data: { role: 'AFFILIATE' } });
    const msg2 = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg2).not.toContain('đại lý');
    expect(msg2).toContain('3 đơn tự giao chưa xong');
  });

  it('chỉ còn một vướng mắc (khoản chờ đối soát của đơn mới giao) vẫn 409', async () => {
    const { admin, sf, selfShip, flag } = await store();
    await selfShip('DELIVERED', { deliveredAt: new Date(Date.now() - DAY), paymentStatus: 'PAID' });
    const msg = await conflictMessage(svc.setStorePartner(admin.id, sf.id, false));
    expect(msg).toContain('khoản chờ đối soát');
    expect(await flag()).toBe(true);
  });

  it('hai admin bấm tắt cùng lúc: một dòng sổ, cờ tắt', async () => {
    const { admin, sf, events, flag } = await store();
    const r = summarize(await Promise.allSettled([svc.setStorePartner(admin.id, sf.id, false), svc.setStorePartner(admin.id, sf.id, false)]));
    expect(r.errors).toEqual([]);
    expect(await flag()).toBe(false);
    expect(await events()).toHaveLength(1);
  });
});
