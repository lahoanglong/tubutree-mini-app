// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ value: null as string | null, get: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { storage: { get: store.get, set: store.set } } }));

import { applyFontScale, loadFontScale, saveFontScale } from './font-scale';

beforeEach(() => {
  vi.clearAllMocks();
  store.get.mockImplementation(async () => store.value);
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.fontScale;
});

// Cùng khoá `tubu_prefs`, cùng cỡ 15/16/18px và JSON {fontScale} với Mini App.
describe('cỡ chữ toàn web', () => {
  it('applyFontScale đặt cỡ gốc và data-font-scale', () => {
    applyFontScale('small');
    expect(document.documentElement.style.fontSize).toBe('15px');
    expect(document.documentElement.dataset.fontScale).toBe('small');
    applyFontScale('large');
    expect(document.documentElement.style.fontSize).toBe('18px');
    applyFontScale('normal');
    expect(document.documentElement.style.fontSize).toBe('16px');
  });

  it('loadFontScale đọc tubu_prefs; thiếu, hỏng hay giá trị lạ thì normal', async () => {
    store.value = JSON.stringify({ fontScale: 'large' });
    expect(await loadFontScale()).toBe('large');
    expect(store.get).toHaveBeenCalledWith('tubu_prefs');
    store.value = null;
    expect(await loadFontScale()).toBe('normal');
    store.value = '{khong-phai-json';
    expect(await loadFontScale()).toBe('normal');
    store.value = JSON.stringify({ fontScale: 'huge' });
    expect(await loadFontScale()).toBe('normal');
    store.get.mockRejectedValue(new Error('x'));
    expect(await loadFontScale()).toBe('normal');
  });

  it('saveFontScale ghi {fontScale} vào tubu_prefs', async () => {
    await saveFontScale('small');
    expect(store.set).toHaveBeenCalledWith('tubu_prefs', JSON.stringify({ fontScale: 'small' }));
  });
});
