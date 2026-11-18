'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { MiniProductCard } from '@tubutree/shared-types';
import { addBasketToCart, basketCartLines, type BasketCartResult } from '@tubutree/app-core/game-mini/basket-cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniPlayPath, miniProductPath } from '@tubutree/app-core/game-mini/format';
import { kitchenCopy } from '@tubutree/app-core/game-mini/kitchen-copy';
import { miniProductView } from '@tubutree/app-core/game-mini/review';
import { Button, ProductTile, Text } from '@/components/mini';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartStorefrontSlug } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { loginHref } from '@/lib/return-to';
import { clearPendingBasket, savePendingBasket, type MiniCartGame } from './basket-pending';

const CART_PATH = '/gio-hang';

/** Chữ khác nhau giữa hai game; dòng kết quả thêm giỏ ("Đã thêm n món", hết hàng, mạng chậm) và "Xem giỏ hàng" dùng chung. */
const HEAD: Record<MiniCartGame, { set: string; pending: string; add: string; testid: string }> = {
  basket: { set: gameCopy('basket.set'), pending: gameCopy('basket.pending'), add: gameCopy('basket.add'), testid: 'mini-basket' },
  kitchen_swap: { set: kitchenCopy('set'), pending: kitchenCopy('pending'), add: kitchenCopy('add'), testid: 'mini-kitchen' },
};

/**
 * Bộ sản phẩm ở màn kết quả (chunk lười riêng, chỉ tải ở Giỏ Đúng Việc và Căn Bếp Xanh): thẻ sản phẩm và MỘT nút thêm cả bộ vào giỏ. Khoá
 * `busy` là ref đồng bộ nên chạm đúp chỉ gửi một lần; thêm xong (dù chỉ một món) nút thành "Xem giỏ hàng" để không cộng bộ lần hai. Khách chưa
 * đăng nhập được chuyển sang đăng nhập rồi quay về màn chơi như "Thêm cả combo" của web, nhưng kết quả ván không sống qua lần chuyển trang nên bộ
 * được ghi lại trước (`basket-pending.ts`, mỗi game một khoá) và khung ván hiện lại với `pending` để khách bấm thêm. Không gọi API thưởng nào:
 * hai game này không thưởng khi thêm giỏ hay khi mua.
 */
export default function MiniBasketCart({
  products,
  pending: fromLastRound = false,
  game = 'basket',
}: {
  products: MiniProductCard[];
  pending?: boolean;
  game?: MiniCartGame;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const phase = useAuthPhase();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<BasketCartResult | null>(null);
  const [error, setError] = useState(false);
  const head = HEAD[game];

  const add = async () => {
    if (busy.current || phase === 'loading') return;
    if (phase === 'guest') {
      savePendingBasket(products, game);
      router.push(loginHref(miniPlayPath.web(game)));
      return;
    }
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      const r = await addBasketToCart(coreHttp, products, cartStorefrontSlug());
      if (r.added.length > 0) void qc.invalidateQueries({ queryKey: ['cart'] });
      clearPendingBasket(game);
      setDone(r);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const lines = done ? basketCartLines(done) : error ? [gameCopy('basket.error')] : [];
  const added = (done?.added.length ?? 0) > 0;
  // Không món nào vào được vì hết hàng cả bộ: bấm lại cũng vậy. Còn món chưa gửi vì mạng (chưa món nào vào giỏ) thì bấm lại được.
  const soldOut = done !== null && !added && done.unsent.length === 0;
  return (
    <div className="tubu-mg-panel" data-testid={`${head.testid}-${fromLastRound ? 'pending' : 'set'}`}>
      <Text variant="caption" tone="secondary" as="p">
        {fromLastRound ? head.pending : head.set}
      </Text>
      {products.map((p) => (
        <ProductTile key={p.slug} view={miniProductView(p)} variant="line" href={miniProductPath.web(p.slug, game)} />
      ))}
      <Button fullWidth size="lg" variant="secondary" loading={pending || phase === 'loading'} disabled={soldOut} onPress={added ? () => router.push(CART_PATH) : add}>
        {added ? gameCopy('basket.viewCart') : head.add}
      </Button>
      <div role="status" aria-live="polite" data-testid={`${head.testid}-status`}>
        {lines.map((l) => (
          <Text key={l} variant="body-sm" tone={error ? 'danger' : 'secondary'} as="p">
            {l}
          </Text>
        ))}
      </div>
    </div>
  );
}
