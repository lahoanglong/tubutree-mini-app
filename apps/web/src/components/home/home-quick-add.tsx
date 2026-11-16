'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { fetchProduct, type ProductCard } from '@tubutree/app-core/api/catalog';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { QUICK_ADD_SOLD_OUT, quickAddPlan } from '@tubutree/app-core/quick-add';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { ProductCardQuickAddContext, type ProductCardQuickAdd } from '@/components/mini/product-card-quick-add';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { useAuthPhase } from '@/lib/auth-phase';
import { playCartFeedback } from '@/lib/cart-feedback';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { useGuestCartFlag } from '@/lib/guest-cart/flag';
import { addGuestLine, GUEST_CART_MAX_LINES } from '@/lib/guest-cart/store';
import { loginHref, rememberPendingAdd } from '@/lib/return-to';

interface AddVars {
  product: ProductCard;
  origin: Element | null;
}

/**
 * Cấp nút ＋ thêm nhanh cho mọi `ProductCard` bên dưới (chỉ Trang chủ bọc): khách đã đăng nhập đi đường giỏ nhanh dùng chung (`useQuickAdd`: một phân loại còn hàng
 * thì thêm thẳng, nhiều thì mở bảng chọn, hết hàng thì báo). Khoá theo sản phẩm: hai cú chạm sát nhau vào cùng thẻ chỉ gửi một lượt thêm, vì state chưa kịp
 * dựng lại giữa hai cú chạm. Khách chưa đăng nhập: giỏ khách khi cờ bật và chỉ có một phân loại còn hàng, còn lại nhớ món rồi sang đăng nhập như Reel;
 * đang khôi phục phiên thì chưa biết là ai nên bỏ qua cú chạm.
 */
export function HomeQuickAddProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const phase = useAuthPhase();
  const guestFlag = useGuestCartFlag();
  const { quickAdd, notify, busyId: quickBusyId, feedback } = useQuickAdd(undefined, homeBestSellerQuery(coreHttp).queryKey);

  const addAsGuest = async ({ product, origin }: AddVars) => {
    try {
      const detail = await fetchProduct(coreHttp, product.slug);
      const plan = quickAddPlan(detail.variations);
      if (plan.kind === 'soldOut') {
        notify({ ok: false, text: QUICK_ADD_SOLD_OUT });
        return;
      }
      if (plan.kind === 'add' && !guestFlag.pending && guestFlag.enabled) {
        const variation = detail.variations.find((v) => v.id === plan.variationId);
        const res = addGuestLine({ variationId: plan.variationId, slug: product.slug, quantity: 1, maxQty: variation?.stock });
        if (res.ok) {
          notify({ ok: true, text: 'Đã thêm vào giỏ!' });
          playCartFeedback(origin?.isConnected ? origin : null);
          return;
        }
        if (res.reason !== 'storage') {
          notify({ ok: false, text: res.reason === 'full' ? fillCopy('guestCart.full', { n: GUEST_CART_MAX_LINES }) : fillCopy('guestCart.atMax') });
          return;
        }
      }
      // Chỉ nhớ lượt thêm khi khách không phải chọn gì (đúng một phân loại còn hàng): nhiều phân loại thì trang sản phẩm sau đăng nhập để khách tự chọn, không thêm hộ.
      if (plan.kind === 'add') rememberPendingAdd({ variationId: plan.variationId, quantity: 1 });
      router.push(loginHref(`/san-pham/${encodeURIComponent(product.slug)}`));
    } catch (e) {
      notify({ ok: false, text: actionErrorText(e) });
    }
  };

  const mutation = useLockedMutation<void, Error, AddVars>(
    { mutationFn: (vars) => (phase === 'guest' ? addAsGuest(vars) : quickAdd(vars.product, { origin: vars.origin })) },
    (vars) => vars.product.id,
  );
  // `mutate` mới mỗi lần dựng lại: giữ `add` đứng yên để các thẻ không dựng lại chỉ vì nút ＋ của thẻ khác đổi trạng thái.
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;
  const add = useCallback<ProductCardQuickAdd['add']>(
    (product, origin) => {
      if (phase === 'loading') return;
      mutateRef.current({ product, origin });
    },
    [phase],
  );

  const guestBusyId = mutation.isPending ? (mutation.variables?.product.id ?? null) : null;
  const busyId = quickBusyId ?? guestBusyId;
  const value = useMemo<ProductCardQuickAdd>(() => ({ add, busyId }), [add, busyId]);
  return (
    <ProductCardQuickAddContext.Provider value={value}>
      {children}
      {feedback}
    </ProductCardQuickAddContext.Provider>
  );
}
