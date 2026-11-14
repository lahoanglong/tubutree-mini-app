import { useRef, useState, type ReactNode } from 'react';
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
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';
import { VariationSheet } from '../variation-sheet';

const FLASH_STALE_MS = 30_000;

interface Picking {
  card: ProductCard;
  variations: VariationDetail[];
}

/**
 * Bảng chọn phân loại khi sản phẩm của bộ gợi ý có từ hai phân loại còn hàng. Tồn kho sống lấy từ chi tiết món (cùng khoá `['product', slug]` với trang chi tiết),
 * để sau lệnh bị từ chối ("Chỉ còn N") lần tải lại cập nhật luôn trần số lượng của bảng đang mở.
 */
function KitVariationPicker({ card, variations: opened, onClose, onConfirm }: { card: ProductCard; variations: VariationDetail[]; onClose: () => void; onConfirm: (id: string, qty: number) => Promise<void> }) {
  const phase = useAuthPhase();
  const variations = useQuery({ queryKey: ['product', card.slug], queryFn: () => fetchProduct(card.slug), staleTime: 60_000 }).data?.variations ?? opened;
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: FLASH_STALE_MS });
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const flash = useFlashAllowance(flashQ.data, variations.map((v) => v.id));
  const [busy, setBusy] = useState(false);
  return (
    <VariationSheet
      open
      onClose={onClose}
      mode="add"
      productName={card.name}
      thumbnail={card.thumbnail}
      variations={variations}
      flash={flash}
      initialId={card.pinnedVariationId ?? card.repVariationId ?? null}
      initialQty={1}
      busy={busy}
      cartLines={cartQ.data?.items}
      onConfirm={async (v, qty) => {
        setBusy(true);
        try {
          await onConfirm(v.id, qty);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/**
 * "+ Thêm vào giỏ" một chạm cho các món của bộ gợi ý. Thẻ danh sách không mang phân loại nên tải chi tiết lúc bấm (cũng cho tồn kho mới nhất), rồi theo cùng luật
 * của Yêu thích và Reel: một phân loại còn hàng thì thêm thẳng, từ hai thì mở bảng chọn, hết hàng thì báo. Chưa đăng nhập thì mời đăng nhập trước rồi thêm tiếp.
 * Khoá `adding` là ref đồng bộ: hai cú chạm sát nhau (kể cả hai món khác nhau) chỉ gửi một lệnh.
 */
export function useKitQuickAdd(): { add: (card: ProductCard) => Promise<void>; picker: ReactNode } {
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const loginWithNotice = useLoginWithNotice();
  const adding = useRef(false);
  const [picking, setPicking] = useState<Picking | null>(null);

  const addLine = async (variationId: string, qty: number) => {
    const cart = await addToCart(variationId, qty);
    queryClient.setQueryData(cartKey(), cart);
    haptic('medium');
    notify({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
  };

  // Máy chủ từ chối (400/404/409): làm mới giỏ và danh sách trước khi nhả khoá, kẻo chạm lại trên số liệu cũ nhận đúng lỗi đó.
  const reloadIfRejected = async (error: unknown) => {
    if (!isStaleStateError(error)) return;
    await settleWithin(Promise.all([queryClient.invalidateQueries({ queryKey: ['cart'] }), queryClient.invalidateQueries({ queryKey: ['products'] })]));
  };

  const add = async (card: ProductCard) => {
    if (adding.current) return;
    adding.current = true;
    try {
      if (useAuthStore.getState().status !== 'authenticated') {
        await loginWithNotice();
        if (useAuthStore.getState().status !== 'authenticated') return;
      }
      const detail = await queryClient.fetchQuery({ queryKey: ['product', card.slug], queryFn: () => fetchProduct(card.slug), staleTime: 0 });
      const plan = quickAddPlan(detail.variations);
      if (plan.kind === 'soldOut') {
        notify({ text: QUICK_ADD_SOLD_OUT, type: 'error' });
        void queryClient.invalidateQueries({ queryKey: ['products'] });
      } else if (plan.kind === 'pick') setPicking({ card, variations: detail.variations });
      else await addLine(plan.variationId, 1);
    } catch (e) {
      notify({ text: getErrorMessage(e), type: 'error' });
      await reloadIfRejected(e);
    } finally {
      adding.current = false;
    }
  };

  const confirmPick = async (variationId: string, qty: number) => {
    if (adding.current) return;
    adding.current = true;
    const slug = picking?.card.slug;
    try {
      await addLine(variationId, qty);
      setPicking(null);
    } catch (e) {
      notify({ text: getErrorMessage(e), type: 'error' });
      await reloadIfRejected(e);
      // Bảng có ô số lượng nên 400 ("Chỉ còn N") giữ bảng để giảm số lượng; chỉ khi món hoặc phân loại không còn (404/409) mới đóng, và chỉ đóng bảng của đúng món này.
      if (isTargetGoneError(e)) setPicking((cur) => (cur?.card.slug === slug ? null : cur));
    } finally {
      adding.current = false;
    }
  };

  const picker = picking ? <KitVariationPicker card={picking.card} variations={picking.variations} onClose={() => setPicking(null)} onConfirm={confirmPick} /> : null;
  return { add, picker };
}
