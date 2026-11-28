import { fillTemplate } from '../copy-template';
import { formatVnNumber } from '../number-format';
import { refillLandingRows, type RefillLandingDTO } from './refill-landing';

/**
 * Chữ của thẻ chuyển đổi sau khi gửi mã đơn sàn thành công (w55-01): Mini `/points/scan` và web `/quet-ma` đọc cùng một nguồn. Tách khỏi `shop-copy.ts`
 * và `shop-copy-boot.ts`: chỉ chunk lười của thẻ nạp, không vào gói đầu Mini App hay gói khởi động web. Nút chính "Dùng điểm mua lần sau" nằm ở
 * `marketplace-scan-guide.ts` (`scanSuccessCtaLabel`); ở đây chỉ chữ riêng của thẻ.
 */
export const POST_SCAN_COPY = {
  region: 'Gợi ý sau khi tích điểm',
  value: '≈ {vnd}đ giảm cho lần mua sau',
  add: 'Thêm',
  added: 'Đã thêm',
  addAria: 'Thêm {name} vào giỏ',
} as const;

export type PostScanCopyKey = keyof typeof POST_SCAN_COPY;

/** Số ký tự tối đa sau khi điền giá trị xấu nhất; null = dòng có tên sản phẩm (cắt bằng CSS). Chỉ spec đọc. */
export const POST_SCAN_COPY_MAX: Record<PostScanCopyKey, number | null> = {
  region: 30,
  value: 40,
  add: 6,
  added: 10,
  addAria: null,
};

export function postScanCopy(key: PostScanCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(POST_SCAN_COPY[key], vars, key);
}

/** 1 Điểm Xanh = 1đ (`loyalty.vnd_per_point_redeem` mặc định 1, cùng hằng ở `order-discount.ts`): dùng khi cấu hình chưa về hay số hỏng. */
export const POST_SCAN_VND_PER_POINT = 1;

/** Số đồng khách đổi được từ số điểm của đơn vừa quét (làm tròn xuống); null khi chưa có điểm (REVIEW thiếu tiền hàng, đang tìm đơn) hay số hỏng. */
export function postScanValueVnd(points: number | null | undefined, vndPerPointRedeem?: number | null): number | null {
  if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) return null;
  const rate = typeof vndPerPointRedeem === 'number' && Number.isFinite(vndPerPointRedeem) && vndPerPointRedeem > 0 ? vndPerPointRedeem : POST_SCAN_VND_PER_POINT;
  const vnd = Math.floor(points * rate);
  return vnd > 0 ? vnd : null;
}

/** Tối đa hai gói gợi ý: thẻ ba dòng (giá trị điểm + hai gói), không thêm dòng nào nữa. */
export const POST_SCAN_OFFERS_MAX = 2;

export interface PostScanOfferView {
  /** Phân loại vào giỏ khi bấm "Thêm"; cũng là khoá hàng. */
  variationId: string;
  slug: string;
  name: string;
  /** Giá gói đang bán trên thẻ, đã định dạng; giá cuối do giỏ tính lại. */
  priceLabel: string;
  addAria: string;
}

export interface PostScanView {
  /** "≈ 1.990đ giảm cho lần mua sau"; null khi chưa có điểm. */
  valueText: string | null;
  offers: PostScanOfferView[];
}

/**
 * Gói gợi ý sau khi quét: mỗi gói Refill một dòng, theo thứ tự máy chủ của trang Tiết kiệm với Refill (còn hàng, rẻ hơn nhiều nhất trước), tối đa hai.
 * Đơn sàn không có dòng sản phẩm (payload chỉ giữ số lượng và giá) nên không ghép theo món đã mua; không có gói nào (cờ tắt, chưa tải, dữ liệu hỏng)
 * thì không có dòng gợi ý và thẻ vẫn đủ giá trị điểm + hai nút.
 */
export function postScanView(
  input: { points: number | null | undefined; vndPerPointRedeem?: number | null; landing: RefillLandingDTO | null | undefined },
  formatPrice: (n: number) => string,
): PostScanView {
  const vnd = postScanValueVnd(input.points, input.vndPerPointRedeem);
  const offers = refillLandingRows(input.landing)
    .slice(0, POST_SCAN_OFFERS_MAX)
    .map((row) => ({
      variationId: row.view.variationId,
      slug: row.view.slug,
      name: row.view.name,
      priceLabel: formatPrice(row.view.price),
      addAria: postScanCopy('addAria', { name: row.view.name }),
    }));
  return { valueText: vnd === null ? null : postScanCopy('value', { vnd: formatVnNumber(vnd) }), offers };
}
