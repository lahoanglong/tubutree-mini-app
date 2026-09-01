import { useState } from 'react';
import { Box, Page, Text, Button, Sheet, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSubscriptions,
  setSubscriptionStatus,
  skipSubscriptionCycle,
  type SubscriptionDTO,
} from '../services/subscriptions-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { vi } from '../i18n/vi';

export default function SubscriptionsPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions });
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' }) =>
      setSubscriptionStatus(id, status),
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

  const targetSub = subsQ.data?.find((s) => s.id === cancelTarget) ?? null;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      <Box p={4}>
        <Text size="small" style={{ color: 'var(--neutral-600)' }}>
          Tự động đặt lại sản phẩm bạn dùng thường xuyên — tiết kiệm <b>12%</b> mỗi đơn, hủy bất kỳ lúc nào.
        </Text>
        {subsQ.data && subsQ.data[0] ? (
          <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 4 }}>
            {vi.subscriptions.discountLine(Math.round(subsQ.data[0].effectiveDiscountPct * 100))}
          </Text>
        ) : null}
      </Box>

      {subsQ.isLoading ? (
        <Box p={4} flex flexDirection="column" style={{ gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </Box>
      ) : subsQ.isError ? (
        <ErrorState message={getErrorMessage(subsQ.error)} onRetry={() => void subsQ.refetch()} />
      ) : subsQ.data && subsQ.data.length > 0 ? (
        <Box px={4} flex flexDirection="column" style={{ gap: 10, paddingBottom: 24 }}>
          {subsQ.data.map((s: SubscriptionDTO) => (
            <Box key={s.id} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}>
              <Box flex style={{ gap: 12 }}>
                <Box
                  style={{ width: 56, height: 56, borderRadius: 'var(--radius-md)', background: 'var(--leaf-50)', flex: '0 0 auto', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {s.thumbnail ? (
                    <img src={s.thumbnail} alt={s.productName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Text style={{ fontSize: 24 }}>🌿</Text>
                  )}
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="small" bold>
                    {s.productName}
                  </Text>
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                    {s.variationName} · SL {s.quantity}
                  </Text>
                  <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 2 }}>
                    Mỗi {s.intervalWeeks} tuần · {formatVnd(s.unitPrice * s.quantity)}
                  </Text>
                </Box>
                <StatusPill status={s.status} />
              </Box>

              <Box flex alignItems="center" justifyContent="space-between" mt={3}>
                <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                  {s.status === 'ACTIVE'
                    ? s.nextRunAt
                      ? `Lần kế: ${new Date(s.nextRunAt).toLocaleDateString('vi-VN')}`
                      : 'Đang lên lịch'
                    : 'Đang tạm dừng'}
                </Text>
                <Box flex style={{ gap: 14, opacity: statusMut.isPending ? 0.5 : 1 }}>
                  {s.status === 'ACTIVE' ? (
                    <Text
                      size="small"
                      bold
                      className="tubu-press"
                      style={{ color: 'var(--clay-700)' }}
                      onClick={() => !statusMut.isPending && statusMut.mutate({ id: s.id, status: 'PAUSED' })}
                    >
                      Tạm dừng
                    </Text>
                  ) : (
                    <Text
                      size="small"
                      bold
                      className="tubu-press"
                      style={{ color: 'var(--leaf-700)' }}
                      onClick={() => !statusMut.isPending && statusMut.mutate({ id: s.id, status: 'ACTIVE' })}
                    >
                      Tiếp tục
                    </Text>
                  )}
                  <Text
                    size="small"
                    bold
                    className="tubu-press"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => !statusMut.isPending && setCancelTarget(s.id)}
                  >
                    Hủy
                  </Text>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Text style={{ fontSize: 44 }}>🔁</Text>
          <Text style={{ color: 'var(--neutral-600)', marginTop: 8 }}>Chưa có lịch đặt định kỳ</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
            Mở một sản phẩm và chọn “Đặt định kỳ” để bắt đầu.
          </Text>
          <Button onClick={() => navigate('/browse')} style={{ marginTop: 16, background: 'var(--leaf-600)' }}>
            Khám phá sản phẩm
          </Button>
        </Box>
      )}

      <Sheet visible={cancelTarget !== null} onClose={() => setCancelTarget(null)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large">
            {vi.subscriptions.saveTitle}
          </Text>
          <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
            {vi.subscriptions.saveBody}
          </Text>

          <Button
            fullWidth
            loading={statusMut.isPending && statusMut.variables?.status === 'PAUSED'}
            onClick={() =>
              cancelTarget &&
              statusMut.mutate(
                { id: cancelTarget, status: 'PAUSED' },
                { onSuccess: () => setCancelTarget(null) },
              )
            }
            style={{ marginTop: 16, background: 'var(--leaf-600)' }}
          >
            {vi.subscriptions.pauseCta}
          </Button>

          {targetSub?.status === 'ACTIVE' ? (
            <Button
              fullWidth
              variant="secondary"
              loading={skipMut.isPending}
              onClick={() => cancelTarget && skipMut.mutate(cancelTarget)}
              style={{ marginTop: 10 }}
            >
              {vi.subscriptions.skipCta}
            </Button>
          ) : null}

          <Text
            size="small"
            bold
            className="tubu-press"
            style={{ color: 'var(--danger)', textAlign: 'center', marginTop: 20 }}
            onClick={() =>
              cancelTarget &&
              statusMut.mutate(
                { id: cancelTarget, status: 'CANCELLED' },
                { onSuccess: () => setCancelTarget(null) },
              )
            }
          >
            {vi.subscriptions.confirmCancelCta}
          </Text>

          <Text
            size="small"
            className="tubu-press"
            style={{ color: 'var(--neutral-400)', textAlign: 'center', marginTop: 14 }}
            onClick={() => setCancelTarget(null)}
          >
            {vi.common.close}
          </Text>
        </Box>
      </Sheet>
    </Page>
  );
}

function StatusPill({ status }: { status: SubscriptionDTO['status'] }) {
  const map = {
    ACTIVE: { label: 'Đang chạy', color: 'var(--leaf-700)', bg: 'var(--leaf-50)' },
    PAUSED: { label: 'Tạm dừng', color: 'var(--clay-700)', bg: 'var(--clay-50)' },
    CANCELLED: { label: 'Đã hủy', color: 'var(--neutral-600)', bg: 'var(--neutral-100)' },
  }[status];
  return (
    <Text size="xSmall" style={{ color: map.color, background: map.bg, padding: '2px 8px', borderRadius: 'var(--radius-full)', height: 'fit-content' }}>
      {map.label}
    </Text>
  );
}
