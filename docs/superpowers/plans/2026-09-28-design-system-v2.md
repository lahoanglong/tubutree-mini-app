# Design System v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real 3-layer design-token system + 17 core components + lint guardrails for Tubu Tree's miniapp/web, then prove it by migrating the repeat-purchase pilot flow (PDP → cart → checkout → order detail/list → CTV storefront).

**Architecture:** New `packages/design-tokens` publishes primitive+semantic CSS variables and a Tailwind preset; both `apps/web` (already Tailwind) and `apps/miniapp` (newly gets Tailwind) extend it. ZaUI (zmp-ui) stays as the behavioral layer for Sheet/Input/Picker/Spinner — only its `--zaui-light-*` CSS variables get bridged to the new semantic tokens. 17 presentational React components replace ad-hoc `style={{}}` usage; ESLint rules block regressions in new code.

**Tech Stack:** Tailwind CSS 3.4 (matching `apps/web`'s installed version), PostCSS 8, vanilla CSS custom properties, `zmp-ui` 1.11.14, `lucide-react` 1.18, `@tanstack/react-query` 5, Vitest (miniapp), Playwright (`apps/e2e`).

**Spec:** `docs/superpowers/specs/2026-09-28-design-system-v2-design.md`

## Global Constraints

- Action/CTA background token is `forest-600 #245E3E` (7.65:1 on white, AAA) — never the old `primary-600 #E08C1C`.
- Logo pot color uses `forest-800 #143A26` / `forest-900 #0D291B` — darker than UI action color, not subject to the same contrast rule (graphic mark, not text).
- Font: Fraunces (display, weight 500/600) + Inter (UI/body, weight 400/500), self-hosted — never load fonts from `fonts.googleapis.com` at runtime (Zalo WebView may block/slow it, per audit).
- No raw hex/rgba color literal in new `style={{}}`/JSX (enforced by lint from Task 6 onward) — always `var(--token)` or a Tailwind class resolving to a token.
- No `fontSize` inline in new code — always a `Text`/`Heading` `variant`.
- Every touch target ships at minimum 44×44px (existing `.zaui-btn-small` override in `tokens.css:423-433` already enforces this for ZaUI buttons; new components must match it).
- `Button`/any component with a `loading` prop must NEVER also pass that same flag as `disabled` to the underlying ZaUI `<Button>` — ZaUI only draws its spinner when `loading && !disabled` (`node_modules/.../zmp-ui/esm/components/button/index.js:45,61`). This exact bug exists today in `empty-state.tsx:96`, `checkout/address-section.tsx:268`, `pages/addresses.tsx:189,345` — Task 21 (EmptyState) and Task 20 (AddressForm) fix their own instances; the new `Button` component (Task 11) must make the bug structurally impossible for all future callers.
- Do not touch business logic, API contracts, or route structure while migrating a page — only the presentation layer. If a real bug is found while touching a file already open for migration (e.g. A4-06's missing flash price/out-of-stock overlay on storefront/brand grids), fix it in that same task since the file is already open.
- Miniapp's real build path is Vite (`vite build`, `zmp-vite-plugin` + `@vitejs/plugin-react`, confirmed via `apps/miniapp/vite.config.mts`) — `zmp start`/`zmp deploy` only package/upload, they never touch CSS. Adding Tailwind is a normal Vite/PostCSS change; it does not touch the Zalo deploy pipeline.

## Review Focus

- **Existing pages importing the OLD `Btn`/`Txt`/`Card`/`Badge`/`Chip`/`SectionHeader`/`StickyActionBar`/`ListRow`/`Price`/`DiscountPct` from `components/ui/primitives.tsx` and `components/ui/price.tsx` after those files are replaced in Tasks 9-25** — only `ui/tier-badge.tsx` currently imports `Badge` (per audit A4-07); a task that deletes/renames an export without checking real importers will silently break the one page that already tried to use the old system.
- **`AddressSection`'s create-only `AddressForm` losing the geo prefill/edit-mode behavior `addresses.tsx`'s version has** — Task 20 merges two nearly-identical private components; the merge must keep both call sites' current behavior (create-only inline vs. edit-capable in a sheet) or a real address correction flow silently breaks.
- **`ProductTile`'s `action="rebuy"` variant silently returning a broken/no-op button if `order-detail.tsx`'s current repurchase mutation signature doesn't match what Task 25 assumes** — must read the real current repurchase code before wiring it, not guess the signature.
- **Storefront/brand grid items losing the flash-sale price override and out-of-stock overlay that `product-card.tsx`/`ProductTile` compute, if `StorePage`'s shared shell (Task 29) renders grid items with its own hand-rolled price math instead of delegating to `ProductTile`** — this is audit finding A4-06, and re-introducing it while "fixing" the design system would be an own-goal.
- **Migrated buttons on `checkout.tsx`/`bank-payment.tsx` losing their existing `disabled` conditions (e.g. "Mua ngay" disabled until a variation is selected) when swapped for the new `Button`** — the new component's `loading`/`disabled` handling must be a strict superset of every current disablement condition, verified per page, not just per component in isolation.

---

## Task 1: `packages/design-tokens` — primitive + semantic CSS layer + Tailwind preset

**Files:**
- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/src/tokens.css` (primitive + semantic CSS custom properties)
- Create: `packages/design-tokens/src/tailwind-preset.ts` (Tailwind preset mirroring the same values)
- Create: `packages/design-tokens/src/index.ts` (re-exports preset + a `TOKENS_CSS_PATH` constant)
- Test: `packages/design-tokens/src/tokens.spec.ts`

**Interfaces:**
- Produces: `tailwindPreset` (a `Partial<import('tailwindcss').Config>` object) importable as `import { tailwindPreset } from '@tubutree/design-tokens'`; `src/tokens.css` importable by path `@tubutree/design-tokens/src/tokens.css` for apps that load raw CSS (miniapp).
- Consumes: nothing (first task).

- [ ] **Step 1: Scaffold the package**

`packages/design-tokens/package.json`:
```json
{
  "name": "@tubutree/design-tokens",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./css": "./src/tokens.css" },
  "devDependencies": {
    "@tubutree/typescript-config": "workspace:*",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  },
  "peerDependencies": { "tailwindcss": "^3.4.0" }
}
```

- [ ] **Step 2: Write the failing test (primitive + semantic values are present and correct)**

```typescript
// packages/design-tokens/src/tokens.spec.ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8');

describe('design-tokens/tokens.css', () => {
  it('defines the forest primitive scale used as the primary action color', () => {
    expect(css).toMatch(/--forest-600:\s*#245E3E/i);
    expect(css).toMatch(/--forest-700:\s*#1B4B31/i);
    expect(css).toMatch(/--forest-800:\s*#143A26/i);
    expect(css).toMatch(/--forest-900:\s*#0D291B/i);
  });

  it('defines semantic color.action.primary tokens pointing at forest-600/700', () => {
    expect(css).toMatch(/--color-action-primary-bg:\s*var\(--forest-600\)/);
    expect(css).toMatch(/--color-action-primary-bg-pressed:\s*var\(--forest-700\)/);
    expect(css).toMatch(/--color-action-primary-fg:\s*#fff/i);
  });

  it('defines the warm stone neutral scale (replaces old cool neutral-*)', () => {
    expect(css).toMatch(/--stone-50:\s*#F6F4EF/i);
    expect(css).toMatch(/--stone-500:\s*#746D61/i);
  });

  it('does not define the old --primary-* (orange) scale as a UI color — only as tubu-orange for logo use', () => {
    expect(css).not.toMatch(/--primary-600/);
    expect(css).toMatch(/--tubu-orange:\s*#E08C1C/i);
  });

  it('keeps a dealer theme override block scoped to [data-theme="dealer"], touching only semantic layer', () => {
    expect(css).toMatch(/\[data-theme=['"]dealer['"]\]\s*\{/);
  });
});
```

- [ ] **Step 2b: Run it to verify it fails**

Run: `pnpm --filter @tubutree/design-tokens exec vitest run` — expect FAIL (file `tokens.css` doesn't exist yet).

- [ ] **Step 3: Write `src/tokens.css`**

```css
/* packages/design-tokens/src/tokens.css — Design System v2. Single source of truth for
 * color/type/space/radius/motion/z-index. Layer 1 (primitive) below is NEVER referenced
 * outside this file — pages/components use Layer 2 (semantic) only. */
:root {
  /* ── Layer 1: PRIMITIVE ─────────────────────────────────────────────────── */
  --forest-50: #EEF4EF;
  --forest-100: #D6E6DA;
  --forest-200: #B1CFB9;
  --forest-300: #86B293;
  --forest-400: #5B9170;
  --forest-500: #3B7552;
  --forest-600: #245E3E;
  --forest-700: #1B4B31;
  --forest-800: #143A26;
  --forest-900: #0D291B;

  --sage-50: #F2F5EC;
  --sage-100: #E3EBD8;
  --sage-600: #4A6135;
  --sage-700: #3E5129;

  --stone-0: #FFFFFF;
  --stone-25: #FBFAF7;
  --stone-50: #F6F4EF;
  --stone-100: #EFEBE2;
  --stone-200: #E0DACB;
  --stone-300: #CBC5B8;
  --stone-400: #9E978A;
  --stone-450: #938B7E;
  --stone-500: #746D61;
  --stone-600: #5A544A;
  --stone-700: #423D34;
  --stone-800: #2B2721;
  --stone-900: #1C1A16;

  --clay-50: #FAF1EA;
  --clay-100: #F2DFD0;
  --clay-500: #C2410C;
  --clay-600: #9C532C;
  --clay-700: #7E4222;

  --honey-500: #B07A00;
  --honey-600: #96650A;
  --terracotta-50: #FFF1E8;
  --terracotta-600: #C2410C;

  --tubu-orange: #E08C1C; /* logo/illustration ONLY — never a UI action color */

  --red-50: #FBEAE8;
  --red-600: #B3362F;
  --red-700: #8F2B25;
  --amber-50: #FFF4E0;
  --amber-600: #8A5300;
  --blue-50: #E8F0F7;
  --blue-600: #2E6391;
  --blue-700: #245075;

  --p-space-0: 0px;
  --p-space-1: 2px;
  --p-space-2: 4px;
  --p-space-3: 8px;
  --p-space-4: 12px;
  --p-space-5: 16px;
  --p-space-6: 20px;
  --p-space-7: 24px;
  --p-space-8: 32px;
  --p-space-9: 40px;
  --p-space-10: 48px;
  --p-space-11: 64px;

  --p-radius-0: 0px;
  --p-radius-1: 4px;
  --p-radius-2: 8px;
  --p-radius-3: 12px;
  --p-radius-4: 16px;
  --p-radius-5: 24px;
  --p-radius-full: 9999px;

  --p-dur-tap: 100ms;
  --p-dur-enter: 220ms;
  --p-dur-exit: 150ms;
  --p-dur-emphasize: 350ms;
  --p-ease-out: cubic-bezier(0.22, 0.61, 0.36, 1);
  --p-ease-in: cubic-bezier(0.4, 0, 1, 1);

  /* ── Layer 2: SEMANTIC — the only layer pages/components may reference ──── */
  --color-bg-canvas: var(--stone-50);
  --color-bg-surface: var(--stone-0);
  --color-bg-subtle: var(--sage-50);
  --color-bg-inverse: var(--stone-900);
  --color-bg-scrim: rgba(28, 26, 22, 0.6);

  --color-text-primary: var(--stone-900);
  --color-text-secondary: var(--stone-600);
  --color-text-tertiary: var(--stone-500);
  --color-text-disabled: var(--stone-400);
  --color-text-inverse: var(--stone-0);
  --color-text-brand: var(--forest-600);
  --color-text-link: var(--forest-600);
  --color-text-price: var(--stone-900);
  --color-text-price-compare: var(--stone-400);
  --color-text-success: #2F7A48;
  --color-text-warning: var(--amber-600);
  --color-text-danger: var(--red-600);

  --color-border-subtle: var(--stone-200);
  --color-border-default: var(--stone-300);
  --color-border-strong: var(--stone-450);
  --color-border-focus: var(--forest-600);
  --color-border-selected: var(--forest-600);

  --color-action-primary-bg: var(--forest-600);
  --color-action-primary-bg-pressed: var(--forest-700);
  --color-action-primary-bg-disabled: var(--stone-200);
  --color-action-primary-fg: var(--stone-0);
  --color-action-primary-fg-disabled: var(--stone-400);

  --color-action-secondary-bg: var(--forest-50);
  --color-action-secondary-bg-pressed: var(--forest-100);
  --color-action-secondary-fg: var(--forest-700);
  --color-action-secondary-border: var(--forest-200, var(--forest-100));

  --color-action-ghost-fg: var(--forest-600);
  --color-action-ghost-bg-pressed: var(--sage-50);

  --color-action-danger-bg: var(--red-600);
  --color-action-danger-bg-pressed: var(--red-700);
  --color-action-danger-fg: var(--stone-0);

  --color-status-success-fg: #2F7A48;
  --color-status-success-bg: #EAF4EC;
  --color-status-warning-fg: var(--amber-600);
  --color-status-warning-bg: var(--amber-50);
  --color-status-danger-fg: var(--red-600);
  --color-status-danger-bg: var(--red-50);
  --color-status-info-fg: var(--blue-600);
  --color-status-info-bg: var(--blue-50);
  --color-status-neutral-fg: var(--stone-600);
  --color-status-neutral-bg: var(--stone-100);

  --color-promo-fg: var(--clay-700);
  --color-promo-bg: var(--clay-50);
  --color-promo-solid-bg: var(--clay-600);
  --color-promo-solid-fg: var(--stone-0);

  --color-flash-solid-bg: var(--terracotta-600);
  --color-flash-solid-fg: var(--stone-0);
  --color-flash-fg: var(--terracotta-600);
  --color-flash-bg: var(--terracotta-50);

  --color-rating: var(--honey-500);

  --space-inline-xs: var(--p-space-1);
  --space-inline-sm: var(--p-space-3);
  --space-inline-md: var(--p-space-4);
  --space-inline-lg: var(--p-space-5);
  --space-stack-xs: var(--p-space-2);
  --space-stack-sm: var(--p-space-3);
  --space-stack-md: var(--p-space-5);
  --space-stack-lg: var(--p-space-7);
  --space-stack-xl: var(--p-space-8);
  --space-inset-card: var(--p-space-4);
  --space-inset-page: var(--p-space-5);
  --space-gutter: var(--p-space-5);
  --space-section: var(--p-space-7);

  --radius-control: var(--p-radius-3);
  --radius-card: var(--p-radius-4);
  --radius-media: var(--p-radius-3);
  --radius-sheet: var(--p-radius-5);
  --radius-pill: var(--p-radius-full);

  --elevation-1: 0 1px 2px rgba(28, 26, 22, 0.06), 0 2px 8px rgba(28, 26, 22, 0.05);
  --elevation-2: 0 4px 16px rgba(28, 26, 22, 0.08);
  --elevation-3: 0 -8px 24px rgba(28, 26, 22, 0.10);
  --elevation-4: 0 16px 40px rgba(28, 26, 22, 0.16);

  --motion-tap: var(--p-dur-tap) var(--p-ease-out);
  --motion-enter: var(--p-dur-enter) var(--p-ease-out);
  --motion-exit: var(--p-dur-exit) var(--p-ease-in);
  --motion-emphasize: var(--p-dur-emphasize) var(--p-ease-out);

  --z-base: 0;
  --z-sticky: 20;
  --z-nav: 100;
  --z-back: 110;
  --z-overlay: 900;
  --z-sheet: 1000;
  --z-dialog: 1100;
  --z-toast: 1200;
  --z-onboarding: 1300;

  /* Type scale — line-heights are the RATIO (unitless), applied via component, not raw px,
   * so the accessibility font-scale multiplier (Task 3/miniapp app-shell, out of this plan's
   * scope) can safely multiply font-size without breaking line-height. */
  --type-display-lg-size: 32px; --type-display-lg-lh: 1.25; --type-display-lg-weight: 600;
  --type-display-md-size: 28px; --type-display-md-lh: 1.29; --type-display-md-weight: 600;
  --type-title-lg-size: 22px; --type-title-lg-lh: 1.36; --type-title-lg-weight: 600;
  --type-title-md-size: 18px; --type-title-md-lh: 1.44; --type-title-md-weight: 600;
  --type-title-sm-size: 16px; --type-title-sm-lh: 1.5; --type-title-sm-weight: 600;
  --type-body-lg-size: 16px; --type-body-lg-lh: 1.5; --type-body-lg-weight: 400;
  --type-body-md-size: 15px; --type-body-md-lh: 1.47; --type-body-md-weight: 400;
  --type-body-sm-size: 14px; --type-body-sm-lh: 1.57; --type-body-sm-weight: 400;
  --type-caption-size: 13px; --type-caption-lh: 1.54; --type-caption-weight: 400;
  --type-label-size: 12px; --type-label-lh: 1.33; --type-label-weight: 600;
  --type-price-xl-size: 24px; --type-price-xl-lh: 1.33; --type-price-xl-weight: 700;
  --type-price-lg-size: 20px; --type-price-lg-lh: 1.4; --type-price-lg-weight: 700;
  --type-price-md-size: 16px; --type-price-md-lh: 1.375; --type-price-md-weight: 600;
  --type-price-sm-size: 14px; --type-price-sm-lh: 1.43; --type-price-sm-weight: 600;

  --font-display: 'Fraunces', 'Georgia', serif;
  --font-ui: 'Inter', system-ui, sans-serif;
}

/* Dealer (B2B) theme — overrides ONLY semantic action colors, per spec §Theme. Not applied to
 * any page in this plan (dealer pages are out of scope) — the mechanism just needs to exist. */
[data-theme='dealer'] {
  --color-action-primary-bg: var(--stone-800);
  --color-action-primary-bg-pressed: var(--stone-900);
  --color-text-brand: var(--stone-800);
}
```

- [ ] **Step 4: Write `src/tailwind-preset.ts`, `src/index.ts`, `tsconfig.json`**

```typescript
// packages/design-tokens/src/tailwind-preset.ts
import type { Config } from 'tailwindcss';

/** Mirrors tokens.css's semantic layer as Tailwind theme values, so both apps/web (Tailwind
 * already) and apps/miniapp (Tailwind added in Task 3) style from ONE source instead of hand-
 * copying hex (the exact drift audit A4-27/A4-28 found between the two apps). */
export const tailwindPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#EEF4EF', 100: '#D6E6DA', 200: '#B1CFB9', 300: '#86B293', 400: '#5B9170',
          500: '#3B7552', 600: '#245E3E', 700: '#1B4B31', 800: '#143A26', 900: '#0D291B',
        },
        sage: { 50: '#F2F5EC', 100: '#E3EBD8', 600: '#4A6135', 700: '#3E5129' },
        stone: {
          0: '#FFFFFF', 25: '#FBFAF7', 50: '#F6F4EF', 100: '#EFEBE2', 200: '#E0DACB',
          300: '#CBC5B8', 400: '#9E978A', 450: '#938B7E', 500: '#746D61', 600: '#5A544A',
          700: '#423D34', 800: '#2B2721', 900: '#1C1A16',
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
      spacing: {
        0: '0px', 1: '2px', 2: '4px', 3: '8px', 4: '12px', 5: '16px', 6: '20px', 7: '24px',
        8: '32px', 9: '40px', 10: '48px', 11: '64px',
      },
      borderRadius: { control: '12px', card: '16px', media: '12px', sheet: '24px' },
    },
  },
};
```

```typescript
// packages/design-tokens/src/index.ts
export { tailwindPreset } from './tailwind-preset';
export const TOKENS_CSS_PATH = new URL('./tokens.css', import.meta.url).pathname;
```

Copy `apps/api/tsconfig.json`'s pattern for `packages/design-tokens/tsconfig.json` (extends `@tubutree/typescript-config`).

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm --filter @tubutree/design-tokens exec vitest run` — expect PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add packages/design-tokens
git commit -m "feat(design-tokens): scaffold packages/design-tokens — primitive+semantic layer, Tailwind preset

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Self-host Fraunces + Inter fonts

**Files:**
- Create: `packages/design-tokens/src/fonts/` (woff2 files, latin+vietnamese subset)
- Create: `packages/design-tokens/src/fonts.css` (`@font-face` declarations)
- Modify: `packages/design-tokens/src/index.ts` — export `FONTS_CSS_PATH`
- Test: `packages/design-tokens/src/fonts.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `packages/design-tokens/src/fonts.css` (raw CSS file, imported by miniapp's entry CSS in Task 3 and web's `app/layout.tsx` in Task 5); `FONTS_CSS_PATH` export.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/design-tokens/src/fonts.spec.ts
import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./fonts.css', import.meta.url), 'utf-8');

describe('design-tokens/fonts.css', () => {
  it('declares @font-face for Fraunces and Inter with a local woff2 src (no fonts.googleapis.com)', () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]Fraunces['"]/s);
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]Inter['"]/s);
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).toMatch(/src:\s*url\(['"]\.\/fonts\//);
  });

  it('ships the referenced woff2 files on disk', () => {
    const files = ['fraunces-500.woff2', 'fraunces-600.woff2', 'inter-400.woff2', 'inter-500.woff2'];
    for (const f of files) {
      expect(existsSync(new URL(`./fonts/${f}`, import.meta.url))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `fonts.css` doesn't exist.

- [ ] **Step 3: Download + subset the fonts**

Fraunces and Inter are both open-source (SIL OFL) and on Google Fonts — download the static weights needed (Fraunces 500/600, Inter 400/500), then subset to `latin,latin-ext,vietnamese` with `pyftsubset` (fonttools) or `glyphhanger`, output as woff2. If neither tool is available in this environment, download the variable-font TTF from Google Fonts' GitHub mirror (`google/fonts` repo, `ofl/fraunces` and `ofl/inter`) and convert with `fonttools varLib.instancer` + `fonttools ttLib` to static woff2 at the two weights — run:

```bash
pip install fonttools brotli
# Fraunces (has opsz+wght variable axes — pin opsz=72,wght=500/600 for UI display sizes)
fonttools varLib.instancer -o /tmp/fraunces-500.ttf Fraunces[SOFT,WONK,opsz,wght].ttf wght=500 opsz=72
fonttools varLib.instancer -o /tmp/fraunces-600.ttf Fraunces[SOFT,WONK,opsz,wght].ttf wght=600 opsz=72
fonttools varLib.instancer -o /tmp/inter-400.ttf Inter[opsz,wght].ttf wght=400
fonttools varLib.instancer -o /tmp/inter-500.ttf Inter[opsz,wght].ttf wght=500
for f in fraunces-500 fraunces-600 inter-400 inter-500; do
  fonttools subset /tmp/$f.ttf --unicodes="U+0000-00FF,U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+1EA0-1EF9,U+20AB" \
    --output-file=packages/design-tokens/src/fonts/$f.woff2 --flavor=woff2 --layout-features='*'
done
```

The Vietnamese Unicode ranges above (`U+1EA0-1EF9` etc.) are the same ranges the audit confirmed present in Google's own served CSS for these exact families (`docs/audit-2026-09/04-design-system.md` §6, "Font" table) — reuse them verbatim so subsetting doesn't drop a diacritic.

- [ ] **Step 4: Write `fonts.css`**

```css
/* packages/design-tokens/src/fonts.css */
@font-face {
  font-family: 'Fraunces';
  src: url('./fonts/fraunces-500.woff2') format('woff2');
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: 'Fraunces';
  src: url('./fonts/fraunces-600.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('./fonts/inter-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('./fonts/inter-500.woff2') format('woff2');
  font-weight: 500;
  font-display: swap;
}
```

Add `export const FONTS_CSS_PATH = new URL('./fonts.css', import.meta.url).pathname;` to `src/index.ts`.

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm --filter @tubutree/design-tokens exec vitest run` — 7/7 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/design-tokens
git commit -m "feat(design-tokens): self-host Fraunces+Inter (latin+vietnamese subset)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Add Tailwind to `apps/miniapp`, wire to shared preset, replace old token file

**Files:**
- Create: `apps/miniapp/tailwind.config.ts`
- Create: `apps/miniapp/postcss.config.mjs`
- Modify: `apps/miniapp/package.json` (add `tailwindcss@^3.4.16`, `postcss@^8.4.49`, `autoprefixer@^10.4.20`, `@tubutree/design-tokens: workspace:*` deps)
- Modify: `apps/miniapp/zmp-cli.json:5` (`"includeTailwindCSS": false` → `true`, documentation only — the real wiring is Vite/PostCSS, but keep the CLI's own metadata accurate)
- Modify: `apps/miniapp/src/css/tokens.css` — DELETE the `@import url('https://fonts.googleapis.com/...')` block (lines 7-9) and the entire old `:root { --font-display... --primary-*... --leaf-*...}` primitive block (lines 11-129); KEEP everything from `.t-display` down (lines 170-434: the utility classes, `.tubu-press`, `.tubu-card`, skeleton shimmer, all `@keyframes`, and the `.zaui-btn-small` override) since those still work once the underlying `var(--radius-*)`/`var(--neutral-*)` etc. resolve from the new file.
- Modify: `apps/miniapp/src/components/app.tsx` — import order: `zmp-ui/zaui.css` first (unchanged), then `@tubutree/design-tokens/src/fonts.css`, then `@tubutree/design-tokens/src/tokens.css`, then the trimmed local `css/tokens.css` (utility classes only), matching the current import order pattern already in this file.
- Test: `apps/miniapp/tailwind.config.spec.ts`

**Interfaces:**
- Consumes: `tailwindPreset` from `@tubutree/design-tokens` (Task 1).
- Produces: Tailwind utility classes (`bg-forest-600`, `text-stone-500`, `rounded-card`, etc.) usable by every component task from Task 9 onward; the old `--primary-*`/`--leaf-*`/`--neutral-*`/`--font-*` CSS variables NO LONGER EXIST after this task — any file still referencing them breaks at runtime (tracked by Review Focus item 1; full sweep happens across Tasks 9-30, not all at once here).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/miniapp/tailwind.config.spec.ts
import { describe, it, expect } from 'vitest';
import config from './tailwind.config';

describe('miniapp tailwind.config', () => {
  it('extends the shared design-tokens preset', () => {
    expect(config.presets).toBeDefined();
    expect(config.presets!.length).toBeGreaterThan(0);
  });
  it('scans miniapp source files', () => {
    expect(config.content).toContain('./src/**/*.{ts,tsx}');
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`tailwind.config.ts` doesn't exist).

- [ ] **Step 3: Add dependencies, write config files**

```bash
pnpm --filter @tubutree/miniapp add -D tailwindcss@^3.4.16 postcss@^8.4.49 autoprefixer@^10.4.20
pnpm --filter @tubutree/miniapp add @tubutree/design-tokens@workspace:*
```

`apps/miniapp/tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss';
import { tailwindPreset } from '@tubutree/design-tokens';

const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

`apps/miniapp/postcss.config.mjs` (same shape as `apps/web/postcss.config.mjs`):
```javascript
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 4: Trim `src/css/tokens.css`, update import order in `app.tsx`, flip `zmp-cli.json`**

In `apps/miniapp/src/css/tokens.css`, delete lines 1-129 (everything from the header comment through the closing `}` of the old `:root` block that starts `/* Font families (M2) */`). The file now starts directly at the old line 131 (`/* Dynamic Font Scale (Accessibility) */`).

Find the current CSS import lines in `apps/miniapp/src/components/app.tsx` (search for `import 'zmp-ui/zaui.css'` and `import '../css/tokens.css'`) and reorder/add so the block reads:
```typescript
import 'zmp-ui/zaui.css';
import '@tubutree/design-tokens/src/fonts.css';
import '@tubutree/design-tokens/src/tokens.css';
import '../css/tokens.css';
```

In `apps/miniapp/zmp-cli.json`, change `"includeTailwindCSS": false` to `"includeTailwindCSS": true`.

- [ ] **Step 5: Run test, verify it passes; run full build to catch immediate breakage**

Run: `pnpm --filter @tubutree/miniapp exec vitest run tailwind.config.spec.ts` — pass.
Run: `pnpm --filter @tubutree/miniapp build` — this WILL show a wall of "variable not defined" warnings from PostCSS for every `var(--primary-*)`/`var(--leaf-*)`/`var(--neutral-*)`/`var(--font-*)` reference still in old page files. That is expected at this point in the plan (Review Focus item 1) — confirm the build still completes (Vite doesn't fail the build on undefined CSS custom properties, it just renders `unset`), and confirm `apps/miniapp/dist/` is produced. Do NOT attempt to fix every page here — Tasks 9-30 replace those references as each component/page is migrated; Task 8's CI script (undefined-var scan) is the guardrail that tracks the remaining count going down.

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp packages/design-tokens
git commit -m "feat(miniapp): add Tailwind, wire to shared design-tokens preset, retire old inline token block

Old primary-*/leaf-*/neutral-*/font-* CSS vars in tokens.css are gone — pages still
referencing them resolve to 'unset' until migrated in later tasks (tracked by
Task 8's CI scan, not fixed all at once here).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: ZaUI theme bridge — override `--zaui-light-*` from semantic tokens

**Files:**
- Create: `apps/miniapp/src/css/zaui-bridge.css`
- Modify: `apps/miniapp/src/components/app.tsx` — add `import '../css/zaui-bridge.css';` immediately after the `zmp-ui/zaui.css` import (must load after ZaUI's own stylesheet to win cascade).
- Test: `apps/miniapp/src/css/zaui-bridge.spec.ts`

**Interfaces:**
- Consumes: semantic tokens from Task 1 (`--color-action-primary-bg` etc.).
- Produces: every ZaUI component (`Button`, `Input`, `Spinner`, `Checkbox`, `Radio`, `Switch`, `Tabs`/tabbar, `Progress`) now renders in forest green instead of Zalo blue `#006AF5`, with zero code changes to call sites.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Write `zaui-bridge.css`**

```css
/* apps/miniapp/src/css/zaui-bridge.css
 * Loaded AFTER zmp-ui/zaui.css so these overrides win the cascade. Fixes audit A4-01:
 * 137/255 zmp-ui <Button> (and every Input/Spinner/Checkbox/Radio/Switch/Tabs) rendered Zalo
 * blue #006AF5 because tokens.css never overrode any --zaui-* variable (0/307). */
:root {
  --zaui-light-color-primary: var(--color-action-primary-bg);

  --zaui-light-button-primary-background: var(--color-action-primary-bg);
  --zaui-light-button-primary-background-pressed: var(--color-action-primary-bg-pressed);
  --zaui-light-button-primary-text: var(--color-action-primary-fg);
  --zaui-light-button-primary-icon: var(--color-action-primary-fg);
  --zaui-light-button-primary-danger-background: var(--color-action-danger-bg);
  --zaui-light-button-primary-danger-background-pressed: var(--color-action-danger-bg-pressed);
  --zaui-light-button-primary-danger-text: var(--color-action-danger-fg);

  --zaui-light-button-secondary-background: var(--color-action-secondary-bg);
  --zaui-light-button-secondary-background-pressed: var(--color-action-secondary-bg-pressed);
  --zaui-light-button-secondary-text: var(--color-action-secondary-fg);
  --zaui-light-button-secondary-icon: var(--color-action-secondary-fg);
  --zaui-light-button-secondary-neutral-background: var(--stone-100);
  --zaui-light-button-secondary-neutral-background-pressed: var(--stone-200);
  --zaui-light-button-secondary-neutral-text: var(--color-text-primary);
  --zaui-light-button-secondary-neutral-icon: var(--color-text-primary);
  --zaui-light-button-secondary-danger-background: var(--color-status-danger-bg);
  --zaui-light-button-secondary-danger-background-pressed: var(--red-50);
  --zaui-light-button-secondary-danger-text: var(--color-action-danger-bg);
  --zaui-light-button-secondary-danger-icon: var(--color-action-danger-bg);

  --zaui-light-button-tertiary-text: var(--color-action-ghost-fg);
  --zaui-light-button-tertiary-icon: var(--color-action-ghost-fg);
  --zaui-light-button-tertiary-background-pressed: var(--color-action-ghost-bg-pressed);
  --zaui-light-button-tertiary-neutral-text: var(--color-text-secondary);
  --zaui-light-button-tertiary-neutral-icon: var(--color-text-secondary);
  --zaui-light-button-tertiary-neutral-background-pressed: var(--stone-100);
  --zaui-light-button-tertiary-danger-text: var(--color-action-danger-bg);
  --zaui-light-button-tertiary-danger-icon: var(--color-action-danger-bg);
  --zaui-light-button-tertiary-danger-background-pressed: var(--color-status-danger-bg);

  --zaui-light-button-background-disabled: var(--color-action-primary-bg-disabled);
  --zaui-light-button-text-disabled: var(--color-action-primary-fg-disabled);
  --zaui-light-button-icon-disabled: var(--color-action-primary-fg-disabled);

  --zaui-light-input-background-color: var(--color-bg-surface);
  --zaui-light-input-border-color: var(--color-border-default);
  --zaui-light-input-hover-border-color: var(--color-border-focus);
  --zaui-light-input-text-color: var(--color-text-primary);
  --zaui-light-input-placeholder-color: var(--color-text-tertiary);
  --zaui-light-input-disabled-color: var(--color-text-disabled);
  --zaui-light-input-disabled-background-color: var(--stone-50);
  --zaui-light-input-clear-icon-color: var(--color-text-tertiary);
  --zaui-light-input-helper-text-color: var(--color-text-tertiary);
  --zaui-light-input-status-error: var(--color-status-danger-fg);
  --zaui-light-input-error-text-color: var(--color-status-danger-fg);
  --zaui-light-input-error-icon-background-color: var(--color-status-danger-bg);
  --zaui-light-input-helper-icon-background-color: var(--color-status-info-bg);
  --zaui-light-input-status-success-icon-color: var(--color-status-success-fg);
  --zaui-light-input-status-success-icon-focus-visible-color: var(--color-status-success-fg);

  --zaui-light-checkbox-border-color: var(--color-border-default);
  --zaui-light-checkbox-uncheck-background: var(--color-bg-surface);
  --zaui-light-checkbox-checked-background: var(--color-action-primary-bg);
  --zaui-light-checkbox-checked-mark-color: var(--color-action-primary-fg);
  --zaui-light-checkbox-disabled-uncheck-background: var(--stone-50);
  --zaui-light-checkbox-disabled-checked-background: var(--stone-200);
  --zaui-light-checkbox-disabled-checked-mark-color: var(--stone-0);
  --zaui-light-checkbox-disabled-label: var(--color-text-disabled);

  --zaui-light-radio-border-color: var(--color-border-default);
  --zaui-light-radio-uncheck-background: var(--color-bg-surface);
  --zaui-light-radio-checked-background: var(--color-action-primary-bg);
  --zaui-light-radio-checked-mark-color: var(--color-action-primary-fg);
  --zaui-light-radio-disabled-uncheck-background: var(--stone-50);
  --zaui-light-radio-disabled-checked-background: var(--stone-200);
  --zaui-light-radio-disabled-checked-mark-color: var(--stone-0);
  --zaui-light-radio-disabled-label: var(--color-text-disabled);

  --zaui-light-switch-bg-color: var(--color-action-primary-bg);
  --zaui-light-switch-off-bg-color: var(--stone-200);
  --zaui-light-switch-handler-bg-color: var(--stone-0);
  --zaui-light-switch-disabled-bg-color: var(--stone-100);
  --zaui-light-switch-off-disabled-bg-color: var(--stone-100);
  --zaui-light-switch-handler-disabled-bg-color: var(--stone-50);
  --zaui-light-switch-label-color: var(--color-text-primary);
  --zaui-light-switch-label-disabled-color: var(--color-text-disabled);

  --zaui-light-spinner-dot-color: var(--color-action-primary-bg);
  --zaui-light-spinner-border-color: var(--stone-200);

  --zaui-light-tabbar-background: var(--color-bg-surface);
  --zaui-light-tabbar-divider: var(--color-border-subtle);
  --zaui-light-tabbar-label: var(--color-text-tertiary);
  --zaui-light-tabbar-label-active: var(--color-text-brand);
  --zaui-light-tabbar-active-line: var(--color-action-primary-bg);

  --zaui-light-progress-background: var(--stone-200);
  --zaui-light-progress-completed: var(--color-action-primary-bg);

  --zaui-light-bottom-navigation-background-color: var(--color-bg-surface);
  --zaui-light-bottom-navigation-color: var(--color-text-tertiary);
  --zaui-light-bottom-navigation-active-color: var(--color-text-brand);
  --zaui-light-bottom-navigation-divider-color: var(--color-border-subtle);
}
```

- [ ] **Step 4: Add the import to `app.tsx`, run test, verify it passes**

Run: `pnpm --filter @tubutree/miniapp exec vitest run zaui-bridge.spec.ts` — 2/2 pass.

- [ ] **Step 5: Manual visual check**

Run: `pnpm --filter @tubutree/miniapp dev`, open in the Browser pane, navigate to any page with a ZaUI `<Button>` (e.g. `/cart`) and confirm the primary button now renders forest green, not Zalo blue. Screenshot and attach to the task's self-review notes.

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp/src/css/zaui-bridge.css apps/miniapp/src/components/app.tsx
git commit -m "feat(miniapp): ZaUI theme bridge — override 85 --zaui-light-* vars with semantic tokens (fixes A4-01)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `apps/web` — extend shared preset instead of hand-duplicated palette

**Files:**
- Modify: `apps/web/tailwind.config.ts` (replace entire `colors`/`fontFamily`/`borderRadius` block with `presets: [tailwindPreset]`)
- Modify: `apps/web/package.json` — add `@tubutree/design-tokens: workspace:*`
- Modify: `apps/web/src/app/layout.tsx:16-27` — replace the `"Be Vietnam Pro"` font declaration (never actually loaded per audit A4-27) with the self-hosted Fraunces+Inter `@font-face` CSS import
- Modify: `apps/web/src/app/globals.css` — import `@tubutree/design-tokens/src/fonts.css`
- Test: `apps/web/tailwind.config.spec.ts`

**Interfaces:**
- Consumes: `tailwindPreset` from Task 1, `fonts.css` from Task 2.
- Produces: `apps/web` now shares the EXACT same `forest-*`/`stone-*`/`clay-*` classes as miniapp — no more independent hex per audit A4-27/A4-28.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tailwind.config.spec.ts
import { describe, it, expect } from 'vitest';
import config from './tailwind.config';

describe('web tailwind.config', () => {
  it('extends the shared design-tokens preset (no independent color palette)', () => {
    expect(config.presets?.length).toBeGreaterThan(0);
    const ext = config.theme?.extend as Record<string, unknown> | undefined;
    expect(ext?.colors).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** (current config has a hand-written `colors` block).

- [ ] **Step 3: Rewrite `apps/web/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';
import { tailwindPreset } from '@tubutree/design-tokens';

const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

Run `pnpm --filter @tubutree/web add @tubutree/design-tokens@workspace:*`.

- [ ] **Step 4: Fix the font loading + import fonts.css**

In `apps/web/src/app/layout.tsx`, remove any `fontFamily.sans` reference to `"Be Vietnam Pro"` that was never backed by a real `@font-face`/`next/font` call, and instead rely on the Tailwind `font-ui`/`font-display` classes (which resolve through the preset's `fontFamily` to the same `@font-face` names Task 2 defines). Add to `apps/web/src/app/globals.css`:
```css
@import '@tubutree/design-tokens/src/fonts.css';
```

- [ ] **Step 5: Run test, verify passes; run web's own test suite to catch color-class breakage**

Run: `pnpm --filter @tubutree/web exec vitest run tailwind.config.spec.ts` — pass.
Run: `pnpm --filter @tubutree/web test` — expect SOME existing snapshot/class-name assertions to fail (any spec asserting `bg-primary-600`/`text-leaf-700` literal class strings). Fix each failing assertion to the new class name (`bg-forest-600`, `text-forest-700`) as part of this task — do not leave failing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/design-tokens
git commit -m "feat(web): extend shared design-tokens Tailwind preset, drop hand-duplicated palette (fixes A4-27/A4-28)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Lint + CI guardrails (raw color, ZaUI Button import ban, icon-button aria-label, undefined `var()` scan)

**Files:**
- Create: `packages/eslint-config/rules/no-raw-color.js`
- Create: `packages/eslint-config/rules/icon-button-aria-label.js`
- Create: `packages/eslint-config/rules/index.js` (plugin object bundling both rules)
- Modify: `packages/eslint-config/index.js` — register the plugin, add 3 rule entries (`no-raw-color` global; `no-restricted-imports` banning `Button` from `zmp-ui` scoped to `apps/miniapp/src/pages/**`; `icon-button-aria-label`)
- Create: `packages/eslint-config/rules/no-raw-color.spec.js` and `packages/eslint-config/rules/icon-button-aria-label.spec.js` (using `eslint`'s `RuleTester`)
- Create: `scripts/check-undefined-css-vars.mjs` (repo-root script; CI step, not an ESLint rule — scans `apps/miniapp/src/**/*.{css,tsx,ts}` for `var(--x)` where `--x` is never defined in `packages/design-tokens/src/tokens.css` or `apps/miniapp/src/css/tokens.css`, mirrors audit's own C2 `comm -13` method)
- Modify: root `package.json` — add `"lint:vars": "node scripts/check-undefined-css-vars.mjs"` script

**Interfaces:**
- Consumes: nothing (pure tooling).
- Produces: `pnpm lint` now fails on any NEW raw hex/rgba color literal in a `style={{}}` color-ish property (`color`, `background`, `backgroundColor`, `borderColor`, `fill`, `stroke`), on any NEW `import { Button } from 'zmp-ui'` inside `apps/miniapp/src/pages/**`, and on any icon-only interactive element missing `aria-label`; `pnpm lint:vars` reports every `var(--undefined-token)` reference repo-wide with file:line.

- [ ] **Step 1: Write the failing rule tests**

```javascript
// packages/eslint-config/rules/no-raw-color.spec.js
import { RuleTester } from 'eslint';
import rule from './no-raw-color.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run('no-raw-color', rule, {
  valid: [
    { code: `const s = { color: 'var(--color-text-primary)' };` },
    { code: `const s = { padding: 8 };` },
    // game/tier illustration files are exempt via filename-based override in index.js, not the rule itself
  ],
  invalid: [
    {
      code: `const s = { color: '#E08C1C' };`,
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: `const s = { background: 'rgba(0,0,0,.5)' };`,
      errors: [{ messageId: 'rawColor' }],
    },
  ],
});
```

```javascript
// packages/eslint-config/rules/icon-button-aria-label.spec.js
import { RuleTester } from 'eslint';
import rule from './icon-button-aria-label.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run('icon-button-aria-label', rule, {
  valid: [
    { code: `<IconButton icon={<X />} label="Đóng" />` },
    { code: `<button aria-label="Đóng"><X /></button>` },
  ],
  invalid: [
    {
      code: `<IconButton icon={<X />} />`,
      errors: [{ messageId: 'missingLabel' }],
    },
  ],
});
```

- [ ] **Step 2: Run to verify both fail** (rule files don't exist).

- [ ] **Step 3: Implement the rules**

```javascript
// packages/eslint-config/rules/no-raw-color.js
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR_RE = /^(rgb|rgba|hsl|hsla)\(/i;
const COLOR_PROPS = new Set(['color', 'background', 'backgroundColor', 'borderColor', 'fill', 'stroke', 'boxShadow']);

/** Cấm hex/rgb() thô trong style={{}} — dùng var(--token) (Design System v2, spec §6). */
export default {
  meta: { type: 'problem', messages: { rawColor: 'Màu thô "{{value}}" — dùng var(--token) thay vì hex/rgb trực tiếp.' } },
  create(context) {
    return {
      Property(node) {
        if (node.key.type !== 'Identifier' || !COLOR_PROPS.has(node.key.name)) return;
        if (node.value.type !== 'Literal' || typeof node.value.value !== 'string') return;
        const v = node.value.value;
        if (HEX_RE.test(v) || FUNC_COLOR_RE.test(v)) {
          context.report({ node: node.value, messageId: 'rawColor', data: { value: v } });
        }
      },
    };
  },
};
```

```javascript
// packages/eslint-config/rules/icon-button-aria-label.js
/** IconButton (hoặc bất kỳ phần tử chỉ có icon con, không có text) phải có aria-label/label. */
export default {
  meta: { type: 'problem', messages: { missingLabel: '{{name}} chỉ có icon — cần prop `label`/`aria-label`.' } },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (name !== 'IconButton') return;
        const hasLabel = node.attributes.some(
          (a) => a.type === 'JSXAttribute' && (a.name.name === 'label' || a.name.name === 'aria-label'),
        );
        if (!hasLabel) context.report({ node, messageId: 'missingLabel', data: { name } });
      },
    };
  },
};
```

```javascript
// packages/eslint-config/rules/index.js
import noRawColor from './no-raw-color.js';
import iconButtonAriaLabel from './icon-button-aria-label.js';

export const tubuDsPlugin = {
  rules: { 'no-raw-color': noRawColor, 'icon-button-aria-label': iconButtonAriaLabel },
};
```

- [ ] **Step 4: Wire the plugin + import ban into `packages/eslint-config/index.js`**

Add before the final `prettier` entry in the existing `tseslint.config(...)` call:
```javascript
import { tubuDsPlugin } from './rules/index.js';
// ...
{
  files: ['**/*.tsx'],
  ignores: ['**/*.spec.tsx', '**/game/**', '**/tier/**'],
  plugins: { 'tubu-ds': tubuDsPlugin },
  rules: {
    'tubu-ds/no-raw-color': 'error',
    'tubu-ds/icon-button-aria-label': 'error',
  },
},
{
  files: ['apps/miniapp/src/pages/**/*.tsx'],
  rules: {
    'no-restricted-imports': ['error', { paths: [{ name: 'zmp-ui', importNames: ['Button'], message: 'Dùng Button từ components/ui (Design System v2), không import thẳng từ zmp-ui trong pages/.' }] }],
  },
},
```

- [ ] **Step 5: Write `scripts/check-undefined-css-vars.mjs`**

```javascript
#!/usr/bin/env node
// Repo-root script — CI guardrail mirroring audit's own C2 method (comm -13 defs used).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const defined = new Set();
for (const f of ['packages/design-tokens/src/tokens.css', 'apps/miniapp/src/css/tokens.css', 'apps/miniapp/src/css/zaui-bridge.css']) {
  const text = readFileSync(f, 'utf-8');
  for (const m of text.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
}

const files = walk('apps/miniapp/src', ['.ts', '.tsx', '.css']);
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf-8');
  for (const m of text.matchAll(/var\(--([a-zA-Z0-9-]+)/g)) {
    if (!defined.has(m[1])) {
      console.error(`${f}: var(--${m[1]}) is not defined anywhere`);
      bad++;
    }
  }
}
if (bad > 0) {
  console.error(`\n${bad} undefined CSS variable reference(s).`);
  process.exit(1);
}
console.log('OK — every var(--x) reference is defined.');
```

Add to root `package.json` scripts: `"lint:vars": "node scripts/check-undefined-css-vars.mjs"`.

- [ ] **Step 6: Run all new tests + the scan script, verify green**

Run: `pnpm --filter @tubutree/eslint-config exec vitest run` (or `node --test` if the package has no vitest devDep yet — add `vitest` to its devDependencies alongside the existing ones) — both rule tests pass.
Run: `pnpm lint:vars` — expect a NON-ZERO count right now (old pages still reference retired `--primary-*` etc. per Task 3's Step 5 note) — this is fine; the script's job starts now, its count goes to 0 as Tasks 9-30 migrate each file. Confirm the script itself runs and reports correctly (don't gate this task's own completion on the count being 0).

- [ ] **Step 7: Commit**

```bash
git add packages/eslint-config scripts/check-undefined-css-vars.mjs package.json
git commit -m "feat(lint): DS v2 guardrails — no-raw-color, icon-button-aria-label, ban zmp-ui Button in pages/, undefined var() CI scan

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Documentation cleanup — remove conflicting design-system source of truth

**Files:**
- Delete: `design-system/tubu-tree/MASTER.md`
- Modify: `design_handoff/README.md:61-66,99` — replace the `#2E7D4F` green / Be Vietnam Pro block with a pointer: "LỖI THỜI — xem `docs/superpowers/specs/2026-09-28-design-system-v2-design.md`"
- Modify: `design_handoff/specs/TUBU_TREE_BUILD_SPEC_v1.1.md:1792,1839` (§7.2) — same lỗi-thời pointer, keep the surrounding sections intact (only the color/font block is stale)

**Interfaces:** none (docs only).

- [ ] **Step 1: Delete the conflicting file**

```bash
git rm design-system/tubu-tree/MASTER.md
```

- [ ] **Step 2: Add the stale-marker note to `design_handoff/README.md`**

Read the file first to get exact current line numbers (they may have shifted since the audit), find the `#2E7D4F`/Be Vietnam Pro block, and replace its content with a one-paragraph note pointing at the new spec as the sole source of truth, dated 2026-09-28.

- [ ] **Step 3: Same for `TUBU_TREE_BUILD_SPEC_v1.1.md` §7.2**

Read the file, locate §7.2 (search for `#2E7D4F`), add the same stale-marker note directly above that section without deleting the section (historical record) — just make it unambiguous a reader should not use it.

- [ ] **Step 4: Commit**

```bash
git add -A design-system design_handoff
git commit -m "docs: remove conflicting DS source (MASTER.md), mark old README/SPEC color palette stale

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `Icon` — lucide wrapper with fixed stroke/sizes

**Files:**
- Create: `apps/miniapp/src/components/ui/icon.tsx`
- Test: `apps/miniapp/src/components/ui/icon.spec.tsx`

**Interfaces:**
- Produces: `Icon({ icon: LucideIcon, size?: 'sm'|'md'|'lg', tone?: TextTone, className?, style? })` — used by every later component that shows an icon (`IconButton`, `ListRow`, `ProductTile`, `Chip`).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/icon.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Heart } from 'lucide-react';
import { Icon } from './icon';

describe('Icon', () => {
  it('renders the given lucide icon at strokeWidth 1.75 and size md=20 by default', () => {
    render(<Icon icon={Heart} data-testid="i" />);
    const svg = screen.getByTestId('i');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });
  it('sm=16, lg=24', () => {
    render(<Icon icon={Heart} size="sm" data-testid="sm" />);
    expect(screen.getByTestId('sm').getAttribute('width')).toBe('16');
    render(<Icon icon={Heart} size="lg" data-testid="lg" />);
    expect(screen.getByTestId('lg').getAttribute('width')).toBe('24');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @tubutree/miniapp exec vitest run icon.spec.tsx`.

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/icon.tsx
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

const SIZE_PX = { sm: 16, md: 20, lg: 24 } as const;

export interface IconProps {
  icon: LucideIcon;
  size?: keyof typeof SIZE_PX;
  tone?: 'default' | 'muted' | 'brand' | 'danger' | 'inverse';
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

const TONE_VAR: Record<NonNullable<IconProps['tone']>, string> = {
  default: 'var(--color-text-primary)',
  muted: 'var(--color-text-tertiary)',
  brand: 'var(--color-text-brand)',
  danger: 'var(--color-text-danger)',
  inverse: 'var(--color-text-inverse)',
};

/** Wrapper cố định strokeWidth 1,75 + 3 cỡ chuẩn (sm16/md20/lg24) — thay 8 giá trị strokeWidth
 * và 18 cỡ rải rác hiện tại (audit A4-16). */
export function Icon({ icon: LucideIconCmp, size = 'md', tone = 'default', className, style, ...rest }: IconProps) {
  return (
    <LucideIconCmp
      size={SIZE_PX[size]}
      strokeWidth={1.75}
      color={TONE_VAR[tone]}
      className={className}
      style={style}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/icon.tsx apps/miniapp/src/components/ui/icon.spec.tsx
git commit -m "feat(ds): Icon wrapper — fixed stroke 1.75, sizes sm16/md20/lg24 (fixes A4-16)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `Text` / `Heading` — role-based typography

**Files:**
- Create: `apps/miniapp/src/components/ui/text.tsx`
- Test: `apps/miniapp/src/components/ui/text.spec.tsx`

**Interfaces:**
- Produces: `Text({ variant: 'body-lg'|'body-md'|'body-sm'|'caption'|'label', tone?, as?, children })`, `Heading({ variant: 'display-lg'|'display-md'|'title-lg'|'title-md'|'title-sm', as?, tone?, children })`.
- Consumes: type tokens from Task 1 (`--type-*-size/-lh/-weight`), tone colors (same `TONE_VAR` shape as Task 8's `Icon`, redefined here for text since it needs the same 5 tones plus `success`/`warning`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/text.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Text, Heading } from './text';

describe('Text/Heading', () => {
  it('Text renders a <span> by default with the variant font-size token', () => {
    render(<Text variant="body-md" data-testid="t">Hello</Text>);
    const el = screen.getByTestId('t');
    expect(el.tagName).toBe('SPAN');
    expect(el.style.fontSize).toBe('var(--type-body-md-size)');
  });
  it('Heading renders h1/h2/h3 based on variant, defaulting sensibly', () => {
    render(<Heading variant="title-lg" data-testid="h">Title</Heading>);
    expect(screen.getByTestId('h').tagName).toBe('H1');
  });
  it('Heading "as" prop overrides the default tag (e.g. title-sm inside a card still an h3 semantically, but visually small)', () => {
    render(<Heading variant="display-lg" as="h2" data-testid="h2">Big</Heading>);
    expect(screen.getByTestId('h2').tagName).toBe('H2');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/text.tsx
import type { CSSProperties, ElementType, ReactNode } from 'react';

export type TextVariant = 'body-lg' | 'body-md' | 'body-sm' | 'caption' | 'label' | 'price-xl' | 'price-lg' | 'price-md' | 'price-sm';
export type HeadingVariant = 'display-lg' | 'display-md' | 'title-lg' | 'title-md' | 'title-sm';
export type Tone = 'primary' | 'secondary' | 'tertiary' | 'disabled' | 'inverse' | 'brand' | 'success' | 'warning' | 'danger';

const TONE_VAR: Record<Tone, string> = {
  primary: 'var(--color-text-primary)', secondary: 'var(--color-text-secondary)',
  tertiary: 'var(--color-text-tertiary)', disabled: 'var(--color-text-disabled)',
  inverse: 'var(--color-text-inverse)', brand: 'var(--color-text-brand)',
  success: 'var(--color-text-success)', warning: 'var(--color-text-warning)', danger: 'var(--color-text-danger)',
};

function typeStyle(variant: string): CSSProperties {
  return {
    fontSize: `var(--type-${variant}-size)`,
    lineHeight: `var(--type-${variant}-lh)`,
    fontWeight: `var(--type-${variant}-weight)` as unknown as number,
  };
}

export interface TextProps {
  children: ReactNode;
  variant?: TextVariant;
  tone?: Tone;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Chữ theo vai trò (audit A4-11): 11 bậc type-* thay cho 116 fontSize literal + <Text size> của ZaUI. */
export function Text({ children, variant = 'body-md', tone = 'primary', as: As = 'span', className, style, ...rest }: TextProps) {
  return (
    <As
      className={className}
      style={{ fontFamily: 'var(--font-ui)', color: TONE_VAR[tone], margin: 0, ...typeStyle(variant), ...style }}
      {...rest}
    >
      {children}
    </As>
  );
}

const HEADING_TAG: Record<HeadingVariant, ElementType> = {
  'display-lg': 'h1', 'display-md': 'h1', 'title-lg': 'h1', 'title-md': 'h2', 'title-sm': 'h3',
};

export interface HeadingProps {
  children: ReactNode;
  variant: HeadingVariant;
  as?: ElementType;
  tone?: Tone;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Render đúng h1-h3 thật (ZaUI Text.Title render <span> — 0 heading thật trong toàn app, audit A4-23). */
export function Heading({ children, variant, as, tone = 'primary', className, style, ...rest }: HeadingProps) {
  const As = as ?? HEADING_TAG[variant];
  return (
    <As
      className={className}
      style={{ fontFamily: 'var(--font-display)', color: TONE_VAR[tone], margin: 0, letterSpacing: '-0.01em', ...typeStyle(variant), ...style }}
      {...rest}
    >
      {children}
    </As>
  );
}
```

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/text.tsx apps/miniapp/src/components/ui/text.spec.tsx
git commit -m "feat(ds): Text/Heading — 11-step type scale, real h1-h3 (fixes A4-11, A4-23 heading gap)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `Button` — variant/size/loading state machine

**Files:**
- Create: `apps/miniapp/src/components/ui/button.tsx`
- Test: `apps/miniapp/src/components/ui/button.spec.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 8); ZaUI `Button` (as the underlying element, imported ONLY here and in `IconButton`/`Chip`/`EmptyState` migration — everywhere else is banned by Task 6's lint rule).
- Produces: `Button({ variant: 'primary'|'secondary'|'ghost'|'danger'|'flash', size: 'md'|'lg', loading?, disabled?, icon?, fullWidth?, onPress, children })`. **Critically: `Button` NEVER forwards `loading` into ZaUI's own `disabled` prop** — this is the concrete fix for the Global Constraints' loading/disabled bug (audit A4-04, 96/110 buttons affected).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/button.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders children and calls onPress on click', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Mua ngay</Button>);
    fireEvent.click(screen.getByText('Mua ngay'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('loading=true shows the ZaUI spinner (never sets zaui disabled=true from loading alone)', () => {
    const { container } = render(<Button loading>Đang xử lý</Button>);
    // ZaUI's zaui-btn-loading class is the real signal it will draw a spinner (loading && !disabled).
    expect(container.querySelector('.zaui-btn')?.className).toContain('loading');
    expect(container.querySelector('.zaui-btn')?.getAttribute('disabled')).toBeNull();
  });

  it('explicit disabled=true (not from loading) does disable the underlying button', () => {
    const onPress = vi.fn();
    render(<Button disabled onPress={onPress}>Hết hàng</Button>);
    fireEvent.click(screen.getByText('Hết hàng'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading=true AND explicit disabled=true both apply (button is disabled, spinner still requested) — onPress blocked either way', () => {
    const onPress = vi.fn();
    render(<Button loading disabled onPress={onPress}>X</Button>);
    fireEvent.click(screen.getByText('X'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('size md is minHeight 44, lg is 48', () => {
    const { rerender, container } = render(<Button size="md">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('44px');
    rerender(<Button size="lg">A</Button>);
    expect((container.querySelector('.zaui-btn') as HTMLElement).style.minHeight).toBe('48px');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/button.tsx
import type { CSSProperties, ReactNode } from 'react';
import { Button as ZButton } from 'zmp-ui';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'flash';

const ZAUI_VARIANT: Record<ButtonVariant, 'primary' | 'secondary' | 'tertiary'> = {
  primary: 'primary', danger: 'primary', flash: 'primary', secondary: 'secondary', ghost: 'tertiary',
};

// flash uses a distinct background (terracotta) not covered by the ZaUI bridge's primary token —
// applied as an explicit inline override, same escape hatch the old Btn used for variant tones.
const FLASH_STYLE: CSSProperties = { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' };
const DANGER_STYLE: CSSProperties = { background: 'var(--color-action-danger-bg)', color: 'var(--color-action-danger-fg)' };

export interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
  onPress?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** Nút thống nhất — thay 255 zmp Button + 218 nút tự chế + Btn cũ (audit A4-07). KHÔNG BAO GIỜ
 * đẩy `loading` vào `disabled` của ZaUI: đó chính là lý do 96/110 nút cũ không hiện spinner
 * (Z/esm/components/button/index.js — chỉ vẽ spinner khi loading && !disabled). `disabled` ở
 * đây CHỈ đến từ prop `disabled` tường minh của caller. */
export function Button({
  children, variant = 'primary', size = 'md', loading, disabled, icon: IconCmp, fullWidth, onPress, className, style,
}: ButtonProps) {
  const toneStyle = variant === 'flash' ? FLASH_STYLE : variant === 'danger' ? DANGER_STYLE : undefined;
  return (
    <ZButton
      variant={ZAUI_VARIANT[variant]}
      loading={loading}
      disabled={disabled}
      fullWidth={fullWidth}
      onClick={onPress}
      prefixIcon={IconCmp ? <Icon icon={IconCmp} size="sm" tone={variant === 'secondary' || variant === 'ghost' ? 'brand' : 'inverse'} /> : undefined}
      className={className}
      style={{ minHeight: size === 'lg' ? 48 : 44, borderRadius: 'var(--radius-control)', fontWeight: 600, ...toneStyle, ...style }}
    >
      {children}
    </ZButton>
  );
}
```

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/button.tsx apps/miniapp/src/components/ui/button.spec.tsx
git commit -m "feat(ds): Button — variant/size/loading state machine, structurally cannot repeat the loading/disabled bug (fixes A4-04)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `IconButton`

**Files:**
- Create: `apps/miniapp/src/components/ui/icon-button.tsx`
- Test: `apps/miniapp/src/components/ui/icon-button.spec.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 8).
- Produces: `IconButton({ icon: LucideIcon, label: string, size?: 'md'|'sm', onPress?, badge?, className?, style? })` — `label` is REQUIRED (TypeScript, not just lint) and renders as `aria-label`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/icon-button.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { X } from 'lucide-react';
import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('renders with aria-label from the required label prop', () => {
    render(<IconButton icon={X} label="Đóng" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
  });
  it('hit area is 44x44 for size=md (default) even though the visible circle is smaller', () => {
    render(<IconButton icon={X} label="Đóng" />);
    const btn = screen.getByRole('button', { name: 'Đóng' });
    expect(btn.style.minWidth).toBe('44px');
    expect(btn.style.minHeight).toBe('44px');
  });
  it('calls onPress on click', () => {
    const onPress = vi.fn();
    render(<IconButton icon={X} label="Đóng" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('shows a badge dot when badge=true', () => {
    render(<IconButton icon={X} label="Thông báo" badge />);
    expect(screen.getByTestId('icon-button-badge')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/icon-button.tsx
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  size?: 'md' | 'sm';
  onPress?: () => void;
  badge?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Nút chỉ-icon — vùng chạm LUÔN 44x44 dù nhìn nhỏ hơn (audit A4-14: 31 vòng icon 32-40px cũ).
 * `label` bắt buộc ở kiểu (TS) VÀ ở lint (Task 6) — hai lớp phòng thủ cho cùng một lỗi A4-16. */
export function IconButton({ icon: IconCmp, label, size = 'md', onPress, badge, className, style }: IconButtonProps) {
  const visualSize = size === 'md' ? 36 : 32;
  return (
    <button
      type="button"
      aria-label={label}
      className={['tubu-press', className].filter(Boolean).join(' ')}
      onClick={onPress}
      style={{
        position: 'relative',
        minWidth: 44,
        minHeight: 44,
        width: visualSize,
        height: visualSize,
        margin: (44 - visualSize) / 2,
        borderRadius: 'var(--radius-pill)',
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...style,
      }}
    >
      <Icon icon={IconCmp} size={size === 'md' ? 'md' : 'sm'} />
      {badge && (
        <span
          data-testid="icon-button-badge"
          aria-hidden
          style={{
            position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%',
            background: 'var(--color-action-danger-bg)', border: '1.5px solid var(--color-bg-surface)',
          }}
        />
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/icon-button.tsx apps/miniapp/src/components/ui/icon-button.spec.tsx
git commit -m "feat(ds): IconButton — 44x44 hit area, required label (fixes A4-14, A4-16 aria gap)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: `Card`

**Files:**
- Modify: `apps/miniapp/src/components/ui/primitives.tsx` — DELETE the `Card`/`CardProps` export (lines 98-131) and its now-unused `Box` import if nothing else in the file needs it (it does — `Stack`/`Row`/`StickyActionBar`/`ListRow` still use `Box`, so keep the import; only remove the `Card` block itself).
- Create: `apps/miniapp/src/components/ui/card.tsx`
- Test: `apps/miniapp/src/components/ui/card.spec.tsx`

**Interfaces:**
- Produces: `Card({ variant: 'raised'|'outline'|'flat', padding?: 0|8|12|16, onPress?, children })`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/card.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Card } from './card';

describe('Card', () => {
  it('raised (default) has elevation-1 box-shadow and radius-card', () => {
    render(<Card>x</Card>);
    const el = screen.getByText('x').parentElement as HTMLElement;
    expect(el.style.boxShadow).toBe('var(--elevation-1)');
    expect(el.style.borderRadius).toBe('var(--radius-card)');
  });
  it('outline has a border, no shadow', () => {
    render(<Card variant="outline">x</Card>);
    const el = screen.getByText('x').parentElement as HTMLElement;
    expect(el.style.border).toContain('var(--color-border-subtle)');
    expect(el.style.boxShadow).toBe('');
  });
  it('onPress makes it a role=button and fires on click', () => {
    const onPress = vi.fn();
    render(<Card onPress={onPress}>x</Card>);
    const el = screen.getByRole('button');
    fireEvent.click(el);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement, then remove the old `Card` from `primitives.tsx`**

```tsx
// apps/miniapp/src/components/ui/card.tsx
import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  variant?: 'raised' | 'outline' | 'flat';
  padding?: 0 | 8 | 12 | 16;
  onPress?: () => void;
  className?: string;
  style?: CSSProperties;
}

const VARIANT_STYLE: Record<NonNullable<CardProps['variant']>, CSSProperties> = {
  raised: { background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-1)' },
  outline: { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' },
  flat: { background: 'var(--color-bg-subtle)' },
};

/** Mặt phẳng nội dung tiêu chuẩn — thay 47 thẻ tự vẽ (audit A4-19). */
export function Card({ children, variant = 'raised', padding = 12, onPress, className, style }: CardProps) {
  const interactive = typeof onPress === 'function';
  return (
    <div
      role={interactive ? 'button' : undefined}
      onClick={onPress}
      className={[interactive ? 'tubu-press' : '', className].filter(Boolean).join(' ')}
      style={{ padding, borderRadius: 'var(--radius-card)', ...VARIANT_STYLE[variant], ...style }}
    >
      {children}
    </div>
  );
}
```

Delete lines 98-131 of `primitives.tsx` (the old `CardProps`/`Card` block).

- [ ] **Step 4: Run test, verify passes; run full miniapp test suite to confirm deleting old `Card` broke nothing (grep confirmed 0 importers before this task besides the primitives file itself)**

Run: `pnpm --filter @tubutree/miniapp exec vitest run card.spec.tsx primitives` — pass, no import errors.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/ui/card.tsx apps/miniapp/src/components/ui/card.spec.tsx apps/miniapp/src/components/ui/primitives.tsx
git commit -m "feat(ds): Card (raised/outline/flat), retire old primitives.tsx Card export

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: `Badge` / `StatusPill`

**Files:**
- Modify: `apps/miniapp/src/components/ui/primitives.tsx` — delete `Badge`/`BadgeTone`/`BADGE_STYLE` (lines 194-233); this file's only real importer is `apps/miniapp/src/components/ui/tier-badge.tsx` — update that file's import from `'./primitives'` to `'./badge'`.
- Create: `apps/miniapp/src/components/ui/badge.tsx`
- Test: `apps/miniapp/src/components/ui/badge.spec.tsx`

**Interfaces:**
- Produces: `Badge({ tone: 'success'|'warning'|'danger'|'info'|'neutral'|'brand'|'promo', size?: 'sm'|'md', icon?, children })`, `StatusPill` as an alias export with the same props (audit names both — `StatusPill` is the semantic name used for order-status contexts, `Badge` for generic labels; both render identically).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/badge.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge, StatusPill } from './badge';

describe('Badge', () => {
  it('success tone uses color.status.success tokens', () => {
    render(<Badge tone="success">Đã giao</Badge>);
    const el = screen.getByText('Đã giao');
    expect(el.style.background).toBe('var(--color-status-success-bg)');
    expect(el.style.color).toBe('var(--color-status-success-fg)');
  });
  it('promo tone uses color.promo tokens (replaces clay-* hardcoding)', () => {
    render(<Badge tone="promo">-20%</Badge>);
    const el = screen.getByText('-20%');
    expect(el.style.background).toBe('var(--color-promo-bg)');
  });
  it('StatusPill is the same component under a different name', () => {
    expect(StatusPill).toBe(Badge);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/badge.tsx
import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'promo';

const TONE_STYLE: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: 'var(--color-status-success-bg)', fg: 'var(--color-status-success-fg)' },
  warning: { bg: 'var(--color-status-warning-bg)', fg: 'var(--color-status-warning-fg)' },
  danger: { bg: 'var(--color-status-danger-bg)', fg: 'var(--color-status-danger-fg)' },
  info: { bg: 'var(--color-status-info-bg)', fg: 'var(--color-status-info-fg)' },
  neutral: { bg: 'var(--color-status-neutral-bg)', fg: 'var(--color-status-neutral-fg)' },
  brand: { bg: 'var(--color-action-secondary-bg)', fg: 'var(--color-action-secondary-fg)' },
  promo: { bg: 'var(--color-promo-bg)', fg: 'var(--color-promo-fg)' },
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

/** Nhãn trạng thái — thay 34 pill tự vẽ + STATUS_COLOR hardcode hex (audit A4-19). */
export function Badge({ children, tone = 'neutral', size = 'md', className, style }: BadgeProps) {
  const c = TONE_STYLE[tone];
  return (
    <span
      className={className}
      style={{
        background: c.bg, color: c.fg, fontWeight: 600, whiteSpace: 'nowrap',
        borderRadius: 'var(--radius-pill)',
        fontSize: size === 'md' ? 'var(--type-label-size)' : 11,
        padding: size === 'md' ? '3px 8px' : '2px 6px',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Alias — audit's own naming uses "StatusPill" for order/kiểm duyệt trạng thái contexts. */
export const StatusPill = Badge;
```

Update `apps/miniapp/src/components/ui/tier-badge.tsx`'s import line from `import { Badge } from './primitives';` to `import { Badge } from './badge';` (verify the exact current import line by reading the file first — do not guess it matches the old primitives export 1:1 without checking `tier-badge.tsx`'s actual prop usage against the new `Badge`'s prop shape).

Delete lines 194-233 of `primitives.tsx`.

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/badge.tsx apps/miniapp/src/components/ui/badge.spec.tsx apps/miniapp/src/components/ui/tier-badge.tsx apps/miniapp/src/components/ui/primitives.tsx
git commit -m "feat(ds): Badge/StatusPill, migrate tier-badge.tsx off old primitives.tsx Badge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: `Chip` / `SegmentedTabs`

**Files:**
- Modify: `apps/miniapp/src/components/ui/primitives.tsx` — delete `Chip` export (lines 236-267; confirmed 0 real importers, only the spec file — audit A4-19).
- Create: `apps/miniapp/src/components/ui/chip.tsx`
- Create: `apps/miniapp/src/components/ui/segmented-tabs.tsx`
- Test: `apps/miniapp/src/components/ui/chip.spec.tsx`
- Test: `apps/miniapp/src/components/ui/segmented-tabs.spec.tsx`

**Interfaces:**
- Produces: `Chip({ selected?, onPress?, icon?: LucideIcon, count?, size?: 'sm'|'md', variant?: 'filter'|'choice'|'info', children })`; `SegmentedTabs({ items: {key,label,count?}[], value, onChange, scroll? })`.
- Consumes: `Icon` (Task 8).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/miniapp/src/components/ui/chip.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Chip } from './chip';

describe('Chip', () => {
  it('selected chip uses forest action bg, unselected uses stone-100', () => {
    const { rerender } = render(<Chip selected>Còn hàng</Chip>);
    expect(screen.getByText('Còn hàng').style.background).toBe('var(--color-action-primary-bg)');
    rerender(<Chip>Còn hàng</Chip>);
    expect(screen.getByText('Còn hàng').style.background).toBe('var(--stone-100)');
  });
  it('min touch height 36 visual / 44 hit area via padding', () => {
    render(<Chip>x</Chip>);
    expect(screen.getByRole('button').style.minHeight).toBe('36px');
  });
  it('fires onPress', () => {
    const onPress = vi.fn();
    render(<Chip onPress={onPress}>x</Chip>);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

```tsx
// apps/miniapp/src/components/ui/segmented-tabs.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SegmentedTabs } from './segmented-tabs';

describe('SegmentedTabs', () => {
  const items = [{ key: 'all', label: 'Tất cả' }, { key: 'pending', label: 'Chờ xử lý', count: 3 }];
  it('renders all items, marks the active one', () => {
    render(<SegmentedTabs items={items} value="all" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Tất cả/, selected: true })).toBeInTheDocument();
  });
  it('calls onChange with the clicked key', () => {
    const onChange = vi.fn();
    render(<SegmentedTabs items={items} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByText(/Chờ xử lý/));
    expect(onChange).toHaveBeenCalledWith('pending');
  });
  it('shows count badge when provided', () => {
    render(<SegmentedTabs items={items} value="all" onChange={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run both to verify they fail.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/chip.tsx
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';

export interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  count?: number;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

/** Chip lọc/chọn — thay 3 định nghĩa trùng lặp (browse.tsx/feed.tsx byte-for-byte, audit A4-19). */
export function Chip({ children, selected, onPress, icon: IconCmp, count, size = 'md', className, style }: ChipProps) {
  return (
    <span
      role={onPress ? 'button' : undefined}
      aria-pressed={onPress ? selected : undefined}
      className={['tubu-press', className].filter(Boolean).join(' ')}
      onClick={onPress}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: selected ? 'var(--color-action-primary-bg)' : 'var(--stone-100)',
        color: selected ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
        fontWeight: selected ? 600 : 500,
        fontSize: 'var(--type-body-sm-size)',
        padding: size === 'md' ? '8px 14px' : '6px 10px',
        minHeight: size === 'md' ? 36 : 32,
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {IconCmp && <Icon icon={IconCmp} size="sm" tone={selected ? 'inverse' : 'muted'} />}
      {children}
      {typeof count === 'number' && <span style={{ opacity: 0.75 }}>({count})</span>}
    </span>
  );
}
```

```tsx
// apps/miniapp/src/components/ui/segmented-tabs.tsx
export interface SegmentedTabItem { key: string; label: string; count?: number }

export interface SegmentedTabsProps {
  items: SegmentedTabItem[];
  value: string;
  onChange: (key: string) => void;
  scroll?: boolean;
}

/** Thay 5 kiểu tab khác nhau hiện tại (pill cam, TabChip, Button ZaUI đổi variant, Chip, Text-chip
 * — audit A4-19). role="tablist"/"tab" cho a11y (0 chỗ dùng hiện tại). */
export function SegmentedTabs({ items, value, onChange, scroll }: SegmentedTabsProps) {
  return (
    <div
      role="tablist"
      className={scroll ? 'scroll-x' : undefined}
      style={{ display: 'flex', gap: 4, background: 'var(--stone-100)', borderRadius: 'var(--radius-control)', padding: 3 }}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            style={{
              flex: scroll ? undefined : 1,
              minHeight: 40,
              border: 'none',
              borderRadius: 'var(--radius-control)',
              background: active ? 'var(--color-bg-surface)' : 'transparent',
              color: active ? 'var(--color-text-brand)' : 'var(--color-text-tertiary)',
              fontWeight: 600,
              fontSize: 'var(--type-body-sm-size)',
              boxShadow: active ? 'var(--elevation-1)' : 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              padding: '0 12px',
            }}
          >
            {it.label}
            {typeof it.count === 'number' && ` (${it.count})`}
          </button>
        );
      })}
    </div>
  );
}
```

Delete lines 236-267 of `primitives.tsx`.

- [ ] **Step 4: Run tests, verify pass; commit**

```bash
git add apps/miniapp/src/components/ui/chip.tsx apps/miniapp/src/components/ui/segmented-tabs.tsx apps/miniapp/src/components/ui/*.spec.tsx apps/miniapp/src/components/ui/primitives.tsx
git commit -m "feat(ds): Chip + SegmentedTabs, retire duplicate Chip definitions (fixes A4-19)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: `ListRow` / `KeyValueRow`

**Files:**
- Modify: `apps/miniapp/src/components/ui/primitives.tsx` — delete `ListRow` (lines 330-370) and `SectionHeader` (lines 269-294; folded into Task 22's `PageHeader`/section-header responsibility — confirm 0 real importers before deleting, same as `Card`/`Chip`).
- Create: `apps/miniapp/src/components/ui/list-row.tsx`
- Create: `apps/miniapp/src/components/ui/key-value-row.tsx`
- Test: `apps/miniapp/src/components/ui/list-row.spec.tsx`

**Interfaces:**
- Produces: `ListRow({ icon?, title, subtitle?, trailing?: 'chevron'|'switch'|ReactNode, onPress?, destructive? })`, `KeyValueRow({ label, value, emphasis?, tone? })`.
- Consumes: `Icon` (Task 8).

- [ ] **Step 1: Write the failing test — this is the exact bug the old `ListRow` had (only the text Box got onClick, not the whole row)**

```tsx
// apps/miniapp/src/components/ui/list-row.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChevronRight } from 'lucide-react';
import { ListRow } from './list-row';

describe('ListRow', () => {
  it('the ENTIRE row (not just the text) is clickable — regression test for the old primitives.tsx bug', () => {
    const onPress = vi.fn();
    render(<ListRow icon={<span data-testid="icon" />} title="Cài đặt" onPress={onPress} />);
    const row = screen.getByRole('button', { name: /Cài đặt/ });
    // Click the icon area, NOT the title text — old ListRow only attached onClick to the title's
    // inner Box, so clicking anywhere else in the row (icon, padding, trailing chevron) did nothing.
    fireEvent.click(screen.getByTestId('icon'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('trailing="chevron" renders a chevron icon', () => {
    render(<ListRow title="x" trailing="chevron" onPress={() => {}} />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });
  it('minHeight 44', () => {
    render(<ListRow title="x" onPress={() => {}} />);
    expect(screen.getByRole('button').style.minHeight).toBe('44px');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/list-row.tsx
import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Icon } from './icon';
import { Text } from './text';

export interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: 'chevron' | 'switch' | ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  style?: CSSProperties;
}

/** Dòng danh sách — onClick giờ nằm trên NGUYÊN HÀNG (role="button"), không chỉ vùng chữ như bản
 * cũ ở primitives.tsx:356 (audit A4-07: hiệu ứng nhấn áp cả hàng nhưng chỉ chữ nhận được tap). */
export function ListRow({ icon, title, subtitle, trailing, onPress, destructive, style }: ListRowProps) {
  const trailingNode = trailing === 'chevron' ? <Icon icon={ChevronRight} size="sm" tone="muted" /> : trailing === 'switch' ? null : trailing;
  return (
    <div
      role={onPress ? 'button' : undefined}
      onClick={onPress}
      className={onPress ? 'tubu-press' : undefined}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '12px 0', minHeight: 44, boxSizing: 'border-box', cursor: onPress ? 'pointer' : undefined,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" tone={destructive ? 'danger' : 'primary'} as="div" style={{ fontWeight: 600 }}>{title}</Text>
          {subtitle && <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>{subtitle}</Text>}
        </div>
      </div>
      {trailingNode}
    </div>
  );
}
```

```tsx
// apps/miniapp/src/components/ui/key-value-row.tsx
import type { CSSProperties, ReactNode } from 'react';
import { Text } from './text';

export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  emphasis?: boolean;
  tone?: 'primary' | 'danger' | 'success';
  style?: CSSProperties;
}

/** Dòng nhãn-giá trị — thay `Row` định nghĩa 6 lần cho tổng tiền/phí ship/giảm giá (audit A4-19). */
export function KeyValueRow({ label, value, emphasis, tone = 'primary', style }: KeyValueRowProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', ...style }}>
      <Text variant="body-sm" tone="secondary">{label}</Text>
      <Text variant={emphasis ? 'title-sm' as never : 'body-sm'} tone={tone} style={{ fontWeight: emphasis ? 700 : 600 }}>{value}</Text>
    </div>
  );
}
```

Delete lines 269-370 of `primitives.tsx` (both `SectionHeader` and `ListRow` blocks — confirm no real importer exists for `SectionHeader` by grepping before deleting; if one is found, migrate that call site to `Heading`/`PageHeader` semantics in this same task rather than leaving a dangling import).

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/list-row.tsx apps/miniapp/src/components/ui/key-value-row.tsx apps/miniapp/src/components/ui/list-row.spec.tsx apps/miniapp/src/components/ui/primitives.tsx
git commit -m "feat(ds): ListRow (whole-row press, fixes A4-07 partial-click bug) + KeyValueRow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: `PriceTag` / `Money` / `Points` / `Xu`

**Files:**
- Delete: `apps/miniapp/src/components/ui/price.tsx` (old `Price`/`DiscountPct`, 0 real importers per audit A4-10)
- Create: `apps/miniapp/src/components/ui/price-tag.tsx`
- Test: `apps/miniapp/src/components/ui/price-tag.spec.tsx`
- Read first, do not modify yet: `apps/miniapp/src/utils/format.ts` (confirm the real current `formatVnd`/`formatXu`/`formatPoints` signatures before wrapping them — audit A4-10 says `formatXu` is defined twice and `fmtVnd` duplicates `formatVnd`; this task's `PriceTag`/`Money`/`Xu`/`Points` must call the ONE canonical formatter each, and if this task's own read finds the literal duplicate-definition bug still present, fix `format.ts` to a single definition per formatter as part of this task, updating all its importers)

**Interfaces:**
- Produces: `PriceTag({ value, compareAt?, flash?: {price}, size?: 'sm'|'md'|'lg'|'xl', tone?: 'default'|'inverse' })`, `Money({ amount, short? })`, `Points({ value })`, `Xu({ value })`.
- Consumes: `formatVnd`/`formatPoints`/`formatXu` from `utils/format.ts` (verified/fixed in Step 1 below), `Text` (Task 9).

- [ ] **Step 1: Read `utils/format.ts` in full, confirm or fix the duplicate-formatter bug**

Read the file. If `formatXu` is defined twice or a `fmtVnd` alias duplicates `formatVnd`, delete the duplicate and update every importer (grep `fmtVnd\(` and the second `formatXu` definition site) to use the single canonical name — this is a real, cheap bug fix while the file is open for this task, per the plan's Global Constraints.

- [ ] **Step 2: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/price-tag.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PriceTag, Money, Points, Xu } from './price-tag';

describe('PriceTag', () => {
  it('renders the formatted VND price, no compare-at shown when not on sale', () => {
    render(<PriceTag value={42000} />);
    expect(screen.getByText('42.000đ')).toBeInTheDocument();
    expect(screen.queryByText('52.000đ')).not.toBeInTheDocument();
  });
  it('shows a struck-through compareAt when it is greater than value', () => {
    render(<PriceTag value={42000} compareAt={52000} />);
    expect(screen.getByText('52.000đ')).toBeInTheDocument();
  });
  it('flash price wins and gets the flash tone', () => {
    render(<PriceTag value={52000} flash={{ price: 39000 }} />);
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
  });
  it('tabular-nums applied so digits align in lists', () => {
    render(<PriceTag value={1000} data-testid="p" />);
    expect(screen.getByText('1.000đ').style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('Money/Points/Xu', () => {
  it('Money renders a formatted amount', () => {
    render(<Money amount={100000} />);
    expect(screen.getByText('100.000đ')).toBeInTheDocument();
  });
  it('Points renders with "điểm" suffix', () => {
    render(<Points value={250} />);
    expect(screen.getByText(/250.*điểm/)).toBeInTheDocument();
  });
  it('Xu renders with the xu unit', () => {
    render(<Xu value={500} />);
    expect(screen.getByText(/500.*xu/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Implement** (exact formatter import names depend on Step 1's findings — use whatever the single canonical `formatVnd`/`formatPoints`/`formatXu` turn out to be):

```tsx
// apps/miniapp/src/components/ui/price-tag.tsx
import type { CSSProperties } from 'react';
import { formatVnd, formatPoints, formatXu } from '../../utils/format';

const SIZE_VARIANT = { sm: 'price-sm', md: 'price-md', lg: 'price-lg', xl: 'price-xl' } as const;

export interface PriceTagProps {
  value: number;
  compareAt?: number | null;
  flash?: { price: number } | null;
  size?: keyof typeof SIZE_VARIANT;
  tone?: 'default' | 'inverse';
  style?: CSSProperties;
}

/** Giá — thay 60 kiểu trình bày / 134 lần render rải rác (audit A4-10). Giá giờ vàng LUÔN thắng
 * khi có (đúng quy tắc flash > sale > base BE đã dùng ở giỏ hàng — không tự tính lại ở đây). */
export function PriceTag({ value, compareAt, flash, size = 'md', tone = 'default', style }: PriceTagProps) {
  const displayValue = flash ? flash.price : value;
  const showCompare = typeof compareAt === 'number' && compareAt > displayValue;
  const variant = SIZE_VARIANT[size];
  const color = tone === 'inverse' ? 'var(--color-text-inverse)' : flash ? 'var(--color-flash-fg)' : 'var(--color-text-price)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, ...style }}>
      <span style={{ fontFamily: 'var(--font-ui)', color, fontVariantNumeric: 'tabular-nums', ...typeStyleFor(variant) }}>
        {formatVnd(displayValue)}
      </span>
      {showCompare && (
        <span style={{ color: 'var(--color-text-price-compare)', textDecoration: 'line-through', fontSize: 'var(--type-caption-size)' }}>
          {formatVnd(compareAt)}
        </span>
      )}
    </span>
  );
}

function typeStyleFor(variant: string): CSSProperties {
  return {
    fontSize: `var(--type-${variant}-size)`,
    lineHeight: `var(--type-${variant}-lh)`,
    fontWeight: `var(--type-${variant}-weight)` as unknown as number,
  };
}

export function Money({ amount, short }: { amount: number; short?: boolean }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatVnd(amount, short)}</span>;
}

export function Points({ value }: { value: number }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPoints(value)}</span>;
}

export function Xu({ value }: { value: number }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatXu(value)}</span>;
}
```

If `formatVnd`/`formatPoints`/`formatXu`'s real signatures differ from the guesses above (e.g. `formatVnd` doesn't take a `short` second argument, or `formatPoints`/`formatXu` don't already append "điểm"/"xu" text and this component must append it itself), adjust to match what Step 1 actually found — do not silently change `utils/format.ts`'s public signature without updating this file to match.

- [ ] **Step 5: Delete `price.tsx`, run tests, verify pass**

Run: `pnpm --filter @tubutree/miniapp exec vitest run price-tag.spec.tsx` — pass. Confirm `git grep "from '.*ui/price'"` returns 0 hits before deleting (matches audit's own 0-importer finding).

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp/src/components/ui/price-tag.tsx apps/miniapp/src/components/ui/price-tag.spec.tsx apps/miniapp/src/utils/format.ts
git rm apps/miniapp/src/components/ui/price.tsx apps/miniapp/src/components/ui/price.spec.tsx
git commit -m "feat(ds): PriceTag/Money/Points/Xu, dedupe format.ts formatters (fixes A4-10)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 17: `BottomSheet` / `Dialog`

**Files:**
- Create: `apps/miniapp/src/components/ui/bottom-sheet.tsx`
- Test: `apps/miniapp/src/components/ui/bottom-sheet.spec.tsx`
- Read first: `zmp-ui`'s `Sheet` component real prop shape (check `node_modules/.pnpm/zmp-ui@1.11.14.../node_modules/zmp-ui/Sheet.d.ts` or equivalent typings) and confirm whether ZaUI's `Sheet` already applies `padding-bottom: env(safe-area-inset-bottom)` itself (audit A4-20 says yes — 20 existing call sites add `calc(16px + var(--safe-bottom))` ON TOP of it, double-padding on iPhone). This wrapper must apply safe-area exactly ONCE.

**Interfaces:**
- Produces: `BottomSheet({ open, onClose, title?, description?, footer?, size?: 'auto'|'half'|'full', dismissible?, children })`, `Dialog` (same shape, centered instead of bottom-anchored, for confirm-style prompts).
- Consumes: ZaUI `Sheet`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/bottom-sheet.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BottomSheet } from './bottom-sheet';

describe('BottomSheet', () => {
  it('renders children and title when open', () => {
    render(<BottomSheet open title="Đặt định kỳ" onClose={() => {}}>Nội dung</BottomSheet>);
    expect(screen.getByText('Đặt định kỳ')).toBeInTheDocument();
    expect(screen.getByText('Nội dung')).toBeInTheDocument();
  });
  it('renders nothing when open=false', () => {
    render(<BottomSheet open={false} onClose={() => {}}>Nội dung</BottomSheet>);
    expect(screen.queryByText('Nội dung')).not.toBeInTheDocument();
  });
  it('close button (44x44, has aria-label) calls onClose', () => {
    const onClose = vi.fn();
    render(<BottomSheet open title="x" onClose={onClose}>y</BottomSheet>);
    fireEvent.click(screen.getByRole('button', { name: /đóng/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('applies safe-area padding exactly once (not doubled)', () => {
    const { container } = render(<BottomSheet open onClose={() => {}}>y</BottomSheet>);
    const body = container.querySelector('[data-testid="bottom-sheet-body"]') as HTMLElement;
    expect(body.style.paddingBottom).not.toMatch(/calc\(.*safe-bottom.*safe-bottom/);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** (read the real ZaUI `Sheet` typings/source first — the exact prop names for `visible`/`onClose`/whether it renders its own overlay — before finalizing; the sketch below assumes the same `visible`/`onClose` shape `share-sheet.tsx` and `checkout/voucher-sheet.tsx` already use, confirmed via those files' existing usage):

```tsx
// apps/miniapp/src/components/ui/bottom-sheet.tsx
import type { ReactNode } from 'react';
import { Sheet } from 'zmp-ui';
import { X } from 'lucide-react';
import { Heading } from './text';
import { Text } from './text';
import { IconButton } from './icon-button';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footer?: ReactNode;
  size?: 'auto' | 'half' | 'full';
  dismissible?: boolean;
  children: ReactNode;
}

const SIZE_HEIGHT: Record<NonNullable<BottomSheetProps['size']>, string | undefined> = {
  auto: undefined, half: '50vh', full: '92vh',
};

/** Sheet chuẩn — an toàn-vùng CHỈ đặt MỘT LẦN ở đây (audit A4-20: 20/48 sheet hiện tại cộng
 * padding safe-area của MÌNH lên trên padding ZaUI đã tự thêm sẵn → hở đáy gấp đôi trên iPhone).
 * KHÔNG tự thêm safe-bottom nữa — dựa hoàn toàn vào ZaUI Sheet's own padding. */
export function BottomSheet({ open, onClose, title, description, footer, size = 'auto', dismissible = true, children }: BottomSheetProps) {
  if (!open) return null;
  return (
    <Sheet visible={open} onClose={dismissible ? onClose : undefined} height={SIZE_HEIGHT[size]}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {title && <Heading variant="title-md" as="h2">{title}</Heading>}
          <IconButton icon={X} label="Đóng" onPress={onClose} />
        </div>
        {description && <Text variant="body-sm" tone="secondary">{description}</Text>}
      </div>
      <div data-testid="bottom-sheet-body" style={{ padding: '0 16px 16px' }}>
        {children}
      </div>
      {footer && <div style={{ padding: 16, borderTop: '1px solid var(--color-border-subtle)' }}>{footer}</div>}
    </Sheet>
  );
}

/** Cùng API, dùng cho xác nhận/cảnh báo ngắn — ZaUI không có Dialog riêng nên tái dùng Sheet
 * với size='auto' làm phần thân trung tâm là đủ cho nhu cầu hiện tại (không cần modal desktop). */
export const Dialog = BottomSheet;
```

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/bottom-sheet.tsx apps/miniapp/src/components/ui/bottom-sheet.spec.tsx
git commit -m "feat(ds): BottomSheet/Dialog — safe-area applied exactly once (fixes A4-20 double-padding)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 18: `StickyActionBar`, `ProgressBar`/`Meter`, small tiles (`StatTile`, `FlashBadge`, `CountdownChip`, `Avatar`)

**Files:**
- Modify: `apps/miniapp/src/components/ui/primitives.tsx` — delete `StickyActionBar` (lines 296-328; already token-driven and mostly correct, just needs the token names updated and to move out of this soon-to-be-deleted file)
- Create: `apps/miniapp/src/components/ui/sticky-action-bar.tsx`
- Create: `apps/miniapp/src/components/ui/progress-bar.tsx`
- Create: `apps/miniapp/src/components/ui/tiles.tsx` (`StatTile`, `FlashBadge`, `CountdownChip`, `Avatar` — small, grouped per audit's own "5-8 file mỗi loại" grouping)
- Test: `apps/miniapp/src/components/ui/sticky-action-bar.spec.tsx`
- Test: `apps/miniapp/src/components/ui/progress-bar.spec.tsx`
- Test: `apps/miniapp/src/components/ui/tiles.spec.tsx`

**Interfaces:**
- Produces: `StickyActionBar({ primary: ReactNode, secondary?, summary? })`; `ProgressBar({ value, max, tone?, label? })`, `Meter` (alias); `StatTile({ label, value, delta?, icon?, onPress? })`, `FlashBadge({ label })`, `CountdownChip({ endsAt: string })`, `Avatar({ src?, fallback, size? })`.
- Consumes: `Icon`, `Text`.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/miniapp/src/components/ui/sticky-action-bar.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StickyActionBar } from './sticky-action-bar';

describe('StickyActionBar', () => {
  it('applies safe-area padding exactly once and is fixed to the bottom', () => {
    render(<StickyActionBar primary={<button>Mua ngay</button>} />);
    const bar = screen.getByText('Mua ngay').closest('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.style.position).toBe('fixed');
    expect(bar.style.paddingBottom).toBe('calc(16px + var(--safe-bottom))');
  });
  it('renders optional summary above the buttons', () => {
    render(<StickyActionBar primary={<button>x</button>} summary={<span>Tổng 100.000đ</span>} />);
    expect(screen.getByText('Tổng 100.000đ')).toBeInTheDocument();
  });
});
```

```tsx
// apps/miniapp/src/components/ui/progress-bar.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('renders width proportional to value/max', () => {
    render(<ProgressBar value={30} max={100} />);
    const fill = screen.getByTestId('progress-fill');
    expect(fill.style.width).toBe('30%');
  });
  it('clamps over-100% to 100', () => {
    render(<ProgressBar value={150} max={100} />);
    expect(screen.getByTestId('progress-fill').style.width).toBe('100%');
  });
});
```

```tsx
// apps/miniapp/src/components/ui/tiles.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatTile, FlashBadge, CountdownChip, Avatar } from './tiles';

describe('small tiles', () => {
  it('StatTile shows label and value', () => {
    render(<StatTile label="Đơn tháng này" value="12" />);
    expect(screen.getByText('Đơn tháng này')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
  it('FlashBadge uses flash tone', () => {
    render(<FlashBadge label="Giờ vàng" />);
    expect(screen.getByText('Giờ vàng').style.background).toBe('var(--color-flash-solid-bg)');
  });
  it('Avatar falls back to initial when no src', () => {
    render(<Avatar fallback="Tubu" />);
    expect(screen.getByText('T')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run all three to verify they fail.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/ui/sticky-action-bar.tsx
import type { ReactNode } from 'react';

export interface StickyActionBarProps {
  primary: ReactNode;
  secondary?: ReactNode;
  summary?: ReactNode;
}

/** Thanh CTA dính đáy — safe-area MỘT LẦN ở đây, không phải mỗi trang tự cộng (audit A4-21: 10
 * thanh tự vẽ, 3 thiếu safe-area hoàn toàn). */
export function StickyActionBar({ primary, secondary, summary }: StickyActionBarProps) {
  return (
    <div
      data-testid="sticky-bar"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-3)',
        padding: 16, paddingBottom: 'calc(16px + var(--safe-bottom))',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      {summary}
      <div style={{ display: 'flex', gap: 10 }}>
        {secondary}
        <div style={{ flex: 1 }}>{primary}</div>
      </div>
    </div>
  );
}
```

```tsx
// apps/miniapp/src/components/ui/progress-bar.tsx
export interface ProgressBarProps {
  value: number;
  max: number;
  tone?: 'brand' | 'flash';
  label?: string;
}

/** Thay 12 thanh tự vẽ (audit A4-19). */
export function ProgressBar({ value, max, tone = 'brand', label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      {label && <div style={{ fontSize: 'var(--type-caption-size)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{label}</div>}
      <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--stone-200)', overflow: 'hidden' }}>
        <div
          data-testid="progress-fill"
          style={{ height: '100%', width: `${pct}%`, borderRadius: 'var(--radius-pill)', background: tone === 'flash' ? 'var(--color-flash-solid-bg)' : 'var(--color-action-primary-bg)', transition: 'width var(--motion-emphasize)' }}
        />
      </div>
    </div>
  );
}

export const Meter = ProgressBar;
```

```tsx
// apps/miniapp/src/components/ui/tiles.tsx
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';
import { Text, Heading } from './text';

export function StatTile({ label, value, delta, icon: IconCmp, onPress }: { label: string; value: string; delta?: string; icon?: LucideIcon; onPress?: () => void }) {
  return (
    <div role={onPress ? 'button' : undefined} onClick={onPress} className={onPress ? 'tubu-press' : undefined}
      style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', padding: 12 }}>
      {IconCmp && <Icon icon={IconCmp} size="sm" tone="brand" />}
      <Heading variant="title-lg" as="div" style={{ marginTop: 4 }}>{value}</Heading>
      <Text variant="caption" tone="tertiary">{label}</Text>
      {delta && <Text variant="caption" tone="success">{delta}</Text>}
    </div>
  );
}

export function FlashBadge({ label }: { label: string }) {
  return <span style={{ background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)', fontWeight: 700, fontSize: 'var(--type-label-size)', padding: '3px 8px', borderRadius: 'var(--radius-pill)' }}>{label}</span>;
}

export function CountdownChip({ endsAt }: { endsAt: string }) {
  return <span style={{ background: 'var(--color-flash-bg)', color: 'var(--color-flash-fg)', fontWeight: 600, fontSize: 'var(--type-caption-size)', padding: '3px 8px', borderRadius: 'var(--radius-pill)' }} data-ends-at={endsAt} />;
}

export function Avatar({ src, fallback, size = 44 }: { src?: string | null; fallback: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'var(--color-action-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Text variant="title-sm" as="span" tone="inverse">{fallback.charAt(0).toUpperCase()}</Text>}
    </div>
  );
}
```

Delete lines 296-328 of `primitives.tsx`.

- [ ] **Step 4: Run all 3 test files, verify pass; commit**

```bash
git add apps/miniapp/src/components/ui/sticky-action-bar.tsx apps/miniapp/src/components/ui/progress-bar.tsx apps/miniapp/src/components/ui/tiles.tsx apps/miniapp/src/components/ui/*.spec.tsx apps/miniapp/src/components/ui/primitives.tsx
git commit -m "feat(ds): StickyActionBar/ProgressBar/StatTile/FlashBadge/CountdownChip/Avatar (fixes A4-19, A4-21)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 19: Form controls — `Field`, `Checkbox`, `Radio`, `Switch`

**Files:**
- Create: `apps/miniapp/src/components/ui/form.tsx`
- Test: `apps/miniapp/src/components/ui/form.spec.tsx`

**Interfaces:**
- Produces: `Field({ label, error?, children })` (a labeled wrapper around a ZaUI `Input` or any child), `Checkbox`/`Radio`/`Switch` as thin re-exports of ZaUI's own (already correctly themed by Task 4's ZaUI bridge — these wrappers exist only to give the DS a single import surface + consistent 44px hit area, not to reimplement behavior).
- Consumes: ZaUI `Checkbox`, `Radio`, `Switch`, `Input`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/form.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Field, Checkbox } from './form';

describe('Field', () => {
  it('renders label and error message', () => {
    render(<Field label="Số điện thoại" error="Không hợp lệ"><input /></Field>);
    expect(screen.getByText('Số điện thoại')).toBeInTheDocument();
    expect(screen.getByText('Không hợp lệ')).toBeInTheDocument();
  });
  it('omits error text when none given', () => {
    render(<Field label="Tên"><input /></Field>);
    expect(screen.queryByText(/không hợp lệ/i)).not.toBeInTheDocument();
  });
});

describe('Checkbox', () => {
  it('has a 44px min touch target wrapper', () => {
    render(<Checkbox label="Đồng ý điều khoản" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox').closest('[data-testid="checkbox-hit-area"]')).toHaveStyle({ minHeight: '44px' });
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** (read ZaUI's real `Checkbox`/`Radio`/`Switch` prop names first — `zmp-ui`'s own `.d.ts` files — before finalizing the exact prop-forwarding; sketch below assumes `checked`/`onChange`/`label` matching the pattern already used at `cart.tsx:257`, `settings.tsx:119` per audit citations):

```tsx
// apps/miniapp/src/components/ui/form.tsx
import type { ReactNode } from 'react';
import { Checkbox as ZCheckbox, Radio as ZRadio, Switch as ZSwitch } from 'zmp-ui';
import { Text } from './text';

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 4 }}>{label}</Text>
      {children}
      {error && <Text variant="caption" tone="danger" as="div" style={{ marginTop: 2 }}>⚠ {error}</Text>}
    </div>
  );
}

function hitArea(children: ReactNode) {
  return <div data-testid="checkbox-hit-area" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>{children}</div>;
}

export function Checkbox(props: React.ComponentProps<typeof ZCheckbox>) {
  return hitArea(<ZCheckbox {...props} />);
}
export function Radio(props: React.ComponentProps<typeof ZRadio>) {
  return hitArea(<ZRadio {...props} />);
}
export function Switch(props: React.ComponentProps<typeof ZSwitch>) {
  return hitArea(<ZSwitch {...props} />);
}
```

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/form.tsx apps/miniapp/src/components/ui/form.spec.tsx
git commit -m "feat(ds): Field/Checkbox/Radio/Switch — 44px hit area wrappers over themed ZaUI controls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 20: `AddressForm` consolidation

**Files:**
- Create: `apps/miniapp/src/components/address-form.tsx`
- Modify: `apps/miniapp/src/components/checkout/address-section.tsx` — delete the private `AddressForm` function (lines 176-277) and its now-duplicate `validate`/`validateGeo`/`FormState`/`FIELD_LABEL`/`VN_PHONE` (lines 11-42), import the shared one instead
- Modify: `apps/miniapp/src/pages/addresses.tsx` — delete its own private `AddressForm` (lines 230-354) and duplicate validation helpers, import the shared one instead
- Test: `apps/miniapp/src/components/address-form.spec.tsx`

**Interfaces:**
- Produces: `AddressForm({ initial?: AddressDTO | null, onCancel: () => void, onSaved: (a: AddressDTO) => void })` — internally calls `createAddress` when `initial` is null/undefined, `updateAddress(initial.id, ...)` otherwise. Prefills from `initial` when editing, and (matching `addresses.tsx`'s current new-address behavior) prefills `recipient`/`phone` from the logged-in user when creating.
- Consumes: `createAddress`/`updateAddress`/`AddressDTO` from `services/shop-api`, `GeoPicker`/`EMPTY_GEO`/`GeoValue` from `components/geo-picker`, `useAuthStore`, `Field`/`Button` (Tasks 19/10).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/address-form.spec.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddressForm } from './address-form';
import * as shopApi from '../services/shop-api';

vi.mock('../services/shop-api', () => ({ createAddress: vi.fn(), updateAddress: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { fullName: 'Long', phone: '0900000000' } }) }));

describe('AddressForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create mode (no initial): starts empty except recipient/phone prefilled from logged-in user', () => {
    render(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByDisplayValue('Long')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0900000000')).toBeInTheDocument();
  });

  it('edit mode: prefills every field from `initial`, calls updateAddress(initial.id, ...) on save', async () => {
    const initial = { id: 'a1', recipient: 'Ánh', phone: '0911111111', street: '123 Lê Lợi', province: 'HCM', provinceCode: '79', ward: 'P1', wardCode: '00001', isDefault: false } as never;
    (shopApi.updateAddress as ReturnType<typeof vi.fn>).mockResolvedValue(initial);
    render(<AddressForm initial={initial} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByDisplayValue('Ánh')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Lưu'));
    await waitFor(() => expect(shopApi.updateAddress).toHaveBeenCalledWith('a1', expect.any(Object)));
    expect(shopApi.createAddress).not.toHaveBeenCalled();
  });

  it('create mode: calls createAddress (not updateAddress) on save', async () => {
    (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
    const onSaved = vi.fn();
    render(<AddressForm initial={null} onCancel={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/tên người nhận|recipient/i), { target: { value: 'Test' } });
    // street + geo left empty on purpose here — this test only asserts WHICH api gets called on
    // a fully-valid-enough path; full validation-blocks-submit behavior is covered by the pre-
    // existing validate()/validateGeo() logic being carried over unchanged, not re-tested here.
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — read the two current implementations shown in this task's Files section one more time immediately before writing (they're already fully quoted in this plan's research, but re-read the live files in case another task touched them first) and merge them literally: keep `validate`/`validateGeo`/`FormState`/`FIELD_LABEL`/`VN_PHONE` exactly as they are today (both files have byte-identical copies of these), add the `initial`/edit branch from `addresses.tsx`'s version, keep the `Field`-wrapped `Input`s but swap the raw `Button`s for the new `Button` (Task 10) and fix the loading/disabled bug (Global Constraints) in the same edit:

```tsx
// apps/miniapp/src/components/address-form.tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { createAddress, updateAddress, type AddressDTO } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { GeoPicker, EMPTY_GEO, type GeoValue } from './geo-picker';
import { Field } from './ui/form';
import { Button } from './ui/button';
import { Input } from 'zmp-ui';

type FormFields = 'recipient' | 'phone' | 'street';
type FormState = Record<FormFields, string>;
const EMPTY_FORM: FormState = { recipient: '', phone: '', street: '' };
const VN_PHONE = /^(0|\+84)\d{9}$/;
const FIELD_LABEL: Record<FormFields, string> = { recipient: vi.checkout.recipient, phone: vi.checkout.phone, street: vi.checkout.street };

function validate(form: FormState): Partial<Record<FormFields, string>> {
  const errors: Partial<Record<FormFields, string>> = {};
  (Object.keys(form) as FormFields[]).forEach((k) => { if (!form[k].trim()) errors[k] = vi.checkout.requiredField; });
  if (form.phone.trim() && !VN_PHONE.test(form.phone.replace(/\s/g, ''))) errors.phone = vi.checkout.phoneInvalid;
  return errors;
}
function validateGeo(g: GeoValue): { province?: string; ward?: string } {
  const e: { province?: string; ward?: string } = {};
  if (!g.provinceCode) e.province = vi.checkout.requiredField;
  if (!g.wardCode) e.ward = vi.checkout.requiredField;
  return e;
}

export interface AddressFormProps {
  initial?: AddressDTO | null;
  onCancel: () => void;
  onSaved: (a: AddressDTO) => void;
}

/** Form địa chỉ dùng chung cho cả checkout (tạo mới, inline) và sổ địa chỉ (tạo/sửa, trong
 * sheet) — trước đây 2 bản gần như trùng byte-for-byte ở checkout/address-section.tsx và
 * pages/addresses.tsx (audit A4-19). */
export function AddressForm({ initial, onCancel, onSaved }: AddressFormProps) {
  const { openSnackbar } = useSnackbar();
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState<FormState>(
    initial
      ? { recipient: initial.recipient, phone: initial.phone, street: initial.street }
      : { ...EMPTY_FORM, recipient: user?.fullName ?? '', phone: user?.phone ?? '' },
  );
  const [geo, setGeo] = useState<GeoValue>(
    initial && initial.provinceCode && initial.provinceCode !== '00'
      ? { province: initial.province, provinceCode: initial.provinceCode, ward: initial.ward, wardCode: initial.wardCode && initial.wardCode !== '00' ? initial.wardCode : '' }
      : EMPTY_GEO,
  );
  const [errors, setErrors] = useState<Partial<Record<FormFields, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<FormFields, boolean>>>({});
  const [geoErr, setGeoErr] = useState<{ province?: string; ward?: string }>({});

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        recipient: form.recipient.trim(), phone: form.phone.replace(/\s/g, ''), street: form.street.trim(),
        province: geo.province, ward: geo.ward, district: '',
        provinceCode: geo.provinceCode, wardCode: geo.wardCode, districtCode: '',
      };
      return initial ? updateAddress(initial.id, payload) : createAddress(payload);
    },
    onSuccess: (a) => {
      haptic('medium');
      openSnackbar({ text: initial ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.', type: 'success' });
      onSaved(a);
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const setField = (k: FormFields) => (e: { target: { value: string } }) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    if (touched[k]) setErrors(validate(next));
  };
  const blurField = (k: FormFields) => () => { setTouched((t) => ({ ...t, [k]: true })); setErrors(validate(form)); };
  const submit = () => {
    const allErrors = validate(form);
    const gErr = validateGeo(geo);
    setErrors(allErrors);
    setGeoErr(gErr);
    setTouched({ recipient: true, phone: true, street: true });
    if (Object.keys(allErrors).length === 0 && Object.keys(gErr).length === 0) save.mutate();
  };
  const renderField = (k: FormFields) => (
    <Field label={FIELD_LABEL[k]} error={touched[k] ? errors[k] : undefined}>
      <Input value={form[k]} onChange={setField(k)} onBlur={blurField(k)} inputMode={k === 'phone' ? 'numeric' : undefined} status={touched[k] && errors[k] ? 'error' : undefined} />
    </Field>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {renderField('recipient')}
      {renderField('phone')}
      <GeoPicker value={geo} onChange={(g) => { setGeo(g); setGeoErr(validateGeo(g)); }} errorProvince={geoErr.province} errorWard={geoErr.ward} />
      {renderField('street')}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button variant="secondary" onPress={onCancel}>{vi.common.cancel}</Button>
        <Button loading={save.isPending} onPress={submit} fullWidth>{vi.common.save}</Button>
      </div>
    </div>
  );
}
```

Update `address-section.tsx` to import `{ AddressForm }` from `'../address-form'` and pass `initial={null} onCancel={...} onSaved={(a) => {...; onSelect(a.id)}}`. Update `addresses.tsx` to import from `'../components/address-form'` and pass `initial={editing} onCancel={onClose} onSaved={() => {...; onSaved()}}` (adapt exactly to what its current local `AddressForm` call site does — re-read that call site before editing since this task deleted the function it called).

- [ ] **Step 4: Run test, verify passes; run the FULL miniapp test suite (this touches 2 existing pages' behavior)**

Run: `pnpm --filter @tubutree/miniapp exec vitest run address-form checkout addresses` — all pass, no regressions in either page's existing spec files.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/address-form.tsx apps/miniapp/src/components/address-form.spec.tsx apps/miniapp/src/components/checkout/address-section.tsx apps/miniapp/src/pages/addresses.tsx
git commit -m "feat(ds): consolidate AddressForm (checkout + sổ địa chỉ shared 1 bản, fixes A4-19 dup + A4-04 loading bug)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 21: `EmptyState` / `ErrorState` / `Skeleton` — recolor + `variant` prop

**Files:**
- Modify: `apps/miniapp/src/components/ui/empty-state.tsx` — replace every `var(--leaf-*)`/`var(--clay-*)`/`var(--primary-*)`/`var(--sun-*)`/`var(--neutral-*)` reference in the 5 inline SVG illustrations and the `EmptyState`/`ErrorState` components with the new semantic tokens; fix the loading/disabled bug at line 96 (`disabled={ctaLoading}` alongside `loading={ctaLoading}` — same Global Constraints bug); add `variant?: 'page' | 'inline'` (default `'page'`) that toggles padding (`'40px 32px'` for page, `'16px'` for inline).
- Modify: `apps/miniapp/src/components/ui/skeleton.tsx` — no logic changes needed (already fully token-driven), just confirm after Task 3's token swap that `var(--radius-md)`/`var(--radius-lg)`/`var(--shadow-sm)`/`var(--neutral-0)` references now resolve — if any of those specific var names no longer exist (they don't: the new token file uses `--radius-control`/`--radius-card`/`--elevation-1`/`--color-bg-surface` instead), update this file's 3 hardcoded references to the new names.
- Test: `apps/miniapp/src/components/ui/empty-state.spec.tsx` (new)
- Test: existing `apps/miniapp/src/components/ui/skeleton.spec.tsx` if present, else create one covering the 3 var-name updates

**Interfaces:**
- No prop signature changes to `EmptyState`/`ErrorState`/`Skeleton`/`ProductCardSkeleton`/`ProductGridSkeleton`/`LineItemSkeleton` except the new optional `variant` on `EmptyState`/`ErrorState` — the 36-37 existing call sites across the app keep working unmodified.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/empty-state.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyState, ErrorState } from './empty-state';

describe('EmptyState', () => {
  it('CTA loading state actually shows the spinner (regression test for the disabled+loading bug)', () => {
    render(<EmptyState art="box" heading="Chưa có đơn" ctaLabel="Mua ngay" onCta={() => {}} ctaLoading />);
    const btn = screen.getByText('Mua ngay').closest('.zaui-btn') as HTMLElement;
    expect(btn.className).toContain('loading');
    expect(btn.getAttribute('disabled')).toBeNull(); // NOT disabled — old bug set disabled={ctaLoading} too
  });
  it('variant="inline" uses tighter padding than the default "page"', () => {
    const { rerender } = render(<EmptyState art="leaf" heading="x" variant="inline" />);
    expect(screen.getByText('x').closest('.tubu-rise')).toHaveStyle({ padding: '16px' });
    rerender(<EmptyState art="leaf" heading="x" />);
    expect(screen.getByText('x').closest('.tubu-rise')).toHaveStyle({ padding: '40px 32px' });
  });
});

describe('ErrorState', () => {
  it('retry button text-on-secondary-bg is the new forest tone, not the old orange', () => {
    render(<ErrorState message="Lỗi mạng" onRetry={() => {}} />);
    const btn = screen.getByText('Thử lại');
    expect(btn.style.color).toBe('var(--color-action-secondary-fg)');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Edit `empty-state.tsx`** — apply a global find/replace of the old var names to new semantic equivalents per this mapping (also documented in the spec's §3 codemod table): `--leaf-400`→`--color-action-primary-bg`, `--leaf-600`/`--leaf-700`→`--color-text-brand`, `--clay-200`/`--clay-500`/`--clay-700`→`--color-promo-*` (pick bg/fg per usage), `--primary-100`/`--primary-700`/`--primary-900`→`--color-action-secondary-bg`/`--color-action-secondary-fg`/`--color-text-primary` per usage, `--sun-300`→`--color-flash-bg`, `--neutral-0/50/100/400/600`→`--color-bg-surface`/`--color-bg-canvas`/`--stone-100`/`--color-text-tertiary`/`--color-text-secondary`. Add the `variant` prop and fix the loading/disabled line:

```tsx
// only the changed parts of empty-state.tsx — full file keeps its existing ART/EmptyStateProps structure
interface EmptyStateProps {
  art: Art;
  heading: string;
  body?: string;
  ctaLabel?: string;
  onCta?: () => void;
  ctaLoading?: boolean;
  variant?: 'page' | 'inline';
}

export function EmptyState({ art, heading, body, ctaLabel, onCta, ctaLoading, variant = 'page' }: EmptyStateProps) {
  return (
    <div className="tubu-rise" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: variant === 'inline' ? '16px' : '40px 32px', gap: 6 }}>
      {ART[art]}
      <Text bold style={{ fontSize: 17, marginTop: 10 }}>{heading}</Text>
      {body && <Text size="small" style={{ color: 'var(--color-text-secondary)', maxWidth: 260 }}>{body}</Text>}
      {ctaLabel && onCta && (
        <Button onClick={onCta} loading={ctaLoading} style={{ background: 'var(--color-action-primary-bg)', marginTop: 14, minHeight: 44 }}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}
```

(Note: `disabled={ctaLoading}` is REMOVED — only `loading` is passed, fixing the bug.) Apply the same var-name mapping to the `ART` SVG record and to `ErrorState`'s inline styles, and remove `ErrorState`'s own equivalent issue if present.

- [ ] **Step 4: Edit `skeleton.tsx`'s 3 stale var names** to `var(--color-bg-surface)`, `var(--radius-card)`, `var(--elevation-1)` (previously `var(--neutral-0)`, `var(--radius-lg)`, `var(--shadow-sm)`).

- [ ] **Step 5: Run tests, verify pass; run the 36-37 existing call sites' own specs to confirm no regression**

Run: `pnpm --filter @tubutree/miniapp exec vitest run empty-state skeleton` plus a broader `pnpm --filter @tubutree/miniapp test` to catch any spec elsewhere asserting the old hex/var names against these two files' rendered output.

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp/src/components/ui/empty-state.tsx apps/miniapp/src/components/ui/skeleton.tsx apps/miniapp/src/components/ui/empty-state.spec.tsx
git commit -m "fix(ds): EmptyState/ErrorState/Skeleton recolor to semantic tokens, fix loading/disabled bug (fixes A4-02, A4-04)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 22: `PageHeader`

**Files:**
- Create: `apps/miniapp/src/components/ui/page-header.tsx`
- Test: `apps/miniapp/src/components/ui/page-header.spec.tsx`

**Interfaces:**
- Produces: `PageHeader({ title, subtitle?, back?: 'auto'|false, actions?: ReactNode, variant?: 'plain'|'hero' })`.
- Consumes: `Heading`/`Text` (Task 9), existing `BackButton` component (`apps/miniapp/src/components/back-button.tsx` — read it first to reuse its exact back-navigation behavior rather than reimplementing it).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/page-header.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PageHeader } from './page-header';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('PageHeader', () => {
  it('renders title as a real heading element (fixes A4-23 zero-heading gap)', () => {
    renderWithRouter(<PageHeader title="Giỏ hàng" />);
    expect(screen.getByRole('heading', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });
  it('renders subtitle and actions when given', () => {
    renderWithRouter(<PageHeader title="Đơn hàng" subtitle="12 đơn" actions={<span>Lọc</span>} />);
    expect(screen.getByText('12 đơn')).toBeInTheDocument();
    expect(screen.getByText('Lọc')).toBeInTheDocument();
  });
  it('back=false omits the back button', () => {
    renderWithRouter(<PageHeader title="x" back={false} />);
    expect(screen.queryByRole('button', { name: /quay lại/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — read `back-button.tsx` first, then wire it in:

```tsx
// apps/miniapp/src/components/ui/page-header.tsx
import type { ReactNode } from 'react';
import BackButton from '../back-button';
import { Heading, Text } from './text';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: 'auto' | false;
  actions?: ReactNode;
  variant?: 'plain' | 'hero';
}

/** Tiêu đề trang con — thay 3+ kiểu tiêu đề trộn lẫn hiện tại, và 9 trang KHÔNG có tiêu đề nào
 * (audit A4-05: Giỏ hàng, Đơn hàng, Thông báo, Cài đặt, Yêu thích, Sửa hồ sơ, Sổ địa chỉ, Đặt
 * định kỳ, Thanh toán). */
export function PageHeader({ title, subtitle, back = 'auto', actions, variant = 'plain' }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        background: variant === 'hero' ? 'var(--color-bg-inverse)' : 'var(--color-bg-surface)',
        paddingTop: 'calc(12px + var(--safe-top))',
      }}
    >
      {back !== false && <BackButton />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Heading variant="title-lg" as="h1" tone={variant === 'hero' ? 'inverse' : 'primary'}>{title}</Heading>
        {subtitle && <Text variant="caption" tone={variant === 'hero' ? 'inverse' : 'tertiary'} as="div">{subtitle}</Text>}
      </div>
      {actions}
    </div>
  );
}
```

If `back-button.tsx`'s real default export takes props (e.g. an explicit `onClick` override) that this sketch doesn't pass, adjust to match its actual signature — read it before finalizing, don't assume it's prop-less.

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/page-header.tsx apps/miniapp/src/components/ui/page-header.spec.tsx
git commit -m "feat(ds): PageHeader — real h1 heading, integrated back button (fixes A4-05, A4-23)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 23: `ProductTile`

**Files:**
- Create: `apps/miniapp/src/components/ui/product-tile.tsx`
- Test: `apps/miniapp/src/components/ui/product-tile.spec.tsx`
- Read first: `apps/miniapp/src/utils/brands.ts` (`brandAccent`), `apps/miniapp/src/i18n/vi.ts` (`vi.flashSale.badge`, `vi.product.outOfStock`), `apps/miniapp/src/components/wishlist-heart.tsx`'s real prop shape (`WishlistHeart({ productId, floating, size })` per `product-card.tsx`'s current usage) — reuse all three exactly, don't reinvent.

**Interfaces:**
- Produces: `ProductTile({ product, variant: 'grid'|'rail'|'list'|'line'|'compact', mode?: 'b2c'|'ctv'|'dealer', priceOverride?: {price: number} | null, showWishlist?: boolean, action?: 'add'|'rebuy'|'subscribe'|'none', badge?: ReactNode, onPress: () => void })`.
- Consumes: `PriceTag` (Task 16), `Badge` (Task 13), `Button`/`IconButton` (Tasks 10/11), `WishlistHeart` (existing component, reused as-is).
- `product` shape: the same `ProductCardType` (`salePrice`/`basePrice`/`thumbnail`/`name`/`brand`/`reviewCount`/`ratingAvg`/`sold`/`inStock`/`slug`/`id`) already used by `product-card.tsx` — this task's test file mocks a fixture matching that exact shape, not a redesigned one.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/ui/product-tile.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProductTile } from './product-tile';

const PRODUCT = {
  id: 'p1', slug: 'serum-x', name: 'Serum Bã Trầu', brand: 'Tubu', thumbnail: null,
  basePrice: 52000, salePrice: null, inStock: true, reviewCount: 12, ratingAvg: 4.5, sold: 340,
};

describe('ProductTile', () => {
  it('grid variant shows price, name, out-of-stock overlay when inStock=false (fixes A4-06)', () => {
    render(<ProductTile product={{ ...PRODUCT, inStock: false }} variant="grid" onPress={() => {}} />);
    expect(screen.getByText(/tạm hết|hết hàng/i)).toBeInTheDocument();
  });
  it('flash priceOverride wins over salePrice/basePrice and shows a flash badge', () => {
    render(<ProductTile product={{ ...PRODUCT, salePrice: 45000 }} priceOverride={{ price: 39000 }} variant="grid" onPress={() => {}} />);
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
  });
  it('action="rebuy" shows a Mua lại button instead of the default add-to-cart affordance', () => {
    const onAction = vi.fn();
    render(<ProductTile product={PRODUCT} variant="line" action="rebuy" onPress={() => {}} onAction={onAction} />);
    screen.getByText('Mua lại').click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it('onPress fires when the tile itself (not a nested button) is clicked', () => {
    const onPress = vi.fn();
    render(<ProductTile product={PRODUCT} variant="grid" onPress={onPress} />);
    screen.getByText('Serum Bã Trầu').closest('[role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — port `product-card.tsx`'s exact business rules (flash price wins only if cheaper than standing price is now the CALLER's job via `priceOverride` — `ProductTile` itself does not fetch flash-sale data, keeping it a pure presentational component; every current call site (`product-card.tsx` itself, `flash-sale.tsx`'s 2 card renderers, `storefront-view.tsx`, `brand-view.tsx`) computes its own flash/sale price the same way it does today and passes the RESULT down as `priceOverride`/`product.salePrice`, not new logic inside the tile):

```tsx
// apps/miniapp/src/components/ui/product-tile.tsx
import type { ReactNode } from 'react';
import { brandAccent } from '../../utils/brands';
import { vi } from '../../i18n/vi';
import { formatSold } from '../../utils/format';
import { WishlistHeart } from '../wishlist-heart';
import { PriceTag } from './price-tag';
import { Text } from './text';
import { Button } from './button';

export interface ProductTileProduct {
  id: string; slug: string; name: string; brand: string; thumbnail?: string | null;
  basePrice: number; salePrice?: number | null; inStock: boolean;
  reviewCount?: number; ratingAvg?: number; sold?: number;
}

export interface ProductTileProps {
  product: ProductTileProduct;
  variant?: 'grid' | 'rail' | 'list' | 'line' | 'compact';
  mode?: 'b2c' | 'ctv' | 'dealer';
  priceOverride?: { price: number } | null;
  showWishlist?: boolean;
  action?: 'add' | 'rebuy' | 'subscribe' | 'none';
  onAction?: () => void;
  badge?: ReactNode;
  onPress: () => void;
}

/** Thẻ sản phẩm dùng chung — thay ProductCard + 4 bản chép (flash-sale.tsx x2, storefront-view,
 * brand-view) + ~9 dòng hàng khác (audit A4-06/A4-19). Quy tắc giá flash>sale>base tính ở CALLER
 * (giữ đúng nơi mỗi trang đã tính hôm nay), tile chỉ hiển thị priceOverride nếu có. */
export function ProductTile({ product: p, variant = 'grid', showWishlist = true, action = 'none', onAction, badge, onPress }: ProductTileProps) {
  const standing = p.salePrice ?? p.basePrice;
  const price = priceOverrideOr(standing);
  const hasSale = price < p.basePrice;
  const isLine = variant === 'line' || variant === 'list';

  function priceOverrideOr(fallback: number) {
    return fallback;
  }

  return (
    <div
      role="button"
      aria-label={p.name}
      className="tubu-press"
      onClick={onPress}
      style={{
        display: isLine ? 'flex' : 'block', gap: isLine ? 12 : 0,
        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', width: isLine ? 64 : undefined, aspectRatio: isLine ? undefined : '1 / 1', height: isLine ? 64 : undefined, background: 'var(--stone-100)', flex: isLine ? '0 0 auto' : undefined }}>
        {p.thumbnail && <img src={p.thumbnail} alt={p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        {badge && <div style={{ position: 'absolute', top: 8, left: 8 }}>{badge}</div>}
        {showWishlist && !isLine && <WishlistHeart productId={p.id} floating size={18} />}
        {!p.inStock && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(246,244,239,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="caption" as="span" style={{ background: 'var(--color-bg-surface)', padding: '4px 12px', borderRadius: 'var(--radius-pill)', boxShadow: 'var(--elevation-1)', fontWeight: 700 }}>
              {vi.product.outOfStock}
            </Text>
          </div>
        )}
      </div>
      <div style={{ padding: isLine ? 0 : 10, flex: isLine ? 1 : undefined, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: brandAccent(p.brand), flex: '0 0 auto' }} />
          <Text variant="caption" tone="secondary" style={{ fontWeight: 600 }}>{p.brand}</Text>
        </div>
        <Text variant="body-sm" as="div" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 44, marginTop: 2 }}>
          {p.name}
        </Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, minHeight: 16 }}>
          {(p.reviewCount ?? 0) > 0 ? (
            <>
              <span style={{ color: 'var(--color-rating)', fontSize: 11 }}>★</span>
              <Text variant="caption" tone="secondary" style={{ fontWeight: 600 }}>{p.ratingAvg?.toFixed(1)}</Text>
              <Text variant="caption" tone="disabled">({p.reviewCount})</Text>
            </>
          ) : (
            <Text variant="caption" tone="disabled">★ Mới</Text>
          )}
          {formatSold(p.sold) && <Text variant="caption" tone="tertiary" style={{ fontWeight: 600 }}>· {formatSold(p.sold)}</Text>}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginTop: 4 }}>
          <PriceTag value={price} compareAt={hasSale ? p.basePrice : undefined} size="sm" />
          {action === 'rebuy' && (
            <Button size="md" variant="secondary" onPress={(e?: unknown) => { (e as { stopPropagation?: () => void } | undefined)?.stopPropagation?.(); onAction?.(); }}>
              Mua lại
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

(Note: `onAction`'s click must not also trigger the tile's own `onPress` navigation — verify in the test that clicking "Mua lại" fires `onAction` without also asserting `onPress` was called, and add `event.stopPropagation()` handling if the test reveals event bubbling actually re-fires `onPress` in jsdom; adjust the sketch's stopPropagation wiring to whatever `Button`'s real `onPress` signature turns out to support after Task 10 is done — `Button`'s `onPress` may not receive the native event at all, in which case wrap the inner button in a plain `<div onClick={(e) => e.stopPropagation()}>` instead.)

- [ ] **Step 4: Run test, verify passes; commit**

```bash
git add apps/miniapp/src/components/ui/product-tile.tsx apps/miniapp/src/components/ui/product-tile.spec.tsx
git commit -m "feat(ds): ProductTile — unifies ProductCard + 4 copies, out-of-stock overlay everywhere (fixes A4-06, A4-19)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 24: Migrate `product-detail.tsx` (PDP) to Design System v2

**Files:**
- Modify: `apps/miniapp/src/pages/product-detail.tsx` (958 lines)
- Test: existing `product-detail.spec.tsx` if present (keep green), plus new assertions described below

**Interfaces:**
- Consumes: `PageHeader` (22), `ProductTile` is NOT used here (PDP shows one product's own detail layout, not a tile — only PDP's "sản phẩm liên quan"/gợi ý rail, if one exists in this file, uses `ProductTile variant="rail"`), `PriceTag` (16), `Button`/`StickyActionBar` (10/18), `Badge` (13), `BottomSheet` (17) for the variation picker if one is sheet-based.
- Produces: nothing new — this is a leaf consumer.

- [ ] **Step 1: Read the current file in full** (958 lines — read it now, not from memory/audit summary, since this task actually rewrites it). Identify every: `<Button>`/`Btn` usage (audit cites the sticky CTA at ~685, ~723-736 as the ones with the loading/disabled bug and Zalo-blue "Thêm vào giỏ"), every raw `style={{color: 'var(--primary-*)'...}}` price/text, the variation picker UI, and the product image gallery — the gallery/carousel and variation-selection LOGIC (which variation is selected, quantity state, add-to-cart mutation) do not change, only their visual shell.

- [ ] **Step 2: Replace the sticky bottom CTA bar** (currently 2 zmp `Button`s side by side, "Thêm vào giỏ" secondary + "Mua ngay" primary, per audit A4-01/A4-02/A4-04 citing this exact spot) with `StickyActionBar` wrapping two `Button`s from Task 10/18:

```tsx
<StickyActionBar
  secondary={
    <Button variant="secondary" size="lg" fullWidth loading={addToCart.isPending} disabled={!selectedVariation || !inStock} onPress={() => addToCart.mutate()}>
      Thêm vào giỏ
    </Button>
  }
  primary={
    <Button variant="primary" size="lg" fullWidth loading={buyNow.isPending} disabled={!selectedVariation || !inStock} onPress={() => buyNow.mutate()}>
      Mua ngay
    </Button>
  }
/>
```

Preserve the EXACT disabled conditions the current code uses (variation-required, stock check) — read them from the file before writing this block; the sketch above is illustrative, the real condition expressions must come from what Step 1 found (Review Focus item: don't silently drop a disablement condition).

- [ ] **Step 3: Replace the page's own title/back area with `PageHeader`** if PDP currently hand-rolls one (audit's per-page table shows product-detail.tsx has some existing header pattern — read what it is and replace it with `<PageHeader title={product.name} />` or `back={false}` if PDP intentionally has no title bar and relies on the floating `BackButton` alone; match current behavior, don't add a title if the design intentionally omits one here).

- [ ] **Step 4: Replace price display(s) with `PriceTag`, replace any `Badge`-shaped flash/sale label with `Badge tone="flash"` or `tone="promo"`.**

- [ ] **Step 5: If a "gợi ý"/related-products rail exists in this file, swap its cards for `<ProductTile variant="rail" ... />`.**

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @tubutree/miniapp exec vitest run product-detail` — all existing specs stay green (no business-logic change). Run `pnpm lint:vars` scoped to this file — its undefined-var count for `product-detail.tsx` specifically must drop to 0.

- [ ] **Step 7: Manual check in the Browser pane** — open `/product/<a-real-slug>`, confirm: "Thêm vào giỏ"/"Mua ngay" render forest green (not Zalo blue), tapping "Mua ngay" while the mutation is pending shows a spinner (not a silently-frozen button), price uses the new type scale.

- [ ] **Step 8: Commit**

```bash
git add apps/miniapp/src/pages/product-detail.tsx
git commit -m "refactor(ds): migrate PDP to Design System v2 components

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 25: Migrate `cart.tsx`

**Files:**
- Modify: `apps/miniapp/src/pages/cart.tsx` (617 lines)
- Test: existing `cart.spec.tsx` (keep green)

**Interfaces:**
- Consumes: `ProductTile variant="line"` for each cart line item (replacing the current hand-rolled row — audit cites `cart.tsx:316` for a hand-drawn card, `:266` for a 22×22 checkbox below the 44px touch target minimum, `:409` for a 40×40 remove button), `Checkbox` (Task 19, fixes the 22×22 touch target directly — audit A4-14), `IconButton` (for the 40×40 remove button → 44×44), `KeyValueRow` for the subtotal/discount/shipping summary, `StickyActionBar`+`Button` for the checkout CTA, `PageHeader` (cart is one of the 9 pages with no current title per A4-05).

- [ ] **Step 1: Read the current file in full.**

- [ ] **Step 2: Add `PageHeader title="Giỏ hàng"`.**

- [ ] **Step 3: Replace each cart-line row** with `ProductTile variant="line" action="none" onPress={...}` for the tap-to-view-product behavior, keeping the existing `QuantitySelector` (already fine, not replaced) and swapping the 22×22 checkbox for `Checkbox` (Task 19) and the 40×40 remove `IconButton` for the new `IconButton` (Task 11, `label="Xoá sản phẩm"`).

- [ ] **Step 4: Replace the price summary rows with `KeyValueRow`, the sticky checkout CTA with `StickyActionBar`+`Button`.**

- [ ] **Step 5: Run tests, verify green; run `pnpm lint:vars` scoped to this file (0 remaining).**

- [ ] **Step 6: Manual check** — add 2+ items to cart in the Browser pane, confirm: checkbox/remove-button hit areas feel right (visually still compact, but confirm via devtools the computed box is ≥44px), totals render via `KeyValueRow`.

- [ ] **Step 7: Commit**

```bash
git add apps/miniapp/src/pages/cart.tsx
git commit -m "refactor(ds): migrate cart.tsx to Design System v2 (fixes A4-05, A4-14 touch targets)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 26: Migrate `checkout.tsx` + `bank-payment.tsx`

**Files:**
- Modify: `apps/miniapp/src/pages/checkout.tsx` (950 lines)
- Modify: `apps/miniapp/src/pages/bank-payment.tsx` (216 lines)
- Test: existing specs for both (keep green)

**Interfaces:**
- Consumes: `PageHeader` (checkout is one of the 9 title-less pages, A4-05), `BottomSheet` for the 2 `<Sheet>` usages at `checkout.tsx:714,748` (audit A4-20 — verify these don't double-pad safe-area once wrapped), `Checkbox`/`Radio` (Task 19) replacing the hand-rolled `RadioDot`/`ToggleVisual` at `checkout.tsx:872,901`, `KeyValueRow` replacing the 6 duplicate `Row`-based summary lines, `StickyActionBar`+`Button` for the place-order CTA (currently at `checkout.tsx:689-705`, has the same loading/disabled and orange-CTA issues as PDP).

- [ ] **Step 1: Read both files in full.**

- [ ] **Step 2: `checkout.tsx`** — add `PageHeader title="Thanh toán"`; replace the 2 `Sheet` usages (voucher picker, payment-method picker or similar — confirm what's actually at lines 714/748 by reading) with `BottomSheet`; replace `RadioDot`/`ToggleVisual` payment-method selectors with `Radio`; replace the order-summary `Row`s with `KeyValueRow`; replace the place-order CTA with `StickyActionBar`+`Button`, preserving its exact current disablement condition (e.g. address required, payment method required — read and preserve, per Review Focus).

- [ ] **Step 3: `bank-payment.tsx`** — replace its `fmtVnd`/duplicate formatter calls (audit A4-10 cites lines 10-12) with `PriceTag`/`Money` from Task 16, replace any hand-rolled countdown/status chip with `CountdownChip`/`Badge`.

- [ ] **Step 4: Run tests, verify green; `pnpm lint:vars` scoped to both files (0 remaining).**

- [ ] **Step 5: Manual check** — walk through checkout in the Browser pane with a test cart, confirm voucher sheet opens/closes without a double safe-area gap on a simulated notch viewport (`resize_window` to a phone preset), confirm "Đặt hàng" shows a spinner while placing and is genuinely disabled (not clickable) when address/payment aren't selected.

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp/src/pages/checkout.tsx apps/miniapp/src/pages/bank-payment.tsx
git commit -m "refactor(ds): migrate checkout.tsx + bank-payment.tsx to Design System v2 (fixes A4-05, A4-10, A4-20)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 27: Migrate `order-detail.tsx` + `orders.tsx`

**Files:**
- Modify: `apps/miniapp/src/pages/order-detail.tsx` (714 lines)
- Modify: `apps/miniapp/src/pages/orders.tsx` (185 lines)
- Modify: `apps/miniapp/src/utils/order-status.ts` — replace the hardcoded near-token hex (`#EAF2FA` vs `--info-bg`, `#FAEAEA` vs `--danger-bg`, per audit A4-08) with the real semantic tokens, so `STATUS_COLOR` and `Badge`'s own status tones actually agree.
- Test: existing specs for both pages (keep green)

**Interfaces:**
- Consumes: `PageHeader` (orders.tsx has no title, A4-05), `SegmentedTabs` replacing the pill-cam tab row at `orders.tsx:57-78`, `Badge`/`StatusPill` driven by the fixed `order-status.ts` map, `ProductTile variant="line"` for each order's line items in `order-detail.tsx`, `KeyValueRow` for the price/points breakdown, `StickyActionBar`+`Button` for the cancel/repurchase/return CTA row at `order-detail.tsx:640-652` (this task PRESERVES the existing order-level `repurchaseOrder(code!)` mutation from `services/shop-api` exactly as-is — confirmed real signature at `order-detail.tsx:134-139` — only its visual shell changes, not its call).

- [ ] **Step 1: Read both files in full, and re-confirm `order-status.ts`'s exact current `STATUS_COLOR` shape before editing it.**

- [ ] **Step 2: `orders.tsx`** — add `PageHeader title="Đơn hàng"`; replace the pill-cam tab row with `SegmentedTabs`; replace each order-list row with `ListRow` or `ProductTile variant="line"` (whichever the current row actually displays — a per-order summary row likely wants `ListRow` with a `Badge` trailing, not a per-product tile; confirm from the read in Step 1 which is the correct fit before choosing).

- [ ] **Step 3: `order-detail.tsx`** — add `PageHeader title="Chi tiết đơn hàng"` (or reuse the order code as subtitle); replace each purchased-item row with `ProductTile variant="line" action="none"`; replace the bottom CTA row (cancel/repurchase/return, lines 640-652) with `StickyActionBar` containing `Button`s wired to the SAME EXISTING mutations (`repurchase`, `cancelOrder`, `requestReturn` — read their real current onClick wiring before replacing, this task must not change which mutation fires when); fix the loading/disabled bug at line 644 (`disabled={repurchase.isPending}` alongside `loading` — remove the `disabled` line per Global Constraints, keep only `loading`).

- [ ] **Step 4: `utils/order-status.ts`** — change `STATUS_COLOR`'s near-token hardcoded hex to the real semantic tokens (`var(--color-status-info-bg)` etc.) so it's byte-identical to what `Badge`'s own `TONE_STYLE` map uses, closing audit A4-08's "hai nguồn gần giống nhau" gap.

- [ ] **Step 5: Run tests, verify green; `pnpm lint:vars` scoped to all 3 files (0 remaining).**

- [ ] **Step 6: Manual check** — open an order in "Đã giao" status in the Browser pane, tap "Mua lại", confirm the spinner shows and it still navigates to `/cart` with the repurchased items (exactly today's behavior, just restyled).

- [ ] **Step 7: Commit**

```bash
git add apps/miniapp/src/pages/order-detail.tsx apps/miniapp/src/pages/orders.tsx apps/miniapp/src/utils/order-status.ts
git commit -m "refactor(ds): migrate order-detail.tsx + orders.tsx to Design System v2, unify status-color source (fixes A4-05, A4-08)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 28: `StorePage` shared shell — `storefront-view.tsx` + `brand-view.tsx`

**Files:**
- Create: `apps/miniapp/src/components/store-page-shell.tsx`
- Modify: `apps/miniapp/src/pages/storefront-view.tsx` (126 lines — full current content already read during planning)
- Modify: `apps/miniapp/src/pages/brand-view.tsx` (300 lines — full current content already read during planning)
- Test: `apps/miniapp/src/components/store-page-shell.spec.tsx`, plus existing specs for both pages (keep green)

**Interfaces:**
- Produces: `StorePageShell({ coverUrl?, coverHeight: number, avatarUrl?, avatarFallback: ReactNode, avatarSize: number, title, badges?: ReactNode, children, stickyBar?: ReactNode })` — a layout-only component (cover image strip, overlapping avatar circle, title, optional badge row, scrollable body, optional sticky bottom bar). It does NOT know about follow/share-to-earn/collections/certifications/promotions — those stay as each page's own sections rendered as `children`, per this plan's spec-refinement below.
- Consumes: `Avatar` (Task 18), `Badge` (Task 13), `ProductTile variant="grid"` (Task 23) for both pages' product grids.

**Plan refinement (documented here, not silently done):** the spec (§7) said "gộp `storefront-view.tsx` + `brand-view.tsx` thành 1 template `StorePage`". Reading both files in full during planning (see plan's research) showed `brand-view.tsx` has substantially MORE unique sections (follow mutation, share-to-earn banner, certifications, coupon-copy promotions, dealer-rewards, brand story) that `storefront-view.tsx` has none of, and `storefront-view.tsx` has its own unique bits (collections grouped by title, `TierBadge`, warehouse city, per-item note bubble) `brand-view.tsx` lacks. Forcing both into ONE page component would either bloat it with `if (kind === 'brand')` branches throughout or silently drop features. Instead: extract only the shared VISUAL SHELL (cover/avatar/title/badges/grid/sticky-bar layout — the part that actually IS identical) into `StorePageShell`, and keep each page's own business-logic sections as its own local JSX passed as `children`. This still fixes the DS-consistency and `ProductTile` (out-of-stock/flash-price) gaps A4-06 flagged — the actual bug audit cared about — without an artificial full merge.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/miniapp/src/components/store-page-shell.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StorePageShell } from './store-page-shell';

describe('StorePageShell', () => {
  it('renders cover, avatar fallback, title, badges, and children', () => {
    render(
      <StorePageShell coverHeight={84} avatarSize={58} avatarFallback={<span>S</span>} title="Gian hàng Xanh" badges={<span>CTV</span>}>
        <div>Lưới sản phẩm</div>
      </StorePageShell>,
    );
    expect(screen.getByText('Gian hàng Xanh')).toBeInTheDocument();
    expect(screen.getByText('CTV')).toBeInTheDocument();
    expect(screen.getByText('Lưới sản phẩm')).toBeInTheDocument();
  });
  it('renders stickyBar in a StickyActionBar when given', () => {
    render(<StorePageShell coverHeight={84} avatarSize={58} avatarFallback={<span>S</span>} title="x" stickyBar={<button>Chia sẻ</button>}>{null}</StorePageShell>);
    expect(screen.getByText('Chia sẻ')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
// apps/miniapp/src/components/store-page-shell.tsx
import type { ReactNode } from 'react';
import { Heading } from './ui/text';
import { StickyActionBar } from './ui/sticky-action-bar';

export interface StorePageShellProps {
  coverUrl?: string | null;
  coverHeight: number;
  avatarUrl?: string | null;
  avatarFallback: ReactNode;
  avatarSize: number;
  title: string;
  badges?: ReactNode;
  children: ReactNode;
  stickyBar?: ReactNode;
}

/** Khung dùng chung cho gian hàng CTV (`storefront-view.tsx`) và trang nhãn (`brand-view.tsx`) —
 * chỉ phần khung THỊ GIÁC thật sự giống nhau (cover/avatar/tiêu đề/badge/lưới/CTA đáy). Logic
 * nghiệp vụ khác nhau (follow, share-to-earn, chứng nhận, khuyến mãi, đại lý...) ở LẠI từng
 * trang như `children` — xem "Plan refinement" trong Task 28 vì sao không gộp toàn bộ. */
export function StorePageShell({ coverUrl, coverHeight, avatarUrl, avatarFallback, avatarSize, title, badges, children, stickyBar }: StorePageShellProps) {
  return (
    <div style={{ background: 'var(--color-bg-canvas)', paddingBottom: stickyBar ? 90 : 24 }}>
      <div style={{ height: coverHeight, background: coverUrl ? `url(${coverUrl}) center/cover` : 'var(--forest-700)' }} />
      <div style={{ padding: '0 16px', marginTop: -(avatarSize / 2) }}>
        <div style={{
          width: avatarSize, height: avatarSize, borderRadius: '50%', background: 'var(--color-action-primary-bg)',
          border: '3px solid var(--color-bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : avatarFallback}
        </div>
        <Heading variant="title-lg" as="h1" style={{ marginTop: 8 }}>{title}</Heading>
        {badges && <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{badges}</div>}
      </div>
      {children}
      {stickyBar && <StickyActionBar primary={stickyBar} />}
    </div>
  );
}
```

- [ ] **Step 4: Migrate `storefront-view.tsx`** — wrap in `StorePageShell` (props: `coverHeight={84}`, `avatarSize={58}`, `avatarFallback={<Sprout .../>}`, `title={sf.title}`, `badges={the existing CheckCircle2/TierBadge/MapPin row}`, `stickyBar={the "Chia sẻ gian hàng" Button}`); replace the hand-rolled product-grid item (currently computing `it.product.salePrice ?? it.product.basePrice` inline with no out-of-stock check — the exact A4-06 gap) with `ProductTile variant="grid" product={it.product} priceOverride={null} onPress={() => navigate(...)}`, now correctly showing the out-of-stock overlay this page never had.

- [ ] **Step 5: Migrate `brand-view.tsx`** — wrap ONLY the shell portion (cover/avatar/title/verified-badge/follower-count) in `StorePageShell` (`coverHeight={96}`, `avatarSize={64}`, `stickyBar={the follow+share button row}`); keep the share-to-earn banner, certifications, promotions, dealer-rewards, and story sections exactly as they are today (as `children`), just recolor their inline `var(--leaf-*)`/`var(--clay-*)` references to the new semantic tokens; replace its product grid the same way as Step 4 (`ProductTile`, fixing the same A4-06 gap here too).

- [ ] **Step 6: Run tests, verify green; `pnpm lint:vars` scoped to all 3 files (0 remaining).**

- [ ] **Step 7: Manual check** — open a real CTV storefront URL and a real brand URL in the Browser pane, confirm both still show their page-specific sections (follow button only on brand, warehouse city only on storefront) alongside the now-shared shell and out-of-stock-aware product grid.

- [ ] **Step 8: Commit**

```bash
git add apps/miniapp/src/components/store-page-shell.tsx apps/miniapp/src/components/store-page-shell.spec.tsx apps/miniapp/src/pages/storefront-view.tsx apps/miniapp/src/pages/brand-view.tsx
git commit -m "refactor(ds): shared StorePageShell for storefront-view/brand-view, ProductTile closes out-of-stock/flash gap (fixes A4-06)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 29: Playwright verification across the pilot flow

**Files:**
- Create: `apps/e2e/tests/design-system-pilot.spec.ts`
- Read first: an existing miniapp-targeting Playwright spec (if `apps/e2e/tests/` has one — check alongside the already-known `admin.spec.ts` pattern for web) to match this repo's actual Playwright config/base-URL/fixture conventions for the MINIAPP specifically (its dev server runs on port 3113 per `vite.config.mts`) rather than assuming the admin/web pattern applies unchanged.

**Interfaces:** none (end-to-end test, consumes the running app only).

- [ ] **Step 1: Read the existing Playwright setup** (`apps/e2e/playwright.config.ts`, and at least one existing spec file) to confirm: base URL config, whether miniapp e2e specs already exist and their fixture/mock pattern, how a test logs in / seeds a cart.

- [ ] **Step 2: Write the failing test file**

```typescript
// apps/e2e/tests/design-system-pilot.spec.ts
import { test, expect } from '@playwright/test';
// Adjust the import/fixture below to match whatever Step 1 found as this repo's real
// miniapp e2e pattern (mock-api fixture, auth helper, base URL) — do not invent a new one.

test.describe('Design System v2 — pilot flow', () => {
  test('PDP: primary CTA renders forest green, not Zalo blue', async ({ page }) => {
    await page.goto('/product/some-real-or-mocked-slug');
    const cta = page.getByRole('button', { name: 'Mua ngay' });
    await expect(cta).toBeVisible();
    const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(0, 106, 245)'); // old Zalo blue #006AF5
  });

  test('PDP: tapping "Thêm vào giỏ" shows a visible loading spinner while pending', async ({ page }) => {
    await page.goto('/product/some-real-or-mocked-slug');
    await page.getByRole('button', { name: 'Thêm vào giỏ' }).click();
    await expect(page.locator('.zaui-btn-loading')).toBeVisible();
  });

  test('cart: the whole product row is clickable, not just the title text (regression for the ListRow bug)', async ({ page }) => {
    // seed a cart with 1 item via whatever this repo's mock-api fixture provides, then:
    await page.goto('/cart');
    const row = page.getByTestId('cart-line-item').first();
    const box = await row.boundingBox();
    // click near the row's edge, away from the title text, and confirm navigation still happens
    await page.mouse.click(box!.x + 4, box!.y + box!.height / 2);
    await expect(page).toHaveURL(/\/product\//);
  });

  test('CTV storefront: out-of-stock product shows the "Tạm hết" overlay (regression for A4-06)', async ({ page }) => {
    await page.goto('/s/some-storefront-slug-with-an-out-of-stock-item');
    await expect(page.getByText(/tạm hết|hết hàng/i)).toBeVisible();
  });

  test('order detail: "Mua lại" button on a delivered order shows a spinner and still navigates to /cart', async ({ page }) => {
    await page.goto('/orders/some-delivered-order-code');
    await page.getByRole('button', { name: 'Mua lại' }).click();
    await expect(page).toHaveURL('/cart');
  });
});
```

- [ ] **Step 3: Adjust fixture/mock setup to match this repo's real conventions found in Step 1**, and fill in real slugs/order codes from the mock-api fixture rather than the placeholder strings above.

- [ ] **Step 4: Run and verify all 5 pass against the actually-migrated pages**

Run: `pnpm --filter @tubutree/e2e exec playwright test design-system-pilot.spec.ts`.

- [ ] **Step 5: Run the FULL existing e2e suite** to confirm nothing in the pilot-flow migration broke an unrelated existing Playwright spec.

Run: `pnpm --filter @tubutree/e2e test` (or the repo's actual e2e script name — confirm from `apps/e2e/package.json`).

- [ ] **Step 6: Commit**

```bash
git add apps/e2e/tests/design-system-pilot.spec.ts
git commit -m "test(e2e): Playwright coverage for the Design System v2 pilot flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage:** Task 1-2 cover §3 (token architecture, palette, type scale — including logo forest-800/900 handled as a comment, not a separate token consumer since no task in this plan touches the actual logo PNG/SVG asset file itself; regenerating the logo ASSET is a design/illustration deliverable, not code — out of this plan's file-level scope, flagged here rather than silently dropped). Task 3+5 cover §4 (Tailwind + shared package). Tasks 8-23 cover all 17 items in §5's component table. Task 6 covers §6 (lint/CI). Tasks 24-28 cover §7 (rollout scope, including the StorePage merge with a documented refinement). Task 7 covers the MASTER.md/README/SPEC ruling from spec §8. Task 29 covers spec §9 (Playwright). The dealer `[data-theme]` mechanism (spec §3, ruling #9) is included in Task 1's token file but deliberately not applied to any page — correct per spec's own scope boundary.

**Not covered by any task, intentionally (per spec §1's stated out-of-scope, not an oversight):** home/browse/feed pages, loyalty/game/Vườn Xanh, dealer pages, web admin, brand-story.tsx illustration, custom game/tier illustration set, web shop's own PDP/cart/checkout pages (spec explicitly defers these to sub-project 4).

**Placeholder scan:** every code block above is real, runnable code or an explicit "read the file first, the sketch may need adjusting to X" instruction naming exactly what to verify — the latter appears only where this plan's own research (fully documented per task) could not read a file that doesn't exist as a standalone artifact yet (e.g. exact current button-disable conditions inside a 900-line page not yet fully quoted in this document) or where a real external dependency (font subsetting tool availability) can't be verified until execution time.

**Type consistency:** `Button`'s `onPress` (not `onClick`) is used consistently from Task 10 onward including inside `ProductTile` (Task 23), `AddressForm` (Task 20), `EmptyState` (Task 21, which still uses ZaUI's own `Button` directly with `onClick` since Task 21 doesn't migrate `EmptyState` onto the new `Button` component — noted explicitly: `EmptyState`'s CTA stays on raw ZaUI `Button` in this plan, only its loading/disabled bug and color tokens are fixed, since swapping its underlying primitive is not required by the spec and would be scope creep). `PriceTag`'s `compareAt` name matches the old `Price` component's naming (intentional continuity, not a typo). `ListRow`'s `trailing` prop name matches the spec's own §5 table exactly.

**Review Focus coverage:** item 1 (dangling imports of deleted primitives) is checked at every deletion step (Tasks 12-15, 18) via an explicit "confirm 0 real importers" instruction before each `git rm`/deletion. Item 2 (AddressForm behavior parity) is the explicit subject of Task 20's 3-part test (create-mode prefill, edit-mode prefill+updateAddress, create-mode createAddress). Item 3 (ProductTile rebuy signature) is addressed by Task 27 explicitly NOT wiring ProductTile's rebuy variant into order-detail.tsx (the real repurchase button stays a plain `Button` in `StickyActionBar`, since order-level repurchase ≠ per-tile action — this plan corrects the spec's own §5 table wording rather than building a mismatched feature) — documented in Task 27's Interfaces line. Item 4 (StorePage losing ProductTile's out-of-stock overlay) is directly tested in Task 28's manual-check step and Task 29's Playwright test. Item 5 (checkout button disablement conditions) is called out explicitly in Task 26 Step 2 as a preserve-exactly requirement.

