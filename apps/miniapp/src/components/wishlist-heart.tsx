import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { getWishlistIds, addWishlist, removeWishlist } from '../services/wishlist-api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';

/**
 * Nút tim yêu thích — tự đọc danh sách id đã thích (query dedupe ['wishlist-ids'])
 * và toggle với optimistic update. Ẩn khi chưa đăng nhập? → vẫn hiện, tap sẽ login.
 */
export function WishlistHeart({
  productId,
  size = 22,
  floating = false,
}: {
  productId: string;
  size?: number;
  floating?: boolean;
}) {
  const { status, login } = useAuthStore();
  const qc = useQueryClient();
  const authed = status === 'authenticated';

  const idsQ = useQuery({
    queryKey: ['wishlist-ids'],
    queryFn: getWishlistIds,
    enabled: authed,
    staleTime: 60_000,
  });
  const liked = idsQ.data?.includes(productId) ?? false;

  const toggle = useMutation({
    mutationFn: () => (liked ? removeWishlist(productId) : addWishlist(productId)),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['wishlist-ids'] });
      const prev = qc.getQueryData<string[]>(['wishlist-ids']) ?? [];
      qc.setQueryData<string[]>(
        ['wishlist-ids'],
        liked ? prev.filter((id) => id !== productId) : [...prev, productId],
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['wishlist-ids'], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['wishlist-ids'] });
      void qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
  });

  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic('light');
    if (!authed) return void login();
    toggle.mutate();
  };

  return (
    <button
      type="button"
      aria-label={liked ? 'Bỏ yêu thích' : 'Thêm yêu thích'}
      aria-pressed={liked}
      onClick={handle}
      style={{
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(floating
          ? {
              position: 'absolute',
              top: 8,
              right: 8,
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)',
              boxShadow: 'var(--shadow-sm)',
            }
          : { width: 44, height: 44, background: 'transparent' }),
      }}
    >
      <Heart
        size={size}
        strokeWidth={1.9}
        color={liked ? 'var(--danger)' : 'var(--neutral-600)'}
        fill={liked ? 'var(--danger)' : 'none'}
      />
    </button>
  );
}
