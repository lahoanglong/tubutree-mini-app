'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProductCard as CoreProductCard } from '@tubutree/app-core/api/catalog';
import { addOneVariationPricing } from '@tubutree/app-core/commerce/add-one-pricing';
import { inCartQuantity } from '@tubutree/app-core/commerce/flash-line';
import { buildFrequentlyBoughtBundle, pickFbtPartners, type FbtBundle } from '@tubutree/app-core/commerce/frequently-bought';
import { boughtTogetherQuery } from '@tubutree/app-core/queries/catalog';
import { usePdpSelection } from '@/components/pdp-selection';
import { useProductStock } from '@/components/pdp-stock';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { useFlashAllowance } from '@/lib/use-flash-allowance';
import { getCart } from '@/lib/shop-client';
import { useRunningFlash } from '@/lib/use-flash-sales';
import { joinVariationLine, variationLabel } from '@/lib/variation-label';

const FIVE_MIN = 5 * 60_000;
const NO_PRODUCTS: ReadonlySet<string> = new Set();

/**
 * Sản phẩm đã có trong giỏ lúc giỏ tải xong lần đầu của trang này, đóng băng cho tới khi đổi sản phẩm (cùng luật với `useFbtCartProductIds` của Mini App).
 * Thêm cả bộ xong, giỏ tải lại có chính các món vừa thêm: loại chúng khỏi gợi ý thì khối biến mất giữa trang và dải "Khách thường mua cùng" bên dưới nhảy món.
 * Chưa tải xong giỏ thì coi là rỗng (khác Mini App, nơi chưa dựng khối): khối nằm sẵn trong HTML server, nên không chờ giỏ mới hiện.
 */
function useFrozenCartProductIds(slug: string, items: readonly { productId?: string }[] | undefined, settled: boolean): ReadonlySet<string> {
  const frozen = useRef<{ slug: string; ids: ReadonlySet<string> } | null>(null);
  if (frozen.current && frozen.current.slug !== slug) frozen.current = null;
  if (!frozen.current && settled) {
    frozen.current = { slug, ids: new Set((items ?? []).flatMap((l) => (l.productId ? [l.productId] : []))) };
  }
  return frozen.current?.ids ?? NO_PRODUCTS;
}

export interface FbtHostArgs {
  productId: string;
  slug: string;
  name: string;
  thumbnail: string | null;
  variations: readonly { id: string; name?: string; retailPrice: number; salePrice: number | null; stock: number }[];
  /** Gian hàng tạm nghỉ/ngừng bán: khách xem được trang nhưng chưa mua được, nên không có bộ. */
  blockedReason?: string | null;
  initialBoughtTogether?: CoreProductCard[];
}

/**
 * Bộ "Gợi ý mua kèm hợp vị" của trang: món đang xem (phân loại khách đang chọn, giá và tồn đúng như khối mua) cộng các món bổ trợ từ dải "Khách thường mua cùng".
 * `PdpFbt` (vẽ khối) và `PdpRails` (bỏ đúng các món đó khỏi các dải bên dưới) cùng gọi hook này nên hai nơi luôn khớp: khối không hiện thì dải giữ đủ món.
 * Món đã có trong giỏ lúc giỏ tải xong thì không gợi ý lại, nhưng danh sách đó đóng băng (xem `useFrozenCartProductIds`) để bộ đứng yên sau khi khách thêm. Danh sách đầu do server dựng (khối nằm sẵn trong HTML).
 */
export function useFbt({ productId, slug, name, thumbnail, variations, blockedReason = null, initialBoughtTogether }: FbtHostArgs): { bundle: FbtBundle | null; claimed: ReadonlySet<string> } {
  const together = useQuery({ ...boughtTogetherQuery(coreHttp, slug), initialData: initialBoughtTogether, staleTime: FIVE_MIN, retry: 0 });
  const stock = useProductStock(slug).data;
  const { flash, now } = useRunningFlash();
  const phase = useAuthPhase();
  const cart = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const cartProductIds = useFrozenCartProductIds(slug, cart.data?.items, phase === 'guest' || (phase === 'authenticated' && !cart.isPending));
  const selectedId = usePdpSelection()?.selectedId;
  const selected = variations.find((v) => v.id === selectedId);
  // Giá của đơn vị vừa thêm theo giỏ HIỆN CÓ (không phải giỏ đóng băng của việc chọn món): vượt suất Giờ vàng của khách thì giỏ tính giá thường cho cả dòng.
  const flashWithAllowance = useFlashAllowance(flash, variations.map((v) => v.id));
  const pricing = selected ? addOneVariationPricing(selected, flashWithAllowance, inCartQuantity(cart.data?.items, selected.id)) : null;
  const partners = pickFbtPartners({ currentProductId: productId, candidates: together.data, flash, now, cartProductIds });
  const bundle = buildFrequentlyBoughtBundle({
    current: {
      productId,
      slug,
      // Cùng Mini App: sản phẩm nhiều phân loại ghi kèm phân loại đang chọn (khách thấy đúng món sẽ vào giỏ).
      name: selected && variations.length > 1 ? joinVariationLine(name, variationLabel(selected.name, variations.length)) : name,
      thumbnail,
      variationId: selected?.id ?? null,
      price: pricing?.price ?? 0,
      compareAt: pricing?.compareAt ?? null,
      inStock: !blockedReason && (stock?.[selected?.id ?? ''] ?? selected?.stock ?? 0) > 0,
    },
    candidates: [],
    partners,
  });
  return { bundle, claimed: new Set(bundle ? partners.map((p) => p.productId) : []) };
}
