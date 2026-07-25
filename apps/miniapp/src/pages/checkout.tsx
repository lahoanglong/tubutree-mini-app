import { useEffect, useRef, useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useNavigate, useLocation, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, ChevronRight, X } from 'lucide-react';
import type { OrderDTO } from '@tubutree/shared-types';
import { getAddresses, getCart, checkoutQuote, placeOrder } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { useStorefrontContext } from '../store/storefront-context';
import { AddressSection } from '../components/checkout/address-section';
import { OrderSuccess } from '../components/checkout/order-success';
import { VoucherSheet } from '../components/checkout/voucher-sheet';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { formatVnd } from '../utils/format';
import { newIdempotencyKey } from '../utils/idempotency';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const { user, status } = useAuthStore();
  const authed = status === 'authenticated';
  const sfCtx = useStorefrontContext();
  // Chỉ gian hàng CTV (kind='ctv') mới gắn storefrontSlug (combo + attribution).
  // Trang nhãn (kind='brand') KHÔNG gửi → tránh ô nhiễm analytics CTV; vẫn giữ referralCode.
  const ctvSlug = sfCtx.kind === 'ctv' ? (sfCtx.slug ?? undefined) : undefined;

  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [usePoints, setUsePoints] = useState(false);
  const [note, setNote] = useState('');
  const [voucherSheetOpen, setVoucherSheetOpen] = useState(false);
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
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
  // Key giữ nguyên suốt phiên checkout — retry sau timeout không tạo đơn đôi (AD-004).
  const idempotencyKey = useRef(newIdempotencyKey());

  // Guard auth: tránh gọi /cart, /me/addresses khi chưa silent-login xong (deeplink → 401).
  const cart = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: authed });
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

  // Checkout TẬP CON: itemIds do trang Giỏ truyền qua navigation state (chọn từng món).
  // Không có state (vd "Mua ngay" từ PDP / mở trực tiếp) → undefined = toàn giỏ.
  const location = useLocation();
  const itemIds = (location.state as { itemIds?: string[] } | null)?.itemIds;
  const itemIdsKey = itemIds ? itemIds.join(',') : '';

  const pointsToUse = usePoints ? (user?.pointsBalance ?? 0) : 0;
  const quote = useQuery({
    queryKey: ['quote', addressId, pointsToUse, ctvSlug, itemIdsKey],
    queryFn: () => checkoutQuote(addressId!, pointsToUse, ctvSlug, itemIds),
    enabled: !!addressId && authed,
  });

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invoiceValid =
    !wantInvoice ||
    (invoice.taxCode.trim() && invoice.companyName.trim() && invoice.address.trim() && EMAIL.test(invoice.email.trim()));

  // Đang chọn Ví/TubuXu mà tổng đơn vượt số dư → tự trả về COD, tránh đặt fail.
  useEffect(() => {
    if (!quote.data) return;
    if (payment === 'WALLET' && (user?.walletBalance ?? 0) < quote.data.total) setPayment('COD');
    if (payment === 'XU' && (user?.coinsBalance ?? 0) < quote.data.total) setPayment('COD');
  }, [payment, quote.data, user?.walletBalance, user?.coinsBalance]);

  const order = useMutation({
    mutationFn: () =>
      placeOrder(
        {
          addressId: addressId!,
          paymentMethod: payment,
          pointsToUse,
          note: note.trim() || undefined,
          invoiceRequest: wantInvoice
            ? {
                taxCode: invoice.taxCode.trim(),
                companyName: invoice.companyName.trim(),
                address: invoice.address.trim(),
                email: invoice.email.trim(),
              }
            : undefined,
          referralCode: sfCtx.referralCode ?? undefined,
          storefrontSlug: ctvSlug,
          itemIds,
        },
        idempotencyKey.current,
      ),
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
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      // Refresh auth store (user.walletBalance / pointsBalance dùng ở header/checkout) để UI đồng bộ.
      void useAuthStore.getState().restore().catch(() => undefined);
      idempotencyKey.current = newIdempotencyKey(); // đơn sau là đơn mới
      // Chuyển khoản: sang màn VietQR để khách quét trả ngay (Pancake đối soát → tự xác nhận).
      if (payment === 'BANK_TRANSFER') {
        navigate(`/bank-payment/${o.code}`, { replace: true });
        return;
      }
      setPlaced(o);
    },
    onError: (e: unknown) => {
      if (getErrorMessage(e) === 'PRICE_CHANGED') {
        setPriceChanged(true);
        return;
      }
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  // ── Success screen ──
  if (placed) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <OrderSuccess
          order={placed}
          onTrack={() => navigate(`/order/${placed.code}`, { replace: true })}
          onContinue={() => navigate('/', { replace: true })}
        />
      </Page>
    );
  }

  if (cart.isLoading || addresses.isLoading) return <CheckoutSkeleton />;

  if (cart.isError || addresses.isError) {
    const err = cart.isError ? cart.error : addresses.error;
    const retry = () => {
      if (cart.isError) void cart.refetch();
      if (addresses.isError) void addresses.refetch();
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

  const walletBalance = user?.walletBalance ?? 0;
  const total = quote.data?.total ?? 0;
  const canPlace = !!addressId && quote.isSuccess && !order.isPending && !!invoiceValid && !submitting;

  const coinsBalance = user?.coinsBalance ?? 0;
  const paymentMethods = [
    { value: 'COD', label: vi.checkout.paymentCod, disabled: false },
    // ZALOPAY tạm ẨN: chưa nối cổng thanh toán thật → nếu hiện, bấm đặt sẽ ra "thành công"
    // mà KHÔNG thu tiền (như COD) → đơn treo/sai đối soát. Mở lại khi tích hợp Payment API Zalo.
    { value: 'BANK_TRANSFER', label: vi.checkout.paymentBank, disabled: false },
    {
      value: 'WALLET',
      label: vi.checkout.paymentWallet(formatVnd(walletBalance)),
      disabled: quote.isSuccess && walletBalance < total,
    },
    {
      value: 'XU',
      label: vi.checkout.paymentXu(`${coinsBalance.toLocaleString('vi-VN')} xu`),
      disabled: quote.isSuccess && coinsBalance < total,
    },
  ];

  const shownItems = itemIds
    ? (cart.data?.items ?? []).filter((it) => itemIds.includes(it.id))
    : (cart.data?.items ?? []);
  const previewSubtotal = shownItems.reduce((s, it) => s + it.total, 0);
  const previewDiscount = cart.data?.couponCode ? (cart.data.discount ?? 0) : 0;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 110 }}>

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
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Text bold size="small" style={{ marginBottom: 10 }}>
            Sản phẩm ({shownCount})
          </Text>
          <Box flex flexDirection="column" style={{ gap: 12 }}>
            {shownItems.map((it) => (
              <Box key={it.id} flex alignItems="center" style={{ gap: 10 }}>
                <img
                  src={it.thumbnail ?? undefined}
                  alt={it.productName}
                  style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', background: 'var(--neutral-100)', flexShrink: 0 }}
                />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.productName}</Text>
                  {it.variationName && (
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                      {typeof it.variationName === 'object' && it.variationName !== null
                        ? (it.variationName as { name?: string }).name ?? ''
                        : String(it.variationName)}
                    </Text>
                  )}
                  <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                    {formatVnd(it.unitPrice)} × {it.quantity}
                  </Text>
                </Box>
                <Text size="small" bold style={{ whiteSpace: 'nowrap' }}>{formatVnd(it.total)}</Text>
              </Box>
            ))}
          </Box>
        </Box>
        ) : null;
      })()}

      {/* ── Mã giảm giá ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Box
          className="tubu-press"
          onClick={() => {
            haptic('light');
            setVoucherSheetOpen(true);
          }}
          flex
          alignItems="center"
          justifyContent="space-between"
          style={{ cursor: 'pointer' }}
        >
          <Box flex alignItems="center" style={{ gap: 10 }}>
            <Box
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: 'var(--clay-50)',
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 auto',
              }}
            >
              <Ticket size={20} color="var(--clay-700)" />
            </Box>
            <Box>
              <Text bold size="small" style={{ color: 'var(--neutral-900)' }}>
                Mã giảm giá
              </Text>
              {cart.data?.couponCode ? (
                <Box flex alignItems="center" style={{ gap: 8, marginTop: 2 }}>
                  <span
                    style={{
                      background: 'var(--clay-50)',
                      border: '1px dashed var(--clay-500)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 6px',
                      color: 'var(--clay-700)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {cart.data.couponCode}
                  </span>
                  {quote.data && quote.data.discount > 0 && (
                    <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                      -{formatVnd(quote.data.discount)}
                    </Text>
                  )}
                </Box>
              ) : (
                <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                  Chọn hoặc nhập mã ưu đãi
                </Text>
              )}
            </Box>
          </Box>

          <Box flex alignItems="center" style={{ gap: 4, color: 'var(--primary-700)' }}>
            <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>
              {cart.data?.couponCode ? 'Thay đổi' : 'Xem mã'}
            </Text>
            <ChevronRight size={16} color="var(--primary-700)" />
          </Box>
        </Box>
      </Box>

      {/* ── Thanh toán ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.checkout.payment}
        </Text>
        {paymentMethods.map((m) => (
          <Box
            key={m.value}
            role="radio"
            aria-checked={payment === m.value}
            aria-disabled={m.disabled}
            className={m.disabled ? undefined : 'tubu-press'}
            onClick={() => {
              if (m.disabled) return;
              haptic('light');
              setPayment(m.value);
            }}
            flex
            alignItems="center"
            style={{ gap: 10, padding: '12px 0', minHeight: 44, opacity: m.disabled ? 0.45 : 1, boxSizing: 'border-box' }}
          >
            <RadioDot active={payment === m.value} />
            <Text size="small">{m.label}</Text>
          </Box>
        ))}
      </Box>

      {/* ── Điểm Xanh ── */}
      {user && (
        <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
          <Box
            role="checkbox"
            aria-checked={usePoints}
            aria-disabled={user.pointsBalance <= 0}
            className={user.pointsBalance > 0 ? 'tubu-press' : undefined}
            onClick={() => {
              if (user.pointsBalance <= 0) return;
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
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {user.pointsBalance > 0
                  ? usePoints && quote.data
                    ? vi.checkout.pointsUse(quote.data.pointsUsed, formatVnd(quote.data.pointsDiscount))
                    : vi.checkout.pointsAvailable(user.pointsBalance)
                  : vi.checkout.pointsNone}
              </Text>
            </Box>
            <ToggleVisual on={usePoints} disabled={user.pointsBalance <= 0} />
          </Box>
        </Box>
      )}

      {/* ── Ghi chú ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.checkout.note}
        </Text>
        <Input placeholder={vi.checkout.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
      </Box>

      {/* ── Hoá đơn VAT (spec §6.3) ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Box
          role="checkbox"
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
          <ToggleVisual on={wantInvoice} />
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
              <Text size="xSmall" style={{ color: 'var(--danger)' }}>
                ⚠ Vui lòng điền đủ MST, tên công ty, địa chỉ và email hợp lệ.
              </Text>
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
        style={{ background: 'var(--neutral-0)', cursor: 'pointer' }}
      >
        <Box flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 10 }}>
          <Text bold size="small" style={{ color: 'var(--neutral-900)' }}>
            {vi.checkout.summary}
          </Text>
          <Box flex alignItems="center" style={{ gap: 4, color: 'var(--primary-700)' }}>
            <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>
              Chi tiết
            </Text>
            <ChevronRight size={16} color="var(--primary-700)" />
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
            <Text size="xSmall" style={{ color: 'var(--danger)' }}>
              ⚠ {getErrorMessage(quote.error)}
            </Text>
            <Text role="button" size="xSmall" bold onClick={(e) => { e.stopPropagation(); void quote.refetch(); }} style={{ color: 'var(--primary-700)', padding: 8 }}>
              {vi.common.retry}
            </Text>
          </Box>
        ) : quote.data ? (
          <>
            <Row label={vi.cart.subtotal} value={formatVnd(quote.data.subtotal)} />
            {quote.data.discount > 0 && (
              <Row label={vi.cart.discount} value={`-${formatVnd(quote.data.discount)}`} accent="leaf" />
            )}
            {quote.data.comboDiscount > 0 && (
              <Row label="Ưu đãi combo" value={`-${formatVnd(quote.data.comboDiscount)}`} accent="leaf" />
            )}
            {quote.data.pointsDiscount > 0 && (
              <Row label={vi.checkout.points} value={`-${formatVnd(quote.data.pointsDiscount)}`} accent="leaf" />
            )}
            <Row
              label={vi.checkout.shippingFee}
              value={quote.data.shippingFee === 0 ? vi.common.freeShip : formatVnd(quote.data.shippingFee)}
              accent={quote.data.shippingFee === 0 ? 'leaf' : undefined}
            />
            <Row label={vi.checkout.total} value={formatVnd(quote.data.total)} bold />
            {quote.data.pointsEarned > 0 && (
              <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 4 }}>
                🌱 {vi.checkout.pointsEarn(quote.data.pointsEarned)}
              </Text>
            )}
          </>
        ) : (
          /* Fallback preview summary when addressId is missing/unselected */
          <>
            <Row label={vi.cart.subtotal} value={formatVnd(previewSubtotal)} />
            {previewDiscount > 0 && (
              <Row label={vi.cart.discount} value={`-${formatVnd(previewDiscount)}`} accent="leaf" />
            )}
            <Row
              label={vi.checkout.shippingFee}
              value={addressId ? 'Đang tính...' : 'Cần chọn địa chỉ giao hàng'}
            />
            <Row label={vi.checkout.total} value={formatVnd(Math.max(0, previewSubtotal - previewDiscount))} bold />
          </>
        )}
      </Box>

      {/* ── Sticky CTA ── */}
      <Box
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--neutral-0)',
          boxShadow: 'var(--shadow-lg)',
          padding: '12px 16px calc(12px + var(--safe-bottom))',
        }}
      >
        <Button
          fullWidth
          loading={order.isPending || submitting}
          disabled={!canPlace || submitting}
          onClick={async () => {
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
          style={{ background: 'var(--primary-600)', minHeight: 48, fontWeight: 600 }}
        >
          {order.isPending
            ? vi.checkout.placing
            : quote.data
              ? vi.checkout.placeOrderWith(formatVnd(quote.data.total))
              : vi.checkout.placeOrder}
        </Button>
      </Box>

      <Sheet visible={priceChanged} onClose={() => setPriceChanged(false)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large">
            {vi.flashSale.priceChangedTitle}
          </Text>
          <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 8 }}>
            {vi.flashSale.priceChangedBody}
          </Text>
          <Button
            fullWidth
            style={{ marginTop: 16 }}
            onClick={() => {
              setPriceChanged(false);
              void queryClient.invalidateQueries({ queryKey: ['cart'] });
              void queryClient.invalidateQueries({ queryKey: ['quote'] });
              navigate('/cart');
            }}
          >
            {vi.flashSale.priceChangedCta}
          </Button>
        </Box>
      </Sheet>

      <VoucherSheet
        visible={voucherSheetOpen}
        onClose={() => setVoucherSheetOpen(false)}
        currentCode={cart.data?.couponCode}
        subtotal={quote.data?.subtotal ?? cart.data?.subtotal ?? 0}
        onCouponApplied={() => {
          void cart.refetch();
          void quote.refetch();
        }}
      />

      <Sheet visible={summarySheetOpen} onClose={() => setSummarySheetOpen(false)} autoHeight mask style={{ zIndex: 1000 }}>
        <Box p={4} style={{ paddingBottom: 'calc(20px + var(--safe-bottom))' }}>
          <Box flex alignItems="center" justifyContent="space-between" mb={3}>
            <Text bold size="normal" style={{ color: 'var(--neutral-900)' }}>
              Chi tiết tính tiền đơn hàng
            </Text>
            <button
              type="button"
              aria-label="Đóng"
              className="tubu-press"
              onClick={() => setSummarySheetOpen(false)}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: 'var(--neutral-100)',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={18} color="var(--neutral-600)" />
            </button>
          </Box>

          <Box p={3} style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-lg)' }}>
            <Row label="Tạm tính tiền hàng" value={formatVnd(quote.data?.subtotal ?? previewSubtotal)} />

            {(quote.data?.discount ?? previewDiscount) > 0 && (
              <Row label="Giảm giá voucher" value={`-${formatVnd(quote.data?.discount ?? previewDiscount)}`} accent="leaf" />
            )}

            {quote.data && quote.data.comboDiscount > 0 && (
              <Row label="Giảm giá combo" value={`-${formatVnd(quote.data.comboDiscount)}`} accent="leaf" />
            )}

            {quote.data && quote.data.pointsDiscount > 0 && (
              <Row label="Giảm giá điểm Xanh" value={`-${formatVnd(quote.data.pointsDiscount)}`} accent="leaf" />
            )}

            <Row
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
              accent={quote.data?.shippingFee === 0 ? 'leaf' : undefined}
            />

            <div style={{ height: 1, background: 'var(--neutral-200)', margin: '8px 0' }} />

            <Row
              label="Tổng thanh toán"
              value={formatVnd(quote.data?.total ?? Math.max(0, previewSubtotal - previewDiscount))}
              bold
            />

            {(quote.data?.pointsEarned ?? 0) > 0 && (
              <Text size="xSmall" style={{ color: 'var(--leaf-700)', marginTop: 6, textAlign: 'right', display: 'block' }}>
                🌱 Tích lũy +{quote.data!.pointsEarned} điểm Xanh khi giao thành công
              </Text>
            )}
          </Box>

          <Button
            fullWidth
            onClick={() => setSummarySheetOpen(false)}
            style={{ background: 'var(--primary-600)', marginTop: 16, minHeight: 44, fontWeight: 600 }}
          >
            Đã hiểu
          </Button>
        </Box>
      </Sheet>
    </Page>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      {children}
    </Page>
  );
}

function Row({
  label,
  value,
  bold,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: 'leaf';
}) {
  return (
    <Box flex justifyContent="space-between" style={{ padding: '4px 0' }}>
      <Text size="small" style={{ color: 'var(--neutral-600)' }}>
        {label}
      </Text>
      <Text
        size="small"
        bold={bold}
        style={{
          color: accent === 'leaf' ? 'var(--leaf-700)' : bold ? 'var(--primary-700)' : undefined,
          fontSize: bold ? 16 : undefined,
        }}
      >
        {value}
      </Text>
    </Box>
  );
}

function RadioDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        border: `2px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color var(--dur-fast) var(--ease-out)',
        flex: '0 0 auto',
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: active ? 'var(--primary-600)' : 'transparent',
          transition: 'background var(--dur-fast) var(--ease-out)',
        }}
      />
    </span>
  );
}

function ToggleVisual({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 44,
        height: 26,
        borderRadius: 'var(--radius-full)',
        background: on ? 'var(--primary-600)' : 'var(--neutral-200)',
        opacity: disabled ? 0.5 : 1,
        position: 'relative',
        transition: 'background var(--dur-base) var(--ease-out)',
        flex: '0 0 auto',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'white',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--dur-base) var(--ease-out)',
        }}
      />
    </span>
  );
}

function CheckoutSkeleton() {
  return (
    <Shell>
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width={120} height={14} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </Box>
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton width={150} height={14} />
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </Box>
    </Shell>
  );
}
