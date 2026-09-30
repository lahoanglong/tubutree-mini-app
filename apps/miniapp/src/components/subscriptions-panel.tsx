import { useState } from 'react';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import {
  getSubscriptions,
  setSubscriptionStatus,
  skipSubscriptionCycle,
  type SubscriptionDTO,
} from '../services/subscriptions-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { usePublicConfig } from '../hooks/use-public-config';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Badge, type BadgeTone } from './ui/badge';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { EmptyState, ErrorState } from './ui/empty-state';
import { Icon } from './ui/icon';
import { LineItemSkeleton } from './ui/skeleton';
import { Text } from './ui/text';

type SubStatus = SubscriptionDTO['status'];
const STATUS_TONE: Record<SubStatus, BadgeTone> = { ACTIVE: 'success', PAUSED: 'warning', CANCELLED: 'neutral' };

/**
 * Nội dung "Đặt định kỳ" — nhúng làm tab "Định kỳ" của trang Đơn hàng (spec 4a.2). Chuyển từ
 * pages/subscriptions.tsx sang DS v2, GIỮ nguyên hành vi: tạm dừng/tiếp tục, huỷ qua sheet giữ chân
 * (tạm dừng / bỏ qua kỳ / vẫn huỷ).
 */
export function SubscriptionsPanel() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  // /me/subscriptions cần auth — fetch trước khi restore() xong sẽ 401 và kẹt (retry:false cho 4xx).
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed });
  const cfg = usePublicConfig();
  const subs = subsQ.data ?? [];
  // % thực tế đang áp (thang bậc) thắng % cấu hình chung khi đã có lịch.
  const subscribePct = Math.round((subs[0]?.effectiveDiscountPct ?? cfg.subscribeDiscountPct) * 100);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SubStatus }) => setSubscriptionStatus(id, status),
    onSuccess: () => {
      haptic('light');
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const skipMut = useMutation({
    mutationFn: (id: string) => skipSubscriptionCycle(id),
    onSuccess: () => {
      haptic('light');
      openSnackbar({ text: vi.subscriptions.skipOk, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      setCancelTarget(null);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const targetSub = subs.find((s) => s.id === cancelTarget) ?? null;
  const pending = statusMut.isPending ? statusMut.variables?.status : undefined;
  const changeFromSheet = (status: SubStatus) => {
    if (!cancelTarget) return;
    statusMut.mutate({ id: cancelTarget, status }, { onSuccess: () => setCancelTarget(null) });
  };

  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Text variant="body-sm" tone="secondary" as="p">
          {vi.subscriptions.intro(subscribePct)}
        </Text>
        {subs[0] && (
          <Text variant="caption" tone="brand" as="p" style={{ marginTop: 4 }}>
            {vi.subscriptions.discountLine(Math.round(subs[0].effectiveDiscountPct * 100))}
          </Text>
        )}
      </div>

      {!authed || subsQ.isLoading ? (
        <>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </>
      ) : subsQ.isError ? (
        <ErrorState variant="inline" message={getErrorMessage(subsQ.error)} onRetry={() => void subsQ.refetch()} />
      ) : subs.length > 0 ? (
        subs.map((s) => (
          <SubscriptionCard
            key={s.id}
            sub={s}
            busy={statusMut.isPending}
            onToggle={() => statusMut.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}
            onCancel={() => setCancelTarget(s.id)}
          />
        ))
      ) : (
        <EmptyState
          variant="inline"
          art="box"
          heading={vi.subscriptions.emptyHeading}
          body={vi.subscriptions.emptyBody}
          ctaLabel={vi.subscriptions.emptyCta}
          onCta={() => navigate('/browse')}
        />
      )}

      <BottomSheet
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={vi.subscriptions.saveTitle}
        description={vi.subscriptions.saveBody}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button
            fullWidth
            loading={pending === 'PAUSED'}
            disabled={statusMut.isPending && pending !== 'PAUSED'}
            onPress={() => changeFromSheet('PAUSED')}
          >
            {vi.subscriptions.pauseCta}
          </Button>
          {targetSub?.status === 'ACTIVE' && (
            <Button fullWidth variant="secondary" loading={skipMut.isPending} onPress={() => cancelTarget && skipMut.mutate(cancelTarget)}>
              {vi.subscriptions.skipCta}
            </Button>
          )}
          <Button
            fullWidth
            variant="ghost"
            loading={pending === 'CANCELLED'}
            disabled={statusMut.isPending && pending !== 'CANCELLED'}
            onPress={() => changeFromSheet('CANCELLED')}
            style={{ color: 'var(--color-text-danger)' }}
          >
            {vi.subscriptions.confirmCancelCta}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}

function SubscriptionCard({
  sub: s,
  busy,
  onToggle,
  onCancel,
}: {
  sub: SubscriptionDTO;
  busy: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  return (
    <Card padding={12}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div
          style={{
            width: 56, height: 56, flex: '0 0 auto', overflow: 'hidden', display: 'grid', placeItems: 'center',
            borderRadius: 'var(--radius-media)', background: 'var(--color-bg-subtle)',
          }}
        >
          {s.thumbnail ? (
            <img src={s.thumbnail} alt={s.productName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Icon icon={Sprout} tone="brand" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {s.productName}
          </Text>
          <Text variant="caption" tone="tertiary" as="div">
            {s.variationName} · SL {s.quantity}
          </Text>
          <Text variant="caption" tone="brand" as="div">
            {vi.subscriptions.perCycle(s.intervalWeeks, formatVnd(s.unitPrice * s.quantity))}
          </Text>
        </div>
        <Badge tone={STATUS_TONE[s.status]} size="sm" style={{ alignSelf: 'flex-start' }}>
          {vi.subscriptions.statusLabel[s.status]}
        </Badge>
      </div>
      <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 10 }}>
        {s.status === 'ACTIVE'
          ? s.nextRunAt
            ? vi.subscriptions.nextRun(new Date(s.nextRunAt).toLocaleDateString('vi-VN'))
            : vi.subscriptions.scheduling
          : vi.subscriptions.pausedLine}
      </Text>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="secondary" disabled={busy} onPress={onToggle} style={{ flex: 1, minWidth: 0 }}>
          {s.status === 'ACTIVE' ? vi.subscriptions.pause : vi.subscriptions.resume}
        </Button>
        <Button variant="ghost" disabled={busy} onPress={onCancel} style={{ flex: 1, minWidth: 0, color: 'var(--color-text-danger)' }}>
          {vi.subscriptions.cancel}
        </Button>
      </div>
    </Card>
  );
}
