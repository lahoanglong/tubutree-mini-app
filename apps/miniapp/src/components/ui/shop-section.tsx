import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { collectionView } from '@tubutree/app-core/commerce/collection-view';
import { productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { comboTotals } from '@tubutree/app-core/commerce/shop-page';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useNotify } from '../../hooks/use-notify';
import { addAllToCart } from '../../services/cart-batch';
import { getErrorMessage, isBusinessMessage } from '../../services/api';
import { isHttpError } from '../../services/http';
import { serverNow } from '../../utils/server-clock';
import { haptic } from '../../utils/haptic';
import { ComboCard } from './combo-card';
import { ProductGrid } from './product-grid';
import { ProductRail } from './product-rail';
import { Section } from './section';
import { SectionHeader } from './section-header';

/** Món trong bộ sưu tập của gian hàng; `variationId` là phân loại CTV ghim cho món, chưa lọc tồn kho; thẻ chỉ đổi sang nó (`pinnedVariationId`) khi còn hàng. */
export interface ShopSectionItem {
  id: string;
  note?: string | null;
  variationId?: string | null;
  product: Omit<ProductCardData, 'isFeatured'> & { isFeatured?: boolean };
}

export interface ShopSectionProps {
  collection: { id: string; title: string; kind: string; layout: string; comboDiscountPct?: number | null; items: ShopSectionItem[] };
  /** Thương hiệu truyền false: mọi thẻ cùng một thương hiệu nên bỏ dòng tên. */
  showBrand?: boolean;
  /** Có thì khối bị cắt hiện "Tất cả (n)" (chuyển sang tab Sản phẩm); không có thì không nút. */
  onSeeAll?: () => void;
  /** Xem trước ở màn dựng gian hàng: "Thêm cả combo" không ghi giỏ. */
  preview?: boolean;
}

const asCard = (it: ShopSectionItem): ProductCardData => ({ ...it.product, isFeatured: it.product.isFeatured ?? false });
const priceOf = (it: ShopSectionItem) => it.product.salePrice ?? it.product.basePrice;
/**
 * Phân loại gửi lên giỏ là đúng phân loại thẻ đang báo giá và còn hàng: ghim còn hàng, không thì đại diện. `it.variationId` là phân loại
 * CTV ghim chưa lọc tồn kho (API chỉ đổi thành `pinnedVariationId` khi còn hàng), nên chỉ là đường lui khi món không có dữ liệu phân loại;
 * dùng nó trước sẽ gửi phân loại hết hàng và máy chủ từ chối cả combo ở mọi lần bấm.
 */
const variationOf = (it: ShopSectionItem) => it.product.pinnedVariationId ?? it.product.repVariationId ?? it.variationId;

/** Lỗi 4xx có lời nghiệp vụ ("Sản phẩm X đã hết hàng") thì đọc thẳng; còn lại câu cố định, vì lời "quá thời gian" chung chung sai nghĩa với lệnh tất cả-hoặc-không. */
function comboErrorText(error: unknown): string {
  if (isHttpError(error) && error.response && error.response.status < 500) {
    const message = getErrorMessage(error);
    if (isBusinessMessage(message)) return message;
  }
  return fillCopy('shop.comboError');
}

function ComboSection({ collection, pct, preview }: { collection: ShopSectionProps['collection']; pct: number; preview: boolean }) {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const inflight = useRef(false);
  const items = collection.items;
  const mutation = useMutation({
    mutationFn: (lines: { variationId: string; quantity: number }[]) => addAllToCart(lines),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      haptic('medium');
      notify({ type: 'success', text: fillCopy('shop.comboAdded') });
    },
    onError: (error) => notify({ type: 'error', text: comboErrorText(error) }),
    onSettled: () => {
      inflight.current = false;
    },
  });

  const now = serverNow();
  const views = items.map((it) => productCardView({ product: asCard(it), flash: null, variant: 'line', now, showBrand: false }));
  const { total, comboTotal } = comboTotals(items.map(priceOf), pct);

  const onAddAll = () => {
    if (preview || inflight.current) return;
    const lines = items.map((it) => ({ variationId: variationOf(it), quantity: 1 }));
    if (lines.some((l) => !l.variationId)) {
      notify({ type: 'error', text: fillCopy('shop.comboError') });
      return;
    }
    inflight.current = true;
    mutation.mutate(lines as { variationId: string; quantity: number }[]);
  };

  return (
    <Section id={`shop-col-${collection.id}`} label={collection.title}>
      <div data-testid="shop-combo">
        <ComboCard title={collection.title} items={views} pct={pct} total={total} comboTotal={comboTotal} onAddAll={onAddAll} busy={mutation.isPending} />
      </div>
    </Section>
  );
}

/**
 * Một khối của trang shop, vẽ theo `layout` của bộ sưu tập (trước đây mọi bộ thành lưới hiện hết món): CAROUSEL kệ ngang, GRID lưới
 * 2 cột, STACK hàng dòng, COMBO thẻ "mua cả bộ". Ngân sách món do `collectionView` (app-core) giữ; bị cắt thì tiêu đề có "Tất cả (n)".
 * ShopSection đặt trong cột có lề trang 16px (kệ ngang lùi lề âm đúng 16px); đặt ngoài cột đó thì kệ tràn ra mép.
 * Combo chỉ là combo khi có ít nhất hai sản phẩm khác nhau và `%` giảm hợp lệ (API cũng chỉ giảm khi đủ); không thì hiện như hàng dòng,
 * để không quảng cáo "mua cả bộ" cho thứ không giảm gì. "Thêm cả combo" là một lệnh của máy chủ: thêm hết hoặc không món nào.
 */
export function ShopSection({ collection, showBrand, onSeeAll, preview = false }: ShopSectionProps) {
  if (collection.items.length === 0) return null;
  const view = collectionView(collection);
  const distinct = new Set(collection.items.map((it) => it.product.id)).size;
  if (view.layout === 'combo' && view.comboPct !== null && distinct >= 2) {
    return <ComboSection collection={collection} pct={view.comboPct} preview={preview} />;
  }

  const layout = view.layout === 'combo' ? 'line' : view.layout;
  const shown = layout === 'line' && view.layout === 'combo' ? view.items.slice(0, 5) : view.items;
  const cards = shown.map(asCard);
  const noteById = new Map(shown.map((it) => [it.product.id, it.note ?? undefined]));
  const noteOf = (p: ProductCardData) => noteById.get(p.id);
  const hasMore = layout === view.layout ? view.hasMore : collection.items.length > shown.length;
  const action =
    hasMore && onSeeAll
      ? {
          label: fillCopy('shop.seeAllN', { n: view.total }),
          onPress: onSeeAll,
          spoken: fillCopy('shop.seeAllNSpoken', { n: view.total, title: collection.title }),
        }
      : undefined;

  return (
    <Section id={`shop-col-${collection.id}`}>
      <SectionHeader title={collection.title} action={action} />
      {layout === 'rail' && (
        // Lề âm bù lề trang 16px của cột chứa (kệ có đệm 12px chừa bóng thẻ): thẻ đầu kệ thẳng với tiêu đề và với kệ Trang chủ, như BLEED của web.
        <div data-testid="shop-rail" className="tubu-bleed">
          <ProductRail items={cards} variant="rail-md" label={collection.title} showBrand={showBrand} noteOf={noteOf} />
        </div>
      )}
      {layout === 'grid' && (
        <div data-testid="shop-grid">
          <ProductGrid items={cards} variant="grid" showBrand={showBrand} noteOf={noteOf} />
        </div>
      )}
      {layout === 'line' && (
        <div data-testid="shop-line">
          <ProductGrid items={cards} variant="line" columns={1} showBrand={showBrand} noteOf={noteOf} />
        </div>
      )}
    </Section>
  );
}
