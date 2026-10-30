'use client';

import { createHomeFeed, takeHomeRequest } from '@tubutree/app-core/home-feed';
import { fetchHomeMe, type HomePublicDTO } from '@tubutree/app-core/api/home';
import { rawCoreHttp, setCoreGetInterceptor } from './core-http';

// Server đã tự cắt từng khối ở ~2,5s nên request gộp không cần chờ lâu mới lùi về request lẻ.
const FEED_TIMEOUT_MS = 4_000;

let userId: string | null = null;

const feed = createHomeFeed({
  fetchPublic: () => rawCoreHttp.get<HomePublicDTO>('/home', { anonymous: true }),
  fetchMe: () => fetchHomeMe(rawCoreHttp),
  identity: () => userId,
  timeoutMs: FEED_TIMEOUT_MS,
});

/**
 * Bật request gộp `/home` + `/home/me` cho Trang chủ (cùng cơ chế với Mini App). Chỉ ở trình duyệt: ở máy chủ trạng thái này dùng chung giữa
 * các request. `userId` để khối cá nhân không trao nhầm khi đổi tài khoản lúc trang còn mở.
 */
export function armHomeFeed(currentUserId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  userId = currentUserId ?? null;
  feed.arm();
  setCoreGetInterceptor((path, query) => (feed.isArmed() ? takeHomeRequest(feed, path, query) : null));
}

export function disarmHomeFeed(): void {
  feed.disarm();
  setCoreGetInterceptor(null);
}

/** Kéo để làm mới / thử lại: bỏ khối đã dùng, request gộp kế tiếp sẽ tải lại. */
export const resetHomeFeed = feed.reset;
