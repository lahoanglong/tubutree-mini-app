import { ForbiddenException } from '@nestjs/common';
import { CTV_CANNOT_CREATE_PRODUCT } from '../../src/modules/merchant/merchant.service';
import { partnerHarness } from './n2b-harness';
import { randCode } from './helpers';

/**
 * Thứ tự khoá của updateProduct khi mở bán lại / xin mã Pancake: biến thể → gian hàng → users (như đặt đơn: khoá biến thể rồi
 * users FOR UPDATE khi dùng điểm). Khoá users trước biến thể thì đặt đơn của chính chủ (dùng điểm) deadlock với nó.
 */
describe('updateProduct: thứ tự khoá và nhánh xin mã Pancake (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  beforeAll(async () => {
    h = await partnerHarness();
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  it('đặt đơn của chủ (biến thể rồi users FOR UPDATE) ‖ mở bán lại sản phẩm của chính mình: không 40P01, cả hai xong', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const p = await h.product(c.sf.id, { fulfilment: 'MERCHANT', isActive: false });
    const v = await h.prisma.variation.findFirstOrThrow({ where: { productId: p.id } });
    let pid = 0;
    let locked!: () => void;
    const ready = new Promise<void>((r) => (locked = r));
    let step2!: () => void;
    const gate = new Promise<void>((r) => (step2 = r));
    const checkoutLike = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${v.id} ORDER BY "id" FOR NO KEY UPDATE`;
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${c.owner.id} FOR UPDATE`;
      },
      { timeout: 30_000 },
    );
    await ready;
    let s = false;
    const updating = h.portal.updateProduct(c.owner.id, p.id, { isActive: true }).finally(() => (s = true));
    await h.waitUntil(async () => s || (await h.lockWaiters(pid)) >= 1, 'updateProduct');
    step2();
    const settled = await Promise.allSettled([checkoutLike, updating]);
    const errors = settled.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
    expect(errors.join(' ')).not.toMatch(/40P01|deadlock/i);
    expect(settled.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await h.prisma.product.findUniqueOrThrow({ where: { id: p.id } })).isActive).toBe(true);
  });

  it('xin mã Pancake cho sản phẩm tự giao đang ẩn của gian hàng đang bị thu hồi (thu hồi đã đếm 0 sản phẩm): bị từ chối, sản phẩm không mở bán', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const oldCode = `OLD-${randCode(6)}`;
    const newCode = `NEW-${randCode(6)}`;
    const p = await h.product(c.sf.id, { fulfilment: 'MERCHANT', isActive: false });
    await h.prisma.product.update({ where: { id: p.id }, data: { pancakeLinkCode: oldCode } });
    const shell = await h.prisma.product.create({
      data: {
        fulfilment: 'TUBU', isActive: true, brand: 'IT', slug: `n2e-${randCode(8).toLowerCase()}`, name: 'Tubu IT', description: 'IT', basePrice: 1000,
        variations: { create: [{ sku: `N2E-${randCode(8)}`, pancakeId: newCode, name: 'v', attributes: {}, retailPrice: 1000, stock: 5 }] },
      },
    });
    h.created.productIds.push(shell.id);

    const holder = await h.hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${c.owner.id} FOR NO KEY UPDATE`);
    const running: Promise<unknown>[] = [];
    try {
      let d = false;
      running.push(h.admin.setUserRole(c.adminUser.id, c.owner.phone!, 'CUSTOMER').finally(() => (d = true)));
      await h.waitUntil(async () => d || (await h.lockWaiters(holder.pid)) >= 1, 'thu hồi');
      let s = false;
      running.push(h.portal.updateProduct(c.owner.id, p.id, { pancakeCode: newCode }).finally(() => (s = true)));
      await h.waitUntil(async () => s || (await h.lockWaiters(holder.pid)) >= 2, 'xin mã');
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
  });
});
