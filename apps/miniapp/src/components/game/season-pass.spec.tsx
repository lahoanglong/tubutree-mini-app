import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SeasonPassState } from '../../services/game-api';
import { vi as viText } from '../../i18n/vi';
import { SeasonPass } from './season-pass';
import { StreakRepair } from './streak-repair';

const PASS = {
  active: true,
  seasonTitle: 'Xuân',
  xp: 150,
  premiumEligible: false,
  tiers: [
    { tier: 0, xpRequired: 100, unlocked: true, claimedFree: true, claimedPremium: false, free: { type: 'SEEDS', amount: 5 }, premium: { type: 'POINTS', amount: 20 } },
    { tier: 1, xpRequired: 300, unlocked: false, claimedFree: false, claimedPremium: false, free: { type: 'SEEDS', amount: 5 }, premium: { type: 'POINTS', amount: 20 } },
  ],
} as unknown as SeasonPassState;

const renderPass = () => render(<SeasonPass pass={PASS} claimPending={false} claimVariables={undefined} onClaim={vi.fn()} />);

describe('SeasonPass — icon nét thay emoji (D7-6)', () => {
  it('tiêu đề khối có icon, chữ không còn emoji', () => {
    renderPass();
    const title = screen.getByRole('heading', { name: viText.game.seasonPass.title });
    expect(title.querySelector('svg')).not.toBeNull();
    expect(title.textContent).toBe(viText.game.seasonPass.title);
  });

  it('"Đã nhận" và nút "Chưa mở" mang icon nét; chữ không kèm ký tự ✓ 🔒', () => {
    renderPass();
    const claimed = screen.getByText(viText.game.seasonPass.claimed);
    expect(claimed.textContent).toBe('Đã nhận');
    expect(claimed.querySelector('svg')).not.toBeNull();
    const locked = screen.getAllByRole('button', { name: viText.game.seasonPass.locked });
    expect(locked.length).toBeGreaterThan(0);
    for (const b of locked) expect(b.querySelector('svg')).not.toBeNull();
  });

  it('gợi ý Premium có icon khoá, chữ không kèm emoji', () => {
    renderPass();
    const hint = screen.getByText(viText.game.seasonPass.premiumHint);
    expect(hint.querySelector('svg')).not.toBeNull();
    expect(hint.textContent).toBe(viText.game.seasonPass.premiumHint);
  });
});

describe('StreakRepair — icon nét thay emoji (D7-6)', () => {
  it('tiêu đề "Bạn vừa mất chuỗi N ngày" có icon, chữ không kèm emoji', () => {
    render(<StreakRepair brokenStreakDays={7} cost={50} pending={false} onRepair={vi.fn()} />);
    const title = screen.getByText('Bạn vừa mất chuỗi 7 ngày');
    expect(title.querySelector('svg')).not.toBeNull();
  });
});

describe('SeasonPass — bậc đang khoá vẫn đọc được (D8-6)', () => {
  it('hàng bậc khoá không bị làm mờ bằng opacity và không dùng nền stone-100 (chữ vàng chỉ 4,24:1 trên đó)', () => {
    renderPass();
    const lockedRow = screen.getByText(viText.game.seasonPass.tier(2)).closest('div[style*="padding: 12px"]') as HTMLElement;
    expect(lockedRow).not.toBeNull();
    expect(lockedRow.style.opacity).toBe('');
    expect(lockedRow.style.background).not.toContain('--stone-100');
    const unlockedRow = screen.getByText(viText.game.seasonPass.tier(1)).closest('div[style*="padding: 12px"]') as HTMLElement;
    expect(unlockedRow.style.opacity).toBe('');
  });
});

