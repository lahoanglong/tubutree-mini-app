import { useRef, useState } from 'react';
import { Page, useSnackbar, useNavigate } from 'zmp-ui';
import { Droplets, Sprout } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRefillSummary, returnBottles } from '../services/refill-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { Heading, Text } from '../components/ui/text';
import { formatDate } from '../utils/format';
import { haptic } from '../utils/haptic';
import { newIdempotencyKey } from '../utils/idempotency';

export default function RefillPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const authed = useAuthStore((s) => s.status) === 'authenticated';
  const [qty, setQty] = useState(1);
  // Key giữ nguyên khi lỗi để retry mạng thật không tạo thêm 1 yêu cầu đổi vỏ nữa; chỉ đổi
  // key mới sau khi đã đổi vỏ thành công (lệnh sau là lệnh mới) — mirror pattern checkout/wallet.
  const returnKey = useRef(newIdempotencyKey());

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['refill'],
    queryFn: getRefillSummary,
    enabled: authed,
  });

  const returnM = useMutation({
    mutationFn: () => returnBottles(qty, returnKey.current),
    onSuccess: () => {
      haptic('heavy');
      openSnackbar({ text: 'Đã gửi yêu cầu đổi vỏ chai! Vui lòng chờ quản lý duyệt.', type: 'success' });
      setQty(1);
      returnKey.current = newIdempotencyKey();
      void queryClient.invalidateQueries({ queryKey: ['refill'] });
      void queryClient.invalidateQueries({ queryKey: ['garden'] });
      void queryClient.invalidateQueries({ queryKey: ['game'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const remaining = data?.monthlyRemaining ?? 0;
  const maxQty = Math.max(1, remaining);
  // Không gộp `isPending` vào disabled: Button tự chặn bấm lại khi loading, còn disabled sẽ tắt luôn spinner.
  const eligible = authed && remaining > 0 && qty >= 1 && qty <= remaining;

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 80 }}>
      <PageHeader
        title="Đổi vỏ chai — Nhận nước"
        subtitle="Mang vỏ chai rỗng đến cửa hàng đổi lấy 💧 tưới Vườn Xanh. Tái chế vỏ → nuôi cây, góp quỹ trồng cây 🌳"
      />

      {isLoading ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Skeleton height={70} radius="var(--radius-card)" style={{ flex: 1 }} />
            <Skeleton height={70} radius="var(--radius-card)" style={{ flex: 1 }} />
          </div>
          <Skeleton height={160} radius="var(--radius-card)" />
        </div>
      ) : isError ? (
        <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Tổng quan dấu chân xanh */}
          <div style={{ display: 'flex', gap: 12 }}>
            <Card padding={12} style={{ flex: 1, textAlign: 'center' }}>
              <Text variant="price-lg" tone="brand" as="div">{data?.totalRecycled ?? 0}</Text>
              <Text variant="caption" tone="tertiary" as="div">vỏ đã tái chế</Text>
            </Card>
            <Card padding={12} style={{ flex: 1, textAlign: 'center' }}>
              <Text variant="price-lg" tone="brand" as="div">{remaining}</Text>
              <Text variant="caption" tone="tertiary" as="div">còn đổi được tháng này</Text>
            </Card>
          </div>

          {/* Bộ đổi vỏ */}
          <Card padding={16}>
            <Heading variant="title-sm" as="h2">Bạn đang đổi mấy vỏ chai?</Heading>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
              <QuantitySelector value={qty} min={1} max={maxQty} onChange={setQty} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon icon={Droplets} size="sm" tone="brand" />
              <Text variant="body-sm" tone="secondary">
                Nhận <b>{qty * (data?.perBottle ?? 0)}💧</b> ({data?.perBottle ?? 0}💧 / vỏ)
              </Text>
            </div>
            <Button
              fullWidth
              loading={returnM.isPending}
              disabled={!eligible}
              onPress={() => returnM.mutate()}
              style={{ marginTop: 14 }}
            >
              {remaining > 0 ? 'Gửi yêu cầu đổi vỏ' : 'Đã hết lượt đổi tháng này'}
            </Button>
            {!authed && (
              <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8, textAlign: 'center' }}>
                Đăng nhập để đổi vỏ lấy nước.
              </Text>
            )}
          </Card>

          {/* Lịch sử */}
          {data && data.history.length > 0 && (
            <Card padding={16}>
              <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>Lịch sử đổi vỏ</Heading>
              {data.history.map((h) => {
                const statusKey = h.status ?? 'PENDING';
                const statusMeta = {
                  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
                  APPROVED: { label: `+${h.seedsAwarded}💧`, tone: 'success' },
                  REJECTED: { label: 'Từ chối', tone: 'danger' },
                }[statusKey] as { label: string; tone: 'warning' | 'success' | 'danger' };

                return (
                  <div
                    key={h.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <Text variant="body-sm" tone="secondary">{h.quantity} vỏ · {formatDate(h.createdAt)}</Text>
                    <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                  </div>
                );
              })}
            </Card>
          )}

          {/* Liên kết sang Vườn Cây Tubu */}
          <Card variant="outline" padding={0}>
            <ListRow
              icon={
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--color-action-secondary-bg)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon icon={Sprout} size="md" tone="brand" />
                </div>
              }
              title="Vườn Cây Tubu"
              subtitle="Dùng giọt nước tích luỹ để chăm cây và đổi quà thật"
              trailing="chevron"
              onPress={() => navigate('/game')}
              style={{ padding: 12 }}
            />
          </Card>
        </div>
      )}
    </Page>
  );
}
