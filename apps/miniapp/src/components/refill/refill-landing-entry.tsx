import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import { refillFirstOn } from '@tubutree/app-core/refill/refill-api';
import { REFILL_LANDING_PATH, refillLandingCopy, refillLandingQuery, refillLandingRows } from '@tubutree/app-core/refill/refill-landing';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useSmartNavigate } from '../../lib/smart-nav';
import { coreHttp } from '../../services/core-http';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';

/**
 * Lối vào trang "Tiết kiệm với Refill" ở hub Danh mục và trang Bộ quà tặng: một hàng, chỉ hiện khi cờ `catalog.refill_first_enabled` bật VÀ trang có ít nhất một
 * thẻ gói bán được, để không dẫn khách tới trang trống. Đặt cuối trang nơi gọi nên hiện muộn sau khi tải không đẩy nội dung đang xem.
 */
export function RefillLandingEntry({ style }: { style?: CSSProperties }) {
  const on = refillFirstOn(usePublicConfig());
  const q = useQuery({ ...refillLandingQuery(coreHttp), enabled: on });
  if (!on || refillLandingRows(q.data).length === 0) return null;
  return <EntryRow style={style} />;
}

/** Hàng chỉ dựng khi có trang để mở: hook điều hướng cần router, nơi gọi không có router (spec hub) không phải dựng nó khi lối vào ẩn. */
function EntryRow({ style }: { style?: CSSProperties }) {
  const goSmart = useSmartNavigate();
  return (
    <div data-testid="refill-landing-entry" style={style}>
      <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
        <ListRow
          icon={<Icon icon={Droplets} size="md" tone="brand" />}
          title={refillLandingCopy('title')}
          subtitle={refillLandingCopy('entrySub')}
          trailing="chevron"
          onPress={() => goSmart(REFILL_LANDING_PATH.miniapp)}
          style={{ padding: 'var(--space-inset-card)' }}
        />
      </Card>
    </div>
  );
}
