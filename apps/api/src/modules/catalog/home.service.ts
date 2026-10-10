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
// Flash sale: quota giảm theo từng đơn và giờ vàng bắt đầu/kết thúc đúng mốc nên không được tươi kém
// endpoint lẻ /flash-sales/active (header LIVE 5s/10s) — cache RAM chỉ đủ để gom request đồng thời.
const FLASH_TTL_MS = 3_000;
// Có khối lỗi thì cache ngắn để lần sau thử lại sớm, không giữ "null" cả 20s.
const PUBLIC_DEGRADED_TTL_MS = 3_000;
// Khối chậm quá hạn → null để client gọi lẻ khối đó, không giữ cả trang chờ.
const BLOCK_TIMEOUT_MS = 2_500;
const DEFAULT_PURCHASED_LIMIT = 10;

const productQuery = (extra: Partial<ProductQuery>) => ({ page: 1, limit: HOME_SECTION_LIMIT, ...extra }) as ProductQuery;

type Block<T> = T | null;

interface Slot<T> {
  value: { data: T; expiresAt: number } | null;
  inflight: Promise<T> | null;
}
const newSlot = <T>(): Slot<T> => ({ value: null, inflight: null });

/**
 * Gộp các khối của Trang chủ vào một request. Mỗi khối chịu lỗi độc lập: khối lỗi → null (client
 * tự gọi lẻ khối đó), không làm hỏng cả trang.
 */
@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);
  private staticSlot = newSlot<HomeStatic>();
  private flashSlot = newSlot<Block<HomePublic['flashActive']>>();

  constructor(
    private readonly catalog: CatalogService,
    private readonly flashSale: FlashSaleService,
    private readonly orders: OrdersService,
    private readonly purchased: PurchasedItemsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async block<T>(name: string, run: () => Promise<T>): Promise<Block<T>> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`quá ${BLOCK_TIMEOUT_MS}ms`)), BLOCK_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      this.logger.warn(`Khối Home "${name}" lỗi: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Phần không theo người dùng — dữ liệu y hệt các endpoint công khai lẻ (không giá sỉ, không PII)
   * nên cache chung trong RAM. Flash sale có TTL riêng ngắn hơn hẳn phần còn lại.
   *
   * Cache PER-INSTANCE như brands/categories trong CatalogService: chạy ≥2 replica thì chuyển sang Redis.
   */
  async getPublic(now: number = Date.now()): Promise<HomePublic> {
    const [stat, flashActive] = await Promise.all([
      this.cached(this.staticSlot, now, PUBLIC_TTL_MS, () => this.buildStatic()),
      this.cached(this.flashSlot, now, FLASH_TTL_MS, () => this.block('flashActive', () => this.flashSale.listActive())),
    ]);
    return { ...stat, flashActive };
  }

  private async cached<T>(slot: Slot<T>, now: number, ttlMs: number, build: () => Promise<T>): Promise<T> {
    if (slot.value && slot.value.expiresAt > now) return slot.value.data;
    // Nhiều request cùng lúc khi cache hết hạn dùng chung một lần dựng, không đổ dồn xuống DB.
    slot.inflight ??= build().finally(() => {
      slot.inflight = null;
    });
    const data = await slot.inflight;
    const degraded = data === null || (typeof data === 'object' && Object.values(data).some((v) => v === null));
    slot.value = { data, expiresAt: now + (degraded ? Math.min(ttlMs, PUBLIC_DEGRADED_TTL_MS) : ttlMs) };
    return data;
  }

  private async buildStatic(): Promise<HomeStatic> {
    const [bestSellers, featured, newest, categories, brands] = await Promise.all([
      this.block('bestSellers', () => this.catalog.list(productQuery({ sort: 'best_seller' }))),
      this.block('featured', () => this.catalog.list(productQuery({ limit: HOME_FEATURED_LIMIT }))),
      this.block('newest', () => this.catalog.list(productQuery({ sort: 'newest' }))),
      this.block('categories', () => this.catalog.categories()),
      this.block('brands', () => this.catalog.brands()),
    ]);
    return { bestSellers, featured, newest, categories, brands };
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

type HomeStatic = Omit<HomePublic, 'flashActive'>;

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
