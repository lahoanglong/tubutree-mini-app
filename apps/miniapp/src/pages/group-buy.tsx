import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { listGroupBuys, joinGroupBuy, type GroupBuy } from '../services/groupbuy-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { useAuthStore } from '../store/auth';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { Text } from '../components/ui/text';

function timeLeft(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  if (diff <= 0) return 'đã hết hạn';
  if (diff < 3600) return `còn ${Math.floor(diff / 60)} phút`;
  if (diff < 86400) return `còn ${Math.floor(diff / 3600)} giờ`;
  return `còn ${Math.floor(diff / 86400)} ngày`;
}

export default function GroupBuyPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const authed = useAuthStore((s) => s.status) === 'authenticated';
  const login = useAuthStore((s) => s.login);

  const {
    data: groups,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({ queryKey: ['group-buy'], queryFn: listGroupBuys });

  const joinM = useMutation({
    mutationFn: (id: string) => joinGroupBuy(id),
    onSuccess: (r) => {
      openSnackbar({
        text: r.status === 'SUCCESS' ? '🎉 Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.' : 'Đã tham gia nhóm 🛒',
        type: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: ['group-buy'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 80 }}>
      <PageHeader title="Mua chung giá tốt" subtitle="Rủ thêm bạn cho đủ nhóm — cả nhóm cùng được giá ưu đãi!" />

      {isLoading ? (
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </div>
      ) : isError ? (
        <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : groups && groups.length > 0 ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              g={g}
              authed={authed}
              onOpen={() => navigate(`/product/${g.product.slug}`)}
              onJoin={() => (authed ? joinM.mutate(g.id) : void login())}
              joining={joinM.isPending && joinM.variables === g.id}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          art="basket"
          heading="Chưa có nhóm mua chung nào"
          body="Mở nhóm từ trang sản phẩm để rủ bạn bè mua chung giá tốt!"
          ctaLabel="Khám phá sản phẩm"
          onCta={() => navigate('/browse')}
        />
      )}
    </Page>
  );
}

function GroupCard({
  g,
  authed,
  onOpen,
  onJoin,
  joining,
}: {
  g: GroupBuy;
  authed: boolean;
  onOpen: () => void;
  onJoin: () => void;
  joining: boolean;
}) {
  const pct = g.targetSize > 0 ? Math.min(100, Math.round((g.currentSize / g.targetSize) * 100)) : 0;
  return (
    <Card padding={12}>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={onOpen}
          className="tubu-press"
          aria-label={g.product.thumbnail ? undefined : g.product.name}
          style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', flex: '0 0 auto', alignSelf: 'flex-start' }}
        >
          {g.product.thumbnail ? (
            <img
              src={g.product.thumbnail}
              alt={g.product.name}
              style={{ width: 56, height: 56, borderRadius: 'var(--radius-control)', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--radius-control)',
                background: 'var(--color-action-secondary-bg)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Icon icon={Sprout} size="lg" tone="brand" />
            </div>
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text
            variant="body-sm"
            as="div"
            style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {g.product.name}
          </Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Text variant="body-sm" tone="brand" style={{ fontWeight: 600 }}>{formatVnd(g.unitPrice)}</Text>
            <Text variant="caption" tone="tertiary" style={{ textDecoration: 'line-through' }}>{formatVnd(g.basePrice)}</Text>
            <Badge tone="promo" size="sm">−{g.discountPct}%</Badge>
          </div>
          <Text variant="caption" tone="tertiary" as="div">
            {g.currentSize}/{g.targetSize} người · {timeLeft(g.expiresAt)}
          </Text>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <ProgressBar value={pct} max={100} />
      </div>
      <Button fullWidth disabled={authed && g.joined} loading={joining} onPress={onJoin} style={{ marginTop: 10 }}>
        {!authed ? 'Đăng nhập để tham gia' : g.joined ? 'Đã tham gia' : `Tham gia mua chung (−${g.discountPct}%)`}
      </Button>
    </Card>
  );
}
