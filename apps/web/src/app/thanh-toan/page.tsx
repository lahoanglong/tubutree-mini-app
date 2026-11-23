'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronRight, Sprout } from 'lucide-react';
import { useQuery, useMutation, useMutationState, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { WASTE_QUERY_KEYS } from '@tubutree/app-core/api/waste';
import type { QuotePendingGiftDTO } from '@tubutree/shared-types';
import { useAuth } from '@/lib/auth-context';
import { rememberActiveOrder } from '@tubutree/app-core/home-todo-rows';
import { browserStorage } from '@/lib/recently-viewed';
import { syncHomeHintCookie } from '@/lib/home-hint-cookie';
import { useAuthPhase } from '@/lib/auth-phase';
import { OrderConsent } from '@/components/order-consent';
import { OrderZaloConsentRow, useOrderZaloConsent } from '@/components/checkout/order-zalo';
import { AddressPicker } from '@/components/checkout/address-picker';
import { TransferPreview, warmBankPayment } from '@/components/checkout/transfer-preview';
import {
  getCart,
  getAddresses,
  checkoutQuote,
  getBankQr,
  placeOrder,
  updateCartItem,
  removeCartItem,
  setCartGift,
  getMe,
  getPublicConfig,
  formatVnd,
  type AddressDTO,
  type CartLine,
  type OrderDTO,
} from '@/lib/shop-client';
import { ctvSlugFor, getStorefrontContext, subscribeStorefrontContext } from '@/lib/storefront-context';
import { pointsOfferText } from '@tubutree/app-core/points-offer';
import { normalizeTaxCode } from '@tubutree/app-core/commerce/tax-code';
import { validateInvoiceFields, type InvoiceField } from '@tubutree/app-core/commerce/checkout-form';
import { checkoutPlaceHint, checkoutTotalText, markTransferOrderPlaced, paymentMethodCue, rememberRecentAddress } from '@tubutree/app-core/commerce/checkout-display';
import { draftAddressId, saveCheckoutDraft, takeCheckoutDraft, type CheckoutDraft } from '@tubutree/app-core/commerce/checkout-draft';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { shippingRowView } from '@tubutree/app-core/checkout-pickup-view';
import { visibleGifts } from '@tubutree/app-core/checkout-pickup-state';
import { couponNoticeText } from '@tubutree/app-core/coupon-min-order';
import { useRemovedCoupon } from '@/lib/use-removed-coupon';
import { checkoutLineProblems, priceChangedActions, type LineFix } from '@tubutree/app-core/commerce/checkout-issues';
import { giftTrialPlaceField } from '@tubutree/app-core/commerce/gift-trial';
import { checkoutEtaLabel, etaSchedule, placedOrderKinds } from '@tubutree/app-core/shipping-eta';
import { checkoutPointsOffer, convertedPointsLine, formatCount, idlePointsLabel, lockedPointsLabel, pointsCapState, zeroTotalNote, type CheckoutPointsOffer } from '@/lib/checkout-points';
import {
  ORDER_NOTE_MAX,
  effectiveReferralCode,
  cartFixableNotice,
  isInvoiceValid,
  paymentMissingNote,
  paymentUnavailableReason,
  pickPaymentMethod,
} from '@/lib/checkout-rules';
import { clearCheckoutSelection, recallCheckoutSelection, reconcileSelection } from '@/lib/checkout-selection';
import { bankPaymentHref, orderDetailHref } from '@/lib/order-view';
import { ui, uiBar } from '@/lib/guest-ui';
import { invalidateBalances } from '@/lib/balances';
import { ApiError, NetworkError } from '@/lib/client-api';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { CouponBox, COUPON_MUTATION_KEY, forgetAutoCoupon, couponPreviewKey } from '@/components/coupon-box';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { useGuestOrderClaim } from '@/lib/guest-checkout/claim';
import { guestCheckoutOn, welcomeAmountOf } from '@/lib/guest-checkout/flag';
import { useServerGuestConfig } from '@/components/checkout/server-guest-config';
import { ReferralCodeBox } from '@/components/referral-code-box';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { OrderSuccess } from '@/components/checkout/order-success';
import { GiftRows, GiftTrialRow } from '@/components/checkout/gift-rows';
import { useShippingEstimate } from '@/components/checkout/use-shipping-estimate';
import { cartShippingView } from '@tubutree/app-core/api/shipping-estimate';
import { comboOnlyDiscount, greenBoxDiscountOf } from '@tubutree/app-core/commerce/green-box';
import { PickupSection, WaivedShippingValue } from '@/components/checkout/pickup-section';
import { PICKUP_OPTIONS_KEY, useCheckoutPickup } from '@/components/checkout/use-checkout-pickup';
import { useCheckoutFunnel } from '@/components/analytics/use-checkout-funnel';
import { trackRecycleStep } from '@/lib/recycle-funnel';
import { DesktopLines, MobileItems, RECALC_DIM, Row, type LineFixView } from '@/components/checkout/checkout-lines';
import { CheckoutSkeleton } from './checkout-skeleton';
import { InlineRetry } from './inline-retry';
import { InvoiceSection } from './invoice-section';
import { ErrorState } from '@/components/ui/error-state';
import { EMPTY_INVOICE, loadSavedInvoice, saveInvoice } from '@/lib/saved-invoice';
import { shipmentsNote } from '@/lib/shipments';
import { useCartKey } from '@/lib/cart-key';
import { createOrderKeyRing } from '@/lib/order-key-ring';
import { isOutcomeUnknown } from '@/lib/checkout-waste';
import BackLink from '@/components/back-link';
import { BackAwareLink } from '@/components/back-aware-link';
import { pushOrBack } from '@/lib/nav-depth';
import { CheckMark, miniCheckboxWrap, miniCheckbox, miniCheckboxGutter, miniRadio, miniRadioGutter, mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/mini';
import { EmptyState } from '@/components/mini/empty-state';
import { CART_EMPTY } from '@tubutree/app-core/cart-copy';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { PAGE_WIDE } from '@/lib/page-frame';

// Form đặt hàng không đăng nhập chỉ hiện cho khách chưa đăng nhập khi cờ web.guest_checkout_enabled bật: tách khỏi JS tải lần đầu của trang
// (khách đã đăng nhập không bao giờ cần). Khung chờ là RouteSkeleton như lúc chờ phiên đăng nhập và chờ cấu hình.
const GuestCheckout = dynamic(() => import('@/components/checkout/guest-checkout').then((m) => m.GuestCheckout), {
  ssr: false,
  loading: () => <AuthLoading />,
});

// Máy chủ trả nguyên mã này (không phải câu cho khách) khi hết suất/hết giờ vàng giữa lúc thanh toán.
const PRICE_CHANGED = 'PRICE_CHANGED';
const LINE_FIX_KEY = ['checkout-line-fix'] as const;

// has-[:focus-visible]: ô radio của thẻ địa chỉ bị sr-only ở điện thoại nên vòng lấy nét phải hiện trên cả thẻ.
const OPTION_BASE = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border p-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--color-border-focus)]';
const optionClass = (selected: boolean) =>
  `${OPTION_BASE} ${selected ? 'border-[var(--color-border-selected)] bg-[var(--color-bg-subtle)]' : 'border-[var(--color-border-strong)] bg-[var(--color-bg-surface)]'}`;
// Mini App: dòng phương thức thanh toán không viền/nền, cách nhau bằng khoảng đệm (checkout.tsx: padding 12px 0).
const payOptionClass = (selected: boolean) =>
  `${optionClass(selected)} max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-3`;
// Ô ghi chú: dưới md cao một dòng và bo 8px như Input của Mini, từ md nhiều dòng với bo của ô nhập thường.
const NOTE_FIELD = ui.field.replace('rounded-control', 'rounded-[0.5rem] md:rounded-control');
// Mỗi phần của trang thanh toán ở điện thoại là dải trắng phẳng tràn ngang cách nhau 8px (Box p=4 mt=2 của Mini App).
const MINI_BAND = `p-4 ${ui.card} ${mini.band} max-md:mt-2`;

type PlaceBody = Parameters<typeof placeOrder>[0];
/** Bộ nhớ theo tab (sessionStorage) cho lựa chọn giữ qua một lần sang giỏ: chặn (Safari riêng tư) thì null, quay lại chọn lại. */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const PREVIOUS_MAYBE_PLACED = 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.';

export default function CheckoutPage() {
  const phase = useAuthPhase();
  // Vừa đăng nhập Zalo trên trình duyệt có đơn đặt không đăng nhập: đưa đơn về tài khoản (không có đơn như thế thì không gọi gì).
  useGuestOrderClaim(phase === 'authenticated');
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [note, setNote] = useState('');
  const [wantInvoice, setWantInvoice] = useState(false);
  const [invoice, setInvoice] = useState(EMPTY_INVOICE);
  // Mã giới thiệu khách tự nhập ở đây (đã được server xác nhận) khác mã đến từ link gian hàng (sfCtx).
  const [referralApplied, setReferralApplied] = useState<string | null>(null);
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
  // Lời báo về phần đổi rác kèm đơn (món bị bỏ vì đổi địa chỉ, phiếu đổi giữa chừng): hiện tới khi khách đổi lựa chọn kế tiếp.
  const [pickupNotice, setPickupNotice] = useState<string | null>(null);
  // Mã đơn chuyển khoản đã đặt xong, đang chờ router.replace hoàn tất: trang khoá lại, nếu không giỏ nạp lại còn dòng khác thì nút Đặt hàng bật lại và bấm thêm sẽ tạo đơn thứ hai với key mới.
  const [redirectingCode, setRedirectingCode] = useState<string | null>(null);
  // Một key cho một nội dung đơn trong phiên thanh toán: bấm lại sau lỗi mạng gửi lại cùng đơn; đổi nội dung thì key mới.
  const orderKeys = useRef(createOrderKeyRing());
  // Lần đặt trước chưa rõ kết quả (mạng rớt/5xx): máy chủ có thể đã tạo đơn, mà giỏ/báo giá nạp lại (header cũng quan sát giỏ)
  // sẽ làm body đổi và sinh key mới, tạo đơn thứ hai. Đóng băng chính yêu cầu: bấm lại gửi nguyên body và key đó cho tới khi có kết quả rõ.
  const unknownAttempt = useRef<{ body: PlaceBody; key: string; rev: number } | null>(null);
  // Đếm số lần khách tự đổi lựa chọn. Không so các trường của body: phương thức thanh toán, yêu cầu thu rác, điểm dùng
  // được tính lại từ dữ liệu máy chủ (ví tụt, yêu cầu rác gắn mã đơn) ngay khi nạp lại sau đơn đã tạo, không phải khách đổi ý.
  const choiceRev = useRef(0);
  // Bản sao của choiceRev và của rev lần đặt đang treo trong state để vẽ: nút chỉ là "Thử lại" khi lựa chọn hiện tại đúng là lần đặt bị treo.
  const [choiceTick, setChoiceTick] = useState(0);
  const [unknownRev, setUnknownRev] = useState<number | null>(null);
  const bumpChoice = () => {
    choiceRev.current += 1;
    setChoiceTick(choiceRev.current);
    setPickupNotice(null);
  };
  const bootedRef = useRef(false);
  // Bản sao của cờ đóng băng trong state: giỏ nguyên vẹn nạp lại thành rỗng thì form (và nút Đặt hàng) biến mất, màn giỏ trống phải còn lối gửi lại.
  const [maybePlaced, setMaybePlaced] = useState(false);
  const chosen = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    bumpChoice();
    fn(...args);
  };

  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  // Mã bị máy chủ gỡ lúc đọc giỏ (giỏ rơi dưới đơn tối thiểu, hết hạn, bị tắt) chỉ được báo một lần: nhớ để khách thấy vì sao tổng tăng.
  const removedCoupon = useRemovedCoupon(cartQ.data, formatVnd);
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: phase === 'authenticated' });
  // Số dư Ví Tubu lấy từ máy chủ (không từ ảnh chụp lúc đăng nhập): khách vừa được hoàn tiền về ví hoặc vừa tiêu ví
  // ở Mini App sẽ thấy đúng số, thay vì chọn được rồi bị từ chối "số dư không đủ".
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: phase === 'authenticated' });
  const walletBalance = meQ.data?.walletBalance ?? user?.walletBalance ?? 0;
  const configQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const serverGuestConfig = useServerGuestConfig();
  const zalo = useOrderZaloConsent();
  const shippingEta = configQ.data?.shippingEta;

  // Mua một phần giỏ: giỏ ghi nhớ các dòng đã chọn ở sessionStorage (tải lại trang thanh toán không được âm thầm
  // chuyển sang tính tiền cả giỏ). Chỉ đối chiếu với giỏ thật khi đã tải xong để không xoá nhầm lựa chọn.
  const [selection] = useState(() => recallCheckoutSelection());
  const cartLoaded = !!cartQ.data;
  const itemIds = cartLoaded ? reconcileSelection(selection, cartQ.data!.items.map((it) => it.id)) : undefined;
  const itemIdsKey = itemIds ? itemIds.join(',') : '';
  const cartReady = selection == null || cartLoaded;
  const checkoutItems = itemIds ? (cartQ.data?.items ?? []).filter((it) => itemIds.includes(it.id)) : (cartQ.data?.items ?? []);
  // Giỏ đã tải và không còn món nào (đặt xong rồi Back, mở lại tab cũ): không dựng form 0đ, không gọi báo giá (BE trả 400).
  const cartEmpty = cartLoaded && checkoutItems.length === 0;

  const userId = user?.id;
  useEffect(() => {
    setInvoice(loadSavedInvoice(userId));
  }, [userId]);

  // Khách vừa sang giỏ sửa món hết hàng hay giá đổi rồi quay lại: lấy lại địa chỉ và ghi chú đã chọn (đọc một lần khi biết tài khoản).
  // Địa chỉ chỉ lấy lại khi còn trong sổ. Cách trả tiền không giữ (như nháp của khách chưa đăng nhập): tổng đã đổi ở giỏ, Ví trừ tiền ngay.
  const draftRef = useRef<CheckoutDraft | null | undefined>(undefined);
  useEffect(() => {
    if (!userId || draftRef.current !== undefined) return;
    const draft = takeCheckoutDraft(tabStorage(), userId, Date.now());
    draftRef.current = draft;
    if (!draft) return;
    if (draft.note) setNote(draft.note);
    const restored = addrQ.data ? draftAddressId(draft, addrQ.data) : null;
    if (restored) setAddressId(restored);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (addrQ.data && addressId === null) {
      const def = addrQ.data.find((a) => a.isDefault) ?? addrQ.data[0];
      const restored = draftAddressId(draftRef.current, addrQ.data);
      if (restored) setAddressId(restored);
      else if (def) setAddressId(def.id);
    }
  }, [addrQ.data, addressId]);
  // Lối "về giỏ hàng để sửa" (món hết hàng, vượt suất, giá đổi) ghi lại lựa chọn đang có để lúc quay lại không phải chọn lại, như Mini App.
  // Ctrl/Cmd/Shift-click mở tab khác: tab này vẫn ở Thanh toán nên không ghi, kẻo nháp nằm lại cho lần mở màn sau.
  const keepChoices = (e?: React.MouseEvent) => {
    if (e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    saveCheckoutDraft(tabStorage(), userId, { addressId, note }, Date.now());
  };

  // Gian hàng đang mua qua — quyết định combo giảm giá và việc CTV có được ghi nhận đơn hay
  // không. Đọc một lần khi mount: sessionStorage không phải state phản ứng, và giá trị chỉ đổi
  // khi khách đi qua một gian hàng khác (tức là đã rời trang này).
  const [sfCtx] = useState(() => getStorefrontContext());
  // Mã từ link chỉ khoá ô nhập khi máy chủ đã xác nhận là mã CTV; mã khách thường (nút chia sẻ sản phẩm) bị máy chủ bỏ qua nên
  // không được hiện như "đang mua qua link giới thiệu". Chưa biết (null) vẫn gửi kèm đơn để máy chủ tự quyết: lỗi mạng lúc chạm không được làm CTV mất công.
  // Phản ứng theo thay đổi: chạm giới thiệu trả kết quả sau khi màn này đã mở thì ô mã đổi theo, không kẹt ở giá trị lúc mở trang.
  const linkReferral = useSyncExternalStore(subscribeStorefrontContext, () => getStorefrontContext().referralCode, () => null);
  const referralEligible = useSyncExternalStore(subscribeStorefrontContext, () => getStorefrontContext().referralEligible, () => null);
  const linkedReferral = referralEligible === true ? linkReferral : null;
  const orderLinkReferral = referralEligible === false ? null : linkReferral;
  // CHỈ gian hàng CTV mới gắn vào đơn — xem ghi chú ở StorefrontContext.kind.
  const ctvSlug = ctvSlugFor(sfCtx);
  // Web chỉ ghi ngữ cảnh ở /s/[slug] (mọi loại gian hàng), còn /brand/[slug] đọc thực thể khác: không dựng link /brand/ từ đây.
  const continueHref = sfCtx.slug ? `/s/${encodeURIComponent(sfCtx.slug)}` : '/';
  // Điểm Xanh: Mini App cho tiêu, web thì không — cùng một giỏ mà mua trên web đắt hơn.
  const [usePoints, setUsePoints] = useState(false);
  // Quote đầu tiên (pointsToUse = 0) trả về số điểm DÙNG ĐƯỢC (redeemablePoints = số dư − điểm đơn còn
  // trong hạn/đang chờ xử lý đổi-trả; backend kẹp đúng theo số này) để biết khách dùng được bao nhiêu.
  // PHẢI là state: dùng useRef thì lần ghi trong effect không kích hoạt render nào nữa, mà render
  // có quote chính là render cuối của luồng khởi động (refetchOnWindowFocus đang tắt) — ô "Dùng
  // Điểm Xanh" sẽ KHÔNG BAO GIỜ hiện, tức tính năng vừa thêm không dùng được.
  const [pointsOffer, setPointsOffer] = useState<CheckoutPointsOffer>({
    usable: 0,
    converted: 0,
    lockNote: null,
    convertedNote: null,
  });
  const usablePoints = pointsOffer.usable;

  // Mã giảm giá đổi trên giỏ nên báo giá đang hiện đã cũ cho tới khi tính lại xong: khoá nút đặt hàng
  // trong lúc đó để khách không bấm đặt khi con số trên màn hình chưa phải con số sẽ bị tính.
  const couponChanging = useIsMutating({ mutationKey: COUPON_MUTATION_KEY }) > 0;
  // Đổi rác kèm đơn + quà 0đ: lựa chọn của khách đi vào báo giá và đặt đơn; cổng mở/đóng do máy chủ báo trong `quote.pickup`.
  const pickup = useCheckoutPickup({
    enabled: phase === 'authenticated',
    addressId,
    itemIds,
    onReconciled: () => setPickupNotice(fillCopy('checkout.pickup.reconciled')),
    nudgeEnabled: configQ.data?.returnPackagingNudgeEnabled === true,
  });
  const trackNudgeShown = useCallback(() => trackRecycleStep('return_nudge_shown', 'PICKUP'), []);
  const trackNudgeApplied = useCallback(() => trackRecycleStep('return_nudge_applied', 'PICKUP'), []);
  const quoteQ = useQuery({
    queryKey: ['quote', addressId, ctvSlug, usePoints, itemIdsKey, pickup.fieldsKey],
    queryFn: () => checkoutQuote(addressId!, usePoints ? usablePoints : 0, ctvSlug, itemIds, pickup.fields),
    // Chờ giỏ tải xong: địa chỉ có thể về trước, lúc đó chưa biết giỏ có trống không và báo giá giỏ trống bị 400.
    enabled: !!addressId && phase === 'authenticated' && cartLoaded && cartReady && !cartEmpty && pickup.ready,
    // Đổi địa chỉ: giữ báo giá cũ trên màn (mờ phí giao và tổng, khoá Đặt hàng) tới khi báo giá mới về, để tổng không nhảy về "…" rồi nhảy lại.
    // Chỉ khi các lựa chọn khác giữ nguyên; lỗi báo giá thì TanStack bỏ dữ liệu giữ chỗ và màn hiện dòng lỗi có Thử lại.
    placeholderData: (prev, prevQuery) =>
      prevQuery && prevQuery.queryKey[1] !== addressId && prevQuery.queryKey[2] === ctvSlug && prevQuery.queryKey[3] === usePoints && prevQuery.queryKey[4] === itemIdsKey
        ? prev
        : undefined,
  });
  // Số trên màn là của địa chỉ trước: query mới có thể chưa chạy (đang chờ phần đổi rác) nên `isFetching` chưa bật, phải xét riêng.
  const recalculating = quoteQ.isPlaceholderData;
  const { pruneGifts } = pickup;
  const pendingGifts = quoteQ.data?.pendingGiftRedemptions;
  useEffect(() => {
    pruneGifts(pendingGifts);
  }, [pendingGifts, pruneGifts]);
  // Báo giá đang tải lại thì quà giữ như lần trước: dòng quà không được biến mất rồi hiện lại mỗi lần khách đổi lựa chọn.
  const giftsRef = useRef<QuotePendingGiftDTO[]>([]);
  if (quoteQ.data) giftsRef.current = visibleGifts(quoteQ.data.pendingGiftRedemptions, pickup.excluded);
  useEffect(() => {
    // Giữ lại số điểm dùng được của lần quote gần nhất — khi bật "dùng điểm", BE tự kẹp theo trần
    // loyalty.max_redeem_pct nên gửi toàn bộ số dùng được là an toàn.
    if (quoteQ.data && !usePoints) setPointsOffer(checkoutPointsOffer(quoteQ.data));
  }, [quoteQ.data, usePoints]);

  const quoteStale = couponChanging || quoteQ.isFetching || recalculating;
  // Refetch lỗi vẫn giữ `data` của lần trước (React Query v5): không coi đó là báo giá hiện hành, nếu không
  // khách thấy số cũ trong khi server đã tính theo mã mới và nút Đặt hàng vẫn bật.
  const quote = quoteQ.isError ? undefined : quoteQ.data;
  const funnel = useCheckoutFunnel({ quoteReady: quoteQ.isSuccess, itemCount: checkoutItems.length, addressId });
  // Giỏ có hàng của gian hàng đối tác: Điểm Xanh chỉ trả cho hàng Tubu (trần của đơn + câu giải thích; giỏ chỉ hàng đối tác thì tắt).
  const partnerPoints = pointsCapState(quote, usablePoints);
  const convertedLine = convertedPointsLine(pointsOffer, partnerPoints);
  // Dưới md ghi chú nằm trong cột chữ cạnh ô tick như Mini; từ md trở lên giữ dòng riêng dưới ô. Hai bản chỉ khác nhau ở lớp hiển thị.
  const pointNotes = (vis: 'md:hidden' | 'md:block') => {
    const cls = vis === 'md:hidden' ? 'mt-0.5 block text-caption text-[color:var(--color-text-tertiary)] md:hidden' : 'mt-1 hidden text-caption text-[color:var(--color-text-secondary)] md:block';
    const Tag = vis === 'md:hidden' ? 'span' : 'p';
    const notes = [usablePoints > 0 && partnerPoints.capNote, usablePoints > 0 && partnerPoints.partnerNote, convertedLine, pointsOffer.lockNote];
    return notes.map((n, i) => (n ? <Tag key={i} className={cls}>{n}</Tag> : null));
  };
  useEffect(() => {
    if (partnerPoints.disabled && usePoints) setUsePoints(false);
  }, [partnerPoints.disabled, usePoints]);
  // Đơn 0đ: BE ép COD + xác nhận luôn (không thu tiền) nên ẩn lựa chọn phương thức và gửi COD cho khớp.
  const zeroNote = quote ? zeroTotalNote(quote) : null;
  const paymentToSend = zeroNote ? 'COD' : payment;
  const shipments = quote?.shipments ?? [];
  const split = shipments.length > 1 || shipments.some((s) => s.fulfiller.kind === 'MERCHANT');
  const splitNote = shipmentsNote(shipments);
  const tubuShipment = shipments.find((s) => s.fulfiller.kind === 'TUBU');
  const tubuShippingFee = quote ? (tubuShipment ? tubuShipment.shippingFee : shipments.length === 0 ? quote.shippingFee : 0) : undefined;
  const shipRow = quote ? shippingRowView(quote) : null;
  // Chưa chọn địa chỉ: phí kiện Tubu ước tính thay vì chỉ "Nhập địa chỉ để tính phí". Có hàng gian hàng tự giao thì giữ câu cũ.
  const shipEstimateBase =
    !addressId && checkoutItems.length > 0 && !checkoutItems.some((it) => it.fulfiller?.kind === 'MERCHANT')
      ? checkoutItems.filter((it) => it.stock > 0).reduce((sum, it) => sum + it.total, 0)
      : null;
  const shipEstimate = cartShippingView(useShippingEstimate(shipEstimateBase).estimate, { goodsNet: 0, freeshipReached: false });
  const noAddressShipText = shipEstimate ? fillCopy('checkout.shipEstimateValue', { fee: shipEstimate.feeText }) : fillCopy('checkout.shipNeedsAddress');
  const shippingValue: React.ReactNode = !quote ? (addressId ? '…' : noAddressShipText) : shipRow?.waived ? (
    <WaivedShippingValue originalFee={shipRow.originalFee} note={shipRow.note ?? ''} />
  ) : quote.shippingFee === 0 ? (
    'Miễn phí'
  ) : (
    formatVnd(quote.shippingFee)
  );
  // Chưa có cấu hình (đang tải, lỗi, API cũ) thì không hứa ngày giao; giỏ chỉ có hàng gian hàng tự giao thì cũng không.
  // Cờ ngày nhận theo lịch kho bật thì ngày tính theo giờ cắt đơn và tỉnh của địa chỉ đang chọn (TP.HCM hay tỉnh khác).
  const schedule = etaSchedule(configQ.data);
  const addressProvince = addrQ.data?.find((a) => a.id === addressId)?.province;
  const etaLabel = checkoutEtaLabel(shippingEta, shipments.map((s) => s.fulfiller.kind), undefined, schedule, addressProvince);
  // Cách thanh toán dùng được theo báo giá (máy chủ từ chối đặt đúng các cách nó khoá: hạn mức COD từng đơn, giỏ tách đơn D4)
  // và số dư Ví mới nhất. Lựa chọn không còn dùng được thì đổi sang cách khác dùng được, hết cách thì bỏ chọn để khoá nút đặt.
  const pickedPayment = quote ? pickPaymentMethod(payment, quote, walletBalance) : payment;
  useEffect(() => {
    if (pickedPayment !== payment) setPayment(pickedPayment);
  }, [pickedPayment, payment]);

  const invoiceValid = isInvoiceValid(wantInvoice, invoice);
  // Lời báo ô hoá đơn: hiện khi khách rời ô, hoặc khi bấm Đặt hàng mà còn thiếu (lúc đó con trỏ nhảy tới ô lỗi đầu tiên).
  const invoiceAllErrors = wantInvoice ? validateInvoiceFields(invoice) : {};
  const [invoiceTouched, setInvoiceTouched] = useState<Partial<Record<InvoiceField, boolean>>>({});
  const [placeAttempted, setPlaceAttempted] = useState(false);
  // Lần bấm Đặt hàng tính cho ô hoá đơn tách riêng khỏi địa chỉ: bật hoá đơn SAU một lần bấm thiếu địa chỉ thì bốn ô chưa được đỏ ngay.
  const [invoiceAttempted, setInvoiceAttempted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const invoiceShown = Object.fromEntries(
    Object.entries(invoiceAllErrors).filter(([f]) => invoiceAttempted || invoiceTouched[f as InvoiceField]),
  ) as Partial<Record<InvoiceField, string>>;
  const formBlocked = !addressId || !invoiceValid;
  const addressBlockRef = useRef<HTMLDivElement>(null);
  const invoiceBlockRef = useRef<HTMLDivElement>(null);
  // Bấm Đặt hàng khi còn thiếu địa chỉ hoặc ô hoá đơn: cuộn tới và đưa con trỏ vào chỗ thiếu đầu tiên theo thứ tự trên màn hình.
  useEffect(() => {
    if (focusTick === 0) return;
    const target = !addressId
      ? (addressBlockRef.current?.querySelector<HTMLElement>('button, input, [role="radio"]') ?? addressBlockRef.current)
      : invoiceBlockRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.focus();
    target?.scrollIntoView?.({ block: 'center' });
  }, [focusTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hết hàng/vượt tồn: báo ngay dưới đúng dòng kèm cách sửa nhanh và chặn đặt (khách đi thẳng vào /thanh-toan hay lưu đường dẫn
  // không phải chờ tới lúc bấm đặt mới biết). Chỉ xét các dòng đang thanh toán.
  const lineProblems = checkoutLineProblems(checkoutItems, { keepLastLine: !!itemIds });
  const hasLineProblem = Object.keys(lineProblems).length > 0;

  const attempt = useRef<{ body: PlaceBody; key: string; rev: number } | null>(null);
  // Khoá đồng bộ cho mọi đường gửi đơn: `place.isPending` chỉ đúng sau lần vẽ kế (React Query báo trạng thái qua setTimeout 0), hai cú bấm sát nhau vẫn đều thấy nút bật.
  // Chỉ nhả khi lỗi để khách thử lại; đặt xong thì trang đã đổi sang màn thành công hoặc chuyển sang trang VietQR, không nhả để cú bấm muộn không tạo đơn thứ hai.
  const placingRef = useRef(false);
  // Khách đã bấm "Cập nhật giá mới" sau lỗi giá đổi: báo tổng mới cho tới lần đặt kế tiếp.
  const [priceAccepted, setPriceAccepted] = useState(false);
  // Lời lỗi nhớ riêng (không đọc `place.error`): `place.error` chỉ có sau khi `onError` xong, mà `onError` giữ tới khi giỏ và báo giá tải lại; lời lỗi phải hiện ngay.
  const [placeFailure, setPlaceFailure] = useState<{ error: Error } | null>(null);
  const placeError = placeFailure?.error ?? null;
  const placeFailed = placeFailure !== null;
  // Máy chủ đã từ chối vì màn đã cũ và giỏ/báo giá đang tải lại: nút vẫn khoá, nhưng việc đang chạy là tải lại giỏ chứ không phải gửi đơn, nên chữ trên nút nói đúng việc đó.
  const [reloadingStale, setReloadingStale] = useState(false);
  const place = useMutation({
    onMutate: () => {
      setPriceAccepted(false);
      setPlaceFailure(null);
      setReloadingStale(false);
    },
    mutationFn: () => {
      const body: PlaceBody = {
        addressId: addressId!,
        paymentMethod: paymentToSend,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(itemIds ? { itemIds } : {}),
        ...pickup.fields,
        ...(wantInvoice
          ? {
              invoiceRequest: {
                taxCode: normalizeTaxCode(invoice.taxCode),
                companyName: invoice.companyName.trim(),
                address: invoice.address.trim(),
                email: invoice.email.trim(),
              },
            }
          : {}),
        // Báo BE khách đã thấy đơn 0đ: nếu lúc đặt tổng > 0 (điểm vừa bị tiêu bớt) thì BE từ chối thay vì
        // tạo đơn COD có tiền phải trả mà khách không chọn.
        ...(zeroNote ? { quotedZeroTotal: true } : {}),
        // Giá/phí đổi giữa lúc báo giá và lúc bấm đặt → BE trả TOTAL_CHANGED thay vì thu số khách chưa thấy.
        ...(quote ? { expectedTotal: quote.total } : {}),
        pointsToUse: usePoints ? usablePoints : 0,
        storefrontSlug: ctvSlug,
        referralCode: effectiveReferralCode(referralApplied, orderLinkReferral),
        // Máy chủ chỉ lưu mã link khi link thuộc đúng người giới thiệu của đơn (mã khách tự nhập của CTV khác thì bỏ).
        affiliateLinkCode: getStorefrontContext().linkCode ?? undefined,
        ...(zalo.checked !== undefined ? { orderZaloConsent: zalo.checked } : {}),
        // Quà dùng thử đúng như khách đang thấy: quà vừa đổi mốc hoặc hết thì BE trả 409 thay vì âm thầm đổi quà.
        ...giftTrialPlaceField(quote?.giftTrial),
      };
      const frozen = unknownAttempt.current;
      if (frozen) {
        // Dữ liệu suy ra từ giỏ/báo giá (dòng đã chọn, tổng) có thể đã đổi vì đơn trước đã tạo: gửi lại nguyên yêu cầu cũ để máy chủ trả đơn cũ.
        // Lựa chọn của chính khách đổi thì đây là đơn khác: không gửi, mời kiểm tra Đơn hàng; lần bấm sau đặt đơn mới.
        if (frozen.rev !== choiceRev.current) {
          void qc.invalidateQueries({ queryKey: ['orders'] });
          return Promise.reject(new Error(PREVIOUS_MAYBE_PLACED));
        }
        return placeOrder(frozen.body, frozen.key);
      }
      const key = orderKeys.current.keyFor(body);
      attempt.current = { body, key, rev: choiceRev.current };
      return placeOrder(body, key);
    },
    onSuccess: (order) => {
      funnel.ordered();
      orderKeys.current.reset();
      unknownAttempt.current = null;
      setUnknownRev(null);
      setMaybePlaced(false);
      // Theo đơn máy chủ đã tạo, không theo radio đang chọn lúc phản hồi về.
      const isBank = order.paymentMethod === 'BANK_TRANSFER';
      if (!isBank) setPlaced(order);
      if (wantInvoice) saveInvoice(userId, invoice);
      clearCheckoutSelection();
      forgetAutoCoupon(userId);
      void qc.invalidateQueries({ queryKey: ['cart'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      rememberActiveOrder(browserStorage(), userId);
      syncHomeHintCookie();
      if (pickup.applied) {
        void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.all });
        void qc.invalidateQueries({ queryKey: [PICKUP_OPTIONS_KEY] });
      }
      // Điểm Xanh đã tiêu/tích và tiền ví đã trừ: các số dư và sổ cái đang cache đều cũ.
      invalidateBalances(qc);
      if (addressId) rememberRecentAddress(browserStorage(), addressId, userId);
      // Chuyển khoản: sang trang VietQR để khách trả ngay (đối soát xong đơn tự xác nhận), như Mini App.
      if (isBank) {
        // Gọi QR ngay, song song với việc chuyển trang: khung QR dùng chung khoá ['bank-qr', mã] nên nhận đúng lời gọi đang chạy, không gọi lần hai.
        markTransferOrderPlaced(order.code, Date.now());
        void qc.prefetchQuery({ queryKey: ['bank-qr', order.code], queryFn: () => getBankQr(order.code) });
        setRedirectingCode(order.code);
        router.replace(bankPaymentHref(order.code));
      }
    },
    onError: (e) => {
      setPlaceFailure({ error: e });
      // Mọi lần tải lại của nhánh lỗi gom ở đây (mỗi khoá một lần). Máy chủ từ chối vì màn đã cũ (400/404/409/422, `serverRejectedState`) thì nút Đặt hàng giữ khoá tới khi chúng về
      // (tối đa `LOCK_REFRESH_WAIT_MS`), như Mini App: nhả sớm thì chạm lần hai gửi lại đúng đơn vừa bị từ chối trên giỏ/báo giá cũ. Mất mạng, 401 và 5xx không nói gì về giỏ: nhả ngay,
      // bấm lại phải gửi cùng body, cùng khoá.
      const reloads = new Map<string, Promise<unknown>>();
      const reload = (queryKey: readonly unknown[]) => {
        const id = JSON.stringify(queryKey);
        if (!reloads.has(id)) reloads.set(id, qc.invalidateQueries({ queryKey }));
      };
      // 401/408/429 bị chặn trước khi vào nghiệp vụ nên không nói gì về đơn của lần trước: giữ đóng băng.
      const rejectedBeforeService = e instanceof ApiError && [401, 408, 429].includes(e.status);
      if (isOutcomeUnknown(e)) unknownAttempt.current ??= attempt.current;
      else if (!rejectedBeforeService) unknownAttempt.current = null;
      setMaybePlaced(unknownAttempt.current !== null);
      setUnknownRev(unknownAttempt.current?.rev ?? null);
      // Phần đổi rác đã gửi bị máy chủ từ chối vì phiếu/điều kiện đổi giữa chừng (409 không mã): tải lại báo giá và danh sách món, báo khách.
      // Lỗi mạng/quá thời gian/5xx có thể đến sau khi máy chủ đã tạo đơn, nên không tải lại: bấm lại phải gửi cùng body, cùng khoá.
      const sentBody = (unknownAttempt.current ?? attempt.current)?.body;
      const sentPickup = !!(sentBody?.wasteRequestId || sentBody?.inlinePickup);
      const pickupChanged = sentPickup && e instanceof ApiError && e.status === 409 && !e.code && /thu rác/i.test(e.message);
      if (sentPickup && serverRejectedState(e)) {
        reload([PICKUP_OPTIONS_KEY]);
        reload(['quote']);
        reload(WASTE_QUERY_KEYS.me);
        if (e instanceof ApiError && e.code === 'WASTE_MAX_OPEN') {
          pickup.setMaxOpenError(e.message);
        }
      }
      if (pickupChanged) setPickupNotice(fillCopy('checkout.pickup.changed'));
      if (e instanceof ApiError && e.code === 'CART_CHANGED') {
        // Giỏ vừa đổi ở nơi khác (hoặc lần bấm trước đã đặt xong): dựng lại giỏ, báo giá và danh sách đơn.
        reload(['cart']);
        reload(['orders']);
        reload(['quote']);
      } else if (e instanceof Error && e.message === PRICE_CHANGED) {
        reload(['cart']);
        reload(['quote']);
      } else if (e instanceof ApiError && e.code === 'TOTAL_CHANGED') {
        reload(['quote']);
        reload(['cart']);
      } else if (e instanceof ApiError && e.code === 'PAYMENT_METHOD_NOT_ALLOWED') {
        // Báo giá đang cache còn cho cách vừa bị từ chối (vd nơi giao đổi sau lúc báo giá): tải lại để khoá đúng cách đó và tự
        // chọn cách khác, không thì bấm lại bao nhiêu lần cũng nhận cùng lỗi. Nơi giao đổi thường vì giỏ đổi ở tab khác: kiện của
        // báo giá mới lấy món từ giỏ đang cache, nên tải lại cả giỏ, không thì kiện mới hiện ra không có món nào.
        reload(['quote']);
        reload(['cart']);
      } else if (cartFixableNotice(e, e instanceof Error ? e.message : null) !== null) {
        reload(['cart']);
      }
      if (!serverRejectedState(e)) {
        placingRef.current = false;
        return undefined;
      }
      // Các lời từ chối còn lại (địa chỉ không hợp lệ, mã không dùng được, dòng không còn...) đều nói giỏ, báo giá hay đơn đã khác với màn đang hiện.
      reload(['cart']);
      reload(['quote']);
      reload(['orders']);
      setReloadingStale(true);
      // Không hạ cờ `reloadingStale` ở đây: cờ chỉ có nghĩa khi `place.isPending` (xem `placeLabel`) và `onMutate` đặt lại cho lần đặt kế, nên nhãn không phụ thuộc thứ tự giữa lần hạ cờ
      // và lúc React Query chuyển sang `error` (nếu hạ ở đây mà React vẽ xen giữa thì nút chớp "Đang đặt hàng…" một khung).
      return settleWithin(Promise.all([...reloads.values()])).then(() => {
        placingRef.current = false;
      });
    },
  });
  const resetPlace = () => {
    place.reset();
    setPlaceFailure(null);
  };

  const startPlace = () => {
    if (placingRef.current) return;
    placingRef.current = true;
    place.mutate();
  };

  // Sửa nhanh dòng hết hàng/vượt tồn ngay tại màn: khách không rời trang nên các ô đã nhập còn nguyên. Đổi dòng là đổi lựa chọn của khách,
  // nên một lần đặt đang đóng băng (chưa rõ kết quả) không được phát lại nữa.
  // Khoá đồng bộ THEO DÒNG như Mini App (apps/miniapp/src/pages/checkout.tsx:500-516): chạm đúp vào cùng một dòng chỉ gửi một lệnh, dòng khác vẫn đi song song.
  // Lỗi nhớ riêng theo dòng (không đọc `lineFix.error`): `isError` chỉ bật sau khi lời hứa tải lại của `onError` xong, mà lời lỗi phải hiện ngay.
  const [lineFixError, setLineFixError] = useState<{ id: string; error: unknown } | null>(null);
  // Quà tặng dùng thử 0đ: lưu lựa chọn vào giỏ (đúng phần đang đặt) rồi báo giá lại để dòng quà và trường gửi khi đặt khớp nhau.
  const giftChoice = useMutation({
    mutationFn: (variationId: string | null) => setCartGift(variationId, itemIds),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['quote'] }), qc.invalidateQueries({ queryKey: ['cart'] })]),
  });
  const lineFix = useLockedMutation(
    {
      mutationKey: LINE_FIX_KEY,
      mutationFn: ({ id, fix }: { id: string; fix: LineFix }) => (fix.kind === 'remove' ? removeCartItem(id) : updateCartItem(id, fix.quantity)),
      onMutate: ({ id }) => setLineFixError((cur) => (cur?.id === id ? null : cur)),
      // Chờ giỏ và báo giá về mới thôi bận (tối đa 4 giây): nút xoá còn bấm được trong lúc giỏ cũ còn hiện thì lần bấm hai gọi xoá dòng đã mất và nhận 404.
      onSuccess: () => {
        bumpChoice();
        // Đơn đang gửi thì không reset: reset làm `isPending` về false trong lúc `placingRef` còn khoá, nút hiện lại "Đặt hàng" mà bấm không ăn gì tới khi phản hồi về.
        if (!placingRef.current) resetPlace();
        return settleWithin(Promise.all([qc.invalidateQueries({ queryKey: ['cart'] }), qc.invalidateQueries({ queryKey: ['quote'] })]));
      },
      // Giỏ luôn tải lại ở nền: lệnh quá hạn/502 có thể đã ghi ở máy chủ (dòng đã mất) mà màn còn hiện dòng cũ. Máy chủ từ chối (400/404/409/422) thì giữ khoá tới khi giỏ VÀ báo giá về
      // (tối đa 4 giây): nút "Giảm còn n" theo tồn mới và tổng tiền không còn tính dòng đã mất. Lỗi khác nhả ngay. Như apps/miniapp/src/pages/checkout.tsx:510-516 (Mini không tính 422).
      onError: (e, { id }) => {
        setLineFixError({ id, error: e });
        const cartReload = qc.invalidateQueries({ queryKey: ['cart'] });
        if (!serverRejectedState(e)) return undefined;
        return settleWithin(Promise.all([cartReload, qc.invalidateQueries({ queryKey: ['quote'] })]));
      },
    },
    (v) => v.id,
  );
  const lineFixPending = useMutationState({ filters: { mutationKey: LINE_FIX_KEY, status: 'pending' }, select: (mu) => (mu.state.variables as { id: string }).id });
  const lineFixView: LineFixView = {
    problems: lineProblems,
    pendingIds: lineFixPending,
    errorFor: lineFixError?.id ?? null,
    errorText: lineFixError ? actionErrorText(lineFixError.error) : null,
    onFix: (id, fix) => {
      if (fix.kind === 'cart') {
        keepChoices();
        pushOrBack(router, '/gio-hang');
      }
      else lineFix.mutate({ id, fix });
    },
  };

  // Từ lg nút Đặt hàng nằm cuối khung "Đơn hàng", có thể ngoài màn khi khách đang điền form hoá đơn ở cột trái: đặt lỗi thì cuộn khối nút + lời báo vào màn
  // (nearest: không giật trang nếu đã thấy; 64rem = breakpoint lg) và trả focus về nút, vì nút có thể đang khoá thật (báo giá đang tải) hoặc khách đã chuyển focus đi trong lúc chờ. Dưới lg thanh dính đáy lo phần này, không cuộn trang.
  // Lỗi hiện ra lúc nút thường còn khoá (báo giá đang tải, hoặc `onError` còn giữ lệnh tới khi giỏ và báo giá về) và `focus()` vào nút khoá không có tác dụng:
  // lỗi chỉ ghi một "yêu cầu focus", làm khi lệnh đã xong hẳn và báo giá, giỏ tải xong. Xong mà nút vẫn khoá vì lý do khác thì bỏ yêu cầu, kẻo lúc khách sửa xong ô hoá đơn focus bị giật về nút.
  // Báo giá có thể về sau vài giây, lúc đó khách đã tab sang ô khác và đang gõ (ghi chú, hoá đơn, ô nhập mã giảm giá, ô tick Điểm Xanh nằm ngay trong khung "Đơn hàng"): giật focus về nút
  // thì Space/Enter kế tiếp bấm nhầm Đặt hàng. Nên chỉ trả focus khi nó không ở đâu cả (body, nút khoá làm mất focus) hoặc còn ở chính nút; focus ở bất kỳ phần tử nào khác (kể cả
  // liên kết cạnh nút, Enter trên đó là đi trang) thì khách đã chọn chỗ đó, yêu cầu bị bỏ, không giật.
  const placePartRef = useRef<HTMLDivElement>(null);
  const placeButtonRef = useRef<HTMLButtonElement>(null);
  const placeFocusDue = useRef(false);
  useEffect(() => {
    if (!placeFailed || !window.matchMedia?.('(min-width: 64rem)').matches) return;
    placePartRef.current?.scrollIntoView({ block: 'nearest' });
    placeFocusDue.current = true;
  }, [placeFailed, placeFailure, place.submittedAt]);
  const placeSettled = !quoteQ.isFetching && !cartQ.isFetching && !couponChanging;
  useEffect(() => {
    if (!placeFocusDue.current || !placeSettled || place.isPending) return;
    placeFocusDue.current = false;
    // Đọc trạng thái khoá từ chính nút đã vẽ (hook phải đứng trước các `return` sớm, lúc đó `placeDisabled` chưa tính).
    const button = placeButtonRef.current;
    const active = document.activeElement;
    const focusIsFree = !active || active === document.body || active === button;
    if (button && !button.disabled && focusIsFree) button.focus({ preventScroll: true });
  }, [placeSettled, place.isPending, placeFailure, place.submittedAt]);

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
    // Đặt hàng không đăng nhập (web.guest_checkout_enabled): đọc cờ từ chính truy vấn /config/public trang vẫn gọi, cờ tắt thì không thêm yêu cầu nào.
    // Trong lúc truy vấn đó chưa về, dùng bản máy chủ đã đọc sẵn ở layout để không giữ khách ở khung chờ; chỉ chờ khi máy chủ cũng không có.
    // Bản máy chủ có thể cũ vài phút ngay sau khi đổi cờ (xem thanh-toan/layout.tsx): bản của trình duyệt về thì luôn theo bản đó.
    const guestConfig = configQ.data ?? serverGuestConfig;
    if (configQ.isPending && guestConfig === undefined) {
      return (
        <Shell>
          <AuthLoading />
        </Shell>
      );
    }
    if (guestCheckoutOn(guestConfig)) {
      return (
        <Shell>
          <GuestCheckout welcomeAmount={welcomeAmountOf(guestConfig)} />
        </Shell>
      );
    }
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để thanh toán đơn hàng." returnTo="/thanh-toan" />
      </Shell>
    );
  }

  if (redirectingCode) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <p role="status" className="text-[color:var(--color-text-secondary)]">
            Đang chuyển tới trang thanh toán…
          </p>
          <Link href={bankPaymentHref(redirectingCode)} className={`mt-4 inline-block ${ui.btnPrimary}`}>
            Mở trang thanh toán
          </Link>
        </div>
      </Shell>
    );
  }

  if (placed) {
    return (
      <Shell bare>
        <OrderSuccess
          order={placed}
          etaLabel={checkoutEtaLabel(shippingEta, placedOrderKinds(placed), undefined, schedule, addressProvince)}
          continueHref={continueHref}
        />
      </Shell>
    );
  }

  if (cartEmpty && maybePlaced) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <h2 className="font-display text-lg font-semibold text-[color:var(--color-text-primary)]">Đơn của bạn có thể đã được tạo</h2>
          <p className="mt-1 text-sm text-[color:var(--color-text-secondary)]">
            Lần đặt trước chưa nhận được phản hồi và giỏ đã trống. Bấm Kiểm tra lại để hệ thống trả đúng đơn đó, không tạo thêm đơn.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={startPlace}
              aria-busy={place.isPending || undefined}
              aria-disabled={place.isPending || undefined}
              className={ui.btnPrimary}
            >
              {place.isPending ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
            </button>
            <Link href="/tai-khoan/don-hang" className={ui.btnSecondary}>
              Đơn của tôi
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  // Khách đã chọn một phần giỏ mà các món đó không còn (xoá ở nơi khác): không tính tiền phần khác, báo và đưa về giỏ.
  if (cartEmpty && (cartQ.data?.items.length ?? 0) > 0) {
    return (
      <Shell>
        <EmptyState
          art="basket"
          heading={fillCopy('checkout.selectionLostHeading')}
          body={fillCopy('checkout.selectionLostBody')}
          ctaLabel={fillCopy('checkout.lineToCart')}
          onCta={() => {
            clearCheckoutSelection();
            router.replace('/gio-hang');
          }}
        />
      </Shell>
    );
  }

  if (cartEmpty) {
    return (
      <Shell>
        <EmptyState art="basket" heading={CART_EMPTY.heading} body={CART_EMPTY.body} ctaLabel={CART_EMPTY.cta} onCta={() => router.replace('/san-pham')} />
      </Shell>
    );
  }

  // Chưa đủ giỏ, địa chỉ và báo giá đầu tiên thì giữ chỗ từng khối bằng khung chờ: các khối hiện dần làm trang nhảy ngay lúc khách sắp bấm.
  // Chốt một lần: đổi điểm/mã giảm tính lại báo giá không được dựng lại khung chờ.
  const firstQuotePending = !!addrQ.data?.length && !cartQ.isError && (addressId === null || quoteQ.isPending);
  const bootReady = !cartQ.isPending && !addrQ.isPending && !firstQuotePending;
  if (bootReady) bootedRef.current = true;
  if (!bootedRef.current) {
    return (
      <Shell>
        <CheckoutSkeleton />
      </Shell>
    );
  }
  // Giỏ không tải được: lỗi cả trang kèm Thử lại như Mini App, không dựng form với "Tạm tính 0đ" và nút Đặt hàng xám không lý do.
  if (cartQ.isError && !cartQ.data) {
    return (
      <Shell>
        <ErrorState message="Không tải được giỏ hàng." onRetry={() => void cartQ.refetch()} />
      </Shell>
    );
  }

  const cart = cartQ.data;
  const priceChanged = placeError instanceof Error && placeError.message === PRICE_CHANGED;
  const placeErrorMessage = placeError instanceof Error && !priceChanged ? (placeError instanceof NetworkError ? placeError.message : actionErrorText(placeError)) : null;
  const placeCartNotice = placeError ? cartFixableNotice(placeError, placeErrorMessage) : null;
  const cartIssue = placeCartNotice;
  const previewSubtotal = checkoutItems.reduce((sum, it) => sum + it.total, 0);
  // Chưa có báo giá: xem trước khoản giảm từ giỏ như Mini. Combo, mã và hạng của giỏ chỉ đúng cho cả giỏ; mua một phần thì máy chủ tính lại.
  const earnedLabel = quote ? `Nhận +${formatCount(quote.pointsEarned)} Điểm Xanh khi giao thành công` : '';
  const wholeCart = !itemIds || itemIds.length === (cart?.items.length ?? 0);
  // Hộp Xanh nằm trong `comboDiscount` (giỏ và báo giá): hiện thành dòng riêng, tổng không đổi.
  const comboSrc = quote ?? (wholeCart ? cart : null);
  const shownComboOnly = comboOnlyDiscount(comboSrc);
  const shownGreenBox = greenBoxDiscountOf(comboSrc);
  const previewDiscount = wholeCart && cart?.couponCode ? (cart.discount ?? 0) : 0;
  const previewTier = wholeCart ? (cart?.tierDiscount ?? 0) : 0;
  // Như Mini: thẻ tóm tắt chỉ dùng xem trước khi báo giá không chạy (chưa có địa chỉ); đang tải hay lỗi thì không chen dòng giảm vào.
  const cardPreview = !quote && !quoteQ.isLoading && !quoteQ.isError;
  const previewRecalcNote = !wholeCart && (!!cart?.couponCode || (cart?.comboDiscount ?? 0) > 0 || (cart?.tierDiscount ?? 0) > 0);
  const paymentMethods = [
    { k: 'COD', label: 'Thanh toán khi nhận hàng (COD)' },
    { k: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng' },
    { k: 'WALLET', label: `Ví Tubu (${formatVnd(walletBalance)})` },
  ]
    // Ví chỉ trả được cả đơn: số dư 0đ thì khách không làm gì được với dòng này. Ví âm vẫn hiện (khoá, kèm lý do) để khách biết vì sao không dùng được.
    .filter((m) => m.k !== 'WALLET' || walletBalance !== 0)
    .map((m) => ({ ...m, hint: quote ? paymentUnavailableReason(m.k, quote, walletBalance) : null, cue: paymentMethodCue(m.k) }));
  const paymentNote = quote && !zeroNote && payment === '' ? paymentMissingNote(quote, walletBalance) : null;
  // Thiếu địa chỉ hoặc ô hoá đơn thì nút vẫn bấm được: bấm để chỉ ra ô thiếu (lỗi ngay dưới ô, con trỏ nhảy tới). Chỉ những lý do
  // không phải ô nhập (đang tính tiền, dòng cần sửa, chưa có cách thanh toán) mới khoá hẳn, và đã có chữ nói lý do.
  // Đang gửi thì nút `aria-busy` + `aria-disabled` chứ không `disabled`: nút khoá thật làm Chromium thả focus về body; `startPlace` đã chặn cú bấm lặp.
  // Đang lưu quà 0đ: đơn gửi lúc này mang quà cũ trong khi giỏ đã đổi, máy chủ trả 409; chờ lưu xong và báo giá mới về.
  const placeDisabled = hasLineProblem || giftChoice.isPending || (!!addressId && (!quote || quoteStale || (!zeroNote && payment === '')));
  const onPlace = () => {
    if (formBlocked) {
      setPlaceAttempted(true);
      setInvoiceAttempted(true);
      setFocusTick((n) => n + 1);
      return;
    }
    if (!placingRef.current) funnel.step('place_order_click');
    startPlace();
  };
  const totalText = checkoutTotalText({ total: quote?.total ?? null, hasAddress: !!addressId }, formatVnd);
  // Lần đặt vừa rồi chưa rõ kết quả (mất mạng, quá thời gian, 5xx): nút nói rõ là gửi lại cùng đơn (cùng khoá, không tạo đơn trùng).
  const retryingPlace = placeFailed && isOutcomeUnknown(placeError) && unknownRev !== null && unknownRev === choiceTick;
  const placeLabel = reloadingStale && place.isPending
    ? 'Đang cập nhật giỏ…'
    : place.isPending
      ? 'Đang đặt hàng…'
      : quote
        ? fillCopy(retryingPlace ? 'checkout.retryWith' : 'checkout.placeWith', { price: formatVnd(quote.total) })
        : 'Đặt hàng';
  // Lời báo đặt lỗi/giỏ cần sửa nằm cuối khung tóm tắt; thanh dính đáy nhắc lại để khách không phải cuộn xuống mới biết vì sao.
  // Đỏ chỉ cho lỗi thật (đặt lỗi, giá đổi, giỏ cần sửa); lý do khoá nút do thiếu địa chỉ/chưa tính được là chữ phụ như Mini.
  const barError =
    cartIssue ??
    (priceChanged
      ? fillCopy('checkout.priceChangedHint')
      : retryingPlace
        ? fillCopy('checkout.retryNote')
        : placeFailed
          ? (placeErrorMessage ?? 'Đặt hàng thất bại.')
          : null);
  const addressOutdated = quoteQ.error instanceof ApiError && quoteQ.error.code === 'ADDRESS_OUTDATED';
  const barNote = barError ? null : (checkoutPlaceHint({ hasAddress: !!addressId, quoteFailed: quoteQ.isError, addressOutdated }) ?? (hasLineProblem ? fillCopy('checkout.fixLinesHint') : null));

  return (
    <Shell>
      {priceChanged && (
        <div
          role="alert"
          data-testid="checkout-price-changed"
          className="mb-4 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg"
        >
          <p className="font-semibold">Giá ưu đãi đã thay đổi</p>
          <p className="mt-0.5">{fillCopy('checkout.priceChangedBody')}</p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            <button
              type="button"
              className={ui.btnPrimary}
              disabled={quoteStale}
              onClick={() => {
                resetPlace();
                setPriceAccepted(true);
              }}
            >
              {priceChangedActions().accept}
            </button>
            <BackAwareLink href="/gio-hang" onClick={keepChoices} className={ui.btnSecondary}>
              {priceChangedActions().viewCart}
            </BackAwareLink>
          </div>
        </div>
      )}
      {pickupNotice && (
        <p role="status" data-testid="checkout-pickup-notice" className="mb-4 rounded-card bg-warning-bg px-4 py-3 text-sm font-semibold text-warning-fg">
          {pickupNotice}
        </p>
      )}
      {priceAccepted && quote && !quoteStale && !placeFailed && (
        <p
          role="status"
          data-testid="checkout-price-updated"
          className="mb-4 rounded-card bg-success-bg px-4 py-3 text-sm font-semibold text-success-fg"
        >
          {fillCopy('checkout.priceUpdated', { price: formatVnd(quote.total) })}
        </p>
      )}
      {cartIssue && (
        <div
          role="alert"
          data-testid="checkout-cart-issue"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg"
        >
          <p className="min-w-0 flex-1 break-words">{cartIssue}</p>
          <BackAwareLink href="/gio-hang" onClick={keepChoices} className={ui.btnSecondary}>
            Về giỏ hàng để sửa
          </BackAwareLink>
        </div>
      )}
      <div className="grid gap-6 max-md:grid-cols-[minmax(0,1fr)] max-md:gap-0 md:mx-auto md:max-w-2xl lg:max-w-none lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 max-md:contents">
          <section
            ref={addressBlockRef}
            data-mini-block="address"
            data-testid="checkout-address-block"
            role="group"
            aria-label="Địa chỉ giao hàng"
            tabIndex={-1}
            aria-describedby={placeAttempted && !addressId ? 'checkout-address-error' : undefined}
            className={`${MINI_BAND} max-md:order-1 outline-none`}
          >
            <h2 data-ds="checkout-block-title" className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Địa chỉ giao hàng</h2>
            {addrQ.isError && (
              <p className={`mt-2 ${ui.error}`}>
                Không tải được danh sách địa chỉ.{' '}
                <InlineRetry onRetry={() => addrQ.refetch()} />
              </p>
            )}
            <AddressPicker
              addresses={addrQ.data ?? []}
              selectedId={addressId}
              quoteOutdated={addressOutdated}
              loadFailed={addrQ.isError}
              autoOpen={addrQ.isSuccess && addrQ.data.length === 0}
              userId={user?.id}
              onSelect={chosen(setAddressId)}
              onCreated={(a) => {
                // Đưa địa chỉ mới vào danh sách trước khi chọn: dòng địa chỉ chỉ vẽ khi id đang chọn có trong danh sách,
                // chờ tải lại (hoặc tải lại lỗi) thì khối địa chỉ trống, khách không còn chỗ bấm.
                qc.setQueryData<AddressDTO[]>(['addresses'], (old = []) => (old.some((x) => x.id === a.id) ? old : [...old, a]));
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                chosen(setAddressId)(a.id);
                funnel.step('address_saved');
              }}
              onUpdated={() => {
                bumpChoice();
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                void qc.invalidateQueries({ queryKey: ['quote'] });
              }}
            />
            {placeAttempted && !addressId && (
              <p id="checkout-address-error" role="alert" className="mt-2 text-caption text-danger-fg">
                <span aria-hidden="true">⚠ </span>
                {fillCopy('checkout.addressNeeded')}
              </p>
            )}
          </section>

          <section data-mini-block="payment" className={`${MINI_BAND} max-md:order-5`}>
            <h2 id="pay-methods-heading" className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Phương thức thanh toán</h2>
            {zeroNote ? (
              <p className="mt-2 text-sm text-[color:var(--color-text-brand)]">{zeroNote}</p>
            ) : (
              <div role="radiogroup" aria-labelledby="pay-methods-heading" className="mt-2 space-y-2">
                {paymentMethods.map((p) => {
                  const reason = p.hint;
                  return (
                    <div key={p.k}>
                      <label className={`${payOptionClass(payment === p.k)} ${reason ? 'cursor-not-allowed' : ''}`}>
                        <input
                          type="radio"
                          name="pay"
                          checked={payment === p.k}
                          onChange={chosen(() => {
                            setPayment(p.k);
                            funnel.step('payment_method_selected', p.k);
                            if (p.k === 'BANK_TRANSFER') warmBankPayment((href) => router.prefetch(href));
                          })}
                          disabled={!!reason || place.isPending}
                          aria-describedby={reason ? `pay-blocked-${p.k}` : p.cue ? `pay-cue-${p.k}` : undefined}
                          className={`${miniRadio} ${miniRadioGutter} ${reason ? 'opacity-[0.45] md:opacity-60' : ''}`}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className={reason ? 'opacity-[0.45] md:opacity-60' : undefined}>{p.label}</span>
                          {reason && (
                            <span id={`pay-blocked-${p.k}`} className="text-caption text-[color:var(--color-text-secondary)] md:hidden">
                              {reason}
                            </span>
                          )}
                          {/* Dòng phụ là mô tả của radio (aria-describedby), không gộp vào tên: tên giữ ngắn "Chuyển khoản ngân hàng". Cách bị khoá thì lý do khoá thay chỗ. */}
                          {!reason && p.cue && (
                            <span id={`pay-cue-${p.k}`} aria-hidden="true" className="text-caption text-[color:var(--color-text-secondary)]">
                              {p.cue}
                            </span>
                          )}
                        </span>
                      </label>
                      {reason && (
                        <p aria-hidden="true" className="mt-1 text-caption text-[color:var(--color-text-secondary)] hidden md:block">
                          {reason}
                        </p>
                      )}
                      {p.k === 'BANK_TRANSFER' && payment === 'BANK_TRANSFER' && !reason && <TransferPreview total={quote?.total ?? null} dim={recalculating} />}
                    </div>
                  );
                })}
                {paymentNote && (
                  <p role="status" className="text-sm text-warning-fg">
                    {paymentNote}
                  </p>
                )}
              </div>
            )}
          </section>

          <section data-mini-block="note" data-ds="checkout-note" className={`${MINI_BAND} max-md:order-7`}>
            <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Ghi chú cho Tubu</h2>
            <label className="mt-2 block">
              <span className="text-field-label text-[color:var(--color-text-secondary)] max-md:sr-only">Lời nhắn cho người giao hàng (không bắt buộc)</span>
              <textarea
                value={note}
                onChange={chosen((e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value))}
                maxLength={ORDER_NOTE_MAX}
                rows={2}
                placeholder="Ví dụ: giao giờ hành chính…"
                disabled={place.isPending}
                aria-describedby="order-note-count"
                className={`${NOTE_FIELD} mt-1 h-12 resize-none py-2 md:h-auto md:resize-y`}
              />
            </label>
            <p id="order-note-count" className="mt-1 text-caption text-[color:var(--color-text-secondary)] max-md:sr-only">
              {note.length}/{ORDER_NOTE_MAX} ký tự
            </p>
          </section>

          <div data-mini-block="referral" className="max-md:order-4 max-md:mt-2">
            <ReferralCodeBox
              linkedCode={linkedReferral}
              appliedCode={referralApplied}
              onApplied={chosen(setReferralApplied)}
              disabled={place.isPending}
            />
          </div>

          <div ref={invoiceBlockRef} data-mini-block="invoice" className="max-md:order-9 max-md:mt-2">
            <InvoiceSection
              want={wantInvoice}
              onWant={(v) => {
                chosen(setWantInvoice)(v);
                if (v) {
                  setInvoiceAttempted(false);
                  setInvoiceTouched({});
                }
              }}
              invoice={invoice}
              onInvoice={chosen(setInvoice)}
              errors={invoiceShown}
              onTouch={(f) => setInvoiceTouched((t) => (t[f] ? t : { ...t, [f]: true }))}
              disabled={place.isPending}
            />
          </div>
        </div>

        {/* Từ lg khung "Đơn hàng" dính dưới header (không vùng cuộn riêng, DESIGN.md) để cột phải đi theo khi cột trái dài; dải tổng + nút Đặt hàng bên dưới dính đáy màn nên nút luôn trong tầm nhìn dù khung cao hơn màn. */}
        <div className={`h-fit p-4 ${ui.card} max-md:contents lg:pb-0 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:self-start`}>
          <h2 className={`${ui.sectionTitle} max-md:hidden`}>Đơn hàng</h2>
          {/* Từ md danh sách chữ hiện đủ dòng, không vùng cuộn lồng: dòng thứ 6 trở đi gập sau nút kèm tiền; giỏ tách kiện hiện hết
              để khách thấy đủ mọi kiện và phí giao cộng vào tổng. */}
          <div data-mini-block="items" className="max-md:order-2 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4">
          <MobileItems items={checkoutItems} shipments={split ? shipments : null} splitNote={splitNote} fix={lineFixView} />
          <DesktopLines items={checkoutItems} shipments={split ? shipments : null} fix={lineFixView} />
          {itemIds && cart && (
            <p className="mt-2 text-caption text-[color:var(--color-text-secondary)]">
              Đang thanh toán {itemIds.length}/{cart.items.length} sản phẩm trong giỏ.{' '}
              <BackAwareLink href="/gio-hang" className="font-semibold text-[color:var(--color-text-brand)] underline">
                Đổi lựa chọn
              </BackAwareLink>
            </p>
          )}
          {splitNote && <p className="mt-2 text-caption text-[color:var(--color-text-secondary)] hidden md:block">{splitNote}</p>}
          <PickupSection
            pickup={quote ? (quote.pickup ?? null) : undefined}
            tubuShippingFee={tubuShippingFee}
            applied={pickup.applied}
            options={pickup.options}
            optionsLoading={pickup.optionsLoading}
            optionsError={pickup.optionsError}
            onRetryOptions={() => void pickup.refetchOptions()}
            open={pickup.sheetOpen}
            onOpenChange={pickup.setSheetOpen}
            onApply={chosen(pickup.apply)}
            onClear={chosen(pickup.clear)}
            maxOpenError={pickup.maxOpenError}
            disabled={place.isPending}
            nudge={pickup.nudge}
            onNudgeShown={trackNudgeShown}
            onNudgeApplied={trackNudgeApplied}
          />
          <GiftRows
            gifts={giftsRef.current}
            excluded={pickup.excluded}
            onToggle={chosen(pickup.toggleGift)}
            shortfallVnd={quote?.giftShortfallVnd ?? 0}
            disabled={place.isPending}
          />
          <GiftTrialRow
            summary={quote?.giftTrial}
            showLocked={false}
            busy={giftChoice.isPending || place.isPending}
            onChoose={chosen((variationId: string | null) => {
              if (!giftChoice.isPending) giftChoice.mutate(variationId);
            })}
          />
          {giftChoice.isError && (
            <p role="alert" className="mt-1 text-caption text-danger-fg">
              {actionErrorText(giftChoice.error) || fillCopy('giftTrial.saveFailed')}
            </p>
          )}
          </div>
          <div data-mini-block="summary" className="max-md:order-10 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pt-4">
          <div className="mb-2.5 hidden items-center justify-between max-md:flex">
            <h2 className="font-ui text-sm font-semibold">Tóm tắt đơn hàng</h2>
            <button
              type="button"
              onClick={() => setSummarySheetOpen(true)}
              aria-haspopup="dialog"
              className="inline-flex min-h-11 items-center gap-1 text-caption font-bold text-[color:var(--color-text-brand)]"
            >
              Chi tiết
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <Row ds="checkout-summary-row" label="Tạm tính" value={formatVnd(quote?.subtotal ?? previewSubtotal)} />
          {cardPreview && shownComboOnly > 0 && <Row label="Giảm giá combo" value={`-${formatVnd(shownComboOnly)}`} green />}
          {cardPreview && shownGreenBox > 0 && <Row label={fillCopy('greenBox.name')} value={`-${formatVnd(shownGreenBox)}`} green />}
          {cardPreview && previewDiscount > 0 && <Row label="Giảm giá" value={`-${formatVnd(previewDiscount)}`} green />}
          {cardPreview && previewTier > 0 && <Row label="Ưu đãi hạng thành viên" value={`-${formatVnd(previewTier)}`} green />}
          {cardPreview && previewRecalcNote && (
            <p className="py-1 text-caption text-[color:var(--color-text-secondary)]">Mua một phần giỏ: mã giảm giá và ưu đãi được tính lại ở bước thanh toán.</p>
          )}
          {(quote?.discount ?? 0) > 0 && (
            <Row
              label={<>Giảm giá<span className="hidden md:inline">{cart?.couponCode ? ` (${cart.couponCode})` : ''}</span></>}
              value={`-${formatVnd(quote!.discount)}`}
              green
            />
          )}
          {quote && shownComboOnly > 0 && <Row label="Ưu đãi combo" value={`-${formatVnd(shownComboOnly)}`} green />}
          {quote && shownGreenBox > 0 && <Row label={fillCopy('greenBox.name')} value={`-${formatVnd(shownGreenBox)}`} green />}
          {(quote?.tierDiscount ?? 0) > 0 && (
            <Row label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote!.tierDiscount!)}`} green />
          )}
          {(quote?.pointsDiscount ?? 0) > 0 && (
            <Row
              label={<>Điểm Xanh<span className="hidden md:inline">{` (${formatCount(quote!.pointsUsed)})`}</span></>}
              value={`-${formatVnd(quote!.pointsDiscount)}`}
              green
            />
          )}
          <Row label="Phí vận chuyển" value={shippingValue} valueGreen={quote?.shippingFee === 0} dim={recalculating} />
          {quote && etaLabel && <Row label="Giao dự kiến" value={etaLabel} />}
          </div>
          <BottomSheet
            open={summarySheetOpen}
            onClose={() => setSummarySheetOpen(false)}
            title="Chi tiết tính tiền đơn hàng"
            footer={
              <Button fullWidth onPress={() => setSummarySheetOpen(false)}>
                Đã hiểu
              </Button>
            }
          >
            <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-canvas)] p-3">
              <Row label="Tạm tính tiền hàng" value={formatVnd(quote?.subtotal ?? previewSubtotal)} />
              {(quote ? quote.discount : previewDiscount) > 0 && <Row label="Mã giảm giá" value={`-${formatVnd(quote ? quote.discount : previewDiscount)}`} valueGreen />}
              {shownComboOnly > 0 && <Row label="Giảm giá combo" value={`-${formatVnd(shownComboOnly)}`} valueGreen />}
              {shownGreenBox > 0 && <Row label={fillCopy('greenBox.name')} value={`-${formatVnd(shownGreenBox)}`} valueGreen />}
              {(quote ? (quote.tierDiscount ?? 0) : previewTier) > 0 && <Row label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote ? quote.tierDiscount! : previewTier)}`} valueGreen />}
              {(quote?.pointsDiscount ?? 0) > 0 && <Row label="Giảm giá Điểm Xanh" value={`-${formatVnd(quote!.pointsDiscount)}`} valueGreen />}
              <Row label="Phí vận chuyển" value={shippingValue} valueGreen={quote?.shippingFee === 0} />
              <div className="my-2 h-px bg-[var(--color-border-subtle)]" />
              <div className="flex justify-between gap-2.5 py-1.5 font-bold text-[color:var(--color-text-primary)]">
                <span className="text-sm font-normal text-[color:var(--color-text-secondary)]">Tổng thanh toán</span>
                <span className="text-base">{totalText}</span>
              </div>
              {quote && quote.pointsEarned > 0 && (
                <p className="mt-1.5 flex items-center justify-end gap-1 text-caption text-success-fg">
                  <Sprout size={13} aria-hidden="true" />
                  {earnedLabel}
                </p>
              )}
            </div>
          </BottomSheet>
          {cart && (
            <div data-mini-block="coupon" className="max-md:order-3 max-md:mt-2">
              <CouponBox
                band
                actionLabel="Chọn mã"
                currentCode={cart.couponCode}
                appliedDiscount={quote?.discount ?? 0}
                subtotal={previewSubtotal}
                shippingFee={quote?.shippingFee ?? null}
                notice={couponNoticeText({ ...(quote ?? cart), couponCode: cart.couponCode }, formatVnd)}
                removedNotice={removedCoupon.notice}
                onDismissRemoved={removedCoupon.dismiss}
                disabled={place.isPending}
                // Luồng có itemIds ("Mua ngay", chọn món) không tự áp, kể cả khi giỏ chỉ có đúng món đó: máy chủ giữ mã lại trên giỏ sau khi đặt.
                autoApply={!itemIds && (!!addressId || addrQ.data?.length === 0)}
                memoryUserId={userId}
                preview={checkoutItems.length > 0 ? { ...(addressId ? { addressId } : {}), storefrontSlug: ctvSlug, itemIds } : undefined}
                previewKey={couponPreviewKey(checkoutItems)}
              />
            </div>
          )}
          <div data-mini-block="points" className="max-md:order-6 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4 max-md:empty:hidden">
          {usablePoints > 0 && (
            <label
              className={`relative mt-3 flex min-h-11 items-center gap-2 rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 text-sm max-md:mt-0 max-md:flex-row-reverse max-md:justify-between max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 ${
                partnerPoints.disabled ? 'cursor-not-allowed md:opacity-60' : 'cursor-pointer'
              }`}
            >
              <span className={`${miniCheckboxWrap} ${miniCheckboxGutter} ${partnerPoints.disabled ? 'opacity-60 md:opacity-100' : ''}`}>
                <input
                  type="checkbox"
                  checked={usePoints && !partnerPoints.disabled}
                  disabled={partnerPoints.disabled}
                  onChange={chosen((e: React.ChangeEvent<HTMLInputElement>) => setUsePoints(e.target.checked))}
                  className={miniCheckbox}
                />
                <CheckMark />
              </span>
              {/* Số thật backend trừ (đã áp trần % giá trị hàng) nằm ở quote.pointsUsed, không phải số dư. */}
              <span className="min-w-0 text-[color:var(--color-text-brand)]">
                <span className="block font-semibold max-md:text-[color:var(--color-text-primary)]">Điểm Xanh</span>
                <span className="block text-caption max-md:text-[color:var(--color-text-tertiary)]">
                  {partnerPoints.disabled
                    ? lockedPointsLabel(quote, pointsOffer)
                    : pointsOfferText(usablePoints, quote, usePoints && quote ? quote : null, configQ.data?.loyalty?.vndPerPointRedeem)}
                </span>
                {pointNotes('md:hidden')}
              </span>
            </label>
          )}
          {usablePoints === 0 && (
            <div data-testid="points-none" className="flex min-h-11 items-center justify-between md:hidden">
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-[var(--type-body-sm-lh)] text-[color:var(--color-text-primary)]">Điểm Xanh</span>
                <span className="block text-caption text-[color:var(--color-text-tertiary)]">{idlePointsLabel(quote ?? user)}</span>
                {pointNotes('md:hidden')}
              </span>
              <span className={`${miniCheckboxWrap} ${miniCheckboxGutter}`}>
                <input type="checkbox" checked={false} disabled readOnly aria-label="Dùng Điểm Xanh" className={miniCheckbox} />
                <CheckMark />
              </span>
            </div>
          )}
          {pointNotes('md:block')}
          </div>
          <div data-mini-part="summary-total" className="max-md:order-11 max-md:bg-[var(--color-bg-surface)] max-md:px-4">
          <div
            data-ds="checkout-summary-total"
            className="flex justify-between gap-2.5 py-1.5 text-[color:var(--color-text-primary)] md:mt-3 md:gap-0 md:border-t md:border-[var(--color-border-subtle)] md:pb-0 md:pt-3 md:font-bold lg:hidden"
          >
            <span className="text-sm font-normal leading-[var(--type-body-sm-lh)] text-[color:var(--color-text-secondary)] md:text-base md:font-bold md:leading-[inherit] md:text-[color:var(--color-text-primary)]">Tổng cộng</span>
            {/* Đang tải/đang lỗi thì hiện "…" thay vì 0đ: con số 0 đứng yên cạnh dòng báo lỗi
                trông như đơn không mất tiền. */}
            <span className={`text-base font-bold leading-[var(--type-body-sm-lh)] tabular-nums md:leading-[inherit] ${recalculating ? RECALC_DIM : ''}`}>{totalText}</span>
          </div>
          {/* Chữ chỉ cho trình đọc màn hình: chữ hiện ra rồi biến mất sẽ làm khối nhảy. */}
          <p role="status" className="sr-only">
            {recalculating ? fillCopy('checkout.recalculating') : ''}
          </p>
          {quote && quote.pointsEarned > 0 && (
            <p className="mt-1 flex items-center gap-1 text-caption text-success-fg">
              <Sprout size={13} aria-hidden="true" />
              {earnedLabel}
            </p>
          )}
          {quoteQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              {quoteQ.error instanceof ApiError && quoteQ.error.code === 'ADDRESS_OUTDATED'
                ? `${loadErrorText(quoteQ.error)} Hãy bấm Sửa ở địa chỉ đó để chọn lại tỉnh/phường, hoặc thêm địa chỉ mới.`
                : pickup.applied && quoteQ.error instanceof ApiError && quoteQ.error.status === 400
                  ? loadErrorText(quoteQ.error)
                  : 'Không tính được phí ship/tổng tiền.'}{' '}
              <InlineRetry onRetry={() => quoteQ.refetch()} />
            </p>
          )}
          {cartQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              Không tải được giỏ hàng.{' '}
              <InlineRetry onRetry={() => cartQ.refetch()} />
            </p>
          )}

          {/* Dưới lg nút đặt hàng nằm ở thanh dính đáy (cuối trang). Từ lg khung "Đơn hàng" dính dưới header và khối dưới đây (dải tổng + nút) dính đáy màn trong khung, để nút và lý do khoá/lỗi đặt hàng nằm sát nhau và còn trong tầm nhìn khi khung cao hơn màn. */}
          </div>
          <div ref={placePartRef} data-mini-part="place-order" className="max-md:order-11 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pb-4 lg:sticky lg:bottom-0 lg:bg-[var(--color-bg-surface)] lg:py-4">
          {/* Bản sao hiển thị của dòng Tổng cộng ở khối tổng phía trên (ẩn từ lg): tổng tiền đi cùng khối dính, luôn nằm cạnh nút Đặt hàng. */}
          <div className="mb-3 hidden justify-between border-t border-[var(--color-border-subtle)] pt-3 font-bold text-[color:var(--color-text-primary)] lg:flex">
            <span>Tổng cộng</span>
            <span className={`tabular-nums ${recalculating ? RECALC_DIM : ''}`}>{totalText}</span>
          </div>
          {zalo.view && <OrderZaloConsentRow phone={zalo.view.phone} checked={zalo.checked === true} onChange={zalo.setPicked} />}
          <OrderConsent className="hidden lg:block" />
          <button
            ref={placeButtonRef}
            type="button"
            onClick={onPlace}
            disabled={placeDisabled}
            aria-busy={place.isPending || undefined}
            aria-disabled={place.isPending || undefined}
            className={`${ui.btnPrimary} mt-3 hidden w-full tabular-nums lg:inline-flex`}
          >
            {placeLabel}
          </button>
          {/* Lý do khoá nút từ lg, ngay dưới nút như lời báo lỗi (thanh dính đáy ở điện thoại có vùng riêng, ẩn từ lg; dòng đồng ý điều khoản giữ sát trên nút). Luôn có mặt trong cây, chỉ đổi chữ: vùng gắn cùng lúc với chữ thì đọc màn hình thường không đọc. */}
          <p
            role="status"
            data-testid="place-note-lg"
            className={barNote ? 'mt-2 hidden text-caption text-[color:var(--color-text-secondary)] lg:block' : 'sr-only'}
          >
            {barNote}
          </p>
          {/* Giá đổi và giỏ cần sửa đã có banner role="alert" ở đầu trang (xa nút khi cuộn): lời nhắc cạnh nút chỉ để nhìn, không thêm vùng alert thứ hai. */}
          {(priceChanged || cartIssue !== null) && barError && (
            <p data-testid="place-error-lg" aria-hidden="true" className="mt-2 hidden text-caption text-danger-fg lg:block">
              {barError}
            </p>
          )}
          {placeFailed && !priceChanged && placeCartNotice === null && (
            <div role="alert" className={`mt-2 ${ui.error}`}>
              <p>{placeErrorMessage ?? 'Đặt hàng thất bại.'}</p>
              {isOutcomeUnknown(placeError) && !retryingPlace && (
                <p className="mt-1 text-[color:var(--color-text-secondary)]">
                  {PREVIOUS_MAYBE_PLACED} Mở{' '}
                  <Link href="/tai-khoan/don-hang" className="font-semibold text-[color:var(--color-text-brand)] underline">
                    Đơn của tôi
                  </Link>
                  .
                </p>
              )}
              {retryingPlace && (
                <p className="mt-1 text-[color:var(--color-text-secondary)]">
                  Đơn có thể đã được ghi nhận. Bấm Thử lại để gửi lại đúng đơn này — hệ thống nhận ra yêu cầu trùng nên không tạo thêm đơn. Hoặc xem{' '}
                  <Link href="/tai-khoan/don-hang" className="font-semibold text-[color:var(--color-text-brand)] underline">
                    Đơn của tôi
                  </Link>
                  .
                </p>
              )}
              {placeError?.message === PREVIOUS_MAYBE_PLACED && (
                <p className="mt-1 text-[color:var(--color-text-secondary)]">
                  Nếu đơn trước chưa có trong{' '}
                  <Link href="/tai-khoan/don-hang" className="font-semibold text-[color:var(--color-text-brand)] underline">
                    Đơn của tôi
                  </Link>
                  , bấm Đặt hàng lần nữa để đặt đơn mới với lựa chọn hiện tại.
                </p>
              )}
            </div>
          )}
          <OrderConsent className="pt-3 lg:hidden" />
          </div>
        </div>
      </div>
      <StickyActionBar label="Đặt hàng" hideFrom="lg">
        <div className="md:mx-auto md:max-w-2xl">
          {barError && (
            <p aria-hidden="true" className="mb-2 text-caption text-danger-fg">
              {barError}
            </p>
          )}
          {/* Vùng báo luôn có mặt trong cây, chỉ đổi chữ: vùng gắn vào cùng lúc với chữ thì đọc màn hình (VoiceOver) thường không đọc. */}
          <p role="status" className={barNote ? 'mb-2 text-caption text-[color:var(--color-text-secondary)]' : 'sr-only'}>
            {barNote}
          </p>
          <button
            type="button"
            onClick={onPlace}
            disabled={placeDisabled}
            aria-busy={place.isPending || undefined}
            aria-disabled={place.isPending || undefined}
            className={`${uiBar.primary} w-full`}
          >
            {placeLabel}
          </button>
        </div>
      </StickyActionBar>
    </Shell>
  );
}

// Dưới md đúng KeyValueRow của Mini: đệm 6px, nhãn 14/400, giá trị 15/600 (cỡ 15px là cỡ thừa kế của Mini, không phải bậc body-sm).
// `bare`: màn thành công ở điện thoại không có thanh tiêu đề (Mini App OrderSuccess tự có h1), từ md vẫn như các màn khác.
function Shell({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0 md:max-w-[45rem] lg:max-w-frame`}>
      <BackLink href="/gio-hang" crumbs={[{ label: 'Trang chủ', href: '/' }, { label: 'Giỏ hàng', href: '/gio-hang' }, { label: 'Thanh toán' }]}>
        ← Về giỏ hàng
      </BackLink>
      {bare ? (
        // Không dùng PageHeader: data-page-bleed dù ẩn bằng CSS vẫn khớp `body.with-back-btn:has([data-page-bleed])` và làm mất đệm 48px của nút lùi nổi.
        <header className="flex items-center gap-2 max-md:hidden md:mt-1">
          <h1 className={ui.pageTitle}>Thanh toán</h1>
        </header>
      ) : (
        <PageHeader title="Thanh toán" className="md:mt-1" />
      )}
      <div className="mt-4 max-md:mt-0">{children}</div>
    </main>
  );
}
