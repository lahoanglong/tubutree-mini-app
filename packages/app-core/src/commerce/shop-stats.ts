import { fillCopy } from '../shop-copy';
import { formatRating, soldCountText } from './card-meta';
import { formatVnNumber } from '../number-format';

export interface ShopStat {
  label: string;
  value: string;
  spoken: string;
}

/** "Đã bán hơn 1.200": số tròn trăm (dưới 1 triệu) hoặc tròn trăm nghìn, khớp "1,2k+" nhìn thấy; dưới 1000 đọc nguyên số. */
function soldSpoken(sold: number): string {
  if (sold < 1000) return fillCopy('meta.sold', { n: sold });
  const step = sold < 1_000_000 ? 100 : 100_000;
  return fillCopy('stats.soldSpoken', { n: formatVnNumber(Math.floor(sold / step) * step) });
}

/**
 * Hàng số liệu của trang shop (ShopStatsRow): sản phẩm, đánh giá, đã bán. Mục không có dữ liệu thì bỏ (không in "★ NaN"
 * hay "Đã bán 0"); số sản phẩm luôn hiện kể cả 0. Chưa có "người theo dõi" vì đợt này không làm theo dõi gian hàng.
 */
export function shopStats(i: { productCount: number; ratingAvg?: number | null; sold?: number | null }): ShopStat[] {
  const stats: ShopStat[] = [
    { label: fillCopy('stats.products'), value: String(i.productCount), spoken: fillCopy('stats.productsSpoken', { n: i.productCount }) },
  ];
  const rating = formatRating(i.ratingAvg ?? 0);
  if (rating) stats.push({ label: fillCopy('stats.rating'), value: rating, spoken: fillCopy('stats.ratingSpoken', { avg: rating }) });
  const sold = soldCountText(i.sold);
  if (sold !== null) stats.push({ label: fillCopy('stats.sold'), value: sold, spoken: soldSpoken(Number(i.sold)) });
  return stats;
}
