'use client';

// Nguồn: apps/miniapp/src/components/refill/refill-landing-entry.tsx
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import { refillFirstOn } from '@tubutree/app-core/refill/refill-api';
import { REFILL_LANDING_PATH, refillLandingCopy, refillLandingQuery, refillLandingRows } from '@tubutree/app-core/refill/refill-landing';
import { Card, Icon, ListRow } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';
import { usePublicConfig } from '@/lib/use-public-config';

/**
 * Lối vào trang "Tiết kiệm với Refill" ở hub Danh mục và trang Bộ quà tặng: một hàng (liên kết thật), chỉ hiện khi cờ `catalog.refill_first_enabled` bật VÀ trang có
 * ít nhất một thẻ gói bán được, để không dẫn khách tới trang trống. Đặt cuối trang nơi gọi nên hiện muộn sau khi tải không đẩy nội dung đang xem.
 */
export function RefillLandingEntry({ className = '' }: { className?: string }) {
  const on = refillFirstOn(usePublicConfig());
  const q = useQuery({ ...refillLandingQuery(coreHttp), enabled: on });
  if (!on || refillLandingRows(q.data).length === 0) return null;
  return (
    <Link href={REFILL_LANDING_PATH.web} data-testid="refill-landing-entry" className={`tubu-press block rounded-card ${className}`}>
      <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
        <ListRow
          icon={<Icon icon={Droplets} size="md" tone="brand" />}
          title={refillLandingCopy('title')}
          subtitle={refillLandingCopy('entrySub')}
          trailing="chevron"
          style={{ padding: 'var(--space-inset-card)' }}
        />
      </Card>
    </Link>
  );
}
