import { applyDecorators, CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';

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
  /** Nội dung người dùng tự viết cho khách chưa đăng nhập xem (xem trước cộng đồng): gỡ bài hay tắt cờ phải có hiệu lực trong 1 phút. */
  USER_CONTENT: 'public, max-age=30, s-maxage=60',
  /** Flash sale đang chạy: quota giảm theo từng đơn nên TTL rất ngắn. */
  LIVE: 'public, max-age=5, s-maxage=10',
} as const;

export const PUBLIC_CACHE_POLICY_KEY = 'public-cache-policy';

/**
 * Chỉ gắn Cache-Control khi handler trả thành công. `@Header` của Nest set trước khi handler chạy nên
 * 404/400/5xx cũng mang `public, s-maxage` và bị proxy/CDN giữ lại.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policy = Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, context.getHandler()) as keyof typeof PUBLIC_CACHE | undefined;
    if (!policy) return next.handle();
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        if (res.statusCode >= 200 && res.statusCode < 300) res.setHeader('Cache-Control', PUBLIC_CACHE[policy]);
      }),
    );
  }
}

export const PublicCache = (policy: keyof typeof PUBLIC_CACHE) =>
  applyDecorators(SetMetadata(PUBLIC_CACHE_POLICY_KEY, policy), UseInterceptors(PublicCacheInterceptor));
