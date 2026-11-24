'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Play, Star, Video } from 'lucide-react';
import { reviewMediaItems } from '@tubutree/app-core/commerce/review-media';
import { canPdpQuickAdd, requestPdpQuickAdd } from '@/lib/pdp-quick-add';
import { trackPurchase } from '@/lib/analytics';
import { orderAgeDays } from '@/components/analytics/funnel';
import { REVIEW_NEEDS_PURCHASE, reviewOrderReturned } from '@tubutree/app-core/review-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { useHydrated } from '@/lib/use-hydrated';
import { apiMediaUrl } from '@/lib/client-api';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { Chip } from '@/components/mini/chip';
import { mini } from '@/components/order-mobile/mobile-ui';
import { formatRating } from '@tubutree/app-core/commerce/card-meta';
import { pickQuickReviews } from '@tubutree/app-core/commerce/pdp-view';
import {
  REVIEW_STEP,
  reviewFilterChips,
  reviewHasMore,
  reviewListKey,
  reviewListView,
  reviewMoreKey,
  reviewMorePrefix,
  reviewMoreStep,
  type ReviewFilterKey,
} from '@tubutree/app-core/commerce/review-filter';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import {
  ELIGIBILITY_FAILED,
  REVIEW_ORDER_PARAM,
  fetchCanReview,
  fetchProductReviews,
  greenCornerRules,
  hiddenNotice,
  pendingNotice,
  type MyReviewRef,
  type ReviewableOrder,
} from '@/lib/reviews-client';
import { ecoTagLine } from '@tubutree/app-core/commerce/green-corner';
import { usePublicConfig } from '@/lib/use-public-config';
import { pdpBand, pdpSectionTitle } from './pdp-sections';
import type { FormTarget } from './review-editor';
import { usePressLock } from '@/lib/use-press-lock';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';

// Form viết/sửa đánh giá (tải ảnh, tải video, thẻ Góc Sống Xanh) chỉ hiện khi khách bấm "Viết đánh giá"/"Sửa" hoặc mở từ chi tiết đơn:
// tách khỏi First Load của trang sản phẩm. Khung chờ nằm đúng chỗ form, giữ `aria-busy` để trình đọc màn hình biết form đang mở.
const ReviewEditor = dynamic(() => import('./review-editor').then((m) => m.ReviewEditor), {
  ssr: false,
  loading: () => <div aria-busy="true" className="mt-3 min-h-44" />,
});
// Khung xem ảnh/video toàn màn hình chỉ mở khi khách chạm một ảnh đánh giá: tách khỏi First Load. Nó được vẽ (đóng) ngay khi tóm tắt đánh giá
// hiện nên chunk tải lúc đó, trước lần chạm đầu; khung đang đóng không vẽ gì nên không cần khung giữ chỗ.
const ReviewMediaLightbox = dynamic(() => import('@/components/review-media-lightbox').then((m) => m.ReviewMediaLightbox), { ssr: false });
// Khối "không có đánh giá khớp bộ lọc" (minh hoạ của Mini App, ~7KB) chỉ hiện khi khách đã mở danh sách và lọc ra rỗng: nạp lười.
// Khung giữ chỗ cao bằng khối thật (đệm 16 + hình 96 + tiêu đề + 2 dòng mô tả) để trang không giật khi nó hiện.
const EmptyState = dynamic(() => import('@/components/mini/empty-state').then((m) => m.EmptyState), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-[206px]" />,
});

/** Chờ và lỗi của danh sách đánh giá: dùng chung cho danh sách đầy đủ và kết quả chip lọc. */
function ListLoading() {
  return (
    <p aria-busy="true" className="mt-3 text-sm text-stone-600">
      Đang tải đánh giá…
    </p>
  );
}

function ListFailed({ onRetry }: { onRetry: () => void | PromiseLike<unknown> }) {
  // Nút đang giữ focus nên không `disabled`; khoá chạm đúp là ref trong `usePressLock`, nhả khi lần tải lại xong.
  const { press, busy } = usePressLock(onRetry);
  return (
    <div role="alert" className="mt-3">
      <p className={ui.error}>Không tải được đánh giá.</p>
      <button
        type="button"
        className={`${ui.btnText} text-forest-700`}
        onClick={press}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
      >
        Thử lại
      </button>
    </div>
  );
}

/**
 * Tên đọc của dải sao. 'avg' (mặc định): điểm trung bình, đọc đúng số đang hiện ("4,4", "5,0") như PdpRating.
 * 'score': điểm một khách chấm, số nguyên 1..5 nên đọc "5" chứ không "5,0".
 */
const starsSpoken = (value: number, spoken: 'avg' | 'score'): string => (spoken === 'score' ? String(value) : formatRating(value) || String(value));

export function Stars({ value, small = false, spoken = 'avg' }: { value: number; small?: boolean; spoken?: 'avg' | 'score' }) {
  return (
    <span role="img" aria-label={`${starsSpoken(value, spoken)} trên 5 sao`} className="inline-flex whitespace-nowrap">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`${small ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${i <= Math.round(value) ? 'fill-honey-500 text-honey-500' : 'fill-[color:var(--stone-450)] text-[color:var(--stone-450)]'}`}
        />
      ))}
    </span>
  );
}

/**
 * Gỡ `?danh-gia=` khỏi URL sau khi đã dùng nó: còn giữ thì quay lại hay tải lại trang mở lại form (lúc đó đã thành form sửa
 * của đánh giá vừa gửi). Thay mục lịch sử hiện tại bằng history.replaceState (Next đồng bộ useSearchParams theo) chứ không
 * router.replace: đổi tham số qua router là một lần điều hướng của trang, có thể dựng lại khối này và đóng form vừa mở.
 */
function forgetOrderParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(REVIEW_ORDER_PARAM)) return;
  url.searchParams.delete(REVIEW_ORDER_PARAM);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Khung chờ khi trang được dựng sẵn (ISR): tham số mở form chỉ đọc được ở trình duyệt. Giữ id để link #danh-gia cuộn tới. */
export function ProductReviewsFallback() {
  return (
    <section id="danh-gia" data-section="pdp-reviews" data-pdp-block="reviews" aria-labelledby="danh-gia-title" className={`${pdpBand} scroll-mt-20 tabular-nums`}>
      <h2 id="danh-gia-title" className={pdpSectionTitle}>
        Đánh giá
      </h2>
      <p className="mt-2 text-sm text-stone-600">Đang tải đánh giá…</p>
    </section>
  );
}

/** Đường dẫn ảnh tương đối của API ghép địa chỉ máy chủ ảnh; địa chỉ đầy đủ (video) giữ nguyên. */
export const mediaSrc = (src: string) => (src.startsWith('/') ? apiMediaUrl(src) : src);

/**
 * Đánh giá trên trang sản phẩm web: tóm tắt điểm, hàng chip lọc, 2 đánh giá mở sẵn (ưu tiên có ảnh, `pickQuickReviews`) và "Xem thêm đánh giá" mở danh
 * sách công khai đầy đủ (mới nhất trước) như Mini App; bấm chip cũng mở danh sách theo chip đó. Form viết/sửa theo cùng luật với Mini App. Chưa có đánh giá thì chỉ một dòng. Nút "Viết đánh giá" chỉ có khi khách
 * đã đăng nhập và còn lần mua chưa đánh giá. `?danh-gia=<id đơn>` (từ chi tiết đơn) mở sẵn form cho đúng lần mua đó.
 */
export function ProductReviews({ slug }: { slug: string }) {
  const params = useSearchParams();
  const openForOrderId = params?.get(REVIEW_ORDER_PARAM) ?? undefined;
  const phase = useAuthPhase();
  const hydrated = useHydrated();
  const listQ = useQuery({ queryKey: reviewListKey(slug, 'all'), queryFn: () => fetchProductReviews(slug) });
  const eligQ = useQuery({
    queryKey: ['can-review', slug],
    queryFn: () => fetchCanReview(slug),
    enabled: phase === 'authenticated',
    retry: false,
  });
  // Nút Thử lại đang giữ focus nên không `disabled`; khoá chạm đúp là ref trong `usePressLock`, nhả khi lần hỏi lại xong.
  const retryElig = usePressLock(() => eligQ.refetch());
  const [target, setTarget] = useState<FormTarget | null>(null);
  const [visible, setVisible] = useState(REVIEW_STEP);
  const [filter, setFilter] = useState<ReviewFilterKey>('all');
  // Danh sách đầy đủ (các trang sau) chỉ mở khi khách bấm "Xem thêm đánh giá" hoặc một chip; trước đó chỉ có 2 đánh giá chọn sẵn.
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  // Chip lọc hỏi máy chủ: danh sách đầy đủ chỉ có 100 đánh giá mới nhất, lọc trên đó báo "không có đánh giá khớp" sai.
  const filteredQ = useQuery({ queryKey: reviewListKey(slug, filter), queryFn: () => fetchProductReviews(slug, filter), enabled: filter !== 'all' });
  // Trang sau trang đầu (mỗi trang 100 dòng) chỉ tải khi khách bấm "Xem thêm đánh giá" hết dòng đã tải; đổi chip thì bỏ hết.
  const [moreOn, setMoreOn] = useState(false);
  const firstNext = (filter === 'all' ? listQ.data : filteredQ.data)?.nextCursor ?? null;
  const moreQ = useInfiniteQuery({
    queryKey: reviewMoreKey(slug, filter, firstNext ?? ''),
    queryFn: ({ pageParam }) => fetchProductReviews(slug, filter, pageParam),
    initialPageParam: firstNext ?? '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: moreOn && firstNext !== null,
    // Trang đầu tải lại mà đổi dòng cuối (vừa có đánh giá mới) thì khoá đổi: giữ các trang đang hiện của cùng chip tới khi bản mới về.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[3] === filter ? prev : undefined),
  });
  const [notice, setNotice] = useState<string | null>(null);
  // Đánh giá đang xem ảnh/video toàn màn hình và vị trí tệp.
  const [lightbox, setLightbox] = useState<{ id: string; index: number } | null>(null);

  const elig = phase === 'authenticated' ? eligQ.data : undefined;
  const myReviews = elig?.myReviews ?? [];
  const mineById = new Map(myReviews.map((r) => [r.id, r]));
  const latestMine = myReviews[0];
  // Đang chờ duyệt ảnh (Góc Sống Xanh) cũng chưa hiện nhưng không phải bị ẩn: câu báo khác, và bỏ hết ảnh thì đánh giá hiện ngay.
  const isHidden = (r: MyReviewRef | undefined) => r?.isVisible === false && r.awaitingApproval !== true;
  const hiddenMine = myReviews.filter(isHidden);
  const pendingMine = myReviews.filter((r) => r.awaitingApproval === true);
  const rules = greenCornerRules(usePublicConfig().reviewGreenCorner);
  const nextOrder = elig?.canReview ? elig.reviewableOrders?.[0] : undefined;

  const openForm = (t: FormTarget) => {
    setNotice(null);
    setTarget(t);
  };
  const newTarget = (o: ReviewableOrder): FormTarget => ({ kind: 'new', orderId: o.orderId, orderCode: o.code, deliveredAt: o.deliveredAt });
  const editTarget = (r: MyReviewRef): FormTarget => ({ kind: 'edit', reviewId: r.id, orderId: r.orderId, orderCode: r.orderCode });
  const openEdit = (r: MyReviewRef) => openForm(editTarget(r));

  // `review_started` mỗi lần mở form viết đánh giá mới (nút hay liên kết từ chi tiết đơn); sửa đánh giá cũ không tính.
  const startedTarget = useRef<FormTarget | null>(null);
  useEffect(() => {
    if (target?.kind !== 'new' || startedTarget.current === target) return;
    startedTarget.current = target;
    const age = orderAgeDays(target.deliveredAt);
    if (age !== null) trackPurchase('review_started', { orderAgeDays: age });
  }, [target]);

  const deepLinked = useRef(false);
  useEffect(() => {
    if (!openForOrderId || !elig || deepLinked.current) return;
    deepLinked.current = true;
    const order = elig.reviewableOrders?.find((o) => o.orderId === openForOrderId);
    const mine = elig.myReviews?.find((r) => r.orderId === openForOrderId);
    if (order) setTarget(newTarget(order));
    else if (mine) setTarget(editTarget(mine));
    forgetOrderParam();
  }, [openForOrderId, elig]);

  // Cache có thể đã đầy (dải "Đánh giá nhanh" dùng chung khoá) trước khi khối Suspense này hydrate; vẽ ngay sẽ lệch HTML máy chủ.
  const data = hydrated ? listQ.data : undefined;
  const listLoading = listQ.isLoading || (!hydrated && !listQ.isError);
  const dist = data?.distribution ?? {};
  const list = reviewListView(
    filter,
    listQ,
    filteredQ,
    moreOn ? { pages: moreQ.data?.pages, isFetching: moreQ.isFetching, isError: moreQ.isError } : undefined,
  );
  const items = list.items;
  const picked = data ? pickQuickReviews(data.items ?? []) : [];
  const lbReview = lightbox ? (items.find((x) => x.id === lightbox.id) ?? picked.find((x) => x.id === lightbox.id)) : undefined;
  const lbMedia = lbReview ? reviewMediaItems(lbReview) : [];
  const chips = reviewFilterChips(data, filter);
  const moreLoading = list.more === 'loading';
  const showMore = () => {
    if (moreLoading) return;
    const step = reviewMoreStep(visible, items.length, list.hasMore);
    setVisible(step.visible);
    if (step.fetch) setMoreOn(true);
  };
  // Dòng đã tải chưa đủ số dòng cần hiện (vừa bấm, hoặc bộ trang sau vừa tải lại từ trang đầu mới): tải tiếp trang kế.
  const wantMore = moreOn && list.status === 'ready' && list.hasMore && visible >= items.length;
  const { fetchNextPage } = moreQ;
  const moreSettled = !!moreQ.data && !moreQ.isPlaceholderData && !moreQ.isFetching && !moreQ.isError;
  useEffect(() => {
    if (wantMore && moreSettled) void fetchNextPage();
  }, [wantMore, moreSettled, fetchNextPage]);
  const retryMore = () => (moreQ.isFetchNextPageError ? moreQ.fetchNextPage() : moreQ.refetch());
  // Chưa biết (đang tải, lỗi) thì null: câu "cần mua để đánh giá" chỉ bỏ khi chắc chắn chưa có đánh giá nào (khối chỉ còn một dòng).
  const empty = data ? data.count === 0 : null;
  // Nút "Xem thêm đánh giá" của phần thu gọn biến mất khi mở danh sách: đưa tiêu điểm tới hàng chip để bàn phím và trình đọc màn hình không rơi về
  // đầu trang. Mở bằng chip thì tiêu điểm vẫn ở chip vừa bấm.
  const listTop = useRef<HTMLDivElement>(null);
  const focusChips = useRef(false);
  const openList = () => {
    focusChips.current = true;
    setExpanded(true);
  };
  useEffect(() => {
    if (!expanded || !focusChips.current) return;
    focusChips.current = false;
    listTop.current?.focus({ preventScroll: true });
  }, [expanded]);
  const reviewItem = (r: (typeof items)[number]) => {
    const mine = mineById.get(r.id);
    return (
      <li key={r.id} className="border-t border-stone-200 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-forest-50 text-sm font-semibold text-forest-800"
          >
            {r.author.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-stone-900">{r.author}</span>
              {r.verifiedPurchase && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-fg">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  Đã mua
                </span>
              )}
              {mine && (
                <span className="rounded-full bg-forest-50 px-2 py-0.5 text-xs font-medium text-forest-800">Của bạn</span>
              )}
            </div>
            <Stars value={r.rating} small spoken="score" />
          </div>
          <span className="flex-none text-xs text-stone-600">{formatDate(r.createdAt)}</span>
        </div>
        {mine && (
          <div className="mt-1 flex items-center justify-between gap-2">
            {mine.orderCode && <span className="text-xs text-stone-600">Đơn {mine.orderCode}</span>}
            <button
              type="button"
              className={`${ui.btnText} ml-auto text-forest-700`}
              aria-label={mine.orderCode ? `Sửa đánh giá đơn ${mine.orderCode}` : 'Sửa đánh giá này'}
              // Form đang mở thì đổi `target` sẽ dựng lại form (đổi key) và bỏ mất ảnh đang xử lý; nút đầu trang cũng chỉ hiện khi chưa có form. Không `disabled` để nút giữ focus.
              aria-disabled={target ? true : undefined}
              onClick={() => !target && openEdit(mine)}
            >
              Sửa
            </button>
          </div>
        )}
        {r.comment && <p className="mt-2 whitespace-pre-line break-words text-sm text-stone-700">{r.comment}</p>}
        {ecoTagLine(r.ecoTags) && <p className="mt-1 text-xs font-medium text-[var(--color-text-brand)]">{ecoTagLine(r.ecoTags)}</p>}
        {(r.images.length > 0 || r.videoUrl) && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {reviewMediaItems(r).map((m, i) =>
              m.kind === 'image' ? (
                <button
                  key={m.src}
                  type="button"
                  aria-label={fillCopy('review.mediaOpenImage', { n: i + 1 })}
                  aria-haspopup="dialog"
                  onClick={() => setLightbox({ id: r.id, index: i })}
                  className="tubu-press block h-16 min-h-11 w-16 min-w-11 flex-none overflow-hidden rounded-control"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaSrc(m.src)} alt="" loading="lazy" className="block h-full w-full object-cover" onError={hideBrokenImage} />
                </button>
              ) : (
                <button
                  key={m.src}
                  type="button"
                  aria-label={fillCopy('review.mediaOpenVideo')}
                  aria-haspopup="dialog"
                  onClick={() => setLightbox({ id: r.id, index: i })}
                  className="tubu-press flex h-16 min-h-11 w-16 min-w-11 flex-none items-center justify-center rounded-control bg-stone-900 text-[var(--color-text-inverse)]"
                >
                  <Play className="h-6 w-6" aria-hidden="true" />
                </button>
              ),
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section id="danh-gia" data-section="pdp-reviews" data-pdp-block="reviews" aria-labelledby="danh-gia-title" className={`${pdpBand} scroll-mt-20 tabular-nums`}>
      <div className="flex flex-wrap items-center justify-between gap-2 max-md:min-h-12">
        <h2 id="danh-gia-title" className={pdpSectionTitle}>
          Đánh giá{data && data.count > 0 ? ` (${data.count})` : ''}
        </h2>
        {elig && !target && (
          <>
            {nextOrder ? (
              <button type="button" data-testid="review-write" className={`${ui.btnSecondary} ${mini.ghost}`} onClick={() => openForm(newTarget(nextOrder))}>
                {fillCopy('pdp.reviewWrite')}
              </button>
            ) : elig.reason === 'ALL_REVIEWED' && latestMine ? (
              <button type="button" className={`${ui.btnSecondary} ${mini.ghost}`} onClick={() => openEdit(latestMine)}>
                Sửa đánh giá của bạn
              </button>
            ) : elig.reason === 'NOT_PURCHASED' && empty === false ? (
              <span className="text-sm text-stone-600">{REVIEW_NEEDS_PURCHASE}</span>
            ) : null}
          </>
        )}
      </div>

      {phase === 'authenticated' && eligQ.isError && !eligQ.data && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-3">
          <p className={ui.error}>{ELIGIBILITY_FAILED}</p>
          <button
            type="button"
            className={`${ui.btnText} text-forest-700`}
            onClick={retryElig.press}
            aria-busy={retryElig.busy || undefined}
            aria-disabled={retryElig.busy || undefined}
          >
            Thử lại
          </button>
        </div>
      )}

      {hiddenMine.map((r) => (
        <p key={r.id} role="status" className="mt-2 rounded-control bg-warning-bg px-3 py-2 text-sm text-warning-fg">
          {hiddenNotice(r.orderCode)}
        </p>
      ))}
      {pendingMine.map((r) => (
        <p key={r.id} role="status" className="mt-2 rounded-control bg-info-bg px-3 py-2 text-sm text-info-fg">
          {pendingNotice(r.orderCode)}
        </p>
      ))}

      {notice && (
        <p role="status" className="mt-2 rounded-control bg-success-bg px-3 py-2 text-sm font-medium text-success-fg">
          {notice}
        </p>
      )}

      {target && (
        <ReviewEditor
          key={target.kind === 'edit' ? `edit:${target.reviewId}` : 'new'}
          slug={slug}
          target={target}
          purchaseCount={elig?.purchaseCount ?? 0}
          rewardAvailable={elig?.rewardAvailable !== false}
          rewardReturned={target.kind === 'new' && reviewOrderReturned(elig, target.orderId)}
          rules={rules}
          hidden={target.kind === 'edit' && isHidden(mineById.get(target.reviewId))}
          onCancel={() => setTarget(null)}
          onSaved={(message) => {
            setTarget(null);
            setNotice(message);
          }}
        />
      )}

      {listLoading ? (
        <ListLoading />
      ) : listQ.isError && !data ? (
        <ListFailed onRetry={() => listQ.refetch()} />
      ) : !data || data.count === 0 ? (
        <p data-testid="pdp-reviews-empty" className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {fillCopy('pdp.reviewsEmpty')}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <div className="text-center">
              <div className="font-display text-4xl font-semibold text-stone-900">{formatRating(data.average)}</div>
              <Stars value={data.average} />
              <div className="text-xs text-stone-600">{data.count} đánh giá</div>
            </div>
            <ul aria-label="Phân bổ số sao" className="min-w-[12rem] flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = dist[String(star)] ?? 0;
                const pct = data.count > 0 ? Math.round((n / data.count) * 100) : 0;
                return (
                  <li key={star} className="flex items-center gap-2 text-xs text-stone-600">
                    <span className="w-3 text-right">{star}</span>
                    <Star aria-hidden="true" className="h-3 w-3 flex-none fill-honey-500 text-honey-500" />
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                      <span className="block h-full bg-honey-500" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-6 text-right">{n}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Hàng chip lọc như Mini App, có cả lúc thu gọn: đổi bộ lọc thì mở danh sách đầy đủ ở 5 dòng đầu của chip đó. */}
          {/* Hàng dưới cách hàng trên 12px (gap-y-3): chip nhìn cao ~33px, vùng chạm 44px giãn ~5,5px mỗi phía; khoảng 8px làm vùng chạm hai hàng chồng nhau. */}
          <div ref={listTop} tabIndex={-1} aria-label="Lọc đánh giá" role="group" className="mt-3 flex flex-wrap gap-x-2 gap-y-3 outline-none">
            {chips.map((f) => (
              <Chip
                key={String(f.key)}
                size="sm"
                selected={filter === f.key}
                icon={f.key === 'video' ? Video : undefined}
                count={f.count}
                onPress={() => {
                  setExpanded(true);
                  setFilter(f.key);
                  setVisible(REVIEW_STEP);
                  setMoreOn(false);
                  qc.removeQueries({ queryKey: reviewMorePrefix(slug) });
                }}
              >
                {f.label}
              </Chip>
            ))}
          </div>

          {!expanded ? (
            <>
              {picked.length > 0 && (
                <ul data-testid="review-picked" className="mt-3">
                  {picked.map(reviewItem)}
                </ul>
              )}
              {data.count > picked.length && (
                <button type="button" data-testid="reviews-more" className={`${ui.btnSecondary} ${mini.ghost} w-full`} onClick={openList}>
                  {fillCopy('pdp.reviewsMore')}
                </button>
              )}
            </>
          ) : (
            <>
              {list.status === 'loading' ? (
                <ListLoading />
              ) : list.status === 'error' ? (
                <ListFailed onRetry={() => filteredQ.refetch()} />
              ) : (
                <>
                  <ul className="mt-3">{items.slice(0, visible).map(reviewItem)}</ul>
                  {items.length === 0 && <EmptyState variant="inline" art="search" heading="Không có đánh giá khớp bộ lọc." />}
                  {list.more === 'error' && visible >= items.length ? (
                    <ListFailed onRetry={retryMore} />
                  ) : (
                    reviewHasMore(visible, list) && (
                      <button
                        type="button"
                        className={`${ui.btnSecondary} ${mini.ghost} w-full`}
                        aria-busy={moreLoading || undefined}
                        aria-disabled={moreLoading || undefined}
                        onClick={showMore}
                      >
                        {moreLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {fillCopy('pdp.reviewsMore')}
                      </button>
                    )
                  )}
                </>
              )}
            </>
          )}
          <ReviewMediaLightbox
            open={lbReview !== undefined && lbMedia.length > 0}
            onClose={() => setLightbox(null)}
            items={lbMedia}
            index={lightbox?.index ?? 0}
            onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
            author={lbReview?.author ?? ''}
            rating={lbReview?.rating ?? 0}
            verifiedPurchase={lbReview?.verifiedPurchase}
            comment={lbReview?.comment}
            resolveSrc={mediaSrc}
            onAdd={
              canPdpQuickAdd()
                ? () => {
                    setLightbox(null);
                    requestPdpQuickAdd();
                  }
                : undefined
            }
          />
        </>
      )}
    </section>
  );
}
