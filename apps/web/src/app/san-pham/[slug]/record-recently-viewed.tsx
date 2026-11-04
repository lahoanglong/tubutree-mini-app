'use client';

import { useEffect, useRef } from 'react';
import { recordRecentlyViewed } from '@/lib/recently-viewed';

/**
 * Ghi "Đã xem gần đây" MỘT lần cho mỗi slug sau khi trang sản phẩm gắn vào trình duyệt (như `useRecordRecentlyViewed` của Mini App: cùng trường, cùng thumbnail `thumbnail ?? images[0] ?? null`, do trang server tính sẵn). Không vẽ gì nên không ảnh hưởng HTML server hay hydrate; `recordRecentlyViewed` đã bắt lỗi localStorage.
 */
export function RecordRecentlyViewed({ slug, name, thumbnail }: { slug: string; name: string; thumbnail: string | null }) {
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (recorded.current === slug) return;
    recorded.current = slug;
    recordRecentlyViewed({ slug, name, thumbnail });
  }, [slug, name, thumbnail]);
  return null;
}
