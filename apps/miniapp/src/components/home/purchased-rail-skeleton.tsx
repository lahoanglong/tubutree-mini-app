import { Skeleton } from '../ui/skeleton';

export const COMPACT_CARD_HEIGHT = 168;
export const HEADING_HEIGHT = 24;
export const HEADING_PAD_TOP = 4;
export const HEADING_PAD_BOTTOM = 8;
export const RAIL_PADDING_BOTTOM = 12;

/** Khung chờ của kệ Mua lại, tách khỏi purchased-rail.tsx để Trang chủ dùng làm chỗ giữ khi chunk kệ chưa về mà vẫn đúng từng px với khung chờ của kệ thật. */
export function PurchasedRailSkeleton() {
  return (
    <div data-testid="purchased-rail-loading" aria-hidden="true" style={{ paddingBottom: RAIL_PADDING_BOTTOM }}>
      <div style={{ padding: `${HEADING_PAD_TOP}px 16px ${HEADING_PAD_BOTTOM}px` }}>
        <Skeleton width={96} height={HEADING_HEIGHT} />
      </div>
      <div style={{ padding: '0 16px' }}>
        <Skeleton height={COMPACT_CARD_HEIGHT} radius="var(--radius-card)" />
      </div>
    </div>
  );
}
