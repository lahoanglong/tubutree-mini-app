import { QueryClient } from '@tanstack/react-query';
import { isHttpError } from './http';

/** Lỗi tạm (mất mạng, timeout, 5xx, 429, 408): tải lại sau có thể khỏi. 4xx còn lại là nghiệp vụ, tải lại vẫn y vậy. */
function isTransientError(error: unknown): boolean {
  if (!isHttpError(error)) return false;
  const status = error.response?.status;
  return !status || status >= 500 || status === 408 || status === 429;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * QueryClient của app. Khác mặc định của react-query:
 *  - query `networkMode: 'always'`: mặc định 'online' TẠM DỪNG query khi máy báo offline — query chưa có dữ liệu không
 *    bao giờ lỗi, không bao giờ tải, nên trang chỉ có `data` rỗng và vẽ màn "chưa có đơn/giỏ trống" sai sự thật (R5-BUYER-1).
 *    'always' gửi request thật, lỗi mạng thành `isError` để trang hiện câu "Mất mạng…" kèm nút Thử lại.
 *  - query lỗi tạm tự tải lại khi có mạng lại (refetchOnReconnect) và khi khách quay lại app (visibilitychange); query
 *    đã có dữ liệu thì không tải thừa mỗi lần quay lại. Phiên đăng nhập có cơ chế riêng (hooks/use-auth-phase.ts).
 *  - query không retry lỗi 4xx; offline thì không retry; staleTime ngắn cho tiền/đơn/ví.
 *  - mutation `networkMode: 'always'`: mặc định 'online' TẠM DỪNG mutation khi máy báo offline rồi tự chạy khi có mạng lại —
 *    bấm "Đặt hàng" lúc mất sóng thì không có phản hồi nào, và đơn tự được tạo sau đó kể cả khi khách đã rời màn hình. 'always'
 *    gửi request thật, lỗi mạng rơi vào onError (hiện câu "Có vẻ mất mạng…"), không có hàng đợi nào chạy lại về sau.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        // Không retry lỗi 4xx (nghiệp vụ/401) — 401 đã được interceptor tự refresh+retry;
        // retry thêm chỉ làm tăng churn. Chỉ retry 1 lần cho lỗi mạng/5xx, và không retry khi máy đang offline.
        retry: (failureCount, error) => {
          if (isOffline()) return false;
          const status = isHttpError(error) ? error.response?.status : undefined;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        refetchOnReconnect: true,
        refetchOnWindowFocus: (query) => query.state.status === 'error' && isTransientError(query.state.error),
        // Default staleTime ngắn (10s) — money/auth/orders/wallet/notifications cần tươi
        // ngay sau action (vd thanh toán WALLET trừ tiền; nếu staleTime 60s mà thiếu
        // invalidate ở 1 nơi nào đó → user thấy số dư cũ).
        // Catalog/brands/categories chậm-đổi (~15p sync Pancake) nên override staleTime: 60_000
        // tại từng useQuery để giữ lợi ích cache (xem browse.tsx/home.tsx).
        staleTime: 10_000,
      },
      mutations: {
        networkMode: 'always',
      },
    },
  });
}
