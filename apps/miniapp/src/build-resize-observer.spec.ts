import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('build-resize-observer: thay resize-observer-polyfill bằng API có sẵn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('trả đúng ResizeObserver của trình duyệt khi có', async () => {
    class Native {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', Native);
    const mod = await import('./build-resize-observer');
    expect(mod.default).toBe(Native);
  });

  it('máy thiếu API: lớp rỗng, gọi observe/disconnect không ném lỗi', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const mod = await import('./build-resize-observer');
    const ro = new mod.default(() => {});
    expect(() => {
      ro.observe({} as Element);
      ro.unobserve({} as Element);
      ro.disconnect();
    }).not.toThrow();
  });

  it('vite.config.mts trỏ resize-observer-polyfill về file này và target build không thấp hơn safari13.1 (nơi ResizeObserver có sẵn)', () => {
    const cfg = fs.readFileSync(path.resolve(here, '../vite.config.mts'), 'utf8');
    expect(cfg).toMatch(/'resize-observer-polyfill':\s*fileURLToPath\(new URL\('\.\/src\/build-resize-observer\.ts'/);
    expect(cfg).toContain("target: ['es2020', 'safari13.1']");
  });
});
