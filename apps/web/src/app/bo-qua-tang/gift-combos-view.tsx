'use client';

// Nguồn: apps/miniapp/src/pages/gift-combos.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Gift, Truck } from 'lucide-react';
import type { GiftLanding } from '@tubutree/app-core/api/bundle';
import { comboAddedCue, giftCombosCallouts, giftCombosViews, type CueCart, type GiftCombosCallout } from '@tubutree/app-core/commerce/gift-combos';
import { bundleKeys, giftLandingQuery } from '@tubutree/app-core/queries/bundle';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { EmptyState } from '@/components/empty-state';
import { Card, ComboCard, Skeleton, Text } from '@/components/mini';
import { RefillLandingEntry } from '@/components/refill/refill-landing-entry';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { comboBundleLines, useBundleAdd } from '@/lib/use-bundle-add';
import { useHydrated } from '@/lib/use-hydrated';

const GRID = 'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 md:gap-4';
const CALLOUT_ICON = { freeship: Truck, gift: Gift } as const;

/** Hai mốc kèm đơn (Miễn phí giao hàng, quà dùng thử 0đ): chỉ là thông tin, không nút. Cùng `GiftCombosCallouts` của Mini App. */
function GiftCombosCallouts({ items }: { items: readonly GiftCombosCallout[] }) {
  if (items.length === 0) return null;
  return (
    <Card variant="flat" padding={12} style={{ background: 'var(--color-bg-subtle)' }}>
      <ul aria-label={fillCopy('giftCombos.calloutsLabel')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}>
        {items.map((c) => {
          const Icon = CALLOUT_ICON[c.kind];
          return (
            <li key={c.kind} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-inline-sm)' }}>
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" color="var(--color-text-brand)" style={{ flex: '0 0 auto' }} />
              <Text variant="body-sm" numeric data-testid="gift-combos-callout">
                {c.text}
              </Text>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Trang Bộ quà tặng & combo khởi đầu của web: combo thật đang bán được (luật Combo Trang chủ, tối đa 8), "Tiết kiệm" của thẻ là số máy chủ tính bằng
 * đúng hàm giỏ trừ, hai mốc đọc từ máy chủ, "Thêm cả combo" một chạm (khách chưa đăng nhập: cờ giỏ khách bật thì vào giỏ trình duyệt ngay tại trang, tắt thì sang đăng nhập rồi quay lại, như Combo Trang chủ).
 * Kết quả hiện ngay dưới thẻ vừa bấm (web không có thông báo nổi): "Đã thêm…" kèm câu còn thiếu bao nhiêu tới Miễn phí giao hàng, rồi quà dùng thử 0đ,
 * đọc từ giỏ máy chủ trả về. HTML máy chủ (ISR 5 phút) vẽ sẵn; lượt hydrate đầu lọc hạn theo đúng giờ dựng HTML, sau đó theo giờ máy chủ hiện tại.
 */
export default function GiftCombosView({ initial, initialFetchedAt }: { initial?: GiftLanding; initialFetchedAt?: number }) {
  const q = useQuery({ ...giftLandingQuery(coreHttp), ...(initial ? { initialData: initial, initialDataUpdatedAt: initialFetchedAt } : {}) });
  const hydrated = useHydrated();
  const { add, busyId, result } = useBundleAdd([bundleKeys.giftLanding]);
  const [cue, setCue] = useState<{ id: string; text: string } | null>(null);
  const router = useRouter();
  const title = fillCopy('giftCombos.title');
  const now = hydrated ? serverNow() : (initialFetchedAt ?? serverNow());
  // Trước hydrate `now` là giờ máy chủ dựng HTML (cùng mốc lọc hạn với JSON-LD của page.tsx) nên hai lượt vẽ đầu khớp nhau; sau hydrate là giờ thật.
  const views = giftCombosViews(q.data, now);
  const callouts = giftCombosCallouts(q.data);
  // Máy chủ từ chối vì món hết hàng thì danh sách tải lại và thẻ vừa bấm có thể biến mất cùng vùng báo của nó: lời báo khi đó hiện ở vùng chung của trang.
  const orphan = result && !views.some((v) => v.id === result.id) ? result : null;

  return (
    <>
      <PageHeader title={title} backHref="/" />
      <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 'var(--space-stack-sm)' }}>
        {fillCopy('giftCombos.intro')}
      </Text>
      <div style={{ marginTop: 'var(--space-stack-sm)' }}>
        <GiftCombosCallouts items={callouts} />
      </div>
      <div role="status" data-testid="gift-combos-status" className={orphan ? 'mt-3 text-sm' : 'sr-only'}>
        {orphan && <p className={orphan.ok ? 'text-success-fg' : 'text-danger-fg'}>{orphan.text}</p>}
      </div>
      <div style={{ marginTop: 'var(--space-stack-md)' }}>
        {q.isLoading ? (
          <div className={GRID} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={248} radius="var(--radius-card)" />
            ))}
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState message={loadErrorText(q.error)} onRetry={() => void q.refetch()} />
        ) : views.length === 0 ? (
          <EmptyState title={fillCopy('giftCombos.empty')} actionHref="/san-pham" actionLabel={fillCopy('flash.emptyCta')} />
        ) : (
          <section aria-labelledby="gift-combos-list-title" data-testid="gift-combos-list" className={`${GRID} tabular-nums`}>
            <h2 id="gift-combos-list-title" className="sr-only">
              {fillCopy('giftCombos.listLabel', { n: views.length })}
            </h2>
            {views.map((v) => {
              // Ưu tiên món còn hàng: "Xem từng món" luôn dẫn tới một món mua được.
              const target = v.items.find((it) => it.stock !== 'out') ?? v.items[0];
              const mine = result?.id === v.id ? result : null;
              const onDone = (cart: CueCart | null) => {
                const next = comboAddedCue(cart);
                setCue(next ? { id: v.id, text: next.text } : null);
              };
              return (
                <div key={v.id}>
                  <ComboCard
                    title={v.title}
                    items={v.items}
                    pct={v.pct}
                    total={v.total}
                    comboTotal={v.comboTotal}
                    busy={busyId === v.id}
                    itemPrices={!v.clamped}
                    onAddAll={() => {
                      setCue(null);
                      add({ id: v.id, lines: comboBundleLines(v), errorKey: 'shop.comboError', successText: fillCopy('shop.comboAdded'), onDone });
                    }}
                    onSeeItems={target?.slug ? () => router.push(`/san-pham/${encodeURIComponent(target.slug)}`) : undefined}
                  />
                  {/* Vùng đọc luôn có sẵn dưới mỗi thẻ để kết quả được đọc khi vừa hiện, ngay chỗ khách vừa bấm. */}
                  <div role="status" data-testid="gift-combos-cue" className={mine ? 'pt-2 text-sm' : undefined}>
                    {mine && <p className={mine.ok ? 'text-success-fg' : 'text-danger-fg'}>{mine.text}</p>}
                    {mine?.ok && cue?.id === v.id && <p className="pt-1 text-caption font-semibold tabular-nums text-[color:var(--color-text-brand)]">{cue.text}</p>}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
      <RefillLandingEntry className="mt-4" />
    </>
  );
}
