'use client';

import { useRouter } from 'next/navigation';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { EmptyState } from '@/components/mini';
import { SR_ONLY } from '@/components/mini/sr-only';

/** Chiến dịch hết hạn, chưa mở hay không có: cùng chữ, hình và nút với màn "đã kết thúc" của `pages/campaign.tsx` ở Mini App. */
export default function CampaignNotFound() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-3xl px-4">
      <h1 style={SR_ONLY}>Chương trình</h1>
      <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <EmptyState
          art="search"
          heading={fillCopy('campaign.endedTitle')}
          body={fillCopy('campaign.endedBody')}
          ctaLabel={fillCopy('campaign.backHome')}
          onCta={() => router.replace('/')}
        />
      </div>
    </main>
  );
}
