import { fillTemplate } from '../copy-template';
import type { HttpClient } from '../http';
import { fillCopy } from '../shop-copy';
import type { RefillOfferDTO, RefillPairsDTO } from './refill-api';
import { refillUnitSaving } from './refill-rail';

/**
 * Chữ của huy hiệu "rẻ hơn mỗi 100ml" (trang chi tiết chai khách đã mua, liên kết đổi ở giỏ), dùng chung Mini App và web. Tách khỏi
 * `shop-copy.ts` như `referral/copy.ts`: web dựng dải trang chi tiết ở máy chủ và giỏ nạp module này riêng, nên chữ không vào gói khởi
 * động của Trang chủ.
 */
export const REFILL_SAVING_COPY = {
  badge: 'Rẻ hơn {pct}%/{per}',
  spoken: '{label}, rẻ hơn {pct}% mỗi {per}',
} as const;

export type RefillSavingCopyKey = keyof typeof REFILL_SAVING_COPY;

/** Trần độ dài sau khi điền số (huy hiệu một dòng cạnh nhãn ở khổ 360). */
export const REFILL_SAVING_COPY_MAX: Record<RefillSavingCopyKey, number> = {
  badge: 18,
  spoken: 56,
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

/** Dải "Đổi sang túi Refill 10L · Rẻ hơn 34%/100ml" ở trang chi tiết: mở trang gói Refill. */
export interface RefillSavingPill {
  slug: string;
  label: string;
  badge: string | null;
  /** Tên đọc, bắt đầu bằng đúng chữ nhìn thấy (WCAG 2.5.3). */
  spoken: string;
}

/**
 * Dải gói Refill cho trang chi tiết một chai đã ghép cặp (THUẦN). Chỉ khi có cặp và gói còn hàng; không đọc được lượng hay Refill không
 * rẻ hơn thì chỉ có nhãn đổi, không hứa rẻ hơn. Giá chai là giá đang bán trên thẻ (chưa gồm Giờ vàng), cùng cách tính giá gói Refill;
 * chai đang Giờ vàng (`flash`) thì khách thấy giá thấp hơn giá đó, nên không nêu mức rẻ hơn (như giỏ không mời đổi dòng Giờ vàng).
 * Người gọi chỉ vẽ khi khách đã nhận chai này (dòng "Bạn đã mua · Mua lại"): khách chưa có chai thì cần cái chai.
 */
export function pdpRefillPill(bottle: Bottle, offer: RefillOfferDTO | null | undefined, opts: { flash?: boolean } = {}): RefillSavingPill | null {
  if (!offer || !offer.inStock) return null;
  const label = fillCopy('refill.railBadge', { size: offer.sizeLabel ? ` ${offer.sizeLabel}` : '' });
  const s = opts.flash ? null : refillUnitSaving(bottle, offer);
  return { slug: offer.slug, label, badge: s ? refillSavingCopy('badge', s) : null, spoken: s ? refillSavingCopy('spoken', { label, ...s }) : label };
}

/** Cặp công khai của một sản phẩm (cờ `catalog.refill_first_enabled` tắt thì máy chủ trả `{}`); cache như danh mục. */
export const fetchRefillPair = (http: HttpClient, productId: string) => http.get<RefillPairsDTO>('/catalog/refill-pairs', { query: { ids: productId } });

export const refillPairQuery = (http: HttpClient, productId: string) => ({
  queryKey: ['refill-pairs', 'public', productId] as const,
  queryFn: () => fetchRefillPair(http, productId),
  staleTime: 5 * 60_000,
  retry: false,
});
