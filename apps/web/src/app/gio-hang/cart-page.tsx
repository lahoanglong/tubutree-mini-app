'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Truck, Zap, Trash2, Minus, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient, useMutationState } from '@tanstack/react-query';
import { cartSaving, lineCompareAt } from '@tubutree/app-core/commerce/pdp-view';
import { CART_OUT_OF_STOCK, CART_OVER_STOCK_BLOCKED, cartOutOfStockBlocked } from '@tubutree/app-core/cart-copy';
import { cartTotalLabel } from '@tubutree/app-core/commerce/cart-total';
import { cartShippingView } from '@tubutree/app-core/api/shipping-estimate';
import { useShippingEstimate } from '@/components/checkout/use-shipping-estimate';
import { cartComboBlocks, comboRemovalNotice, comboSavingPending, type ComboRemovalNotice } from '@tubutree/app-core/commerce/cart-combo';
import { aovGiftExclusions, aovGiftLockedRowShown, aovUpsellGoal } from '@tubutree/app-core/cart/aov-upsell';
import { cartGiftThreshold } from '@tubutree/app-core/commerce/cart-progress';
import { cartUnlockLevel, freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import { cartProgressStrip, comboOnlyDiscount, greenBoxCartHint, greenBoxDiscountOf, greenBoxProgress, readGreenBox } from '@tubutree/app-core/commerce/green-box';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { couponNoticeText } from '@tubutree/app-core/coupon-min-order';
import { useRemovedCoupon } from '@/lib/use-removed-coupon';
import { useAuthPhase } from '@/lib/auth-phase';
import { useMediaQuery } from '@/lib/use-media-query';
import { addToCart, getCart, getCartSelection, updateCartItem, removeCartItem, setCartGift, formatVnd, type CartLine } from '@/lib/shop-client';
import { CouponBox, couponPreviewKey, couponProductIds, PREVIEW_DEBOUNCE_MS, useSettled } from '@/components/coupon-box';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ui, uiBar } from '@/lib/guest-ui';
import { fulfillerLabel, groupByFulfiller, showFulfillerHeaders, tubuSubtotal } from '@/lib/shipments';
import { rememberCheckoutSelection } from '@/lib/checkout-selection';
import { markCheckoutEntry, trackPurchase } from '@/lib/analytics';
import { subtotalBucket } from '@tubutree/shared-types';
import { ctvSlugFor, getStorefrontContext } from '@/lib/storefront-context';
import { useCartKey } from '@/lib/cart-key';
import BackLink from '@/components/back-link';
import { CheckMark, miniCheckboxWrap, miniCheckbox } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { LineItemSkeleton, Skeleton } from '@/components/ui/skeleton';
import { Badge, CartVoucherHintStrip, Countdown, FreeShippingProgressBar, KeyValueRow, ProductThumb } from '@/components/mini';
import { useCartVoucherHint } from '@/lib/use-cart-voucher-hint';
import type { CouponPreviewParams } from '@/lib/shop-client';
import { PAGE_WIDE } from '@/lib/page-frame';
import { cartStockNote, overStockTarget, qtyPickMax } from '@tubutree/app-core/commerce/stock-text';
import { CartComboBlock } from '@/components/cart-combo-block';
import { GiftNote, GiftTrialRow } from '@/components/checkout/gift-rows';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { useCartWrite } from '@/lib/use-cart-write';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { joinVariationLine, variationLabel } from '@/lib/variation-label';
import { FreeshipAddons } from './freeship-addons';
import { CartUnlockSlot } from '@/components/cart/freeship-booster/cart-unlock-slot';
import { GuestCartView } from './guest-cart-view';
import { GreenBoxEvents, GreenBoxStrip } from './green-box-strip';
import { refillConfirmText, refillSwapOffers } from '@tubutree/app-core/refill/refill-swap';
import { RefillSwapLink } from '@/components/refill/refill-swap-link';
import { useCartRefill } from '@/components/refill/use-cart-refill';
import { useGuestCartFlag } from '@/lib/guest-cart/flag';
import { runGuestMerge, takeGuestMergeNote, type GuestMergeNote } from '@/lib/guest-cart/after-login';
import { readGuestCart } from '@/lib/guest-cart/store';
import { useGuestCartLines } from '@/lib/guest-cart/use-guest-cart';

// Sau khi xoá một dòng, khách có chừng này để hoàn tác (thêm lại đúng phân loại và số lượng).
// 10 giây: người dùng bàn phím/đọc màn hình cần đủ thời gian tới nút "Hoàn tác" (WCAG 2.2.1); đồng hồ còn dừng khi trỏ/focus đang ở trên thanh.
const UNDO_WINDOW_MS = 10_000;

// Ô −/+ của dòng giỏ: từ md nút trần 44px trong khung viền chung; ở điện thoại là hai ô vuông 36px có viền tách rời như QuantitySelector size sm của
// Mini App, vùng chạm vẫn 44x44 nhờ .tubu-hit-44-square (giãn 4px mỗi phía, nằm trong khe 8px nên không chồng nút bên cạnh). Ô 44px làm bộ đếm
// rộng ~134px, giá + bộ đếm không vừa cột chữ ~203px ở 375px và bộ đếm rớt xuống hàng riêng.
const qtyButton =
  'tubu-hit-44-square flex h-11 w-11 items-center justify-center text-lg disabled:opacity-40 aria-disabled:opacity-40 max-md:h-9 max-md:w-9 max-md:rounded-control max-md:border max-md:border-[var(--color-border-subtle)] max-md:bg-[var(--color-bg-surface)]';

// Nút −/+ còn bấm được thì co 0,97 khi nhấn (`.tubu-press`, tắt khi khách chọn giảm chuyển động); đã khoá thì đứng yên như Mini App.
const qtyButtonFor = (off: boolean) => (off ? qtyButton : `${qtyButton} tubu-press`);

// Chunk giỏ trống chỉ tải khi giỏ rỗng: lúc chờ giữ chỗ bằng khung giả thay vì để trắng một nhịp. Có vẽ ở máy chủ: bản dựng sẵn cho khách
// (app/gio-hang/khach) đưa giỏ trống và kệ gợi ý vào HTML đầu.
const EmptyCart = dynamic(() => import('./empty-cart'), {
  loading: () => (
    <div role="status" aria-busy="true" className="flex flex-col items-center gap-3 py-10">
      <span className="sr-only">Đang tải giỏ hàng…</span>
      <Skeleton width={120} height={96} />
      <Skeleton width={180} height={18} />
      <Skeleton width={240} height={14} />
      <Skeleton width={160} height={44} />
    </div>
  ),
});

// Lưới của giỏ có dòng và của khung chờ dùng chung một chuỗi lớp, nên khung chờ không nhảy khi giỏ về (một cột tới md, từ lg cột tóm tắt 360px).
const CART_GRID = 'grid grid-cols-1 gap-6 max-md:gap-3 md:mx-auto md:max-w-2xl lg:max-w-none lg:grid-cols-[minmax(0,1fr)_360px]';

function CartSkeleton() {
  return (
    <div role="status" aria-busy="true" className={`${CART_GRID} py-4`}>
      <span className="sr-only">Đang tải giỏ hàng…</span>
      <div className="flex min-w-0 flex-col gap-3">
        <LineItemSkeleton />
        <LineItemSkeleton />
        <LineItemSkeleton />
      </div>
      <div aria-hidden="true" className={`hidden h-fit flex-col gap-2.5 p-4 ${ui.card} lg:flex lg:self-start`}>
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={44} />
        <Skeleton height={20} />
        <Skeleton height={44} />
      </div>
    </div>
  );
}

/** Việc khách làm trên MỘT dòng giỏ: đổi số lượng hoặc xoá. Chung một khoá theo dòng nên tăng/giảm/xoá của cùng dòng không đua nhau. */
type LineOp = { op: 'qty'; id: string; q: number } | { op: 'remove'; id: string; line?: CartLine };
const LINE_OP_KEY = ['cart-line-op'] as const;

// Ở phạm vi module (không đọc state/props) để các effect dùng được mà không phải khai làm phụ thuộc.
const focusIsFree = () => !document.activeElement || document.activeElement === document.body;
const focusHeading = () => {
  if (!focusIsFree()) return;
  const h = document.querySelector<HTMLElement>('main h1');
  if (!h) return;
  h.tabIndex = -1;
  h.addEventListener('blur', () => h.removeAttribute('tabindex'), { once: true });
  h.focus();
};

const clampPercent = (pct: number) => (Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0);

export default function CartPage() {
  const phase = useAuthPhase();
  const guestCart = useGuestCartFlag();
  // Qua hook (máy chủ và lượt hydrate thấy giỏ trống), không đọc thẳng localStorage lúc vẽ: bản dựng sẵn cho khách hydrate ngay nhánh khách.
  const guestLines = useGuestCartLines();
  // Món chọn lúc chưa đăng nhập vừa chuyển vào giỏ tài khoản mà có món không chuyển đủ: báo một lần ở đầu giỏ.
  const [mergeNote, setMergeNote] = useState<GuestMergeNote | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (phase === 'authenticated') setMergeNote(takeGuestMergeNote());
  }, [phase]);
  // Món chưa chuyển được lúc đăng nhập (cấu hình về chậm, mạng chập chờn) thì gộp nốt mỗi lần mở giỏ.
  useEffect(() => {
    if (phase !== 'authenticated' || !guestCart.enabled || readGuestCart().length === 0) return;
    let live = true;
    void runGuestMerge(queryClient).then(() => {
      const note = takeGuestMergeNote();
      if (live && note) setMergeNote(note);
    });
    return () => {
      live = false;
    };
  }, [phase, guestCart.enabled, queryClient]);
  // Điện thoại: hàng mã giảm giá nằm trong thanh dính đáy (như Mini App); khổ lớn hơn: trong khung tóm tắt. Một thẻ duy nhất, nên chọn chỗ bằng JS.
  const phoneCoupon = useMediaQuery('(max-width: 767px)');
  const router = useRouter();
  const cartKeyNow = useCartKey();
  const cartQ = useQuery({ queryKey: cartKeyNow, queryFn: getCart, enabled: phase === 'authenticated' });
  // `cart_viewed` một lần mỗi lần mở giỏ, khi dữ liệu giỏ có lần đầu (kể cả bản trong bộ nhớ đệm); tải lại giỏ sau đó không phát thêm.
  const cartViewed = useRef(false);
  useEffect(() => {
    const c = cartQ.data;
    if (!c || cartViewed.current) return;
    cartViewed.current = true;
    trackPurchase('cart_viewed', { itemCount: Math.min(500, c.items.length), subtotalBucket: subtotalBucket(c.subtotal) });
  }, [cartQ.data]);
  // Máy chủ gỡ mã khi giỏ rơi dưới đơn tối thiểu và chỉ báo đúng một lần: nhớ để khách thấy mã nào mất và cần mua thêm bao nhiêu.
  const removedCoupon = useRemovedCoupon(cartQ.data, formatVnd);
  // Chọn món để thanh toán một phần giỏ: nhớ tập ĐÃ BỎ CHỌN nên món mới thêm tự được chọn và món đã xoá tự biến mất.
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());
  // Chọn một phần giỏ (còn ít nhất một dòng): hỏi máy chủ giá của đúng phần đó, cùng nhịp debounce với xem trước mã. Chọn cả giỏ
  // dùng thẳng giỏ trong bộ nhớ, không hỏi thêm. Khoá nằm dưới ['cart', gian hàng] nên làm mới giỏ cũng làm mới giá phần chọn.
  const subsetLines = (cartQ.data?.items ?? []).filter((it) => !deselected.has(it.id));
  // Mã đang áp nằm trong dấu vân tay: áp/bỏ mã đổi giá phần chọn dù id, số lượng, thành tiền không đổi.
  const subsetSig =
    cartQ.data && subsetLines.length > 0 && subsetLines.length < cartQ.data.items.length
      ? JSON.stringify([subsetLines.map((it) => it.id), couponPreviewKey(subsetLines), cartQ.data.couponCode])
      : null;
  const settledSubsetSig = useSettled(subsetSig, PREVIEW_DEBOUNCE_MS);
  const selectionQ = useQuery({
    queryKey: [...cartKeyNow, 'selection', settledSubsetSig],
    queryFn: () => getCartSelection((JSON.parse(settledSubsetSig!) as [string[], string, string | null])[0]),
    enabled: phase === 'authenticated' && !!settledSubsetSig,
    retry: false,
  });
  // Số chỉ đúng cho đúng phần đã hỏi: vừa đổi chọn/số lượng (chưa hỏi lại), đang tải lại hoặc lỗi thì không hiện số cũ.
  const priced =
    !!subsetSig && settledSubsetSig === subsetSig && selectionQ.isSuccess && !selectionQ.isFetching ? selectionQ.data : null;
  // Cùng gian hàng thanh toán gửi (combo) để số giảm của từng mã đúng số thanh toán sẽ trừ.
  const [ctvSlug] = useState(() => ctvSlugFor(getStorefrontContext()));
  const toggleSelect = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Quà tặng dùng thử 0đ: lưu lựa chọn vào giỏ. Cả giỏ thì giỏ trả về thay cache; chọn một phần thì đọc lại giỏ và phần đang chọn.
  const giftChoice = useMutation({
    mutationFn: ({ variationId, itemIds }: { variationId: string | null; itemIds?: string[] }) => setCartGift(variationId, itemIds),
    onSuccess: (c, { itemIds }) => {
      if (itemIds) void queryClient.invalidateQueries({ queryKey: cartKeyNow });
      else queryClient.setQueryData(cartKeyNow, c);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: cartKeyNow }),
  });
  const [removedLine, setRemovedLine] = useState<CartLine | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  // Lỗi nhớ theo từng dòng: `mutation.error` chỉ giữ lệnh sau cùng nên lệnh của dòng A lỗi sau khi dòng B đã chạy sẽ mất lời báo.
  const [lineErrors, setLineErrors] = useState<ReadonlyMap<string, unknown>>(() => new Map());
  const cartWrite = useCartWrite();
  // Gợi ý đổi dòng chai sang gói Refill (cờ tắt: không gọi máy chủ, không vẽ gì). Một thanh Hoàn tác cho cả bỏ món lẫn đổi Refill.
  const refill = useCartRefill(
    cartQ.data?.items,
    (e) => setUndoError(actionErrorText(e)),
    () => {
      setUndoError(null);
      setRemovedLine(null);
    },
  );
  // Khoá đồng bộ theo dòng (không theo lệnh sau cùng): state chỉ đúng sau lần vẽ kế, và `variables` của mutation đổi sang dòng khác sẽ mở nhầm dòng đang bay.
  const lineOp = useLockedMutation(
    {
      mutationKey: LINE_OP_KEY,
      mutationFn: (v: LineOp) => (v.op === 'qty' ? updateCartItem(v.id, v.q) : removeCartItem(v.id)),
      onMutate: (v) => {
        setLineErrors((prev) => new Map([...prev].filter(([id]) => id !== v.id)));
        return cartWrite.begin();
      },
      // Thanh hoàn tác dựng ở đây chứ không ở callback riêng của `mutate()`: callback riêng chỉ chạy cho lệnh sau cùng, nên chạm dòng khác lúc lệnh xoá còn bay sẽ làm mất thanh.
      // Thanh chỉ mở sau khi máy chủ xoá xong: hoàn tác (thêm lại) không được vượt mặt lệnh xoá còn đang bay.
      // Trả lời hứa tải lại giỏ (khi có lệnh chồng): lệnh còn "đang bay", khoá dòng còn giữ, tới khi giỏ mới về.
      onSuccess: (data, v, cmd) => {
        const refreshed = cartWrite.write(cmd, data);
        // Đã sửa giỏ sau khi đổi sang Refill: Hoàn tác không còn trả đúng trạng thái cũ nên đóng lại.
        refill.dismiss();
        if (v.op === 'remove' && v.line) {
          setUndoError(null);
          setRemovedLine(v.line);
        }
        return refreshed;
      },
      // Máy chủ từ chối vì giỏ đã khác (dòng đã bị xoá hay hết hàng ở nơi khác): lời lỗi hiện ngay, giỏ tải lại, và khoá dòng giữ tới khi giỏ mới về (tối đa `LOCK_REFRESH_WAIT_MS`)
      // như Mini App; nhả sớm thì chạm lần hai chạy lại lệnh trên số cũ hoặc trên dòng đã mất. Lỗi mạng và 5xx không tải lại: lần tải cũng hỏng.
      onError: (error, v, cmd) => {
        setLineErrors((prev) => new Map(prev).set(v.id, error));
        const reloaded = cartWrite.fail(cmd, serverRejectedState(error));
        return reloaded ? settleWithin(reloaded) : undefined;
      },
    },
    (v) => v.id,
  );
  // Mọi lệnh dòng đang bay (không chỉ lệnh sau cùng): nút của đúng các dòng đó báo aria-busy, dòng khác vẫn bấm được.
  const inFlightOps = useMutationState({ filters: { mutationKey: LINE_OP_KEY, status: 'pending' }, select: (m) => m.state.variables as LineOp });
  const busyIds = new Set(inFlightOps.map((v) => v.id));
  // Hộp báo "bộ sẽ mất giảm" trước khi xoá món khoá của combo. Dữ liệu giữ lại sau khi đóng để chữ không trống khi hộp tắt.
  const [pendingRemove, setPendingRemove] = useState<{ line: CartLine; notice: ComboRemovalNotice } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Hộp gỡ khi dòng chờ xoá không còn trong giỏ (làm mới giỏ vì tab khác đã xoá, kể cả giỏ về trống): "Vẫn bỏ" không được xoá dòng đã mất, và hộp không được bật lại khi giỏ có hàng lần sau.
  const pendingGone = !!pendingRemove && !(cartQ.data?.items ?? []).some((it) => it.id === pendingRemove.line.id);
  useEffect(() => {
    if (pendingGone) setConfirmOpen(false);
  }, [pendingGone]);
  const undoRef = useRef<HTMLButtonElement>(null);
  const undoHold = useAutoDismiss(!!removedLine, UNDO_WINDOW_MS, () => setRemovedLine(null), removedLine);
  // Dòng vừa xoá bị gỡ khỏi cây kéo theo nút Xoá đang giữ focus: chuyển focus sang "Hoàn tác" để bàn phím không rơi về đầu trang.
  // Chỉ khi nút Xoá đang có vòng lấy nét (người dùng bàn phím): chuột/cảm ứng không bị giữ đồng hồ vì một focus họ không thấy.
  // Đợi phản hồi chậm thì khách có thể đã Tab sang ô khác (vd gõ mã giảm giá): chỉ kéo focus khi nó đang rơi về body, không giật khỏi chỗ khách đang làm.
  const focusUndo = useRef(false);
  const removeOrigin = useRef<Element | null>(null);
  useEffect(() => {
    if (removedLine && focusUndo.current && (focusIsFree() || document.activeElement === removeOrigin.current)) undoRef.current?.focus();
    focusUndo.current = false;
  }, [removedLine]);
  // Hết giờ Giờ vàng khi khách đang xem: lấy lại giỏ để máy chủ tính lại giá, không cần tải trang.
  const refreshCart = () => void cartWrite.reload();
  // Bấm "Hoàn tác" bằng bàn phím làm thanh hoàn tác biến mất khi nó đang giữ focus: đưa focus tới dòng vừa thêm lại (hoặc tiêu đề trang nếu dòng không còn).
  const restoreFocus = useRef<{ variationId: string } | null>(null);
  useEffect(() => {
    const want = restoreFocus.current;
    if (!want) return;
    restoreFocus.current = null;
    const lines = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="cart-line"]'));
    const row = lines.find((l) => l.dataset.variationId === want.variationId);
    const target = row?.querySelector<HTMLElement>('input[type="checkbox"]');
    if (!focusIsFree()) return;
    if (target) target.focus();
    else focusHeading();
  }, [cartQ.data, cartQ.dataUpdatedAt]);
  const removeWithUndo = (line: CartLine) => {
    removeOrigin.current = document.activeElement;
    try {
      focusUndo.current = !!document.activeElement?.matches(':focus-visible');
    } catch {
      focusUndo.current = false;
    }
    lineOp.mutate({ op: 'remove', id: line.id, line });
  };
  // Khoá đồng bộ: `removedLine` trong closure chỉ về null sau lần vẽ kế, hai cú bấm "Hoàn tác" sát nhau sẽ thêm lại hai lần (số lượng nhân đôi).
  const undoing = useRef(false);
  const undoRemove = () => {
    if (!removedLine || undoing.current) return;
    undoing.current = true;
    const line = removedLine;
    let viaKeyboard = false;
    try {
      viaKeyboard = !!document.activeElement?.matches(':focus-visible');
    } catch {
      viaKeyboard = false;
    }
    setRemovedLine(null);
    const cmd = cartWrite.begin();
    addToCart(line.variationId, line.quantity)
      .then((c) => {
        if (viaKeyboard) restoreFocus.current = { variationId: line.variationId };
        cartWrite.write(cmd, c);
      })
      .catch((e: unknown) => {
        cartWrite.fail(cmd);
        setUndoError(actionErrorText(e));
        if (viaKeyboard) focusHeading();
      })
      .finally(() => {
        undoing.current = false;
      });
  };

  // Phí giao ước tính chỉ khi phần chọn toàn hàng Tubu giao (gian hàng tự giao có phí riêng, chỉ biết ở Thanh toán); tiền hàng như thanh Miễn phí giao hàng.
  // Gọi trước các `return` theo phiên đăng nhập bên dưới.
  const estSelected = (cartQ.data?.items ?? []).filter((it) => !deselected.has(it.id));
  const estBase =
    phase === 'authenticated' && estSelected.length > 0 && !estSelected.some((it) => it.fulfiller?.kind === 'MERCHANT')
      ? estSelected.filter((it) => it.stock > 0).reduce((sum, it) => sum + it.total, 0)
      : null;
  const shipQ = useShippingEstimate(estBase);
  // Dải mua thêm ở đầu Giỏ có đang hiện không (`onShownChange`); gọi trước các `return` theo phiên đăng nhập.
  const [aovRailShown, setAovRailShown] = useState<boolean | null>(null);

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
    // Cờ đang tải lần đầu mà giỏ khách có món (cờ từng bật): chờ, kẻo tường đăng nhập chớp lên rồi đổi sang giỏ khách. Giỏ khách trống thì
    // hiện tường đăng nhập ngay như khi chưa có giỏ khách.
    if (guestCart.pending && guestLines.length > 0) {
      return (
        <Shell>
          <AuthLoading />
        </Shell>
      );
    }
    return (
      <Shell>
        {guestCart.enabled ? (
          <GuestCartView empty={<EmptyCart />} gridClassName={CART_GRID} />
        ) : (
          <LoginRequired message="Đăng nhập để xem giỏ hàng của bạn." returnTo="/gio-hang" />
        )}
      </Shell>
    );
  }

  const cart = cartQ.data;
  // Món khoá của combo (bỏ riêng nó thì bộ hết khớp) phải hỏi trước khi xoá; không chặn: "Vẫn bỏ" xoá như thường, "Giữ lại" thôi.
  const requestRemove = (line: CartLine) => {
    const notice = comboRemovalNotice(cart?.comboGroups, line.id);
    if (!notice) return removeWithUndo(line);
    setPendingRemove({ line, notice });
    setConfirmOpen(true);
  };
  const confirmRemove = () => {
    setConfirmOpen(false);
    if (pendingRemove) removeWithUndo(pendingRemove.line);
  };
  // Checkout sẽ từ chối dòng hết hàng/vượt tồn: chặn từ giỏ để khách biết phải sửa gì thay vì gặp lỗi ở bước sau.
  const allItems = cart?.items ?? [];
  const selectedItems = allItems.filter((it) => !deselected.has(it.id));
  const allSelected = selectedItems.length === allItems.length;
  // Quà dùng thử theo đúng phần đang chọn: chọn một phần mà giá phần đó chưa về thì ẩn, không hiện mốc của cả giỏ.
  const giftTrialShown = allSelected ? cart?.giftTrial : priced?.giftTrial;
  // Dòng hết hàng (tồn 0) không mua được: không cộng vào tạm tính hay tiến độ miễn phí giao, như Mini App.
  const buyableSelected = selectedItems.filter((it) => it.stock > 0);
  const selectedSubtotal = buyableSelected.reduce((sum, it) => sum + it.total, 0);
  const selectedCount = selectedItems.reduce((sum, it) => sum + it.quantity, 0);
  // Chỉ chặn theo các dòng đang chọn: bỏ chọn dòng hết hàng thì vẫn thanh toán được phần còn lại.
  const outOfStockSelected = selectedItems.filter((it) => it.stock <= 0);
  const stockBlocked = selectedItems.some((it) => it.stock <= 0 || it.quantity > it.stock);
  const toggleAll = () => setDeselected(allSelected ? new Set(allItems.map((it) => it.id)) : new Set());
  // Mỗi nơi giao thành một đơn riêng khi đặt (D4): chia giỏ theo nơi giao để khách thấy trước.
  const groups = groupByFulfiller(allItems);
  const withHeaders = showFulfillerHeaders(groups);
  const hasMerchant = groupByFulfiller(selectedItems).some((g) => g.fulfiller.kind === 'MERCHANT');
  // Tiến độ miễn phí giao hàng theo phần ĐANG CHỌN (đúng số sẽ thanh toán); có hàng gian hàng tự giao thì chỉ tính phần Tubu giao và chỉ hiện khi phần đó > 0.
  const freeshipBase = hasMerchant ? tubuSubtotal(buyableSelected) : selectedSubtotal;
  // `cart.freeship` do máy chủ tính trên cả giỏ kể cả dòng hết hàng, nên không tin khi còn dòng hết hàng đang chọn.
  const serverFreeship = !hasMerchant && allSelected && !!cart?.freeship && buyableSelected.length === selectedItems.length;
  const freeship = cart ? freeshipProgress({ base: freeshipBase, threshold: cart.freeshipThreshold, serverReached: serverFreeship }) : null;
  const showFreeship = !!cart && (!hasMerchant || freeshipBase > 0);
  // Số giảm hiển thị: cả giỏ lấy từ giỏ, một phần giỏ lấy từ giá phần chọn của máy chủ; chưa có giá đó thì không hiện (thanh toán tính lại).
  const shown = allSelected ? cart : priced;
  const shownDiscount = shown?.discount ?? 0;
  const shownCombo = shown?.comboDiscount ?? 0;
  const shownTier = shown?.tierDiscount ?? 0;
  // Hộp Xanh nằm trong `comboDiscount` của máy chủ: tách ra dòng riêng, tổng không đổi. Tiến độ đọc cùng nguồn số với các dòng giảm.
  const shownGreenBox = greenBoxDiscountOf(shown);
  const shownComboOnly = comboOnlyDiscount(shown);
  const greenBox = showFreeship ? readGreenBox(shown) : null;
  const strip = cartProgressStrip(!!freeship?.reached, greenBox);
  const greenBoxView = strip === 'greenBox' ? greenBoxProgress(greenBox) : null;
  const greenBoxHint = strip === 'freeship' ? greenBoxCartHint(greenBox) : null;
  // Dải mua thêm món nhỏ: mốc kế tiếp là Miễn phí giao hàng, đạt rồi thì quà dùng thử 0đ của đúng phần đang chọn (giá phần chọn chưa về thì không có mốc quà).
  const aovGoal =
    showFreeship && freeship && cart
      ? aovUpsellGoal({ base: freeshipBase, freeship: { ...freeship, threshold: cart.freeshipThreshold }, giftTrial: giftTrialShown, tubuOnly: hasMerchant })
      : null;
  // Ô quà khoá không nói lại số dải mốc quà đang nói, và không nói "Thêm …" khi giỏ tạm đã đủ mốc mà giỏ chưa đọc lại.
  const giftLockedShown = aovGiftLockedRowShown({ goal: aovGoal, railShown: aovRailShown, base: freeshipBase, giftTrial: giftTrialShown });
  // Giảm giá của phần chọn tính trên tạm tính CỦA CHÍNH phần chọn máy chủ trả (giá có thể đổi so với giỏ đã tải, vd hết giờ vàng).
  const shownSubtotal = !allSelected && priced ? priced.subtotal : selectedSubtotal;
  const payTotal = Math.max(0, shownSubtotal - shownCombo - shownDiscount - shownTier);
  const hasDiscount = shownCombo + shownDiscount + shownTier > 0;
  // Có phí giao ước tính: "Tổng tạm tính" = tiền hàng đã giảm + phí. Chưa có thì như cũ: `payTotal` chưa gồm phí giao nên không ghi "Tổng".
  // Một nhãn và một số cho chân dính (375) và khung tóm tắt (md, lg), cùng chữ với Mini App.
  const ship = cartShippingView(shipQ.estimate, { goodsNet: payTotal, freeshipReached: !!freeship?.reached, stale: shipQ.stale });
  // Ước tính phí giao về sau giỏ: lúc còn chờ thì giữ sẵn dòng phí ("Đang tính…"), không thì thanh dính đáy cao thêm một dòng khi số về và cả
  // thanh nhảy lên (CLS ở 390px). Tổng và nhãn tổng vẫn chỉ theo số thật (`ship`).
  const shipRow = ship ?? (shipQ.pending ? { feeLabel: fillCopy('cart.shipEstimate'), feeText: fillCopy('checkout.calculating'), free: false } : null);
  const totalLabel = ship?.totalLabel ?? cartTotalLabel(shownCombo + shownDiscount + shownTier);
  const shownTotal = ship?.total ?? payTotal;
  // Tiết kiệm = giá gạch của dòng mua được đang chọn + giảm combo đang hiện (chỉ hiển thị; tiền thật do máy chủ tính). Mã giảm giá và hạng đã có dòng riêng nên không cộng.
  const saving = cartSaving(buyableSelected, shownCombo);
  const onPay = () => {
    rememberCheckoutSelection(allSelected ? null : selectedItems.map((it) => it.id));
    markCheckoutEntry(allSelected ? 'cart' : 'cart_subset');
  };
  // Lý do nút Thanh toán đang khoá (lời giải thích đầy đủ nằm ở khung tóm tắt; thanh dính đáy nhắc lại ngay cạnh nút).
  const payHint =
    selectedItems.length === 0
      ? 'Chọn ít nhất một sản phẩm để thanh toán.'
      : stockBlocked
        ? outOfStockSelected.length > 0
          ? cartOutOfStockBlocked(outOfStockSelected.map((it) => it.productName))
          : CART_OVER_STOCK_BLOCKED
        : null;
  const showBar = !cartQ.isLoading && !!cart && cart.items.length > 0;
  // Liên kết "Đã có chai? Đổi sang Refill …" theo đúng mốc màn đang hiện (phần đang chọn): đổi làm tụt mốc thì hỏi lại trước.
  const refillViews = refillSwapOffers({
    lines: allItems,
    pairs: refill.pairs,
    comboGroups: cart?.comboGroups,
    milestones: {
      freeship: showFreeship && freeship && cart ? { base: freeshipBase, threshold: cart.freeshipThreshold, reached: freeship.reached, tubuOnly: hasMerchant } : null,
      giftTrial: giftTrialShown,
      greenBox,
    },
    isSelected: (id) => !deselected.has(id),
    saving: refill.saving,
  });
  const refillConfirm = refill.confirm && refillConfirmText(refill.confirm);
  // Một thanh Hoàn tác cho cả đổi Refill lẫn bỏ món (như Mini App): lệnh sau cùng thắng, thanh của lệnh trước đóng.
  const undoBar = refill.receipt
    ? { text: fillCopy('refill.swapped'), onUndo: refill.undo, hold: refill.hold }
    : removedLine
      ? { text: 'Đã bỏ khỏi giỏ', onUndo: undoRemove, hold: undoHold }
      : null;

  // Một dòng giỏ; dòng của bộ combo và dòng lẻ vẽ cùng một hàm.
  const renderLine = (it: CartLine) => {
    // Hết hàng / vượt tồn: `+` chỉ làm khách mất dòng (quantity kẹp về 0 → API xoá) mà không báo gì.
    const soldOut = it.stock <= 0;
    const atMax = it.quantity >= qtyPickMax(it.stock) || it.quantity > it.stock;
    const stockNote = cartStockNote(it.quantity, it.stock);
    const busy = busyIds.has(it.id);
    const qtyPending = inFlightOps.some((v) => v.op === 'qty' && v.id === it.id);
    const lineError = lineErrors.get(it.id);
    const compareAt = lineCompareAt(it);
    const lineVariation = variationLabel(it.variationName);
    const swap = refillViews.get(it.id);
    return (
      <div key={it.id} data-testid="cart-line" data-variation-id={it.variationId} className="flex gap-3 p-3 max-md:relative max-md:items-center max-md:rounded-card max-md:bg-[var(--color-bg-surface)] max-md:shadow-[var(--elevation-1)]">
        <label className="tubu-hit-flush relative flex h-11 w-9 flex-none cursor-pointer items-center justify-center md:max-lg:-mx-1 md:max-lg:min-w-11">
          <span className={miniCheckboxWrap}>
            <input
              type="checkbox"
              checked={!deselected.has(it.id)}
              onChange={() => toggleSelect(it.id)}
              aria-label={`Chọn ${it.productName} để thanh toán`}
              className={miniCheckbox}
            />
            <CheckMark />
          </span>
        </label>
        <Link
          href={`/san-pham/${it.slug}`}
          tabIndex={-1}
          aria-hidden="true"
          data-testid="cart-line-thumb"
          className="flex-none max-md:self-start"
        >
          <ProductThumb src={it.thumbnail} alt="" size={64} />
        </Link>
        {/*
          Cột chữ là hàng tự xuống dòng để điện thoại xếp lại đúng thứ tự của Mini App chỉ bằng `order`: tên, phân loại, nhãn Giờ vàng +
          "Kết thúc sau …", lưu ý, [giá + bộ đếm cùng một hàng], Thành tiền; thùng rác ở góc trên phải. Từ md giá và nhãn Giờ vàng nằm
          chung một hàng như cũ.
        */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
          <div className="basis-full break-words text-sm font-medium text-stone-900 max-md:pr-9">
            <Link href={`/san-pham/${it.slug}`} className="tubu-hit-44 block hover:underline">
              {it.productName}
            </Link>
          </div>
          {lineVariation && <div className="basis-full break-words text-caption text-stone-600 max-md:text-[color:var(--color-text-tertiary)]">{lineVariation}</div>}
          <div className="mt-1 flex items-baseline gap-x-2 max-md:order-3 max-md:mt-1.5 max-md:flex-col max-md:items-start max-md:gap-0">
            {/* Điện thoại: giá 14/20 và giá gạch 12/16 như PriceTag sm + stack của Mini App, khối giá cao 36 bằng bộ đếm nên dòng giảm giá không cao hơn dòng thường. */}
            <span className={`font-semibold max-md:text-[length:var(--type-price-sm-size)] max-md:leading-5 max-md:tabular-nums ${compareAt || it.isFlash ? 'text-[color:var(--color-text-price-deal)]' : 'text-stone-900'}`}>{formatVnd(it.unitPrice)}</span>
            {compareAt && (
              <span className="text-caption text-[color:var(--color-text-price-compare)] line-through max-md:text-[length:var(--type-label-size)] max-md:leading-4 max-md:tabular-nums">
                {formatVnd(compareAt)}
              </span>
            )}
          </div>
          {it.isFlash && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 max-md:order-1 max-md:basis-full max-md:gap-x-1.5">
              <span data-testid="cart-flash-badge">
                <Badge tone="promo" size="sm" icon={Zap}>
                  Giờ vàng
                </Badge>
              </span>
              {it.flashEndAt ? (
                <span className="text-caption text-stone-600">
                  <Countdown endAt={it.flashEndAt} mode="text" onEnd={refreshCart} />
                </span>
              ) : (
                it.soldPct != null && Number.isFinite(it.soldPct) && clampPercent(it.soldPct) > 0 && (
                  <span className="text-caption text-stone-600">Đã bán {clampPercent(it.soldPct)}%</span>
                )
              )}
            </div>
          )}
          {/* Số của máy chủ (it.total): máy chủ có thể tính lại giá cả dòng (flash hết suất). Ẩn khi lệnh đổi số lượng của dòng còn bay, vì lúc đó số chưa phải của máy chủ. Từ md đã có cột tổng bên phải. */}
          {it.quantity > 1 && !qtyPending && (
            <div className="basis-full text-caption tabular-nums text-stone-600 max-md:order-4 max-md:mt-0.5 md:hidden">Thành tiền {formatVnd(it.total)}</div>
          )}
          {it.flashLimitNotice && <p className="mt-1 basis-full text-caption font-medium text-warning-fg max-md:order-2">{it.flashLimitNotice}</p>}
          {soldOut && (
            <p className="mt-1 flex basis-full items-center gap-1 text-caption text-warning-fg max-md:order-2">
              <AlertTriangle size={13} aria-hidden className="shrink-0" />
              {CART_OUT_OF_STOCK}
            </p>
          )}
          {/* Tồn thấp chạm trần (giải thích nút + khoá) hoặc đang vượt tồn: cùng luật `cartStockNote` với Mini. */}
          {stockNote && (
            <p className="mt-1 flex basis-full items-center gap-1 text-caption text-warning-fg max-md:order-2">
              <AlertTriangle size={13} aria-hidden className="shrink-0" />
              {stockNote}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 md:basis-full max-md:contents">
            <div className="flex items-center rounded-control border border-stone-450 text-sm max-md:order-3 max-md:ml-auto max-md:gap-2 max-md:rounded-none max-md:border-0">
              <button
                type="button"
                onClick={() => lineOp.mutate({ op: 'qty', id: it.id, q: it.quantity > it.stock ? Math.min(it.quantity - 1, overStockTarget(it.stock)) : it.quantity - 1 })}
                disabled={soldOut || it.quantity <= 1}
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                aria-label={`Giảm số lượng ${it.productName}`}
                className={qtyButtonFor(soldOut || it.quantity <= 1 || busy)}
              >
                <Minus className="h-[18px] w-[18px] md:hidden" strokeWidth={2.2} aria-hidden="true" />
                <span className="max-md:hidden">−</span>
              </button>
              <span className="w-7 text-center tabular-nums text-stone-900 max-md:min-w-[22px] max-md:font-semibold" aria-live="polite">
                {it.quantity}
              </span>
              <button
                type="button"
                onClick={() => lineOp.mutate({ op: 'qty', id: it.id, q: it.quantity + 1 })}
                disabled={soldOut || atMax}
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                aria-label={`Tăng số lượng ${it.productName}`}
                className={qtyButtonFor(soldOut || atMax || busy)}
              >
                <Plus className="h-[18px] w-[18px] md:hidden" strokeWidth={2.2} aria-hidden="true" />
                <span className="max-md:hidden">+</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => !busy && requestRemove(it)}
              aria-busy={busy || undefined}
              aria-disabled={busy || undefined}
              aria-label={`Xoá ${it.productName} khỏi giỏ hàng`}
              aria-haspopup={comboRemovalNotice(cart?.comboGroups, it.id) ? 'dialog' : undefined}
              className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-danger-fg disabled:opacity-40 aria-disabled:opacity-40 max-md:absolute max-md:right-1 max-md:top-1 max-md:min-w-11 max-md:justify-center max-md:px-0"
            >
              <Trash2 className="h-5 w-5 text-[color:var(--color-text-primary)] md:hidden" strokeWidth={1.75} aria-hidden="true" />
              <span className="max-md:hidden">Xoá</span>
            </button>
          </div>
          {swap && <RefillSwapLink view={swap} disabled={refill.busy} onPress={refill.press} />}
          {lineErrors.has(it.id) && (
            <p role="alert" className="mt-1 basis-full text-caption text-danger-fg max-md:order-5">
              {actionErrorText(lineError)}
            </p>
          )}
        </div>
        <div className="flex-none font-semibold text-stone-900 max-md:hidden">{formatVnd(it.total)}</div>
      </div>
    );
  };

  const couponBox = (sheet: boolean) => (
    <CartCouponBox
      sheet={sheet}
      currentCode={cart!.couponCode}
      appliedDiscount={shownDiscount}
      subtotal={selectedSubtotal}
      // Câu giải thích chỉ hiện khi thuộc phần đang hiển thị: cả giỏ, hoặc giá phần chọn đã có; chưa có thì thôi (không mượn câu của cả giỏ).
      notice={couponNoticeText(shown, formatVnd)}
      removedNotice={removedCoupon.notice}
      onDismissRemoved={removedCoupon.dismiss}
      // Không chọn món nào: không hỏi máy chủ (itemIds rỗng bị coi là cả giỏ), thẻ giữ cách hiện cũ.
      preview={
        selectedItems.length === 0
          ? undefined
          : { storefrontSlug: ctvSlug, itemIds: allSelected ? undefined : selectedItems.map((it) => it.id) }
      }
      previewKey={couponPreviewKey(selectedItems)}
      productIds={couponProductIds(selectedItems)}
    />
  );

  return (
    <Shell>
      {mergeNote && (
        <div role="status" data-testid="guest-merge-note" className="mb-3 space-y-0.5 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          {mergeNote.failedLines > 0 && <p>{fillCopy('guestCart.mergeFailed', { n: mergeNote.failedLines })}</p>}
          {mergeNote.reduced > 0 && <p>{fillCopy('guestCart.mergeReduced', { n: mergeNote.reduced })}</p>}
          {mergeNote.kept > 0 && <p>{fillCopy('guestCart.mergeKept', { n: mergeNote.kept })}</p>}
        </div>
      )}
      {cart && (cart.unavailableItems?.length ?? 0) > 0 && (
        <div
          role="status"
          className="mb-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg"
        >
          <p className="font-semibold">{cart.unavailableItems!.length} sản phẩm đã ngừng bán</p>
          <p className="mt-0.5">Không thể đặt các sản phẩm này nên đã được tách khỏi đơn của bạn.</p>
          <ul className="mt-2 space-y-1">
            {cart.unavailableItems!.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-words line-through">
                  {joinVariationLine(it.productName, variationLabel(it.variationName))} × {it.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => lineOp.mutate({ op: 'remove', id: it.id })}
                  aria-busy={busyIds.has(it.id) || undefined}
                  aria-disabled={busyIds.has(it.id) || undefined}
                  aria-label={`Xoá ${it.productName} khỏi giỏ hàng`}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 font-semibold underline aria-disabled:opacity-50"
                >
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cartQ.isLoading ? (
        <CartSkeleton />
      ) : cartQ.isError && !cart ? (
        <ErrorState message={loadErrorText(cartQ.error)} onRetry={() => cartQ.refetch()} />
      ) : !cart || cart.items.length === 0 ? (
        <EmptyCart />
      ) : (
        <div className={CART_GRID}>
          <div className="min-w-0">
            {showFreeship && freeship && (
              <CartUnlockSlot testId="cart-freeship" className="mb-3 max-md:mb-2" level={cartUnlockLevel(freeship.reached, greenBox?.tier?.minItems)}>
                {greenBoxView ? (
                  <GreenBoxStrip view={greenBoxView} onMore={() => router.push('/hop-xanh')} />
                ) : (
                  <FreeShippingProgressBar
                    base={freeshipBase}
                    threshold={cart.freeshipThreshold}
                    serverReached={serverFreeship}
                    tubuOnly={hasMerchant}
                    giftThreshold={cartGiftThreshold(giftTrialShown)}
                    onShopMore={() => router.push('/')}
                  />
                )}
                {aovGoal && <FreeshipAddons goal={aovGoal} lines={allItems} exclude={aovGiftExclusions(giftTrialShown ?? cart.giftTrial)} onShownChange={setAovRailShown} />}
              </CartUnlockSlot>
            )}
            <GreenBoxEvents state={greenBox} visible={greenBoxView !== null || greenBoxHint !== null} />
            <CartVoucherHintSection
              currentCode={cart.couponCode}
              subtotal={selectedSubtotal}
              productIds={couponProductIds(selectedItems)}
              preview={selectedItems.length === 0 ? undefined : { storefrontSlug: ctvSlug, itemIds: allSelected ? undefined : selectedItems.map((it) => it.id) }}
              previewKey={couponPreviewKey(selectedItems)}
            />
            <label className="relative mb-3 flex min-h-11 cursor-pointer items-center gap-3 px-1 text-sm font-medium text-stone-900 max-md:mb-1 max-md:min-h-11 max-md:px-0 max-md:font-normal max-md:text-[length:var(--type-body-md-size)]">
              <span className={miniCheckboxWrap}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Chọn tất cả sản phẩm"
                  className={miniCheckbox}
                />
                <CheckMark />
              </span>
              Chọn tất cả
            </label>
            {withHeaders && (
              <p className="mb-3 text-caption text-stone-600 max-md:mb-1">
                Giỏ có hàng do nhiều nơi giao: mỗi nơi giao thành một đơn riêng, có phí giao riêng.
              </p>
            )}
            <div className="space-y-3">
              {groups.map((g) => {
                // Các món cùng bộ combo gom dưới một đầu nhóm; món lẻ vẽ như cũ phía dưới. API cũ không có nhóm thì mọi món là món lẻ.
                const comboWaiting = comboSavingPending({ partial: subsetSig !== null, priced: priced !== null });
                const { blocks, loose } = cartComboBlocks(g.items, cart.comboGroups, deselected, priced?.comboGroups, comboWaiting);
                return (
                  <section
                    key={g.key}
                    aria-label={withHeaders ? fulfillerLabel(g.fulfiller) : 'Sản phẩm trong giỏ'}
                    className={`divide-y divide-stone-200 ${ui.card} md:overflow-hidden max-md:space-y-2.5 max-md:divide-y-0 max-md:border-0 max-md:bg-transparent max-md:shadow-none`}
                  >
                    {withHeaders && (
                      <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-stone-900 max-md:px-0">
                        <Truck className="h-4 w-4 text-forest-600" aria-hidden="true" />
                        {fulfillerLabel(g.fulfiller)}
                      </h2>
                    )}
                    {blocks.map((block) => (
                      <CartComboBlock key={block.group.id} block={block} headingAs={withHeaders ? 'h3' : 'h2'}>
                        {block.lines.map(renderLine)}
                      </CartComboBlock>
                    ))}
                    {loose.map(renderLine)}
                  </section>
                );
              })}
            </div>
            {(cart.pendingGiftRedemptions?.length ?? 0) > 0 && <GiftNote />}
            <GiftTrialRow
              summary={giftTrialShown}
              showLocked={giftLockedShown}
              busy={giftChoice.isPending}
              onChoose={(variationId) => {
                if (giftChoice.isPending) return;
                giftChoice.mutate({ variationId, itemIds: allSelected ? undefined : selectedItems.map((it) => it.id) });
              }}
            />
            {giftChoice.isError && (
              <p role="alert" className="mt-1 text-caption text-danger-fg">
                {actionErrorText(giftChoice.error) || fillCopy('giftTrial.saveFailed')}
              </p>
            )}
          </div>

          {/* Giỏ chưa có dòng nào trước tổng (không giảm, không phí giao): khung từ md mở đầu bằng khối mã giảm giá, bỏ vạch kẻ + khoảng trống của nó. */}
          <div data-testid="cart-summary" className={`h-fit p-4 ${ui.card} max-md:contents lg:pb-0 lg:sticky lg:top-[calc(var(--header-h)+16px)] lg:self-start md:[&>[data-testid=cart-summary-rows]:empty+*]:mt-0 md:[&>[data-testid=cart-summary-rows]:empty+*]:border-t-0 md:[&>[data-testid=cart-summary-rows]:empty+*]:pt-0`}>
            <div data-testid="cart-summary-rows" className="empty:hidden max-md:hidden">
            {/* Có giảm hay có phí giao thì hàng này là tiền hàng chưa trừ, hàng cuối là tổng; không có gì xen giữa thì hai số bằng nhau nên chỉ giữ hàng cuối. */}
            {/* Chỉ theo số phí thật: lúc phí còn chờ, hàng cuối vẫn là "Tạm tính" nên thêm hàng này là hai dòng "Tạm tính" cùng số. */}
            {(hasDiscount || ship) && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-600">{cartTotalLabel(0)}</span>
                <span className="text-stone-900">{formatVnd(shownSubtotal)}</span>
              </div>
            )}
            {shownComboOnly > 0 && (
              <div className="mt-1 flex justify-between text-sm text-success-fg">
                <span>Giảm giá combo</span>
                <span>-{formatVnd(shownComboOnly)}</span>
              </div>
            )}
            {shownGreenBox > 0 && (
              <div data-testid="cart-green-box" className="mt-1 flex justify-between text-sm text-success-fg">
                <span>{fillCopy('greenBox.name')}</span>
                <span>-{formatVnd(shownGreenBox)}</span>
              </div>
            )}
            {shownDiscount > 0 && (
              <div className="mt-1 flex justify-between text-sm text-success-fg">
                <span>Giảm giá{cart.couponCode ? ` (${cart.couponCode})` : ''}</span>
                <span>-{formatVnd(shownDiscount)}</span>
              </div>
            )}
            {shownTier > 0 && (
              <div className="mt-1 flex justify-between text-sm text-success-fg">
                <span>Ưu đãi hạng thành viên</span>
                <span>-{formatVnd(shownTier)}</span>
              </div>
            )}
            {shipRow && (
              <div data-testid={ship ? 'cart-ship-estimate' : 'cart-ship-estimate-pending'} className="mt-1 flex justify-between text-sm">
                <span className="text-[var(--color-text-secondary)]">{shipRow.feeLabel}</span>
                <span className={shipRow.free ? 'text-success-fg' : 'text-[var(--color-text-primary)]'}>{shipRow.feeText}</span>
              </div>
            )}
            {saving > 0 && (
              <div data-testid="cart-saving" className="mt-1 text-right text-caption font-semibold text-[color:var(--color-text-price-deal)]">
                {fillCopy('cart.saving', { x: formatVnd(saving) })}
              </div>
            )}
            {greenBoxHint && (
              <p data-testid="green-box-hint" className="mt-1 text-caption text-success-fg">
                {greenBoxHint}
              </p>
            )}
            </div>
            {!phoneCoupon && couponBox(false)}
            {!allSelected && !priced && cart.couponCode && (
              <p className="mt-2 text-caption text-stone-600 max-md:mt-0 max-md:px-1">Mua một phần giỏ: mã giảm giá được tính lại ở bước thanh toán.</p>
            )}
            <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900 max-md:hidden lg:hidden">
              <span>{totalLabel}</span>
              <span>{formatVnd(shownTotal)}</span>
            </div>
            {/* Dưới lg nút và lời giải thích nằm ở thanh dính đáy (cuối trang); từ lg giữ ở khung tóm tắt dính bên phải. */}
            <div className="hidden lg:sticky lg:bottom-0 lg:block lg:bg-stone-0 lg:py-4">
              <div className="mb-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900">
                <span>{totalLabel}</span>
                <span>{formatVnd(shownTotal)}</span>
              </div>
              {selectedItems.length === 0 ? (
                <>
                  <button type="button" disabled className={`${ui.btnPrimary} w-full`}>
                    Thanh toán (0)
                  </button>
                  <p role="status" className="mt-2 text-caption text-stone-600">
                    {payHint}
                  </p>
                </>
              ) : stockBlocked ? (
                <>
                  <button type="button" disabled className={`${ui.btnPrimary} w-full`}>
                    Thanh toán ({selectedCount})
                  </button>
                  <p role="status" className="mt-2 text-caption text-warning-fg">
                    {payHint}
                  </p>
                </>
              ) : (
                <Link href="/thanh-toan" onClick={onPay} className={`${ui.btnPrimary} w-full`}>
                  Thanh toán ({selectedCount})
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
      {undoError && (
        <p role="alert" className="mt-3 text-sm text-danger-fg">
          {undoError}
        </p>
      )}
      {cart && cart.items.length > 0 && pendingRemove && (
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
      {cart && cart.items.length > 0 && refillConfirm && (
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
      {/* Vùng báo luôn có mặt trong cây (chỉ đổi phần con): vùng live vừa gắn cùng chữ thường không được đọc ra. */}
      <div role="status" data-testid="undo-region">
        {undoBar && (
          <div
            data-surface="inverse"
            data-testid={refill.receipt ? 'refill-undo' : undefined}
            {...undoBar.hold}
            className={`fixed inset-x-3 z-30 mx-auto flex max-w-md items-center justify-between rounded-control bg-stone-900 px-4 py-2 text-sm text-stone-0 ${
              showBar ? 'bottom-[calc(var(--sticky-bar-h,8rem)+0.5rem)] lg:bottom-6' : 'bottom-6'
            }`}
          >
            <span>{undoBar.text}</span>
            <button ref={undoRef} type="button" onClick={undoBar.onUndo} className="min-h-11 px-2 font-bold text-forest-200">
              Hoàn tác
            </button>
          </div>
        )}
      </div>
      {showBar && (
        <StickyActionBar label="Thanh toán" hideFrom="lg">
          <div className="md:mx-auto md:max-w-2xl">
            {/* Dưới md khung tóm tắt bị ẩn hẳn (cả với trình đọc màn hình): lời báo ở đây là bản duy nhất khách thấy/nghe được. */}
            {payHint && (
              <p
                id="cart-pay-hint"
                role="status"
                className={`mb-1 text-caption ${stockBlocked ? 'text-warning-fg' : 'text-stone-600'}`}
              >
                {payHint}
              </p>
            )}
            {phoneCoupon && couponBox(true)}
            <div className="mt-1 space-y-1">
              {/* Từ md khung tóm tắt trong thân trang đã ghi các khoản giảm và "Tiết kiệm": thanh dính chỉ giữ tổng + nút, không lặp lại. */}
              {(shownCombo > 0 || shownDiscount > 0 || shownTier > 0 || shipRow || greenBoxHint) && (
                <div className="space-y-1 md:hidden">
                  {shownComboOnly > 0 && <KeyValueRow label="Giảm giá combo" value={`-${formatVnd(shownComboOnly)}`} tone="success" style={{ padding: 0 }} />}
                  {shownGreenBox > 0 && <KeyValueRow label={fillCopy('greenBox.name')} value={`-${formatVnd(shownGreenBox)}`} tone="success" style={{ padding: 0 }} />}
                  {shownDiscount > 0 && <KeyValueRow label="Giảm giá" value={`-${formatVnd(shownDiscount)}`} tone="success" style={{ padding: 0 }} />}
                  {shownTier > 0 && <KeyValueRow label="Ưu đãi hạng thành viên" value={`-${formatVnd(shownTier)}`} tone="success" style={{ padding: 0 }} />}
                  {ship ? (
                    <KeyValueRow label={ship.feeLabel} value={ship.feeText} tone={ship.free ? 'success' : 'primary'} style={{ padding: 0 }} dataDs="cart-ship-estimate" />
                  ) : (
                    shipRow && <KeyValueRow label={shipRow.feeLabel} value={shipRow.feeText} style={{ padding: 0 }} />
                  )}
                  {greenBoxHint && (
                    <p data-testid="green-box-hint" className="text-caption text-success-fg">
                      {greenBoxHint}
                    </p>
                  )}
                </div>
              )}
              {/* Tổng bên trái, nút bên phải CÙNG MỘT HÀNG (như Mini App). Khối tổng grow 1000 và không min-w-0, nên hàng chỉ xuống dòng khi số tiền (không ngắt được)
                  rộng hơn chỗ còn lại (320px, 9 chữ số): nút xuống hàng riêng và giãn hết bề ngang thay vì cắt chữ hay chui dưới nút; chung hàng thì giữ 9.25rem. */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <div className="flex-[1000_1_0%]">
                  <div className="whitespace-nowrap text-label text-stone-600">{totalLabel}</div>
                  <div data-testid="cart-total-value" className="whitespace-nowrap text-[length:var(--type-title-md-size)] font-bold leading-[var(--type-title-md-lh)] tabular-nums text-stone-900">
                    {formatVnd(shownTotal)}
                  </div>
                  {saving > 0 && (
                    <div data-testid="cart-saving" className="text-caption font-semibold text-[color:var(--color-text-price-deal)] md:hidden">
                      {fillCopy('cart.saving', { x: formatVnd(saving) })}
                    </div>
                  )}
                </div>
                {payHint ? (
                  <button type="button" disabled aria-describedby="cart-pay-hint" className={`${uiBar.primary} flex-[1_0_9.25rem]`}>
                    Thanh toán ({selectedCount})
                  </button>
                ) : (
                  <Link href="/thanh-toan" onClick={onPay} className={`${uiBar.primary} flex-[1_0_9.25rem]`}>
                    Thanh toán ({selectedCount})
                  </Link>
                )}
              </div>
            </div>
          </div>
        </StickyActionBar>
      )}
    </Shell>
  );
}

/**
 * Nhắc mã sắp mở khoá dưới thanh Miễn phí giao hàng. Tách thành component riêng để hook xem trước chạy độc lập với phần còn lại của trang, như `CartVoucherHintSection`
 * của Mini App. Mời áp mã đã đủ điều kiện không ở đây mà ở nút "Áp dụng" của `CartCouponBox`: một hành động, một nút.
 */
function CartVoucherHintSection(props: {
  currentCode: string | null | undefined;
  subtotal: number;
  productIds?: string[] | undefined;
  preview?: CouponPreviewParams | undefined;
  previewKey: string;
}) {
  const v = useCartVoucherHint(props);
  const router = useRouter();
  return <CartVoucherHintStrip hint={v.hint} onShopMore={() => router.push('/')} />;
}

/**
 * Hộp mã giảm giá của giỏ (thanh dính ở điện thoại, khung tóm tắt từ md): có mã đã đủ điều kiện mà giỏ chưa áp thì nút cuối hàng là "Áp dụng" một chạm
 * (`CouponBox.quickApply`), nút DUY NHẤT áp mã trên màn giỏ. Lệnh áp, khoá chạm đúp và lời báo lỗi là của `useCartVoucherHint` như trước. Khung `aria-live` có sẵn từ
 * lúc dựng (chèn khung cùng chữ thì trình đọc màn hình không đọc): áp xong nút biến mất, hàng đổi sang chip mã nên "Đã áp dụng mã …" chỉ cần cho trình đọc màn hình.
 */
function CartCouponBox(props: ComponentProps<typeof CouponBox>) {
  const v = useCartVoucherHint({
    currentCode: props.currentCode,
    subtotal: props.subtotal,
    productIds: props.productIds,
    preview: props.preview,
    previewKey: props.previewKey ?? '',
  });
  const offer = v.hint?.apply ?? null;
  return (
    <>
      <CouponBox
        {...props}
        quickApply={offer ? { ariaLabel: offer.ariaLabel, applying: v.applying, error: v.error, onApply: () => v.apply(offer.code) } : null}
      />
      <div aria-live="polite">
        {v.appliedNote && (
          <p data-testid="cart-voucher-applied" className="sr-only">
            {v.appliedNote}
          </p>
        )}
      </div>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0 md:max-w-[45rem] lg:max-w-frame`}>
      <BackLink href="/" crumbs={[{ label: 'Trang chủ', href: '/' }, { label: 'Giỏ hàng' }]}>
        ← Tiếp tục mua sắm
      </BackLink>
      <PageHeader title="Giỏ hàng" className="md:mt-1" />
      <div className="mt-4 max-md:mt-0 max-md:px-3 max-md:pt-2">{children}</div>
    </main>
  );
}
