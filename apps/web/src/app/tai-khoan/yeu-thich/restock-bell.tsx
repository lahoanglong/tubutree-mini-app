'use client';

import { useState } from 'react';
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
import { wishlistQuery } from '@tubutree/app-core/queries/wishlist';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { serverRejectedState } from '@/lib/server-rejected-state';

// Nguồn: apps/miniapp/src/pages/wishlist-restock.tsx (cùng hook, cùng nút, cùng khoá cache).

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
 * hàng hay đã ngừng bán (400/404/409/422) thì tải lại danh sách yêu thích để thẻ hiện đúng.
 */
export function useRestockToggle(notify: (n: { ok: boolean; text: string }) => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
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
        mark(productId, true);
        await qc.cancelQueries({ queryKey: myRestockAlertsKey });
        const prev = qc.getQueryData<MyRestockAlerts>(myRestockAlertsKey);
        if (prev) qc.setQueryData<MyRestockAlerts>(myRestockAlertsKey, applyRestockToggle(prev, productId, view, serverNow()));
        return { removed: prev?.items.filter((a) => view.kind === 'waiting' && view.variationIds.includes(a.variationId)) ?? [] };
      },
      onSuccess: (_d, { view }) => notify({ ok: true, text: fillCopy(view.kind === 'subscribe' ? 'restock.subscribedToast' : 'restock.cancelledToast') }),
      onError: (e, { view }, ctx) => {
        qc.setQueryData<MyRestockAlerts>(myRestockAlertsKey, (cur) => {
          if (!cur) return cur;
          if (view.kind === 'subscribe') return { ...cur, items: cur.items.filter((a) => a.variationId !== view.variationId) };
          const back = (ctx?.removed ?? []).filter((a) => !cur.items.some((x) => x.variationId === a.variationId));
          return { ...cur, items: [...cur.items, ...back] };
        });
        notify({ ok: false, text: actionErrorText(e) });
        if (serverRejectedState(e)) void qc.invalidateQueries({ queryKey: wishlistQuery(coreHttp).queryKey });
      },
      onSettled: (_d, _e, { productId }) => {
        mark(productId, false);
        return Promise.all([
          qc.invalidateQueries({ queryKey: myRestockAlertsKey }),
          qc.invalidateQueries({ queryKey: ['restock-alerts', productId] }),
        ]);
      },
    },
    ({ productId }) => productId,
  );

  return { press: (productId: string, view: Toggle['view']) => toggle.mutate({ productId, view }), busy };
}

/**
 * Chuông "Báo tôi khi có hàng" ở góc dưới ảnh thẻ hết hàng (chỗ nút giỏ nhanh của thẻ còn hàng): vùng chạm 44px bọc vòng 32px, cùng khuôn `QuickAddButton`.
 * Công tắc `aria-pressed`, tên đọc giữ nguyên ở hai trạng thái; đang chờ thì vòng tô màu chính và chuông đặc. Bận thì `aria-disabled` (không
 * `disabled` kẻo rớt focus).
 */
export function RestockBellButton({ name, on, busy, onPress }: { name: string; on: boolean; busy: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={fillCopy('wishlist.restock.bell', { name })}
      aria-pressed={on}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onPress();
      }}
      className="inline-flex h-11 w-11 items-center justify-center"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full shadow-e1 ${busy ? 'opacity-60' : ''}`}
        style={{
          background: on ? 'var(--color-action-primary-bg)' : 'var(--color-bg-surface)',
          color: on ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
        }}
      >
        <Bell size={18} strokeWidth={1.9} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
      </span>
    </button>
  );
}
