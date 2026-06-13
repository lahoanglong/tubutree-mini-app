import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <path
          d="M12 21s-7.5-4.6-10-9.3C.6 8.4 2.3 5 5.6 5c2 0 3.3 1.1 4.4 2.6C11 6.1 12.4 5 14.4 5 17.7 5 19.4 8.4 18 11.7 15.5 16.4 12 21 12 21z"
          fill={liked ? 'var(--danger)' : 'none'}
          stroke={liked ? 'var(--danger)' : 'var(--neutral-600)'}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
