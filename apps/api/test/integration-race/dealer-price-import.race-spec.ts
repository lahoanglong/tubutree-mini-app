import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createUser, randCode, setConfig, summarize } from './helpers';

/**
 * Giá sỉ đại lý > 0 được DealerService.unitPrice ưu tiên tuyệt đối. Parser cũ đọc `185.000` thành 185đ, `240,000` thành 240đ và bỏ
 * im lặng `1.250.000`. Trên Postgres thật: mọi cách viết số tiền kiểu Việt Nam ghi đúng giá; file còn dòng lỗi không ghi gì; hai
 * lần nhập hai bậc khác nhau chồng lên cùng biến thể không làm mất giá của bậc kia.
 */
describe('Nhập giá sỉ đại lý theo bậc (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let adminId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const none = {} as never;
    admin = new AdminService(prisma, new SystemConfigService(prisma), none, none, none, none, none, none, none, none);
    adminId = (await createUser(prisma, { role: 'ADMIN' })).id;
    // Sàn giá sỉ = giá lẻ × (1 − trần chiết khấu đại lý); spec khác có thể đổi khoá này trên cùng DB.
    await setConfig(prisma, 'dealer.max_discount_pct', 0.45);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function tier() {
    const tag = randCode(8);
    return prisma.dealerTier.create({ data: { id: `tier_${tag}`, name: `Bậc ${tag}`, minOrderVolume: 0, discountRules: {} } });
  }

  async function variation(retailPrice: number) {
    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `it-dp-p-${tag}`, brand: 'IT', slug: `it-dp-${tag.toLowerCase()}`, name: `SP sỉ ${tag}`, description: 'IT', basePrice: retailPrice },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-dp-v-${tag}`, productId: p.id, sku: `ITDP-${tag}`, name: 'Mặc định', attributes: {}, retailPrice, stock: 10 },
    });
  }

  const priceOf = async (id: string, tierId: string) => {
    const v = await prisma.variation.findUniqueOrThrow({ where: { id }, select: { dealerPrices: true } });
    return ((v.dealerPrices as Record<string, number> | null) ?? {})[tierId] ?? null;
  };

  it('185.000 / 240,000 (Excel tách cột) / 1.250.000 / 185 000 → đúng số đồng, có lịch sử', async () => {
    const t = await tier();
    const a = await variation(200_000);
    const b = await variation(300_000);
    const c = await variation(1_500_000);
    const d = await variation(200_000);
    const csv = `SKU,Giá sỉ\n${a.sku},185.000\n${b.sku},240,000\n${c.sku};1.250.000\n${d.sku}\t185 000`;

    const preview = await admin.previewDealerPrices(t.id, { csv });
    expect(preview.rows.map((r) => [r.status, r.price])).toEqual([
      ['OK', 185_000],
      ['OK', 240_000],
      ['OK', 1_250_000],
      ['OK', 185_000],
    ]);

    const r = await admin.importDealerPrices(adminId, t.id, { csv });
    expect(r).toEqual({ tierId: t.id, updated: 4, unchanged: 0, notFound: [], skipped: 0 });
    expect([await priceOf(a.id, t.id), await priceOf(b.id, t.id), await priceOf(c.id, t.id), await priceOf(d.id, t.id)]).toEqual([
      185_000, 240_000, 1_250_000, 185_000,
    ]);
    const hist = await prisma.dealerPriceHistory.findMany({ where: { tierId: t.id }, orderBy: { newPrice: 'asc' } });
    expect(hist.map((h) => [h.newPrice, h.oldPrice, h.changedBy])).toEqual([
      [185_000, null, adminId],
      [185_000, null, adminId],
      [240_000, null, adminId],
      [1_250_000, null, adminId],
    ]);
  });

  it('một dòng lỗi (mơ hồ / ngoài khoảng giá lẻ / SKU lặp) → không dòng nào được ghi', async () => {
    const t = await tier();
    const a = await variation(200_000);
    const b = await variation(200_000);
    for (const bad of ['185.5', '185', '25.000', '109.999', '250000']) {
      await expect(admin.importDealerPrices(adminId, t.id, { csv: `${a.sku},180.000\n${b.sku},${bad}` })).rejects.toThrow('Chưa ghi dòng nào');
    }
    await expect(admin.importDealerPrices(adminId, t.id, { csv: `${a.sku},180.000\n${a.sku},180.000` })).rejects.toThrow('Chưa ghi dòng nào');
    expect([await priceOf(a.id, t.id), await priceOf(b.id, t.id)]).toEqual([null, null]);
    expect(await prisma.dealerPriceHistory.count({ where: { tierId: t.id } })).toBe(0);
  });

  it('hai bậc nhập chồng nhau trên cùng biến thể: giữ giá của cả hai bậc (không ghi đè JSON cũ)', async () => {
    const vs = await Promise.all(Array.from({ length: 5 }, () => variation(200_000)));
    for (let round = 0; round < 5; round++) {
      const [t1, t2] = await Promise.all([tier(), tier()]);
      const results = await Promise.allSettled([
        admin.importDealerPrices(adminId, t1.id, { csv: vs.map((v) => `${v.sku},150.000`).join('\n') }),
        admin.importDealerPrices(adminId, t2.id, { csv: [...vs].reverse().map((v) => `${v.sku};160.000`).join('\n') }),
      ]);
      expect(summarize(results).errors).toEqual([]);
      for (const v of vs) {
        expect([await priceOf(v.id, t1.id), await priceOf(v.id, t2.id)]).toEqual([150_000, 160_000]);
      }
    }
  });
});
