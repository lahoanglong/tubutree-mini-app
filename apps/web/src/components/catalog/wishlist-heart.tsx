'use client';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { addWishlist, removeWishlist } from '@tubutree/app-core/api/wishlist';
import { wishlistIdsQuery } from '@tubutree/app-core/queries/wishlist';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loginHref } from '@/lib/return-to';

const IDS_KEY = wishlistIdsQuery(coreHttp).queryKey;

// Mỗi sản phẩm một hàng đợi: lệnh thêm/bỏ gửi lần lượt đúng thứ tự chạm, nên chạm nhanh không còn hai lệnh "thêm" đua nhau (409).
const tails = new Map<string, Promise<void>>();
let inFlight = 0;

function sendToggle(qc: QueryClient, productId: string, want: boolean) {
  inFlight += 1;
  const tail: Promise<void> = (tails.get(productId) ?? Promise.resolve())
    .then(async () => {
      try {
        await (want ? addWishlist(coreHttp, productId) : removeWishlist(coreHttp, productId));
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
 * Nút tim yêu thích, tự đọc danh sách id đã thích. Mỗi lần chạm đổi tim ngay trên cache theo trạng thái mới nhất (kể cả lần chạm trước
 * chưa có phản hồi) rồi xếp lệnh vào hàng đợi; chỉ tải lại từ máy chủ khi không còn lệnh nào chờ để không ghi đè trạng thái lạc quan.
 * Khách chưa đăng nhập vẫn thấy nút; chạm thì sang đăng nhập rồi quay lại đúng trang.
 */
export function WishlistHeart({
  productId,
  className = '',
  floating = false,
}: {
  productId: string;
  className?: string;
  /** Nổi trên góc ảnh thẻ như Mini App: vùng chạm 44px bọc vòng trắng 32px; đặt ở cha có `position: relative`. */
  floating?: boolean;
}) {
  const phase = useAuthPhase();
  const router = useRouter();
  const qc = useQueryClient();
  const authed = phase === 'authenticated';

  const idsQ = useQuery({ ...wishlistIdsQuery(coreHttp), enabled: authed, staleTime: 60_000 });
  const liked = idsQ.data?.includes(productId) ?? false;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (phase === 'guest') {
      router.push(loginHref(`${window.location.pathname}${window.location.search}`));
      return;
    }
    if (!authed) return;
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
      onClick={onClick}
      className={`inline-flex h-11 w-11 items-center justify-center text-stone-700 ${floating ? 'absolute right-0.5 top-0.5' : 'rounded-control hover:bg-stone-50'} ${className}`}
    >
      {floating ? (
        <span data-testid="heart-disc" className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-0 shadow-[var(--elevation-1)]">
          <Heart className={`h-[22px] w-[22px] ${liked ? 'fill-danger-fg text-danger-fg' : ''}`} strokeWidth={1.9} aria-hidden="true" />
        </span>
      ) : (
        <Heart className={`h-[22px] w-[22px] ${liked ? 'fill-danger-fg text-danger-fg' : ''}`} strokeWidth={1.9} aria-hidden="true" />
      )}
    </button>
  );
}
