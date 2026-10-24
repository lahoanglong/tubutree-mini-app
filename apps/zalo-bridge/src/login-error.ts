// ZaloApiError (node_modules/zca-js/dist/Errors/ZaloApiError.d.ts) là lỗi Zalo đã trả lời và từ chối phiên. Dò theo tên lớp
// trên chuỗi prototype vì zca-js có hai bản (ESM và CJS), instanceof qua bản kia sẽ sai.
function isZaloApiError(e: unknown): boolean {
  for (let p = e as object | null; p; p = Object.getPrototypeOf(p)) {
    if (p.constructor?.name === 'ZaloApiError') return true;
  }
  return false;
}

const TRANSIENT_STATUS_TEXT = /^(internal server error|bad gateway|service unavailable|gateway timeout|gateway time-out|http version not supported|server error)$/i;

// zca-js không giữ mã HTTP trên lỗi: login.js:8,34 chỉ ghép response.statusText vào thông điệp ("Failed to fetch login info: <statusText>"),
// utils.js:580-583 ghép "Request failed with status code <mã>". Không có trường số đáng tin, nên đọc status/statusCode nếu có,
// rồi mã trong thông điệp, rồi statusText 5xx chuẩn. Không nhận ra được thì giữ như cũ (Zalo từ chối phiên).
function httpStatusOf(e: unknown): number | null {
  const o = e as { status?: unknown; statusCode?: unknown; message?: unknown };
  for (const v of [o?.status, o?.statusCode]) {
    if (typeof v === 'number' && v >= 100 && v <= 599) return v;
  }
  const message = typeof o?.message === 'string' ? o.message : '';
  const code = /status code (\d{3})\b/i.exec(message);
  if (code) return Number(code[1]);
  const text = /^Failed to fetch (?:login|server) info: (.+)$/i.exec(message)?.[1]?.trim();
  if (text && TRANSIENT_STATUS_TEXT.test(text)) return 500;
  return null;
}

// Lỗi mạng, hết giờ 60 giây, DNS, hay Zalo lỗi HTTP 5xx: chưa có lời từ chối phiên nên phiên có thể vẫn còn dùng được, thử lại.
export function classifyLoginError(e: unknown): 'retry' | 'need-qr' {
  if (!isZaloApiError(e)) return 'retry';
  const status = httpStatusOf(e);
  return status !== null && status >= 500 ? 'retry' : 'need-qr';
}
