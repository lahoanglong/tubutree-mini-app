'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Trash2, Zap } from 'lucide-react';
import { subtotalBucket } from '@tubutree/shared-types';
import { CART_OUT_OF_STOCK } from '@tubutree/app-core/cart-copy';
import { cartStockNote } from '@tubutree/app-core/commerce/stock-text';
import { freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import { cartShippingView } from '@tubutree/app-core/api/shipping-estimate';
import { useShippingEstimate } from '@/components/checkout/use-shipping-estimate';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { ProductCardView } from '@tubutree/app-core/commerce/product-card-view';
import { Badge, FreeShippingProgressBar, IconButton, ProductTile, QuantitySelector } from '@/components/mini';
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
  // Khách chưa đăng nhập: phí theo mức chung (không hạng, không ưu đãi đơn đầu), hỏi không kèm phiên. Có hàng gian hàng tự giao thì không ước tính.
  const shipQ = useShippingEstimate(view.settled && !view.hasMerchant ? view.subtotal : null, { anonymous: true });

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
  const freeshipReached = threshold !== null && freeshipProgress({ base: freeshipBase, threshold }).reached;
  const ship = cartShippingView(shipQ.estimate, { goodsNet: view.subtotal, freeshipReached, stale: shipQ.stale });
  const totalLabel = ship?.totalLabel ?? subtotalLabel;
  const total = ship?.total ?? view.subtotal;

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
          {ship && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-secondary)]">{subtotalLabel}</span>
                <span className="tabular-nums text-[var(--color-text-primary)]">{formatVnd(view.subtotal)}</span>
              </div>
              <div data-testid="cart-ship-estimate" className="mt-1 flex justify-between text-sm">
                <span className="text-[var(--color-text-secondary)]">{ship.feeLabel}</span>
                <span className={`tabular-nums ${ship.free ? 'text-success-fg' : 'text-[var(--color-text-primary)]'}`}>{ship.feeText}</span>
              </div>
            </>
          )}
          <div className={`mb-3 flex justify-between font-bold text-[var(--color-text-primary)] ${ship ? 'mt-3 border-t border-[var(--color-border-subtle)] pt-3' : ''}`}>
            <span>{totalLabel}</span>
            <span className="tabular-nums">{formatVnd(total)}</span>
          </div>
          <Link href={LOGIN_TO_ORDER} data-testid="guest-cart-login" className={`${ui.btnPrimary} w-full`}>
            {cta}
          </Link>
        </div>
      </div>

      <StickyActionBar label="Đặt hàng" hideFrom="lg">
        <div className="md:mx-auto md:max-w-2xl">
          {ship && (
            <div className="mb-1 flex justify-between text-sm" data-ds="cart-ship-estimate">
              <span className="text-[var(--color-text-secondary)]">{ship.feeLabel}</span>
              <span className={`font-semibold tabular-nums ${ship.free ? 'text-success-fg' : 'text-[var(--color-text-primary)]'}`}>{ship.feeText}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <div className="flex-[1000_1_0%]">
              <div className="whitespace-nowrap text-label text-[color:var(--color-text-secondary)]">{totalLabel}</div>
              <div data-testid="cart-total-value" className="whitespace-nowrap text-[length:var(--type-title-md-size)] font-bold leading-[var(--type-title-md-lh)] tabular-nums text-[color:var(--color-text-primary)]">
                {formatVnd(total)}
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

// Dòng giỏ khách là thẻ dòng của design system (`ProductTile` biến thể `line`: ảnh 64px, tên là liên kết phủ cả thẻ, giá): không có trạng thái chọn món hay hoàn tác
// như giỏ tài khoản. Nút xoá ở chỗ `action`; cảnh báo, Thử lại và bộ chọn số lượng ở `footer`, nổi trên lớp phủ của liên kết tên.
function GuestLine({ row, retry }: { row: GuestCartRow; retry: { status: string; refetch?: () => void } | undefined }) {
  // Chưa tải được sản phẩm thì chưa biết tên: gọi trung tính, không gọi là ngừng bán kẻo khách xoá món vẫn đang bán.
  const name = row.productName ?? fillCopy(row.state === 'gone' ? 'guestCart.gone' : 'guestCart.itemFallback');
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
  // Thẻ dòng chỉ cần các trường này; trạng thái hết hàng nói bằng dòng cảnh báo (rõ hơn lớp phủ chữ trên ảnh 64px) nên `stock` luôn 'in'.
  const view: ProductCardView = {
    id: row.variationId,
    slug: row.slug,
    name,
    brandLine: null,
    thumbnail: row.thumbnail,
    price: row.unitPrice ?? 0,
    compareAt: row.compareAt,
    discountPct: 0,
    isFlash: row.isFlash,
    isDeal: row.compareAt !== null || row.isFlash,
    imageBadge: null,
    label: null,
    meta: null,
    stock: 'in',
    stockText: null,
    rank: null,
    spoken: { price: row.unitPrice !== null ? formatVnd(row.unitPrice) : '', stock: null, badges: null },
  };
  const footer = (
    <div className="flex flex-col gap-1">
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
        <div className="relative z-[1] self-start">
          <button type="button" onClick={retry.refetch} className="inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--color-action-secondary-fg)] underline">
            {fillCopy('guestCart.retry')}
          </button>
        </div>
      )}
      {buyable && (
        <div className="relative z-[1] flex flex-wrap items-center justify-between gap-2">
          <QuantitySelector size="sm" value={row.quantity} max={row.maxQty} itemLabel={name} onChange={(n) => setGuestQuantity(row.variationId, Math.min(row.maxQty, n))} />
          {row.quantity > 1 && <span className="text-caption tabular-nums text-[color:var(--color-text-secondary)]">Thành tiền {formatVnd(row.total)}</span>}
        </div>
      )}
    </div>
  );
  return (
    <div data-testid="cart-line" data-variation-id={row.variationId} data-state={row.state}>
      <ProductTile
        view={view}
        variant="line"
        href={href}
        note={lineVariation ?? undefined}
        hidePrice={row.unitPrice === null}
        dimMedia={!buyable}
        footer={footer}
        action={<IconButton icon={Trash2} size="sm" label={fillCopy('guestCart.removeAria', { name })} onPress={() => removeGuestLine(row.variationId)} />}
      />
    </div>
  );
}
