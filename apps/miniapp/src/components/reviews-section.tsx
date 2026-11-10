import { useEffect, useId, useRef, useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Play, Star, Video } from 'lucide-react';
import { reviewMediaItems } from '@tubutree/app-core/commerce/review-media';
import { ReviewMediaLightbox } from './review-media-lightbox';
import {
  fetchReviews,
  createReview,
  canReviewProduct,
  fetchMyReview,
  type MyReview,
  type MyReviewRef,
  type ReviewableOrder,
} from '../services/shop-api';
import { apiMediaUrl, getErrorMessage, getLoadErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { useLoginWithNotice } from './ui/auth-gate';
import { formatRating } from '@tubutree/app-core/commerce/card-meta';
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
import { ratingFromKey, reviewFormIssue, type ReviewFormField } from '@tubutree/app-core/commerce/review-form';
import { isImeEnter, isSubmitShortcut } from '@tubutree/app-core/keyboard';
import { REVIEW_NEEDS_PURCHASE, REWARD_ALREADY_GIVEN, VIDEO_UPLOADING, rewardHint } from '@tubutree/app-core/review-copy';
import { MultiImageUpload, VideoUpload, isCloudinaryConfigured } from './image-upload';
import { formatDate, formatNumber } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Badge } from './ui/badge';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import { InitialsAvatar } from './ui/initials-avatar';
import { EmptyState, ErrorState } from './ui/empty-state';
import { SectionTitle } from './ui/section-title';
import { Skeleton } from './ui/skeleton';
import { Heading, Text } from './ui/text';
import { INPUT_LIMITS } from '../utils/input-limits';


/**
 * Tên đọc của dải sao. 'avg' (mặc định): điểm trung bình, đọc đúng số đang hiện ("4,4", "5,0") như PdpRating.
 * 'score': điểm một khách chấm, số nguyên 1..5 nên đọc "5" chứ không "5,0".
 */
const starsSpoken = (value: number, spoken: 'avg' | 'score'): string => (spoken === 'score' ? String(value) : formatRating(value) || String(value));

/** Dải sao tĩnh (hiển thị) — size tùy chỉnh. */
export function Stars({ value, size = 14, spoken = 'avg' }: { value: number; size?: number; spoken?: 'avg' | 'score' }) {
  return (
    <span role="img" aria-label={`${starsSpoken(value, spoken)} trên 5 sao`} style={{ display: 'inline-flex', whiteSpace: 'nowrap', lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          strokeWidth={1.75}
          aria-hidden
          style={{ color: i <= Math.round(value) ? 'var(--color-rating)' : 'var(--stone-450)', fill: 'currentColor' }}
        />
      ))}
    </span>
  );
}

interface ReviewDraft {
  rating: number;
  comment: string;
  images: string[];
  video: string;
}

const EMPTY_DRAFT: ReviewDraft = { rating: 5, comment: '', images: [], video: '' };

/** Khung chờ của danh sách đánh giá: dùng chung cho danh sách đầy đủ và kết quả chip lọc. */
function ListSkeleton() {
  return (
    <div aria-busy="true" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Skeleton width="100%" height={64} />
      <Skeleton width="100%" height={64} />
    </div>
  );
}

const draftFromReview = (r: MyReview): ReviewDraft => ({
  rating: r.rating,
  comment: r.comment ?? '',
  images: r.images,
  video: r.videoUrl ?? '',
});

/**
 * Đánh giá đang soạn, luôn gắn một lần mua (đơn): viết mới cho đơn còn viết được chốt lúc mở form, sửa gắn đúng dòng đánh
 * giá của đơn đó. Form chỉ mở sau khi can-review về nên không bao giờ gửi đánh giá mới thiếu đơn: máy chủ hiểu lần gửi
 * không kèm đơn (bản app cũ) là sửa đánh giá mới nhất khi mọi lần mua đã có đánh giá.
 */
type FormTarget =
  | { kind: 'new'; orderId: string; orderCode: string | null }
  | { kind: 'edit'; reviewId: string; orderId: string; orderCode: string | null };

// Nháp viết mới dùng chung cho mọi đơn: nội dung là cảm nhận về sản phẩm.
const targetKey = (t: FormTarget) => (t.kind === 'new' ? 'new' : `edit:${t.reviewId}`);

/**
 * `openForOrderId`: đơn khách bấm "Viết đánh giá"/"Sửa đánh giá" ở chi tiết đơn — mở sẵn form cho đúng lần mua đó khi
 * can-review về (đơn còn viết được thì viết mới, đơn đã có đánh giá thì sửa đánh giá đó). `onOrderLinkUsed` được gọi một
 * lần ngay khi đã dùng đơn đó, để trang gỡ nó khỏi trạng thái điều hướng: quay lại hay tải lại trang không tự mở lại form
 * (lúc đó đã thành form sửa của đánh giá vừa gửi).
 */
export function ReviewsSection({
  slug,
  openForOrderId,
  onOrderLinkUsed,
  onQuickAdd,
}: {
  slug: string;
  openForOrderId?: string;
  onOrderLinkUsed?: () => void;
  /** Có thì lightbox ảnh đánh giá hiện nút "Thêm vào giỏ": đóng lightbox rồi chạy luồng thêm giỏ của trang. */
  onQuickAdd?: () => void;
}) {
  const { status } = useAuthStore();
  const login = useLoginWithNotice();
  // Đánh giá đang xem ảnh/video toàn màn hình và vị trí tệp.
  const [lightbox, setLightbox] = useState<{ id: string; index: number } | null>(null);
  const [writing, setWriting] = useState(false);
  // Đang gửi thì không đóng được form: đóng giữa chừng gỡ WriteReview (mất khoá chống gửi đôi và chỗ hiện lỗi), mở lại là gửi được lần hai.
  const [submitting, setSubmitting] = useState(false);
  const [target, setTarget] = useState<FormTarget | null>(null);
  // BottomSheet gỡ nội dung khỏi DOM khi đóng; nháp nằm ở đây để chạm nhầm lên mask/vuốt xuống
  // không làm mất sao, nhận xét và ảnh/video đã upload (P1-2). Nháp gắn với đúng đánh giá đang soạn: mở đánh giá khác
  // thì form lấy nội dung của đánh giá đó. null = chưa gõ gì: form lấy đánh giá hiện có (sửa) hoặc form trống (viết mới).
  const [edited, setEdited] = useState<{ key: string; draft: ReviewDraft } | null>(null);
  const [filter, setFilter] = useState<ReviewFilterKey>('all');
  const [visible, setVisible] = useState(REVIEW_STEP);
  const qc = useQueryClient();
  const reviewsQ = useQuery({ queryKey: reviewListKey(slug, 'all'), queryFn: () => fetchReviews(slug) });
  // Chip lọc hỏi máy chủ: danh sách đầy đủ chỉ có 100 đánh giá mới nhất, lọc trên đó báo "không có đánh giá khớp" sai.
  const filteredQ = useQuery({ queryKey: reviewListKey(slug, filter), queryFn: () => fetchReviews(slug, filter), enabled: filter !== 'all' });
  // Trang sau trang đầu (mỗi trang 100 dòng) chỉ tải khi khách bấm "Xem thêm đánh giá" hết dòng đã tải; đổi chip thì bỏ hết.
  const [moreOn, setMoreOn] = useState(false);
  const firstNext = (filter === 'all' ? reviewsQ.data : filteredQ.data)?.nextCursor ?? null;
  const moreQ = useInfiniteQuery({
    queryKey: reviewMoreKey(slug, filter, firstNext ?? ''),
    queryFn: ({ pageParam }) => fetchReviews(slug, filter, pageParam),
    initialPageParam: firstNext ?? '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: moreOn && firstNext !== null,
    // Trang đầu tải lại mà đổi dòng cuối (vừa có đánh giá mới) thì khoá đổi: giữ các trang đang hiện của cùng chip tới khi bản mới về.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[3] === filter ? prev : undefined),
  });
  // Chỉ hỏi khi đã đăng nhập; chưa đăng nhập thì vẫn hiện nút để còn mời login.
  const eligQ = useQuery({
    queryKey: ['can-review', slug],
    queryFn: () => canReviewProduct(slug),
    enabled: status === 'authenticated',
    retry: false,
  });
  const editingId = target?.kind === 'edit' ? target.reviewId : null;
  // Danh sách công khai trả ảnh base64 dạng đường dẫn; sửa phải gửi lại đúng ảnh cũ nên đọc nguyên đánh giá của mình.
  const myReviewQ = useQuery({
    queryKey: ['my-review', editingId],
    queryFn: () => fetchMyReview(editingId!),
    enabled: writing && editingId !== null,
    retry: false,
  });

  const elig = eligQ.data;
  const myReviews = elig?.myReviews ?? [];
  const mineById = new Map(myReviews.map((r) => [r.id, r]));
  const nextOrder = elig?.canReview ? elig.reviewableOrders?.[0] : undefined;

  const openForm = (t: FormTarget) => {
    setTarget(t);
    setWriting(true);
  };
  const openNew = (o: ReviewableOrder) => openForm({ kind: 'new', orderId: o.orderId, orderCode: o.code });
  const openEdit = (r: MyReviewRef) => openForm({ kind: 'edit', reviewId: r.id, orderId: r.orderId, orderCode: r.orderCode });

  const deepLinked = useRef(false);
  useEffect(() => {
    if (!openForOrderId || !elig || deepLinked.current) return;
    deepLinked.current = true;
    const order = elig.reviewableOrders?.find((o) => o.orderId === openForOrderId);
    const mine = elig.myReviews?.find((r) => r.orderId === openForOrderId);
    if (order) openNew(order);
    else if (mine) openEdit(mine);
    onOrderLinkUsed?.();
  }, [openForOrderId, elig]);

  const key = target ? targetKey(target) : '';
  const base = editingId && myReviewQ.data ? draftFromReview(myReviewQ.data) : EMPTY_DRAFT;
  const draft = edited && edited.key === key ? edited.draft : base;
  const latestMine = myReviews[0];
  // Đánh giá bị admin ẩn không nằm trong danh sách công khai: khách chỉ biết qua đây. isVisible thiếu (API cũ) coi là đang hiện.
  const hiddenMine = myReviews.filter((r) => r.isVisible === false);
  const hiddenIds = new Set(hiddenMine.map((r) => r.id));
  // Đã đăng nhập thì chỉ có nút khi can-review đã về (như web): chưa biết còn đơn nào để viết thì chưa mở được form.
  const headerAction =
    status !== 'authenticated'
      ? { label: 'Viết đánh giá', onPress: () => void login() }
      : nextOrder
        ? { label: 'Viết đánh giá', onPress: () => openNew(nextOrder) }
        : elig?.reason === 'ALL_REVIEWED' && latestMine
          ? { label: 'Sửa đánh giá của bạn', onPress: () => openEdit(latestMine) }
          : null;
  const data = reviewsQ.data;
  const dist = data?.distribution ?? {};
  const list = reviewListView(
    filter,
    reviewsQ,
    filteredQ,
    moreOn ? { pages: moreQ.data?.pages, isFetching: moreQ.isFetching, isError: moreQ.isError } : undefined,
  );
  const filtered = list.items;
  const lbReview = lightbox ? filtered.find((x) => x.id === lightbox.id) : undefined;
  const lbMedia = lbReview ? reviewMediaItems(lbReview) : [];
  const chips = reviewFilterChips(data, filter);
  const showMore = () => {
    const step = reviewMoreStep(visible, filtered.length, list.hasMore);
    setVisible(step.visible);
    if (step.fetch) setMoreOn(true);
  };
  // Dòng đã tải chưa đủ số dòng cần hiện (vừa bấm, hoặc bộ trang sau vừa tải lại từ trang đầu mới): tải tiếp trang kế.
  const wantMore = moreOn && list.status === 'ready' && list.hasMore && visible >= filtered.length;
  const { fetchNextPage } = moreQ;
  const moreSettled = !!moreQ.data && !moreQ.isPlaceholderData && !moreQ.isFetching && !moreQ.isError;
  useEffect(() => {
    if (wantMore && moreSettled) void fetchNextPage();
  }, [wantMore, moreSettled, fetchNextPage]);
  const retryMore = () => (moreQ.isFetchNextPageError ? moreQ.fetchNextPage() : moreQ.refetch());

  return (
    <section id="danh-gia" aria-label="Đánh giá sản phẩm" className="tubu-nums" style={{ padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}>
      {/* Cao bằng nút đầu mục (48px): nút chỉ hiện khi can-review đã về, hàng không được nhảy lúc đó. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 48 }}>
        <SectionTitle block>Đánh giá {data && data.count > 0 ? `(${data.count})` : ''}</SectionTitle>
        {/* Chỉ mở ô soạn khi BE xác nhận đủ điều kiện. Trước đây mở cho mọi user đăng nhập,
            khách chưa mua chọn sao + upload ảnh/video xong mới nhận lỗi "chỉ đánh giá sản phẩm
            đã mua" — mất trắng công sức (P1-2). Mọi lần mua đã có đánh giá thì nút là sửa đánh giá mới nhất. */}
        {headerAction && (
          <Button
            variant="ghost"
            onPress={() => {
              haptic('light');
              headerAction.onPress();
            }}
          >
            {headerAction.label}
          </Button>
        )}
        {status === 'authenticated' && elig?.reason === 'NOT_PURCHASED' && (
          <Text variant="caption" tone="tertiary">
            {REVIEW_NEEDS_PURCHASE}
          </Text>
        )}
      </div>

      {status === 'authenticated' && eligQ.isError && !eligQ.data && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="caption" tone="danger">
            {vi.reviews.eligibilityFailed}
          </Text>
          <Button variant="ghost" loading={eligQ.isFetching} onPress={() => void eligQ.refetch()}>
            {vi.common.retry}
          </Button>
        </div>
      )}
      {status === 'authenticated' &&
        hiddenMine.map((r) => (
          <div key={r.id} role="status" style={{ marginTop: 4 }}>
            <Text variant="caption" tone="warning" as="p">
              {vi.reviews.hiddenNotice(r.orderCode)}
            </Text>
          </div>
        ))}

      {reviewsQ.isLoading ? (
        <ListSkeleton />
      ) : reviewsQ.isError ? (
        <ErrorState message={getLoadErrorMessage(reviewsQ.error)} onRetry={() => reviewsQ.refetch()} />
      ) : data && data.count > 0 ? (
        <>
          {/* Trung bình + breakdown sao 5→1 */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'center' }}>
            <div style={{ textAlign: 'center', flex: '0 0 auto' }}>
              <Heading variant="display-lg" as="div">
                {formatRating(data.average)}
              </Heading>
              <Stars value={data.average} size={13} />
              <Text variant="caption" tone="tertiary" as="div">
                {data.count} đánh giá
              </Text>
            </div>
            <div style={{ flex: 1 }}>
              {[5, 4, 3, 2, 1].map((star) => {
                const n = dist[String(star)] ?? 0;
                const pct = data.count > 0 ? Math.round((n / data.count) * 100) : 0;
                return (
                  <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Text variant="caption" tone="tertiary" style={{ width: 10 }}>
                      {star}
                    </Text>
                    <Star size={10} strokeWidth={1.75} aria-hidden style={{ color: 'var(--color-rating)', fill: 'currentColor', flex: '0 0 auto' }} />
                    <div style={{ flex: 1, height: 6, background: 'var(--stone-100)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-rating)' }} />
                    </div>
                    <Text variant="caption" tone="tertiary" style={{ width: 18, textAlign: 'right' }}>
                      {n}
                    </Text>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Filter chips */}
          {/* Hàng dưới cách hàng trên 12px: chip nhìn cao ~33px, vùng chạm 44px giãn ~5,5px mỗi phía; cách dưới 11px thì vùng chạm hai hàng chồng nhau. */}
          <div style={{ display: 'flex', gap: 'var(--space-inset-card) var(--space-inline-sm)', marginTop: 12, flexWrap: 'wrap' }}>
            {chips.map((f) => (
              <Chip
                key={String(f.key)}
                size="sm"
                selected={filter === f.key}
                icon={f.key === 'video' ? Video : undefined}
                count={f.count}
                onPress={() => {
                  haptic('light');
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

          {list.status === 'loading' ? (
            <ListSkeleton />
          ) : list.status === 'error' ? (
            <ErrorState message={getLoadErrorMessage(filteredQ.error)} onRetry={() => filteredQ.refetch()} />
          ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {filtered.slice(0, visible).map((r) => {
              const mine = mineById.get(r.id);
              return (
              <div key={r.id} style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <InitialsAvatar name={r.author} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text variant="label">{r.author}</Text>
                      {r.verifiedPurchase && (
                        <Badge tone="success" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <Check size={11} strokeWidth={2.25} aria-hidden />
                          Đã mua
                        </Badge>
                      )}
                      {mine && (
                        <Badge tone="brand" size="sm">
                          Của bạn
                        </Badge>
                      )}
                    </div>
                    <Stars value={r.rating} size={11} spoken="score" />
                  </div>
                  <Text variant="caption" tone="tertiary">
                    {formatDate(r.createdAt)}
                  </Text>
                </div>
                {mine && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    {mine.orderCode && (
                      <Text variant="caption" tone="tertiary">
                        Đơn {mine.orderCode}
                      </Text>
                    )}
                    <Button
                      variant="ghost"
                      aria-label={mine.orderCode ? `Sửa đánh giá đơn ${mine.orderCode}` : 'Sửa đánh giá này'}
                      onPress={() => {
                        haptic('light');
                        openEdit(mine);
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      Sửa
                    </Button>
                  </div>
                )}
                {r.comment && (
                  <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 6 }}>
                    {r.comment}
                  </Text>
                )}
                {(r.images.length > 0 || r.videoUrl) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto' }}>
                    {reviewMediaItems(r).map((m, i) => (
                      <button
                        key={m.src}
                        type="button"
                        className="tubu-press"
                        aria-label={m.kind === 'image' ? fillCopy('review.mediaOpenImage', { n: i + 1 }) : fillCopy('review.mediaOpenVideo')}
                        aria-haspopup="dialog"
                        onClick={() => {
                          haptic('light');
                          setLightbox({ id: r.id, index: i });
                        }}
                        style={{ width: 64, height: 64, minWidth: 44, minHeight: 44, flex: '0 0 auto', padding: 0, border: 'none', overflow: 'hidden', borderRadius: 'var(--radius-media)', cursor: 'pointer', background: m.kind === 'video' ? 'var(--color-bg-inverse)' : 'transparent', color: 'var(--color-text-inverse)', display: 'grid', placeItems: 'center' }}
                      >
                        {m.kind === 'image' ? (
                          <img src={apiMediaUrl(m.src)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <Play size={24} aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
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
              resolveSrc={apiMediaUrl}
              onAdd={
                onQuickAdd
                  ? () => {
                      setLightbox(null);
                      onQuickAdd();
                    }
                  : undefined
              }
            />
            {filtered.length === 0 && <EmptyState variant="inline" art="search" heading="Không có đánh giá khớp bộ lọc." />}
            {list.more === 'error' && visible >= filtered.length ? (
              <ErrorState message={getLoadErrorMessage(moreQ.error)} onRetry={retryMore} />
            ) : (
              reviewHasMore(visible, list) && (
                <Button variant="ghost" fullWidth loading={list.more === 'loading'} onPress={showMore}>
                  {fillCopy('pdp.reviewsMore')}
                </Button>
              )
            )}
          </div>
          )}
        </>
      ) : (
        <EmptyState variant="inline" art="sprout" heading="Chưa có đánh giá" body="Hãy là người đầu tiên chia sẻ trải nghiệm." />
      )}

      <BottomSheet open={writing} onClose={() => setWriting(false)} dismissible={!submitting} title={editingId ? 'Sửa đánh giá' : 'Đánh giá sản phẩm'}>
        {editingId && myReviewQ.isPending ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy="true">
            <Skeleton width="100%" height={44} />
            <Skeleton width="100%" height={96} />
          </div>
        ) : editingId && myReviewQ.isError ? (
          <ErrorState message={getLoadErrorMessage(myReviewQ.error)} onRetry={() => myReviewQ.refetch()} />
        ) : target ? (
          <WriteReview
            slug={slug}
            draft={draft}
            isEdit={!!editingId}
            orderId={target.orderId}
            orderCode={target.orderCode ?? undefined}
            purchaseCount={elig?.purchaseCount ?? 0}
            showReward={elig?.rewardAvailable !== false}
            hidden={target.kind === 'edit' && hiddenIds.has(target.reviewId)}
            onSubmittingChange={setSubmitting}
            onDraftChange={(patch) => setEdited((d) => ({ key, draft: { ...(d && d.key === key ? d.draft : base), ...patch } }))}
            onDone={() => {
              setEdited(null);
              setWriting(false);
            }}
          />
        ) : null}
      </BottomSheet>
    </section>
  );
}

function WriteReview({
  slug,
  draft,
  isEdit,
  orderId,
  orderCode,
  purchaseCount,
  showReward,
  hidden,
  onSubmittingChange,
  onDraftChange,
  onDone,
}: {
  slug: string;
  draft: ReviewDraft;
  isEdit: boolean;
  /** Lần mua được đánh giá: đơn còn viết được (viết mới) hoặc đơn của đánh giá đang sửa. */
  orderId: string;
  orderCode?: string;
  /** Số đơn đã nhận có sản phẩm này; API cũ chưa trả thì là 0 (không hiện câu nào). */
  purchaseCount: number;
  /** false chỉ khi API báo hết thưởng; thiếu trường (API cũ) vẫn hiện câu gợi ý. Máy chủ mới quyết định thưởng thật. */
  showReward: boolean;
  /** Đánh giá đang sửa bị Tubu ẩn: lưu không làm nó hiện lại, nên không được báo như thể đã đổi được gì. */
  hidden: boolean;
  onSubmittingChange: (submitting: boolean) => void;
  onDraftChange: (patch: Partial<ReviewDraft>) => void;
  onDone: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const { rating, comment, images, video } = draft;
  // Đang tải video lên: gửi lúc này sẽ lưu đánh giá không kèm video (mất phần thưởng video, sửa lại cũng không được cộng thêm).
  const [videoBusy, setVideoBusy] = useState(false);
  const [imagesBusy, setImagesBusy] = useState(false);
  const mediaBusy = videoBusy || imagesBusy;
  // Lỗi đang hiện: ở hàng sao, ở ô nhận xét, hay lỗi gửi do máy chủ trả (dưới nút). Đọc qua role=alert, focus tới chỗ cần sửa.
  const [issue, setIssue] = useState<{ field: ReviewFormField | 'submit'; message: string } | null>(null);
  const starRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const commentBox = useRef<HTMLDivElement>(null);
  const submitAlert = useRef<HTMLDivElement>(null);
  // Khoá đồng bộ chống chạm đúp: isPending chỉ đổi sau lần vẽ kế tiếp nên hai chạm cùng nhịp vẫn gửi hai lần.
  const sending = useRef(false);
  const ratingErrorId = useId();
  const commentErrorId = useId();

  const submit = useMutation({
    mutationFn: () =>
      createReview(slug, {
        rating,
        comment: comment.trim() || undefined,
        images: images.length > 0 ? images : undefined,
        videoUrl: video.trim() || undefined,
        orderId,
      }),
    onSuccess: (res) => {
      haptic('medium');
      // Theo BE chứ không theo chế độ form: đánh giá của đơn này có thể đã được tạo từ thiết bị khác. Thưởng chỉ một lần cho
      // mỗi (khách, sản phẩm) nên đánh giá lần mua sau ra pointsEarned = 0: chỉ báo cộng điểm khi thật sự có điểm.
      const earned = res.updated ? 0 : (res.pointsEarned ?? 0);
      if (hidden || res.isVisible === false) {
        openSnackbar({ text: vi.reviews.savedHidden, type: 'info' });
      } else {
        openSnackbar({
          text: res.updated
            ? 'Đã cập nhật đánh giá của bạn'
            : earned > 0
              ? `Cảm ơn đánh giá của bạn! Đã cộng ${formatNumber(earned)} Điểm Xanh`
              : 'Đã gửi đánh giá của bạn',
          type: 'success',
        });
      }
      void qc.invalidateQueries({ queryKey: ['reviews', slug] });
      void qc.invalidateQueries({ queryKey: ['can-review', slug] });
      void qc.invalidateQueries({ queryKey: ['my-review', res.id] });
      void qc.invalidateQueries({ queryKey: ['order'] });
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      onDone();
    },
    onError: (e) => setIssue({ field: 'submit', message: getErrorMessage(e) }),
    onSettled: () => {
      sending.current = false;
      onSubmittingChange(false);
    },
  });

  useEffect(() => {
    if (issue?.field === 'submit') submitAlert.current?.focus();
  }, [issue]);

  const pickRating = (i: number) => {
    haptic('light');
    onDraftChange({ rating: i });
    if (issue?.field === 'rating') setIssue(null);
  };

  const send = () => {
    if (sending.current || submit.isPending || mediaBusy) return;
    const found = reviewFormIssue({ rating, comment });
    if (found) {
      setIssue(found);
      if (found.field === 'rating') (starRefs.current[rating - 1] ?? starRefs.current[0])?.focus();
      else commentBox.current?.querySelector('textarea')?.focus();
      return;
    }
    setIssue(null);
    sending.current = true;
    onSubmittingChange(true);
    submit.mutate();
  };

  const bonus = !isEdit && (Boolean(video) || images.length > 0);
  const ratingStop = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 1;

  return (
    // Enter mà bộ gõ tiếng Việt dùng để chốt chữ không được bấm nút đang focus (sao, Gửi); ô nhận xét giữ nguyên cho bộ gõ.
    <div
      onKeyDown={(e) => {
        if (isImeEnter(e.nativeEvent) && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div
        role="radiogroup"
        aria-label="Số sao"
        aria-invalid={issue?.field === 'rating' || undefined}
        aria-describedby={issue?.field === 'rating' ? ratingErrorId : undefined}
        onKeyDown={(e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          const next = ratingFromKey(e.key, rating);
          if (next === null) return;
          e.preventDefault();
          pickRating(next);
          starRefs.current[next - 1]?.focus();
        }}
        style={{ display: 'flex', justifyContent: 'center', gap: 4, margin: '8px 0 16px' }}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            ref={(el) => {
              starRefs.current[i - 1] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === rating}
            aria-label={`${i} sao`}
            tabIndex={i === ratingStop ? 0 : -1}
            className="tubu-press"
            onClick={() => pickRating(i)}
            style={{
              minWidth: 44,
              minHeight: 44,
              padding: 0,
              border: 'none',
              background: 'transparent',
              display: 'grid',
              placeItems: 'center',
              color: i <= rating ? 'var(--color-rating)' : 'var(--stone-450)',
            }}
          >
            <Star size={32} strokeWidth={1.75} aria-hidden style={{ fill: 'currentColor' }} />
          </button>
        ))}
      </div>
      {issue?.field === 'rating' && (
        <div id={ratingErrorId} role="alert" style={{ margin: '0 0 var(--space-stack-sm)', textAlign: 'center' }}>
          <Text variant="caption" tone="danger" as="p">
            {issue.message}
          </Text>
        </div>
      )}
      <div ref={commentBox}>
        <Input.TextArea maxLength={INPUT_LIMITS.reviewComment}
          aria-label="Nội dung đánh giá"
          aria-invalid={issue?.field === 'comment' || undefined}
          aria-describedby={issue?.field === 'comment' ? commentErrorId : undefined}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          placeholder="Chia sẻ cảm nhận của bạn về sản phẩm (không bắt buộc)…"
          value={comment}
          onChange={(e) => {
            onDraftChange({ comment: e.target.value });
            if (issue?.field === 'comment') setIssue(null);
          }}
          onKeyDown={(e) => {
            if (!isSubmitShortcut(e.nativeEvent)) return;
            e.preventDefault();
            send();
          }}
          rows={4}
        />
      </div>
      {issue?.field === 'comment' && (
        <div id={commentErrorId} role="alert" style={{ marginTop: 'var(--space-inline-xs)' }}>
          <Text variant="caption" tone="danger" as="p">
            {issue.message}
          </Text>
        </div>
      )}
      <MultiImageUpload value={images} onChange={(v) => onDraftChange({ images: v })} onBusyChange={setImagesBusy} max={5} />
      <VideoUpload value={video} onChange={(v) => onDraftChange({ video: v })} onBusyChange={setVideoBusy} />
      {(purchaseCount > 1 || isEdit) && orderCode && (
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
          {isEdit
            ? `Bạn đang sửa đánh giá cho đơn ${orderCode}.`
            : `Bạn đã mua sản phẩm này ${purchaseCount} lần, mỗi lần mua được viết một đánh giá. Đánh giá này cho đơn ${orderCode}.`}
        </Text>
      )}
      {isEdit && hidden && (
        <Text variant="caption" tone="warning" as="p" style={{ marginTop: 8 }}>
          {vi.reviews.editHiddenNote}
        </Text>
      )}
      {(isEdit || showReward) && (
        <Text
          variant="caption"
          tone={bonus ? 'success' : 'tertiary'}
          as="p"
          style={{ marginTop: 8, fontWeight: bonus ? 600 : 400 }}
        >
          {rewardHint({
            isEdit,
            rewardAvailable: true,
            hasImages: images.length > 0,
            hasVideo: Boolean(video),
            canUploadVideo: isCloudinaryConfigured(),
          })}
        </Text>
      )}
      {!isEdit && !showReward && (
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
          {REWARD_ALREADY_GIVEN}
        </Text>
      )}
      {issue?.field === 'submit' && (
        <div ref={submitAlert} tabIndex={-1} role="alert" style={{ marginTop: 'var(--space-stack-sm)' }}>
          <Text variant="body-sm" tone="danger" as="p">
            {issue.message}
          </Text>
        </div>
      )}
      <Button fullWidth loading={submit.isPending} disabled={mediaBusy} onPress={send} style={{ marginTop: 16 }}>
        {videoBusy ? VIDEO_UPLOADING : imagesBusy ? vi.common.imagesUploading : isEdit ? 'Lưu đánh giá' : 'Gửi đánh giá'}
      </Button>
    </div>
  );
}
