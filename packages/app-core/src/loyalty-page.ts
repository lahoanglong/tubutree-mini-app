import { offersTabHref } from './commerce/offers-hub';
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
