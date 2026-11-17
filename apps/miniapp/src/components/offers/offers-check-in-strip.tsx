import type { CSSProperties } from 'react';
import { Sprout } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { checkInView } from '@tubutree/app-core/loyalty-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { getDailyCheckInStatus } from '../../services/account-api';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';

const OFFERS_INSET: CSSProperties = { padding: 'var(--space-inset-card) var(--space-gutter) 0' };

/**
 * Dòng trạng thái điểm danh hôm nay ở tab Săn mã của Ưu đãi và ở trang Điểm Xanh. Điểm danh chỉ làm ở Vườn Xanh (một chỗ duy nhất), nên dòng chỉ
 * ghi "đã" hay "chưa" và mở tab Vườn Xanh, không bao giờ có nút điểm danh. Dùng chung khoá ['loyalty-checkin'] với chấm của tab nên không tốn thêm request.
 * Chưa đăng nhập, đang tải hay lỗi: không vẽ gì (khối này không đáng làm trang nhảy hay hiện lỗi).
 * Trang Điểm Xanh truyền `variant="raised"` và `style` riêng để dòng cùng mặt thẻ, cùng lề với các khối khác của trang.
 */
export function OffersCheckInStrip({
  authed,
  onOpenGarden,
  variant = 'outline',
  style = OFFERS_INSET,
}: {
  authed: boolean;
  onOpenGarden: () => void;
  variant?: 'outline' | 'raised';
  style?: CSSProperties;
}) {
  const q = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled: authed, staleTime: 60_000, retry: false });
  if (!authed || !q.data) return null;
  const title = fillCopy(checkInView(q.data).canCheckIn ? 'offers.checkInTodo' : 'offers.checkInDone');
  return (
    <section aria-label={title} style={style}>
      <Card variant={variant} padding={0} style={{ overflow: 'hidden' }}>
        <ListRow
          icon={<Icon icon={Sprout} tone="brand" />}
          title={title}
          subtitle={fillCopy('offers.openGarden')}
          trailing="chevron"
          onPress={onOpenGarden}
          style={{ padding: 'var(--space-inset-card)' }}
        />
      </Card>
    </section>
  );
}
