import { useNavigate } from 'zmp-ui';
import { vi } from '../../i18n/vi';
import type { ProductCard } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { CatalogGrid, CatalogGridSkeleton } from '../catalog/catalog-grid';
import { Heading, Text } from '../ui/text';

export interface SectionQuery {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data?: { data: ProductCard[] };
}

export interface HomeSectionProps {
  title: string;
  query: SectionQuery;
  listSource: string;
  /** Số SP tối đa khối xin từ API (vd SECTION_LIMIT). Khung chờ vẽ ĐÚNG bằng chừng này ô để lúc dữ liệu về trang không nhảy (M2). */
  limit: number;
  /** Đích của nút "Xem tất cả" (vd `/browse?sort=best_seller`). Bỏ trống → không có nút (vd "Dành cho bạn", chỉ có ở Trang chủ). */
  seeAllTo?: string;
}

/**
 * Một khối lưới SP của Trang chủ. Đã tải mà rỗng → không vẽ gì (không để tiêu đề trống);
 * tải lỗi (không có dữ liệu) → cũng ẨN LẶNG LẼ vì không có SP nào để hiện (Trang chủ không đặt ErrorState ở vùng nhìn
 * thấy đầu tiên; kéo để làm mới là cách thử lại). Làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện dữ liệu cũ.
 * Hàng tiêu đề có chiều cao như nhau ở khung chờ và nội dung thật (nút "Xem tất cả" 44px có mặt cả hai trạng thái).
 */
export function HomeSection({ title, query, listSource, limit, seeAllTo }: HomeSectionProps) {
  const navigate = useNavigate();
  const items = query.data?.data ?? [];
  if (!query.isLoading && items.length === 0) return null;
  return (
    <section aria-label={title} style={{ padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: seeAllTo ? 0 : 8, minHeight: seeAllTo ? 44 : undefined }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
        {seeAllTo && (
          <button
            type="button"
            aria-label={vi.home.seeAllLabel(title)}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              navigate(seeAllTo);
            }}
            style={{
              flex: '0 0 auto',
              minHeight: 44,
              padding: '0 4px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Text variant="label" tone="brand">
              {vi.home.seeAll}
            </Text>
          </button>
        )}
      </div>
      {query.isLoading ? <CatalogGridSkeleton count={limit} /> : <CatalogGrid products={items} listSource={listSource} />}
    </section>
  );
}
