import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Page, useNavigate, useSnackbar } from 'zmp-ui';
import { Box } from '../components/ui/box';
import { useSmartNavigate } from '../lib/smart-nav';
import { useQuery, useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { Trash2, Ticket, ChevronRight, AlertTriangle, Zap } from 'lucide-react';
import { cartSaving, lineCompareAt } from '@tubutree/app-core/commerce/pdp-view';
import { cartTotalLabel } from '@tubutree/app-core/commerce/cart-total';
import { cartShippingView } from '@tubutree/app-core/api/shipping-estimate';
import { cartStockNote, isLowStock, overStockTarget, qtyPickMax } from '@tubutree/app-core/commerce/stock-text';
import { cartComboBlocks, comboRemovalNotice, comboSavingPending, type ComboRemovalNotice } from '@tubutree/app-core/commerce/cart-combo';
import { aovGiftExclusions, aovGiftLockedRowShown, aovUpsellGoal } from '@tubutree/app-core/cart/aov-upsell';
import { cartPricingLines, cartRefetchOnReturn, soldOutRecovery, type SoldOutRecovery } from '@tubutree/app-core/cart/sold-out-recovery';
import { cartGiftThreshold } from '@tubutree/app-core/commerce/cart-progress';
import { cartUnlockLevel, freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import {
  cartProgressStrip,
  comboOnlyDiscount,
  greenBoxCartHint,
  greenBoxDiscountOf,
  greenBoxProgress,
  greenBoxTierRise,
  greenBoxWebCopy,
  readGreenBox,
  type GreenBoxProgressView,
  type GreenBoxState,
} from '@tubutree/app-core/commerce/green-box';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import {
  getAddresses,
  getCart,
  getCartSelection,
  updateCartItem,
  removeCartItem,
  addToCart,
  setCartGift,
  type CartSummary,
  type CartLine,
  type UnavailableCartLine,
} from '../services/shop-api';
import { cartPreviewKey, cartProductIds } from '../utils/coupon-scope';
import { getErrorMessage, getLoadErrorMessage, isStaleStateError } from '../services/api';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { SuggestedRail } from '../components/catalog/suggested-rail';
import { formatVnd } from '../utils/format';
import { clampPercent } from '../utils/flash-display';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { PREVIEW_DEBOUNCE_MS, useDebounced } from '../utils/use-debounced';
import { recompute } from '../utils/cart-rules';
import { StorefrontContextBar } from '../components/storefront-context-bar';
import { VoucherSheet } from '../components/checkout/voucher-sheet';
import { couponHintShort } from '@tubutree/app-core/coupon-use';
import { couponCapNoteText, couponNoticeText, heldCouponNotice } from '@tubutree/app-core/coupon-min-order';
import { CouponRemovedNotice } from '../components/checkout/coupon-removed-notice';
import { useRemovedCoupon } from '../hooks/use-removed-coupon';
import { useStorefrontContext } from '../store/storefront-context';
import { rememberCheckoutSelection } from '../utils/checkout-selection';
import { subtotalBucket } from '@tubutree/shared-types';
import { setCheckoutEntry, trackEvent } from '../services/analytics';
import { isTransientError } from '../services/query-client';
import { PageHeader } from '../components/ui/page-header';
import { Checkbox } from '../components/ui/form';
import { SR_ONLY } from '../components/ui/sr-only';
import { IconButton } from '../components/ui/icon-button';
import { KeyValueRow } from '../components/ui/key-value-row';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useLockedMutation } from '../components/game/use-locked-mutation';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { PriceTag } from '../components/ui/price-tag';
import { Heading, Text } from '../components/ui/text';
import { fulfillerLabel, groupByFulfiller, showFulfillerHeaders, tubuSubtotal } from '../utils/shipments';
import { cartKey, useCartKey } from '../services/cart-key';
import { useNotify } from '../hooks/use-notify';
import { ProductThumb } from '../components/ui/product-thumb';
import { Countdown } from '../components/ui/countdown';
import { ConfirmSheet } from '../components/ui/confirm-sheet';
import { CartComboBlock } from '../components/cart-combo-block';
import { GiftNote, GiftTrialRow } from '../components/checkout/gift-rows';
import { FreeShippingProgressBar } from '../components/ui/free-shipping-progress-bar';
import type { FreeshipAddonItem } from '../components/ui/freeship-addon-rail';
import { FreeshipBoosterRail } from '../components/cart/freeship-booster/freeship-booster-rail';
import { CartUnlockSlot } from '../components/cart/freeship-booster/cart-unlock-slot';
import { CartVoucherHintStrip } from '../components/ui/cart-voucher-hint-strip';
import { useCartVoucherHint } from '../components/checkout/use-cart-voucher-hint';
import { useShippingEstimate } from '../components/checkout/use-shipping-estimate';
import { settleWithin } from '../utils/settle-within';
import { refillConfirmText, refillSwapOffers } from '@tubutree/app-core/refill/refill-swap';
import { refillSavingBadge } from '@tubutree/app-core/refill/refill-saving';
import { RefillSwapLink } from '../components/refill/refill-swap-link';
import { useCartRefill } from '../components/refill/use-cart-refill';
import { CartNudges } from '../components/cart/cart-nudges';
import { joinVariationLine, variationLabel } from '../utils/variation-label';

const UNDO_WINDOW_MS = 3500;

/** Tồn giả định của dòng vừa thêm từ dải gợi ý trong lúc chờ máy chủ: 99 là mức "còn nhiều" mà API công khai trả cho tồn trên 20, nên dòng không hiện câu "chỉ còn" nhất thời. Lần đọc lại giỏ thay bằng số thật. */
const ADDON_PENDING_STOCK = 99;

/** Tên phân loại của dòng giỏ có thể là đối tượng `{ name }` (mã cũ đọc cả dạng này); kiểu khai báo là chuỗi nên đọc qua `unknown`. */
const legacyVariationName = (v: unknown): string | null | undefined =>
  typeof v === 'object' && v !== null ? (v as { name?: string }).name : (v as string | null | undefined);

/** Dòng tạm chưa có mã thật ở máy chủ: không cho đổi số lượng, xoá hay tính vào đơn cho tới khi giỏ đọc lại (mã `pending-…` gửi lên sẽ 404). */
const isPendingAddonLine = (line: CartLine) => line.id.startsWith('pending-');

/** Dòng giỏ tạm của món bù đơn vừa bấm "+ Thêm", để thanh Miễn phí giao hàng chạy ngay; số thật về khi giỏ được đọc lại. */
function pendingAddonLine(item: FreeshipAddonItem): CartLine {
  return {
    id: `pending-${item.variationId}`,
    variationId: item.variationId,
    productName: item.name,
    variationName: '',
    slug: item.slug,
    thumbnail: item.thumbnail,
    unitPrice: item.price,
    listUnitPrice: item.compareAt ?? null,
    quantity: 1,
    stock: ADDON_PENDING_STOCK,
    total: item.price,
  };
}

/**
 * Mutation giỏ hàng kiểu optimistic (AD-005):
 * cancel queries → snapshot → áp ngay vào cache → rollback nếu lỗi → invalidate khi xong.
 */
// Số lệnh sửa giỏ đang bay theo từng QueryClient, đếm đồng bộ (cộng ở đầu onMutate, trừ ở đầu onSettled): hai lệnh xong cùng lúc thì lệnh xong sau luôn thấy 0.
const editsInFlight = new WeakMap<QueryClient, number>();
function countEdits(queryClient: QueryClient, delta: number): number {
  const next = (editsInFlight.get(queryClient) ?? 0) + delta;
  editsInFlight.set(queryClient, next);
  return next;
}

// Mọi lệnh sửa MỘT dòng (đổi số lượng, xoá) xếp hàng theo thứ tự bấm, theo từng QueryClient (rời trang rồi quay lại khi lệnh cũ còn bay vẫn xếp sau nó):
// bay song song thì máy chủ có thể nhận đảo thứ tự, hoặc lệnh xoá tới trước làm lệnh đổi số lượng nhận 404 và hoàn lại dòng đã xoá.
const lineQueues = new WeakMap<QueryClient, Map<string, Promise<unknown>>>();
function inLineOrder<T>(queryClient: QueryClient, id: string, task: () => Promise<T>): Promise<T> {
  let queue = lineQueues.get(queryClient);
  if (!queue) {
    queue = new Map();
    lineQueues.set(queryClient, queue);
  }
  const lanes = queue;
  const run = (lanes.get(id) ?? Promise.resolve()).then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  lanes.set(id, tail);
  void tail.then(() => {
    if (lanes.get(id) === tail) lanes.delete(id);
  });
  return run;
}

function useOptimisticCartOptions<TVars>(
  mutationFn: (vars: TVars) => Promise<CartSummary>,
  apply: (prev: CartSummary, vars: TVars) => CartSummary,
  onResponse?: (response: CartSummary, vars: TVars) => void,
): UseMutationOptions<CartSummary, unknown, TVars, { prev: CartSummary | undefined }> {
  const queryClient = useQueryClient();
  const { openSnackbar } = useSnackbar();
  return {
    mutationFn,
    onMutate: async (vars: TVars) => {
      countEdits(queryClient, 1);
      await queryClient.cancelQueries({ queryKey: ['cart'] });
      const prev = queryClient.getQueryData<CartSummary>(cartKey());
      if (prev) queryClient.setQueryData(cartKey(), apply(prev, vars));
      return { prev };
    },
    // Phản hồi không ghi vào cache (bấm +/− liên tiếp không bị phản hồi cũ kéo số lượng lùi; số đúng do lần đọc lại sau `onSettled` cập nhật), nhưng
    // `couponRemoved` chỉ nằm ở phản hồi này nên chuyển cho nơi nhớ lời báo.
    onSuccess: (data, vars) => onResponse?.(data, vars),
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(cartKey(), ctx.prev);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Máy chủ từ chối vì giỏ đã khác (400/404/409): giữ khoá/cờ bận của lệnh tới khi giỏ thật về (tối đa `settleWithin`), kẻo bấm lại trên số cũ vừa hoàn nhận đúng lỗi đó.
      // Còn lệnh sửa khác đang bay thì để lệnh xong cuối đọc lại (ở `onSettled`): đọc về lúc này chưa có lệnh kia. Mất mạng, quá hạn, 401, 5xx không nói gì về giỏ: nhả ngay.
      if (!isStaleStateError(e) || countEdits(queryClient, 0) > 1) return undefined;
      return settleWithin(queryClient.invalidateQueries({ queryKey: ['cart'] }));
    },
    // Còn lệnh sửa giỏ khác đang bay thì chưa đọc lại: bản đọc về lúc đó chưa có lệnh kia, giỏ nháy về số cũ. Lệnh xong cuối cùng đọc lại.
    onSettled: () => {
      if (countEdits(queryClient, -1) <= 0) void queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  };
}

function useOptimisticCart<TVars>(
  mutationFn: (vars: TVars) => Promise<CartSummary>,
  apply: (prev: CartSummary, vars: TVars) => CartSummary,
  onResponse?: (response: CartSummary) => void,
) {
  return useMutation(useOptimisticCartOptions(mutationFn, apply, onResponse));
}

export default function CartPage() {
  const navigate = useNavigate();
  const goSmart = useSmartNavigate();
  const queryClient = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const { notify } = useNotify();
  const phase = useAuthPhase();

  const cartKeyNow = useCartKey();
  // Khách quay lại app (visibilitychange) sau một lúc vắng: đọc lại giỏ để tồn kho và giá Giờ vàng là số mới, nút "Bỏ món hết & thanh toán tiếp"
  // hiện ngay thay vì để khách bấm Thanh toán rồi mới gặp dòng hết hàng. Không đọc khi lệnh sửa giỏ hay mutation khác (quà 0đ) đang bay (cùng luật với web,
  // `cartRefetchOnReturn`). Giỏ đang lỗi thì giữ luật chung của query-client.ts (chỉ đọc lại khi lỗi tạm).
  const cart = useQuery({
    queryKey: cartKeyNow,
    queryFn: getCart,
    enabled: phase === 'authenticated',
    refetchOnWindowFocus: (q) =>
      q.state.status === 'error'
        ? isTransientError(q.state.error)
        : cartRefetchOnReturn(q.state.dataUpdatedAt, countEdits(queryClient, 0) + queryClient.isMutating()),
  });
  // Máy chủ gỡ mã khi giỏ rơi dưới đơn tối thiểu và chỉ báo đúng một lần: nhớ để khách thấy mã nào mất và cần mua thêm bao nhiêu.
  const removedCoupon = useRemovedCoupon(cart.data, formatVnd);
  const [removed, setRemoved] = useState<CartLine | null>(null);
  // Hộp báo "bộ sẽ mất giảm" trước khi xoá món khoá của combo. Dữ liệu giữ lại sau khi đóng để chữ không trống trong lúc tấm trượt xuống.
  const [pendingRemove, setPendingRemove] = useState<{ line: CartLine; notice: ComboRemovalNotice } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Tấm chọn mã nằm ở cấp trang, không trong chân dính (position:fixed, z 20): zmp-ui Sheet không có portal nên lớp phủ và tấm
  // sẽ kẹt trong ngăn xếp z 20, nút Quay lại (z 200) và thanh Hoàn tác (z 30) vẽ đè lên và vẫn bấm được.
  const [voucherOpen, setVoucherOpen] = useState(false);
  const sfCtx = useStorefrontContext();
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Gợi ý đổi dòng chai sang gói Refill (cờ tắt: không gọi máy chủ, không vẽ gì). Một thanh Hoàn tác cho cả bỏ món lẫn đổi Refill.
  // Đổi và Hoàn tác đi cùng nhịp sửa giỏ của các lệnh khác (`countEdits`): bản đọc giỏ cũ không ghi đè kết quả, lệnh xong cuối mới đọc lại.
  const refill = useCartRefill(
    cart.data?.items,
    (c) => {
      removedCoupon.remember(c);
      queryClient.setQueryData(cartKey(), c);
      setRemoved(null);
    },
    (e) => notify({ text: getErrorMessage(e), type: 'error' }),
    {
      begin: () => {
        countEdits(queryClient, 1);
        return queryClient.cancelQueries({ queryKey: ['cart'] });
      },
      end: () => {
        if (countEdits(queryClient, -1) <= 0) void queryClient.invalidateQueries({ queryKey: ['cart'] });
      },
    },
  );
  // Chọn từng món: lưu tập ĐÃ BỎ CHỌN (deselected) → món mới auto-chọn, món xoá tự biến mất
  // (không cần đồng bộ tay). checkout chỉ thanh toán các món đang chọn.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);
  // Một lần mỗi lần mở giỏ, khi dữ liệu giỏ có lần đầu (kể cả bản trong bộ nhớ đệm); giỏ tải lại sau đó không phát thêm.
  const cartViewed = useRef(false);
  useEffect(() => {
    const c = cart.data;
    if (!c || cartViewed.current) return;
    cartViewed.current = true;
    trackEvent('cart_viewed', 'miniapp', { itemCount: c.items.length, subtotalBucket: subtotalBucket(c.subtotal) });
  }, [cart.data]);
  // Giỏ về trống (làm mới giỏ khi tấm đang mở): tấm gỡ theo, không để nó bật lại khi giỏ có hàng lần sau.
  const noItems = (cart.data?.items.length ?? 0) === 0;
  useEffect(() => {
    if (noItems) setVoucherOpen(false);
  }, [noItems]);
  // Hộp báo bỏ món gỡ khi dòng chờ xoá không còn trong giỏ (làm mới giỏ vì máy khác đã xoá, kể cả giỏ về trống): "Vẫn bỏ" không được xoá dòng đã mất.
  const pendingGone = !!pendingRemove && !(cart.data?.items ?? []).some((l) => l.id === pendingRemove.line.id);
  useEffect(() => {
    if (pendingGone) setConfirmOpen(false);
  }, [pendingGone]);

  // Chọn một phần giỏ (còn ít nhất một dòng): hỏi máy chủ giá của đúng phần đó, cùng nhịp debounce với xem trước mã của VoucherSheet.
  // Chọn cả giỏ dùng thẳng giỏ trong bộ nhớ, không hỏi thêm. Khoá nằm dưới ['cart', gian hàng] nên làm mới giỏ cũng làm mới giá này.
  // Nút chính đang là "Bỏ món hết & thanh toán tiếp": giá là của phần còn lại (`cartPricingLines`), kể cả khi đang chọn cả giỏ.
  const pricingLines = cartPricingLines((cart.data?.items ?? []).filter((l) => !deselected.has(l.id)));
  // Mã đang áp nằm trong dấu vân tay: áp/bỏ mã đổi giá phần chọn dù id, số lượng, thành tiền không đổi.
  const subsetSig =
    cart.data && pricingLines.length > 0 && pricingLines.length < cart.data.items.length
      ? JSON.stringify([pricingLines.map((l) => l.id), cartPreviewKey(pricingLines), cart.data.couponCode])
      : null;
  const settledSubsetSig = useDebounced(subsetSig, PREVIEW_DEBOUNCE_MS);
  const selectionQ = useQuery({
    queryKey: [...cartKeyNow, 'selection', settledSubsetSig],
    queryFn: () => getCartSelection((JSON.parse(settledSubsetSig!) as [string[], string, string | null])[0]),
    enabled: phase === 'authenticated' && !!settledSubsetSig,
    retry: false,
  });
  // Số chỉ đúng cho đúng phần đã hỏi: vừa đổi chọn/số lượng (chưa hỏi lại), đang tải lại hoặc lỗi thì không hiện số cũ.
  const priced =
    !!subsetSig && settledSubsetSig === subsetSig && selectionQ.isSuccess && !selectionQ.isFetching ? selectionQ.data : null;
  // Lỗi của đúng phần đang chọn: không hiện số giảm của phần chọn mà trước đây cũng không nói vì sao, nên báo tại chỗ kèm Thử lại.
  const selectionPriceFailed = !!subsetSig && settledSubsetSig === subsetSig && selectionQ.isError;

  const update = useOptimisticCart(
    ({ id, qty }: { id: string; qty: number }) => inLineOrder(queryClient, id, () => updateCartItem(id, qty)),
    (prev, { id, qty }) =>
      recompute(prev, prev.items.map((l) => (l.id === id ? { ...l, quantity: qty } : l)), id),
    (response) => {
      removedCoupon.remember(response);
      // Đã sửa giỏ sau khi đổi sang Refill: Hoàn tác không còn trả đúng trạng thái cũ nên đóng lại.
      refill.dismiss();
    },
  );
  // Khoá đồng bộ theo dòng: hai cú chạm sát nhau vào cùng nút Xoá không gọi xoá hai lần (lần hai nhận 404 và hoàn lại giỏ).
  // Thanh Hoàn tác mở ở `onSuccess` cấp mutation, không ở callback của `mutate`: callback đó chỉ chạy cho lần gọi cuối, xoá dòng B khi dòng A còn bay thì mất của A.
  // Chỉ mở sau khi máy chủ xoá xong — tránh Hoàn tác (thêm lại) vượt mặt lệnh xoá còn đang bay làm sai trạng thái cuối.
  const remove = useLockedMutation(
    useOptimisticCartOptions(
      ({ id }: { id: string; line: CartLine }) => inLineOrder(queryClient, id, () => removeCartItem(id)),
      (prev, { id }) => recompute(prev, prev.items.filter((l) => l.id !== id)),
      (response, { line }) => {
        removedCoupon.remember(response);
        refill.dismiss();
        setRemoved(line);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setRemoved(null), UNDO_WINDOW_MS);
      },
    ),
    ({ id }) => id,
  );

  // Quà tặng dùng thử 0đ: lưu lựa chọn vào giỏ. Cả giỏ thì giỏ trả về thay cache; chọn một phần thì đọc lại giỏ và phần đang chọn.
  const giftChoice = useMutation({
    mutationFn: ({ variationId, itemIds }: { variationId: string | null; itemIds?: string[] }) => setCartGift(variationId, itemIds),
    // Lượt đọc giỏ đang bay (vd đọc lại khi quay lại app) gửi trước lúc máy chủ lưu quà: về muộn thì đè giỏ có quà mới.
    onMutate: () => queryClient.cancelQueries({ queryKey: cartKey() }),
    onSuccess: (c, { itemIds }) => {
      if (itemIds) void queryClient.invalidateQueries({ queryKey: cartKey() });
      else queryClient.setQueryData(cartKey(), c);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
    },
    onError: (e: unknown) => {
      notify({ text: getErrorMessage(e) || fillCopy('giftTrial.saveFailed'), type: 'error' });
      void queryClient.invalidateQueries({ queryKey: cartKey() });
    },
  });

  // Gợi ý bù đơn (nguồn món và chọn món ở `FreeshipBoosterRail`); lệnh thêm nằm ở đây vì nó sửa giỏ kiểu optimistic như mọi lệnh giỏ khác.
  const addon = useOptimisticCart(
    ({ item }: { item: FreeshipAddonItem }) => addToCart(item.variationId, 1),
    (prev, { item }) => recompute(prev, [...prev.items, pendingAddonLine(item)]),
    removedCoupon.remember,
  );
  // Khoá đồng bộ theo món: hai cú chạm sát nhau vào CÙNG một món trước khi `isPending` kịp vẽ lại không được thêm món hai lần, còn món khác vẫn thêm được ngay.
  // Nhả khoá bằng `mutateAsync` vì callback truyền vào `mutate` chỉ chạy cho lần gọi cuối. Lỗi đã có thanh báo ở `onError` của mutation nên bỏ qua ở đây.
  const addonInFlight = useRef(new Set<string>());
  const handleAddAddon = (item: FreeshipAddonItem) => {
    if (addonInFlight.current.has(item.slug)) return;
    addonInFlight.current.add(item.slug);
    haptic('light');
    void addon
      .mutateAsync({ item })
      .catch(() => undefined)
      .finally(() => addonInFlight.current.delete(item.slug));
  };

  // Khoá đồng bộ theo dòng ngừng bán: chạm đúp "Xoá" không gọi xoá hai lần (lần hai nhận 404). Máy chủ từ chối (400/404/409: dòng đã bị gỡ ở máy khác) thì giữ khoá tới khi giỏ đọc lại về (tối đa `settleWithin`), lỗi khác nhả ngay.
  const discontinuedInFlight = useRef(new Set<string>());
  const handleRemoveDiscontinued = (id: string) => {
    if (discontinuedInFlight.current.has(id)) return;
    discontinuedInFlight.current.add(id);
    removeCartItem(id)
      .then((c) => queryClient.setQueryData(cartKey(), c))
      .catch((e: unknown) => {
        openSnackbar({ text: getErrorMessage(e), type: 'error' });
        if (isStaleStateError(e)) return settleWithin(queryClient.invalidateQueries({ queryKey: ['cart'] }));
        return undefined;
      })
      .finally(() => discontinuedInFlight.current.delete(id));
  };

  const handleRemove = (line: CartLine) => {
    haptic('light');
    remove.mutate({ id: line.id, line });
  };

  // `removed` chỉ đổi sau lần vẽ kế tiếp: chạm đúp "Hoàn tác" thấy dòng vẫn còn ở cả hai lần và thêm món hai lần (số lượng nhân đôi).
  const undoing = useRef(false);
  const handleUndo = () => {
    if (!removed || undoing.current) return;
    undoing.current = true;
    haptic('light');
    const line = removed;
    setRemoved(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    addToCart(line.variationId, line.quantity)
      .then((c) => queryClient.setQueryData(cartKey(), c))
      .catch((e: unknown) => {
        openSnackbar({ text: getErrorMessage(e), type: 'error' });
        // Máy chủ từ chối (hết hàng, món không còn...): đọc lại giỏ và giữ khoá tới khi giỏ về (tối đa `settleWithin`). Lỗi khác nhả ngay.
        if (isStaleStateError(e)) return settleWithin(queryClient.invalidateQueries({ queryKey: ['cart'] }));
        return undefined;
      })
      .finally(() => {
        undoing.current = false;
      });
  };

  // Dải mua thêm ở đầu Giỏ có đang hiện không (`onShownChange`); gọi trước các `return` theo phiên đăng nhập.
  const [aovRailShown, setAovRailShown] = useState<boolean | null>(null);

  // Chưa đăng nhập xong: đang khôi phục → khung chờ (không chớp màn đăng nhập); mất kết nối → Thử lại; khách → mời đăng nhập.
  if (phase !== 'authenticated') {
    return (
      <Shell>
        <AuthPhaseView phase={phase} loading={<CartSkeleton />} />
      </Shell>
    );
  }

  if (cart.isLoading) {
    return (
      <Shell>
        <CartSkeleton />
      </Shell>
    );
  }

  // Chỉ thay cả trang bằng màn lỗi khi KHÔNG có giỏ để hiện: tải lại lỗi (vd mất mạng sau khi xoá món) không được làm trắng giỏ đang xem.
  const summary = cart.data;
  if (!summary) {
    return (
      <Shell>
        <ErrorState message={getLoadErrorMessage(cart.error)} onRetry={() => cart.refetch()} />
      </Shell>
    );
  }
  const empty = summary.items.length === 0;
  // Món khoá của combo (bỏ riêng nó thì bộ hết khớp) phải hỏi trước khi xoá; không chặn: "Vẫn bỏ" xoá như thường, "Giữ lại" thôi.
  const requestRemove = (line: CartLine) => {
    const notice = comboRemovalNotice(summary.comboGroups, line.id);
    if (!notice) return handleRemove(line);
    setPendingRemove({ line, notice });
    setConfirmOpen(true);
  };
  const confirmRemove = () => {
    setConfirmOpen(false);
    if (pendingRemove) handleRemove(pendingRemove.line);
  };
  // Mỗi nơi giao thành một đơn riêng khi đặt (D4): chia giỏ theo nơi giao để khách thấy trước.
  const groups = groupByFulfiller(summary.items);
  const withHeaders = showFulfillerHeaders(groups);
  const hasMerchant = groups.some((g) => g.fulfiller.kind === 'MERCHANT');
  // Món đang chọn (không nằm trong deselected). Toàn-chọn → checkout gửi itemIds=undefined (toàn giỏ).
  const selectedItems = summary.items.filter((l) => !deselected.has(l.id));
  const allSelected = selectedItems.length === summary.items.length;
  // Số tiền lấy từ giỏ (cả giỏ) hay từ giá phần chọn của máy chủ: chọn cả giỏ mà có nút bỏ món hết thì vẫn là phần chọn (`pricingLines`).
  const pricingAll = pricingLines.length === summary.items.length;
  // Quà dùng thử theo đúng phần đang chọn: chọn một phần mà giá phần đó chưa về thì ẩn, không hiện mốc của cả giỏ.
  const giftTrialShown = pricingAll ? summary.giftTrial : priced?.giftTrial;
  // Dòng hết hàng (tồn 0) không mua được: không cộng vào tạm tính hay tiến độ miễn phí giao, để khách không thấy số mà đặt không nổi.
  const buyableSelected = selectedItems.filter((l) => l.stock > 0);
  const outOfStockSelected = selectedItems.filter((l) => l.stock <= 0);
  const selectedSubtotal = buyableSelected.reduce((s, l) => s + l.total, 0);
  const selectedCount = selectedItems.reduce((s, l) => s + l.quantity, 0);
  // Tiến độ Miễn phí giao hàng theo tổng ĐANG CHỌN (không phải toàn giỏ), khớp số tiền sẽ thanh toán. Có hàng gian hàng tự giao thì chỉ tính phần Tubu Tree giao
  // (checkout tính phí kho Tubu trên tiền hàng của kiện Tubu). `summary.freeship` do máy chủ tính trên cả giỏ kể cả dòng hết hàng, nên không tin khi còn dòng hết hàng đang chọn.
  const freeshipBase = hasMerchant ? tubuSubtotal(buyableSelected) : selectedSubtotal;
  const showFreeship = !hasMerchant || freeshipBase > 0;
  const freeshipServerReached = !hasMerchant && allSelected && summary.freeship && outOfStockSelected.length === 0;
  const freeship = freeshipProgress({ base: freeshipBase, threshold: summary.freeshipThreshold, serverReached: freeshipServerReached });
  // Hộp Xanh đọc cùng nguồn số với chân dính (cả giỏ, hoặc giá phần chọn của máy chủ): chưa có số đúng của phần chọn thì không nói gì.
  const greenBox = showFreeship ? readGreenBox(pricingAll ? summary : priced) : null;
  // Số giảm cạnh mã cùng nguồn với dòng "Giảm giá" của chân dính (như web): phần chọn chưa có giá thì không ghi số của cả giỏ.
  const couponDiscount = (pricingAll ? summary : priced)?.discount ?? 0;
  const strip = cartProgressStrip(freeship.reached, greenBox);
  const greenBoxView = strip === 'greenBox' ? greenBoxProgress(greenBox) : null;
  const greenBoxHint = strip === 'freeship' ? greenBoxCartHint(greenBox) : null;
  // Mức mở khoá của dải đầu giỏ: tăng khi vừa đạt Miễn phí giao hàng hay lên bậc Hộp Xanh thì dải nảy mừng một lần (`CartUnlockSlot`).
  const unlockLevel = cartUnlockLevel(freeship.reached, greenBox?.tier?.minItems);
  // Dải mua thêm món nhỏ: mốc kế tiếp là Miễn phí giao hàng, đạt rồi thì quà dùng thử 0đ của đúng phần đang chọn (giá phần chọn chưa về thì không có mốc quà).
  const aovGoal = aovUpsellGoal({
    base: freeshipBase,
    freeship: showFreeship ? { ...freeship, threshold: summary.freeshipThreshold } : null,
    giftTrial: giftTrialShown,
    tubuOnly: hasMerchant,
  });
  // Ô quà khoá không nói lại số dải mốc quà đang nói, và không nói "Thêm …" khi giỏ tạm đã đủ mốc mà giỏ chưa đọc lại.
  const giftLockedShown = aovGiftLockedRowShown({ goal: aovGoal, railShown: aovRailShown, base: freeshipBase, giftTrial: giftTrialShown });
  // Liên kết "Đã có chai? Đổi sang Refill …" theo đúng mốc màn đang hiện (phần đang chọn): đổi làm tụt mốc thì hỏi lại trước.
  const refillViews = refillSwapOffers({
    lines: summary.items,
    pairs: refill.pairs,
    comboGroups: summary.comboGroups,
    milestones: {
      freeship: showFreeship ? { base: freeshipBase, threshold: summary.freeshipThreshold, reached: freeship.reached, tubuOnly: hasMerchant } : null,
      giftTrial: giftTrialShown,
      greenBox,
    },
    isSelected: (id) => !deselected.has(id),
    saving: refillSavingBadge,
  });
  const refillConfirm = refill.confirm && refillConfirmText(refill.confirm);
  const swapSlugs = new Set(summary.items.filter((l) => refillViews.has(l.id)).map((l) => l.slug));
  const undoBar = refill.receipt ? { text: fillCopy('refill.swapped'), onUndo: refill.undo } : removed ? { text: vi.cart.removed, onUndo: handleUndo } : null;
  // Máy chủ từ chối đặt đơn khi số lượng vượt tồn: chặn ngay ở giỏ thay vì để khách điền xong mới báo lỗi.
  const overStockSelected = selectedItems.some((l) => l.quantity > l.stock);
  // Món đang chọn hết hàng trong lúc khách vắng mà phần còn lại mua được: nút chính bỏ chọn món hết rồi đi Thanh toán, không khoá cả giỏ.
  const recovery = soldOutRecovery(selectedItems);
  // Cùng gian hàng checkout gửi (combo) để số giảm của từng mã đúng số thanh toán sẽ trừ.
  const ctvSlug = sfCtx.kind === 'ctv' ? (sfCtx.slug ?? undefined) : undefined;
  // Không chọn món nào: không hỏi máy chủ (itemIds rỗng bị coi là cả giỏ), thẻ giữ cách hiện cũ. Xem trước mã theo đúng phần có giá (bỏ món hết).
  const previewSelection =
    pricingLines.length === 0
      ? null
      : { itemIds: pricingAll ? undefined : pricingLines.map((l) => l.id), key: cartPreviewKey(pricingLines) };
  const previewParams = previewSelection ? { storefrontSlug: ctvSlug, itemIds: previewSelection.itemIds } : undefined;
  const toggleAll = () => {
    haptic('light');
    setDeselected(allSelected ? new Set(summary.items.map((l) => l.id)) : new Set());
  };
  const startCheckout = (lines: readonly CartLine[]) => {
    // null = cố ý thanh toán toàn giỏ. Luôn ghi nhớ để lần tải lại trang thanh toán không
    // âm thầm chuyển từ "1 món đã chọn" sang "cả giỏ".
    const itemIds = lines.length === summary.items.length ? null : lines.map((l) => l.id);
    rememberCheckoutSelection(itemIds);
    setCheckoutEntry(itemIds ? 'cart_subset' : 'cart');
    navigate('/checkout', { state: { itemIds } });
  };
  const goCheckout = () => {
    if (selectedItems.length === 0 || addon.isPending) return;
    if (recovery) {
      // Lệnh sửa giỏ còn bay (món bù chưa có id thật `pending-…`, Hoàn tác): danh sách dòng chưa chắc đúng, gửi id lúc này là sai món (như web).
      if (countEdits(queryClient, 0) > 0 || queryClient.isMutating() > 0) return;
      // Món hết chỉ bỏ chọn, không xoá: quay lại giỏ vẫn thấy chúng (bỏ chọn) để mua khi có hàng lại.
      const drop = new Set(recovery.soldOutIds);
      setDeselected((prev) => new Set([...prev, ...drop]));
      startCheckout(selectedItems.filter((l) => !drop.has(l.id)));
      return;
    }
    if (overStockSelected) return;
    startCheckout(selectedItems);
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(var(--sticky-bar-h, 150px) + 16px)' }}>
      <PageHeader title="Giỏ hàng" />
      <StorefrontContextBar />
      <DiscontinuedNotice lines={summary.unavailableItems ?? []} onRemove={handleRemoveDiscontinued} />
      {empty ? (
        <>
          <EmptyState
            art="basket"
            heading={vi.cart.emptyHeading}
            body={vi.cart.emptyBody}
            ctaLabel={vi.cart.emptyCta}
            onCta={() => goSmart('/browse')}
          />
          <SuggestedRail listSource="cart_empty" />
        </>
      ) : (
        <>
          {showFreeship && (
            <Box px={3} pt={2}>
              <CartUnlockSlot level={unlockLevel}>
                {greenBoxView ? (
                  <GreenBoxStrip view={greenBoxView} onMore={() => goSmart('/green-box')} />
                ) : (
                  <FreeShippingProgressBar
                    base={freeshipBase}
                    threshold={summary.freeshipThreshold}
                    serverReached={freeshipServerReached}
                    tubuOnly={hasMerchant}
                    giftThreshold={cartGiftThreshold(giftTrialShown)}
                    onShopMore={() => goSmart('/')}
                  />
                )}
              </CartUnlockSlot>
            </Box>
          )}
          <GreenBoxEvents state={greenBox} visible={greenBoxView !== null || greenBoxHint !== null} />
          {aovGoal && (
            <FreeshipBoosterRail
              goal={aovGoal}
              lines={summary.items}
              exclude={aovGiftExclusions(giftTrialShown ?? summary.giftTrial)}
              busySlug={addon.isPending ? addon.variables?.item.slug : null}
              onAdd={handleAddAddon}
              onShownChange={setAovRailShown}
            />
          )}
          <CartVoucherHintSection
            currentCode={summary.couponCode}
            subtotal={selectedSubtotal}
            productIds={cartProductIds(pricingLines)}
            previewParams={previewParams}
            previewKey={previewSelection?.key ?? ''}
          />
          {/* Chọn tất cả */}
          <Box px={3} pt={2}>
            <Checkbox checked={allSelected} onChange={toggleAll} label="Chọn tất cả" />
          </Box>
          {selectionPriceFailed && (
            <div
              key={selectionQ.errorUpdateCount}
              role="alert"
              data-testid="cart-selection-error"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-inline-sm)', padding: 'var(--space-stack-xs) var(--space-gutter) 0' }}
            >
              <Text variant="body-sm" tone="danger">
                {vi.cart.selectionPriceError}
              </Text>
              {/* Tên riêng: nhiều nút "Thử lại" trên cùng màn làm nhiều việc khác nhau. */}
              <Button variant="ghost" loading={selectionQ.isFetching} aria-label={vi.home.retryLabel('báo giá phần đã chọn')} onPress={() => selectionQ.refetch()}>
                {vi.common.retry}
              </Button>
            </div>
          )}
          {withHeaders && (
            <Box px={3} pt={2}>
              <Text variant="caption" tone="secondary" as="div" style={{ lineHeight: 18 / 13 }}>
                Giỏ có hàng do nhiều nơi giao: mỗi nơi giao thành một đơn riêng, có phí giao riêng.
              </Text>
            </Box>
          )}
          {groups.map((g) => {
            // Các món cùng bộ combo gom dưới một đầu nhóm; món lẻ vẽ như cũ phía dưới. API cũ không có nhóm thì mọi món là món lẻ.
            const comboWaiting = comboSavingPending({ editing: summary.comboPending, partial: subsetSig !== null, priced: priced !== null });
            const { blocks, loose } = cartComboBlocks(g.items, summary.comboGroups, deselected, priced?.comboGroups, comboWaiting);
            const renderLine = (line: CartLine) => {
              const swap = refillViews.get(line.id);
              return (
                <CartLineRow
                  key={line.id}
                  line={line}
                  selected={!deselected.has(line.id)}
                  onToggleSelect={() => !isPendingAddonLine(line) && toggleSelect(line.id)}
                  onQty={(qty) => !isPendingAddonLine(line) && update.mutate({ id: line.id, qty })}
                  onRemove={() => !isPendingAddonLine(line) && requestRemove(line)}
                  onOpen={() => navigate(`/product/${line.slug}`)}
                  onFlashEnd={() => void queryClient.invalidateQueries({ queryKey: ['cart'] })}
                  pending={update.isPending && update.variables?.id === line.id}
                  refill={swap && <RefillSwapLink view={swap} disabled={refill.busy} onPress={refill.press} />}
                />
              );
            };
            return (
              <section key={g.key} aria-label={withHeaders ? fulfillerLabel(g.fulfiller) : 'Sản phẩm trong giỏ'}>
                {withHeaders && (
                  <Heading variant="title-sm" as="h2" style={{ padding: '12px 12px 0' }}>
                    {fulfillerLabel(g.fulfiller)}
                  </Heading>
                )}
                <Box p={3} pt={2} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {blocks.map((block) => (
                    <CartComboBlock key={block.group.id} block={block} headingAs={withHeaders ? 'h3' : 'h2'}>
                      {block.lines.map(renderLine)}
                    </CartComboBlock>
                  ))}
                  {loose.map(renderLine)}
                </Box>
              </section>
            );
          })}
          {summary.items.length > 0 && (
            <Box px={3}>
              <CartNudges lines={summary.items} swapSlugs={swapSlugs} />
            </Box>
          )}
          {(summary.pendingGiftRedemptions?.length ?? 0) > 0 && (
            <Box px={3}>
              <GiftNote />
            </Box>
          )}
          {giftTrialShown && (
            <Box px={3}>
              <GiftTrialRow
                summary={giftTrialShown}
                showLocked={giftLockedShown}
                busy={giftChoice.isPending}
                onChoose={(variationId) => {
                  if (giftChoice.isPending) return;
                  // Cùng phần có giá với ô quà đang hiện: quà hiện theo phần chọn thì phải đọc lại phần chọn, không thì ô quà giữ lựa chọn cũ.
                  giftChoice.mutate({ variationId, itemIds: pricingAll ? undefined : pricingLines.map((l) => l.id) });
                }}
              />
            </Box>
          )}
        </>
      )}

      {/* Undo bar — hiện 3.5s sau khi xoá (DI #3) */}
      {undoBar && (
        <Box
          className="tubu-rise"
          style={{
            position: 'fixed',
            bottom: empty ? 80 : 236,
            left: 12,
            right: 12,
            background: 'var(--color-bg-inverse)',
            borderRadius: 'var(--radius-control)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 30,
          }}
        >
          <Text variant="body-sm" tone="inverse" as="div" style={{ lineHeight: 18 / 14 }}>
            {undoBar.text}
          </Text>
          <div role="button" {...rowKeyboardProps()} onClick={undoBar.onUndo} className="tubu-hit-44" style={{ padding: '8px 6px', display: 'inline-block' }}>
            <Text as="div" variant="body-sm" style={{ lineHeight: 18 / 14, fontWeight: 500, color: 'var(--forest-200)' }}>
              {vi.common.undo}
            </Text>
          </div>
        </Box>
      )}

      {!empty && (
        <StickySummary
          summary={summary}
          selectedSubtotal={selectedSubtotal}
          selectedCount={selectedCount}
          pricingAll={pricingAll}
          priced={priced}
          overStock={overStockSelected}
          outOfStockNames={outOfStockSelected.map((l) => l.productName)}
          recovery={recovery}
          onCheckout={goCheckout}
          shipBase={selectedItems.some((l) => l.fulfiller?.kind === 'MERCHANT') ? null : tubuSubtotal(buyableSelected)}
          freeshipReached={freeship.reached}
          greenBoxHint={greenBoxHint}
          savingLines={buyableSelected}
          removedNotice={<CouponRemovedNotice notice={removedCoupon.notice} onDismiss={removedCoupon.dismiss} />}
          coupon={
            <CouponRow
              summary={summary}
              discount={couponDiscount}
              subtotal={selectedSubtotal}
              productIds={cartProductIds(pricingLines)}
              previewParams={previewParams}
              previewKey={previewSelection?.key ?? ''}
              onOpen={() => setVoucherOpen(true)}
            />
          }
        />
      )}

      {!empty && pendingRemove && (
        <ConfirmSheet
          open={confirmOpen}
          title={pendingRemove.notice.title}
          message={pendingRemove.notice.message}
          confirmLabel={pendingRemove.notice.confirmLabel}
          cancelLabel={pendingRemove.notice.keepLabel}
          onConfirm={confirmRemove}
          onCancel={() => setConfirmOpen(false)}
        />
      )}

      {!empty && refillConfirm && (
        <ConfirmSheet
          open
          title={refillConfirm.title}
          message={refillConfirm.body}
          confirmLabel={refillConfirm.confirm}
          cancelLabel={refillConfirm.cancel}
          onConfirm={() => refill.confirm && refill.apply(refill.confirm)}
          onCancel={refill.cancel}
        />
      )}

      {!empty && (
        <VoucherSheet
          visible={voucherOpen}
          onClose={() => setVoucherOpen(false)}
          currentCode={summary.couponCode}
          // Điều kiện tối thiểu voucher phải tính trên tổng ĐANG CHỌN (checkout tập con) — dùng
          // summary.subtotal (toàn giỏ) ở đây từng khiến voucher hiện "đủ điều kiện" sai khi user
          // đã bỏ chọn bớt món (BE re-check khi apply nên không lọt số tiền, nhưng UI gây hiểu lầm).
          subtotal={selectedSubtotal}
          productIds={cartProductIds(pricingLines)}
          previewParams={previewParams}
          previewKey={previewSelection?.key}
        />
      )}
    </Page>
  );
}

/**
 * Nhắc mã sắp mở khoá dưới thanh Miễn phí giao hàng. Tách thành component riêng vì hook xem trước phải chạy sau các `return` sớm của trang (giỏ đang tải, lỗi),
 * như `CouponRow`. Cùng khoá truy vấn với dòng mã ở chân dính nên không thêm lượt gọi máy chủ. Mời áp mã đã đủ điều kiện không ở đây mà ở nút "Áp dụng"
 * của `CouponRow`: một hành động, một nút.
 */
function CartVoucherHintSection(props: {
  currentCode: string | null | undefined;
  subtotal: number;
  productIds?: string[];
  previewParams?: { storefrontSlug?: string; itemIds?: string[] };
  previewKey: string;
}) {
  const v = useCartVoucherHint(props);
  const goSmart = useSmartNavigate();
  if (!v.hint?.unlock) return null;
  return (
    <Box px={3} pt={2}>
      <CartVoucherHintStrip hint={v.hint} onShopMore={() => goSmart('/')} />
    </Box>
  );
}

function DiscontinuedNotice({ lines, onRemove }: { lines: UnavailableCartLine[]; onRemove: (id: string) => void }) {
  if (lines.length === 0) return null;
  return (
    <Box
      role="status"
      mx={3}
      mt={2}
      p={3}
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      <Box flex alignItems="center" style={{ gap: 6 }}>
        <AlertTriangle size={16} color="var(--color-text-warning)" aria-hidden />
        <Text variant="body-sm" tone="warning" as="div" style={{ lineHeight: 18 / 14, fontWeight: 500 }}>
          {vi.cart.discontinuedHeading(lines.length)}
        </Text>
      </Box>
      <Text variant="caption" tone="secondary" as="div" style={{ lineHeight: 18 / 13, marginTop: 4 }}>
        {vi.cart.discontinuedBody}
      </Text>
      {lines.map((l) => (
        <Box key={l.id} flex alignItems="center" justifyContent="space-between" style={{ gap: 8, marginTop: 8 }}>
          <Text variant="body-sm" as="div" style={{ lineHeight: 18 / 14, flex: 1, minWidth: 0, textDecoration: 'line-through' }}>
            {joinVariationLine(l.productName, variationLabel(l.variationName))} × {l.quantity}
          </Text>
          <Button variant="ghost" onPress={() => onRemove(l.id)}>
            {vi.cart.discontinuedRemove}
          </Button>
        </Box>
      ))}
    </Box>
  );
}

function CartSkeleton() {
  return (
    <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LineItemSkeleton />
      <LineItemSkeleton />
      <LineItemSkeleton />
    </Box>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Giỏ hàng" />
      {children}
    </Page>
  );
}

function CartLineRow({
  line,
  selected,
  onToggleSelect,
  onQty,
  onRemove,
  onOpen,
  onFlashEnd,
  pending,
  refill,
}: {
  line: CartLine;
  selected: boolean;
  onToggleSelect: () => void;
  onQty: (qty: number) => void;
  onRemove: () => void;
  onOpen: () => void;
  /** Hết giờ Giờ vàng khi khách đang xem: làm mới giỏ để API tính lại giá, không cần tải trang. */
  onFlashEnd: () => void;
  /** PATCH số lượng của chính dòng này đang bay: line.total lúc đó là số client tự nhân (optimistic), chưa phải số server. */
  pending: boolean;
  /** Liên kết đổi sang gói Refill dưới dòng (chỉ dòng chai khách đã có). */
  refill?: ReactNode;
}) {
  // Bấm +/- nhanh 5 lần trước đây gọi 5 PATCH song song → debounce qty cuối cùng
  // (UI cập nhật tức thời qua local state, request chỉ bay sau ~380ms ổn định).
  const [localQty, setLocalQty] = useState(line.quantity);
  const debouncedQty = useDebounced(localQty, 380);
  // Tồn thấp: theo số đang chọn trên màn (localQty) để dòng hiện cùng lúc nút + khoá, không đợi máy chủ. Tồn trên 20: theo số của máy chủ như web,
  // vì báo "vượt" theo số vừa bấm là cho khách đọc ra tồn thật ngay trên máy, không cần máy chủ trả lời.
  const stockNote = cartStockNote(isLowStock(line.stock) ? localQty : line.quantity, line.stock);
  const soldOut = line.stock <= 0;
  // CHỈ đồng bộ về line.quantity khi KHÔNG có thay đổi đang chờ flush — tránh case
  // refetch cart (do mutate line khác) trả về quantity CŨ và snap UI ngược lại khi
  // user đang tap. Sau khi debouncedQty đã đuổi kịp localQty thì server-truth là an toàn.
  useEffect(() => {
    if (debouncedQty === localQty) setLocalQty(line.quantity);
  }, [line.quantity]);
  useEffect(() => {
    if (debouncedQty !== line.quantity) onQty(debouncedQty);
    // onQty/line.quantity ổn định trong scope mutate; chỉ trigger khi debouncedQty đổi.
  }, [debouncedQty]);
  const compareAt = lineCompareAt(line);
  const lineVariation = variationLabel(legacyVariationName(line.variationName));
  return (
    <Box
      data-testid="cart-line"
      p={3}
      style={{
        position: 'relative',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        boxShadow: 'var(--elevation-1)',
      }}
    >
      <Checkbox flush checked={selected} onChange={onToggleSelect}>
        <span style={SR_ONLY}>{`Chọn ${line.productName}`}</span>
      </Checkbox>
      <Box
        // Ảnh chỉ là đường tắt cho chuột/chạm; tên sản phẩm ngay bên cạnh là nút cho bàn phím và trình đọc màn hình,
        // để một dòng không có hai nút trùng tên.
        aria-hidden
        data-testid="cart-line-thumb"
        onClick={onOpen}
        style={{
          width: 72,
          height: 72,
          borderRadius: 'var(--radius-media)',
          overflow: 'hidden',
          background: 'var(--color-bg-subtle)',
          flex: '0 0 auto',
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ProductThumb src={line.thumbnail} alt={line.productName} size={72} />
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        {/* Chừa 36px bên phải cho thùng rác góc trên (vùng chạm 44 nhô ra khỏi lề thẻ). Tên 1-2 dòng chỉ cao 18-36px:
            tubu-hit-44 nới vùng chạm lên 44px mà không đổi bố cục dòng. */}
        <div style={{ paddingRight: 36 }}>
          <div role="button" {...rowKeyboardProps()} onClick={onOpen} className="tubu-hit-44" style={{ cursor: 'pointer', display: 'block' }}>
            <Text as="div" variant="body-sm" style={{ lineHeight: 18 / 14, fontWeight: 500 }}>
              {line.productName}
            </Text>
          </div>
        </div>
        {lineVariation && (
          <Text variant="caption" tone="tertiary" as="div" style={{ lineHeight: 18 / 13 }}>
            {lineVariation}
          </Text>
        )}
        {line.isFlash && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <Badge tone="promo" size="sm" icon={Zap}>
              {vi.flashSale.badge}
            </Badge>
            {line.flashEndAt ? (
              <Text variant="caption" tone="tertiary" as="div" style={{ lineHeight: 18 / 13 }}>
                <Countdown endAt={line.flashEndAt} mode="text" onEnd={onFlashEnd} />
              </Text>
            ) : (
              line.soldPct != null && Number.isFinite(line.soldPct) && clampPercent(line.soldPct) > 0 && (
                <Text variant="caption" tone="tertiary" as="div" style={{ lineHeight: 18 / 13 }}>
                  {vi.flashSale.soldPct(clampPercent(line.soldPct))}
                </Text>
              )
            )}
          </Box>
        )}
        {(stockNote || soldOut) && (
          <Box flex alignItems="center" style={{ gap: 4, marginTop: 2 }}>
            <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden />
            <Text variant="caption" tone="warning" as="div" style={{ lineHeight: 18 / 13 }}>
              {stockNote ?? vi.cart.outOfStock}
            </Text>
          </Box>
        )}
        {line.flashLimitNotice && (
          <Box flex alignItems="flex-start" style={{ gap: 4, marginTop: 2 }}>
            <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden style={{ flex: '0 0 auto', marginTop: 2 }} />
            <Text variant="caption" tone="warning" as="div" data-testid="flash-limit-notice" style={{ lineHeight: 18 / 13 }}>
              {line.flashLimitNotice}
            </Text>
          </Box>
        )}
        {/* Hàng đáy: giá bên trái, bộ đếm 36px bên phải. Giá niêm yết gạch xếp DƯỚI giá bán (layout stack, cao 36 bằng bộ đếm): xếp ngang
            thì ở 375px hai giá cộng bộ đếm không vừa một hàng, giá rớt xuống dòng và dòng đang giảm cao gần gấp rưỡi dòng thường. Máy hẹp (320px)
            vẫn cho cả khối giá xuống dòng thay vì tràn. */}
        <Box flex alignItems="center" justifyContent="space-between" style={{ marginTop: 6, flexWrap: 'wrap', rowGap: 4, columnGap: 8 }}>
          <PriceTag value={line.unitPrice} compareAt={compareAt} size="sm" layout={compareAt ? 'stack' : 'inline'} tone={compareAt || line.isFlash ? 'deal' : 'default'} />
          {/* Giỏ đang vượt tồn (tồn đổi sau khi thêm): nút − kéo thẳng về mức thanh toán được như web (`overStockTarget`), khách không phải bấm từng số xuống. */}
          <QuantitySelector
            size="sm"
            value={localQty}
            max={line.quantity > line.stock ? line.quantity : qtyPickMax(line.stock)}
            disabled={soldOut}
            onChange={(q) => setLocalQty(q < localQty && line.quantity > line.stock ? Math.min(q, overStockTarget(line.stock)) : q)}
          />
        </Box>
        {/* Số của server (line.total): máy chủ có thể tính lại giá cả dòng (flash hết suất). Ẩn khi SL chưa khớp server (chờ debounce) và khi PATCH còn bay (số lúc đó do client tự nhân). */}
        {line.quantity > 1 && localQty === line.quantity && !pending && (
          <Text variant="caption" tone="secondary" as="div" style={{ lineHeight: 18 / 13, display: 'block', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            Thành tiền {formatVnd(line.total)}
          </Text>
        )}
        {refill}
      </Box>
      <IconButton
        icon={Trash2}
        label={`Xoá ${line.productName}`}
        onPress={onRemove}
        size="sm"
        style={{ position: 'absolute', top: 4, right: 4 }}
      />
    </Box>
  );
}

function CouponRow({
  summary,
  discount,
  subtotal,
  productIds,
  previewParams,
  previewKey,
  onOpen,
}: {
  summary: CartSummary;
  /** Số giảm của mã trên phần đang hiện giá (cả giỏ, hoặc giá phần chọn của máy chủ); 0 khi chưa có số đúng. */
  discount: number;
  /** Tiền hàng đang chọn, đúng số tấm chọn mã dùng để xét đủ điều kiện. */
  subtotal: number;
  productIds?: string[];
  /** Món đang chọn (itemIds undefined = cả giỏ) và gian hàng; undefined = chưa chọn món nào. */
  previewParams?: { storefrontSlug?: string; itemIds?: string[] };
  /** Dấu vân tay của các món đang chọn ('' = chưa chọn món nào). */
  previewKey: string;
  /** Mở tấm chọn mã (do trang giữ, ngoài chân dính). */
  onOpen: () => void;
}) {
  // Chỉ gợi ý khi giỏ chưa có mã: không tự áp, khách bấm "Áp dụng" hoặc chọn ở tấm chọn mã.
  const v = useCartVoucherHint({ currentCode: summary.couponCode, subtotal, productIds, previewParams, previewKey });
  const hint = v.usable;
  // Có mã đủ điều kiện chưa áp: hành động cuối hàng là "Áp dụng" (một chạm, mã giảm nhiều nhất) thay cho "Chọn mã", và là nút DUY NHẤT áp mã trên màn giỏ.
  // Bấm phần chữ bên trái vẫn mở tấm chọn mã (nút nằm ngoài vùng bấm đó, không lồng nút trong nút).
  const quick = summary.couponCode ? null : (v.hint?.apply ?? null);
  const errorId = useId();

  return (
    <>
      {/* Hàng gọn nằm trong chân dính (mã là bước cuối trước khi bấm Thanh toán): hàng 44, nội dung xuống dưới nhãn khi hết chỗ. */}
      <Box
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-inline-sm)',
          boxShadow: 'inset 0 -1px 0 var(--color-border-subtle)',
        }}
      >
        <Box
          className="tubu-press"
          role="button"
          data-testid="coupon-row"
          {...rowKeyboardProps()}
          onClick={() => {
            haptic('light');
            onOpen();
          }}
          style={{
            minHeight: 44,
            minWidth: 0,
            flex: 1,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <Box flex alignItems="center" style={{ gap: 8, minWidth: 0, flex: 1 }}>
            <Ticket size={20} color="var(--clay-700)" aria-hidden style={{ flex: '0 0 auto' }} />
            {/* Nhãn và nội dung cùng một dòng khi đủ chỗ; máy hẹp (320px) thì nội dung xuống dòng dưới nhãn, thay vì bị cắt "…" hay vỡ ba dòng. Hai dòng vẫn gọn trong 44px. Mã dài bất thường thì xuống dòng ngay trong pill (khách phải đọc đủ mã), hàng cao thêm. */}
            <Box style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 'var(--space-inline-sm)', rowGap: 'var(--space-inline-xs)', minWidth: 0, flex: 1 }}>
              <Text variant="body-sm" as="div" data-testid="coupon-label" style={{ lineHeight: 18 / 14, fontWeight: 500, flex: '0 0 auto' }}>
                Mã giảm giá
              </Text>
              {summary.couponCode ? (
                <Box flex alignItems="center" style={{ gap: 8, minWidth: 0 }}>
                  <span
                    data-testid="coupon-code"
                    style={{
                      background: 'var(--clay-50)',
                      border: '1px dashed var(--clay-500)',
                      borderRadius: 'var(--radius-control)',
                      padding: '2px 6px',
                      color: 'var(--clay-700)',
                      fontSize: 'var(--type-label-size)',
                      fontWeight: 700,
                      minWidth: 0,
                      maxWidth: '100%',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {summary.couponCode}
                  </span>
                  {discount > 0 && (
                    <Text variant="caption" tone="success" as="div" data-testid="coupon-discount" style={{ lineHeight: 18 / 13, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      -{formatVnd(discount)}
                    </Text>
                  )}
                </Box>
              ) : hint ? (
                <Text variant="caption" tone="brand" as="div" data-testid="coupon-hint" style={{ minWidth: 0, lineHeight: 'var(--type-label-lh)' }}>
                  {couponHintShort(hint)}
                </Text>
              ) : (
                <Text variant="caption" tone="tertiary" as="div" data-testid="coupon-placeholder" style={{ minWidth: 0, lineHeight: 'var(--type-label-lh)' }}>
                  {fillCopy('coupon.rowInvite')}
                </Text>
              )}
            </Box>
          </Box>

          {!quick && (
            <Box flex alignItems="center" style={{ gap: 2, flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--color-text-brand)' }}>
              <Text variant="caption" tone="brand" as="div" data-testid="coupon-cta" style={{ lineHeight: 18 / 13, fontWeight: 500 }}>
                {summary.couponCode ? 'Thay đổi' : 'Chọn mã'}
              </Text>
              <ChevronRight size={16} color="var(--color-text-brand)" aria-hidden />
            </Box>
          )}
        </Box>

        {quick && (
          <Button
            variant="secondary"
            className="tubu-vhint-cta"
            data-testid="cart-voucher-apply-cta"
            aria-label={quick.ariaLabel}
            aria-describedby={v.error ? errorId : undefined}
            loading={v.applying}
            onPress={() => v.apply(quick.code)}
          >
            {fillCopy('cart.voucherHint.applyCta')}
          </Button>
        )}
      </Box>
      {quick && v.error && (
        <div id={errorId} role="alert" data-testid="cart-voucher-error">
          <Text as="div" variant="caption" tone="danger" style={{ lineHeight: 18 / 13 }}>
            {v.error}
          </Text>
        </div>
      )}
    </>
  );
}

/** Dòng giảm giá trong chân dính: bỏ đệm dọc 6px mặc định của KeyValueRow (khoảng cách đã do thanh lo) để thêm một dòng giảm chỉ tốn ~24px. */
const COMPACT_ROW = { padding: 0 } as const;

/**
 * Dải Hộp Xanh ở đầu giỏ, thay chỗ dải Miễn phí giao hàng khi đã đạt ngưỡng (một dải tại một thời điểm). Dùng chung khung `tubu-freeship` nên đổi dải
 * không đổi chiều cao. "Ghép thêm" mở trang ghép `/green-box` (cùng web `/hop-xanh`). Bậc cao nhất: một dòng xác nhận, không thanh, không nút.
 */
function GreenBoxStrip({ view, onMore }: { view: GreenBoxProgressView; onMore: () => void }) {
  const label = (
    <p role="status" aria-live="polite" aria-atomic="true" className="tubu-freeship-text">
      {view.text}
    </p>
  );
  if (view.done) {
    return (
      <div data-testid="green-box-progress" data-reached="true" className="tubu-freeship">
        {label}
      </div>
    );
  }
  return (
    <div data-testid="green-box-progress" data-reached="false" data-cta="true" className="tubu-freeship">
      <div className="tubu-freeship-head">
        {label}
        <Button variant="secondary" className="tubu-freeship-cta" data-testid="green-box-more-cta" aria-label={greenBoxWebCopy('ctaAria')} onPress={onMore}>
          {greenBoxWebCopy('cta')}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label={view.marksText}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.pct}
        className="tubu-freeship-track"
      >
        <div className="tubu-freeship-fill" style={{ width: `${view.pct}%` }} />
      </div>
      <p className="tubu-freeship-text" data-testid="green-box-marks">
        {view.marksText}
      </p>
    </div>
  );
}

/** Sự kiện Hộp Xanh của một lần mở giỏ: lần đầu thấy tiến độ, và mỗi lần bậc tăng (không tính lần đọc đầu, giỏ mở ra đã ở bậc đó). */
function GreenBoxEvents({ state, visible }: { state: GreenBoxState | null; visible: boolean }) {
  const shownRef = useRef(false);
  const tierRef = useRef<number | null>(null);
  const items = state?.items ?? null;
  const tier = state ? (state.tier?.minItems ?? 0) : null;
  useEffect(() => {
    if (items === null || tier === null) return;
    if (visible && !shownRef.current) {
      shownRef.current = true;
      trackEvent('green_box_progress_shown', 'miniapp', { items, tier });
    }
    const rise = greenBoxTierRise(tierRef.current, tier);
    if (rise !== null) trackEvent('green_box_tier_reached', 'miniapp', { tier: rise });
    tierRef.current = tier;
  }, [items, tier, visible]);
  return null;
}

/** Chân dính của giỏ: mã giảm giá, các dòng giảm, tổng tiền và nút Thanh toán. Thanh Miễn phí giao hàng nằm ở đầu giỏ (`FreeShippingProgressBar`), không ở đây. */
function StickySummary({
  summary,
  selectedSubtotal,
  selectedCount,
  pricingAll,
  priced,
  overStock,
  outOfStockNames,
  recovery,
  onCheckout,
  shipBase,
  freeshipReached,
  greenBoxHint,
  savingLines,
  coupon,
  removedNotice,
}: {
  /** "Thêm {n} món nữa giảm {pct}% Hộp Xanh" khi chưa đạt Miễn phí giao hàng (dải đầu giỏ còn đang nói về phí giao); null thì không có dòng. */
  greenBoxHint: string | null;
  /** Tiền hàng kiện Tubu đang chọn để ước tính phí giao; null khi có hàng gian hàng tự giao (phí từng gian hàng chỉ biết ở Thanh toán). */
  shipBase: number | null;
  /** Thanh Miễn phí giao hàng đang báo đã đạt: dòng phí nói cùng một điều. */
  freeshipReached: boolean;
  /** Lời báo mã vừa bị máy chủ gỡ (đơn tối thiểu, hết hạn, bị tắt); tự không dựng gì khi không có. */
  removedNotice: ReactNode;
  summary: CartSummary;
  selectedSubtotal: number;
  selectedCount: number;
  /** Số tiền lấy từ giỏ (true) hay từ `priced`: false khi chọn một phần, hoặc chọn cả giỏ mà nút chính là bỏ món hết một chạm. */
  pricingAll: boolean;
  /** Giá của phần chọn từ máy chủ (chỉ khi chọn một phần và đã có số đúng); null = chưa có, không hiện giảm giá. */
  priced: CartSummary | null;
  overStock: boolean;
  /** Tên các dòng đang chọn mà tồn bằng 0: nói rõ dòng nào cần bỏ chọn hoặc xoá. */
  outOfStockNames: string[];
  /** Có thì nút chính là "Bỏ món hết & thanh toán tiếp" (một chạm) thay cho nút Thanh toán bị khoá. */
  recovery: SoldOutRecovery | null;
  onCheckout: () => void;
  /** Các dòng mua được đang chọn: "Tiết kiệm" = giá gạch của chúng + giảm combo đang hiện (chỉ hiển thị, tiền thật do máy chủ tính). */
  savingLines: readonly CartLine[];
  /** Hàng mã giảm giá: dính cùng tổng tiền để chọn mã xong là bấm Thanh toán luôn. */
  coupon: ReactNode;
}) {
  // Cả giỏ lấy số giảm từ giỏ; một phần giỏ lấy từ giá phần chọn của máy chủ (combo cần đủ bộ trong phần chọn); chưa có thì không
  // hiện số nào (thanh toán tính lại) — tránh số sai.
  const shown = pricingAll ? summary : priced;
  const discount = shown?.discount ?? 0;
  const comboDiscount = shown?.comboDiscount ?? 0;
  const tierDiscount = shown?.tierDiscount ?? 0;
  // Hộp Xanh nằm trong `comboDiscount` của máy chủ: tách ra dòng riêng, tổng không đổi.
  const greenBoxDiscount = greenBoxDiscountOf(shown);
  const comboRowDiscount = comboOnlyDiscount(shown);
  // Cùng số `comboDiscount` đang hiện ở dòng "Giảm giá combo" (0 khi chưa có giá phần chọn). Mã giảm giá và hạng đã có dòng riêng nên không cộng.
  const saving = cartSaving(savingLines, comboDiscount);
  // Giảm giá của phần chọn tính trên tạm tính CỦA CHÍNH phần chọn máy chủ trả (giá có thể đổi so với giỏ đã tải, vd hết giờ vàng).
  const shownSubtotal = !pricingAll && priced ? priced.subtotal : selectedSubtotal;
  // Lời báo của mã đang giữ trên phần đang hiển thị, kèm số cần mua thêm khi mã chỉ thiếu đơn tối thiểu. Cả giỏ chỉ nói khi mã giữ chưa áp (thêm dòng cho chân dính vốn chật
  // ở 320px); phần chọn nói cả câu của máy chủ về mã đã áp (vd Giờ vàng không giảm thêm) như trước.
  const couponSrc = shown?.couponCode ? shown : null;
  // Mã bị kẹp ở trần giảm gộp voucher + Điểm Xanh thì cả giỏ cũng nói, vì dòng mã ghi ít hơn mệnh giá.
  const couponLine = pricingAll ? (heldCouponNotice(couponSrc, formatVnd) ?? couponCapNoteText(couponSrc)) : couponNoticeText(couponSrc, formatVnd);
  const goodsNet = Math.max(0, shownSubtotal - comboDiscount - discount - tierDiscount);
  const { estimate, stale } = useShippingEstimate(selectedCount > 0 ? shipBase : null);
  // Nút Thanh toán của chân dính luôn trong khung nhìn: giỏ đặt được thì đọc sẵn sổ địa chỉ, thứ màn Thanh toán chờ mới hỏi được báo giá. Mã màn
  // Thanh toán đã tải sẵn lúc app rảnh (`prefetchShoppingRoutes`), phí giao ước tính dùng chung khoá với dòng phí ngay trên.
  const queryClient = useQueryClient();
  const payable = selectedCount > 0 && (!overStock || !!recovery);
  useEffect(() => {
    if (payable) void queryClient.prefetchQuery({ queryKey: ['addresses'], queryFn: getAddresses });
  }, [payable, queryClient]);
  const ship = cartShippingView(estimate, { goodsNet, freeshipReached, stale });
  const total = (
    <>
      {/* Có phí giao ước tính: "Tổng tạm tính" = tiền hàng đã giảm + phí đó. Chưa có (đang hỏi, lỗi, có hàng gian hàng tự giao): số đã trừ giảm giá,
          CHƯA gồm ship, trong khi "Tạm tính" ở màn Thanh toán là tiền hàng gộp chưa trừ gì — nên nhãn ghi "(đã giảm)" khi thật sự có giảm (P2-4). */}
      <div style={{ fontSize: 'var(--type-label-size)', lineHeight: 'var(--type-label-lh)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
        {ship?.totalLabel ?? cartTotalLabel(comboDiscount + discount + tierDiscount)}
      </div>
      <div
        data-testid="cart-total-value"
        style={{ fontSize: 'var(--type-title-md-size)', lineHeight: 'var(--type-title-md-lh)', fontWeight: 700, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
      >
        {formatVnd(ship?.total ?? goodsNet)}
      </div>
      {saving > 0 && (
        // Cùng màu deal và độ đậm với dòng "Tiết kiệm" của PDP (một màu cho mọi khoản giảm giá, DESIGN.md). Được xuống dòng tại khoảng trắng
        // ("Tiết kiệm" / "12.345.000đ") khi khối tổng hẹp ở 320px; số tiền không có điểm ngắt nên không bao giờ bị cắt giữa số.
        <Text variant="caption" as="div" data-testid="cart-saving" style={{ lineHeight: 18 / 13, color: 'var(--color-text-price-deal)', fontWeight: 600, display: 'block' }}>
          {fillCopy('cart.saving', { x: formatVnd(saving) })}
        </Text>
      )}
    </>
  );

  return (
    <StickyActionBar
      dense
      summary={
        <>
          {coupon}
          {comboRowDiscount > 0 && (
            <KeyValueRow label={vi.cart.comboDiscount} value={`-${formatVnd(comboRowDiscount)}`} tone="success" style={COMPACT_ROW} />
          )}
          {greenBoxDiscount > 0 && (
            <KeyValueRow label={fillCopy('greenBox.name')} value={`-${formatVnd(greenBoxDiscount)}`} tone="success" style={COMPACT_ROW} dataDs="cart-green-box" />
          )}
          {discount > 0 && (
            <KeyValueRow label={vi.cart.discount} value={`-${formatVnd(discount)}`} tone="success" style={COMPACT_ROW} />
          )}
          {tierDiscount > 0 && <KeyValueRow label={vi.cart.tierDiscount} value={`-${formatVnd(tierDiscount)}`} tone="success" style={COMPACT_ROW} />}
          {ship && <KeyValueRow label={ship.feeLabel} value={ship.feeText} tone={ship.free ? 'success' : 'primary'} style={COMPACT_ROW} dataDs="cart-ship-estimate" />}
          {couponLine && (
            <div role="status" data-testid="coupon-notice">
              <Text as="div" variant="caption" tone="warning" style={{ lineHeight: 18 / 13 }}>
                {couponLine}
              </Text>
            </div>
          )}
          {greenBoxHint && (
            <Text variant="caption" tone="success" as="p" data-testid="green-box-hint">
              {greenBoxHint}
            </Text>
          )}
          {removedNotice}
          {outOfStockNames.length > 0 && (
            <Box flex alignItems="flex-start" role="status" data-testid="cart-sold-out-note" style={{ gap: 4 }}>
              <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              <Text variant="caption" tone="warning" as="div" style={{ lineHeight: 18 / 13 }}>
                {recovery ? recovery.note : vi.cart.outOfStockBlocked(outOfStockNames)}
              </Text>
            </Box>
          )}
          {/* Nhãn một chạm dài hơn "Thanh toán (n)": tổng xuống cuối phần trên để nút chiếm trọn một hàng, không bị rút gọn "…". */}
          {recovery && <div data-testid="cart-total-row">{total}</div>}
          {overStock && outOfStockNames.length === 0 && (
            <Box flex alignItems="center" role="status" style={{ gap: 4 }}>
              <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden />
              <Text variant="caption" tone="warning" as="div" style={{ lineHeight: 18 / 13 }}>
                {vi.cart.overStockBlocked}
              </Text>
            </Box>
          )}
        </>
      }
      lead={recovery ? undefined : total}
      primary={
        <Button fullWidth disabled={selectedCount === 0 || (overStock && !recovery)} onPress={onCheckout}>
          {recovery ? recovery.cta : vi.cart.checkout(selectedCount)}
        </Button>
      }
    />
  );
}
