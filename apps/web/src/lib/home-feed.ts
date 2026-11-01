'use client';

import { createHomeFeed, takeHomeRequest } from '@tubutree/app-core/home-feed';
import { fetchHomeMe, type HomePublicDTO } from '@tubutree/app-core/api/home';
import { rawCoreHttp, setCoreGetInterceptor } from './core-http';

let userId: string | null = null;

const feed = createHomeFeed({
  fetchPublic: () => rawCoreHttp.get<HomePublicDTO>('/home', { anonymous: true }),
  fetchMe: () => fetchHomeMe(rawCoreHttp),
  identity: () => userId,
});

// Không đặt hạn chờ riêng: apiFetch đã có hạn 20s, và server tự cắt từng khối ở ~2,5s. Hạn ngắn hơn chỉ làm lần chờ chậm gấp đôi
// (bỏ request gộp còn đang chạy rồi gọi lẻ lại, cũng chậm y vậy). Chỉ lỗi hoặc khối null mới lùi về request lẻ.

/**
 * Bật request gộp `/home` + `/home/me` cho Trang chủ (cùng cơ chế với Mini App). Chỉ ở trình duyệt: ở máy chủ trạng thái này dùng chung giữa
 * các request. `userId` để khối cá nhân không trao nhầm khi đổi tài khoản lúc trang còn mở.
 */
export function armHomeFeed(currentUserId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  userId = currentUserId ?? null;
  feed.arm();
  setCoreGetInterceptor((path, query) => {
    if (!feed.isArmed()) return null;
    // Suất sắp mở là công khai: khách chưa có tài khoản đi request lẻ. Hỏi khối gộp sẽ khởi động `/home/me` (401) và khoá định danh rỗng,
    // làm mọi khối cá nhân của lần đăng nhập ngay sau đó không còn khớp và phải gọi lẻ.
    if (path === '/flash-sales/upcoming' && !userId) return null;
    return takeHomeRequest(feed, path, query);
  });
}

export function disarmHomeFeed(): void {
  feed.disarm();
  setCoreGetInterceptor(null);
}

/** Kéo để làm mới / thử lại: bỏ khối đã dùng, request gộp kế tiếp sẽ tải lại. */
export const resetHomeFeed = feed.reset;
