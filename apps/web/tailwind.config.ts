import type { Config } from 'tailwindcss';
import stockColors from 'tailwindcss/colors';
import { tailwindPreset } from '@tubutree/design-tokens';

// Design System v2 (docs/superpowers/plans/2026-09-28-design-system-v2.md, Task 5) shares the
// `@tubutree/design-tokens` preset (forest-*/sage-*/stone-*/honey-*/terracotta-*, fonts, semantic
// radii) with apps/miniapp.
//
// ─── LEGACY v1 WEB PALETTE — TẠM THỜI (final review C2) ─────────────────────────────────────
// apps/web is NOT migrated in sub-project 3 (spec §7). Removing this palette made 1,049
// primary-/leaf-/sun-/neutral- class uses across 36 files emit NO CSS (login + checkout CTAs
// became white text on a transparent background). The block below restores, VERBATIM from the
// merge-base (22e36d4), what web rendered in production before this branch:
//   - custom primary/leaf/clay/sun/neutral hex;
//   - Tailwind's STOCK neutral shades web relied on implicitly (old `extend.neutral` merged
//     per-shade over the stock scale; the preset now sets `neutral: undefined`, which wipes the
//     stock scale — so the shades web still uses are re-added explicitly from tailwindcss/colors);
//   - old custom borderRadius sm/md/lg/xl.
// `extend` here merges AFTER the preset, so it wins over the preset's `neutral: undefined` and
// its clay-50/500/700. Delete shade-by-shade as web pages migrate to DS v2 (sub-project 4+).
// Shades web references that were ALSO undefined at the merge-base (primary-300/500/800,
// leaf-300/500/800, clay-800) are intentionally NOT invented here — parity with prod, not a
// redesign; see .superpowers/sdd/2026-09-28-design-system-v2/final-fix-report.md.
const legacyV1Colors = {
  primary: {
    50: '#FDF3E3',
    100: '#FBE4C4',
    200: '#F4C98A',
    400: '#EBA94A',
    600: '#E08C1C',
    700: '#B86A10',
    900: '#5C3505',
  },
  leaf: {
    50: '#EEF7D9',
    100: '#DCEFBE',
    200: '#BBD98A',
    400: '#95D222',
    600: '#509018',
    700: '#3C6D12',
    900: '#1F3A09',
  },
  clay: { 50: '#FBF4ED', 200: '#EDD4BD', 500: '#C97B4A', 700: '#8C4F2A' },
  sun: { 300: '#FDD96E', 500: '#F4B400' },
  neutral: {
    // Stock Tailwind neutral (what web got implicitly before this branch).
    ...stockColors.neutral,
    // Old custom overrides (win over stock, exactly as the old extend did).
    0: '#FFFFFF',
    50: '#FAFAF8',
    100: '#F2F2EF',
    200: '#E5E5E0',
    400: '#A8A8A0',
    600: '#5F5F58',
    900: '#1A1A17',
  },
};

const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: legacyV1Colors,
      borderRadius: { sm: '6px', md: '10px', lg: '16px', xl: '24px' },
    },
  },
  plugins: [],
};

export default config;
