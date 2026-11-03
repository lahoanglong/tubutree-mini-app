'use client';

import { useRouter } from 'next/navigation';
import { SuggestedRail } from '@/components/catalog/suggested-rail';
import { EmptyState } from '@/components/mini/empty-state';

/**
 * Giỏ trống như Mini App: minh hoạ + lời mời + nút, rồi kệ gợi ý. Tải lười vì chỉ khách giỏ trống mới cần. Ở điện thoại khung
 * của trang chừa lề 12px hai bên và 8px phía trên cho danh sách dòng giỏ; màn trống bỏ phần đó để kệ sát lề 16px như Mini App.
 */
export default function EmptyCart() {
  const router = useRouter();
  return (
    <div className="max-md:-mx-3 max-md:-mt-2">
      <EmptyState
        art="basket"
        heading="Giỏ còn trống đấy"
        body="Khám phá sản phẩm Tubu chọn riêng cho bạn"
        ctaLabel="Khám phá ngay"
        onCta={() => router.push('/san-pham')}
      />
      <SuggestedRail />
    </div>
  );
}
