import { Box, Page, Text, Button, Spinner, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listGroupBuys, joinGroupBuy, type GroupBuy } from '../services/groupbuy-api';
import { useAuthStore } from '../store/auth';

function timeLeft(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  if (diff <= 0) return 'đã hết hạn';
  if (diff < 3600) return `còn ${Math.floor(diff / 60)} phút`;
  if (diff < 86400) return `còn ${Math.floor(diff / 3600)} giờ`;
  return `còn ${Math.floor(diff / 86400)} ngày`;
}

function msg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? 'Có lỗi xảy ra';
}

export default function GroupBuyPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const authed = useAuthStore((s) => s.status) === 'authenticated';

  const { data: groups, isLoading } = useQuery({ queryKey: ['group-buy'], queryFn: listGroupBuys });

  const joinM = useMutation({
    mutationFn: (id: string) => joinGroupBuy(id),
    onSuccess: (r) => {
      openSnackbar({
        text: r.status === 'SUCCESS' ? '🎉 Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.' : 'Đã tham gia nhóm 🛒',
        type: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: ['group-buy'] });
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
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
        <Box flex justifyContent="center" p={6}><Spinner /></Box>
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
        <Box style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Text style={{ fontSize: 48 }}>🛒</Text>
          <Text style={{ color: 'var(--neutral-600)', marginTop: 8 }}>Chưa có nhóm mua chung nào</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
            Mở nhóm từ trang sản phẩm để rủ bạn bè mua chung giá tốt!
          </Text>
          <Button onClick={() => navigate('/browse')} style={{ marginTop: 16, background: 'var(--leaf-600)' }}>
            Khám phá sản phẩm
          </Button>
        </Box>
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
            <Text size="xSmall" bold style={{ color: 'var(--danger, #b91c1c)' }}>−{g.discountPct}%</Text>
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
