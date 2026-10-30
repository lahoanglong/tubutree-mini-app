import { useRef } from 'react';
import { Page, useNavigate, useParams, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { groupMemberStatus, groupMissing, groupMissingLine, groupPriceLabels, groupRewardLine } from '@tubutree/app-core/group-buy-copy';
import { getGroupBuy, listGroupBuys, joinGroupBuy, type GroupBuy } from '../services/groupbuy-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { fetchActiveFlashSales } from '../services/shop-api';
import { serverNow } from '../utils/server-clock';
import { formatVnd } from '../utils/format';
import { useAuthStore } from '../store/auth';
import { useLoginWithNotice } from '../hooks/use-login-notice';
import { isGuestUser } from '../utils/guest-user';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { Heading, Text } from '../components/ui/text';
import { useShareWithFallback } from '../components/share-sheet';
import { withReferral } from '../utils/share-link';
import { ProductThumb } from '../components/ui/product-thumb';

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
  const login = useLoginWithNotice();
  const user = useAuthStore((s) => s.user);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const referralCode = user?.referralCode;
  const shareWithFallback = useShareWithFallback();

  const {
    data: groups,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({ queryKey: ['group-buy'], queryFn: listGroupBuys });

  // Link /group-buy/:id (người trong nhóm gửi bạn): nhóm đó có thể không nằm trong 30 nhóm mới nhất của danh sách chung. API chi tiết
  // công khai (khách thấy đúng nhóm rồi mới được mời đăng nhập; mã giảm chỉ trả cho thành viên), nhưng `joined`/`couponCode` theo
  // người xem nên khoá gắn với người xem, như `groupBuyOneQuery` của app-core: đăng nhập xong thì tải lại.
  const invitedQ = useQuery({
    queryKey: ['group-buy', 'one', invitedId, user?.id ?? 'guest'],
    queryFn: () => getGroupBuy(invitedId!),
    enabled: Boolean(invitedId),
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

  // Tài khoản khách (chưa có số điện thoại hay Zalo thật) bị máy chủ từ chối tham gia: liên kết trước, xong mới gửi. Khoá đồng bộ để
  // chạm đúp không mở hai lần hộp xin số điện thoại.
  const linking = useRef(false);
  const join = async (id: string) => {
    if (!authed) {
      void login();
      return;
    }
    if (user && isGuestUser(user)) {
      if (linking.current) return;
      linking.current = true;
      let phone: string | null = null;
      try {
        phone = await ensurePhone();
      } catch {
        phone = null;
      } finally {
        linking.current = false;
      }
      if (!phone) {
        openSnackbar({ text: 'Chưa liên kết được số điện thoại Zalo nên chưa tham gia được. Bạn bấm Tham gia và cho phép lại nhé.', type: 'warning' });
        return;
      }
    }
    joinM.mutate(id);
  };

  const share = (g: GroupBuy) =>
    void shareWithFallback(
      {
        title: `Mua chung ${g.product.name} giảm ${g.discountPct}%`,
        description: `Còn thiếu ${groupMissing(g)} người nữa là đủ nhóm, vào tham gia cùng mình nhé!`,
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
      // Nhóm đủ người: trang sản phẩm áp mã của nhóm vào giỏ sau khi khách thêm giỏ hay mua ngay.
      onBuy={() => navigate(`/product/${g.product.slug}`, { state: { variationId: g.variationId, applyCoupon: g.couponCode } })}
      onJoin={() => void join(g.id)}
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
        <ErrorState message={getLoadErrorMessage(error)} onRetry={() => void refetch()} />
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
  onBuy,
  onJoin,
  onShare,
  joining,
}: {
  g: GroupBuy;
  authed: boolean;
  invitedBanner: boolean;
  onOpen: () => void;
  onBuy: () => void;
  onJoin: () => void;
  onShare: () => void;
  joining: boolean;
}) {
  const pct = g.targetSize > 0 ? Math.min(100, Math.round((g.currentSize / g.targetSize) * 100)) : 0;
  const isOpen = g.status === 'OPEN';
  const member = authed && g.joined;
  const closedLabel = g.status === 'SUCCESS' ? 'Nhóm đã đủ người' : 'Nhóm đã hết hạn';
  const label = !isOpen ? closedLabel : !authed ? 'Đăng nhập để tham gia' : `Tham gia mua chung (−${g.discountPct}%)`;
  // Chỉ đọc cache Giờ vàng (nhịp tải lại do useFlashSalesPoller lo): "Mua một mình" theo giá hiện nay, không theo giá lưu lúc tạo nhóm.
  const flash = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 }).data;
  const prices = groupPriceLabels(g, formatVnd, flash, serverNow());
  const inOpenGroup = member && isOpen;
  const missingLine = groupMissingLine(g);
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
          aria-label={g.product.name}
          style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', flex: '0 0 auto', alignSelf: 'flex-start' }}
        >
          <ProductThumb src={g.product.thumbnail} alt={g.product.name} size={56} />
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
            <Text variant="body-sm" tone="brand" style={{ fontWeight: 600 }}>{prices.group}</Text>
            <Badge tone="promo" size="sm">−{g.discountPct}%</Badge>
          </div>
          <Text variant="caption" tone="tertiary" as="div">{prices.solo}</Text>
          <Text variant="caption" tone="tertiary" as="div">
            {g.currentSize}/{g.targetSize} người · {g.status === 'SUCCESS' ? 'đã đủ nhóm' : timeLeft(g.expiresAt)}
          </Text>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <ProgressBar value={pct} max={100} ariaLabel={`${g.product.name}: tiến độ nhóm mua chung`} />
      </div>
      {g.status !== 'SUCCESS' && (
        <div style={{ marginTop: 6 }}>
          {/* Người đã ở trong nhóm có dòng trạng thái riêng bên dưới ("cần thêm N người"), không lặp ý. */}
          {isOpen && !inOpenGroup && missingLine && (
            <Text variant="caption" tone="secondary" as="div" style={{ fontWeight: 600 }}>
              {missingLine}
            </Text>
          )}
          <Text variant="caption" tone="secondary" as="div">
            {groupRewardLine(g, formatVnd)}
          </Text>
        </div>
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
          <Button fullWidth onPress={onBuy} style={{ marginTop: 10 }}>
            {`Mua ngay với mã giảm ${g.discountPct}%`}
          </Button>
        </>
      ) : inOpenGroup ? (
        <>
          <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 8, fontWeight: 600 }}>
            {groupMemberStatus(g)}
          </Text>
          <Button fullWidth icon={Share2} onPress={onShare} style={{ marginTop: 8 }}>
            Mời bạn bè
          </Button>
        </>
      ) : (
        <Button fullWidth disabled={!isOpen || member} loading={joining} onPress={onJoin} style={{ marginTop: 10 }}>
          {label}
        </Button>
      )}
    </Card>
  );
}
