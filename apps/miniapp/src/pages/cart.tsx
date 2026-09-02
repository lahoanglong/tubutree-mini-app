import { useEffect, useRef, useState } from 'react';
import { Box, Page, Text, Button, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Ticket, ChevronRight } from 'lucide-react';
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
    const itemIds = allSelected ? undefined : selectedItems.map((l) => l.id);
    navigate('/checkout', itemIds ? { state: { itemIds } } : undefined);
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 190 }}>

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
          <Box px={3} pt={2} flex alignItems="center" style={{ gap: 10 }}>
            <Checkbox checked={allSelected} onToggle={toggleAll} ariaLabel="Chọn tất cả" />
            <Text size="small" className="tubu-press" onClick={toggleAll}>Chọn tất cả</Text>
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
            background: 'var(--neutral-900)',
            borderRadius: 'var(--radius-md)',
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
            style={{ color: 'var(--sun-300)', padding: '8px 6px' }}
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

/** Checkbox tròn dùng chung cho chọn món trong giỏ. */
function Checkbox({ checked, onToggle, ariaLabel }: { checked: boolean; onToggle: () => void; ariaLabel: string }) {
  return (
    <Box
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      className="tubu-press"
      onClick={onToggle}
      style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${checked ? 'var(--primary-600)' : 'var(--neutral-300)'}`,
        background: checked ? 'var(--primary-600)' : 'transparent',
        display: 'grid', placeItems: 'center',
      }}
    >
      {checked && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
    </Box>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
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
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <Checkbox checked={selected} onToggle={onToggleSelect} ariaLabel={`Chọn ${line.productName}`} />
      <Box
        role="button"
        aria-label={line.productName}
        onClick={onOpen}
        style={{
          width: 64,
          height: 64,
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          background: 'var(--leaf-50)',
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
            <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--leaf-200)" />
          </svg>
        )}
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="small" bold onClick={onOpen} style={{ cursor: 'pointer' }}>
          {line.productName}
        </Text>
        {line.variationName && (
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {typeof line.variationName === 'object' && line.variationName !== null
              ? (line.variationName as { name?: string }).name ?? ''
              : String(line.variationName)}
          </Text>
        )}
        <Text bold style={{ color: 'var(--primary-700)', marginTop: 4 }}>
          {formatVnd(line.unitPrice)}
        </Text>
        {line.isFlash && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 4 }}>
            <span
              style={{
                display: 'inline-block',
                background: 'var(--clay-50)',
                color: 'var(--clay-700)',
                borderRadius: 'var(--radius-full)',
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {vi.flashSale.badge}
            </span>
            {line.soldPct != null && Number.isFinite(line.soldPct) && (
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {vi.flashSale.soldPct(line.soldPct)}
              </Text>
            )}
          </Box>
        )}
        {overStock && (
          <Text size="xSmall" style={{ color: 'var(--warning)', marginTop: 2 }}>
            ⚠ {vi.cart.stockLimited(line.stock)}
          </Text>
        )}
        <Box flex alignItems="center" style={{ marginTop: 8 }}>
          <QuantitySelector
            size="sm"
            value={localQty}
            max={Math.max(1, line.stock)}
            onChange={setLocalQty}
          />
          <Box
            role="button"
            aria-label={`Bỏ ${line.productName} khỏi giỏ`}
            className="tubu-press"
            onClick={onRemove}
            style={{
              marginLeft: 'auto',
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Trash2 size={18} color="var(--neutral-400)" strokeWidth={1.8} />
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
          background: 'var(--neutral-0)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          boxShadow: 'var(--shadow-xs)',
        }}
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
            <Text size="small" bold style={{ color: 'var(--neutral-900)' }}>
              Mã giảm giá
            </Text>
            {summary.couponCode ? (
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
                  {summary.couponCode}
                </span>
                {summary.discount > 0 && (
                  <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                    -{formatVnd(summary.discount)}
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
            {summary.couponCode ? 'Thay đổi' : 'Chọn mã'}
          </Text>
          <ChevronRight size={16} color="var(--primary-700)" />
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
    <Box
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--neutral-0)',
        boxShadow: 'var(--shadow-lg)',
        padding: '12px 16px calc(12px + var(--safe-bottom))',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
      }}
    >
      <Box style={{ marginBottom: 10 }}>
        <Text size="xSmall" style={{ color: reached ? 'var(--leaf-700)' : 'var(--neutral-600)' }}>
          {reached ? vi.cart.freeshipReached : vi.cart.freeshipProgress(formatVnd(remaining))}
        </Text>
        <Box
          aria-hidden
          style={{
            height: 5,
            background: 'var(--neutral-100)',
            borderRadius: 'var(--radius-full)',
            marginTop: 5,
            overflow: 'hidden',
          }}
        >
          <Box
            style={{
              width: `${progressPct}%`,
              height: '100%',
              background: reached
                ? 'var(--leaf-400)'
                : 'linear-gradient(90deg, var(--primary-200), var(--primary-600))',
              borderRadius: 'var(--radius-full)',
              transition: 'width var(--dur-slow) var(--ease-out)',
            }}
          />
        </Box>
      </Box>

      {discount > 0 && (
        <Box flex justifyContent="space-between">
          <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
            {vi.cart.discount}
          </Text>
          <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
            -{formatVnd(discount)}
          </Text>
        </Box>
      )}
      <Box flex justifyContent="space-between" alignItems="baseline">
        <Text size="small" style={{ color: 'var(--neutral-600)' }}>
          {vi.cart.subtotal}
        </Text>
        <Text bold style={{ fontSize: 18, color: 'var(--primary-700)' }}>
          {formatVnd(Math.max(0, selectedSubtotal - discount))}
        </Text>
      </Box>
      <Button
        fullWidth
        disabled={selectedCount === 0}
        onClick={onCheckout}
        style={{ background: 'var(--primary-600)', marginTop: 8, minHeight: 48, fontWeight: 600 }}
      >
        {vi.cart.checkout(selectedCount)}
      </Button>
    </Box>
  );
}
