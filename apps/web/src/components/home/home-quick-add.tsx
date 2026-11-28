'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { guestQuickAddLogin, useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { ProductCardQuickAddContext, type ProductCardQuickAdd } from '@/components/mini/product-card-quick-add';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';

interface AddVars {
  product: ProductCard;
  origin: Element | null;
}

/**
 * Cấp nút ＋ thêm nhanh cho mọi `ProductCard` bên dưới (chỉ Trang chủ bọc): khách đã đăng nhập đi đường giỏ nhanh dùng chung (`useQuickAdd`: một phân loại còn hàng
 * thì thêm thẳng, nhiều thì mở bảng chọn, hết hàng thì báo). Khoá theo sản phẩm: hai cú chạm sát nhau vào cùng thẻ chỉ gửi một lượt thêm, vì state chưa kịp
 * dựng lại giữa hai cú chạm. Khách chưa đăng nhập: giỏ khách khi cờ bật (một phân loại thì thêm thẳng, nhiều thì mở bảng chọn), cờ tắt thì nhớ món rồi sang đăng nhập như Reel;
 * đang khôi phục phiên thì chưa biết là ai nên bỏ qua cú chạm.
 */
export function HomeQuickAddProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const phase = useAuthPhase();
  // Khách chưa đăng nhập đi cùng đường giỏ nhanh: cờ giỏ khách bật thì vào giỏ trình duyệt (nhiều phân loại mở bảng chọn), tắt thì nhớ món rồi sang đăng nhập.
  const guest = useMemo(() => ({ login: guestQuickAddLogin(router) }), [router]);
  const { quickAdd, busyId: quickBusyId, feedback, notify } = useQuickAdd(undefined, homeBestSellerQuery(coreHttp).queryKey, { guest });

  const mutation = useLockedMutation<void, Error, AddVars>(
    {
      // Thẻ ghim phân loại (thẻ Giờ Xanh mang phân loại của suất): bảng chọn mở sẵn phân loại đó, như Mini App.
      // Lỗi điều hướng sang đăng nhập (ném sau lượt thêm) không được rơi vào `mutate` (React Query nuốt): báo cho khách thay vì im lặng.
      mutationFn: async (vars) => {
        try {
          await quickAdd(vars.product, { origin: vars.origin, initialId: vars.product.pinnedVariationId ?? null });
        } catch (e) {
          notify({ ok: false, text: actionErrorText(e) });
        }
      },
    },
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
