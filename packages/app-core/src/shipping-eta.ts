import type { ShippingEta } from './api/config';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "02/10 – 04/10" từ khoảng ngày cấu hình (ngày lịch, chưa theo tỉnh). Tự ghép dd/MM từ ngày-tháng địa phương thay vì
 * `toLocaleDateString('vi-VN')`: định dạng đó phụ thuộc ICU của từng trình duyệt/Node (có nơi ra "01-10"), còn màn này cần đúng "dd/MM".
 * Dùng chung cho web và Mini App.
 */
export function shippingEtaLabel(eta: ShippingEta, now: Date = new Date()): string {
  const fmt = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days); // theo ngày lịch, không cộng mili-giây (an toàn khi lệch giờ mùa hè)
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  };
  return eta.minDays === eta.maxDays ? fmt(eta.minDays) : `${fmt(eta.minDays)} – ${fmt(eta.maxDays)}`;
}

const ETA_STATUSES = new Set(['CONFIRMED', 'PACKED', 'SHIPPING']);
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Ngày giao dự kiến của một đơn đang xử lý: giờ đặt (cùng gốc với màn thanh toán) cộng khoảng ngày cấu hình, tính theo
 * ngày Việt Nam (UTC+7 quanh năm). null khi chưa cấu hình, đơn chưa xác nhận hoặc đã xong, đơn có món đặt trước (chưa biết
 * hàng về lúc nào), đơn của gian hàng đối tác (họ tự giao, khoảng ngày của Tubu không áp dụng), đơn Tubu đang xử lý tay (ngày chỉ là đoán) hoặc ngày muộn nhất đã qua; ngày sớm nhất không lùi về trước hôm nay:
 * không bịa ngày.
 */
export function orderDeliveryEtaLabel(
  eta: ShippingEta | null | undefined,
  order: {
    status: string;
    createdAt: string;
    items?: { backorderedQty?: number | null }[] | null;
    fulfilment?: { kind: string } | null;
    manualHandling?: boolean | null;
  },
  now: Date = new Date(),
): string | null {
  if (!eta || !ETA_STATUSES.has(order.status)) return null;
  if (order.manualHandling || order.fulfilment?.kind === 'MERCHANT') return null;
  if (order.items?.some((it) => (it.backorderedQty ?? 0) > 0)) return null;
  const base = new Date(order.createdAt);
  if (Number.isNaN(base.getTime())) return null;
  const vnDay = new Date(base.getTime() + VN_OFFSET_MS);
  const dayUtc = (days: number) => Date.UTC(vnDay.getUTCFullYear(), vnDay.getUTCMonth(), vnDay.getUTCDate() + days);
  const nowVn = new Date(now.getTime() + VN_OFFSET_MS);
  const todayUtc = Date.UTC(nowVn.getUTCFullYear(), nowVn.getUTCMonth(), nowVn.getUTCDate());
  if (dayUtc(eta.maxDays) < todayUtc) return null;
  const fmt = (days: number) => {
    const d = new Date(Math.max(dayUtc(days), todayUtc));
    return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
  };
  const [from, to] = [fmt(eta.minDays), fmt(eta.maxDays)];
  return from === to ? from : `${from} – ${to}`;
}
