'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AlbumCard } from '@tubutree/app-core/game-album/types';
import { albumCopy } from '@tubutree/app-core/game-album/copy';
import { addBasketToCart, basketCartLines } from '@tubutree/app-core/game-mini/basket-cart';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { miniProductPath, safeSourceUrl, sourceHost } from '@tubutree/app-core/game-mini/format';
import { miniProductView } from '@tubutree/app-core/game-mini/review';
import { ProductTile, Text } from '@/components/mini';
import { Sheet } from '@/components/ui/sheet';
import { cartStorefrontSlug } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';

/**
 * Sheet của một thẻ (tải lười qua `next/dynamic`, chỉ khi khách chạm thẻ): kiến thức, nguồn (liên kết thật, tab mới) và sản phẩm liên quan với
 * nút "Thêm vào giỏ" một chạm. Màn sổ chỉ dành cho khách đã đăng nhập nên thêm giỏ không cần bước đăng nhập; khoá ref chặn chạm đúp.
 */
export default function AlbumCardSheet({ card, onClose }: { card: AlbumCard | null; onClose: () => void }) {
  const qc = useQueryClient();
  const busy = useRef(false);
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null);
  const href = card ? safeSourceUrl(card.sourceUrl) : null;
  const host = card ? sourceHost(card.sourceUrl) : null;
  const product = card?.product;

  const add = async () => {
    if (busy.current || !product) return;
    busy.current = true;
    try {
      const r = await addBasketToCart(coreHttp, [product], cartStorefrontSlug());
      if (r.added.length > 0) void qc.invalidateQueries({ queryKey: ['cart'] });
      setLine({ text: basketCartLines(r).join(' '), error: false });
    } catch {
      setLine({ text: gameCopy('basket.error'), error: true });
    } finally {
      busy.current = false;
    }
  };

  return (
    <Sheet
      open={card !== null}
      onClose={() => {
        setLine(null);
        onClose();
      }}
      title={albumCopy('title')}
    >
      {card && (
        <div className="album-sheet" data-testid="album-card-sheet">
          <Text variant="body-lg" as="p">
            {card.title}
          </Text>
          {card.answer && (
            <Text variant="body-sm" as="p">
              {gameCopy('result.expected', { a: card.answer })}
            </Text>
          )}
          <Text variant="body-sm" as="p">
            {card.explanation}
          </Text>
          {href && host && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="tubu-mg-link">
              {gameCopy('result.sourceHost', { host })}
            </a>
          )}
          {product && (
            <ProductTile
              view={miniProductView(product)}
              variant="line"
              href={miniProductPath.web(product.slug, card.game)}
              onAdd={product.inStock ? add : undefined}
              addLabel={gameCopy('result.add')}
            />
          )}
          <div role="status" aria-live="polite">
            {line && (
              <Text variant="body-sm" tone={line.error ? 'danger' : 'secondary'} as="p">
                {line.text}
              </Text>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
