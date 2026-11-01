import type { BundleDTO, BundleItemDTO } from '../../../../packages/app-core/src/api/bundle';
import type { ProductCard } from '../../../miniapp/src/services/shop-api';
import { BINH_SUA, CATALOG, NRC, XA_PHONG, toCard, type CatalogItem } from './discovery-mocks';
import type { MockApi } from './mock-api';

/**
 * Dữ liệu `GET /products/:slug/bundles` và `GET /bundles/combos` đúng dạng API thật cho spec Combo ưu đãi / Mua kèm. Mặc định (mock-api) cả hai trả rỗng,
 * nên spec khác không đổi. Món lấy từ danh mục giả của spec khám phá; `variationId` là phân loại duy nhất của món (`var-<id>`).
 */
const DAY = 86_400_000;

const card = (x: CatalogItem): ProductCard => ({ ...toCard(x), repVariationId: `var-${x.id}` });
const item = (x: CatalogItem, addonPrice: number | null = null): BundleItemDTO => ({
  productId: x.id, variationId: `var-${x.id}`, maxQty: 1, addonPrice, inStock: true, product: card(x),
});

/** Túi vải đầu tiên của danh mục giả: còn hàng, 600.000đ (BINH_SUA 180.000đ cũng còn hàng; KEM hết hàng nên không dùng). */
const TUI = CATALOG[4]!;

export const PDP_SLUG = NRC.slug;
export const COMBO_TITLE = 'Combo rửa sạch xanh';
export const HOME_COMBO_TITLES = ['Combo bếp xanh', 'Combo cho bé'] as const;

export const pdpCombo = (over: Partial<BundleDTO> = {}): BundleDTO => ({
  id: 'bd-combo', kind: 'BUNDLE_PCT', title: COMBO_TITLE, pct: 10, endAt: new Date(Date.now() + 7 * DAY).toISOString(), anchorProductId: null,
  items: [item(NRC), item(XA_PHONG)], ...over,
});

/** Hai món mua kèm với sản phẩm chính là NRC: nước rửa bình sữa 180.000đ → 135.000đ (-25%), túi vải 600.000đ → 420.000đ (-30%). */
export const pdpAddon = (over: Partial<BundleDTO> = {}): BundleDTO => ({
  id: 'bd-addon', kind: 'ADDON', title: 'Mua kèm nước rửa chén', pct: null, endAt: new Date(Date.now() + 7 * DAY).toISOString(), anchorProductId: NRC.id,
  items: [item(BINH_SUA, 135_000), item(TUI, 420_000)], ...over,
});

export const homeCombos = (): BundleDTO[] => [
  pdpCombo({ id: 'bd-home-1', title: HOME_COMBO_TITLES[0], items: [item(NRC), item(XA_PHONG)] }),
  pdpCombo({ id: 'bd-home-2', title: HOME_COMBO_TITLES[1], items: [item(BINH_SUA), item(TUI)] }),
];

export function mockPdpBundles(api: MockApi, bundles: { combos?: BundleDTO[]; addons?: BundleDTO[]; hold?: Promise<void>; delayMs?: number }): void {
  api.get('/products/:slug/bundles', async () => {
    await bundles.hold;
    if (bundles.delayMs) await new Promise((resolve) => setTimeout(resolve, bundles.delayMs));
    return { combos: bundles.combos ?? [], addons: bundles.addons ?? [] };
  });
}

export function mockHomeCombos(api: MockApi, combos: BundleDTO[], hold?: Promise<void>): void {
  api.get('/bundles/combos', async () => {
    await hold;
    return combos;
  });
}
