import type { HttpClient } from '@tubutree/app-core/http';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';

/**
 * Đợt Giờ vàng đang chạy cho trang dựng phía web server (ISR). Khác `fetchActiveFlashSales` của app-core ở chỗ KHÔNG đồng bộ đồng hồ: bộ nhớ đệm fetch của Next có thể trả
 * bản cũ tới 60 giây, và `syncServerClock` ghi độ lệch vào biến của tiến trình, nên bản cũ sẽ dịch `serverNow()` của mọi lần dựng sau đó trong tiến trình (thẻ gian hàng,
 * khối thương hiệu). Đồng hồ chỉ đồng bộ ở trình duyệt, nơi mỗi người có điện thoại lệch riêng.
 */
export const fetchActiveFlashSalesNoSync = (http: HttpClient) => http.get<FlashSaleActiveItem[]>('/flash-sales/active', { anonymous: true });
