'use client';

import { useRouter } from 'next/navigation';
import { PRODUCT_NOT_FOUND } from '@tubutree/app-core/client-copy';
import { SR_ONLY } from '@/components/mini/sr-only';
import { SuggestedRail } from '@/components/catalog/suggested-rail';
import { ErrorState } from '@/components/ui/error-state';

/** Sản phẩm không có hoặc đã gỡ: cùng chữ, nút, hotline và kệ gợi ý với màn 404 của `product-detail.tsx` ở Mini App. */
export default function ProductNotFound() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-3xl">
      <h1 style={SR_ONLY}>Chi tiết sản phẩm</h1>
      <ErrorState message={PRODUCT_NOT_FOUND} onHome={() => router.replace('/')} />
      <SuggestedRail />
    </main>
  );
}
