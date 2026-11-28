import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cfg: { isLoaded: true, seasonalTheme: undefined as string | undefined },
  imported: 0,
}));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
// Factory chỉ chạy khi chunk mùa lễ thật sự được import: đếm để chứng minh mùa "none" không tải gì.
vi.mock('../season/christmas-home', () => {
  mocks.imported += 1;
  return { default: () => <div data-testid="christmas-chunk" /> };
});

import { CHRISTMAS_HERO_HEIGHT } from '@tubutree/app-core/seasonal/seasonal-theme';
import { HomeSeasonSlot } from './home-season-slot';

beforeEach(() => {
  localStorage.clear();
  mocks.cfg = { isLoaded: true, seasonalTheme: undefined };
});

// Thứ tự có chủ ý: `lazy()` nhớ chunk đã về, nên các ca "không tải" và "khung giữ chỗ" chạy trước ca vẽ chunk.
describe('HomeSeasonSlot (theme.seasonal)', () => {
  it.each([undefined, 'none', 'tet', 'halloween'])('mùa %s: không vẽ gì, không tải chunk Noel', async (theme) => {
    mocks.cfg = { isLoaded: true, seasonalTheme: theme };
    const { container } = render(<HomeSeasonSlot />);
    expect(container.innerHTML).toBe('');
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.imported).toBe(0);
    expect(localStorage.getItem('tubu_season_hint')).toBe(theme === 'tet' ? 'tet' : 'none');
  });

  it('cấu hình chưa về: theo mùa lần trước (giữ chỗ đúng chiều cao thẻ) hoặc không giữ gì', () => {
    mocks.cfg = { isLoaded: false, seasonalTheme: undefined };
    const first = render(<HomeSeasonSlot />);
    expect(first.container.innerHTML).toBe('');
    first.unmount();
    localStorage.setItem('tubu_season_hint', 'christmas');
    render(<HomeSeasonSlot />);
    expect(screen.getByTestId('home-season-wait').style.height).toBe(`${CHRISTMAS_HERO_HEIGHT}px`);
    // Cấu hình chưa về thì không ghi đè lời nhắc.
    expect(localStorage.getItem('tubu_season_hint')).toBe('christmas');
  });

  it('mùa christmas: vẽ chunk Noel trong vỏ khối có lề như các khối khác, nhớ mùa cho lần mở sau', async () => {
    mocks.cfg = { isLoaded: true, seasonalTheme: 'christmas' };
    const { container } = render(<HomeSeasonSlot />);
    const shell = container.querySelector<HTMLElement>('[data-home-block="season"]')!;
    expect(shell.style.marginTop).toBe('var(--space-block)');
    expect(await screen.findByTestId('christmas-chunk')).toBeInTheDocument();
    expect(mocks.imported).toBe(1);
    expect(localStorage.getItem('tubu_season_hint')).toBe('christmas');
  });
});
