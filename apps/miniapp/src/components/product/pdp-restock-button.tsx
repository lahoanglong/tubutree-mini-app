import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchRestockStatus,
  myRestockAlertsKey,
  restockStatusKey,
  subscribeRestock,
  unsubscribeRestock,
  type RestockStatus,
} from '@tubutree/app-core/api/restock-alerts';
import { restockButtonView, restockIntentAction } from '@tubutree/app-core/commerce/restock-intent';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Button } from '../ui/button';
import { useLockedMutation } from '../game/use-locked-mutation';
import { useLoginWithNotice } from '../../hooks/use-login-notice';
import { useNotify } from '../../hooks/use-notify';
import { coreHttp } from '../../services/core-http';
import { getErrorMessage } from '../../services/api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';

interface ToggleVars {
  variationId: string;
  subscribed: boolean;
}

/**
 * Trạng thái "Báo tôi khi có hàng" của sản phẩm cho khách đang xem; dùng chung khoá cache cho nút và chip phân loại. Chỉ hỏi khi sản phẩm có
 * phân loại hết hàng. Không thử lại: lỗi hay API chưa có đường này thì giữ nút xám như trước.
 */
export function useRestockStatus(productId: string | undefined, anyOut: boolean) {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: restockStatusKey(productId ?? '', authed),
    queryFn: () => fetchRestockStatus(coreHttp, productId!, { anonymous: !authed }),
    enabled: !!productId && anyOut,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Nút chính của thanh mua khi phân loại đang chọn hết hàng. Cờ catalog.restock_alert_enabled tắt (hoặc trạng thái chưa về) thì vẫn là
 * nút xám "Tạm hết hàng" như trước; bật thì "Báo tôi khi có hàng", bấm lại để huỷ. Khách chưa đăng nhập thì đăng nhập rồi đăng ký luôn.
 */
export function PdpRestockButton({ productId, variationId }: { productId: string; variationId: string | undefined }) {
  const qc = useQueryClient();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const loginWithNotice = useLoginWithNotice();
  const { notify } = useNotify();
  const statusQ = useRestockStatus(productId, true);

  const toggle = useLockedMutation(
    {
      mutationFn: ({ variationId: id, subscribed }: ToggleVars) =>
        subscribed ? unsubscribeRestock(coreHttp, id) : subscribeRestock(coreHttp, id),
      onMutate: async ({ variationId: id, subscribed }) => {
        const meKey = restockStatusKey(productId, true);
        await qc.cancelQueries({ queryKey: meKey });
        const prev = qc.getQueryData<RestockStatus>(meKey);
        if (prev) {
          const ids = subscribed ? prev.variationIds.filter((x) => x !== id) : [...prev.variationIds, id];
          qc.setQueryData<RestockStatus>(meKey, { ...prev, variationIds: ids });
        }
        return { prev };
      },
      onSuccess: (_d, { subscribed }) => {
        notify({ text: fillCopy(subscribed ? 'restock.cancelledToast' : 'restock.subscribedToast'), type: 'success' });
      },
      onError: (e, _v, ctx) => {
        if (ctx?.prev) qc.setQueryData(restockStatusKey(productId, true), ctx.prev);
        notify({ text: getErrorMessage(e), type: 'error' });
      },
      // Trang Yêu thích đọc danh sách đăng ký riêng (`myRestockAlertsKey`): làm mới cùng lúc để quay lại trang đó thấy đúng chuông và nhãn.
      onSettled: () =>
        Promise.all([qc.invalidateQueries({ queryKey: restockStatusKey(productId, true) }), qc.invalidateQueries({ queryKey: myRestockAlertsKey })]),
    },
    ({ variationId: id }) => id,
  );

  const view = restockButtonView(statusQ.data, variationId);
  if (view.kind === 'off' || !variationId) {
    return (
      <Button variant="primary" size="lg" fullWidth disabled>
        {vi.product.outOfStock}
      </Button>
    );
  }
  const subscribed = view.kind === 'subscribed';

  const onPress = async () => {
    haptic('light');
    if (!authed) {
      await loginWithNotice();
      if (useAuthStore.getState().status !== 'authenticated') return;
      // Đăng nhập xong mới biết khách đã đăng ký phân loại này từ trước chưa: đã đăng ký thì giữ nguyên, không huỷ ngược ý khách.
      const fresh = await qc.fetchQuery({
        queryKey: restockStatusKey(productId, true),
        queryFn: () => fetchRestockStatus(coreHttp, productId, { anonymous: false }),
      });
      if (restockIntentAction({ variationId }, fresh, [{ id: variationId, stock: 0 }]) === 'subscribe') {
        toggle.mutate({ variationId, subscribed: false });
      }
      return;
    }
    toggle.mutate({ variationId, subscribed });
  };

  return (
    <Button
      variant={subscribed ? 'secondary' : 'primary'}
      size="lg"
      fullWidth
      loading={toggle.isPending}
      aria-pressed={subscribed}
      onPress={onPress}
      className="tubu-pdp-restock"
    >
      {fillCopy(subscribed ? 'restock.subscribed' : 'restock.notifyMe')}
    </Button>
  );
}
