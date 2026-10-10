import { Header } from '@nestjs/common';

/**
 * Cache-Control cho endpoint công khai KHÔNG phụ thuộc người gọi (không đọc JWT, không giá sỉ/PII).
 * TTL ngắn vì tồn kho/giá đổi theo sync Pancake (~15p) và checkout luôn kiểm lại phía server;
 * `s-maxage` dài hơn `max-age` để proxy/CDN gom request mà trình duyệt vẫn thấy dữ liệu mới nhanh.
 * CORS đã gắn `Vary: Origin` nên cache chung không trả nhầm header theo origin khác.
 * KHÔNG dùng cho endpoint theo user (for-you, upcoming, home/me...) — các route đó tự khai báo no-store.
 */
export const PUBLIC_CACHE = {
  /** Dữ liệu tham chiếu ít đổi: config công khai, danh mục, nhãn, FAQ, địa giới. */
  STATIC: 'public, max-age=60, s-maxage=300',
  /** Danh mục sản phẩm / Trang chủ / trang nhãn: đổi theo sync tồn + giá. */
  CATALOG: 'public, max-age=15, s-maxage=30',
  /** Flash sale đang chạy: quota giảm theo từng đơn nên TTL rất ngắn. */
  LIVE: 'public, max-age=5, s-maxage=10',
} as const;

export const PublicCache = (policy: keyof typeof PUBLIC_CACHE) => Header('Cache-Control', PUBLIC_CACHE[policy]);
