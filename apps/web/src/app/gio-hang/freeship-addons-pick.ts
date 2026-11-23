import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { pickAovAddons } from '@tubutree/app-core/cart/aov-upsell';
import { FREESHIP_BOOSTER_WINDOW } from '@tubutree/app-core/commerce/freeship-progress';
import type { FreeshipAddonItem } from '@/components/mini';
import type { useFreeshipBoosterCards } from '@/components/cart/freeship-booster/use-freeship-booster-cards';
import type { useCardPricing } from '@/lib/use-card-pricing';
import type { FreeshipAddonsProps } from './freeship-addons';

interface Candidate extends FreeshipAddonItem {
  inStock: boolean;
  variationId: string;
}

/**
 * Món của dải mua thêm (chung cho giỏ tài khoản và giỏ khách): Tubu giao, có phân loại, giá thẻ hiện tại (Giờ vàng), rồi luật `pickAovAddons`.
 * Không nhớ kết quả: giá và phân loại phụ thuộc kho Giờ vàng và đồng hồ (đọc trong `pricing`), Giờ vàng hết hạn phải tính lại ngay.
 */
export function pickFreeshipAddonItems(
  { goal, lines, exclude }: Pick<FreeshipAddonsProps, 'goal' | 'lines' | 'exclude'>,
  source: ReturnType<typeof useFreeshipBoosterCards>,
  pricing: ReturnType<typeof useCardPricing>,
): Candidate[] {
  const candidates: Candidate[] = source.cards
    .filter((c: ProductCard) => (c.fulfiller?.kind ?? 'TUBU') === 'TUBU')
    .flatMap((c: ProductCard) => {
      const p = pricing(c);
      if (!p.variationId) return [];
      return [{ slug: c.slug, name: c.name, thumbnail: c.thumbnail, price: p.price, compareAt: p.compareAt, variationId: p.variationId, inStock: c.inStock }];
    });
  return pickAovAddons(candidates, {
    shortfall: goal.shortfall,
    inCartSlugs: new Set(lines.map((l) => l.slug)),
    inCartVariationIds: new Set(lines.map((l) => l.variationId)),
    excludeSlugs: exclude?.slugs,
    excludeVariationIds: exclude?.variationIds,
    ...(source.booster ? { window: FREESHIP_BOOSTER_WINDOW, ranked: true } : {}),
  });
}
