'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { planShopSections, publicTier, shopTabs, storefrontStatsInput, uniqueShopProducts, type ShopTabKey } from '@tubutree/app-core/commerce/shop-page';
import { shopStats } from '@tubutree/app-core/commerce/shop-stats';
import { SAMPLE_STOREFRONT_LABEL, SAMPLE_STOREFRONT_NOTE } from '@tubutree/app-core/storefront-signup';
import type { ProductCard as ProductCardData, StorefrontDetail } from '@/lib/api';
import { StorefrontAction } from '@/components/affiliate/storefront-owner';
import { StoreLayout } from '@/components/layouts/store-layout';
import { Badge } from '@/components/mini/badge';
import { SegmentedTabs } from '@/components/mini/segmented-tabs';
import { ShopHeader } from '@/components/mini/shop-header';
import { ShopSection, type ShopSectionItem } from '@/components/mini/shop-section';
import { ShopStatsRow } from '@/components/mini/shop-stats-row';
import { ShopTopBar } from '@/components/mini/shop-top-bar';
import { Text } from '@/components/mini/text';
import { TierBadge } from '@/components/mini/tier-badge';
import { ShopCategoriesTab } from './shop-categories-tab';
import { ShopProductsTab } from './shop-products-tab';

/** Phần dữ liệu công khai thân trang cần: không gồm kho/ngân hàng (trang server tự quyết định có hiện kho hay không). */
export type StorefrontBodyData = Pick<StorefrontDetail, 'slug' | 'title' | 'type' | 'isPartner' | 'isSample' | 'headerNote' | 'coverUrl' | 'avatarUrl' | 'ownerTier' | 'referralCode' | 'collections'>;

export interface StorefrontBodyProps {
  storefront: StorefrontBodyData;
  /** "CTV tuyển chọn" và tick: chỉ khi admin đã duyệt gian hàng (do trang server tính). */
  badgeLabel: string | null;
  /** Khối do trang server dựng: URL subdomain, kho xuất hàng, hotline, dải cam kết. Nằm giữa số liệu và tab. */
  intro?: ReactNode;
}

/** Thanh tab dính ở điện thoại ngay dưới nút lùi cố định (56px); từ md web có thanh đầu trang riêng nên tab trôi theo trang. */
const STICKY_TOP = 'calc(var(--safe-top, 0px) + 56px)';
const TABS_HEIGHT = 62;
const SORT_TOP = `calc(var(--safe-top, 0px) + 56px + ${TABS_HEIGHT - 12}px)`;

const asSection = (c: { id: string; title: string; kind: string; layout: string; comboDiscountPct?: number | null; items: StorefrontDetail['collections'][number]['items'] }) => ({
  id: c.id,
  title: c.title,
  kind: c.kind,
  layout: c.layout,
  comboDiscountPct: c.comboDiscountPct ?? null,
  items: c.items as unknown as ShopSectionItem[],
});

/**
 * Thân trang `/s/[slug]` (client): đầu shop, số liệu, tab Shop | Sản phẩm | Danh mục như Mini App. Trang server chỉ truyền dữ liệu thuần
 * (và khối `intro` đã dựng) xuống đây vì hàm không đi qua ranh giới server/client. Gian hàng chưa có sản phẩm nào thì chỉ có đầu shop.
 */
export function StorefrontBody({ storefront: sf, badgeLabel, intro }: StorefrontBodyProps) {
  const [tab, setTab] = useState<ShopTabKey>('shop');
  const [scopeId, setScopeId] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const collections = useMemo(
    () => (sf.collections ?? []).map((c) => ({ ...c, kind: c.kind ?? 'NORMAL', layout: c.layout ?? 'GRID', items: (c.items ?? []).filter((it) => Boolean(it?.product)) })).filter((c) => c.items.length > 0),
    [sf.collections],
  );
  const plan = useMemo(() => planShopSections(collections), [collections]);
  const stats = useMemo(() => storefrontStatsInput(collections), [collections]);
  const allProducts = useMemo(() => uniqueShopProducts(collections), [collections]);
  const scope = scopeId ? collections.find((c) => c.id === scopeId) : undefined;
  const scoped = useMemo(
    () => (scope ? uniqueShopProducts([scope]) : allProducts).map((p) => ({ ...p, isFeatured: false })) as unknown as ProductCardData[],
    [scope, allProducts],
  );
  const tier = publicTier(sf.ownerTier);
  const tabs = shopTabs({ productCount: stats.productCount, hasCategories: collections.length > 1 }).map((t) => ({
    key: t.key,
    label: t.count === undefined ? t.label : `${t.label} (${t.count})`,
  }));

  const openTab = (key: string, scopeTo: string | null = null) => {
    setTab(key as ShopTabKey);
    setScopeId(scopeTo);
    // Thanh tab dính nên nội dung mới đổi dưới tay khách: kéo thanh tab lên đầu thay vì để trang ở giữa chừng.
    tabsRef.current?.scrollIntoView?.({ block: 'start' });
  };

  const tabBar =
    collections.length > 0 ? (
      <>
        {intro}
        <div
          ref={tabsRef}
          className="sticky z-[3] bg-[var(--color-bg-canvas)] px-4 pb-2 pt-3 md:static md:px-0 lg:max-w-md"
          style={{ top: STICKY_TOP, minHeight: TABS_HEIGHT }}
        >
          <SegmentedTabs items={tabs} value={tab} onChange={(k) => openTab(k)} />
        </div>
      </>
    ) : (
      intro
    );

  return (
    <>
      <ShopTopBar title={sf.title} />
      <StoreLayout
        header={
          <ShopHeader
            inStoreGrid
            title={sf.title}
            coverUrl={sf.coverUrl}
            avatarUrl={sf.avatarUrl}
            verified={Boolean(badgeLabel)}
            note={sf.headerNote}
            action={<StorefrontAction slug={sf.slug} title={sf.title} referralCode={sf.referralCode} />}
            badges={
              <>
                {sf.isSample && <Badge tone="promo">{SAMPLE_STOREFRONT_LABEL}</Badge>}
                {badgeLabel && (
                  <Badge tone="verified" icon={Sparkles}>
                    {badgeLabel}
                  </Badge>
                )}
                {tier && <TierBadge name={tier.name} emoji={tier.emoji} />}
              </>
            }
          />
        }
        stats={<ShopStatsRow stats={shopStats(stats)} />}
        intro={
          <>
            {sf.isSample && (
              <div className="px-4 pt-2 md:px-0">
                <Text variant="caption" tone="tertiary" as="div" data-testid="sample-note">{SAMPLE_STOREFRONT_NOTE}</Text>
              </div>
            )}
          </>
        }
        tabs={tabBar}
      >
        {collections.length > 0 && (
          <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label} style={{ ['--sort-bar-top' as string]: SORT_TOP }}>
            {tab === 'shop' && (
              <div className="px-4 md:px-0">
                {plan.main.map((col) => (
                  <ShopSection key={col.id} collection={asSection(col)} onSeeAll={() => openTab('products', col.id)} />
                ))}
              </div>
            )}
            {tab === 'products' && (
              <ShopProductsTab
                key={scopeId ?? 'all'}
                source={{ kind: 'local', products: scoped }}
                scope={scope ? { label: scope.title, onClear: () => setScopeId(null) } : undefined}
              />
            )}
            {tab === 'categories' && <ShopCategoriesTab collections={collections} onOpen={(id) => openTab('products', id)} />}
          </div>
        )}
      </StoreLayout>
    </>
  );
}
