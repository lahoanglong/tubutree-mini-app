import type { Config } from 'tailwindcss';
import { tailwindPreset } from '@tubutree/design-tokens';

// Design System v2 (docs/superpowers/plans/2026-09-28-design-system-v2.md, Task 5): the
// hand-duplicated primary/leaf/clay/sun/neutral hex palette (drifted from apps/miniapp's own
// copy — audit A4-27/A4-28) is retired in favor of the shared `@tubutree/design-tokens` preset,
// so both apps style from forest-*/sage-*/stone-*/clay-*/honey-*/terracotta-* — ONE source.
const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
