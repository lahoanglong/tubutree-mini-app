// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardEntry } from '@tubutree/app-core/api/feed';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';

// Chép ý community-leaderboard.spec.tsx (Mini App): cổng đăng nhập, đang khôi phục phiên, thứ tự API trả về, huy chương ba hạng đầu
// và #n sau đó, hạng thành viên + điểm uy tín, hàng tiêu đề cột, ảnh đại diện, bảng trống, lỗi + Thử lại, một h1 ở mọi trạng thái.

const mocks = vi.hoisted(() => ({
  auth: { user: null as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import LeaderboardPage from './page';

const ENTRY = (author: string, level: number, reputation: number, avatar: string | null = null): LeaderboardEntry => ({ author, avatar, reputation, level, levelName: `Hạng ${level}` });
const BOARD = [ENTRY('Lan Anh', 4, 980, 'https://img.test/lan.jpg'), ENTRY('Minh Tâm', 3, 640), ENTRY('Hà My', 2, 410), ENTRY('Quốc Bảo', 2, 120)];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<LeaderboardPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const h1 = (c: HTMLElement) => c.querySelectorAll('h1').length;

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.get.mockReset().mockResolvedValue(BOARD);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/cong-dong/xep-hang', () => {
  it('chưa đăng nhập: cổng đăng nhập mang returnTo, không tải bảng', async () => {
    mocks.auth.status = 'idle';
    const { container } = await mount();
    expect(container.textContent).toContain('Đăng nhập để xem cộng đồng');
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fcong-dong%2Fxep-hang"]')).not.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: không hiện cổng đăng nhập và không tải bảng', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    const { container } = await mount();
    expect(container.textContent).not.toContain('Đăng nhập để xem cộng đồng');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('mất kết nối lúc khôi phục phiên: nói đúng vậy, không mời đăng nhập lại', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.sessionUnavailable = true;
    const { container } = await mount();
    expect(container.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(container.textContent).not.toContain('Đăng nhập để xem cộng đồng');
  });

  it('gọi GET /feed/leaderboard, hiện đúng thứ tự API trả về, huy chương ba hạng đầu và #n sau đó', async () => {
    const { container } = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/feed/leaderboard');
    const t = container.textContent ?? '';
    expect(t.indexOf('Lan Anh')).toBeLessThan(t.indexOf('Minh Tâm'));
    expect(t.indexOf('Minh Tâm')).toBeLessThan(t.indexOf('Hà My'));
    expect(t.indexOf('Hà My')).toBeLessThan(t.indexOf('Quốc Bảo'));
    expect(t).toContain('#4');
    for (const s of ['🥇', '🥈', '🥉']) expect(t).not.toContain(s);
    const medals = Array.from(container.querySelectorAll('[role="img"]')).map((e) => e.getAttribute('aria-label'));
    expect(medals).toEqual(expect.arrayContaining(['Huy chương vàng', 'Huy chương bạc', 'Huy chương đồng']));
  });

  it('mỗi dòng hiện hạng thành viên (emoji + tên hạng) và điểm uy tín', async () => {
    const { container } = await mount();
    const t = container.textContent ?? '';
    expect(t).toContain('🏆 Hạng 4');
    expect(t).toContain('🌳 Hạng 3');
    expect(t.match(/🌿 Hạng 2/g)).toHaveLength(2);
    expect(t).toContain('980 điểm uy tín');
    expect(t).toContain('120 điểm uy tín');
  });

  it('có hàng tiêu đề cột Hạng / Thành viên / điểm uy tín', async () => {
    const { container } = await mount();
    for (const s of ['Hạng', 'Thành viên']) expect(byText(container, 'div,span', s)).not.toBeNull();
    expect(container.textContent).toContain('điểm uy tín');
  });

  it('có ảnh đại diện thì hiện ảnh; không có thì dùng biểu tượng, không dùng emoji 🌱', async () => {
    const { container } = await mount();
    expect(container.querySelector('img[src="https://img.test/lan.jpg"]')).not.toBeNull();
    mocks.get.mockResolvedValue([ENTRY('Minh Tâm', 3, 640)]);
    const solo = await mount();
    expect(solo.container.querySelector('img')).toBeNull();
    expect(solo.container.textContent).not.toContain('🌱');
  });

  it('ảnh đại diện lạ (javascript:) không thành thẻ img', async () => {
    mocks.get.mockResolvedValue([ENTRY('Minh Tâm', 3, 640, 'javascript:alert(1)')]);
    const { container } = await mount();
    expect(container.querySelector('img')).toBeNull();
  });

  it('bảng trống: hiện trạng thái trống', async () => {
    mocks.get.mockResolvedValue([]);
    const { container } = await mount();
    expect(container.textContent).toContain('Chưa có bài viết nào');
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.get.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(BOARD);
    const { container } = await mount();
    expect(container.textContent).toContain('mất mạng');
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(container.textContent).toContain('Lan Anh');
  });

  it('đúng một h1 "Bảng xếp hạng" ở mọi trạng thái, có liên kết quay lại cộng đồng', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    expect(h1((await mount()).container)).toBe(1);
    mocks.auth.initialized = true;
    const gate = await mount();
    expect(h1(gate.container)).toBe(1);
    expect(gate.container.textContent).not.toContain('🏆');
    mocks.auth.status = 'authenticated';
    mocks.get.mockReturnValue(new Promise(() => {}));
    expect(h1((await mount()).container)).toBe(1);
    mocks.get.mockReset().mockRejectedValue(new Error('x'));
    expect(h1((await mount()).container)).toBe(1);
    mocks.get.mockReset().mockResolvedValue(BOARD);
    const loaded = await mount();
    expect(loaded.container.querySelector('h1')!.textContent).toBe('Bảng xếp hạng');
    expect(loaded.container.querySelector('a[href="/cong-dong"]')).not.toBeNull();
    expect(unnamedControls(loaded.container)).toEqual([]);
  });
});

describe('/cong-dong/xep-hang — giao diện điện thoại như Mini App', () => {
  it('hàng xếp hạng không viền; tiêu đề trên thanh trắng, trang bỏ đệm 48px', async () => {
    const { container } = await mount();
    expect(container.querySelector('li')!.classList.contains('border')).toBe(false);
    expect(container.querySelector('main')!.hasAttribute('data-page-bleed')).toBe(true);
    expect(container.querySelector('h1')!.closest('header')!.parentElement!.className).toContain('max-md:bg-stone-0');
  });
});
