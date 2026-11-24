import { useQueryClient } from '@tanstack/react-query';
import { subscribeRestock, unsubscribeRestock } from '@tubutree/app-core/api/restock-alerts';
import { withPurchasedRestock } from '@tubutree/app-core/commerce/quick-reorder';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PURCHASED_ITEMS_KEY } from '../../hooks/use-purchased-items';
import { useNotify } from '../../hooks/use-notify';
import { getErrorMessage } from '../../services/api';
import { coreHttp } from '../../services/core-http';
import type { PurchasedItemsPage } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { useLockedMutation } from '../game/use-locked-mutation';

interface Toggle {
  variationId: string;
  /** Khách đang chờ hàng về của phân loại này lúc chạm: chạm lần nữa là huỷ. */
  waiting: boolean;
}

/**
 * "Báo khi có" trên kệ Mua lại: một chạm đăng ký (hay huỷ, khi đang chờ) báo hàng về cho đúng phân loại đã mua. Vẽ ngay trên mọi trang món đã mua
 * trong cache, lỗi thì trả riêng phân loại đó về như cũ (lần chạm trên ô khác đang bay không bị xoá theo). Xong thì tải lại món đã mua và mọi trạng
 * thái báo hàng về (`['restock-alerts']`: trang Yêu thích, trang chi tiết) để chuông và nút ở đó khớp. Mỗi phân loại một lệnh bay mỗi lúc.
 */
export function useBuyAgainRestock() {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const patch = (variationId: string, waiting: boolean) =>
    qc.setQueriesData<PurchasedItemsPage>({ queryKey: [PURCHASED_ITEMS_KEY] }, (page) => (page ? withPurchasedRestock(page, variationId, waiting) : page));

  const toggle = useLockedMutation(
    {
      mutationFn: ({ variationId, waiting }: Toggle) => (waiting ? unsubscribeRestock(coreHttp, variationId) : subscribeRestock(coreHttp, variationId)),
      onMutate: async ({ variationId, waiting }: Toggle) => {
        await qc.cancelQueries({ queryKey: [PURCHASED_ITEMS_KEY] });
        patch(variationId, !waiting);
      },
      onSuccess: (_d, { waiting }) => notify({ text: fillCopy(waiting ? 'restock.cancelledToast' : 'restock.subscribedToast'), type: 'success' }),
      onError: (e, { variationId, waiting }) => {
        patch(variationId, waiting);
        notify({ text: getErrorMessage(e), type: 'error' });
      },
      onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: [PURCHASED_ITEMS_KEY] }), qc.invalidateQueries({ queryKey: ['restock-alerts'] })]),
    },
    ({ variationId }) => variationId,
  );

  return {
    /** Phân loại đang chờ máy chủ trả lời (nút của nó báo bận). */
    busyKey: toggle.isPending ? (toggle.variables?.variationId ?? null) : null,
    press: (variationId: string, waiting: boolean) => {
      haptic('light');
      toggle.mutate({ variationId, waiting });
    },
  };
}
