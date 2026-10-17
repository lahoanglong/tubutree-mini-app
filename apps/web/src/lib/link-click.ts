import { apiFetch } from './client-api';

const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;
const REPORTED_KEY = 'tubu_link_click:';

/**
 * Link CTV tạo ở Mini App có dạng `/?ref=<mã>&l=<mã link>`; khách mở nó thì báo API +1 click cho link đó (CTV thấy ở bảng "Link").
 * Một lần mỗi phiên trình duyệt cho mỗi link (cờ ở sessionStorage); route API công khai nên khách chưa đăng nhập cũng đếm được.
 * Fire-and-forget: con số click không đáng làm hỏng việc mở trang.
 */
export function reportLinkClick(search: string): void {
  const code = new URLSearchParams(search).get('l')?.trim();
  if (!code || !LINK_CODE_PATTERN.test(code)) return;
  try {
    if (sessionStorage.getItem(REPORTED_KEY + code)) return;
    sessionStorage.setItem(REPORTED_KEY + code, '1');
  } catch {
    /* không có storage: chấp nhận có thể đếm lặp trong phiên còn hơn bỏ lỡ lượt mở */
  }
  void apiFetch('/affiliate/click', { method: 'POST', body: { shortCode: code }, auth: false }).catch(() => {});
}
