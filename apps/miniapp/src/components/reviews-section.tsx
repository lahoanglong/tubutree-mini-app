import { useState } from 'react';
import { Box, Text, Button, Input, Sheet, Avatar, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchReviews, createReview } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { MultiImageUpload, VideoUpload } from './image-upload';
import { haptic } from '../utils/haptic';

/** Dải sao tĩnh (hiển thị) — size tùy chỉnh. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span aria-label={`${value} trên 5 sao`} style={{ whiteSpace: 'nowrap', lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{ fontSize: size, color: i <= Math.round(value) ? 'var(--sun-500)' : 'var(--neutral-200)' }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

export function ReviewsSection({ slug }: { slug: string }) {
  const { status, login } = useAuthStore();
  const [writing, setWriting] = useState(false);
  const [filter, setFilter] = useState<number | 'all' | 'photo' | 'video'>('all');
  const [visible, setVisible] = useState(5);
  const reviewsQ = useQuery({ queryKey: ['reviews', slug], queryFn: () => fetchReviews(slug) });

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

  return (
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Box flex alignItems="center" justifyContent="space-between">
        <Text bold size="small">
          Đánh giá {data && data.count > 0 ? `(${data.count})` : ''}
        </Text>
        <Text
          size="small"
          bold
          style={{ color: 'var(--primary-700)' }}
          onClick={() => {
            haptic('light');
            if (status !== 'authenticated') return void login();
            setWriting(true);
          }}
        >
          Viết đánh giá
        </Text>
      </Box>

      {data && data.count > 0 ? (
        <>
          {/* Trung bình + breakdown sao 5→1 */}
          <Box flex style={{ gap: 16, marginTop: 12, alignItems: 'center' }}>
            <Box style={{ textAlign: 'center', flex: '0 0 auto' }}>
              <Text bold style={{ fontSize: 32, color: 'var(--neutral-900)', lineHeight: '36px' }}>
                {data.average.toFixed(1)}
              </Text>
              <Stars value={data.average} size={13} />
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {data.count} đánh giá
              </Text>
            </Box>
            <Box style={{ flex: 1 }}>
              {[5, 4, 3, 2, 1].map((star) => {
                const n = dist[String(star)] ?? 0;
                const pct = data.count > 0 ? Math.round((n / data.count) * 100) : 0;
                return (
                  <Box key={star} flex alignItems="center" style={{ gap: 6, marginBottom: 3 }}>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)', width: 10 }}>
                      {star}
                    </Text>
                    <span style={{ color: 'var(--sun-500)', fontSize: 10 }}>★</span>
                    <Box style={{ flex: 1, height: 6, background: 'var(--neutral-100)', borderRadius: 99, overflow: 'hidden' }}>
                      <Box style={{ width: `${pct}%`, height: '100%', background: 'var(--sun-500)' }} />
                    </Box>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)', width: 18, textAlign: 'right' }}>
                      {n}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Filter chips */}
          <Box flex style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {([
              { k: 'all' as const, label: 'Tất cả' },
              { k: 5 as const, label: '5★' },
              { k: 4 as const, label: '4★' },
              { k: 3 as const, label: '3★' },
              { k: 'photo' as const, label: 'Có ảnh' },
              ...((data.videoCount ?? 0) > 0 ? [{ k: 'video' as const, label: `🎬 Có video (${data.videoCount})` }] : []),
            ]).map((f) => (
              <Text
                key={String(f.k)}
                size="xSmall"
                onClick={() => {
                  haptic('light');
                  setFilter(f.k);
                  setVisible(5);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-full)',
                  border: `1px solid ${filter === f.k ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
                  color: filter === f.k ? 'var(--primary-700)' : 'var(--neutral-600)',
                  background: filter === f.k ? 'var(--primary-50)' : 'transparent',
                }}
              >
                {f.label}
              </Text>
            ))}
          </Box>

          <Box flex flexDirection="column" style={{ gap: 12, marginTop: 12 }}>
            {filtered.slice(0, visible).map((r) => (
              <Box key={r.id} style={{ borderTop: '1px solid var(--neutral-100)', paddingTop: 12 }}>
                <Box flex alignItems="center" style={{ gap: 8 }}>
                  <Avatar size={28} src={r.avatar ?? undefined} />
                  <Box style={{ flex: 1 }}>
                    <Box flex alignItems="center" style={{ gap: 6 }}>
                      <Text size="xSmall" bold>
                        {r.author}
                      </Text>
                      {r.verifiedPurchase && (
                        <Text
                          size="xSmall"
                          style={{ color: 'var(--leaf-700)', background: 'var(--leaf-50)', padding: '0 6px', borderRadius: 'var(--radius-full)' }}
                        >
                          ✓ Đã mua
                        </Text>
                      )}
                    </Box>
                    <Stars value={r.rating} size={11} />
                  </Box>
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                    {new Date(r.createdAt).toLocaleDateString('vi-VN')}
                  </Text>
                </Box>
                {r.comment && (
                  <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
                    {r.comment}
                  </Text>
                )}
                {r.images.length > 0 && (
                  <Box flex style={{ gap: 6, marginTop: 8, overflowX: 'auto' }}>
                    {r.images.map((img) => (
                      <img
                        key={img}
                        src={img}
                        alt="ảnh đánh giá"
                        loading="lazy"
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                      />
                    ))}
                  </Box>
                )}
                {r.videoUrl && (
                  <video
                    src={r.videoUrl}
                    controls
                    preload="metadata"
                    playsInline
                    style={{ width: '100%', maxHeight: 220, marginTop: 8, borderRadius: 'var(--radius-sm)', background: '#000' }}
                  />
                )}
              </Box>
            ))}
            {filtered.length === 0 && (
              <Text size="small" style={{ color: 'var(--neutral-400)', paddingTop: 8 }}>
                Không có đánh giá khớp bộ lọc.
              </Text>
            )}
            {filtered.length > visible && (
              <Text
                size="small"
                bold
                onClick={() => setVisible((v) => v + 5)}
                style={{ color: 'var(--primary-700)', textAlign: 'center', paddingTop: 4 }}
              >
                Xem thêm ({filtered.length - visible})
              </Text>
            )}
          </Box>
        </>
      ) : (
        <Text size="small" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
          Chưa có đánh giá. Hãy là người đầu tiên chia sẻ trải nghiệm 🌿
        </Text>
      )}

      <Sheet visible={writing} onClose={() => setWriting(false)} autoHeight>
        <WriteReview slug={slug} onDone={() => setWriting(false)} />
      </Sheet>
    </Box>
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
      openSnackbar({ text: 'Cảm ơn đánh giá của bạn! Đã cộng Điểm Xanh 🌿', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['reviews', slug] });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <Text bold size="large">
        Đánh giá sản phẩm
      </Text>
      <Box flex justifyContent="center" style={{ gap: 8, margin: '16px 0' }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            role="button"
            aria-label={`${i} sao`}
            onClick={() => {
              haptic('light');
              setRating(i);
            }}
            style={{ fontSize: 36, color: i <= rating ? 'var(--sun-500)' : 'var(--neutral-200)' }}
          >
            ★
          </span>
        ))}
      </Box>
      <Input.TextArea
        placeholder="Chia sẻ cảm nhận của bạn về sản phẩm (không bắt buộc)..."
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
      />
      <MultiImageUpload value={images} onChange={setImages} max={5} />
      <VideoUpload value={video} onChange={setVideo} />
      <Text
        size="xSmall"
        style={{ color: video || images.length > 0 ? 'var(--leaf-700)' : 'var(--neutral-400)', marginTop: 8, fontWeight: video || images.length > 0 ? 600 : 400 }}
      >
        {video
          ? '🎬 Tuyệt! Đánh giá có video nhận +15 Điểm Xanh!'
          : images.length > 0
            ? '🌿 Bạn sẽ nhận +10 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.'
            : 'Thêm video +15 / ảnh +10 Điểm Xanh (chỉ chữ +5). Chỉ đánh giá SP đã mua & nhận.'}
      </Text>
      <Button
        fullWidth
        loading={submit.isPending}
        onClick={() => submit.mutate()}
        style={{ marginTop: 16, background: 'var(--primary-600)' }}
      >
        Gửi đánh giá
      </Button>
    </Box>
  );
}
