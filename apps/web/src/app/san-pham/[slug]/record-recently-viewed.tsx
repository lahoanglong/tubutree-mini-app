'use client';

import { useEffect, useRef } from 'react';
import { recordRecentlyViewed } from '@/lib/recently-viewed';

/**
 * Ghi "Đã xem gần đây" MỘT lần cho mỗi slug sau khi trang sản phẩm gắn vào trình duyệt (như `useRecordRecentlyViewed` của Mini App: cùng trường, cùng thumbnail
 * `thumbnail ?? images[0] ?? null`). Không vẽ gì nên không ảnh hưởng HTML server hay hydrate; `recordRecentlyViewed` đã bắt lỗi localStorage.
 */
export function RecordRecentlyViewed({ slug, name, thumbnail, images }: { slug: string; name: string; thumbnail: string | null; images: readonly string[] }) {
  const recorded = useRef<string | null>(null);
  const first = images[0] ?? null;
  useEffect(() => {
    if (recorded.current === slug) return;
    recorded.current = slug;
    recordRecentlyViewed({ slug, name, thumbnail: thumbnail ?? first });
  }, [slug, name, thumbnail, first]);
  return null;
}
