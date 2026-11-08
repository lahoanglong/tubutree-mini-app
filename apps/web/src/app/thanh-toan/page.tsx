'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ChevronRight, Plus, Recycle, Sprout } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { getWasteMe, WASTE_QUERY_KEYS } from '@tubutree/app-core/api/waste';
import { useAuth } from '@/lib/auth-context';
import { rememberActiveOrder } from '@tubutree/app-core/home-todo-rows';
import { browserStorage } from '@/lib/recently-viewed';
import { syncHomeHintCookie } from '@/lib/home-hint-cookie';
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
  updateCartItem,
  removeCartItem,
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
import { checkoutPlaceHint, checkoutTotalText, collapseCheckoutLines } from '@tubutree/app-core/commerce/checkout-display';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { couponNoticeText } from '@tubutree/app-core/coupon-min-order';
import { useRemovedCoupon } from '@/lib/use-removed-coupon';
import { checkoutLineProblems, priceChangedActions, type LineAction, type LineFix, type LineProblem } from '@tubutree/app-core/commerce/checkout-issues';
import { checkoutEtaLabel, placedOrderKinds } from '@tubutree/app-core/shipping-eta';
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
import { CheckMark, miniCheckboxWrap, miniCheckbox, miniCheckboxGutter, miniRadio, miniRadioGutter, mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { Button, ProductThumb } from '@/components/mini';
import { EmptyState } from '@/components/mini/empty-state';
import { CART_EMPTY } from '@tubutree/app-core/cart-copy';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { PAGE_WIDE } from '@/lib/page-frame';
import { clearSubmitted } from '@/lib/recycle-wizard';

// Máy chủ trả nguyên mã này (không phải câu cho khách) khi hết suất/hết giờ vàng giữa lúc thanh toán.
const PRICE_CHANGED = 'PRICE_CHANGED';

// has-[:focus-visible]: ô radio của thẻ địa chỉ bị sr-only ở điện thoại nên vòng lấy nét phải hiện trên cả thẻ.
const OPTION_BASE = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border p-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--color-border-focus)]';
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
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);
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
  // Bản sao của choiceRev và của rev lần đặt đang treo trong state để vẽ: nút chỉ là "Thử lại" khi lựa chọn hiện tại đúng là lần đặt bị treo.
  const [choiceTick, setChoiceTick] = useState(0);
  const [unknownRev, setUnknownRev] = useState<number | null>(null);
  const bumpChoice = () => {
    choiceRev.current += 1;
    setChoiceTick(choiceRev.current);
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
  // Chưa có cấu hình (đang tải, lỗi, API cũ) thì không hứa ngày giao; giỏ chỉ có hàng gian hàng tự giao thì cũng không.
  const etaLabel = checkoutEtaLabel(shippingEta, shipments.map((s) => s.fulfiller.kind));
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
  // Khách đã bấm "Cập nhật giá mới" sau lỗi giá đổi: báo tổng mới cho tới lần đặt kế tiếp.
  const [priceAccepted, setPriceAccepted] = useState(false);
  const place = useMutation({
    onMutate: () => setPriceAccepted(false),
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
      setUnknownRev(unknownAttempt.current?.rev ?? null);
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

  // Sửa nhanh dòng hết hàng/vượt tồn ngay tại màn: khách không rời trang nên các ô đã nhập còn nguyên. Đổi dòng là đổi lựa chọn của khách,
  // nên một lần đặt đang đóng băng (chưa rõ kết quả) không được phát lại nữa.
  const lineFix = useMutation({
    mutationFn: ({ id, fix }: { id: string; fix: LineFix }) => (fix.kind === 'remove' ? removeCartItem(id) : updateCartItem(id, fix.quantity)),
    // Chờ giỏ và báo giá về mới thôi bận: nút xoá còn bấm được trong lúc giỏ cũ còn hiện thì lần bấm hai gọi xoá dòng đã mất và nhận 404.
    onSuccess: async () => {
      bumpChoice();
      place.reset();
      await Promise.all([qc.invalidateQueries({ queryKey: ['cart'] }), qc.invalidateQueries({ queryKey: ['quote'] })]);
    },
    // Bị từ chối thường vì tồn vừa đổi: tải lại giỏ để nút "Giảm còn n" theo tồn mới.
    onError: () => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
    },
  });
  const lineFixView: LineFixView = {
    problems: lineProblems,
    pendingId: lineFix.isPending ? (lineFix.variables?.id ?? null) : null,
    errorFor: lineFix.isError ? (lineFix.variables?.id ?? null) : null,
    errorText: lineFix.isError ? actionErrorText(lineFix.error) : null,
    onFix: (id, fix) => {
      if (fix.kind === 'cart') router.push('/gio-hang');
      else lineFix.mutate({ id, fix });
    },
  };

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
  const priceChanged = place.error instanceof Error && place.error.message === PRICE_CHANGED;
  const placeErrorMessage = place.error instanceof Error && !priceChanged ? (place.error instanceof NetworkError ? place.error.message : actionErrorText(place.error)) : null;
  const placeCartNotice = place.error ? cartFixableNotice(place.error, placeErrorMessage) : null;
  const cartIssue = placeCartNotice;
  const previewSubtotal = checkoutItems.reduce((sum, it) => sum + it.total, 0);
  // Chưa có báo giá: xem trước khoản giảm từ giỏ như Mini. Combo, mã và hạng của giỏ chỉ đúng cho cả giỏ; mua một phần thì máy chủ tính lại.
  const earnedLabel = quote ? `Nhận +${formatCount(quote.pointsEarned)} Điểm Xanh khi giao thành công` : '';
  const wholeCart = !itemIds || itemIds.length === (cart?.items.length ?? 0);
  const previewCombo = wholeCart ? (cart?.comboDiscount ?? 0) : 0;
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
    .map((m) => ({ ...m, hint: quote ? paymentUnavailableReason(m.k, quote, walletBalance) : null }));
  const paymentNote = quote && !zeroNote && payment === '' ? paymentMissingNote(quote, walletBalance) : null;
  // Thiếu địa chỉ hoặc ô hoá đơn thì nút vẫn bấm được: bấm để chỉ ra ô thiếu (lỗi ngay dưới ô, con trỏ nhảy tới). Chỉ những lý do
  // không phải ô nhập (đang gửi, đang tính tiền, dòng cần sửa, chưa có cách thanh toán) mới khoá hẳn, và đã có chữ nói lý do.
  const placeDisabled =
    place.isPending || hasLineProblem || (!!addressId && (!quote || quoteStale || (!zeroNote && payment === '')));
  const onPlace = () => {
    if (formBlocked) {
      setPlaceAttempted(true);
      setInvoiceAttempted(true);
      setFocusTick((n) => n + 1);
      return;
    }
    place.mutate();
  };
  const totalText = checkoutTotalText({ total: quote?.total ?? null, hasAddress: !!addressId }, formatVnd);
  // Lần đặt vừa rồi chưa rõ kết quả (mất mạng, quá thời gian, 5xx): nút nói rõ là gửi lại cùng đơn (cùng khoá, không tạo đơn trùng).
  const retryingPlace = place.isError && isOutcomeUnknown(place.error) && unknownRev !== null && unknownRev === choiceTick;
  const placeLabel = place.isPending
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
        : place.isError
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
                place.reset();
                setPriceAccepted(true);
              }}
            >
              {priceChangedActions().accept}
            </button>
            <Link href="/gio-hang" className={ui.btnSecondary}>
              {priceChangedActions().viewCart}
            </Link>
          </div>
        </div>
      )}
      {priceAccepted && quote && !quoteStale && !place.isError && (
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
          <Link href="/gio-hang" className={ui.btnSecondary}>
            Về giỏ hàng để sửa
          </Link>
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
                <button type="button" onClick={() => void addrQ.refetch()} className={ui.btnText}>
                  Thử lại
                </button>
              </p>
            )}
            <AddressPicker
              addresses={addrQ.data ?? []}
              selectedId={addressId}
              quoteOutdated={addressOutdated}
              loadFailed={addrQ.isError}
              userId={user?.id}
              onSelect={chosen(setAddressId)}
              onCreated={(a) => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                chosen(setAddressId)(a.id);
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
                          onChange={chosen(() => setPayment(p.k))}
                          disabled={!!reason || place.isPending}
                          aria-describedby={reason ? `pay-blocked-${p.k}` : undefined}
                          className={`${miniRadio} ${miniRadioGutter} ${reason ? 'opacity-[0.45] md:opacity-60' : ''}`}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className={reason ? 'opacity-[0.45] md:opacity-60' : undefined}>{p.label}</span>
                          {reason && (
                            <span id={`pay-blocked-${p.k}`} className="text-caption text-[color:var(--color-text-secondary)] md:hidden">
                              {reason}
                            </span>
                          )}
                        </span>
                      </label>
                      {reason && (
                        <p aria-hidden="true" className="mt-1 text-caption text-[color:var(--color-text-secondary)] hidden md:block">
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

        {/* Khung cuộn cùng trang, không cột dính và không vùng cuộn riêng (DESIGN.md, Khuôn trang web máy tính): chỉ dải tổng + nút Đặt hàng bên dưới dính đáy màn nên nút luôn trong tầm nhìn dù khung dài. */}
        <div className={`h-fit p-4 ${ui.card} max-md:contents lg:pb-0 lg:self-start`}>
          <h2 className={`${ui.sectionTitle} max-md:hidden`}>Đơn hàng</h2>
          {/* Từ md danh sách chữ hiện đủ dòng, không vùng cuộn lồng: dòng thứ 6 trở đi gập sau nút kèm tiền; giỏ tách kiện hiện hết
              để khách thấy đủ mọi kiện và phí giao cộng vào tổng. */}
          <div data-mini-block="items" className="max-md:order-2 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4">
          <MobileItems items={checkoutItems} shipments={split ? shipments : null} splitNote={splitNote} fix={lineFixView} />
          <DesktopLines items={checkoutItems} shipments={split ? shipments : null} fix={lineFixView} />
          {itemIds && cart && (
            <p className="mt-2 text-caption text-[color:var(--color-text-secondary)]">
              Đang thanh toán {itemIds.length}/{cart.items.length} sản phẩm trong giỏ.{' '}
              <Link href="/gio-hang" className="font-semibold text-[color:var(--color-text-brand)] underline">
                Đổi lựa chọn
              </Link>
            </p>
          )}
          {splitNote && <p className="mt-2 text-caption text-[color:var(--color-text-secondary)] hidden md:block">{splitNote}</p>}
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
          {cardPreview && previewCombo > 0 && <Row label="Giảm giá combo" value={`-${formatVnd(previewCombo)}`} green />}
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
          {(quote?.comboDiscount ?? 0) > 0 && <Row label="Ưu đãi combo" value={`-${formatVnd(quote!.comboDiscount!)}`} green />}
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
          <Row
            label="Phí vận chuyển"
            value={quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : addressId ? '…' : 'Nhập địa chỉ để tính phí'}
            valueGreen={quote?.shippingFee === 0}
          />
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
              {(quote ? (quote.comboDiscount ?? 0) : previewCombo) > 0 && <Row label="Giảm giá combo" value={`-${formatVnd(quote ? quote.comboDiscount! : previewCombo)}`} valueGreen />}
              {(quote ? (quote.tierDiscount ?? 0) : previewTier) > 0 && <Row label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote ? quote.tierDiscount! : previewTier)}`} valueGreen />}
              {(quote?.pointsDiscount ?? 0) > 0 && <Row label="Giảm giá Điểm Xanh" value={`-${formatVnd(quote!.pointsDiscount)}`} valueGreen />}
              <Row
                label="Phí vận chuyển"
                value={quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : addressId ? '…' : 'Nhập địa chỉ để tính phí'}
                valueGreen={quote?.shippingFee === 0}
              />
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
            <span className="text-base font-bold leading-[var(--type-body-sm-lh)] tabular-nums md:leading-[inherit]">{totalText}</span>
          </div>
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
            <span className="tabular-nums">{totalText}</span>
          </div>
          <OrderConsent className="hidden lg:block" />
          <button
            ref={placeButtonRef}
            type="button"
            onClick={onPlace}
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
              {isOutcomeUnknown(place.error) && !retryingPlace && (
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
          onClick={onPlace}
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
function Row({ label, value, green, valueGreen, ds }: { label: React.ReactNode; value: string; green?: boolean; valueGreen?: boolean; ds?: string }) {
  return (
    <div
      data-ds={ds}
      className={`flex justify-between gap-2.5 py-1.5 text-sm md:mt-1 md:gap-0 md:py-0 ${green ? 'text-[color:var(--color-text-primary)] md:text-success-fg' : 'text-[color:var(--color-text-primary)]'}`}
    >
      <span className={`leading-[var(--type-body-sm-lh)] md:leading-5 text-[color:var(--color-text-secondary)] ${green ? 'md:text-inherit' : ''}`}>{label}</span>
      <span className={`text-[0.9375rem] font-semibold leading-[var(--type-body-sm-lh)] tabular-nums md:text-sm md:font-normal md:leading-5 ${green || valueGreen ? 'text-success-fg' : ''}`}>{value}</span>
    </div>
  );
}

type ShipmentView = { key: string; itemIds: string[]; fulfiller: Parameters<typeof fulfillerLabel>[0]; shippingFee: number };

// Danh sách chữ trong khung "Đơn hàng" từ md (điện thoại dùng MobileItems). Các dòng thấy được cộng với tiền dòng gập ra đúng "Tạm tính".
function DesktopLines({ items, shipments, fix }: { items: CartLine[]; shipments: ShipmentView[] | null; fix: LineFixView }) {
  const [expanded, setExpanded] = useState(false);
  // Dòng lỗi nằm sau chỗ gập thì khách thấy nút đặt bị khoá mà không thấy lý do: có dòng lỗi thì mở hết.
  const { shown, hiddenCount, hiddenTotal } = collapseCheckoutLines(items, expanded || Object.keys(fix.problems).length > 0);
  return (
    <div role="region" aria-label="Sản phẩm trong đơn" className="mt-2 space-y-1 text-sm max-md:hidden">
      {shipments
        ? shipments.map((sh) => (
            <div key={sh.key} className="space-y-1 border-b border-[var(--color-border-subtle)] pb-2 last:border-b-0">
              <p className="text-caption font-semibold text-[color:var(--color-text-primary)]">{fulfillerLabel(sh.fulfiller)}</p>
              {items
                .filter((it) => sh.itemIds.includes(it.id))
                .map((it) => (
                  <LineRow key={it.id} item={it} fix={fix} />
                ))}
              <div className="flex justify-between gap-2 text-caption text-[color:var(--color-text-secondary)]">
                <span>Phí giao</span>
                <span className="tabular-nums">{sh.shippingFee === 0 ? 'Miễn phí' : formatVnd(sh.shippingFee)}</span>
              </div>
            </div>
          ))
        : shown.map((it) => <LineRow key={it.id} item={it} fix={fix} />)}
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

function LineRow({ item, fix }: { item: CartLine; fix: LineFixView }) {
  return (
    <>
      <div data-testid="checkout-line" className="flex justify-between gap-2">
        <span className="min-w-0 text-[color:var(--color-text-secondary)]">
          <span className="line-clamp-2">{item.productName}</span>
          <span className="block text-caption tabular-nums text-[color:var(--color-text-tertiary)]">
            {item.variationName && <span>{item.variationName}</span>}
            {item.variationName ? ' · ' : ''}×{item.quantity}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-[color:var(--color-text-primary)]">{formatVnd(item.total)}</span>
      </div>
      <LineProblemNote id={item.id} fix={fix} />
    </>
  );
}

/** Lỗi của một dòng hàng ngay dưới dòng đó, kèm nút sửa nhanh (bỏ dòng, giảm về số còn). */
interface LineFixView {
  problems: Record<string, LineProblem>;
  pendingId: string | null;
  errorFor: string | null;
  errorText: string | null;
  onFix: (id: string, fix: LineAction) => void;
}

function LineProblemNote({ id, fix }: { id: string; fix: LineFixView }) {
  const problem = fix.problems[id];
  if (!problem) return null;
  return (
    <div data-testid="checkout-line-problem" role="alert" className="mt-1 flex flex-wrap items-center justify-between gap-2">
      <span className="text-caption text-danger-fg">{fix.errorFor === id && fix.errorText ? fix.errorText : problem.text}</span>
      <button
        type="button"
        className={ui.btnSecondary}
        disabled={fix.pendingId === id}
        onClick={() => fix.onFix(id, problem.fix)}
      >
        {problem.fixLabel}
      </button>
    </div>
  );
}

function AddressPicker({
  addresses,
  selectedId,
  quoteOutdated,
  loadFailed,
  userId,
  onSelect,
  onCreated,
  onUpdated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
  quoteOutdated: boolean;
  /** Danh sách không tải được: đã có dòng lỗi riêng, không được nói "chưa thêm địa chỉ". */
  loadFailed: boolean;
  userId?: string;
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
            submitLabel="Lưu"
            initial={addressToForm(a)}
            userId={userId}
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
            <label data-ds="checkout-address-card" className={`tubu-press ${addressOptionClass(selectedId === a.id)} min-w-0 flex-1 items-start max-md:block`}>
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
          title="Thêm địa chỉ"
          userId={userId}
          submitLabel="Lưu"
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
  fix,
}: {
  items: CartLine[];
  shipments: { key: string; itemIds: string[]; fulfiller: Parameters<typeof fulfillerLabel>[0]; shippingFee: number }[] | null;
  splitNote: string | null;
  fix: LineFixView;
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
                    <div className="text-caption tabular-nums text-[color:var(--color-text-tertiary)]">
                      {formatVnd(it.unitPrice)} × {it.quantity}
                    </div>
                    <LineProblemNote id={it.id} fix={fix} />
                  </div>
                  <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatVnd(it.total)}</div>
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
