import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { useQueries } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Copy, Repeat } from 'lucide-react';
import type { OrderDTO } from '@tubutree/shared-types';
import { fetchProduct, type PlacedOrder } from '../../services/shop-api';
import { useNotify } from '../../hooks/use-notify';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useStorefrontContext } from '../../store/storefront-context';
import { copyText } from '../../utils/clipboard';
import { formatVnd } from '../../utils/format';
import { isRetailOnly } from '../../utils/retail-only';
import { checkoutEtaLabel, etaSchedule, placedOrderKinds } from '@tubutree/app-core/shipping-eta';
import { showOrderZaloFriend } from '@tubutree/app-core/order-zalo';
import { referralViralOn } from '@tubutree/app-core/referral/viral-flag';
import { OrderZaloFriend, useOrderZaloFriendKnown } from './order-zalo';
import { viSuccess } from '../../i18n/vi-checkout';
import { SubscribeSheet } from '../subscribe-sheet';
import { SUBSCRIPTIONS_IN_MINIAPP } from '../../utils/features';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { KeyValueRow } from '../ui/key-value-row';
import { SR_ONLY } from '../ui/sr-only';
import { Heading, Text } from '../ui/text';
import '../../css/order-success.css';

const MAX_SUBSCRIBE_CHECKS = 3;

// Lời mời bạn (cờ growth.referral_viral_enabled): chunk riêng, chỉ nạp khi cờ bật.
const OrderInviteNudge = lazy(() => import('../referral/order-invite-nudge'));

export interface SubscribeCandidate {
  variationId: string;
  quantity: number;
  productName: string;
}

/**
 * Sản phẩm đầu tiên của đơn cho phép "Đặt định kỳ" — CÙNG điều kiện PDP đang dùng để hiện nút
 * (product-detail.tsx: `selected && inStock && !retailOnly`, tức variation đang bán, stock > 0 và không phải hàng gian hàng
 * đối tác). Dùng chung queryKey ['product', slug] với PDP. Đơn không có dòng nào đủ điều kiện → null (ẩn gợi ý).
 */
export function useSubscribeCandidate(order: OrderDTO): SubscribeCandidate | null {
  const slugs = SUBSCRIPTIONS_IN_MINIAPP
    ? [...new Set(order.items.map((it) => it.productSlug).filter((s): s is string => !!s))].slice(0, MAX_SUBSCRIBE_CHECKS)
    : [];
  const products = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ['product', slug],
      queryFn: () => fetchProduct(slug),
      staleTime: 60_000,
      retry: false,
    })),
  });
  for (const it of order.items) {
    const idx = it.productSlug ? slugs.indexOf(it.productSlug) : -1;
    const product = idx >= 0 ? products[idx]?.data : undefined;
    if (!product || isRetailOnly(product)) continue;
    const variation = product.variations.find((v) => v.id === it.variationId);
    if (variation && variation.stock > 0) {
      return { variationId: it.variationId, quantity: it.quantity, productName: it.productName };
    }
  }
  return null;
}

/** Gợi ý phụ sau khi đặt: MỘT dòng chạm mở sheet (cùng kiểu dòng mời bạn bên dưới), không thêm nút cỡ lớn tranh vai "Theo dõi đơn". */
export function SubscribeRow({ candidate, discountPct, onOpen }: { candidate: SubscribeCandidate; discountPct: number; onOpen: () => void }) {
  return (
    <button type="button" className="tubu-press touch-target tubu-order-success-row" onClick={onOpen}>
      <Icon icon={Repeat} tone="brand" style={{ flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-sm" as="span" style={{ display: 'block', fontWeight: 600 }}>
          {viSuccess.subscribeTitle(candidate.productName)}
        </Text>
        <Text variant="caption" tone="secondary" as="span" style={{ display: 'block' }}>
          {viSuccess.subscribeBody(discountPct)}
        </Text>
      </span>
      <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flex: 'none' }} />
    </button>
  );
}

// 3 bước thành một hàng (số + tên bước) để nút chính và mã đơn nằm trong màn đầu; câu giải thích từng bước vẫn đọc được bằng trình đọc màn hình.
function NextStepsCompact() {
  return (
    <section aria-label={viSuccess.nextTitle}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 'var(--space-stack-sm)' }}>
        {viSuccess.nextTitle}
      </Heading>
      <ol className="tubu-order-success-steps">
        {viSuccess.steps.map((s, i) => (
          <li key={s.title} className="tubu-order-success-step">
            <span aria-hidden className="tubu-order-success-step-num" data-current={i === 0 || undefined}>
              {i + 1}
            </span>
            <Text variant="caption" as="span" style={{ fontWeight: 600 }}>
              {s.title}
              <span style={SR_ONLY}>: {s.body}</span>
            </Text>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Màn "Đặt hàng thành công" (spec 4a.5, A2-45), cùng bố cục MobileSuccess của web ở 375×812: trạng thái đơn, thẻ mã đơn + tiền, rồi ngay hai nút
 * "Theo dõi đơn" / "Tiếp tục mua sắm" để nút chính luôn trong màn đầu, kể cả đơn tách nhiều nơi giao. Danh sách đơn tách, 3 bước tiếp theo (một hàng)
 * và nhóm gợi ý phụ (kết bạn Zalo, Đặt định kỳ, mời bạn) nằm dưới. Bỏ lá rơi / emoji chức năng.
 */
export function OrderSuccess({
  order,
  onTrack,
  onContinue,
}: {
  order: PlacedOrder;
  onTrack: () => void;
  onContinue: () => void;
}) {
  const navigate = useNavigate();
  const { notify } = useNotify();
  const sfSlug = useStorefrontContext((s) => s.slug);
  const sfKind = useStorefrontContext((s) => s.kind);
  const cfg = usePublicConfig();
  const friendKnown = useOrderZaloFriendKnown();
  const candidate = useSubscribeCandidate(order);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const handleContinue = () => {
    if (sfSlug) navigate(sfKind === 'brand' ? `/brand/${sfSlug}` : `/s/${sfSlug}`, { replace: true });
    else onContinue();
  };

  // Lần đặt có hàng gian hàng tự giao bị tách thành nhiều đơn (D4): khách phải thấy đủ các mã và tổng thật phải trả,
  // và sao chép được cả danh sách chứ không chỉ mã đơn đầu.
  const split = order.splitOrders && order.splitOrders.length > 1 ? order.splitOrders : null;
  const codes = split ? split.map((o) => o.code) : [order.code];
  const codesText = codes.join(', ');

  const copyCode = () => {
    void copyText(codesText).then((ok) =>
      notify(ok ? { text: viSuccess.copied, type: 'success' } : { text: viSuccess.copyFailed(codesText), type: 'info', duration: 4000 }),
    );
  };

  // Cấu hình công khai đã được trang checkout tải sẵn (cùng queryKey) nên dòng ETA có ngay ở lần vẽ đầu; gợi ý phụ nằm DƯỚI hai CTA
  // để lúc sản phẩm tải xong không đẩy nút "Theo dõi đơn" đi chỗ khác.
  // Gian hàng đối tác tự giao nên không hứa ngày thay họ: chỉ phần hàng Tubu giao mới có ngày (cùng luật với chi tiết đơn).
  const eta = cfg.isLoaded ? checkoutEtaLabel(cfg.shippingEta, placedOrderKinds(order), undefined, etaSchedule(cfg), order.shippingAddress?.province) : null;
  const grandTotal = split ? split.reduce((sum, o) => sum + o.total, 0) : order.total;
  // Màn Thanh toán hứa điểm của cả lần đặt — màn này phải nói cùng con số, không chỉ điểm của đơn đầu.
  const pointsEarned = split && split.every((o) => o.pointsEarned != null)
    ? split.reduce((sum, o) => sum + (o.pointsEarned ?? 0), 0)
    : order.pointsEarned;

  return (
    <div data-testid="order-success" className="tubu-order-success">
      <div className="tubu-order-success-head">
        <span aria-hidden className="tubu-pop tubu-order-success-mark">
          <Icon icon={CheckCircle2} size="lg" tone="brand" />
        </span>
        <Heading variant="title-lg" as="h1">
          {viSuccess.heading}
        </Heading>
        <Text variant="body-sm" tone="secondary">
          {viSuccess.subheading}
        </Text>
      </div>

      <Card variant="outline" padding={12}>
        <div className="tubu-order-success-code">
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">
              {viSuccess.orderCode}
            </Text>
            {codes.map((c) => (
              <Text key={c} variant="body-lg" as="div" style={{ fontWeight: 700, letterSpacing: 1, wordBreak: 'break-all' }}>
                {c}
              </Text>
            ))}
          </div>
          <IconButton icon={Copy} label={viSuccess.copyCodeLabel(codesText)} onPress={copyCode} />
        </div>
        <div className="tubu-order-success-facts">
          <KeyValueRow
            label={split ? `Tổng ${split.length} đơn` : viSuccess.total}
            value={formatVnd(grandTotal)}
            emphasis
          />
          {order.paymentMethod === 'COD' && (
            <Text variant="caption" tone="secondary" as="div">
              {viSuccess.prepareCash}
            </Text>
          )}
          {pointsEarned > 0 && (
            <KeyValueRow label={viSuccess.pointsLabel} value={viSuccess.pointsValueWhen(pointsEarned)} tone="success" />
          )}
          {eta && <KeyValueRow label={viSuccess.etaLabel} value={eta} />}
        </div>
      </Card>

      <div className="tubu-order-success-ctas">
        <Button fullWidth size="lg" onPress={onTrack}>
          {viSuccess.trackOrder}
        </Button>
        <Button fullWidth variant="ghost" onPress={handleContinue}>
          {viSuccess.keepShopping}
        </Button>
      </div>

      {split && (
        <section aria-label="Đơn cùng lần đặt">
          <Heading variant="title-sm" as="h2" style={{ marginBottom: 'var(--space-stack-xs)' }}>
            Hàng do {split.length} nơi giao nên được tách thành {split.length} đơn
          </Heading>
          <Text variant="caption" tone="secondary" as="p" style={{ margin: '0 0 var(--space-stack-sm)' }}>
            Mỗi đơn có mã, phí giao và lộ trình riêng.
          </Text>
          <ul className="tubu-order-success-list">
            {split.map((o) => (
              <li key={o.code}>
                <button
                  type="button"
                  className="tubu-press tubu-order-success-split"
                  aria-label={`Xem đơn ${o.code}, ${o.fulfillerName} giao, ${formatVnd(o.total)}`}
                  onClick={() => navigate(`/order/${o.code}`, { replace: true })}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body-sm" as="span" style={{ display: 'block', fontWeight: 700 }}>
                      {o.code}
                    </Text>
                    <Text variant="caption" tone="secondary" as="span" style={{ display: 'block' }}>
                      {o.fulfillerName} giao
                    </Text>
                  </span>
                  <Text variant="body-sm" as="span" numeric style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatVnd(o.total)}
                  </Text>
                  <Icon icon={ChevronRight} size="sm" tone="muted" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NextStepsCompact />

      <section aria-label={viSuccess.extrasLabel} className="tubu-order-success-extras">
        {showOrderZaloFriend(cfg.orderZaloEnabled, order, friendKnown) && <OrderZaloFriend code={order.code} from="success" />}
        {candidate && (
          <SubscribeRow candidate={candidate} discountPct={Math.round(cfg.subscribeDiscountPct * 100)} onOpen={() => setSubscribeOpen(true)} />
        )}
        {referralViralOn(cfg) && (
          <Suspense fallback={null}>
            <OrderInviteNudge />
          </Suspense>
        )}
      </section>

      {candidate && (
        <SubscribeSheet
          visible={subscribeOpen}
          onClose={() => setSubscribeOpen(false)}
          variationId={candidate.variationId}
          quantity={candidate.quantity}
        />
      )}
    </div>
  );
}
