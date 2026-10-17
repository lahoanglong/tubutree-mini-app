import { PrismaService } from '../../src/prisma/prisma.service';
import { orderCsvChunks } from '../../src/modules/admin/admin-export';
import { orderItemCsvChunks } from '../../src/modules/admin/admin-order-items-export';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Báo cáo admin (D1-04, D2-02, D1-14) trên Postgres THẬT. DB race dùng chung với spec khác nên mỗi ca dùng một khoảng ngày
 * riêng trong quá khứ xa (createdAt đặt tay) và/hoặc lọc theo người dùng của chính ca đó.
 */
describe('Báo cáo admin (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const storefrontIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      const orderIds = (await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((o) => o.id);
      await prisma.$transaction([
        prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  const mkUser = async (data: Parameters<typeof createUser>[1] = {}) => {
    const u = await createUser(prisma, data);
    userIds.push(u.id);
    return u;
  };

  async function collect(gen: AsyncGenerator<string>) {
    let out = '';
    for await (const c of gen) out += c;
    return out;
  }

  describe('D1-04a: CSV đơn có nguồn, CTV, gian hàng; CSV theo dòng hàng', () => {
    it('đơn gian hàng của CTV ghi đủ nền tảng/nguồn/CTV/gian hàng, dòng hàng mang SKU', async () => {
      const buyer = await mkUser();
      const ctv = await mkUser({ role: 'AFFILIATE', fullName: 'CTV Lan', phone: `09${randCode(8).replace(/\D/g, '1').padEnd(8, '1').slice(0, 8)}` });
      const store = await prisma.storefront.create({
        data: { type: 'CTV', slug: `it-rp-${randCode(8).toLowerCase()}`, ownerUserId: ctv.id, title: 'Gian hàng Lan', isPublished: true },
      });
      storefrontIds.push(store.id);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        source: 'storefront',
        platform: 'miniapp',
        referrerUserId: ctv.id,
        storefrontSlug: store.slug,
        storefrontId: store.id,
        total: 150_000,
      });
      await prisma.orderItem.create({
        data: { orderId: order.id, variationId: 'it-var-missing', productName: 'Mật ong', variationName: '500ml', unitPrice: 75_000, quantity: 2, total: 150_000 },
      });

      const csv = await collect(orderCsvChunks(prisma, { id: order.id }));
      const [header, line] = csv.trimEnd().split('\r\n');
      expect(header!.endsWith('Nền tảng,Nguồn đơn,CTV giới thiệu,SĐT CTV,Gian hàng')).toBe(true);
      expect(line).toContain(',Mini App,Gian hàng (khách tự mua),CTV Lan,');
      expect(line!.endsWith(',Gian hàng Lan')).toBe(true);

      const items = await collect(orderItemCsvChunks(prisma, { id: order.id }));
      const rows = items.trimEnd().split('\r\n');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toContain(',Mật ong,500ml,2,75000,150000,');
      expect(rows[1]).toContain(',Gian hàng (khách tự mua),CTV Lan,Gian hàng Lan,');
    });
  });
});
