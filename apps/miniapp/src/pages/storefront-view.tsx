import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Page, useParams, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Share2, Sparkles } from 'lucide-react';
import { publicTier, planShopSections, shopTabs, storefrontStatsInput, uniqueShopProducts, type ShopTabKey } from '@tubutree/app-core/commerce/shop-page';
import { shopStats } from '@tubutree/app-core/commerce/shop-stats';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { SAMPLE_STOREFRONT_LABEL, SAMPLE_STOREFRONT_NOTE, sampleShareText } from '@tubutree/app-core/storefront-signup';
import { getPublicStorefront, type Storefront } from '../services/storefront-api';
import { apiMediaUrl, getLoadErrorMessage, isNotFoundError } from '../services/api';
import { vi } from '../i18n/vi';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { SuggestedRail } from '../components/catalog/suggested-rail';
import { useStorefrontContext } from '../store/storefront-context';
import { useAuthStore } from '../store/auth';
import { ShareSheet } from '../components/share-sheet';
import { TierBadge } from '../components/ui/tier-badge';
import { Text } from '../components/ui/text';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { ShopHeader } from '../components/ui/shop-header';
import { ShopSection } from '../components/ui/shop-section';
import { ShopStatsRow } from '../components/ui/shop-stats-row';
import { ShopTopBar } from '../components/ui/shop-top-bar';
import { ShopCategoriesTab } from '../components/shop-page/shop-categories-tab';
import { ShopProductsTab } from '../components/shop-page/shop-products-tab';

/** Nhãn tin cậy chỉ cho gian hàng admin đã duyệt: tick và "CTV tuyển chọn" là lời cam kết của Tubu Tree, không phải của chủ shop tự gắn. */
function trustBadgeLabel(sf: { type: 'CTV' | 'BRAND' | 'MERCHANT'; approved?: boolean }): string | null {
  if (!sf.approved) return null;
  if (sf.type === 'MERCHANT') return vi.storefront.badgePartner;
  if (sf.type === 'BRAND') return vi.storefront.badgeBrand;
  return vi.storefront.badgeSelectedCtv;
}

export default function StorefrontViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['public-storefront', slug], queryFn: () => getPublicStorefront(slug), staleTime: 60_000 });
  const setSfContext = useStorefrontContext((s) => s.setContext);

  const sf = q.data;
  useEffect(() => {
    if (!sf) return;
    // Chỉ gian hàng CTV có mã giới thiệu và được ghi công; gian hàng đối tác/nhãn hàng giữ nguyên mã CTV khách đang có.
    setSfContext(
      sf.type === 'CTV'
        ? { slug: sf.slug, referralCode: sf.referralCode ?? null, kind: 'ctv', referralEligible: true }
        : { slug: sf.slug, kind: 'partner' },
    );
  }, [sf, setSfContext]);

  if (q.isLoading) return <Page className="page"><Box p={4}><Skeleton style={{ height: 180, borderRadius: 16 }} /></Box></Page>;
  if (!sf) {
    // Link CTV hỏng/gian hàng đã đóng: thử lại không khác đi, nên chỉ đường về và gợi ý sản phẩm thay vì ngõ cụt.
    const gone = isNotFoundError(q.error);
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.storefront.publicTitle} />
        {gone ? (
          <ErrorState message={vi.storefront.notFound} onRetry={() => undefined} onHome={() => navigate('/')} />
        ) : (
          <ErrorState message={getLoadErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
        {gone && <SuggestedRail listSource="storefront_not_found" />}
      </Page>
    );
  }

  return <StorefrontShop sf={sf} />;
}

/**
 * Cao thanh nút lùi cố định (56): dải tab và thanh sắp xếp dính ngay dưới nó. `top` của phần tử dính đo từ mép NỘI DUNG của `.zaui-page`, mà trang
 * `page-bleed` đã đệm đầu đúng vùng an toàn, nên KHÔNG cộng `--safe-top` nữa (cộng thì trên máy có tai thỏ dải tab hở đúng một vùng an toàn dưới thanh).
 */
const STICKY_TOP = '56px';
/** Đo ở 375px: đệm 12 + dải tab 50 + đệm 8 = 70. Thanh sắp xếp chui dưới 8px đệm đáy (khoảng trống) cho khỏi hở một sợi khi chữ đổi cỡ, không chui vào phần chữ. */
const TABS_HEIGHT = 70;
const TABS_PAD_BOTTOM = 8;

function StorefrontShop({ sf }: { sf: Storefront }) {
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(false);
  const [tab, setTab] = useState<ShopTabKey>('shop');
  const [scopeId, setScopeId] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const myReferralCode = useAuthStore((s) => s.user?.referralCode);

  // Chỉ gian hàng CTV có mã giới thiệu để nhận ra chủ; chủ gian hàng đối tác chia sẻ từ trình dựng.
  const isOwner = Boolean(myReferralCode && sf.referralCode && myReferralCode.toUpperCase() === sf.referralCode.toUpperCase());
  const collections = useMemo(
    () => sf.collections.map((col) => ({ ...col, items: col.items.filter((it) => Boolean(it?.product)) })).filter((col) => col.items.length > 0),
    [sf.collections],
  );
  const plan = useMemo(() => planShopSections(collections), [collections]);
  const stats = useMemo(() => storefrontStatsInput(collections), [collections]);
  const allProducts = useMemo(() => uniqueShopProducts(collections), [collections]);
  const scope = scopeId ? collections.find((c) => c.id === scopeId) : undefined;
  const scopedProducts = useMemo(
    () => (scope ? uniqueShopProducts([scope]) : allProducts).map((p) => ({ ...p, isFeatured: false })),
    [scope, allProducts],
  );
  const badgeLabel = trustBadgeLabel(sf);
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

  return (
    <Page className="page page-bleed" style={{ background: 'var(--color-bg-canvas)' }}>
      <ShopTopBar title={sf.title} />
      <ShopHeader
        title={sf.title}
        coverUrl={sf.coverUrl ? apiMediaUrl(sf.coverUrl) : null}
        avatarUrl={sf.avatarUrl ? apiMediaUrl(sf.avatarUrl) : null}
        verified={Boolean(badgeLabel)}
        note={sf.headerNote}
        action={
          isOwner ? (
            <Button variant="secondary" icon={Share2} aria-label={vi.storefront.shareStore} onPress={() => setShareOpen(true)}>
              {fillCopy('shop.share')}
            </Button>
          ) : undefined
        }
        badges={
          <>
            {sf.isSample && <Badge tone="promo">{SAMPLE_STOREFRONT_LABEL}</Badge>}
            {badgeLabel && (
              <Badge tone="verified" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={12} />
                {badgeLabel}
              </Badge>
            )}
            {tier && <TierBadge name={tier.name} emoji={tier.emoji} />}
          </>
        }
      />
      <ShopStatsRow stats={shopStats(stats)} />
      {sf.isSample && (
        <Box px={4} mt={2}>
          <Text variant="caption" tone="tertiary" as="div" data-testid="sample-note">{SAMPLE_STOREFRONT_NOTE}</Text>
        </Box>
      )}

      {collections.length === 0 ? (
        <EmptyState
          art="basket"
          heading={vi.storefront.emptyHeading}
          body={isOwner ? vi.storefront.emptyOwnerBody : vi.storefront.emptyBody}
          ctaLabel={isOwner ? vi.storefront.addProduct : vi.storefront.viewProducts}
          onCta={() => navigate(isOwner ? '/storefront' : '/browse')}
        />
      ) : (
        <>
          <div ref={tabsRef} style={{ position: 'sticky', top: STICKY_TOP, zIndex: 3, background: 'var(--color-bg-canvas)', padding: `12px 16px ${TABS_PAD_BOTTOM}px`, minHeight: TABS_HEIGHT }}>
            <SegmentedTabs items={tabs} value={tab} onChange={(k) => openTab(k)} />
          </div>

          <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label} style={{ ['--sort-bar-top' as string]: `${56 + TABS_HEIGHT - TABS_PAD_BOTTOM}px` }}>
            {tab === 'shop' && (
              <div style={{ padding: '0 16px' }}>
                {plan.main.map((col) => (
                  <ShopSection key={col.id} collection={col} onSeeAll={() => openTab('products', col.id)} />
                ))}
              </div>
            )}
            {tab === 'products' && (
              <ShopProductsTab
                key={scopeId ?? 'all'}
                source={{ kind: 'local', products: scopedProducts }}
                scope={scope ? { label: scope.title, onClear: () => setScopeId(null) } : undefined}
              />
            )}
            {tab === 'categories' && <ShopCategoriesTab collections={collections} onOpen={(id) => openTab('products', id)} />}
          </div>
        </>
      )}

      {!isOwner && sf.type === 'CTV' && (
        <Box mt={6} px={4} style={{ textAlign: 'center' }}>
          <button
            type="button"
            className="tubu-press tubu-hit-44"
            onClick={() => navigate('/storefront')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-secondary)' }}
          >
            {fillCopy('shop.learnStore')}
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Box>
      )}
      {/* Không có nút dính đáy kéo khách rời gian hàng: lối sang danh mục chung chỉ là link phụ ở cuối trang. */}
      {!isOwner && collections.length > 0 && (
        <Box mt={2} px={4} style={{ textAlign: 'center' }}>
          <Button variant="ghost" onPress={() => navigate('/browse')}>{vi.storefront.moreAtTubu}</Button>
        </Box>
      )}

      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={sf.slug}
        title={sampleShareText(sf.title, sf.isSample)}
        referralCode={sf.referralCode ?? null}
        thumbnail={sf.collections[0]?.items[0]?.product.thumbnail ?? undefined}
      />
    </Page>
  );
}
