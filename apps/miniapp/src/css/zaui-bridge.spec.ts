// apps/miniapp/src/css/zaui-bridge.spec.ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

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
  '--zaui-light-input-border-color',
  '--zaui-light-input-hover-border-color',
  '--zaui-light-input-text-color',
  '--zaui-light-checkbox-checked-background',
  '--zaui-light-checkbox-checked-mark-color',
  '--zaui-light-radio-checked-background',
  '--zaui-light-radio-checked-mark-color',
  '--zaui-light-switch-bg-color',
  '--zaui-light-spinner-dot-color',
  '--zaui-light-spinner-border-color',
  '--zaui-light-tabbar-active-line',
  '--zaui-light-tabbar-label-active',
  '--zaui-light-progress-completed',
  '--zaui-light-bottom-navigation-active-color',
];

describe('zaui-bridge.css', () => {
  it('overrides every required --zaui-light-* variable', () => {
    for (const v of REQUIRED_VARS) {
      expect(css, `missing override for ${v}`).toMatch(new RegExp(`${v}\\s*:`));
    }
  });
  it('never hardcodes a raw hex — every override points at var(--color-* / --forest-* / --stone-*)', () => {
    const declarations = css.match(/--zaui-light-[a-z0-9-]+:\s*[^;]+;/g) ?? [];
    for (const d of declarations) {
      expect(d, d).toMatch(/var\(--/);
    }
  });
});
