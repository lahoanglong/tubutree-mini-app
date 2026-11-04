'use client';

import { useRouter } from 'next/navigation';
import { STOREFRONT_NOT_FOUND, STOREFRONT_PUBLIC_TITLE } from '@tubutree/app-core/client-copy';
import { SuggestedRail } from '@/components/catalog/suggested-rail';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';

/** Gian hàng không có hoặc chưa duyệt: cùng thanh tiêu đề, chữ, nút và kệ gợi ý với màn không tìm thấy của `storefront-view.tsx` ở Mini App. */
export default function StorefrontNotFound() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-3xl md:px-4 md:py-6">
      <PageHeader title={STOREFRONT_PUBLIC_TITLE} />
      <ErrorState message={STOREFRONT_NOT_FOUND} onHome={() => router.replace('/')} />
      <SuggestedRail />
    </main>
  );
}
