'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lookupVariations, searchAdminProducts, type AdminVariationLabel } from '@/lib/admin-client';
import { variationLabel, variationOptionLabel } from '@/lib/admin-pickers';
import { SearchPicker, type PickedItem, type PickerResult } from './search-picker';

/**
 * Chọn sản phẩm (mode=product → id sản phẩm, cho Content Kit) hoặc biến thể (mode=variation → id biến thể,
 * cho Flash Sale) bằng cách gõ tên không dấu hoặc SKU. Hàng đang ẩn vẫn hiện (kèm nhãn) — admin có thể cần
 * chuẩn bị Flash Sale cho hàng sắp mở bán; BE mới là nơi chặn nếu không hợp lệ.
 */
export function ProductPicker({
  mode,
  value,
  onChange,
  label,
  debounceMs,
  className,
}: {
  mode: 'product' | 'variation';
  value: PickedItem | null;
  onChange: (v: PickedItem | null) => void;
  label: string;
  debounceMs?: number;
  className?: string;
}) {
  return (
    <SearchPicker
      value={value}
      onChange={onChange}
      label={label}
      placeholder={mode === 'product' ? 'Gõ tên sản phẩm hoặc SKU…' : 'Gõ tên sản phẩm hoặc SKU để chọn biến thể…'}
      queryKey={`admin-product-search-${mode}`}
      debounceMs={debounceMs}
      className={className}
      search={async (q): Promise<PickerResult> => {
        const products = await searchAdminProducts(q);
        if (mode === 'product') {
          return {
            options: products.map((p) => ({
              id: p.id,
              label: p.name,
              detail: [p.brand, p.isActive ? null : 'đang ẩn'].filter(Boolean).join(' · ') || undefined,
            })),
          };
        }
        return {
          options: products.flatMap((p) =>
            p.variations.map((v) => ({
              id: v.id,
              label: variationOptionLabel(v),
              group: p.isActive ? p.name : `${p.name} · đang ẩn`,
              pickedLabel: `${p.name} · ${v.name} (${v.sku})`,
            })),
          ),
        };
      }}
    />
  );
}

/**
 * Nhãn cho các Variation ID đã lưu (danh sách mặt hàng của một đợt Flash Sale) bằng MỘT lượt tra cứu,
 * thay vì hiện id trần. Tra lỗi thì lùi về "Biến thể {id}" để danh sách vẫn dùng được.
 */
export function useVariationLabels(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const q = useQuery({
    queryKey: ['admin-variation-labels', key],
    queryFn: () => lookupVariations(key.split(',')),
    enabled: key.length > 0,
    staleTime: 60_000,
  });
  const map = useMemo(() => new Map<string, AdminVariationLabel>((q.data ?? []).map((v) => [v.id, v])), [q.data]);
  const labelFor = (id: string): string => {
    if (q.isError) return `Biến thể ${id}`;
    if (q.isLoading) return 'Đang tải tên…';
    return variationLabel(map.get(id), id);
  };
  return { map, labelFor };
}
