import { formatVnd } from './format-vnd';

const count = (n: number) => n.toLocaleString('vi-VN');

/** Hiệu quả chiến dịch từ API. Mọi trường có thể thiếu khi gặp máy chủ bản cũ chưa tính hiệu quả. */
export interface CampaignRoiFields {
  views?: number;
  clicks?: number;
  ordersCount?: number;
  gmv?: number;
}

/** Hiệu quả mã giảm giá từ API; thiếu khi gặp máy chủ bản cũ. */
export interface CouponRoiFields {
  /** Mã miễn phí giao hàng không giảm tiền hàng nên `discountCost` luôn 0 (tiền ship được miễn không lưu trên đơn): bỏ phần "giảm" thay vì hiện 0đ. */
  type?: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  ordersCount?: number;
  gmv?: number;
  discountCost?: number;
  avgOrderValue?: number;
}

/**
 * Một dòng chữ nhỏ dưới chiến dịch: lượt xem trang, lượt chạm banner (đếm sự kiện, không phải số khách), đơn dùng mã gắn với chiến dịch và
 * doanh thu của các đơn đó. `null` khi máy chủ chưa trả số liệu: không hiện dòng thay vì hiện "0" sai.
 */
export function campaignRoiText(r: CampaignRoiFields): string | null {
  if (r.views == null && r.clicks == null && r.ordersCount == null && r.gmv == null) return null;
  return [
    `${count(r.views ?? 0)} lượt xem`,
    `${count(r.clicks ?? 0)} lượt chạm banner`,
    `${count(r.ordersCount ?? 0)} đơn dùng mã`,
    formatVnd(r.gmv ?? 0),
  ].join(' · ');
}

/**
 * Một dòng chữ nhỏ dưới mã giảm giá: số đơn, doanh thu, tiền giảm và giá trị trung bình một đơn. Chưa có đơn nào thì một câu ngắn, không
 * hàng số 0. `null` khi máy chủ chưa trả số liệu.
 */
export function couponRoiText(r: CouponRoiFields): string | null {
  if (r.ordersCount == null) return null;
  if (r.ordersCount <= 0) return 'Chưa có đơn dùng mã';
  return [
    `${count(r.ordersCount)} đơn`,
    `doanh thu ${formatVnd(r.gmv ?? 0)}`,
    ...(r.type === 'FREESHIP' ? [] : [`giảm ${formatVnd(r.discountCost ?? 0)}`]),
    `trung bình ${formatVnd(r.avgOrderValue ?? 0)}/đơn`,
  ].join(' · ');
}
