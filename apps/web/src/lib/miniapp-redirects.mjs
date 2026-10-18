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
      rows.push({ source: item.miniapp, destination: item.web, permanent: false });
    }
  }
  // Next khớp theo thứ tự khai báo: đường tĩnh phải đứng trước đường động (/feed/events trước /feed/:id).
  return [...rows.filter((r) => !r.source.includes(':')), ...rows.filter((r) => r.source.includes(':'))];
}
