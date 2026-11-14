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
 * Dải mỏng báo trạng thái điểm danh hôm nay ở tab Săn mã của Ưu đãi. Điểm danh và tưới cây làm ở Vườn Xanh (một chỗ duy nhất), nên dải chỉ
 * ghi "đã" hay "chưa" và mở tab Vườn Xanh. Dùng chung khoá ['loyalty-checkin'] với chấm đỏ của tab nên không tốn thêm request.
 * Chưa đăng nhập, đang tải hay lỗi: không vẽ gì (khối này không đáng làm trang nhảy hay hiện lỗi).
 */
export function OffersCheckInStrip({ authed, onOpenGarden }: { authed: boolean; onOpenGarden: () => void }) {
  const q = useQuery({ ...checkInQuery(coreHttp), enabled: authed, staleTime: 60_000, retry: false });
  if (!authed || !q.data) return null;
  const title = fillCopy(checkInView(q.data).canCheckIn ? 'offers.checkInTodo' : 'offers.checkInDone');
  return (
    <section aria-label={title}>
      <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
        <ListRow icon={<OffersIconTile icon={Sprout} />} title={title} subtitle={fillCopy('offers.openGarden')} trailing="chevron" onPress={onOpenGarden} style={{ padding: 'var(--space-inset-card)' }} />
      </Card>
    </section>
  );
}
