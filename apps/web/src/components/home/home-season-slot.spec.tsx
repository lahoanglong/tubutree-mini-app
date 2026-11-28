// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ theme: undefined as string | undefined, imported: 0 }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, seasonalTheme: mocks.theme }) }));
// `next/dynamic` thu gọn: vẽ `loading` tới khi import xong, như bản thật với `ssr: false`.
vi.mock('next/dynamic', async () => {
  const { useEffect, useState, createElement } = await import('react');
  return {
    default: (load: () => Promise<{ default: () => ReactElement }>, opts: { loading: () => ReactElement }) =>
      function Dynamic() {
        const [C, setC] = useState<null | (() => ReactElement)>(null);
        useEffect(() => void load().then((m) => setC(() => m.default)), []);
        return C ? createElement(C) : opts.loading();
      },
  };
});
vi.mock('./season/christmas-home', () => {
  mocks.imported += 1;
  return { default: () => <div data-testid="christmas-chunk" /> };
});

import { CHRISTMAS_HERO_HEIGHT } from '@tubutree/app-core/seasonal/seasonal-theme';
import { HomeSeasonSlot } from './home-season-slot';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeSeasonSlot web (theme.seasonal)', () => {
  it.each([undefined, 'none', 'tet'])('mùa %s: không vẽ gì, không tải chunk Noel', async (theme) => {
    mocks.theme = theme;
    mounted = render(<HomeSeasonSlot />);
    await flush(3);
    expect(mounted.container.innerHTML).toBe('');
    expect(mocks.imported).toBe(0);
  });

  it('mùa christmas: giữ chỗ đúng chiều cao thẻ rồi vẽ chunk Noel', async () => {
    mocks.theme = 'christmas';
    mounted = render(<HomeSeasonSlot />);
    const wait = mounted.container.querySelector<HTMLElement>('[data-testid="home-season-wait"]');
    expect(wait?.style.height).toBe(`${CHRISTMAS_HERO_HEIGHT}px`);
    await flush(3);
    expect(mounted.container.querySelector('[data-home-block="season"] [data-testid="christmas-chunk"]')).not.toBeNull();
    expect(mocks.imported).toBe(1);
  });
});
