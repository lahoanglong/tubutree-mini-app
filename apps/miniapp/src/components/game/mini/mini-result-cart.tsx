import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MiniProductCard } from '@tubutree/shared-types';
import { fetchProductsBySlugs } from '@tubutree/app-core/api/catalog';
import { addBasketToCart, basketCartLines, type BasketCartResult } from '@tubutree/app-core/game-mini/basket-cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniProductPath, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { kitchenDiscovered } from '@tubutree/app-core/game-mini/kitchen';
import { kitchenCopy } from '@tubutree/app-core/game-mini/kitchen-copy';
import { miniBasketSet, miniCatalogView, miniMatchProductSlugs, miniProductsKey, miniProductView, miniQuizProduct } from '@tubutree/app-core/game-mini/review';
import type { RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { Button } from '../../ui/button';
import { ProductTile } from '../../ui/product-tile';
import { Text } from '../../ui/text';
import { useAuthPhase } from '../../../hooks/use-auth-phase';
import { useLoginWithNotice } from '../../../hooks/use-login-notice';
import { useNotify } from '../../../hooks/use-notify';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { cartStorefrontSlug } from '../../../services/cart-key';
import { coreHttp } from '../../../services/core-http';
import { useAuthStore } from '../../../store/auth';

/**
 * Phần "Thêm vào giỏ" của màn kết quả game mini ở Mini App (chunk lười riêng, màn kết quả chỉ nạp khi ván có sản phẩm): bộ sản phẩm của Giỏ Đúng
 * Việc và Căn Bếp Xanh, sản phẩm vừa học của Đố Xanh, Đoán Xuất Xứ, Ghép Cặp. Mọi lần thêm đi qua `addBasketToCart` (thẻ hiện hành, phân loại đại
 * diện, báo món hết hàng). Khách chưa đăng nhập đăng nhập Zalo ngay trên màn kết quả (màn không rời đi, kết quả giữ nguyên) rồi món được thêm tiếp,
 * nên không cần ghi bộ chờ như web. Không gọi API thưởng nào: thêm giỏ hay mua không có thưởng thêm.
 */

export type MiniCartGame = 'basket' | 'kitchen_swap';

const CART_PATH = '/cart';

/**
 * Thêm món vào giỏ qua `addBasketToCart`, đăng nhập tại chỗ nếu cần. null khi khách bỏ dở hay đăng nhập lỗi (thanh thông báo của
 * `useLoginWithNotice` đã nói lý do); lỗi mạng ném ra cho nơi gọi.
 */
function useAddToCart() {
  const qc = useQueryClient();
  const login = useLoginWithNotice();
  return async (products: MiniProductCard[]) => {
    if (useAuthStore.getState().status !== 'authenticated') {
      await login();
      if (useAuthStore.getState().status !== 'authenticated') return null;
    }
    const r = await addBasketToCart(coreHttp, products, cartStorefrontSlug());
    if (r.added.length > 0) void qc.invalidateQueries({ queryKey: ['cart'] });
    return r;
  };
}

/** Khối sản phẩm của màn kết quả: dòng nhãn nhỏ rồi các thẻ sản phẩm. */
function ProductsPanel({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="tubu-mg-panel" data-testid={id}>
      <Text variant="caption" tone="secondary" as="p">
        {label}
      </Text>
      {children}
    </div>
  );
}

/**
 * Sản phẩm của ván vừa chơi: bộ của Giỏ Đúng Việc (bộ đúng) và Căn Bếp Xanh (3 sản phẩm vừa khám phá), sản phẩm ở câu/lượt cuối của Đố Xanh và Đoán
 * Xuất Xứ, sản phẩm theo cặp của Ghép Cặp. Ván không gắn sản phẩm nào thì không vẽ gì.
 */
export default function ResultProducts({ game, state }: { game: PlayableMiniGame; state: RoundState }) {
  const review = state.result?.review;
  const content = state.round?.content;
  if (!review) return null;
  if (game === 'basket' || game === 'kitchen_swap') {
    const set = game === 'basket' ? miniBasketSet(review, content) : kitchenDiscovered(review, content);
    return set.length > 0 ? <MiniBasketCart game={game} products={set} /> : null;
  }
  const product = game === 'match' ? null : miniQuizProduct(content);
  const matchSlugs = game === 'match' ? miniMatchProductSlugs(review) : [];
  return product || matchSlugs.length > 0 ? <LearnedProducts game={game} product={product} matchSlugs={matchSlugs} /> : null;
}

/**
 * Bộ sản phẩm và MỘT nút thêm cả bộ, cùng chữ với web. Khoá `busy` là ref đồng bộ nên chạm đúp chỉ gửi một lần; thêm xong (dù chỉ một món) nút
 * thành "Xem giỏ hàng" để không cộng bộ lần hai.
 */
export function MiniBasketCart({ products, game }: { products: MiniProductCard[]; game: MiniCartGame }) {
  const navigate = useSmartNavigate();
  const phase = useAuthPhase();
  const addToCart = useAddToCart();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<BasketCartResult | null>(null);
  const [error, setError] = useState(false);
  const kitchen = game === 'kitchen_swap';
  const testid = kitchen ? 'mini-kitchen' : 'mini-basket';

  const add = async () => {
    if (busy.current || phase === 'loading') return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      const r = await addToCart(products);
      if (r) setDone(r);
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
    <ProductsPanel id={`${testid}-set`} label={kitchen ? kitchenCopy('set') : gameCopy('basket.set')}>
      {products.map((p) => (
        <ProductTile key={p.slug} view={miniProductView(p)} variant="line" href={miniProductPath.miniapp(p.slug, game)} />
      ))}
      <Button fullWidth size="lg" variant="secondary" loading={pending || phase === 'loading'} disabled={soldOut} onPress={added ? () => navigate(CART_PATH) : add}>
        {added ? gameCopy('basket.viewCart') : kitchen ? kitchenCopy('add') : gameCopy('basket.add')}
      </Button>
      <div role="status" aria-live="polite" data-testid={`${testid}-status`}>
        {lines.map((l) => (
          <Text key={l} variant="body-sm" tone={error ? 'danger' : 'secondary'} as="p">
            {l}
          </Text>
        ))}
      </div>
    </ProductsPanel>
  );
}

/**
 * Sản phẩm vừa học kèm nút "+ Thêm vào giỏ" một chạm: sản phẩm của câu/lượt cuối (Đố Xanh, Đoán Xuất Xứ) hoặc tối đa 2 sản phẩm theo cặp (Ghép Cặp,
 * giá và tồn kho hiện hành từ danh mục). Món hết hàng không có nút. Báo kết quả bằng thanh thông báo; khoá ref nên chạm đúp chỉ gửi một lần.
 */
export function LearnedProducts({ game, product, matchSlugs }: { game: PlayableMiniGame; product: MiniProductCard | null; matchSlugs: string[] }) {
  const addToCart = useAddToCart();
  const { notify } = useNotify();
  const busy = useRef(false);
  const cardsQ = useQuery({ queryKey: miniProductsKey(matchSlugs), queryFn: () => fetchProductsBySlugs(coreHttp, matchSlugs), staleTime: 60_000, enabled: matchSlugs.length > 0 });

  const add = async (slug: string, name: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await addToCart([{ slug, name, imageUrl: null, price: 0, inStock: true }]);
      if (r) notify({ text: basketCartLines(r).join(' '), type: r.added.length > 0 ? 'success' : 'warning' });
    } catch {
      notify({ text: gameCopy('basket.error'), type: 'error' });
    } finally {
      busy.current = false;
    }
  };

  const tiles = product
    ? [{ slug: product.slug, name: product.name, inStock: product.inStock, view: miniProductView(product) }]
    : (cardsQ.data ?? []).map((c) => ({ slug: c.slug, name: c.name, inStock: c.inStock, view: miniCatalogView(c) }));
  if (tiles.length === 0) return null;
  const label = game === 'match' ? 'result.matchProduct' : game === 'origin' ? 'result.originProduct' : 'result.product';
  return (
    <ProductsPanel id={product ? 'mini-result-product' : 'mini-result-products'} label={gameCopy(label)}>
      {tiles.map((t) => (
        <ProductTile
          key={t.slug}
          view={t.view}
          variant="line"
          href={miniProductPath.miniapp(t.slug, game)}
          onAdd={t.inStock ? () => void add(t.slug, t.name) : undefined}
          addLabel={gameCopy('result.add')}
        />
      ))}
    </ProductsPanel>
  );
}
