import { REFILL_LANDING_PATH, refillLandingCopy, refillLandingRows, type RefillLandingDTO } from '@tubutree/app-core/refill/refill-landing';
import type { RefillEntryLink } from '@/components/refill/refill-landing-link';

/** Chỉ trang máy chủ gọi (đưa chữ xuống client thành prop): nhập module này từ component client sẽ kéo `refill-landing.ts` vào JS trang. */
export function refillEntryLink(): RefillEntryLink {
  return { href: REFILL_LANDING_PATH.web, title: refillLandingCopy('title'), sub: refillLandingCopy('entrySub') };
}

/**
 * Lối vào khi trang Refill có gói bán được (cờ `catalog.refill_first_enabled` tắt thì API trả rỗng). `undefined`: API lỗi, trang nơi đặt tự quyết
 * (hub Danh mục hỏi lại ở trình duyệt); đã hỏi được mà trống thì `null`. `productSlugs` có thì chỉ khi một thẻ của trang có gói hoặc chai thuộc tập đó
 * (trang thương hiệu: chỉ nhãn có hàng Refill mới mang link).
 */
export function refillEntryOf(landing: RefillLandingDTO | undefined, productSlugs?: ReadonlySet<string>): RefillEntryLink | null | undefined {
  if (landing === undefined) return undefined;
  const rows = refillLandingRows(landing);
  const hit = productSlugs ? rows.some((r) => productSlugs.has(r.view.slug) || r.bottles.some((b) => productSlugs.has(b.slug))) : rows.length > 0;
  return hit ? refillEntryLink() : null;
}
