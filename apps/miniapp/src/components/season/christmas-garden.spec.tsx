import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XMAS_TREE_KEY, xmasTreeCopy as c, type OrnamentProgress } from '@tubutree/app-core/seasonal/xmas-tree';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  shareLink: vi.fn(() => Promise.resolve()),
  user: { fullName: 'Lan', referralCode: 'LAN01' } as { fullName?: string; referralCode?: string } | null,
}));
vi.mock('../../utils/sfx', () => ({ sfx: { play: (cue: string) => mocks.play(cue) } }));
vi.mock('../../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { user: typeof mocks.user }) => unknown) => sel({ user: mocks.user }) }));
vi.mock('../ui/bottom-sheet', () => ({
  BottomSheet: ({ open, title, footer, children }: { open: boolean; title: string; footer?: ReactNode; children: ReactNode }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}));

import ChristmasGarden from './christmas-garden';

const NEW: OrnamentProgress = { streakDays: 0, activeToday: false, drops: 0, harvested: 0 };
const renderGarden = (progress: OrnamentProgress = NEW) => render(<ChristmasGarden progress={progress} plain={<span data-testid="plain-tree" />} />);
const openTray = () => fireEvent.click(screen.getByTestId('xmas-decorate'));
const stored = () => JSON.parse(localStorage.getItem(XMAS_TREE_KEY) ?? 'null') as { u: string[]; on: string[] } | null;

beforeEach(() => {
  localStorage.clear();
  mocks.play.mockClear();
  mocks.shareLink.mockClear();
  mocks.user = { fullName: 'Lan', referralCode: 'LAN01' };
});

describe('ChristmasGarden (Mini): Cây Thông Noel Tự Trang Trí', () => {
  it('thẻ đầu: cây thông, tuyết, nút Trang trí đếm món; cây thường không vẽ', () => {
    renderGarden();
    expect(screen.getByTestId('xmas-tree')).toHaveAccessibleName(c.treeAria(0));
    expect(document.querySelectorAll('.tubu-xgd-snow .tubu-xmas-flake')).toHaveLength(12);
    expect(screen.getByTestId('xmas-decorate')).toHaveTextContent(`${c.decorate}${c.count(0)}`);
    expect(screen.getByTestId('xmas-decorate').getAttribute('data-ready')).toBe('true');
    expect(screen.queryByTestId('plain-tree')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('khay 6 ô: món đủ điều kiện mở và treo luôn (chuông), chạm lần nữa cất (pop), lưu trên máy', () => {
    renderGarden();
    openTray();
    expect(screen.getByRole('dialog', { name: c.sheetTitle })).toBeInTheDocument();
    expect(screen.getAllByRole('button').filter((b) => b.classList.contains('tubu-xgd-slot'))).toHaveLength(6);
    const star = screen.getByTestId('xmas-slot-star');
    expect(star.getAttribute('data-state')).toBe('ready');
    expect(star).toHaveAccessibleName(c.slotAria(c.names.star, 'ready', c.hints.star));

    fireEvent.click(star);
    expect(star.getAttribute('data-state')).toBe('on');
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('xmas-msg')).toHaveTextContent(c.unlocked(c.names.star));
    expect(mocks.play).toHaveBeenLastCalledWith('bell');
    expect(stored()).toEqual({ u: ['star'], on: ['star'] });
    expect(screen.getByTestId('xmas-decorate')).toHaveTextContent(c.count(1));
    expect(document.querySelectorAll('[data-orn="star"]').length).toBeGreaterThan(0);

    fireEvent.click(star);
    expect(star.getAttribute('data-state')).toBe('off');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('xmas-msg')).toHaveTextContent(c.off(c.names.star));
    expect(mocks.play).toHaveBeenLastCalledWith('pop');
    expect(stored()).toEqual({ u: ['star'], on: [] });
  });

  it('món chưa đủ mốc: không đổi gì, hiện lời nhắc cách mở, không kêu, không ghi bộ nhớ', () => {
    renderGarden();
    openTray();
    const deer = screen.getByTestId('xmas-slot-reindeer');
    expect(deer.getAttribute('data-state')).toBe('locked');
    expect(deer.hasAttribute('aria-pressed')).toBe(false);
    expect(deer.querySelector('.tubu-xgd-lock')).not.toBeNull();
    fireEvent.click(deer);
    expect(deer.getAttribute('data-state')).toBe('locked');
    expect(screen.getByTestId('xmas-msg')).toHaveTextContent(c.hints.reindeer);
    expect(mocks.play).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it('mốc đủ cả 6 (chuỗi 7 ngày, 50💧, đã thu hoạch, chăm hôm nay): mọi ô sẵn sàng', () => {
    renderGarden({ streakDays: 7, activeToday: true, drops: 50, harvested: 1 });
    openTray();
    for (const id of ['star', 'lights', 'baubles', 'gifts', 'reindeer', 'wreath']) expect(screen.getByTestId(`xmas-slot-${id}`).getAttribute('data-state')).toBe('ready');
  });

  it('mở lại app: đọc món đã treo từ máy; dữ liệu hỏng thì cây trống, không vỡ', () => {
    localStorage.setItem(XMAS_TREE_KEY, JSON.stringify({ u: ['star', 'gifts'], on: ['gifts'] }));
    const { unmount } = renderGarden();
    expect(screen.getByTestId('xmas-decorate')).toHaveTextContent(c.count(1));
    expect(screen.getByTestId('xmas-decorate').hasAttribute('data-ready')).toBe(false);
    unmount();
    localStorage.setItem(XMAS_TREE_KEY, '{hỏng');
    renderGarden();
    expect(screen.getByTestId('xmas-decorate')).toHaveTextContent(c.count(0));
  });

  it('Gửi qua Zalo: shareLink kèm tên, số món, đường dẫn mời có mã giới thiệu; chạm đúp chỉ gửi một lần', async () => {
    let resolve = () => {};
    mocks.shareLink.mockImplementationOnce(() => new Promise<void>((r) => (resolve = r)));
    localStorage.setItem(XMAS_TREE_KEY, JSON.stringify({ u: ['star'], on: ['star'] }));
    renderGarden();
    openTray();
    expect(screen.getByTestId('xmas-card')).toHaveTextContent(c.cardLine('Lan', 1));
    const cta = screen.getByRole('button', { name: c.shareCta });
    fireEvent.click(cta);
    fireEvent.click(cta);
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
    expect(mocks.shareLink).toHaveBeenCalledWith({ title: c.zaloTitle('Lan'), description: c.zaloText(1), path: expect.stringMatching(/^\/game\?.*LAN01/) });
    await act(async () => resolve());
  });

  it('hồ sơ chưa có tên: thiệp ghi "Mình"; shareLink lỗi thì nút mở lại, không ném', async () => {
    mocks.user = null;
    mocks.shareLink.mockImplementationOnce(() => Promise.reject(new Error('cancel')));
    renderGarden();
    openTray();
    expect(screen.getByTestId('xmas-card')).toHaveTextContent(c.cardLine(c.me, 0));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: c.shareCta })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: c.shareCta })));
    expect(mocks.shareLink).toHaveBeenCalledTimes(2);
  });
});
