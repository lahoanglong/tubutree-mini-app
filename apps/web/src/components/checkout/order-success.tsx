'use client';

// Nguồn: apps/miniapp/src/components/checkout/order-success.tsx (chữ ở i18n/vi.ts nhóm success).
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Copy, Repeat } from 'lucide-react';
import type { OrderDTO as ShopOrderDTO, SplitOrderDTO } from '@/lib/shop-client';
import { Button, Card, Heading, Icon, IconButton, KeyValueRow, Text } from '@/components/mini';
import { formatCount } from '@/lib/checkout-points';
import { apiFetch } from '@/lib/client-api';
import { copyText } from '@/lib/copy-text';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { orderDetailHref } from '@/lib/order-view';
import { isRetailOnly } from '@/lib/pdp-logic';
import { usePublicConfig } from '@/lib/use-public-config';
import { SubscribeSheet } from '@/app/san-pham/[slug]/subscribe-sheet';
import type { ProductDetail } from '@/lib/api';

const t = {
  prepareCash: 'Chuẩn bị tiền mặt khi nhận hàng',
  heading: 'Cảm ơn bạn đã chọn Tubu',
  subheading: 'Đơn hàng của bạn đã được ghi nhận',
  orderCode: 'Mã đơn hàng',
  copyCode: 'Sao chép mã đơn',
  copied: 'Đã sao chép mã đơn',
  copyFailed: (code: string) => `Không sao chép được — mã đơn: ${code}`,
  total: 'Tổng thanh toán',
  pointsLabel: 'Điểm Xanh sẽ nhận',
  pointsValue: (n: number) => `+${formatCount(n)} điểm`,
  pointsComing: (n: number) => `${formatCount(n)} Điểm Xanh sẽ về tay khi đơn giao thành công`,
  etaLabel: 'Giao dự kiến',
  nextTitle: 'Tiếp theo',
  steps: [
    { title: 'Xác nhận đơn', body: 'Tubu kiểm tra và xác nhận đơn của bạn.' },
    { title: 'Đóng gói', body: 'Sản phẩm được đóng gói cẩn thận.' },
    { title: 'Giao hàng', body: 'Đơn vị vận chuyển giao tới địa chỉ của bạn.' },
  ],
  trackOrder: 'Theo dõi đơn',
  keepShopping: 'Tiếp tục mua sắm',
  subscribeTitle: (name: string) => `Đặt định kỳ ${name}`,
  subscribeBody: (pct: number) => `Tự động giao lại theo chu kỳ, tiết kiệm ${pct}% mỗi đơn.`,
  subscribeCta: 'Đặt định kỳ',
  splitTitle: (n: number) => `Hàng do ${n} nơi giao nên được tách thành ${n} đơn`,
  splitBody: 'Mỗi đơn có mã, phí giao và lộ trình riêng.',
};

const MAX_SUBSCRIBE_CHECKS = 3;

interface SubscribeCandidate {
  variationId: string;
  quantity: number;
  productName: string;
}

// Sản phẩm đầu tiên của đơn cho phép "Đặt định kỳ": cùng điều kiện Mini App (variation còn hàng và không phải hàng chỉ bán lẻ).
// Gọi thẳng API công khai không cache vì trang chi tiết là bản ISR, tồn kho in sẵn có thể cũ.
function useSubscribeCandidate(order: OrderDTO): SubscribeCandidate | null {
  const items = order.items ?? [];
  const slugs = [...new Set(items.map((it) => it.productSlug).filter((s): s is string => !!s))].slice(0, MAX_SUBSCRIBE_CHECKS);
  const products = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ['product', slug],
      queryFn: () => apiFetch<ProductDetail>(`/products/${encodeURIComponent(slug)}`, { auth: false, cache: 'no-store' }),
      staleTime: 60_000,
      retry: false,
    })),
  });
  for (const it of items) {
    const idx = it.productSlug ? slugs.indexOf(it.productSlug) : -1;
    const product = idx >= 0 ? products[idx]?.data : undefined;
    if (!product || isRetailOnly(product)) continue;
    const variation = product.variations.find((v) => v.id === it.variationId);
    if (variation && variation.stock > 0) return { variationId: it.variationId, quantity: it.quantity, productName: it.productName };
  }
  return null;
}

function SubscribeCard({ candidate, onOpen }: { candidate: SubscribeCandidate; onOpen: () => void }) {
  const cfg = usePublicConfig();
  return (
    <Card variant="flat" padding={12}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Icon icon={Repeat} tone="brand" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {t.subscribeTitle(candidate.productName)}
          </Text>
          <Text variant="caption" tone="secondary" as="div">
            {t.subscribeBody(Math.round(cfg.subscribeDiscountPct * 100))}
          </Text>
        </div>
      </div>
      <Button variant="secondary" fullWidth onPress={onOpen} style={{ marginTop: 10 }}>
        {t.subscribeCta}
      </Button>
    </Card>
  );
}

// Phản hồi place-order có thêm điểm sẽ nhận (shared-types OrderDTO / PlacedOrder của Mini App) mà kiểu cục bộ của web chưa khai.
type PlacedSplit = SplitOrderDTO & { pointsEarned?: number };
type OrderDTO = Omit<ShopOrderDTO, 'splitOrders'> & { pointsEarned?: number; splitOrders?: PlacedSplit[] };
type Split = PlacedSplit[];

// Lần đặt có hàng gian hàng tự giao bị tách thành nhiều đơn: tổng và điểm phải là của cả lần đặt, không chỉ đơn đầu
// (cùng cách tính với Mini App và với số điểm màn Thanh toán đã hứa).
function summarize(order: OrderDTO) {
  const split: Split | null = order.splitOrders && order.splitOrders.length > 1 ? order.splitOrders : null;
  const codes = split ? split.map((o) => o.code) : [order.code];
  const grandTotal = split ? split.reduce((sum, o) => sum + o.total, 0) : order.total;
  const pointsEarned =
    split && split.every((o) => o.pointsEarned != null) ? split.reduce((sum, o) => sum + (o.pointsEarned ?? 0), 0) : (order.pointsEarned ?? 0);
  return { split, codes, grandTotal, pointsEarned };
}

/**
 * Màn "Đặt hàng thành công" sau khi đặt. Dưới md vẽ như OrderSuccess của Mini App; từ md giữ màn máy tính,
 * thêm cùng các dòng thông tin (tiền mặt, điểm, Giao dự kiến). `etaLabel` null khi cấu hình công khai chưa tải hoặc thiếu `shippingEta`.
 */
export function OrderSuccess({ order, etaLabel, continueHref }: { order: OrderDTO; etaLabel: string | null; continueHref: string }) {
  const { split, codes, grandTotal, pointsEarned } = summarize(order);
  const candidate = useSubscribeCandidate(order);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const subscribe = candidate && (
    <>
      <SubscribeCard candidate={candidate} onOpen={() => setSubscribeOpen(true)} />
      {notice && (
        <Text variant="caption" tone="secondary" as="div">
          <span role="status">{notice}</span>
        </Text>
      )}
    </>
  );
  return (
    <>
      <MobileSuccess
        order={order} etaLabel={etaLabel} split={split} codes={codes} grandTotal={grandTotal} pointsEarned={pointsEarned}
        continueHref={continueHref} subscribe={subscribe}
      />
      <DesktopSuccess
        order={order} etaLabel={etaLabel} split={split} grandTotal={grandTotal} pointsEarned={pointsEarned}
        continueHref={continueHref} subscribe={subscribe}
      />
      {candidate && (
        <SubscribeSheet
          visible={subscribeOpen}
          onClose={() => setSubscribeOpen(false)}
          onNotice={setNotice}
          variationId={candidate.variationId}
          quantity={candidate.quantity}
        />
      )}
    </>
  );
}

interface View {
  order: OrderDTO;
  etaLabel: string | null;
  split: Split | null;
  grandTotal: number;
  pointsEarned: number;
  continueHref: string;
  subscribe: React.ReactNode;
}

function MobileSuccess({ order, etaLabel, split, codes, grandTotal, pointsEarned, continueHref, subscribe }: View & { codes: string[] }) {
  const router = useRouter();
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const codesText = codes.join(', ');
  const copyCode = () => {
    void copyText(codesText).then((ok) => setCopyNote(ok ? t.copied : t.copyFailed(codesText)));
  };
  return (
    <div data-testid="order-success-mobile" className="flex flex-col gap-4 md:hidden" style={{ padding: '32px 16px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
        <span
          aria-hidden
          style={{ width: 56, height: 56, borderRadius: 'var(--radius-pill)', background: 'var(--color-action-secondary-bg)', display: 'grid', placeItems: 'center' }}
        >
          <Icon icon={CheckCircle2} size="lg" tone="brand" />
        </span>
        <Heading variant="title-lg" as="h1">
          {t.heading}
        </Heading>
        <Text variant="body-sm" tone="secondary">
          {t.subheading}
        </Text>
      </div>

      <Card variant="outline" padding={16}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">
              {t.orderCode}
            </Text>
            {codes.map((c) => (
              <Text key={c} variant="body-lg" as="div" style={{ fontWeight: 700, letterSpacing: 1, wordBreak: 'break-all' }}>
                {c}
              </Text>
            ))}
          </div>
          <IconButton icon={Copy} label={t.copyCode} onPress={copyCode} />
        </div>
        {copyNote && (
          <Text variant="caption" tone="secondary" as="div">
            <span role="status">{copyNote}</span>
          </Text>
        )}
        <div style={{ borderTop: '1px solid var(--color-border-subtle)', marginTop: 12, paddingTop: 8 }}>
          <KeyValueRow label={split ? `Tổng ${split.length} đơn` : t.total} value={formatVnd(grandTotal)} emphasis />
          {order.paymentMethod === 'COD' && (
            <Text variant="caption" tone="secondary" as="div">
              {t.prepareCash}
            </Text>
          )}
          {pointsEarned > 0 && (
            <>
              <KeyValueRow label={t.pointsLabel} value={t.pointsValue(pointsEarned)} tone="success" />
              <Text variant="caption" tone="tertiary" as="div">
                {t.pointsComing(pointsEarned)}
              </Text>
            </>
          )}
          {etaLabel && <KeyValueRow label={t.etaLabel} value={etaLabel} />}
        </div>
      </Card>

      {split && (
        <section aria-label="Đơn cùng lần đặt">
          <Heading variant="title-sm" as="h2" style={{ marginBottom: 4 }}>
            {t.splitTitle(split.length)}
          </Heading>
          <Text variant="caption" tone="secondary" as="p" style={{ margin: '0 0 8px' }}>
            {t.splitBody}
          </Text>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {split.map((o) => (
              <li key={o.code}>
                <button
                  type="button"
                  className="tubu-press"
                  aria-label={`Xem đơn ${o.code}, ${o.fulfillerName} giao, ${formatVnd(o.total)}`}
                  onClick={() => router.replace(orderDetailHref(o.code))}
                  style={{
                    width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                    border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-control)',
                    background: 'var(--color-bg-surface)', textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body-sm" as="span" style={{ display: 'block', fontWeight: 700 }}>
                      {o.code}
                    </Text>
                    <Text variant="caption" tone="secondary" as="span" style={{ display: 'block' }}>
                      {o.fulfillerName} giao
                    </Text>
                  </span>
                  <Text variant="body-sm" as="span" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatVnd(o.total)}
                  </Text>
                  <Icon icon={ChevronRight} size="sm" tone="muted" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t.nextTitle}>
        <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
          {t.nextTitle}
        </Heading>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {t.steps.map((s, i) => (
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button fullWidth size="lg" onPress={() => router.replace(orderDetailHref(order.code))}>
          {t.trackOrder}
        </Button>
        <Button fullWidth variant="ghost" onPress={() => router.replace(continueHref)}>
          {t.keepShopping}
        </Button>
      </div>
      {subscribe}
    </div>
  );
}

function DesktopSuccess({ order, etaLabel, split, grandTotal, pointsEarned, continueHref, subscribe }: View) {
  return (
    <div data-testid="order-success-desktop" className="py-16 text-center max-md:hidden">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
        <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
      </div>
      <h2 className="mt-5 font-display text-2xl font-semibold text-stone-900">{t.heading}</h2>
      <p className="mt-1 text-sm text-stone-600">{t.subheading}</p>
      {split ? (
        <div className="mx-auto mt-3 max-w-md text-left">
          <p className="text-center font-semibold text-stone-900">{t.splitTitle(split.length)}</p>
          <p className="text-center text-sm text-stone-600">{t.splitBody}</p>
          <ul className="mt-2 space-y-2">
            {split.map((o) => (
              <li key={o.code} className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${ui.card}`}>
                <span>
                  <Link href={orderDetailHref(o.code)} className="font-semibold text-forest-700 underline">
                    {o.code}
                  </Link>{' '}
                  · {o.fulfillerName} giao
                </span>
                <span className="font-semibold text-stone-900">{formatVnd(o.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-stone-700">
          {t.orderCode} <span className="font-semibold text-forest-700">{order.code}</span>
        </p>
      )}
      <div className="mx-auto mt-3 max-w-md space-y-1 text-sm text-stone-700">
        <p>
          {split ? `Tổng ${split.length} đơn` : t.total}: <span className="font-semibold text-stone-900">{formatVnd(grandTotal)}</span>
        </p>
        {order.paymentMethod === 'COD' && <p>{t.prepareCash}</p>}
        {pointsEarned > 0 && (
          <p className="text-success-fg">
            {t.pointsLabel}: {t.pointsValue(pointsEarned)} — {t.pointsComing(pointsEarned)}
          </p>
        )}
        {etaLabel && <p>{t.etaLabel}: <span className="font-semibold text-stone-900">{etaLabel}</span></p>}
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href={orderDetailHref(order.code)} className={ui.btnPrimary}>
          {t.trackOrder}
        </Link>
        <Link href="/tai-khoan/don-hang" className={ui.btnSecondary}>
          Đơn của tôi
        </Link>
        <Link href={continueHref} replace className={ui.btnSecondary}>
          {t.keepShopping}
        </Link>
      </div>
      <div className="mx-auto mt-6 flex max-w-md flex-col gap-2 text-left">{subscribe}</div>
    </div>
  );
}
