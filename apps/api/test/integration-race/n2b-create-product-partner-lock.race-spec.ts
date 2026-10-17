import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CTV_CANNOT_CREATE_PRODUCT } from '../../src/modules/merchant/merchant.service';
import { partnerHarness } from './n2b-harness';
import { sleep } from './helpers';

/**
 * createProduct kiểm cờ đối tác rồi mới chèn sản phẩm; trước đây hai bước không chung khoá nên thu hồi đại lý (setUserRole DEALER →
 * CUSTOMER) chen giữa để lại chủ CUSTOMER, gian hàng CTV isPartner=false và một sản phẩm tự giao đang bán (chính là một vướng mắc của
 * partnerBlockers). Giờ chèn dưới FOR KEY SHARE của dòng gian hàng + kiểm lại cờ: hoặc sản phẩm bị từ chối, hoặc thu hồi 409 vì có sản phẩm.
 */
describe('createProduct và thu hồi đại lý đua nhau (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  beforeAll(async () => {
    h = await partnerHarness();
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const dto = { name: 'SP đua', description: 'Mô tả', basePrice: 50_000, stock: 3 };
  const ownProducts = (storefrontId: string) => h.prisma.product.count({ where: { storefrontId, fulfilment: 'MERCHANT', isActive: true } });

  it('thu hồi chen giữa lúc kiểm và lúc chèn (dòng gian hàng bị giữ, cờ tắt rồi commit): sản phẩm bị từ chối, không có sản phẩm mồ côi', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const locker = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "storefronts" WHERE "id" = ${c.sf.id} FOR UPDATE`;
        await tx.storefront.update({ where: { id: c.sf.id }, data: { isPartner: false, type: 'CTV' } });
        await held;
      },
      { timeout: 30_000 },
    );
    await sleep(100);
    const creating = h.portal.createProduct(c.owner.id, dto).then(() => null, (e: unknown) => e);
    await sleep(400);
    release();
    await locker;
    const err = await creating;
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe(CTV_CANNOT_CREATE_PRODUCT);
    expect(await ownProducts(c.sf.id)).toBe(0);
  });

  it('sản phẩm vào trước: thu hồi DEALER → CUSTOMER bị 409 vì có sản phẩm tự giao đang bán, vai trò và gian hàng giữ nguyên', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    await h.portal.createProduct(c.owner.id, dto);
    const err = await h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toContain('1 sản phẩm tự giao đang bán');
    expect(await c.roleOf()).toBe('DEALER');
    expect(await c.store()).toMatchObject({ type: 'MERCHANT', isPartner: true });
  });

  it('đua thật 12 vòng: không bao giờ vừa có sản phẩm tự giao đang bán vừa mất cờ đối tác', async () => {
    for (let round = 0; round < 12; round++) {
      const c = await h.ownerStore({ role: 'DEALER', type: round % 2 ? 'CTV' : 'MERCHANT' });
      const jitter = () => sleep(Math.floor(Math.random() * 25));
      const [created, demoted] = await Promise.all([
        jitter().then(() => h.portal.createProduct(c.owner.id, dto)).then(() => true, () => false),
        jitter().then(() => h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER')).then(() => true, () => false),
      ]);
      expect(created && demoted).toBe(false);
      const store = await c.store();
      const products = await ownProducts(c.sf.id);
      if (products > 0) {
        expect(store.isPartner).toBe(true);
        expect(await c.roleOf()).toBe('DEALER');
      } else {
        expect(demoted).toBe(true);
        expect(store).toMatchObject({ type: 'CTV', isPartner: false });
      }
    }
  });
});
