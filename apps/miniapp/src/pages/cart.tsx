import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Page, Text, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Ticket, ChevronRight, AlertTriangle, Zap } from 'lucide-react';
import { cartSaving, lineCompareAt } from '@tubutree/app-core/commerce/pdp-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import {
  getCart,
  getCartSelection,
  updateCartItem,
  removeCartItem,
  addToCart,
  type CartSummary,
  type CartLine,
  type UnavailableCartLine,
} from '../services/shop-api';
import { cartPreviewKey, cartProductIds } from '../utils/coupon-scope';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { LineItemSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { SuggestedRail } from '../components/catalog/suggested-rail';
import { formatVnd } from '../utils/format';
import { clampPercent } from '../utils/flash-display';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { PREVIEW_DEBOUNCE_MS, useDebounced } from '../utils/use-debounced';
import { recompute } from '../utils/cart-rules';
import { StorefrontContextBar } from '../components/storefront-context-bar';
import { VoucherSheet } from '../components/checkout/voucher-sheet';
import { useCouponHint } from '../components/checkout/use-coupon-hint';
import { couponHintShort } from '@tubutree/app-core/coupon-use';
import { useStorefrontContext } from '../store/storefront-context';
import { rememberCheckoutSelection } from '../utils/checkout-selection';
import { PageHeader } from '../components/ui/page-header';
import { Checkbox } from '../components/ui/form';
import { SR_ONLY } from '../components/ui/sr-only';
import { IconButton } from '../components/ui/icon-button';
import { KeyValueRow } from '../components/ui/key-value-row';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { PriceTag } from '../components/ui/price-tag';
import { Heading } from '../components/ui/text';
import { fulfillerLabel, groupByFulfiller, showFulfillerHeaders, tubuSubtotal } from '../utils/shipments';
import { cartKey, useCartKey } from '../services/cart-key';
import { ProductThumb } from '../components/ui/product-thumb';
import { Countdown } from '../components/ui/countdown';

const UNDO_WINDOW_MS = 3500;

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
      await queryClient.cancelQueries({ queryKey: ['cart'] });
      const prev = queryClient.getQueryData<CartSummary>(cartKey());
      if (prev) queryClient.setQueryData(cartKey(), apply(prev, vars));
      return { prev };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(cartKey(), ctx.prev);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });
}

export default function CartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const phase = useAuthPhase();

  const cartKeyNow = useCartKey();
  const cart = useQuery({ queryKey: cartKeyNow, queryFn: getCart, enabled: phase === 'authenticated' });
  const [removed, setRemoved] = useState<CartLine | null>(null);
  // Tấm chọn mã nằm ở cấp trang, không trong chân dính (position:fixed, z 20): zmp-ui Sheet không có portal nên lớp phủ và tấm
  // sẽ kẹt trong ngăn xếp z 20, nút Quay lại (z 200) và thanh Hoàn tác (z 30) vẽ đè lên và vẫn bấm được.
  const [voucherOpen, setVoucherOpen] = useState(false);
  const sfCtx = useStorefrontContext();
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
  // Giỏ về trống (làm mới giỏ khi tấm đang mở): tấm gỡ theo, không để nó bật lại khi giỏ có hàng lần sau.
  const noItems = (cart.data?.items.length ?? 0) === 0;
  useEffect(() => {
    if (noItems) setVoucherOpen(false);
  }, [noItems]);

  // Chọn một phần giỏ (còn ít nhất một dòng): hỏi máy chủ giá của đúng phần đó, cùng nhịp debounce với xem trước mã của VoucherSheet.
  // Chọn cả giỏ dùng thẳng giỏ trong bộ nhớ, không hỏi thêm. Khoá nằm dưới ['cart', gian hàng] nên làm mới giỏ cũng làm mới giá này.
  const subsetLines = (cart.data?.items ?? []).filter((l) => !deselected.has(l.id));
  // Mã đang áp nằm trong dấu vân tay: áp/bỏ mã đổi giá phần chọn dù id, số lượng, thành tiền không đổi.
  const subsetSig =
    cart.data && subsetLines.length > 0 && subsetLines.length < cart.data.items.length
      ? JSON.stringify([subsetLines.map((l) => l.id), cartPreviewKey(subsetLines), cart.data.couponCode])
      : null;
  const settledSubsetSig = useDebounced(subsetSig, PREVIEW_DEBOUNCE_MS);
  const selectionQ = useQuery({
    queryKey: [...cartKeyNow, 'selection', settledSubsetSig],
    queryFn: () => getCartSelection((JSON.parse(settledSubsetSig!) as [string[], string, string | null])[0]),
    enabled: phase === 'authenticated' && !!settledSubsetSig,
    retry: false,
  });
  // Số chỉ đúng cho đúng phần đã hỏi: vừa đổi chọn/số lượng (chưa hỏi lại), đang tải lại hoặc lỗi thì không hiện số cũ.
  const priced =
    !!subsetSig && settledSubsetSig === subsetSig && selectionQ.isSuccess && !selectionQ.isFetching ? selectionQ.data : null;

  const update = useOptimisticCart(
    ({ id, qty }: { id: string; qty: number }) => updateCartItem(id, qty),
    (prev, { id, qty }) =>
      recompute(prev, prev.items.map((l) => (l.id === id ? { ...l, quantity: qty } : l)), id),
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
      .then((c) => queryClient.setQueryData(cartKey(), c))
      .catch((e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }));
  };

  // Chưa đăng nhập xong: đang khôi phục → khung chờ (không chớp màn đăng nhập); mất kết nối → Thử lại; khách → mời đăng nhập.
  if (phase !== 'authenticated') {
    return (
      <Shell>
        <AuthPhaseView phase={phase} loading={<CartSkeleton />} />
      </Shell>
    );
  }

  if (cart.isLoading) {
    return (
      <Shell>
        <CartSkeleton />
      </Shell>
    );
  }

  // Chỉ thay cả trang bằng màn lỗi khi KHÔNG có giỏ để hiện: tải lại lỗi (vd mất mạng sau khi xoá món) không được làm trắng giỏ đang xem.
  const summary = cart.data;
  if (!summary) {
    return (
      <Shell>
        <ErrorState message={getLoadErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />
      </Shell>
    );
  }
  const empty = summary.items.length === 0;
  // Mỗi nơi giao thành một đơn riêng khi đặt (D4): chia giỏ theo nơi giao để khách thấy trước.
  const groups = groupByFulfiller(summary.items);
  const withHeaders = showFulfillerHeaders(groups);
  const hasMerchant = groups.some((g) => g.fulfiller.kind === 'MERCHANT');
  // Món đang chọn (không nằm trong deselected). Toàn-chọn → checkout gửi itemIds=undefined (toàn giỏ).
  const selectedItems = summary.items.filter((l) => !deselected.has(l.id));
  const allSelected = selectedItems.length === summary.items.length;
  // Dòng hết hàng (tồn 0) không mua được: không cộng vào tạm tính hay tiến độ miễn phí giao, để khách không thấy số mà đặt không nổi.
  const buyableSelected = selectedItems.filter((l) => l.stock > 0);
  const outOfStockSelected = selectedItems.filter((l) => l.stock <= 0);
  const selectedSubtotal = buyableSelected.reduce((s, l) => s + l.total, 0);
  const selectedCount = selectedItems.reduce((s, l) => s + l.quantity, 0);
  // Máy chủ từ chối đặt đơn khi số lượng vượt tồn: chặn ngay ở giỏ thay vì để khách điền xong mới báo lỗi.
  const overStockSelected = selectedItems.some((l) => l.quantity > l.stock);
  // Cùng gian hàng checkout gửi (combo) để số giảm của từng mã đúng số thanh toán sẽ trừ.
  const ctvSlug = sfCtx.kind === 'ctv' ? (sfCtx.slug ?? undefined) : undefined;
  // Không chọn món nào: không hỏi máy chủ (itemIds rỗng bị coi là cả giỏ), thẻ giữ cách hiện cũ.
  const previewSelection =
    selectedItems.length === 0
      ? null
      : { itemIds: allSelected ? undefined : selectedItems.map((l) => l.id), key: cartPreviewKey(selectedItems) };
  const previewParams = previewSelection ? { storefrontSlug: ctvSlug, itemIds: previewSelection.itemIds } : undefined;
  const toggleAll = () => {
    haptic('light');
    setDeselected(allSelected ? new Set(summary.items.map((l) => l.id)) : new Set());
  };
  const goCheckout = () => {
    if (selectedItems.length === 0 || overStockSelected) return;
    // null = cố ý thanh toán toàn giỏ. Luôn ghi nhớ để lần tải lại trang thanh toán không
    // âm thầm chuyển từ "1 món đã chọn" sang "cả giỏ".
    const itemIds = allSelected ? null : selectedItems.map((l) => l.id);
    rememberCheckoutSelection(itemIds);
    navigate('/checkout', { state: { itemIds } });
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(var(--sticky-bar-h, 150px) + 16px)' }}>
      <PageHeader title="Giỏ hàng" />
      <StorefrontContextBar />
      <DiscontinuedNotice
        lines={summary.unavailableItems ?? []}
        onRemove={(id) =>
          removeCartItem(id)
            .then((c) => queryClient.setQueryData(cartKey(), c))
            .catch((e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }))
        }
      />
      {empty ? (
        <>
          <EmptyState
            art="basket"
            heading={vi.cart.emptyHeading}
            body={vi.cart.emptyBody}
            ctaLabel={vi.cart.emptyCta}
            onCta={() => navigate('/browse')}
          />
          <SuggestedRail listSource="cart_empty" />
        </>
      ) : (
        <>
          {/* Chọn tất cả */}
          <Box px={3} pt={2}>
            <Checkbox checked={allSelected} onChange={toggleAll} label="Chọn tất cả" />
          </Box>
          {withHeaders && (
            <Box px={3} pt={2}>
              <Text size="xSmall" style={{ color: 'var(--color-text-secondary)' }}>
                Giỏ có hàng do nhiều nơi giao: mỗi nơi giao thành một đơn riêng, có phí giao riêng.
              </Text>
            </Box>
          )}
          {groups.map((g) => (
            <section key={g.key} aria-label={withHeaders ? fulfillerLabel(g.fulfiller) : 'Sản phẩm trong giỏ'}>
              {withHeaders && (
                <Heading variant="title-sm" as="h2" style={{ padding: '12px 12px 0' }}>
                  {fulfillerLabel(g.fulfiller)}
                </Heading>
              )}
              <Box p={3} pt={2} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {g.items.map((line) => (
                  <CartLineRow
                    key={line.id}
                    line={line}
                    selected={!deselected.has(line.id)}
                    onToggleSelect={() => toggleSelect(line.id)}
                    onQty={(qty) => update.mutate({ id: line.id, qty })}
                    onRemove={() => handleRemove(line)}
                    onOpen={() => navigate(`/product/${line.slug}`)}
                    onFlashEnd={() => void queryClient.invalidateQueries({ queryKey: ['cart'] })}
                    pending={update.isPending && update.variables?.id === line.id}
                  />
                ))}
              </Box>
            </section>
          ))}
        </>
      )}

      {/* Undo bar — hiện 3.5s sau khi xoá (DI #3) */}
      {removed && (
        <Box
          className="tubu-rise"
          style={{
            position: 'fixed',
            bottom: empty ? 80 : 236,
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
            {...rowKeyboardProps()}
            size="small"
            bold
            onClick={handleUndo}
            className="tubu-hit-44"
            style={{ color: 'var(--forest-200)', padding: '8px 6px', display: 'inline-block' }}
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
          priced={priced}
          overStock={overStockSelected}
          outOfStockNames={outOfStockSelected.map((l) => l.productName)}
          tubuOnlyFreeship={hasMerchant}
          tubuSelectedSubtotal={tubuSubtotal(buyableSelected)}
          onCheckout={goCheckout}
          saving={cartSaving(buyableSelected)}
          coupon={
            <CouponRow
              summary={summary}
              previewParams={previewParams}
              previewKey={previewSelection?.key ?? ''}
              onOpen={() => setVoucherOpen(true)}
            />
          }
        />
      )}

      {!empty && (
        <VoucherSheet
          visible={voucherOpen}
          onClose={() => setVoucherOpen(false)}
          currentCode={summary.couponCode}
          // Điều kiện tối thiểu voucher phải tính trên tổng ĐANG CHỌN (checkout tập con) — dùng
          // summary.subtotal (toàn giỏ) ở đây từng khiến voucher hiện "đủ điều kiện" sai khi user
          // đã bỏ chọn bớt món (BE re-check khi apply nên không lọt số tiền, nhưng UI gây hiểu lầm).
          subtotal={selectedSubtotal}
          productIds={cartProductIds(selectedItems)}
          previewParams={previewParams}
          previewKey={previewSelection?.key}
        />
      )}
    </Page>
  );
}

function DiscontinuedNotice({ lines, onRemove }: { lines: UnavailableCartLine[]; onRemove: (id: string) => void }) {
  if (lines.length === 0) return null;
  return (
    <Box
      role="status"
      mx={3}
      mt={2}
      p={3}
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      <Box flex alignItems="center" style={{ gap: 6 }}>
        <AlertTriangle size={16} color="var(--color-text-warning)" aria-hidden />
        <Text size="small" bold style={{ color: 'var(--color-text-warning)' }}>
          {vi.cart.discontinuedHeading(lines.length)}
        </Text>
      </Box>
      <Text size="xSmall" style={{ marginTop: 4, color: 'var(--color-text-secondary)' }}>
        {vi.cart.discontinuedBody}
      </Text>
      {lines.map((l) => (
        <Box key={l.id} flex alignItems="center" justifyContent="space-between" style={{ gap: 8, marginTop: 8 }}>
          <Text size="small" style={{ flex: 1, minWidth: 0, textDecoration: 'line-through' }}>
            {l.productName}
            {l.variationName ? ` · ${l.variationName}` : ''} × {l.quantity}
          </Text>
          <Button variant="ghost" onPress={() => onRemove(l.id)}>
            {vi.cart.discontinuedRemove}
          </Button>
        </Box>
      ))}
    </Box>
  );
}

function CartSkeleton() {
  return (
    <Box p={3} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LineItemSkeleton />
      <LineItemSkeleton />
      <LineItemSkeleton />
    </Box>
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
  onFlashEnd,
  pending,
}: {
  line: CartLine;
  selected: boolean;
  onToggleSelect: () => void;
  onQty: (qty: number) => void;
  onRemove: () => void;
  onOpen: () => void;
  /** Hết giờ Giờ vàng khi khách đang xem: làm mới giỏ để API tính lại giá, không cần tải trang. */
  onFlashEnd: () => void;
  /** PATCH số lượng của chính dòng này đang bay: line.total lúc đó là số client tự nhân (optimistic), chưa phải số server. */
  pending: boolean;
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
  const compareAt = lineCompareAt(line);
  return (
    <Box
      data-testid="cart-line"
      p={3}
      style={{
        position: 'relative',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        boxShadow: 'var(--elevation-1)',
      }}
    >
      <Checkbox checked={selected} onChange={onToggleSelect}>
        <span style={SR_ONLY}>{`Chọn ${line.productName}`}</span>
      </Checkbox>
      <Box
        // Ảnh chỉ là đường tắt cho chuột/chạm; tên sản phẩm ngay bên cạnh là nút cho bàn phím và trình đọc màn hình,
        // để một dòng không có hai nút trùng tên.
        aria-hidden
        data-testid="cart-line-thumb"
        onClick={onOpen}
        style={{
          width: 72,
          height: 72,
          borderRadius: 'var(--radius-media)',
          overflow: 'hidden',
          background: 'var(--color-bg-subtle)',
          flex: '0 0 auto',
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ProductThumb src={line.thumbnail} alt={line.productName} size={72} />
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        {/* Chừa 36px bên phải cho thùng rác góc trên (vùng chạm 44 nhô ra khỏi lề thẻ). Tên 1-2 dòng chỉ cao 18-36px:
            tubu-hit-44 nới vùng chạm lên 44px mà không đổi bố cục dòng. */}
        <div style={{ paddingRight: 36 }}>
          <Text
            size="small"
            bold
            role="button"
            {...rowKeyboardProps()}
            onClick={onOpen}
            className="tubu-hit-44"
            style={{ cursor: 'pointer', display: 'block' }}
          >
            {line.productName}
          </Text>
        </div>
        {line.variationName && (
          <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
            {typeof line.variationName === 'object' && line.variationName !== null
              ? (line.variationName as { name?: string }).name ?? ''
              : String(line.variationName)}
          </Text>
        )}
        {line.isFlash && (
          <Box flex alignItems="center" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <Badge tone="promo" size="sm" icon={Zap}>
              {vi.flashSale.badge}
            </Badge>
            {line.flashEndAt ? (
              <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                <Countdown endAt={line.flashEndAt} mode="text" onEnd={onFlashEnd} />
              </Text>
            ) : (
              line.soldPct != null && Number.isFinite(line.soldPct) && clampPercent(line.soldPct) > 0 && (
                <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)' }}>
                  {vi.flashSale.soldPct(clampPercent(line.soldPct))}
                </Text>
              )
            )}
          </Box>
        )}
        {overStock && (
          <Box flex alignItems="center" style={{ gap: 4, marginTop: 2 }}>
            <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden />
            <Text size="xSmall" style={{ color: 'var(--color-text-warning)' }}>
              {line.stock > 0 ? vi.cart.stockLimited(line.stock) : vi.cart.outOfStock}
            </Text>
          </Box>
        )}
        {line.flashLimitNotice && (
          <Box flex alignItems="flex-start" style={{ gap: 4, marginTop: 2 }}>
            <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden style={{ flex: '0 0 auto', marginTop: 2 }} />
            <Text size="xSmall" data-testid="flash-limit-notice" style={{ color: 'var(--color-text-warning)' }}>
              {line.flashLimitNotice}
            </Text>
          </Box>
        )}
        {/* Hàng đáy: giá bên trái, bộ đếm 36px bên phải. Giá niêm yết gạch xếp DƯỚI giá bán (layout stack, cao 36 bằng bộ đếm): xếp ngang
            thì ở 375px hai giá cộng bộ đếm không vừa một hàng, giá rớt xuống dòng và dòng đang giảm cao gần gấp rưỡi dòng thường. Máy hẹp (320px)
            vẫn cho cả khối giá xuống dòng thay vì tràn. */}
        <Box flex alignItems="center" justifyContent="space-between" style={{ marginTop: 6, flexWrap: 'wrap', rowGap: 4, columnGap: 8 }}>
          <PriceTag value={line.unitPrice} compareAt={compareAt} size="sm" layout={compareAt ? 'stack' : 'inline'} tone={compareAt || line.isFlash ? 'deal' : 'default'} />
          <QuantitySelector size="sm" value={localQty} max={Math.max(1, line.stock)} onChange={setLocalQty} />
        </Box>
        {/* Số của server (line.total): máy chủ có thể tính lại giá cả dòng (flash hết suất). Ẩn khi SL chưa khớp server (chờ debounce) và khi PATCH còn bay (số lúc đó do client tự nhân). */}
        {line.quantity > 1 && localQty === line.quantity && !pending && (
          <Text size="xSmall" style={{ color: 'var(--color-text-secondary)', display: 'block', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            Thành tiền {formatVnd(line.total)}
          </Text>
        )}
      </Box>
      <IconButton
        icon={Trash2}
        label={`Xoá ${line.productName}`}
        onPress={onRemove}
        size="sm"
        style={{ position: 'absolute', top: 4, right: 4 }}
      />
    </Box>
  );
}

function CouponRow({
  summary,
  previewParams,
  previewKey,
  onOpen,
}: {
  summary: CartSummary;
  /** Món đang chọn (itemIds undefined = cả giỏ) và gian hàng; undefined = chưa chọn món nào. */
  previewParams?: { storefrontSlug?: string; itemIds?: string[] };
  /** Dấu vân tay của các món đang chọn ('' = chưa chọn món nào). */
  previewKey: string;
  /** Mở tấm chọn mã (do trang giữ, ngoài chân dính). */
  onOpen: () => void;
}) {
  // Chỉ gợi ý khi giỏ chưa có mã: không tự áp, khách vẫn chọn ở tấm chọn mã.
  const hint = useCouponHint(!summary.couponCode, previewParams, previewKey);

  return (
    <>
      {/* Hàng gọn nằm trong chân dính (mã là bước cuối trước khi bấm Thanh toán): một dòng, vùng chạm 44. */}
      <Box
        className="tubu-press"
        role="button"
        {...rowKeyboardProps()}
        onClick={() => {
          haptic('light');
          onOpen();
        }}
        style={{
          minHeight: 44,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
          boxShadow: 'inset 0 -1px 0 var(--color-border-subtle)',
        }}
      >
        <Box flex alignItems="center" style={{ gap: 8, minWidth: 0, flex: 1 }}>
          <Ticket size={20} color="var(--clay-700)" aria-hidden style={{ flex: '0 0 auto' }} />
          <Text size="small" bold style={{ color: 'var(--color-text-primary)', flex: '0 0 auto' }}>
            Mã giảm giá
          </Text>
          {summary.couponCode ? (
            <Box flex alignItems="center" style={{ gap: 8, minWidth: 0 }}>
              <span
                style={{
                  background: 'var(--clay-50)',
                  border: '1px dashed var(--clay-500)',
                  borderRadius: 'var(--radius-control)',
                  padding: '2px 6px',
                  color: 'var(--clay-700)',
                  fontSize: 11,
                  fontWeight: 700,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {summary.couponCode}
              </span>
              {summary.discount > 0 && (
                <Text size="xSmall" style={{ color: 'var(--color-text-success)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  -{formatVnd(summary.discount)}
                </Text>
              )}
            </Box>
          ) : hint ? (
            // couponHintShort rút số tiền xuống k/tr nên một dòng ở 375px; không cắt "…" phòng khi máy 320px hay cỡ chữ lớn thì xuống dòng trong hàng 44px.
            <Text size="xSmall" data-testid="coupon-hint" style={{ color: 'var(--color-text-brand)', minWidth: 0, lineHeight: 'var(--type-label-lh)' }}>
              {couponHintShort(hint)}
            </Text>
          ) : (
            <Text size="xSmall" style={{ color: 'var(--color-text-tertiary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Chọn hoặc nhập mã giảm giá
            </Text>
          )}
        </Box>

        <Box flex alignItems="center" style={{ gap: 2, flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--color-text-brand)' }}>
          <Text size="xSmall" bold style={{ color: 'var(--color-text-brand)' }}>
            {summary.couponCode ? 'Thay đổi' : 'Chọn mã'}
          </Text>
          <ChevronRight size={16} color="var(--color-text-brand)" aria-hidden />
        </Box>
      </Box>
    </>
  );
}

/** Dòng giảm giá trong chân dính: bỏ đệm dọc 6px mặc định của KeyValueRow (khoảng cách đã do thanh lo) để thêm một dòng giảm chỉ tốn ~24px. */
const COMPACT_ROW = { padding: 0 } as const;

/** Sticky summary + freeship progress (DI #1). */
function StickySummary({
  summary,
  selectedSubtotal,
  selectedCount,
  allSelected,
  priced,
  overStock,
  outOfStockNames,
  tubuOnlyFreeship,
  tubuSelectedSubtotal,
  onCheckout,
  saving,
  coupon,
}: {
  summary: CartSummary;
  selectedSubtotal: number;
  selectedCount: number;
  allSelected: boolean;
  /** Giá của phần chọn từ máy chủ (chỉ khi chọn một phần và đã có số đúng); null = chưa có, không hiện giảm giá. */
  priced: CartSummary | null;
  overStock: boolean;
  /** Tên các dòng đang chọn mà tồn bằng 0: nói rõ dòng nào cần bỏ chọn hoặc xoá. */
  outOfStockNames: string[];
  /** Giỏ có hàng gian hàng tự giao: miễn phí vận chuyển chỉ áp cho phần Tubu Tree giao. */
  tubuOnlyFreeship: boolean;
  tubuSelectedSubtotal: number;
  onCheckout: () => void;
  /** Tiền khách tiết kiệm nhờ giá giảm của các dòng đang chọn (chỉ hiển thị, tiền thật do máy chủ tính). */
  saving: number;
  /** Hàng mã giảm giá: dính cùng tổng tiền để chọn mã xong là bấm Thanh toán luôn. */
  coupon: ReactNode;
}) {
  const threshold = summary.freeshipThreshold;
  // Freeship progress theo tổng ĐANG CHỌN (không phải toàn giỏ) — khớp số tiền sẽ thanh toán. Có hàng gian hàng tự giao
  // thì chỉ tính phần Tubu Tree giao (checkout tính phí kho Tubu trên tiền hàng của kiện Tubu).
  const base = tubuOnlyFreeship ? tubuSelectedSubtotal : selectedSubtotal;
  const showFreeship = !tubuOnlyFreeship || base > 0;
  // `summary.freeship` do máy chủ tính trên cả giỏ kể cả dòng hết hàng, nên không tin khi còn dòng hết hàng đang chọn.
  const reached = (!tubuOnlyFreeship && allSelected && summary.freeship && outOfStockNames.length === 0) || base >= threshold;
  const progressPct = Math.min(100, Math.round((base / threshold) * 100));
  const remaining = Math.max(0, threshold - base);
  // Cả giỏ lấy số giảm từ giỏ; một phần giỏ lấy từ giá phần chọn của máy chủ (combo cần đủ bộ trong phần chọn); chưa có thì không
  // hiện số nào (thanh toán tính lại) — tránh số sai.
  const shown = allSelected ? summary : priced;
  const discount = shown?.discount ?? 0;
  const comboDiscount = shown?.comboDiscount ?? 0;
  const tierDiscount = shown?.tierDiscount ?? 0;
  // Giảm giá của phần chọn tính trên tạm tính CỦA CHÍNH phần chọn máy chủ trả (giá có thể đổi so với giỏ đã tải, vd hết giờ vàng).
  const shownSubtotal = !allSelected && priced ? priced.subtotal : selectedSubtotal;
  const subsetNotice = !allSelected && priced?.couponCode ? priced.couponNotice : null;

  return (
    <StickyActionBar
      dense
      summary={
        <>
          {coupon}
          {showFreeship && (
            <Box>
              <Text size="xSmall" style={{ color: reached ? 'var(--color-text-success)' : 'var(--color-text-secondary)' }}>
                {reached
                  ? tubuOnlyFreeship
                    ? vi.cart.freeshipReachedTubuOnly
                    : vi.cart.freeshipReached
                  : vi.cart.freeshipProgress(formatVnd(remaining)) + (tubuOnlyFreeship ? ' cho phần hàng Tubu Tree giao' : '')}
              </Text>
              {/* Đã đạt thì chỉ còn dòng chữ: thanh đầy 100% không nói thêm gì mà tốn chiều cao của chân dính. */}
              {!reached && (
                <Box
                  aria-hidden
                  data-testid="freeship-bar"
                  style={{
                    height: 4,
                    background: 'var(--stone-200)',
                    borderRadius: 'var(--radius-pill)',
                    marginTop: 4,
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    style={{
                      width: `${progressPct}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, var(--forest-200), var(--color-action-primary-bg))',
                      borderRadius: 'var(--radius-pill)',
                      transition: 'width var(--dur-slow) var(--ease-out)',
                    }}
                  />
                </Box>
              )}
            </Box>
          )}

          {comboDiscount > 0 && (
            <KeyValueRow label={vi.cart.comboDiscount} value={`-${formatVnd(comboDiscount)}`} tone="success" style={COMPACT_ROW} />
          )}
          {discount > 0 && (
            <KeyValueRow label={vi.cart.discount} value={`-${formatVnd(discount)}`} tone="success" style={COMPACT_ROW} />
          )}
          {tierDiscount > 0 && <KeyValueRow label={vi.cart.tierDiscount} value={`-${formatVnd(tierDiscount)}`} tone="success" style={COMPACT_ROW} />}
          {subsetNotice && (
            <Text size="xSmall" role="status" data-testid="coupon-notice" style={{ color: 'var(--color-text-warning)' }}>
              {subsetNotice}
            </Text>
          )}
          {outOfStockNames.length > 0 && (
            <Box flex alignItems="flex-start" role="status" style={{ gap: 4 }}>
              <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              <Text size="xSmall" style={{ color: 'var(--color-text-warning)' }}>
                {vi.cart.outOfStockBlocked(outOfStockNames)}
              </Text>
            </Box>
          )}
          {overStock && outOfStockNames.length === 0 && (
            <Box flex alignItems="center" role="status" style={{ gap: 4 }}>
              <AlertTriangle size={13} color="var(--color-text-warning)" aria-hidden />
              <Text size="xSmall" style={{ color: 'var(--color-text-warning)' }}>
                {vi.cart.overStockBlocked}
              </Text>
            </Box>
          )}
        </>
      }
      lead={
        <>
          {/* Con số này ĐÃ trừ giảm giá và CHƯA gồm ship, trong khi "Tạm tính" ở màn Thanh toán
              là tiền hàng gộp chưa trừ gì — cùng một nhãn, hai số khác nhau, khách tưởng bị đội
              giá (P2-4 audit mạch lạc). Nói rõ ngay trên nhãn, nhưng chỉ khi thật sự có giảm. */}
          <div style={{ fontSize: 'var(--type-label-size)', lineHeight: 'var(--type-label-lh)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
            {comboDiscount + discount + tierDiscount > 0 ? vi.cart.subtotalAfterDiscount : vi.cart.subtotal}
          </div>
          <div
            data-testid="cart-total-value"
            style={{ fontSize: 'var(--type-title-md-size)', lineHeight: 'var(--type-title-md-lh)', fontWeight: 700, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
          >
            {formatVnd(Math.max(0, shownSubtotal - comboDiscount - discount - tierDiscount))}
          </div>
          {saving > 0 && (
            <Text size="xSmall" data-testid="cart-saving" style={{ color: 'var(--color-text-success)', display: 'block', whiteSpace: 'nowrap' }}>
              {fillCopy('cart.saving', { x: formatVnd(saving) })}
            </Text>
          )}
        </>
      }
      primary={
        <Button fullWidth disabled={selectedCount === 0 || overStock} onPress={onCheckout}>
          {vi.cart.checkout(selectedCount)}
        </Button>
      }
    />
  );
}
