import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CTV_CANNOT_CREATE_PRODUCT } from '../../src/modules/merchant/merchant.service';
import { partnerHarness } from './n2b-harness';

/**
 * Gian hàng MERCHANT luôn là đối tác và cờ không tắt tay được: sau khi `revokeGrant` giữ gian hàng (storeBlocked) vì còn vướng, lần đặt
 * lại vai trò CUSTOMER/AFFILIATE (khi hết vướng) phải chuyển nó về CTV + isPartner=false, nếu không AFFILIATE (thuộc MERCHANT_PORTAL_ROLES)
 * đăng được sản phẩm tự giao mà không có đơn đại lý được duyệt. Gian hàng CTV do admin bật cờ tay thì không bị đụng.
 */
describe('Đặt lại vai trò CUSTOMER/AFFILIATE với gian hàng MERCHANT (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  beforeAll(async () => {
    h = await partnerHarness();
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const dto = { name: 'SP mới', description: 'Mô tả', basePrice: 50_000, stock: 3 };

  it('revokeGrant bị chặn → hết vướng → setUserRole AFFILIATE chuyển gian hàng về CTV isPartner=false, đăng sản phẩm bị từ chối', async () => {
    const c = await h.ownerStore({ role: 'STAFF', type: 'MERCHANT' });
    await h.prisma.roleGrant.create({ data: { phone: c.owner.phone!, role: 'STAFF', grantedBy: c.adminUser.id } });
    const order = await c.selfShip('SHIPPING');

    await expect(h.rbac.revokeGrant(c.adminUser.id, c.owner.phone!)).resolves.toMatchObject({ role: 'CUSTOMER', storeBlocked: true });
    expect(await c.store()).toMatchObject({ type: 'MERCHANT', isPartner: true });

    // Còn vướng: đặt lại vai trò cũng 409, gian hàng giữ nguyên.
    await expect(h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'AFFILIATE')).rejects.toBeInstanceOf(ConflictException);
    expect(await c.store()).toMatchObject({ type: 'MERCHANT', isPartner: true });
    expect(await c.roleOf()).toBe('CUSTOMER');

    await h.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await expect(h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'AFFILIATE')).resolves.toMatchObject({ role: 'AFFILIATE', previousRole: 'CUSTOMER' });
    expect(await c.store()).toMatchObject({ type: 'CTV', isPartner: false });
    const ev = await c.partnerEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromValue: 'true', toValue: 'false', actorId: c.adminUser.id, reason: c.sf.id });

    const err = await h.portal.createProduct(c.owner.id, dto).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe(CTV_CANNOT_CREATE_PRODUCT);
    expect(await h.prisma.product.count({ where: { storefrontId: c.sf.id } })).toBe(0);
  });

  it('CUSTOMER → CUSTOMER với gian hàng MERCHANT còn vướng vẫn 409; sạch vướng thì chuyển CTV và lặp lại là no-op', async () => {
    const c = await h.ownerStore({ role: 'CUSTOMER', type: 'MERCHANT' });
    await c.selfShip('PACKED');
    await expect(h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER')).rejects.toBeInstanceOf(ConflictException);
    expect(await c.store()).toMatchObject({ type: 'MERCHANT', isPartner: true });
    await h.prisma.order.updateMany({ where: { fulfillerStorefrontId: c.sf.id }, data: { status: 'CANCELLED' } });
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER');
    expect(await c.store()).toMatchObject({ type: 'CTV', isPartner: false });
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER');
    expect(await c.partnerEvents()).toHaveLength(1);
  });

  it('gian hàng CTV do admin bật cờ tay: CUSTOMER → AFFILIATE và CUSTOMER → CUSTOMER không đụng, kể cả khi đang vướng', async () => {
    const c = await h.ownerStore({ role: 'CUSTOMER', type: 'CTV', isPartner: false });
    await h.fulfilment.setStorePartner(c.adminUser.id, c.sf.id, true);
    await c.selfShip('SHIPPING');
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'AFFILIATE');
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER');
    await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER');
    expect(await c.store()).toMatchObject({ type: 'CTV', isPartner: true });
    expect((await c.partnerEvents()).filter((e) => e.toValue === 'false')).toHaveLength(0);
    expect(await c.roleOf()).toBe('CUSTOMER');
  });

  it('người không có gian hàng: CUSTOMER → AFFILIATE → CUSTOMER chạy như trước', async () => {
    const adminUser = await h.user('ADMIN');
    const u = await h.user('CUSTOMER');
    await expect(h.admin.setUserRole(adminUser.id, u.phone!, 'AFFILIATE')).resolves.toMatchObject({ role: 'AFFILIATE' });
    await expect(h.admin.setUserRole(adminUser.id, u.phone!, 'CUSTOMER')).resolves.toMatchObject({ role: 'CUSTOMER' });
  });
});
