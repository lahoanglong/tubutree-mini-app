import { ForbiddenException } from '@nestjs/common';
import { CTV_CANNOT_CREATE_PRODUCT } from '../../src/modules/merchant/merchant.service';
import { partnerHarness } from './n2b-harness';

/**
 * Mở bán lại sản phẩm tự giao (updateProduct isActive:true) có cùng cửa sổ như createProduct: kiểm cờ ngoài transaction, không khoá
 * gian hàng. Thu hồi đại lý đã đếm 0 sản phẩm đang bán rồi mới ghi users thì sản phẩm mở bán chen vào để lại chủ CUSTOMER, gian hàng
 * CTV isPartner=false và một sản phẩm tự giao đang bán.
 */
describe('updateProduct mở bán lại đua với thu hồi đại lý (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  beforeAll(async () => {
    h = await partnerHarness();
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  it('thu hồi đã đếm 0 sản phẩm đang bán (kẹt ở dòng users) + chủ mở bán lại: không bao giờ cả hai cùng qua', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const p = await h.product(c.sf.id, { fulfilment: 'MERCHANT', isActive: false });
    const holder = await h.hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${c.owner.id} FOR NO KEY UPDATE`);
    const running: Promise<unknown>[] = [];
    try {
      let d = false;
      running.push(h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER').finally(() => (d = true)));
      await h.waitUntil(async () => d || (await h.lockWaiters(holder.pid)) >= 1, 'thu hồi');
      let s = false;
      running.push(h.portal.updateProduct(c.owner.id, p.id, { isActive: true }).finally(() => (s = true)));
      await h.waitUntil(async () => s || (await h.lockWaiters(holder.pid)) >= 2, 'mở bán lại');
    } finally {
      holder.release();
      await holder.done;
    }
    const settled = await Promise.allSettled(running);
    expect(settled[0]!.status).toBe('fulfilled');
    const err = settled[1]!.status === 'rejected' ? (settled[1] as PromiseRejectedResult).reason : null;
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe(CTV_CANNOT_CREATE_PRODUCT);
    expect(await h.prisma.product.count({ where: { storefrontId: c.sf.id, fulfilment: 'MERCHANT', isActive: true } })).toBe(0);
    expect(await c.roleOf()).toBe('CUSTOMER');
    expect(await c.store()).toMatchObject({ type: 'CTV', isPartner: false });
  });

  it('mở bán lại vào trước: thu hồi thấy sản phẩm đang bán và 409, vai trò giữ nguyên', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const p = await h.product(c.sf.id, { fulfilment: 'MERCHANT', isActive: false });
    await h.portal.updateProduct(c.owner.id, p.id, { isActive: true });
    await expect(h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER')).rejects.toMatchObject({ status: 409 });
    expect(await c.roleOf()).toBe('DEALER');
  });
});
