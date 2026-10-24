/**
 * Bỏ dữ liệu khách khỏi sự kiện lỗi trước khi gửi: cookie, header xác thực, thân request, query (có thể chứa token).
 * Dùng chung cho SDK trình duyệt và SDK server, nên chỉ đụng tới hình dạng event tối thiểu.
 */
export interface ScrubbableEvent {
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: unknown[];
}

const DROP_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-webhook-token', 'x-throttle-bypass', 'x-api-key']);

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const req = event.request;
  if (req) {
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (req.url) req.url = req.url.split(/[?#]/)[0]!;
    if (req.headers) {
      req.headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !DROP_HEADERS.has(k.toLowerCase())));
    }
  }
  // Breadcrumb (URL gọi ra ngoài, dòng console, chữ trên nút bấm) khó đảm bảo sạch nên bỏ hết.
  if (event.breadcrumbs) event.breadcrumbs = [];
  return event;
}
