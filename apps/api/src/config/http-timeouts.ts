import type { Server } from 'node:http';

/**
 * Node mặc định đóng kết nối rảnh sau 5 giây. Reverse proxy giữ kết nối tới API trong một pool và tái dùng chúng:
 * nếu Node đóng trước, request tiếp theo đi vào đúng kết nối vừa chết và khách thấy 502 lẻ "error reading status line"
 * (A3-010, đo được ECONNRESET ~3,3% ở 800 rps). Giá trị phải lớn hơn thời gian proxy còn giữ kết nối rảnh:
 * Caddy `reverse_proxy` mặc định 2 phút, Apache `ProxyPass ... ttl=30` (ops/vietnix-vhost-api.conf.*).
 */
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 125_000;

/** Phải lớn hơn keepAliveTimeout, nếu không Node cắt kết nối rảnh ở mốc headersTimeout (mặc định 60 giây). */
export const HTTP_HEADERS_TIMEOUT_MS = HTTP_KEEP_ALIVE_TIMEOUT_MS + 1_000;

export function applyHttpTimeouts(server: Pick<Server, 'keepAliveTimeout' | 'headersTimeout'>): void {
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
}
