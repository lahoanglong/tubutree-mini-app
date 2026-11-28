'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { pdpBuyModeOrRetail, pdpBuyModes, type PdpBuyModeKey } from '@tubutree/app-core/commerce/pdp-buy-modes';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { PdpBuyModes } from '@/components/mini/pdp-buy-modes';
import { trackWebEvent } from '@/lib/analytics';
import { PdpSubscribeRow, subscribeResumeRequested, usePdpSubscribeOffer } from './pdp-extras';
import { PdpRefillOfferBlock } from './pdp-refill-offer';

type PdpVariation = Parameters<typeof PdpSubscribeRow>[0]['variations'][number];

/**
 * Dải chọn cách mua của trang sản phẩm web (w47-01), cùng luật với Mini App (`pdpBuyModes`): "Mua lẻ" mặc định, "Túi Refill" khi chai đã ghép gói,
 * "Định kỳ" khi phân loại đang chọn còn hàng và sản phẩm không chỉ bán giá lẻ. Chỉ chế độ đang chọn có dòng chi tiết: thẻ gói Refill hay nút mở
 * tấm Đặt định kỳ; lối sang trang mọi gói Refill nằm ngay dưới dải, không theo chế độ. Lượt hiện thẻ Refill (`refill_swap_shown`) đếm khi dải có nút Refill, như trước đây đếm khi thẻ hiện.
 */
export function PdpBuyModeStrip({
  slug,
  variations,
  initialConfig,
  refill,
  retailOnly,
  refillExtra,
}: {
  slug: string;
  variations: PdpVariation[];
  initialConfig?: PublicConfig;
  /** Thẻ gói Refill máy chủ đã dựng; null khi chai chưa ghép gói hay gian hàng tạm nghỉ. */
  refill: PdpRefillOfferView | null;
  retailOnly: boolean;
  /** Lối sang trang mọi gói Refill (thành phần máy chủ), ngay dưới dải khi có nút Túi Refill. */
  refillExtra?: ReactNode;
}) {
  const subscribe = usePdpSubscribeOffer(slug, variations, initialConfig);
  const modes = pdpBuyModes({ refill, subscribe: !retailOnly && !!subscribe.selected, subscribePct: subscribe.pct });
  const [picked, setPicked] = useState<PdpBuyModeKey>('retail');
  const mode = pdpBuyModeOrRetail(modes, picked);

  // Đọc tham số sau khi gắn (máy chủ không biết URL đầy đủ): dựng HTML luôn là "Mua lẻ" để khỏi lệch khi hydrate.
  useEffect(() => {
    if (subscribeResumeRequested()) setPicked('subscribe');
  }, []);

  const refillShown = refill !== null && modes?.some((m) => m.key === 'refill') === true;
  useEffect(() => {
    if (refillShown) trackWebEvent('refill_swap_shown', { surface: 'pdp' });
  }, [refillShown, refill?.productId]);

  if (!modes) return null;
  return (
    <>
      <PdpBuyModes modes={modes} mode={mode} onModeChange={setPicked}>
        {mode === 'refill' && refill && <PdpRefillOfferBlock view={refill} trackShown={false} />}
        {mode === 'subscribe' && <PdpSubscribeRow slug={slug} variations={variations} initialConfig={initialConfig} />}
      </PdpBuyModes>
      {/* Ngoài phần theo chế độ: link nội bộ có sẵn trong HTML máy chủ dựng (dựng trang luôn là "Mua lẻ"), không đợi khách chọn Túi Refill. */}
      {refillShown && refillExtra}
    </>
  );
}
