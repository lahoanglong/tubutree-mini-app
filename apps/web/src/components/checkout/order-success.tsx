'use client';

// Nguồn: apps/miniapp/src/components/checkout/order-success.tsx (chữ ở i18n/vi-checkout.ts, viSuccess).
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
import { showOrderZaloFriend } from '@tubutree/app-core/order-zalo';
import { referralViralOn } from '@tubutree/app-core/referral/viral-flag';
import { OrderInviteNudge } from '@/components/referral/order-invite-nudge';
import { OrderZaloFriend } from './order-zalo';
import { SubscribeSheet } from '@/app/san-pham/[slug]/subscribe-sheet';
import type { ProductDetail } from '@/lib/api';

const t = {
  prepareCash: 'Chuẩn bị tiền mặt khi nhận hàng',
  heading: 'Cảm ơn bạn đã chọn Tubu',
  subheading: 'Đơn hàng của bạn đã được ghi nhận',
  orderCode: 'Mã đơn hàng',
  copyCodeLabel: (codes: string) => `Sao chép mã đơn ${codes}`,
  copied: 'Đã sao chép mã đơn',
  copyFailed: (code: string) => `Không sao chép được — mã đơn: ${code}`,
  total: 'Tổng thanh toán',
  pointsLabel: 'Điểm Xanh sẽ nhận',
  pointsValueWhen: (n: number) => `+${formatCount(n)} điểm, về khi đơn giao xong`,
  etaLabel: 'Giao dự kiến',
  nextTitle: 'Tiếp theo',
  extrasLabel: 'Thêm cho đơn này',
  steps: [
    { title: 'Xác nhận đơn', body: 'Tubu kiểm tra và xác nhận đơn của bạn.' },
    { title: 'Đóng gói', body: 'Sản phẩm được đóng gói cẩn thận.' },
    { title: 'Giao hàng', body: 'Đơn vị vận chuyển giao tới địa chỉ của bạn.' },
  ],
  trackOrder: 'Theo dõi đơn',
  keepShopping: 'Tiếp tục mua sắm',
  subscribeTitle: (name: string) => `Đặt định kỳ ${name}`,
  subscribeBody: (pct: number) => `Tự động giao lại theo chu kỳ, tiết kiệm ${pct}% mỗi đơn.`,
  splitTitle: (n: number) => `Hàng do ${n} nơi giao nên được tách thành ${n} đơn`,
  splitBody: 'Mỗi đơn có mã, phí giao và lộ trình riêng.',
};

const MAX_SUBSCRIBE_CHECKS = 3;

// KeyValueRow của web chưa gán tabular-nums cho giá trị như bản Mini; thuộc tính này kế thừa nên đặt ở dòng.
const NUMS = { fontVariantNumeric: 'tabular-nums' } as const;

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
    const variation = it.variationId ? product.variations.find((v) => v.id === it.variationId) : undefined;
    if (it.variationId && variation && variation.stock > 0) return { variationId: it.variationId, quantity: it.quantity, productName: it.productName };
  }
  return null;
}

// Gợi ý phụ sau khi đặt: MỘT dòng chạm mở sheet (cùng kiểu dòng mời bạn bên dưới), không thêm nút cỡ lớn tranh vai "Theo dõi đơn".
function SubscribeRow({ candidate, onOpen }: { candidate: SubscribeCandidate; onOpen: () => void }) {
  const cfg = usePublicConfig();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tubu-press flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[var(--radius-card)] border border-[color:var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-left"
      style={{ padding: 'var(--space-stack-sm) var(--space-inline-md)', fontFamily: 'inherit' }}
    >
      <Icon icon={Repeat} tone="brand" style={{ flex: 'none' }} />
      <span className="min-w-0 flex-1">
        <Text variant="body-sm" as="span" style={{ display: 'block', fontWeight: 600 }}>
          {t.subscribeTitle(candidate.productName)}
        </Text>
        <Text variant="caption" tone="secondary" as="span" style={{ display: 'block' }}>
          {t.subscribeBody(Math.round(cfg.subscribeDiscountPct * 100))}
        </Text>
      </span>
      <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flex: 'none' }} />
    </button>
  );
}

// Phản hồi place-order có thêm điểm sẽ nhận (shared-types OrderDTO / PlacedOrder của Mini App) mà kiểu cục bộ của web chưa khai.
type PlacedSplit = SplitOrderDTO & { pointsEarned?: number };
type PlacedItem = ShopOrderDTO['items'][number] & { variationId?: string; productSlug?: string | null };
type OrderDTO = Omit<ShopOrderDTO, 'splitOrders' | 'items'> & { pointsEarned?: number; splitOrders?: PlacedSplit[]; items: PlacedItem[] };
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
  const cfg = usePublicConfig();
  const friend = showOrderZaloFriend(cfg.orderZaloEnabled, order) && <OrderZaloFriend code={order.code} from="success" />;
  const invite = referralViralOn(cfg) && <OrderInviteNudge />;
  const subscribe = candidate && (
    <>
      <SubscribeRow candidate={candidate} onOpen={() => setSubscribeOpen(true)} />
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
        continueHref={continueHref} subscribe={subscribe} friend={friend} invite={invite}
      />
      <DesktopSuccess
        order={order} etaLabel={etaLabel} split={split} codes={codes} grandTotal={grandTotal} pointsEarned={pointsEarned}
        continueHref={continueHref} subscribe={subscribe} friend={friend} invite={invite}
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
  codes: string[];
  grandTotal: number;
  pointsEarned: number;
  continueHref: string;
  subscribe: React.ReactNode;
  /** Lời mời kết bạn Zalo (liên kết phụ, chỉ khi cờ bật và đơn có đồng ý); đặt sau các nút để không tranh vai nút chính. */
  friend: React.ReactNode;
  /** Lời mời bạn nhận thưởng đơn đầu (cờ `growth.referral_viral_enabled`): một dòng dưới gợi ý Đặt định kỳ, như Mini App. */
  invite: React.ReactNode;
}

// Chép cả danh sách mã (đơn tách thì mọi mã, không chỉ mã đầu); báo kết quả bằng role="status" để trình đọc màn hình đọc lên.
function useCopyCodes(codesText: string) {
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const copyCode = () => {
    void copyText(codesText).then((ok) => setCopyNote(ok ? t.copied : t.copyFailed(codesText)));
  };
  return { copyNote, copyCode };
}

// 3 bước tiếp theo đủ câu ở khổ máy tính; điện thoại dùng `NextStepsCompact` với cùng chữ trong `t.steps`.
function NextSteps() {
  return (
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
  );
}

// Khổ điện thoại: 3 bước thành một hàng (số + tên bước) để nút chính và mã đơn nằm trong màn đầu; câu giải thích từng bước vẫn đọc được
// bằng trình đọc màn hình, máy tính giữ danh sách đủ câu (NextSteps).
function NextStepsCompact() {
  return (
    <section aria-label={t.nextTitle}>
      <Heading variant="title-sm" as="h2" className="mb-2">
        {t.nextTitle}
      </Heading>
      <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0">
        {t.steps.map((s, i) => (
          <li key={s.title} className="flex flex-col items-center gap-1 text-center">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-pill)] text-caption font-bold"
              style={{
                background: i === 0 ? 'var(--color-action-primary-bg)' : 'var(--color-bg-subtle)',
                color: i === 0 ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
              }}
            >
              {i + 1}
            </span>
            <Text variant="caption" as="span" style={{ fontWeight: 600 }}>
              {s.title}
              <span className="sr-only">: {s.body}</span>
            </Text>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Khổ điện thoại (375×812): trạng thái đơn, thẻ mã đơn + tiền, rồi ngay hai nút "Theo dõi đơn" / "Tiếp tục mua sắm" để nút chính luôn trong
 * màn đầu, kể cả đơn tách nhiều nơi giao. Danh sách đơn tách, 3 bước tiếp theo và nhóm gợi ý phụ (kết bạn Zalo, Đặt định kỳ, mời bạn) nằm dưới.
 */
function MobileSuccess({ order, etaLabel, split, codes, grandTotal, pointsEarned, continueHref, subscribe, friend, invite }: View) {
  const router = useRouter();
  const codesText = codes.join(', ');
  const { copyNote, copyCode } = useCopyCodes(codesText);
  return (
    <div data-testid="order-success-mobile" className="flex flex-col gap-3 px-4 pb-6 pt-2 md:hidden">
      <div className="flex flex-col items-center gap-1 text-center">
        <span aria-hidden className="grid h-12 w-12 place-items-center rounded-[var(--radius-pill)] bg-[var(--color-action-secondary-bg)]">
          <Icon icon={CheckCircle2} size="lg" tone="brand" />
        </span>
        <Heading variant="title-lg" as="h1">
          {t.heading}
        </Heading>
        <Text variant="body-sm" tone="secondary">
          {t.subheading}
        </Text>
      </div>

      <Card variant="outline" padding={12}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <Text variant="caption" tone="tertiary" as="div">
              {t.orderCode}
            </Text>
            {codes.map((c) => (
              <Text key={c} variant="body-lg" as="div" className="break-all" style={{ fontWeight: 700, letterSpacing: 1 }}>
                {c}
              </Text>
            ))}
          </div>
          <IconButton icon={Copy} label={t.copyCodeLabel(codesText)} onPress={copyCode} />
        </div>
        {copyNote && (
          <Text variant="caption" tone="secondary" as="div">
            <span role="status">{copyNote}</span>
          </Text>
        )}
        <div className="mt-2 border-t border-[color:var(--color-border-subtle)] pt-1">
          <KeyValueRow label={split ? `Tổng ${split.length} đơn` : t.total} value={formatVnd(grandTotal)} emphasis style={NUMS} />
          {order.paymentMethod === 'COD' && (
            <Text variant="caption" tone="secondary" as="div">
              {t.prepareCash}
            </Text>
          )}
          {pointsEarned > 0 && (
            <KeyValueRow label={t.pointsLabel} value={t.pointsValueWhen(pointsEarned)} tone="success" style={NUMS} />
          )}
          {etaLabel && <KeyValueRow label={t.etaLabel} value={etaLabel} style={NUMS} />}
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <Button fullWidth size="lg" onPress={() => router.replace(orderDetailHref(order.code))}>
          {t.trackOrder}
        </Button>
        <Button fullWidth variant="ghost" onPress={() => router.replace(continueHref)}>
          {t.keepShopping}
        </Button>
      </div>

      {split && (
        <section aria-label="Đơn cùng lần đặt">
          <Heading variant="title-sm" as="h2" className="mb-1">
            {t.splitTitle(split.length)}
          </Heading>
          <Text variant="caption" tone="secondary" as="p" className="mb-2 mt-0">
            {t.splitBody}
          </Text>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {split.map((o) => (
              <li key={o.code}>
                <button
                  type="button"
                  className="tubu-press flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-left"
                  style={{ padding: 'var(--space-stack-sm) var(--space-inline-md)' }}
                  aria-label={`Xem đơn ${o.code}, ${o.fulfillerName} giao, ${formatVnd(o.total)}`}
                  onClick={() => router.replace(orderDetailHref(o.code))}
                >
                  <span className="min-w-0 flex-1">
                    <Text variant="body-sm" as="span" style={{ display: 'block', fontWeight: 700 }}>
                      {o.code}
                    </Text>
                    <Text variant="caption" tone="secondary" as="span" style={{ display: 'block' }}>
                      {o.fulfillerName} giao
                    </Text>
                  </span>
                  <Text variant="body-sm" as="span" numeric className="whitespace-nowrap" style={{ fontWeight: 600 }}>
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

      <section aria-label={t.extrasLabel} className="flex flex-col gap-2 empty:hidden">
        {friend}
        {subscribe}
        {invite}
      </section>
    </div>
  );
}

function DesktopSuccess({ order, etaLabel, split, codes, grandTotal, pointsEarned, continueHref, subscribe, friend, invite }: View) {
  const codesText = codes.join(', ');
  const { copyNote, copyCode } = useCopyCodes(codesText);
  return (
    <div data-testid="order-success-desktop" className="py-10 text-center max-md:hidden">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
        <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
      </div>
      <h2 className="mt-5 font-display text-2xl font-semibold text-stone-900">{t.heading}</h2>
      <p className="mt-1 text-sm text-stone-600">{t.subheading}</p>
      <div className="mt-2 flex items-center justify-center gap-1 text-stone-700">
        <p className="break-words">
          {t.orderCode} <span className="font-semibold text-forest-700">{codesText}</span>
        </p>
        <IconButton icon={Copy} label={t.copyCodeLabel(codesText)} onPress={copyCode} />
      </div>
      {copyNote && (
        <Text variant="caption" tone="secondary" as="div">
          <span role="status">{copyNote}</span>
        </Text>
      )}
      {split && (
        <div className="mx-auto mt-3 max-w-md text-left">
          <p className="text-center font-semibold text-stone-900">{t.splitTitle(split.length)}</p>
          <p className="text-center text-sm text-stone-600">{t.splitBody}</p>
          <ul className="mt-2 space-y-2">
            {split.map((o) => (
              <li key={o.code} className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${ui.card}`}>
                <span>
                  <Link href={orderDetailHref(o.code)} replace className="font-semibold text-forest-700 underline">
                    {o.code}
                  </Link>{' '}
                  · {o.fulfillerName} giao
                </span>
                <span className="font-semibold text-stone-900" style={NUMS}>
                  {formatVnd(o.total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mx-auto mt-3 max-w-md space-y-1 text-sm text-stone-700">
        <p>
          {split ? `Tổng ${split.length} đơn` : t.total}:{' '}
          <span className="font-semibold text-stone-900" style={NUMS}>
            {formatVnd(grandTotal)}
          </span>
        </p>
        {order.paymentMethod === 'COD' && <p>{t.prepareCash}</p>}
        {pointsEarned > 0 && (
          <p className="text-success-fg" style={NUMS}>
            {t.pointsLabel}: {t.pointsValueWhen(pointsEarned)}
          </p>
        )}
        {etaLabel && <p>{t.etaLabel}: <span className="font-semibold text-stone-900">{etaLabel}</span></p>}
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href={orderDetailHref(order.code)} replace className={ui.btnPrimary}>
          {t.trackOrder}
        </Link>
        <Link href="/tai-khoan/don-hang" className={ui.btnSecondary}>
          Đơn của tôi
        </Link>
        <Link href={continueHref} replace className={ui.btnSecondary}>
          {t.keepShopping}
        </Link>
      </div>
      <div className="mx-auto mt-6 max-w-md text-left">
        <NextSteps />
      </div>
      {friend && <div className="mx-auto mt-6 max-w-md text-left">{friend}</div>}
      <div className="mx-auto mt-6 flex max-w-md flex-col gap-2 text-left">
        {subscribe}
        {invite}
      </div>
    </div>
  );
}
