import { useEffect, useRef, useState } from 'react';
import { Box, Page, Text, Input, useNavigate, useLocation, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, ChevronRight, Sprout, AlertCircle, Recycle } from 'lucide-react';
import { getAddresses, getCart, checkoutQuote, placeOrder, type PlacedOrder } from '../services/shop-api';
import { cartPreviewKey, cartProductIds } from '../utils/coupon-scope';
import { fulfillerLabel, shipmentsNote } from '../utils/shipments';
import { getWallet, getLoyalty } from '../services/account-api';
import { getErrorCode, getErrorMessage } from '../services/api';
import { trackEvent } from '../services/analytics';
import { useAuthStore } from '../store/auth';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useStorefrontContext } from '../store/storefront-context';
import { AddressSection } from '../components/checkout/address-section';
import { OrderSuccess } from '../components/checkout/order-success';
import { VoucherSheet } from '../components/checkout/voucher-sheet';
import { ReferralCodeBox, effectiveReferralCode } from '../components/checkout/referral-code-box';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { formatVnd, recyclingCheckoutFields, recyclingMaxKg } from '../utils/format';
import { usePublicConfig } from '../hooks/use-public-config';
import { createOrderKeyRing } from '../utils/idempotency';
import {
  checkoutPoints,
  isInvoiceValid,
  paymentMissingNote,
  paymentUnavailableReason,
  pickPaymentMethod,
  pointsCapState,
  pointsEarnLabel,
  pointsUseLabel,
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
import { PageHeader } from '../components/ui/page-header';
import { ProductThumb } from '../components/ui/product-thumb';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Radio, Checkbox } from '../components/ui/form';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { KeyValueRow } from '../components/ui/key-value-row';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Button } from '../components/ui/button';
import { useCartKey } from '../services/cart-key';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
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
  const [hasRecyclingPickup, setHasRecyclingPickup] = useState(false);
  const [recyclingNote, setRecyclingNote] = useState('');
  // Chỉ hiện lựa chọn thu gom khi BE xác nhận tính năng đang chạy (Gomdon đã cấu hình + admin bật).
  // Chưa tải xong / API cũ không có field → coi như tắt: không hứa thu gom khi không ai đi thu.
  const publicConfig = usePublicConfig();
  const recyclingEnabled = publicConfig.isLoaded && publicConfig.recyclingEnabled === true;
  const [voucherSheetOpen, setVoucherSheetOpen] = useState(false);
  // Mã giới thiệu CTV khách tự nhập ở màn này (đã được server xác nhận) — khác mã đến từ link (sfCtx).
  const [referralApplied, setReferralApplied] = useState<string | null>(null);
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
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

  // Guard auth: tránh gọi /cart, /me/addresses khi chưa silent-login xong (deeplink → 401).
  const cart = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: authed });
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
  const itemIds = reconcileSelection(rawSelection, (cart.data?.items ?? []).map((it) => it.id));
  const itemIdsKey = itemIds ? itemIds.join(',') : '';

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
  const quote = useQuery({
    queryKey: ['quote', addressId, pointsToUse, ctvSlug, itemIdsKey],
    queryFn: () => checkoutQuote(addressId!, pointsToUse, ctvSlug, itemIds),
    enabled: !!addressId && authed && cartReady && cartHasItems,
  });

  // Giỏ có hàng của gian hàng đối tác: Điểm Xanh chỉ trả cho hàng Tubu (trần của đơn + câu giải thích; giỏ chỉ hàng đối tác thì tắt).
  const partnerPoints = pointsCapState(quote.data, points.usable);
  const pointsUsable = points.usable > 0 && !partnerPoints.disabled;
  useEffect(() => {
    if (partnerPoints.disabled && usePoints) setUsePoints(false);
  }, [partnerPoints.disabled, usePoints]);

  const invoiceValid = isInvoiceValid(wantInvoice, invoice);

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

  const order = useMutation({
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
        // Chỉ gửi khi bật + chọn (body mặc định y hệt bản cũ — xem recyclingCheckoutFields).
        ...recyclingCheckoutFields(recyclingEnabled, hasRecyclingPickup, recyclingNote),
        invoiceRequest: wantInvoice
          ? {
              taxCode: invoice.taxCode.trim(),
              companyName: invoice.companyName.trim(),
              address: invoice.address.trim(),
              email: invoice.email.trim(),
            }
          : undefined,
        referralCode: effectiveReferralCode(referralApplied, sfCtx.referralCode),
        storefrontSlug: ctvSlug,
        itemIds,
      };
      return placeOrder(body, orderKeys.current.keyFor(body));
    },
    onSuccess: (o) => {
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
      // Thanh toán WALLET trừ walletBalance và sử dụng điểm cộng/trừ pointsBalance ở BE;
      // staleTime=60s global → wallet/profile sẽ stale 60s nếu không invalidate → user thấy số cũ.
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      // Điểm Xanh đọc từ ['loyalty'] (nguồn số dư dùng ở chính màn này) — đơn vừa tiêu/tích điểm.
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      // Refresh auth store (user.walletBalance / pointsBalance dùng ở header/checkout) để UI đồng bộ.
      void useAuthStore.getState().restore().catch(() => undefined);
      orderKeys.current.reset(); // đơn sau là đơn mới
      clearCheckoutSelection(); // lựa chọn của đơn vừa đặt không được dính sang đơn sau
      // Chuyển khoản: sang màn VietQR để khách quét trả ngay (Pancake đối soát → tự xác nhận).
      if (paymentToSend === 'BANK_TRANSFER') {
        navigate(`/bank-payment/${o.code}`, { replace: true });
        return;
      }
      setPlaced(o);
    },
    onError: (e: unknown) => {
      // Giữ key: lỗi mạng/quá thời gian/5xx có thể xảy ra sau khi server đã tạo đơn — bấm lại cùng nội dung phải là replay,
      // không phải đơn thứ hai. Khách sửa địa chỉ/thanh toán/món thì keyFor tự ra key mới.
      if (getErrorCode(e) === 'CART_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: ['cart'] });
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['quote'] });
        openSnackbar({ text: getErrorMessage(e), type: 'error' });
        return;
      }
      if (getErrorMessage(e) === 'PRICE_CHANGED') {
        setPriceChanged(true);
        return;
      }
      if (getErrorCode(e) === 'TOTAL_CHANGED') {
        setTotalChanged(getErrorMessage(e));
        void queryClient.invalidateQueries({ queryKey: ['quote'] });
        void queryClient.invalidateQueries({ queryKey: ['cart'] });
        return;
      }
      if (isCartFixableError(getErrorMessage(e))) {
        setCartIssue(getErrorMessage(e));
        void queryClient.invalidateQueries({ queryKey: ['cart'] });
        return;
      }
      // Báo giá đang cache còn cho cách vừa bị từ chối (vd nơi giao đổi sau lúc báo giá): tải lại để khoá đúng cách đó và tự chọn
      // cách khác, không thì bấm lại bao nhiêu lần cũng nhận cùng lỗi. Nơi giao đổi thường vì giỏ đổi ở nơi khác: kiện của báo giá
      // mới lấy món từ giỏ đang cache, nên tải lại cả giỏ, không thì kiện mới hiện ra không có món nào.
      if (getErrorCode(e) === 'PAYMENT_METHOD_NOT_ALLOWED') {
        void queryClient.invalidateQueries({ queryKey: ['quote'] });
        void queryClient.invalidateQueries({ queryKey: ['cart'] });
      }
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

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
    const retry = () => {
      if (cartFailed) void cart.refetch();
      if (addressesFailed) void addresses.refetch();
    };
    return (
      <Shell>
        <ErrorState message={getErrorMessage(err)} onRetry={retry} />
      </Shell>
    );
  }

  // Giỏ trống (vd mở từ deeplink) → không cho đặt đơn rỗng.
  if ((cart.data?.items.length ?? 0) === 0) {
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
  const checkoutItems = itemIds
    ? (cart.data?.items ?? []).filter((it) => itemIds.includes(it.id))
    : (cart.data?.items ?? []);
  const overStockLine = checkoutItems.find((it) => it.quantity > it.stock);
  const shownCartIssue = overStockLine ? vi.checkout.overStock(overStockLine.productName, overStockLine.stock) : cartIssue;
  const canPlace = !!addressId && quote.isSuccess && !quote.isFetching && !!invoiceValid && !overStockLine && (!!zeroNote || payment !== '');

  // Chưa có báo giá (chưa chọn địa chỉ) thì chưa biết tổng đơn → chưa khoá, chưa có lý do.
  const paymentMethods = [
    { value: 'COD', label: vi.checkout.paymentCod },
    // ZALOPAY tạm ẨN: chưa nối cổng thanh toán thật → nếu hiện, bấm đặt sẽ ra "thành công"
    // mà KHÔNG thu tiền (như COD) → đơn treo/sai đối soát. Mở lại khi tích hợp Payment API Zalo.
    { value: 'BANK_TRANSFER', label: vi.checkout.paymentBank },
    { value: 'WALLET', label: vi.checkout.paymentWallet(formatVnd(walletBalance)) },
  ].map((m) => {
    const hint = quote.isSuccess ? paymentUnavailableReason(m.value, quote.data, walletBalance) : null;
    return { ...m, hint, disabled: hint !== null };
  });
  const paymentNote = quote.isSuccess && !zeroNote && payment === '' ? paymentMissingNote(quote.data, walletBalance) : null;
  // Mỗi nơi giao thành một đơn riêng (D4): chia danh sách món và phí giao theo kiện máy chủ báo.
  const shipments = quote.data?.shipments ?? [];
  const split = shipments.length > 1 || shipments.some((sh) => sh.fulfiller.kind === 'MERCHANT');
  const splitNote = shipmentsNote(shipments);

  const shownItems = itemIds
    ? (cart.data?.items ?? []).filter((it) => itemIds.includes(it.id))
    : (cart.data?.items ?? []);
  const previewSubtotal = shownItems.reduce((s, it) => s + it.total, 0);
  // Chưa có báo giá: tiền hàng trừ combo (chỉ khi mua cả giỏ — chọn một phần thì máy chủ tính lại) rồi trừ mã, như checkout trừ.
  const previewCombo = itemIds ? 0 : (cart.data?.comboDiscount ?? 0);
  const previewDiscount = cart.data?.couponCode ? (cart.data.discount ?? 0) : 0;
  const maxRecycleKg = recyclingMaxKg(shownItems);

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 96 }}>
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

      <AddressSection
        addresses={addresses.data ?? []}
        selectedId={addressId}
        onSelect={setAddressId}
      />

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
                  <Text size="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.productName}</Text>
                  {it.variationName && (
                    <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                      {typeof it.variationName === 'object' && it.variationName !== null
                        ? (it.variationName as { name?: string }).name ?? ''
                        : String(it.variationName)}
                    </Text>
                  )}
                  <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                    {formatVnd(it.unitPrice)} × {it.quantity}
                  </Text>
                </Box>
                <Text size="small" bold style={{ whiteSpace: 'nowrap' }}>{formatVnd(it.total)}</Text>
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
          onClick={() => {
            haptic('light');
            setVoucherSheetOpen(true);
          }}
          flex
          alignItems="center"
          justifyContent="space-between"
          style={{ cursor: 'pointer', minHeight: 44 }}
        >
          <Box flex alignItems="center" style={{ gap: 10 }}>
            <Box
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-control)',
                background: 'var(--clay-50)',
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 auto',
              }}
            >
              <Ticket size={20} color="var(--clay-700)" />
            </Box>
            <Box>
              <Text bold size="small" style={{ color: 'var(--color-text-primary)' }}>
                Mã giảm giá
              </Text>
              {cart.data?.couponCode ? (
                <Box flex alignItems="center" style={{ gap: 8, marginTop: 2 }}>
                  <span
                    style={{
                      background: 'var(--clay-50)',
                      border: '1px dashed var(--clay-500)',
                      borderRadius: 'var(--radius-control)',
                      padding: '2px 6px',
                      color: 'var(--clay-700)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {cart.data.couponCode}
                  </span>
                  {quote.data && quote.data.discount > 0 && (
                    <Text size="xSmall" style={{ color: 'var(--color-text-success)' }}>
                      -{formatVnd(quote.data.discount)}
                    </Text>
                  )}
                </Box>
              ) : (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  Chọn hoặc nhập mã giảm giá
                </Text>
              )}
            </Box>
          </Box>

          <Box flex alignItems="center" style={{ gap: 4, color: 'var(--color-text-brand)' }}>
            <Text size="xSmall" bold style={{ color: 'var(--color-text-brand)' }}>
              {cart.data?.couponCode ? 'Thay đổi' : 'Xem mã'}
            </Text>
            <ChevronRight size={16} color="var(--color-text-brand)" />
          </Box>
        </Box>
        {cart.data?.couponCode && (quote.data?.couponNotice ?? cart.data.couponNotice) && (
          <Text
            size="xSmall"
            role="status"
            data-testid="coupon-notice"
            style={{ color: 'var(--color-text-warning)', marginTop: 6 }}
          >
            {quote.data?.couponNotice ?? cart.data.couponNotice}
          </Text>
        )}
      </Box>

      {/* Chỉ coi là mã gắn sẵn khi đúng là mã CTV: slug gian hàng nhãn/cửa hàng không phải mã giới thiệu và không được gửi kèm đơn. */}
      <ReferralCodeBox
        linkedCode={sfCtx.referralCode}
        appliedCode={referralApplied}
        onApplied={setReferralApplied}
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
              setPayment(m.value);
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
                {points.usable > 0 && usePoints && quote.data
                  ? pointsUseLabel(quote.data.pointsUsed, formatVnd(quote.data.pointsDiscount))
                  : (points.label ?? vi.checkout.pointsNone)}
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
      <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.checkout.note}
        </Text>
        <Input placeholder={vi.checkout.notePlaceholder} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Box>

      {/* ── Thu gom vật liệu tái chế (Eco-Card) — chỉ khi tính năng đang bật ── */}
      {recyclingEnabled && (
        <Box id="checkout-recycling" p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
          <Box
            role="checkbox"
            {...rowKeyboardProps()}
            aria-label="Gửi lại vật liệu tái chế"
            aria-checked={hasRecyclingPickup}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              setHasRecyclingPickup((v) => !v);
            }}
            flex
            alignItems="center"
            justifyContent="space-between"
            style={{ minHeight: 44, cursor: 'pointer' }}
          >
            <Box flex alignItems="center" style={{ gap: 10 }}>
              <Box
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--color-bg-subtle)',
                  display: 'grid',
                  placeItems: 'center',
                  flex: '0 0 auto',
                }}
              >
                <Recycle size={20} color="var(--color-text-brand)" />
              </Box>
              <Box>
                <Text bold size="small" style={{ color: 'var(--color-text-primary)' }}>
                  Gửi lại vật liệu tái chế (Bảo vệ môi trường)
                </Text>
                <Text size="xSmall" style={{ color: 'var(--color-text-success)', fontWeight: 600, marginTop: 2 }}>
                  Thu gom tối đa ~{maxRecycleKg} kg
                </Text>
              </Box>
            </Box>
            {/* Checkbox thị giác thuần tuý — logic bật/tắt thu gom vẫn ở onClick của Box cha. */}
            <Checkbox checked={hasRecyclingPickup} onChange={() => {}} />
          </Box>

          {hasRecyclingPickup && (
            <Box flex flexDirection="column" style={{ gap: 10, marginTop: 12 }}>
              <Box
                p={3}
                style={{
                  background: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--forest-200)',
                }}
              >
                <Text size="xSmall" style={{ color: 'var(--forest-800)', lineHeight: '18px' }}>
                  Chúng tôi sẽ thu gom lại các vật liệu tái chế được đóng gói gọn gàng như bọc nilong, hoặc quần áo cũ, pin, vỏ sữa làm sạch -&gt; giúp bảo vệ môi trường. Số kg thu gom tối đa bằng số kg của đơn hàng (~{maxRecycleKg} kg).
                </Text>
              </Box>
              {paymentToSend === 'BANK_TRANSFER' && (
                <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', lineHeight: '18px' }}>
                  Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.
                </Text>
              )}
              <Input
                placeholder="Ghi chú loại vật dụng muốn gửi (vd: 3 cục pin, vỏ hộp sữa...)"
                value={recyclingNote}
                maxLength={200}
                onChange={(e) => setRecyclingNote(e.target.value)}
              />
            </Box>
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
          <Box flex flexDirection="column" style={{ gap: 10, marginTop: 10 }}>
            <Input
              label="Mã số thuế"
              value={invoice.taxCode}
              onChange={(e) => setInvoice((f) => ({ ...f, taxCode: e.target.value }))}
            />
            <Input
              label="Tên công ty"
              value={invoice.companyName}
              onChange={(e) => setInvoice((f) => ({ ...f, companyName: e.target.value }))}
            />
            <Input
              label="Địa chỉ xuất hoá đơn"
              value={invoice.address}
              onChange={(e) => setInvoice((f) => ({ ...f, address: e.target.value }))}
            />
            <Input
              label="Email nhận hoá đơn"
              value={invoice.email}
              onChange={(e) => setInvoice((f) => ({ ...f, email: e.target.value }))}
            />
            {!invoiceValid && (
              <Box flex alignItems="center" style={{ gap: 4, marginTop: 4 }}>
                <AlertCircle size={13} color="var(--color-text-danger)" aria-hidden />
                <Text size="xSmall" style={{ color: 'var(--color-text-danger)' }}>
                  Vui lòng điền đủ MST, tên công ty, địa chỉ và email hợp lệ.
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* ── Tóm tắt ── */}
      <Box
        p={4}
        mt={2}
        className="tubu-press"
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
                {getErrorMessage(quote.error)}
              </Text>
            </Box>
            <Text
              role="button"
              size="xSmall"
              bold
              className="tubu-hit-44"
              onClick={(e) => { e.stopPropagation(); void quote.refetch(); }}
              style={{ color: 'var(--color-text-brand)', padding: 8, display: 'inline-block' }}
            >
              {vi.common.retry}
            </Text>
          </Box>
        ) : quote.data ? (
          <>
            <KeyValueRow label={vi.cart.subtotal} value={formatVnd(quote.data.subtotal)} />
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
            <KeyValueRow label={vi.checkout.total} value={formatVnd(quote.data.total)} emphasis />
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
            <KeyValueRow label={vi.cart.subtotal} value={formatVnd(previewSubtotal)} />
            {previewCombo > 0 && (
              <KeyValueRow label="Giảm giá combo" value={`-${formatVnd(previewCombo)}`} tone="success" />
            )}
            {previewDiscount > 0 && (
              <KeyValueRow label={vi.cart.discount} value={`-${formatVnd(previewDiscount)}`} tone="success" />
            )}
            <KeyValueRow
              label={vi.checkout.shippingFee}
              value={addressId ? 'Đang tính...' : 'Cần chọn địa chỉ giao hàng'}
            />
            <KeyValueRow label={vi.checkout.total} value={formatVnd(Math.max(0, previewSubtotal - previewCombo - previewDiscount))} emphasis />
          </>
        )}
      </Box>

      {/* ── Sticky CTA ── */}
      <StickyActionBar
        primary={
          <Button
            fullWidth
            loading={order.isPending || submitting}
            disabled={!canPlace}
            onPress={async () => {
              if (submitting) return;
              setSubmitting(true);
              try {
                // Xin SĐT đúng lúc đặt hàng (như Homefarm) nếu tài khoản chưa có — không chặn nếu user từ chối.
                await useAuthStore.getState().ensurePhone().catch(() => undefined);
                order.mutate(undefined, { onSettled: () => setSubmitting(false) });
              } catch {
                setSubmitting(false);
              }
            }}
          >
            {order.isPending
              ? vi.checkout.placing
              : quote.data
                ? vi.checkout.placeOrderWith(formatVnd(quote.data.total))
                : vi.checkout.placeOrder}
          </Button>
        }
      />

      <BottomSheet
        open={priceChanged}
        onClose={() => setPriceChanged(false)}
        title={vi.flashSale.priceChangedTitle}
        description={vi.flashSale.priceChangedBody}
        footer={
          <Button
            fullWidth
            onPress={() => {
              setPriceChanged(false);
              void queryClient.invalidateQueries({ queryKey: ['cart'] });
              void queryClient.invalidateQueries({ queryKey: ['quote'] });
              navigate('/cart');
            }}
          >
            {vi.flashSale.priceChangedCta}
          </Button>
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
        previewParams={addressId && checkoutItems.length > 0 ? { addressId, storefrontSlug: ctvSlug, itemIds } : undefined}
        previewKey={cartPreviewKey(checkoutItems)}
        onCouponApplied={() => {
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

          {quote.data && (quote.data.tierDiscount ?? 0) > 0 && (
            <KeyValueRow label="Ưu đãi hạng thành viên" value={`-${formatVnd(quote.data.tierDiscount ?? 0)}`} tone="success" />
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
                  ? 'Đang tính...'
                  : 'Cần chọn địa chỉ giao hàng'
            }
            tone={quote.data?.shippingFee === 0 ? 'success' : 'primary'}
          />

          <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '8px 0' }} />

          <KeyValueRow
            label="Tổng thanh toán"
            value={formatVnd(quote.data?.total ?? Math.max(0, previewSubtotal - previewCombo - previewDiscount))}
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

/** Lỗi đặt đơn mà khách chỉ sửa được bằng cách đổi số lượng trong giỏ. */
function isCartFixableError(message: string): boolean {
  return /không đủ tồn kho/.test(message) || message === 'Vượt giới hạn mua ưu đãi.' || message === 'Hết suất ưu đãi.';
}
