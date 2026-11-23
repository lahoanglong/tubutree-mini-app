import { offersTabHref } from './commerce/offers-hub';
import { formatVnNumber } from './number-format';
import { fillCopy } from './shop-copy';

/**
 * Dòng duy nhất của trang Điểm Xanh dẫn sang hub Ưu đãi (tab Đổi quà): kho quà và ví mã đều nằm ở hub nên trang chỉ giữ một lối.
 * Dòng phụ nêu số mã khi chắc khách đang có mã; chưa tải xong, tải lỗi hay chưa có mã thì nói chung, để dòng không đổi chiều cao khi mã về.
 * `basePath` là đường của hub trên từng nền (`/offers` ở Mini App, `/uu-dai` ở web).
 */
export function loyaltyOffersRow(basePath: string, couponCount: number | null | undefined): { title: string; sub: string; href: string } {
  return {
    title: fillCopy('loyalty.offersRowTitle'),
    sub: couponCount != null && couponCount > 0 ? fillCopy('loyalty.offersRowCount', { n: couponCount }) : fillCopy('loyalty.offersRowSub'),
    href: offersTabHref(basePath, 'rewards'),
  };
}

/**
 * Lối đổi điểm ngay dưới dòng "… sẽ hết hạn ngày …" khi lô điểm thường còn ≤ 30 ngày (`urgent` của `expiringPointsNote`). Đích là tab Đổi quà của hub Ưu đãi
 * (`/offers` ở Mini App: `/rewards` cũ chỉ chuyển hướng về đó; `/uu-dai` ở web).
 *
 * `note` nói rõ lô sắp hết hạn là lô điểm thường và số dùng được ngay (`redeemablePoints` = điểm thường trừ phần còn khoá theo hạn đổi/trả), vì con số lớn ở
 * trang là tổng có cả lô quy đổi không hết hạn; chỉ hiện khi hai số khác nhau. Không có CTA khi chưa gấp, hay khi máy chủ báo không còn điểm nào đổi được ngay
 * (mời "Đổi ngay" mà kho quà báo thiếu điểm là hứa sai). API cũ chưa trả `redeemablePoints`: vẫn mời, không có `note`.
 */
export function expiringRedeemCta(
  basePath: string,
  expiring: { urgent: boolean } | null | undefined,
  points: { redeemable?: number | null; total: number },
): { label: string; href: string; note: string | null } | null {
  if (!expiring?.urgent) return null;
  const redeemable = typeof points.redeemable === 'number' && Number.isFinite(points.redeemable) ? Math.max(0, points.redeemable) : null;
  if (redeemable === 0) return null;
  return {
    label: fillCopy('loyalty.expiringCta'),
    href: offersTabHref(basePath, 'rewards'),
    note: redeemable !== null && redeemable !== points.total ? fillCopy('loyalty.expiringRedeemable', { n: formatVnNumber(redeemable) }) : null,
  };
}

/** Lời dặn chụp màn hình thẻ thành viên để quét ở quầy khi mất mạng: chỉ khi quầy tích điểm được (`posCreditEnabled`), không thì thẻ chưa dùng ở quầy. */
export function memberCardOfflineHint(card: { posCreditEnabled: boolean } | null | undefined): string | null {
  return card?.posCreditEnabled ? fillCopy('loyalty.cardOfflineHint') : null;
}
