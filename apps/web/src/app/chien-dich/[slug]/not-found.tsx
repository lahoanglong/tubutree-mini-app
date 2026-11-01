'use client';

import { useRouter } from 'next/navigation';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { EmptyState } from '@/components/mini';
import { PageHeader } from '@/components/ui/page-header';

/** Chiến dịch hết hạn, chưa mở hay không có: cùng thanh tiêu đề, chữ, hình và nút với màn "đã kết thúc" của `pages/campaign.tsx` ở Mini App. */
export default function CampaignNotFound() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-3xl px-4">
      <PageHeader title="Chương trình" backHref="/" backLabel={fillCopy('campaign.backHome')} />
      <div className="px-2 py-6">
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
