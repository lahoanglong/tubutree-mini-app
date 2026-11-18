'use client';

import { useState } from 'react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { collapseCheckoutLines } from '@tubutree/app-core/commerce/checkout-display';
import type { LineAction, LineProblem } from '@tubutree/app-core/commerce/checkout-issues';
import { WaivedShippingValue } from '@/components/checkout/pickup-section';
import { ProductThumb } from '@/components/mini';
import { formatVnd, type CartLine } from '@/lib/shop-client';
import { fulfillerLabel } from '@/lib/shipments';
import { ui } from '@/lib/guest-ui';
import { variationLabel } from '@/lib/variation-label';

/**
 * Khối dòng hàng và dòng tiền của trang thanh toán (điện thoại: "Sản phẩm (n)" như Mini App; từ md: danh sách chữ trong khung "Đơn hàng").
 * Dùng chung cho thanh toán của tài khoản và thanh toán không đăng nhập (`guest-checkout.tsx`).
 */

/** Đang tính lại báo giá: giữ số cũ nhưng mờ đi. */
export const RECALC_DIM = 'opacity-50';

export type CheckoutLineView = Pick<CartLine, 'id' | 'productName' | 'variationName' | 'quantity' | 'unitPrice' | 'total' | 'thumbnail'>;

/** Không có dòng lỗi nào (thanh toán không đăng nhập: giỏ lỗi thì máy chủ trả lỗi chung). */
export const NO_LINE_FIX: LineFixView = { problems: {}, pendingIds: [], errorFor: null, errorText: null, onFix: () => undefined };

export function Row({ label, value, green, valueGreen, ds, dim }: { label: React.ReactNode; value: React.ReactNode; green?: boolean; valueGreen?: boolean; ds?: string; dim?: boolean }) {
  return (
    <div
      data-ds={ds}
      className={`flex justify-between gap-2.5 py-1.5 text-sm md:mt-1 md:gap-0 md:py-0 ${green ? 'text-[color:var(--color-text-primary)] md:text-success-fg' : 'text-[color:var(--color-text-primary)]'} ${dim ? RECALC_DIM : ''}`}
    >
      <span className={`leading-[var(--type-body-sm-lh)] md:leading-5 text-[color:var(--color-text-secondary)] ${green ? 'md:text-inherit' : ''}`}>{label}</span>
      <span className={`text-[0.9375rem] font-semibold leading-[var(--type-body-sm-lh)] tabular-nums md:text-sm md:font-normal md:leading-5 ${green || valueGreen ? 'text-success-fg' : ''}`}>{value}</span>
    </div>
  );
}

export type ShipmentView = { key: string; itemIds: string[]; fulfiller: Parameters<typeof fulfillerLabel>[0]; shippingFee: number; shippingFeeWaived?: number };

// Danh sách chữ trong khung "Đơn hàng" từ md (điện thoại dùng MobileItems). Các dòng thấy được cộng với tiền dòng gập ra đúng "Tạm tính".
export function DesktopLines({ items, shipments, fix }: { items: CheckoutLineView[]; shipments: ShipmentView[] | null; fix: LineFixView }) {
  const [expanded, setExpanded] = useState(false);
  // Dòng lỗi nằm sau chỗ gập thì khách thấy nút đặt bị khoá mà không thấy lý do: có dòng lỗi thì mở hết.
  const { shown, hiddenCount, hiddenTotal } = collapseCheckoutLines(items, expanded || Object.keys(fix.problems).length > 0);
  return (
    <div role="region" aria-label="Sản phẩm trong đơn" className="mt-2 hidden space-y-1 text-sm md:block">
      {shipments
        ? shipments.map((sh) => (
            <div key={sh.key} className="space-y-1 border-b border-[var(--color-border-subtle)] pb-2 last:border-b-0">
              <p className="text-caption font-semibold text-[color:var(--color-text-primary)]">{fulfillerLabel(sh.fulfiller)}</p>
              {items
                .filter((it) => sh.itemIds.includes(it.id))
                .map((it) => (
                  <LineRow key={it.id} item={it} fix={fix} />
                ))}
              <div className="flex justify-between gap-2 text-caption text-[color:var(--color-text-secondary)]">
                <span>Phí giao</span>
                {(sh.shippingFeeWaived ?? 0) > 0 ? (
                  <WaivedShippingValue originalFee={sh.shippingFee + (sh.shippingFeeWaived ?? 0)} note={fillCopy('checkout.shipWaived')} />
                ) : (
                  <span className="tabular-nums">{sh.shippingFee === 0 ? 'Miễn phí' : formatVnd(sh.shippingFee)}</span>
                )}
              </div>
            </div>
          ))
        : shown.map((it) => <LineRow key={it.id} item={it} fix={fix} />)}
      {!shipments && (hiddenCount > 0 || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold text-[color:var(--color-text-brand)]"
        >
          <span>{expanded ? fillCopy('checkout.fewerLines') : fillCopy('checkout.moreLines', { n: hiddenCount })}</span>
          {!expanded && <span className="tabular-nums text-[color:var(--color-text-primary)]">{formatVnd(hiddenTotal)}</span>}
        </button>
      )}
    </div>
  );
}

function LineVariationNote({ name }: { name: string }) {
  const label = variationLabel(name);
  return label ? <div className="text-caption text-[color:var(--color-text-tertiary)]">{label}</div> : null;
}

function LineRow({ item, fix }: { item: CheckoutLineView; fix: LineFixView }) {
  const lineVariation = variationLabel(item.variationName);
  return (
    <>
      <div data-testid="checkout-line" className="flex justify-between gap-2">
        <span className="min-w-0 text-[color:var(--color-text-secondary)]">
          <span className="line-clamp-2">{item.productName}</span>
          <span className="block text-caption tabular-nums text-[color:var(--color-text-tertiary)]">
            {lineVariation && <span>{lineVariation}</span>}
            {lineVariation ? ' · ' : ''}×{item.quantity}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-[color:var(--color-text-primary)]">{formatVnd(item.total)}</span>
      </div>
      <LineProblemNote id={item.id} fix={fix} />
    </>
  );
}

/** Lỗi của một dòng hàng ngay dưới dòng đó, kèm nút sửa nhanh (bỏ dòng, giảm về số còn). */
export interface LineFixView {
  problems: Record<string, LineProblem>;
  pendingIds: string[];
  errorFor: string | null;
  errorText: string | null;
  onFix: (id: string, fix: LineAction) => void;
}

function LineProblemNote({ id, fix }: { id: string; fix: LineFixView }) {
  const problem = fix.problems[id];
  if (!problem) return null;
  const busy = fix.pendingIds.includes(id);
  return (
    <div data-testid="checkout-line-problem" role="alert" className="mt-1 flex flex-wrap items-center justify-between gap-2">
      <span className="text-caption text-danger-fg">{fix.errorFor === id && fix.errorText ? fix.errorText : problem.text}</span>
      <button
        type="button"
        className={ui.btnSecondary}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        onClick={() => {
          // Khoá ref của `useLockedMutation` mất khi trang gắn lại (rời giỏ rồi quay về lúc lệnh còn bay): báo bận lấy từ bộ nhớ chung nên chặn ở đây.
          if (busy) return;
          fix.onFix(id, problem.fix);
        }}
      >
        {problem.fixLabel}
      </button>
    </div>
  );
}

// Khối "Sản phẩm (n)" của Mini App (checkout.tsx): ảnh 48px, tên tối đa hai dòng, phân loại, đơn giá × số lượng, thành tiền. Chỉ hiện ở điện thoại;
// từ md danh sách chữ trong khung "Đơn hàng" giữ nguyên.
export function MobileItems({
  items,
  shipments,
  splitNote,
  fix,
}: {
  items: CheckoutLineView[];
  shipments: ShipmentView[] | null;
  splitNote: string | null;
  fix: LineFixView;
}) {
  if (items.length === 0) return null;
  const count = items.reduce((sum, it) => sum + it.quantity, 0);
  const groups = shipments
    ? shipments.map((sh) => ({ key: sh.key, shipment: sh, lines: items.filter((it) => sh.itemIds.includes(it.id)) }))
    : [{ key: 'all', shipment: null, lines: items }];
  return (
    <div className="md:hidden">
      <h2 className="font-ui text-sm font-semibold leading-5">Sản phẩm ({count})</h2>
      {splitNote && <p className="mt-2.5 text-caption text-[color:var(--color-text-secondary)]">{splitNote}</p>}
      <div className="mt-2.5 space-y-3">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.shipment ? fulfillerLabel(g.shipment.fulfiller) : 'Sản phẩm sẽ mua'}>
            {g.shipment && <p className="mb-2 text-sm font-semibold">{fulfillerLabel(g.shipment.fulfiller)}</p>}
            <div className="space-y-3">
              {g.lines.map((it) => (
                <div key={it.id} className="flex items-center gap-2.5">
                  <ProductThumb src={it.thumbnail} alt={it.productName} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm">{it.productName}</div>
                    <LineVariationNote name={it.variationName} />
                    <div className="text-caption tabular-nums text-[color:var(--color-text-tertiary)]">
                      {formatVnd(it.unitPrice)} × {it.quantity}
                    </div>
                    <LineProblemNote id={it.id} fix={fix} />
                  </div>
                  <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatVnd(it.total)}</div>
                </div>
              ))}
            </div>
            {g.shipment && (
              <div className="mt-1.5 flex justify-between text-sm">
                <span className="text-[color:var(--color-text-secondary)]">Phí giao</span>
                {(g.shipment.shippingFeeWaived ?? 0) > 0 ? (
                  <WaivedShippingValue originalFee={g.shipment.shippingFee + (g.shipment.shippingFeeWaived ?? 0)} note={fillCopy('checkout.shipWaived')} />
                ) : (
                  <span className={g.shipment.shippingFee === 0 ? 'text-success-fg' : ''}>
                    {g.shipment.shippingFee === 0 ? 'Miễn phí' : formatVnd(g.shipment.shippingFee)}
                  </span>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

