'use client';

// Nguồn: apps/miniapp/src/components/reorder/use-buy-again-restock.ts (cùng khoá cache, cùng lệnh, cùng chữ báo).
import { useQueryClient } from '@tanstack/react-query';
import type { PurchasedItemsPage } from '@tubutree/app-core/api/orders';
import { subscribeRestock, unsubscribeRestock } from '@tubutree/app-core/api/restock-alerts';
import { withPurchasedRestock } from '@tubutree/app-core/commerce/quick-reorder';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';

/** Tiền tố khoá danh sách món đã mua (`purchasedItemsQuery` thêm giới hạn ở cuối): kệ, Trang chủ và trang chi tiết đọc chung. */
const PURCHASED_ITEMS_KEY = ['purchased-items'] as const;

interface Toggle {
  variationId: string;
  /** Khách đang chờ hàng về của phân loại này lúc chạm: chạm lần nữa là huỷ. */
  waiting: boolean;
}

/**
 * "Báo khi có" trên kệ Mua lại: một chạm đăng ký (hay huỷ, khi đang chờ) báo hàng về cho đúng phân loại đã mua. Vẽ ngay trên mọi trang món đã mua
 * trong cache, lỗi thì trả riêng phân loại đó về như cũ. Xong thì tải lại món đã mua và mọi trạng thái báo hàng về (`['restock-alerts']`: trang Yêu thích,
 * trang chi tiết). Mỗi phân loại một lệnh bay mỗi lúc. `notify` là chỗ báo của nơi gọi (thông báo nổi của dải, dòng trạng thái của kệ).
 */
export function useBuyAgainRestock(notify: (n: { ok: boolean; text: string }) => void) {
  const qc = useQueryClient();
  const patch = (variationId: string, waiting: boolean) =>
    qc.setQueriesData<PurchasedItemsPage>({ queryKey: PURCHASED_ITEMS_KEY }, (page) => (page ? withPurchasedRestock(page, variationId, waiting) : page));

  const toggle = useLockedMutation(
    {
      mutationFn: ({ variationId, waiting }: Toggle) => (waiting ? unsubscribeRestock(coreHttp, variationId) : subscribeRestock(coreHttp, variationId)),
      onMutate: async ({ variationId, waiting }: Toggle) => {
        await qc.cancelQueries({ queryKey: PURCHASED_ITEMS_KEY });
        patch(variationId, !waiting);
      },
      onSuccess: (_d, { waiting }) => notify({ ok: true, text: fillCopy(waiting ? 'restock.cancelledToast' : 'restock.subscribedToast') }),
      onError: (e, { variationId, waiting }) => {
        patch(variationId, waiting);
        notify({ ok: false, text: actionErrorText(e) });
      },
      onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: PURCHASED_ITEMS_KEY }), qc.invalidateQueries({ queryKey: ['restock-alerts'] })]),
    },
    ({ variationId }) => variationId,
  );

  return {
    /** Phân loại đang chờ máy chủ trả lời (nút của nó báo bận). */
    busyKey: toggle.isPending ? (toggle.variables?.variationId ?? null) : null,
    press: (variationId: string, waiting: boolean) => toggle.mutate({ variationId, waiting }),
  };
}
