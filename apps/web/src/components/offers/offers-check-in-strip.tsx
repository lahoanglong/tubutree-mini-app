'use client';

// Nguồn: apps/miniapp/src/components/offers/offers-check-in-strip.tsx
import { useQuery } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { checkInView } from '@tubutree/app-core/loyalty-copy';
import { checkInQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Card, ListRow } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';
import { OffersIconTile } from './offers-icon-tile';

/**
 * Dòng trạng thái điểm danh hôm nay ở tab Săn mã của Ưu đãi và ở trang Điểm Xanh. Điểm danh chỉ làm ở Vườn Xanh (một chỗ duy nhất), nên dòng chỉ
 * ghi "đã" hay "chưa" và mở Vườn Xanh, không bao giờ có nút điểm danh. Dùng chung khoá ['loyalty-checkin'] với chấm của tab nên không tốn thêm request.
 * Chưa đăng nhập, đang tải hay lỗi: không vẽ gì (khối này không đáng làm trang nhảy hay hiện lỗi).
 * Trang Điểm Xanh truyền `variant="raised"` để dòng cùng mặt thẻ với các khối khác, `className` để đặt dòng vào cột của lưới.
 */
export function OffersCheckInStrip({
  authed,
  onOpenGarden,
  variant = 'outline',
  className,
}: {
  authed: boolean;
  onOpenGarden: () => void;
  variant?: 'outline' | 'raised';
  className?: string;
}) {
  const q = useQuery({ ...checkInQuery(coreHttp), enabled: authed, staleTime: 60_000, retry: false });
  if (!authed || !q.data) return null;
  const title = fillCopy(checkInView(q.data).canCheckIn ? 'offers.checkInTodo' : 'offers.checkInDone');
  return (
    <section aria-label={title} className={className}>
      <Card variant={variant} padding={0} style={{ overflow: 'hidden' }}>
        <ListRow icon={<OffersIconTile icon={Sprout} />} title={title} subtitle={fillCopy('offers.openGarden')} trailing="chevron" onPress={onOpenGarden} style={{ padding: 'var(--space-inset-card)' }} />
      </Card>
    </section>
  );
}
