import { CreditCard, PackageSearch, RotateCcw, ShieldCheck } from 'lucide-react';
import { STOREFRONT_TRUST_TITLE, storefrontTrustChips, type StorefrontTrustKey } from '@tubutree/app-core/commerce/storefront-trust';

export interface StorefrontTrustChipsProps {
  /** `returns.window_days` của cấu hình công khai: 0 bỏ chip đổi trả, chưa biết thì hứa chung. */
  returnWindowDays: unknown;
}

const ICONS: Record<StorefrontTrustKey, typeof ShieldCheck> = { reviewed: ShieldCheck, tracking: PackageSearch, payment: CreditCard, returns: RotateCcw };

/**
 * Dải cam kết: điện thoại là hàng chip gọn (chữ ngắn, tối đa hai hàng ở 375px, cùng số đo với Mini) ngay dưới đầu gian hàng; từ md là bốn ô chữ đủ.
 * Một bộ thẻ cho mọi khổ, chữ ngắn/đủ đổi bằng CSS. Không có hook nên trang server vẽ thẳng.
 */
export function StorefrontTrustChips({ returnWindowDays }: StorefrontTrustChipsProps) {
  return (
    <section aria-labelledby="cam-ket-gian-hang" className="mx-4 mt-3 md:mx-0 md:mt-4">
      <h2 id="cam-ket-gian-hang" className="sr-only">
        {STOREFRONT_TRUST_TITLE}
      </h2>
      <ul role="list" className="flex flex-wrap gap-1.5 md:grid md:grid-cols-4 md:gap-3">
        {storefrontTrustChips(returnWindowDays).map((chip) => {
          const Icon = ICONS[chip.key];
          return (
            <li
              key={chip.key}
              className="flex items-center gap-1.5 rounded-pill bg-[var(--color-bg-subtle)] px-2.5 py-1 md:gap-2 md:rounded-card md:border md:border-[var(--color-border-subtle)] md:bg-[var(--color-bg-surface)] md:p-3 md:[box-shadow:var(--elevation-1)]"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-brand)] md:h-4 md:w-4" aria-hidden="true" />
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                <span className="md:hidden">{chip.short}</span>
                <span className="hidden md:inline">{chip.full}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
