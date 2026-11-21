import { computeRefillValueComparison, type RefillValueComparison } from '../commerce/cart-progress';
import { vnd } from '../commerce/money';
import { parseNetAmount } from '../commerce/unit-price';
import { fillTemplate } from '../copy-template';
import type { HttpClient } from '../http';
import { fillCopy } from '../shop-copy';
import type { RefillOfferDTO, RefillPairsDTO } from './refill-api';
import { refillUnitSaving } from './refill-rail';

/**
 * Chữ của huy hiệu "rẻ hơn mỗi 100ml" (liên kết đổi ở giỏ) và thẻ so túi/can Refill ở trang chi tiết chai, dùng chung Mini App và web. Tách
 * khỏi `shop-copy.ts` như `referral/copy.ts`: web dựng thẻ trang chi tiết ở máy chủ và giỏ nạp module này riêng, nên chữ không vào gói khởi
 * động của Trang chủ.
 */
export const REFILL_SAVING_COPY = {
  badge: 'Rẻ hơn {pct}%/{per}',
  offerTitle: 'Chọn {pack} Refill{size}',
  offerTitleSave: 'Chọn {pack} Refill{size} tiết kiệm {amount} (~{pct}%)',
  offerMeta: 'Thay thế {n} chai nhựa · {price}',
} as const;

export type RefillSavingCopyKey = keyof typeof REFILL_SAVING_COPY;

/** Trần độ dài sau khi điền số: huy hiệu một dòng cạnh nhãn ở khổ 360; tiêu đề thẻ tối đa hai dòng, dòng phụ một dòng cạnh nút "+ Thêm" ở khổ 320. */
export const REFILL_SAVING_COPY_MAX: Record<RefillSavingCopyKey, number> = {
  badge: 18,
  offerTitle: 28,
  offerTitleSave: 52,
  offerMeta: 36,
};

export function refillSavingCopy(key: RefillSavingCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(REFILL_SAVING_COPY[key], vars, key);
}

type Bottle = { name: string; price: number };

/** "Rẻ hơn 34%/100ml": gói Refill rẻ hơn chai trên cùng lượng (làm tròn xuống); null khi không đọc được lượng hay không rẻ hơn. */
export function refillSavingBadge(bottle: Bottle, offer: Pick<RefillOfferDTO, 'name' | 'sizeLabel' | 'price'>): string | null {
  const s = refillUnitSaving(bottle, offer);
  return s ? refillSavingCopy('badge', s) : null;
}

/** Thẻ "Chọn túi Refill 10L tiết kiệm 470.000đ (~34%) · Thay thế 20 chai nhựa · 890.000đ" ở trang chi tiết chai: mở trang gói, hoặc thêm gói vào giỏ một chạm. */
export interface PdpRefillOfferView {
  slug: string;
  productId: string;
  /** Phân loại vào giỏ khi bấm "+ Thêm". */
  variationId: string;
  name: string;
  /** Giá gói đang bán trên thẻ (đồng), chưa gồm Giờ vàng. */
  price: number;
  /** Dòng chính: "Chọn túi Refill 10L tiết kiệm 470.000đ (~34%)", không so được thì "Chọn túi Refill 10L". */
  title: string;
  /** Dòng phụ: "Thay thế 20 chai nhựa · 890.000đ", không có số chai thì chỉ giá gói. */
  meta: string;
  /** Nhãn đọc của nút "+ Thêm" (bắt đầu bằng chữ nhìn thấy, WCAG 2.5.3). */
  addAria: string;
  comparison: RefillValueComparison | null;
}

const CAN = /(^|[^\p{L}])can(?![\p{L}])/iu;

/**
 * Thẻ gói Refill cho trang chi tiết một chai đã ghép cặp (THUẦN), cho mọi khách: chỉ khi có cặp và gói còn hàng. Số tiết kiệm, phần trăm và
 * số chai thay chỉ khi đọc được lượng cả hai bên cùng chiều và gói rẻ hơn mỗi ml (`computeRefillValueComparison`); không thì chỉ mời chọn,
 * không hứa gì. Giá chai là giá đang bán trên thẻ (chưa gồm Giờ vàng), cùng cách tính giá gói; chai đang Giờ vàng (`flash`) thì khách thấy giá
 * thấp hơn giá đó, nên không so (như giỏ không mời đổi dòng Giờ vàng). Không dùng số gam nhựa: thẻ chỉ nói số chai suy ra từ tỉ lệ lượng.
 */
export function pdpRefillOffer(
  bottle: Bottle,
  offer: RefillOfferDTO | null | undefined,
  opts: { flash?: boolean; packFlashPrice?: number | null } = {},
): PdpRefillOfferView | null {
  if (!offer || !offer.inStock) return null;
  const pack = CAN.test(offer.name) ? 'can' : 'túi';
  const size = offer.sizeLabel ? ` ${offer.sizeLabel}` : '';
  const b = parseNetAmount(bottle.name, '');
  const r = parseNetAmount(offer.sizeLabel ?? '', offer.name);
  const packFlash = typeof opts.packFlashPrice === 'number' && Number.isFinite(opts.packFlashPrice) && opts.packFlashPrice > 0 ? opts.packFlashPrice : null;
  const comparison = !opts.flash && packFlash === null && b && r && b.unit === r.unit ? computeRefillValueComparison(bottle.price, b.qty, offer.price, r.qty) : null;
  const price = vnd(packFlash ?? offer.price);
  return {
    slug: offer.slug,
    productId: offer.productId,
    variationId: offer.variationId,
    name: offer.name,
    price: packFlash ?? offer.price,
    title: comparison
      ? refillSavingCopy('offerTitleSave', { pack, size, amount: vnd(comparison.savedVnd), pct: comparison.savedPct })
      : refillSavingCopy('offerTitle', { pack, size }),
    meta: comparison && comparison.bottlesReplaced >= 1 ? refillSavingCopy('offerMeta', { n: comparison.bottlesReplaced, price }) : price,
    addAria: fillCopy('freeship.addAria', { name: offer.name, price }),
    comparison,
  };
}

/** Cặp công khai của một sản phẩm (cờ `catalog.refill_first_enabled` tắt thì máy chủ trả `{}`); cache như danh mục. */
export const fetchRefillPair = (http: HttpClient, productId: string) => http.get<RefillPairsDTO>('/catalog/refill-pairs', { query: { ids: productId } });

export const refillPairQuery = (http: HttpClient, productId: string) => ({
  queryKey: ['refill-pairs', 'public', productId] as const,
  queryFn: () => fetchRefillPair(http, productId),
  staleTime: 5 * 60_000,
  retry: false,
});
