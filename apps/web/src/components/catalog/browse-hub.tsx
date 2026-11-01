'use client';

import { useQuery } from '@tanstack/react-query';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { hubBestSellers } from '@tubutree/app-core/browse/hub';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { bestSellersQuery } from '@tubutree/app-core/queries/browse';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { CategoryEntry } from '@/lib/browse-categories';
import { coreHttp } from '@/lib/core-http';
import { Button, ProductRail, Section, SectionHeader } from '@/components/mini';
import { BrandGrid, type HubBrand } from './brand-grid';
import { CategoryTiles } from './category-tiles';
import { RecentlyViewedRail } from './recently-viewed-rail';

export interface BrowseHubProps {
  entries: CategoryEntry[];
  categoriesLoading: boolean;
  placeholderCount?: number;
  brands: HubBrand[] | undefined;
  /** Kệ Bán chạy nhất do server tải sẵn (HTML đầu có sản phẩm cho crawler); thiếu thì tải phía trình duyệt. */
  initialBestSellers?: ProductCard[];
  onPickCategory: (entry: CategoryEntry) => void;
  onPickAll: () => void;
  onPickBrand: (brand: string) => void;
}

/**
 * Hub của Danh mục (gốc `/san-pham` chưa có từ khoá, bộ lọc hay `all=1`; nguồn: apps/miniapp/src/components/catalog/browse-hub.tsx): lối
 * vào theo danh mục, món đã xem, Bán chạy nhất, thương hiệu, rồi nút mở cả danh sách. KHÔNG tải danh sách sản phẩm; kệ Bán chạy nhất
 * lỗi hay dưới 3 món thì ẩn hẳn và hub vẫn đủ lối vào.
 */
export function BrowseHub({ entries, categoriesLoading, placeholderCount = 4, brands, initialBestSellers, onPickCategory, onPickAll, onPickBrand }: BrowseHubProps) {
  const max = shelf('browse.bestSellers').maxItems;
  const q = useQuery({
    ...bestSellersQuery(coreHttp, max),
    staleTime: 60_000,
    retry: false,
    ...(initialBestSellers ? { initialData: initialBestSellers } : {}),
  });
  const items = hubBestSellers(q.data);
  const showBestSellers = q.isLoading || items.length > 0;
  const title = fillCopy('rank.title');
  // Hub không lọc theo danh mục, nên trang đích là bảng xếp hạng chung (cùng thước đo 30 ngày với kệ).
  const seeAll = seeAllHref('browse.bestSellers', 'web');
  return (
    <div>
      <CategoryTiles entries={entries} isLoading={categoriesLoading} placeholderCount={placeholderCount} onSelect={onPickCategory} onSelectAll={onPickAll} />
      <RecentlyViewedRail />
      {showBestSellers && (
        <Section id="browse-best-sellers" label={title}>
          <SectionHeader title={title} action={seeAll ? { to: seeAll } : undefined} />
          <ProductRail items={items} variant="rank" rankFrom={1} label={title} loading={q.isLoading} skeletonCount={max} />
        </Section>
      )}
      <BrandGrid brands={brands} onSelect={onPickBrand} />
      <Section id="browse-see-all">
        <div style={{ paddingBottom: 16 }}>
          <Button variant="secondary" fullWidth onPress={onPickAll}>
            {fillCopy('browse.seeAllProducts')}
          </Button>
        </div>
      </Section>
    </div>
  );
}
