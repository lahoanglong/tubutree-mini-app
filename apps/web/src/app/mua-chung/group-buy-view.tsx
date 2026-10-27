'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { joinGroupBuy, type GroupBuy } from '@tubutree/app-core/api/groupbuy';
import { groupMemberStatus, groupMissing, groupPriceLabels, groupRewardLine } from '@tubutree/app-core/group-buy-copy';
import { groupBuyListQuery, groupBuyOneQuery } from '@tubutree/app-core/queries/groupbuy';
import { EmptyState } from '@/components/empty-state';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress-bar';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { platformBridge } from '@/lib/platform-bridge';
import { loginHref } from '@/lib/return-to';
import { withReferral } from '@/lib/share-link';
import { PAGE_WIDE } from '@/lib/page-frame';
import { ProductThumb } from '@/components/mini';
import { loadErrorText } from '@/lib/error-text';

type Note = { text: string; error: boolean } | null;

const JUST_CREATED_PARAM = 'moi';
const errorText = loadErrorText;

function timeLeft(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  if (diff <= 0) return 'đã hết hạn';
  if (diff < 3600) return `còn ${Math.floor(diff / 60)} phút`;
  if (diff < 86400) return `còn ${Math.floor(diff / 3600)} giờ`;
  return `còn ${Math.floor(diff / 86400)} ngày`;
}

/**
 * Trang Mua chung: danh sách nhóm và nhóm được mời qua link `/mua-chung/:id`. Danh sách công khai nhưng mỗi nhóm mang `joined`/`isOwner`
 * theo người xem nên tải ở trình duyệt; API chi tiết cần đăng nhập nên khách chỉ xem danh sách chung, và chạm Tham gia thì sang đăng nhập.
 */
export function GroupBuyView({ invitedId }: { invitedId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const { user, retrySession } = useAuth();
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

  const listQ = useQuery(groupBuyListQuery(coreHttp));
  // Nhóm được mời có thể không nằm trong 30 nhóm mới nhất của danh sách chung.
  const invitedQ = useQuery({ ...groupBuyOneQuery(coreHttp, invitedId ?? ''), enabled: Boolean(invitedId) && authed, retry: false });
  const invited = invitedQ.data;
  const rest = (listQ.data ?? []).filter((g) => g.id !== invited?.id);
  const others = rest.filter((g) => g.status !== 'SUCCESS');
  const done = rest.filter((g) => g.status === 'SUCCESS');

  const joinM = useMutation({
    mutationFn: (id: string) => joinGroupBuy(coreHttp, id),
    onSuccess: (r) => {
      setNote({ text: r.status === 'SUCCESS' ? 'Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.' : 'Đã tham gia nhóm', error: false });
      void qc.invalidateQueries({ queryKey: ['group-buy'] });
    },
    onError: (e: unknown) => setNote({ text: errorText(e), error: true }),
  });

  const join = (id: string) => {
    if (authed) {
      setNote(null);
      joinM.mutate(id);
    } else if (phase === 'unavailable') void retrySession();
    else router.push(loginHref(invitedId ? `/mua-chung/${invitedId}` : '/mua-chung'));
  };

  const share = async (g: GroupBuy) => {
    setNote(null);
    const result = await platformBridge.share({
      title: `Mua chung ${g.product.name} giảm ${g.discountPct}%`,
      text: `Còn thiếu ${groupMissing(g)} người nữa là đủ nhóm, vào tham gia cùng mình nhé!`,
      path: withReferral(`/mua-chung/${encodeURIComponent(g.id)}`, user?.referralCode),
    });
    if (result === 'copied') setNote({ text: 'Đã sao chép liên kết nhóm.', error: false });
    else if (result === 'failed') setNote({ text: 'Không sao chép được. Bạn chép liên kết trên thanh địa chỉ nhé.', error: true });
  };

  const renderCard = (g: GroupBuy, invitedBanner = false) => (
    <GroupCard
      key={g.id}
      g={g}
      authed={authed}
      invitedBanner={invitedBanner}
      onJoin={() => join(g.id)}
      onShare={() => void share(g)}
      joining={joinM.isPending && joinM.variables === g.id}
    />
  );

  return (
    <main className={`${PAGE_WIDE} py-6`}>
      <PageHeader title="Mua chung giá tốt" subtitle="Rủ thêm bạn cho đủ nhóm — đủ người, ai cũng nhận mã giảm giá!" />

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
          <ErrorState message={errorText(listQ.error)} onRetry={() => void listQ.refetch()} />
        ) : invited || others.length > 0 || done.length > 0 ? (
          <div className="flex flex-col gap-6">
            {(invited || others.length > 0) && (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3">
                {invited && renderCard(invited, !invited.isOwner && !invited.joined)}
                {others.map((g) => renderCard(g))}
              </div>
            )}
            {done.length > 0 && (
              <section aria-label="Nhóm đã đủ người của bạn" className="flex flex-col gap-3">
                <h2 className={ui.sectionTitle}>Nhóm đã đủ người của bạn</h2>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3">{done.map((g) => renderCard(g))}</div>
              </section>
            )}
          </div>
        ) : (
          <>
            <EmptyState
              title="Chưa có nhóm mua chung nào"
              body="Mở nhóm từ trang sản phẩm để rủ bạn bè mua chung giá tốt!"
              actionHref="/san-pham"
              actionLabel="Khám phá sản phẩm"
            />
            {/* Máy tính: màn trống rộng, giải thích cách chạy để người xem biết bước tiếp theo. */}
            <ol aria-label="Cách mua chung" className="mx-auto mt-2 grid max-w-3xl gap-3 max-md:hidden md:grid-cols-3">
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

const GROUP_STEPS = [
  'Chọn sản phẩm có mua chung và mở nhóm từ trang sản phẩm.',
  'Gửi link cho bạn bè, đủ người trong hạn thì cả nhóm cùng được giá tốt.',
  'Đủ nhóm là nhận mã giảm giá, dùng ở giỏ hàng trong 30 ngày.',
];

function GroupCard({
  g,
  authed,
  invitedBanner,
  onJoin,
  onShare,
  joining,
}: {
  g: GroupBuy;
  authed: boolean;
  invitedBanner: boolean;
  onJoin: () => void;
  onShare: () => void;
  joining: boolean;
}) {
  const isOpen = g.status === 'OPEN';
  const member = authed && g.joined;
  const productHref = `/san-pham/${encodeURIComponent(g.product.slug)}`;
  const closedLabel = g.status === 'SUCCESS' ? 'Nhóm đã đủ người' : 'Nhóm đã hết hạn';
  const label = !isOpen ? closedLabel : !authed ? 'Đăng nhập để tham gia' : `Tham gia mua chung (−${g.discountPct}%)`;
  const prices = groupPriceLabels(g, formatVnd, useActiveFlashSales());
  const inOpenGroup = member && isOpen;

  return (
    <article className={`${ui.card} flex flex-col p-3 max-md:border-0 max-md:shadow-[var(--elevation-1)]`}>
      {invitedBanner && <p className="mb-1.5 text-xs font-semibold text-forest-700 max-md:text-[length:var(--type-caption-size)]">Bạn được mời vào nhóm này</p>}
      <div className="flex gap-3">
        <Link
          href={productHref}
          aria-label={g.product.name}
          className="inline-flex shrink-0 self-start"
        >
          <ProductThumb src={g.product.thumbnail} alt={g.product.name} size={56} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={productHref} className="block truncate text-sm font-semibold text-stone-900 hover:underline max-md:text-[length:var(--type-body-sm-size)]">
            {g.product.name}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-forest-700 max-md:text-[length:var(--type-body-sm-size)]">{prices.group}</span>
            <Badge tone="promo" size="sm">
              −{g.discountPct}%
            </Badge>
          </div>
          <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)]">{prices.solo}</p>
          <p className="text-xs text-stone-600 max-md:text-[length:var(--type-caption-size)]">
            {g.currentSize}/{g.targetSize} người · {g.status === 'SUCCESS' ? 'đã đủ nhóm' : timeLeft(g.expiresAt)}
          </p>
        </div>
      </div>
      <div className="mt-2">
        <ProgressBar value={g.currentSize} max={g.targetSize} />
      </div>
      {g.status !== 'SUCCESS' && (
        <p className="mt-1.5 text-xs text-stone-700 max-md:text-[length:var(--type-caption-size)]">{groupRewardLine(g, formatVnd)}</p>
      )}
      {g.status === 'SUCCESS' && member ? (
        <>
          {g.couponCode && (
            <p className="mt-1.5 text-xs text-stone-700 max-md:text-[length:var(--type-caption-size)]">
              Mã của bạn: <span className="font-bold text-forest-700">{g.couponCode}</span> · chọn trong “Chọn mã” ở giỏ hàng, dùng trong 30 ngày.
            </p>
          )}
          <Link href={productHref} className={`${ui.btnPrimary} mt-3 w-full`}>
            {`Mua ngay với mã giảm ${g.discountPct}%`}
          </Link>
        </>
      ) : inOpenGroup ? (
        <>
          <p className="mt-2 text-xs font-semibold text-stone-700 max-md:text-[length:var(--type-caption-size)]">{groupMemberStatus(g)}</p>
          <button type="button" onClick={onShare} className={`${ui.btnPrimary} mt-2 w-full gap-1.5`}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Mời bạn bè
          </button>
        </>
      ) : (
        <button type="button" disabled={!isOpen || member || joining} onClick={onJoin} className={`${ui.btnPrimary} mt-3 w-full`}>
          {label}
        </button>
      )}
    </article>
  );
}
