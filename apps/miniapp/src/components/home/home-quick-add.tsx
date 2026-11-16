import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QUICK_ADD_SOLD_OUT, quickAddPlan } from '@tubutree/app-core/quick-add';
import { useAuthPhase } from '../../hooks/use-auth-phase';
import { useFlashAllowance } from '../../hooks/use-flash-allowance';
import { useLoginWithNotice } from '../../hooks/use-login-notice';
import { useNotify } from '../../hooks/use-notify';
import { vi } from '../../i18n/vi';
import { getErrorMessage, isStaleStateError, isTargetGoneError } from '../../services/api';
import { cartKey, useCartKey } from '../../services/cart-key';
import { addToCart, fetchActiveFlashSales, fetchProduct, getCart, type ProductCard, type VariationDetail } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { playCartFeedback } from '../../utils/cart-feedback';
import { haptic } from '../../utils/haptic';
import { closeAfterFresh, settleWithin } from '../../utils/settle-within';
import { useLockedMutation } from '../game/use-locked-mutation';
import { ProductCardQuickAddContext } from '../ui/product-card-quick-add';
import { homeBestSellerQuery } from './home-best-seller-query';

// Bảng chọn phân loại chỉ dựng khi khách chạm ＋ trên món có từ hai phân loại: nạp lười để gói đầu của Trang chủ không gánh nó.
const VariationSheet = lazy(() => import('../variation-sheet').then((m) => ({ default: m.VariationSheet })));

const FLASH_STALE_MS = 30_000;

interface QuickAddVars {
  product: ProductCard;
  origin: Element | null;
}

interface Picking {
  product: ProductCard;
  variations: VariationDetail[];
}

interface PickVars {
  productId: string;
  slug: string;
  variationId: string;
  qty: number;
}

/** Danh sách của Trang chủ đang hiện tồn kho của món: tải lại khi máy chủ từ chối để thẻ hết còn nút ＋ trên tồn cũ. */
function refreshHomeLists(queryClient: ReturnType<typeof useQueryClient>): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: homeBestSellerQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: ['products', 'home-suggest'] }),
    queryClient.invalidateQueries({ queryKey: ['for-you'] }),
  ]);
}

function QuickAddPicker({ picking, busy, onClose, onConfirm }: { picking: Picking; busy: boolean; onClose: () => void; onConfirm: (id: string, qty: number) => void }) {
  const phase = useAuthPhase();
  const { product } = picking;
  // Tồn kho sống từ chi tiết món (cùng khoá với trang chi tiết): sau lệnh bị từ chối ("Chỉ còn N") lần tải lại cập nhật luôn trần số lượng của bảng đang mở.
  const variations = useQuery({ queryKey: ['product', product.slug], queryFn: () => fetchProduct(product.slug), staleTime: 60_000 }).data?.variations ?? picking.variations;
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: FLASH_STALE_MS });
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const flash = useFlashAllowance(flashQ.data, variations.map((v) => v.id));
  return (
    <Suspense fallback={null}>
      <VariationSheet
        open
        onClose={onClose}
        mode="add"
        productName={product.name}
        thumbnail={product.thumbnail}
        variations={variations}
        flash={flash}
        initialId={product.pinnedVariationId ?? product.repVariationId ?? null}
        initialQty={1}
        busy={busy}
        cartLines={cartQ.data?.items}
        onConfirm={(v, qty) => onConfirm(v.id, qty)}
      />
    </Suspense>
  );
}

/**
 * Nút ＋ trên thẻ sản phẩm của Trang chủ (Bán chạy nhất, Gợi ý): thẻ không mang phân loại nên tải chi tiết lúc chạm (cũng cho tồn kho mới nhất), rồi theo cùng luật
 * với Yêu thích và Reel: một phân loại còn hàng thì thêm thẳng, từ hai thì mở bảng chọn, hết hàng thì báo và tải lại danh sách. Chưa đăng nhập thì mời đăng nhập trước
 * rồi thêm tiếp. Khoá theo sản phẩm là ref đồng bộ (`useLockedMutation`): hai cú chạm sát nhau vào cùng thẻ chỉ gửi một lệnh, và khi máy chủ từ chối khoá giữ tới khi
 * danh sách mới về.
 */
export function HomeQuickAddProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const loginWithNotice = useLoginWithNotice();
  const [picking, setPicking] = useState<Picking | null>(null);

  const addLine = async (variationId: string, qty: number, origin: Element | null) => {
    const cart = await addToCart(variationId, qty);
    queryClient.setQueryData(cartKey(), cart);
    haptic('medium');
    playCartFeedback(origin?.isConnected ? origin : null);
    notify({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
  };

  const quick = useLockedMutation<void, unknown, QuickAddVars>(
    {
      mutationFn: async ({ product, origin }) => {
        const status = useAuthStore.getState().status;
        if (status === 'loading') return;
        if (status !== 'authenticated') {
          await loginWithNotice();
          if (useAuthStore.getState().status !== 'authenticated') return;
        }
        const detail = await queryClient.fetchQuery({ queryKey: ['product', product.slug], queryFn: () => fetchProduct(product.slug), staleTime: 0 });
        const plan = quickAddPlan(detail.variations);
        if (plan.kind === 'soldOut') {
          notify({ text: QUICK_ADD_SOLD_OUT, type: 'error' });
          // Thẻ còn nút ＋ và không có lớp Hết hàng nếu không tải lại: khách chạm lại sẽ ra đúng lời báo này.
          void refreshHomeLists(queryClient);
        } else if (plan.kind === 'pick') setPicking({ product, variations: detail.variations });
        else await addLine(plan.variationId, 1, origin);
      },
      onError: (e) => notify({ text: getErrorMessage(e), type: 'error' }),
      // Máy chủ từ chối (400/404/409): giữ khoá tới khi danh sách mới về (tối đa `settleWithin`), kẻo chạm lại trên thẻ cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: nhả ngay.
      onSettled: (_data, error) => (isStaleStateError(error) ? settleWithin(refreshHomeLists(queryClient)) : undefined),
    },
    (v) => v.product.id,
  );

  const pick = useLockedMutation<void, unknown, PickVars>(
    {
      mutationFn: async ({ variationId, qty }) => {
        await addLine(variationId, qty, null);
      },
      onSuccess: (_data, v) => setPicking((cur) => (cur?.product.id === v.productId ? null : cur)),
      // Bảng có ô số lượng nên 400 ("Chỉ còn N") và 422 giữ bảng để giảm số lượng; mất mạng, quá hạn, 401, 5xx cũng giữ bảng để thử lại. Món/phân loại không còn (404/409):
      // đóng bảng SAU khi danh sách mới về, và chỉ bảng của đúng món này (bảng có thể đã đổi sang món khác trong lúc lệnh bay).
      onError: (e, v) => {
        notify({ text: getErrorMessage(e), type: 'error' });
        const held = isStaleStateError(e)
          ? settleWithin(Promise.all([refreshHomeLists(queryClient), queryClient.invalidateQueries({ queryKey: ['product', v.slug] })]))
          : undefined;
        return closeAfterFresh(held, () => {
          if (isTargetGoneError(e)) setPicking((cur) => (cur?.product.id === v.productId ? null : cur));
        });
      },
    },
    (v) => v.productId,
  );

  // `mutate` của khoá đổi danh tính mỗi lần vẽ: giữ bản mới nhất trong ref để `add` đứng yên và context chỉ đổi khi `busyId` đổi.
  const quickMutate = useRef(quick.mutate);
  quickMutate.current = quick.mutate;
  const add = useCallback((product: ProductCard, origin: Element | null) => quickMutate.current({ product, origin }), []);
  const busyId = quick.isPending ? (quick.variables?.product.id ?? null) : pick.isPending ? (pick.variables?.productId ?? null) : null;
  const value = useMemo(() => ({ add, busyId }), [add, busyId]);

  return (
    <ProductCardQuickAddContext.Provider value={value}>
      {children}
      {picking && (
        <QuickAddPicker
          picking={picking}
          busy={pick.isPending && pick.variables?.productId === picking.product.id}
          onClose={() => setPicking(null)}
          onConfirm={(variationId, qty) => pick.mutate({ productId: picking.product.id, slug: picking.product.slug, variationId, qty })}
        />
      )}
    </ProductCardQuickAddContext.Provider>
  );
}
