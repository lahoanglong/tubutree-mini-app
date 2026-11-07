'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { pickFreeshipAddons } from '@tubutree/app-core/commerce/freeship-progress';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { FreeshipAddonRail, type FreeshipAddonItem } from '@/components/mini';
import { cartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { addToCart } from '@/lib/shop-client';
import { useCardPricing } from '@/lib/use-card-pricing';

interface Candidate extends FreeshipAddonItem {
  inStock: boolean;
  variationId: string;
}

export interface FreeshipAddonsProps {
  /** Số còn thiếu để Miễn phí giao hàng (đồng, > 0). */
  remaining: number;
  /** Các dòng giỏ HIỆN CÓ: món đã trong giỏ không được gợi ý lại. */
  lines: readonly { slug: string; variationId: string }[];
}

/**
 * Dải gợi ý món bù đơn dưới thanh Miễn phí giao hàng của Giỏ. Nguồn là kệ Bán chạy nhất (cùng khoá query với Trang chủ nên thường đã có sẵn trong bộ nhớ).
 * Lỗi tải thì không vẽ gì: dải chỉ là phần thêm, không được làm giỏ hỏng. Thêm một món là một chạm, cập nhật giỏ theo phản hồi của máy chủ
 * (giá Giờ vàng, combo và mã giảm giá tính lại ở đó nên không cập nhật trước), món mới tự được chọn vì giỏ chỉ nhớ tập món ĐÃ BỎ chọn.
 */
export function FreeshipAddons({ remaining, lines }: FreeshipAddonsProps) {
  const qc = useQueryClient();
  const best = useQuery({ ...homeBestSellerQuery(coreHttp), staleTime: 60_000, retry: false });
  const pricing = useCardPricing();
  const add = useMutation({
    mutationFn: (item: FreeshipAddonItem) => addToCart(item.variationId, 1),
    onSuccess: (cart) => qc.setQueryData(cartKey(), cart),
  });

  const picked = useMemo(() => {
    const candidates: Candidate[] = (best.data?.data ?? [])
      .filter((c: ProductCard) => (c.fulfiller?.kind ?? 'TUBU') === 'TUBU')
      .flatMap((c: ProductCard) => {
        const p = pricing(c);
        if (!p.variationId) return [];
        return [{ slug: c.slug, name: c.name, thumbnail: c.thumbnail, price: p.price, compareAt: p.compareAt, variationId: p.variationId, inStock: c.inStock }];
      });
    return pickFreeshipAddons(candidates, {
      remaining,
      inCartSlugs: new Set(lines.map((l) => l.slug)),
      inCartVariationIds: new Set(lines.map((l) => l.variationId)),
    });
    // `pricing` đổi mỗi lần vẽ nhưng chỉ đọc kho Giờ vàng và đồng hồ; dải tính lại khi dữ liệu hoặc số còn thiếu đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [best.data, remaining, lines]);

  if (picked.length === 0) return null;
  return (
    <>
      <FreeshipAddonRail items={picked} busySlug={add.isPending ? add.variables?.slug : null} onAdd={(item) => !add.isPending && add.mutate(item)} />
      {add.isError && (
        <p role="alert" className="mt-2 text-caption text-danger-fg">
          {actionErrorText(add.error)}
        </p>
      )}
    </>
  );
}
