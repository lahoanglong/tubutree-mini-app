import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchProductsBySlugs } from '@tubutree/app-core/api/catalog';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniProductPath, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { miniBasketSet, miniCatalogView, miniMatchProductSlugs, miniProductsKey, miniProductView, miniQuizProduct } from '@tubutree/app-core/game-mini/review';
import type { RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { ProductTile } from '../../ui/product-tile';
import { Text } from '../../ui/text';
import { coreHttp } from '../../../services/core-http';

// Thêm giỏ chỉ có ở Giỏ Đúng Việc: chunk riêng để màn kết quả của các game khác không mang mã giỏ.
const MiniBasketCart = lazy(() => import('./mini-basket-cart'));

/** "Nguyên liệu này có trong" sau Ghép Cặp: tối đa 2 sản phẩm theo cặp, giá và tồn kho hiện hành từ danh mục. */
function MatchProducts({ slugs }: { slugs: string[] }) {
  const q = useQuery({ queryKey: miniProductsKey(slugs), queryFn: () => fetchProductsBySlugs(coreHttp, slugs), staleTime: 60_000 });
  const cards = q.data ?? [];
  if (cards.length === 0) return null;
  return (
    <div className="tubu-mg-panel" data-testid="mini-result-products">
      <Text variant="caption" tone="secondary" as="p">
        {gameCopy('result.matchProduct')}
      </Text>
      {cards.map((c) => (
        <ProductTile key={c.slug} view={miniCatalogView(c)} variant="line" href={miniProductPath.miniapp(c.slug, 'match')} />
      ))}
    </div>
  );
}

/**
 * Khối sản phẩm của màn kết quả (chunk lười riêng, `mini-result` tải trước lúc đang chơi): sản phẩm ở câu/lượt cuối của Đố Xanh và Đoán Xuất Xứ,
 * "Nguyên liệu này có trong" của Ghép Cặp, bộ đúng kèm "Thêm bộ này vào giỏ" của Giỏ Đúng Việc. Đúng Thùng không có khối này.
 */
export default function MiniResultProducts({ game, state }: { game: PlayableMiniGame; state: RoundState }) {
  const review = state.result?.review;
  if (!review) return null;
  if (game === 'daily_quiz' || game === 'origin') {
    const product = miniQuizProduct(state.round?.content);
    if (!product) return null;
    return (
      <div className="tubu-mg-panel">
        <Text variant="caption" tone="secondary" as="p">
          {gameCopy(game === 'origin' ? 'result.originProduct' : 'result.product')}
        </Text>
        <div data-testid="mini-result-product">
          <ProductTile view={miniProductView(product)} variant="line" href={miniProductPath.miniapp(product.slug, game)} />
        </div>
      </div>
    );
  }
  if (game === 'match') {
    const slugs = miniMatchProductSlugs(review);
    return slugs.length > 0 ? <MatchProducts slugs={slugs} /> : null;
  }
  if (game === 'basket') {
    const set = miniBasketSet(review, state.round?.content);
    if (set.length === 0) return null;
    return (
      <Suspense fallback={<div className="tubu-mg-board-skeleton" data-size="sm" aria-hidden />}>
        <MiniBasketCart products={set} />
      </Suspense>
    );
  }
  return null;
}
