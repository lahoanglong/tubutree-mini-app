import { Badge } from './primitives';

/**
 * Huy hiệu bậc CTV hiển thị công khai trên trang gian hàng — dữ liệu đến từ
 * `storefront.ownerTier` (GET /storefront/public/:slug), tính từ doanh số tháng của CTV
 * (affiliate.service.ts monthlyTier, xem storefront.service.ts getPublicBySlug). Chỉ có
 * name+emoji, KHÔNG có doanh thu/bonusPct thật — không lộ doanh số CTV cho khách.
 */
export function TierBadge({ name, emoji }: { name: string; emoji: string }) {
  return (
    <Badge tone="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span aria-hidden>{emoji}</span>
      {name}
    </Badge>
  );
}
