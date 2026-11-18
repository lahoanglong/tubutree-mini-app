import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import {
  MERCH_BEST_SELLER_MIN_PRODUCTS_DEFAULT,
  MERCH_BEST_SELLER_MIN_PRODUCTS_KEY,
  MERCH_BEST_SELLER_MIN_SOLD_DEFAULT,
  MERCH_BEST_SELLER_MIN_SOLD_KEY,
  MERCH_SHELF_MAX_PINS,
  MERCH_SHELVES_ENABLED_KEY,
  isCuratedBasis,
  pinInWindow,
  sanitizeCount,
  type PinWindow,
} from './merch-shelf';

/** Cùng luật "còn hàng" với bộ lọc `inStock` và thẻ: có phân loại đang bán còn tồn. */
export const PIN_SELLABLE_WHERE = { ...PUBLIC_PRODUCT_WHERE, variations: { some: { isActive: true, stock: { gt: 0 } } } } as const;

const TTL_MS = 60_000;
const MAX_KEYS = 200;

type PinRow = PinWindow & { productId: string };

/**
 * Phần đọc của Xếp kệ cho đường khách: cờ, món ghim còn bán và còn hàng của một kệ, và kệ Bán chạy nhất đã đủ số bán chưa. Nhớ 60 giây theo instance
 * (cùng hạn chế với các bộ nhớ khác của CatalogService); admin lưu kệ thì `invalidate()` trên instance nhận lệnh. Khung giờ ghim xét lúc đọc, không
 * theo lúc nhớ, nên món hết giờ rơi khỏi kệ đúng mốc. Đọc lỗi thì coi như không có ghim: kệ giữ thứ tự cũ, không làm hỏng danh sách.
 */
export class MerchShelfReader {
  private readonly logger = new Logger(MerchShelfReader.name);
  private readonly pins = new Map<string, { rows: PinRow[]; expiresAt: number }>();
  private curated: { value: boolean; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: Pick<PrismaService, 'merchShelfPin' | 'product'>,
    private readonly config?: Pick<SystemConfigService, 'get'>,
  ) {}

  invalidate(): void {
    this.pins.clear();
    this.curated = null;
  }

  async enabled(): Promise<boolean> {
    if (!this.config) return false;
    try {
      return (await this.config.get<unknown>(MERCH_SHELVES_ENABLED_KEY, false)) === true;
    } catch {
      return false;
    }
  }

  /** Id món ghim đang hiệu lực của kệ, theo `position`. */
  async livePins(key: string, now: Date = new Date()): Promise<string[]> {
    const rows = await this.pinRows(key, now.getTime());
    return rows.filter((r) => pinInWindow(r, now)).map((r) => r.productId);
  }

  /** Kệ Bán chạy nhất chưa đủ số bán thật (`merch.best_seller_min_products` sản phẩm có từ `merch.best_seller_min_sold` lượt bán 30 ngày). */
  async isCurated(nowMs: number = Date.now()): Promise<boolean> {
    if (this.curated && this.curated.expiresAt > nowMs) return this.curated.value;
    try {
      const [rawProducts, rawSold] = await Promise.all([
        this.config?.get<unknown>(MERCH_BEST_SELLER_MIN_PRODUCTS_KEY, MERCH_BEST_SELLER_MIN_PRODUCTS_DEFAULT),
        this.config?.get<unknown>(MERCH_BEST_SELLER_MIN_SOLD_KEY, MERCH_BEST_SELLER_MIN_SOLD_DEFAULT),
      ]);
      const minProducts = sanitizeCount(rawProducts, MERCH_BEST_SELLER_MIN_PRODUCTS_DEFAULT, 1000);
      const minSold = sanitizeCount(rawSold, MERCH_BEST_SELLER_MIN_SOLD_DEFAULT, 1_000_000);
      const withSales = await this.prisma.product.count({ where: { ...PUBLIC_PRODUCT_WHERE, soldApp30d: { gte: minSold } } });
      const value = isCuratedBasis(withSales, minProducts);
      this.curated = { value, expiresAt: nowMs + TTL_MS };
      return value;
    } catch (err) {
      this.logger.warn(`Không đọc được số bán cho kệ Bán chạy nhất: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async pinRows(key: string, nowMs: number): Promise<PinRow[]> {
    const hit = this.pins.get(key);
    if (hit && hit.expiresAt > nowMs) return hit.rows;
    try {
      const rows = await this.prisma.merchShelfPin.findMany({
        where: { shelfKey: key, product: PIN_SELLABLE_WHERE },
        orderBy: [{ position: 'asc' }, { productId: 'asc' }],
        select: { productId: true, startsAt: true, endsAt: true },
        take: MERCH_SHELF_MAX_PINS,
      });
      if (this.pins.size >= MAX_KEYS) this.pins.delete(this.pins.keys().next().value as string);
      this.pins.set(key, { rows, expiresAt: nowMs + TTL_MS });
      return rows;
    } catch (err) {
      this.logger.warn(`Không đọc được món ghim của kệ "${key}": ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
}
