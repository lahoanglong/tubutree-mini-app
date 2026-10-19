import { Page, useNavigate, useParams, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2, Sprout } from 'lucide-react';
import { getGroupBuy, listGroupBuys, joinGroupBuy, type GroupBuy } from '../services/groupbuy-api';
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
import { Heading, Text } from '../components/ui/text';
import { useShareWithFallback } from '../components/share-sheet';
import { withReferral } from '../utils/share-link';

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
  const { id: invitedId } = useParams<{ id: string }>();
  const authed = useAuthStore((s) => s.status) === 'authenticated';
  const login = useAuthStore((s) => s.login);
  const referralCode = useAuthStore((s) => s.user?.referralCode);
  const shareWithFallback = useShareWithFallback();

  const {
    data: groups,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({ queryKey: ['group-buy'], queryFn: listGroupBuys });

  // Link /group-buy/:id (người trong nhóm gửi bạn): nhóm đó có thể không nằm trong 30 nhóm mới nhất của danh sách chung.
  // API chi tiết cần đăng nhập nên khách chưa đăng nhập chỉ xem danh sách chung.
  const invitedQ = useQuery({
    queryKey: ['group-buy', 'one', invitedId],
    queryFn: () => getGroupBuy(invitedId!),
    enabled: Boolean(invitedId) && authed,
    retry: false,
  });
  const invited = invitedQ.data;
  const rest = (groups ?? []).filter((g) => g.id !== invited?.id);
  const others = rest.filter((g) => g.status !== 'SUCCESS');
  const done = rest.filter((g) => g.status === 'SUCCESS');

  const joinM = useMutation({
    mutationFn: (id: string) => joinGroupBuy(id),
    onSuccess: (r) => {
      openSnackbar({
        text: r.status === 'SUCCESS' ? 'Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.' : 'Đã tham gia nhóm',
        type: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: ['group-buy'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const share = (g: GroupBuy) =>
    void shareWithFallback(
      {
        title: `Mua chung ${g.product.name} giảm ${g.discountPct}%`,
        description: `Còn thiếu ${Math.max(0, g.targetSize - g.currentSize)} người nữa là đủ nhóm, vào tham gia cùng mình nhé!`,
        thumbnail: g.product.thumbnail ?? undefined,
        path: withReferral(`/group-buy/${g.id}`, referralCode),
      },
      `Cùng mình mua chung ${g.product.name} giảm ${g.discountPct}% trên Tubu Tree nhé! Vào mục "Mua chung nhóm" để tham gia.${
        referralCode ? ` Mã giới thiệu của mình: ${referralCode}` : ''
      }`,
    );

  const renderCard = (g: GroupBuy, invitedBanner = false) => (
    <GroupCard
      key={g.id}
      g={g}
      authed={authed}
      invitedBanner={invitedBanner}
      onOpen={() => navigate(`/product/${g.product.slug}`)}
      onJoin={() => (authed ? joinM.mutate(g.id) : void login())}
      onShare={() => share(g)}
      joining={joinM.isPending && joinM.variables === g.id}
    />
  );

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 80 }}>
      <PageHeader title="Mua chung giá tốt" subtitle="Rủ thêm bạn cho đủ nhóm — đủ người, ai cũng nhận mã giảm giá!" />

      {isLoading ? (
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </div>
      ) : isError ? (
        <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : invited || others.length > 0 || done.length > 0 ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {invited && renderCard(invited, !invited.isOwner && !invited.joined)}
          {others.map((g) => renderCard(g))}
          {done.length > 0 && (
            <section aria-label="Nhóm đã đủ người của bạn" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Heading variant="title-sm" as="h2" style={{ marginTop: 4 }}>
                Nhóm đã đủ người của bạn
              </Heading>
              {done.map((g) => renderCard(g))}
            </section>
          )}
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
  invitedBanner,
  onOpen,
  onJoin,
  onShare,
  joining,
}: {
  g: GroupBuy;
  authed: boolean;
  invitedBanner: boolean;
  onOpen: () => void;
  onJoin: () => void;
  onShare: () => void;
  joining: boolean;
}) {
  const pct = g.targetSize > 0 ? Math.min(100, Math.round((g.currentSize / g.targetSize) * 100)) : 0;
  const isOpen = g.status === 'OPEN';
  const member = authed && g.joined;
  const closedLabel = g.status === 'SUCCESS' ? 'Nhóm đã đủ người' : 'Nhóm đã hết hạn';
  const label = !isOpen
    ? closedLabel
    : !authed
      ? 'Đăng nhập để tham gia'
      : g.joined
        ? g.isOwner
          ? 'Nhóm của bạn'
          : 'Đã tham gia'
        : `Tham gia mua chung (−${g.discountPct}%)`;
  return (
    <Card padding={12}>
      {invitedBanner && (
        <Text variant="caption" tone="brand" as="div" style={{ fontWeight: 600, marginBottom: 6 }}>
          Bạn được mời vào nhóm này
        </Text>
      )}
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
            {g.currentSize}/{g.targetSize} người · {g.status === 'SUCCESS' ? 'đã đủ nhóm' : timeLeft(g.expiresAt)}
          </Text>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <ProgressBar value={pct} max={100} />
      </div>
      {g.status !== 'SUCCESS' && (
        <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 6 }}>
          {`Đủ nhóm: nhận mã giảm ${g.discountPct}%, dùng cho đơn từ ${formatVnd(g.unitPrice)}`}
        </Text>
      )}
      {g.status === 'SUCCESS' && member ? (
        <>
          {g.couponCode && (
            <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 6 }}>
              Mã của bạn:{' '}
              <Text variant="caption" tone="brand" style={{ fontWeight: 700 }}>
                {g.couponCode}
              </Text>
              {' '}· chọn trong “Chọn mã” ở giỏ hàng, dùng trong 30 ngày.
            </Text>
          )}
          <Button fullWidth onPress={onOpen} style={{ marginTop: 10 }}>
            {`Mua ngay với mã giảm ${g.discountPct}%`}
          </Button>
        </>
      ) : (
        <Button fullWidth disabled={!isOpen || member} loading={joining} onPress={onJoin} style={{ marginTop: 10 }}>
          {label}
        </Button>
      )}
      {member && isOpen && (
        <Button fullWidth variant="secondary" icon={Share2} onPress={onShare} style={{ marginTop: 8 }}>
          Mời bạn bè
        </Button>
      )}
    </Card>
  );
}
