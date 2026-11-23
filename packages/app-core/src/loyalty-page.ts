import { offersTabHref } from './commerce/offers-hub';
import { formatVnNumber } from './number-format';
import { fillCopy } from './shop-copy';

/**
 * Lối đổi điểm khi lô điểm thường còn ≤ 30 ngày (`urgent` của `expiringPointsNote`). Không đứng riêng: `loyaltyOffersRow` mượn nhãn và dòng phụ này,
 * để trang vẫn chỉ có một lối sang tab Đổi quà (`/offers` ở Mini App vì `/rewards` cũ chỉ chuyển hướng về đó; `/uu-dai` ở web).
 *
 * `note` nói rõ lô sắp hết hạn là lô điểm thường và số dùng được ngay (`redeemablePoints` = điểm thường trừ phần còn khoá theo hạn đổi/trả), vì con số lớn ở
 * trang là tổng có cả lô quy đổi không hết hạn; chỉ có khi hai số khác nhau. Không mời khi chưa gấp, hay khi máy chủ báo không còn điểm nào đổi được ngay
 * (mời "Đổi ngay" mà kho quà báo thiếu điểm là hứa sai). API cũ chưa trả `redeemablePoints`: vẫn mời, không có `note`.
 */
export interface ExpiringRedeemCta {
  label: string;
  note: string | null;
}

export function expiringRedeemCta(
  expiring: { urgent: boolean } | null | undefined,
  points: { redeemable?: number | null; total: number },
): ExpiringRedeemCta | null {
  if (!expiring?.urgent) return null;
  const redeemable = typeof points.redeemable === 'number' && Number.isFinite(points.redeemable) ? Math.max(0, points.redeemable) : null;
  if (redeemable === 0) return null;
  return {
    label: fillCopy('loyalty.expiringCta'),
    note: redeemable !== null && redeemable !== points.total ? fillCopy('loyalty.expiringRedeemable', { n: formatVnNumber(redeemable) }) : null,
  };
}

/**
 * Dòng duy nhất của trang Điểm Xanh dẫn sang hub Ưu đãi (tab Đổi quà): kho quà và ví mã đều nằm ở hub nên trang chỉ giữ một lối.
 * Dòng phụ nêu số mã khi chắc khách đang có mã; chưa tải xong, tải lỗi hay chưa có mã thì nói chung, để dòng không đổi chiều cao khi mã về.
 * Khi điểm sắp hết hạn (`expiring` từ `expiringRedeemCta`) dòng đổi nhãn thành lời mời đổi ngay (`urgent`); nhãn đã có "→" nên nền bỏ mũi tên cuối dòng.
 * `basePath` là đường của hub trên từng nền (`/offers` ở Mini App, `/uu-dai` ở web).
 */
export function loyaltyOffersRow(
  basePath: string,
  couponCount: number | null | undefined,
  expiring?: ExpiringRedeemCta | null,
): { title: string; sub: string; href: string; urgent: boolean } {
  const sub = couponCount != null && couponCount > 0 ? fillCopy('loyalty.offersRowCount', { n: couponCount }) : fillCopy('loyalty.offersRowSub');
  return {
    title: expiring ? expiring.label : fillCopy('loyalty.offersRowTitle'),
    sub: expiring?.note ?? sub,
    href: offersTabHref(basePath, 'rewards'),
    urgent: Boolean(expiring),
  };
}

/** Lời dặn chụp màn hình thẻ thành viên để quét ở quầy khi mất mạng: chỉ khi quầy tích điểm được (`posCreditEnabled`), không thì thẻ chưa dùng ở quầy. */
export function memberCardOfflineHint(card: { posCreditEnabled: boolean } | null | undefined): string | null {
  return card?.posCreditEnabled ? fillCopy('loyalty.cardOfflineHint') : null;
}
