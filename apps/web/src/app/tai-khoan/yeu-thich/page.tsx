'use client';

import { useQuery } from '@tanstack/react-query';
import { wishlistQuery } from '@tubutree/app-core/queries/wishlist';
import ProductCard from '@/components/product-card';
import { EmptyState } from '@/components/empty-state';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { PAGE_WIDE } from '@/lib/page-frame';
import { GRID_PRODUCTS } from '@/lib/product-grid';

const TITLE = 'Sản phẩm yêu thích';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className={`${PAGE_WIDE} py-6`}>
      <PageHeader title={TITLE} backHref="/tai-khoan" backLabel="Tài khoản" />
      <div className="mt-4">{children}</div>
    </main>
  );
}

export default function WishlistPage() {
  const phase = useAuthPhase();
  // Chờ đăng nhập xong mới gọi: khách chưa đăng nhập gọi /me/wishlist sẽ ra 401 và hiện lỗi thay vì trạng thái rỗng.
  const wishQ = useQuery({ ...wishlistQuery(coreHttp), enabled: phase === 'authenticated' });

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để xem sản phẩm yêu thích của bạn." returnTo="/tai-khoan/yeu-thich" />
      </Shell>
    );
  }

  return (
    <Shell>
      {wishQ.isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : wishQ.isError && !wishQ.data ? (
        <ErrorState message={wishQ.error instanceof Error ? wishQ.error.message : undefined} onRetry={() => void wishQ.refetch()} />
      ) : wishQ.data && wishQ.data.length > 0 ? (
        <section aria-labelledby="wishlist-list">
          <h2 id="wishlist-list" className="sr-only">
            Danh sách sản phẩm yêu thích
          </h2>
          <div className={GRID_PRODUCTS}>
            {wishQ.data.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="Chưa có sản phẩm yêu thích"
          body="Chạm biểu tượng trái tim trên sản phẩm để lưu lại xem sau."
          actionHref="/san-pham"
          actionLabel="Khám phá sản phẩm"
        />
      )}
    </Shell>
  );
}
