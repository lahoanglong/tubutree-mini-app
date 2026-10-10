import { api } from './api';
import type { CategoryDTO, FlashSaleActiveItem, OrderView, PageResponse, ProductCard, PurchasedItemsPage, UpcomingFlashItem } from './shop-api';
import type { NotificationDTO } from './account-api';
import type { SubscriptionDTO } from './subscriptions-api';

/**
 * Trang chủ gộp request (C-037). Khi Trang chủ đang mở ("armed"), lần gọi ĐẦU TIÊN của từng service lẻ
 * (fetchCategories, fetchForYou, ...) được trả từ 2 request gộp `GET /home` + `GET /home/me` thay vì một
 * request riêng. Component và query key giữ nguyên.
 *
 * Mọi đường lỗi đều lùi về request lẻ: API cũ 404, lỗi mạng, khối null phía server, hoặc tham số lẻ không
 * khớp tham số mà endpoint gộp dùng. Mỗi khối chỉ dùng MỘT lần mỗi phiên mở Trang chủ — refetch định kỳ
 * và invalidate sau đó luôn đi request lẻ để lấy dữ liệu mới.
 */

type Block<T> = T | null | undefined;

export interface HomePublicDTO {
  bestSellers: Block<PageResponse<ProductCard>>;
  featured: Block<PageResponse<ProductCard>>;
  newest: Block<PageResponse<ProductCard>>;
  flashActive: Block<FlashSaleActiveItem[]>;
  categories: Block<CategoryDTO[]>;
  brands: Block<{ brand: string; count: number }[]>;
}

export interface HomeMeDTO {
  forYou: Block<ProductCard[]>;
  flashUpcoming: Block<UpcomingFlashItem[]>;
  purchasedItems: Block<PurchasedItemsPage>;
  activeOrderCount: Block<{ count?: unknown }>;
  shippingOrders: Block<PageResponse<OrderView>>;
  subscriptions: Block<SubscriptionDTO[]>;
  notifications: Block<NotificationDTO[]>;
  purchasedLimit?: number;
}

// Khớp HOME_PUBLIC phía API (apps/api/src/modules/catalog/home.service.ts) và SECTION_LIMIT của pages/home.tsx.
const SECTION_LIMIT = 6;
const FEATURED_LIMIT = SECTION_LIMIT * 2;
// Khớp PURCHASED_RAIL_LIMIT của kệ Mua lại; lệch thì wrapper tự lùi về request lẻ.
export const HOME_PURCHASED_LIMIT = 10;
const FEED_TIMEOUT_MS = 8_000;

interface Feed<T> {
  promise: Promise<T | null>;
  taken: Set<string>;
}
interface Session {
  pub: Feed<HomePublicDTO> | null;
  me: Feed<HomeMeDTO> | null;
}

let session: Session | null = null;

function startFeed<T>(url: string, params?: Record<string, number>): Feed<T> {
  const promise = api
    .get<T>(url, { params, timeout: FEED_TIMEOUT_MS })
    .then((r) => (r.data && typeof r.data === 'object' ? r.data : null))
    .catch(() => null);
  return { promise, taken: new Set() };
}

/** Gọi khi Trang chủ mount (trước khi các query con chạy). Idempotent. */
export function armHomeFeed(): void {
  session ??= { pub: null, me: null };
}

export function disarmHomeFeed(): void {
  session = null;
}

/** Kéo để làm mới: bỏ khối đã dùng, request gộp kế tiếp sẽ tải lại. */
export function resetHomeFeed(): void {
  if (session) session = { pub: null, me: null };
}

async function take<T extends object, K extends keyof T>(feed: Feed<T> | null, key: K): Promise<NonNullable<T[K]> | null> {
  if (!feed) return null;
  const data = await feed.promise;
  const value = data?.[key];
  if (value == null || feed.taken.has(String(key))) return null;
  feed.taken.add(String(key));
  return value as NonNullable<T[K]>;
}

function publicFeed(): Feed<HomePublicDTO> | null {
  if (!session) return null;
  return (session.pub ??= startFeed<HomePublicDTO>('/home'));
}

function meFeed(): Feed<HomeMeDTO> | null {
  if (!session) return null;
  return (session.me ??= startFeed<HomeMeDTO>('/home/me', { purchasedLimit: HOME_PURCHASED_LIMIT }));
}

export const takePublicBlock = <K extends keyof HomePublicDTO>(key: K) => take(publicFeed(), key);

export const takeMeBlock = <K extends Exclude<keyof HomeMeDTO, 'purchasedLimit'>>(key: K) => take(meFeed(), key);

/** Nhận diện lời gọi fetchProducts của 3 khối SP ở Trang chủ. */
export function homeProductSlot(params: Record<string, string | number>): 'bestSellers' | 'featured' | 'newest' | null {
  const keys = Object.keys(params);
  const { limit, sort } = params;
  if (keys.length === 2 && limit === SECTION_LIMIT && sort === 'best_seller') return 'bestSellers';
  if (keys.length === 2 && limit === SECTION_LIMIT && sort === 'newest') return 'newest';
  if (keys.length === 1 && limit === FEATURED_LIMIT) return 'featured';
  return null;
}

/** Kệ Mua lại chỉ dùng khối gộp khi hỏi đúng trang đầu với limit mà /home/me đã lấy. */
export async function takePurchasedItems(params: { cursor?: string; limit?: number; variationId?: string }): Promise<PurchasedItemsPage | null> {
  if (params.cursor || params.variationId || params.limit !== HOME_PURCHASED_LIMIT) return null;
  return takeMeBlock('purchasedItems');
}
