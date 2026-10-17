// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIRST_TOUCH_COOKIE, readFirstTouchCookie } from '@/lib/entry-source';
import { EntrySourceCapture } from './entry-source-capture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EntrySourceCapture', () => {
  const clear = () => {
    document.cookie = `${FIRST_TOUCH_COOKIE}=; path=/; max-age=0`;
  };
  beforeEach(clear);
  afterEach(() => {
    clear();
    window.history.replaceState({}, '', '/');
  });

  async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<EntrySourceCapture />));
    await act(async () => root.unmount());
    host.remove();
  }

  it('mở trang bằng link có nguồn → lưu cookie chạm đầu', async () => {
    window.history.replaceState({}, '', '/san-pham/a?src=shopee&utm_campaign=card-2610');
    await mount();
    expect(readFirstTouchCookie()).toMatchObject({ source: 'shopee', campaign: 'card-2610' });
  });

  it('mở trang trần → không lưu gì', async () => {
    window.history.replaceState({}, '', '/san-pham/a');
    await mount();
    expect(readFirstTouchCookie()).toBeUndefined();
  });
});
