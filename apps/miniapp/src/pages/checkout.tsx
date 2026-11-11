import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Page, Text, Input, useNavigate, useLocation, useSnackbar } from 'zmp-ui';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WasteMeDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { Ticket, ChevronRight, Sprout, AlertCircle, Recycle } from 'lucide-react';
import { getAddresses, getCart, checkoutQuote, placeOrder, removeCartItem, updateCartItem, type PlacedOrder } from '../services/shop-api';
import { cartPreviewKey, cartProductIds } from '../utils/coupon-scope';
import { fulfillerLabel, shipmentsNote } from '../utils/shipments';
import { getWallet, getLoyalty } from '../services/account-api';
import { getErrorCode, getErrorMessage, getLoadErrorMessage, isOutcomeUnknown, isStaleStateError } from '../services/api';
import { isHttpError } from '../services/http';
import { getWasteMe, WASTE_QUERY_KEYS } from '../services/waste-api';
import { trackEvent } from '../services/analytics';
import { useAuthStore } from '../store/auth';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useNotify } from '../hooks/use-notify';
import { useStorefrontContext } from '../store/storefront-context';
import { AddressSection } from '../components/checkout/address-section';
import { OrderSuccess } from '../components/checkout/order-success';
import { VoucherSheet } from '../components/checkout/voucher-sheet';
import { COUPON_CHANGE_KEY, useCheckoutCoupon } from '../components/checkout/use-coupon-hint';
import { normalizeTaxCode } from '@tubutree/app-core/commerce/tax-code';
import { validateInvoiceFields, type InvoiceField } from '@tubutree/app-core/commerce/checkout-form';
import { flashLimitNotice, isCartFixableError } from '@tubutree/app-core/commerce/flash-limit';
import { checkoutLineProblems, isPriceChangedError, priceChangedActions, type LineFix } from '@tubutree/app-core/commerce/checkout-issues';
import { checkoutPlaceHint, checkoutTotalText } from '@tubutree/app-core/commerce/checkout-display';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { couponAutoCopy, couponHintText } from '@tubutree/app-core/coupon-use';
import { couponNoticeText } from '@tubutree/app-core/coupon-min-order';
import { CouponRemovedNotice } from '../components/checkout/coupon-removed-notice';
import { useRemovedCoupon } from '../hooks/use-removed-coupon';
import { pointsOfferText } from '@tubutree/app-core/points-offer';
import { ReferralCodeBox, effectiveReferralCode } from '../components/checkout/referral-code-box';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { useLockedMutation } from '../components/game/use-locked-mutation';
import { formatVnd, formatPoints } from '../utils/format';
import { usePublicConfig } from '../hooks/use-public-config';
import { checkoutEtaLabel } from '@tubutree/app-core/shipping-eta';
import { createOrderKeyRing } from '../utils/idempotency';
import { settleWithin } from '../utils/settle-within';
import { rememberActiveOrder } from '@tubutree/app-core/home-todo-rows';
import { browserStorage } from '../utils/recently-viewed';
import {
  checkoutPoints,
  isInvoiceValid,
  paymentMissingNote,
  paymentUnavailableReason,
  pickPaymentMethod,
  lockedPointsLabel,
  pointsCapState,
  pointsEarnLabel,
  zeroTotalNote,
} from '../utils/checkout-rules';
import {
  clearCheckoutSelection,
  recallCheckoutSelection,
  reconcileSelection,
  rememberCheckoutSelection,
  type RememberedSelection,
} from '../utils/checkout-selection';
import { convertedPointsNote } from '../utils/points-lots';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { PolicySheet } from '../components/policy-sheet';
import type { WebPolicySlug } from '../utils/web-policy';
import { formatLineQty } from '../utils/waste-labels';
import { PageHeader } from '../components/ui/page-header';
import { ProductThumb } from '../components/ui/product-thumb';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Radio, Checkbox, Field } from '../components/ui/form';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { KeyValueRow } from '../components/ui/key-value-row';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Button } from '../components/ui/button';
import { Icon } from '../components/ui/icon';
import { Text as DsText } from '../components/ui/text';
import { ListRow } from '../components/ui/list-row';
import { useCartKey } from '../services/cart-key';
import { INPUT_LIMITS } from '../utils/input-limits';

const PREVIOUS_MAYBE_PLACED = 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.';

type PlaceBody = Parameters<typeof placeOrder>[0];

/** `undefined` ẩn mục, `null` hiện dòng tạo yêu cầu, còn lại là yêu cầu PICKUP mở chưa gắn đơn để bật công tắc. */
export function attachablePickup(me: WasteMeDTO | undefined, pickupFlag: boolean): WasteRequestSummaryDTO | null | undefined {
  if (!pickupFlag || !me || me.blocked || me.shipLockedAt) return undefined;
  return me.openRequests.find((r) => r.method === 'PICKUP' && r.status === 'OPEN' && r.orderCode == null) ?? null;
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<WebPolicySlug | null>(null);
  const { openSnackbar } = useSnackbar();
  const { notify } = useNotify();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const sfCtx = useStorefrontContext();
  // Chỉ gian hàng CTV (kind='ctv') mới gắn storefrontSlug (combo + attribution).
  // Trang nhãn (kind='brand') KHÔNG gửi → tránh ô nhiễm analytics CTV; vẫn giữ referralCode.
  const ctvSlug = sfCtx.kind === 'ctv' ? (sfCtx.slug ?? undefined) : undefined;

  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [usePoints, setUsePoints] = useState(false);
  const [note, setNote] = useState('');
  const [attachWaste, setAttachWaste] = useState(false);
  // Chỉ hiện "Thu kèm rác" khi cờ pickup đã bật thật từ server; chưa tải xong → ẩn, không hứa dịch vụ chưa chắc có.
  const publicConfig = usePublicConfig();
  const pickupFlag = publicConfig.isLoaded && publicConfig.waste.pickup === true;
  const wasteMeQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: pickupFlag });
  const pickupReq = attachablePickup(wasteMeQ.data, pickupFlag);
  const [voucherSheetOpen, setVoucherSheetOpen] = useState(false);
  // Mã từ link chỉ khoá ô nhập khi máy chủ đã xác nhận là mã CTV; mã khách thường (nút chia sẻ sản phẩm) bị máy chủ bỏ qua nên
  // không được hiện như "đang mua qua link giới thiệu". Chưa biết (null) vẫn gửi kèm đơn để máy chủ tự quyết: lỗi mạng lúc chạm không được làm CTV mất công.
  const linkedReferral = sfCtx.referralEligible === true ? sfCtx.referralCode : null;
  const orderLinkReferral = sfCtx.referralEligible === false ? null : sfCtx.referralCode;
  // Mã giới thiệu CTV khách tự nhập ở màn này (đã được server xác nhận) — khác mã đến từ link (sfCtx).
  const [referralApplied, setReferralApplied] = useState<string | null>(null);
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
  // Mốc thời gian lúc khách nhận giá mới: báo "Tổng mới" khi báo giá tải lại xong sau mốc này.
  const [priceAcceptedAt, setPriceAcceptedAt] = useState<number | null>(null);
  const [totalChanged, setTotalChanged] = useState<string | null>(null);
  // Lỗi đặt đơn chỉ sửa được ở giỏ (hết tồn, vượt suất giờ vàng): giữ trên màn kèm đường về giỏ, không để toast trôi mất.
  const [cartIssue, setCartIssue] = useState<string | null>(null);
  // Khoá tap nhanh 2 lần: ensurePhone() mở native sheet, nếu không khoá thì
  // 2 sheet số điện thoại + 2 mutate song song (BE chống đơn đôi nhưng UX hỏng).
  const [submitting, setSubmitting] = useState(false);
  // Hoá đơn VAT (spec §6.3) — nhớ thông tin cho lần sau (localStorage).
  const [wantInvoice, setWantInvoice] = useState(false);
  const [invoice, setInvoice] = useState(() => {
    try {
      const raw = localStorage.getItem('tubu_invoice');
      if (raw) return JSON.parse(raw) as { taxCode: string; companyName: string; address: string; email: string };
    } catch {
      /* ignore */
    }
    return { taxCode: '', companyName: '', address: '', email: '' };
  });
  // Một key cho một nội dung đơn trong phiên checkout: bấm lại sau lỗi mạng/quá thời gian là gửi lại cùng đơn (AD-004).
  const orderKeys = useRef(createOrderKeyRing());
  // Lần đặt trước chưa rõ kết quả (mạng rớt/5xx): server có thể đã tạo đơn, mà ví/điểm/báo giá/giỏ nạp lại làm body đổi và sinh key
  // mới, tạo đơn thứ hai. Đóng băng chính yêu cầu: bấm lại gửi nguyên body và key đó cho tới khi có kết quả rõ.
  const unknownAttempt = useRef<{ body: PlaceBody; key: string; rev: number } | null>(null);
  const attempt = useRef<{ body: PlaceBody; key: string; rev: number } | null>(null);
  // Đếm số lần khách tự đổi lựa chọn. Không so các trường của body: phương thức thanh toán, điểm dùng được, địa chỉ mặc định
  // được tính lại từ dữ liệu máy chủ ngay khi nạp lại, không phải khách đổi ý.
  const choiceRev = useRef(0);
  // Bản sao của choiceRev và của rev lần đặt đang treo trong state để vẽ: nút chỉ là "Thử lại" khi lựa chọn hiện tại đúng là lần đặt bị treo.
  const [choiceTick, setChoiceTick] = useState(0);
  const [unknownRev, setUnknownRev] = useState<number | null>(null);
  const bumpChoice = () => {
    choiceRev.current += 1;
    setChoiceTick(choiceRev.current);
  };
  // Đơn trả về theo yêu cầu đã gửi (có thể là đơn cũ được gửi lại), không theo radio đang chọn lúc phản hồi về.
  const sentMethod = useRef('');
  // Bản sao của cờ đóng băng trong state: giỏ nạp lại thành rỗng thì form và nút Đặt hàng biến mất, màn giỏ trống phải còn lối gửi lại.
  const [maybePlaced, setMaybePlaced] = useState(false);
  const [placeNotice, setPlaceNotice] = useState<'unknown' | 'previous' | null>(null);
  const chosen = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    bumpChoice();
    fn(...args);
  };

  // Guard auth: tránh gọi /cart, /me/addresses khi chưa silent-login xong (deeplink → 401).
  const cart = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: authed });
  // Mã bị máy chủ gỡ lúc đọc giỏ (giỏ rơi dưới đơn tối thiểu, hết hạn, bị tắt) chỉ được báo một lần: nhớ để khách thấy vì sao tổng tăng.
  const removedCoupon = useRemovedCoupon(cart.data, formatVnd);
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: authed });

  useEffect(() => {
    if (!addresses.data || addresses.data.length === 0) return;
    // Chọn mặc định khi chưa chọn, HOẶC khi địa chỉ đang chọn đã bị xoá (tránh quote kẹt lỗi).
    const stillExists = addresses.data.some((a) => a.id === addressId);
    if (!addressId || !stillExists) {
      const first = addresses.data.find((a) => a.isDefault)?.id ?? addresses.data[0]?.id;
      if (first) setAddressId(first);
    }
  }, [addresses.data, addressId]);

  // Checkout TẬP CON: itemIds do trang Giỏ / "Mua ngay" truyền qua navigation state.
  // Zalo Mini App có thể tải lại trang (back-forward, khôi phục phiên, deep link) — state mất
  // thì trước đây màn này âm thầm chuyển sang TOÀN GIỎ, tính tiền cả những món khách không
  // chọn. Nay lựa chọn được ghi nhớ theo phiên; state (nếu có) luôn thắng bộ nhớ.
  const location = useLocation();
  const navSelection = (location.state as { itemIds?: RememberedSelection } | null)?.itemIds;
  const rawSelection: RememberedSelection | undefined =
    navSelection !== undefined ? navSelection : recallCheckoutSelection();
  useEffect(() => {
    if (navSelection !== undefined) rememberCheckoutSelection(navSelection);
  }, [navSelection]);

  // Dòng đã nhớ có thể không còn trong giỏ → đối chiếu với giỏ thật trước khi quote.
  const cartReady = rawSelection == null || cart.isSuccess;
  // Chỉ đối chiếu khi giỏ đã về: trước đó danh sách dòng còn rỗng nên lựa chọn nào cũng thành "chết". Lựa chọn chết là mảng rỗng,
  // không bao giờ rơi về cả giỏ (xem màn báo bên dưới).
  const itemIds = cart.data ? reconcileSelection(rawSelection, cart.data.items.map((it) => it.id)) : undefined;
  const itemIdsKey = itemIds ? itemIds.join(',') : '';
  const selectionDead = !!itemIds && itemIds.length === 0;

  // Số dư PHẢI đọc từ query (được invalidate sau mọi thao tác tiền), KHÔNG từ auth store —
  // store chỉ được nạp lại lúc mở app và sau khi đặt đơn, nên khách vừa nhận tiền vào Ví hoặc vừa
  // tiêu Điểm Xanh trong Vườn Xanh sẽ thấy số cũ: hoặc không chọn được cách trả tiền mình vừa nạp,
  // hoặc chọn được rồi bị BE từ chối "số dư không đủ" sau khi chờ spinner.
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: authed });
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const walletBalanceLive = walletQ.data?.walletBalance ?? user?.walletBalance ?? 0;
  // Điểm DÙNG ĐƯỢC, không phải số dư: điểm thường của đơn vừa giao còn trong hạn đổi/trả hoặc đang chờ xử
  // lý đổi/trả chưa tiêu được; điểm quy đổi (không hết hạn) luôn dùng được. Backend chia hai lô + kẹp theo
  // đúng số này khi báo giá và đặt đơn.
  const points = checkoutPoints(loyaltyQ.data, user?.pointsBalance ?? 0, user?.pointsConvertedBalance ?? 0);

  const pointsToUse = usePoints ? points.usable : 0;
  // Giỏ chưa tải xong hoặc không có món nào thì không báo giá: máy chủ trả 400 cho giỏ rỗng.
  const cartHasItems = (cart.data?.items.length ?? 0) > 0;
  const quoteEnabled = !!addressId && authed && cartReady && cartHasItems && !selectionDead;
  const quote = useQuery({
    queryKey: ['quote', addressId, pointsToUse, ctvSlug, itemIdsKey],
    queryFn: () => checkoutQuote(addressId!, pointsToUse, ctvSlug, itemIds),
    enabled: quoteEnabled,
  });
  // Lời báo của mã đang giữ: báo giá (nếu đã có) thắng giỏ, kèm số cần mua thêm khi mã chỉ thiếu đơn tối thiểu.
  const couponLine = cart.data?.couponCode ? couponNoticeText({ ...(quote.data ?? cart.data), couponCode: cart.data.couponCode }, formatVnd) : null;

  useEffect(() => {
    if (priceAcceptedAt === null) return;
    // Báo giá lỗi hoặc đang tắt (giỏ thành rỗng, hết địa chỉ) thì không còn lần báo giá nào để báo: xoá mốc, kẻo lần báo giá
    // về sau (giỏ có hàng lại) bật câu "Đã cập nhật giá" sai lúc.
    if (quote.isError || !quoteEnabled) {
      setPriceAcceptedAt(null);
      return;
    }
    if (!quote.isSuccess || quote.isFetching || !quote.data || quote.dataUpdatedAt <= priceAcceptedAt) return;
    setPriceAcceptedAt(null);
    notify({ text: fillCopy('checkout.priceUpdated', { price: formatVnd(quote.data.total) }), type: 'success' });
  }, [priceAcceptedAt, quoteEnabled, quote.isError, quote.isSuccess, quote.isFetching, quote.data, quote.dataUpdatedAt, notify]);

  const checkoutItems = itemIds
    ? (cart.data?.items ?? []).filter((it) => itemIds.includes(it.id))
    : (cart.data?.items ?? []);
  // Giỏ chưa có mã thì tự áp mã giảm nhiều nhất khách đang có (một lần); không áp được hoặc khách đã gỡ thì chỉ nhắc còn
  // mã dùng được. Cùng tham số xem trước với VoucherSheet.
  const couponPreviewParams = checkoutItems.length > 0 ? { ...(addressId ? { addressId } : {}), storefrontSlug: ctvSlug, itemIds } : undefined;
  const couponPreviewKey = cartPreviewKey(checkoutItems);
  const couponReady = authed && !addresses.isLoading && cartHasItems && !!cart.data && !cart.data.couponCode;
  const wholeCart = !itemIds || itemIds.length === (cart.data?.items.length ?? 0);
  const autoCoupon = useCheckoutCoupon({
    enabled: couponReady,
    // Luồng có `itemIds` ("Mua ngay", chọn món) không tự áp, kể cả khi giỏ chỉ có đúng món đó: máy chủ coi đơn có itemIds là tập
    // con và giữ mã lại trên giỏ sau khi đặt, khách sẽ nhận lời "mã đã bị gỡ" cho mã họ chưa từng chọn.
    autoAllowed: !itemIds && (!!addressId || addresses.data?.length === 0),
    userId: user?.id,
    cartLoaded: !!cart.data,
    currentCode: cart.data?.couponCode,
    previewParams: couponPreviewParams,
    previewKey: couponPreviewKey,
    onChanged: () => {
      bumpChoice();
    },
  });
  // Lệnh áp/gỡ mã của tấm chọn mã còn bay: khách đóng tấm được rồi chạm Đặt hàng ở chân trang, đơn sẽ đi với giỏ chưa có mã.
  const couponChanging = useIsMutating({ mutationKey: COUPON_CHANGE_KEY }) > 0;

  // Giỏ có hàng của gian hàng đối tác: Điểm Xanh chỉ trả cho hàng Tubu (trần của đơn + câu giải thích; giỏ chỉ hàng đối tác thì tắt).
  const partnerPoints = pointsCapState(quote.data, points.usable);
  const pointsUsable = points.usable > 0 && !partnerPoints.disabled;
  useEffect(() => {
    if (partnerPoints.disabled && usePoints) setUsePoints(false);
  }, [partnerPoints.disabled, usePoints]);

  const invoiceValid = isInvoiceValid(wantInvoice, invoice);
  // Lời báo ô hoá đơn: hiện khi khách rời ô, hoặc khi bấm Đặt hàng mà còn thiếu (lúc đó con trỏ nhảy tới ô lỗi đầu tiên).
  const invoiceErrors = wantInvoice ? validateInvoiceFields(invoice) : {};
  const [invoiceTouched, setInvoiceTouched] = useState<Partial<Record<InvoiceField, boolean>>>({});
  const [placeAttempted, setPlaceAttempted] = useState(false);
  // Lần bấm Đặt hàng tính cho ô hoá đơn tách riêng khỏi địa chỉ: bật hoá đơn SAU một lần bấm thiếu địa chỉ thì bốn ô chưa được đỏ ngay.
  const [invoiceAttempted, setInvoiceAttempted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const invoiceError = (f: InvoiceField) => (invoiceAttempted || invoiceTouched[f] ? invoiceErrors[f] : undefined);
  const touchInvoice = (f: InvoiceField) => () => setInvoiceTouched((t) => (t[f] ? t : { ...t, [f]: true }));
  const addressRef = useRef<HTMLDivElement>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  // Bấm Đặt hàng khi còn thiếu địa chỉ hoặc ô hoá đơn: cuộn tới và đưa con trỏ vào chỗ thiếu đầu tiên theo thứ tự trên màn hình.
  useEffect(() => {
    if (focusTick === 0) return;
    const target = !addressId
      ? (addressRef.current?.querySelector<HTMLElement>('button, [role=radio], input') ?? addressRef.current)
      : invoiceRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.focus();
    target?.scrollIntoView?.({ block: 'center' });
  }, [focusTick]);


  // Đơn 0đ: BE ép COD + xác nhận luôn (không thu tiền). Gửi đúng phương thức đó và không mở màn QR chuyển
  // khoản cho khoản 0đ dù khách đã lỡ chọn chuyển khoản trước khi dùng điểm.
  const zeroNote = quote.data ? zeroTotalNote(quote.data) : null;
  const paymentToSend = zeroNote ? 'COD' : payment;

  // Cách thanh toán dùng được theo báo giá (máy chủ từ chối đặt đúng các cách nó khoá: hạn mức COD từng đơn, giỏ tách đơn D4)
  // và số dư Ví mới nhất. Lựa chọn không còn dùng được thì đổi sang cách khác dùng được, hết cách thì bỏ chọn để khoá nút đặt.
  useEffect(() => {
    if (!quote.data) return;
    const next = pickPaymentMethod(payment, quote.data, walletBalanceLive);
    if (next !== payment) setPayment(next);
  }, [payment, quote.data, walletBalanceLive]);

  // Phát 'checkout_started' đúng 1 LẦN cho lần quote thành công đầu tiên (không phát lại mỗi
  // khi quote refetch — vd đổi địa chỉ/mã giảm giá làm quote chạy lại nhiều lần trong 1 phiên).
  const trackedCheckoutStarted = useRef(false);
  // Khoá đồng bộ "Thử lại" báo giá: lỗi báo giá giữ nguyên dòng báo trong lúc tải lại nên khách không thấy gì xảy ra và chạm tiếp,
  // mà báo giá đã có số cũ thì mỗi `refetch()` huỷ lần trước rồi hỏi lại.
  const quoteRetrying = useRef(false);
  useEffect(() => {
    if (!quote.isSuccess || trackedCheckoutStarted.current) return;
    trackedCheckoutStarted.current = true;
    void trackEvent('checkout_started', 'miniapp', {
      itemCount: itemIds?.length ?? cart.data?.items?.length ?? 0,
      subtotal: quote.data?.subtotal ?? 0,
      // Hạn chế đã biết (review 2026-09-28, CHẤP NHẬN cho MVP): `entry` không phân biệt được
      // "Mua ngay" (PDP) với "checkout MỘT PHẦN giỏ" (trang Giỏ bỏ chọn vài món) — cả 2 đều có
      // `itemIds` nên đều bị gắn nhãn 'buy_now'. Phân biệt đúng cần thêm cờ `checkoutEntry`
      // truyền qua navigation state ở CẢ product-detail.tsx lẫn cart.tsx + mở rộng
      // utils/checkout-selection.ts để sống sót qua reload — phạm vi rộng hơn task này, để dành
      // cho whole-branch review. `isSubset` là bước trung gian rẻ tiền: tối thiểu phân biệt
      // được "có chọn tập con" hay không.
      entry: itemIds ? 'buy_now' : 'cart',
      isSubset: !!itemIds,
    });
  }, [quote.isSuccess]);

  const order = useLockedMutation({
    mutationFn: () => {
      const body = {
        addressId: addressId!,
        paymentMethod: paymentToSend,
        pointsToUse,
        // Báo BE khách đã thấy đơn 0đ: nếu lúc đặt tổng > 0 (điểm vừa bị tiêu bớt) thì BE từ chối thay vì
        // tạo đơn COD có tiền phải trả mà khách không chọn.
        ...(zeroNote ? { quotedZeroTotal: true } : {}),
        // Tổng khách đang thấy: giá/phí đổi giữa lúc báo giá và lúc bấm đặt thì BE trả TOTAL_CHANGED thay vì thu số mới.
        ...(quote.data ? { expectedTotal: quote.data.total } : {}),
        note: note.trim() || undefined,
        ...(attachWaste && pickupReq ? { wasteRequestId: pickupReq.id } : {}),
        invoiceRequest: wantInvoice
          ? {
              taxCode: normalizeTaxCode(invoice.taxCode),
              companyName: invoice.companyName.trim(),
              address: invoice.address.trim(),
              email: invoice.email.trim(),
            }
          : undefined,
        referralCode: effectiveReferralCode(referralApplied, orderLinkReferral),
        storefrontSlug: ctvSlug,
        itemIds,
      };
      const frozen = unknownAttempt.current;
      if (frozen) {
        // Dữ liệu suy ra từ giỏ/báo giá có thể đã đổi vì đơn trước đã tạo: gửi lại nguyên yêu cầu cũ để server trả đơn cũ.
        // Lựa chọn của chính khách đổi thì đây là đơn khác: không gửi, mời kiểm tra Đơn hàng; lần bấm sau đặt đơn mới.
        if (frozen.rev !== choiceRev.current) {
          void queryClient.invalidateQueries({ queryKey: ['orders'] });
          return Promise.reject(new Error(PREVIOUS_MAYBE_PLACED));
        }
        sentMethod.current = frozen.body.paymentMethod;
        return placeOrder(frozen.body, frozen.key);
      }
      const key = orderKeys.current.keyFor(body);
      attempt.current = { body, key, rev: choiceRev.current };
      sentMethod.current = body.paymentMethod;
      return placeOrder(body, key);
    },
    onSuccess: (o) => {
      unknownAttempt.current = null;
      setUnknownRev(null);
      setMaybePlaced(false);
      haptic('heavy');
      // Nhớ thông tin hoá đơn cho lần đặt sau (đỡ nhập lại).
      if (wantInvoice) {
        try {
          localStorage.setItem('tubu_invoice', JSON.stringify(invoice));
        } catch {
          /* ignore */
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      rememberActiveOrder(browserStorage(), user?.id);
      if (attachWaste && pickupReq) void queryClient.invalidateQueries({ queryKey: ['waste'] });
      // Thanh toán WALLET trừ walletBalance và sử dụng điểm cộng/trừ pointsBalance ở BE;
      // staleTime=60s global → wallet/profile sẽ stale 60s nếu không invalidate → user thấy số cũ.
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      // Điểm Xanh đọc từ ['loyalty'] (nguồn số dư dùng ở chính màn này) — đơn vừa tiêu/tích điểm.
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      // Refresh auth store (user.walletBalance / pointsBalance dùng ở header/checkout) để UI đồng bộ.
      void useAuthStore.getState().restore().catch(() => undefined);
      orderKeys.current.reset(); // đơn sau là đơn mới
      setPlaceNotice(null);
      clearCheckoutSelection(); // lựa chọn của đơn vừa đặt không được dính sang đơn sau
      autoCoupon.forget();
      // Chuyển khoản: sang màn VietQR để khách quét trả ngay (Pancake đối soát → tự xác nhận).
      if ((o.paymentMethod ?? sentMethod.current) === 'BANK_TRANSFER') {
        navigate(`/bank-payment/${o.code}`, { replace: true });
        return;
      }
      setPlaced(o);
    },
    onError: (e: unknown) => {
      // Mọi lần tải lại của nhánh lỗi gom ở đây (mỗi khoá một lần): khi máy chủ từ chối vì màn đã cũ (400/404/409) nút Đặt hàng giữ khoá tới khi dữ liệu về
      // (tối đa `settleWithin`), kẻo bấm lại trên giỏ/báo giá cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về giỏ: nhả ngay, bấm lại vẫn gửi cùng body, cùng khoá.
      const reloads = new Map<string, Promise<unknown>>();
      const reload = (queryKey: readonly unknown[]) => {
        const id = JSON.stringify(queryKey);
        if (!reloads.has(id)) reloads.set(id, queryClient.invalidateQueries({ queryKey }));
      };
      const hold = () => (isStaleStateError(e) ? settleWithin(Promise.all([...reloads.values()])) : undefined);
      if (e instanceof Error && e.message === PREVIOUS_MAYBE_PLACED) {
        unknownAttempt.current = null;
        setUnknownRev(null);
        setMaybePlaced(false);
        setPlaceNotice('previous');
        openSnackbar({ text: PREVIOUS_MAYBE_PLACED, type: 'error' });
        return undefined;
      }
      // 401/408/429 bị chặn trước khi vào nghiệp vụ nên không nói gì về đơn của lần trước: giữ đóng băng.
      const status = isHttpError(e) ? e.response?.status : undefined;
      const rejectedBeforeService = status !== undefined && [401, 408, 429].includes(status);
      if (isOutcomeUnknown(e)) unknownAttempt.current ??= attempt.current;
      else if (!rejectedBeforeService) unknownAttempt.current = null;
      setMaybePlaced(unknownAttempt.current !== null);
      setUnknownRev(unknownAttempt.current?.rev ?? null);
      setPlaceNotice(isOutcomeUnknown(e) ? 'unknown' : null);
      // 4xx cho yêu cầu thu rác đã đóng/bị khoá: tải lại để công tắc biến mất. Lỗi mạng/quá thời gian/5xx có thể đến sau khi
      // server đã tạo đơn, nên không tải lại: bấm lại phải gửi cùng body, cùng khoá.
      if (attachWaste && !isOutcomeUnknown(e)) {
        reload(WASTE_QUERY_KEYS.me);
      }
      // Giữ key: lỗi mạng/quá thời gian/5xx có thể xảy ra sau khi server đã tạo đơn — bấm lại cùng nội dung phải là replay,
      // không phải đơn thứ hai. Khách sửa địa chỉ/thanh toán/món thì keyFor tự ra key mới.
      if (getErrorCode(e) === 'CART_CHANGED') {
        reload(['cart']);
        reload(['orders']);
        reload(['quote']);
        openSnackbar({ text: getErrorMessage(e), type: 'error' });
        return hold();
      }
      // `getErrorMessage` đã biến mã không dấu thành câu chung, nên nhận ra bằng thân phản hồi thô.
      if (isPriceChangedError(e)) {
        setPriceChanged(true);
        reload(['cart']);
        reload(['quote']);
        return hold();
      }
      if (getErrorCode(e) === 'TOTAL_CHANGED') {
        setTotalChanged(getErrorMessage(e));
        reload(['quote']);
        reload(['cart']);
        return hold();
      }
      // Vượt giới hạn mua mỗi khách của một suất Giờ vàng: câu có sẵn con số giới hạn, sửa ở giỏ bằng cách giảm số lượng.
      const flashLimit = flashLimitNotice(e);
      if (flashLimit !== null) {
        setCartIssue(flashLimit);
        reload(['cart']);
        return hold();
      }
      if (isCartFixableError(getErrorMessage(e))) {
        setCartIssue(getErrorMessage(e));
        reload(['cart']);
        return hold();
      }
      // Báo giá đang cache còn cho cách vừa bị từ chối (vd nơi giao đổi sau lúc báo giá): tải lại để khoá đúng cách đó và tự chọn
      // cách khác, không thì bấm lại bao nhiêu lần cũng nhận cùng lỗi. Nơi giao đổi thường vì giỏ đổi ở nơi khác: kiện của báo giá
      // mới lấy món từ giỏ đang cache, nên tải lại cả giỏ, không thì kiện mới hiện ra không có món nào.
      if (getErrorCode(e) === 'PAYMENT_METHOD_NOT_ALLOWED') {
        reload(['quote']);
        reload(['cart']);
      }
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Các lời từ chối còn lại (hết hàng, mã không dùng được, địa chỉ không hợp lệ...) đều nói giỏ/báo giá/đơn đã khác với màn đang hiện.
      if (isStaleStateError(e)) {
        reload(['cart']);
        reload(['quote']);
        reload(['orders']);
      }
      return hold();
    },
    onSettled: () => setSubmitting(false),
  });
  // Đang xin SĐT hoặc đang gửi đơn (kể cả đơn gửi lại bằng "Kiểm tra lại", không qua `submitting`): không đổi mã giữa chừng.
  const orderBusy = order.isPending || submitting;

  // Sửa nhanh dòng hết hàng/vượt tồn ngay tại màn: khách không rời trang nên các ô đã nhập còn nguyên. Đổi dòng là đổi lựa chọn
  // của khách, nên một lần đặt đang đóng băng (chưa rõ kết quả) không được phát lại nữa.
  const lineFix = useLockedMutation({
    mutationFn: ({ id, fix }: { id: string; fix: LineFix }) => (fix.kind === 'remove' ? removeCartItem(id) : updateCartItem(id, fix.quantity)),
    // Chờ giỏ và báo giá về mới thôi bận: nút xoá còn bấm được trong lúc giỏ cũ còn hiện thì lần bấm hai gọi xoá dòng đã mất và nhận 404.
    onSuccess: async () => {
      bumpChoice();
      setCartIssue(null);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['cart'] }), queryClient.invalidateQueries({ queryKey: ['quote'] })]);
    },
    // Bị từ chối thường vì tồn vừa đổi: tải lại giỏ để nút "Giảm còn n" theo tồn mới.
    // Máy chủ từ chối (400/404/409) thì giữ khoá tới khi giỏ và báo giá về (tối đa `settleWithin`). Lỗi khác vẫn tải lại giỏ ở nền như trước (kết quả có thể đã ghi) nhưng nhả khoá ngay.
    onError: (e: unknown) => {
      notify({ text: getErrorMessage(e), type: 'error' });
      const cartReload = queryClient.invalidateQueries({ queryKey: ['cart'] });
      if (!isStaleStateError(e)) return undefined;
      return settleWithin(Promise.all([cartReload, queryClient.invalidateQueries({ queryKey: ['quote'] })]));
    },
  }, (v) => v.id);

  // ── Success screen ──
  if (placed) {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <OrderSuccess
          order={placed}
          onTrack={() => navigate(`/order/${placed.code}`, { replace: true })}
          onContinue={() => navigate('/', { replace: true })}
        />
      </Page>
    );
  }

  // Chưa vào được phiên: không được rơi xuống "Giỏ còn trống" (giỏ có thật, chỉ là chưa tải được).
  if (phase === 'loading') return <CheckoutSkeleton />;
  if (phase !== 'authenticated') {
    return (
      <Shell>
        <AuthPhaseView phase={phase} />
      </Shell>
    );
  }

  if (cart.isLoading || addresses.isLoading) return <CheckoutSkeleton />;

  const cartFailed = cart.isError && !cart.data;
  const addressesFailed = addresses.isError && !addresses.data;
  if (cartFailed || addressesFailed) {
    const err = cartFailed ? cart.error : addresses.error;
    const retry = () => Promise.all([cartFailed ? cart.refetch() : undefined, addressesFailed ? addresses.refetch() : undefined]);
    return (
      <Shell>
        <ErrorState message={getLoadErrorMessage(err)} onRetry={retry} />
      </Shell>
    );
  }

  if (checkoutItems.length === 0 && maybePlaced) {
    return (
      <Shell>
        <EmptyState
          art="basket"
          heading="Đơn của bạn có thể đã được tạo"
          body="Lần đặt trước chưa nhận được phản hồi và giỏ đã trống. Bấm Kiểm tra lại để hệ thống trả đúng đơn đó, không tạo thêm đơn."
          ctaLabel={order.isPending ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          onCta={() => {
            if (!order.isPending) order.mutate();
          }}
        />
        <Box p={4}>
          <Button fullWidth variant="secondary" onPress={() => navigate('/orders', { replace: true })}>
            Đơn của tôi
          </Button>
        </Box>
      </Shell>
    );
  }

  // Khách đã chọn một phần giỏ mà các món đó không còn (xoá ở nơi khác): không tính tiền phần khác, báo và đưa về giỏ.
  if (checkoutItems.length === 0 && (cart.data?.items.length ?? 0) > 0) {
    return (
      <Shell>
        <EmptyState
          art="basket"
          heading={fillCopy('checkout.selectionLostHeading')}
          body={fillCopy('checkout.selectionLostBody')}
          ctaLabel={fillCopy('checkout.lineToCart')}
          onCta={() => {
            clearCheckoutSelection();
            navigate('/cart', { replace: true });
          }}
        />
      </Shell>
    );
  }

  // Giỏ trống (vd mở từ deeplink) → không cho đặt đơn rỗng.
  if (checkoutItems.length === 0) {
    return (
      <Shell>
        <EmptyState
          art="basket"
          heading={vi.cart.emptyHeading}
          body={vi.cart.emptyBody}
          ctaLabel={vi.cart.emptyCta}
          onCta={() => navigate('/browse', { replace: true })}
        />
      </Shell>
    );
  }

  const walletBalance = walletBalanceLive;
  // Lý do THẬT khiến "Đặt hàng" không bấm được (chưa chọn địa chỉ / quote chưa sẵn sàng / hoá đơn
  // VAT chưa hợp lệ / chưa có cách thanh toán dùng được) — KHÔNG gồm order.isPending/submitting: 2 cờ đó là trạng thái ĐANG XỬ LÝ, đã
  // truyền riêng qua Button's `loading` bên dưới. Button (Task 10, components/ui/button.tsx) tự
  // chặn bấm-2-lần khi `loading` bất kể `disabled`, và handler onPress cũng tự kiểm `submitting`
  // trước khi mutate — gộp lại `disabled` chỉ khiến spinner không hiện trong lúc đặt hàng (đúng
  // bug audit A4-01/A4-02/A4-04 mà lần migrate này phải sửa), không thêm được lớp bảo vệ nào mới.
  const lineProblems = checkoutLineProblems(checkoutItems, { keepLastLine: !!itemIds });
  const hasLineProblem = Object.keys(lineProblems).length > 0;
  const shownCartIssue = cartIssue;
  // Thiếu địa chỉ hoặc ô hoá đơn thì nút vẫn bấm được: bấm để chỉ ra ô thiếu (lỗi ngay dưới ô, con trỏ nhảy tới). Chỉ những lý do
  // không phải ô nhập (đang tính tiền, dòng cần sửa, chưa có cách thanh toán, đang áp mã) mới khoá hẳn, và đã có chữ nói lý do.
  const formBlocked = !addressId || !invoiceValid;
  const placeLocked =
    hasLineProblem || autoCoupon.busy || couponChanging || (!!addressId && (!quote.isSuccess || quote.isFetching || (!zeroNote && payment === '')));

  // Chưa có báo giá (chưa chọn địa chỉ) thì chưa biết tổng đơn → chưa khoá, chưa có lý do.
  const paymentMethods = [
    { value: 'COD', label: vi.checkout.paymentCod },
    // ZALOPAY tạm ẨN: chưa nối cổng thanh toán thật → nếu hiện, bấm đặt sẽ ra "thành công"
    // mà KHÔNG thu tiền (như COD) → đơn treo/sai đối soát. Mở lại khi tích hợp Payment API Zalo.
    { value: 'BANK_TRANSFER', label: vi.checkout.paymentBank },
    { value: 'WALLET', label: vi.checkout.paymentWallet(formatVnd(walletBalance)) },
  ]
    // Ví chỉ trả được cả đơn: số dư 0đ thì khách không làm gì được với dòng này. Ví âm vẫn hiện (khoá, kèm lý do) để khách biết vì sao không dùng được.
    .filter((m) => m.value !== 'WALLET' || walletBalance !== 0)
    .map((m) => {
    const hint = quote.isSuccess ? paymentUnavailableReason(m.value, quote.data, walletBalance) : null;
    return { ...m, hint, disabled: hint !== null };
  });
  const paymentNote = quote.isSuccess && !zeroNote && payment === '' ? paymentMissingNote(quote.data, walletBalance) : null;
  // Mỗi nơi giao thành một đơn riêng (D4): chia danh sách món và phí giao theo kiện máy chủ báo.
  const shipments = quote.data?.shipments ?? [];
  const split = shipments.length > 1 || shipments.some((sh) => sh.fulfiller.kind === 'MERCHANT');
  const splitNote = shipmentsNote(shipments);
  // Cùng điều kiện với màn thành công: chưa có cấu hình thì không hứa ngày giao; giỏ chỉ có hàng gian hàng tự giao thì cũng không.
  const etaLabel = publicConfig.isLoaded ? checkoutEtaLabel(publicConfig.shippingEta, shipments.map((sh) => sh.fulfiller.kind)) : null;

  const shownItems = itemIds
    ? (cart.data?.items ?? []).filter((it) => itemIds.includes(it.id))
    : (cart.data?.items ?? []);
  const previewSubtotal = shownItems.reduce((s, it) => s + it.total, 0);
  // Chưa có báo giá: tiền hàng trừ combo (chỉ khi mua cả giỏ — chọn một phần thì máy chủ tính lại) rồi trừ mã, như checkout trừ.
  // Lựa chọn nhớ lại có thể bằng đúng mọi dòng của giỏ (vd còn lại sau khi dọn món đã xoá): vẫn là cả giỏ.
  // Combo, mã và hạng của giỏ chỉ đúng cho cả giỏ (mã tính trên phần hàng sau combo, hạng trên phần còn lại); mua một phần thì máy chủ tính lại.
  const previewCombo = wholeCart ? (cart.data?.comboDiscount ?? 0) : 0;
  const previewDiscount = wholeCart && cart.data?.couponCode ? (cart.data.discount ?? 0) : 0;
  const previewTier = wholeCart ? (cart.data?.tierDiscount ?? 0) : 0;
  // Lý do nút Đặt hàng đang khoá do thiếu địa chỉ hoặc báo giá lỗi: nói ngay trên nút (cùng câu với web).
  const addressOutdated = getErrorCode(quote.error) === 'ADDRESS_OUTDATED';
  const placeHint = checkoutPlaceHint({ hasAddress: !!addressId, quoteFailed: quote.isError, addressOutdated }) ?? (hasLineProblem ? fillCopy('checkout.fixLinesHint') : null);
  // Lần đặt vừa rồi chưa rõ kết quả (mất mạng, quá thời gian, 5xx): nút nói rõ là gửi lại cùng đơn (cùng khoá, không tạo đơn trùng).
  const retryingPlace = placeNotice === 'unknown' && unknownRev !== null && unknownRev === choiceTick;
  const placeBarNote = placeHint ?? (retryingPlace ? fillCopy('checkout.retryNote') : null);
  const previewRecalcNote = !wholeCart && (!!cart.data?.couponCode || (cart.data?.comboDiscount ?? 0) > 0 || (cart.data?.tierDiscount ?? 0) > 0);

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(96px + var(--safe-bottom))' }}>
      <PageHeader title="Thanh toán" />

      {shownCartIssue && (
        <Box
          role="alert"
          data-testid="checkout-cart-issue"
          p={3}
          mx={3}
          mt={2}
          style={{
            background: 'var(--color-status-warning-bg)',
            borderRadius: 'var(--radius-card)',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <AlertCircle size={18} color="var(--color-text-warning)" aria-hidden style={{ flex: '0 0 auto', marginTop: 2 }} />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="small" style={{ color: 'var(--color-text-primary)' }}>
              {shownCartIssue}
            </Text>
            <Box mt={2}>
              <Button variant="secondary" onPress={() => navigate('/cart')}>
                {vi.checkout.backToCart}
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      <div
        ref={addressRef}
        data-testid="checkout-address-block"
        role="group"
        aria-label={vi.checkout.address}
        tabIndex={-1}
        aria-describedby={placeAttempted && !addressId ? 'checkout-address-error' : undefined}
        style={{ outline: 'none' }}
      >
        <AddressSection
          addresses={addresses.data ?? []}
          selectedId={addressId}
          onSelect={chosen(setAddressId)}
          quoteOutdated={addressOutdated && !quote.isFetching}
        />
      </div>
      {placeAttempted && !addressId && (
        <Box id="checkout-address-error" role="alert" px={4} pt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <DsText variant="caption" tone="danger" as="div">
            <span aria-hidden="true">⚠ </span>
            {fillCopy('checkout.addressNeeded')}
          </DsText>
        </Box>
      )}

      {/* ── Sản phẩm sẽ mua ── (liệt kê món; nếu checkout TẬP CON thì chỉ hiện món đã chọn) */}
      {(() => {
        const shownItems = itemIds
          ? (cart.data?.items ?? []).filter((it) => itemIds.includes(it.id))
          : (cart.data?.items ?? []);
        const shownCount = shownItems.reduce((s, it) => s + it.quantity, 0);
        return shownItems.length > 0 ? (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Text bold size="small" style={{ marginBottom: 10 }}>
            Sản phẩm ({shownCount})
          </Text>
          {splitNote && (
            <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', marginBottom: 10 }}>
              {splitNote}
            </Text>
          )}
          {(split
            ? shipments.map((sh) => ({ key: sh.key, shipment: sh, items: shownItems.filter((it) => sh.itemIds.includes(it.id)) }))
            : [{ key: 'all', shipment: null, items: shownItems }]
          ).map((grp) => (
          <section
            key={grp.key}
            aria-label={grp.shipment ? fulfillerLabel(grp.shipment.fulfiller) : 'Sản phẩm trong đơn'}
            style={{ marginBottom: grp.shipment ? 12 : 0 }}
          >
          {grp.shipment && (
            <Text bold size="small" style={{ marginBottom: 8 }}>
              {fulfillerLabel(grp.shipment.fulfiller)}
            </Text>
          )}
          <Box flex flexDirection="column" style={{ gap: 12 }}>
            {grp.items.map((it) => (
              <Box key={it.id} flex alignItems="center" style={{ gap: 10 }}>
                <ProductThumb src={it.thumbnail} alt={it.productName} size={48} />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{it.productName}</Text>
                  {it.variationName && (
                    <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                      {typeof it.variationName === 'object' && it.variationName !== null
                        ? (it.variationName as { name?: string }).name ?? ''
                        : String(it.variationName)}
                    </Text>
                  )}
                  <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatVnd(it.unitPrice)} × {it.quantity}
                  </Text>
                  {lineProblems[it.id] && (
                    <Box data-testid="checkout-line-problem" role="alert" mt={1} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <DsText variant="caption" tone="danger">{lineProblems[it.id]!.text}</DsText>
                      <Button
                        variant="secondary"
                        loading={lineFix.isPending && lineFix.variables?.id === it.id}
                        onPress={() => {
                          const fix = lineProblems[it.id]!.fix;
                          if (fix.kind === 'cart') navigate('/cart');
                          else lineFix.mutate({ id: it.id, fix });
                        }}
                      >
                        {lineProblems[it.id]!.fixLabel}
                      </Button>
                    </Box>
                  )}
                </Box>
                <Text size="small" bold style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatVnd(it.total)}</Text>
              </Box>
            ))}
          </Box>
          {grp.shipment && (
            <KeyValueRow
              label="Phí giao"
              value={grp.shipment.shippingFee === 0 ? vi.common.freeShip : formatVnd(grp.shipment.shippingFee)}
              tone={grp.shipment.shippingFee === 0 ? 'success' : 'primary'}
            />
          )}
          </section>
          ))}
        </Box>
        ) : null;
      })()}

      {/* ── Mã giảm giá ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <Box
          className="tubu-press"
          role="button"
          data-testid="coupon-row"
          {...rowKeyboardProps()}
          onClick={() => {
            haptic('light');
            setVoucherSheetOpen(true);
          }}
          flex
          alignItems="center"
          justifyContent="space-between"
          style={{ cursor: 'pointer', minHeight: 44, gap: 8 }}
        >
          <Box flex alignItems="center" style={{ gap: 'var(--space-inline-sm)', minWidth: 0, flex: 1 }}>
            <Box
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-control)',
                background: 'var(--color-promo-bg)',
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 auto',
              }}
            >
              <Ticket size={20} color="var(--color-promo-fg)" />
            </Box>
            <Box style={{ minWidth: 0 }}>
              <Text bold size="small" data-testid="coupon-label" style={{ color: 'var(--color-text-primary)' }}>
                Mã giảm giá
              </Text>
              {cart.data?.couponCode ? (
                <Box flex alignItems="center" style={{ flexWrap: 'wrap', columnGap: 'var(--space-inline-sm)', rowGap: 'var(--space-inline-xs)', marginTop: 2, minWidth: 0 }}>
                  <span
                    data-testid="coupon-code"
                    style={{
                      background: 'var(--color-promo-bg)',
                      border: '1px dashed var(--color-promo-solid-bg)',
                      borderRadius: 'var(--radius-control)',
                      padding: '2px 6px',
                      color: 'var(--color-promo-fg)',
                      fontSize: 'var(--type-label-size)',
                      fontWeight: 700,
                      minWidth: 0,
                      maxWidth: '100%',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {cart.data.couponCode}
                  </span>
                  {quote.data && quote.data.discount > 0 && (
                    <Text size="xSmall" data-testid="coupon-discount" style={{ color: 'var(--color-text-success)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      -{formatVnd(quote.data.discount)}
                    </Text>
                  )}
                </Box>
              ) : autoCoupon.hint ? (
                <Text size="xSmall" data-testid="coupon-hint" style={{ color: 'var(--color-text-brand)', marginTop: 2 }}>
                  {couponHintText(autoCoupon.hint, formatVnd)}
                </Text>
              ) : (
                <Text size="xSmall" data-testid="coupon-placeholder" style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {fillCopy('coupon.rowInvite')}
                </Text>
              )}
            </Box>
          </Box>

          <Box flex alignItems="center" style={{ gap: 'var(--space-inline-xs)', flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--color-text-brand)' }}>
            <Text size="xSmall" bold data-testid="coupon-cta" style={{ color: 'var(--color-text-brand)' }}>
              {cart.data?.couponCode ? 'Thay đổi' : 'Chọn mã'}
            </Text>
            <ChevronRight size={16} color="var(--color-text-brand)" />
          </Box>
        </Box>
        {autoCoupon.autoCode && (
          <Box flex alignItems="center" justifyContent="space-between" style={{ marginTop: 4, paddingLeft: 46 }}>
            <Text size="xSmall" data-testid="coupon-auto-label" style={{ color: 'var(--color-text-success)' }}>
              {couponAutoCopy.applied}
            </Text>
            <button
              type="button"
              data-testid="coupon-auto-remove"
              aria-label={couponAutoCopy.removeAria(autoCoupon.autoCode)}
              disabled={autoCoupon.removing || orderBusy}
              onClick={() => {
                haptic('light');
                autoCoupon.remove();
              }}
              style={{
                minHeight: 44,
                minWidth: 44,
                padding: '0 8px',
                background: 'none',
                border: 0,
                color: 'var(--color-text-brand)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {couponAutoCopy.remove}
            </button>
          </Box>
        )}
        {couponLine && (
          <Text
            size="xSmall"
            role="status"
            data-testid="coupon-notice"
            style={{ color: 'var(--color-text-warning)', marginTop: 6 }}
          >
            {couponLine}
          </Text>
        )}
        <CouponRemovedNotice notice={removedCoupon.notice} onDismiss={removedCoupon.dismiss} />
      </Box>

      {/* Chỉ coi là mã gắn sẵn khi đúng là mã CTV: slug gian hàng nhãn/cửa hàng không phải mã giới thiệu và không được gửi kèm đơn. */}
      <ReferralCodeBox
        linkedCode={linkedReferral}
        appliedCode={referralApplied}
        onApplied={chosen(setReferralApplied)}
        disabled={orderBusy}
      />

      {/* ── Thanh toán ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.checkout.payment}
        </Text>
        {zeroNote && (
          <Text size="small" style={{ color: 'var(--color-text-secondary)', minHeight: 44, display: 'block' }}>
            {zeroNote}
          </Text>
        )}
        {!zeroNote && paymentMethods.map((m) => (
          <Box
            key={m.value}
            role="radio"
            {...rowKeyboardProps()}
            aria-checked={payment === m.value}
            aria-disabled={m.disabled}
            aria-describedby={m.hint ? `pay-hint-${m.value}` : undefined}
            className={m.disabled ? undefined : 'tubu-press'}
            onClick={() => {
              if (m.disabled) return;
              haptic('light');
              // Chạm lại đúng cách đang chọn không phải là đổi lựa chọn: không được mở băng của lần đặt chưa rõ kết quả.
              if (m.value !== payment) chosen(setPayment)(m.value);
            }}
            flex
            alignItems="center"
            style={{ gap: 10, padding: '12px 0', minHeight: 44, boxSizing: 'border-box' }}
          >
            {/* Radio (Task 19) là thị giác thuần tuý ở đây — logic chọn phương thức thanh toán
                VẪN nằm nguyên trong onClick của Box cha ở trên (không đổi). onChange rỗng chỉ để
                thoả điều kiện "controlled input cần onChange" của React; input thật của Radio nằm
                ĐÈ lên đúng vùng chấm tròn (zaui checkbox/radio input position:absolute che kín ô
                24x24) nên 1 chạm tại đó chỉ phát sinh đúng 1 sự kiện click nổi bọt lên Box cha —
                không có nguy cơ gọi setPayment 2 lần. */}
            <Box style={{ opacity: m.disabled ? 0.45 : 1 }}>
              <Radio checked={payment === m.value} disabled={m.disabled} onChange={() => {}} />
            </Box>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="small" style={{ opacity: m.disabled ? 0.45 : 1 }}>
                {m.label}
              </Text>
              {/* Lý do KHÔNG mờ theo dòng: chữ giải thích mà mờ thì khách vẫn không đọc được. */}
              {m.hint && (
                <Text id={`pay-hint-${m.value}`} size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                  {m.hint}
                </Text>
              )}
            </Box>
          </Box>
        ))}
        {paymentNote && (
          <Text role="status" size="small" style={{ color: 'var(--color-text-warning)', marginTop: 4 }}>
            {paymentNote}
          </Text>
        )}
      </Box>

      {/* ── Điểm Xanh ── */}
      {user && (
        <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Box
            role="checkbox"
            {...rowKeyboardProps()}
            aria-checked={usePoints && pointsUsable}
            aria-disabled={!pointsUsable}
            className={pointsUsable ? 'tubu-press' : undefined}
            onClick={() => {
              if (!pointsUsable) return;
              haptic('light');
              bumpChoice();
              setUsePoints((v) => !v);
            }}
            flex
            alignItems="center"
            justifyContent="space-between"
            style={{ minHeight: 44 }}
          >
            <Box>
              <Text bold size="small">
                {vi.checkout.points}
              </Text>
              <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                {pointsUsable
                  ? pointsOfferText(points.usable, quote.data, usePoints && quote.data ? quote.data : null, publicConfig.loyalty?.vndPerPointRedeem)
                  : partnerPoints.disabled && points.usable > 0
                    ? lockedPointsLabel(points.balance)
                    : (points.label ?? fillCopy('checkout.pointsNone'))}
              </Text>
              {points.usable > 0 && partnerPoints.capNote && (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {partnerPoints.capNote}
                </Text>
              )}
              {points.usable > 0 && partnerPoints.partnerNote && (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {partnerPoints.partnerNote}
                </Text>
              )}
              {points.convertedNote && (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {partnerPoints.capNote || partnerPoints.partnerNote ? convertedPointsNote(points.converted) : points.convertedNote}
                </Text>
              )}
              {points.lockNote && (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {points.lockNote}
                </Text>
              )}
            </Box>
            {/* Checkbox (Task 19) thị giác thuần tuý — cùng lý do như Radio ở trên: logic bật/tắt
                dùng điểm vẫn nằm nguyên trong onClick của Box cha, onChange rỗng chỉ để thoả React. */}
            <Checkbox checked={usePoints && pointsUsable} disabled={!pointsUsable} onChange={() => {}} />
          </Box>
        </Box>
      )}

      {/* ── Ghi chú ── */}
      <Box p={4} mt={2} data-ds="checkout-note" style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.checkout.note}
        </Text>
        <Input aria-label={vi.checkout.note} placeholder={vi.checkout.notePlaceholder} maxLength={500} value={note} onChange={(e) => {
          bumpChoice();
          setNote(e.target.value);
        }} />
      </Box>

      {/* ── Thu kèm rác: gắn yêu cầu PICKUP đang mở vào đơn này (spec §12.2 bước 2) ── */}
      {pickupReq !== undefined && (
        <Box id="checkout-waste-pickup" p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          {pickupReq === null ? (
            <ListRow
              icon={<Icon icon={Recycle} tone="brand" />}
              title="Thu kèm rác"
              subtitle="Tạo yêu cầu để bưu tá lấy rác khi giao đơn này"
              trailing="chevron"
              onPress={() => navigate('/recycle/new')}
            />
          ) : (
            <>
              <Box
                role="checkbox"
                {...rowKeyboardProps()}
                aria-label="Thu kèm rác"
                aria-checked={attachWaste}
                className="tubu-press"
                onClick={() => {
                  haptic('light');
                  bumpChoice();
                  setAttachWaste((v) => !v);
                }}
                flex
                alignItems="center"
                justifyContent="space-between"
                style={{ minHeight: 44, cursor: 'pointer' }}
              >
                <Box flex alignItems="center" style={{ gap: 10 }}>
                  <Icon icon={Recycle} tone="brand" />
                  <Text bold size="small" style={{ color: 'var(--color-text-primary)' }}>
                    Thu kèm rác
                  </Text>
                </Box>
                {/* Checkbox thị giác thuần tuý — logic bật/tắt vẫn ở onClick của Box cha. */}
                <Checkbox checked={attachWaste} onChange={() => {}} />
              </Box>
              <Box
                p={3}
                mt={2}
                style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)' }}
              >
                <Text bold size="small">
                  {pickupReq.code}
                </Text>
                {pickupReq.lines.map((l) => (
                  <Text key={`${l.itemName}-${l.unitLabel}`} size="xSmall" style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {formatLineQty(l.itemName, l.declaredQty, l.unitLabel)}
                  </Text>
                ))}
                <Text size="xSmall" style={{ color: 'var(--color-text-success)', fontWeight: 600, marginTop: 4 }}>
                  {`Ước tính ${formatPoints(pickupReq.estimatedPoints)}`}
                </Text>
                {attachWaste && (
                  <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', lineHeight: '18px', marginTop: 4 }}>
                    Ghi mã lên túi, bưu tá lấy khi giao đơn.
                  </Text>
                )}
                {attachWaste && paymentToSend === 'BANK_TRANSFER' && (
                  <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', lineHeight: '18px', marginTop: 4 }}>
                    Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.
                  </Text>
                )}
              </Box>
            </>
          )}
        </Box>
      )}

      {/* ── Hoá đơn VAT (spec §6.3) ── */}
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <Box
          role="checkbox"
          {...rowKeyboardProps()}
          aria-checked={wantInvoice}
          className="tubu-press"
          onClick={() => {
            haptic('light');
            bumpChoice();
            if (!wantInvoice) {
              setInvoiceAttempted(false);
              setInvoiceTouched({});
            }
            setWantInvoice((v) => !v);
          }}
          flex
          alignItems="center"
          justifyContent="space-between"
          style={{ minHeight: 44 }}
        >
          <Text bold size="small">
            Yêu cầu xuất hoá đơn VAT
          </Text>
          {/* Checkbox thị giác thuần tuý — logic bật/tắt yêu cầu hoá đơn vẫn ở onClick của Box cha. */}
          <Checkbox checked={wantInvoice} onChange={() => {}} />
        </Box>
        {wantInvoice && (
          <div ref={invoiceRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            <Field label="Mã số thuế" error={invoiceError('taxCode')}>
              <Input
                maxLength={INPUT_LIMITS.invoiceTaxCode}
                value={invoice.taxCode}
                status={invoiceError('taxCode') ? 'error' : undefined}
                onBlur={touchInvoice('taxCode')}
                onChange={(e) => {
                  bumpChoice();
                  setInvoice((f) => ({ ...f, taxCode: e.target.value }));
                }}
              />
            </Field>
            <Field label="Tên công ty" error={invoiceError('companyName')}>
              <Input
                maxLength={INPUT_LIMITS.invoiceCompanyName}
                value={invoice.companyName}
                status={invoiceError('companyName') ? 'error' : undefined}
                onBlur={touchInvoice('companyName')}
                onChange={(e) => {
                  bumpChoice();
                  setInvoice((f) => ({ ...f, companyName: e.target.value }));
                }}
              />
            </Field>
            <Field label="Địa chỉ xuất hoá đơn" error={invoiceError('address')}>
              <Input
                maxLength={INPUT_LIMITS.invoiceAddress}
                value={invoice.address}
                status={invoiceError('address') ? 'error' : undefined}
                onBlur={touchInvoice('address')}
                onChange={(e) => {
                  bumpChoice();
                  setInvoice((f) => ({ ...f, address: e.target.value }));
                }}
              />
            </Field>
            <Field label="Email nhận hoá đơn" error={invoiceError('email')}>
              <Input
                maxLength={INPUT_LIMITS.invoiceEmail}
                inputMode="email"
                value={invoice.email}
                status={invoiceError('email') ? 'error' : undefined}
                onBlur={touchInvoice('email')}
                onChange={(e) => {
                  bumpChoice();
                  setInvoice((f) => ({ ...f, email: e.target.value }));
                }}
              />
            </Field>
          </div>
        )}
      </Box>

      {/* ── Tóm tắt ── */}
      <Box
        p={4}
        mt={2}
        className="tubu-press"
        // Lỗi báo giá có nút Thử lại nằm trong thẻ: lúc đó thẻ không là nút nữa (nút lồng nút) nhưng chạm vẫn mở như trước.
        role={quote.isError ? undefined : 'button'}
        {...(quote.isError ? null : rowKeyboardProps())}
        onClick={() => {
          haptic('light');
          setSummarySheetOpen(true);
        }}
        style={{ background: 'var(--color-bg-surface)', cursor: 'pointer' }}
      >
        <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 10 }}>
          <Text bold size="small" style={{ color: 'var(--color-text-primary)' }}>
            {vi.checkout.summary}
          </Text>
          <Box flex alignItems="center" style={{ gap: 4, color: 'var(--color-text-brand)' }}>
            <Text size="xSmall" bold style={{ color: 'var(--color-text-brand)' }}>
              Chi tiết
            </Text>
            <ChevronRight size={16} color="var(--color-text-brand)" />
          </Box>
        </Box>

        {quote.isLoading ? (
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton height={14} />
            <Skeleton height={14} width="80%" />
            <Skeleton height={18} width="60%" />
          </Box>
        ) : quote.isError ? (
          <Box flex alignItems="center" justifyContent="space-between">
            <Box flex alignItems="center" style={{ gap: 4 }}>
              <AlertCircle size={13} color="var(--color-text-danger)" aria-hidden />
              <Text size="xSmall" style={{ color: 'var(--color-text-danger)' }}>
                {getLoadErrorMessage(quote.error)}
              </Text>
            </Box>
            <Text
              role="button"
              {...rowKeyboardProps()}
              size="xSmall"
              bold
              className="tubu-hit-44"
              aria-busy={quote.isFetching || undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (quoteRetrying.current) return;
                quoteRetrying.current = true;
                const release = () => {
                  quoteRetrying.current = false;
                };
                void quote.refetch().then(release, release);
              }}
              style={{ color: 'var(--color-text-brand)', padding: 8, display: 'inline-block', opacity: quote.isFetching ? 0.6 : 1 }}
            >
              {vi.common.retry}
            </Text>
          </Box>
        ) : quote.data ? (
          <>
            <KeyValueRow dataDs="checkout-summary-row" label={vi.cart.subtotal} value={formatVnd(quote.data.subtotal)} />
            {quote.data.discount > 0 && (
              <KeyValueRow label={vi.cart.discount} value={`-${formatVnd(quote.data.discount)}`} tone="success" />
            )}
            {quote.data.comboDiscount > 0 && (
              <KeyValueRow label="Ưu đãi combo" value={`-${formatVnd(quote.data.comboDiscount)}`} tone="success" />
            )}
            {(quote.data.tierDiscount ?? 0) > 0 && (
              <KeyValueRow label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote.data.tierDiscount ?? 0)}`} tone="success" />
            )}
            {quote.data.pointsDiscount > 0 && (
              <KeyValueRow label={vi.checkout.points} value={`-${formatVnd(quote.data.pointsDiscount)}`} tone="success" />
            )}
            <KeyValueRow
              label={vi.checkout.shippingFee}
              value={quote.data.shippingFee === 0 ? vi.common.freeShip : formatVnd(quote.data.shippingFee)}
              tone={quote.data.shippingFee === 0 ? 'success' : 'primary'}
            />
            {etaLabel && <KeyValueRow label={vi.success.etaLabel} value={etaLabel} />}
            <KeyValueRow dataDs="checkout-summary-total" label={vi.checkout.total} value={formatVnd(quote.data.total)} emphasis />
            {quote.data.pointsEarned > 0 && (
              <Box flex alignItems="center" style={{ gap: 4, marginTop: 4 }}>
                <Sprout size={13} color="var(--color-text-success)" aria-hidden />
                <Text size="xSmall" style={{ color: 'var(--color-text-success)' }}>
                  {pointsEarnLabel(quote.data.pointsEarned)}
                </Text>
              </Box>
            )}
          </>
        ) : (
          /* Fallback preview summary when addressId is missing/unselected */
          <>
            <KeyValueRow dataDs="checkout-summary-row" label={vi.cart.subtotal} value={formatVnd(previewSubtotal)} />
            {previewCombo > 0 && (
              <KeyValueRow label="Giảm giá combo" value={`-${formatVnd(previewCombo)}`} tone="success" />
            )}
            {previewDiscount > 0 && (
              <KeyValueRow label={vi.cart.discount} value={`-${formatVnd(previewDiscount)}`} tone="success" />
            )}
            {previewTier > 0 && (
              <KeyValueRow label="Ưu đãi hạng thành viên" value={`-${formatVnd(previewTier)}`} tone="success" />
            )}
            {previewRecalcNote && (
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                {vi.cart.subsetRecalcNote}
              </Text>
            )}
            <KeyValueRow
              label={vi.checkout.shippingFee}
              value={addressId ? fillCopy('checkout.calculating') : fillCopy('checkout.shipNeedsAddress')}
            />
            <KeyValueRow dataDs="checkout-summary-total" label={vi.checkout.total} value={checkoutTotalText({ total: null, hasAddress: !!addressId }, formatVnd)} emphasis />
          </>
        )}
      </Box>

      {placeNotice && (
        <Box p={4} data-testid="place-notice" role="alert" style={{ background: 'var(--color-bg-surface)' }}>
          {placeNotice === 'unknown' && retryingPlace ? (
            <Text size="small">
              Đơn có thể đã được ghi nhận. Bấm Thử lại để gửi lại đúng đơn này — hệ thống nhận ra yêu cầu trùng nên không tạo thêm đơn. Hoặc xem Đơn của tôi.
            </Text>
          ) : placeNotice === 'unknown' ? (
            <Text size="small">{PREVIOUS_MAYBE_PLACED}</Text>
          ) : (
            <Text size="small">
              Nếu đơn trước chưa có trong Đơn của tôi, bấm Đặt hàng lần nữa để đặt đơn mới với lựa chọn hiện tại.
            </Text>
          )}
          <Button size="md" variant="secondary" style={{ marginTop: 8 }} onPress={() => navigate('/orders')}>
            Đơn của tôi
          </Button>
        </Box>
      )}

      <Text size="xSmall" data-testid="order-consent" style={{ display: 'block', padding: '12px 16px 0', color: 'var(--color-text-secondary)' }}>
        Bằng việc đặt hàng, bạn đồng ý với <ConsentLink onPress={() => setPolicy('dieu-khoan')}>Điều khoản</ConsentLink> và{' '}
        <ConsentLink onPress={() => setPolicy('doi-tra')}>Chính sách đổi trả</ConsentLink>.
      </Text>

      <PolicySheet slug={policy} onClose={() => setPolicy(null)} />

      {/* ── Sticky CTA ── */}
      <StickyActionBar
        summary={
          // Vùng báo luôn có mặt, chỉ đổi chữ: vùng gắn vào cùng lúc với chữ thì đọc màn hình (VoiceOver trong Zalo) thường không đọc.
          // Lúc rỗng đặt absolute để không chiếm khoảng cách (gap) của thanh.
          <div role="status" style={placeBarNote ? undefined : { position: 'absolute' }}>
            {placeBarNote && (
              <DsText variant="caption" tone={placeHint ? 'secondary' : 'danger'}>
                {placeBarNote}
              </DsText>
            )}
          </div>
        }
        primary={
          <Button
            fullWidth
            loading={orderBusy}
            disabled={placeLocked}
            onPress={async () => {
              if (submitting) return;
              if (formBlocked) {
                setPlaceAttempted(true);
                setInvoiceAttempted(true);
                setFocusTick((n) => n + 1);
                return;
              }
              setSubmitting(true);
              try {
                // Xin SĐT đúng lúc đặt hàng (như Homefarm) nếu tài khoản chưa có — không chặn nếu user từ chối.
                await useAuthStore.getState().ensurePhone().catch(() => undefined);
                order.mutate();
              } catch {
                setSubmitting(false);
              }
            }}
          >
            {order.isPending
              ? vi.checkout.placing
              : quote.data
                ? retryingPlace
                  ? fillCopy('checkout.retryWith', { price: formatVnd(quote.data.total) })
                  : vi.checkout.placeOrderWith(formatVnd(quote.data.total))
                : vi.checkout.placeOrder}
          </Button>
        }
      />

      <BottomSheet
        open={priceChanged}
        onClose={() => {
          setPriceChanged(false);
          void queryClient.invalidateQueries({ queryKey: ['cart'] });
          void queryClient.invalidateQueries({ queryKey: ['quote'] });
        }}
        title={vi.flashSale.priceChangedTitle}
        description={fillCopy('checkout.priceChangedBody')}
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button
              fullWidth
              onPress={() => {
                setPriceChanged(false);
                setPriceAcceptedAt(Date.now());
                void queryClient.invalidateQueries({ queryKey: ['cart'] });
                void queryClient.invalidateQueries({ queryKey: ['quote'] });
              }}
            >
              {priceChangedActions().accept}
            </Button>
            <Button
              fullWidth
              variant="secondary"
              onPress={() => {
                setPriceChanged(false);
                void queryClient.invalidateQueries({ queryKey: ['cart'] });
                void queryClient.invalidateQueries({ queryKey: ['quote'] });
                navigate('/cart');
              }}
            >
              {priceChangedActions().viewCart}
            </Button>
          </div>
        }
      >
        {null}
      </BottomSheet>

      <BottomSheet
        open={totalChanged !== null}
        onClose={() => setTotalChanged(null)}
        title={vi.checkout.totalChangedTitle}
        description={totalChanged ?? undefined}
        footer={
          <Button fullWidth onPress={() => setTotalChanged(null)}>
            {vi.checkout.totalChangedCta}
          </Button>
        }
      >
        {null}
      </BottomSheet>

      <VoucherSheet
        visible={voucherSheetOpen}
        onClose={() => setVoucherSheetOpen(false)}
        currentCode={cart.data?.couponCode}
        subtotal={quote.data?.subtotal ?? cart.data?.subtotal ?? 0}
        shippingFee={quote.data?.shippingFee}
        productIds={cartProductIds(checkoutItems)}
        previewParams={checkoutItems.length > 0 ? { ...(addressId ? { addressId } : {}), storefrontSlug: ctvSlug, itemIds } : undefined}
        previewKey={cartPreviewKey(checkoutItems)}
        busy={autoCoupon.busy || orderBusy}
        onCouponApplied={() => {
          bumpChoice();
          void cart.refetch();
          void quote.refetch();
        }}
      />

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
        <Box p={3} style={{ background: 'var(--color-bg-canvas)', borderRadius: 'var(--radius-card)' }}>
          <KeyValueRow label="Tạm tính tiền hàng" value={formatVnd(quote.data?.subtotal ?? previewSubtotal)} />

          {(quote.data?.discount ?? previewDiscount) > 0 && (
            <KeyValueRow label="Mã giảm giá" value={`-${formatVnd(quote.data?.discount ?? previewDiscount)}`} tone="success" />
          )}

          {(quote.data ? quote.data.comboDiscount : previewCombo) > 0 && (
            <KeyValueRow label="Giảm giá combo" value={`-${formatVnd(quote.data ? quote.data.comboDiscount : previewCombo)}`} tone="success" />
          )}

          {(quote.data ? (quote.data.tierDiscount ?? 0) : previewTier) > 0 && (
            <KeyValueRow label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote.data ? (quote.data.tierDiscount ?? 0) : previewTier)}`} tone="success" />
          )}

          {quote.data && quote.data.pointsDiscount > 0 && (
            <KeyValueRow label="Giảm giá Điểm Xanh" value={`-${formatVnd(quote.data.pointsDiscount)}`} tone="success" />
          )}

          <KeyValueRow
            label="Phí vận chuyển"
            value={
              quote.data
                ? quote.data.shippingFee === 0
                  ? vi.common.freeShip
                  : formatVnd(quote.data.shippingFee)
                : addressId
                  ? fillCopy('checkout.calculating')
                  : fillCopy('checkout.shipNeedsAddress')
            }
            tone={quote.data?.shippingFee === 0 ? 'success' : 'primary'}
          />

          <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '8px 0' }} />

          <KeyValueRow
            label="Tổng thanh toán"
            value={checkoutTotalText({ total: quote.data?.total ?? null, hasAddress: !!addressId }, formatVnd)}
            emphasis
          />

          {(quote.data?.pointsEarned ?? 0) > 0 && (
            <Box flex alignItems="center" justifyContent="flex-end" style={{ gap: 4, marginTop: 6 }}>
              <Sprout size={13} color="var(--color-text-success)" aria-hidden />
              <Text size="xSmall" style={{ color: 'var(--color-text-success)' }}>
                {pointsEarnLabel(quote.data!.pointsEarned)}
              </Text>
            </Box>
          )}
        </Box>
      </BottomSheet>
    </Page>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Thanh toán" />
      {children}
    </Page>
  );
}

function CheckoutSkeleton() {
  return (
    <Shell>
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width={120} height={14} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </Box>
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width={150} height={14} />
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </Box>
    </Shell>
  );
}

/** Liên kết nằm giữa câu: chữ có gạch chân, giữ nguyên dòng chữ xung quanh (vùng chạm là cả dòng cao 16px + khoảng đệm của thanh). */
function ConsentLink({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="tubu-hit-44"
      onClick={onPress}
      style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--color-text-brand)', textDecoration: 'underline', cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}
