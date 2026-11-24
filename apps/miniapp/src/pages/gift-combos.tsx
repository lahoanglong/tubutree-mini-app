import { useState, type CSSProperties } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Gift, Truck } from 'lucide-react';
import { comboAddedCue, giftCombosCallouts, giftCombosViews, type CueCart, type GiftCombosCallout } from '@tubutree/app-core/commerce/gift-combos';
import { giftLandingQuery } from '@tubutree/app-core/queries/bundle';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useBundleAdd } from '../components/product/use-bundle-add';
import { RefillLandingEntry } from '../components/refill/refill-landing-entry';
import { Card } from '../components/ui/card';
import { ComboCard } from '../components/ui/combo-card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { SR_ONLY } from '../components/ui/sr-only';
import { Text } from '../components/ui/text';
import { useSmartNavigate } from '../lib/smart-nav';
import { getLoadErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';

const PAGE_STYLE: CSSProperties = { background: 'var(--color-bg-canvas)', paddingBottom: 'var(--space-stack-xl)' };
const BODY: CSSProperties = { padding: '0 var(--space-inset-page)' };
const LIST: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-inline-md)', fontVariantNumeric: 'tabular-nums' };
const CALLOUT_ICON = { freeship: Truck, gift: Gift } as const;

/** Hai mốc kèm đơn (Miễn phí giao hàng, quà dùng thử 0đ): chỉ là thông tin, không nút. Cùng `GiftCombosCallouts` của web. */
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
 * Bộ quà tặng & combo khởi đầu (lối vào: "Xem tất cả" của Combo tiết kiệm ở Trang chủ). Combo thật đang bán được, tối đa 8; "Tiết kiệm" của thẻ là số
 * máy chủ tính bằng đúng hàm giỏ trừ; hai mốc kèm đơn đọc từ máy chủ; "Thêm cả combo" một chạm, xong thì ngay dưới thẻ vừa bấm có một dòng nói còn thiếu
 * bao nhiêu tới Miễn phí giao hàng, rồi tới quà dùng thử 0đ (đọc từ giỏ máy chủ trả về). Cùng dữ liệu và luật với web `/bo-qua-tang`.
 */
export default function GiftCombosPage() {
  const navigate = useNavigate();
  const goSmart = useSmartNavigate();
  const q = useQuery(giftLandingQuery(coreHttp));
  const { add, busyId } = useBundleAdd();
  const [cue, setCue] = useState<{ id: string; text: string } | null>(null);
  const views = giftCombosViews(q.data, serverNow());
  const callouts = giftCombosCallouts(q.data);

  return (
    <Page className="page" style={PAGE_STYLE}>
      <PageHeader title={fillCopy('giftCombos.title')} />
      <div style={BODY}>
        <Text variant="body-sm" tone="secondary" as="p">
          {fillCopy('giftCombos.intro')}
        </Text>
        <div style={{ marginTop: 'var(--space-stack-sm)' }}>
          <GiftCombosCallouts items={callouts} />
        </div>
        <div style={{ marginTop: 'var(--space-stack-md)' }}>
          {q.isLoading ? (
            <div style={LIST} aria-hidden="true">
              {[0, 1].map((i) => (
                <Skeleton key={i} height={248} radius="var(--radius-card)" />
              ))}
            </div>
          ) : q.isError && !q.data ? (
            <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : views.length === 0 ? (
            <EmptyState variant="inline" art="basket" heading={fillCopy('giftCombos.empty')} ctaLabel={fillCopy('flash.emptyCta')} onCta={() => goSmart('/browse')} />
          ) : (
            <section aria-labelledby="gift-combos-list-title" data-testid="gift-combos-list" style={LIST}>
              <h2 id="gift-combos-list-title" style={SR_ONLY}>
                {fillCopy('giftCombos.listLabel', { n: views.length })}
              </h2>
              {views.map((v) => {
                // Ưu tiên món còn hàng: "Xem từng món" luôn dẫn tới một món mua được.
                const target = v.items.find((it) => it.stock !== 'out') ?? v.items[0];
                const onDone = (cart: CueCart) => {
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
                      itemPrices
                      onAddAll={() => {
                        setCue(null);
                        add({ id: v.id, lines: v.lines, errorKey: 'shop.comboError', successText: fillCopy('shop.comboAdded'), onDone });
                      }}
                      onSeeItems={target?.slug ? () => navigate(`/product/${encodeURIComponent(target.slug)}`) : undefined}
                    />
                    {/* Vùng đọc luôn có sẵn để câu mốc được đọc khi vừa hiện; báo "đã thêm" là thông báo nổi của hook. */}
                    <div role="status" data-testid="gift-combos-cue">
                      {cue?.id === v.id && (
                        <Text variant="caption" tone="brand" as="p" numeric style={{ paddingTop: 'var(--space-stack-xs)', fontWeight: 600 }}>
                          {cue.text}
                        </Text>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
        <RefillLandingEntry style={{ marginTop: 'var(--space-stack-md)' }} />
      </div>
    </Page>
  );
}
