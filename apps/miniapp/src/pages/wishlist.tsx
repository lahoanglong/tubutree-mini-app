import { useRef, useState } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { ShoppingCart } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QUICK_ADD_SOLD_OUT, quickAddPlan } from '@tubutree/app-core/quick-add';
import { wishlistFilterView, type WishlistFilterKey } from '@tubutree/app-core/commerce/wishlist-filter';
import { getWishlist } from '../services/wishlist-api';
import { addToCart, fetchActiveFlashSales, fetchProduct, getCart, type ProductCard as ProductCardData, type VariationDetail } from '../services/shop-api';
import { getErrorMessage, getLoadErrorMessage, isStaleStateError, isTargetGoneError } from '../services/api';
import { cartKey, useCartKey } from '../services/cart-key';
import { serverNow } from '../utils/server-clock';
import { settleWithin } from '../utils/settle-within';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { playCartFeedback } from '../utils/cart-feedback';
import { VariationSheet } from '../components/variation-sheet';
import { useFlashAllowance } from '../hooks/use-flash-allowance';
import { useFlashListExpiry } from '../hooks/use-flash-expiry';
import { AuthGate } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { ProductGrid } from '../components/ui/product-grid';
import { Chip } from '../components/ui/chip';
import { ScrollRow } from '../components/ui/scroll-row';
import { PageHeader } from '../components/ui/page-header';
import { EmptyState, ErrorState } from '../components/ui/empty-state';

/** Nút giỏ nhanh nổi ở góc dưới ảnh thẻ (ProductTile đặt vị trí): vùng chạm 44px bọc vòng trắng 32px, cùng kiểu với nút tim ở góc trên. */
function QuickAddButton({ name, busy, onPress }: { name: string; busy: boolean; onPress: (source: Element) => void }) {
  return (
    <button
      type="button"
      aria-label={`Thêm ${name} vào giỏ`}
      aria-busy={busy}
      onClick={(e) => onPress(e.currentTarget)}
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
  // `busyId` chỉ đúng sau lần vẽ kế tiếp: hai cú chạm sát nhau vẫn đều thấy nút rảnh và cộng giỏ hai lần. Ref đồng bộ, dùng chung cho
  // quickAdd và confirmPick vì cả hai cùng ghi vào giỏ.
  const adding = useRef(false);
  const [filter, setFilter] = useState<WishlistFilterKey>('all');
  const [picker, setPicker] = useState<{ product: ProductCardData; variations: VariationDetail[] } | null>(null);
  const phase = useAuthPhase();
  // Gate auth: tránh gọi /me/wishlist khi chưa login → 401 → màn lỗi (đáng lẽ là empty).
  const wishQ = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist, enabled: phase === 'authenticated' });
  // Cùng khoá với `ProductCard` (thẻ trong lưới đã tự đọc) nên bật ở đây không thêm request: bộ lọc "Đang giảm" cần đúng danh sách mà thẻ dùng để gạch giá Giờ vàng.
  const hasItems = (wishQ.data?.length ?? 0) > 0;
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000, enabled: hasItems || picker !== null });
  useFlashListExpiry(flashQ.data ?? []);
  // Giỏ cho bảng chọn: thêm giỏ cộng dồn và máy chủ giá Giờ vàng trên cả dòng, nên nút phải biết số đã có (cùng khoá với giỏ ở trang chi tiết, thêm xong `setQueryData` cập nhật).
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });

  // Số suất Giờ vàng khách còn mua được (đã trừ các đơn trước) cho các phân loại của sản phẩm trong bảng; không có bảng thì không có id nên không gọi.
  const flashWithAllowance = useFlashAllowance(flashQ.data, picker?.variations.map((v) => v.id) ?? []);

  // Danh sách về rỗng thì bộ lọc về Tất cả: khi có món lại (quay lại trang trong ngăn xếp) trang không mở ở bộ lọc cũ.
  if (wishQ.data && wishQ.data.length === 0 && filter !== 'all') setFilter('all');
  // Bộ lọc chỉ có khi danh sách có món; chip đếm trên toàn danh sách, lưới và lời báo rỗng theo bộ lọc đang chọn.
  const filterView = wishQ.data && wishQ.data.length > 0 ? wishlistFilterView(wishQ.data, filter, flashQ.data ?? [], serverNow()) : null;

  const addLine = async (variationId: string, qty: number, source: Element | null = null) => {
    const cart = await addToCart(variationId, qty, 'wishlist');
    queryClient.setQueryData(cartKey(), cart);
    haptic('medium');
    playCartFeedback(source?.isConnected ? source : null);
    openSnackbar({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
  };

  // Máy chủ từ chối (400/404/409: hết hàng, món không còn): tải lại danh sách để thẻ hiện đúng trạng thái và giữ khoá `adding` tới khi dữ liệu về (tối đa `settleWithin`),
  // kẻo bấm lại trên thẻ cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
  const reloadIfRejected = async (error: unknown) => {
    if (!isStaleStateError(error)) return;
    await settleWithin(queryClient.invalidateQueries({ queryKey: ['wishlist'] }));
  };

  // Thẻ không mang phân loại nên tải chi tiết lúc bấm (cũng cho tồn kho mới nhất), rồi theo cùng luật với trang chi tiết.
  const quickAdd = async (product: ProductCardData, source: Element | null = null) => {
    if (adding.current) return;
    adding.current = true;
    setBusyId(product.id);
    try {
      const detail = await queryClient.fetchQuery({ queryKey: ['product', product.slug], queryFn: () => fetchProduct(product.slug), staleTime: 0 });
      const plan = quickAddPlan(detail.variations);
      if (plan.kind === 'soldOut') {
        openSnackbar({ text: QUICK_ADD_SOLD_OUT, type: 'error' });
        // Thẻ còn nút giỏ và không có lớp Hết hàng nếu không tải lại: khách bấm lại sẽ ra đúng lời báo này.
        void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      } else if (plan.kind === 'pick') setPicker({ product, variations: detail.variations });
      else await addLine(plan.variationId, 1, source);
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      await reloadIfRejected(e);
    } finally {
      adding.current = false;
      setBusyId(null);
    }
  };

  const confirmPick = async (variation: { id: string }, qty: number) => {
    if (adding.current) return;
    adding.current = true;
    const pickedId = picker?.product.id ?? null;
    setBusyId(pickedId);
    try {
      await addLine(variation.id, qty);
      setPicker(null);
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Món/phân loại không còn (404/409): đóng bảng của đúng món này (bảng có thể đã đổi sang món khác trong lúc lệnh bay). Bảng có ô số lượng nên 400 ("Chỉ còn N") và 422 giữ bảng để giảm số lượng; mất mạng, quá hạn, 401, 5xx cũng giữ bảng để thử lại.
      if (isTargetGoneError(e)) setPicker((cur) => (cur?.product.id === pickedId ? null : cur));
      await reloadIfRejected(e);
    } finally {
      adding.current = false;
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
            <ErrorState message={getLoadErrorMessage(wishQ.error)} onRetry={() => wishQ.refetch()} />
          ) : filterView ? (
            <>
              <ScrollRow
                label={filterView.groupAria}
                style={{ display: 'flex', gap: 'var(--space-inline-sm)', paddingBlock: 'var(--space-stack-xs)', marginBottom: 'var(--space-stack-sm)' }}
              >
                {filterView.chips.map((c) => (
                  <Chip
                    key={c.key}
                    selected={c.selected}
                    count={c.count}
                    onPress={() => {
                      haptic('light');
                      setFilter(c.key);
                    }}
                  >
                    {c.label}
                  </Chip>
                ))}
              </ScrollRow>
              {filterView.empty ? (
                <EmptyState
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
                  renderImageOverlay={(p) => (p.inStock !== false ? <QuickAddButton name={p.name} busy={busyId === p.id} onPress={(source) => void quickAdd(p, source)} /> : undefined)}
                />
              )}
            </>
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
          flash={flashWithAllowance}
          initialId={picker.product.pinnedVariationId ?? picker.product.repVariationId ?? null}
          initialQty={1}
          busy={busyId === picker.product.id}
          cartLines={cartQ.data?.items}
          onConfirm={confirmPick}
        />
      )}
    </Page>
  );
}
