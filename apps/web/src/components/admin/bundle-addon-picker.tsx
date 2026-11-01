'use client';

import { useRef } from 'react';
import { searchAdminProducts } from '@/lib/admin-client';
import { variationOptionLabel } from '@/lib/admin-pickers';
import { SearchPicker } from './search-picker';

export interface PickedAddonVariation {
  productId: string;
  productName: string;
  variationId: string;
  variationName: string;
  /** Giá đang bán của phân loại: để báo "giảm bao nhiêu" và chặn giá kèm không thấp hơn ngay ở form. */
  price: number;
}

/**
 * Chọn món mua kèm theo ĐÚNG MỘT phân loại: giá kèm là một con số cố định nên không thể áp cho cả sản phẩm (phân loại đắt gấp chục lần
 * cũng sẽ về giá đó). Các dòng kết quả là phân loại đang bán, gom theo tên sản phẩm.
 */
export function AddonVariationPicker({
  onPick,
  label = 'Thêm món mua kèm',
  debounceMs,
}: {
  onPick: (v: PickedAddonVariation) => void;
  label?: string;
  debounceMs?: number;
}) {
  const hits = useRef(new Map<string, PickedAddonVariation>());
  return (
    <SearchPicker
      value={null}
      label={label}
      placeholder="Gõ tên sản phẩm hoặc SKU để chọn phân loại…"
      queryKey="admin-bundle-addon-variation"
      debounceMs={debounceMs}
      onChange={(p) => {
        const hit = p ? hits.current.get(p.id) : undefined;
        if (hit) onPick(hit);
      }}
      search={async (q) => {
        const products = await searchAdminProducts(q);
        const options = products.flatMap((p) =>
          p.variations
            .filter((v) => v.isActive)
            .map((v) => {
              hits.current.set(v.id, { productId: p.id, productName: p.name, variationId: v.id, variationName: v.name, price: v.price });
              return { id: v.id, label: variationOptionLabel(v), group: p.isActive ? p.name : `${p.name} · đang ẩn`, pickedLabel: `${p.name} · ${v.name}` };
            }),
        );
        return { options };
      }}
    />
  );
}
