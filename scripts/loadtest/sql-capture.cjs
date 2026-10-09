// Gọi 1 lượt các endpoint nóng vào API 3301 (DEBUG=prisma:query) để lấy SQL thật Prisma sinh ra.
const { tokenFor } = require('./lib.cjs');
const B = 'http://localhost:3301/api';
const ut = tokenFor('perf_u_10004');
const whale = tokenFor('perf_u_1', 'ADMIN');
const admin = tokenFor('perf_u_1', 'ADMIN');
let n = 0;
async function hit(label, path, tok, opt = {}) {
  console.log('### MARK ' + label);
  const t0 = performance.now();
  const r = await fetch(B + path, { method: opt.method || 'GET', headers: { 'X-Forwarded-For': '10.1.' + (n++ >> 8) + '.' + (n & 255), ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(opt.body ? { 'Content-Type': 'application/json' } : {}) }, body: opt.body });
  const txt = await r.text();
  console.log('###', label, r.status, (performance.now() - t0).toFixed(0) + 'ms', txt.length + 'B');
}
(async () => {
  await hit('catalog_list', '/products?page=1&limit=20');
  await hit('catalog_list_p50', '/products?page=50&limit=20');
  await hit('catalog_search', '/products?q=' + encodeURIComponent('chậu cây') + '&limit=20');
  await hit('catalog_search_nodau', '/products?q=chau%20cay&limit=20');
  await hit('catalog_bestseller', '/products?sort=best_seller&limit=20');
  await hit('catalog_filter', '/products?category=cat-skincare&inStock=true&minRating=4&minPrice=100000&maxPrice=500000&limit=20');
  await hit('suggest', '/search/suggest?q=' + encodeURIComponent('chậu'));
  await hit('pdp', '/products/perf-san-pham-1712');
  await hit('related', '/products/perf-san-pham-1712/related');
  await hit('bought_together', '/products/perf-san-pham-1712/bought-together');
  await hit('categories', '/categories');
  await hit('brands', '/brands');
  await hit('for_you', '/products/for-you', ut);
  await hit('cart_get', '/cart', ut);
  await hit('orders_list', '/orders?page=1&limit=10', ut);
  await hit('orders_list_whale', '/orders?page=1&limit=10', whale);
  await hit('orders_active_count', '/orders/active-count', ut);
  await hit('flash_active', '/flash-sales/active');
  await hit('flash_upcoming', '/flash-sales/upcoming');
  await hit('feed', '/feed?take=20', ut);
  await hit('feed_popular', '/feed?take=20&sort=popular', ut);
  await hit('feed_search', '/feed?take=20&q=' + encodeURIComponent('cây'), ut);
  await hit('notifications', '/me/notifications', ut);
  await hit('admin_orders', '/admin/orders?page=1&limit=20', admin);
  await hit('admin_orders_status', '/admin/orders?page=1&limit=20&status=CONFIRMED', admin);
  await hit('admin_dashboard', '/admin/dashboard/stats', admin);
})();
