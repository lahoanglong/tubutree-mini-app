import { useQuery } from '@tanstack/react-query';
import { bestSellersHeading, curatedShelfItems } from '@tubutree/app-core/browse/best-sellers';
import { hubBestSellers } from '@tubutree/app-core/browse/hub';
import { seeAllHref } from '@tubutree/app-core/merch/home-shelves';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { CategoryEntry } from '../../hooks/use-categories';
import { homeBestSellerQuery } from '../home/home-best-seller-query';
import { Button } from '../ui/button';
import { ProductRail } from '../ui/product-rail';
import { Section } from '../ui/section';
import { SectionHeader } from '../ui/section-header';
import { RefillLandingEntry } from '../refill/refill-landing-entry';
import { BrandGrid, type HubBrand } from './brand-grid';
import { CategoryTiles } from './category-tiles';
import { RecentlyViewedRail } from './recently-viewed-rail';

export interface BrowseHubProps {
  entries: CategoryEntry[];
  categoriesLoading: boolean;
  placeholderCount: number;
  brands: HubBrand[] | undefined;
  onPickCategory: (entry: CategoryEntry) => void;
  onPickAll: () => void;
  onPickBrand: (brand: string) => void;
}

/**
 * Hub của Danh mục (gốc `/browse` khi chưa có từ khoá, bộ lọc hay `all=1`): lối vào theo danh mục, món đã xem, Bán chạy nhất,
 * thương hiệu, lối vào Tiết kiệm với Refill (khi có gói), rồi nút mở cả danh sách. KHÔNG tải danh sách sản phẩm; kệ Bán chạy nhất lỗi hay dưới 3 món thì ẩn hẳn và hub vẫn đủ lối vào.
 */
export function BrowseHub({ entries, categoriesLoading, placeholderCount, brands, onPickCategory, onPickAll, onPickBrand }: BrowseHubProps) {
  // Cùng khoá với kệ Trang chủ: vào Danh mục sau Trang chủ dùng lại dữ liệu đã tải; `hubBestSellers` tự cắt còn maxItems của kệ.
  const q = useQuery({ ...homeBestSellerQuery, select: (page) => page.data, staleTime: 60_000, retry: false });
  const ranked = hubBestSellers(q.data);
  // Chưa đủ số bán mà admin đã ghim kệ: "Tubu chọn cho bạn", chỉ món ghim, không số hạng (xem `bestSellersHeading`).
  const heading = bestSellersHeading(ranked);
  const items = curatedShelfItems(ranked, shelf('browse.bestSellers').minItems);
  const showBestSellers = q.isLoading || items.length > 0;
  const title = heading.title;
  // Hub không lọc theo danh mục, nên trang đích là bảng xếp hạng chung (cùng thước đo 30 ngày với kệ).
  const seeAll = seeAllHref('browse.bestSellers');
  return (
    <div>
      <CategoryTiles entries={entries} isLoading={categoriesLoading} placeholderCount={placeholderCount} onSelect={onPickCategory} onSelectAll={onPickAll} />
      <RecentlyViewedRail />
      {showBestSellers && (
        <Section id="browse-best-sellers">
          <div style={{ padding: '0 16px' }}>
            <SectionHeader title={title} action={seeAll ? { to: seeAll } : undefined} />
          </div>
          <ProductRail
            items={items}
            variant="rank"
            rankFrom={heading.ranked ? 1 : undefined}
            label={title}
            listSource="browse_best_seller"
            loading={q.isLoading}
            skeletonCount={shelf('browse.bestSellers').maxItems}
          />
        </Section>
      )}
      <BrandGrid brands={brands} onSelect={onPickBrand} />
      <Section id="browse-see-all">
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
          <RefillLandingEntry />
          <Button variant="secondary" fullWidth onPress={onPickAll}>
            {fillCopy('browse.seeAllProducts')}
          </Button>
        </div>
      </Section>
    </div>
  );
}
