import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('@tubutree/app-core/features');
  vi.resetModules();
});

describe('GAME_TABS theo cờ GAME_SOCIAL_ON_WEB', () => {
  it('cờ tắt (mặc định): không có tab Cộng đồng, khoá hợp lệ của ?tab= cũng không có', async () => {
    const { GAME_TABS, GAME_TAB_KEYS } = await import('./game-tabs');
    expect(GAME_TABS.map((t) => t.label)).toEqual(['Hôm nay', 'Vườn']);
    expect(GAME_TAB_KEYS).toEqual(['today', 'garden']);
  });

  it('cờ bật: tab Cộng đồng hiện lại như cũ, ở cuối', async () => {
    vi.resetModules();
    vi.doMock('@tubutree/app-core/features', () => ({ GAME_SOCIAL_ON_WEB: true }));
    const { GAME_TABS, GAME_TAB_KEYS } = await import('./game-tabs');
    expect(GAME_TABS.map((t) => t.label)).toEqual(['Hôm nay', 'Vườn', 'Cộng đồng']);
    expect(GAME_TAB_KEYS).toEqual(['today', 'garden', 'community']);
  });
});
