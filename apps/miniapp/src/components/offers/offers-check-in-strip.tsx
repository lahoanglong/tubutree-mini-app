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
 * Dòng Vườn Xanh ở tab Săn mã của Ưu đãi (ngay sau banner chiến dịch) và ở trang Điểm Xanh. Đã đăng nhập: ghi hôm nay "đã" hay "chưa" điểm danh và
 * mở Vườn Xanh; điểm danh chỉ làm ở Vườn Xanh (một chỗ duy nhất) nên không bao giờ có nút điểm danh. Dùng chung khoá ['loyalty-checkin'] với chấm của
 * thẻ Vườn Xanh ở Trang chủ nên không tốn thêm request.
 * `showGuest` (Ưu đãi): khách chưa đăng nhập, hay trạng thái điểm danh đang tải hoặc lỗi, vẫn thấy dòng "Vườn Xanh" cùng chiều cao (lối vào nổi
 * thay tab giữa cũ, W42), không làm trang nhảy khi trạng thái về. Không truyền thì như trước: chỉ vẽ khi đã có trạng thái.
 * Trang Điểm Xanh truyền `variant="raised"` và `style` riêng để dòng cùng mặt thẻ, cùng lề với các khối khác của trang.
 */
export function OffersCheckInStrip({
  authed,
  onOpenGarden,
  showGuest = false,
  variant = 'outline',
  style = OFFERS_INSET,
}: {
  authed: boolean;
  onOpenGarden: () => void;
  showGuest?: boolean;
  variant?: 'outline' | 'raised';
  style?: CSSProperties;
}) {
  const q = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled: authed, staleTime: 60_000, retry: false });
  const status = authed ? q.data : undefined;
  if (!status && !showGuest) return null;
  const title = status ? fillCopy(checkInView(status).canCheckIn ? 'offers.checkInTodo' : 'offers.checkInDone') : fillCopy('offers.gardenTitle');
  return (
    <section aria-label={title} data-testid="offers-garden-row" style={style}>
      <Card variant={variant} padding={0} style={{ overflow: 'hidden' }}>
        <ListRow
          icon={<Icon icon={Sprout} tone="brand" />}
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
