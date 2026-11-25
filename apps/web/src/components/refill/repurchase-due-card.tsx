'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { addToCart } from '@tubutree/app-core/api/cart';
import { REPURCHASE_DUE_KEY, repurchaseDueQuery } from '@tubutree/app-core/api/repurchase-due';
import {
  dismissRepurchaseDue,
  isRepurchaseDueDismissed,
  repurchaseDueCopy,
  repurchaseDueView,
  type RepurchaseDueStore,
  type RepurchaseDueSurface,
} from '@tubutree/app-core/refill/repurchase-due-card';
import { Button, Card, IconButton, Text } from '@/components/mini';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartKey, cartStorefrontSlug } from '@/lib/cart-key';
import { playCartFeedback } from '@/lib/cart-feedback';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { formatVnd } from '@/lib/format-vnd';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';

function dismissStore(): RepurchaseDueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const clampLines = (lines: number) => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }) as const;
const TITLE_CLAMP = clampLines(2);
// Thân 3 dòng: câu Refill dài hai dòng ở 375px sẽ cắt mất lý do (bớt một chai nhựa).
const BODY_CLAMP = clampLines(3);
const NOTICE_MS = 4000;

export interface RepurchaseDueCardProps {
  /** Nơi đặt thẻ (`repurchase_due_*.surface`): Tài khoản hay giỏ trống. */
  surface: RepurchaseDueSurface;
}

/**
 * Thẻ "Mua lại" hàng tiêu hao 25–40 ngày sau khi nhận (w36-01), tải lười ở Tài khoản và giỏ trống. Một nút thêm gói Refill ghép cặp (không có thì đúng món
 * đã mua) vào giỏ, số lượng 1, nguồn `repurchase_due`; xong thì thẻ biến mất và thông báo nổi "Đã thêm" kèm "Xem giỏ" (cùng kiểu thông báo giỏ nhanh).
 * × ẩn đúng món đó 14 ngày ở trình duyệt này. Chỉ khách đã đăng nhập; cờ tắt, không có món hay lỗi: không vẽ gì, kể cả vùng báo.
 * Cùng vai và cùng số đo với `RepurchaseDueCard` của Mini App.
 */
export default function RepurchaseDueCard({ surface }: RepurchaseDueCardProps) {
  const authed = useAuthPhase() === 'authenticated';
  const qc = useQueryClient();
  const q = useQuery({ ...repurchaseDueQuery(coreHttp), enabled: authed });
  const view = authed ? repurchaseDueView(q.data?.item, formatVnd) : null;
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const noticeHold = useAutoDismiss(!!notice, NOTICE_MS, () => setNotice(null), notice);
  const dismissed = view ? hiddenKey === view.key || isRepurchaseDueDismissed(view.key, Date.now(), dismissStore()) : true;
  const shown = view !== null && !dismissed;
  const ctaRef = useRef<HTMLSpanElement>(null);
  const inflight = useRef(false);

  const viewedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!shown || !view || viewedKey.current === view.key) return;
    viewedKey.current = view.key;
    trackWebEvent('repurchase_due_view', { surface, variationId: view.variationId });
  }, [shown, view, surface]);

  const mutation = useMutation({
    mutationFn: (variationId: string) => addToCart(coreHttp, variationId, 1, 'repurchase_due', cartStorefrontSlug()),
    onSuccess: (cart, variationId) => {
      qc.setQueryData(cartKey(), cart);
      playCartFeedback(ctaRef.current?.isConnected ? ctaRef.current : null);
      trackWebEvent('repurchase_due_add', { surface, variationId });
      // Như Mini: bỏ món khỏi bộ nhớ đệm để mở lại Tài khoản hay giỏ trống trong 5 phút không mời thêm lần nữa. Vùng báo vẫn gắn khi còn lời báo.
      qc.setQueryData(REPURCHASE_DUE_KEY, { item: null });
      setNotice({ ok: true, text: repurchaseDueCopy('added') });
    },
    onError: (e) => {
      setNotice({ ok: false, text: actionErrorText(e) });
      return serverRejectedState(e) ? settleWithin(qc.invalidateQueries({ queryKey: REPURCHASE_DUE_KEY })) : undefined;
    },
    onSettled: () => {
      inflight.current = false;
    },
  });

  if (!view && !notice) return null;

  const add = (variationId: string) => {
    if (inflight.current) return;
    inflight.current = true;
    mutation.mutate(variationId);
  };

  const dismiss = (v: { key: string; variationId: string }) => {
    dismissRepurchaseDue(v.key, Date.now(), dismissStore());
    setHiddenKey(v.key);
    trackWebEvent('repurchase_due_dismiss', { surface, variationId: v.variationId });
  };

  return (
    <>
      {view && shown && (
        <section aria-label={repurchaseDueCopy('region')} data-testid="repurchase-due-card" className="px-4 pt-3 md:px-0 lg:col-span-full">
          <Card padding={12}>
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Text variant="label" as="p" style={TITLE_CLAMP}>
                  {view.title}
                </Text>
                <Text variant="caption" tone="secondary" as="p" style={BODY_CLAMP}>
                  {view.body}
                </Text>
                <div className="mt-1">
                  <span ref={ctaRef} className="inline-flex">
                    <Button variant="secondary" size="md" loading={mutation.isPending} onPress={() => add(view.variationId)}>
                      {view.cta}
                    </Button>
                  </span>
                </div>
              </div>
              <IconButton icon={X} label={repurchaseDueCopy('dismiss')} size="sm" onPress={() => dismiss(view)} />
            </div>
          </Card>
        </section>
      )}
      {/* Vùng báo có mặt từ khi thẻ có món, chỉ đổi phần con: vùng live vừa gắn cùng chữ thường không được đọc ra. */}
      <div role="status">
        {notice && (
          <div
            role={notice.ok ? undefined : 'alert'}
            data-surface="inverse"
            data-testid="repurchase-due-notice"
            {...noticeHold}
            className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card bg-[color:var(--color-bg-inverse)] px-4 py-2 text-sm text-[color:var(--color-text-inverse)] shadow-raised"
          >
            <span>{notice.text}</span>
            {notice.ok && surface === 'account' && (
              <Link href="/gio-hang" className="inline-flex min-h-11 flex-none items-center font-semibold underline underline-offset-2">
                {repurchaseDueCopy('viewCart')}
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}
