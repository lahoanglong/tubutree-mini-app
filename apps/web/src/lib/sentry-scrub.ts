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

// Danh sách cho phép: SDK chép nguyên header request, mỗi nhà cung cấp có header token riêng.
const ALLOW_HEADERS = new Set(['user-agent', 'content-type', 'content-length', 'accept', 'accept-language', 'host', 'referer']);

const stripQuery = (u: string) => u.split(/[?#]/)[0]!;

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const req = event.request;
  if (req) {
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (req.url) req.url = stripQuery(req.url);
    if (req.headers) {
      req.headers = Object.fromEntries(
        Object.entries(req.headers)
          .filter(([k]) => ALLOW_HEADERS.has(k.toLowerCase()))
          // Referer của callback OAuth Zalo mang ?code=&state=.
          .map(([k, v]) => [k, k.toLowerCase() === 'referer' ? stripQuery(String(v)) : v]),
      );
    }
  }
  // Breadcrumb (URL gọi ra ngoài, dòng console, chữ trên nút bấm) khó đảm bảo sạch nên bỏ hết.
  if (event.breadcrumbs) event.breadcrumbs = [];
  return event;
}
