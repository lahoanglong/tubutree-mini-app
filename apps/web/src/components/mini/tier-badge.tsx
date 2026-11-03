'use client';

// Nguồn: apps/miniapp/src/components/ui/tier-badge.tsx
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from './badge';

/**
 * Huy hiệu bậc CTV hiển thị công khai trên trang gian hàng — dữ liệu đến từ
 * `storefront.ownerTier` (GET /storefront/public/:slug), tính từ doanh số tháng của CTV
 * (affiliate.service.ts monthlyTier, xem storefront.service.ts getPublicBySlug). Chỉ có
 * name+emoji, KHÔNG có doanh thu/bonusPct thật — không lộ doanh số CTV cho khách.
 * Chữ ghi "CTV {tên bậc}" (shop-copy): emoji bị aria-hidden nên trình đọc chỉ nghe chữ, và tên bậc đứng một mình ("Đồng") không nói nó là gì.
 */
export function TierBadge({ name, emoji }: { name: string; emoji: string }) {
  return (
    <Badge tone="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span aria-hidden>{emoji}</span>
      {fillCopy('shop.tierBadge', { name })}
    </Badge>
  );
}

/**
 * Chỗ giữ cho huy hiệu bậc khi `/affiliate/tiers` chưa về: cùng `Badge` (nên cao đúng bằng huy hiệu thật, bậc về thì thay vào mà hàng không nhảy) nhưng chữ tàng hình và không có chữ "CTV ..." nào trong cây
 * (trình đọc màn hình và e2e không thấy một huy hiệu giả). Bậc lỗi, hết hạn chờ hoặc là bậc thấp nhất thì nơi gọi thay bằng `TierBadgeHint`.
 */
export function TierBadgeSkeleton() {
  return (
    <span data-testid="tier-badge-skeleton" aria-hidden="true" className="tubu-skeleton" style={{ display: 'inline-flex', borderRadius: 'var(--radius-pill)' }}>
      <Badge tone="brand" style={{ visibility: 'hidden' }}>
        <span style={{ display: 'inline-block', width: '5.5rem' }}>{'\u00a0'}</span>
      </Badge>
    </span>
  );
}

/**
 * Chỗ huy hiệu bậc của gian hàng CTV khi KHÔNG có huy hiệu để khoe (bậc thấp nhất, `/affiliate/tiers` lỗi, mất mạng hoặc hết hạn chờ): giữ đúng chiều cao hàng huy hiệu để lúc bậc về muộn
 * (khung chờ biến mất) hàng không thu lại và đẩy phần dưới lên, mà vẫn có chữ nói vì sao trang khách chưa có huy hiệu. Chỉ chủ shop thấy ở trình dựng, trang khách không vẽ: viền đứt, nền trong, chữ phụ để không giống một huy hiệu công khai.
 */
export function TierBadgeHint({ nextName }: { nextName?: string | null }) {
  return (
    <span data-testid="tier-badge-hint" style={{ display: 'inline-flex' }}>
      <Badge tone="neutral" size="sm" style={{ background: 'transparent', color: 'var(--color-text-secondary)', border: 'thin dashed var(--color-border-default)' }}>
        {nextName ? fillCopy('shop.tierHintNext', { name: nextName }) : fillCopy('shop.tierHint')}
      </Badge>
    </span>
  );
}
