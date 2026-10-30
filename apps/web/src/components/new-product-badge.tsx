'use client';

import { isNewProduct, NEW_PRODUCT_LABEL } from '@tubutree/app-core/product-badges';
import { useHydrated } from '@/lib/use-hydrated';
import { useCatalogLaunchDate } from '@/lib/use-catalog-launch-date';

/**
 * Nhãn "Mới" tính theo giờ máy khách nên chỉ vẽ sau hydrate: HTML dựng sẵn (ISR) có thể được trả muộn hơn lúc dựng, SP qua mốc 30 ngày
 * hoặc đồng hồ máy khách lệch thì server và lần hydrate đầu sẽ khác nhau một phần tử ("Hydration failed", chớp màn).
 */
export function NewProductBadge({ createdAt }: { createdAt: string | null | undefined }) {
  const hydrated = useHydrated();
  const launchDate = useCatalogLaunchDate();
  if (!hydrated || !isNewProduct(createdAt, Date.now(), launchDate)) return null;
  return (
    <span
      data-testid="card-new-badge"
      className="rounded-full bg-[var(--color-action-secondary-bg)] px-1.5 py-0.5 text-xs font-semibold text-[var(--color-action-secondary-fg)]"
    >
      {NEW_PRODUCT_LABEL}
    </span>
  );
}
