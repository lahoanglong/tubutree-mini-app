type QueryScalar = string | number | boolean | null | undefined;

// Mảng chỉ để khớp axios nếu một service sau này truyền vào; kiểu Query của app-core không cho phép.
type QueryInput = Record<string, QueryScalar | readonly QueryScalar[]>;

// Cùng bộ mã hoá với buildURL của axios (Mini App): API nhận đúng một chuỗi query từ hai nền tảng.
function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%20/g, '+');
}

export function buildQueryString(query: QueryInput | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(query)) {
    if (Array.isArray(raw)) {
      for (const item of raw as readonly QueryScalar[]) {
        if (item != null) parts.push(`${encode(`${key}[]`)}=${encode(String(item))}`);
      }
    } else if (raw != null) {
      parts.push(`${encode(key)}=${encode(String(raw))}`);
    }
  }
  return parts.join('&');
}

export function withQuery(path: string, query: QueryInput | undefined): string {
  const qs = buildQueryString(query);
  if (!qs) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}
