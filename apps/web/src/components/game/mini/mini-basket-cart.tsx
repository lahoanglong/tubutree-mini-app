'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { MiniProductCard } from '@tubutree/shared-types';
import { addBasketToCart, basketCartLines, type BasketCartResult } from '@tubutree/app-core/game-mini/basket-cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniPlayPath, miniProductPath } from '@tubutree/app-core/game-mini/format';
import { miniProductView } from '@tubutree/app-core/game-mini/review';
import { Button, ProductTile, Text } from '@/components/mini';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartStorefrontSlug } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { loginHref } from '@/lib/return-to';

const CART_PATH = '/gio-hang';

/**
 * Bộ đúng của Giỏ Đúng Việc ở màn kết quả (chunk lười riêng, chỉ tải khi ván là Giỏ Đúng Việc): 3 thẻ sản phẩm và MỘT nút "Thêm bộ này vào giỏ".
 * Khoá `busy` là ref đồng bộ nên chạm đúp chỉ gửi một lần; thêm xong (dù chỉ một món) nút thành "Xem giỏ hàng" để không cộng bộ lần hai. Khách
 * chưa đăng nhập được chuyển sang đăng nhập rồi quay về màn chơi, như "Thêm cả combo" của web. Không gọi API thưởng nào: game này không thưởng khi
 * thêm giỏ hay khi mua.
 */
export default function MiniBasketCart({ products }: { products: MiniProductCard[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const phase = useAuthPhase();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<BasketCartResult | null>(null);
  const [error, setError] = useState(false);

  const add = async () => {
    if (busy.current || phase === 'loading') return;
    if (phase === 'guest') {
      router.push(loginHref(miniPlayPath.web('basket')));
      return;
    }
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      const r = await addBasketToCart(coreHttp, products, cartStorefrontSlug());
      if (r.added.length > 0) void qc.invalidateQueries({ queryKey: ['cart'] });
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
    <div className="tubu-mg-panel" data-testid="mini-basket-set">
      <Text variant="caption" tone="secondary" as="p">
        {gameCopy('basket.set')}
      </Text>
      {products.map((p) => (
        <ProductTile key={p.slug} view={miniProductView(p)} variant="line" href={miniProductPath.web(p.slug, 'basket')} />
      ))}
      <Button fullWidth size="lg" variant="secondary" loading={pending} disabled={soldOut} onPress={added ? () => router.push(CART_PATH) : add}>
        {gameCopy(added ? 'basket.viewCart' : 'basket.add')}
      </Button>
      <div role="status" aria-live="polite" data-testid="mini-basket-status">
        {lines.map((l) => (
          <Text key={l} variant="body-sm" tone={error ? 'danger' : 'secondary'} as="p">
            {l}
          </Text>
        ))}
      </div>
    </div>
  );
}
