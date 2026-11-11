'use client';

import { useEffect, useState } from 'react';
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { pickFreeshipAddons } from '@tubutree/app-core/commerce/freeship-progress';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { FreeshipAddonRail, type FreeshipAddonItem } from '@/components/mini';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { addToCart } from '@/lib/shop-client';
import { useCardPricing } from '@/lib/use-card-pricing';
import { reloadCartAfter, useCartWrite } from '@/lib/use-cart-write';

const ADD_KEY = ['freeship-add'] as const;
// Phải trùng LINE_OP_KEY của lệnh đổi số lượng/xoá dòng ở page.tsx; spec của dải này dựng cả trang giỏ nên đổi một bên là đỏ.
const LINE_OP_KEY = ['cart-line-op'] as const;

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
  // Lỗi nhớ riêng (không đọc `mutation.error`): lỗi của món bay trước sẽ mất nếu lệnh sau cùng thuộc món khác và thành công.
  const [error, setError] = useState<{ value: unknown } | null>(null);
  const cartWrite = useCartWrite(ADD_KEY, LINE_OP_KEY);
  // Khoá đồng bộ THEO MÓN như Mini App: `isPending` chỉ đổi sau lần vẽ kế nên hai cú chạm sát nhau vào CÙNG một món sẽ thêm hai lần, còn chạm món khác vẫn đi ngay, không bị nuốt.
  const add = useLockedMutation(
    {
      mutationKey: ADD_KEY,
      mutationFn: (item: FreeshipAddonItem) => addToCart(item.variationId, 1),
      onMutate: () => {
        setError(null);
        cartWrite.began();
      },
      // `write` trả lời hứa tải lại giỏ khi có lệnh chồng: món còn bị khoá (và còn báo bận) tới khi giỏ mới về, không thì chạm lần hai thêm món đã vào giỏ.
      onSuccess: cartWrite.write,
      // Máy chủ từ chối vì giỏ hoặc kệ đã cũ (món vừa hết hàng, đã có trong giỏ): lời lỗi hiện ngay, giữ khoá tới khi giỏ và kệ mới về (tối đa 4 giây) để món vừa bị từ chối không chạm lại được.
      onError: (e) => {
        setError({ value: e });
        if (!serverRejectedState(e)) return undefined;
        // Giỏ chờ lệnh dòng đang bay xong (xem `reloadCartAfter`); kệ Bán chạy không phụ thuộc giỏ nên tải ngay.
        return settleWithin(Promise.all([reloadCartAfter(qc, LINE_OP_KEY), qc.invalidateQueries({ queryKey: homeBestSellerQuery(coreHttp).queryKey })]));
      },
      onSettled: cartWrite.settled,
    },
    (item) => item.slug,
  );
  // Mọi món đang bay (không chỉ lệnh sau cùng): nút của đúng các món đó báo bận, vì khoá theo món nuốt cú chạm vào chúng.
  const busySlugs = useMutationState({ filters: { mutationKey: ADD_KEY, status: 'pending' }, select: (m) => (m.state.variables as FreeshipAddonItem).slug });

  // Không bọc `useMemo`: giá và phân loại phụ thuộc kho Giờ vàng và đồng hồ (đọc trong `pricing`), nên Giờ vàng hết hạn phải tính lại ngay, không giữ giá cũ.
  const picked = (() => {
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
  })();

  // Món bị từ chối vì hết hàng làm kệ tải lại loại món đó, dải có thể rơi dưới mức tối thiểu và biến mất: lời lỗi vẫn hiện một mình để khách đọc được lý do.
  // Dải hiện lại sau đó thì lời cũ bỏ đi, không cho nó sống lại cạnh một dải khác.
  const railGone = picked.length === 0;
  useEffect(() => {
    if (!railGone) setError(null);
  }, [railGone]);

  if (railGone && !error) return null;
  return (
    <>
      <FreeshipAddonRail items={picked} busySlug={busySlugs} onAdd={(item) => add.mutate(item)} />
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger-fg">
          {actionErrorText(error.value)}
        </p>
      )}
    </>
  );
}
