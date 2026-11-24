'use client';

// Nguồn: apps/miniapp/src/components/refill/refill-next-delivery.tsx
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { updateSubscription, type SubscriptionPatch } from '@tubutree/app-core/api/subscriptions';
import { subscriptionsQuery } from '@tubutree/app-core/queries/subscriptions';
import type { RefillLandingDTO } from '@tubutree/app-core/refill/refill-landing';
import { refillNextCopy, refillNextDelivery, refillPostponeDoneText, refillPostponePatch } from '@tubutree/app-core/refill/refill-next-delivery';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { Button, Card, PriceTag, Text } from '@/components/mini';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { settleWithin } from '@/lib/settle-within';
import { isStaleSubscriptionError } from '@/lib/subscription-stale-error';

export interface RefillNextDeliveryProps {
  /** Dữ liệu của trang (cặp chai ↔ gói Refill): chỉ gói định kỳ của một gói Refill trên trang mới lên thẻ. */
  landing: RefillLandingDTO | undefined;
}

type Postpone = { id: string; patch: SubscriptionPatch; date: string };
type Notice = { ok: boolean; text: string; id: string };

const SECTION = { marginTop: 'var(--space-stack-md)' } as const;

/**
 * Thẻ "Kỳ Refill tới" đầu trang Tiết kiệm với Refill, như Mini App: khách đã đăng nhập có gói định kỳ đang chạy của một gói Refill thì thấy ngày giao kỳ tới
 * (kèm thứ), giá định kỳ so với giá lẻ (cùng số đơn kỳ máy chủ tính) và nút "Dời lịch kỳ tới (+7 ngày)" một chạm. Khách chưa đăng nhập hay không có gói như
 * vậy thì không vẽ gì (HTML máy chủ của trang không đổi). Lời báo nằm ngay trong thẻ và ngày trên thẻ đổi theo danh sách tải lại; nút giữ bận tới lúc đó.
 */
export function RefillNextDelivery({ landing }: RefillNextDeliveryProps) {
  const qc = useQueryClient();
  // /me/subscriptions cần đăng nhập: gọi trước khi khôi phục xong phiên sẽ 401. Cùng khoá với tab Định kỳ nên dời ở đây thì tab đó cũng mới.
  const authed = useAuthPhase() === 'authenticated';
  const subsQ = useQuery({ ...subscriptionsQuery(coreHttp), enabled: authed });
  // Gói vừa bấm dời: thẻ giữ gói đó tới khi rời trang, kể cả khi kỳ mới xa hơn gói Refill khác, để lần bấm sau không dời nhầm gói.
  const [pinned, setPinned] = useState<string | null>(null);
  const view = authed ? refillNextDelivery(subsQ.data, landing, new Date(), pinned) : null;
  const [notice, setNotice] = useState<Notice | null>(null);
  // Lời báo thuộc gói đã bấm: thẻ chuyển sang gói khác thì không treo lời báo cũ dưới gói mới.
  const shown = notice && (!view || notice.id === view.subscriptionId) ? notice : null;

  const postponeMut = useLockedMutation({
    mutationFn: ({ id, patch }: Postpone) => updateSubscription(coreHttp, id, patch),
    onMutate: ({ id }) => {
      setPinned(id);
      setNotice(null);
    },
    onSuccess: (sub, { id, date }) => {
      setNotice({ ok: true, text: refillPostponeDoneText(sub?.nextRunAt, date), id });
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    // Lịch đã khác thẻ (cron vừa ra đơn kỳ đó: 409, gói vừa huỷ ở máy khác: 400): tải lại để lần bấm sau theo số thật. Mất mạng, 5xx: để nguyên.
    onError: (e, { id }) => {
      setNotice({ ok: false, text: actionErrorText(e), id });
      return isStaleSubscriptionError(e) ? settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] })) : undefined;
    },
  });

  const regions = (
    <>
      <div role="status">
        {shown?.ok && (
          <Text variant="body-sm" tone="success" as="p" style={{ fontWeight: 600 }}>
            {shown.text}
          </Text>
        )}
      </div>
      <div role="alert">
        {shown && !shown.ok && (
          <Text variant="body-sm" tone="danger" as="p" style={{ fontWeight: 600 }}>
            {shown.text}
          </Text>
        )}
      </div>
    </>
  );
  // Gói vừa bấm hết chạy (huỷ hay tạm dừng ở máy khác) và không còn gói Refill nào: thẻ thôi vẽ nhưng lời báo ở lại tới khi rời trang.
  if (!view) return shown ? <section style={SECTION} className="md:max-w-md">{regions}</section> : null;
  const busy = postponeMut.isPending;
  const blocked = !view.postpone.allowed || subsQ.isFetching;
  const postpone = () => {
    const patch = refillPostponePatch(view);
    if (!patch || blocked) return;
    postponeMut.mutate({ id: view.subscriptionId, patch, date: view.postpone.date });
  };

  return (
    <section aria-labelledby="refill-next-title" data-testid="refill-next-delivery" style={SECTION} className="md:max-w-md">
      <Card variant="outline" padding={12}>
        <div className="flex flex-col" style={{ gap: 'var(--space-stack-xs)' }}>
          <div className="flex items-center justify-between" style={{ gap: 'var(--space-inline-sm)' }}>
            <h2 id="refill-next-title" className="m-0">
              <Text variant="caption" tone="secondary">
                {refillNextCopy('heading')}
              </Text>
            </h2>
            <Link href="/tai-khoan/don-hang?tab=subscriptions" className="tubu-press tubu-hit-44 flex-none hover:underline">
              <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
                {view.manageText}
              </Text>
            </Link>
          </div>
          <Text variant="body-md" as="p" numeric style={{ fontWeight: 600 }} data-testid="refill-next-date">
            {view.dateText}
          </Text>
          <Text variant="body-sm" tone="secondary" as="p" className="truncate">
            {view.itemText}
          </Text>
          <PriceTag value={view.goods} compareAt={view.retail} size="sm" data-testid="refill-next-price" />
          <Text variant="caption" tone={view.retail === null ? 'secondary' : 'success'} as="p" numeric>
            {view.savingText}
          </Text>
          <Button
            variant="secondary"
            fullWidth
            data-testid="refill-next-postpone"
            aria-label={view.postpone.aria}
            disabled={!view.postpone.allowed}
            aria-disabled={blocked || busy || undefined}
            loading={busy}
            onPress={postpone}
            style={{ marginTop: 'var(--space-stack-xs)' }}
          >
            {view.postpone.label}
          </Button>
          {view.postpone.limitText && (
            <Text variant="caption" tone="secondary" as="p">
              {view.postpone.limitText}
            </Text>
          )}
          {regions}
        </div>
      </Card>
    </section>
  );
}
