'use client';

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { Share2, Users } from 'lucide-react';
import { fetchProducts, type ProductCard } from '@tubutree/app-core/api/catalog';
import { createGroupBuy, joinGroupBuy, type GroupBuy } from '@tubutree/app-core/api/groupbuy';
import {
  GROUP_LIVE_COUNTDOWN_MS,
  groupDeadline,
  groupMemberStatus,
  groupMissingLine,
  groupPriceLabels,
  groupRewardLine,
  groupShareContent,
  groupSlotsLine,
} from '@tubutree/app-core/group-buy-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { groupBuyListQuery, groupBuyOneQuery } from '@tubutree/app-core/queries/groupbuy';
import { serverNow } from '@tubutree/app-core/server-clock';
import { EmptyState } from '@/components/empty-state';
import { PhoneCartButton } from '@/components/phone-cart-button';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { Badge } from '@/components/ui/badge';
import { GroupCycleDealsNavPills } from '@/components/ui/ecosystem-nav-pills';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress-bar';
import { LineItemSkeleton, Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { platformBridge } from '@/lib/platform-bridge';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { loginHref } from '@/lib/return-to';
import { withReferral } from '@/lib/share-link';
import { useWelcomeOffer } from '@/lib/use-welcome-offer';
import { PAGE_WIDE } from '@/lib/page-frame';
import { Countdown, ProductThumb } from '@/components/mini';
import { actionErrorText, loadErrorText } from '@/lib/error-text';

type Note = { text: string; error: boolean } | null;

const JUST_CREATED_PARAM = 'moi';
const errorText = loadErrorText;
const JOIN_KEY = ['group-buy-join'] as const;
const START_KEY = ['group-buy-start'] as const;

const REDUCE_MOTION = '(prefers-reduced-motion: reduce)';
const subscribeReduceMotion = (cb: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(REDUCE_MOTION);
  mq.addEventListener?.('change', cb);
  return () => mq.removeEventListener?.('change', cb);
};
const readReduceMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_MOTION).matches;

/** Trần của setTimeout (2^31 − 1 ms). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Giảm chuyển động của máy. Máy chủ dựng trang và lúc hydrate coi như không (HTML khớp), đọc thật ngay sau đó. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, readReduceMotion, () => false);
}

/**
 * Trang Mua chung: danh sách nhóm và nhóm được mời qua link `/mua-chung/:id`. Danh sách và chi tiết nhóm công khai nhưng mỗi nhóm
 * mang `joined`/`isOwner` theo người xem nên tải ở trình duyệt; khách chưa đăng nhập chạm Tham gia thì sang đăng nhập rồi quay lại.
 */
export function GroupBuyView({ invitedId }: { invitedId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const { user, retrySession } = useAuth();
  const offer = useWelcomeOffer(Boolean(user));
  const authed = phase === 'authenticated';
  const [note, setNote] = useState<Note>(null);

  // `?moi=1` do trang sản phẩm đặt khi vừa mở nhóm: báo một lần như Mini App rồi gỡ cờ để tải lại không báo nữa.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(JUST_CREATED_PARAM) !== '1') return;
    url.searchParams.delete(JUST_CREATED_PARAM);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setNote({ text: 'Đã mở nhóm mua chung! Rủ bạn bè tham gia nhé 🛒', error: false });
  }, []);

  const viewer = authed ? (user?.id ?? 'user') : 'guest';
  const listQ = useQuery(groupBuyListQuery(coreHttp, viewer));
  // Nhóm được mời có thể không nằm trong 30 nhóm mới nhất của danh sách chung. Khách chưa đăng nhập cũng xem được (máy chủ không
  // trả mã giảm cho người chưa tham gia); đăng nhập xong khoá đổi nên `joined`/`couponCode` được tải lại theo người xem.
  const invitedQ = useQuery({ ...groupBuyOneQuery(coreHttp, invitedId ?? '', viewer), enabled: Boolean(invitedId), retry: false });
  const invited = invitedQ.data;
  const rest = (listQ.data ?? []).filter((g) => g.id !== invited?.id);
  const others = rest.filter((g) => g.status !== 'SUCCESS');
  const done = rest.filter((g) => g.status === 'SUCCESS');

  const startersQ = useQuery({
    queryKey: ['group-buy-starters'],
    queryFn: async () => {
      const res = await fetchProducts(coreHttp, { page: 1, limit: 8, sort: 'best_seller' });
      const raw = Array.isArray(res?.data) ? res.data : [];
      return raw
        .filter((p) => p.inStock !== false && p.fulfiller?.kind !== 'MERCHANT' && p.fulfiller?.kind !== 'UNAVAILABLE')
        .slice(0, 6);
    },
    enabled: listQ.isSuccess && !invitedId,
    staleTime: 60_000,
    retry: false,
  });
  const starters = startersQ.data ?? [];

  const startM = useLockedMutation(
    {
      mutationKey: START_KEY,
      mutationFn: (productId: string) => createGroupBuy(coreHttp, productId),
      onSuccess: (created) => {
        router.push(`/mua-chung/${encodeURIComponent(created.id)}?moi=1`);
      },
      onError: (e: unknown) => {
        setNote({ text: actionErrorText(e), error: true });
      },
    },
    (productId) => productId,
  );
  const startingIds = useMutationState({ filters: { mutationKey: START_KEY, status: 'pending' }, select: (m) => m.state.variables as string });

  // Khoá theo nhóm: chạm đúp vào CÙNG nhóm bị bỏ qua, hai nhóm khác nhau vẫn tham gia song song. `onSuccess` trả lời hứa tải lại danh sách
  // nên khoá giữ tới khi `joined`/`currentSize` mới về (tối đa `settleWithin`, kẻo mạng chậm giữ nút lâu hơn lệnh đã xong); nhả sớm hơn thì thẻ còn nút "Tham gia" theo số cũ và bấm được lần hai.
  const joinM = useLockedMutation(
    {
      mutationKey: JOIN_KEY,
      mutationFn: (id: string) => joinGroupBuy(coreHttp, id),
      onSuccess: (r) => {
        setNote({ text: r.status === 'SUCCESS' ? 'Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.' : 'Đã tham gia nhóm', error: false });
        return settleWithin(qc.invalidateQueries({ queryKey: ['group-buy'] }));
      },
      onError: (e: unknown) => {
        setNote({ text: errorText(e), error: true });
        // Thẻ đang cho bấm "Tham gia" trên nhóm mà máy chủ vừa nói đã đủ/đã đóng/đã có mình: tải lại để thẻ hiện đúng trạng thái, giữ khoá tới lúc đó.
        return serverRejectedState(e) ? settleWithin(qc.invalidateQueries({ queryKey: ['group-buy'] })) : undefined;
      },
    },
    (id) => id,
  );
  // Mọi nhóm đang tham gia (không chỉ lệnh sau cùng, `joinM.variables` chỉ giữ lệnh cuối): khoá theo nhóm nuốt cú chạm vào các nhóm đó, nên nút của chúng phải báo bận.
  const joiningIds = useMutationState({ filters: { mutationKey: JOIN_KEY, status: 'pending' }, select: (m) => m.state.variables as string });

  // Khôi phục phiên và hộp chia sẻ của trình duyệt đều chỉ mở được một lần một lúc: lần chạm thứ hai trong lúc chạy bị bỏ qua.
  const sessionRetrying = useRef(false);
  // Khách chạm Tham gia hai lần cùng khung hình: `router.push` không có trạng thái để thẻ báo bận, nên cả hai cú chạm đều gọi điều hướng sang đăng nhập (mở luồng đăng nhập hai lần).
  // Cờ chỉ đặt lại khi phiên đổi pha: điều hướng không xảy ra mà màn còn sống thì nút Tham gia không được chết.
  const loginRedirected = useRef(false);
  useEffect(() => {
    loginRedirected.current = false;
  }, [phase]);
  const sharingRef = useRef(false);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const join = (id: string) => {
    if (authed) {
      setNote(null);
      joinM.mutate(id);
    } else if (phase === 'unavailable') {
      if (sessionRetrying.current) return;
      sessionRetrying.current = true;
      void retrySession().finally(() => {
        sessionRetrying.current = false;
      });
    } else {
      if (loginRedirected.current) return;
      loginRedirected.current = true;
      router.push(loginHref(invitedId ? `/mua-chung/${invitedId}` : '/mua-chung'));
    }
  };

  const share = async (g: GroupBuy) => {
    // `navigator.share` thứ hai khi hộp đầu còn mở bị từ chối, rồi nhánh dự phòng sẽ báo "Đã sao chép liên kết" sai sự thật.
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharingId(g.id);
    setNote(null);
    try {
      const content = groupShareContent(g, offer);
      const result = await platformBridge.share({
        title: content.title,
        text: content.text,
        path: withReferral(`/mua-chung/${encodeURIComponent(g.id)}`, user?.referralCode),
      });
      if (result === 'copied') setNote({ text: 'Đã sao chép liên kết nhóm.', error: false });
      else if (result === 'failed') setNote({ text: 'Không sao chép được. Bạn chép liên kết trên thanh địa chỉ nhé.', error: true });
    } finally {
      sharingRef.current = false;
      setSharingId(null);
    }
  };

  const startRoom = (productId: string) => {
    if (authed) {
      setNote(null);
      startM.mutate(productId);
    } else if (phase === 'unavailable') {
      if (sessionRetrying.current) return;
      sessionRetrying.current = true;
      void retrySession().finally(() => {
        sessionRetrying.current = false;
      });
    } else {
      if (loginRedirected.current) return;
      loginRedirected.current = true;
      router.push(loginHref('/mua-chung'));
    }
  };

  const renderCard = (g: GroupBuy, invitedBanner = false, landing = false) => (
    <GroupCard
      key={g.id}
      g={g}
      authed={authed}
      invitedBanner={invitedBanner}
      shareContent={landing ? groupShareContent(g, offer) : null}
      onJoin={() => join(g.id)}
      onShare={() => void share(g)}
      joining={joiningIds.includes(g.id)}
      sharing={sharingId === g.id}
    />
  );

  return (
    <main className={`${PAGE_WIDE} py-6`}>
      <PageHeader
        title="Mua chung giá tốt"
        subtitle="Rủ thêm bạn cho đủ nhóm — đủ người, ai cũng nhận mã giảm giá!"
        backHref={invitedId ? '/mua-chung' : '/'}
        actions={<PhoneCartButton />}
      />
      <div className="mt-3">
        <GroupCycleDealsNavPills activeOverride="group-buy" />
      </div>

      {note && (
        <p role={note.error ? 'alert' : 'status'} className={`mt-3 text-sm ${note.error ? 'text-danger-fg' : 'text-success-fg'}`}>
          {note.text}
        </p>
      )}

      <div className="mt-4">
        {listQ.isLoading ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            <LineItemSkeleton />
            <LineItemSkeleton />
          </div>
        ) : listQ.isError ? (
          <ErrorState message={errorText(listQ.error)} onRetry={() => listQ.refetch()} />
        ) : invited || others.length > 0 || done.length > 0 ? (
          <div className="flex flex-col gap-6">
            {(invited || others.length > 0) && (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3">
                {invited && renderCard(invited, !invited.isOwner && !invited.joined, true)}
                {others.map((g) => renderCard(g))}
              </div>
            )}
            {done.length > 0 && (
              <section aria-label="Nhóm đã đủ người của bạn" className="flex flex-col gap-3">
                <h2 className={ui.sectionTitle}>Nhóm đã đủ người của bạn</h2>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3">{done.map((g) => renderCard(g))}</div>
              </section>
            )}
            {!invitedId && starters.length > 0 && (
              <StarterShelf items={starters} authed={authed} startingIds={startingIds} onStart={startRoom} />
            )}
          </div>
        ) : (
          <>
            <EmptyState
              title="Chưa có nhóm mua chung nào"
              body="Mở nhóm ngay bên dưới hoặc từ trang sản phẩm để rủ bạn bè mua chung giá tốt!"
              actionHref="/san-pham"
              actionLabel="Khám phá sản phẩm"
            />
            {!invitedId && (startersQ.isPending || starters.length > 0) && (
              <div className="mt-6">
                {startersQ.isPending ? (
                  <StarterShelfSkeleton />
                ) : (
                  <StarterShelf items={starters} authed={authed} startingIds={startingIds} onStart={startRoom} />
                )}
              </div>
            )}
            {/* Máy tính: màn trống rộng, giải thích cách chạy để người xem biết bước tiếp theo. */}
            <ol aria-label="Cách mua chung" className="mx-auto mt-4 grid max-w-3xl gap-3 max-md:hidden md:grid-cols-3">
              {GROUP_STEPS.map((t, i) => (
                <li key={t} className={`${ui.card} flex gap-3 p-4 text-sm text-stone-700`}>
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-forest-100 text-sm font-bold text-forest-800">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}

/** Số món tối đa của kệ mở nhóm (`startersQ` cắt 6, PROD thường đủ 6): khung chờ vẽ đủ chừng ấy ô để kệ về không đẩy phần dưới (các bước Mua chung ở máy tính). */
const STARTER_MAX = 6;
const STARTER_SHELF = 'rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 [box-shadow:var(--elevation-1)]';
const STARTER_GRID = 'mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';
const STARTER_ITEM = 'flex flex-col justify-between gap-3 rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3';

function StarterShelfHead() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-pill bg-[var(--color-bg-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-text-brand)]">
          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          MỞ NHÓM TRỰC TIẾP 1 CHẠM
        </div>
        <h2 className={`${ui.sectionTitle} mt-1.5`}>Mở nhóm Mua chung mới — Chọn món giá kho</h2>
        <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
          Chọn sản phẩm sinh học bán chạy do Tubu giao để mở nhóm ngay và rủ bạn bè cùng nhận Mã giảm giá.
        </p>
      </div>
    </div>
  );
}

/** Kệ mở nhóm đang tải (danh sách nhóm đã về rỗng, món bán chạy về sau): cùng khung, cùng đầu kệ và đủ ô như kệ thật. */
function StarterShelfSkeleton() {
  return (
    <section aria-label="Mở nhóm Mua chung mới — Chọn món giá kho" aria-busy="true" data-testid="group-buy-starter-shelf-loading" className={STARTER_SHELF}>
      <StarterShelfHead />
      <div className={STARTER_GRID}>
        {Array.from({ length: STARTER_MAX }, (_, i) => (
          <div key={i} aria-hidden="true" className={STARTER_ITEM}>
            <div className="flex min-h-14 items-start gap-3">
              <Skeleton width={56} height={56} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton width="80%" height={14} />
                <Skeleton width="50%" height={12} />
              </div>
            </div>
            <Skeleton height={44} />
          </div>
        ))}
      </div>
    </section>
  );
}

function StarterShelf({
  items,
  authed,
  startingIds,
  onStart,
}: {
  items: readonly ProductCard[];
  authed: boolean;
  startingIds: readonly string[];
  onStart: (productId: string) => void;
}) {
  return (
    <section aria-label="Mở nhóm Mua chung mới — Chọn món giá kho" data-testid="group-buy-starter-shelf" className={STARTER_SHELF}>
      <StarterShelfHead />

      <div className={STARTER_GRID}>
        {items.map((p) => {
          const price = p.salePrice ?? p.basePrice;
          const starting = startingIds.includes(p.id);
          return (
            <article key={p.id} className={`${STARTER_ITEM} tabular-nums`}>
              <Link href={`/san-pham/${encodeURIComponent(p.slug)}`} className="flex min-h-14 items-start gap-3">
                <ProductThumb src={p.thumbnail} alt="" size={56} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
                    {p.name}
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-[var(--color-text-brand)]">
                    Giá lẻ hiện tại: {formatVnd(price)}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                aria-busy={starting || undefined}
                aria-disabled={starting || undefined}
                aria-label={`${authed ? 'Mở nhóm ngay' : 'Đăng nhập để mở nhóm'} cho ${p.name}`}
                onClick={() => {
                  if (starting) return;
                  onStart(p.id);
                }}
                className={`${ui.btnSecondary} w-full`}
              >
                {authed ? 'Mở nhóm ngay' : 'Đăng nhập để mở nhóm'}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const GROUP_STEPS = [
  'Chọn sản phẩm có mua chung và mở nhóm từ trang sản phẩm.',
  'Gửi link cho bạn bè, đủ người trong hạn thì cả nhóm cùng được giá tốt.',
  'Đủ nhóm là nhận mã giảm giá, dùng ở giỏ hàng trong 30 ngày.',
];

function GroupCard({
  g,
  authed,
  invitedBanner,
  shareContent,
  onJoin,
  onShare,
  joining,
  sharing,
}: {
  g: GroupBuy;
  authed: boolean;
  invitedBanner: boolean;
  /** Có ở thẻ nhóm của trang mời /mua-chung/:id: dòng "Còn N suất · Tiết kiệm X" và khung xem trước tin mời. */
  shareContent: { title: string; text: string } | null;
  onJoin: () => void;
  onShare: () => void;
  joining: boolean;
  sharing: boolean;
}) {
  // Đồng hồ tới giờ thì vẽ lại thẻ: hạn tính lại theo giờ máy chủ, nút Tham gia khoá và chữ đổi sang "đã hết hạn" ngay, không chờ lần tải sau.
  const [tick, rerender] = useReducer((n: number) => n + 1, 0);
  const now = serverNow();
  const deadline = groupDeadline(g, now);
  // Thẻ dạng chữ ("còn N ngày") tự đổi sang đồng hồ sống đúng mốc còn 24 giờ, không chờ lần tải lại danh sách. `tick` hẹn lại khi hạn quá xa
  // so với trần setTimeout (khoảng 24,8 ngày).
  const textUntilLive = g.status === 'OPEN' && deadline.kind === 'text' && !deadline.expired;
  useEffect(() => {
    if (!textUntilLive) return;
    const ms = Date.parse(g.expiresAt) - GROUP_LIVE_COUNTDOWN_MS - serverNow();
    const t = setTimeout(rerender, Math.min(Math.max(ms, 0) + 50, MAX_TIMEOUT_MS));
    return () => clearTimeout(t);
  }, [textUntilLive, g.expiresAt, tick]);
  // Nhóm quá hạn nhưng cron 15 phút chưa đóng vẫn trả OPEN: máy chủ từ chối mọi lần tham gia, nên thẻ coi như đã hết hạn thay vì cho bấm mãi.
  const expired = g.status === 'OPEN' && deadline.kind === 'text' && deadline.expired;
  const isOpen = g.status === 'OPEN' && !expired;
  const landing = shareContent !== null;
  const member = authed && g.joined;
  const productHref = `/san-pham/${encodeURIComponent(g.product.slug)}`;
  const closedLabel = g.status === 'SUCCESS' ? 'Nhóm đã đủ người' : 'Nhóm đã hết hạn';
  const label = !isOpen ? closedLabel : !authed ? 'Đăng nhập để tham gia' : `Tham gia mua chung (−${g.discountPct}%)`;
  const flash = useActiveFlashSales();
  const prices = groupPriceLabels(g, formatVnd, flash);
  const inOpenGroup = member && isOpen;
  // Trang mời: "Còn N suất · Tiết kiệm X" thay dòng "Còn thiếu N người" (cùng một ý). Thành viên đã có dòng trạng thái riêng.
  const slotsLine = landing && isOpen && !inOpenGroup ? groupSlotsLine(g, formatVnd, now, flash) : null;
  const missingLine = slotsLine ? null : groupMissingLine(g);

  return (
    <article className={`${ui.card} flex flex-col p-3 tabular-nums max-md:border-0 max-md:[box-shadow:var(--elevation-1)]`}>
      {invitedBanner && <p className="mb-1.5 text-xs font-semibold text-forest-700 max-md:text-[length:var(--type-caption-size)]">Bạn được mời vào nhóm này</p>}
      <Link href={productHref} className="flex min-h-14 gap-3">
        <span className="inline-flex shrink-0 self-start">
          <ProductThumb src={g.product.thumbnail} alt="" size={56} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-stone-900 max-md:text-[length:var(--type-body-sm-size)]">
            {g.product.name}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-forest-700 max-md:text-[length:var(--type-body-sm-size)]">{prices.group}</span>
            <Badge tone="promo" size="sm">
              −{g.discountPct}%
            </Badge>
          </div>
          <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)]">{prices.solo}</p>
          <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)]">
            {g.currentSize}/{g.targetSize} người · {deadline.kind === 'live' ? <GroupCountdown endAt={deadline.endAt} onEnd={rerender} /> : deadline.text}
          </p>
        </div>
      </Link>
      {slotsLine && (
        <div className="mt-2">
          <Badge tone="promo" size="md">
            {slotsLine}
          </Badge>
        </div>
      )}
      <div className="mt-2">
        <ProgressBar value={g.currentSize} max={g.targetSize} ariaLabel={`${g.product.name}: tiến độ nhóm mua chung`} />
      </div>
      {g.status !== 'SUCCESS' && (
        <div className="mt-1.5 text-xs text-stone-700 max-md:text-[length:var(--type-caption-size)]">
          {/* Người đã ở trong nhóm có dòng trạng thái riêng bên dưới ("cần thêm N người"), không lặp ý. */}
          {isOpen && !inOpenGroup && missingLine && <p className="font-semibold">{missingLine}</p>}
          <p>{groupRewardLine(g, formatVnd)}</p>
        </div>
      )}
      {g.status === 'SUCCESS' && member ? (
        <>
          {g.couponCode && (
            <p className="mt-1.5 text-xs text-stone-700 max-md:text-[length:var(--type-caption-size)]">
              Mã của bạn: <span className="font-bold text-forest-700">{g.couponCode}</span> · chọn trong “Chọn mã” ở giỏ hàng, dùng trong 30 ngày.
            </p>
          )}
          <Link href={g.couponCode ? `${productHref}?ma=${encodeURIComponent(g.couponCode)}` : productHref} className={`${ui.btnPrimary} mt-3 w-full`}>
            {`Mua ngay với mã giảm giá ${g.discountPct}%`}
          </Link>
        </>
      ) : inOpenGroup ? (
        <>
          <p className="mt-2 text-xs font-semibold text-stone-700 max-md:text-[length:var(--type-caption-size)]">{groupMemberStatus(g)}</p>
          {/* Thành viên: nút "Mời bạn bè" ngay dưới là nút chia sẻ duy nhất, khung chỉ cho xem trước tin. */}
          {shareContent && <SharePreview content={shareContent} />}
          <button
            type="button"
            aria-busy={sharing || undefined}
            aria-disabled={sharing || undefined}
            onClick={() => {
              if (sharing) return;
              onShare();
            }}
            className={`${ui.btnPrimary} mt-2 w-full gap-1.5`}
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Mời bạn bè
          </button>
        </>
      ) : (
        <>
          {shareContent && isOpen && <SharePreview content={shareContent} productName={g.product.name} sharing={sharing} onShare={onShare} />}
          <button
            type="button"
            disabled={!isOpen || member}
            aria-busy={joining || undefined}
            aria-disabled={joining || undefined}
            onClick={() => {
              if (joining) return;
              onJoin();
            }}
            className={`${ui.btnPrimary} mt-3 w-full`}
          >
            {label}
          </button>
        </>
      )}
    </article>
  );
}

/**
 * Hạn nhóm còn dưới 24 giờ: đồng hồ sống dùng chung (`Countdown`, số `tabular-nums`, tên đọc đổi theo phút). Ô số nhảy từng giây, trừ khi máy
 * bật giảm chuyển động thì dùng dạng chữ đổi theo phút. Tông xanh để không lẫn với Giờ vàng. Nguồn: GroupCountdown của apps/miniapp/src/pages/group-buy.tsx.
 */
function GroupCountdown({ endAt, onEnd }: { endAt: string; onEnd: () => void }) {
  const reduce = useReducedMotion();
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {!reduce && <span aria-hidden="true">{fillCopy('groupBuy.left')}</span>}
      <Countdown endAt={endAt} mode={reduce ? 'text' : 'clock'} tone="green" onEnd={onEnd} />
    </span>
  );
}

/**
 * Khung "Tin mời sẽ gửi" của trang mời: đúng tiêu đề và mô tả mà hộp chia sẻ gửi đi (`groupShareContent`). Có `onShare` (người chưa ở trong nhóm)
 * thì kèm nút Chia sẻ một chạm; thành viên đã có nút "Mời bạn bè" nên khung chỉ để xem.
 */
function SharePreview({
  content,
  productName,
  sharing = false,
  onShare,
}: {
  content: { title: string; text: string };
  productName?: string;
  sharing?: boolean;
  onShare?: () => void;
}) {
  return (
    <div
      data-testid="group-share-preview"
      className="mt-2 flex items-center gap-2 rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[length:var(--type-label-size)] text-[var(--color-text-tertiary)]">{fillCopy('groupBuy.sharePreview')}</p>
        <p className="truncate text-[length:var(--type-caption-size)] font-semibold text-[var(--color-text-primary)]">{content.title}</p>
        <p className="line-clamp-2 text-[length:var(--type-caption-size)] text-[var(--color-text-secondary)]">{content.text}</p>
      </div>
      {onShare && (
        <button
          type="button"
          aria-label={fillCopy('groupBuy.shareCtaLabel', { name: productName ?? '' })}
          aria-busy={sharing || undefined}
          aria-disabled={sharing || undefined}
          onClick={() => {
            if (sharing) return;
            onShare();
          }}
          className={`${ui.btnSecondary.replace('px-5', 'px-3')} shrink-0 gap-1.5`}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {fillCopy('groupBuy.shareCta')}
        </button>
      )}
    </div>
  );
}
