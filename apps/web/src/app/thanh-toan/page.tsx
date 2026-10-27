'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Plus, Recycle, ShoppingBag } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { getWasteMe, WASTE_QUERY_KEYS } from '@tubutree/app-core/api/waste';
import { useAuth } from '@/lib/auth-context';
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
import { ctvSlugFor, getStorefrontContext } from '@/lib/storefront-context';
import { shippingEtaLabel } from '@tubutree/app-core/shipping-eta';
import { checkoutPointsOffer, convertedPointsLine, formatCount, pointsCapState, zeroTotalNote, type CheckoutPointsOffer } from '@/lib/checkout-points';
import {
  ORDER_NOTE_MAX,
  effectiveReferralCode,
  isCartFixableError,
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
import { CouponBox, COUPON_MUTATION_KEY, couponPreviewKey } from '@/components/coupon-box';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ReferralCodeBox } from '@/components/referral-code-box';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { OrderSuccess } from '@/components/checkout/order-success';
import { BankTransferPanel } from './bank-transfer-panel';
import { InvoiceSection } from './invoice-section';
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

// Máy chủ trả nguyên mã này (không phải câu cho khách) khi hết suất/hết giờ vàng giữa lúc thanh toán.
const PRICE_CHANGED = 'PRICE_CHANGED';

const OPTION_BASE = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border p-3 text-sm';
const optionClass = (selected: boolean) =>
  `${OPTION_BASE} ${selected ? 'border-forest-600 bg-forest-50' : 'border-stone-450 bg-stone-0'}`;
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
  // Chưa có cấu hình (đang tải, lỗi, API cũ) thì không hứa ngày giao.
  const etaLabel = configQ.data?.shippingEta ? shippingEtaLabel(configQ.data.shippingEta) : null;
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
        referralCode: effectiveReferralCode(referralApplied, sfCtx.referralCode),
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
      void qc.invalidateQueries({ queryKey: ['cart'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
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
      } else if (e instanceof Error && isCartFixableError(e.message)) {
        void qc.invalidateQueries({ queryKey: ['cart'] });
      }
    },
  });

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
          <p role="status" className="text-stone-700">
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
        <OrderSuccess order={placed} etaLabel={etaLabel} continueHref={continueHref} />
        {/* A2-02 = A6-01: đơn CHUYỂN KHOẢN hiện QR/STK/nội dung CK ngay sau khi đặt để khách trả liền;
            nếu đóng tab, trang chi tiết đơn (`/tai-khoan/don-hang/[code]`) dựng lại đúng khung này. */}
        <div className="mx-auto max-w-md">
          <BankTransferPanel order={placed} />
        </div>
      </Shell>
    );
  }

  if (cartEmpty && maybePlaced) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <h2 className="font-display text-lg font-semibold text-stone-900">Đơn của bạn có thể đã được tạo</h2>
          <p className="mt-1 text-sm text-stone-600">
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
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
            <ShoppingBag className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-stone-900">Giỏ hàng đang trống</h2>
          <p className="mt-1 text-sm text-stone-600">Chưa có sản phẩm nào để thanh toán. Chọn vài món xanh rồi quay lại nhé.</p>
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

  const cart = cartQ.data;
  const priceChanged = place.error instanceof Error && place.error.message === PRICE_CHANGED;
  const placeErrorMessage = place.error instanceof Error && !priceChanged ? place.error.message : null;
  const cartIssue = overStock
    ? overStockMessage(overStock.productName, overStock.stock)
    : placeErrorMessage && isCartFixableError(placeErrorMessage)
      ? placeErrorMessage
      : null;
  const previewSubtotal = checkoutItems.reduce((sum, it) => sum + it.total, 0);
  const paymentMethods = [
    { k: 'COD', label: 'Thanh toán khi nhận hàng (COD)' },
    { k: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng' },
    { k: 'WALLET', label: `Ví Tubu (${formatVnd(walletBalance)})` },
  ].map((m) => ({ ...m, hint: quote ? paymentUnavailableReason(m.k, quote, walletBalance) : null }));
  const paymentNote = quote && !zeroNote && payment === '' ? paymentMissingNote(quote, walletBalance) : null;
  const placeDisabled =
    !addressId || !quote || quoteStale || place.isPending || !invoiceValid || !!overStock || (!zeroNote && payment === '');
  const totalText = quote ? formatVnd(quote.total) : addressId ? '…' : 'Chưa tính';
  // Lời báo đặt lỗi/giỏ cần sửa nằm cuối khung tóm tắt; thanh dính đáy nhắc lại để khách không phải cuộn xuống mới biết vì sao.
  const barHint = cartIssue ?? (priceChanged ? 'Giá ưu đãi đã thay đổi. Vui lòng xem lại giỏ hàng trước khi đặt.' : place.isError ? (placeErrorMessage ?? 'Đặt hàng thất bại.') : null);

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
            <p className="mt-0.5">Một số sản phẩm giờ vàng đã hết suất hoặc hết giờ. Vui lòng xem lại giỏ hàng trước khi đặt.</p>
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
      <div className="grid gap-6 max-md:gap-0 md:mx-auto md:max-w-2xl lg:max-w-none lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 max-md:contents">
          <section data-mini-block="address" className={`${MINI_BAND} max-md:order-1`}>
            <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Địa chỉ giao hàng</h2>
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
              <p className="mt-2 text-sm text-forest-800">{zeroNote}</p>
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
                        <p id={`pay-blocked-${p.k}`} className="mt-1 text-xs text-stone-600">
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

          <section data-mini-block="note" className={`${MINI_BAND} max-md:order-7`}>
            <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Ghi chú cho đơn hàng</h2>
            <label className="mt-2 block">
              <span className="text-xs font-medium text-stone-700">Lời nhắn cho người giao hàng (không bắt buộc)</span>
              <textarea
                value={note}
                onChange={chosen((e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value))}
                maxLength={ORDER_NOTE_MAX}
                rows={3}
                placeholder="Ví dụ: giao giờ hành chính, gọi trước khi giao, gửi ở bảo vệ"
                disabled={place.isPending}
                aria-describedby="order-note-count"
                className={`${ui.field} mt-1 py-2`}
              />
            </label>
            <p id="order-note-count" className="mt-1 text-xs text-stone-600">
              {note.length}/{ORDER_NOTE_MAX} ký tự
            </p>
          </section>

          {pickupReq !== undefined && (
            <section id="checkout-waste-pickup" data-mini-block="waste" className={`${MINI_BAND} max-md:order-8`}>
              {pickupReq === null ? (
                <Link href="/doi-rac/tao" className="flex min-h-11 items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-3">
                    <Recycle className="h-5 w-5 text-forest-600" aria-hidden="true" />
                    <span>
                      <span className="block font-semibold text-stone-900">Thu kèm rác</span>
                      <span className="block text-xs text-stone-600">Tạo yêu cầu để bưu tá lấy rác khi giao đơn này</span>
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-stone-600">
                    ›
                  </span>
                </Link>
              ) : (
                <>
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-stone-900">
                    <span className="flex items-center gap-3">
                      <Recycle className="h-5 w-5 text-forest-600" aria-hidden="true" />
                      Thu kèm rác
                    </span>
                    <input
                      type="checkbox"
                      checked={attachWaste}
                      onChange={chosen((e: React.ChangeEvent<HTMLInputElement>) => setAttachWaste(e.target.checked))}
                      disabled={place.isPending}
                      className="h-6 w-6 shrink-0 accent-forest-600"
                    />
                  </label>
                  <div className="mt-2 rounded-control bg-stone-100 p-3 text-xs text-stone-700">
                    <p className="text-sm font-semibold text-stone-900">{pickupReq.code}</p>
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
              linkedCode={sfCtx.referralCode}
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

        {/* 9rem: khung chưa dính ở đầu trang nằm thấp hơn vị trí dính khoảng 6.5rem (tiêu đề + đường dẫn); trừ thêm để đáy khung, nơi có nút Đặt hàng, đã trong màn ngay khi chưa cuộn. */}
        <div className={`h-fit p-4 ${ui.card} max-md:contents lg:pb-0 lg:sticky lg:top-[calc(var(--header-h)+16px)] lg:max-h-[calc(100vh-var(--header-h)-9rem)] lg:self-start lg:overflow-y-auto`}>
          <h2 className={`${ui.sectionTitle} max-md:hidden`}>Đơn hàng</h2>
          {/* Giỏ một nơi giao: cuộn trong khung (focus được bằng bàn phím, axe scrollable-region-focusable). Giỏ tách kiện
              hiện hết để khách thấy đủ mọi kiện và phí giao cộng vào tổng. */}
          <div data-mini-block="items" className="max-md:order-2 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4">
          <MobileItems items={checkoutItems} shipments={split ? shipments : null} splitNote={splitNote} />
          <div
            role="region"
            aria-label="Sản phẩm trong đơn"
            tabIndex={split ? undefined : 0}
            className={`mt-2 space-y-1 text-sm max-md:hidden ${split ? '' : 'max-h-40 overflow-auto'}`}
          >
            {split
              ? shipments.map((sh) => (
                  <div key={sh.key} className="space-y-1 border-b border-stone-200 pb-2 last:border-b-0">
                    <p className="text-xs font-semibold text-stone-900">{fulfillerLabel(sh.fulfiller)}</p>
                    {checkoutItems
                      .filter((it) => sh.itemIds.includes(it.id))
                      .map((it) => (
                        <div key={it.id} className="flex justify-between gap-2">
                          <span className="text-stone-600">{it.productName} ×{it.quantity}</span>
                          <span className="text-stone-900">{formatVnd(it.total)}</span>
                        </div>
                      ))}
                    <div className="flex justify-between gap-2 text-xs text-stone-600">
                      <span>Phí giao</span>
                      <span>{sh.shippingFee === 0 ? 'Miễn phí' : formatVnd(sh.shippingFee)}</span>
                    </div>
                  </div>
                ))
              : checkoutItems.map((it) => (
                  <div key={it.id} className="flex justify-between gap-2">
                    <span className="text-stone-600">{it.productName} ×{it.quantity}</span>
                    <span className="text-stone-900">{formatVnd(it.total)}</span>
                  </div>
                ))}
          </div>
          {itemIds && cart && (
            <p className="mt-2 text-xs text-stone-600">
              Đang thanh toán {itemIds.length}/{cart.items.length} sản phẩm trong giỏ.{' '}
              <Link href="/gio-hang" className="font-semibold text-forest-700 underline">
                Đổi lựa chọn
              </Link>
            </p>
          )}
          {splitNote && <p className="mt-2 text-xs text-stone-600 max-md:hidden">{splitNote}</p>}
          </div>
          <div data-mini-block="summary" className="max-md:order-10 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pt-4">
          <h2 className="mb-2.5 hidden font-ui text-sm font-semibold max-md:block">Tóm tắt đơn hàng</h2>
          <Row label="Tạm tính" value={formatVnd(quote?.subtotal ?? previewSubtotal)} />
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
                actionLabel="Xem mã"
                currentCode={cart.couponCode}
                appliedDiscount={quote?.discount ?? 0}
                subtotal={previewSubtotal}
                shippingFee={quote?.shippingFee ?? null}
                notice={quote ? quote.couponNotice : cart.couponNotice}
                disabled={place.isPending}
                preview={checkoutItems.length > 0 ? { ...(addressId ? { addressId } : {}), storefrontSlug: ctvSlug, itemIds } : undefined}
                previewKey={couponPreviewKey(checkoutItems)}
              />
            </div>
          )}
          <div data-mini-block="points" className="max-md:order-6 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4 max-md:empty:hidden">
          {usablePoints > 0 && (
            <label
              className={`relative mt-3 flex min-h-11 items-center gap-2 rounded-control border border-forest-200 bg-forest-50 p-3 text-sm max-md:mt-0 max-md:flex-row-reverse max-md:justify-between max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 ${
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
              <span className="text-forest-800">
                {usePoints && quote
                  ? `Dùng ${quote.pointsUsed.toLocaleString('vi-VN')} Điểm Xanh — giảm ${formatVnd(quote.pointsDiscount)}`
                  : `Bạn có ${usablePoints.toLocaleString('vi-VN')} Điểm Xanh`}
              </span>
            </label>
          )}
          {usablePoints > 0 && partnerPoints.capNote && <p className="mt-1 text-xs text-stone-600">{partnerPoints.capNote}</p>}
          {usablePoints > 0 && partnerPoints.partnerNote && <p className="mt-1 text-xs text-stone-600">{partnerPoints.partnerNote}</p>}
          {convertedLine && <p className="mt-1 text-xs text-stone-600">{convertedLine}</p>}
          {pointsOffer.lockNote && <p className="mt-1 text-xs text-stone-600">{pointsOffer.lockNote}</p>}
          </div>
          <div data-mini-part="summary-total" className="max-md:order-11 max-md:bg-[var(--color-bg-surface)] max-md:px-4">
          <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900 max-md:mt-0 max-md:border-t-0 max-md:pt-1 lg:hidden">
            <span>Tổng cộng</span>
            {/* Đang tải/đang lỗi thì hiện "…" thay vì 0đ: con số 0 đứng yên cạnh dòng báo lỗi
                trông như đơn không mất tiền. */}
            <span>{totalText}</span>
          </div>
          {quote && quote.pointsEarned > 0 && (
            <p className="mt-1 text-xs text-success-fg">Nhận +{formatCount(quote.pointsEarned)} Điểm Xanh khi giao thành công</p>
          )}
          {quoteQ.isError && (
            <p className={`mt-2 ${ui.error}`}>
              {quoteQ.error instanceof ApiError && quoteQ.error.code === 'ADDRESS_OUTDATED'
                ? `${quoteQ.error.message} Hãy bấm Sửa ở địa chỉ đó để chọn lại tỉnh/phường, hoặc thêm địa chỉ mới.`
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

          {/* Dưới lg nút đặt hàng nằm ở thanh dính đáy (cuối trang); từ lg giữ ở khung tóm tắt dính bên phải, dính đáy khung để màn thấp (1366×768) vẫn thấy nút và lỗi đặt hàng. */}
          </div>
          {/* Con trực tiếp của khung cuộn (không nằm trong khối tổng): sticky chỉ trượt trong khối cha của nó. Điện thoại giữ thứ tự và đệm cũ. */}
          <div data-mini-part="place-order" className="max-md:order-11 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pb-4 lg:sticky lg:bottom-0 lg:bg-stone-0 lg:py-4">
          {/* Bản sao hiển thị của dòng Tổng cộng: khung tóm tắt cuộn được nên dòng gốc có thể trượt khỏi màn, tổng tiền phải luôn nằm cạnh nút Đặt hàng. */}
          <div aria-hidden="true" className="mb-3 hidden justify-between border-t border-stone-200 pt-3 font-bold text-stone-900 lg:flex">
            <span>Tổng cộng</span>
            <span>{totalText}</span>
          </div>
          <OrderConsent className="hidden lg:block" />
          <button
            type="button"
            onClick={() => place.mutate()}
            disabled={placeDisabled}
            className={`${ui.btnPrimary} mt-2 hidden w-full lg:inline-flex`}
          >
            {place.isPending ? 'Đang đặt hàng…' : 'Đặt hàng'}
          </button>
          {place.isError && !priceChanged && !(placeErrorMessage && isCartFixableError(placeErrorMessage)) && (
            <div role="alert" className={`mt-2 ${ui.error}`}>
              <p>{placeErrorMessage ?? 'Đặt hàng thất bại.'}</p>
              {isOutcomeUnknown(place.error) && (
                <p className="mt-1 text-stone-700">
                  Đơn có thể đã được ghi nhận. Bấm Đặt hàng lần nữa để thử lại — hệ thống nhận ra yêu cầu trùng nên không tạo thêm đơn. Hoặc xem{' '}
                  <Link href="/tai-khoan/don-hang" className="font-semibold text-forest-700 underline">
                    Đơn của tôi
                  </Link>
                  .
                </p>
              )}
              {place.error?.message === PREVIOUS_MAYBE_PLACED && (
                <p className="mt-1 text-stone-700">
                  Nếu đơn trước chưa có trong{' '}
                  <Link href="/tai-khoan/don-hang" className="font-semibold text-forest-700 underline">
                    Đơn của tôi
                  </Link>
                  , bấm Đặt hàng lần nữa để đặt đơn mới với lựa chọn hiện tại.
                </p>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
      <StickyActionBar label="Đặt hàng" hideFrom="lg">
        {barHint && (
          <p aria-hidden="true" className="mb-2 text-xs text-danger-fg">
            {barHint}
          </p>
        )}
        <OrderConsent className="mb-2" />
        <button
          type="button"
          onClick={() => place.mutate()}
          disabled={placeDisabled}
          className={`${uiBar.primary} w-full`}
        >
          {place.isPending ? 'Đang đặt hàng…' : quote ? `Đặt hàng · ${formatVnd(quote.total)}` : 'Đặt hàng'}
        </button>
      </StickyActionBar>
    </Shell>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className={`mt-1 flex justify-between text-sm ${green ? 'text-success-fg' : 'text-stone-900'}`}>
      <span className={green ? '' : 'text-stone-600'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AddressPicker({
  addresses,
  selectedId,
  quoteOutdated,
  onSelect,
  onCreated,
  onUpdated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
  quoteOutdated: boolean;
  onSelect: (id: string) => void;
  onCreated: (a: AddressDTO) => void;
  onUpdated: (a: AddressDTO) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="mt-2 space-y-2">
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
            <label className={`${addressOptionClass(selectedId === a.id)} min-w-0 flex-1 items-start max-md:block`}>
              <input
                type="radio"
                name="addr"
                checked={selectedId === a.id}
                onChange={() => onSelect(a.id)}
                className={`${miniRadio} max-md:sr-only`}
              />
              <span className="min-w-0 break-words">
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <span className="font-medium text-stone-900 max-md:font-semibold">{a.recipient} · {a.phone}</span>
                  {a.isDefault && (
                    <span className="rounded-full bg-[var(--color-action-secondary-bg)] px-2 py-[3px] text-xs font-semibold text-[color:var(--color-action-secondary-fg)]">
                      Mặc định
                    </span>
                  )}
                </span>
                <br />
                <span className="text-stone-600">{[a.street, a.ward, a.district, a.province].filter(Boolean).join(', ')}</span>
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
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest-700 hover:underline"
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
            <Link href="/tai-khoan/dia-chi" className="inline-flex min-h-11 items-center text-sm text-stone-700 hover:underline max-md:hidden">
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

// Khối "Sản phẩm (n)" của Mini App (checkout.tsx): ảnh 48px, tên một dòng, phân loại, đơn giá × số lượng, thành tiền. Chỉ hiện ở điện thoại;
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
      {splitNote && <p className="mt-2.5 text-xs text-[color:var(--color-text-secondary)]">{splitNote}</p>}
      <div className="mt-2.5 space-y-3">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.shipment ? fulfillerLabel(g.shipment.fulfiller) : 'Sản phẩm sẽ mua'}>
            {g.shipment && <p className="mb-2 text-sm font-semibold">{fulfillerLabel(g.shipment.fulfiller)}</p>}
            <div className="space-y-3">
              {g.lines.map((it) => (
                <div key={it.id} className="flex items-center gap-2.5">
                  <ProductThumb src={it.thumbnail} alt={it.productName} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{it.productName}</div>
                    {it.variationName && <div className="text-xs text-[color:var(--color-text-tertiary)]">{it.variationName}</div>}
                    <div className="text-xs text-[color:var(--color-text-tertiary)]">
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
