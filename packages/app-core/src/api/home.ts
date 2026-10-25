import type { HttpClient } from '../http';
import type { CategoryDTO, PageResponse, ProductCard } from './catalog';
import type { NotificationDTO } from './account';
import type { PublicConfig } from './config';
import type { FlashSaleActiveItem, UpcomingFlashItem } from './flash-sale';
import type { NewCustomerOffer } from './loyalty';
import type { OrderView, PurchasedItemsPage } from './orders';
import type { SubscriptionDTO } from './subscriptions';

/**
 * Trang chủ gộp request (C-037): `GET /home` (công khai) và `GET /home/me` (cá nhân). Chỉ phần gọi API; việc
 * "nhận từng khối một lần" và lùi về request lẻ là cơ chế của Mini App, không nằm ở đây.
 */
type Block<T> = T | null | undefined;

export interface HomePublicDTO {
  bestSellers: Block<PageResponse<ProductCard>>;
  featured: Block<PageResponse<ProductCard>>;
  newest: Block<PageResponse<ProductCard>>;
  flashActive: Block<FlashSaleActiveItem[]>;
  categories: Block<CategoryDTO[]>;
  brands: Block<{ brand: string; count: number }[]>;
  /** Cùng nội dung GET /config/public: khối "Quà khách mới" cần số công khai mà không tốn thêm request khi mở Trang chủ. */
  publicConfig: Block<PublicConfig>;
}

export interface HomeMeDTO {
  forYou: Block<ProductCard[]>;
  flashUpcoming: Block<UpcomingFlashItem[]>;
  purchasedItems: Block<PurchasedItemsPage>;
  activeOrderCount: Block<{ count?: unknown }>;
  shippingOrders: Block<PageResponse<OrderView>>;
  subscriptions: Block<SubscriptionDTO[]>;
  notifications: Block<NotificationDTO[]>;
  newCustomerOffer: Block<NewCustomerOffer>;
  /** Số yêu cầu đổi rác đang mở của khách (một câu đếm phía API). API cũ không có trường này: coi là 0. */
  wasteOpenRequestCount?: Block<number>;
  purchasedLimit?: number;
}

// Khớp kệ Mua lại; lệch thì phía Mini App tự lùi về request lẻ.
export const HOME_PURCHASED_LIMIT = 10;

export const fetchHomePublic = (http: HttpClient) => http.get<HomePublicDTO>('/home');

export const fetchHomeMe = (http: HttpClient, purchasedLimit: number = HOME_PURCHASED_LIMIT) =>
  http.get<HomeMeDTO>('/home/me', { query: { purchasedLimit } });
