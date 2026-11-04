'use client';

import { useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { addToCart, getCart } from '@tubutree/app-core/api/cart';
import { fetchProduct, type ProductCard, type VariationDetail } from '@tubutree/app-core/api/catalog';
import { QUICK_ADD_SOLD_OUT, quickAddPlan } from '@tubutree/app-core/quick-add';
import { wishlistQuery } from '@tubutree/app-core/queries/wishlist';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartKey, cartStorefrontSlug, useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { useFlashAllowance } from '@/lib/use-flash-allowance';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';

const VariationSheet = dynamic(() => import('@/components/variation-sheet').then((m) => m.VariationSheet), { ssr: false });

const NOTICE_MS = 4000;

interface Notice {
  ok: boolean;
  text: string;
}

/**
 * Nút giỏ nhanh nổi ở góc dưới ảnh thẻ: vùng chạm 44px bọc vòng trắng 32px, cùng kiểu nút tim ở góc trên.
 * Thẻ không mang phân loại nên tải chi tiết lúc bấm (cũng cho tồn kho mới nhất), rồi theo cùng luật với trang chi tiết:
 * một phân loại thì thêm thẳng, nhiều thì mở bảng chọn.
 */
export function useWishlistQuickAdd(): { buttonFor: (p: ProductCard) => ReactNode; feedback: ReactNode } {
  const qc = useQueryClient();
  const flash = useActiveFlashSales();
  const phase = useAuthPhase();
  // Giỏ cho bảng chọn: thêm giỏ cộng dồn và máy chủ giá Giờ vàng trên cả dòng, nên nút phải biết số đã có (cùng khoá với giỏ ở thanh đầu và trang sản phẩm, thêm xong `setQueryData` cập nhật).
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: () => getCart(coreHttp, cartStorefrontSlug()), enabled: phase === 'authenticated' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ product: ProductCard; variations: VariationDetail[] } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Số suất Giờ vàng khách còn mua được (đã trừ các đơn trước) cho các phân loại của sản phẩm trong bảng; không có bảng thì không có id nên không gọi.
  const flashWithAllowance = useFlashAllowance(flash, picker?.variations.map((v) => v.id) ?? []);
  // Chống bấm đúp đồng bộ: state chưa kịp render lại giữa hai cú chạm liền nhau, còn ref thì có ngay.
  const inFlight = useRef(false);

  // Tự tắt sau NOTICE_MS nhưng dừng khi trỏ/focus đang ở trên thông báo (có liên kết "Xem giỏ hàng"; WCAG 2.2.1).
  const noticeHold = useAutoDismiss(!!notice, NOTICE_MS, () => setNotice(null), notice);
  const show = (n: Notice) => setNotice(n);

  const addLine = async (variationId: string, qty: number) => {
    const cart = await addToCart(coreHttp, variationId, qty, 'wishlist', cartStorefrontSlug());
    // Badge giỏ ở header đọc cùng khoá và không remount khi khách ở lại trang này.
    qc.setQueryData(cartKey(), cart);
    show({ ok: true, text: 'Đã thêm vào giỏ!' });
  };

  const run = async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await task();
    } catch (e) {
      show({ ok: false, text: actionErrorText(e) });
      setPicker(null);
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };

  const quickAdd = (product: ProductCard) =>
    run(async () => {
      setBusyId(product.id);
      const detail = await fetchProduct(coreHttp, product.slug);
      const plan = quickAddPlan(detail.variations);
      if (plan.kind === 'soldOut') {
        show({ ok: false, text: QUICK_ADD_SOLD_OUT });
        // Thẻ còn nút giỏ và không có lớp Hết hàng nếu không tải lại: khách bấm lại sẽ ra đúng lời báo này.
        void qc.invalidateQueries({ queryKey: wishlistQuery(coreHttp).queryKey });
      }
      else if (plan.kind === 'pick') setPicker({ product, variations: detail.variations });
      else await addLine(plan.variationId, 1);
    });

  const confirmPick = (variation: { id: string }, qty: number) =>
    run(async () => {
      setBusyId(picker?.product.id ?? null);
      await addLine(variation.id, qty);
      setPicker(null);
    });

  const buttonFor = (p: ProductCard) =>
    p.inStock === false ? null : (
      <button
        type="button"
        aria-label={`Thêm ${p.name} vào giỏ`}
        aria-busy={busyId === p.id}
        aria-disabled={busyId === p.id || undefined}
        onClick={() => void quickAdd(p)}
        className="inline-flex h-11 w-11 items-center justify-center text-stone-700"
      >
        <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-stone-0 shadow-[var(--elevation-1)] ${busyId === p.id ? 'opacity-60' : ''}`}>
          <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
        </span>
      </button>
    );

  const feedback = (
    <>
      {/* Vùng báo luôn có mặt trong cây, chỉ đổi phần con: vùng live vừa gắn cùng chữ thường không được đọc ra. */}
      <div role="status">
        {notice && (
          <div
            role={notice.ok ? undefined : 'alert'}
            data-surface="inverse"
            {...noticeHold}
            className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card bg-stone-900 px-4 py-2 text-sm text-stone-0 shadow-raised"
          >
            <span>{notice.text}</span>
            {notice.ok && (
              <Link href="/gio-hang" className="inline-flex min-h-11 flex-none items-center font-semibold underline underline-offset-2">
                Xem giỏ hàng
              </Link>
            )}
          </div>
        )}
      </div>
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
          cartLines={cartQ.data?.items}
          onConfirm={(v, qty) => void confirmPick(v, qty)}
        />
      )}
    </>
  );

  return { buttonFor, feedback };
}
