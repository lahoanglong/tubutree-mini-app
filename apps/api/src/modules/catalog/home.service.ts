import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PurchasedItemsService } from '../orders/purchased-items.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { buildPublicConfig, tierLoaderOf, type PublicConfigDTO } from '../system-config/public-config';
import { SystemConfigService } from '../system-config/system-config.service';
import { BundlesService, type BundleDTO } from '../bundles/bundles.service';
import { listLiveBanners, type CampaignBannerDTO } from '../campaigns/campaign-public';
import { paginated } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_ORDER_STATUSES } from '../orders/order-status-groups';
import { WASTE_OPEN_STATUSES } from '../waste-exchange/waste.constants';
import { CatalogService } from './catalog.service';
import { vnDateSeed } from './catalog-seed';
import type { ProductQuery } from './dto/product-query.dto';

// Phải khớp SECTION_LIMIT / FEATURED_FETCH_LIMIT của miniapp (pages/home.tsx): client chỉ dùng khối
// gộp khi tham số truy vấn lẻ của nó trùng đúng các giá trị này.
export const HOME_SECTION_LIMIT = 6;
export const HOME_FEATURED_LIMIT = HOME_SECTION_LIMIT * 2;
// Kệ Bán chạy nhất của Trang chủ lấy dư 2 món so với tối đa 10 của kệ để còn đủ sau khi bỏ món đã nằm ở kệ trên (Giờ vàng, Mua lại).
// Theo lượt bán 30 ngày, khớp HOME_BEST_SELLER_LIMIT của app-core (queries/home.ts) và homeProductSlot của Mini App.
export const HOME_BEST_SELLER_LIMIT = 12;
// Khớp HOME_COMBOS_LIMIT của app-core (queries/bundle.ts) và `maxItems` của kệ `home.combos`.
export const HOME_COMBOS_LIMIT = 4;

const PUBLIC_TTL_MS = 20_000;
// Flash sale: quota giảm theo từng đơn và giờ vàng bắt đầu/kết thúc đúng mốc nên không được tươi kém
// endpoint lẻ /flash-sales/active (header LIVE 5s/10s) — cache RAM chỉ đủ để gom request đồng thời.
const FLASH_TTL_MS = 3_000;
// Có khối lỗi thì cache ngắn để lần sau thử lại sớm, không giữ "null" cả 20s.
const PUBLIC_DEGRADED_TTL_MS = 3_000;
// Khối chậm quá hạn → null để client gọi lẻ khối đó, không giữ cả trang chờ.
const BLOCK_TIMEOUT_MS = 2_500;
const FACTS_TIMEOUT_MS = 1_000;
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
  // Tăng mỗi lần làm mới tay: lượt dựng đang bay lúc đó không được ghi bản cũ trở lại slot.
  private epoch = 0;
  private flashSlot = newSlot<Block<HomePublic['flashActive']>>();
  // Dựng tay thay vì inject: BundlesModule import CatalogModule (cardsByIds), nên CatalogModule không import ngược lại (như banner dùng `listLiveBanners(prisma)`).
  private readonly bundles: BundlesService;

  constructor(
    private readonly catalog: CatalogService,
    private readonly flashSale: FlashSaleService,
    private readonly orders: OrdersService,
    private readonly purchased: PurchasedItemsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly notifications: NotificationsService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly prisma: PrismaService,
  ) {
    this.bundles = new BundlesService(prisma, catalog, config);
  }

  private async block<T>(name: string, run: () => Promise<T>, deadline: number = Date.now() + BLOCK_TIMEOUT_MS): Promise<Block<T>> {
    const budget = Math.max(0, deadline - Date.now());
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`quá ${BLOCK_TIMEOUT_MS}ms`)), budget);
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
    return { ...stat, flashActive: this.withServerNow(flashActive, now) };
  }

  // Cache 3s không được làm đồng hồ máy chủ cũ theo: app dùng serverNow để bù lệch giờ khi đếm ngược Giờ vàng.
  private withServerNow(flash: Block<HomePublic['flashActive']>, now: number): Block<HomePublic['flashActive']> {
    if (!Array.isArray(flash)) return flash;
    const serverNow = new Date(now).toISOString();
    return flash.map((it) => ('serverNow' in it ? { ...it, serverNow } : it)) as typeof flash;
  }

  /** Bỏ phần tĩnh đã nhớ (danh mục, nhãn...) để lần gọi kế tiếp dựng lại; admin đổi cây danh mục gọi hàm này. */
  invalidateStatic(): void {
    this.epoch++;
    this.staticSlot.value = null;
    this.staticSlot.inflight = null;
  }

  private async cached<T>(slot: Slot<T>, now: number, ttlMs: number, build: () => Promise<T>): Promise<T> {
    if (slot.value && slot.value.expiresAt > now) return slot.value.data;
    const epoch = this.epoch;
    // Nhiều request cùng lúc khi cache hết hạn dùng chung một lần dựng, không đổ dồn xuống DB.
    const inflight = (slot.inflight ??= build().finally(() => {
      if (slot.inflight === inflight) slot.inflight = null;
    }));
    const data = await inflight;
    const degraded = data === null || (typeof data === 'object' && Object.values(data).some((v) => v === null));
    if (epoch === this.epoch) slot.value = { data, expiresAt: now + (degraded ? Math.min(ttlMs, PUBLIC_DEGRADED_TTL_MS) : ttlMs) };
    return data;
  }

  private async buildStatic(): Promise<HomeStatic> {
    const [bestSellers, featured, newest, categories, brands, publicConfig, campaigns, combos] = await Promise.all([
      this.block('bestSellers', () => this.catalog.list(productQuery({ limit: HOME_BEST_SELLER_LIMIT, sort: 'best_seller_30d' }))),
      this.block('featured', () => this.catalog.list(productQuery({ limit: HOME_FEATURED_LIMIT }))),
      this.block('newest', () => this.catalog.list(productQuery({ sort: 'newest' }))),
      this.block('categories', () => this.catalog.categories()),
      this.block('brands', () => this.catalog.brands()),
      // Khối "Quà khách mới" cần số công khai: gộp vào đây để mở Trang chủ không tốn thêm request /config/public.
      this.block('publicConfig', () => buildPublicConfig(this.config, tierLoaderOf(this.prisma))),
      // Banner đầu Trang chủ: không lọc đối tượng ở đây vì blob dùng chung cho mọi khách; app-core lọc NEW/RETURNING theo loại khách.
      this.block('campaigns', () => listLiveBanners(this.prisma, 'HOME_TOP')),
      // Kệ combo toàn sàn: cùng dữ liệu `GET /bundles/combos?limit=4`, gộp vào đây để Trang chủ không tốn thêm request.
      this.block('combos', () => this.bundles.homeCombos(HOME_COMBOS_LIMIT)),
    ]);
    return { bestSellers, featured, newest, categories, brands, publicConfig, campaigns, combos };
  }

  /**
   * Số đơn theo trạng thái và số yêu cầu đổi rác đang mở của khách, MỘT câu SQL: các khối đếm đơn, kệ Mua lại, gợi ý và ưu đãi
   * khách mới đều chỉ cần biết "có đơn không / có đơn giao không / đang chờ bao nhiêu".
   */
  private async userFacts(userId: string): Promise<UserFacts> {
    const rows = await this.prisma.$queryRaw<{ kind: string; key: string; n: number }[]>(Prisma.sql`
      SELECT 'order' AS kind, o.status::text AS key, COUNT(*)::int AS n FROM orders o WHERE o."userId" = ${userId} GROUP BY o.status
      UNION ALL
      SELECT 'waste', 'open', COUNT(*)::int FROM waste_requests w WHERE w."userId" = ${userId} AND w.status::text IN (${Prisma.join([...WASTE_OPEN_STATUSES])})`);
    const byStatus = new Map<string, number>();
    let wasteOpen = 0;
    for (const r of rows) {
      if (r.kind === 'order') byStatus.set(r.key, r.n);
      else wasteOpen = r.n;
    }
    const count = (statuses: readonly string[]) => statuses.reduce((s, st) => s + (byStatus.get(st) ?? 0), 0);
    return {
      hasOrders: count([...byStatus.keys()]) > 0,
      hasPriorOrder: count([...byStatus.keys()].filter((k) => k !== 'CANCELLED')) > 0,
      delivered: count(['DELIVERED']),
      shipping: count(['SHIPPING']),
      active: count(ACTIVE_ORDER_STATUSES),
      wasteOpen,
    };
  }

  /**
   * Số đếm của khách với hạn riêng ngắn hơn hạn của khối: lỗi hoặc quá hạn thì trả null và các khối dùng đường gọi thẳng
   * từng dịch vụ như trước, nên một câu đếm chậm không kéo cả sáu khối thành null.
   */
  private async userFactsOrNull(userId: string): Promise<UserFacts | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.userFacts(userId),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), FACTS_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      this.logger.warn(`Số đếm của khách lỗi, các khối gọi thẳng dịch vụ: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Phần theo người dùng — KHÔNG cache dùng chung. */
  async getForUser(userId: string, purchasedLimit: number = DEFAULT_PURCHASED_LIMIT, now: number = Date.now()): Promise<HomeMe> {
    // Một hạn chung cho cả request: thời gian chờ số đếm ăn vào hạn của mọi khối, nên tổng không vượt BLOCK_TIMEOUT_MS (Mini chỉ chờ 4 s).
    const deadline = Date.now() + BLOCK_TIMEOUT_MS;
    const seed = vnDateSeed(now);
    const facts = this.userFactsOrNull(userId);
    const own = <T>(name: string, run: () => Promise<T>) => this.block(name, run, deadline);
    const withFacts = <T>(name: string, run: (f: UserFacts | null) => Promise<T>) => facts.then((f) => this.block(name, () => run(f), deadline));
    const [forYou, flashUpcoming, purchasedItems, activeOrderCount, shippingOrders, subscriptions, notifications, newCustomerOffer, wasteOpenRequestCount] = await Promise.all([
      withFacts('forYou', (f) => (f ? this.catalog.getForYou(userId, { hasOrders: f.hasOrders, seed }) : this.catalog.getForYou(userId, { seed }))),
      own('flashUpcoming', () => this.flashSale.listUpcoming(userId)),
      withFacts('purchasedItems', async (f) => (f && f.delivered === 0 ? { items: [], nextCursor: null } : this.purchased.list(userId, { limit: purchasedLimit }))),
      withFacts('activeOrderCount', async (f) => (f ? { count: f.active } : this.orders.activeCount(userId))),
      withFacts('shippingOrders', async (f) => (f && f.shipping === 0 ? paginated([], 1, 1, 0) : this.orders.list(userId, { status: 'SHIPPING' }, 1, 1))),
      own('subscriptions', () => this.subscriptions.list(userId)),
      own('notifications', () => this.notifications.listForUser(userId)),
      // Đã có đơn chưa huỷ thì kết quả luôn là "không phải khách mới", dù tài khoản thật hay khách vãng lai: khỏi đọc khách và đơn thêm lần nữa.
      withFacts('newCustomerOffer', async (f) => (f?.hasPriorOrder ? { isNewCustomer: false as const, welcomeVoucher: null } : this.loyalty.getNewCustomerOffer(userId, f ? { hasPriorOrder: false } : {}))),
      // Chỉ một câu đếm (không gọi /waste/me nặng): để Trang chủ/Ưu đãi giữ lối vào Đổi rác cho khách còn yêu cầu mở khi chương trình tạm dừng.
      withFacts('wasteOpenRequestCount', async (f) => f?.wasteOpen ?? this.prisma.wasteRequest.count({ where: { userId, status: { in: [...WASTE_OPEN_STATUSES] } } })),
    ]);
    return { forYou, flashUpcoming, purchasedItems, activeOrderCount, shippingOrders, subscriptions, notifications, newCustomerOffer, wasteOpenRequestCount, purchasedLimit };
  }
}

interface UserFacts {
  hasOrders: boolean;
  hasPriorOrder: boolean;
  delivered: number;
  shipping: number;
  active: number;
  wasteOpen: number;
}

type Awaited2<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>;

export interface HomePublic {
  bestSellers: Block<Awaited2<CatalogService['list']>>;
  featured: Block<Awaited2<CatalogService['list']>>;
  newest: Block<Awaited2<CatalogService['list']>>;
  flashActive: Block<Awaited2<FlashSaleService['listActive']>>;
  categories: Block<Awaited2<CatalogService['categories']>>;
  brands: Block<Awaited2<CatalogService['brands']>>;
  publicConfig: Block<PublicConfigDTO>;
  campaigns: Block<CampaignBannerDTO[]>;
  combos: Block<BundleDTO[]>;
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
  newCustomerOffer: Block<Awaited2<LoyaltyService['getNewCustomerOffer']>>;
  /** Số yêu cầu đổi rác đang mở (OPEN, IN_TRANSIT, RECEIVED) của khách; API cũ không có trường này. */
  wasteOpenRequestCount: Block<number>;
  /** Giới hạn đã dùng cho kệ Mua lại — client đối chiếu với tham số lẻ của nó. */
  purchasedLimit: number;
}
