import { ForbiddenException } from '@nestjs/common';
import { AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { partnerHarness } from './n2b-harness';

/**
 * Khoá gian hàng của ẩn danh (NO KEY UPDATE) tương thích với FOR KEY SHARE của createProduct, và createProduct không đọc users, nên một
 * sản phẩm tự giao đang bán chèn được khi tài khoản chủ đang bị ẩn danh. createProduct nay đọc dòng users của chủ FOR KEY SHARE sau
 * dòng gian hàng: đợi ẩn danh xong rồi thấy isBlocked và từ chối.
 */
describe('createProduct đua với ẩn danh tài khoản của chủ (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  let deletion: AccountDeletionService;
  beforeAll(async () => {
    h = await partnerHarness();
    deletion = new AccountDeletionService(h.prisma, h.fulfilment);
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const dto = { name: 'SP đua', description: 'Mô tả', basePrice: 50_000, stock: 3 };

  it('ẩn danh đang dở (giữ users, kẹt ở dòng địa chỉ): createProduct không tạo được sản phẩm', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const addr = await h.address(c.owner.id);
    const request = await h.prisma.accountDeletionRequest.create({ data: { userId: c.owner.id, reason: 'IT' } });
    const holder = await h.hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${addr.id} FOR UPDATE`);
    const running: Promise<unknown>[] = [];
    try {
      let d = false;
      running.push(deletion.process(request.id, c.adminUser.id).finally(() => (d = true)));
      await h.waitUntil(async () => d || (await h.lockWaiters(holder.pid)) >= 1, 'ẩn danh');
      let s = false;
      running.push(h.portal.createProduct(c.owner.id, dto).finally(() => (s = true)));
      await h.waitUntil(async () => s || (await h.lockWaiters(holder.pid)) >= 2, 'createProduct');
    } finally {
      holder.release();
      await holder.done;
    }
    const settled = await Promise.allSettled(running);
    expect(settled[0]!.status).toBe('fulfilled');
    expect(settled[1]!.status).toBe('rejected');
    expect((settled[1] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(await h.prisma.product.count({ where: { storefrontId: c.sf.id } })).toBe(0);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: c.owner.id } })).isBlocked).toBe(true);
  });

  it('sản phẩm vào trước ẩn danh: ẩn danh thấy sản phẩm và từ chối', async () => {
    const c = await h.ownerStore({ role: 'DEALER', type: 'MERCHANT' });
    const request = await h.prisma.accountDeletionRequest.create({ data: { userId: c.owner.id, reason: 'IT' } });
    await h.portal.createProduct(c.owner.id, dto);
    await expect(deletion.process(request.id, c.adminUser.id)).rejects.toMatchObject({ response: { code: 'ACCOUNT_DELETION_BLOCKED' } });
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: c.owner.id } })).isBlocked).toBe(false);
  });
});
