import { useState } from 'react';
import { Input, Avatar, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Star, Video, type LucideIcon } from 'lucide-react';
import { fetchReviews, createReview, canReviewProduct } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { MultiImageUpload, VideoUpload } from './image-upload';
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

export function ReviewsSection({ slug }: { slug: string }) {
  const { status, login } = useAuthStore();
  const [writing, setWriting] = useState(false);
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
            đã mua" — mất trắng công sức (P1-2). */}
        {(status !== 'authenticated' || eligQ.data?.canReview !== false) && (
          <Button
            variant="ghost"
            onPress={() => {
              haptic('light');
              if (status !== 'authenticated') return void login();
              setWriting(true);
            }}
          >
            Viết đánh giá
          </Button>
        )}
        {status === 'authenticated' && eligQ.data?.canReview === false && (
          <Text variant="caption" tone="tertiary">
            {eligQ.data.reason === 'ALREADY_REVIEWED' ? 'Bạn đã đánh giá' : 'Mua & nhận hàng để đánh giá'}
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
            {filtered.slice(0, visible).map((r) => (
              <div key={r.id} style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar size={28} src={r.avatar ?? undefined} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Text variant="label">{r.author}</Text>
                      {r.verifiedPurchase && (
                        <Badge tone="success" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <Check size={11} strokeWidth={2.25} aria-hidden />
                          Đã mua
                        </Badge>
                      )}
                    </div>
                    <Stars value={r.rating} size={11} />
                  </div>
                  <Text variant="caption" tone="tertiary">
                    {new Date(r.createdAt).toLocaleDateString('vi-VN')}
                  </Text>
                </div>
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
                        src={img}
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
            ))}
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

      <BottomSheet open={writing} onClose={() => setWriting(false)} title="Đánh giá sản phẩm">
        <WriteReview slug={slug} onDone={() => setWriting(false)} />
      </BottomSheet>
    </section>
  );
}

function WriteReview({ slug, onDone }: { slug: string; onDone: () => void }) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [video, setVideo] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      createReview(slug, {
        rating,
        comment: comment.trim() || undefined,
        images: images.length > 0 ? images : undefined,
        videoUrl: video.trim() || undefined,
      }),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Cảm ơn đánh giá của bạn! Đã cộng Điểm Xanh', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['reviews', slug] });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const bonus = Boolean(video) || images.length > 0;

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
              setRating(i);
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
        onChange={(e) => setComment(e.target.value)}
        rows={4}
      />
      <MultiImageUpload value={images} onChange={setImages} max={5} />
      <VideoUpload value={video} onChange={setVideo} />
      <Text
        variant="caption"
        tone={bonus ? 'success' : 'tertiary'}
        as="p"
        style={{ marginTop: 8, fontWeight: bonus ? 600 : 400 }}
      >
        {video
          ? 'Tuyệt! Đánh giá có video nhận +15 Điểm Xanh!'
          : images.length > 0
            ? 'Bạn sẽ nhận +10 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.'
            : 'Thêm video +15 / ảnh +10 Điểm Xanh (chỉ chữ +5). Chỉ đánh giá SP đã mua & nhận.'}
      </Text>
      <Button fullWidth loading={submit.isPending} onPress={() => submit.mutate()} style={{ marginTop: 16 }}>
        Gửi đánh giá
      </Button>
    </div>
  );
}
