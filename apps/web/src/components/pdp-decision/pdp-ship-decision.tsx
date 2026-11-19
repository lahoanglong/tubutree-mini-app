'use client';

import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { inCartQuantity, variationLinePreview } from '@tubutree/app-core/commerce/flash-line';
import { pdpEtaText, pdpFreeshipGap, type GapCartLine } from '@tubutree/app-core/commerce/pdp-view';
import { usePdpSelection } from '@/components/pdp-selection';
import type { ProductDetail } from '@/lib/api';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { useGuestCartFlag } from '@/lib/guest-cart/flag';
import { guestProductKey } from '@/lib/guest-cart/products';
import type { GuestCartLine } from '@/lib/guest-cart/store';
import { useGuestCartLines } from '@/lib/guest-cart/use-guest-cart';
import { guestCartView } from '@/lib/guest-cart/view';
import { resolveFreeshipFrom } from '@/lib/pdp-logic';
import { phoneBrandLabel } from '@/lib/phone-ui';
import { getCart } from '@/lib/shop-client';
import { useFlashAllowance } from '@/lib/use-flash-allowance';
import { useRunningFlash } from '@/lib/use-flash-sales';
import { useHydrated } from '@/lib/use-hydrated';
import { usePublicConfig } from '@/lib/use-public-config';

type FlashList = Parameters<typeof guestCartView>[2];

// Điện thoại: không đặt cỡ, màu riêng, để dòng thừa hưởng chữ phụ của `ListRow` như dòng thường trong khối vận chuyển của Mini.
const PLAIN = 'tabular-nums md:text-sm md:text-[var(--color-text-secondary)]';
const ETA_SHAPE_DATE = new Date('2026-01-14T05:00:00Z');

/**
 * Giỏ khách của web dưới dạng dòng tính phần còn thiếu, chỉ từ bộ nhớ đệm (`guestProductKey` của trang giỏ, món đang xem từ props): mở trang chi tiết
 * không gọi thêm API. Món nào chưa có giá trong bộ nhớ đệm thì không biết tổng giỏ: null, trang giữ câu tĩnh.
 */
function guestGapLines(lines: readonly GuestCartLine[], current: ProductDetail, cached: (slug: string) => ProductDetail | null | undefined, flash: FlashList) {
  const products = new Map<string, { status: 'ok'; product: ProductDetail } | { status: 'missing' }>();
  for (const l of lines) {
    const p = l.slug === current.slug ? current : cached(l.slug);
    if (p === undefined) return null;
    products.set(l.slug, p ? { status: 'ok', product: p } : { status: 'missing' });
  }
  return guestCartView(lines, products, flash).rows.map((r): GapCartLine => {
    const known = products.get(r.slug);
    const name = known?.status === 'ok' ? known.product.fulfiller?.name : undefined;
    return { variationId: r.variationId, total: r.total, stock: r.state === 'ok' ? r.stock : 0, fulfiller: { kind: r.tubu ? 'TUBU' : 'MERCHANT', name } };
  });
}

/**
 * Khối vận chuyển khi bật cờ `shipping.pdp_eta_enabled`: "Nhận dự kiến …" (hàng kho Tubu còn hàng) và câu còn thiếu để miễn phí giao hàng thay câu tĩnh `freeship`.
 * Cờ tắt thì vẽ đúng `freeship` như cũ. Hai câu phụ thuộc giờ và giỏ của trình duyệt nên chỉ vẽ sau hydrate; dòng ngày giữ chỗ từ HTML để không đẩy phần dưới.
 */
export function PdpShipDecision(props: { product: ProductDetail; initialConfig?: PublicConfig; freeship: ReactNode }) {
  const on = usePublicConfig(props.initialConfig).pdpEtaEnabled === true && props.product.fulfiller?.kind !== 'UNAVAILABLE';
  return on ? <ShipDecisionOn {...props} /> : <>{props.freeship}</>;
}

function ShipDecisionOn({ product, initialConfig, freeship }: { product: ProductDetail; initialConfig?: PublicConfig; freeship: ReactNode }) {
  const cfg = usePublicConfig(initialConfig);
  const hydrated = useHydrated();
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const selection = usePdpSelection();
  const { flash } = useRunningFlash();
  const flashA = useFlashAllowance(flash, product.variations.map((v) => v.id));
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const guestFlag = useGuestCartFlag();
  const guestLines = useGuestCartLines();

  const kind = product.fulfiller?.kind;
  const merchant = product.fulfiller?.kind === 'MERCHANT' ? product.fulfiller : null;
  const selected = product.variations.find((v) => v.id === selection?.selectedId) ?? product.variations[0];
  const inStock = selection?.buyable ?? (selected?.stock ?? 0) > 0;
  // Chỗ giữ của dòng ngày là chính câu đó tính ở một ngày cố định (cùng số chữ số, chữ số đều bề ngang): HTML máy chủ và lần vẽ đầu ở trình duyệt
  // giống nhau, và hàng hẹp (768px) gãy dòng y như khi có ngày thật. Cùng điều kiện còn hàng với dòng thật để không giữ chỗ rồi bỏ.
  const etaShape = pdpEtaText(initialConfig?.shippingEta ?? cfg.shippingEta, kind, inStock, ETA_SHAPE_DATE, (initialConfig ?? cfg).deliverySchedule);
  const etaText = hydrated ? pdpEtaText(cfg.shippingEta, kind, inStock, undefined, cfg.deliverySchedule) : null;

  const guest = phase === 'guest';
  // Gian hàng không có câu tĩnh để thay: giữ sẵn một dòng ẩn (từ HTML tới khi biết giỏ) để câu còn thiếu điền vào, không chèn dòng mới đẩy phần dưới.
  const settling = !hydrated || phase === 'loading' || (phase === 'authenticated' && cartQ.isPending) || (guest && guestFlag.pending);
  const reserveGap = merchant !== null && Boolean(merchant.shippingFee) && Boolean(merchant.freeShipFrom) && inStock && settling;
  const lines =
    phase === 'authenticated'
      ? cartQ.data?.items
      : guest && !guestFlag.pending
        ? guestFlag.enabled
          ? guestGapLines(guestLines, product, (slug) => qc.getQueryData<ProductDetail | null>(guestProductKey(slug)), flash)
          : []
        : null;
  const threshold = merchant
    ? merchant.shippingFee
      ? merchant.freeShipFrom
      : null
    : resolveFreeshipFrom({ phase, cartThreshold: cartQ.data?.freeshipThreshold, configThreshold: cfg.freeshipThreshold, configLoaded: cfg.isLoaded });
  const qtyLines = phase === 'authenticated' ? cartQ.data?.items : guest && guestFlag.enabled ? guestLines : undefined;
  const line = selected ? variationLinePreview(selected, flashA, selection?.quantity ?? 1, inCartQuantity(qtyLines, selected.id)) : null;
  const gapText =
    hydrated && selected
      ? pdpFreeshipGap({
          lines,
          threshold,
          serverFree: cartQ.data?.freeship,
          variationId: selected.id,
          lineTotal: inStock && line ? line.lineTotal : null,
          store: merchant?.name,
        })
      : null;

  const second = merchant ? (
    (gapText || reserveGap) && (
      <p data-testid={gapText ? 'pdp-freeship-gap' : undefined} aria-hidden={gapText ? undefined : true} className={`${PLAIN} ${gapText ? '' : 'invisible'}`}>
        {gapText ?? ' '}
      </p>
    )
  ) : gapText ? (
    <p data-testid="pdp-freeship-gap" className={`text-sm font-medium text-[var(--color-text-brand)] ${phoneBrandLabel}`}>
      {gapText}
    </p>
  ) : (
    freeship
  );

  // Từ md các dòng nằm chung một hàng: câu thứ hai xuống hàng riêng, để ngày nhận (chỉ có sau hydrate) dài ra không làm hàng gãy thêm dòng.
  return (
    <>
      {(etaText || (!hydrated && etaShape)) && (
        <p data-testid="pdp-eta" aria-hidden={etaText ? undefined : true} className={`${PLAIN} ${etaText ? '' : 'invisible'}`}>
          {etaText ?? etaShape}
        </p>
      )}
      <div className="empty:hidden md:basis-full">{second}</div>
    </>
  );
}
