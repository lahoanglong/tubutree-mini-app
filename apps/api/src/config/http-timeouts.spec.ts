import { createServer } from 'node:http';
import { applyHttpTimeouts, HTTP_HEADERS_TIMEOUT_MS, HTTP_KEEP_ALIVE_TIMEOUT_MS } from './http-timeouts';

/** keepalive idle mặc định của Caddy `reverse_proxy` (docker-compose.prod.yml). Apache dùng `ttl=30` (ops/vietnix-vhost-api.conf.*). */
const CADDY_UPSTREAM_IDLE_MS = 120_000;

describe('http-timeouts — kết nối rảnh phải sống lâu hơn proxy phía trước (A3-010)', () => {
  it('Node đóng kết nối rảnh SAU proxy: nếu sớm hơn, proxy tái dùng đúng kết nối vừa bị đóng → 502 lẻ', () => {
    expect(HTTP_KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(CADDY_UPSTREAM_IDLE_MS);
  });

  it('headersTimeout lớn hơn keepAliveTimeout (ngược lại Node cắt kết nối rảnh trước hạn)', () => {
    expect(HTTP_HEADERS_TIMEOUT_MS).toBeGreaterThan(HTTP_KEEP_ALIVE_TIMEOUT_MS);
  });

  it('đặt cả hai giá trị lên http.Server thật', () => {
    const server = createServer();
    expect(server.keepAliveTimeout).toBe(5_000);
    applyHttpTimeouts(server);
    expect(server.keepAliveTimeout).toBe(HTTP_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HTTP_HEADERS_TIMEOUT_MS);
    server.close();
  });
});
