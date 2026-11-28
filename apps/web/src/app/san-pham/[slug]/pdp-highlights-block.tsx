'use client';

import { ecoFactLines } from '@tubutree/app-core/eco/facts';
import { pdpHighlights } from '@tubutree/app-core/commerce/pdp-highlights';
import { PdpHighlights } from '@/components/mini/pdp-highlights';
import { usePdpSelection } from '@/components/pdp-selection';

/**
 * Khối "Điểm nổi bật" của trang sản phẩm web: Điểm cộng xanh đọc theo phân loại đang chọn (`ecoFactLines`) nên chọn dòng ở trình duyệt, cùng luật
 * `pdpHighlights` với Mini App (tối đa 3 dòng gộp mô tả ngắn, Điểm cộng xanh, chứng nhận).
 */
export function PdpHighlightsBlock({
  benefit,
  certifications,
  ecoFacts,
  productSlug,
}: {
  benefit: string | null;
  certifications: readonly string[];
  ecoFacts: unknown;
  productSlug: string;
}) {
  const variationId = usePdpSelection()?.selectedId ?? null;
  const rows = pdpHighlights({ benefit, certifications, eco: ecoFactLines(ecoFacts, variationId) });
  return <PdpHighlights rows={rows} productSlug={productSlug} />;
}
