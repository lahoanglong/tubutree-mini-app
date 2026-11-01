'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Leaf, MapPin } from 'lucide-react';
import { brandStatsInput, followerStat, promotionVoucher, shopTabs, type ShopTabKey } from '@tubutree/app-core/commerce/shop-page';
import { shopStats } from '@tubutree/app-core/commerce/shop-stats';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { BrandActions, BrandDealerBlock } from '@/app/brand/[slug]/brand-actions';
import type { BrandDetail, ProductCard as ProductCardData } from '@/lib/api';
import { copyText } from '@/lib/copy-text';
import { StoreLayout } from '@/components/layouts/store-layout';
import { Badge } from '@/components/mini/badge';
import { EmptyState } from '@/components/mini/empty-state';
import { Icon } from '@/components/mini/icon';
import { ProductRail } from '@/components/mini/product-rail';
import { ScrollRow } from '@/components/mini/scroll-row';
import { SectionHeader } from '@/components/mini/section-header';
import { SegmentedTabs } from '@/components/mini/segmented-tabs';
import { ShopHeader } from '@/components/mini/shop-header';
import { ShopStatsRow } from '@/components/mini/shop-stats-row';
import { ShopTopBar } from '@/components/mini/shop-top-bar';
import { Text } from '@/components/mini/text';
import { VoucherTicket } from '@/components/mini/voucher-ticket';
import { ShopProductsTab } from './shop-products-tab';

export interface BrandBodyProps {
  brand: BrandDetail;
  /** Id điểm trên bản đồ câu chuyện (do trang server tra theo slug và tên); null khi thương hiệu chưa có ghim. */
  mapOriginId: string | null;
}

/** Số sản phẩm nổi bật trên tab Shop (kệ ngang); phần còn lại ở tab Sản phẩm. */
const FEATURED_MAX = 10;
const STICKY_TOP = 'calc(var(--safe-top, 0px) + 56px)';
const TABS_HEIGHT = 62;
const SORT_TOP = `calc(var(--safe-top, 0px) + 56px + ${TABS_HEIGHT - 12}px)`;
const LINK_BTN = 'inline-flex min-h-11 flex-none items-center justify-center rounded-control bg-[var(--color-action-secondary-bg)] px-4 text-sm font-semibold text-[color:var(--color-action-secondary-fg)]';

/**
 * Thân trang `/brand/[slug]` (client): đầu shop có Theo dõi và Chia sẻ, số liệu (kèm người theo dõi), tab Shop | Sản phẩm | Câu chuyện
 * như Mini App. Sản phẩm phân trang thật qua API (trang server chỉ nhận 30 món đầu).
 */
export function BrandBody({ brand: b, mapOriginId }: BrandBodyProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ShopTabKey>('shop');
  const [promoNote, setPromoNote] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const hasStory = Boolean(b.story || b.origin || b.storyImages.length > 0);
  const productCount = b.productCount ?? b.products.length;
  const featured = useMemo(() => b.products.slice(0, FEATURED_MAX).map((p) => ({ ...p, brand: b.name, isFeatured: false })) as unknown as ProductCardData[], [b]);
  const tabs = shopTabs({ productCount, hasStory, hasCategories: false }).map((t) => ({
    key: t.key,
    label: t.count === undefined ? t.label : `${t.label} (${t.count})`,
  }));
  const openTab = (key: string) => {
    setTab(key as ShopTabKey);
    // Thanh tab dính nên nội dung mới đổi dưới tay khách: kéo thanh tab lên đầu thay vì để trang ở giữa chừng.
    tabsRef.current?.scrollIntoView?.({ block: 'start' });
  };
  const copyPromoCode = (code: string) =>
    void copyText(code).then((ok) => setPromoNote(ok ? `Đã chép mã ${code} — dán ở bước thanh toán` : `Mã giảm giá: ${code}`));
  const now = serverNow();

  return (
    <>
      <ShopTopBar title={b.name} />
      <BrandActions slug={b.slug} name={b.name} followerCount={b.followerCount}>
        {(a) => (
          <StoreLayout
            header={
              <ShopHeader
                inStoreGrid
                title={b.name}
                coverUrl={b.coverUrl}
                avatarUrl={b.logoUrl}
                verified={b.isVerified}
                note={b.tagline}
                badges={
                  b.isVerified ? (
                    <Badge tone="verified" icon={Check}>
                      Chính hãng
                    </Badge>
                  ) : undefined
                }
                action={a.buttons}
              />
            }
            stats={<ShopStatsRow stats={[...shopStats(brandStatsInput({ ...b, productCount })), ...[followerStat(a.followerCount)].filter((x) => x !== null)]} />}
            intro={
              <>
                {a.note}
                {a.banner}
              </>
            }
            tabs={
              <div
                ref={tabsRef}
                className="sticky z-[3] bg-[var(--color-bg-canvas)] px-4 pb-2 pt-3 md:static md:px-0 lg:max-w-md"
                style={{ top: STICKY_TOP, minHeight: TABS_HEIGHT }}
              >
                <SegmentedTabs items={tabs} value={tab} onChange={openTab} />
              </div>
            }
          >
            <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label} style={{ ['--sort-bar-top' as string]: SORT_TOP }}>
              {tab === 'shop' && (
                <div className="px-4 md:px-0">
                  {b.certifications.length > 0 && (
                    <div className="mt-1">
                      <SectionHeader title="Chứng nhận" />
                      <ScrollRow label="Chứng nhận" style={{ gap: 8, minWidth: 0, maxWidth: '100%' }}>
                        {b.certifications.map((c) => (
                          <Badge key={c.code} tone="success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Icon icon={Leaf} size="sm" tone="brand" />
                            {c.label}
                          </Badge>
                        ))}
                      </ScrollRow>
                    </div>
                  )}

                  {b.promotions.length > 0 && (
                    <div className="mt-4" data-testid="brand-vouchers">
                      <SectionHeader title={fillCopy('shop.vouchers')} icon="ticket" />
                      {/* Phiếu chip chỉ có tiêu đề và điều kiện; mã nằm sau nút Sao chép (dán ở bước thanh toán). */}
                      <ScrollRow label={fillCopy('shop.vouchers')} style={{ gap: 8, minWidth: 0, maxWidth: '100%' }}>
                        {b.promotions.map((p) => (
                          <VoucherTicket
                            key={p.id}
                            voucher={promotionVoucher(p, now)}
                            variant="chip"
                            primary={p.couponCode ? { label: 'Sao chép', onClick: () => copyPromoCode(p.couponCode!) } : undefined}
                          />
                        ))}
                      </ScrollRow>
                      {promoNote && (
                        <p role="status" className="mt-1 text-sm text-success-fg">
                          {promoNote}
                        </p>
                      )}
                    </div>
                  )}

                  {hasStory && b.story && (
                    <div className="mt-4">
                      <SectionHeader title="Câu chuyện thương hiệu" />
                      <Text variant="body-sm" tone="secondary" as="p" data-testid="brand-story-teaser" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {b.story}
                      </Text>
                      <button
                        type="button"
                        onClick={() => openTab('story')}
                        className="tubu-press tubu-hit-44 inline-flex items-center gap-0.5 text-[length:var(--type-label-size)] font-semibold text-[color:var(--color-text-brand)]"
                      >
                        {fillCopy('shop.readStory')}
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}

                  {featured.length > 0 && (
                    <div className="mt-4" data-testid="brand-featured">
                      <SectionHeader
                        title="Sản phẩm nổi bật"
                        action={
                          productCount > featured.length
                            ? {
                                label: fillCopy('shop.seeAllN', { n: productCount }),
                                onPress: () => openTab('products'),
                                spoken: fillCopy('shop.seeAllNSpoken', { n: productCount, title: 'Sản phẩm nổi bật' }),
                              }
                            : undefined
                        }
                      />
                      <ProductRail items={featured} variant="rail-md" label="Sản phẩm nổi bật" showBrand={false} />
                    </div>
                  )}

                  {featured.length === 0 && productCount === 0 && (
                    <EmptyState art="basket" heading={fillCopy('shop.emptyProducts')} ctaLabel="Xem sản phẩm trên Tubu Tree" onCta={() => router.push('/')} />
                  )}

                  <BrandDealerBlock rewards={b.dealerRewards} />
                </div>
              )}

              {tab === 'products' && <ShopProductsTab source={{ kind: 'brand', slug: b.slug }} showBrand={false} />}

              {tab === 'story' && hasStory && (
                <div className="px-4 md:px-0">
                  <SectionHeader title="Câu chuyện thương hiệu" />
                  {b.origin && (
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <MapPin className="h-4 w-4 flex-none text-[color:var(--color-text-brand)]" aria-hidden="true" />
                        <Text variant="body-sm" as="span">Xuất xứ: {b.origin}</Text>
                      </span>
                      {mapOriginId && (
                        <Link href={`/cau-chuyen?brand=${mapOriginId}`} className={LINK_BTN}>
                          Xem trên bản đồ
                        </Link>
                      )}
                    </div>
                  )}
                  {b.story && <Text variant="body-sm" tone="secondary" as="div" style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{b.story}</Text>}
                  {b.storyImages.length > 0 && (
                    <ScrollRow label="Ảnh câu chuyện thương hiệu" style={{ gap: 8, marginTop: 12, minWidth: 0, maxWidth: '100%' }}>
                      {b.storyImages.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={`${i}:${src}`} src={src} alt={`${b.name}, ảnh ${i + 1}`} loading="lazy" className="h-40 w-60 flex-none rounded-card bg-[var(--color-bg-subtle)] object-cover" />
                      ))}
                    </ScrollRow>
                  )}
                </div>
              )}
            </div>
          </StoreLayout>
        )}
      </BrandActions>
    </>
  );
}
