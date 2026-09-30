import { useState } from 'react';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { useQueries } from '@tanstack/react-query';
import { CheckCircle2, Copy, Repeat } from 'lucide-react';
import type { OrderDTO } from '@tubutree/shared-types';
import { fetchProduct } from '../../services/shop-api';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useStorefrontContext } from '../../store/storefront-context';
import { copyText } from '../../utils/clipboard';
import { formatVnd } from '../../utils/format';
import { shippingEtaLabel } from '../../utils/shipping-eta';
import { vi } from '../../i18n/vi';
import { SubscribeSheet } from '../subscribe-sheet';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { KeyValueRow } from '../ui/key-value-row';
import { Heading, Text } from '../ui/text';

const MAX_SUBSCRIBE_CHECKS = 3;

export interface SubscribeCandidate {
  variationId: string;
  quantity: number;
  productName: string;
}

/**
 * Sản phẩm đầu tiên của đơn cho phép "Đặt định kỳ" — CÙNG điều kiện PDP đang dùng để hiện nút
 * (product-detail.tsx: `selected && inStock`, tức variation đang bán và stock > 0). Dùng chung
 * queryKey ['product', slug] với PDP. Đơn không có dòng nào đủ điều kiện → null (ẩn gợi ý).
 */
export function useSubscribeCandidate(order: OrderDTO): SubscribeCandidate | null {
  const slugs = [...new Set(order.items.map((it) => it.productSlug).filter((s): s is string => !!s))].slice(0, MAX_SUBSCRIBE_CHECKS);
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
    const variation = idx >= 0 ? products[idx]?.data?.variations.find((v) => v.id === it.variationId) : undefined;
    if (variation && variation.stock > 0) {
      return { variationId: it.variationId, quantity: it.quantity, productName: it.productName };
    }
  }
  return null;
}

/**
 * Màn "Đặt hàng thành công" (spec 4a.5, A2-45): mã đơn sao chép được, tổng tiền, điểm sẽ nhận,
 * ngày giao dự kiến (khi chủ shop đã cấu hình), 3 bước tiếp theo, CTA chính "Theo dõi đơn", gợi ý
 * "Đặt định kỳ". Bỏ lá rơi / emoji chức năng.
 */
export function OrderSuccess({
  order,
  onTrack,
  onContinue,
}: {
  order: OrderDTO;
  onTrack: () => void;
  onContinue: () => void;
}) {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const sfSlug = useStorefrontContext((s) => s.slug);
  const sfKind = useStorefrontContext((s) => s.kind);
  const cfg = usePublicConfig();
  const candidate = useSubscribeCandidate(order);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const handleContinue = () => {
    if (sfSlug) navigate(sfKind === 'brand' ? `/brand/${sfSlug}` : `/s/${sfSlug}`, { replace: true });
    else onContinue();
  };

  const copyCode = () => {
    void copyText(order.code).then((ok) =>
      openSnackbar(
        ok
          ? { text: vi.success.copied, type: 'success' }
          : { text: vi.success.copyFailed(order.code), type: 'info', duration: 4000 },
      ),
    );
  };

  const eta = cfg.isLoaded && cfg.shippingEta ? shippingEtaLabel(cfg.shippingEta) : null;

  return (
    <div style={{ padding: '32px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
        <span
          aria-hidden
          className="tubu-pop"
          style={{
            width: 56, height: 56, borderRadius: 'var(--radius-pill)', background: 'var(--color-action-secondary-bg)',
            display: 'grid', placeItems: 'center',
          }}
        >
          <Icon icon={CheckCircle2} size="lg" tone="brand" />
        </span>
        <Heading variant="title-lg" as="h1">
          {vi.success.heading}
        </Heading>
        <Text variant="body-sm" tone="secondary">
          {vi.success.subheading}
        </Text>
      </div>

      <Card variant="outline" padding={16}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">
              {vi.success.orderCode}
            </Text>
            <Text variant="body-lg" as="div" style={{ fontWeight: 700, letterSpacing: 1, wordBreak: 'break-all' }}>
              {order.code}
            </Text>
          </div>
          <IconButton icon={Copy} label={vi.success.copyCode} onPress={copyCode} />
        </div>
        <div style={{ borderTop: '1px solid var(--color-border-subtle)', marginTop: 12, paddingTop: 8 }}>
          <KeyValueRow label={vi.success.total} value={formatVnd(order.total)} emphasis />
          {order.paymentMethod === 'COD' && (
            <Text variant="caption" tone="secondary" as="div">
              {vi.success.prepareCash}
            </Text>
          )}
          {order.pointsEarned > 0 && (
            <>
              <KeyValueRow label={vi.success.pointsLabel} value={vi.success.pointsValue(order.pointsEarned)} tone="success" />
              <Text variant="caption" tone="tertiary" as="div">
                {vi.success.pointsComing(order.pointsEarned)}
              </Text>
            </>
          )}
          {eta && <KeyValueRow label={vi.success.etaLabel} value={eta} />}
        </div>
      </Card>

      <section aria-label={vi.success.nextTitle}>
        <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
          {vi.success.nextTitle}
        </Heading>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {vi.success.steps.map((s, i) => (
            <li key={s.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span
                aria-hidden
                style={{
                  width: 28, height: 28, flex: '0 0 auto', display: 'grid', placeItems: 'center', fontWeight: 700,
                  borderRadius: 'var(--radius-pill)', fontSize: 'var(--type-caption-size)',
                  background: i === 0 ? 'var(--color-action-primary-bg)' : 'var(--color-bg-subtle)',
                  color: i === 0 ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
                }}
              >
                {i + 1}
              </span>
              <div>
                <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                  {s.title}
                </Text>
                <Text variant="caption" tone="tertiary" as="div">
                  {s.body}
                </Text>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {candidate && (
        <Card variant="flat" padding={12}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Icon icon={Repeat} tone="brand" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                {vi.success.subscribeTitle(candidate.productName)}
              </Text>
              <Text variant="caption" tone="secondary" as="div">
                {vi.success.subscribeBody(Math.round(cfg.subscribeDiscountPct * 100))}
              </Text>
            </div>
          </div>
          <Button variant="secondary" fullWidth onPress={() => setSubscribeOpen(true)} style={{ marginTop: 10 }}>
            {vi.success.subscribeCta}
          </Button>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button fullWidth size="lg" onPress={onTrack}>
          {vi.success.trackOrder}
        </Button>
        <Button fullWidth variant="ghost" onPress={handleContinue}>
          {vi.success.keepShopping}
        </Button>
      </div>

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
