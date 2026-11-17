import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MiniProductCard } from '@tubutree/shared-types';
import { addBasketToCart, basketCartLines, type BasketCartResult } from '@tubutree/app-core/game-mini/basket-cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniProductPath } from '@tubutree/app-core/game-mini/format';
import { miniProductView } from '@tubutree/app-core/game-mini/review';
import { useLoginWithNotice } from '../../ui/auth-gate';
import { Button } from '../../ui/button';
import { ProductTile } from '../../ui/product-tile';
import { Text } from '../../ui/text';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { cartStorefrontSlug } from '../../../services/cart-key';
import { coreHttp } from '../../../services/core-http';
import { useAuthStore } from '../../../store/auth';

const CART_PATH = '/cart';

/**
 * Bộ đúng của Giỏ Đúng Việc ở màn kết quả (chunk lười riêng, chỉ tải khi ván là Giỏ Đúng Việc): 3 thẻ sản phẩm và MỘT nút "Thêm bộ này vào giỏ".
 * Khoá `busy` là ref đồng bộ nên chạm đúp chỉ gửi một lần; thêm xong (dù chỉ một món) nút thành "Xem giỏ hàng" để không cộng bộ lần hai. Chưa đăng
 * nhập thì mời đăng nhập rồi thêm tiếp, như "Thêm vào giỏ" của bộ gợi ý. Không gọi API thưởng nào: game này không thưởng khi thêm giỏ hay khi mua.
 */
export default function MiniBasketCart({ products }: { products: MiniProductCard[] }) {
  const qc = useQueryClient();
  const navigate = useSmartNavigate();
  const login = useLoginWithNotice();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<BasketCartResult | null>(null);
  const [error, setError] = useState(false);

  const add = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      if (useAuthStore.getState().status !== 'authenticated') {
        await login();
        if (useAuthStore.getState().status !== 'authenticated') return;
      }
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
        <ProductTile key={p.slug} view={miniProductView(p)} variant="line" href={miniProductPath.miniapp(p.slug, 'basket')} />
      ))}
      <Button fullWidth size="lg" variant="secondary" loading={pending} disabled={soldOut} onPress={added ? () => navigate(CART_PATH) : add}>
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
