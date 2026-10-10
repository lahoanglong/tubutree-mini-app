import { Injectable, Logger } from '@nestjs/common';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PurchasedItemsService } from '../orders/purchased-items.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CatalogService } from './catalog.service';
import type { ProductQuery } from './dto/product-query.dto';

// Phải khớp SECTION_LIMIT / FEATURED_FETCH_LIMIT của miniapp (pages/home.tsx): client chỉ dùng khối
// gộp khi tham số truy vấn lẻ của nó trùng đúng các giá trị này.
export const HOME_SECTION_LIMIT = 6;
export const HOME_FEATURED_LIMIT = HOME_SECTION_LIMIT * 2;

const PUBLIC_TTL_MS = 20_000;
// Có khối lỗi thì cache ngắn để lần sau thử lại sớm, không giữ "null" cả 20s.
const PUBLIC_DEGRADED_TTL_MS = 3_000;
const DEFAULT_PURCHASED_LIMIT = 10;

const productQuery = (extra: Partial<ProductQuery>) => ({ page: 1, limit: HOME_SECTION_LIMIT, ...extra }) as ProductQuery;

type Block<T> = T | null;

/**
 * Gộp các khối của Trang chủ vào một request. Mỗi khối chịu lỗi độc lập: khối lỗi → null (client
 * tự gọi lẻ khối đó), không làm hỏng cả trang.
 */
@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);
  private publicCache: { value: HomePublic; expiresAt: number } | null = null;
  private publicInflight: Promise<HomePublic> | null = null;

  constructor(
    private readonly catalog: CatalogService,
    private readonly flashSale: FlashSaleService,
    private readonly orders: OrdersService,
    private readonly purchased: PurchasedItemsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async block<T>(name: string, run: () => Promise<T>): Promise<Block<T>> {
    try {
      return await run();
    } catch (err) {
      this.logger.warn(`Khối Home "${name}" lỗi: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Phần không theo người dùng — dữ liệu y hệt các endpoint công khai lẻ (không giá sỉ, không PII)
   * nên cache chung một bản trong RAM.
   *
   * Cache PER-INSTANCE như brands/categories trong CatalogService: chạy ≥2 replica thì chuyển sang Redis.
   */
  async getPublic(now: number = Date.now()): Promise<HomePublic> {
    if (this.publicCache && this.publicCache.expiresAt > now) return this.publicCache.value;
    // Nhiều request cùng lúc khi cache hết hạn dùng chung một lần dựng, không đổ dồn xuống DB.
    this.publicInflight ??= this.buildPublic().finally(() => {
      this.publicInflight = null;
    });
    const value = await this.publicInflight;
    const degraded = Object.values(value).some((v) => v === null);
    this.publicCache = { value, expiresAt: now + (degraded ? PUBLIC_DEGRADED_TTL_MS : PUBLIC_TTL_MS) };
    return value;
  }

  private async buildPublic(): Promise<HomePublic> {
    const [bestSellers, featured, newest, flashActive, categories, brands] = await Promise.all([
      this.block('bestSellers', () => this.catalog.list(productQuery({ sort: 'best_seller' }))),
      this.block('featured', () => this.catalog.list(productQuery({ limit: HOME_FEATURED_LIMIT }))),
      this.block('newest', () => this.catalog.list(productQuery({ sort: 'newest' }))),
      this.block('flashActive', () => this.flashSale.listActive()),
      this.block('categories', () => this.catalog.categories()),
      this.block('brands', () => this.catalog.brands()),
    ]);
    return { bestSellers, featured, newest, flashActive, categories, brands };
  }

  /** Phần theo người dùng — KHÔNG cache dùng chung. */
  async getForUser(userId: string, purchasedLimit: number = DEFAULT_PURCHASED_LIMIT): Promise<HomeMe> {
    const [forYou, flashUpcoming, purchasedItems, activeOrderCount, shippingOrders, subscriptions, notifications] = await Promise.all([
      this.block('forYou', () => this.catalog.getForYou(userId)),
      this.block('flashUpcoming', () => this.flashSale.listUpcoming(userId)),
      this.block('purchasedItems', () => this.purchased.list(userId, { limit: purchasedLimit })),
      this.block('activeOrderCount', () => this.orders.activeCount(userId)),
      this.block('shippingOrders', () => this.orders.list(userId, { status: 'SHIPPING' }, 1, 1)),
      this.block('subscriptions', () => this.subscriptions.list(userId)),
      this.block('notifications', () => this.notifications.listForUser(userId)),
    ]);
    return { forYou, flashUpcoming, purchasedItems, activeOrderCount, shippingOrders, subscriptions, notifications, purchasedLimit };
  }
}

type Awaited2<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>;

export interface HomePublic {
  bestSellers: Block<Awaited2<CatalogService['list']>>;
  featured: Block<Awaited2<CatalogService['list']>>;
  newest: Block<Awaited2<CatalogService['list']>>;
  flashActive: Block<Awaited2<FlashSaleService['listActive']>>;
  categories: Block<Awaited2<CatalogService['categories']>>;
  brands: Block<Awaited2<CatalogService['brands']>>;
}

export interface HomeMe {
  forYou: Block<Awaited2<CatalogService['getForYou']>>;
  flashUpcoming: Block<Awaited2<FlashSaleService['listUpcoming']>>;
  purchasedItems: Block<Awaited2<PurchasedItemsService['list']>>;
  activeOrderCount: Block<Awaited2<OrdersService['activeCount']>>;
  shippingOrders: Block<Awaited2<OrdersService['list']>>;
  subscriptions: Block<Awaited2<SubscriptionsService['list']>>;
  notifications: Block<Awaited2<NotificationsService['listForUser']>>;
  /** Giới hạn đã dùng cho kệ Mua lại — client đối chiếu với tham số lẻ của nó. */
  purchasedLimit: number;
}
