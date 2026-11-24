'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import type { BestSellersPage } from '@tubutree/app-core/api/browse';
import { bestSellersHeading, bestSellersPageRanks, curatedShelfItems } from '@tubutree/app-core/browse/best-sellers';
import { hubBestSellers } from '@tubutree/app-core/browse/hub';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { bestSellersQuery } from '@tubutree/app-core/queries/browse';
import { refillFirstOn } from '@tubutree/app-core/refill/refill-api';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { CategoryEntry } from '@/lib/browse-categories';
import type { RefillEntryLink } from '@/components/refill/refill-landing-link';
import { coreHttp } from '@/lib/core-http';
import { Button, Card, Icon, ListRow, ProductRail, Section, SectionHeader } from '@/components/mini';
import { usePublicConfig } from '@/lib/use-public-config';
import { BrandGrid, type HubBrand } from './brand-grid';
import { CategoryTiles } from './category-tiles';
import { RecentlyViewedRail } from './recently-viewed-rail';

// Ngoài JS lần đầu của /san-pham (ngân sách web-budget): lối vào chỉ hiện sau khi trang Refill tải xong và chỉ khi cờ bật.
const RefillLandingEntry = dynamic(
  () => import('@/components/refill/refill-landing-entry').then((m) => m.RefillLandingEntry, () => NoRefillLandingEntry),
  { ssr: false },
);
function NoRefillLandingEntry() {
  return null;
}

/** Hàng lối vào ở hub điện thoại (cùng dáng `RefillLandingEntry`), vẽ ngay ở máy chủ. */
function RefillEntryRow({ entry }: { entry: RefillEntryLink }) {
  return (
    <Link href={entry.href} data-testid="refill-landing-entry" className="tubu-press block rounded-card">
      <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
        <ListRow
          icon={<Icon icon={Droplets} size="md" tone="brand" />}
          title={entry.title}
          subtitle={entry.sub}
          trailing="chevron"
          style={{ padding: 'var(--space-inset-card)' }}
        />
      </Card>
    </Link>
  );
}

export interface BrowseHubProps {
  entries: CategoryEntry[];
  categoriesLoading: boolean;
  placeholderCount?: number;
  brands: HubBrand[] | undefined;
  /** Kệ Bán chạy nhất do server tải sẵn (HTML đầu có sản phẩm cho crawler); thiếu thì tải phía trình duyệt. */
  initialBestSellers?: BestSellersPage;
  /**
   * Có: máy chủ thấy trang Refill có gói bán được, vẽ hàng lối vào ngay trong HTML. `null`: máy chủ đã hỏi và trang trống hoặc cờ tắt, không vẽ.
   * Thiếu (máy chủ không hỏi được): tải lười phía trình duyệt như trước.
   */
  refillEntry?: RefillEntryLink | null;
  onPickCategory: (entry: CategoryEntry) => void;
  onPickAll: () => void;
  onPickBrand: (brand: string) => void;
}

/**
 * Hub của Danh mục (gốc `/san-pham` chưa có từ khoá, bộ lọc hay `all=1`; nguồn: apps/miniapp/src/components/catalog/browse-hub.tsx): lối
 * vào theo danh mục, món đã xem, Bán chạy nhất, thương hiệu, lối vào Tiết kiệm với Refill (khi có gói), rồi nút mở cả danh sách. KHÔNG tải danh sách sản phẩm; kệ Bán chạy nhất
 * lỗi hay dưới 3 món thì ẩn hẳn và hub vẫn đủ lối vào.
 */
export function BrowseHub({ entries, categoriesLoading, placeholderCount = 4, brands, initialBestSellers, refillEntry, onPickCategory, onPickAll, onPickBrand }: BrowseHubProps) {
  const max = shelf('browse.bestSellers').maxItems;
  const refillOn = refillFirstOn(usePublicConfig());
  const q = useQuery({
    ...bestSellersQuery(coreHttp, max),
    staleTime: 60_000,
    retry: false,
    ...(initialBestSellers ? { initialData: initialBestSellers } : {}),
  });
  const ranked = hubBestSellers(q.data?.data);
  // Chưa đủ số bán mà admin đã ghim kệ: "Tubu chọn cho bạn", chỉ món ghim, không số hạng (xem `bestSellersHeading`).
  const heading = bestSellersHeading(ranked);
  const items = curatedShelfItems(ranked, shelf('browse.bestSellers').minItems);
  const showBestSellers = q.isLoading || items.length > 0;
  const title = heading.title;
  // Hub không lọc theo danh mục, nên trang đích là bảng xếp hạng chung (cùng thước đo 30 ngày với kệ).
  const seeAll = seeAllHref('browse.bestSellers', 'web');
  return (
    <div>
      <CategoryTiles entries={entries} isLoading={categoriesLoading} placeholderCount={placeholderCount} onSelect={onPickCategory} onSelectAll={onPickAll} />
      <RecentlyViewedRail reserve priorityCount={2} />
      {showBestSellers && (
        <Section id="browse-best-sellers" label={title}>
          <SectionHeader title={title} action={seeAll ? { to: seeAll } : undefined} />
          <ProductRail items={items} variant="rank" ranks={heading.ranked ? bestSellersPageRanks(items, q.data?.pinnedIds) : undefined} label={title} loading={q.isLoading} skeletonCount={max} priorityCount={2} shelf="browseHub" />
        </Section>
      )}
      <BrandGrid brands={brands} onSelect={onPickBrand} />
      <Section id="browse-see-all">
        <div style={{ paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
          <Button variant="secondary" fullWidth onPress={onPickAll}>
            {fillCopy('browse.seeAllProducts')}
          </Button>
          {/* Dưới nút: lối vào hiện muộn (tải lười + chờ API) không được đẩy nút khách đang định chạm. */}
          {refillEntry ? <RefillEntryRow entry={refillEntry} /> : refillEntry === undefined && refillOn && <RefillLandingEntry />}
        </div>
      </Section>
    </div>
  );
}
