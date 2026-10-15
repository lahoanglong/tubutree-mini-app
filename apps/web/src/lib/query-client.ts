import { QueryClient } from '@tanstack/react-query';

/**
 * QueryClient của web. Mutation `networkMode: 'always'` (như Mini App, R4-BUYER-1): mặc định 'online' TẠM DỪNG mutation khi
 * trình duyệt báo offline rồi tự chạy khi có mạng lại — bấm "Đặt hàng" lúc mất mạng thì nút treo "Đang đặt hàng…", và đơn tự
 * được tạo sau đó kể cả khi khách đã rời trang. 'always' gửi request thật, lỗi mạng rơi vào onError (hiện câu "Mất kết nối…"),
 * không có hàng đợi nào chạy lại về sau. Query giữ mặc định cũ.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
      mutations: { networkMode: 'always' },
    },
  });
}
