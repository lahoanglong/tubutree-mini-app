'use client';

import { useQuery } from '@tanstack/react-query';
import { getConfig } from '@/lib/admin-client';
import { LoadError } from '@/components/admin/ui';
import { GROWTH_GROUPS } from './growth-controls';
import { GrowthControlGroup } from './growth-hub-controls';
import { GrowthFunnel } from './growth-funnel';
import { GrowthBanners } from './growth-banners';

/**
 * Trung tâm tăng trưởng: phễu chuyển đổi ở trên, bên dưới là công tắc game, trần Điểm Xanh, tính năng giữ chân, kinh tế đơn hàng và banner.
 * Công tắc ghi cùng khoá với tab Cấu hình (dùng chung truy vấn `admin-config`), nên đổi ở đâu cũng thấy ở chỗ kia.
 */
export function GrowthHubTab({ onOpenConfig, onOpenCampaigns }: { onOpenConfig?: () => void; onOpenCampaigns?: () => void }) {
  const q = useQuery({ queryKey: ['admin-config'], queryFn: () => getConfig() });
  const [games, caps, growth, economy] = GROWTH_GROUPS;
  return (
    <div className="space-y-4" data-growth-hub>
      <GrowthFunnel />
      {q.isError && <LoadError message="Không tải được cấu hình hiện tại; công tắc tạm khoá." onRetry={() => q.refetch()} retrying={q.isFetching} />}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <GrowthControlGroup group={games!} rows={q.data} onOpenConfig={onOpenConfig} />
          <GrowthControlGroup group={caps!} rows={q.data} />
        </div>
        <div className="space-y-4">
          <GrowthControlGroup group={economy!} rows={q.data} />
          <GrowthControlGroup group={growth!} rows={q.data} />
          <GrowthBanners onOpenCampaigns={onOpenCampaigns} />
        </div>
      </div>
    </div>
  );
}
