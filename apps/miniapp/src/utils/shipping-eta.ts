import type { ShippingEta } from '../services/shop-api';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "02/10 – 04/10" từ khoảng ngày cấu hình (ngày lịch, chưa theo tỉnh — spec §2).
 * Tự ghép dd/MM từ ngày-tháng địa phương thay vì `toLocaleDateString('vi-VN')`: định dạng đó phụ
 * thuộc ICU của từng webview/Node (có nơi ra "01-10"), còn màn này cần đúng "dd/MM".
 */
export function shippingEtaLabel(eta: ShippingEta, now: Date = new Date()): string {
  const fmt = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days); // theo ngày lịch, không cộng mili-giây (an toàn khi lệch giờ mùa hè)
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  };
  return eta.minDays === eta.maxDays ? fmt(eta.minDays) : `${fmt(eta.minDays)} – ${fmt(eta.maxDays)}`;
}
