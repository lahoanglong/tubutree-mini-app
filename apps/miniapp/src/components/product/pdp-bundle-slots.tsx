import type { ReactNode } from 'react';

/**
 * Chỗ của "Combo ưu đãi" và "Mua kèm deal sốc" (P15 điền). Không có gì thì không render gì, cũng không giữ chỗ: PDP không nhảy
 * và không có tiêu đề trơ.
 */
export function PdpBundleSlots({ combos, addons }: { combos?: ReactNode; addons?: ReactNode }) {
  if (!combos && !addons) return null;
  return (
    <div data-testid="pdp-bundle-slots" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {combos}
      {addons}
    </div>
  );
}
