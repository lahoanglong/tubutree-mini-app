import { useEffect, useRef, useState } from 'react';
import { Input, Avatar, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Star, Video, type LucideIcon } from 'lucide-react';
import {
  fetchReviews,
  createReview,
  canReviewProduct,
  fetchMyReview,
  type MyReview,
  type MyReviewRef,
} from '../services/shop-api';
import { apiMediaUrl, getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { MultiImageUpload, VideoUpload } from './image-upload';
import { formatDate, formatNumber } from '../utils/format';
import { haptic } from '../utils/haptic';
import { Badge } from './ui/badge';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import { EmptyState, ErrorState } from './ui/empty-state';
import { Skeleton } from './ui/skeleton';
import { Heading, Text } from './ui/text';

type ReviewFilter = number | 'all' | 'photo' | 'video';

interface FilterChipDef {
  k: ReviewFilter;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

/** Dải sao tĩnh (hiển thị) — size tùy chỉnh. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span role="img" aria-label={`${value} trên 5 sao`} style={{ display: 'inline-flex', whiteSpace: 'nowrap', lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          strokeWidth={1.75}
          aria-hidden
          style={{ color: i <= Math.round(value) ? 'var(--color-rating)' : 'var(--stone-200)', fill: 'currentColor' }}
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

const draftFromReview = (r: MyReview): ReviewDraft => ({
  rating: r.rating,
  comment: r.comment ?? '',
  images: r.images,
  video: r.videoUrl ?? '',
});

/**
 * Đánh giá đang soạn. Mỗi lần mua (đơn) một đánh giá: sửa thì gắn đúng dòng đánh giá của đơn đó. Viết mới chỉ ghi đơn khi
 * khách chọn đơn từ chi tiết đơn; còn lại lấy đơn còn viết được sớm nhất theo can-review lúc gửi (form có thể mở trước khi
 * can-review về). Không biết đơn nào thì máy chủ tự chọn đơn nhận sớm nhất chưa đánh giá.
 */
type FormTarget = { kind: 'new'; orderId?: string } | { kind: 'edit'; reviewId: string; orderId: string; orderCode: string | null };

// Nháp viết mới dùng chung cho mọi đơn: nội dung là cảm nhận về sản phẩm, không đổi khi can-review về và chọn được đơn.
const targetKey = (t: FormTarget) => (t.kind === 'new' ? 'new' : `edit:${t.reviewId}`);

/**
 * `openForOrderId`: đơn khách bấm "Viết đánh giá"/"Sửa đánh giá" ở chi tiết đơn — mở sẵn form cho đúng lần mua đó khi
 * can-review về (đơn còn viết được thì viết mới, đơn đã có đánh giá thì sửa đánh giá đó).
 */
export function ReviewsSection({ slug, openForOrderId }: { slug: string; openForOrderId?: string }) {
  const { status, login } = useAuthStore();
  const [writing, setWriting] = useState(false);
  const [target, setTarget] = useState<FormTarget | null>(null);
  // BottomSheet gỡ nội dung khỏi DOM khi đóng; nháp nằm ở đây để chạm nhầm lên mask/vuốt xuống
  // không làm mất sao, nhận xét và ảnh/video đã upload (P1-2). Nháp gắn với đúng đánh giá đang soạn: mở đánh giá khác
  // thì form lấy nội dung của đánh giá đó. null = chưa gõ gì: form lấy đánh giá hiện có (sửa) hoặc form trống (viết mới).
  const [edited, setEdited] = useState<{ key: string; draft: ReviewDraft } | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [visible, setVisible] = useState(5);
  const reviewsQ = useQuery({ queryKey: ['reviews', slug], queryFn: () => fetchReviews(slug) });
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
  const nextOrder = elig?.reviewableOrders?.[0];

  const openForm = (t: FormTarget) => {
    setTarget(t);
    setWriting(true);
  };
  const openEdit = (r: MyReviewRef) => openForm({ kind: 'edit', reviewId: r.id, orderId: r.orderId, orderCode: r.orderCode });

  const deepLinked = useRef(false);
  useEffect(() => {
    if (!openForOrderId || !elig || deepLinked.current) return;
    deepLinked.current = true;
    const order = elig.reviewableOrders?.find((o) => o.orderId === openForOrderId);
    const mine = elig.myReviews?.find((r) => r.orderId === openForOrderId);
    if (order) openForm({ kind: 'new', orderId: order.orderId });
    else if (mine) openEdit(mine);
  }, [openForOrderId, elig]);

  const key = target ? targetKey(target) : '';
  const base = editingId && myReviewQ.data ? draftFromReview(myReviewQ.data) : EMPTY_DRAFT;
  const draft = edited && edited.key === key ? edited.draft : base;
  const latestMine = myReviews[0];
  const formOrderId = target?.kind === 'edit' ? target.orderId : (target?.orderId ?? nextOrder?.orderId);
  const formOrderCode =
    target?.kind === 'edit' ? target.orderCode : elig?.reviewableOrders?.find((o) => o.orderId === formOrderId)?.code;
  const headerAction =
    status !== 'authenticated' || !elig || elig.canReview
      ? { label: 'Viết đánh giá', onPress: () => (status !== 'authenticated' ? void login() : openForm({ kind: 'new' })) }
      : elig.reason === 'ALL_REVIEWED' && latestMine
        ? { label: 'Sửa đánh giá của bạn', onPress: () => openEdit(latestMine) }
        : null;
  const data = reviewsQ.data;
  const dist = data?.distribution ?? {};
  const filtered = (data?.items ?? []).filter((r) =>
    filter === 'all'
      ? true
      : filter === 'photo'
        ? r.images.length > 0
        : filter === 'video'
          ? !!r.videoUrl
          : r.rating === filter,
  );

  const chips: FilterChipDef[] = [
    { k: 'all', label: 'Tất cả' },
    { k: 5, label: '5 sao' },
    { k: 4, label: '4 sao' },
    { k: 3, label: '3 sao' },
    { k: 'photo', label: 'Có ảnh' },
    ...((data?.videoCount ?? 0) > 0 ? [{ k: 'video' as const, label: 'Có video', icon: Video, count: data?.videoCount }] : []),
  ];

  return (
    <section aria-label="Đánh giá sản phẩm" style={{ padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 }}>
        <Heading variant="title-sm" as="h2">
          Đánh giá {data && data.count > 0 ? `(${data.count})` : ''}
        </Heading>
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
            Mua &amp; nhận hàng để đánh giá
          </Text>
        )}
      </div>

      {reviewsQ.isLoading ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton width="100%" height={64} />
          <Skeleton width="100%" height={64} />
        </div>
      ) : reviewsQ.isError ? (
        <ErrorState message={getErrorMessage(reviewsQ.error)} onRetry={() => void reviewsQ.refetch()} />
      ) : data && data.count > 0 ? (
        <>
          {/* Trung bình + breakdown sao 5→1 */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'center' }}>
            <div style={{ textAlign: 'center', flex: '0 0 auto' }}>
              <Heading variant="display-lg" as="div">
                {data.average.toFixed(1)}
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
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {chips.map((f) => (
              <Chip
                key={String(f.k)}
                size="sm"
                selected={filter === f.k}
                icon={f.icon}
                count={f.count}
                onPress={() => {
                  haptic('light');
                  setFilter(f.k);
                  setVisible(5);
                }}
              >
                {f.label}
              </Chip>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {filtered.slice(0, visible).map((r) => {
              const mine = mineById.get(r.id);
              return (
              <div key={r.id} style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar size={28} src={r.avatar ?? undefined} />
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
                    <Stars value={r.rating} size={11} />
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
                {r.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto' }}>
                    {r.images.map((img) => (
                      <img
                        key={img}
                        src={apiMediaUrl(img)}
                        alt="ảnh đánh giá"
                        loading="lazy"
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--radius-media)' }}
                      />
                    ))}
                  </div>
                )}
                {r.videoUrl && (
                  <video
                    src={r.videoUrl}
                    controls
                    preload="metadata"
                    playsInline
                    style={{ width: '100%', maxHeight: 220, marginTop: 8, borderRadius: 'var(--radius-media)', background: 'var(--color-bg-inverse)' }}
                  />
                )}
              </div>
              );
            })}
            {filtered.length === 0 && <EmptyState variant="inline" art="search" heading="Không có đánh giá khớp bộ lọc." />}
            {filtered.length > visible && (
              <Button variant="ghost" fullWidth onPress={() => setVisible((v) => v + 5)}>
                Xem thêm ({filtered.length - visible})
              </Button>
            )}
          </div>
        </>
      ) : (
        <EmptyState variant="inline" art="sprout" heading="Chưa có đánh giá" body="Hãy là người đầu tiên chia sẻ trải nghiệm." />
      )}

      <BottomSheet open={writing} onClose={() => setWriting(false)} title={editingId ? 'Sửa đánh giá' : 'Đánh giá sản phẩm'}>
        {editingId && myReviewQ.isPending ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy="true">
            <Skeleton width="100%" height={44} />
            <Skeleton width="100%" height={96} />
          </div>
        ) : editingId && myReviewQ.isError ? (
          <ErrorState message={getErrorMessage(myReviewQ.error)} onRetry={() => void myReviewQ.refetch()} />
        ) : (
          <WriteReview
            slug={slug}
            draft={draft}
            isEdit={!!editingId}
            orderId={formOrderId}
            orderCode={formOrderCode ?? undefined}
            purchaseCount={elig?.purchaseCount ?? 0}
            showReward={elig?.rewardAvailable !== false}
            onDraftChange={(patch) => setEdited((d) => ({ key, draft: { ...(d && d.key === key ? d.draft : base), ...patch } }))}
            onDone={() => {
              setEdited(null);
              setWriting(false);
            }}
          />
        )}
      </BottomSheet>
    </section>
  );
}

// Biểu mẫu không biết khách đã nhận thưởng sản phẩm này trước đó hay chưa (xoá đánh giá rồi viết lại thì BE cho
// pointsEarned = 0), nên mọi câu nhắc điểm phải nêu điều kiện này thay vì hứa vô điều kiện.
const FIRST_REVIEW_ONLY = 'Lần đầu đánh giá sản phẩm này';
// Cờ hết thưởng không hứa điểm nữa nhưng cũng không được im lặng: khách gửi xong chỉ thấy snackbar không kèm điểm.
const REWARD_ALREADY_GIVEN =
  'Bạn đã nhận Điểm Xanh cho đánh giá đầu tiên của sản phẩm này, đánh giá lần mua này không cộng thêm điểm.';
const EDIT_HINT = 'Chỉ lần đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh, sửa đánh giá không cộng thêm.';

function WriteReview({
  slug,
  draft,
  isEdit,
  orderId,
  orderCode,
  purchaseCount,
  showReward,
  onDraftChange,
  onDone,
}: {
  slug: string;
  draft: ReviewDraft;
  isEdit: boolean;
  /** Lần mua được đánh giá; thiếu khi can-review chưa về thì máy chủ tự chọn đơn. */
  orderId?: string;
  orderCode?: string;
  /** Số đơn đã nhận có sản phẩm này; API cũ chưa trả thì là 0 (không hiện câu nào). */
  purchaseCount: number;
  /** false chỉ khi API báo hết thưởng; thiếu trường (API cũ) vẫn hiện câu gợi ý. Máy chủ mới quyết định thưởng thật. */
  showReward: boolean;
  onDraftChange: (patch: Partial<ReviewDraft>) => void;
  onDone: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const { rating, comment, images, video } = draft;

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
      openSnackbar({
        text: res.updated
          ? 'Đã cập nhật đánh giá của bạn'
          : earned > 0
            ? `Cảm ơn đánh giá của bạn! Đã cộng ${formatNumber(earned)} Điểm Xanh`
            : 'Đã gửi đánh giá của bạn',
        type: 'success',
      });
      void qc.invalidateQueries({ queryKey: ['reviews', slug] });
      void qc.invalidateQueries({ queryKey: ['can-review', slug] });
      void qc.invalidateQueries({ queryKey: ['my-review', res.id] });
      void qc.invalidateQueries({ queryKey: ['order'] });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const bonus = !isEdit && (Boolean(video) || images.length > 0);

  return (
    <div>
      <div role="radiogroup" aria-label="Số sao" style={{ display: 'flex', justifyContent: 'center', gap: 4, margin: '8px 0 16px' }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === rating}
            aria-label={`${i} sao`}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              onDraftChange({ rating: i });
            }}
            style={{
              minWidth: 44,
              minHeight: 44,
              padding: 0,
              border: 'none',
              background: 'transparent',
              display: 'grid',
              placeItems: 'center',
              color: i <= rating ? 'var(--color-rating)' : 'var(--stone-200)',
            }}
          >
            <Star size={32} strokeWidth={1.75} aria-hidden style={{ fill: 'currentColor' }} />
          </button>
        ))}
      </div>
      <Input.TextArea
        placeholder="Chia sẻ cảm nhận của bạn về sản phẩm (không bắt buộc)..."
        value={comment}
        onChange={(e) => onDraftChange({ comment: e.target.value })}
        rows={4}
      />
      <MultiImageUpload value={images} onChange={(v) => onDraftChange({ images: v })} max={5} />
      <VideoUpload value={video} onChange={(v) => onDraftChange({ video: v })} />
      {(isEdit || showReward) && (
        <Text
          variant="caption"
          tone={bonus ? 'success' : 'tertiary'}
          as="p"
          style={{ marginTop: 8, fontWeight: bonus ? 600 : 400 }}
        >
          {isEdit
            ? EDIT_HINT
            : video
              ? `Tuyệt! ${FIRST_REVIEW_ONLY}, đánh giá có video nhận +15 Điểm Xanh!`
              : images.length > 0
                ? `${FIRST_REVIEW_ONLY}, bạn nhận +10 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.`
                : `${FIRST_REVIEW_ONLY}: thêm video +15 / ảnh +10 Điểm Xanh (chỉ chữ +5). Chỉ đánh giá SP đã mua & nhận.`}
        </Text>
      )}
      {(purchaseCount > 1 || isEdit) && orderCode && (
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
          {isEdit
            ? `Bạn đang sửa đánh giá cho đơn ${orderCode}.`
            : `Bạn đã mua sản phẩm này ${purchaseCount} lần, mỗi lần mua được viết một đánh giá. Đánh giá này cho đơn ${orderCode}.`}
        </Text>
      )}
      {!isEdit && !showReward && (
        <Text variant="caption" tone="tertiary" as="p" style={{ marginTop: 8 }}>
          {REWARD_ALREADY_GIVEN}
        </Text>
      )}
      <Button fullWidth loading={submit.isPending} onPress={() => submit.mutate()} style={{ marginTop: 16 }}>
        {isEdit ? 'Lưu đánh giá' : 'Gửi đánh giá'}
      </Button>
    </div>
  );
}
