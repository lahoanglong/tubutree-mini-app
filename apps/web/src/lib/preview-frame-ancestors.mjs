/** Trang xem trước nội dung nháp của MSS (hợp đồng MSS ↔ Tubu mục 1.5). MSS nhúng trang này trong iframe. */
export const PREVIEW_PATH = '/san-pham/_preview';

/**
 * Đường thuộc trang xem trước MSS: không vỏ trang bán hàng, không ghi sự kiện phân tích. Đặt ở đây (không phụ thuộc module nào) để analytics.ts
 * dùng được mà không kéo theo site.ts → route-map, vốn bị nhiều spec mock một phần.
 */
export function isPreviewPath(pathname) {
  if (!pathname) return false;
  return pathname === PREVIEW_PATH || pathname.startsWith(`${PREVIEW_PATH}/`);
}

/**
 * Luật header của Next (`source`, path-to-regexp) cho mọi đường KHÔNG thuộc trang xem trước: giữ X-Frame-Options DENY như cũ.
 * Hai luật bù trừ nhau đúng một lần: `/san-pham/_preview` và `/san-pham/_preview/...` đi luật xem trước, còn lại (kể cả `/san-pham/_previewx`) đi luật này.
 */
export const NOT_PREVIEW_SOURCE = '/:path((?!san-pham/_preview(?:/|$)).*)';
export const PREVIEW_SOURCES = [PREVIEW_PATH, `${PREVIEW_PATH}/:path*`];

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HTTPS_ORIGIN = new RegExp(`^https://${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::\\d{1,5})?/?$`, 'i');
const LOCAL_ORIGIN = /^http:\/\/localhost:\d{1,5}\/?$/i;

function originOf(token, production) {
  if (!HTTPS_ORIGIN.test(token) && (production || !LOCAL_ORIGIN.test(token))) return null;
  try {
    const url = new URL(token);
    // Cổng 0 hay quá 65535: URL ném lỗi hoặc ra origin lạ; chỉ nhận dạng gốc đã chuẩn hoá (chữ thường, bỏ cổng mặc định).
    if (url.port === '0') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Giá trị chỉ thị `frame-ancestors` cho trang xem trước, đọc từ biến build MSS_PREVIEW_FRAME_ANCESTORS (các origin cách nhau dấu phẩy hoặc khoảng trắng).
 * Chỉ nhận origin `https://host[:port]` (không đường dẫn, query, tài khoản hay ký tự đại diện `*`); ngoài production nhận thêm `http://localhost:<port>`.
 * Rỗng hoặc không còn origin hợp lệ nào thì `'none'`: thiếu biến hay gõ sai không bao giờ mở trang cho nơi nhúng lạ.
 */
export function previewFrameAncestors(raw, { production = true } = {}) {
  const origins = [];
  for (const token of String(raw ?? '').split(/[\s,]+/)) {
    const origin = token ? originOf(token, production) : null;
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins.length > 0 ? origins.join(' ') : "'none'";
}
