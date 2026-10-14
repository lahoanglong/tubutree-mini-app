import { QueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

/**
 * QueryClient của app. Hai chỗ khác mặc định của react-query:
 *  - query không retry lỗi 4xx; staleTime ngắn cho tiền/đơn/ví.
 *  - mutation `networkMode: 'always'`: mặc định 'online' TẠM DỪNG mutation khi máy báo offline rồi tự chạy khi có mạng lại —
 *    bấm "Đặt hàng" lúc mất sóng thì không có phản hồi nào, và đơn tự được tạo sau đó kể cả khi khách đã rời màn hình. 'always'
 *    gửi request thật, lỗi mạng rơi vào onError (hiện câu "Có vẻ mất mạng…"), không có hàng đợi nào chạy lại về sau.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Không retry lỗi 4xx (nghiệp vụ/401) — 401 đã được interceptor tự refresh+retry;
        // retry thêm chỉ làm tăng churn. Chỉ retry 1 lần cho lỗi mạng/5xx.
        retry: (failureCount, error) => {
          const status = isAxiosError(error) ? error.response?.status : undefined;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
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
