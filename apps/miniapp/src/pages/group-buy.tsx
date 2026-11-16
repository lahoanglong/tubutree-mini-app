import { useEffect, useRef, useState } from 'react';
import { Page, useNavigate, useParams, useSnackbar } from 'zmp-ui';
import { useSmartNavigate } from '../lib/smart-nav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLockedMutation } from '../components/game/use-locked-mutation';
import { Share2 } from 'lucide-react';
import { groupMemberStatus, groupMissing, groupMissingLine, groupPriceLabels, groupRewardLine } from '@tubutree/app-core/group-buy-copy';
import { createGroupBuy, getGroupBuy, listGroupBuys, joinGroupBuy, type GroupBuy } from '../services/groupbuy-api';
import { fetchGroupBuyStarterProducts } from '../services/groupbuy-starters';
import { getErrorMessage, getLoadErrorMessage, isHttpError } from '../services/api';
import { fetchActiveFlashSales, type ProductCard } from '../services/shop-api';
import { serverNow } from '../utils/server-clock';
import { settleWithin } from '../utils/settle-within';
import { formatVnd } from '../utils/format';
import { useAuthStore } from '../store/auth';
import { useLoginWithNotice } from '../components/ui/auth-gate';
import { isGuestUser } from '../utils/guest-user';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { CartButton } from '../components/cart-button';
import { capsuleExtra } from '../utils/capsule';
import { ProgressBar } from '../components/ui/progress-bar';
import { Heading, Text } from '../components/ui/text';
import { useShareWithFallback } from '../components/share-sheet';
import { withReferral } from '../utils/share-link';
import { usePublicConfig } from '../hooks/use-public-config';
import { shareDescription, welcomeOfferOf } from '@tubutree/app-core/commerce/share-offer';
import { ProductThumb } from '../components/ui/product-thumb';

/** Hộp chia sẻ của Zalo không có hạn: quá ngần này thì nhả khoá "Mời bạn bè" dù hộp chưa báo xong. */
const SHARE_LOCK_MAX_MS = 30_000;

/**
 * Máy chủ đã nói rõ nhóm khác với thẻ đang hiện: 400/404/409 (đã đủ người, đã hết hạn, đã đóng, đã tham gia rồi). Mất mạng, hết thời gian,
 * 401 và 5xx thì không tải lại: các lỗi đó hay đến đúng lúc máy chủ đang bận (triển khai), lần tải lại cũng hỏng và lỗi tải danh sách sẽ thay
 * cả danh sách bằng màn lỗi. Nếu máy chủ đã ghi thành viên trước khi lỗi 5xx thì lần bấm sau nhận 400 "đã tham gia" và tải lại ở đó.
 */
function groupMayHaveChanged(e: unknown): boolean {
  if (!isHttpError(e)) return false;
  const status = e.response?.status ?? 0;
  return status === 400 || status === 404 || status === 409;
}

function timeLeft(iso: string): string {
  const diff = (new Date(iso).getTime() - serverNow()) / 1000;
  if (diff <= 0) return 'đã hết hạn';
  if (diff < 3600) return `còn ${Math.floor(diff / 60)} phút`;
  if (diff < 86400) return `còn ${Math.floor(diff / 3600)} giờ`;
  return `còn ${Math.floor(diff / 86400)} ngày`;
}

export default function GroupBuyPage() {
  const navigate = useNavigate();
  const goSmart = useSmartNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const { id: invitedId } = useParams<{ id: string }>();
  const authed = useAuthStore((s) => s.status) === 'authenticated';
  const login = useLoginWithNotice();
  const user = useAuthStore((s) => s.user);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const referralCode = user?.referralCode;
  const shareWithFallback = useShareWithFallback();
  const welcomeOffer = welcomeOfferOf(usePublicConfig());

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

  const startersQ = useQuery({
    queryKey: ['group-buy-starters'],
    queryFn: fetchGroupBuyStarterProducts,
    enabled: !isLoading && !isError && !invitedId,
    staleTime: 60_000,
    retry: false,
  });
  const starters = startersQ.data ?? [];

  const createM = useLockedMutation(
    {
      mutationFn: (productId: string) => createGroupBuy(productId),
      onSuccess: (created) => {
        openSnackbar({ text: 'Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé 🛒', type: 'success' });
        void queryClient.invalidateQueries({ queryKey: ['group-buy'] });
        navigate(`/group-buy/${created.id}`);
      },
      onError: (e: unknown) => {
        openSnackbar({ text: getErrorMessage(e), type: 'error' });
      },
    },
    (productId) => productId,
  );

  const joinM = useLockedMutation({
    mutationFn: (id: string) => joinGroupBuy(id),
    onSuccess: (r) => {
      openSnackbar({
        text: r.status === 'SUCCESS' ? 'Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.' : 'Đã tham gia nhóm',
        type: 'success',
      });
      // Trả Promise: khoá của nhóm giữ tới khi danh sách và chi tiết nhóm làm mới về (tối đa `settleWithin`). Nhả sớm thì thẻ còn `joined: false`
      // và nút "Tham gia" sáng lại, chạm lần nữa gửi một lệnh tham gia thừa bị máy chủ từ chối ngay sau thông báo thành công.
      return settleWithin(queryClient.invalidateQueries({ queryKey: ['group-buy'] }));
    },
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Thẻ đang cho bấm "Tham gia" trên nhóm mà máy chủ vừa nói đã đủ/đã đóng/đã có mình: tải lại để thẻ hiện đúng trạng thái, giữ khoá tới lúc đó.
      return groupMayHaveChanged(e) ? settleWithin(queryClient.invalidateQueries({ queryKey: ['group-buy'] })) : undefined;
    },
  }, (id) => id);

  // Tài khoản khách (chưa có số điện thoại hay Zalo thật) bị máy chủ từ chối tham gia: liên kết trước, xong mới gửi. Khoá đồng bộ để
  // chạm đúp không mở hai lần hộp xin số điện thoại.
  const linking = useRef(false);
  // Chạm Tham gia lúc app còn đang khôi phục phiên: chờ phiên rồi tham gia tiếp đúng nhóm đó (một lần dù chạm nhiều), thay vì nuốt lần chạm.
  const pendingJoin = useRef<string | null>(null);
  const [waitingJoinId, setWaitingJoinId] = useState<string | null>(null);
  // Rời trang trước khi khôi phục xong thì bỏ ý định.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Đọc user mới nhất từ store: lần chạy tiếp sau khi chờ phiên không được dùng user của lần render cũ.
  const joinSignedIn = async (id: string) => {
    const current = useAuthStore.getState().user;
    if (current && isGuestUser(current)) {
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
  const join = async (id: string) => {
    if (!authed) {
      if (useAuthStore.getState().status === 'loading') {
        if (pendingJoin.current) return;
        pendingJoin.current = id;
        setWaitingJoinId(id);
        void login().finally(() => {
          pendingJoin.current = null;
          if (!mounted.current) return;
          setWaitingJoinId(null);
          if (useAuthStore.getState().status === 'authenticated') void joinSignedIn(id);
        });
        return;
      }
      void login();
      return;
    }
    await joinSignedIn(id);
  };

  const startRoom = async (productId: string) => {
    if (!authed) {
      void login();
      return;
    }
    const current = useAuthStore.getState().user;
    if (current && isGuestUser(current)) {
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
        openSnackbar({ text: 'Chưa liên kết được số điện thoại Zalo nên chưa mở nhóm được. Bạn thử lại nhé.', type: 'warning' });
        return;
      }
    }
    createM.mutate(productId);
  };

  // Trả Promise để Button giữ khoá tới khi hộp chia sẻ đóng: chạm đúp không mở hai hộp chia sẻ của Zalo. Có hạn: hộp chia sẻ treo thì nút không chết tới lúc rời trang.
  const share = (g: GroupBuy) =>
    settleWithin(
      shareWithFallback(
        {
          title: `Mua chung ${g.product.name} giảm ${g.discountPct}%`,
          description: shareDescription(`Còn thiếu ${groupMissing(g)} người nữa là đủ nhóm, vào tham gia cùng mình nhé!`, welcomeOffer),
          thumbnail: g.product.thumbnail ?? undefined,
          path: withReferral(`/group-buy/${g.id}`, referralCode),
        },
        `Cùng mình mua chung ${g.product.name} giảm ${g.discountPct}% trên Tubu Tree nhé! Vào mục "Mua chung nhóm" để tham gia.${
          referralCode ? ` Mã giới thiệu của mình: ${referralCode}` : ''
        }`,
      ),
      SHARE_LOCK_MAX_MS,
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
      joining={(joinM.isPending && joinM.variables === g.id) || waitingJoinId === g.id}
    />
  );

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 80 }}>
      <PageHeader
        title="Mua chung giá tốt"
        subtitle="Rủ thêm bạn cho đủ nhóm — đủ người, ai cũng nhận mã giảm giá!"
        actions={
          <div style={{ flex: '0 0 auto', marginRight: capsuleExtra(16) }}>
            <CartButton />
          </div>
        }
      />

      {isLoading ? (
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </div>
      ) : isError ? (
        <ErrorState message={getLoadErrorMessage(error)} onRetry={() => refetch()} />
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
          {!invitedId && starters.length > 0 && (
            <MiniStarterShelf
              items={starters}
              authed={authed}
              creatingId={createM.isPending ? (createM.variables as string) : null}
              onOpen={(slug) => navigate(`/product/${slug}`)}
              onStart={(productId) => void startRoom(productId)}
            />
          )}
        </div>
      ) : (
        <>
          <EmptyState
            art="basket"
            heading="Chưa có nhóm mua chung nào"
            body="Mở nhóm ngay bên dưới hoặc từ trang sản phẩm để rủ bạn bè mua chung giá tốt!"
            ctaLabel="Khám phá sản phẩm"
            onCta={() => goSmart('/browse')}
          />
          {!invitedId && starters.length > 0 && (
            <div style={{ padding: '0 var(--space-inset-page) var(--space-inset-page)' }}>
              <MiniStarterShelf
                items={starters}
                authed={authed}
                creatingId={createM.isPending ? (createM.variables as string) : null}
                onOpen={(slug) => navigate(`/product/${slug}`)}
                onStart={(productId) => void startRoom(productId)}
              />
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function MiniStarterShelf({
  items,
  authed,
  creatingId,
  onOpen,
  onStart,
}: {
  items: readonly ProductCard[];
  authed: boolean;
  creatingId: string | null;
  onOpen: (slug: string) => void;
  onStart: (productId: string) => void;
}) {
  return (
    <section aria-label="Mở nhóm Mua chung mới — Chọn món giá kho" data-testid="group-buy-starter-shelf">
      <Card variant="outline">
        <Text variant="label" tone="brand" as="div">
          MỞ NHÓM TRỰC TIẾP 1 CHẠM
        </Text>
        <Heading variant="title-sm" as="h2" font="ui" style={{ marginTop: 'var(--space-stack-xs)' }}>
          Mở nhóm Mua chung mới — Chọn món giá kho
        </Heading>
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
          Chọn sản phẩm sinh học bán chạy do Tubu giao để mở nhóm ngay và rủ bạn bè cùng nhận Mã giảm giá.
        </Text>
        <div style={{ marginTop: 'var(--space-stack-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--space-inline-sm)' }}>
          {items.map((p) => {
            const price = p.salePrice ?? p.basePrice;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-inline-sm)',
                  padding: 'var(--space-inline-sm)',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-bg-canvas)',
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(p.slug)}
                  className="tubu-press"
                  aria-label={p.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-inline-sm)',
                    flex: 1,
                    minWidth: 0,
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <ProductThumb src={p.thumbnail} alt="" size={48} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="label" as="div">
                      {p.name}
                    </Text>
                    <Text variant="price-sm" tone="brand" numeric as="div">
                      {formatVnd(price)}
                    </Text>
                  </span>
                </button>
                <Button
                  size="md"
                  variant="secondary"
                  loading={creatingId === p.id}
                  onPress={() => onStart(p.id)}
                >
                  {authed ? 'Mở nhóm ngay' : 'Đăng nhập'}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
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
  // Nhóm quá hạn nhưng cron 15 phút chưa đóng vẫn trả OPEN: máy chủ từ chối mọi lần tham gia, nên thẻ coi như đã hết hạn thay vì cho bấm mãi.
  const expired = g.status === 'OPEN' && new Date(g.expiresAt).getTime() <= serverNow();
  const isOpen = g.status === 'OPEN' && !expired;
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
            <Text variant="body-sm" tone="brand" numeric style={{ fontWeight: 600 }}>{prices.group}</Text>
            <Badge tone="promo" size="sm">−{g.discountPct}%</Badge>
          </div>
          <Text variant="caption" tone="tertiary" as="div" numeric>{prices.solo}</Text>
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
            {`Mua ngay với mã giảm giá ${g.discountPct}%`}
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
