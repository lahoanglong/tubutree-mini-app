'use client';

import BackLink from '@/components/back-link';
import { RewardsView } from '@/components/rewards/rewards-view';
import { RecycleRewardsNavPills } from '@/components/ui/ecosystem-nav-pills';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_WIDE } from '@/lib/page-frame';

const TITLE = 'Kho quà Điểm Xanh';

export default function RewardsPage() {
  return (
    <main className={`${PAGE_WIDE} pb-6 pt-0 md:pt-6 tabular-nums`}>
      <BackLink href="/" crumbs={[{ label: 'Trang chủ', href: '/' }, { label: TITLE }]}>
        ← Trang chủ
      </BackLink>
      <PageHeader title={TITLE} backHref="/" backLabel="Về trang chủ" className="md:mt-1" />
      <div className="mt-3">
        <RecycleRewardsNavPills />
      </div>
      <div className="mt-4">
        <RewardsView />
      </div>
    </main>
  );
}
