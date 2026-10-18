'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Recycle, ShoppingBag } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { getWasteMe, WASTE_QUERY_KEYS } from '@tubutree/app-core/api/waste';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { AddressForm } from '@/components/address-form';
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
  type OrderDTO,
} from '@/lib/shop-client';
import { ctvSlugFor, getStorefrontContext } from '@/lib/storefront-context';
import { checkoutPointsOffer, convertedPointsLine, pointsCapState, zeroTotalNote, type CheckoutPointsOffer } from '@/lib/checkout-points';
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
import { orderDetailHref } from '@/lib/order-view';
import { ui, uiBar } from '@/lib/guest-ui';
import { invalidateBalances } from '@/lib/balances';
import { ApiError, NetworkError } from '@/lib/client-api';
import { CouponBox, COUPON_MUTATION_KEY, couponPreviewKey } from '@/components/coupon-box';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ReferralCodeBox } from '@/components/referral-code-box';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { BankTransferPanel } from './bank-transfer-panel';
import { InvoiceSection } from './invoice-section';
import { EMPTY_INVOICE, loadSavedInvoice, saveInvoice } from '@/lib/saved-invoice';
import { fulfillerLabel, shipmentsNote } from '@/lib/shipments';
import { useCartKey } from '@/lib/cart-key';
import { createOrderKeyRing } from '@/lib/order-key-ring';
import { attachablePickup, isOutcomeUnknown } from '@/lib/checkout-waste';
import { coreHttp } from '@/lib/core-http';

// Máy chủ trả nguyên mã này (không phải câu cho khách) khi hết suất/hết giờ vàng giữa lúc thanh toán.
const PRICE_CHANGED = 'PRICE_CHANGED';

const OPTION_BASE = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-control border p-3 text-sm';
const optionClass = (selected: boolean) =>
  `${OPTION_BASE} ${selected ? 'border-forest-600 bg-forest-50' : 'border-stone-450 bg-stone-0'}`;

export default function CheckoutPage() {
  const phase = useAuthPhase();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [note, setNote] = useState('');
  const [wantInvoice, setWantInvoice] = useState(false);
  const [invoice, setInvoice] = useState(EMPTY_INVOICE);
  // Mã giới thiệu khách tự nhập ở đây (đã được server xác nhận) khác mã đến từ link gian hàng (sfCtx).
  const [referralApplied, setReferralApplied] = useState<string | null>(null);
  const [attachWaste, setAttachWaste] = useState(false);
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
  // Một key cho một nội dung đơn trong phiên thanh toán: bấm lại sau lỗi mạng gửi lại cùng đơn; đổi nội dung thì key mới.
  const orderKeys = useRef(createOrderKeyRing());

  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: phase === 'authenticated' });
  // Số dư Ví Tubu lấy từ máy chủ (không từ ảnh chụp lúc đăng nhập): khách vừa được hoàn tiền về ví hoặc vừa tiêu ví
  // ở Mini App sẽ thấy đúng số, thay vì chọn được rồi bị từ chối "số dư không đủ".
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: phase === 'authenticated' });
  const walletBalance = meQ.data?.walletBalance ?? user?.walletBalance ?? 0;
  // Chỉ hiện "Thu kèm rác" khi cờ pickup đã bật thật từ máy chủ; chưa tải xong thì ẩn, không hứa dịch vụ chưa chắc có.
  const configQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const pickupFlag = configQ.data?.waste?.pickup === true;
  const wasteMeQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.me,
    queryFn: () => getWasteMe(coreHttp),
    enabled: phase === 'authenticated' && pickupFlag,
  });
  const pickupReq = attachablePickup(wasteMeQ.data, pickupFlag);

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

  const place = useMutation({
    mutationFn: () => {
      const body = {
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
      return placeOrder(body, orderKeys.current.keyFor(body));
    },
    onSuccess: (order) => {
      orderKeys.current.reset();
      setPlaced(order);
      if (wantInvoice) saveInvoice(userId, invoice);
      clearCheckoutSelection();
      void qc.invalidateQueries({ queryKey: ['cart'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      if (attachWaste && pickupReq) void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.all });
      // Điểm Xanh đã tiêu/tích và tiền ví đã trừ: các số dư và sổ cái đang cache đều cũ.
      invalidateBalances(qc);
    },
    onError: (e) => {
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

  if (placed) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
            <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
          </div>
          <h2 className="mt-5 font-display text-2xl font-semibold text-stone-900">Đặt hàng thành công!</h2>
          {placed.splitOrders && placed.splitOrders.length > 1 ? (
            <div className="mx-auto mt-3 max-w-md text-left">
              <p className="text-center text-stone-700">Hàng do nhiều nơi giao nên được tách thành {placed.splitOrders.length} đơn:</p>
              <ul className="mt-2 space-y-2">
                {placed.splitOrders.map((o) => (
                  <li key={o.code} className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${ui.card}`}>
                    <span>
                      <Link href={orderDetailHref(o.code)} className="font-semibold text-forest-700 underline">
                        {o.code}
                      </Link>{' '}
                      · {o.fulfillerName} giao
                    </span>
                    <span className="font-semibold text-stone-900">{formatVnd(o.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-stone-700">
              Mã đơn <span className="font-semibold text-forest-700">{placed.code}</span> · {formatVnd(placed.total)}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={orderDetailHref(placed.code)} className={ui.btnPrimary}>
              Xem chi tiết đơn
            </Link>
            <Link href="/tai-khoan" className={ui.btnSecondary}>
              Đơn của tôi
            </Link>
            <Link href="/" className={ui.btnSecondary}>
              Tiếp tục mua sắm
            </Link>
          </div>
        </div>
        {/* A2-02 = A6-01: đơn CHUYỂN KHOẢN hiện QR/STK/nội dung CK ngay sau khi đặt để khách trả liền;
            nếu đóng tab, trang chi tiết đơn (`/tai-khoan/don-hang/[code]`) dựng lại đúng khung này. */}
        <div className="mx-auto max-w-md">
          <BankTransferPanel order={placed} />
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
            <Link href="/tai-khoan" className={ui.btnSecondary}>
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
      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <section className={`p-4 ${ui.card}`}>
            <h2 className={ui.sectionTitle}>Địa chỉ giao hàng</h2>
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
              onSelect={setAddressId}
              onCreated={(a) => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                setAddressId(a.id);
              }}
              onUpdated={() => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                void qc.invalidateQueries({ queryKey: ['quote'] });
              }}
            />
          </section>

          <section className={`p-4 ${ui.card}`}>
            <h2 className={ui.sectionTitle}>Phương thức thanh toán</h2>
            {zeroNote ? (
              <p className="mt-2 text-sm text-forest-800">{zeroNote}</p>
            ) : (
              <div className="mt-2 space-y-2">
                {paymentMethods.map((p) => {
                  const reason = p.hint;
                  return (
                    <div key={p.k}>
                      <label className={`${optionClass(payment === p.k)} ${reason ? 'cursor-not-allowed opacity-60' : ''}`}>
                        <input
                          type="radio"
                          name="pay"
                          checked={payment === p.k}
                          onChange={() => setPayment(p.k)}
                          disabled={!!reason}
                          aria-describedby={reason ? `pay-blocked-${p.k}` : undefined}
                          className="h-6 w-6 shrink-0 accent-forest-600"
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

          <section className={`p-4 ${ui.card}`}>
            <h2 className={ui.sectionTitle}>Ghi chú cho đơn hàng</h2>
            <label className="mt-2 block">
              <span className="text-xs font-medium text-stone-700">Lời nhắn cho người giao hàng (không bắt buộc)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
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
            <section id="checkout-waste-pickup" className={`p-4 ${ui.card}`}>
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
                      onChange={(e) => setAttachWaste(e.target.checked)}
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

          <ReferralCodeBox
            linkedCode={sfCtx.referralCode}
            appliedCode={referralApplied}
            onApplied={setReferralApplied}
            disabled={place.isPending}
          />

          <InvoiceSection
            want={wantInvoice}
            onWant={setWantInvoice}
            invoice={invoice}
            onInvoice={setInvoice}
            valid={invoiceValid}
            disabled={place.isPending}
          />
        </div>

        <div className={`h-fit p-4 ${ui.card}`}>
          <h2 className={ui.sectionTitle}>Đơn hàng</h2>
          {/* Giỏ một nơi giao: cuộn trong khung (focus được bằng bàn phím, axe scrollable-region-focusable). Giỏ tách kiện
              hiện hết để khách thấy đủ mọi kiện và phí giao cộng vào tổng. */}
          <div
            role="region"
            aria-label="Sản phẩm trong đơn"
            tabIndex={split ? undefined : 0}
            className={`mt-2 space-y-1 text-sm ${split ? '' : 'max-h-40 overflow-auto'}`}
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
          {splitNote && <p className="mt-2 text-xs text-stone-600">{splitNote}</p>}
          <Row label="Tạm tính" value={formatVnd(quote?.subtotal ?? previewSubtotal)} />
          {(quote?.discount ?? 0) > 0 && (
            <Row label={`Giảm giá${cart?.couponCode ? ` (${cart.couponCode})` : ''}`} value={`-${formatVnd(quote!.discount)}`} green />
          )}
          {(quote?.comboDiscount ?? 0) > 0 && <Row label="Ưu đãi combo" value={`-${formatVnd(quote!.comboDiscount!)}`} green />}
          {(quote?.tierDiscount ?? 0) > 0 && (
            <Row label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote!.tierDiscount!)}`} green />
          )}
          {(quote?.pointsDiscount ?? 0) > 0 && (
            <Row label={`Điểm Xanh (${quote!.pointsUsed})`} value={`-${formatVnd(quote!.pointsDiscount)}`} green />
          )}
          <Row
            label="Phí vận chuyển"
            value={quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : addressId ? '…' : 'Nhập địa chỉ để tính phí'}
          />
          {cart && (
            <CouponBox
              currentCode={cart.couponCode}
              subtotal={previewSubtotal}
              shippingFee={quote?.shippingFee ?? null}
              notice={quote ? quote.couponNotice : cart.couponNotice}
              disabled={place.isPending}
              preview={checkoutItems.length > 0 ? { ...(addressId ? { addressId } : {}), storefrontSlug: ctvSlug, itemIds } : undefined}
              previewKey={couponPreviewKey(checkoutItems)}
            />
          )}
          {usablePoints > 0 && (
            <label
              className={`mt-3 flex min-h-11 items-center gap-2 rounded-control border border-forest-200 bg-forest-50 p-3 text-sm ${
                partnerPoints.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={usePoints && !partnerPoints.disabled}
                disabled={partnerPoints.disabled}
                onChange={(e) => setUsePoints(e.target.checked)}
                className="h-6 w-6 shrink-0 accent-forest-600"
              />
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
          <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900">
            <span>Tổng cộng</span>
            {/* Đang tải/đang lỗi thì hiện "…" thay vì 0đ: con số 0 đứng yên cạnh dòng báo lỗi
                trông như đơn không mất tiền. */}
            <span>{totalText}</span>
          </div>
          {quote && quote.pointsEarned > 0 && (
            <p className="mt-1 text-xs text-success-fg">+{quote.pointsEarned} Điểm Xanh sau khi giao</p>
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

          {/* Dưới md nút đặt hàng nằm ở thanh dính đáy (cuối trang); từ md giữ ở khung tóm tắt. */}
          <button
            type="button"
            onClick={() => place.mutate()}
            disabled={placeDisabled}
            className={`${ui.btnPrimary} mt-4 hidden w-full md:inline-flex`}
          >
            {place.isPending ? 'Đang đặt hàng…' : 'Đặt hàng'}
          </button>
          {place.isError && !priceChanged && !(placeErrorMessage && isCartFixableError(placeErrorMessage)) && (
            <div role="alert" className={`mt-2 ${ui.error}`}>
              <p>{placeErrorMessage ?? 'Đặt hàng thất bại.'}</p>
              {place.error instanceof NetworkError && (
                <p className="mt-1 text-stone-700">
                  Đơn có thể đã được ghi nhận. Bấm Đặt hàng lần nữa để thử lại — hệ thống nhận ra yêu cầu trùng nên không tạo thêm đơn. Hoặc xem{' '}
                  <Link href="/tai-khoan" className="font-semibold text-forest-700 underline">
                    Đơn của tôi
                  </Link>
                  .
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <StickyActionBar label="Đặt hàng">
        {barHint && (
          <p aria-hidden="true" className="mb-2 text-xs text-danger-fg">
            {barHint}
          </p>
        )}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-none">
            <div className="text-xs text-stone-600">Tổng cộng</div>
            <div className="text-lg font-bold leading-tight text-stone-900">{totalText}</div>
          </div>
          <button
            type="button"
            onClick={() => place.mutate()}
            disabled={placeDisabled}
            className={`${uiBar.primary} min-w-0 flex-1`}
          >
            {place.isPending ? 'Đang đặt hàng…' : quote ? `Đặt hàng · ${formatVnd(quote.total)}` : 'Đặt hàng'}
          </button>
        </div>
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
  onSelect,
  onCreated,
  onUpdated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
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
          <div key={a.id} className="flex items-start gap-1">
            <label className={`${optionClass(selectedId === a.id)} min-w-0 flex-1 items-start`}>
              <input
                type="radio"
                name="addr"
                checked={selectedId === a.id}
                onChange={() => onSelect(a.id)}
                className="h-6 w-6 shrink-0 accent-forest-600"
              />
              <span className="min-w-0 break-words">
                <span className="font-medium text-stone-900">{a.recipient} · {a.phone}</span>
                <br />
                <span className="text-stone-600">{[a.street, a.ward, a.district, a.province].filter(Boolean).join(', ')}</span>
                {isLegacyGeo(a) && (
                  <>
                    <br />
                    <span className="text-xs font-medium text-warning-fg">
                      Địa giới cũ (trước khi sắp xếp tỉnh/phường 2025) — chưa giao được, bấm Sửa để chọn lại tỉnh/phường.
                    </span>
                  </>
                )}
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setEditingId(a.id);
              }}
              aria-label={`Sửa địa chỉ của ${a.recipient}`}
              className={ui.btnText}
            >
              Sửa
            </button>
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
            className="inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 hover:underline"
          >
            + Thêm địa chỉ mới
          </button>
          {addresses.length > 0 && (
            <Link href="/tai-khoan/dia-chi" className="inline-flex min-h-11 items-center text-sm text-stone-700 hover:underline">
              Quản lý sổ địa chỉ
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/gio-hang" className={ui.backLink}>
        ← Về giỏ hàng
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>Thanh toán</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}
