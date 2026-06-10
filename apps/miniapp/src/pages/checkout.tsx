import { useEffect, useRef, useState } from 'react';
import { Box, Page, Text, Button, Header, Input, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrderDTO } from '@tubutree/shared-types';
import { getAddresses, getCart, checkoutQuote, placeOrder } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { AddressSection } from '../components/checkout/address-section';
import { OrderSuccess } from '../components/checkout/order-success';
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
  const { user } = useAuthStore();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [usePoints, setUsePoints] = useState(false);
  const [note, setNote] = useState('');
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
  // Key giữ nguyên suốt phiên checkout — retry sau timeout không tạo đơn đôi (AD-004).
  const idempotencyKey = useRef(newIdempotencyKey());

  const cart = useQuery({ queryKey: ['cart'], queryFn: getCart });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: getAddresses });

  useEffect(() => {
    if (addresses.data && addresses.data.length > 0 && !addressId) {
      const first = addresses.data.find((a) => a.isDefault)?.id ?? addresses.data[0]?.id;
      if (first) setAddressId(first);
    }
  }, [addresses.data, addressId]);

  const pointsToUse = usePoints ? (user?.pointsBalance ?? 0) : 0;
  const quote = useQuery({
    queryKey: ['quote', addressId, pointsToUse],
    queryFn: () => checkoutQuote(addressId!, pointsToUse),
    enabled: !!addressId,
  });

  // Đang chọn Ví Tubu mà tổng đơn vượt số dư → tự trả về COD, tránh đặt fail.
  useEffect(() => {
    if (payment === 'WALLET' && quote.data && (user?.walletBalance ?? 0) < quote.data.total) {
      setPayment('COD');
    }
  }, [payment, quote.data, user?.walletBalance]);

  const order = useMutation({
    mutationFn: () =>
      placeOrder(
        { addressId: addressId!, paymentMethod: payment, pointsToUse, note: note.trim() || undefined },
        idempotencyKey.current,
      ),
    onSuccess: (o) => {
      haptic('heavy');
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      idempotencyKey.current = newIdempotencyKey(); // đơn sau là đơn mới
      setPlaced(o);
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
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
  const canPlace = !!addressId && quote.isSuccess && !order.isPending;

  const paymentMethods = [
    { value: 'COD', label: vi.checkout.paymentCod, disabled: false },
    { value: 'ZALOPAY', label: vi.checkout.paymentZalopay, disabled: false },
    { value: 'BANK_TRANSFER', label: vi.checkout.paymentBank, disabled: false },
    {
      value: 'WALLET',
      label: vi.checkout.paymentWallet(formatVnd(walletBalance)),
      disabled: quote.isSuccess && walletBalance < total,
    },
  ];

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 110 }}>
      <Header title={vi.checkout.title} />

      <AddressSection
        addresses={addresses.data ?? []}
        selectedId={addressId}
        onSelect={setAddressId}
      />

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

      {/* ── Tóm tắt ── */}
      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 8 }}>
          {vi.checkout.summary}
        </Text>
        {quote.isLoading && (
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton height={14} />
            <Skeleton height={14} width="80%" />
            <Skeleton height={18} width="60%" />
          </Box>
        )}
        {quote.isError && (
          <Box flex alignItems="center" justifyContent="space-between">
            <Text size="xSmall" style={{ color: 'var(--danger)' }}>
              ⚠ {getErrorMessage(quote.error)}
            </Text>
            <Text role="button" size="xSmall" bold onClick={() => void quote.refetch()} style={{ color: 'var(--primary-700)', padding: 8 }}>
              {vi.common.retry}
            </Text>
          </Box>
        )}
        {quote.data && (
          <>
            <Row label={vi.cart.subtotal} value={formatVnd(quote.data.subtotal)} />
            {quote.data.discount > 0 && (
              <Row label={vi.cart.discount} value={`-${formatVnd(quote.data.discount)}`} accent="leaf" />
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
          loading={order.isPending}
          disabled={!canPlace}
          onClick={() => order.mutate()}
          style={{ background: 'var(--primary-600)', minHeight: 48, fontWeight: 600 }}
        >
          {order.isPending
            ? vi.checkout.placing
            : quote.data
              ? vi.checkout.placeOrderWith(formatVnd(quote.data.total))
              : vi.checkout.placeOrder}
        </Button>
      </Box>
    </Page>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title={vi.checkout.title} />
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
