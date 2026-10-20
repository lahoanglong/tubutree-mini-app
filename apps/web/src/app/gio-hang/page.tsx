'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, Truck, Leaf, Zap, Trash2, Minus, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { addToCart, getCart, getCartSelection, updateCartItem, removeCartItem, formatVnd, type CartLine } from '@/lib/shop-client';
import { CouponBox, couponPreviewKey, PREVIEW_DEBOUNCE_MS, useSettled } from '@/components/coupon-box';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ui, uiBar } from '@/lib/guest-ui';
import { fulfillerLabel, groupByFulfiller, showFulfillerHeaders, tubuSubtotal } from '@/lib/shipments';
import { rememberCheckoutSelection } from '@/lib/checkout-selection';
import { ctvSlugFor, getStorefrontContext } from '@/lib/storefront-context';
import { cartKey, useCartKey } from '@/lib/cart-key';
import BackLink from '@/components/back-link';
import { TitleBand, CheckMark, miniCheckboxWrap, miniCheckbox, mini } from '@/components/order-mobile/mobile-ui';
import { KeyValueRow } from '@/components/mini';

// Sau khi xoá một dòng, khách có chừng này để hoàn tác (thêm lại đúng phân loại và số lượng).
const UNDO_WINDOW_MS = 3500;

// Ô −/+ của dòng giỏ: từ md nút trần trong khung viền chung; ở điện thoại là hai ô vuông có viền tách rời như QuantitySelector của Mini App.
const qtyButton =
  'flex h-11 w-11 items-center justify-center text-lg disabled:opacity-40 max-md:rounded-control max-md:border max-md:border-[var(--color-border-subtle)] max-md:bg-[var(--color-bg-surface)]';

const clampPercent = (pct: number) => (Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0);

export default function CartPage() {
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const cartKeyNow = useCartKey();
  const cartQ = useQuery({ queryKey: cartKeyNow, queryFn: getCart, enabled: phase === 'authenticated' });
  // Chọn món để thanh toán một phần giỏ: nhớ tập ĐÃ BỎ CHỌN nên món mới thêm tự được chọn và món đã xoá tự biến mất.
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());
  // Chọn một phần giỏ (còn ít nhất một dòng): hỏi máy chủ giá của đúng phần đó, cùng nhịp debounce với xem trước mã. Chọn cả giỏ
  // dùng thẳng giỏ trong bộ nhớ, không hỏi thêm. Khoá nằm dưới ['cart', gian hàng] nên làm mới giỏ cũng làm mới giá phần chọn.
  const subsetLines = (cartQ.data?.items ?? []).filter((it) => !deselected.has(it.id));
  // Mã đang áp nằm trong dấu vân tay: áp/bỏ mã đổi giá phần chọn dù id, số lượng, thành tiền không đổi.
  const subsetSig =
    cartQ.data && subsetLines.length > 0 && subsetLines.length < cartQ.data.items.length
      ? JSON.stringify([subsetLines.map((it) => it.id), couponPreviewKey(subsetLines), cartQ.data.couponCode])
      : null;
  const settledSubsetSig = useSettled(subsetSig, PREVIEW_DEBOUNCE_MS);
  const selectionQ = useQuery({
    queryKey: [...cartKeyNow, 'selection', settledSubsetSig],
    queryFn: () => getCartSelection((JSON.parse(settledSubsetSig!) as [string[], string, string | null])[0]),
    enabled: phase === 'authenticated' && !!settledSubsetSig,
    retry: false,
  });
  // Số chỉ đúng cho đúng phần đã hỏi: vừa đổi chọn/số lượng (chưa hỏi lại), đang tải lại hoặc lỗi thì không hiện số cũ.
  const priced =
    !!subsetSig && settledSubsetSig === subsetSig && selectionQ.isSuccess && !selectionQ.isFetching ? selectionQ.data : null;
  // Cùng gian hàng thanh toán gửi (combo) để số giảm của từng mã đúng số thanh toán sẽ trừ.
  const [ctvSlug] = useState(() => ctvSlugFor(getStorefrontContext()));
  const toggleSelect = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const update = useMutation({
    mutationFn: ({ id, q }: { id: string; q: number }) => updateCartItem(id, q),
    onSuccess: (data) => qc.setQueryData(cartKey(), data),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeCartItem(id),
    onSuccess: (data) => qc.setQueryData(cartKey(), data),
  });
  const [removedLine, setRemovedLine] = useState<CartLine | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );
  // Thanh hoàn tác chỉ mở sau khi máy chủ xoá xong: hoàn tác (thêm lại) không được vượt mặt lệnh xoá còn đang bay.
  const removeWithUndo = (line: CartLine) =>
    remove.mutate(line.id, {
      onSuccess: () => {
        setUndoError(null);
        setRemovedLine(line);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setRemovedLine(null), UNDO_WINDOW_MS);
      },
    });
  const undoRemove = () => {
    if (!removedLine) return;
    const line = removedLine;
    setRemovedLine(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    addToCart(line.variationId, line.quantity)
      .then((c) => qc.setQueryData(cartKey(), c))
      .catch((e: unknown) => setUndoError(e instanceof Error ? e.message : 'Không thêm lại được sản phẩm.'));
  };
  // Chặn double-click/race trên cùng 1 dòng: trong lúc đang cập nhật/xóa 1 item, khóa các
  // nút của đúng item đó (item khác vẫn thao tác được bình thường).
  const busyItemId =
    (update.isPending ? update.variables?.id : null) ?? (remove.isPending ? remove.variables : null);
  const failedItemId =
    (update.isError ? update.variables?.id : null) ?? (remove.isError ? remove.variables : null);

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
        <LoginRequired message="Đăng nhập để xem giỏ hàng của bạn." returnTo="/gio-hang" />
      </Shell>
    );
  }

  const cart = cartQ.data;
  // Checkout sẽ từ chối dòng hết hàng/vượt tồn: chặn từ giỏ để khách biết phải sửa gì thay vì gặp lỗi ở bước sau.
  const allItems = cart?.items ?? [];
  const selectedItems = allItems.filter((it) => !deselected.has(it.id));
  const allSelected = selectedItems.length === allItems.length;
  const selectedSubtotal = selectedItems.reduce((sum, it) => sum + it.total, 0);
  const selectedCount = selectedItems.reduce((sum, it) => sum + it.quantity, 0);
  // Chỉ chặn theo các dòng đang chọn: bỏ chọn dòng hết hàng thì vẫn thanh toán được phần còn lại.
  const stockBlocked = selectedItems.some((it) => it.stock <= 0 || it.quantity > it.stock);
  const toggleAll = () => setDeselected(allSelected ? new Set(allItems.map((it) => it.id)) : new Set());
  // Mỗi nơi giao thành một đơn riêng khi đặt (D4): chia giỏ theo nơi giao để khách thấy trước.
  const groups = groupByFulfiller(allItems);
  const withHeaders = showFulfillerHeaders(groups);
  const hasMerchant = groupByFulfiller(selectedItems).some((g) => g.fulfiller.kind === 'MERCHANT');
  // Tiến độ miễn phí giao hàng theo phần ĐANG CHỌN (đúng số sẽ thanh toán); có hàng gian hàng tự giao thì chỉ tính phần Tubu giao.
  const freeshipBase = hasMerchant ? tubuSubtotal(selectedItems) : selectedSubtotal;
  const freeshipReached = (!hasMerchant && allSelected && !!cart?.freeship) || (!!cart && freeshipBase >= cart.freeshipThreshold);
  const remainingFreeship =
    cart && selectedItems.length > 0 && (!hasMerchant || freeshipBase > 0) ? Math.max(0, cart.freeshipThreshold - freeshipBase) : 0;
  // Số giảm hiển thị: cả giỏ lấy từ giỏ, một phần giỏ lấy từ giá phần chọn của máy chủ; chưa có giá đó thì không hiện (thanh toán tính lại).
  const shown = allSelected ? cart : priced;
  const shownDiscount = shown?.discount ?? 0;
  const shownCombo = shown?.comboDiscount ?? 0;
  const shownTier = shown?.tierDiscount ?? 0;
  // Giảm giá của phần chọn tính trên tạm tính CỦA CHÍNH phần chọn máy chủ trả (giá có thể đổi so với giỏ đã tải, vd hết giờ vàng).
  const shownSubtotal = !allSelected && priced ? priced.subtotal : selectedSubtotal;
  const payTotal = Math.max(0, shownSubtotal - shownCombo - shownDiscount - shownTier);
  const onPay = () => rememberCheckoutSelection(allSelected ? null : selectedItems.map((it) => it.id));
  // Lý do nút Thanh toán đang khoá (lời giải thích đầy đủ nằm ở khung tóm tắt; thanh dính đáy nhắc lại ngay cạnh nút).
  const payHint =
    selectedItems.length === 0
      ? 'Chọn ít nhất một sản phẩm để thanh toán.'
      : stockBlocked
        ? 'Có sản phẩm đã hết hàng hoặc vượt số lượng còn lại. Hãy xóa, giảm số lượng hoặc bỏ chọn rồi thanh toán.'
        : null;
  // Thanh tiến độ freeship theo phần đang chọn như StickySummary của Mini App; có hàng gian hàng tự giao thì chỉ hiện khi phần Tubu giao > 0.
  const barRemaining = cart ? Math.max(0, cart.freeshipThreshold - freeshipBase) : 0;
  const showFreeship = !!cart && (!hasMerchant || freeshipBase > 0);
  const freeshipPct = cart && cart.freeshipThreshold > 0 ? Math.min(100, Math.round((freeshipBase / cart.freeshipThreshold) * 100)) : 100;
  const showBar = !cartQ.isLoading && !cartQ.isError && !!cart && cart.items.length > 0;

  return (
    <Shell>
      {cart && (cart.unavailableItems?.length ?? 0) > 0 && (
        <div
          role="status"
          className="mb-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg"
        >
          <p className="font-semibold">{cart.unavailableItems!.length} sản phẩm đã ngừng bán</p>
          <p className="mt-0.5">Không thể đặt các sản phẩm này nên đã được tách khỏi đơn của bạn.</p>
          <ul className="mt-2 space-y-1">
            {cart.unavailableItems!.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-words line-through">
                  {it.productName}
                  {it.variationName ? ` · ${it.variationName}` : ''} × {it.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => remove.mutate(it.id)}
                  disabled={remove.isPending && remove.variables === it.id}
                  aria-label={`Xoá ${it.productName} khỏi giỏ hàng`}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 font-semibold underline disabled:opacity-50"
                >
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cartQ.isLoading ? (
        <p className="py-10 text-center text-stone-600">Đang tải giỏ hàng…</p>
      ) : cartQ.isError ? (
        <div className="py-20 text-center">
          <p className="text-stone-700">Không tải được giỏ hàng.</p>
          <button type="button" onClick={() => void cartQ.refetch()} className={`${ui.btnPrimary} mt-4`}>
            Thử lại
          </button>
        </div>
      ) : !cart || cart.items.length === 0 ? (
        <div className="py-20 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
            <ShoppingBag className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-stone-900">Giỏ hàng đang trống</h2>
          <p className="mt-1 text-sm text-stone-600">Khám phá các sản phẩm xanh và bảo vệ môi trường cùng Tubu Tree</p>
          <Link href="/" className={`${ui.btnPrimary} mt-5`}>
            Khám phá sản phẩm
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 max-md:gap-3 md:grid-cols-3">
          <div className="min-w-0 md:col-span-2">
            <label className="relative mb-3 flex min-h-11 cursor-pointer items-center gap-3 px-1 text-sm font-medium text-stone-900 max-md:mb-1 max-md:min-h-0 max-md:px-0 max-md:py-1 max-md:font-normal max-md:text-[length:var(--type-body-md-size)]">
              <span className={miniCheckboxWrap}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Chọn tất cả sản phẩm"
                  className={miniCheckbox}
                />
                <CheckMark />
              </span>
              Chọn tất cả
            </label>
            {!freeshipReached && remainingFreeship > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-card border border-forest-200 bg-forest-50 px-4 py-3 text-sm text-forest-800 max-md:hidden">
                <Truck className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                <span>
                  Mua thêm <strong className="font-bold">{formatVnd(remainingFreeship)}</strong> để được miễn phí giao hàng
                  {hasMerchant ? ' phần hàng Tubu Tree giao' : ''}
                </span>
              </div>
            )}
            {withHeaders && (
              <p className="mb-3 text-xs text-stone-600 max-md:mb-1">
                Giỏ có hàng do nhiều nơi giao: mỗi nơi giao thành một đơn riêng, có phí giao riêng.
              </p>
            )}
            <div className="space-y-3">
              {groups.map((g) => (
                <section
                  key={g.key}
                  aria-label={withHeaders ? fulfillerLabel(g.fulfiller) : 'Sản phẩm trong giỏ'}
                  className={`divide-y divide-stone-200 ${ui.card} max-md:space-y-2.5 max-md:divide-y-0 max-md:border-0 max-md:bg-transparent max-md:shadow-none`}
                >
                  {withHeaders && (
                    <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-stone-900 max-md:px-0">
                      <Truck className="h-4 w-4 text-forest-600" aria-hidden="true" />
                      {fulfillerLabel(g.fulfiller)}
                    </h2>
                  )}
                  {g.items.map((it) => {
                    // Hết hàng / vượt tồn: `+` chỉ làm khách mất dòng (quantity kẹp về 0 → API xoá) mà không báo gì.
                    const soldOut = it.stock <= 0;
                    const atMax = !soldOut && it.quantity >= it.stock;
                    const busy = busyItemId === it.id;
                    return (
                      <div key={it.id} className="flex gap-3 p-3 max-md:items-center max-md:rounded-card max-md:bg-[var(--color-bg-surface)] max-md:shadow-[var(--elevation-1)]">
                        <label className="relative flex h-11 w-9 flex-none cursor-pointer items-center justify-center">
                          <span className={miniCheckboxWrap}>
                            <input
                              type="checkbox"
                              checked={!deselected.has(it.id)}
                              onChange={() => toggleSelect(it.id)}
                              aria-label={`Chọn ${it.productName} để thanh toán`}
                              className={miniCheckbox}
                            />
                            <CheckMark />
                          </span>
                        </label>
                        <Link
                          href={`/san-pham/${it.slug}`}
                          tabIndex={-1}
                          aria-hidden="true"
                          className={`flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-control bg-forest-50 ${mini.thumb}`}
                        >
                          {it.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Leaf className="h-6 w-6 text-forest-600 max-md:h-7 max-md:w-7 max-md:text-[color:var(--forest-200)]" aria-hidden="true" />
                          )}
                        </Link>
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-medium text-stone-900 max-md:font-semibold">
                            <Link href={`/san-pham/${it.slug}`} className="hover:underline">
                              {it.productName}
                            </Link>
                          </div>
                          <div className="break-words text-xs text-stone-600 max-md:text-[color:var(--color-text-tertiary)]">{it.variationName}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-semibold text-stone-900">{formatVnd(it.unitPrice)}</span>
                            {it.isFlash && (
                              <span
                                data-testid="cart-flash-badge"
                                className="inline-flex items-center gap-0.5 rounded-full bg-promo-bg px-2 py-0.5 text-xs font-bold text-promo-fg"
                              >
                                <Zap className="h-3 w-3" aria-hidden="true" />
                                Giá Giờ vàng
                              </span>
                            )}
                            {it.isFlash && it.soldPct != null && Number.isFinite(it.soldPct) && (
                              <span className="text-xs text-stone-600">Đã bán {clampPercent(it.soldPct)}%</span>
                            )}
                          </div>
                          {/* Số của máy chủ (it.total): máy chủ có thể tính lại giá cả dòng (flash hết suất). Ẩn khi lệnh đổi số lượng của dòng còn bay, vì lúc đó số chưa phải của máy chủ. Từ md đã có cột tổng bên phải. */}
                          {it.quantity > 1 && !(update.isPending && update.variables?.id === it.id) && (
                            <div className="text-xs tabular-nums text-stone-600 md:hidden">Thành tiền {formatVnd(it.total)}</div>
                          )}
                          {it.flashLimitNotice && <p className="mt-1 text-xs font-medium text-warning-fg">{it.flashLimitNotice}</p>}
                          {soldOut && (
                            <p className="mt-1 text-xs font-semibold text-danger-fg">
                              Hết hàng — hãy xóa khỏi giỏ hoặc bỏ chọn để thanh toán các món còn lại
                            </p>
                          )}
                          {!soldOut && atMax && (
                            <p className="mt-1 text-xs font-medium text-warning-fg">Chỉ còn {it.stock} sản phẩm</p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 max-md:mt-2 max-md:gap-y-1">
                            {!soldOut && (
                              <div className="flex items-center rounded-control border border-stone-450 text-sm max-md:gap-3 max-md:rounded-none max-md:border-0">
                                <button
                                  type="button"
                                  onClick={() => update.mutate({ id: it.id, q: Math.max(1, Math.min(it.stock, it.quantity - 1)) })}
                                  disabled={busy}
                                  aria-label={`Giảm số lượng ${it.productName}`}
                                  className={qtyButton}
                                >
                                  <Minus className="h-[18px] w-[18px] md:hidden" strokeWidth={2.2} aria-hidden="true" />
                                  <span className="max-md:hidden">−</span>
                                </button>
                                <span className="w-7 text-center text-stone-900 max-md:min-w-[22px] max-md:font-semibold" aria-live="polite">
                                  {it.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => update.mutate({ id: it.id, q: it.quantity + 1 })}
                                  disabled={busy || atMax}
                                  aria-label={`Tăng số lượng ${it.productName}`}
                                  className={qtyButton}
                                >
                                  <Plus className="h-[18px] w-[18px] md:hidden" strokeWidth={2.2} aria-hidden="true" />
                                  <span className="max-md:hidden">+</span>
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => removeWithUndo(it)}
                              disabled={busy}
                              aria-label={`Xóa ${it.productName} khỏi giỏ hàng`}
                              className={`inline-flex min-h-11 items-center px-3 text-sm font-medium text-danger-fg disabled:opacity-40 max-md:ml-auto max-md:justify-center max-md:px-0 ${
                                soldOut ? 'rounded-control border border-danger-fg font-semibold' : ''
                              }`}
                            >
                              <Trash2 className="h-5 w-5 text-[color:var(--color-text-primary)] md:hidden" strokeWidth={1.75} aria-hidden="true" />
                              <span className="max-md:hidden">Xóa</span>
                            </button>
                          </div>
                          {failedItemId === it.id && (
                            <p role="alert" className="mt-1 text-xs text-danger-fg">
                              {(update.error ?? remove.error) instanceof Error
                                ? (update.error ?? remove.error)?.message
                                : 'Cập nhật giỏ hàng thất bại.'}
                            </p>
                          )}
                        </div>
                        <div className="flex-none font-semibold text-stone-900 max-md:hidden">{formatVnd(it.total)}</div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          </div>

          <div data-testid="cart-summary" className={`h-fit p-4 ${ui.card} max-md:contents`}>
            <div data-testid="cart-summary-rows" className="max-md:hidden">
            <div className="flex justify-between text-sm">
              <span className="text-stone-600">Tạm tính</span>
              <span className="text-stone-900">{formatVnd(shownSubtotal)}</span>
            </div>
            {shownCombo > 0 && (
              <div className="mt-1 flex justify-between text-sm text-success-fg">
                <span>Giảm giá combo</span>
                <span>-{formatVnd(shownCombo)}</span>
              </div>
            )}
            {shownDiscount > 0 && (
              <div className="mt-1 flex justify-between text-sm text-success-fg">
                <span>Giảm giá{cart.couponCode ? ` (${cart.couponCode})` : ''}</span>
                <span>-{formatVnd(shownDiscount)}</span>
              </div>
            )}
            {shownTier > 0 && (
              <div className="mt-1 flex justify-between text-sm text-success-fg">
                <span>Ưu đãi hạng thành viên</span>
                <span>-{formatVnd(shownTier)}</span>
              </div>
            )}
            </div>
            <CouponBox
              currentCode={cart.couponCode}
              appliedDiscount={shownDiscount}
              subtotal={selectedSubtotal}
              // Câu giải thích chỉ hiện khi thuộc phần đang hiển thị: cả giỏ, hoặc giá phần chọn đã có; chưa có thì thôi (không mượn câu của cả giỏ).
              notice={shown?.couponNotice ?? null}
              // Không chọn món nào: không hỏi máy chủ (itemIds rỗng bị coi là cả giỏ), thẻ giữ cách hiện cũ.
              preview={
                selectedItems.length === 0
                  ? undefined
                  : { storefrontSlug: ctvSlug, itemIds: allSelected ? undefined : selectedItems.map((it) => it.id) }
              }
              previewKey={couponPreviewKey(selectedItems)}
            />
            {!allSelected && !priced && cart.couponCode && (
              <p className="mt-2 text-xs text-stone-600 max-md:mt-0 max-md:px-1">Mua một phần giỏ: mã giảm giá được tính lại ở bước thanh toán.</p>
            )}
            <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900 max-md:hidden">
              <span>Tổng</span>
              <span>{formatVnd(payTotal)}</span>
            </div>
            {/* Dưới md nút và lời giải thích nằm ở thanh dính đáy (cuối trang); từ md giữ ở khung tóm tắt. */}
            <div className="hidden md:block">
              {selectedItems.length === 0 ? (
                <>
                  <button type="button" disabled className={`${ui.btnPrimary} mt-4 w-full`}>
                    Thanh toán (0)
                  </button>
                  <p role="status" className="mt-2 text-xs text-stone-600">
                    {payHint}
                  </p>
                </>
              ) : stockBlocked ? (
                <>
                  <button type="button" disabled className={`${ui.btnPrimary} mt-4 w-full`}>
                    Thanh toán ({selectedCount})
                  </button>
                  <p role="alert" className="mt-2 text-xs text-danger-fg">
                    {payHint}
                  </p>
                </>
              ) : (
                <Link href="/thanh-toan" onClick={onPay} className={`${ui.btnPrimary} mt-4 w-full`}>
                  Thanh toán ({selectedCount})
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
      {undoError && (
        <p role="alert" className="mt-3 text-sm text-danger-fg">
          {undoError}
        </p>
      )}
      {removedLine && (
        <div
          role="status"
          className={`fixed inset-x-3 z-30 mx-auto flex max-w-md items-center justify-between rounded-control bg-stone-900 px-4 py-2 text-sm text-stone-0 ${
            showBar ? 'bottom-[calc(var(--sticky-bar-h,8rem)+0.5rem)] md:bottom-6' : 'bottom-6'
          }`}
        >
          <span>Đã bỏ khỏi giỏ</span>
          <button type="button" onClick={undoRemove} className="min-h-11 px-2 font-bold text-forest-200">
            Hoàn tác
          </button>
        </div>
      )}
      {showBar && (
        <StickyActionBar label="Thanh toán">
          {/* Dưới md khung tóm tắt bị ẩn hẳn (cả với trình đọc màn hình): lời báo ở đây là bản duy nhất khách thấy/nghe được. */}
          {payHint && (
            <p
              id="cart-pay-hint"
              role={stockBlocked ? 'alert' : 'status'}
              className={`mb-2 text-xs ${stockBlocked ? 'text-danger-fg' : 'text-stone-600'}`}
            >
              {payHint}
            </p>
          )}
          <div className="pb-1 pt-1">
            {showFreeship && (
              <div className="mb-0.5">
                <div className={`text-xs ${freeshipReached ? 'text-success-fg' : 'text-stone-600'}`}>
                  {freeshipReached
                    ? hasMerchant
                      ? 'Miễn phí giao hàng cho phần hàng Tubu Tree giao'
                      : 'Bạn được miễn phí giao hàng 🌿'
                    : `Mua thêm ${formatVnd(barRemaining)} để được miễn phí giao hàng${hasMerchant ? ' cho phần hàng Tubu Tree giao' : ''}`}
                </div>
                <div aria-hidden="true" className="mt-[5px] h-[5px] overflow-hidden rounded-full bg-stone-200">
                  <div
                    data-testid="freeship-fill"
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${freeshipPct}%`,
                      background: freeshipReached ? 'var(--forest-400)' : 'linear-gradient(90deg, var(--forest-200), var(--color-action-primary-bg))',
                    }}
                  />
                </div>
              </div>
            )}
            {shownCombo > 0 && <KeyValueRow label="Giảm giá combo" value={`-${formatVnd(shownCombo)}`} tone="success" />}
            {shownDiscount > 0 && <KeyValueRow label="Giảm giá" value={`-${formatVnd(shownDiscount)}`} tone="success" />}
            {shownTier > 0 && <KeyValueRow label="Ưu đãi hạng thành viên" value={`-${formatVnd(shownTier)}`} tone="success" />}
            <KeyValueRow label="Tạm tính (đã giảm, chưa gồm phí giao hàng)" value={formatVnd(payTotal)} emphasis />
            {payHint ? (
              <button type="button" disabled aria-describedby="cart-pay-hint" className={`${uiBar.primary} mt-2 w-full`}>
                Thanh toán ({selectedCount})
              </button>
            ) : (
              <Link href="/thanh-toan" onClick={onPay} className={`${uiBar.primary} mt-2 w-full`}>
                Thanh toán ({selectedCount})
              </Link>
            )}
          </div>
        </StickyActionBar>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0">
      <BackLink href="/">
        ← Tiếp tục mua sắm
      </BackLink>
      <TitleBand title="Giỏ hàng" className="md:mt-1" />
      <div className="mt-4 max-md:mt-0 max-md:px-3 max-md:pt-2">{children}</div>
    </main>
  );
}
