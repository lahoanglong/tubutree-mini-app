'use client';

import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/mini';
import { SR_ONLY } from '@/components/mini/sr-only';

/** Nhãn không có hoặc chưa công khai: cùng chữ, hình và nút với màn 404 của `brand-view.tsx` ở Mini App. */
export default function BrandNotFound() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-3xl px-4">
      <h1 style={SR_ONLY}>Nhãn hàng</h1>
      <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <EmptyState
          art="search"
          heading="Không tìm thấy nhãn hàng"
          body="Nhãn này chưa được công khai hoặc liên kết đã cũ. Xem các nhãn khác trong Danh mục nhé."
          ctaLabel="Xem Danh mục"
          onCta={() => router.replace('/san-pham')}
        />
      </div>
    </main>
  );
}
