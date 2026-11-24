import { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyRestockAlerts,
  myRestockAlertsKey,
  subscribeRestock,
  unsubscribeRestock,
  type MyRestockAlerts,
} from '@tubutree/app-core/api/restock-alerts';
import { applyRestockToggle, type WishlistRestockView } from '@tubutree/app-core/commerce/wishlist-filter';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useLockedMutation } from '../components/game/use-locked-mutation';
import { coreHttp } from '../services/core-http';
import { getErrorMessage, isStaleStateError } from '../services/api';
import { serverNow } from '../utils/server-clock';

type Toggle = { productId: string; view: Exclude<WishlistRestockView, { kind: 'none' }> };

/**
 * Đăng ký báo hàng về của khách cho trang Yêu thích (một lần gọi cho cả trang). Chỉ hỏi khi đã đăng nhập và danh sách có món hết hàng. Không thử
 * lại: lỗi hay API chưa có đường này thì trang giữ như trước (không chuông, không nhãn, không chip).
 */
export function useMyRestockAlerts(enabled: boolean) {
  return useQuery({ queryKey: myRestockAlertsKey, queryFn: () => fetchMyRestockAlerts(coreHttp), enabled, retry: false });
}

/**
 * Một chạm trên chuông: vẽ ngay (lạc quan), gửi lệnh, rồi tải lại danh sách đăng ký và trạng thái báo hàng về của trang chi tiết sản phẩm đó.
 * Lỗi thì gỡ đúng thay đổi của lần chạm này (không trả cả bản chụp cũ: lần chạm trên thẻ khác đang bay sẽ bị xoá theo). Máy chủ nói món đã có
 * hàng hay đã ngừng bán (400/404/409) thì tải lại danh sách yêu thích để thẻ hiện đúng.
 */
export function useRestockToggle(notify: (text: string, ok: boolean) => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // Số lệnh chuông chưa có trả lời của máy chủ. Không dùng `isMutating`: lệnh đang chờ tải lại cũng được đếm, nên lệnh xong sau sẽ bỏ
  // qua lần tải lại mà bản tải của lệnh kia đã gửi trước khi máy chủ ghi thay đổi của nó.
  const unanswered = useRef(0);
  const mark = (productId: string, on: boolean) =>
    setBusy((cur) => {
      const next = new Set(cur);
      if (on) next.add(productId);
      else next.delete(productId);
      return next;
    });

  const toggle = useLockedMutation(
    {
      mutationFn: async ({ view }: Toggle) => {
        if (view.kind === 'subscribe') await subscribeRestock(coreHttp, view.variationId);
        else await Promise.all(view.variationIds.map((id) => unsubscribeRestock(coreHttp, id)));
      },
      onMutate: async ({ productId, view }: Toggle) => {
        unanswered.current += 1;
        mark(productId, true);
        await qc.cancelQueries({ queryKey: myRestockAlertsKey });
        const prev = qc.getQueryData<MyRestockAlerts>(myRestockAlertsKey);
        if (prev) qc.setQueryData<MyRestockAlerts>(myRestockAlertsKey, applyRestockToggle(prev, productId, view, serverNow()));
        return { removed: prev?.items.filter((a) => view.kind === 'waiting' && view.variationIds.includes(a.variationId)) ?? [] };
      },
      onSuccess: (_d, { view }) => notify(fillCopy(view.kind === 'subscribe' ? 'restock.subscribedToast' : 'restock.cancelledToast'), true),
      onError: (e, { view }, ctx) => {
        qc.setQueryData<MyRestockAlerts>(myRestockAlertsKey, (cur) => {
          if (!cur) return cur;
          if (view.kind === 'subscribe') return { ...cur, items: cur.items.filter((a) => a.variationId !== view.variationId) };
          const back = (ctx?.removed ?? []).filter((a) => !cur.items.some((x) => x.variationId === a.variationId));
          return { ...cur, items: [...cur.items, ...back] };
        });
        notify(getErrorMessage(e), false);
        if (isStaleStateError(e)) void qc.invalidateQueries({ queryKey: ['wishlist'] });
      },
      // Khoá chạm giữ tới khi tải lại xong: nhả trạng thái bận cùng lúc để chuông không trông bấm được mà chạm bị nuốt.
      // Danh sách đăng ký chỉ tải lại khi không còn lệnh chuông nào chờ máy chủ: bản tải về lúc thẻ khác còn đang bay chưa có thay đổi
      // của thẻ đó và vẽ đè nó về trạng thái cũ (nhấp nháy). Lệnh trả lời sau cùng tải lại cho cả nhóm.
      onSettled: (_d, _e, { productId }) => {
        unanswered.current -= 1;
        return Promise.all([
          unanswered.current === 0 ? qc.invalidateQueries({ queryKey: myRestockAlertsKey }) : undefined,
          qc.invalidateQueries({ queryKey: ['restock-alerts', productId] }),
        ]).finally(() => mark(productId, false));
      },
    },
    ({ productId }) => productId,
  );

  return { press: (productId: string, view: Toggle['view']) => toggle.mutate({ productId, view }), busy };
}

/**
 * Chuông "Báo tôi khi có hàng" ở góc dưới ảnh thẻ hết hàng (chỗ nút giỏ nhanh của thẻ còn hàng), cùng khuôn `QuickAddButton`: vòng nhìn thấy
 * `--space-stack-xl`, vùng chạm 44px qua `tubu-hit-44-square`. Công tắc `aria-pressed`, tên đọc giữ nguyên ở hai trạng thái; đang chờ thì vòng tô
 * màu chính và chuông đặc.
 */
export function RestockBellButton({
  productId,
  name,
  on,
  busy,
  onPress,
}: {
  productId: string;
  name: string;
  on: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      data-restock-bell={productId}
      className="tubu-hit-44-square"
      aria-label={fillCopy('wishlist.restock.bell', { name })}
      aria-pressed={on}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onPress();
      }}
      style={{
        width: 'var(--space-stack-xl)',
        height: 'var(--space-stack-xl)',
        margin: 'var(--space-stack-xs)',
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        background: on ? 'var(--color-action-primary-bg)' : 'var(--color-bg-surface)',
        boxShadow: 'var(--elevation-1)',
        color: on ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Bell size={18} strokeWidth={1.9} fill={on ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}
