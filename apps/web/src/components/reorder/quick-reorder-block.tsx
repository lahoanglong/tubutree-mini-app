'use client';

// Nguồn: apps/miniapp/src/components/reorder/use-quick-reorder.ts + chỗ dùng QuickReorderStrip trong purchased-rail.tsx.
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { quickReorderLines, type QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { QuickReorderStrip } from '@/components/mini/quick-reorder-strip';
import { announcePdpNavigation } from '@/components/skeletons/pdp-nav-event';
import { playCartFeedback } from '@/lib/cart-feedback';
import { productHref } from '@/lib/product-href';
import { useBundleAdd } from '@/lib/use-bundle-add';

const ADD_ALL_ID = 'quick-reorder';
const ADD_ALL_BUTTON = '[data-testid="quick-reorder"] .tubu-quick-head button';

/** Nút "+ Thêm" của đúng phân loại: nguồn của chấm bay tới giỏ (dải chỉ trao `item` cho `onAdd`, nên hỏi DOM thay vì giữ ref từng thẻ). */
function addButtonOf(variationId: string): Element | null {
  const all = document.querySelectorAll('[data-testid="quick-reorder-add"]');
  return Array.from(all).find((el) => el.getAttribute('data-variation-id') === variationId) ?? null;
}

/**
 * Dải "Mua lại món quen" kèm hành vi thêm (bản web của `useQuickReorder` ở Mini App): một chạm thêm đúng phân loại đã mua (số lượng 1, nguồn `repurchase`, thông báo
 * nổi "Đã thêm vào giỏ!" như mọi đường giỏ nhanh); "Thêm lại tất cả" là một lệnh lô (máy chủ thêm hết hoặc không món nào) và kết quả cũng hiện ở thông báo nổi.
 * Mỗi lúc chỉ một lệnh bay: lệnh thứ hai bấm lúc lệnh đầu chưa xong bị bỏ. Khách chưa đăng nhập bấm "Thêm lại tất cả" thì sang đăng nhập (do `useBundleAdd`).
 */
export function QuickReorderBlock({ items }: { items: readonly QuickReorderItem[] }) {
  const router = useRouter();
  const quick = useQuickAdd('repurchase');
  const bundle = useBundleAdd();
  const busyAll = bundle.busyId === ADD_ALL_ID;

  // `notify` đổi danh tính mỗi lần vẽ: giữ ở ref để effect chỉ chạy khi lệnh lô có kết quả mới.
  const notifyRef = useRef(quick.notify);
  notifyRef.current = quick.notify;
  const result = bundle.result;
  useEffect(() => {
    if (result?.id === ADD_ALL_ID) notifyRef.current({ ok: result.ok, text: result.text });
  }, [result]);

  return (
    <>
      <QuickReorderStrip
        items={items}
        busyKey={quick.busyId}
        busyAll={busyAll}
        onAdd={(item) => {
          if (busyAll) return;
          void quick.addVariation(item.variationId, { origin: addButtonOf(item.variationId) });
        }}
        onAddAll={() => {
          if (quick.busyId !== null) return;
          bundle.add({
            id: ADD_ALL_ID,
            lines: quickReorderLines(items),
            errorKey: 'quickReorder.error',
            successText: fillCopy('quickReorder.addedAll', { n: items.length }),
            onDone: () => playCartFeedback(document.querySelector(ADD_ALL_BUTTON)),
          });
        }}
        onOpen={(item) => {
          const href = productHref(encodeURIComponent(item.slug), null, item.variationId);
          announcePdpNavigation(href);
          router.push(href);
        }}
      />
      {quick.feedback}
    </>
  );
}
