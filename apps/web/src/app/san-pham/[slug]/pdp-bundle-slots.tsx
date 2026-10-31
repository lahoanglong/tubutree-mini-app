import type { ReactNode } from 'react';

/**
 * Chỗ của "Combo ưu đãi" và "Mua kèm deal sốc" (P15 điền). Không có gì thì không render gì, cũng không giữ chỗ: trang không nhảy
 * và không có tiêu đề trơ.
 */
export function PdpBundleSlots({ combos, addons }: { combos?: ReactNode; addons?: ReactNode }) {
  if (!combos && !addons) return null;
  return (
    <div data-testid="pdp-bundle-slots" className="mt-3 flex flex-col gap-2">
      {combos}
      {addons}
    </div>
  );
}
