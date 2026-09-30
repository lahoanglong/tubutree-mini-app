import { useEffect, useRef, useState } from 'react';
import { Box, Page, Text, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Ticket, ChevronRight, AlertTriangle } from 'lucide-react';
import {
  getCart,
  updateCartItem,
  removeCartItem,
  addToCart,
  type CartSummary,
  type CartLine,
} from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { formatVnd } from '../utils/format';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { useDebounced } from '../utils/use-debounced';
import { recompute } from '../utils/cart-rules';
import { StorefrontContextBar } from '../components/storefront-context-bar';
import { VoucherSheet } from '../components/checkout/voucher-sheet';
import { rememberCheckoutSelection } from '../utils/checkout-selection';
import { PageHeader } from '../components/ui/page-header';
import { Checkbox } from '../components/ui/form';
import { SR_ONLY } from '../components/ui/sr-only';
import { IconButton } from '../components/ui/icon-button';
import { KeyValueRow } from '../components/ui/key-value-row';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Button } from '../components/ui/button';
import { PriceTag } from '../components/ui/price-tag';

const UNDO_WINDOW_MS = 3500;
const CART_KEY = ['cart'] as const;

/**
 * Mutation giỏ hàng kiểu optimistic (AD-005):
 * cancel queries → snapshot → áp ngay vào cache → rollback nếu lỗi → invalidate khi xong.
 */
function useOptimisticCart<TVars>(
  mutationFn: (vars: TVars) => Promise<CartSummary>,
  apply: (prev: CartSummary, vars: TVars) => CartSummary,
) {
  const queryClient = useQueryClient();
  const { openSnackbar } = useSnackbar();
  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey: CART_KEY });
      const prev = queryClient.getQueryData<CartSummary>(CART_KEY);
      if (prev) queryClient.setQueryData(CART_KEY, apply(prev, vars));
      return { prev };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(CART_KEY, ctx.prev);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CART_KEY }),
  });
}

export default function CartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const { status } = useAuthStore();

  const cart = useQuery({ queryKey: CART_KEY, queryFn: getCart, enabled: status === 'authenticated' });
  const [removed, setRemoved] = useState<CartLine | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chọn từng món: lưu tập ĐÃ BỎ CHỌN (deselected) → món mới auto-chọn, món xoá tự biến mất
  // (không cần đồng bộ tay). checkout chỉ thanh toán các món đang chọn.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const update = useOptimisticCart(
    ({ id, qty }: { id: string; qty: number }) => updateCartItem(id, qty),
    (prev, { id, qty }) =>
      recompute(prev, prev.items.map((l) => (l.id === id ? { ...l, quantity: qty } : l))),
  );
  const remove = useOptimisticCart(
    ({ id }: { id: string; line: CartLine }) => removeCartItem(id),
    (prev, { id }) => recompute(prev, prev.items.filter((l) => l.id !== id)),
  );

  const handleRemove = (line: CartLine) => {
    haptic('light');
    // Undo bar chỉ mở sau khi server xóa xong — tránh undo (add lại) vượt mặt
    // request xóa còn đang bay làm sai trạng thái cuối.
    remove.mutate(
      { id: line.id, line },
      {
        onSuccess: () => {
          setRemoved(line);
          if (undoTimer.current) clearTimeout(undoTimer.current);
          undoTimer.current = setTimeout(() => setRemoved(null), UNDO_WINDOW_MS);
        },
      },
    );
  };

  const handleUndo = () => {
    if (!removed) return;
    haptic('light');
    const line = removed;
    setRemoved(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    addToCart(line.variationId, line.quantity)
      .then((c) => queryClient.setQueryData(CART_KEY, c))
      .catch((e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }));
  };

  // Đang silent-login lúc mở app → skeleton thay vì chớp màn đăng nhập.
  if (status === 'loading' || (status === 'authenticated' && cart.isLoading)) {
    return (
      <Shell>
        <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LineItemSkeleton />
          <LineItemSkeleton />
          <LineItemSkeleton />
        </Box>
      </Shell>
    );
  }

  if (cart.isError) {
    return (
      <Shell>
        <ErrorState message={getErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />
      </Shell>
    );
  }

  // Chưa đăng nhập xong / query bị disable (status idle) → cart.data undefined.
  // Hiện giỏ trống thay vì crash trắng màn (trước đây cart.data! gây lỗi).
  const summary = cart.data;
  if (!summary) {
    return (
      <Shell>
        <EmptyState
          art="basket"
          heading={vi.cart.emptyHeading}
          body={vi.cart.emptyBody}
          ctaLabel={vi.cart.emptyCta}
          onCta={() => navigate('/browse')}
        />
      </Shell>
    );
  }
  const empty = summary.items.length === 0;
  // Món đang chọn (không nằm trong deselected). Toàn-chọn → checkout gửi itemIds=undefined (toàn giỏ).
  const selectedItems = summary.items.filter((l) => !deselected.has(l.id));
  const allSelected = selectedItems.length === summary.items.length;
  const selectedSubtotal = selectedItems.reduce((s, l) => s + l.total, 0);
  const selectedCount = selectedItems.reduce((s, l) => s + l.quantity, 0);
  const toggleAll = () => {
    haptic('light');
    setDeselected(allSelected ? new Set(summary.items.map((l) => l.id)) : new Set());
  };
  const goCheckout = () => {
    if (selectedItems.length === 0) return;
    // null = cố ý thanh toán toàn giỏ. Luôn ghi nhớ để lần tải lại trang thanh toán không
    // âm thầm chuyển từ "1 món đã chọn" sang "cả giỏ".
    const itemIds = allSelected ? null : selectedItems.map((l) => l.id);
    rememberCheckoutSelection(itemIds);
    navigate('/checkout', { state: { itemIds } });
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 190 }}>
      <PageHeader title="Giỏ hàng" />
      <StorefrontContextBar />
      {empty ? (
        <EmptyState
          art="basket"
          heading={vi.cart.emptyHeading}
          body={vi.cart.emptyBody}
          ctaLabel={vi.cart.emptyCta}
          onCta={() => navigate('/browse')}
        />
      ) : (
        <>
          {/* Chọn tất cả */}
          <Box px={3} pt={2}>
            <Checkbox checked={allSelected} onChange={toggleAll} label="Chọn tất cả" />
          </Box>
          <Box p={3} pt={2} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {summary.items.map((line) => (
              <CartLineRow
                key={line.id}
                line={line}
                selected={!deselected.has(line.id)}
                onToggleSelect={() => toggleSelect(line.id)}
                onQty={(qty) => update.mutate({ id: line.id, qty })}
                onRemove={() => handleRemove(line)}
                onOpen={() => navigate(`/product/${line.slug}`)}
              />
            ))}
          </Box>

          <CouponBlock summary={summary} selectedSubtotal={selectedSubtotal} />
        </>
      )}

      {/* Undo bar — hiện 3.5s sau khi xóa (DI #3) */}
      {removed && (
        <Box
          className="tubu-rise"
          style={{
            position: 'fixed',
            bottom: empty ? 80 : 156,
            left: 12,
            right: 12,
            background: 'var(--color-bg-inverse)',
            borderRadius: 'var(--radius-control)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 30,
          }}
        >
          <Text size="small" style={{ color: 'white' }}>
            {vi.cart.removed}
          </Text>
          <Text
            role="button"
            size="small"
            bold
            onClick={handleUndo}
            style={{ color: 'var(--forest-200)', padding: '8px 6px' }}
          >
            {vi.common.undo}
          </Text>
        </Box>
      )}

      {!empty && (
        <StickySummary
          summary={summary}
          selectedSubtotal={selectedSubtotal}
          selectedCount={selectedCount}
          allSelected={allSelected}
          onCheckout={goCheckout}
        />
      )}
    </Page>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Giỏ hàng" />
      {children}
    </Page>
  );
}

function CartLineRow({
  line,
  selected,
  onToggleSelect,
  onQty,
  onRemove,
  onOpen,
}: {
  line: CartLine;
  selected: boolean;
  onToggleSelect: () => void;
  onQty: (qty: number) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const overStock = line.quantity > line.stock;
  // Bấm +/- nhanh 5 lần trước đây gọi 5 PATCH song song → debounce qty cuối cùng
  // (UI cập nhật tức thời qua local state, request chỉ bay sau ~380ms ổn định).
  const [localQty, setLocalQty] = useState(line.quantity);
  const debouncedQty = useDebounced(localQty, 380);
  // CHỈ đồng bộ về line.quantity khi KHÔNG có thay đổi đang chờ flush — tránh case
  // refetch cart (do mutate line khác) trả về quantity CŨ và snap UI ngược lại khi
  // user đang tap. Sau khi debouncedQty đã đuổi kịp localQty thì server-truth là an toàn.
  useEffect(() => {
    if (debouncedQty === localQty) setLocalQty(line.quantity);
  }, [line.quantity]);
  useEffect(() => {
    if (debouncedQty !== line.quantity) onQty(debouncedQty);
    // onQty/line.quantity ổn định trong scope mutate; chỉ trigger khi debouncedQty đổi.
  }, [debouncedQty]);
  return (
    <Box
      p={3}
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        boxShadow: 'var(--elevation-1)',
      }}
    >
      <Checkbox checked={selected} onChange={onToggleSelect}>
        <span style={SR_ONLY}>{`Chọn ${line.productName}`}</span>
      </Checkbox>
      <Box
        role="button"
        aria-label={line.productName}
        onClick={onOpen}
        style={{
          width: 64,
          height: 64,
          borderRadius: 'var(--radius-media)',
          overflow: 'hidden',
          background: 'var(--color-bg-subtle)',
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {line.thumbnail ? (
          <img
            src={line.thumbnail}
            alt={line.productName}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <svg width="28" height="28" viewBox="0 0 48 48" fill="none" aria-hidden>
            <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--forest-200)" />
          </svg>
        )}
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="small" bold onClick={onOpen} style={{ cursor: 'pointer' }}>
          {line.productName}
        </Text>
        {line.variationName && (
          <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
            {typeof line.variationName === 'object' && line.variationName !== null
              ? (line.variationName as { name?: string }).name ?? ''
              : String(line.variationName)}
          </Text>
        )}
        <Box style={{ marginTop: 4 }}>
          <PriceTag value={line.unitPrice} size="sm" />
        </Box>
        {line.isFlash && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 4 }}>
            <span
              style={{
                display: 'inline-block',
                background: 'var(--clay-50)',
                color: 'var(--clay-700)',
                borderRadius: 'var(--radius-pill)',
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {vi.flashSale.badge}
            </span>
            {line.soldPct != null && Number.isFinite(line.soldPct) && (
              <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                {vi.flashSale.soldPct(line.soldPct)}
              </Text>
            )}
          </Box>
        )}
        {overStock && (
          <Box flex alignItems="center" style={{ gap: 4, marginTop: 2 }}>
            <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden />
            <Text size="xSmall" style={{ color: 'var(--color-text-warning)' }}>
              {vi.cart.stockLimited(line.stock)}
            </Text>
          </Box>
        )}
        <Box flex alignItems="center" style={{ marginTop: 8 }}>
          <QuantitySelector
            size="sm"
            value={localQty}
            max={Math.max(1, line.stock)}
            onChange={setLocalQty}
          />
          <Box style={{ marginLeft: 'auto' }}>
            <IconButton icon={Trash2} label={`Xoá ${line.productName}`} onPress={onRemove} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function CouponBlock({ summary, selectedSubtotal }: { summary: CartSummary; selectedSubtotal: number }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <Box
        p={3}
        mx={3}
        className="tubu-press"
        onClick={() => {
          haptic('light');
          setSheetOpen(true);
        }}
        style={{
          background: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          boxShadow: 'var(--elevation-1)',
        }}
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
            <Text size="small" bold style={{ color: 'var(--color-text-primary)' }}>
              Mã giảm giá
            </Text>
            {summary.couponCode ? (
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
                  {summary.couponCode}
                </span>
                {summary.discount > 0 && (
                  <Text size="xSmall" style={{ color: 'var(--color-text-success)' }}>
                    -{formatVnd(summary.discount)}
                  </Text>
                )}
              </Box>
            ) : (
              <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                Chọn hoặc nhập mã ưu đãi
              </Text>
            )}
          </Box>
        </Box>

        <Box flex alignItems="center" style={{ gap: 4, color: 'var(--color-text-brand)' }}>
          <Text size="xSmall" bold style={{ color: 'var(--color-text-brand)' }}>
            {summary.couponCode ? 'Thay đổi' : 'Chọn mã'}
          </Text>
          <ChevronRight size={16} color="var(--color-text-brand)" />
        </Box>
      </Box>

      <VoucherSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        currentCode={summary.couponCode}
        // Điều kiện tối thiểu voucher phải tính trên tổng ĐANG CHỌN (checkout tập con) — dùng
        // summary.subtotal (toàn giỏ) ở đây từng khiến voucher hiện "đủ điều kiện" sai khi user
        // đã bỏ chọn bớt món (BE re-check khi apply nên không lọt số tiền, nhưng UI gây hiểu lầm).
        subtotal={selectedSubtotal}
      />
    </>
  );
}

/** Sticky summary + freeship progress (DI #1). */
function StickySummary({
  summary,
  selectedSubtotal,
  selectedCount,
  allSelected,
  onCheckout,
}: {
  summary: CartSummary;
  selectedSubtotal: number;
  selectedCount: number;
  allSelected: boolean;
  onCheckout: () => void;
}) {
  const threshold = summary.freeshipThreshold;
  // Freeship progress theo tổng ĐANG CHỌN (không phải toàn giỏ) — khớp số tiền sẽ thanh toán.
  const reached = (allSelected && summary.freeship) || selectedSubtotal >= threshold;
  const progressPct = Math.min(100, Math.round((selectedSubtotal / threshold) * 100));
  const remaining = Math.max(0, threshold - selectedSubtotal);
  // Coupon giảm chỉ hiển thị khi chọn TOÀN giỏ (subset re-tính ở checkout — tránh số sai).
  const discount = allSelected ? summary.discount : 0;

  return (
    <StickyActionBar
      summary={
        <>
          <Box style={{ marginBottom: 2 }}>
            <Text size="xSmall" style={{ color: reached ? 'var(--color-text-success)' : 'var(--color-text-secondary)' }}>
              {reached ? vi.cart.freeshipReached : vi.cart.freeshipProgress(formatVnd(remaining))}
            </Text>
            <Box
              aria-hidden
              style={{
                height: 5,
                background: 'var(--stone-200)',
                borderRadius: 'var(--radius-pill)',
                marginTop: 5,
                overflow: 'hidden',
              }}
            >
              <Box
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: reached
                    ? 'var(--forest-400)'
                    : 'linear-gradient(90deg, var(--forest-200), var(--color-action-primary-bg))',
                  borderRadius: 'var(--radius-pill)',
                  transition: 'width var(--dur-slow) var(--ease-out)',
                }}
              />
            </Box>
          </Box>

          {discount > 0 && (
            <KeyValueRow label={vi.cart.discount} value={`-${formatVnd(discount)}`} tone="success" />
          )}
          {/* Con số này ĐÃ trừ giảm giá và CHƯA gồm ship, trong khi "Tạm tính" ở màn Thanh toán
              là tiền hàng gộp chưa trừ gì — cùng một nhãn, hai số khác nhau, khách tưởng bị đội
              giá (P2-4 audit mạch lạc). Nói rõ ngay trên nhãn. */}
          <KeyValueRow
            label={vi.cart.subtotalAfterDiscount}
            value={formatVnd(Math.max(0, selectedSubtotal - discount))}
            emphasis
          />
        </>
      }
      primary={
        <Button fullWidth disabled={selectedCount === 0} onPress={onCheckout}>
          {vi.cart.checkout(selectedCount)}
        </Button>
      }
    />
  );
}
