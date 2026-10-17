import { ForbiddenException } from '@nestjs/common';
import { CTV_CANNOT_CREATE_PRODUCT } from '../../src/modules/merchant/merchant.service';
import { partnerHarness } from './n2b-harness';

/**
 * Cờ isPartner của gian hàng CTV có hai nguồn: admin bật tay (setStorePartner, giữ qua đổi CUSTOMER ↔ AFFILIATE theo quyết định của chủ)
 * và theo vai trò (Cổng người bán bật cho DEALER, duyệt hồ sơ đại lý). Cờ theo vai trò phải tắt khi chủ được đặt về CUSTOMER/AFFILIATE,
 * nếu không AFFILIATE đăng được sản phẩm tự giao mà không có đơn đại lý.
 */
describe('Cờ đối tác CTV theo vai trò khi đặt về CUSTOMER/AFFILIATE (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  beforeAll(async () => {
    h = await partnerHarness();
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const dto = { name: 'SP mới', description: 'Mô tả', basePrice: 50_000, stock: 3 };

  it('CUSTOMER → DEALER (Cổng bật cờ) → STAFF → revokeGrant bị chặn → hết vướng → AFFILIATE: cờ tắt, đăng sản phẩm bị từ chối', async () => {
    const c = await h.ownerStore({ role: 'CUSTOMER', type: 'CTV', isPartner: false });
    const tier = await h.tier();
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'DEALER', tier.id);
    await h.portal.getOrCreateStore(c.owner.id);
    expect((await c.store()).isPartner).toBe(true);
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'STAFF');
    await h.prisma.roleGrant.create({ data: { phone: c.owner.phone!, role: 'STAFF', grantedBy: c.adminUser.id } });
    const order = await c.selfShip('SHIPPING');

    await expect(h.rbac.revokeGrant(c.adminUser.id, c.owner.phone!)).resolves.toMatchObject({ role: 'CUSTOMER', storeBlocked: true });
    expect((await c.store()).isPartner).toBe(true);

    await h.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'AFFILIATE');
    expect(await c.store()).toMatchObject({ type: 'CTV', isPartner: false });
    const err = await h.portal.createProduct(c.owner.id, dto).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe(CTV_CANNOT_CREATE_PRODUCT);
  });

  it('cờ do duyệt hồ sơ đại lý bật cũng là cờ theo vai trò: CUSTOMER → AFFILIATE tắt nó', async () => {
    const c = await h.ownerStore({ role: 'CUSTOMER', type: 'CTV', isPartner: false });
    await h.prisma.storefront.update({ where: { id: c.sf.id }, data: { isPartner: true } });
    await h.prisma.userAdminEvent.create({
      data: { userId: c.owner.id, kind: 'STOREFRONT_PARTNER', fromValue: 'false', toValue: 'true', reason: c.sf.id, actorId: c.adminUser.id },
    });
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'AFFILIATE');
    expect((await c.store()).isPartner).toBe(false);
  });

  it('cờ admin bật tay (setStorePartner) của AFFILIATE: giữ qua CUSTOMER ↔ AFFILIATE nhiều lần, kể cả khi đang vướng', async () => {
    const c = await h.ownerStore({ role: 'AFFILIATE', type: 'CTV', isPartner: false });
    await h.fulfilment.setStorePartner(c.adminUser.id, c.sf.id, true);
    await c.selfShip('SHIPPING');
    for (const role of ['CUSTOMER', 'AFFILIATE', 'AFFILIATE', 'CUSTOMER'] as const) {
      await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, role);
      expect((await c.store()).isPartner).toBe(true);
    }
    expect((await c.partnerEvents()).filter((e) => e.toValue === 'false')).toHaveLength(0);
  });

  it('admin bật tay rồi Cổng người bán bật lại sau khi tắt: lần bật MỚI NHẤT quyết định (theo vai trò thì bị tắt)', async () => {
    const c = await h.ownerStore({ role: 'AFFILIATE', type: 'CTV', isPartner: false });
    await h.fulfilment.setStorePartner(c.adminUser.id, c.sf.id, true);
    await h.fulfilment.setStorePartner(c.adminUser.id, c.sf.id, false);
    await h.prisma.user.update({ where: { id: c.owner.id }, data: { role: 'DEALER' } });
    await h.portal.getOrCreateStore(c.owner.id);
    expect((await c.store()).isPartner).toBe(true);
    await h.prisma.user.update({ where: { id: c.owner.id }, data: { role: 'CUSTOMER' } });
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'AFFILIATE');
    expect((await c.store()).isPartner).toBe(false);
  });
});
