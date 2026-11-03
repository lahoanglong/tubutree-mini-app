'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Plus, Recycle, ShoppingBag, Sprout } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { getWasteMe, WASTE_QUERY_KEYS } from '@tubutree/app-core/api/waste';
import { useAuth } from '@/lib/auth-context';
import { rememberActiveOrder } from '@tubutree/app-core/home-todo-rows';
import { browserStorage } from '@/lib/recently-viewed';
import { syncHomeHintCookie } from '@/components/home/use-home-customer-kind';
import { useAuthPhase } from '@/lib/auth-phase';
import { AddressForm } from '@/components/address-form';
import { OrderConsent } from '@/components/order-consent';
import { addressToForm, isLegacyGeo } from '@/lib/address-form';
import {
  getCart,
  getAddresses,
  createAddress,
  updateAddress,
  checkoutQuote,
  placeOrder,
  getMe,
  getPublicConfig,
  formatVnd,
  type AddressDTO,
  type CartLine,
  type OrderDTO,
} from '@/lib/shop-client';
import { ctvSlugFor, getStorefrontContext, subscribeStorefrontContext } from '@/lib/storefront-context';
import { pointsOfferText } from '@tubutree/app-core/points-offer';
import { checkoutPlaceHint, checkoutTotalText, collapseCheckoutLines } from '@tubutree/app-core/commerce/checkout-display';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { checkoutEtaLabel, placedOrderKinds } from '@tubutree/app-core/shipping-eta';
import { checkoutPointsOffer, convertedPointsLine, formatCount, idlePointsLabel, lockedPointsLabel, pointsCapState, zeroTotalNote, type CheckoutPointsOffer } from '@/lib/checkout-points';
import {
  ORDER_NOTE_MAX,
  effectiveReferralCode,
  cartFixableNotice,
  isInvoiceValid,
  outOfStockLine,
  overStockMessage,
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
import { CouponBox, COUPON_MUTATION_KEY, forgetAutoCoupon, couponPreviewKey } from '@/components/coupon-box';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ReferralCodeBox } from '@/components/referral-code-box';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { OrderSuccess } from '@/components/checkout/order-success';
import { CheckoutSkeleton } from './checkout-skeleton';
import { InvoiceSection } from './invoice-section';
import { ErrorState } from '@/components/ui/error-state';
import { EMPTY_INVOICE, loadSavedInvoice, saveInvoice } from '@/lib/saved-invoice';
import { fulfillerLabel, shipmentsNote } from '@/lib/shipments';
import { useCartKey } from '@/lib/cart-key';
import { createOrderKeyRing } from '@/lib/order-key-ring';
import { isWebRouteReady } from '@/lib/route-map';
import { attachablePickup, isOutcomeUnknown } from '@/lib/checkout-waste';
import { coreHttp } from '@/lib/core-http';
import BackLink from '@/components/back-link';
import { CheckMark, miniCheckboxWrap, miniCheckbox, miniRadio, mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { ProductThumb } from '@/components/mini';
import { PAGE_WIDE } from '@/lib/page-frame';
import { clearSubmitted } from '@/lib/recycle-wizard';

// Máy chủ trả nguyên mã này (không phải câu cho khách) khi hết suất/hết giờ vàng giữa lúc thanh toán.
const PRICE_CHANGED = 'PRICE_CHANGED';

const OPTION_BASE = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border p-3 text-sm';
const optionClass = (selected: boolean) =>
  `${OPTION_BASE} ${selected ? 'border-[var(--color-border-selected)] bg-[var(--color-bg-subtle)]' : 'border-[var(--color-border-strong)] bg-[var(--color-bg-surface)]'}`;
// Mini App: dòng phương thức thanh toán không viền/nền, cách nhau bằng khoảng đệm (checkout.tsx: padding 12px 0).
const payOptionClass = (selected: boolean) =>
  `${optionClass(selected)} max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-3`;
// Mini App: thẻ địa chỉ viền 1,5px; đang chọn viền xanh và nền sage nhạt.
const addressOptionClass = (selected: boolean) =>
  `${optionClass(selected)} max-md:border-[1.5px] ${
    selected
      ? 'max-md:border-[var(--color-border-selected)] max-md:bg-[var(--color-bg-subtle)]'
      : 'max-md:border-[var(--color-border-subtle)] max-md:bg-[var(--color-bg-surface)]'
  }`;
// Ô ghi chú: dưới md cao một dòng và bo 8px như Input của Mini, từ md nhiều dòng với bo của ô nhập thường.
const NOTE_FIELD = ui.field.replace('rounded-control', 'rounded-[0.5rem] md:rounded-control');
// Mỗi phần của trang thanh toán ở điện thoại là dải trắng phẳng tràn ngang cách nhau 8px (Box p=4 mt=2 của Mini App).
const MINI_BAND = `p-4 ${ui.card} ${mini.band} max-md:mt-2`;

type PlaceBody = Parameters<typeof placeOrder>[0];
const PREVIOUS_MAYBE_PLACED = 'Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại.';

export default function CheckoutPage() {
  const phase = useAuthPhase();
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [note, setNote] = useState('');
  const [wantInvoice, setWantInvoice] = useState(false);
  const [invoice, setInvoice] = useState(EMPTY_INVOICE);
  // Mã giới thiệu khách tự nhập ở đây (đã được server xác nhận) khác mã đến từ link gian hàng (sfCtx).
  const [referralApplied, setReferralApplied] = useState<string | null>(null);
  const [attachWaste, setAttachWaste] = useState(false);
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
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
  const bootedRef = useRef(false);
  // Bản sao của cờ đóng băng trong state: giỏ nguyên vẹn nạp lại thành rỗng thì form (và nút Đặt hàng) biến mất, màn giỏ trống phải còn lối gửi lại.
  const [maybePlaced, setMaybePlaced] = useState(false);
  const chosen = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    choiceRev.current += 1;
    fn(...args);
  };

  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: phase === 'authenticated' });
  // Số dư Ví Tubu lấy từ máy chủ (không từ ảnh chụp lúc đăng nhập): khách vừa được hoàn tiền về ví hoặc vừa tiêu ví
  // ở Mini App sẽ thấy đúng số, thay vì chọn được rồi bị từ chối "số dư không đủ".
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: phase === 'authenticated' });
  const walletBalance = meQ.data?.walletBalance ?? user?.walletBalance ?? 0;
  // Chỉ hiện "Thu kèm rác" khi cờ pickup đã bật thật từ máy chủ; chưa tải xong thì ẩn, không hứa dịch vụ chưa chắc có.
  const configQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const pickupFlag = configQ.data?.waste?.pickup === true;
  const shippingEta = configQ.data?.shippingEta;
  const wasteMeQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.me,
    queryFn: () => getWasteMe(coreHttp),
    enabled: phase === 'authenticated' && pickupFlag,
  });
  const attachable = attachablePickup(wasteMeQ.data, pickupFlag);
  // Chưa có yêu cầu thu kèm thì dòng dẫn sang màn tạo yêu cầu; màn đó chưa có trên web thì ẩn dòng, không dẫn khách tới 404.
  const pickupReq = attachable === null && !isWebRouteReady('/doi-rac/tao') ? undefined : attachable;

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

  useEffect(() => {
    if (addrQ.data && addressId === null) {
      const def = addrQ.data.find((a) => a.isDefault) ?? addrQ.data[0];
      if (def) setAddressId(def.id);
    }
  }, [addrQ.data, addressId]);

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
  const quoteQ = useQuery({
    queryKey: ['quote', addressId, ctvSlug, usePoints, itemIdsKey],
    queryFn: () => checkoutQuote(addressId!, usePoints ? usablePoints : 0, ctvSlug, itemIds),
    // Chờ giỏ tải xong: địa chỉ có thể về trước, lúc đó chưa biết giỏ có trống không và báo giá giỏ trống bị 400.
    enabled: !!addressId && phase === 'authenticated' && cartLoaded && cartReady && !cartEmpty,
  });
  useEffect(() => {
    // Giữ lại số điểm dùng được của lần quote gần nhất — khi bật "dùng điểm", BE tự kẹp theo trần
    // loyalty.max_redeem_pct nên gửi toàn bộ số dùng được là an toàn.
    if (quoteQ.data && !usePoints) setPointsOffer(checkoutPointsOffer(quoteQ.data));
  }, [quoteQ.data, usePoints]);

  const quoteStale = couponChanging || quoteQ.isFetching;
  // Refetch lỗi vẫn giữ `data` của lần trước (React Query v5): không coi đó là báo giá hiện hành, nếu không
  // khách thấy số cũ trong khi server đã tính theo mã mới và nút Đặt hàng vẫn bật.
  const quote = quoteQ.isError ? undefined : quoteQ.data;
  // Giỏ có hàng của gian hàng đối tác: Điểm Xanh chỉ trả cho hàng Tubu (trần của đơn + câu giải thích; giỏ chỉ hàng đối tác thì tắt).
  const partnerPoints = pointsCapState(quote, usablePoints);
  const convertedLine = convertedPointsLine(pointsOffer, partnerPoints);
  useEffect(() => {
    if (partnerPoints.disabled && usePoints) setUsePoints(false);
  }, [partnerPoints.disabled, usePoints]);
  // Đơn 0đ: BE ép COD + xác nhận luôn (không thu tiền) nên ẩn lựa chọn phương thức và gửi COD cho khớp.
  const zeroNote = quote ? zeroTotalNote(quote) : null;
  const paymentToSend = zeroNote ? 'COD' : payment;
  const shipments = quote?.shipments ?? [];
  const split = shipments.length > 1 || shipments.some((s) => s.fulfiller.kind === 'MERCHANT');
  const splitNote = shipmentsNote(shipments);
  // Chưa có cấu hình (đang tải, lỗi, API cũ) thì không hứa ngày giao; giỏ chỉ có hàng gian hàng tự giao thì cũng không.
  const etaLabel = checkoutEtaLabel(shippingEta, shipments.map((s) => s.fulfiller.kind));
  // Cách thanh toán dùng được theo báo giá (máy chủ từ chối đặt đúng các cách nó khoá: hạn mức COD từng đơn, giỏ tách đơn D4)
  // và số dư Ví mới nhất. Lựa chọn không còn dùng được thì đổi sang cách khác dùng được, hết cách thì bỏ chọn để khoá nút đặt.
  const pickedPayment = quote ? pickPaymentMethod(payment, quote, walletBalance) : payment;
  useEffect(() => {
    if (pickedPayment !== payment) setPayment(pickedPayment);
  }, [pickedPayment, payment]);

  const invoiceValid = isInvoiceValid(wantInvoice, invoice);
  // Hết hàng/vượt tồn chỉ sửa được ở giỏ: chặn ngay ở đây (khách đi thẳng vào /thanh-toan hay lưu đường dẫn không phải
  // chờ tới lúc bấm đặt mới biết). Chỉ xét các dòng đang thanh toán.
  const overStock = outOfStockLine(checkoutItems);

  const attempt = useRef<{ body: PlaceBody; key: string; rev: number } | null>(null);
  const place = useMutation({
    mutationFn: () => {
      const body: PlaceBody = {
        addressId: addressId!,
        paymentMethod: paymentToSend,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(itemIds ? { itemIds } : {}),
        ...(attachWaste && pickupReq ? { wasteRequestId: pickupReq.id } : {}),
        ...(wantInvoice
          ? {
              invoiceRequest: {
                taxCode: invoice.taxCode.trim(),
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
      orderKeys.current.reset();
      unknownAttempt.current = null;
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
      if (attachWaste && pickupReq) void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.all });
      // Điểm Xanh đã tiêu/tích và tiền ví đã trừ: các số dư và sổ cái đang cache đều cũ.
      invalidateBalances(qc);
      // Chuyển khoản: sang trang VietQR để khách trả ngay (đối soát xong đơn tự xác nhận), như Mini App.
      if (isBank) setRedirectingCode(order.code);
      if (isBank) router.replace(bankPaymentHref(order.code));
    },
    onError: (e) => {
      // 401/408/429 bị chặn trước khi vào nghiệp vụ nên không nói gì về đơn của lần trước: giữ đóng băng.
      const rejectedBeforeService = e instanceof ApiError && [401, 408, 429].includes(e.status);
      if (isOutcomeUnknown(e)) unknownAttempt.current ??= attempt.current;
      else if (!rejectedBeforeService) unknownAttempt.current = null;
      setMaybePlaced(unknownAttempt.current !== null);
      // 4xx cho yêu cầu thu rác đã đóng/bị khoá: tải lại để công tắc biến mất. Lỗi mạng/quá thời gian/5xx có thể đến sau khi máy
      // chủ đã tạo đơn, nên không tải lại: bấm lại phải gửi cùng body, cùng khoá.
      if (attachWaste && !isOutcomeUnknown(e)) void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.me });
      if (e instanceof ApiError && e.code === 'CART_CHANGED') {
        // Giỏ vừa đổi ở nơi khác (hoặc lần bấm trước đã đặt xong): dựng lại giỏ, báo giá và danh sách đơn.
        void qc.invalidateQueries({ queryKey: ['cart'] });
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['quote'] });
      } else if (e instanceof Error && e.message === PRICE_CHANGED) {
        void qc.invalidateQueries({ queryKey: ['cart'] });
        void qc.invalidateQueries({ queryKey: ['quote'] });
      } else if (e instanceof ApiError && e.code === 'TOTAL_CHANGED') {
        void qc.invalidateQueries({ queryKey: ['quote'] });
        void qc.invalidateQueries({ queryKey: ['cart'] });
      } else if (e instanceof ApiError && e.code === 'PAYMENT_METHOD_NOT_ALLOWED') {
        // Báo giá đang cache còn cho cách vừa bị từ chối (vd nơi giao đổi sau lúc báo giá): tải lại để khoá đúng cách đó và tự
        // chọn cách khác, không thì bấm lại bao nhiêu lần cũng nhận cùng lỗi. Nơi giao đổi thường vì giỏ đổi ở tab khác: kiện của
        // báo giá mới lấy món từ giỏ đang cache, nên tải lại cả giỏ, không thì kiện mới hiện ra không có món nào.
        void qc.invalidateQueries({ queryKey: ['quote'] });
        void qc.invalidateQueries({ queryKey: ['cart'] });
      } else if (cartFixableNotice(e, e instanceof Error ? e.message : null) !== null) {
        void qc.invalidateQueries({ queryKey: ['cart'] });
      }
    },
  });

  // Từ lg nút Đặt hàng nằm cuối khung "Đơn hàng", có thể ngoài màn khi khách đang điền form hoá đơn ở cột trái: đặt lỗi thì cuộn khối nút + lời báo vào màn
  // (nearest: không giật trang nếu đã thấy; 64rem = breakpoint lg) và trả focus về nút, vì nút bị khoá lúc đang gửi nên mất focus. Dưới lg thanh dính đáy lo phần này, không cuộn trang.
  // Query-core chạy `onError` (tải lại báo giá/giỏ) TRƯỚC khi ghi trạng thái lỗi, nên lúc `isError` hiện ra nút thường còn khoá vì báo giá đang tải và `focus()` vào nút khoá không có tác dụng:
  // lỗi chỉ ghi một "yêu cầu focus", làm khi báo giá và giỏ tải xong. Xong mà nút vẫn khoá vì lý do khác thì bỏ yêu cầu, kẻo lúc khách sửa xong ô hoá đơn focus bị giật về nút.
  // Báo giá có thể về sau vài giây, lúc đó khách đã tab sang ô khác và đang gõ (ghi chú, hoá đơn, ô nhập mã giảm giá, ô tick Điểm Xanh nằm ngay trong khung "Đơn hàng"): giật focus về nút
  // thì Space/Enter kế tiếp bấm nhầm Đặt hàng. Nên chỉ trả focus khi nó không ở đâu cả (body, nút khoá làm mất focus) hoặc còn ở chính nút; focus ở bất kỳ phần tử nào khác (kể cả
  // liên kết cạnh nút, Enter trên đó là đi trang) thì khách đã chọn chỗ đó, yêu cầu bị bỏ, không giật.
  const placePartRef = useRef<HTMLDivElement>(null);
  const placeButtonRef = useRef<HTMLButtonElement>(null);
  const placeFocusDue = useRef(false);
  useEffect(() => {
    if (!place.isError || !window.matchMedia?.('(min-width: 64rem)').matches) return;
    placePartRef.current?.scrollIntoView({ block: 'nearest' });
    placeFocusDue.current = true;
  }, [place.isError, place.error, place.submittedAt]);
  const placeSettled = !quoteQ.isFetching && !cartQ.isFetching && !couponChanging;
  useEffect(() => {
    if (!placeFocusDue.current || !placeSettled) return;
    placeFocusDue.current = false;
    // Đọc trạng thái khoá từ chính nút đã vẽ (hook phải đứng trước các `return` sớm, lúc đó `placeDisabled` chưa tính).
    const button = placeButtonRef.current;
    const active = document.activeElement;
    const focusIsFree = !active || active === document.body || active === button;
    if (button && !button.disabled && focusIsFree) button.focus({ preventScroll: true });
  }, [placeSettled, place.error, place.submittedAt]);

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
          etaLabel={checkoutEtaLabel(shippingEta, placedOrderKinds(placed))}
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
            <button type="button" onClick={() => place.mutate()} disabled={place.isPending} className={ui.btnPrimary}>
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

  if (cartEmpty) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-[var(--color-bg-subtle)] text-[color:var(--color-text-brand)] shadow-card">
            <ShoppingBag className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-[color:var(--color-text-primary)]">Giỏ hàng đang trống</h2>
          <p className="mt-1 text-sm text-[color:var(--color-text-secondary)]">Chưa có sản phẩm nào để thanh toán. Chọn vài món xanh rồi quay lại nhé.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/" className={ui.btnPrimary}>
              Khám phá sản phẩm
            </Link>
            <Link href="/tai-khoan/don-hang" className={ui.btnSecondary}>
              Đơn của tôi
            </Link>
          </div>
        </div>
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
  const priceChanged = place.error instanceof Error && place.error.message === PRICE_CHANGED;
  const placeErrorMessage = place.error instanceof Error && !priceChanged ? (place.error instanceof NetworkError ? place.error.message : actionErrorText(place.error)) : null;
  const placeCartNotice = place.error ? cartFixableNotice(place.error, placeErrorMessage) : null;
  const cartIssue = overStock ? overStockMessage(overStock.productName, overStock.stock) : placeCartNotice;
  const previewSubtotal = checkoutItems.reduce((sum, it) => sum + it.total, 0);
  const paymentMethods = [
    { k: 'COD', label: 'Thanh toán khi nhận hàng (COD)' },
    { k: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng' },
    { k: 'WALLET', label: `Ví Tubu (${formatVnd(walletBalance)})` },
  ]
    // Ví chỉ trả được cả đơn: số dư 0đ thì khách không làm gì được với dòng này. Ví âm vẫn hiện (khoá, kèm lý do) để khách biết vì sao không dùng được.
    .filter((m) => m.k !== 'WALLET' || walletBalance !== 0)
    .map((m) => ({ ...m, hint: quote ? paymentUnavailableReason(m.k, quote, walletBalance) : null }));
  const paymentNote = quote && !zeroNote && payment === '' ? paymentMissingNote(quote, walletBalance) : null;
  const placeDisabled =
    !addressId || !quote || quoteStale || place.isPending || !invoiceValid || !!overStock || (!zeroNote && payment === '');
  const totalText = checkoutTotalText({ total: quote?.total ?? null, hasAddress: !!addressId }, formatVnd);
  const placeLabel = place.isPending ? 'Đang đặt hàng…' : quote ? fillCopy('checkout.placeWith', { price: formatVnd(quote.total) }) : 'Đặt hàng';
  // Lời báo đặt lỗi/giỏ cần sửa nằm cuối khung tóm tắt; thanh dính đáy nhắc lại để khách không phải cuộn xuống mới biết vì sao.
  // Đỏ chỉ cho lỗi thật (đặt lỗi, giá đổi, giỏ cần sửa); lý do khoá nút do thiếu địa chỉ/chưa tính được là chữ phụ như Mini.
  const barError =
    cartIssue ??
    (priceChanged ? fillCopy('checkout.priceChangedHint') : place.isError ? (placeErrorMessage ?? 'Đặt hàng thất bại.') : null);
  const barNote = barError ? null : checkoutPlaceHint({ hasAddress: !!addressId, quoteFailed: quoteQ.isError });

  return (
    <Shell>
      {priceChanged && (
        <div
          role="alert"
          data-testid="checkout-price-changed"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Giá ưu đãi đã thay đổi</p>
            <p className="mt-0.5">{fillCopy('flash.priceChangedBody')}</p>
          </div>
          <Link href="/gio-hang" className={ui.btnSecondary}>
            Xem lại giỏ hàng
          </Link>
        </div>
      )}
      {cartIssue && (
        <div
          role="alert"
          data-testid="checkout-cart-issue"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg"
        >
          <p className="min-w-0 flex-1 break-words">{cartIssue}</p>
          <Link href="/gio-hang" className={ui.btnSecondary}>
            Về giỏ hàng để sửa
          </Link>
        </div>
      )}
      <div className="grid gap-6 max-md:grid-cols-[minmax(0,1fr)] max-md:gap-0 md:mx-auto md:max-w-2xl lg:max-w-none lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 max-md:contents">
          <section data-mini-block="address" className={`${MINI_BAND} max-md:order-1`}>
            <h2 data-ds="checkout-block-title" className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Địa chỉ giao hàng</h2>
            {addrQ.isError && (
              <p className={`mt-2 ${ui.error}`}>
                Không tải được danh sách địa chỉ.{' '}
                <button type="button" onClick={() => void addrQ.refetch()} className={ui.btnText}>
                  Thử lại
                </button>
              </p>
            )}
            <AddressPicker
              addresses={addrQ.data ?? []}
              selectedId={addressId}
              quoteOutdated={quoteQ.error instanceof ApiError && quoteQ.error.code === 'ADDRESS_OUTDATED'}
              loadFailed={addrQ.isError}
              onSelect={chosen(setAddressId)}
              onCreated={(a) => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                chosen(setAddressId)(a.id);
              }}
              onUpdated={() => {
                choiceRev.current += 1;
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                void qc.invalidateQueries({ queryKey: ['quote'] });
              }}
            />
          </section>

          <section data-mini-block="payment" className={`${MINI_BAND} max-md:order-5`}>
            <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Phương thức thanh toán</h2>
            {zeroNote ? (
              <p className="mt-2 text-sm text-[color:var(--color-text-brand)]">{zeroNote}</p>
            ) : (
              <div className="mt-2 space-y-2">
                {paymentMethods.map((p) => {
                  const reason = p.hint;
                  return (
                    <div key={p.k}>
                      <label className={`${payOptionClass(payment === p.k)} ${reason ? 'cursor-not-allowed opacity-60' : ''}`}>
                        <input
                          type="radio"
                          name="pay"
                          checked={payment === p.k}
                          onChange={chosen(() => setPayment(p.k))}
                          disabled={!!reason || place.isPending}
                          aria-describedby={reason ? `pay-blocked-${p.k}` : undefined}
                          className={miniRadio}
                        />
                        {p.label}
                      </label>
                      {reason && (
                        <p id={`pay-blocked-${p.k}`} className="mt-1 pl-9 text-caption text-[color:var(--color-text-secondary)] md:pl-0">
                          {reason}
                        </p>
                      )}
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
              <span className="text-caption font-medium text-[color:var(--color-text-secondary)] max-md:sr-only">Lời nhắn cho người giao hàng (không bắt buộc)</span>
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

          {pickupReq !== undefined && (
            <section id="checkout-waste-pickup" data-mini-block="waste" className={`${MINI_BAND} max-md:order-8`}>
              {pickupReq === null ? (
                <Link href="/doi-rac/tao" onClick={clearSubmitted} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-3">
                    <Recycle className="h-5 w-5 text-[color:var(--color-text-brand)]" aria-hidden="true" />
                    <span>
                      <span className="block font-semibold text-[color:var(--color-text-primary)]">Thu kèm rác</span>
                      <span className="block text-caption text-[color:var(--color-text-secondary)]">Tạo yêu cầu để bưu tá lấy rác khi giao đơn này</span>
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-[color:var(--color-text-secondary)]">
                    ›
                  </span>
                </Link>
              ) : (
                <>
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[color:var(--color-text-primary)]">
                    <span className="flex items-center gap-3">
                      <Recycle className="h-5 w-5 text-[color:var(--color-text-brand)]" aria-hidden="true" />
                      Thu kèm rác
                    </span>
                    <input
                      type="checkbox"
                      checked={attachWaste}
                      onChange={chosen((e: React.ChangeEvent<HTMLInputElement>) => setAttachWaste(e.target.checked))}
                      disabled={place.isPending}
                      className="h-6 w-6 shrink-0 accent-[color:var(--color-action-primary-bg)]"
                    />
                  </label>
                  <div className="mt-2 rounded-control bg-[var(--color-bg-subtle)] p-3 text-caption text-[color:var(--color-text-secondary)]">
                    <p className="text-sm font-semibold text-[color:var(--color-text-primary)]">{pickupReq.code}</p>
                    {pickupReq.lines.map((l) => (
                      <p key={`${l.itemName}-${l.unitLabel}`} className="mt-0.5">
                        {l.itemName}: {l.declaredQty} {l.unitLabel}
                      </p>
                    ))}
                    <p className="mt-1 font-semibold text-success-fg">Ước tính {new Intl.NumberFormat('vi-VN').format(pickupReq.estimatedPoints)} điểm</p>
                    {attachWaste && <p className="mt-1">Ghi mã lên túi, bưu tá lấy khi giao đơn.</p>}
                    {attachWaste && paymentToSend === 'BANK_TRANSFER' && (
                      <p className="mt-1">Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.</p>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          <div data-mini-block="referral" className="max-md:order-4 max-md:mt-2">
            <ReferralCodeBox
              linkedCode={linkedReferral}
              appliedCode={referralApplied}
              onApplied={chosen(setReferralApplied)}
              disabled={place.isPending}
            />
          </div>

          <div data-mini-block="invoice" className="max-md:order-9 max-md:mt-2">
            <InvoiceSection
              want={wantInvoice}
              onWant={chosen(setWantInvoice)}
              invoice={invoice}
              onInvoice={chosen(setInvoice)}
              valid={invoiceValid}
              disabled={place.isPending}
            />
          </div>
        </div>

        {/* Khung cuộn cùng trang, không cột dính và không vùng cuộn riêng (DESIGN.md, Khuôn trang web máy tính): chỉ dải tổng + nút Đặt hàng bên dưới dính đáy màn nên nút luôn trong tầm nhìn dù khung dài. */}
        <div className={`h-fit p-4 ${ui.card} max-md:contents lg:pb-0 lg:self-start`}>
          <h2 className={`${ui.sectionTitle} max-md:hidden`}>Đơn hàng</h2>
          {/* Từ md danh sách chữ hiện đủ dòng, không vùng cuộn lồng: dòng thứ 6 trở đi gập sau nút kèm tiền; giỏ tách kiện hiện hết
              để khách thấy đủ mọi kiện và phí giao cộng vào tổng. */}
          <div data-mini-block="items" className="max-md:order-2 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4">
          <MobileItems items={checkoutItems} shipments={split ? shipments : null} splitNote={splitNote} />
          <DesktopLines items={checkoutItems} shipments={split ? shipments : null} />
          {itemIds && cart && (
            <p className="mt-2 text-caption text-[color:var(--color-text-secondary)]">
              Đang thanh toán {itemIds.length}/{cart.items.length} sản phẩm trong giỏ.{' '}
              <Link href="/gio-hang" className="font-semibold text-[color:var(--color-text-brand)] underline">
                Đổi lựa chọn
              </Link>
            </p>
          )}
          {splitNote && <p className="mt-2 text-caption text-[color:var(--color-text-secondary)] max-md:hidden">{splitNote}</p>}
          </div>
          <div data-mini-block="summary" className="max-md:order-10 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pt-4">
          <h2 className="mb-2.5 hidden font-ui text-sm font-semibold max-md:block">Tóm tắt đơn hàng</h2>
          <Row ds="checkout-summary-row" label="Tạm tính" value={formatVnd(quote?.subtotal ?? previewSubtotal)} />
          {(quote?.discount ?? 0) > 0 && (
            <Row label={`Giảm giá${cart?.couponCode ? ` (${cart.couponCode})` : ''}`} value={`-${formatVnd(quote!.discount)}`} green />
          )}
          {(quote?.comboDiscount ?? 0) > 0 && <Row label="Ưu đãi combo" value={`-${formatVnd(quote!.comboDiscount!)}`} green />}
          {(quote?.tierDiscount ?? 0) > 0 && (
            <Row label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote!.tierDiscount!)}`} green />
          )}
          {(quote?.pointsDiscount ?? 0) > 0 && (
            <Row label={`Điểm Xanh (${formatCount(quote!.pointsUsed)})`} value={`-${formatVnd(quote!.pointsDiscount)}`} green />
          )}
          <Row
            label="Phí vận chuyển"
            value={quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : addressId ? '…' : 'Nhập địa chỉ để tính phí'}
          />
          {quote && etaLabel && <Row label="Giao dự kiến" value={etaLabel} />}
          </div>
          {cart && (
            <div data-mini-block="coupon" className="max-md:order-3 max-md:mt-2">
              <CouponBox
                band
                actionLabel="Chọn mã"
                currentCode={cart.couponCode}
                appliedDiscount={quote?.discount ?? 0}
                subtotal={previewSubtotal}
                shippingFee={quote?.shippingFee ?? null}
                notice={quote ? quote.couponNotice : cart.couponNotice}
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
                partnerPoints.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              }`}
            >
              <span className={miniCheckboxWrap}>
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
                <span className="block text-caption max-md:text-[color:var(--color-text-secondary)]">
                  {partnerPoints.disabled
                    ? lockedPointsLabel(quote, pointsOffer)
                    : pointsOfferText(usablePoints, quote, usePoints && quote ? quote : null, configQ.data?.loyalty?.vndPerPointRedeem)}
                </span>
              </span>
            </label>
          )}
          {usablePoints === 0 && (
            <div data-testid="points-none" className="flex min-h-11 items-center justify-between md:hidden">
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-[var(--type-body-sm-lh)] text-[color:var(--color-text-primary)]">Điểm Xanh</span>
                <span className="block text-caption text-[color:var(--color-text-tertiary)]">{idlePointsLabel(quote ?? user)}</span>
              </span>
              <span className={miniCheckboxWrap}>
                <input type="checkbox" checked={false} disabled readOnly aria-label="Dùng Điểm Xanh" className={miniCheckbox} />
                <CheckMark />
              </span>
            </div>
          )}
          {usablePoints > 0 && partnerPoints.capNote && <p className="mt-1 text-caption text-[color:var(--color-text-secondary)]">{partnerPoints.capNote}</p>}
          {usablePoints > 0 && partnerPoints.partnerNote && <p className="mt-1 text-caption text-[color:var(--color-text-secondary)]">{partnerPoints.partnerNote}</p>}
          {convertedLine && <p className="mt-1 text-caption text-[color:var(--color-text-secondary)]">{convertedLine}</p>}
          {pointsOffer.lockNote && <p className="mt-1 text-caption text-[color:var(--color-text-secondary)]">{pointsOffer.lockNote}</p>}
          </div>
          <div data-mini-part="summary-total" className="max-md:order-11 max-md:bg-[var(--color-bg-surface)] max-md:px-4">
          <div
            data-ds="checkout-summary-total"
            className="flex justify-between gap-2.5 py-1.5 text-[color:var(--color-text-primary)] md:mt-3 md:gap-0 md:border-t md:border-[var(--color-border-subtle)] md:pb-0 md:pt-3 md:font-bold lg:hidden"
          >
            <span className="text-sm font-normal leading-[var(--type-body-sm-lh)] text-[color:var(--color-text-secondary)] md:text-base md:font-bold md:leading-[inherit] md:text-[color:var(--color-text-primary)]">Tổng cộng</span>
            {/* Đang tải/đang lỗi thì hiện "…" thay vì 0đ: con số 0 đứng yên cạnh dòng báo lỗi
                trông như đơn không mất tiền. */}
            <span className="text-base font-bold leading-[var(--type-body-sm-lh)] md:leading-[inherit]">{totalText}</span>
          </div>
          {quote && quote.pointsEarned > 0 && (
            <p className="mt-1 flex items-center gap-1 text-caption text-success-fg">
              <Sprout size={13} aria-hidden="true" />
              Nhận +{formatCount(quote.pointsEarned)} Điểm Xanh khi giao thành công
            </p>
          )}
          {quoteQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              {quoteQ.error instanceof ApiError && quoteQ.error.code === 'ADDRESS_OUTDATED'
                ? `${loadErrorText(quoteQ.error)} Hãy bấm Sửa ở địa chỉ đó để chọn lại tỉnh/phường, hoặc thêm địa chỉ mới.`
                : 'Không tính được phí ship/tổng tiền.'}{' '}
              <button type="button" onClick={() => void quoteQ.refetch()} className={ui.btnText}>
                Thử lại
              </button>
            </p>
          )}
          {cartQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              Không tải được giỏ hàng.{' '}
              <button type="button" onClick={() => void cartQ.refetch()} className={ui.btnText}>
                Thử lại
              </button>
            </p>
          )}

          {/* Dưới lg nút đặt hàng nằm ở thanh dính đáy (cuối trang). Từ lg khung "Đơn hàng" không dính và không cuộn riêng (DESIGN.md); chỉ khối dưới đây (dải tổng + nút) dính đáy màn trong khung, để nút và lý do khoá/lỗi đặt hàng nằm sát nhau. */}
          </div>
          <div ref={placePartRef} data-mini-part="place-order" className="max-md:order-11 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pb-4 lg:sticky lg:bottom-0 lg:bg-[var(--color-bg-surface)] lg:py-4">
          {/* Bản sao hiển thị của dòng Tổng cộng ở khối tổng phía trên (ẩn từ lg): tổng tiền đi cùng khối dính, luôn nằm cạnh nút Đặt hàng. */}
          <div className="mb-3 hidden justify-between border-t border-[var(--color-border-subtle)] pt-3 font-bold text-[color:var(--color-text-primary)] lg:flex">
            <span>Tổng cộng</span>
            <span>{totalText}</span>
          </div>
          <OrderConsent className="hidden lg:block" />
          <button
            ref={placeButtonRef}
            type="button"
            onClick={() => place.mutate()}
            disabled={placeDisabled}
            className={`${ui.btnPrimary} mt-2 hidden w-full lg:inline-flex`}
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
          {place.isError && !priceChanged && placeCartNotice === null && (
            <div role="alert" className={`mt-2 ${ui.error}`}>
              <p>{placeErrorMessage ?? 'Đặt hàng thất bại.'}</p>
              {isOutcomeUnknown(place.error) && (
                <p className="mt-1 text-[color:var(--color-text-secondary)]">
                  Đơn có thể đã được ghi nhận. Bấm Đặt hàng lần nữa để thử lại — hệ thống nhận ra yêu cầu trùng nên không tạo thêm đơn. Hoặc xem{' '}
                  <Link href="/tai-khoan/don-hang" className="font-semibold text-[color:var(--color-text-brand)] underline">
                    Đơn của tôi
                  </Link>
                  .
                </p>
              )}
              {place.error?.message === PREVIOUS_MAYBE_PLACED && (
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
          onClick={() => place.mutate()}
          disabled={placeDisabled}
          className={`${uiBar.primary} w-full`}
        >
          {placeLabel}
        </button>
      </StickyActionBar>
    </Shell>
  );
}

// Dưới md đúng KeyValueRow của Mini: đệm 6px, nhãn 14/400, giá trị 15/600 (cỡ 15px là cỡ thừa kế của Mini, không phải bậc body-sm).
function Row({ label, value, green, ds }: { label: string; value: string; green?: boolean; ds?: string }) {
  return (
    <div
      data-ds={ds}
      className={`flex justify-between gap-2.5 py-1.5 text-sm md:mt-1 md:gap-0 md:py-0 ${green ? 'text-success-fg' : 'text-[color:var(--color-text-primary)]'}`}
    >
      <span className={`leading-[var(--type-body-sm-lh)] md:leading-5 ${green ? '' : 'text-[color:var(--color-text-secondary)]'}`}>{label}</span>
      <span className="text-[0.9375rem] font-semibold leading-[var(--type-body-sm-lh)] md:text-sm md:font-normal md:leading-5">{value}</span>
    </div>
  );
}

type ShipmentView = { key: string; itemIds: string[]; fulfiller: Parameters<typeof fulfillerLabel>[0]; shippingFee: number };

// Danh sách chữ trong khung "Đơn hàng" từ md (điện thoại dùng MobileItems). Các dòng thấy được cộng với tiền dòng gập ra đúng "Tạm tính".
function DesktopLines({ items, shipments }: { items: CartLine[]; shipments: ShipmentView[] | null }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, hiddenCount, hiddenTotal } = collapseCheckoutLines(items, expanded);
  return (
    <div role="region" aria-label="Sản phẩm trong đơn" className="mt-2 space-y-1 text-sm max-md:hidden">
      {shipments
        ? shipments.map((sh) => (
            <div key={sh.key} className="space-y-1 border-b border-[var(--color-border-subtle)] pb-2 last:border-b-0">
              <p className="text-caption font-semibold text-[color:var(--color-text-primary)]">{fulfillerLabel(sh.fulfiller)}</p>
              {items
                .filter((it) => sh.itemIds.includes(it.id))
                .map((it) => (
                  <LineRow key={it.id} item={it} />
                ))}
              <div className="flex justify-between gap-2 text-caption text-[color:var(--color-text-secondary)]">
                <span>Phí giao</span>
                <span>{sh.shippingFee === 0 ? 'Miễn phí' : formatVnd(sh.shippingFee)}</span>
              </div>
            </div>
          ))
        : shown.map((it) => <LineRow key={it.id} item={it} />)}
      {!shipments && (hiddenCount > 0 || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold text-[color:var(--color-text-brand)]"
        >
          <span>{expanded ? fillCopy('checkout.fewerLines') : fillCopy('checkout.moreLines', { n: hiddenCount })}</span>
          {!expanded && <span className="tabular-nums text-[color:var(--color-text-primary)]">{formatVnd(hiddenTotal)}</span>}
        </button>
      )}
    </div>
  );
}

function LineRow({ item }: { item: CartLine }) {
  return (
    <div data-testid="checkout-line" className="flex justify-between gap-2">
      <span className="min-w-0 text-[color:var(--color-text-secondary)]">
        <span className="line-clamp-2">{item.productName}</span>
        <span className="block text-caption text-[color:var(--color-text-tertiary)]">
          {item.variationName && <span>{item.variationName}</span>}
          {item.variationName ? ' · ' : ''}×{item.quantity}
        </span>
      </span>
      <span className="shrink-0 tabular-nums text-[color:var(--color-text-primary)]">{formatVnd(item.total)}</span>
    </div>
  );
}

function AddressPicker({
  addresses,
  selectedId,
  quoteOutdated,
  loadFailed,
  onSelect,
  onCreated,
  onUpdated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
  quoteOutdated: boolean;
  /** Danh sách không tải được: đã có dòng lỗi riêng, không được nói "chưa thêm địa chỉ". */
  loadFailed: boolean;
  onSelect: (id: string) => void;
  onCreated: (a: AddressDTO) => void;
  onUpdated: (a: AddressDTO) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="mt-2 space-y-2">
      {addresses.length === 0 && !adding && !loadFailed && (
        <p data-testid="address-empty" className="text-sm leading-[var(--type-body-sm-lh)] text-[color:var(--color-text-tertiary)]">
          {fillCopy('checkout.addressEmpty')}
        </p>
      )}
      {addresses.map((a) =>
        editingId === a.id ? (
          <AddressForm
            key={a.id}
            title="Sửa địa chỉ"
            submitLabel="Lưu thay đổi"
            initial={addressToForm(a)}
            onSubmit={async (payload) => {
              const saved = await updateAddress(a.id, payload);
              setEditingId(null);
              onUpdated(saved);
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div key={a.id}>
          <div className="flex items-start gap-1">
            <label data-ds="checkout-address-card" className={`${addressOptionClass(selectedId === a.id)} min-w-0 flex-1 items-start max-md:block`}>
              <input
                type="radio"
                name="addr"
                checked={selectedId === a.id}
                onChange={() => onSelect(a.id)}
                className={`${miniRadio} max-md:sr-only`}
              />
              <span className="min-w-0 break-words">
                <span className="flex items-center gap-x-1.5 leading-[var(--type-body-sm-lh)] md:flex-wrap md:leading-5">
                  <span className="min-w-0 truncate font-semibold text-[color:var(--color-text-primary)] md:overflow-visible md:whitespace-normal md:font-medium">{a.recipient} · {a.phone}</span>
                  {a.isDefault && (
                    <span className="shrink-0 rounded-full bg-[var(--color-action-secondary-bg)] px-2 py-[3px] text-[length:var(--type-label-size)] font-semibold leading-[var(--type-label-lh)] text-[color:var(--color-action-secondary-fg)]">
                      Mặc định
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-caption text-[color:var(--color-text-secondary)] md:mt-0 md:text-sm">{[a.street, a.ward, a.district, a.province].filter(Boolean).join(', ')}</span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setEditingId(a.id);
              }}
              aria-label={`Sửa địa chỉ của ${a.recipient}`}
              className={`${ui.btnText} ${isLegacyGeo(a) || (selectedId === a.id && quoteOutdated) ? '' : 'max-md:hidden'}`}
            >
              Sửa
            </button>
          </div>
          {selectedId === a.id && isLegacyGeo(a) && editingId === null && (
            <div role="alert" className="mt-2 flex flex-col gap-2 rounded-control bg-warning-bg p-3">
              <span className="flex items-start gap-1.5 text-sm text-warning-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                Địa chỉ này theo địa giới cũ (trước khi sắp xếp tỉnh/phường năm 2025) nên chưa giao được. Bạn cập nhật lại tỉnh/thành và phường/xã giúp Tubu nhé.
              </span>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setEditingId(a.id);
                }}
                className={`${ui.btnSecondary} self-start`}
              >
                Cập nhật địa chỉ
              </button>
            </div>
          )}
          </div>
        ),
      )}

      {adding ? (
        <AddressForm
          title="Thêm địa chỉ mới"
          submitLabel="Lưu địa chỉ"
          onSubmit={async (payload) => {
            const created = await createAddress(payload);
            setAdding(false);
            onCreated(created);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4">
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--color-text-brand)] hover:underline"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-dashed border-[var(--color-action-primary-bg)]"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </span>
            Thêm địa chỉ mới
          </button>
          {addresses.length > 0 && (
            <Link href="/tai-khoan/dia-chi" className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-text-secondary)] hover:underline max-md:hidden">
              Quản lý sổ địa chỉ
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// `bare`: màn thành công ở điện thoại không có thanh tiêu đề (Mini App OrderSuccess tự có h1), từ md vẫn như các màn khác.
function Shell({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0`}>
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

// Khối "Sản phẩm (n)" của Mini App (checkout.tsx): ảnh 48px, tên tối đa hai dòng, phân loại, đơn giá × số lượng, thành tiền. Chỉ hiện ở điện thoại;
// từ md danh sách chữ trong khung "Đơn hàng" giữ nguyên.
function MobileItems({
  items,
  shipments,
  splitNote,
}: {
  items: CartLine[];
  shipments: { key: string; itemIds: string[]; fulfiller: Parameters<typeof fulfillerLabel>[0]; shippingFee: number }[] | null;
  splitNote: string | null;
}) {
  if (items.length === 0) return null;
  const count = items.reduce((sum, it) => sum + it.quantity, 0);
  const groups = shipments
    ? shipments.map((sh) => ({ key: sh.key, shipment: sh, lines: items.filter((it) => sh.itemIds.includes(it.id)) }))
    : [{ key: 'all', shipment: null, lines: items }];
  return (
    <div className="md:hidden">
      <h2 className="font-ui text-sm font-semibold leading-5">Sản phẩm ({count})</h2>
      {splitNote && <p className="mt-2.5 text-caption text-[color:var(--color-text-secondary)]">{splitNote}</p>}
      <div className="mt-2.5 space-y-3">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.shipment ? fulfillerLabel(g.shipment.fulfiller) : 'Sản phẩm sẽ mua'}>
            {g.shipment && <p className="mb-2 text-sm font-semibold">{fulfillerLabel(g.shipment.fulfiller)}</p>}
            <div className="space-y-3">
              {g.lines.map((it) => (
                <div key={it.id} className="flex items-center gap-2.5">
                  <ProductThumb src={it.thumbnail} alt={it.productName} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm">{it.productName}</div>
                    {it.variationName && <div className="text-caption text-[color:var(--color-text-tertiary)]">{it.variationName}</div>}
                    <div className="text-caption text-[color:var(--color-text-tertiary)]">
                      {formatVnd(it.unitPrice)} × {it.quantity}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-sm font-semibold">{formatVnd(it.total)}</div>
                </div>
              ))}
            </div>
            {g.shipment && (
              <div className="mt-1.5 flex justify-between text-sm">
                <span className="text-[color:var(--color-text-secondary)]">Phí giao</span>
                <span className={g.shipment.shippingFee === 0 ? 'text-success-fg' : ''}>
                  {g.shipment.shippingFee === 0 ? 'Miễn phí' : formatVnd(g.shipment.shippingFee)}
                </span>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
