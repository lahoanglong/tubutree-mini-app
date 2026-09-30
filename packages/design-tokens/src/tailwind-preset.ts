// packages/design-tokens/src/tailwind-preset.ts
import type { Config } from 'tailwindcss';

/** Exposes tokens.css's PRIMITIVE color scales (forest/sage/stone/clay/honey/terracotta), fonts
 * and semantic radii as Tailwind theme values, so apps/web and apps/miniapp style from ONE
 * source instead of hand-copying hex (the drift audit A4-27/A4-28 found between the two apps).
 * It extends — never re-keys — Tailwind's stock scales (see the `spacing` note below). */
export const tailwindPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        // `neutral: undefined` suppresses Tailwind's OWN built-in `neutral` scale (stock cool
        // grays, e.g. bg-neutral-50 -> #fafafa). Without this, since we never define a custom
        // `neutral` key here, Tailwind's stock one silently shows through `extend` -- it looks
        // plausible and renders, unlike our genuinely-retired primary-*/leaf-*/sun-* names,
        // which correctly produce NO CSS. Verified empirically via an isolated CLI build
        // (packages/design-tokens preset fix round, Task 5) -- do not remove without re-testing.
        // Tailwind's official .d.ts types theme.extend.colors as RecursiveKeyValuePair<string,
        // string> (no `undefined` in the union) even though `undefined` is Tailwind's documented
        // runtime mechanism for removing a default color -- hence the ts-expect-error below.
        // @ts-expect-error -- intentional: see comment above.
        neutral: undefined,
        forest: {
          50: '#EEF4EF', 100: '#D6E6DA', 200: '#B1CFB9', 300: '#86B293', 400: '#5B9170',
          500: '#3B7552', 600: '#245E3E', 700: '#1B4B31', 800: '#143A26', 900: '#0D291B',
        },
        sage: { 50: '#F2F5EC', 100: '#E3EBD8', 600: '#4A6135', 700: '#3E5129' },
        stone: {
          0: '#FFFFFF', 25: '#FBFAF7', 50: '#F6F4EF', 100: '#EFEBE2', 200: '#E0DACB',
          300: '#CBC5B8', 400: '#9E978A', 450: '#938B7E', 500: '#746D61', 600: '#5A544A',
          700: '#423D34', 800: '#2B2721', 900: '#1C1A16',
          // Tailwind's own stock `stone` scale defines a 950 shade we don't -- extend merges
          // per-shade (not a full replace of the `stone` family), so without this explicit
          // `undefined` Tailwind's stock stone-950 (#0c0a09) silently leaks through. Verified
          // empirically (see note above). Same ts-expect-error reason as `neutral` above.
          // @ts-expect-error -- intentional: see comment above `neutral: undefined`.
          950: undefined,
        },
        clay: { 50: '#FAF1EA', 100: '#F2DFD0', 500: '#C2410C', 600: '#9C532C', 700: '#7E4222' },
        honey: { 500: '#B07A00', 600: '#96650A' },
        terracotta: { 50: '#FFF1E8', 600: '#C2410C' },
        'tubu-orange': '#E08C1C',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        ui: ['Inter', 'system-ui', 'sans-serif'],
      },
      // NO `spacing` key here, on purpose (final review C2). Re-keying Tailwind's numeric scale
      // (p-4 = 12px instead of 16px, h-10 = 48px instead of 40px...) silently re-scaled ~1,700
      // utilities in apps/web, the only Tailwind-utility consumer. Spacing semantics live in
      // tokens.css (--space-*). An app that truly needs a custom scale defines it in its OWN
      // tailwind.config.ts. Guarded by tailwind-preset.spec.ts.
      borderRadius: { control: '12px', card: '16px', media: '12px', sheet: '24px' },
    },
  },
};
