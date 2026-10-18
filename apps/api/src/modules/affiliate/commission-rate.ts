import type { SystemConfigService } from '../system-config/system-config.service';
import { AFFILIATE_MAX_RATE_KEY, DEFAULT_AFFILIATE_MAX_RATE_PCT, sanitizeMaxRate } from './commission-rate-csv';

/**
 * % hoa hồng CTV mặc định khi biến thể CHƯA có `affiliateRate` (NULL). Hàng đồng bộ liên tục từ Pancake nên không thể nhập
 * từng biến thể; mức tường minh của biến thể (kể cả 0) luôn thắng. PHẦN TRĂM (8 = 8%), số nguyên như `rateProblem`.
 * Chỉ áp cho hàng Tubu: hàng gian hàng đối tác chỉ có hoa hồng khi admin đặt riêng mức cho biến thể.
 */
export const AFFILIATE_DEFAULT_RATE_KEY = 'affiliate.default_rate_pct';
export const DEFAULT_AFFILIATE_DEFAULT_RATE_PCT = 8;

/** Giá trị đọc từ cấu hình; hỏng (không phải số nguyên 0–50) thì dùng mặc định thay vì ra 0đ hay mức vô lý. */
export function sanitizeDefaultRate(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 50 ? value : DEFAULT_AFFILIATE_DEFAULT_RATE_PCT;
}

/** Mức mặc định thực áp: không vượt trần `affiliate.max_rate_pct` (trần hạ sau khi đặt mặc định thì mặc định theo trần). */
export async function loadDefaultRate(config: Pick<SystemConfigService, 'get'>): Promise<number> {
  const [rate, max] = await Promise.all([
    config.get<unknown>(AFFILIATE_DEFAULT_RATE_KEY, DEFAULT_AFFILIATE_DEFAULT_RATE_PCT),
    config.get<unknown>(AFFILIATE_MAX_RATE_KEY, DEFAULT_AFFILIATE_MAX_RATE_PCT),
  ]);
  return Math.min(sanitizeDefaultRate(rate), sanitizeMaxRate(max));
}

export interface VariationRateInput {
  /** `Variation.affiliateRate` (Decimal hoặc số); null = chưa đặt. */
  explicit: { toString(): string } | number | null | undefined;
  /** `Product.affiliateBlocked`. */
  blocked: boolean;
  /** Sản phẩm thuộc gian hàng đối tác (`Product.storefrontId` khác null). */
  partnerProduct: boolean;
  /** Hàng ký gửi của chính người giới thiệu mà bảng kê đối tác sẽ trả tiền cho họ. */
  ownConsignment: boolean;
  defaultPct: number;
}

/** % hoa hồng áp cho một dòng hàng lúc đặt đơn. Kết quả được chốt vào Commission.lineAmounts nên đổi mặc định sau này không ghi đè đơn cũ. */
export function resolveVariationRate(i: VariationRateInput): number {
  if (i.blocked || i.ownConsignment) return 0;
  if (i.explicit !== null && i.explicit !== undefined) {
    const n = Number(i.explicit.toString());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return i.partnerProduct ? 0 : i.defaultPct;
}

/** Mức cao nhất một sản phẩm có thể cho CTV (huy hiệu "+X% hoa hồng"): cùng luật với lúc tính tiền, nên không hiện % cho hàng thực nhận 0đ. */
export function maxResolvedRate(
  variations: readonly { affiliateRate: VariationRateInput['explicit'] }[],
  product: { affiliateBlocked?: boolean | null; storefrontId?: string | null },
  defaultPct: number,
): number {
  return variations.reduce(
    (m, v) =>
      Math.max(
        m,
        resolveVariationRate({
          explicit: v.affiliateRate,
          blocked: !!product.affiliateBlocked,
          partnerProduct: !!product.storefrontId,
          ownConsignment: false,
          defaultPct,
        }),
      ),
    0,
  );
}
