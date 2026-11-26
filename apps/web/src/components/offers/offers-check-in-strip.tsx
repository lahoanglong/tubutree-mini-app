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
 * Dòng Vườn Xanh ở tab Săn mã của Ưu đãi (ngay sau banner chiến dịch) và ở trang Điểm Xanh. Đã đăng nhập: ghi hôm nay "đã" hay "chưa" điểm danh và
 * mở Vườn Xanh; điểm danh chỉ làm ở Vườn Xanh (một chỗ duy nhất) nên không bao giờ có nút điểm danh. Dùng chung khoá ['loyalty-checkin'] với chấm của
 * thẻ Vườn Xanh ở Trang chủ nên không tốn thêm request.
 * `showGuest` (Ưu đãi): khách chưa đăng nhập, hay trạng thái điểm danh đang tải hoặc lỗi, vẫn thấy dòng "Vườn Xanh" cùng chiều cao (lối vào nổi
 * thay tab giữa cũ, W42), không làm trang nhảy khi trạng thái về. Không truyền thì như trước: chỉ vẽ khi đã có trạng thái.
 * Trang Điểm Xanh truyền `variant="raised"` để dòng cùng mặt thẻ với các khối khác, `className` để đặt dòng vào cột của lưới.
 */
export function OffersCheckInStrip({
  authed,
  onOpenGarden,
  showGuest = false,
  variant = 'outline',
  className,
}: {
  authed: boolean;
  onOpenGarden: () => void;
  showGuest?: boolean;
  variant?: 'outline' | 'raised';
  className?: string;
}) {
  const q = useQuery({ ...checkInQuery(coreHttp), enabled: authed, staleTime: 60_000, retry: false });
  const status = authed ? q.data : undefined;
  if (!status && !showGuest) return null;
  const title = status ? fillCopy(checkInView(status).canCheckIn ? 'offers.checkInTodo' : 'offers.checkInDone') : fillCopy('offers.gardenTitle');
  return (
    <section aria-label={title} data-testid="offers-garden-row" className={className}>
      <Card variant={variant} padding={0} style={{ overflow: 'hidden' }}>
        <ListRow
          icon={<OffersIconTile icon={Sprout} />}
          title={title}
          subtitle={fillCopy(status ? 'offers.openGarden' : 'offers.gardenSub')}
          trailing="chevron"
          onPress={onOpenGarden}
          style={{ padding: 'var(--space-inset-card)' }}
        />
      </Card>
    </section>
  );
}
