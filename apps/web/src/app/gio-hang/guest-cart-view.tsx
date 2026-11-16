'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Trash2, Zap } from 'lucide-react';
import { subtotalBucket } from '@tubutree/shared-types';
import { CART_OUT_OF_STOCK } from '@tubutree/app-core/cart-copy';
import { cartStockNote } from '@tubutree/app-core/commerce/stock-text';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge, Card, FreeShippingProgressBar, IconButton, PriceTag, ProductThumb, QuantitySelector } from '@/components/mini';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { trackPurchase } from '@/lib/analytics';
import { formatVnd } from '@/lib/format-vnd';
import { ui, uiBar } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { useFlashListExpiry } from '@/lib/use-flash-expiry';
import { useRunningFlash } from '@/lib/use-flash-sales';
import { useFreeShipThreshold } from '@/lib/use-free-ship-threshold';
import { variationLabel } from '@/lib/variation-label';
import { useGuestCartProducts } from '@/lib/guest-cart/products';
import { removeGuestLine, setGuestQuantity } from '@/lib/guest-cart/store';
import { useGuestCartLines } from '@/lib/guest-cart/use-guest-cart';
import { guestCartView, type GuestCartRow } from '@/lib/guest-cart/view';

const LOGIN_TO_ORDER = loginHref('/gio-hang');

/**
 * Giỏ của khách chưa đăng nhập (cờ `web.guest_cart_enabled`): món, giá hiện tại lấy lại từ API công khai, số lượng, xoá, tạm tính và tiến độ
 * Miễn phí giao hàng. Không có mã giảm giá hay điểm (cần tài khoản), không chọn từng món: một nút chính "Đăng nhập để đặt hàng"; đăng nhập
 * xong giỏ khách tự chuyển vào giỏ tài khoản (`mergeGuestCartAfterLogin`).
 */
/** `gridClassName`: lưới của giỏ đã đăng nhập (page.tsx), để hai trạng thái của /gio-hang cùng bố cục. */
export function GuestCartView({ empty, gridClassName }: { empty: ReactNode; gridClassName: string }) {
  const lines = useGuestCartLines();
  const slugs = useMemo(() => [...new Set(lines.map((l) => l.slug))], [lines]);
  const products = useGuestCartProducts(slugs);
  const { flash } = useRunningFlash();
  useFlashListExpiry(flash);
  const view = guestCartView(lines, products, flash);
  const threshold = useFreeShipThreshold();

  // Cùng sự kiện với giỏ đã đăng nhập; khách chưa đăng nhập phân biệt bằng sự kiện không có tài khoản. Một lần mỗi lần mở giỏ, khi mọi dòng đã có giá.
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || !view.settled) return;
    viewed.current = true;
    trackPurchase('cart_viewed', { itemCount: Math.min(500, lines.length), subtotalBucket: subtotalBucket(view.subtotal) });
    if (lines.length > 0) trackPurchase('login_wall_shown', { from: '/gio-hang' });
  }, [view.settled, view.subtotal, lines.length]);

  if (lines.length === 0) return <>{empty}</>;

  const freeshipBase = view.hasMerchant ? view.tubuSubtotal : view.subtotal;
  const showFreeship = view.settled && threshold !== null && (!view.hasMerchant || freeshipBase > 0);
  const subtotalLabel = fillCopy('cart.subtotal');
  const cta = fillCopy('guestCart.loginCta');

  return (
    <>
      <div className={gridClassName} data-testid="guest-cart">
        <div className="min-w-0">
          {showFreeship && (
            <div data-testid="cart-freeship" className="mb-3">
              <FreeShippingProgressBar base={freeshipBase} threshold={threshold} tubuOnly={view.hasMerchant} />
            </div>
          )}
          <section aria-label="Sản phẩm trong giỏ" className="flex flex-col gap-2.5">
            {view.rows.map((row) => (row.state === 'loading' ? <LineItemSkeleton key={row.variationId} /> : <GuestLine key={row.variationId} row={row} retry={products.get(row.slug)} />))}
          </section>
        </div>

        <div data-testid="cart-summary" className={`hidden h-fit p-4 ${ui.card} lg:sticky lg:top-[calc(var(--header-h)+theme(spacing.4))] lg:block lg:self-start`}>
          <div className="mb-3 flex justify-between font-bold text-stone-900">
            <span>{subtotalLabel}</span>
            <span className="tabular-nums">{formatVnd(view.subtotal)}</span>
          </div>
          <Link href={LOGIN_TO_ORDER} data-testid="guest-cart-login" className={`${ui.btnPrimary} w-full`}>
            {cta}
          </Link>
        </div>
      </div>

      <StickyActionBar label="Đặt hàng" hideFrom="lg">
        <div className="md:mx-auto md:max-w-2xl">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <div className="flex-[1000_1_0%]">
              <div className="whitespace-nowrap text-label text-stone-600">{subtotalLabel}</div>
              <div data-testid="cart-total-value" className="whitespace-nowrap text-[length:var(--type-title-md-size)] font-bold leading-[var(--type-title-md-lh)] tabular-nums text-stone-900">
                {formatVnd(view.subtotal)}
              </div>
            </div>
            <Link href={LOGIN_TO_ORDER} data-testid="guest-cart-login" className={`${uiBar.primary} flex-[1_0_auto] whitespace-nowrap`}>
              {cta}
            </Link>
          </div>
        </div>
      </StickyActionBar>
    </>
  );
}

// Dòng giỏ khách dựng từ khuôn Mini App (thẻ nổi, giá, bộ chọn số lượng sm, nút xoá biểu tượng) ở mọi khổ: không có trạng thái chọn món hay hoàn tác
// như giỏ tài khoản, nên không cần bản dòng riêng cho máy tính.
function GuestLine({ row, retry }: { row: GuestCartRow; retry: { status: string; refetch?: () => void } | undefined }) {
  const name = row.productName ?? fillCopy('guestCart.gone');
  const buyable = row.state === 'ok';
  const stockNote = buyable ? cartStockNote(row.quantity, row.stock) : null;
  const lineVariation = row.variationName ? variationLabel(row.variationName) : null;
  const href = `/san-pham/${encodeURIComponent(row.slug)}`;
  const status =
    row.state === 'soldOut'
      ? CART_OUT_OF_STOCK
      : row.state === 'gone'
        ? fillCopy('guestCart.gone')
        : row.state === 'blocked'
          ? row.blockedText
          : row.state === 'error'
            ? fillCopy('guestCart.loadFailed')
            : null;
  return (
    <div data-testid="cart-line" data-variation-id={row.variationId} data-state={row.state}>
      <Card padding={12}>
        <div className="flex gap-3">
          <Link href={href} tabIndex={-1} aria-hidden="true" className="flex-none self-start">
            <ProductThumb src={row.thumbnail} alt="" size={64} />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start gap-1">
              <Link href={href} className="tubu-hit-44 min-w-0 flex-1 break-words text-sm font-medium text-stone-900 hover:underline">
                {name}
              </Link>
              <IconButton
                icon={Trash2}
                size="sm"
                label={fillCopy('guestCart.removeAria', { name })}
                onPress={() => removeGuestLine(row.variationId)}
                className="-mr-2 -mt-2 flex-none"
              />
            </div>
            {lineVariation && <div className="break-words text-caption text-[color:var(--color-text-tertiary)]">{lineVariation}</div>}
            {row.isFlash && buyable && (
              <div>
                <Badge tone="promo" size="sm" icon={Zap}>
                  Giờ vàng
                </Badge>
              </div>
            )}
            {(status || stockNote) && (
              <p className="flex items-center gap-1 text-caption text-warning-fg">
                <AlertTriangle size={13} aria-hidden className="shrink-0" />
                {status ?? stockNote}
              </p>
            )}
            {row.state === 'error' && retry?.refetch && (
              <button type="button" onClick={retry.refetch} className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-forest-700 underline">
                {fillCopy('guestCart.retry')}
              </button>
            )}
            {(row.unitPrice !== null || buyable) && (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                {row.unitPrice !== null && (
                  <PriceTag value={row.unitPrice} compareAt={row.compareAt} size="sm" tone={row.compareAt || row.isFlash ? 'deal' : 'default'} layout="stack" />
                )}
                {buyable && (
                  <div className="ml-auto">
                    <QuantitySelector
                      size="sm"
                      value={row.quantity}
                      max={row.maxQty}
                      itemLabel={name}
                      onChange={(n) => setGuestQuantity(row.variationId, Math.min(row.maxQty, n))}
                    />
                  </div>
                )}
              </div>
            )}
            {buyable && row.quantity > 1 && <div className="text-caption tabular-nums text-stone-600">Thành tiền {formatVnd(row.total)}</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}
