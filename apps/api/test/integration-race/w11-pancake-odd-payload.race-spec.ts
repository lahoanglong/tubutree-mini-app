import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogSyncBusyError, PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { pancakeDedupeKey, PANCAKE_STOCK_EVENT } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { randCode, warmPool } from './helpers';

/**
 * W11: payload Pancake thiếu trường hoặc kiểu lạ đi qua đồng bộ danh mục và webhook tồn kho trên Postgres THẬT. Mock Prisma không
 * chứng minh được gì ở đây: chính Prisma/Postgres mới là nơi từ chối `weight` kiểu chuỗi, tồn kho vượt Int, sku trùng. Luôn truyền
 * `updatedSince` để lượt đồng bộ không quét toàn bộ và tắt hàng của các spec khác trong cùng DB.
 */
describe('Payload Pancake kiểu lạ không làm hỏng đồng bộ và tồn kho (real Postgres)', () => {
  const SINCE = '2026-11-06T00:00:00.000Z';
  let prisma: PrismaService;
  let proc: PancakeProcessor;
  const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    proc = new PancakeProcessor(
      prisma,
      { notify: jest.fn(), notifySafe: jest.fn().mockResolvedValue(true) } as unknown as NotificationsService,
      {} as OrderStatusService,
      { alert: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Khoá cron_leases nhả bằng now() làm tròn lên mili giây, nên lượt gọi ngay sau (dưới nửa mili giây) có thể còn thấy khoá: thử lại
   * thay vì để spec chớp nháy.
   */
  async function sync(rows: unknown[]): Promise<number> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await service(rows).syncProducts(SINCE);
      } catch (e) {
        if (!(e instanceof CatalogSyncBusyError) || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }

  /** Một trang dữ liệu rồi trang rỗng, kèm total_pages/total_entries như Pancake thật. */
  function service(rows: unknown[]) {
    const client = {
      isConfigured: () => true,
      fetchProducts: jest
        .fn()
        .mockResolvedValueOnce({ success: true, data: rows, total_pages: 1, total_entries: rows.length })
        .mockResolvedValue({ success: true, data: [], total_pages: 1, total_entries: rows.length }),
    } as unknown as PancakeClient;
    return new PancakeSyncService(prisma, client, lifecycle);
  }

  async function ownVariation(data: { pancakeStock: number; stock: number }) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `w11-op-${tag}`, brand: 'IT', slug: `w11-op-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const variation = await prisma.variation.create({
      data: { pancakeId: `w11-ov-${tag}`, productId: product.id, sku: `w11-os-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, reservedStock: 0, ...data },
    });
    return { product, variation };
  }

  it('đối chứng: Prisma từ chối weight kiểu chuỗi, Postgres từ chối tồn kho vượt cột Int, weight lẻ bị cắt âm thầm — đúng các giá trị mà đồng bộ phải tự chuẩn hoá', async () => {
    const { product, variation } = await ownVariation({ pancakeStock: 1, stock: 1 });
    const tag = randCode(6);
    const base = { productId: product.id, name: 'x', attributes: {}, retailPrice: 1000 };
    await expect(prisma.variation.create({ data: { ...base, pancakeId: `w11-ctl-a-${tag}`, sku: `w11-ctl-a-${tag}`, weight: '250' as never } })).rejects.toThrow();
    const truncated = await prisma.variation.create({ data: { ...base, pancakeId: `w11-ctl-b-${tag}`, sku: `w11-ctl-b-${tag}`, weight: 250.5 } });
    expect(truncated.weight).toBe(250);
    await expect(prisma.$executeRaw`UPDATE "variations" SET "pancakeStock" = ${1e12} WHERE "id" = ${variation.id}`).rejects.toThrow();
  });

  it('một lượt lẫn phần tử rác, variations không phải mảng, biến thể mã rác, giá/tồn/weight/sku kiểu lạ: ghi đúng, không sản phẩm nào lỗi', async () => {
    const tag = randCode(8);
    const numericId = 2_000_000_000 + Math.floor(Math.random() * 90_000_000);
    const rows = [
      null,
      'rác',
      { id: `w11-A-${tag}`, name: `Sản phẩm A ${tag}`, variations: 'x', description: { vi: 'object' }, images: 'https://img.test/a.jpg' },
      {
        id: `w11-B-${tag}`,
        name: `Sản phẩm B ${tag}`,
        images: { 0: 'x' },
        variations: [
          { id: `w11-B1-${tag}`, sku: '', retail_price: '269000', sale_price: '199000', weight: 250.5, remain_quantity: '7', fields: [{ name: 'PHÂN LOẠI', value: '1 chai' }], images: ['https://img.test/b1.jpg'] },
          { id: { a: 1 }, sku: `w11-skip-${tag}`, retail_price: 1000 },
          { id: `w11-B3-${tag}`, sku: `W11-B3-${tag}`, retail_price: 100000, remain_quantity: -3, weight: -5 },
          { id: `w11-B4-${tag}`, retail_price: '12.000', remain_quantity: 1e12, sale_price: {} },
          { id: numericId, sku: {}, retail_price: 50000, remain_quantity: 4, is_removed: 'false' },
        ],
      },
    ];
    const synced = await sync(rows);
    expect(synced).toBe(2);

    const a = await prisma.product.findUniqueOrThrow({ where: { pancakeId: `w11-A-${tag}` }, include: { variations: true } });
    expect(a.variations).toHaveLength(0);
    expect(a.description).toBe('');
    expect(a.images).toEqual(['https://img.test/a.jpg']);

    const b = await prisma.product.findUniqueOrThrow({ where: { pancakeId: `w11-B-${tag}` } });
    expect(b.images).toEqual(['https://img.test/b1.jpg']);
    expect(b.basePrice).toBe(269000);
    const v = (pid: string) => prisma.variation.findUniqueOrThrow({ where: { pancakeId: pid } });

    expect(await v(`w11-B1-${tag}`)).toMatchObject({ sku: `w11-B1-${tag}`, retailPrice: 269000, salePrice: 199000, weight: 251, stock: 7, pancakeStock: 7, name: '1 chai', isActive: true });
    expect(await v(`w11-B3-${tag}`)).toMatchObject({ stock: 0, pancakeStock: 0, weight: null, sku: `W11-B3-${tag}` });
    expect(await v(`w11-B4-${tag}`)).toMatchObject({ retailPrice: 0, salePrice: null, isActive: false, pancakeHold: 'NO_PRICE', stock: 0, pancakeStock: 0 });
    expect(await v(String(numericId))).toMatchObject({ sku: String(numericId), retailPrice: 50000, stock: 4, isActive: true });
    expect(await prisma.variation.count({ where: { sku: `w11-skip-${tag}` } })).toBe(0);
  });

  it('biến thể đã có: remain_quantity rác không đụng tồn kho; số âm đưa tồn về 0; số vượt cột Int bị bỏ; số hợp lệ áp bình thường', async () => {
    const tag = randCode(8);
    const row = (remain: unknown) => [{ id: `w11-U-${tag}`, name: `Sản phẩm U ${tag}`, variations: [{ id: `w11-UV-${tag}`, sku: `W11-UV-${tag}`, retail_price: 80000, remain_quantity: remain }] }];
    const stockOf = () => prisma.variation.findUniqueOrThrow({ where: { pancakeId: `w11-UV-${tag}` }, select: { stock: true, pancakeStock: true } });

    expect(await sync(row(10))).toBe(1);
    expect(await stockOf()).toEqual({ stock: 10, pancakeStock: 10 });

    for (const junk of ['', 'abc', {}, [], true, 1e12, '1e3']) {
      expect(await sync(row(junk))).toBe(1);
      expect(await stockOf()).toEqual({ stock: 10, pancakeStock: 10 });
    }

    expect(await sync(row('6'))).toBe(1);
    expect(await stockOf()).toEqual({ stock: 6, pancakeStock: 6 });

    expect(await sync(row(-3))).toBe(1);
    expect(await stockOf()).toEqual({ stock: 0, pancakeStock: 0 });
  });

  it('một biến thể lỗi khi ghi (sku trùng) không chặn các biến thể còn lại của sản phẩm, sản phẩm tính là lỗi', async () => {
    const tag = randCode(8);
    const { variation: taken } = await ownVariation({ pancakeStock: 1, stock: 1 });
    const rows = [
      {
        id: `w11-D-${tag}`,
        name: `Sản phẩm D ${tag}`,
        variations: [
          { id: `w11-D1-${tag}`, sku: taken.sku, retail_price: 1000, remain_quantity: 1 },
          { id: `w11-D2-${tag}`, sku: `W11-D2-${tag}`, retail_price: 2000, remain_quantity: 2 },
        ],
      },
    ];
    expect(await sync(rows)).toBe(0);
    expect(await prisma.variation.findUnique({ where: { pancakeId: `w11-D1-${tag}` } })).toBeNull();
    expect(await prisma.variation.findUniqueOrThrow({ where: { pancakeId: `w11-D2-${tag}` } })).toMatchObject({ retailPrice: 2000, stock: 2 });
  });

  describe('webhook tồn kho', () => {
    async function stockEvent(pancakeId: string, payload: Record<string, unknown>) {
      const body = { event: PANCAKE_STOCK_EVENT, data: { variation_id: pancakeId, ...payload } };
      const event = await prisma.pancakeWebhookEvent.create({
        data: { eventType: PANCAKE_STOCK_EVENT, dedupeKey: pancakeDedupeKey(PANCAKE_STOCK_EVENT, body), rawPayload: body, status: 'RECEIVED', receivedAt: new Date() },
      });
      await proc.process({ data: { eventId: event.id } } as Job<{ eventId: string }>);
      return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    }

    it.each([[''], ['   '], [true], [[]], [{}], ['abc'], [1e12], [-1], ['1e3']])('remain_quantity=%j: tồn kho không đổi, sự kiện PROCESSED', async (raw) => {
      const { variation } = await ownVariation({ pancakeStock: 12, stock: 12 });
      const event = await stockEvent(variation.pancakeId!, { remain_quantity: raw });
      expect(event.status).toBe('PROCESSED');
      expect(await prisma.variation.findUniqueOrThrow({ where: { id: variation.id }, select: { stock: true, pancakeStock: true } })).toEqual({ stock: 12, pancakeStock: 12 });
    });

    it('chuỗi số và số lẻ được áp (bỏ phần lẻ); updated_at ở tương lai xa không chặn webhook thật sau đó', async () => {
      const { variation } = await ownVariation({ pancakeStock: 12, stock: 12 });
      await stockEvent(variation.pancakeId!, { remain_quantity: '9.9', updated_at: '2099-01-01T00:00:00Z' });
      expect(await prisma.variation.findUniqueOrThrow({ where: { id: variation.id }, select: { stock: true, pancakeStock: true, pancakeStockEventAt: true } })).toEqual({
        stock: 9,
        pancakeStock: 9,
        pancakeStockEventAt: null,
      });
      await stockEvent(variation.pancakeId!, { remain_quantity: 5, updated_at: '2026-11-06T08:00:00Z' });
      expect(await prisma.variation.findUniqueOrThrow({ where: { id: variation.id }, select: { stock: true } })).toEqual({ stock: 5 });
    });
  });
});
