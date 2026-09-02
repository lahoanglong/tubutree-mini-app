import { Box, Page, Text, Button, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listGroupBuys, joinGroupBuy, type GroupBuy } from '../services/groupbuy-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { LineItemSkeleton } from '../components/ui/skeleton';

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
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <Box p={3} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="large">🛒 Mua chung giá tốt</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
          Rủ thêm bạn cho đủ nhóm — cả nhóm cùng được giá ưu đãi!
        </Text>
      </Box>

      {isLoading ? (
        <Box p={2} flex flexDirection="column" style={{ gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </Box>
      ) : isError ? (
        <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : groups && groups.length > 0 ? (
        <Box p={2}>
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              g={g}
              authed={authed}
              onOpen={() => navigate(`/product/${g.product.slug}`)}
              onJoin={() => joinM.mutate(g.id)}
              joining={joinM.isPending && joinM.variables === g.id}
            />
          ))}
        </Box>
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
    <Box mt={2} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
      <Box flex style={{ gap: 10 }}>
        <Box onClick={onOpen} className="tubu-press">
          {g.product.thumbnail ? (
            <img src={g.product.thumbnail} alt={g.product.name} style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }} />
          ) : (
            <Box style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--leaf-50)', display: 'grid', placeItems: 'center', fontSize: 24 }}>🌿</Box>
          )}
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="small" bold style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.product.name}</Text>
          <Box flex alignItems="center" style={{ gap: 6 }}>
            <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>{g.unitPrice.toLocaleString('vi-VN')}đ</Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', textDecoration: 'line-through' }}>{g.basePrice.toLocaleString('vi-VN')}đ</Text>
            <Text size="xSmall" bold style={{ color: 'var(--clay-700)' }}>−{g.discountPct}%</Text>
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {g.currentSize}/{g.targetSize} người · {timeLeft(g.expiresAt)}
          </Text>
        </Box>
      </Box>
      <Box style={{ background: 'var(--neutral-100)', borderRadius: 99, height: 6, marginTop: 8, overflow: 'hidden' }}>
        <Box style={{ width: `${pct}%`, height: 6, background: 'var(--leaf-600)', borderRadius: 99 }} />
      </Box>
      <Button
        fullWidth
        size="small"
        disabled={!authed || g.joined || joining}
        loading={joining}
        onClick={onJoin}
        style={{ marginTop: 10, background: g.joined ? 'var(--neutral-300)' : 'var(--leaf-600)' }}
      >
        {g.joined ? 'Đã tham gia' : `Tham gia mua chung (−${g.discountPct}%)`}
      </Button>
    </Box>
  );
}
