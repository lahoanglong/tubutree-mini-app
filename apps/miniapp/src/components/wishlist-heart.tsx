import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { getWishlistIds, addWishlist, removeWishlist } from '../services/wishlist-api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';

const IDS_KEY = ['wishlist-ids'];

// Mỗi sản phẩm một hàng đợi: lệnh thêm/bỏ gửi lần lượt đúng thứ tự chạm, nên chạm nhanh không còn hai lệnh "thêm" đua nhau (409).
const tails = new Map<string, Promise<void>>();
let inFlight = 0;

function sendToggle(qc: QueryClient, productId: string, want: boolean) {
  inFlight += 1;
  const tail: Promise<void> = (tails.get(productId) ?? Promise.resolve())
    .then(async () => {
      try {
        await (want ? addWishlist(productId) : removeWishlist(productId));
      } catch {
        // Không hoàn tác từng bước: hết lệnh chờ thì tải lại từ máy chủ, tim về đúng trạng thái thật.
      }
    })
    .then(() => {
      inFlight -= 1;
      if (tails.get(productId) === tail) tails.delete(productId);
      if (inFlight === 0) {
        void qc.invalidateQueries({ queryKey: IDS_KEY });
        void qc.invalidateQueries({ queryKey: ['wishlist'] });
      }
    });
  tails.set(productId, tail);
}

/**
 * Nút tim yêu thích — tự đọc danh sách id đã thích (query dedupe ['wishlist-ids']).
 * Mỗi lần chạm đổi tim ngay trên cache theo trạng thái mới nhất (kể cả lần chạm trước chưa có phản hồi), rồi xếp lệnh vào hàng
 * đợi; chỉ tải lại từ máy chủ khi không còn lệnh nào đang chờ để không ghi đè trạng thái lạc quan giữa chừng.
 * Chưa đăng nhập → vẫn hiện, chạm sẽ đăng nhập.
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
    queryKey: IDS_KEY,
    queryFn: getWishlistIds,
    enabled: authed,
    staleTime: 60_000,
  });
  const liked = idsQ.data?.includes(productId) ?? false;

  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic('light');
    if (!authed) return void login();
    void qc.cancelQueries({ queryKey: IDS_KEY });
    const current = qc.getQueryData<string[]>(IDS_KEY) ?? [];
    const want = !current.includes(productId);
    qc.setQueryData<string[]>(IDS_KEY, want ? [...current, productId] : current.filter((id) => id !== productId));
    sendToggle(qc, productId, want);
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
        // Vùng chạm luôn 44x44; khi nổi trên ảnh thẻ, nút trong suốt này bọc vòng tròn 32px nhìn thấy
        // (tâm vòng giữ nguyên chỗ cũ: cách mép 8px).
        width: 44,
        height: 44,
        background: 'transparent',
        ...(floating ? { position: 'absolute', top: 2, right: 2 } : {}),
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...(floating
            ? {
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--color-bg-surface)',
                boxShadow: 'var(--elevation-1)',
              }
            : {}),
        }}
      >
        <Heart
          size={size}
          strokeWidth={1.9}
          color={liked ? 'var(--color-text-danger)' : 'var(--color-text-secondary)'}
          fill={liked ? 'var(--color-text-danger)' : 'none'}
        />
      </span>
    </button>
  );
}
