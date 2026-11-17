'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchRestockStatus,
  restockStatusKey,
  subscribeRestock,
  unsubscribeRestock,
  type RestockStatus,
} from '@tubutree/app-core/api/restock-alerts';
import { restockButtonView, restockIntentAction, type RestockButtonView } from '@tubutree/app-core/commerce/restock-intent';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loginHref } from '@/lib/return-to';
import { actionErrorText } from '@/lib/error-text';
import { clearPendingRestock, rememberPendingRestock, takePendingRestock } from '@/lib/pending-restock';
import { useLockedMutation } from '@/components/game/use-locked-mutation';

interface ToggleVars {
  variationId: string;
  subscribed: boolean;
}

export interface RestockControl {
  view: RestockButtonView;
  pending: boolean;
  press: () => void;
}

/**
 * "Báo tôi khi có hàng" của khối mua trang sản phẩm (cờ catalog.restock_alert_enabled). Một hook cho cả hai nút (thanh dính điện thoại và nút
 * máy tính) để chỉ có một trạng thái và một lệnh ghi. Khách chưa đăng nhập: nhớ phân loại, sang đăng nhập, quay lại thì đăng ký nốt đúng một lần.
 * Chỉ hỏi trạng thái khi sản phẩm có phân loại hết hàng.
 */
export function useRestock({
  productId,
  slug,
  variations,
  selectedId,
  onSelect,
  onNotice,
}: {
  productId: string | undefined;
  slug: string;
  variations: readonly { id: string; stock: number }[];
  selectedId: string;
  onSelect: (variationId: string) => void;
  onNotice: (text: string, ok: boolean) => void;
}): RestockControl {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const anyOut = variations.some((v) => v.stock <= 0);
  const statusQ = useQuery({
    queryKey: restockStatusKey(productId ?? '', authed),
    queryFn: () => fetchRestockStatus(coreHttp, productId!, { anonymous: !authed }),
    enabled: !!productId && anyOut && phase !== 'loading',
    staleTime: 30_000,
  });

  const toggle = useLockedMutation(
    {
      mutationFn: ({ variationId, subscribed }: ToggleVars) =>
        subscribed ? unsubscribeRestock(coreHttp, variationId) : subscribeRestock(coreHttp, variationId),
      onMutate: async ({ variationId, subscribed }) => {
        const key = restockStatusKey(productId ?? '', true);
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<RestockStatus>(key);
        if (prev) {
          const ids = subscribed ? prev.variationIds.filter((x) => x !== variationId) : [...prev.variationIds, variationId];
          qc.setQueryData<RestockStatus>(key, { ...prev, variationIds: ids });
        }
        return { prev };
      },
      onSuccess: (_d, { subscribed }) => onNotice(fillCopy(subscribed ? 'restock.cancelledToast' : 'restock.subscribedToast'), true),
      onError: (e, _v, ctx) => {
        if (ctx?.prev) qc.setQueryData(restockStatusKey(productId ?? '', true), ctx.prev);
        onNotice(actionErrorText(e), false);
      },
      onSettled: () => qc.invalidateQueries({ queryKey: restockStatusKey(productId ?? '', true) }),
    },
    ({ variationId }) => variationId,
  );

  // Quay về sau đăng nhập với phiên và trạng thái đã tải: chọn lại phân loại khách đã bấm và đăng ký nốt (một lần). Quay về mà vẫn là khách
  // (bỏ dở đăng nhập) thì xoá ý định, để lần đăng nhập sau không tự đăng ký điều khách đã quên.
  const intentHandled = useRef(false);
  const status = statusQ.isSuccess ? statusQ.data : null;
  useEffect(() => {
    if (phase === 'guest') {
      clearPendingRestock();
      return;
    }
    if (!authed || !status || intentHandled.current) return;
    intentHandled.current = true;
    const intent = takePendingRestock(variations.map((v) => v.id));
    if (!intent) return;
    onSelect(intent.variationId);
    if (restockIntentAction(intent, status, variations) === 'subscribe') toggle.mutate({ variationId: intent.variationId, subscribed: false });
    // `toggle`, `onSelect`, `variations` đổi tham chiếu mỗi lần vẽ: chạy lại theo phiên và trạng thái là đủ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, authed, status]);

  const view = restockButtonView(statusQ.data, selectedId || undefined);
  const press = () => {
    if (view.kind === 'off' || phase === 'loading') return;
    if (phase === 'unavailable') {
      onNotice(fillCopy('restock.offline'), false);
      return;
    }
    if (phase === 'guest') {
      rememberPendingRestock({ variationId: selectedId });
      router.push(loginHref(`/san-pham/${encodeURIComponent(slug)}`));
      return;
    }
    toggle.mutate({ variationId: selectedId, subscribed: view.kind === 'subscribed' });
  };
  return { view, pending: toggle.isPending, press };
}

/** Nút chính khi phân loại đang chọn hết hàng: đặc khi chưa đăng ký, viền khi đã đăng ký (bấm lại để huỷ). */
export function RestockButton({
  control,
  primaryClass,
  secondaryClass,
  testId,
}: {
  control: RestockControl;
  primaryClass: string;
  secondaryClass: string;
  testId: string;
}) {
  const subscribed = control.view.kind === 'subscribed';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={control.press}
      aria-pressed={subscribed}
      aria-busy={control.pending || undefined}
      aria-disabled={control.pending || undefined}
      className={subscribed ? secondaryClass : primaryClass}
    >
      {fillCopy(subscribed ? 'restock.subscribed' : 'restock.notifyMe')}
    </button>
  );
}
