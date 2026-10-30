import { HOME_PURCHASED_LIMIT, type HomeMeDTO, type HomePublicDTO } from '@tubutree/app-core/api/home';
import { createHomeFeed, isHomePurchasedRequest } from '@tubutree/app-core/home-feed';
import { useAuthStore } from '../store/auth';
import { api } from './api';
import type { PurchasedItemsPage } from './shop-api';

/**
 * Trang chủ gộp request (C-037). Khi Trang chủ đang mở ("armed"), lần gọi ĐẦU TIÊN của từng service lẻ
 * (fetchCategories, fetchForYou, ...) được trả từ 2 request gộp `GET /home` + `GET /home/me` thay vì một
 * request riêng. Component và query key giữ nguyên.
 *
 * Mọi đường lỗi đều lùi về request lẻ: API cũ 404, lỗi mạng, khối null phía server, hoặc tham số lẻ không
 * khớp tham số mà endpoint gộp dùng. Mỗi khối chỉ dùng MỘT lần mỗi phiên mở Trang chủ — refetch định kỳ
 * và invalidate sau đó luôn đi request lẻ để lấy dữ liệu mới.
 */

export type { HomeMeDTO, HomePublicDTO };

// Khớp HOME_PUBLIC phía API (apps/api/src/modules/catalog/home.service.ts) và SECTION_LIMIT của pages/home.tsx.
const SECTION_LIMIT = 6;
const FEATURED_LIMIT = SECTION_LIMIT * 2;
export { HOME_PURCHASED_LIMIT };
// Server đã tự cắt từng khối ở ~2,5s nên request gộp không cần chờ lâu mới lùi về request lẻ.
const FEED_TIMEOUT_MS = 4_000;

const feed = createHomeFeed({
  fetchPublic: () => api.get<HomePublicDTO>('/home', { timeout: FEED_TIMEOUT_MS }).then((r) => r.data),
  fetchMe: () => api.get<HomeMeDTO>('/home/me', { params: { purchasedLimit: HOME_PURCHASED_LIMIT }, timeout: FEED_TIMEOUT_MS }).then((r) => r.data),
  // Id tài khoản, không phải access token: token đổi khi làm mới sau 401 dù vẫn cùng một người.
  identity: () => useAuthStore.getState().user?.id,
});

/** Gọi khi Trang chủ mount (trước khi các query con chạy). Idempotent. */
export const armHomeFeed = feed.arm;
export const isHomeFeedArmed = feed.isArmed;
export const disarmHomeFeed = feed.disarm;
/** Kéo để làm mới: bỏ khối đã dùng, request gộp kế tiếp sẽ tải lại. */
export const resetHomeFeed = feed.reset;
export const takePublicBlock = feed.takePublic;
export const takeMeBlock = feed.takeMe;

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
  return isHomePurchasedRequest(params) ? takeMeBlock('purchasedItems') : null;
}
