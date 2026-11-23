// apps/miniapp/src/css/zaui-bridge.spec.ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PRUNED_ZMP_UI_COMPONENTS } from '../build-zaui-prune';

const css = readFileSync(new URL('./zaui-bridge.css', import.meta.url), 'utf-8');

const REQUIRED_VARS = [
  '--zaui-light-color-primary',
  '--zaui-light-button-primary-background',
  '--zaui-light-button-primary-background-pressed',
  '--zaui-light-button-primary-text',
  '--zaui-light-button-secondary-background',
  '--zaui-light-button-secondary-text',
  '--zaui-light-button-secondary-icon',
  '--zaui-light-button-tertiary-text',
  '--zaui-light-button-tertiary-icon',
];

describe('zaui-bridge.css', () => {
  it('nền mờ của zmp Sheet lấy token chung --color-bg-sheet-scrim, cùng màu với hai sheet web', () => {
    expect(css).toMatch(/--zaui-mask-overlay-color:\s*var\(--color-bg-sheet-scrim\)\s*;/);
  });
  it('overrides every required --zaui-light-* variable', () => {
    for (const v of REQUIRED_VARS) {
      expect(css, `missing override for ${v}`).toMatch(new RegExp(`${v}\\s*:`));
    }
  });
  it('không ghi đè biến của thành phần zmp-ui mà bản build đã cắt (luật đọc biến đó không còn trong CSS)', () => {
    const declared = [...css.matchAll(/(--zaui-light-[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? '');
    const dead = declared.filter((v) => PRUNED_ZMP_UI_COMPONENTS.some((c) => v.startsWith(`--zaui-light-${c}-`)));
    expect(dead).toEqual([]);
  });
  it('never hardcodes a raw hex — every override points at var(--color-* / --forest-* / --stone-*)', () => {
    const declarations = css.match(/--zaui-light-[a-z0-9-]+:\s*[^;]+;/g) ?? [];
    for (const d of declarations) {
      expect(d, d).toMatch(/var\(--/);
    }
  });
});
