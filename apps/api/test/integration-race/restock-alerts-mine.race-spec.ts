import { PrismaService } from '../../src/prisma/prisma.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RestockAlertsService } from '../../src/modules/restock-alerts/restock-alerts.service';
import { createUser, deleteItData, uniquePhone, warmPool } from './helpers';

/**
 * `GET /me/restock-alerts` (trang Yêu thích) trên Postgres THẬT: câu SQL nối ba bảng chạy được với tên cột thật, chỉ trả đăng ký đang chờ
 * của chính khách, và vòng đăng ký → danh sách → huỷ khớp nhau kể cả khi đăng ký song song.
 */
describe('restock alerts: danh sách của khách (real Postgres)', () => {
  let prisma: PrismaService;
  let restock: RestockAlertsService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const values: Record<string, unknown> = { 'catalog.restock_alert_enabled': true };
  const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) } as unknown as SystemConfigService;

  // Tag chỉ gồm chữ (không số, không "x"): tên sản phẩm có "8x 3" khớp PACK_RE và làm lệch các spec ghép Refill.
  const letters = () => Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwyz'[Math.floor(Math.random() * 22)]).join('');

  async function customer() {
    const u = await createUser(prisma, { phone: uniquePhone() });
    userIds.push(u.id);
    return u;
  }

  async function outOfStock(n: number) {
    const tag = letters();
    const product = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itrm-${tag}`,
        name: `Chờ hàng ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: {
          create: Array.from({ length: n }, (_, i) => ({ sku: `ITRM-${tag}-${i}`, name: `Loại ${'abc'[i]}`, attributes: {}, retailPrice: 100_000, stock: 0 })),
        },
      },
      include: { variations: { orderBy: { sku: 'asc' } } },
    });
    productIds.push(product.id);
    return product;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    restock = new RestockAlertsService(prisma, config);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    values['catalog.restock_alert_enabled'] = true;
  });

  it('chỉ đăng ký đang chờ của chính khách, kèm sản phẩm và phân loại, cũ trước mới sau', async () => {
    const [me, other] = [await customer(), await customer()];
    const a = await outOfStock(2);
    const b = await outOfStock(1);
    await restock.subscribe(me.id, a.variations[1]!.id);
    await restock.subscribe(me.id, b.variations[0]!.id);
    await restock.subscribe(me.id, a.variations[0]!.id);
    await restock.subscribe(other.id, a.variations[0]!.id);
    // Đã báo (notifiedAt có giá trị) thì không còn là "đang chờ".
    await prisma.restockAlert.updateMany({ where: { userId: me.id, variationId: a.variations[0]!.id }, data: { notifiedAt: new Date() } });

    const out = await restock.mine(me.id);
    expect(out.enabled).toBe(true);
    expect(out.items.map((i) => [i.variationId, i.productId, i.productSlug, i.productName, i.variationName, i.stock])).toEqual([
      [a.variations[1]!.id, a.id, a.slug, a.name, 'Loại b', 0],
      [b.variations[0]!.id, b.id, b.slug, b.name, 'Loại a', 0],
    ]);
    expect(out.items.every((i) => !Number.isNaN(Date.parse(i.createdAt)))).toBe(true);
    expect((await restock.mine(other.id)).items.map((i) => i.variationId)).toEqual([a.variations[0]!.id]);
  });

  it('vòng đăng ký song song → danh sách → huỷ: một dòng cho mỗi phân loại, huỷ xong danh sách rỗng', async () => {
    const me = await customer();
    const p = await outOfStock(1);
    const v = p.variations[0]!.id;
    await Promise.all(Array.from({ length: 5 }, () => restock.subscribe(me.id, v)));
    expect((await restock.mine(me.id)).items.map((i) => i.variationId)).toEqual([v]);
    await restock.unsubscribe(me.id, v);
    expect((await restock.mine(me.id)).items).toEqual([]);
  });

  it('cờ tắt: rỗng dù khách còn đăng ký đang chờ', async () => {
    const me = await customer();
    const p = await outOfStock(1);
    await restock.subscribe(me.id, p.variations[0]!.id);
    values['catalog.restock_alert_enabled'] = false;
    expect(await restock.mine(me.id)).toEqual({ enabled: false, items: [] });
  });
});
