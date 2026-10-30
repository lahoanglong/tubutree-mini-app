// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeasonPassState } from '@tubutree/app-core/api/game';
import { render, type Rendered } from '@/test-utils/dom';

vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/vuon-xanh' }));

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

describe('SeasonPass (web): khách vãng lai không được hứa Điểm Xanh', () => {
  const OPEN_PASS = {
    seasonTitle: 'Mùa xuân',
    xp: 120,
    premiumEligible: true,
    tiers: [{ tier: 0, xpRequired: 100, unlocked: true, claimedFree: false, claimedPremium: false, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 1000 } }],
  } as unknown as SeasonPassState;
  const show = (pass: SeasonPassState, onClaim = vi.fn()) => {
    mounted = render(<SeasonPass pass={pass} claimPending={false} claimVariables={undefined} onClaim={onClaim} />);
    return mounted.container;
  };
  const claims = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Nhận');

  it('user thật: thấy số điểm và nút Nhận ở cả hai nhánh, không có câu mời đăng nhập', () => {
    const c = show(OPEN_PASS);
    expect(c.textContent).toContain('1.000 điểm');
    expect(claims(c)).toHaveLength(2);
    expect(c.querySelector('[data-testid="guest-points-note"]')).toBeNull();
  });

  it('khách vãng lai: một câu mời đăng nhập, bậc Điểm Xanh không có số điểm và không có nút Nhận; bậc giọt nước vẫn nhận được', () => {
    const onClaim = vi.fn();
    const c = show({ ...OPEN_PASS, pointsBlocked: 'GUEST' }, onClaim);
    expect(c.querySelectorAll('[data-testid="guest-points-note"]')).toHaveLength(1);
    expect(c.querySelector('[data-testid="guest-points-note"]')!.textContent).toContain('Đăng nhập Zalo để nhận Điểm Xanh');
    expect(c.textContent).not.toContain('1.000 điểm');
    expect(claims(c)).toHaveLength(1);
    claims(c)[0]!.click();
    expect(onClaim).toHaveBeenCalledWith(0, 'free');
    expect(c.textContent).toContain('10💧');
  });

  it('khách vãng lai mà mùa chỉ có bậc giọt nước: không có câu mời đăng nhập', () => {
    const seedsOnly = { ...OPEN_PASS, pointsBlocked: 'GUEST', tiers: [{ ...OPEN_PASS.tiers![0]!, premium: { type: 'SEEDS', amount: 9 } }] } as unknown as SeasonPassState;
    const c = show(seedsOnly);
    expect(c.querySelector('[data-testid="guest-points-note"]')).toBeNull();
    expect(claims(c)).toHaveLength(2);
  });
});
