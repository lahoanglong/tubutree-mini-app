/**
 * Đường dẫn Mini App trùng đúng URL WooCommerce của tubutree.com cũ: Google và khách đã lưu `/cart`, `/checkout`, `/refill`, nên đây là
 * chuyển hướng vĩnh viễn 301 (không phải 307, cũng không phải 308 của `permanent: true`). `legacy-wp-redirects.ts` giữ cùng đích cho dạng có dấu `/` cuối.
 */
export const MINIAPP_PERMANENT_SOURCES = ['/cart', '/checkout', '/refill'];

/**
 * Sinh danh sách chuyển hướng đường dẫn Mini App sang route web từ route map (01-thiet-ke.md mục 1.3).
 * Là .mjs thuần vì `next.config.mjs` không nạp được TypeScript; `route-map.ts` dùng lại đúng hàm này để spec kiểm chứng.
 */
export function buildMiniappRedirects(groups) {
  const rows = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.web) continue;
      if (item.miniapp === item.web) continue;
      // /product/:slug đã có route handler riêng trên web.
      if (item.miniapp === '/product/:slug') continue;
      rows.push(
        // `permanent: true` của Next ra 308, không phải 301: ba đường WooCommerce cũ khai mã 301 tường minh (Next chấp nhận `statusCode` thay `permanent`).
        MINIAPP_PERMANENT_SOURCES.includes(item.miniapp)
          ? { source: item.miniapp, destination: item.web, statusCode: 301 }
          : { source: item.miniapp, destination: item.web, permanent: false },
      );
    }
  }
  // Next khớp theo thứ tự khai báo: đường tĩnh phải đứng trước đường động (/feed/events trước /feed/:id).
  return [...rows.filter((r) => !r.source.includes(':')), ...rows.filter((r) => r.source.includes(':'))];
}
