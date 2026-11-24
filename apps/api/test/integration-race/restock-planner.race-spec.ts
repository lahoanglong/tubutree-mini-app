import { PrismaService } from '../../src/prisma/prisma.service';
import { PILOT_CLEANUP_ACTION } from '../../src/modules/admin/golive/golive-pilot';
import { buildRestockPlan } from '../../src/modules/restock-alerts/restock-planner';
import { RestockPlannerService } from '../../src/modules/restock-alerts/restock-planner.service';
import { createOrder, createUser, deleteItData, uniquePhone, warmPool } from './helpers';

/**
 * "Kế hoạch nhập hàng" (`GET /admin/restock-planner`) trên Postgres THẬT: ba câu SQL (bán 14 ngày, khách chờ chuông, đại lý đặt trước) chạy
 * được với tên cột và kiểu enum thật, và chỉ đếm đúng tập đơn: trong cửa sổ, đã xác nhận trở đi, không quà 0đ, không đơn thử Giờ G đã dọn.
 */
describe('restock planner: số liệu đọc từ DB (real Postgres)', () => {
  let prisma: PrismaService;
  let planner: RestockPlannerService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const auditIds: string[] = [];
  const storefrontIds: string[] = [];

  // Tag chỉ gồm chữ (không số, không "x"): tên sản phẩm có "8x 3" khớp PACK_RE và làm lệch các spec ghép Refill.
  const letters = () => Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwyz'[Math.floor(Math.random() * 22)]).join('');

  async function customer() {
    const u = await createUser(prisma, { phone: uniquePhone() });
    userIds.push(u.id);
    return u;
  }

  async function product(over: { fulfilment?: 'TUBU' | 'MERCHANT'; isActive?: boolean; stock?: number[]; storefrontId?: string } = {}) {
    const tag = letters();
    const p = await prisma.product.create({
      data: {
        brand: `Hãng ${tag}`,
        slug: `itrp-${tag}`,
        name: `Kế hoạch ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        fulfilment: over.fulfilment ?? 'TUBU',
        isActive: over.isActive ?? true,
        storefrontId: over.storefrontId ?? null,
        variations: {
          create: (over.stock ?? [0, 0]).map((stock, i) => ({ sku: `ITRP-${tag}-${'abc'[i]}`, name: `Loại ${'abc'[i]}`, attributes: {}, retailPrice: 100_000, stock })),
        },
      },
      include: { variations: { orderBy: { sku: 'asc' } } },
    });
    productIds.push(p.id);
    return p;
  }

  const line = (variationId: string, quantity: number, over: { isGift?: boolean; backorderedQty?: number } = {}) => ({
    variationId,
    productName: 'IT',
    variationName: 'IT',
    unitPrice: 100_000,
    quantity,
    total: 100_000 * quantity,
    ...over,
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    planner = new RestockPlannerService(prisma);
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { id: { in: auditIds } } });
    await deleteItData(prisma, { userIds, productIds });
    await prisma.storefront.deleteMany({ where: { id: { in: storefrontIds } } });
    await prisma.$disconnect();
  });

  it('bán 14 ngày chỉ đếm đơn khách thật đã xác nhận trong cửa sổ (không đơn đại lý); khách chờ chỉ đếm đăng ký chưa báo; đặt trước chỉ đơn chưa huỷ/trả', async () => {
    const now = new Date();
    const day = 86_400_000;
    const buyer = await customer();
    const p = await product({ stock: [2, 0] });
    const [a, b] = [p.variations[0]!, p.variations[1]!];

    type Status = 'CONFIRMED' | 'DELIVERED' | 'CANCELLED' | 'PENDING_PAYMENT' | 'SHIPPING';
    const order = (status: Status, daysAgo: number, items: ReturnType<typeof line>[], type: 'RETAIL' | 'DEALER' = 'RETAIL') =>
      createOrder(prisma, { userId: buyer.id, status, type, createdAt: new Date(now.getTime() - daysAgo * day), items: { create: items } });

    await order('CONFIRMED', 1, [line(a.id, 3), line(a.id, 1, { isGift: true })]); // +3 a (quà không tính)
    await order('SHIPPING', 13, [line(a.id, 1), line(b.id, 2)]); // +1 a, +2 b
    await order('DELIVERED', 15, [line(a.id, 50)]); // ngoài cửa sổ
    await order('CANCELLED', 1, [line(a.id, 7, { backorderedQty: 5 })]); // huỷ: không bán, không đặt trước
    await order('PENDING_PAYMENT', 1, [line(a.id, 9)]); // chưa xác nhận
    const pilot = await order('CONFIRMED', 1, [line(a.id, 4)]); // đơn thử Giờ G đã dọn
    auditIds.push(
      (await prisma.adminAuditLog.create({ data: { actorId: buyer.id, action: PILOT_CLEANUP_ACTION, targetType: 'ORDER', targetIds: [pilot.code], payload: {} } })).id,
    );
    await order('CONFIRMED', 2, [line(b.id, 6, { backorderedQty: 4 })], 'DEALER'); // đại lý: không vào tốc độ bán, 4 đặt trước

    const [w1, w2, w3] = [await customer(), await customer(), await customer()];
    await prisma.restockAlert.createMany({
      data: [
        { userId: w1.id, variationId: b.id },
        { userId: w2.id, variationId: b.id },
        { userId: w3.id, variationId: b.id, notifiedAt: new Date() },
      ],
    });

    // Hàng gian hàng tự giao, hàng đối tác "Tubu giao hộ" (tồn của đối tác) và sản phẩm đang ẩn không vào kế hoạch dù có đơn.
    const merchant = await product({ fulfilment: 'MERCHANT' });
    const hidden = await product({ isActive: false });
    const store = await prisma.storefront.create({
      data: { type: 'CTV', isPartner: true, slug: `itrp-${letters()}`, ownerUserId: buyer.id, title: 'Đối tác IT', isPublished: true },
    });
    storefrontIds.push(store.id);
    const partner = await product({ storefrontId: store.id });
    await order('CONFIRMED', 1, [line(merchant.variations[0]!.id, 5), line(hidden.variations[0]!.id, 5), line(partner.variations[0]!.id, 5)]);

    const inputs = await planner.inputs(now);
    const ours = inputs.filter((i) => i.productId === p.id);
    expect(ours.map((i) => [i.sku, i.supplier, i.stock, i.sold, i.waiting, i.backordered])).toEqual([
      [a.sku, p.brand, 2, 4, 0, 0],
      [b.sku, p.brand, 0, 2, 2, 4],
    ]);
    expect(inputs.some((i) => [merchant.id, hidden.id, partner.id].includes(i.productId))).toBe(false);

    // Từ số thật tới đề xuất: b = ⌈2 × 30 ÷ 14⌉ = 5, + 2 khách chờ + 4 đại lý chờ − 0 tồn = 11 (hết hàng);
    // a = ⌈4 × 30 ÷ 14⌉ = 9 − 2 tồn = 7, còn đủ bán ⌊2 × 14 ÷ 4⌋ = 7 ngày.
    const plan = buildRestockPlan(ours, { targetDays: 30 }, now);
    expect(plan.rows.map((r) => [r.sku, r.suggestedQty, r.urgency, r.coverDays])).toEqual([
      [b.sku, 11, 'OUT', 0],
      [a.sku, 7, 'OK', 7],
    ]);
    expect(plan.suppliers).toEqual([{ name: p.brand, rows: 2, units: 18 }]);
  });
});
