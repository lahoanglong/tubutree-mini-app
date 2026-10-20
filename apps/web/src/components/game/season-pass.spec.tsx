// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeasonPassState } from '@tubutree/app-core/api/game';
import { render, type Rendered } from '@/test-utils/dom';
import { SeasonPass } from './season-pass';

const PASS = {
  seasonTitle: 'Mùa xuân',
  xp: 120,
  premiumEligible: true,
  tiers: [
    { tier: 0, xpRequired: 100, unlocked: true, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 1000 }, freeClaimed: false, premiumClaimed: false },
    { tier: 1, xpRequired: 300, unlocked: false, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 2000 }, freeClaimed: false, premiumClaimed: false },
  ],
} as unknown as SeasonPassState;

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('SeasonPass — bậc khoá', () => {
  it('bậc khoá nền trắng + viền nét đứt đậm, không làm mờ (chữ giữ ≥ 4,5:1); bậc mở nền subtle', () => {
    mounted = render(<SeasonPass pass={PASS} claimPending={false} claimVariables={undefined} onClaim={vi.fn()} />);
    const rows = Array.from(mounted.container.querySelectorAll<HTMLElement>('div.rounded-control.p-3'));
    expect(rows).toHaveLength(2);
    const [open, locked] = rows;
    expect(locked!.className).not.toContain('opacity-');
    expect(locked!.className).toContain('border-dashed');
    expect(locked!.className).toContain('--color-border-strong');
    expect(locked!.className).toContain('bg-stone-0');
    expect(open!.className).toContain('bg-stone-50');
    expect(open!.className).not.toContain('border-dashed');
  });
});
