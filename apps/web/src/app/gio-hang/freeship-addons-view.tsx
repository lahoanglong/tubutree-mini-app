'use client';

import { useEffect, useState } from 'react';
import { useMutationState, useQueryClient } from '@tanstack/react-query';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { pickAovAddons } from '@tubutree/app-core/cart/aov-upsell';
import { FREESHIP_BOOSTER_WINDOW } from '@tubutree/app-core/commerce/freeship-progress';
import { FreeshipAddonRail, type FreeshipAddonItem } from '@/components/mini';
import { FREESHIP_UPSELL_QUERY_PREFIX, type useFreeshipBoosterCards } from '@/components/cart/freeship-booster/use-freeship-booster-cards';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { actionErrorText } from '@/lib/error-text';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { addToCart } from '@/lib/shop-client';
import type { useCardPricing } from '@/lib/use-card-pricing';
import { useCartWrite } from '@/lib/use-cart-write';
import { FreeshipAddonsPending, type FreeshipAddonsProps } from './freeship-addons';

const ADD_KEY = ['freeship-add'] as const;

interface Candidate extends FreeshipAddonItem {
  inStock: boolean;
  variationId: string;
}

export interface FreeshipAddonsViewProps extends FreeshipAddonsProps {
  /** Nguồn món (`useFreeshipBoosterCards`), gọi ở `FreeshipAddons` để tải song song với chunk này. */
  source: ReturnType<typeof useFreeshipBoosterCards>;
  /** Giá thẻ (`useCardPricing`), cùng lý do. */
  pricing: ReturnType<typeof useCardPricing>;
}

/** Phần vẽ và thêm món của `FreeshipAddons` (chunk tải sau): chọn món, thêm một chạm, lời lỗi, báo Giỏ dải có hiện không. */
export function FreeshipAddonsView({ goal, lines, exclude, onShownChange, source, pricing }: FreeshipAddonsViewProps) {
  const qc = useQueryClient();
  // Lỗi nhớ riêng (không đọc `mutation.error`): lỗi của món bay trước sẽ mất nếu lệnh sau cùng thuộc món khác và thành công.
  const [error, setError] = useState<{ value: unknown } | null>(null);
  const cartWrite = useCartWrite();
  // Khoá đồng bộ THEO MÓN như Mini App: `isPending` chỉ đổi sau lần vẽ kế nên hai cú chạm sát nhau vào CÙNG một món sẽ thêm hai lần, còn chạm món khác vẫn đi ngay, không bị nuốt.
  const add = useLockedMutation(
    {
      mutationKey: ADD_KEY,
      mutationFn: (item: FreeshipAddonItem) => addToCart(item.variationId, 1),
      onMutate: () => {
        setError(null);
        return cartWrite.begin();
      },
      // `write` trả lời hứa tải lại giỏ khi có lệnh chồng: món còn bị khoá (và còn báo bận) tới khi giỏ mới về, không thì chạm lần hai thêm món đã vào giỏ.
      onSuccess: (cart, _item, cmd) => cartWrite.write(cmd, cart),
      // Máy chủ từ chối vì giỏ hoặc kệ đã cũ (món vừa hết hàng, đã có trong giỏ): lời lỗi hiện ngay, giữ khoá tới khi giỏ và kệ mới về (tối đa 4 giây) để món vừa bị từ chối không chạm lại được.
      onError: (e, _item, cmd) => {
        setError({ value: e });
        const stale = serverRejectedState(e);
        // Giỏ chờ các lệnh giỏ đang bay xong (xem `useCartWrite`); nguồn gợi ý không phụ thuộc giỏ nên tải ngay.
        const cartReloaded = cartWrite.fail(cmd, stale);
        if (!stale) return undefined;
        const sourceKey = source.booster ? FREESHIP_UPSELL_QUERY_PREFIX : source.bestKey;
        return settleWithin(Promise.all([cartReloaded, qc.invalidateQueries({ queryKey: sourceKey })]));
      },
    },
    (item) => item.slug,
  );
  // Mọi món đang bay (không chỉ lệnh sau cùng): nút của đúng các món đó báo bận, vì khoá theo món nuốt cú chạm vào chúng.
  const busySlugs = useMutationState({ filters: { mutationKey: ADD_KEY, status: 'pending' }, select: (m) => (m.state.variables as FreeshipAddonItem).slug });

  // Không bọc `useMemo`: giá và phân loại phụ thuộc kho Giờ vàng và đồng hồ (đọc trong `pricing`), nên Giờ vàng hết hạn phải tính lại ngay, không giữ giá cũ.
  const picked = (() => {
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
  })();

  // Món bị từ chối vì hết hàng làm kệ tải lại loại món đó, dải có thể rơi dưới mức tối thiểu và biến mất: lời lỗi vẫn hiện một mình để khách đọc được lý do.
  // Dải hiện lại sau đó thì lời cũ bỏ đi, không cho nó sống lại cạnh một dải khác.
  const railGone = picked.length === 0;
  const shown = !railGone ? true : source.pending ? null : false;
  useEffect(() => {
    if (!railGone) setError(null);
  }, [railGone]);
  useEffect(() => {
    if (!onShownChange) return undefined;
    onShownChange(shown);
    return () => onShownChange(false);
  }, [shown, onShownChange]);

  if (railGone && !error) return source.pending ? <FreeshipAddonsPending title={goal.headline} /> : null;
  return (
    <>
      <FreeshipAddonRail
        title={goal.headline}
        stage={goal.stage}
        items={picked}
        busySlug={busySlugs}
        onAdd={(item) => add.mutate(item)}
      />
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger-fg">
          {actionErrorText(error.value)}
        </p>
      )}
    </>
  );
}
