'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { restockWatchIndex, wishlistFilterView, wishlistRestockView, type WishlistFilterKey } from '@tubutree/app-core/commerce/wishlist-filter';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { wishlistQuery } from '@tubutree/app-core/queries/wishlist';
import { Chip, EmptyState as FilterEmptyState, ProductGrid, ScrollRow } from '@/components/mini';
import { EmptyState } from '@/components/empty-state';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';
import { useFlashNow } from '@/lib/flash-now';
import { useFlashListExpiry } from '@/lib/use-flash-expiry';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { useWishlistQuickAdd } from './quick-add';
import { RestockBellButton, useMyRestockAlerts, useRestockToggle } from './restock-bell';

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
  const { buttonFor, feedback, notify } = useWishlistQuickAdd();
  // Báo hàng về: chỉ hỏi khi có thẻ hết hàng (chuông và nhãn chỉ nằm trên thẻ hết hàng).
  const restockQ = useMyRestockAlerts(phase === 'authenticated' && (wishQ.data?.some((p) => p.inStock === false) ?? false));
  const watch = restockWatchIndex(restockQ.data);
  const restock = useRestockToggle(notify);
  // Cùng kho và cùng đồng hồ với `ProductCard` (không thêm request): "Đang giảm" đếm đúng món mà thẻ đang gạch giá, kể cả giá Giờ vàng, và tự cập nhật khi suất hết giờ.
  const flash = useActiveFlashSales();
  const flashNow = useFlashNow();
  useFlashListExpiry(flash);
  const [filter, setFilter] = useState<WishlistFilterKey>('all');
  // Danh sách về rỗng thì bộ lọc về Tất cả: khi có món lại (quay lại trang) trang không mở ở bộ lọc cũ.
  if (wishQ.data && wishQ.data.length === 0 && filter !== 'all') setFilter('all');

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

  // Bộ lọc chỉ có khi danh sách có món; chip đếm trên toàn danh sách, lưới và lời báo rỗng theo bộ lọc đang chọn.
  const filterView = wishQ.data && wishQ.data.length > 0 ? wishlistFilterView(wishQ.data, filter, flash, flashNow, watch) : null;
  // Chip "Chờ hàng về" vừa mất (huỷ món cuối) thì bộ lọc thật đã về Tất cả: giữ state khớp để lần có món chờ sau không tự mở lại bộ lọc cũ.
  if (filterView && filterView.active !== filter) setFilter(filterView.active);

  return (
    <Shell>
      {wishQ.isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : wishQ.isError && !wishQ.data ? (
        <ErrorState message={loadErrorText(wishQ.error)} onRetry={() => wishQ.refetch()} />
      ) : filterView ? (
        <section aria-labelledby="wishlist-list">
          <h2 id="wishlist-list" className="sr-only">
            Danh sách sản phẩm yêu thích
          </h2>
          <ScrollRow
            label={filterView.groupAria}
            style={{ display: 'flex', gap: 'var(--space-inline-sm)', paddingBlock: 'var(--space-stack-xs)', marginBottom: 'var(--space-stack-sm)' }}
          >
            {filterView.chips.map((c) => (
              <Chip key={c.key} selected={c.selected} count={c.count} onPress={() => setFilter(c.key)}>
                {c.label}
              </Chip>
            ))}
          </ScrollRow>
          {filterView.empty ? (
            <FilterEmptyState
              art="search"
              heading={filterView.empty.message}
              ctaLabel={filterView.empty.ctaLabel}
              onCta={() => {
                setFilter('all');
                // Nút vừa bấm nằm trong khối trạng thái rỗng sắp biến mất: trả focus về chip Tất cả để người dùng bàn phím không rơi về đầu trang.
                requestAnimationFrame(() =>
                  document.querySelector<HTMLButtonElement>(`[role="region"][aria-label="${filterView.groupAria}"] button[aria-pressed="true"]`)?.focus(),
                );
              }}
              variant="inline"
            />
          ) : (
            <ProductGrid
              items={filterView.items}
              variant="grid"
              noteOf={(p) => (wishlistRestockView(p, restockQ.data, watch).kind === 'waiting' ? fillCopy('wishlist.restock.waiting') : undefined)}
              renderImageOverlay={(p) => {
                if (p.inStock !== false) return buttonFor(p);
                const view = wishlistRestockView(p, restockQ.data, watch);
                if (view.kind === 'none') return null;
                return <RestockBellButton name={p.name} on={view.kind === 'waiting'} busy={restock.busy.has(p.id)} onPress={() => restock.press(p.id, view)} />;
              }}
            />
          )}
        </section>
      ) : (
        <EmptyState
          title="Chưa có sản phẩm yêu thích"
          body="Chạm biểu tượng trái tim trên sản phẩm để lưu lại xem sau."
          actionHref="/san-pham"
          actionLabel="Khám phá sản phẩm"
        />
      )}
      {/* Ngoài khối lưới: giỏ nhanh bị từ chối thì danh sách tải lại có thể làm thẻ (cả lưới) biến mất, lời lỗi không được mất theo. */}
      {feedback}
    </Shell>
  );
}
