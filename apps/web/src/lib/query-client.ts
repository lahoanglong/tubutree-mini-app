import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/client-api';

const CATALOG_STALE_MS = 30_000;

/** Lỗi 4xx là nghiệp vụ (404, 401...): thử lại vẫn y vậy, chỉ nhân đôi request. Mất mạng và 5xx thì thử một lần. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/**
 * QueryClient của web. Mutation `networkMode: 'always'` (như Mini App, R4-BUYER-1): mặc định 'online' TẠM DỪNG mutation khi
 * trình duyệt báo offline rồi tự chạy khi có mạng lại — bấm "Đặt hàng" lúc mất mạng thì nút treo "Đang đặt hàng…", và đơn tự
 * được tạo sau đó kể cả khi khách đã rời trang. 'always' gửi request thật, lỗi mạng rơi vào onError (hiện câu "Mất kết nối…"),
 * không có hàng đợi nào chạy lại về sau. Query giữ mặc định cũ.
 */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false },
      mutations: { networkMode: 'always' },
    },
  });
  // Danh mục sản phẩm đổi chậm (đồng bộ Pancake ~15 phút): quay lại trong 30 giây thì dùng lại, không gọi mạng.
  client.setQueryDefaults(['products'], { staleTime: CATALOG_STALE_MS });
  client.setQueryDefaults(['storefront-categories'], { staleTime: CATALOG_STALE_MS });
  return client;
}
