import type { StorefrontStats } from '@tubutree/app-core/api/storefront';
import { formatVnd } from '@/lib/format-vnd';

export const LAYOUT_LABEL = { GRID: 'Lưới', CAROUSEL: 'Cuộn ngang', STACK: 'Xếp dọc' } as const;
export const KIND_LABEL = { NORMAL: 'Thường', COMBO: 'Combo giảm giá' } as const;

/** Chỗ khách mở gian hàng: subdomain khi cờ bật và đã có tên, ngược lại đường dẫn /s/<slug>. */
export function storefrontHost(sf: { slug: string; subdomain?: string | null; subdomainEnabled?: boolean }): string {
  return sf.subdomainEnabled && sf.subdomain ? `${sf.subdomain}.tubutree.com` : `/s/${sf.slug}`;
}

export interface StatRow {
  key: string;
  name: string;
  value: string;
}

/**
 * Các dòng cộng đúng ô Doanh thu: top 5 sản phẩm, phần còn lại gộp một dòng, phần cấp đơn (ship, giảm giá, chênh lệch
 * giữa tiền hoàn thực tế và phần trừ theo tỷ lệ dòng) một dòng; dòng 0 món bị bỏ.
 */
export function statsRows(data: StorefrontStats): StatRow[] {
  const lines = data.byProduct.filter((p) => p.qty > 0);
  const rest = lines.slice(5);
  const orderLevel = data.shippingAndOrderDiscount30d ?? 0;
  const rows: StatRow[] = lines.slice(0, 5).map((p) => ({
    key: p.productSlug || p.productName,
    name: p.productName,
    value: `${p.qty} món · ${formatVnd(p.revenue)}`,
  }));
  if (rest.length > 0) {
    rows.push({
      key: 'rest',
      name: `${rest.length} sản phẩm khác`,
      value: `${rest.reduce((t, p) => t + p.qty, 0)} món · ${formatVnd(rest.reduce((t, p) => t + p.revenue, 0))}`,
    });
  }
  if (orderLevel !== 0) rows.push({ key: 'order-level', name: 'Phí ship, giảm giá, chênh lệch hoàn tiền', value: formatVnd(orderLevel) });
  return rows;
}

/** goal = 0 (nhiệm vụ đã đạt sẵn) là 100%, không chia cho 0. */
export function questPercent(q: { goal: number; progress: number }): number {
  return q.goal > 0 ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 100;
}

/** Mã giới thiệu đi kèm MỌI lối chia sẻ: thiếu thì khách mua từ link đó không tính hoa hồng cho CTV. */
export function storefrontShareUrl(origin: string, slug: string, referralCode?: string | null): string {
  return `${origin}/s/${slug}${referralCode ? `?ref=${referralCode}` : ''}`;
}

export function shareCaptions(url: string): string[] {
  return [
    `Mình tuyển vài món sống xanh đang dùng, ghé xem nha 🌿 ${url}`,
    `Gian hàng sống xanh của mình đây 💚 ${url}`,
    `Đồ thiên nhiên lành cho da & nhẹ với đất 🌱 ${url}`,
  ].map((c) => (c.includes(url) ? c : `${c} ${url}`));
}

/**
 * Link bộ nội dung bán hàng: API trả đường dẫn tương đối của Mini App ('/product/<slug>?ref=..') khi chưa cấu hình URL
 * gốc; dán vào Zalo/Facebook không mở được, nên ghép domain web và đổi sang trang sản phẩm thật của web.
 * URL tuyệt đối do API dựng giữ nguyên.
 */
export function absoluteKitLink(origin: string, link: string): string {
  if (!link.startsWith('/')) return link;
  return `${origin}${link.replace(/^\/product\//, '/san-pham/')}`;
}

/**
 * Thay `relative` bằng `absolute` trong bài mẫu, chỉ khi nó đứng đầu từ (đầu chuỗi, sau khoảng trắng hay ngoặc mở): nếu
 * không, link tuyệt đối admin gõ sẵn sẽ bị chèn domain lần thứ hai.
 */
export function withAbsoluteLink(caption: string, relative: string, absolute: string): string {
  if (absolute === relative) return caption;
  const escaped = relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return caption.replace(new RegExp(`(^|[\\s(\\[])${escaped}`, 'g'), (_m, lead: string) => `${lead}${absolute}`);
}

/** Bài mẫu do admin soạn tay có thể thiếu {link}: chép thiếu mã giới thiệu thì CTV mất hoa hồng. */
export function shareFallbackText(caption: string | undefined, link: string): string {
  if (!caption) return link;
  return caption.includes('ref=') ? caption : `${caption} ${link}`;
}
