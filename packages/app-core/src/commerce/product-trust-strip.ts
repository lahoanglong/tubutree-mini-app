import type { LegalSlug } from '../legal';
import { returnsPromise } from '../returns-copy';
import { fillCopy } from '../shop-copy';

/**
 * Dải cam kết ở trang chi tiết sản phẩm (ProductTrustStrip), ngay dưới khối chọn phân loại và Số lượng. Mini App và web cùng gọi
 * `productTrustStrip`: trụ cột nào hiện, chữ nào, lối xem chính sách nào không được lệch giữa hai nền tảng.
 *
 * Chỉ hứa điều Tubu làm được cho mọi sản phẩm Tubu giao. Hàng gian hàng tự giao (và gian hàng tạm nghỉ) không có cam kết đóng gói hay
 * đổi trả của Tubu nên không có dải. Đổi trả tắt ở cấu hình (`returns.window_days` = 0) thì bỏ trụ đổi trả, cùng luật với `returnsPromise`.
 */

export type TrustPillarKey = 'origin' | 'delivery' | 'returns';

export interface TrustPillar {
  key: TrustPillarKey;
  title: string;
  sub: string;
}

export interface ProductTrustCta {
  /** Chính sách mở khi chạm: Mini mở ngay trong app, web đi tới `/chinh-sach/{slug}`. */
  slug: Extract<LegalSlug, 'doi-tra' | 'van-chuyen'>;
  label: string;
  ariaLabel: string;
}

export interface ProductTrustStripView {
  groupAria: string;
  pillars: TrustPillar[];
  cta: ProductTrustCta;
}

export interface ProductTrustInput {
  /** `fulfiller.kind` của sản phẩm; chưa biết (API cũ) coi như hàng Tubu, như khối "Cam kết Tubu" ở cuối trang. */
  fulfillerKind: string | null | undefined;
  /** `returns.window_days` của cấu hình công khai; mọi giá trị khác 0 (kể cả chưa tải) vẫn giữ trụ đổi trả. */
  returnWindowDays: unknown;
}

const pillar = (key: TrustPillarKey): TrustPillar => ({ key, title: fillCopy(`trust.${key}.title`), sub: fillCopy(`trust.${key}.sub`) });

export function productTrustStrip({ fulfillerKind, returnWindowDays }: ProductTrustInput): ProductTrustStripView | null {
  if (fulfillerKind === 'MERCHANT' || fulfillerKind === 'UNAVAILABLE') return null;
  const withReturns = returnsPromise(returnWindowDays) !== null;
  const pillars = [pillar('origin'), pillar('delivery'), ...(withReturns ? [pillar('returns')] : [])];
  const which = withReturns ? 'returns' : 'shipping';
  return {
    groupAria: fillCopy('trust.groupAria'),
    pillars,
    cta: { slug: withReturns ? 'doi-tra' : 'van-chuyen', label: fillCopy(`trust.cta.${which}`), ariaLabel: fillCopy(`trust.ctaAria.${which}`) },
  };
}
