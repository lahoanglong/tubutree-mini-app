#!/usr/bin/env node
// API giả cho phần dựng phía máy chủ (SSR) của web khi chạy tests/mss-catalog-preview.web.spec.ts: trang sản phẩm đã ghép nội dung MSS và trang
// /san-pham/_preview gọi API từ máy chủ Next nên mock trình duyệt (support/mock-api.ts) không chặn được. Dữ liệu ở tests/support/mss-catalog-fixture.json.
//
// Chạy (cổng mẫu; web build với cùng gốc API và origin MSS giả được phép nhúng):
//   PORT=3131 node apps/e2e/scripts/mss-preview-fixture-api.mjs &
//   NEXT_PUBLIC_API_BASE_URL=http://localhost:3131/api API_BASE_URL=http://localhost:3131/api MSS_PREVIEW_FRAME_ANCESTORS=https://mss.e2e.test \
//     pnpm --filter @tubutree/web exec next build && pnpm --filter @tubutree/web exec next start -p 3132 &
//   cd apps/e2e && E2E_SCOPE=web E2E_API_PORT=3131 E2E_WEB_PORT=3132 npx playwright test tests/mss-catalog-preview.web.spec.ts
// Playwright dùng lại hai máy chủ đang chạy (reuseExistingServer khi không có CI). Đường không khai ở dưới bị cắt kết nối, y như API chưa lên: lúc
// `next build` các trang dựng sẵn (Trang chủ...) dựng bản rỗng như khi build không có API, còn trả 404 hay dạng rỗng thiếu trường thì dựng sẵn Trang chủ hỏng.
// apps/web/.next/cache/fetch-cache giữ phản hồi theo URL qua các lần build: build hỏng vì phản hồi cũ của cùng cổng thì đổi PORT.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const fixture = JSON.parse(readFileSync(new URL('../tests/support/mss-catalog-fixture.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT ?? 3131);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function preview(res, token) {
  const t = fixture.tokens;
  if (token === t.ok) return send(res, 200, { ...fixture.product, preview: fixture.preview });
  if (token === t.down) return send(res, 503, { error: 'preview_unavailable', message: 'MSS chưa trả được bản nháp, thử lại sau' });
  if (token === t.missing) return send(res, 404, { error: 'not_found', message: 'Sản phẩm chưa có trên Tubu' });
  return send(res, 404, { error: 'preview_expired', message: 'Phiên xem trước đã hết hạn, mở lại từ MSS' });
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fixture.local');
  const path = url.pathname.replace(/^\/api(?=\/)/, '');
  if (req.method !== 'GET') return req.socket.destroy();
  if (path === '/health') return send(res, 200, { status: 'ok' });
  if (path === '/mss/preview/product') return preview(res, url.searchParams.get('token'));
  if (path === `/products/${fixture.slug}`) return send(res, 200, fixture.product);
  return req.socket.destroy();
}).listen(port, () => {
  console.log(`mss-preview-fixture-api: http://localhost:${port}/api (slug ${fixture.slug})`);
});
