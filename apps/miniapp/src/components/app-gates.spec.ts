import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src', 'components', 'app.tsx'), 'utf8');

describe('cổng chào và cổng nhận mã ở app.tsx', () => {
  it('mỗi cổng có SilentBoundary riêng: cổng này lỗi tải không kéo cổng kia xuống', () => {
    const boundaries = [...src.matchAll(/<SilentBoundary>([\s\S]*?)<\/SilentBoundary>/g)].map((m) => m[1]);
    const onboarding = boundaries.filter((b) => b.includes('<OnboardingGate'));
    const claim = boundaries.filter((b) => b.includes('<CouponClaimGate'));
    expect(onboarding).toHaveLength(1);
    expect(claim).toHaveLength(1);
    expect(onboarding[0]).not.toContain('<CouponClaimGate');
    expect(claim[0]).not.toContain('<OnboardingGate');
  });

  it('cờ vào bằng link CTV tính ở entry rồi truyền xuống, không tính trong module lazy', () => {
    expect(src).toContain('hasPartnerLinkParams(window.location.search, window.location.hash)');
    expect(src).toContain('<OnboardingGate openedFromPartnerLink={OPENED_FROM_PARTNER_LINK} />');
  });
});
