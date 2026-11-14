'use client';

import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/components/mini';

/** Ô icon vuông của hàng trong thẻ Ưu đãi (tiện ích, dải điểm danh, Điểm Xanh): cùng số đo ở mọi hàng của trang. */
export function OffersIconTile({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} tone="brand" />
    </span>
  );
}
