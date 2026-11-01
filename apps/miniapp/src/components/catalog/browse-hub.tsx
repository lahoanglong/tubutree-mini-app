import { useQuery } from '@tanstack/react-query';
import { hubBestSellers } from '@tubutree/app-core/browse/hub';
import { bestSellersQuery } from '@tubutree/app-core/queries/browse';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { CategoryEntry } from '../../hooks/use-categories';
import { coreHttp } from '../../services/core-http';
import { Button } from '../ui/button';
import { ProductRail } from '../ui/product-rail';
import { Section } from '../ui/section';
import { SectionHeader } from '../ui/section-header';
import { BrandGrid, type HubBrand } from './brand-grid';
import { CategoryTiles } from './category-tiles';
import { RecentlyViewedRail } from './recently-viewed-rail';

/** Chưa có trang /best-sellers: "Xem tất cả" mở danh sách xếp theo bán chạy (đi qua `navigate`, nên Back về hub). */
export const BEST_SELLERS_LIST_ROUTE = '/browse?sort=best_seller';

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
 * thương hiệu, rồi nút mở cả danh sách. KHÔNG tải danh sách sản phẩm; kệ Bán chạy nhất lỗi hay dưới 3 món thì ẩn hẳn và hub vẫn đủ lối vào.
 */
export function BrowseHub({ entries, categoriesLoading, placeholderCount, brands, onPickCategory, onPickAll, onPickBrand }: BrowseHubProps) {
  const q = useQuery({ ...bestSellersQuery(coreHttp, shelf('browse.bestSellers').maxItems), staleTime: 60_000, retry: false });
  const items = hubBestSellers(q.data);
  const showBestSellers = q.isLoading || items.length > 0;
  const title = fillCopy('rank.title');
  return (
    <div>
      <CategoryTiles entries={entries} isLoading={categoriesLoading} placeholderCount={placeholderCount} onSelect={onPickCategory} onSelectAll={onPickAll} />
      <RecentlyViewedRail />
      {showBestSellers && (
        <Section id="browse-best-sellers">
          <div style={{ padding: '0 16px' }}>
            <SectionHeader title={title} action={{ to: BEST_SELLERS_LIST_ROUTE }} />
          </div>
          <ProductRail
            items={items}
            variant="rank"
            rankFrom={1}
            label={title}
            listSource="browse_best_seller"
            loading={q.isLoading}
            skeletonCount={shelf('browse.bestSellers').maxItems}
          />
        </Section>
      )}
      <BrandGrid brands={brands} onSelect={onPickBrand} />
      <Section id="browse-see-all">
        <div style={{ padding: '0 16px 16px' }}>
          <Button variant="secondary" fullWidth onPress={onPickAll}>
            {fillCopy('browse.seeAllProducts')}
          </Button>
        </div>
      </Section>
    </div>
  );
}
