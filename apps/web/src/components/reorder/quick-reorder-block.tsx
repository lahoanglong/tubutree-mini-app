'use client';

// Nguồn: apps/miniapp/src/components/reorder/use-quick-reorder.ts + chỗ dùng QuickReorderStrip trong purchased-rail.tsx.
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { quickReorderLines, type QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import type { RefillQuickItem } from '@tubutree/app-core/refill/refill-rail';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { QuickReorderStrip } from '@/components/mini/quick-reorder-strip';
import { announcePdpNavigation } from '@/components/skeletons/pdp-nav-event';
import { trackWebEvent } from '@/lib/analytics';
import { playCartFeedback } from '@/lib/cart-feedback';
import { productHref } from '@/lib/product-href';
import { useBundleAdd } from '@/lib/use-bundle-add';
import { useBuyAgainRestock } from './use-buy-again-restock';

/** Tiền tố khoá danh sách món đã mua (`purchasedItemsQuery` thêm giới hạn ở cuối): dải vẽ từ đúng danh sách này, nên bị từ chối vì trạng thái đã đổi thì tải lại nó. */
const PURCHASED_ITEMS_KEY = ['purchased-items'] as const;
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
export function QuickReorderBlock({ items, onOpenBottle }: { items: readonly RefillQuickItem[]; onOpenBottle?: (bottle: QuickReorderItem) => void }) {
  const router = useRouter();
  const quick = useQuickAdd('repurchase', PURCHASED_ITEMS_KEY);
  // "Báo khi có" của ô hết hàng báo kết quả ở cùng thông báo nổi với "+ Thêm".
  const restock = useBuyAgainRestock(quick.notify);
  const bundle = useBundleAdd([PURCHASED_ITEMS_KEY]);
  const busyAll = bundle.busyId === ADD_ALL_ID;
  // Khoá chéo đồng bộ giữa hai đường thêm: `quick.busyId` và `busyAll` chỉ đúng sau lần vẽ kế nên hai cú bấm khác nút trong cùng khung hình sẽ bay hai lệnh.
  // "+ Thêm" tự chặn "+ Thêm" khác bằng cờ của `useQuickAdd`, còn lệnh lô chặn bằng `bundle.isBusy`; `oneInFlight` là phần "+ Thêm đang bay" cho lệnh lô đọc.
  // Chỉ cú "+ Thêm" ĐẶT cờ mới được nhả nó: cú bị `useQuickAdd` bỏ (đã có lệnh bay) trả lời hứa xong ngay, nhả cờ sẽ mở khoá cho lệnh lô khi lệnh đầu còn bay.
  const oneInFlight = useRef(false);

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
        onNotify={(item) => restock.press(item.variationId, item.restockWaiting === true)}
        notifyBusyKey={restock.busyKey}
        onAdd={(item) => {
          if (bundle.isBusy() || oneInFlight.current) return;
          oneInFlight.current = true;
          if ((item as RefillQuickItem).bottle) trackWebEvent('refill_swap_applied', { surface: 'reorder' });
          void quick.addVariation(item.variationId, { origin: addButtonOf(item.variationId) }).finally(() => {
            oneInFlight.current = false;
          });
        }}
        onAddAll={() => {
          if (oneInFlight.current) return;
          // Ô hết hàng ("Báo khi có") không vào lệnh lô: số món báo lại là số dòng thật sự gửi đi.
          const lines = quickReorderLines(items);
          bundle.add({
            id: ADD_ALL_ID,
            lines,
            errorKey: 'quickReorder.error',
            successText: fillCopy('quickReorder.addedAll', { n: lines.length }),
            onDone: () => playCartFeedback(document.querySelector(ADD_ALL_BUTTON)),
          });
        }}
        onOpen={(item) => {
          // Ô đã đổi sang gói Refill: mở tấm Mua lại của đúng chai cũ (khách vẫn mua lại được món cũ).
          const bottle = (item as RefillQuickItem).bottle;
          if (bottle && onOpenBottle) return onOpenBottle(bottle);
          const href = productHref(encodeURIComponent(item.slug), null, item.variationId);
          announcePdpNavigation(href);
          router.push(href);
        }}
      />
      {quick.feedback}
    </>
  );
}
