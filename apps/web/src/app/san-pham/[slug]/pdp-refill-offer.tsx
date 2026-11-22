'use client';

import { useRouter } from 'next/navigation';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { PdpRefillOffer } from '@/components/mini/pdp-refill-offer';
import { useRefillOfferAdd } from '@/components/refill/use-refill-offer-add';

const addButton = () => document.querySelector('[data-testid="pdp-refill-add"]');

/**
 * Thẻ gói Refill của trang chi tiết web (trang dựng `view` ở máy chủ từ cặp công khai) kèm đường thêm giỏ dùng chung `useRefillOfferAdd` (nguồn ghi nhận `pdp`).
 * Thất bại: thẻ dựng ở máy chủ, không có truy vấn ở trình duyệt để tải lại, nên làm mới trang (gói vừa hết hàng hay đổi giá thì thẻ đổi theo).
 */
export function PdpRefillOfferBlock({ view, blocked = false }: { view: PdpRefillOfferView; blocked?: boolean }) {
  const router = useRouter();
  const refill = useRefillOfferAdd('pdp', ['refill-pairs', 'public', view.productId], { onRejected: () => router.refresh() });
  const onAdd = () => {
    if (blocked) return;
    refill.add(view, addButton());
  };
  return (
    <>
      <PdpRefillOffer view={view} busy={refill.busyVariationId === view.variationId} blocked={blocked} onAdd={onAdd} />
      {refill.feedback}
    </>
  );
}
