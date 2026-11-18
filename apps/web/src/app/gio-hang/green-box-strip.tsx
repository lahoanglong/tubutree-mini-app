'use client';

// Nguồn: GreenBoxStrip / GreenBoxEvents trong apps/miniapp/src/pages/cart.tsx (cùng chữ, cùng test-id, cùng khung tubu-freeship).
import { useEffect, useRef } from 'react';
import { greenBoxTierRise, greenBoxWebCopy, type GreenBoxProgressView, type GreenBoxState } from '@tubutree/app-core/commerce/green-box';
import { Button } from '@/components/mini/button';
import { trackWebEvent } from '@/lib/analytics';

/**
 * Dải Hộp Xanh ở đầu giỏ, thay chỗ dải Miễn phí giao hàng khi đã đạt ngưỡng (một dải tại một thời điểm). Dùng chung khung `tubu-freeship` nên đổi dải
 * không đổi chiều cao. Bậc cao nhất: một dòng xác nhận, không thanh, không nút.
 */
export function GreenBoxStrip({ view, onMore }: { view: GreenBoxProgressView; onMore: () => void }) {
  const label = <p className="tubu-freeship-text">{view.text}</p>;
  if (view.done) {
    return (
      <div data-testid="green-box-progress" data-reached="true" aria-live="polite" className="tubu-freeship">
        {label}
      </div>
    );
  }
  return (
    <div data-testid="green-box-progress" data-reached="false" data-cta="true" aria-live="polite" className="tubu-freeship">
      <div className="tubu-freeship-head">
        {label}
        <Button variant="secondary" className="tubu-freeship-cta" data-testid="green-box-more-cta" aria-label={greenBoxWebCopy('ctaAria')} onPress={onMore}>
          {greenBoxWebCopy('cta')}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.pct}
        aria-label={view.marksText}
        className="tubu-freeship-track"
      >
        <div className="tubu-freeship-fill" style={{ width: `${view.pct}%` }} />
      </div>
      <p className="tubu-freeship-text" data-testid="green-box-marks">
        {view.marksText}
      </p>
    </div>
  );
}

/** Sự kiện Hộp Xanh của một lần mở giỏ: lần đầu thấy tiến độ, và mỗi lần bậc tăng (không tính lần đọc đầu, giỏ mở ra đã ở bậc đó). */
export function GreenBoxEvents({ state, visible }: { state: GreenBoxState | null; visible: boolean }) {
  const shownRef = useRef(false);
  const tierRef = useRef<number | null>(null);
  const items = state?.items ?? null;
  const tier = state ? (state.tier?.minItems ?? 0) : null;
  useEffect(() => {
    if (items === null || tier === null) return;
    if (visible && !shownRef.current) {
      shownRef.current = true;
      trackWebEvent('green_box_progress_shown', { items, tier });
    }
    const rise = greenBoxTierRise(tierRef.current, tier);
    if (rise !== null) trackWebEvent('green_box_tier_reached', { tier: rise });
    tierRef.current = tier;
  }, [items, tier, visible]);
  return null;
}
