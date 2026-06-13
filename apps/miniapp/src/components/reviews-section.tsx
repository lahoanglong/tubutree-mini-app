import { useState } from 'react';
import { Box, Text, Button, Input, Sheet, Avatar, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchReviews, createReview } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { MultiImageUpload } from './image-upload';
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
  const reviewsQ = useQuery({ queryKey: ['reviews', slug], queryFn: () => fetchReviews(slug) });

  const data = reviewsQ.data;

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
          <Box flex alignItems="center" style={{ gap: 8, marginTop: 8 }}>
            <Text bold style={{ fontSize: 28, color: 'var(--neutral-900)' }}>
              {data.average.toFixed(1)}
            </Text>
            <Box>
              <Stars value={data.average} size={16} />
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {data.count} lượt đánh giá
              </Text>
            </Box>
          </Box>

          <Box flex flexDirection="column" style={{ gap: 12, marginTop: 12 }}>
            {data.items.slice(0, 5).map((r) => (
              <Box key={r.id} style={{ borderTop: '1px solid var(--neutral-100)', paddingTop: 12 }}>
                <Box flex alignItems="center" style={{ gap: 8 }}>
                  <Avatar size={28} src={r.avatar ?? undefined} />
                  <Box style={{ flex: 1 }}>
                    <Text size="xSmall" bold>
                      {r.author}
                    </Text>
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
              </Box>
            ))}
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

  const submit = useMutation({
    mutationFn: () =>
      createReview(slug, {
        rating,
        comment: comment.trim() || undefined,
        images: images.length > 0 ? images : undefined,
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
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8 }}>
        Có ảnh được +10 Điểm Xanh · chỉ chữ +5 Điểm Xanh. Chỉ đánh giá được sản phẩm đã mua & nhận.
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
