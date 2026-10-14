import { PrismaService } from '../../src/prisma/prisma.service';
import { WishlistService } from '../../src/modules/wishlist/wishlist.service';
import { createUser, randCode, summarize, warmPool } from './helpers';

/**
 * R4-BUYER-8 trên Postgres thật: chạm đúp nút tim gửi hai lệnh "thêm" cùng lúc. Lệnh thua đua không được ném lỗi (trước đây
 * 409 im lặng ở FE), mỗi cặp user-sản phẩm chỉ có đúng một dòng, và lệnh bỏ sau đó vẫn xoá được dòng.
 */
describe('Wishlist: thêm đồng thời (real Postgres)', () => {
  let prisma: PrismaService;
  let wishlist: WishlistService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    wishlist = new WishlistService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function product() {
    const tag = randCode(8);
    return prisma.product.create({
      data: { pancakeId: `it-w-${tag}`, brand: 'IT Brand', slug: `it-w-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000 },
    });
  }

  it('(a) 8 lệnh thêm cùng lúc, 20 vòng → mọi lệnh trả ok, mỗi vòng đúng 1 dòng', async () => {
    for (let round = 0; round < 20; round++) {
      const [user, p] = await Promise.all([createUser(prisma), product()]);
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => wishlist.add(user.id, p.id)));
      const s = summarize(results);
      const rows = await prisma.wishlist.count({ where: { userId: user.id, productId: p.id } });
      if (s.rejected.length > 0) console.log('[a#%d] lỗi=%j', round, s.errors);

      expect(s.errors).toEqual([]);
      expect(s.fulfilled.every((r) => r.value.ok)).toBe(true);
      expect(rows).toBe(1);
    }
  });

  it('(b) thêm, bỏ, thêm gửi lần lượt (chạm 3 lần) → còn đúng 1 dòng; thêm rồi bỏ → hết dòng', async () => {
    const [user, p] = await Promise.all([createUser(prisma), product()]);
    await wishlist.add(user.id, p.id);
    await wishlist.remove(user.id, p.id);
    await wishlist.add(user.id, p.id);
    expect(await prisma.wishlist.count({ where: { userId: user.id, productId: p.id } })).toBe(1);

    await wishlist.remove(user.id, p.id);
    expect(await prisma.wishlist.count({ where: { userId: user.id, productId: p.id } })).toBe(0);
  });
});
