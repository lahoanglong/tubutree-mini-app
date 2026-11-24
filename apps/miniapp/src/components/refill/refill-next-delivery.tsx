import { useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubscriptionPatch } from '@tubutree/app-core/api/subscriptions';
import type { RefillLandingDTO } from '@tubutree/app-core/refill/refill-landing';
import { refillNextCopy, refillNextDelivery, refillPostponeDoneText, refillPostponePatch } from '@tubutree/app-core/refill/refill-next-delivery';
import { useSmartNavigate } from '../../lib/smart-nav';
import { getErrorMessage } from '../../services/api';
import { getSubscriptions, isStaleSubscriptionError, updateSubscription } from '../../services/subscriptions-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';
import { useLockedMutation } from '../game/use-locked-mutation';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { PriceTag } from '../ui/price-tag';
import { Text } from '../ui/text';

const STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' };
const HEAD: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-inline-sm)' };
const LINK: CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', flex: '0 0 auto' };
const ONE_LINE: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export interface RefillNextDeliveryProps {
  /** Dữ liệu của trang (cặp chai ↔ gói Refill): chỉ gói định kỳ của một gói Refill trên trang mới lên thẻ. */
  landing: RefillLandingDTO | undefined;
}

type Postpone = { id: string; patch: SubscriptionPatch; date: string };

/**
 * Thẻ "Kỳ Refill tới" đầu trang Tiết kiệm với Refill: khách đã đăng nhập có gói định kỳ đang chạy của một gói Refill thì thấy ngày giao kỳ tới (kèm thứ), giá
 * định kỳ so với giá lẻ (cùng số đơn kỳ máy chủ tính) và nút "Dời lịch kỳ tới (+7 ngày)" một chạm. Không có gói như vậy thì không vẽ gì. Lời báo nằm ngay
 * trong thẻ (vùng `role="status"` luôn có mặt) và ngày trên thẻ đổi theo danh sách tải lại; nút giữ bận tới lúc đó. Bản web: `components/refill/refill-next-delivery.tsx`.
 */
export function RefillNextDelivery({ landing }: RefillNextDeliveryProps) {
  const goSmart = useSmartNavigate();
  const qc = useQueryClient();
  // /me/subscriptions cần đăng nhập: gọi trước khi khôi phục xong phiên sẽ 401. Cùng khoá với tab Định kỳ nên dời ở đây thì tab đó cũng mới.
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed });
  const view = authed ? refillNextDelivery(subsQ.data, landing) : null;
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const postponeMut = useLockedMutation({
    mutationFn: ({ id, patch }: Postpone) => updateSubscription(id, patch),
    onMutate: () => setNotice(null),
    onSuccess: (sub, { date }) => {
      haptic('light');
      setNotice({ ok: true, text: refillPostponeDoneText(sub?.nextRunAt, date) });
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    // Lịch đã khác thẻ (cron vừa ra đơn kỳ đó: 409, gói vừa tạm dừng ở máy khác: 400): tải lại để lần chạm sau theo số thật. Mất mạng, 5xx: để nguyên.
    onError: (e) => {
      setNotice({ ok: false, text: getErrorMessage(e) });
      return isStaleSubscriptionError(e) ? settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] })) : undefined;
    },
  });

  if (!view) return null;
  const busy = postponeMut.isPending;
  const blocked = !view.postpone.allowed || subsQ.isFetching;
  const postpone = () => {
    const patch = refillPostponePatch(view);
    if (!patch || blocked) return;
    postponeMut.mutate({ id: view.subscriptionId, patch, date: view.postpone.date });
  };

  return (
    <section aria-labelledby="refill-next-title" data-testid="refill-next-delivery" style={{ marginTop: 'var(--space-stack-md)' }}>
      <Card variant="outline" padding={12}>
        <div style={STACK}>
          <div style={HEAD}>
            <h2 id="refill-next-title" style={{ margin: 0 }}>
              <Text variant="caption" tone="secondary">
                {refillNextCopy('heading')}
              </Text>
            </h2>
            <button type="button" className="tubu-press tubu-hit-44" style={LINK} onClick={() => goSmart('/orders?tab=subscriptions')}>
              <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
                {view.manageText}
              </Text>
            </button>
          </div>
          <Text variant="body-md" as="p" numeric style={{ fontWeight: 600 }} data-testid="refill-next-date">
            {view.dateText}
          </Text>
          <Text variant="body-sm" tone="secondary" as="p" style={ONE_LINE}>
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
            aria-disabled={blocked || undefined}
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
          <div role="status">
            {notice && (
              <div role={notice.ok ? undefined : 'alert'}>
                <Text variant="body-sm" tone={notice.ok ? 'success' : 'danger'} as="p" style={{ fontWeight: 600 }}>
                  {notice.text}
                </Text>
              </div>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}
