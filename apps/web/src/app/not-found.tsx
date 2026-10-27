'use client';

import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/mini';
import { SR_ONLY } from '@/components/mini/sr-only';

/** 404 cùng chữ và hình với `pages/not-found.tsx` của Mini App. */
export default function NotFound() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-3xl px-4">
      <h1 style={SR_ONLY}>Không tìm thấy trang</h1>
      <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <EmptyState
          art="search"
          heading="Trang này lạc vào vườn rồi"
          body="Có thể liên kết đã cũ hoặc trang không tồn tại. Quay về trang chủ để tiếp tục dạo vườn nhé."
          ctaLabel="Về trang chủ"
          onCta={() => router.replace('/')}
        />
      </div>
    </main>
  );
}
