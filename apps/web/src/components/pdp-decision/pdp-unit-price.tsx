'use client';

import type { PublicConfig } from '@tubutree/app-core/api/config';
import { variationUnitPrices } from '@tubutree/app-core/commerce/unit-price';
import { usePdpSelection } from '@/components/pdp-selection';
import { useRunningFlash } from '@/lib/use-flash-sales';
import { usePublicConfig } from '@/lib/use-public-config';
import { UnitPriceLine } from './unit-price-line';

type Product = { name: string; variations: { id: string; name: string; stock: number; retailPrice: number; salePrice?: number | null }[] };

/** Giá theo đơn vị của phân loại đang chọn, cùng giá Giờ vàng với giá đầu trang. `initialConfig` từ máy chủ để dòng có ngay trong HTML, không chèn sau khi tải. */
export function PdpUnitPrice({ product, initialConfig }: { product: Product; initialConfig?: PublicConfig }) {
  const cfg = usePublicConfig(initialConfig);
  const { flash } = useRunningFlash();
  const selection = usePdpSelection();
  const units = cfg.unitPriceEnabled === true ? variationUnitPrices(product.variations, flash, product.name, selection?.selectedId) : null;
  return units ? <UnitPriceLine text={units.line} /> : null;
}
