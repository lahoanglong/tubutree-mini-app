import { useState } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { ShoppingCart } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QUICK_ADD_SOLD_OUT, quickAddPlan } from '@tubutree/app-core/quick-add';
import { getWishlist } from '../services/wishlist-api';
import { addToCart, fetchActiveFlashSales, fetchProduct, type ProductCard as ProductCardData, type VariationDetail } from '../services/shop-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { cartKey } from '../services/cart-key';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { VariationSheet } from '../components/variation-sheet';
import { AuthGate } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { ProductGrid } from '../components/ui/product-grid';
import { PageHeader } from '../components/ui/page-header';
import { EmptyState, ErrorState } from '../components/ui/empty-state';

/** Nút giỏ nhanh nổi ở góc dưới ảnh thẻ (ProductTile đặt vị trí): vùng chạm 44px bọc vòng trắng 32px, cùng kiểu với nút tim ở góc trên. */
function QuickAddButton({ name, busy, onPress }: { name: string; busy: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Thêm ${name} vào giỏ`}
      aria-busy={busy}
      disabled={busy}
      onClick={onPress}
      style={{ width: 44, height: 44, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span
        style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-1)', opacity: busy ? 0.6 : 1 }}
      >
        <ShoppingCart size={18} strokeWidth={1.9} color="var(--color-text-secondary)" />
      </span>
    </button>
  );
}

export default function WishlistPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ product: ProductCardData; variations: VariationDetail[] } | null>(null);
  const phase = useAuthPhase();
  // Gate auth: tránh gọi /me/wishlist khi chưa login → 401 → màn lỗi (đáng lẽ là empty).
  const wishQ = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist, enabled: phase === 'authenticated' });
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000, enabled: picker !== null });

  const addLine = async (variationId: string, qty: number) => {
    const cart = await addToCart(variationId, qty, 'wishlist');
    queryClient.setQueryData(cartKey(), cart);
    haptic('medium');
    openSnackbar({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
  };

  // Thẻ không mang phân loại nên tải chi tiết lúc bấm (cũng cho tồn kho mới nhất), rồi theo cùng luật với trang chi tiết.
  const quickAdd = async (product: ProductCardData) => {
    setBusyId(product.id);
    try {
      const detail = await queryClient.fetchQuery({ queryKey: ['product', product.slug], queryFn: () => fetchProduct(product.slug), staleTime: 0 });
      const plan = quickAddPlan(detail.variations);
      if (plan.kind === 'soldOut') {
        openSnackbar({ text: QUICK_ADD_SOLD_OUT, type: 'error' });
        // Thẻ còn nút giỏ và không có lớp Hết hàng nếu không tải lại: khách bấm lại sẽ ra đúng lời báo này.
        void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      } else if (plan.kind === 'pick') setPicker({ product, variations: detail.variations });
      else await addLine(plan.variationId, 1);
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const confirmPick = async (variation: { id: string }, qty: number) => {
    setBusyId(picker?.product.id ?? null);
    try {
      await addLine(variation.id, qty);
      setPicker(null);
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Sản phẩm yêu thích" />

      <AuthGate
        loading={
          <div style={{ padding: 16 }}>
            <ProductGrid items={[]} variant="grid" loading skeletonCount={4} />
          </div>
        }
      >
        <div style={{ padding: 16 }}>
          {wishQ.isLoading ? (
            <ProductGrid items={[]} variant="grid" loading skeletonCount={4} />
          ) : wishQ.isError && !wishQ.data ? (
            <ErrorState message={getLoadErrorMessage(wishQ.error)} onRetry={() => void wishQ.refetch()} />
          ) : wishQ.data && wishQ.data.length > 0 ? (
            <ProductGrid
              items={wishQ.data}
              variant="grid"
              renderImageOverlay={(p) => (p.inStock !== false ? <QuickAddButton name={p.name} busy={busyId === p.id} onPress={() => void quickAdd(p)} /> : undefined)}
            />
          ) : (
            <EmptyState
              art="sprout"
              heading="Chưa có sản phẩm yêu thích"
              body="Chạm biểu tượng trái tim trên sản phẩm để lưu lại xem sau."
              ctaLabel="Khám phá sản phẩm"
              onCta={() => navigate('/browse')}
            />
          )}
        </div>
      </AuthGate>

      {picker && (
        <VariationSheet
          open
          onClose={() => setPicker(null)}
          mode="add"
          productName={picker.product.name}
          thumbnail={picker.product.thumbnail}
          variations={picker.variations}
          flash={flashQ.data ?? []}
          initialId={picker.product.pinnedVariationId ?? picker.product.repVariationId ?? null}
          initialQty={1}
          busy={busyId === picker.product.id}
          onConfirm={confirmPick}
        />
      )}
    </Page>
  );
}
