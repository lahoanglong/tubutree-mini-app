# Buy-flow 4b — Discovery & search (Home + Browse) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make finding a product fast and forgiving: Home leads returning customers with "Mua lại" and new customers with Flash sale + Bán chạy + Danh mục (first product grid within the first 5 blocks), and Browse gets unaccented search with suggest-as-you-type, a filter sheet (price, in stock, brand, rating ≥4), a real "Bán chạy" sort, URL-synced state that survives going to a product and back, and "Đã xem gần đây" — all in Design System v2.

**Architecture:** The API gains four optional query params on `GET /products` (`minPrice`, `maxPrice`, `inStock`, `minRating`), a real `best_seller` ordering (rank in the service, page by ids), Vietnamese-insensitive search done with the built-in Postgres `translate()` (no extension, no migration, per-request fallback to the old `contains`), and an additive `productCount` on `GET /categories`. The miniapp gets a typed catalog client that degrades quietly against the old API, pure URL-state helpers + `useSearchState` (react-router `useSearchParams`, `replace: true`), `useRecentlyViewed`/`useCategories`/`useSuggest`/`useScrollRestoration` hooks, a set of catalog components (`CatalogTile`, `CategoryGrid`, `SortChips`, `ResultHeader`, `FilterSheet`, `SuggestList`, `RecentlyViewedRail`) and Home blocks (`homeBlockOrder`, `OrderStrip`, `HomeSection`, `HomeHeader`, `HomeExtras`), then rewrites `pages/browse.tsx` and `pages/home.tsx` on top of them. Deploy order is API first, miniapp second.

**Tech Stack:** NestJS 10 + Prisma 5.22 (Postgres) + class-validator/class-transformer, Jest (unit + `test/integration-race` on real Postgres); React 18 + zmp-ui 1.11 + react-router-dom 6.28 + TanStack Query 5 + lucide-react, Vitest + Testing Library; Playwright (`apps/e2e`, mocked API).

**Spec:** `docs/superpowers/specs/2026-09-30-buy-flow-redesign-design.md` — this plan covers **§5 (phase 4b) only**, plus the 4b-relevant parts of §2 (unaccent decision), §3.4 (events `search_result_clicked`, `filter_applied`), §9, §10, §11. Audit refs: `docs/audit-2026-09/02-purchase-funnel.md` (A2-32 block order, A2-33 hero copy / refresh, A2-34 "Xu hướng" + emoji). Carry-over debts: `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md` (only items touching Home/Browse/product tiles/chips). Precedent: `docs/superpowers/plans/2026-09-30-buy-flow-4a-reorder-rhythm.md`.

## Plan Notes / Rulings

Places where the spec is ambiguous, or where the code contradicts it. Each ruling picks the most conservative option.

1. **Unaccented search: no `unaccent` extension, no migration.** Verified facts: prod Postgres version and role privileges are unknown (shared VPS with ChoDeli), and `prisma migrate deploy` applies migrations in one run — a failing `CREATE EXTENSION` marks the migration failed (P3009) and blocks *every later deploy* until someone runs `migrate resolve` by hand. Postgres has a built-in `translate(text, from, to)` that needs no privilege and is identical on dev, CI and prod. So the spec's own fallback (§2: "chuẩn hoá chuỗi … bằng hàm thuần trên cột `name` đã có") becomes the only path: a single map of Vietnamese letters (lower **and** upper case, so `lower()` under a `C` collation cannot break it) plus the 8 Vietnamese combining marks (so NFD-encoded names fold too) lives in `apps/api/src/modules/catalog/search-text.ts`; the SQL applies `lower(translate(name, FROM, TO))` and the query is folded by the same map in TypeScript (`foldVietnamese`). The real-Postgres test asserts the database fold equals the TypeScript fold for uppercase, NFD and extra-space samples. If the raw SQL ever throws, the request falls back to today's `name contains (insensitive) OR tags has` (logged at `warn`, not latched). No manual DB step is needed. `unaccent` would add nothing for Vietnamese.
2. **`best_seller` = `soldApp + soldExternal desc, id asc`, ranked in the service.** Prisma cannot order by an expression. A generated column was rejected (Prisma 5 does not model generated columns → drift migrations; this repo already lost three GIN indexes to a drift migration, see `schema.prisma` comment). The service selects `{ id, soldApp, soldExternal }` for every matching product (3 small columns), sorts in memory, slices the page and fetches full cards for those ids, preserving order; `total` = number of matches (one query fewer). Fine for the current catalog (hundreds of products); a stored, indexed `soldTotal` column is a follow-up if the catalog passes ~5k products. All other sorts get `{ id: 'asc' }` as a secondary key — today's default `isFeatured desc` alone makes infinite-scroll pages overlap/skip on ties.
3. **Filter semantics.** Price filters on the **displayed price** `salePrice ?? basePrice` (exactly `ProductTile`'s `standing` price), written as `OR: [{ salePrice: range }, { salePrice: null, basePrice: range }]` inside `AND` (the `q` filter also needs `OR`, so everything composable goes into `AND`). `minPrice > maxPrice` is swapped, not rejected. `inStock` = at least one **active** variation with `stock > 0` (same rule as the card's `inStock`). Rating ≥4 uses `ratingAvg >= minRating`; products with no reviews (`ratingAvg = 0`) are excluded by design. The rating filter needs a fourth param `minRating` (spec §5b.3 lists only three; §5b.2 asks for the filter). Price sorts still order by `basePrice` (unchanged; noted as a follow-up).
4. **Real categories vs the 4 segments.** Verified: Pancake sync never writes `Product.categoryIds` (only seed/merchant products have them), while `forSegment` is inferred from the name for every synced product. Showing seeded categories that hold no live products would lead to empty pages. Therefore `GET /categories` gains an additive `productCount` (active + APPROVED products), and the miniapp shows real categories with `productCount > 0`; if none (or the API is old and sends no `productCount`, or the call fails) it shows the 4 segments. A real category navigates to `?category=<id>` (new URL param, maps to the existing `category` query param); a segment to `?segment=<key>` (unchanged). `?segment=` and `?brand=` deep links from Home keep working and render as removable chips.
5. **`GET /search/suggest` keeps its response shape** (array of `{ slug, name, thumbnail, basePrice }`) because `affiliate/ctv-order-sheet.tsx` and `community/product-picker.tsx` consume it; it only switches to the folded match. Category suggestions and recent keywords are computed on the client (categories list is already cached; recent keywords are local). Suggest fires at ≥2 characters, debounced 250 ms.
6. **Old API (deploy order mistakes).** Verified: the global `ValidationPipe` has `forbidNonWhitelisted: true`, so an API older than 4b answers **400** to `minPrice/maxPrice/inStock/minRating`. The miniapp only sends params that are set; on a 400 *while extended params are present* it retries once without them and marks the page `filtersIgnored`, which shows an inline notice instead of an error. `sort=best_seller` is already in the old DTO allow-list, so the old API silently returns the featured order (accepted). Categories without `productCount` → segments. Suggest is unchanged.
7. **URL state.** Params: `q`, `sort` (`best_seller|newest|price_asc|price_desc`; absent = Gợi ý), `category`, `segment`, `brand` (comma list, as today), `minPrice`, `maxPrice`, `inStock=1`, `rating=4`. Serialization is canonical (fixed order, defaults omitted) so the same state is always the same URL. Every write is `setSearchParams(..., { replace: true })` — filters never stack history entries. `focus=search` (Home's search shell) is one-shot: Browse focuses the input then removes `focus` with `replace`, so coming back from a product does not reopen the keyboard. Typing no longer fires a product query per pause: typing shows `SuggestList`; **Enter / a suggestion / a recent keyword commits `q`** to the URL. Scroll position is saved to `sessionStorage` under `tubu_scroll:<canonical query>` (debounced on scroll + on unmount) and restored once per key when the list has data. zmp-ui's `restoreScrollOnBack` is not used: it keys on `location.key`, which changes on every `replace`.
8. **Home block order.** The header (logo, bell, cart) is page chrome and not counted as a block. Returning customer (≥1 purchased item from `GET /me/purchased-items`): search → Mua lại → order strip → Flash sale (+ upcoming) → Dành cho bạn → Bán chạy → Danh mục → Đã xem gần đây → Tubu chọn cho bạn → Mới về → extras. New customer: search → (Mua lại slot, empty) → (strip slot, empty) → Flash → Bán chạy → Danh mục → Dành cho bạn → Đã xem gần đây → Tubu chọn → Mới về → extras. The rail and strip slots stay at positions 2–3 in both orders, so the 4a skeleton guard (skeleton ≈ rail height, block below moves ≤16px) still holds when `purchased-items` resolves; while it loads the page uses the new-customer order. In both orders the first product grid is block ≤5. "Tubu chọn cho bạn" drops products already shown in "Dành cho bạn" (A2-32 duplicate). The "Cho mẹ và bé" product section and the segment pill row are removed (the segment stays reachable from Danh mục and deep links). Extras, in order: two small cards (AI "Trợ lý AI 24/7" keeps its accessible name "Hỏi trợ lý AI 24/7"; "Mua chung giá tốt"), the hero card with the CTA renamed **"Tìm sản phẩm"** (A2-33; no more "Khám phá vườn"), the brand strip "Thương hiệu Việt", "Hành trình nguyên liệu", "Cộng đồng Vườn Tubu". Pull-to-refresh now invalidates every Home query prefix (A2-33).
9. **Order strip** ("đơn đang giao / kỳ định kỳ kế tiếp"): the newest `SHIPPING` order (`GET /orders?status=SHIPPING&limit=1`, fetched only when the shared active-order badge count is > 0) and the next `ACTIVE` subscription (`GET /me/subscriptions`, same `['subscriptions']` key as the panel). Hidden when neither exists, for guests, and on any error.
10. **`FlashSale` / `UpcomingFlashSales` are not migrated** (spec does not ask; behaviour and look unchanged). They keep their legacy vars and are excluded from the 4b guard; recorded as a follow-up.
11. **Recently viewed** stores `{ slug, name, thumbnail, price, viewedAt }` (spec fields + timestamp), max 20, newest first, de-duplicated by slug, in `localStorage['tubu_recently_viewed']`; written once per slug when the PDP query succeeds. Rendered by its own small card (not `ProductTile`): `ProductTile` would print a fake "★ Mới" and a wishlist heart that needs a product id we do not store. Shown on Home, on the Browse root, and under the no-results state. No server sync.
12. **Browse clean-up (A2-34):** "Xu hướng" (= first 6 brands) and the always-visible brand chip row are removed; brands live in `FilterSheet` and as removable chips; segment emoji labels become lucide icons; the recent-keyword clock emoji is gone.
13. **New primitive `SearchField`** in `components/ui/` (DS v2 has no text input; Browse needs focus/Enter/clear control). `Chip` gains a 44px hit area (class `tubu-hit-44`, visual size unchanged — the DS follow-up "Chip (32/36px) is under the 44px touch target") and an optional `ariaLabel`. Rows of chips get ≥4px vertical padding so the enlarged hit area is not clipped by `overflow-x: auto`.
14. **`CatalogTile`** (in `components/catalog/`) carries the flash > sale > base rule and the sale/flash badge exactly as the legacy `ProductCard`, on top of `ProductTile`. The PDP's own `RelatedTile` is left for 4c; legacy `components/product-card.tsx` stays (still used by `wishlist.tsx`).
15. **Lint gate.** Verified baseline: `home.tsx` has 7 and `browse.tsx` 2 `tubu-ds`/`no-restricted-imports` errors today; `product-detail.tsx` and `flash-sale.tsx` are clean. Rewritten/created files must be at **0** errors; no other file may gain errors.
16. **E2E defaults.** The new Home calls `GET /categories`, `GET /me/subscriptions` and (badge > 0) `GET /orders`. `mockSession` gets defaults for all three in the same task that adds the calls (the fixture fails on any unmocked call); later registrations still win at equal specificity.
17. **Events.** `search_performed { q, resultsCount }` keeps its props. New: `search_result_clicked { q, position (1-based), source: 'results'|'suggest', slug }` and `filter_applied { type: 'price'|'in_stock'|'brand'|'rating' }`, one event per filter type that actually changed when "Xem n sản phẩm" is pressed.
18. **FilterSheet result count** = `meta.total` of a `limit=1` catalog query for the draft filters (debounced 250 ms). The apply button reads "Xem n sản phẩm"; while counting "Xem kết quả"; on error or old API "Áp dụng". Never disabled.
19. **Carry-overs folded in (files 4b touches only):** Chip 44px hit area (deferred finding); `PURCHASED_RAIL_LIMIT` exported from `purchased-rail.tsx` so Home can share the rail's query key (rail markup untouched, so its `TILE_HEIGHT = 337` stays valid). Nothing else from the follow-up ledger touches 4b files.
20. **Not in scope:** product images/srcset (A2-49/50), PDP layout (4c), cart/checkout (4d), the Button `useRef` lock, search-keyword logging for real "trending".

## Global Constraints

- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Write file content and commit messages in normal English or Vietnamese prose (no caveman style). UI copy is Vietnamese and goes through `apps/miniapp/src/i18n/vi.ts`.
- DS v2 rules for every new/rewritten miniapp file: use components in `apps/miniapp/src/components/ui/`; no raw colors (hex/rgb/rgba) in `style`; no legacy CSS vars `--neutral-*`, `--primary-*`, `--leaf-*`, nor the other legacy alias families of `css/tokens.css` (`--sun-*`, `--success/--warning/--danger/--info(-bg)`, `--clay-200/800`, `--radius-sm/md/lg/xl/full`, `--shadow-*`, `--dealer-*`, `--font-body`); every `IconButton` has `label`; hit areas ≥ 44px; DS `Button` uses `onPress` (never `onClick`); never pass the pending flag as `disabled` to a `Button` that has `loading`; `.catch` (or `try/catch`) on every fire-and-forget promise started from a press handler.
- ESLint: no NEW errors versus the baseline (Ruling 15); every file created or rewritten by this plan is at 0 errors.
- Every task adds or updates tests; tests fail first, then pass.
- Never run `git stash`, `git reset` or `git checkout` (other agents may share the tree).
- Deploy order: **API before miniapp**. New `/products` params are optional; the miniapp omits unset params and, against an old API that answers 400, retries without them and shows a notice (Ruling 6). Do NOT roll the API back below 4b while the 4b miniapp is live (filters would silently disappear).
- `pnpm lint:vars` (repo root) must stay `OK`.
- E2E rules carried over from 4a: every newly called endpoint gets a default mock in the same task; the mock router is specificity-aware (`/orders/active-count` beats `/orders/:code`); **`page.waitForTimeout` is banned** in new tests (use `expect.poll` / `waitForCall`); use `{ timeout: 15_000 }` on the first assertion after any client-side navigation; an "X is absent" assertion must first wait for the request that would populate X **and** for its loading placeholder to disappear (no vacuous passes); skeleton heights must match real content (≤16px) and are pinned by e2e.
- Commands (Git Bash; in PowerShell use `$env:E2E_SCOPE='miniapp';` instead of the `VAR=x` prefix):
  - Miniapp unit: `pnpm --filter @tubutree/miniapp exec vitest run <path>`
  - Miniapp types: `pnpm --filter @tubutree/miniapp exec tsc --noEmit`
  - Miniapp lint: `pnpm --filter @tubutree/miniapp exec eslint <files>`
  - API unit: `cd apps/api && npx jest <pattern>`
  - API types: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
  - API real Postgres (Docker must be running: `pnpm dev:infra`): `cd apps/api && DATABASE_URL="$IT_DATABASE_URL" npx jest -c test/integration-race/jest.config.js --runInBand <pattern>` — `IT_DATABASE_URL` = the `DATABASE_URL` from `apps/api/.env` with only the database name replaced by `tubutree_it` (read it from that file; never print or commit credentials; on this Windows box use host `127.0.0.1` instead of `localhost` if the connection is refused). If `tubutree_it` does not exist: `createdb tubutree_it` then `DATABASE_URL="$IT_DATABASE_URL" npx prisma migrate deploy` in `apps/api`.
  - E2E: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test <file> --workers=1 --retries=0`
  - E2E types: `pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json`
- Verify UI at **320, 375 and 390px** (Tasks 25–26 capture screenshots).
- Deploy notes for the runbook: no migration in 4b; additive response field `productCount` on `GET /categories`; new optional query params on `GET /products`; API first, then miniapp.

## Review Focus

- **A Vietnamese query typed with or without diacritics, in capitals, or stored decomposed (NFD)** — "NƯỚC RỬA", "nuoc rua", a Pancake name pasted from macOS — must find the same products on the real database collation, not only in unit tests. Task 7 pins the database fold against the TypeScript fold and an NFD product name.
- **Search text containing `%` or `_`** must match literally, never "everything". Task 1 (escape) and Task 7 (real query returns nothing for `%`).
- **The 4b miniapp against a pre-4b API** must never show an error page when a filter is applied: one retry without the new params, a notice, results. Task 8 (unit: 400 → retry, 500 → error, 400 without new params → error) and Task 24 (e2e legacy mode).
- **Back from a product page** must restore the query, sort, filters and scroll position, and filter changes must not push history entries (Back leaves Browse instead of undoing filters one by one). Task 9 (`replace` navigation type), Task 11 (scroll save/restore), Task 24 (e2e: history length unchanged, scroll restored).
- **Paging through "Bán chạy" or the default sort when many products tie** must not show a product twice or skip one. Task 5 (unit) and Task 7 (real Postgres, ties across pages).

## File Map

API (`apps/api/src/modules/catalog/...`)
- `search-text.ts` (new) — `VN_FOLD_FROM`, `VN_FOLD_TO`, `foldVietnamese`, `escapeLike`, `likeContainsPattern`, `LIKE_ESCAPE`.
- `dto/product-query.dto.ts` — `minPrice`, `maxPrice`, `inStock`, `minRating`; `dto/product-query.dto.spec.ts` (new).
- `catalog.service.ts` — `listWhere`, `textWhere`, price/stock/rating filters, id tiebreaker, `listBestSellers`, `categories()` with `productCount`, `suggest()` folded.
- `catalog.service.spec.ts` — new describe blocks.
- `apps/api/test/integration-race/buy-flow-4b.race-spec.ts` (new).

Miniapp (`apps/miniapp/src/...`)
- `services/shop-api.ts` — `CatalogSort`, `CatalogQuery`, `CatalogPage`, `catalogParams`, `fetchCatalog`, `CategoryDTO`, `fetchCategories`; `services/discovery-events.ts` (new).
- `utils/vn-fold.ts`, `utils/search-state.ts`, `utils/recently-viewed.ts`, `utils/recent-searches.ts` (new).
- `hooks/use-search-state.ts`, `hooks/use-recently-viewed.ts`, `hooks/use-record-recently-viewed.ts`, `hooks/use-categories.ts`, `hooks/use-suggest.ts`, `hooks/use-scroll-restoration.ts` (new).
- `components/ui/search-field.tsx` (new), `components/ui/chip.tsx`, `css/tokens.css` (`.tubu-hit-44`).
- `components/catalog/` (new): `catalog-pricing.ts`, `catalog-grid.tsx`, `category-grid.tsx`, `sort-chips.tsx`, `result-header.tsx`, `filter-sheet.tsx`, `suggest-list.tsx`, `recently-viewed-rail.tsx`.
- `components/home/` (new): `home-blocks.ts`, `home-header.tsx`, `home-section.tsx`, `order-strip.tsx`, `home-extras.tsx`.
- `components/reorder/purchased-rail.tsx` (export `PURCHASED_RAIL_LIMIT` only).
- Pages: `browse.tsx` (rewritten), `home.tsx` (rewritten), `product-detail.tsx` (one hook call).
- `i18n/vi.ts` — `home`, `browse` blocks.
- `ds-legacy-vars-4b.spec.ts` (new).

E2E (`apps/e2e/tests/...`)
- `support/mock-api.ts` (defaults in `mockSession`), `support/discovery-mocks.ts` (new), `buy-flow-4b.miniapp.spec.ts` (new).

---

## Task 1: API — Vietnamese folding helpers (`search-text.ts`)

**Files:**
- Create: `apps/api/src/modules/catalog/search-text.ts`
- Test: `apps/api/src/modules/catalog/search-text.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const VN_FOLD_FROM: string` / `export const VN_FOLD_TO: string` — `translate()` maps; `VN_FOLD_FROM` = every Vietnamese accented letter (lower + upper) followed by the 8 combining marks; `VN_FOLD_TO` = the ASCII base letter for each accented letter (no entries for the marks, so Postgres deletes them).
  - `export function foldVietnamese(input: string): string` — maps with the same table, deletes the marks, lower-cases, collapses whitespace, trims.
  - `export const LIKE_ESCAPE = '!'`; `export function escapeLike(s: string): string`; `export function likeContainsPattern(q: string): string` → `%<escaped folded q>%`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/catalog/search-text.spec.ts`:

```ts
import { LIKE_ESCAPE, VN_FOLD_FROM, VN_FOLD_TO, escapeLike, foldVietnamese, likeContainsPattern } from './search-text';

/** Đúng ngữ nghĩa translate() của Postgres: ký tự của `from` không có cặp ở `to` thì bị XOÁ. */
function pgTranslate(s: string, from: string, to: string): string {
  let out = '';
  for (const ch of s) {
    const i = from.indexOf(ch);
    if (i === -1) out += ch;
    else if (i < to.length) out += to[i];
  }
  return out;
}
/** Mô phỏng biểu thức SQL trong catalog.service: regexp_replace(lower(translate(...)), '[[:space:]]+', ' ') + trim. */
const sqlFold = (s: string) => pgTranslate(s, VN_FOLD_FROM, VN_FOLD_TO).toLowerCase().replace(/\s+/g, ' ').trim();

describe('foldVietnamese', () => {
  it('bỏ dấu, về chữ thường', () => {
    expect(foldVietnamese('Nước Rửa Chén')).toBe('nuoc rua chen');
    expect(foldVietnamese('Xà phòng thảo mộc Đậu Đỏ')).toBe('xa phong thao moc dau do');
  });

  it('chữ HOA có dấu (lower() của Postgres dưới collation C không hạ được) vẫn gấp đúng', () => {
    expect(foldVietnamese('NƯỚC RỬA CHÉN ĐẬU')).toBe('nuoc rua chen dau');
  });

  it('chuỗi dựng sẵn dạng NFD (dấu tách rời) gấp giống NFC', () => {
    expect(foldVietnamese('Nước rửa'.normalize('NFD'))).toBe('nuoc rua');
  });

  it('gom khoảng trắng thừa, cắt hai đầu', () => {
    expect(foldVietnamese('  xà   phòng  ')).toBe('xa phong');
  });

  it('ASCII giữ nguyên (chỉ hạ chữ)', () => {
    expect(foldVietnamese('Tubu Tree 500ML')).toBe('tubu tree 500ml');
  });

  it('khớp từng ký tự với cách Postgres translate() + lower() xử lý (cả NFD, chữ hoa)', () => {
    const samples = [
      'Nước Rửa Chén Hương Chanh', 'NƯỚC RỬA', 'Kem chống nắng Rau Má', 'Ổi Ửng Ỹ Ỵ ữ', 'Đà Lạt',
      'Nước'.normalize('NFD'), 'Bình sữa cho bé'.normalize('NFD'),
    ];
    for (const s of samples) expect(foldVietnamese(s)).toBe(sqlFold(s));
  });
});

describe('bảng translate', () => {
  it('mỗi chữ có dấu có đúng 1 chữ ASCII a-z; 8 dấu kết hợp đứng cuối, không có cặp (bị xoá)', () => {
    expect(VN_FOLD_FROM.length - VN_FOLD_TO.length).toBe(8);
    expect(VN_FOLD_TO).toMatch(/^[a-z]+$/);
    expect(new Set(VN_FOLD_FROM).size).toBe(VN_FOLD_FROM.length);
    expect(VN_FOLD_FROM.slice(-8)).toBe('̛̣̀́̃̉̂̆');
  });
});

describe('LIKE', () => {
  it('escape %, _ và chính ký tự escape', () => {
    expect(LIKE_ESCAPE).toBe('!');
    expect(escapeLike('50%_off!')).toBe('50!%!_off!!');
  });

  it('likeContainsPattern = %<gấp dấu + escape>%', () => {
    expect(likeContainsPattern('  Nước 50% ')).toBe('%nuoc 50!%%');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest search-text`
Expected: FAIL — `Cannot find module './search-text'`.

- [ ] **Step 3: Implement**

`apps/api/src/modules/catalog/search-text.ts`:

```ts
/**
 * Tìm không dấu tiếng Việt (spec 4b §2, Ruling 1 của plan 4b) — KHÔNG dùng extension `unaccent`:
 * quyền/phiên bản Postgres prod chưa rõ, và một migration `CREATE EXTENSION` lỗi sẽ chặn mọi lần
 * `prisma migrate deploy` sau đó (P3009). `translate()` có sẵn trong Postgres, không cần quyền gì.
 *
 * Cùng MỘT bảng ký tự dùng cho cả hai phía:
 *  - SQL: `lower(translate(p.name, VN_FOLD_FROM, VN_FOLD_TO))` (catalog.service.ts);
 *  - TypeScript: `foldVietnamese(q)` cho từ khoá khách gõ.
 * Bảng gồm cả chữ HOA (để không phụ thuộc `lower()` của collation DB — collation C không hạ được
 * chữ có dấu) và 8 dấu kết hợp (tên lưu dạng NFD: dấu bị xoá, giữ chữ gốc).
 */
const LETTER_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'àáạảãâầấậẩẫăằắặẳẵ'],
  ['e', 'èéẹẻẽêềếệểễ'],
  ['i', 'ìíịỉĩ'],
  ['o', 'òóọỏõôồốộổỗơờớợởỡ'],
  ['u', 'ùúụủũưừứựửữ'],
  ['y', 'ỳýỵỷỹ'],
  ['d', 'đ'],
];

/** Dấu kết hợp của tiếng Việt (dạng NFD): huyền, sắc, ngã, hỏi, nặng, mũ, trăng, móc. */
const VN_COMBINING_MARKS = '̛̣̀́̃̉̂̆';

function buildFoldMap(): { from: string; to: string; map: Map<string, string> } {
  let from = '';
  let to = '';
  const map = new Map<string, string>();
  for (const [base, chars] of LETTER_GROUPS) {
    for (const ch of chars + chars.toUpperCase()) {
      from += ch;
      to += base;
      map.set(ch, base);
    }
  }
  return { from: from + VN_COMBINING_MARKS, to, map };
}

const FOLD = buildFoldMap();
const COMBINING = new Set(VN_COMBINING_MARKS);

/** Tham số `from` của translate(): mọi chữ có dấu (thường + HOA) rồi 8 dấu kết hợp ở cuối. */
export const VN_FOLD_FROM = FOLD.from;
/** Tham số `to` của translate(): ngắn hơn `from` đúng 8 ký tự → Postgres xoá các dấu kết hợp. */
export const VN_FOLD_TO = FOLD.to;

/** "  NƯỚC  Rửa " → "nuoc rua". Cùng bảng với SQL (xem đầu file). */
export function foldVietnamese(input: string): string {
  let out = '';
  for (const ch of input) {
    if (COMBINING.has(ch)) continue;
    out += FOLD.map.get(ch) ?? ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Ký tự escape cho LIKE — dùng '!' thay '\\' để không phải đoán cách template literal escape. */
export const LIKE_ESCAPE = '!';

/** `%` và `_` khách gõ phải khớp đúng nghĩa đen, không thành ký tự đại diện. */
export function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, (c) => `${LIKE_ESCAPE}${c}`);
}

/** Mẫu "chứa" cho `... LIKE <mẫu> ESCAPE '!'`. */
export function likeContainsPattern(q: string): string {
  return `%${escapeLike(foldVietnamese(q))}%`;
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/api && npx jest search-text` → PASS.
Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog/search-text.ts apps/api/src/modules/catalog/search-text.spec.ts
git commit -m "feat(api): Vietnamese text folding shared by SQL translate() and the query (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: API — `ProductQuery` gains `minPrice`, `maxPrice`, `inStock`, `minRating`

**Files:**
- Modify: `apps/api/src/modules/catalog/dto/product-query.dto.ts`
- Create: `apps/api/src/modules/catalog/dto/product-query.dto.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProductQuery` with optional `minPrice?: number` (int ≥ 0), `maxPrice?: number` (int ≥ 0), `inStock?: boolean` (`'true'|'1'` → true, `'false'|'0'` → false), `minRating?: number` (0–5). Existing fields unchanged; `sort` already allows `best_seller`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/catalog/dto/product-query.dto.spec.ts`:

```ts
import { ValidationPipe } from '@nestjs/common';
import { ProductQuery } from './product-query.dto';

// Cùng cấu hình ValidationPipe với main.ts — forbidNonWhitelisted: field lạ bị từ chối (400).
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asQuery = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype: ProductQuery, data: undefined });

describe('ProductQuery (dự án 4b)', () => {
  it('tham số cũ vẫn nhận như trước (web shop, miniapp cũ)', async () => {
    await expect(asQuery({ brand: 'Tubu', q: 'nước', sort: 'best_seller', page: '2', limit: '30' })).resolves.toMatchObject({
      brand: 'Tubu', q: 'nước', sort: 'best_seller', page: 2, limit: 30,
    });
  });

  it('minPrice/maxPrice/minRating ép sang số; inStock "true"/"1" → true, "false"/"0" → false', async () => {
    await expect(asQuery({ minPrice: '100000', maxPrice: '200000', minRating: '4', inStock: 'true' })).resolves.toMatchObject({
      minPrice: 100000, maxPrice: 200000, minRating: 4, inStock: true,
    });
    await expect(asQuery({ inStock: '1' })).resolves.toMatchObject({ inStock: true });
    await expect(asQuery({ inStock: 'false' })).resolves.toMatchObject({ inStock: false });
    await expect(asQuery({ inStock: '0' })).resolves.toMatchObject({ inStock: false });
  });

  it('không truyền tham số mới → không có field nào bị gán mặc định', async () => {
    const q = (await asQuery({})) as ProductQuery;
    expect(q.minPrice).toBeUndefined();
    expect(q.maxPrice).toBeUndefined();
    expect(q.inStock).toBeUndefined();
    expect(q.minRating).toBeUndefined();
  });

  it('từ chối giá âm / lẻ / chữ, minRating ngoài 0..5, inStock lạ', async () => {
    await expect(asQuery({ minPrice: '-1' })).rejects.toThrow();
    await expect(asQuery({ maxPrice: '12.5' })).rejects.toThrow();
    await expect(asQuery({ minPrice: 'abc' })).rejects.toThrow();
    await expect(asQuery({ minRating: '6' })).rejects.toThrow();
    await expect(asQuery({ inStock: 'yes' })).rejects.toThrow();
  });

  it('field lạ vẫn bị từ chối — đây là lý do API trước 4b trả 400 cho tham số mới (miniapp phải tự lùi)', async () => {
    await expect(asQuery({ color: 'red' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest product-query.dto`
Expected: FAIL — `minPrice`/`inStock` rejected as non-whitelisted properties.

- [ ] **Step 3: Implement**

Replace `apps/api/src/modules/catalog/dto/product-query.dto.ts` with:

```ts
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

/** Query string luôn là chuỗi: 'true'/'1' → true, 'false'/'0' → false; giá trị khác để IsBoolean từ chối. */
function toBool({ value }: { value: unknown }): unknown {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

export class ProductQuery extends PaginationQuery {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() segment?: string; // forSegment (vd mom_baby)
  @IsOptional() @IsString() q?: string;

  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest', 'best_seller', 'rating'])
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'best_seller' | 'rating';

  // ── Dự án 4b (bộ lọc Browse). Đều tuỳ chọn → web shop và miniapp cũ gọi như trước. ──

  /** Giá đang bán tối thiểu (salePrice nếu có, không thì basePrice), VND. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000)
  minPrice?: number;

  /** Giá đang bán tối đa, VND. min > max → service tự đổi chỗ. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000)
  maxPrice?: number;

  /** Chỉ SP còn ít nhất 1 phân loại đang bán có tồn > 0. */
  @IsOptional() @Transform(toBool) @IsBoolean()
  inStock?: boolean;

  /** Điểm đánh giá trung bình tối thiểu (ratingAvg). Miniapp gửi 4 ("Từ 4★"). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5)
  minRating?: number;
}
```

- [ ] **Step 4: Run tests and types**

Run: `cd apps/api && npx jest product-query.dto catalog` → PASS (existing catalog specs unaffected).
Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog/dto/product-query.dto.ts apps/api/src/modules/catalog/dto/product-query.dto.spec.ts
git commit -m "feat(api): optional price, stock and rating filters on GET /products query (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: API — price / stock / rating filters in `CatalogService.list` + stable ordering

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`list`, `orderBy`; new private `listWhere`, module-level `priceRange`)
- Test: `apps/api/src/modules/catalog/catalog.service.spec.ts` (append a describe block)

**Interfaces:**
- Consumes: `ProductQuery` (Task 2).
- Produces:
  - `private async listWhere(query: ProductQuery): Promise<Prisma.ProductWhereInput>` — the single place that builds the public catalog filter (Task 4 adds the text filter, Task 5 reuses it for `best_seller`).
  - `function priceRange(min?: number, max?: number): { gte?: number; lte?: number } | undefined`
  - `list()` order: `[<primary>, { id: 'asc' }]` for every non-`best_seller` sort.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/catalog/catalog.service.spec.ts`:

```ts
describe('CatalogService.list — bộ lọc dự án 4b', () => {
  function setup() {
    const findMany = jest.fn().mockResolvedValue([card('p1')]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      product: { findMany, count },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), findMany, count };
  }
  const argsOf = (findMany: jest.Mock) => findMany.mock.calls[0][0];

  it('khoảng giá lọc theo GIÁ ĐANG BÁN (salePrice nếu có, không thì basePrice) — đúng giá thẻ SP hiển thị', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, minPrice: 100000, maxPrice: 200000 });
    const range = { gte: 100000, lte: 200000 };
    expect(argsOf(findMany).where.AND).toEqual([{ OR: [{ salePrice: range }, { salePrice: null, basePrice: range }] }]);
  });

  it('chỉ minPrice → chỉ gte; min > max → tự đổi chỗ', async () => {
    const a = setup();
    await a.svc.list({ page: 1, limit: 20, minPrice: 500000 });
    expect(argsOf(a.findMany).where.AND).toEqual([{ OR: [{ salePrice: { gte: 500000 } }, { salePrice: null, basePrice: { gte: 500000 } }] }]);
    const b = setup();
    await b.svc.list({ page: 1, limit: 20, minPrice: 300000, maxPrice: 100000 });
    const range = { gte: 100000, lte: 300000 };
    expect(argsOf(b.findMany).where.AND).toEqual([{ OR: [{ salePrice: range }, { salePrice: null, basePrice: range }] }]);
  });

  it('inStock → còn ít nhất 1 phân loại ĐANG BÁN có tồn > 0 (cùng quy tắc với inStock của thẻ)', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, inStock: true });
    expect(argsOf(findMany).where.variations).toEqual({ some: { isActive: true, stock: { gt: 0 } } });
  });

  it('inStock=false → không lọc tồn kho', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, inStock: false });
    expect(argsOf(findMany).where.variations).toBeUndefined();
  });

  it('minRating → ratingAvg >= minRating', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, minRating: 4 });
    expect(argsOf(findMany).where.ratingAvg).toEqual({ gte: 4 });
  });

  it('không truyền tham số mới → where như trước (không AND/variations/ratingAvg)', async () => {
    const { svc, findMany } = setup();
    await svc.list({ page: 1, limit: 20, brand: 'Tubu' });
    expect(argsOf(findMany).where).toEqual({ isActive: true, approvalStatus: 'APPROVED', brand: 'Tubu' });
  });

  it('mọi kiểu sắp xếp (trừ best_seller) có id tăng dần làm tiêu chí phụ → phân trang không trùng/sót khi hoà', async () => {
    const a = setup();
    await a.svc.list({ page: 1, limit: 20 });
    expect(argsOf(a.findMany).orderBy).toEqual([{ isFeatured: 'desc' }, { id: 'asc' }]);
    const b = setup();
    await b.svc.list({ page: 1, limit: 20, sort: 'newest' });
    expect(argsOf(b.findMany).orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });

  it('count dùng đúng where của findMany', async () => {
    const { svc, findMany, count } = setup();
    await svc.list({ page: 1, limit: 20, minRating: 4, inStock: true });
    expect(count).toHaveBeenCalledWith({ where: argsOf(findMany).where });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest catalog.service`
Expected: FAIL — `where.AND` / `where.variations` / `where.ratingAvg` undefined; `orderBy` is an object, not an array.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/catalog/catalog.service.ts`, add above `@Injectable()`:

```ts
/** Khoảng giá cho filter Prisma; min > max thì đổi chỗ (client không gửi vậy, nhưng không 400). */
function priceRange(min?: number, max?: number): { gte?: number; lte?: number } | undefined {
  if (min == null && max == null) return undefined;
  let lo = min;
  let hi = max;
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  return { ...(lo != null ? { gte: lo } : {}), ...(hi != null ? { lte: hi } : {}) };
}
```

Replace `list` (currently lines 54-92) with:

```ts
  async list(query: ProductQuery) {
    const { page, limit, sort } = query;
    const where = await this.listWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        // `id` làm tiêu chí phụ: chỉ sắp theo isFeatured/createdAt/giá thì các SP hoà nhau đổi thứ
        // tự giữa hai lần query → cuộn vô hạn ở Browse hiện trùng hoặc sót SP giữa các trang.
        orderBy: [this.orderBy(sort), { id: 'asc' }],
        ...skipTake(page, limit),
        include: { variations: { where: { isActive: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(items.map((p) => this.toCard(p)), page, limit, total);
  }

  /**
   * Bộ lọc công khai của catalog — MỘT nơi duy nhất (list + best_seller dùng chung).
   * P0 A2-03 = A5-06 = A6-04 (docs/audit-2026-09): SP đối tác được tạo với isActive:true ngay cả
   * khi approvalStatus:'PENDING_REVIEW' và bị REJECTED cũng không tự tắt isActive → mọi truy vấn
   * công khai gác thêm approvalStatus, giữ isActive là cờ vòng đời riêng.
   * Điều kiện cần `OR` (giá, từ khoá) đi vào `AND` để không đè nhau.
   */
  private async listWhere(query: ProductQuery): Promise<Prisma.ProductWhereInput> {
    const { brand, category, segment, minPrice, maxPrice, inStock, minRating } = query;
    const where: Prisma.ProductWhereInput = { isActive: true, approvalStatus: 'APPROVED' };
    const and: Prisma.ProductWhereInput[] = [];
    if (brand) {
      const brandList = brand.split(',').map((b) => b.trim()).filter(Boolean);
      if (brandList.length === 1) {
        where.brand = brandList[0];
      } else if (brandList.length > 1) {
        where.brand = { in: brandList };
      }
    }
    if (category) where.categoryIds = { has: category };
    if (segment) where.forSegment = { has: segment };
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { tags: { has: query.q.toLowerCase() } },
      ];
    }
    // Giá ĐANG BÁN = salePrice ?? basePrice — đúng giá `ProductTile` hiển thị (standing price).
    const price = priceRange(minPrice, maxPrice);
    if (price) and.push({ OR: [{ salePrice: price }, { salePrice: null, basePrice: price }] });
    // Cùng quy tắc với `inStock` của thẻ (toCard): có phân loại đang bán còn tồn.
    if (inStock) where.variations = { some: { isActive: true, stock: { gt: 0 } } };
    // ratingAvg mặc định 0 → SP chưa có đánh giá không lọt "Từ 4★" (đúng ý bộ lọc).
    if (minRating != null) where.ratingAvg = { gte: minRating };
    if (and.length > 0) where.AND = and;
    return where;
  }
```

(The `query.q` block is moved verbatim from the old `list`; Task 4 replaces it with the folded search.)

- [ ] **Step 4: Run tests and types**

Run: `cd apps/api && npx jest catalog` → PASS (the three existing `CatalogService.list (Multi-brand filtering)` tests still pass: they assert `where` with `objectContaining`).
Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog/catalog.service.ts apps/api/src/modules/catalog/catalog.service.spec.ts
git commit -m "feat(api): price on displayed price, in-stock and rating filters; id tiebreaker for stable catalog paging (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: API — unaccented search for `GET /products?q=` and `GET /search/suggest`

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (new private `textWhere`; `listWhere` uses it; `suggest` uses it)
- Test: `apps/api/src/modules/catalog/catalog.service.spec.ts` (append)

**Interfaces:**
- Consumes: `VN_FOLD_FROM`, `VN_FOLD_TO`, `foldVietnamese`, `likeContainsPattern`, `LIKE_ESCAPE` (Task 1); `listWhere` (Task 3).
- Produces:
  - `private async textWhere(q: string | undefined): Promise<Prisma.ProductWhereInput | undefined>` — `undefined` for blank `q`; `{ id: { in: string[] } }` from the folded SQL; on SQL error `{ OR: [{ name: { contains, mode: 'insensitive' } }, { tags: { has } }] }` (today's behaviour).
  - `suggest(q)` response shape unchanged: `{ slug, name, thumbnail, basePrice }[]` (max 8).
  - `const TEXT_MATCH_LIMIT = 2000` (safety cap on ids returned by the folded SQL).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/catalog/catalog.service.spec.ts` (add `import { LIKE_ESCAPE, VN_FOLD_FROM, VN_FOLD_TO } from './search-text';` at the top):

```ts
describe('CatalogService — tìm không dấu (dự án 4b)', () => {
  function setup(queryRaw: jest.Mock) {
    const findMany = jest.fn().mockResolvedValue([card('p1')]);
    const prisma = {
      product: { findMany, count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), findMany };
  }

  it('q → SQL gấp dấu bằng translate(); where lọc theo id tìm được (AND, không đè OR khác)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: ' Nước rửa ' });
    expect(findMany.mock.calls[0][0].where.AND).toEqual([{ id: { in: ['p1', 'p2'] } }]);
    expect(findMany.mock.calls[0][0].where.OR).toBeUndefined();
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('translate(p.name');
    expect(LIKE_ESCAPE).toBe('!');
    expect(strings.join('?')).toContain("ESCAPE '!'");
    expect(values).toEqual(expect.arrayContaining([VN_FOLD_FROM, VN_FOLD_TO, '%nuoc rua%', 'nước rửa']));
  });

  it('% và _ trong từ khoá được escape (không thành ký tự đại diện)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: '50%' });
    expect(queryRaw.mock.calls[0]).toContain('%50!%%');
  });

  it('SQL gấp dấu lỗi → lùi về contains như trước (mất tìm không dấu nhưng không sập trang)', async () => {
    const queryRaw = jest.fn().mockRejectedValue(new Error('function translate does not exist'));
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: 'Nước rửa' });
    expect(findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ name: { contains: 'Nước rửa', mode: 'insensitive' } }, { tags: { has: 'nước rửa' } }] },
    ]);
  });

  it('q chỉ có khoảng trắng → coi như không tìm (không gọi SQL)', async () => {
    const queryRaw = jest.fn();
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: '   ' });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it('q kết hợp khoảng giá → cả hai nằm trong AND', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    const { svc, findMany } = setup(queryRaw);
    await svc.list({ page: 1, limit: 20, q: 'nuoc', maxPrice: 100000 });
    expect(findMany.mock.calls[0][0].where.AND).toEqual([
      { id: { in: ['p1'] } },
      { OR: [{ salePrice: { lte: 100000 } }, { salePrice: null, basePrice: { lte: 100000 } }] },
    ]);
  });

  it('suggest dùng cùng cách khớp; giữ shape {slug,name,thumbnail,basePrice}, tối đa 8; q rỗng → []', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    const { svc, findMany } = setup(queryRaw);
    await svc.suggest('nuoc rua');
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, approvalStatus: 'APPROVED', AND: [{ id: { in: ['p1'] } }] },
      take: 8,
      select: { slug: true, name: true, thumbnail: true, basePrice: true },
    });
    await expect(svc.suggest('  ')).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest catalog.service`
Expected: FAIL — `$queryRaw` never called; `where.OR` still set.

- [ ] **Step 3: Implement**

In `catalog.service.ts` add the import and a constant:

```ts
import { VN_FOLD_FROM, VN_FOLD_TO, foldVietnamese, likeContainsPattern } from './search-text';

/** Trần số id trả về từ SQL tìm không dấu — catalog hiện vài trăm SP; chặn trường hợp từ khoá quá chung. */
const TEXT_MATCH_LIMIT = 2000;
```

In `listWhere`, replace the `if (query.q) { where.OR = ... }` block with:

```ts
    const text = await this.textWhere(query.q);
    if (text) and.push(text);
```

(keep it **before** the price `and.push`, so `AND` = `[text, price]` as the test expects).

Add the private method below `listWhere`:

```ts
  /**
   * Khớp từ khoá không dấu, không phân biệt hoa thường (spec 4b §2 — plan 4b Ruling 1): gấp dấu
   * tên SP bằng `translate()` có sẵn của Postgres với CÙNG bảng ký tự mà `foldVietnamese` dùng cho
   * từ khoá. Vẫn giữ khớp tag đúng nguyên văn (chữ thường) như trước. SQL lỗi (DB lạ) → lùi về
   * `contains` cũ cho request đó, không chặn cờ vĩnh viễn (lỗi tạm thời không làm hỏng cả phiên).
   */
  private async textWhere(q: string | undefined): Promise<Prisma.ProductWhereInput | undefined> {
    const raw = (q ?? '').trim();
    if (!foldVietnamese(raw)) return undefined;
    const tag = raw.toLowerCase();
    try {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM products p
        WHERE p."isActive" = true
          AND (
            regexp_replace(lower(translate(p.name, ${VN_FOLD_FROM}, ${VN_FOLD_TO})), '[[:space:]]+', ' ', 'g')
              LIKE ${likeContainsPattern(raw)} ESCAPE '!'
            OR ${tag} = ANY(p.tags)
          )
        LIMIT ${TEXT_MATCH_LIMIT}`;
      return { id: { in: rows.map((r) => r.id) } };
    } catch (err) {
      this.logger.warn(`Tìm không dấu lỗi, dùng contains: ${err instanceof Error ? err.message : String(err)}`);
      return { OR: [{ name: { contains: raw, mode: 'insensitive' } }, { tags: { has: tag } }] };
    }
  }
```

`ESCAPE '!'` is written as **literal SQL text** on purpose: anything inside `${...}` in a Prisma tagged template becomes a bound parameter, and the escape character must be a literal. It must equal `LIKE_ESCAPE` from `search-text.ts` — the unit test asserts both the SQL text and the constant.

Replace `suggest` with:

```ts
  async suggest(q: string) {
    const text = await this.textWhere(q);
    if (!text) return [];
    return this.prisma.product.findMany({
      where: { isActive: true, approvalStatus: 'APPROVED', AND: [text] },
      take: 8,
      select: { slug: true, name: true, thumbnail: true, basePrice: true },
    });
  }
```

- [ ] **Step 4: Run tests and types**

Run: `cd apps/api && npx jest catalog` → PASS. The existing test `suggest(): where lọc approvalStatus APPROVED` still passes: its prisma mock has no `$queryRaw`, so the call throws inside `try` and the fallback `where` still contains `isActive`/`approvalStatus`.
Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog/catalog.service.ts apps/api/src/modules/catalog/catalog.service.spec.ts
git commit -m "feat(api): unaccented, case-insensitive product search and suggest via translate() with contains fallback (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: API — real `best_seller` ordering

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`list` branch + new private `listBestSellers`)
- Test: `apps/api/src/modules/catalog/catalog.service.spec.ts` (append)

**Interfaces:**
- Consumes: `listWhere` (Tasks 3–4), `toCard`, `paginated`, `skipTake`.
- Produces: `GET /products?sort=best_seller` ordered by `soldApp + soldExternal desc`, ties `id asc`; same `PaginatedResult` shape; `meta.total` = number of matching products.

- [ ] **Step 1: Write the failing test**

Append to `catalog.service.spec.ts`:

```ts
describe('CatalogService.list — best_seller (dự án 4b)', () => {
  const RANKED = [
    { id: 'c', soldApp: 0, soldExternal: 15 },
    { id: 'a', soldApp: 5, soldExternal: 10 },
    { id: 'b', soldApp: 20, soldExternal: 0 },
    { id: 'd', soldApp: 0, soldExternal: 0 },
  ];
  function setup(pageRows: ReturnType<typeof card>[]) {
    const findMany = jest.fn().mockResolvedValueOnce(RANKED).mockResolvedValueOnce(pageRows);
    const prisma = { product: { findMany, count: jest.fn() }, $transaction: jest.fn() } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), findMany, prisma };
  }

  it('xếp theo soldApp + soldExternal giảm dần, hoà thì id tăng dần; giữ thứ tự dù DB trả lộn xộn', async () => {
    const { svc, findMany } = setup([card('a'), card('b')]);
    const r = await svc.list({ page: 1, limit: 2, sort: 'best_seller' });
    expect(r.data.map((c) => c.id)).toEqual(['b', 'a']);
    expect(r.meta).toEqual({ page: 1, limit: 2, total: 4 });
    expect(findMany.mock.calls[0][0]).toEqual({
      where: { isActive: true, approvalStatus: 'APPROVED' },
      select: { id: true, soldApp: true, soldExternal: true },
    });
    expect(findMany.mock.calls[1][0]).toEqual({
      where: { AND: [{ isActive: true, approvalStatus: 'APPROVED' }, { id: { in: ['b', 'a'] } }] },
      include: { variations: { where: { isActive: true } } },
    });
  });

  it('trang 2 nối tiếp đúng thứ tự, không trùng trang 1', async () => {
    const { svc, findMany } = setup([card('d'), card('c')]);
    const r = await svc.list({ page: 2, limit: 2, sort: 'best_seller' });
    expect(r.data.map((c) => c.id)).toEqual(['c', 'd']);
    expect(findMany.mock.calls[1][0].where.AND[1]).toEqual({ id: { in: ['c', 'd'] } });
  });

  it('trang vượt quá → data rỗng, total vẫn đúng, không gọi truy vấn thứ 2', async () => {
    const { svc, findMany } = setup([]);
    const r = await svc.list({ page: 9, limit: 2, sort: 'best_seller' });
    expect(r).toEqual({ data: [], meta: { page: 9, limit: 2, total: 4 } });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('giữ bộ lọc ở cả hai bước (vd brand + inStock); không dùng $transaction/count', async () => {
    const { svc, findMany, prisma } = setup([card('b')]);
    await svc.list({ page: 1, limit: 1, sort: 'best_seller', brand: 'Tubu', inStock: true });
    const where = { isActive: true, approvalStatus: 'APPROVED', brand: 'Tubu', variations: { some: { isActive: true, stock: { gt: 0 } } } };
    expect(findMany.mock.calls[0][0].where).toEqual(where);
    expect(findMany.mock.calls[1][0].where.AND[0]).toEqual(where);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('SP bị ẩn giữa hai bước → bỏ khỏi trang, không lỗi', async () => {
    const { svc } = setup([card('b')]); // 'a' vừa bị tắt
    const r = await svc.list({ page: 1, limit: 2, sort: 'best_seller' });
    expect(r.data.map((c) => c.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest catalog.service`
Expected: FAIL — `best_seller` falls through to the `isFeatured` path (`$transaction` mock returns undefined).

- [ ] **Step 3: Implement**

In `list`, right after `const where = await this.listWhere(query);` add:

```ts
    if (sort === 'best_seller') return this.listBestSellers(where, page, limit);
```

Add below `list`:

```ts
  /**
   * "Bán chạy" = soldApp + soldExternal giảm dần, hoà thì id tăng dần (spec 5b.2, plan 4b Ruling 2).
   * Prisma không orderBy được theo biểu thức → xếp hạng ở đây: lấy 3 cột nhỏ của MỌI SP khớp, sắp,
   * cắt trang, rồi lấy thẻ đầy đủ đúng các id của trang (giữ thứ tự). total = số SP khớp.
   * Đủ nhanh với catalog hiện tại (vài trăm SP). Vượt ~5k SP → chuyển sang cột soldTotal có index.
   */
  private async listBestSellers(where: Prisma.ProductWhereInput, page: number, limit: number) {
    const ranked = await this.prisma.product.findMany({
      where,
      select: { id: true, soldApp: true, soldExternal: true },
    });
    ranked.sort((x, y) => {
      const diff = y.soldApp + y.soldExternal - (x.soldApp + x.soldExternal);
      if (diff !== 0) return diff;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
    const { skip, take } = skipTake(page, limit);
    const pageIds = ranked.slice(skip, skip + take).map((r) => r.id);
    if (pageIds.length === 0) return paginated([], page, limit, ranked.length);
    const rows = await this.prisma.product.findMany({
      where: { AND: [where, { id: { in: pageIds } }] },
      include: { variations: { where: { isActive: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => this.toCard(p));
    return paginated(items, page, limit, ranked.length);
  }
```

- [ ] **Step 4: Run tests and types**

Run: `cd apps/api && npx jest catalog` → PASS.
Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog/catalog.service.ts apps/api/src/modules/catalog/catalog.service.spec.ts
git commit -m "feat(api): real best_seller ordering by soldApp + soldExternal with a deterministic tiebreaker (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: API — `productCount` on `GET /categories`

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`categories`, `categoriesCache` type)
- Test: `apps/api/src/modules/catalog/catalog.service.spec.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type CategoryWithCount = Category & { productCount: number }` (in `catalog.service.ts`); `categories(): Promise<CategoryWithCount[]>` — every category row as before plus `productCount` = number of active + APPROVED products whose `categoryIds` contains the id (each product counted once per category).

- [ ] **Step 1: Write the failing test**

Append to `catalog.service.spec.ts`:

```ts
describe('CatalogService.categories — productCount (dự án 4b)', () => {
  const CAT = (id: string, sortOrder: number) => ({ id, parentId: null, name: id, slug: id, image: null, sortOrder });

  function setup() {
    const categoryFindMany = jest.fn().mockResolvedValue([CAT('cat-a', 1), CAT('cat-b', 2)]);
    const productFindMany = jest.fn().mockResolvedValue([
      { categoryIds: ['cat-a'] },
      { categoryIds: ['cat-a', 'cat-a'] }, // trùng id trong 1 SP → vẫn đếm 1
      { categoryIds: [] },
    ]);
    const prisma = { category: { findMany: categoryFindMany }, product: { findMany: productFindMany } } as unknown as PrismaService;
    return { svc: new CatalogService(prisma), categoryFindMany, productFindMany };
  }

  it('mỗi danh mục kèm số SP đang bán (active + APPROVED); danh mục trống → 0; giữ thứ tự sortOrder', async () => {
    const { svc, productFindMany } = setup();
    await expect(svc.categories()).resolves.toEqual([
      { ...CAT('cat-a', 1), productCount: 2 },
      { ...CAT('cat-b', 2), productCount: 0 },
    ]);
    expect(productFindMany).toHaveBeenCalledWith({
      where: { isActive: true, approvalStatus: 'APPROVED' },
      select: { categoryIds: true },
    });
  });

  it('cache 60s vẫn áp dụng cho cả hai truy vấn', async () => {
    const { svc, categoryFindMany, productFindMany } = setup();
    await svc.categories();
    await svc.categories();
    expect(categoryFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest catalog.service`
Expected: FAIL — no `productCount`; `product.findMany` not called.

- [ ] **Step 3: Implement**

In `catalog.service.ts` change the Prisma import to `import type { Category, Prisma } from '@prisma/client';`, add above `@Injectable()`:

```ts
/** Danh mục kèm số SP đang bán — miniapp chỉ hiện danh mục có hàng (plan 4b Ruling 4). */
export type CategoryWithCount = Category & { productCount: number };
```

change the cache field to `private categoriesCache: { value: CategoryWithCount[]; expiresAt: number } | null = null;` and replace `categories()` with:

```ts
  /**
   * Đồng bộ Pancake KHÔNG ghi `categoryIds` (chỉ SP seed/đối tác có) → danh mục seed có thể trống
   * trên prod. Trả thêm `productCount` (field cộng thêm, client cũ bỏ qua) để miniapp ẩn danh mục
   * trống và lùi về 4 phân khúc khi không còn danh mục nào có hàng.
   */
  async categories(): Promise<CategoryWithCount[]> {
    if (this.categoriesCache && this.categoriesCache.expiresAt > Date.now()) {
      return this.categoriesCache.value;
    }
    const [rows, products] = await Promise.all([
      this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.product.findMany({
        where: { isActive: true, approvalStatus: 'APPROVED' },
        select: { categoryIds: true },
      }),
    ]);
    const counts = new Map<string, number>();
    for (const p of products) {
      for (const id of new Set(p.categoryIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const value = rows.map((c) => ({ ...c, productCount: counts.get(c.id) ?? 0 }));
    this.categoriesCache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
  }
```

- [ ] **Step 4: Run tests and types**

Run: `cd apps/api && npx jest catalog` → PASS.
Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/catalog/catalog.service.ts apps/api/src/modules/catalog/catalog.service.spec.ts
git commit -m "feat(api): productCount on GET /categories so empty categories can be hidden (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: API — real-Postgres test for folding, filters, best_seller paging, categories

**Files:**
- Create: `apps/api/test/integration-race/buy-flow-4b.race-spec.ts`

**Interfaces:**
- Consumes: `CatalogService` (Tasks 3–6), `VN_FOLD_FROM`, `VN_FOLD_TO`, `foldVietnamese` (Task 1), `randCode`, `warmPool` (`test/integration-race/helpers.ts`), `ProductQuery` (Task 2).
- Produces: nothing for later tasks (verification only).

- [ ] **Step 1: Write the test**

`apps/api/test/integration-race/buy-flow-4b.race-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import type { ProductQuery } from '../../src/modules/catalog/dto/product-query.dto';
import { VN_FOLD_FROM, VN_FOLD_TO, foldVietnamese } from '../../src/modules/catalog/search-text';
import { randCode, warmPool } from './helpers';

/**
 * Dự án 4b trên Postgres THẬT: tìm không dấu bằng translate() (khớp hàm TS kể cả chữ HOA dưới
 * collation của DB và tên dạng NFD), bộ lọc giá/tồn/đánh giá, "Bán chạy" phân trang ổn định khi hoà,
 * productCount của danh mục. DB dùng chung giữa các lần chạy → mỗi test dùng brand/tag riêng.
 */
describe('Buy-flow 4b — tìm kiếm & bộ lọc catalog (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let catalog: CatalogService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [CatalogService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    catalog = moduleRef.get(CatalogService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const newBrand = () => `IT4B ${randCode(6)}`;

  async function createProduct(
    brand: string,
    over: {
      name: string; id?: string; basePrice?: number; salePrice?: number | null; stock?: number; variationActive?: boolean;
      ratingAvg?: number; soldApp?: number; soldExternal?: number; categoryIds?: string[]; isActive?: boolean;
    },
  ) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        ...(over.id ? { id: over.id } : {}),
        pancakeId: `it4b-p-${tag}`,
        brand,
        slug: `it4b-${tag.toLowerCase()}`,
        name: over.name,
        description: 'IT',
        basePrice: over.basePrice ?? 100_000,
        salePrice: over.salePrice ?? null,
        ratingAvg: over.ratingAvg ?? 0,
        soldApp: over.soldApp ?? 0,
        soldExternal: over.soldExternal ?? 0,
        categoryIds: over.categoryIds ?? [],
        isActive: over.isActive ?? true,
        approvalStatus: 'APPROVED',
      },
    });
    await prisma.variation.create({
      data: {
        pancakeId: `it4b-v-${tag}`,
        productId: product.id,
        sku: `IT4B-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: over.basePrice ?? 100_000,
        stock: over.stock ?? 5,
        isActive: over.variationActive ?? true,
      },
    });
    return product;
  }

  const listIds = async (brand: string, q: Partial<ProductQuery>) =>
    (await catalog.list({ page: 1, limit: 50, brand, ...q })).data.map((c) => c.id).sort();

  it('translate() + lower() của DB gấp dấu GIỐNG HỆT foldVietnamese (chữ HOA, NFD, khoảng trắng thừa)', async () => {
    const samples = [
      'Nước Rửa Chén', 'NƯỚC RỬA CHÉN ĐẬU', 'Xà  phòng   thảo mộc', `${'Nước'.normalize('NFD')} ${'rửa'.normalize('NFD')}`,
      'Kem chống nắng Rau Má 50ml', 'Ổi Ửng Ỹ Ỵ ữ Đà Lạt',
    ];
    for (const s of samples) {
      const [row] = await prisma.$queryRaw<{ f: string }[]>`
        SELECT btrim(regexp_replace(lower(translate(${s}, ${VN_FOLD_FROM}, ${VN_FOLD_TO})), '[[:space:]]+', ' ', 'g')) AS f`;
      expect(row!.f).toBe(foldVietnamese(s));
    }
  });

  it('GET /products?q=: không dấu, chữ hoa, tên NFD đều khớp; % và _ không thành ký tự đại diện', async () => {
    const brand = newBrand();
    const tag = randCode(6).toLowerCase();
    const nrc = await createProduct(brand, { name: `Nước Rửa Chén Hương Chanh ${tag}` });
    const nfd = await createProduct(brand, { name: `${'Nước rửa'.normalize('NFD')} bình sữa ${tag}` });
    await createProduct(brand, { name: `Xà phòng ${tag}` });

    expect(await listIds(brand, { q: 'nuoc rua' })).toEqual([nrc.id, nfd.id].sort());
    expect(await listIds(brand, { q: 'NƯỚC RỬA chén' })).toEqual([nrc.id]);
    expect(await listIds(brand, { q: 'nuoc   rua   chen' })).toEqual([nrc.id]);
    expect(await listIds(brand, { q: '%' })).toEqual([]);
    expect(await listIds(brand, { q: '_' })).toEqual([]);
  });

  it('GET /search/suggest dùng cùng cách khớp không dấu', async () => {
    const brand = newBrand();
    const tag = randCode(6).toLowerCase();
    const p = await createProduct(brand, { name: `Dầu Gội Bưởi ${tag}` });
    const slugs = (await catalog.suggest(`dau goi buoi ${tag}`)).map((s) => s.slug);
    expect(slugs).toEqual([p.slug]);
  });

  it('bộ lọc: giá ĐANG BÁN, chỉ còn hàng (phân loại đang bán), từ 4★; total khớp', async () => {
    const brand = newBrand();
    const onSale = await createProduct(brand, { name: 'IT sale', basePrice: 300_000, salePrice: 150_000, ratingAvg: 4.5 });
    const cheap = await createProduct(brand, { name: 'IT cheap', basePrice: 120_000, ratingAvg: 3.9 });
    const pricey = await createProduct(brand, { name: 'IT pricey', basePrice: 600_000, ratingAvg: 4.0 });
    const soldOut = await createProduct(brand, { name: 'IT sold out', basePrice: 150_000, stock: 0, ratingAvg: 5 });
    const hiddenVar = await createProduct(brand, { name: 'IT hidden variation', basePrice: 150_000, stock: 9, variationActive: false });

    expect(await listIds(brand, { minPrice: 100_000, maxPrice: 200_000 })).toEqual([onSale.id, cheap.id, soldOut.id, hiddenVar.id].sort());
    expect(await listIds(brand, { minPrice: 100_000, maxPrice: 200_000, inStock: true })).toEqual([onSale.id, cheap.id].sort());
    expect(await listIds(brand, { minRating: 4 })).toEqual([onSale.id, pricey.id, soldOut.id].sort());

    const r = await catalog.list({ page: 1, limit: 1, brand, inStock: true });
    expect(r.data).toHaveLength(1);
    expect(r.meta.total).toBe(3); // onSale, cheap, pricey
  });

  it('best_seller: soldApp + soldExternal giảm dần, hoà thì id tăng dần, qua 2 trang không trùng/sót', async () => {
    const brand = newBrand();
    const prefix = `it4b-${randCode(8).toLowerCase()}`;
    const id = (s: string) => `${prefix}-${s}`;
    await createProduct(brand, { id: id('a'), name: 'IT a', soldApp: 5, soldExternal: 10 });
    await createProduct(brand, { id: id('b'), name: 'IT b', soldApp: 20 });
    await createProduct(brand, { id: id('c'), name: 'IT c', soldExternal: 15 });
    await createProduct(brand, { id: id('d'), name: 'IT d' });

    const p1 = await catalog.list({ page: 1, limit: 2, brand, sort: 'best_seller' });
    const p2 = await catalog.list({ page: 2, limit: 2, brand, sort: 'best_seller' });
    expect(p1.data.map((c) => c.id)).toEqual([id('b'), id('a')]);
    expect(p2.data.map((c) => c.id)).toEqual([id('c'), id('d')]);
    expect(p1.meta.total).toBe(4);
    expect(p1.data[0]!.sold).toBe(20);
  });

  it('sắp mặc định với nhiều SP hoà nhau: 3 trang phủ đúng mỗi SP một lần', async () => {
    const brand = newBrand();
    for (let i = 0; i < 5; i++) await createProduct(brand, { name: `IT tie ${i}` });
    const pages = await Promise.all([1, 2, 3].map((page) => catalog.list({ page, limit: 2, brand })));
    const ids = pages.flatMap((p) => p.data.map((c) => c.id));
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('GET /categories: productCount chỉ đếm SP đang bán của đúng danh mục', async () => {
    const catId = `it4b-cat-${randCode(8).toLowerCase()}`;
    await prisma.category.create({ data: { id: catId, name: 'IT Danh mục', slug: catId, sortOrder: 999 } });
    const brand = newBrand();
    await createProduct(brand, { name: 'IT c1', categoryIds: [catId] });
    await createProduct(brand, { name: 'IT c2', categoryIds: [catId] });
    await createProduct(brand, { name: 'IT c3 đã tắt', categoryIds: [catId], isActive: false });
    const fresh = new CatalogService(prisma); // cache 60s theo instance — instance mới để đọc số thật
    const cats = await fresh.categories();
    expect(cats.find((c) => c.id === catId)?.productCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run it (Docker DB up: `pnpm dev:infra`)**

Run: `cd apps/api && DATABASE_URL="$IT_DATABASE_URL" npx jest -c test/integration-race/jest.config.js --runInBand buy-flow-4b`
Expected: PASS 7/7. If the first test fails, the database's `lower()`/`regexp_replace` disagrees with `foldVietnamese` — fix `search-text.ts` (both sides use the same map), never the assertion. If `ESCAPE '!'` raises a syntax error, the template still binds it as a parameter — make sure the SQL text in `textWhere` is the literal `ESCAPE '!'` (Task 4).

- [ ] **Step 3: Run the pre-existing race specs (regression)**

Run: `cd apps/api && DATABASE_URL="$IT_DATABASE_URL" npx jest -c test/integration-race/jest.config.js --runInBand`
Expected: PASS except the known intermittent `order-cancel.race-spec.ts` case (b) P2028 already recorded in the follow-up ledger (re-run once to confirm it is the known flake).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/integration-race/buy-flow-4b.race-spec.ts
git commit -m "test(api): real-Postgres checks for unaccented search, catalog filters, best_seller paging and category counts (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Miniapp — catalog client (`fetchCatalog` with old-API fallback), categories, events, folding, copy

**Files:**
- Modify: `apps/miniapp/src/services/shop-api.ts` (import `isAxiosError`; add types + functions after `suggestProducts`)
- Modify: `apps/miniapp/src/services/shop-api.spec.ts` (append a describe block)
- Create: `apps/miniapp/src/services/discovery-events.ts`, `apps/miniapp/src/services/discovery-events.spec.ts`
- Create: `apps/miniapp/src/utils/vn-fold.ts`, `apps/miniapp/src/utils/vn-fold.spec.ts`
- Modify: `apps/miniapp/src/i18n/vi.ts` (replace the `home` and `browse` blocks)

**Interfaces:**
- Consumes: `fetchProducts`, `PageResponse`, `ProductCard` (existing, `shop-api.ts`).
- Produces:
  - `export type CatalogSort = 'best_seller' | 'newest' | 'price_asc' | 'price_desc'`
  - `export interface CatalogQuery { page: number; limit: number; q?: string; sort?: CatalogSort; brand?: string; category?: string; segment?: string; minPrice?: number; maxPrice?: number; inStock?: boolean; minRating?: number }`
  - `export interface CatalogPage extends PageResponse<ProductCard> { filtersIgnored: boolean }`
  - `export function catalogParams(query: CatalogQuery): Record<string, string | number>`
  - `export async function fetchCatalog(query: CatalogQuery): Promise<CatalogPage>`
  - `export interface CategoryDTO { id: string; parentId: string | null; name: string; slug: string; image: string | null; sortOrder: number; productCount?: number }`; `export const fetchCategories: () => Promise<CategoryDTO[]>`
  - `discovery-events.ts`: `type FilterType = 'price' | 'in_stock' | 'brand' | 'rating'`, `type SearchClickSource = 'results' | 'suggest'`, `trackSearchPerformed({ q, resultsCount })`, `trackSearchResultClicked({ q, position, source, slug })`, `trackFilterApplied(type)`
  - `vn-fold.ts`: `foldVietnamese(input: string): string` (same table as the API), `includesFolded(haystack: string, needle: string): boolean`
  - `vi.home.*` and `vi.browse.*` keys listed in Step 3 (used by Tasks 12–20).

- [ ] **Step 1: Write the failing tests**

Append to `apps/miniapp/src/services/shop-api.spec.ts` (extend the import list with `catalogParams, fetchCatalog, fetchCategories`):

```ts
describe('shop-api — buy-flow 4b', () => {
  beforeEach(() => vi.clearAllMocks());
  const PAGE = { data: [], meta: { page: 1, limit: 30, total: 0 } };
  const badRequest = () => Object.assign(new Error('400'), { isAxiosError: true, response: { status: 400 } });

  it('catalogParams: chỉ gửi tham số có giá trị; q được trim; inStock=true; không gửi inStock=false', () => {
    expect(catalogParams({ page: 1, limit: 30 })).toEqual({ page: 1, limit: 30 });
    expect(catalogParams({ page: 2, limit: 30, q: '  nước ', sort: 'best_seller', brand: 'Tubu', category: 'cat-a', segment: 'eco', minPrice: 0, maxPrice: 200000, inStock: true, minRating: 4 })).toEqual({
      page: 2, limit: 30, q: 'nước', sort: 'best_seller', brand: 'Tubu', category: 'cat-a', segment: 'eco', minPrice: 0, maxPrice: 200000, inStock: 'true', minRating: 4,
    });
    expect(catalogParams({ page: 1, limit: 30, q: '   ', inStock: false })).toEqual({ page: 1, limit: 30 });
  });

  it('fetchCatalog: thành công → filtersIgnored=false', async () => {
    get.mockResolvedValue({ data: PAGE });
    await expect(fetchCatalog({ page: 1, limit: 30, minPrice: 100000 })).resolves.toEqual({ ...PAGE, filtersIgnored: false });
    expect(get).toHaveBeenCalledWith('/products', { params: { page: 1, limit: 30, minPrice: 100000 } });
  });

  it('fetchCatalog: API cũ trả 400 vì tham số mới → gọi lại KHÔNG có minPrice/maxPrice/inStock/minRating, filtersIgnored=true', async () => {
    get.mockRejectedValueOnce(badRequest()).mockResolvedValueOnce({ data: PAGE });
    const r = await fetchCatalog({ page: 1, limit: 30, q: 'nuoc', sort: 'best_seller', minPrice: 1, maxPrice: 2, inStock: true, minRating: 4 });
    expect(r.filtersIgnored).toBe(true);
    expect(get).toHaveBeenLastCalledWith('/products', { params: { page: 1, limit: 30, q: 'nuoc', sort: 'best_seller' } });
  });

  it('fetchCatalog: 400 khi KHÔNG có tham số mới → ném lỗi thật (không nuốt)', async () => {
    get.mockRejectedValueOnce(badRequest());
    await expect(fetchCatalog({ page: 1, limit: 30, q: 'nuoc' })).rejects.toThrow('400');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fetchCatalog: 500 khi có tham số mới → ném lỗi (chỉ 400 mới lùi)', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('500'), { isAxiosError: true, response: { status: 500 } }));
    await expect(fetchCatalog({ page: 1, limit: 30, inStock: true })).rejects.toThrow('500');
  });

  it('fetchCategories gọi GET /categories', async () => {
    get.mockResolvedValue({ data: [{ id: 'cat-a', parentId: null, name: 'A', slug: 'a', image: null, sortOrder: 1, productCount: 3 }] });
    await expect(fetchCategories()).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/categories');
  });
});
```

`apps/miniapp/src/services/discovery-events.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));

import { trackEvent } from './analytics';
import { trackFilterApplied, trackSearchPerformed, trackSearchResultClicked } from './discovery-events';

const track = trackEvent as unknown as ReturnType<typeof vi.fn>;

describe('discovery-events (spec §3.4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('search_performed giữ đúng props cũ { q, resultsCount }', () => {
    trackSearchPerformed({ q: 'nuoc', resultsCount: 3 });
    expect(track).toHaveBeenCalledWith('search_performed', 'miniapp', { q: 'nuoc', resultsCount: 3 });
  });

  it('search_result_clicked { q, position, source, slug }', () => {
    trackSearchResultClicked({ q: 'nuoc', position: 2, source: 'results', slug: 'nrc' });
    expect(track).toHaveBeenCalledWith('search_result_clicked', 'miniapp', { q: 'nuoc', position: 2, source: 'results', slug: 'nrc' });
  });

  it('filter_applied { type }', () => {
    trackFilterApplied('in_stock');
    expect(track).toHaveBeenCalledWith('filter_applied', 'miniapp', { type: 'in_stock' });
  });
});
```

`apps/miniapp/src/utils/vn-fold.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { foldVietnamese, includesFolded } from './vn-fold';

describe('vn-fold (cùng bảng với apps/api/src/modules/catalog/search-text.ts)', () => {
  it('bỏ dấu, chữ HOA, NFD, khoảng trắng thừa', () => {
    expect(foldVietnamese('  NƯỚC   Rửa Chén ')).toBe('nuoc rua chen');
    expect(foldVietnamese('Đậu'.normalize('NFD'))).toBe('dau');
  });

  it('includesFolded khớp không dấu; needle rỗng → false', () => {
    expect(includesFolded('Cho mẹ & bé', 'me & be')).toBe(true);
    expect(includesFolded('Nhà bếp xanh', 'BEP')).toBe(true);
    expect(includesFolded('Sống xanh', 'nha')).toBe(false);
    expect(includesFolded('Sống xanh', '  ')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/services/shop-api.spec.ts src/services/discovery-events.spec.ts src/utils/vn-fold.spec.ts`
Expected: FAIL — `catalogParams`/`fetchCatalog`/`fetchCategories` not exported; modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/services/shop-api.ts` — add at the top `import { isAxiosError } from 'axios';` and, directly after `suggestProducts`:

```ts
// ── Catalog có bộ lọc (dự án 4b) ──
export type CatalogSort = 'best_seller' | 'newest' | 'price_asc' | 'price_desc';
export interface CatalogQuery {
  page: number;
  limit: number;
  q?: string;
  sort?: CatalogSort;
  /** Danh sách thương hiệu, nối bằng dấu phẩy (như `?brand=` từ Trang chủ). */
  brand?: string;
  category?: string;
  segment?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  minRating?: number;
}
export interface CatalogPage extends PageResponse<ProductCard> {
  /** API cũ (trước 4b) từ chối bộ lọc mới → đã tải lại KHÔNG kèm bộ lọc; UI báo nhẹ. */
  filtersIgnored: boolean;
}

/** Tham số mà API trước 4b không biết — ValidationPipe `forbidNonWhitelisted` trả 400 nếu gửi. */
const EXTENDED_CATALOG_PARAMS = ['minPrice', 'maxPrice', 'inStock', 'minRating'] as const;

/** Chỉ gửi tham số có giá trị — API cũ không bị 400 vì những bộ lọc khách không dùng. */
export function catalogParams(query: CatalogQuery): Record<string, string | number> {
  const params: Record<string, string | number> = { page: query.page, limit: query.limit };
  const q = query.q?.trim();
  if (q) params.q = q;
  if (query.sort) params.sort = query.sort;
  if (query.brand) params.brand = query.brand;
  if (query.category) params.category = query.category;
  if (query.segment) params.segment = query.segment;
  if (query.minPrice != null) params.minPrice = query.minPrice;
  if (query.maxPrice != null) params.maxPrice = query.maxPrice;
  if (query.inStock) params.inStock = 'true';
  if (query.minRating != null) params.minRating = query.minRating;
  return params;
}

/**
 * `GET /products` có bộ lọc. Lùi êm khi miniapp mới gặp API cũ (deploy sai thứ tự): 400 KHI có
 * tham số mới → tải lại không kèm chúng, đánh dấu `filtersIgnored`. Lỗi khác (hoặc 400 mà không có
 * tham số mới) vẫn ném ra để trang hiện ErrorState như thường.
 */
export async function fetchCatalog(query: CatalogQuery): Promise<CatalogPage> {
  const params = catalogParams(query);
  const extended = EXTENDED_CATALOG_PARAMS.some((k) => k in params);
  try {
    return { ...(await fetchProducts(params)), filtersIgnored: false };
  } catch (err) {
    if (!extended || !isAxiosError(err) || err.response?.status !== 400) throw err;
    const legacy = { ...params };
    for (const k of EXTENDED_CATALOG_PARAMS) delete legacy[k];
    return { ...(await fetchProducts(legacy)), filtersIgnored: true };
  }
}

export interface CategoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  image: string | null;
  sortOrder: number;
  /** Số SP đang bán (API từ 4b). Thiếu = API cũ → miniapp dùng 4 phân khúc. */
  productCount?: number;
}
export const fetchCategories = () => api.get<CategoryDTO[]>('/categories').then((r) => r.data);
```

`apps/miniapp/src/services/discovery-events.ts`:

```ts
import { trackEvent } from './analytics';

/** Sự kiện khám phá & tìm kiếm (spec §3.4). Tên event tự do ở server (@IsString) — không cần đổi DTO. */
export type FilterType = 'price' | 'in_stock' | 'brand' | 'rating';
export type SearchClickSource = 'results' | 'suggest';

export function trackSearchPerformed(p: { q: string; resultsCount: number }): void {
  trackEvent('search_performed', 'miniapp', { ...p });
}

export function trackSearchResultClicked(p: { q: string; position: number; source: SearchClickSource; slug: string }): void {
  trackEvent('search_result_clicked', 'miniapp', { ...p });
}

export function trackFilterApplied(type: FilterType): void {
  trackEvent('filter_applied', 'miniapp', { type });
}
```

`apps/miniapp/src/utils/vn-fold.ts`:

```ts
/**
 * Gấp chữ tiếng Việt để so khớp không dấu ở client (gợi ý danh mục, từ khoá gần đây).
 * CÙNG bảng với apps/api/src/modules/catalog/search-text.ts — đổi một bên phải đổi bên kia.
 */
const LETTER_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'àáạảãâầấậẩẫăằắặẳẵ'],
  ['e', 'èéẹẻẽêềếệểễ'],
  ['i', 'ìíịỉĩ'],
  ['o', 'òóọỏõôồốộổỗơờớợởỡ'],
  ['u', 'ùúụủũưừứựửữ'],
  ['y', 'ỳýỵỷỹ'],
  ['d', 'đ'],
];
const COMBINING = new Set('̛̣̀́̃̉̂̆');
const FOLD = new Map<string, string>();
for (const [base, chars] of LETTER_GROUPS) {
  for (const ch of chars + chars.toUpperCase()) FOLD.set(ch, base);
}

export function foldVietnamese(input: string): string {
  let out = '';
  for (const ch of input) {
    if (COMBINING.has(ch)) continue;
    out += FOLD.get(ch) ?? ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function includesFolded(haystack: string, needle: string): boolean {
  const n = foldVietnamese(needle);
  return n.length > 0 && foldVietnamese(haystack).includes(n);
}
```

`apps/miniapp/src/i18n/vi.ts` — replace the whole `home: { ... },` block with:

```ts
  home: {
    tagline: 'Sống xanh An Lành',
    greeting: (name: string) => `Chào ${name} 🌿`,
    pointsChip: (n: number) => `${n} điểm Xanh`,
    searchPlaceholder: 'Bạn đang tìm gì hôm nay?',
    featured: 'Tubu chọn cho bạn',
    forYou: 'Dành cho bạn',
    newArrivals: 'Mới về vườn',
    bestSellers: 'Bán chạy',
    brandsTitle: 'Thương hiệu Việt',
    allBrands: 'Tất cả',
    notifications: 'Thông báo',
    unreadBadge: (n: number) => `${n} thông báo chưa đọc`,
    heroKicker: 'Sống xanh an lành',
    heroTitle: 'Thiên nhiên Việt cho cả nhà',
    // A2-33: "Khám phá vườn" dễ nhầm với game Vườn Xanh — nút này mở ô tìm sản phẩm.
    heroCta: 'Tìm sản phẩm',
    aiCard: 'Trợ lý AI 24/7',
    aiCardLabel: 'Hỏi trợ lý AI 24/7',
    groupBuyCard: 'Mua chung giá tốt',
    brandStoryTitle: 'Hành trình nguyên liệu',
    brandStoryBody: 'Khám phá 6 vùng đất làm nên sản phẩm Tubu',
    strip: {
      title: 'Đơn của bạn',
      shipping: (code: string) => `Đơn ${code} đang giao`,
      shippingHint: 'Chạm để theo dõi đơn',
      nextSubscription: (date: string) => `Kỳ định kỳ kế tiếp: ${date}`,
    },
  },
```

and the whole `browse: { ... },` block with:

```ts
  browse: {
    title: 'Khám phá',
    searchPlaceholder: 'Tìm sản phẩm...',
    searchLabel: 'Tìm sản phẩm',
    clearSearch: 'Xoá từ khoá',
    noResultHeading: (q: string) => `Không tìm thấy "${q}"`,
    noResultBody: 'Thử từ khóa khác hoặc bỏ bớt bộ lọc',
    noResultFiltered: 'Chưa có sản phẩm khớp bộ lọc',
    clearAll: 'Xoá tìm kiếm & bộ lọc',
    emptyHeading: 'Chưa có sản phẩm',
    emptyBody: 'Tubu đang chuẩn bị thêm sản phẩm mới',
    loadMore: 'Xem thêm',
    categories: 'Danh mục',
    recentlyViewed: 'Đã xem gần đây',
    segments: {
      mom_baby: 'Cho mẹ & bé',
      home_clean: 'Nhà bếp xanh',
      skincare: 'Chăm sóc cá nhân',
      eco: 'Sống xanh',
    },
    sortGroup: 'Sắp xếp',
    sort: {
      suggested: 'Gợi ý',
      best_seller: 'Bán chạy',
      newest: 'Mới nhất',
      price_asc: 'Giá tăng',
      price_desc: 'Giá giảm',
    },
    resultCount: (n: number) => `${n.toLocaleString('vi-VN')} sản phẩm`,
    filterButton: 'Bộ lọc',
    filterButtonCount: (n: number) => `Bộ lọc (${n})`,
    activeFilters: 'Đang lọc',
    removeFilter: (label: string) => `Bỏ lọc ${label}`,
    filtersIgnored: 'Bộ lọc nâng cao chưa dùng được lúc này — đang hiện mọi kết quả.',
    inStockChip: 'Còn hàng',
    rating4Chip: 'Từ 4★',
    price: {
      under: (max: string) => `Dưới ${max}`,
      between: (min: string, max: string) => `${min}–${max}`,
      from: (min: string) => `Từ ${min}`,
    },
    filter: {
      title: 'Bộ lọc',
      price: 'Khoảng giá',
      availability: 'Tình trạng',
      inStock: 'Chỉ hiện còn hàng',
      brand: 'Thương hiệu',
      rating: 'Đánh giá',
      rating4: 'Từ 4★ trở lên',
      reset: 'Xoá bộ lọc',
      apply: (n: number) => `Xem ${n.toLocaleString('vi-VN')} sản phẩm`,
      applyLoading: 'Xem kết quả',
      applyFallback: 'Áp dụng',
    },
    suggest: {
      title: 'Gợi ý tìm kiếm',
      recent: 'Tìm gần đây',
      clearRecent: 'Xoá lịch sử tìm',
      categories: 'Danh mục',
      products: 'Sản phẩm',
      searchFor: (q: string) => `Tìm “${q}”`,
      none: 'Chưa có gợi ý — nhấn Tìm để xem kết quả',
    },
  },
```

(`vi.home.tagline` stays: `product-detail.tsx:273` uses it. Old keys still referenced by the legacy `home.tsx`/`browse.tsx` — `featured`, `forYou`, `newArrivals`, `brandsTitle`, `allBrands`, `searchPlaceholder`, `noResultHeading`, `noResultBody`, `emptyHeading`, `emptyBody` — are all kept, so the build stays green until Tasks 18/20.)

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/services src/utils/vn-fold.spec.ts` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/services/shop-api.ts apps/miniapp/src/services/shop-api.spec.ts apps/miniapp/src/services/discovery-events.ts apps/miniapp/src/services/discovery-events.spec.ts apps/miniapp/src/utils/vn-fold.ts apps/miniapp/src/utils/vn-fold.spec.ts apps/miniapp/src/i18n/vi.ts
git commit -m "feat(miniapp): catalog client with old-API fallback, categories, discovery events and copy (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Miniapp — URL search state (`search-state.ts`) and `useSearchState`

**Files:**
- Create: `apps/miniapp/src/utils/search-state.ts`, `apps/miniapp/src/utils/search-state.spec.ts`
- Create: `apps/miniapp/src/hooks/use-search-state.ts`, `apps/miniapp/src/hooks/use-search-state.spec.tsx`

**Interfaces:**
- Consumes: `CatalogQuery`, `CatalogSort` (Task 8), `FilterType` (Task 8), `formatVndShort` (`utils/format.ts`), `vi.browse` (Task 8).
- Produces (`utils/search-state.ts`):
  - `interface SearchState { q: string; sort?: CatalogSort; category?: string; segment?: string; brands: string[]; minPrice?: number; maxPrice?: number; inStock: boolean; minRating?: number }`
  - `interface FilterDraft { brands: string[]; minPrice?: number; maxPrice?: number; inStock: boolean; minRating?: number }`
  - `EMPTY_SEARCH_STATE: SearchState`, `CLEAR_SEARCH_PATCH: Partial<SearchState>` (everything but `sort`)
  - `CATALOG_SORTS: readonly CatalogSort[]`, `PRICE_RANGES: readonly PriceRange[]` with `interface PriceRange { key: string; min?: number; max?: number }`, `MIN_RATING_OPTION = 4`
  - `parseSearchState(params: URLSearchParams): SearchState`, `serializeSearchState(s: SearchState): URLSearchParams`
  - `toCatalogQuery(s: SearchState, page: number, limit: number): CatalogQuery`
  - `draftFromState(s: SearchState): FilterDraft`, `activeFilterCount(s: SearchState): number`, `isBrowseRoot(s: SearchState): boolean`
  - `changedFilterTypes(before: SearchState, after: FilterDraft): FilterType[]`
  - `priceRangeLabel(min?: number, max?: number): string`
  - `interface ActiveFilterChip { key: string; label: string; patch: Partial<SearchState> }`; `activeFilterChips(s: SearchState, names: { categoryName?: string; segmentName?: string }): ActiveFilterChip[]`
- Produces (`hooks/use-search-state.ts`): `interface UseSearchState { state: SearchState; urlKey: string; focusSearch: boolean; update(patch: Partial<SearchState>): void; consumeFocus(): void }`; `useSearchState(): UseSearchState` (all writes `replace: true`; `urlKey` = canonical serialization, excludes `focus`).

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/utils/search-state.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CLEAR_SEARCH_PATCH, EMPTY_SEARCH_STATE, PRICE_RANGES, activeFilterChips, activeFilterCount, changedFilterTypes,
  draftFromState, isBrowseRoot, parseSearchState, priceRangeLabel, serializeSearchState, toCatalogQuery, type SearchState,
} from './search-state';

const parse = (s: string) => parseSearchState(new URLSearchParams(s));
const FULL: SearchState = {
  q: 'nước rửa', sort: 'best_seller', category: 'cat-a', segment: undefined, brands: ['Tubu', 'Mộc An'],
  minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4,
};

describe('parseSearchState', () => {
  it('URL rỗng → trạng thái gốc', () => {
    expect(parse('')).toEqual(EMPTY_SEARCH_STATE);
  });

  it('đọc đủ tham số; brand là danh sách phẩy (link cũ từ Trang chủ)', () => {
    expect(parse('q=+n%C6%B0%E1%BB%9Bc+r%E1%BB%ADa+&sort=best_seller&category=cat-a&brand=Tubu,M%E1%BB%99c%20An&minPrice=100000&maxPrice=200000&inStock=1&rating=4')).toEqual(FULL);
  });

  it('bỏ qua giá trị rác: sort lạ, giá âm/lẻ/chữ, rating ngoài 1..5, inStock khác "1"', () => {
    expect(parse('sort=cheapest&minPrice=-5&maxPrice=12.5&rating=9&inStock=true')).toEqual(EMPTY_SEARCH_STATE);
    expect(parse('minPrice=abc&brand=,,')).toEqual(EMPTY_SEARCH_STATE);
  });
});

describe('serializeSearchState', () => {
  it('thứ tự cố định, bỏ giá trị mặc định → cùng trạng thái luôn cùng URL', () => {
    expect(serializeSearchState(FULL).toString()).toBe(
      'q=n%C6%B0%E1%BB%9Bc+r%E1%BB%ADa&category=cat-a&brand=Tubu%2CM%E1%BB%99c+An&minPrice=100000&maxPrice=200000&inStock=1&rating=4&sort=best_seller',
    );
    expect(serializeSearchState(EMPTY_SEARCH_STATE).toString()).toBe('');
  });

  it('parse(serialize(x)) === x', () => {
    expect(parseSearchState(serializeSearchState(FULL))).toEqual(FULL);
  });
});

describe('toCatalogQuery', () => {
  it('map sang tham số API; brand nối phẩy; inStock=false bỏ qua', () => {
    expect(toCatalogQuery(FULL, 2, 30)).toEqual({
      page: 2, limit: 30, q: 'nước rửa', sort: 'best_seller', category: 'cat-a', segment: undefined, brand: 'Tubu,Mộc An',
      minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4,
    });
    expect(toCatalogQuery(EMPTY_SEARCH_STATE, 1, 1)).toEqual({ page: 1, limit: 1, q: undefined, sort: undefined, category: undefined, segment: undefined, brand: undefined, minPrice: undefined, maxPrice: undefined, inStock: undefined, minRating: undefined });
  });
});

describe('bộ lọc', () => {
  it('activeFilterCount đếm theo LOẠI (giá 1, còn hàng 1, thương hiệu 1, đánh giá 1)', () => {
    expect(activeFilterCount(FULL)).toBe(4);
    expect(activeFilterCount({ ...EMPTY_SEARCH_STATE, maxPrice: 100000 })).toBe(1);
    expect(activeFilterCount(EMPTY_SEARCH_STATE)).toBe(0);
  });

  it('isBrowseRoot: không q, không danh mục/phân khúc, không bộ lọc (sort không tính)', () => {
    expect(isBrowseRoot({ ...EMPTY_SEARCH_STATE, sort: 'newest' })).toBe(true);
    expect(isBrowseRoot({ ...EMPTY_SEARCH_STATE, segment: 'eco' })).toBe(false);
    expect(isBrowseRoot({ ...EMPTY_SEARCH_STATE, inStock: true })).toBe(false);
  });

  it('changedFilterTypes chỉ liệt kê loại thật sự đổi', () => {
    const draft = { ...draftFromState(FULL), inStock: false, brands: ['Mộc An', 'Tubu'] };
    expect(changedFilterTypes(FULL, draft)).toEqual(['in_stock']); // thứ tự brand khác nhưng cùng tập
    expect(changedFilterTypes(EMPTY_SEARCH_STATE, draftFromState(FULL))).toEqual(['price', 'in_stock', 'brand', 'rating']);
  });

  it('CLEAR_SEARCH_PATCH xoá mọi thứ trừ sort', () => {
    expect({ ...FULL, ...CLEAR_SEARCH_PATCH }).toEqual({ ...EMPTY_SEARCH_STATE, sort: 'best_seller' });
  });

  it('priceRangeLabel theo các mốc', () => {
    expect(PRICE_RANGES.map((r) => priceRangeLabel(r.min, r.max))).toEqual(['Dưới 100k', '100k–200k', '200k–500k', 'Từ 500k']);
  });

  it('activeFilterChips: mỗi chip một patch gỡ đúng bộ lọc đó', () => {
    const chips = activeFilterChips({ ...FULL, category: undefined, segment: 'eco' }, { segmentName: 'Sống xanh' });
    expect(chips.map((c) => c.label)).toEqual(['Sống xanh', 'Tubu', 'Mộc An', '100k–200k', 'Còn hàng', 'Từ 4★']);
    expect(chips.find((c) => c.label === 'Tubu')!.patch).toEqual({ brands: ['Mộc An'] });
    expect(chips.find((c) => c.label === '100k–200k')!.patch).toEqual({ minPrice: undefined, maxPrice: undefined });
    expect(chips[0]!.patch).toEqual({ segment: undefined });
  });

  it('activeFilterChips: danh mục chưa tải tên → không hiện id thô', () => {
    expect(activeFilterChips({ ...EMPTY_SEARCH_STATE, category: 'cat-a' }, {})).toEqual([]);
  });
});
```

`apps/miniapp/src/hooks/use-search-state.spec.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { EMPTY_SEARCH_STATE } from '../utils/search-state';
import { useSearchState, type UseSearchState } from './use-search-state';

let hook: UseSearchState;
function Probe() {
  hook = useSearchState();
  const loc = useLocation();
  const nav = useNavigationType();
  return <div data-testid="loc" data-nav={nav}>{loc.pathname + loc.search}</div>;
}
const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><Probe /></MemoryRouter>);
const loc = () => screen.getByTestId('loc');

describe('useSearchState', () => {
  it('đọc trạng thái từ URL, kể cả link cũ ?brand= / ?segment= và ?focus=search từ Trang chủ', () => {
    renderAt('/browse?brand=Tubu,M%E1%BB%99c%20An&segment=mom_baby&focus=search');
    expect(hook.state).toEqual({ ...EMPTY_SEARCH_STATE, brands: ['Tubu', 'Mộc An'], segment: 'mom_baby' });
    expect(hook.focusSearch).toBe(true);
    expect(hook.urlKey).toBe('segment=mom_baby&brand=Tubu%2CM%E1%BB%99c+An'); // không gồm focus
  });

  it('update ghi URL bằng REPLACE (không chồng lịch sử), giữ phần còn lại, bỏ focus', () => {
    renderAt('/browse?q=nuoc&focus=search');
    act(() => hook.update({ sort: 'best_seller' }));
    expect(loc()).toHaveTextContent('/browse?q=nuoc&sort=best_seller');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
  });

  it('update với undefined gỡ tham số', () => {
    renderAt('/browse?minPrice=100000&maxPrice=200000&inStock=1');
    act(() => hook.update({ minPrice: undefined, maxPrice: undefined }));
    expect(loc()).toHaveTextContent(/^\/browse\?inStock=1$/);
  });

  it('consumeFocus chỉ bỏ focus (giữ cả tham số lạ như utm), dạng replace', () => {
    renderAt('/browse?q=nuoc&focus=search&utm=zalo');
    act(() => hook.consumeFocus());
    expect(loc()).toHaveTextContent('/browse?q=nuoc&utm=zalo');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
    expect(hook.focusSearch).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils/search-state.spec.ts src/hooks/use-search-state.spec.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/utils/search-state.ts`:

```ts
import type { CatalogQuery, CatalogSort } from '../services/shop-api';
import type { FilterType } from '../services/discovery-events';
import { vi } from '../i18n/vi';
import { formatVndShort } from './format';

/**
 * Trạng thái Browse sống trong URL (spec 5b.2, plan 4b Ruling 7) — quay lại từ trang sản phẩm thì
 * giữ nguyên. Tham số: q, sort, category, segment, brand (phẩy), minPrice, maxPrice, inStock=1, rating.
 */
export interface SearchState {
  q: string;
  sort?: CatalogSort;
  category?: string;
  segment?: string;
  brands: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  minRating?: number;
}

/** Phần trạng thái mà FilterSheet chỉnh (nháp tới khi bấm "Xem n sản phẩm"). */
export interface FilterDraft {
  brands: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  minRating?: number;
}

export interface PriceRange {
  key: string;
  min?: number;
  max?: number;
}

export const EMPTY_SEARCH_STATE: SearchState = { q: '', brands: [], inStock: false };

/** "Xoá tìm kiếm & bộ lọc" — giữ cách sắp xếp khách đã chọn. */
export const CLEAR_SEARCH_PATCH: Partial<SearchState> = {
  q: '', category: undefined, segment: undefined, brands: [], minPrice: undefined, maxPrice: undefined, inStock: false, minRating: undefined,
};

export const CATALOG_SORTS: readonly CatalogSort[] = ['best_seller', 'newest', 'price_asc', 'price_desc'];

export const PRICE_RANGES: readonly PriceRange[] = [
  { key: 'lt100k', max: 100_000 },
  { key: '100k-200k', min: 100_000, max: 200_000 },
  { key: '200k-500k', min: 200_000, max: 500_000 },
  { key: 'gte500k', min: 500_000 },
];

export const MIN_RATING_OPTION = 4;

function intParam(v: string | null): number | undefined {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function parseSearchState(params: URLSearchParams): SearchState {
  const sort = params.get('sort');
  const rating = intParam(params.get('rating'));
  return {
    q: (params.get('q') ?? '').trim(),
    sort: sort && (CATALOG_SORTS as readonly string[]).includes(sort) ? (sort as CatalogSort) : undefined,
    category: params.get('category') || undefined,
    segment: params.get('segment') || undefined,
    brands: (params.get('brand') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    minPrice: intParam(params.get('minPrice')),
    maxPrice: intParam(params.get('maxPrice')),
    inStock: params.get('inStock') === '1',
    minRating: rating != null && rating >= 1 && rating <= 5 ? rating : undefined,
  };
}

/** Thứ tự cố định + bỏ giá trị mặc định → một trạng thái chỉ có một URL (khoá cache + vị trí cuộn). */
export function serializeSearchState(s: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  const q = s.q.trim();
  if (q) p.set('q', q);
  if (s.category) p.set('category', s.category);
  if (s.segment) p.set('segment', s.segment);
  if (s.brands.length > 0) p.set('brand', s.brands.join(','));
  if (s.minPrice != null) p.set('minPrice', String(s.minPrice));
  if (s.maxPrice != null) p.set('maxPrice', String(s.maxPrice));
  if (s.inStock) p.set('inStock', '1');
  if (s.minRating != null) p.set('rating', String(s.minRating));
  if (s.sort) p.set('sort', s.sort);
  return p;
}

export function toCatalogQuery(s: SearchState, page: number, limit: number): CatalogQuery {
  return {
    page,
    limit,
    q: s.q || undefined,
    sort: s.sort,
    category: s.category,
    segment: s.segment,
    brand: s.brands.length > 0 ? s.brands.join(',') : undefined,
    minPrice: s.minPrice,
    maxPrice: s.maxPrice,
    inStock: s.inStock || undefined,
    minRating: s.minRating,
  };
}

export function draftFromState(s: SearchState): FilterDraft {
  return { brands: [...s.brands], minPrice: s.minPrice, maxPrice: s.maxPrice, inStock: s.inStock, minRating: s.minRating };
}

/** Số LOẠI bộ lọc đang bật (badge nút "Bộ lọc"). */
export function activeFilterCount(s: Pick<SearchState, 'brands' | 'minPrice' | 'maxPrice' | 'inStock' | 'minRating'>): number {
  return (
    (s.minPrice != null || s.maxPrice != null ? 1 : 0) +
    (s.inStock ? 1 : 0) +
    (s.brands.length > 0 ? 1 : 0) +
    (s.minRating != null ? 1 : 0)
  );
}

/** Trang Danh mục "gốc": chưa tìm, chưa chọn danh mục/phân khúc, chưa lọc (sắp xếp không tính). */
export function isBrowseRoot(s: SearchState): boolean {
  return !s.q && !s.category && !s.segment && activeFilterCount(s) === 0;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function changedFilterTypes(before: SearchState, after: FilterDraft): FilterType[] {
  const types: FilterType[] = [];
  if (before.minPrice !== after.minPrice || before.maxPrice !== after.maxPrice) types.push('price');
  if (before.inStock !== after.inStock) types.push('in_stock');
  if (!sameSet(before.brands, after.brands)) types.push('brand');
  if (before.minRating !== after.minRating) types.push('rating');
  return types;
}

export function priceRangeLabel(min?: number, max?: number): string {
  if (min != null && max != null) return vi.browse.price.between(formatVndShort(min), formatVndShort(max));
  if (max != null) return vi.browse.price.under(formatVndShort(max));
  return vi.browse.price.from(formatVndShort(min ?? 0));
}

export interface ActiveFilterChip {
  key: string;
  label: string;
  patch: Partial<SearchState>;
}

/** Chip "đang lọc" gỡ được từng cái. Danh mục chưa có tên (danh sách chưa tải) thì chưa hiện. */
export function activeFilterChips(s: SearchState, names: { categoryName?: string; segmentName?: string }): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (s.category && names.categoryName) chips.push({ key: 'category', label: names.categoryName, patch: { category: undefined } });
  if (s.segment) chips.push({ key: 'segment', label: names.segmentName ?? s.segment, patch: { segment: undefined } });
  for (const b of s.brands) chips.push({ key: `brand:${b}`, label: b, patch: { brands: s.brands.filter((x) => x !== b) } });
  if (s.minPrice != null || s.maxPrice != null) {
    chips.push({ key: 'price', label: priceRangeLabel(s.minPrice, s.maxPrice), patch: { minPrice: undefined, maxPrice: undefined } });
  }
  if (s.inStock) chips.push({ key: 'inStock', label: vi.browse.inStockChip, patch: { inStock: false } });
  if (s.minRating != null) chips.push({ key: 'rating', label: vi.browse.rating4Chip, patch: { minRating: undefined } });
  return chips;
}
```

`apps/miniapp/src/hooks/use-search-state.ts`:

```ts
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseSearchState, serializeSearchState, type SearchState } from '../utils/search-state';

export interface UseSearchState {
  state: SearchState;
  /** Khoá chuẩn của trạng thái (không gồm `focus`) — query key danh sách + khoá vị trí cuộn. */
  urlKey: string;
  /** `?focus=search` từ ô tìm ở Trang chủ — dùng MỘT lần rồi `consumeFocus()`. */
  focusSearch: boolean;
  update: (patch: Partial<SearchState>) => void;
  consumeFocus: () => void;
}

/**
 * Trạng thái Browse đồng bộ URL (spec 5b.2). MỌI lần ghi đều `replace: true` — đổi bộ lọc không
 * chồng thêm mục lịch sử, nút Back rời Browse chứ không tua lại từng bộ lọc.
 */
export function useSearchState(): UseSearchState {
  const [params, setParams] = useSearchParams();
  const raw = params.toString();
  const state = useMemo(() => parseSearchState(new URLSearchParams(raw)), [raw]);
  const urlKey = useMemo(() => serializeSearchState(state).toString(), [state]);
  const focusSearch = params.get('focus') === 'search';

  const update = useCallback(
    (patch: Partial<SearchState>) =>
      setParams((prev) => serializeSearchState({ ...parseSearchState(prev), ...patch }), { replace: true }),
    [setParams],
  );
  const consumeFocus = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focus');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { state, urlKey, focusSearch, update, consumeFocus };
}
```

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils/search-state.spec.ts src/hooks/use-search-state.spec.tsx` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/utils/search-state.ts apps/miniapp/src/utils/search-state.spec.ts apps/miniapp/src/hooks/use-search-state.ts apps/miniapp/src/hooks/use-search-state.spec.tsx
git commit -m "feat(miniapp): URL-synced Browse search state with canonical serialization and replace navigation (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Miniapp — recently viewed + recent searches storage, `useRecentlyViewed`

**Files:**
- Create: `apps/miniapp/src/utils/recently-viewed.ts`, `apps/miniapp/src/utils/recently-viewed.spec.ts`
- Create: `apps/miniapp/src/utils/recent-searches.ts`, `apps/miniapp/src/utils/recent-searches.spec.ts`
- Create: `apps/miniapp/src/hooks/use-recently-viewed.ts`, `apps/miniapp/src/hooks/use-recently-viewed.spec.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }`; `browserStorage(): StorageLike | null` (in `recently-viewed.ts`, reused by `recent-searches.ts`)
  - `interface RecentlyViewedItem { slug: string; name: string; thumbnail: string | null; price: number; viewedAt: number }`
  - `RECENTLY_VIEWED_KEY = 'tubu_recently_viewed'`, `RECENTLY_VIEWED_MAX = 20`, `RECENTLY_VIEWED_EVENT = 'tubu:recently-viewed'`
  - `parseRecentlyViewed(raw: string | null): RecentlyViewedItem[]`, `readRecentlyViewed(storage?): RecentlyViewedItem[]`, `recordRecentlyViewed(item: Omit<RecentlyViewedItem, 'viewedAt'>, now?: number, storage?): RecentlyViewedItem[]`, `clearRecentlyViewed(storage?): void`
  - `RECENT_SEARCHES_KEY = 'tubu_recent_searches'` (same key as today), `RECENT_SEARCHES_MAX = 8`, `readRecentSearches(storage?): string[]`, `pushRecentSearch(term: string, storage?): string[]`, `clearRecentSearches(storage?): void`
  - `useRecentlyViewed(): RecentlyViewedItem[]` — re-renders on `RECENTLY_VIEWED_EVENT` and cross-tab `storage` events.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/utils/recently-viewed.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RECENTLY_VIEWED_KEY, RECENTLY_VIEWED_MAX, clearRecentlyViewed, parseRecentlyViewed, readRecentlyViewed, recordRecentlyViewed,
  type StorageLike,
} from './recently-viewed';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}
const item = (slug: string) => ({ slug, name: `SP ${slug}`, thumbnail: null, price: 50000 });

describe('recently-viewed (spec 5b.4)', () => {
  it('chưa có gì → []', () => {
    expect(readRecentlyViewed(memoryStorage())).toEqual([]);
  });

  it('ghi mới nhất lên đầu; xem lại cùng slug thì dời lên đầu, không trùng', () => {
    const s = memoryStorage();
    recordRecentlyViewed(item('a'), 1, s);
    recordRecentlyViewed(item('b'), 2, s);
    const r = recordRecentlyViewed(item('a'), 3, s);
    expect(r.map((x) => x.slug)).toEqual(['a', 'b']);
    expect(r[0]!.viewedAt).toBe(3);
    expect(JSON.parse(s.data[RECENTLY_VIEWED_KEY]!)).toEqual(r);
  });

  it('giữ tối đa 20, bỏ cái cũ nhất', () => {
    const s = memoryStorage();
    for (let i = 0; i < 25; i++) recordRecentlyViewed(item(`p${i}`), i, s);
    const r = readRecentlyViewed(s);
    expect(r).toHaveLength(RECENTLY_VIEWED_MAX);
    expect(r[0]!.slug).toBe('p24');
    expect(r.at(-1)!.slug).toBe('p5');
  });

  it('dữ liệu hỏng / sai shape bị bỏ qua, không ném', () => {
    expect(parseRecentlyViewed('{oops')).toEqual([]);
    expect(parseRecentlyViewed(JSON.stringify([{ slug: 'x' }, null, 3, { ...item('ok'), viewedAt: 1 }]))).toEqual([{ ...item('ok'), viewedAt: 1 }]);
    expect(parseRecentlyViewed(JSON.stringify({ slug: 'x' }))).toEqual([]);
  });

  it('setItem ném (hết quota, chế độ riêng tư) → vẫn trả danh sách, không ném', () => {
    const s = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(recordRecentlyViewed(item('a'), 1, s).map((x) => x.slug)).toEqual(['a']);
  });

  it('không có storage (null) → đọc [] và ghi không ném', () => {
    expect(readRecentlyViewed(null)).toEqual([]);
    expect(recordRecentlyViewed(item('a'), 1, null)).toHaveLength(1);
  });

  it('clearRecentlyViewed xoá khoá', () => {
    const s = memoryStorage();
    recordRecentlyViewed(item('a'), 1, s);
    clearRecentlyViewed(s);
    expect(readRecentlyViewed(s)).toEqual([]);
  });
});
```

`apps/miniapp/src/utils/recent-searches.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RECENT_SEARCHES_KEY, clearRecentSearches, pushRecentSearch, readRecentSearches } from './recent-searches';
import type { StorageLike } from './recently-viewed';

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

describe('recent-searches (giữ khoá cũ tubu_recent_searches)', () => {
  it('bỏ từ khoá < 2 ký tự; mới nhất lên đầu; trùng (không phân biệt hoa thường) dời lên đầu; tối đa 8', () => {
    const s = memoryStorage();
    pushRecentSearch('a', s);
    pushRecentSearch('nước', s);
    pushRecentSearch('xà phòng', s);
    expect(pushRecentSearch('NƯỚC', s)).toEqual(['NƯỚC', 'xà phòng']);
    for (let i = 0; i < 10; i++) pushRecentSearch(`tu khoa ${i}`, s);
    expect(readRecentSearches(s)).toHaveLength(8);
    expect(JSON.parse(s.data[RECENT_SEARCHES_KEY]!)[0]).toBe('tu khoa 9');
  });

  it('dữ liệu hỏng → []; clear xoá', () => {
    const s = memoryStorage();
    s.data[RECENT_SEARCHES_KEY] = '[1, "ok", null]';
    expect(readRecentSearches(s)).toEqual(['ok']);
    clearRecentSearches(s);
    expect(readRecentSearches(s)).toEqual([]);
  });
});
```

`apps/miniapp/src/hooks/use-recently-viewed.spec.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { RECENTLY_VIEWED_KEY, recordRecentlyViewed } from '../utils/recently-viewed';
import { useRecentlyViewed } from './use-recently-viewed';

describe('useRecentlyViewed', () => {
  beforeEach(() => localStorage.clear());

  it('đọc từ localStorage và cập nhật ngay khi PDP ghi thêm (cùng tab)', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current).toEqual([]);
    act(() => {
      recordRecentlyViewed({ slug: 'a', name: 'SP A', thumbnail: null, price: 1000 });
    });
    expect(result.current.map((x) => x.slug)).toEqual(['a']);
  });

  it('giữ nguyên tham chiếu mảng khi dữ liệu không đổi (không render lặp)', () => {
    recordRecentlyViewed({ slug: 'a', name: 'SP A', thumbnail: null, price: 1000 });
    const { result, rerender } = renderHook(() => useRecentlyViewed());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('dữ liệu hỏng → []', () => {
    localStorage.setItem(RECENTLY_VIEWED_KEY, 'not json');
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils/recently-viewed.spec.ts src/utils/recent-searches.spec.ts src/hooks/use-recently-viewed.spec.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/utils/recently-viewed.ts`:

```ts
/**
 * "Đã xem gần đây" (spec 5b.4): 20 SP mới xem nhất, chỉ lưu ở máy (localStorage), không đồng bộ
 * server. Ghi ở PDP khi mở thành công; đọc ở Trang chủ + trang Danh mục. Storage có thể vắng
 * (chế độ riêng tư, WebView lạ) hoặc ném (hết quota) → mọi đường đọc/ghi đều không được ném.
 */
export interface RecentlyViewedItem {
  slug: string;
  name: string;
  thumbnail: string | null;
  price: number;
  viewedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RECENTLY_VIEWED_KEY = 'tubu_recently_viewed';
export const RECENTLY_VIEWED_MAX = 20;
/** Bắn trên `window` sau mỗi lần ghi để các hook cùng tab cập nhật (sự kiện `storage` chỉ tới tab KHÁC). */
export const RECENTLY_VIEWED_EVENT = 'tubu:recently-viewed';

export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isItem(x: unknown): x is RecentlyViewedItem {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.slug === 'string' && r.slug !== '' &&
    typeof r.name === 'string' &&
    (r.thumbnail === null || typeof r.thumbnail === 'string') &&
    typeof r.price === 'number' && Number.isFinite(r.price) &&
    typeof r.viewedAt === 'number'
  );
}

export function parseRecentlyViewed(raw: string | null): RecentlyViewedItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter(isItem).slice(0, RECENTLY_VIEWED_MAX) : [];
  } catch {
    return [];
  }
}

export function readRecentlyViewed(storage: StorageLike | null = browserStorage()): RecentlyViewedItem[] {
  if (!storage) return [];
  try {
    return parseRecentlyViewed(storage.getItem(RECENTLY_VIEWED_KEY));
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(
  item: Omit<RecentlyViewedItem, 'viewedAt'>,
  now: number = Date.now(),
  storage: StorageLike | null = browserStorage(),
): RecentlyViewedItem[] {
  const next = [{ ...item, viewedAt: now }, ...readRecentlyViewed(storage).filter((x) => x.slug !== item.slug)].slice(
    0,
    RECENTLY_VIEWED_MAX,
  );
  if (!storage) return next;
  try {
    storage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECENTLY_VIEWED_EVENT));
  return next;
}

export function clearRecentlyViewed(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(RECENTLY_VIEWED_KEY);
  } catch {
    /* bỏ qua */
  }
}
```

`apps/miniapp/src/utils/recent-searches.ts`:

```ts
import { browserStorage, type StorageLike } from './recently-viewed';

/** Từ khoá đã tìm (chuyển từ pages/browse.tsx, GIỮ khoá cũ để khách không mất lịch sử). */
export const RECENT_SEARCHES_KEY = 'tubu_recent_searches';
export const RECENT_SEARCHES_MAX = 8;

export function readRecentSearches(storage: StorageLike | null = browserStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_SEARCHES_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(term: string, storage: StorageLike | null = browserStorage()): string[] {
  const t = term.trim();
  if (t.length < 2) return readRecentSearches(storage);
  const next = [t, ...readRecentSearches(storage).filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_SEARCHES_MAX);
  try {
    storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* hết quota — vẫn trả danh sách trong bộ nhớ */
  }
  return next;
}

export function clearRecentSearches(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* bỏ qua */
  }
}
```

`apps/miniapp/src/hooks/use-recently-viewed.ts`:

```ts
import { useMemo, useSyncExternalStore } from 'react';
import {
  RECENTLY_VIEWED_EVENT, RECENTLY_VIEWED_KEY, browserStorage, parseRecentlyViewed, type RecentlyViewedItem,
} from '../utils/recently-viewed';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(RECENTLY_VIEWED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(RECENTLY_VIEWED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Snapshot là CHUỖI thô (so sánh bằng giá trị) → useSyncExternalStore không render lặp vô hạn. */
function snapshot(): string | null {
  try {
    return browserStorage()?.getItem(RECENTLY_VIEWED_KEY) ?? null;
  } catch {
    return null;
  }
}

export function useRecentlyViewed(): RecentlyViewedItem[] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => parseRecentlyViewed(raw), [raw]);
}
```

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/utils/recently-viewed.spec.ts src/utils/recent-searches.spec.ts src/hooks/use-recently-viewed.spec.tsx` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/utils/recently-viewed.ts apps/miniapp/src/utils/recently-viewed.spec.ts apps/miniapp/src/utils/recent-searches.ts apps/miniapp/src/utils/recent-searches.spec.ts apps/miniapp/src/hooks/use-recently-viewed.ts apps/miniapp/src/hooks/use-recently-viewed.spec.tsx
git commit -m "feat(miniapp): recently viewed and recent searches storage that never throws (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Miniapp — `useCategories`, `useSuggest`, `useScrollRestoration`

**Files:**
- Create: `apps/miniapp/src/hooks/use-categories.ts`, `apps/miniapp/src/hooks/use-categories.spec.ts`
- Create: `apps/miniapp/src/hooks/use-suggest.ts`, `apps/miniapp/src/hooks/use-suggest.spec.tsx`
- Create: `apps/miniapp/src/hooks/use-scroll-restoration.ts`, `apps/miniapp/src/hooks/use-scroll-restoration.spec.tsx`

**Interfaces:**
- Consumes: `fetchCategories`, `CategoryDTO`, `suggestProducts`, `ProductSuggestion` (`shop-api.ts`), `useDebounced` (`utils/use-debounced.ts`), `vi.browse.segments` (Task 8).
- Produces:
  - `interface CategoryEntry { kind: 'category' | 'segment'; key: string; label: string; icon: LucideIcon }`
  - `SEGMENT_ENTRIES: CategoryEntry[]`, `segmentLabel(key: string): string | undefined`, `categoryEntries(categories: CategoryDTO[] | undefined): CategoryEntry[]`
  - `CATEGORIES_KEY = ['categories'] as const`; `useCategories(): { entries: CategoryEntry[]; categories: CategoryDTO[]; isLoading: boolean }`
  - `SUGGEST_DEBOUNCE_MS = 250`, `SUGGEST_MIN_CHARS = 2`; `useSuggest(draft: string): { products: ProductSuggestion[]; isFetching: boolean }`
  - `SCROLL_KEY_PREFIX = 'tubu_scroll:'`; `useScrollRestoration(key: string, ready: boolean): { anchorRef: RefObject<HTMLDivElement> }` — the anchor must be rendered inside the zmp `Page` (scroller = closest `.zaui-page`).

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/hooks/use-categories.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SEGMENT_ENTRIES, categoryEntries, segmentLabel } from './use-categories';

const cat = (id: string, productCount?: number) => ({ id, parentId: null, name: `DM ${id}`, slug: id, image: null, sortOrder: 1, productCount });

describe('categoryEntries (plan 4b Ruling 4)', () => {
  it('danh mục thật có hàng → giữ, theo thứ tự API; danh mục trống bị ẩn', () => {
    const r = categoryEntries([cat('a', 3), cat('b', 0), cat('c', 1)]);
    expect(r.map((e) => [e.kind, e.key, e.label])).toEqual([
      ['category', 'a', 'DM a'],
      ['category', 'c', 'DM c'],
    ]);
  });

  it('không danh mục nào có hàng / API cũ (thiếu productCount) / chưa có dữ liệu → 4 phân khúc', () => {
    expect(categoryEntries([cat('a', 0)])).toBe(SEGMENT_ENTRIES);
    expect(categoryEntries([cat('a')])).toBe(SEGMENT_ENTRIES);
    expect(categoryEntries(undefined)).toBe(SEGMENT_ENTRIES);
    expect(SEGMENT_ENTRIES.map((e) => e.key)).toEqual(['mom_baby', 'home_clean', 'skincare', 'eco']);
  });

  it('segmentLabel dùng nhãn tiếng Việt thống nhất (không emoji)', () => {
    expect(segmentLabel('mom_baby')).toBe('Cho mẹ & bé');
    expect(segmentLabel('nope')).toBeUndefined();
  });
});
```

`apps/miniapp/src/hooks/use-suggest.spec.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ suggestProducts: vi.fn() }));
vi.mock('../services/shop-api', () => ({ suggestProducts: mocks.suggestProducts }));

import { SUGGEST_DEBOUNCE_MS, SUGGEST_MIN_CHARS, useSuggest } from './use-suggest';

const P = { slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65000 };
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useSuggest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hằng số theo spec: debounce 250ms, từ 2 ký tự', () => {
    expect(SUGGEST_DEBOUNCE_MS).toBe(250);
    expect(SUGGEST_MIN_CHARS).toBe(2);
  });

  it('gõ liên tục → chỉ 1 lần gọi, với từ khoá CUỐI (đã trim), sau khi ngừng gõ', async () => {
    mocks.suggestProducts.mockResolvedValue([P]);
    const { result, rerender } = renderHook(({ d }) => useSuggest(d), { initialProps: { d: '' }, wrapper });
    rerender({ d: 'n' });
    rerender({ d: 'nu' });
    rerender({ d: 'nuo ' });
    expect(mocks.suggestProducts).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.products).toEqual([P]));
    expect(mocks.suggestProducts).toHaveBeenCalledTimes(1);
    expect(mocks.suggestProducts).toHaveBeenCalledWith('nuo');
  });

  it('1 ký tự → không gọi API, products rỗng', async () => {
    const { result } = renderHook(() => useSuggest('n'), { wrapper });
    await new Promise((r) => setTimeout(r, SUGGEST_DEBOUNCE_MS + 50));
    expect(mocks.suggestProducts).not.toHaveBeenCalled();
    expect(result.current.products).toEqual([]);
  });

  it('API lỗi → products rỗng, không ném', async () => {
    mocks.suggestProducts.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useSuggest('nuoc'), { wrapper });
    await waitFor(() => expect(mocks.suggestProducts).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.products).toEqual([]);
  });
});
```

`apps/miniapp/src/hooks/use-scroll-restoration.spec.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SCROLL_KEY_PREFIX, useScrollRestoration } from './use-scroll-restoration';

function Harness({ k, ready }: { k: string; ready: boolean }) {
  const { anchorRef } = useScrollRestoration(k, ready);
  return (
    <div className="zaui-page" data-testid="scroller">
      <div ref={anchorRef} />
    </div>
  );
}
/** jsdom không có layout: giả lập scrollTop ghi/đọc được. */
function fakeScrollTop(el: HTMLElement, initial = 0) {
  let v = initial;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => v, set: (x: number) => { v = x; } });
}

describe('useScrollRestoration', () => {
  beforeEach(() => sessionStorage.clear());

  it('lưu vị trí cuộn (debounce) vào sessionStorage theo khoá URL', async () => {
    const { getByTestId } = render(<Harness k="q=nuoc" ready />);
    const el = getByTestId('scroller');
    fakeScrollTop(el, 640);
    el.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(sessionStorage.getItem(`${SCROLL_KEY_PREFIX}q=nuoc`)).toBe('640'));
  });

  it('rời trang (unmount) → lưu ngay vị trí hiện tại', () => {
    const { getByTestId, unmount } = render(<Harness k="sort=newest" ready />);
    fakeScrollTop(getByTestId('scroller'), 300);
    unmount();
    expect(sessionStorage.getItem(`${SCROLL_KEY_PREFIX}sort=newest`)).toBe('300');
  });

  it('khôi phục khi danh sách đã có dữ liệu (ready), không khôi phục sớm', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc`, '480');
    const { getByTestId, rerender } = render(<Harness k="q=nuoc" ready={false} />);
    const el = getByTestId('scroller');
    fakeScrollTop(el, 0);
    rerender(<Harness k="q=nuoc" ready={false} />);
    expect(el.scrollTop).toBe(0);
    rerender(<Harness k="q=nuoc" ready />);
    expect(el.scrollTop).toBe(480);
  });

  it('chỉ khôi phục MỘT lần cho mỗi khoá (khách cuộn tiếp không bị kéo về)', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=a`, '200');
    const { getByTestId, rerender } = render(<Harness k="q=a" ready={false} />);
    const el = getByTestId('scroller');
    fakeScrollTop(el, 0);
    rerender(<Harness k="q=a" ready />);
    expect(el.scrollTop).toBe(200);
    el.scrollTop = 50;
    rerender(<Harness k="q=a" ready />);
    expect(el.scrollTop).toBe(50);
  });

  it('sessionStorage ném lỗi → không vỡ trang', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => render(<Harness k="q=x" ready />)).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/hooks/use-categories.spec.ts src/hooks/use-suggest.spec.tsx src/hooks/use-scroll-restoration.spec.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/hooks/use-categories.ts`:

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Baby, Droplets, LayoutGrid, Recycle, SprayCan, type LucideIcon } from 'lucide-react';
import { fetchCategories, type CategoryDTO } from '../services/shop-api';
import { vi } from '../i18n/vi';

export interface CategoryEntry {
  kind: 'category' | 'segment';
  key: string;
  label: string;
  icon: LucideIcon;
}

/** 4 phân khúc (forSegment) — luôn có hàng trên prod vì sync Pancake suy ra từ tên SP. */
export const SEGMENT_ENTRIES: CategoryEntry[] = [
  { kind: 'segment', key: 'mom_baby', label: vi.browse.segments.mom_baby, icon: Baby },
  { kind: 'segment', key: 'home_clean', label: vi.browse.segments.home_clean, icon: SprayCan },
  { kind: 'segment', key: 'skincare', label: vi.browse.segments.skincare, icon: Droplets },
  { kind: 'segment', key: 'eco', label: vi.browse.segments.eco, icon: Recycle },
];

export function segmentLabel(key: string): string | undefined {
  return SEGMENT_ENTRIES.find((e) => e.key === key)?.label;
}

/**
 * Danh mục thật CÓ HÀNG (productCount > 0); không còn danh mục nào (hoặc API cũ không có
 * productCount, hoặc lỗi) → 4 phân khúc (spec 5b.2 "fallback 4 phân khúc nếu rỗng").
 */
export function categoryEntries(categories: CategoryDTO[] | undefined): CategoryEntry[] {
  const real = (categories ?? []).filter((c) => typeof c.productCount === 'number' && c.productCount > 0);
  if (real.length === 0) return SEGMENT_ENTRIES;
  return real.map((c) => ({ kind: 'category', key: c.id, label: c.name, icon: LayoutGrid }));
}

export const CATEGORIES_KEY = ['categories'] as const;

export function useCategories(): { entries: CategoryEntry[]; categories: CategoryDTO[]; isLoading: boolean } {
  // Danh mục đổi chậm (cache API 60s) — cùng staleTime với /brands.
  const q = useQuery({ queryKey: CATEGORIES_KEY, queryFn: fetchCategories, staleTime: 60_000, retry: false });
  const entries = useMemo(() => categoryEntries(q.data), [q.data]);
  return { entries, categories: q.data ?? [], isLoading: q.isLoading };
}
```

`apps/miniapp/src/hooks/use-suggest.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { suggestProducts, type ProductSuggestion } from '../services/shop-api';
import { useDebounced } from '../utils/use-debounced';

export const SUGGEST_DEBOUNCE_MS = 250;
export const SUGGEST_MIN_CHARS = 2;

/** Gợi ý SP khi gõ (spec 5b.2): debounce 250ms, từ 2 ký tự; lỗi → im lặng (chỉ là gợi ý). */
export function useSuggest(draft: string): { products: ProductSuggestion[]; isFetching: boolean } {
  const term = useDebounced(draft.trim(), SUGGEST_DEBOUNCE_MS);
  const enabled = term.length >= SUGGEST_MIN_CHARS;
  const q = useQuery({
    queryKey: ['search-suggest', term],
    queryFn: () => suggestProducts(term),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  return { products: enabled ? q.data ?? [] : [], isFetching: enabled && q.isFetching };
}
```

`apps/miniapp/src/hooks/use-scroll-restoration.ts`:

```ts
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export const SCROLL_KEY_PREFIX = 'tubu_scroll:';
const SAVE_DEBOUNCE_MS = 100;

function scrollerOf(anchor: HTMLElement | null): HTMLElement | null {
  return (anchor?.closest('.zaui-page') as HTMLElement | null) ?? null;
}

function save(key: string, scroller: HTMLElement): void {
  try {
    sessionStorage.setItem(SCROLL_KEY_PREFIX + key, String(Math.round(scroller.scrollTop)));
  } catch {
    /* storage bị chặn — chỉ mất tính năng khôi phục */
  }
}

function load(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY_PREFIX + key);
    const y = raw == null ? NaN : Number(raw);
    return Number.isFinite(y) && y > 0 ? y : null;
  } catch {
    return null;
  }
}

/**
 * Giữ vị trí cuộn của trang danh sách theo khoá URL (spec 5b.2) — quay lại từ PDP về đúng chỗ.
 * Không dùng `restoreScrollOnBack` của zmp Page: nó khoá theo `location.key`, mà mỗi lần đổi bộ
 * lọc bằng `replace` lại sinh key mới. `anchorRef` phải nằm TRONG `<Page>` (scroller = .zaui-page).
 * Khôi phục MỘT lần mỗi khoá, và chỉ khi danh sách đã có dữ liệu (`ready`).
 */
export function useScrollRestoration(key: string, ready: boolean): { anchorRef: RefObject<HTMLDivElement> } {
  const anchorRef = useRef<HTMLDivElement>(null);
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    const scroller = scrollerOf(anchorRef.current);
    if (!scroller) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => save(key, scroller), SAVE_DEBOUNCE_MS);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      scroller.removeEventListener('scroll', onScroll);
      save(key, scroller); // rời trang / đổi khoá: lưu vị trí của khoá CŨ ngay
    };
  }, [key]);

  // Layout effect của trang chạy SAU layout effect của <Page> con (Page tự cuộn về 0 khi mount).
  useLayoutEffect(() => {
    if (!ready || restoredFor.current === key) return;
    restoredFor.current = key;
    const scroller = scrollerOf(anchorRef.current);
    const y = load(key);
    if (scroller && y != null) scroller.scrollTop = y;
  }, [key, ready]);

  return { anchorRef };
}
```

- [ ] **Step 4: Run tests and types**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/hooks` → PASS (including the 4a hook specs).
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/hooks/use-categories.ts apps/miniapp/src/hooks/use-categories.spec.ts apps/miniapp/src/hooks/use-suggest.ts apps/miniapp/src/hooks/use-suggest.spec.tsx apps/miniapp/src/hooks/use-scroll-restoration.ts apps/miniapp/src/hooks/use-scroll-restoration.spec.tsx
git commit -m "feat(miniapp): categories with segment fallback, debounced suggest and URL-keyed scroll restoration hooks (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Miniapp — DS primitives: `SearchField`, `Chip` 44px hit area + `ariaLabel`

**Files:**
- Create: `apps/miniapp/src/components/ui/search-field.tsx`, `apps/miniapp/src/components/ui/search-field.spec.tsx`
- Modify: `apps/miniapp/src/components/ui/chip.tsx`, `apps/miniapp/src/components/ui/chip.spec.tsx`
- Modify: `apps/miniapp/src/css/tokens.css` (append `.tubu-hit-44` after the `.touch-target` rule)

**Interfaces:**
- Consumes: `Icon`, `IconButton` (`components/ui`).
- Produces:
  - `interface SearchFieldProps { value: string; onChange(v: string): void; onSubmit(v: string): void; onFocus?(): void; onClear?(): void; label: string; clearLabel: string; placeholder: string }`; `SearchField = forwardRef<HTMLInputElement, SearchFieldProps>` — `<form role="search">` + `<input type="search" enterKeyHint="search" aria-label={label}>`, clear `IconButton` only when `value` is non-empty (default clear = `onChange('')`).
  - `ChipProps.ariaLabel?: string`; every `Chip` carries class `tubu-hit-44` (vertical hit area 44px, visual height unchanged).
  - CSS class `.tubu-hit-44` (any element): `position: relative` + `::after` 44px tall, vertically centred.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/components/ui/search-field.spec.tsx`:

```tsx
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchField } from './search-field';

function renderField(over: Partial<Parameters<typeof SearchField>[0]> = {}) {
  const props = { value: '', onChange: vi.fn(), onSubmit: vi.fn(), label: 'Tìm sản phẩm', clearLabel: 'Xoá từ khoá', placeholder: 'Tìm sản phẩm...', ...over };
  render(<SearchField {...props} />);
  return props;
}

describe('SearchField', () => {
  it('vùng role=search, ô nhập có nhãn, bàn phím hiện nút "Tìm"', () => {
    renderField();
    expect(screen.getByRole('search')).toBeInTheDocument();
    const input = screen.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    expect(input).toHaveAttribute('enterkeyhint', 'search');
    expect(input).toHaveAttribute('placeholder', 'Tìm sản phẩm...');
  });

  it('gõ → onChange; Enter → onSubmit với giá trị hiện tại (không reload trang)', () => {
    const p = renderField({ value: 'nước' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nước rửa' } });
    expect(p.onChange).toHaveBeenCalledWith('nước rửa');
    fireEvent.submit(screen.getByRole('search'));
    expect(p.onSubmit).toHaveBeenCalledWith('nước');
  });

  it('nút xoá chỉ hiện khi có chữ; mặc định onChange(""), có onClear thì gọi onClear', () => {
    const { rerender } = render(<SearchField value="" onChange={vi.fn()} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    expect(screen.queryByRole('button', { name: 'Xoá từ khoá' })).toBeNull();
    const onChange = vi.fn();
    const onClear = vi.fn();
    rerender(<SearchField value="abc" onChange={onChange} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    expect(onChange).toHaveBeenCalledWith('');
    rerender(<SearchField value="abc" onChange={onChange} onClear={onClear} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('ref trỏ tới <input> (trang Danh mục tự focus khi tới từ Trang chủ)', () => {
    const ref = createRef<HTMLInputElement>();
    render(<SearchField ref={ref} value="" onChange={vi.fn()} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá" placeholder="" />);
    ref.current!.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it('khung ô tìm cao ít nhất 44px', () => {
    renderField();
    expect((screen.getByTestId('search-field-box') as HTMLElement).style.minHeight).toBe('44px');
  });
});
```

Append to `apps/miniapp/src/components/ui/chip.spec.tsx` (inside the existing `describe`):

```tsx
  it('vùng chạm 44px (class tubu-hit-44) mà không đổi chiều cao nhìn thấy', () => {
    render(<Chip>x</Chip>);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('tubu-hit-44');
    expect(chip.style.minHeight).toBe('36px');
  });
  it('ariaLabel đặt tên truy cập riêng (vd "Bỏ lọc Tubu")', () => {
    render(<Chip ariaLabel="Bỏ lọc Tubu" selected>Tubu</Chip>);
    expect(screen.getByRole('button', { name: 'Bỏ lọc Tubu' })).toHaveAttribute('aria-pressed', 'true');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/search-field.spec.tsx src/components/ui/chip.spec.tsx`
Expected: FAIL — `search-field` missing; Chip has no `tubu-hit-44` / `aria-label`.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/ui/search-field.tsx`:

```tsx
import { forwardRef } from 'react';
import { Search, X } from 'lucide-react';
import { Icon } from './icon';
import { IconButton } from './icon-button';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter / nút "Tìm" của bàn phím. */
  onSubmit: (value: string) => void;
  onFocus?: () => void;
  /** Mặc định: onChange(''). */
  onClear?: () => void;
  label: string;
  clearLabel: string;
  placeholder: string;
}

/**
 * Ô tìm kiếm DS v2 — DS chưa có ô nhập chữ nào (plan 4b Ruling 13). `<form role="search">` để
 * bàn phím di động hiện nút "Tìm" và Enter gửi đúng một lần; khung cao ≥ 44px; nút xoá là
 * IconButton (vùng chạm 44px, có nhãn).
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, onSubmit, onFocus, onClear, label, clearLabel, placeholder },
  ref,
) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      style={{ flex: 1, minWidth: 0 }}
    >
      <div
        data-testid="search-field-box"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 44,
          padding: '0 2px 0 14px',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          boxSizing: 'border-box',
        }}
      >
        <Icon icon={Search} size="sm" tone="muted" />
        <input
          ref={ref}
          type="search"
          enterKeyHint="search"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          style={{
            flex: 1,
            minWidth: 0,
            height: 42,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--type-body-md-size)',
            color: 'var(--color-text-primary)',
          }}
        />
        {value !== '' && <IconButton icon={X} size="sm" label={clearLabel} onPress={() => (onClear ? onClear() : onChange(''))} />}
      </div>
    </form>
  );
});
```

`apps/miniapp/src/components/ui/chip.tsx` — add `ariaLabel?: string;` to `ChipProps`, destructure it, and on the `<span>` set `aria-label={ariaLabel}` and `className={['tubu-press', 'tubu-hit-44', className].filter(Boolean).join(' ')}`. Update the doc comment:

```tsx
/** Chip lọc/chọn — thay 3 định nghĩa trùng lặp (browse.tsx/feed.tsx byte-for-byte, audit A4-19).
 * Nhìn cao 36px nhưng vùng chạm 44px nhờ `.tubu-hit-44` (follow-up DS v2: "Chip under 44px").
 * Hàng chip trong `.scroll-x` cần đệm dọc ≥ 4px để vùng chạm không bị overflow cắt. */
```

`apps/miniapp/src/css/tokens.css` — after the `.touch-target { ... }` rule:

```css
/* ── Vùng chạm 44px cho phần tử nhìn thấp hơn (Chip 36px): giãn theo chiều dọc, không đổi hình ── */
.tubu-hit-44 {
  position: relative;
}
.tubu-hit-44::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 44px;
  transform: translateY(-50%);
}
```

- [ ] **Step 4: Run tests, types, lint, lint:vars**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/ui/search-field.tsx src/components/ui/chip.tsx` → clean.
Run: `pnpm lint:vars` → OK.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/ui/search-field.tsx apps/miniapp/src/components/ui/search-field.spec.tsx apps/miniapp/src/components/ui/chip.tsx apps/miniapp/src/components/ui/chip.spec.tsx apps/miniapp/src/css/tokens.css
git commit -m "feat(ds): SearchField primitive; Chip gets a 44px hit area and optional aria-label (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Miniapp — `CatalogTile`, `CatalogGrid`, `CatalogGridSkeleton`

**Files:**
- Create: `apps/miniapp/src/components/catalog/catalog-pricing.ts`, `apps/miniapp/src/components/catalog/catalog-pricing.spec.ts`
- Create: `apps/miniapp/src/components/catalog/catalog-grid.tsx`, `apps/miniapp/src/components/catalog/catalog-grid.spec.tsx`

**Interfaces:**
- Consumes: `ProductCard`, `FlashSaleActiveItem`, `fetchActiveFlashSales` (`shop-api.ts`); `ProductTile`, `Badge`, `Skeleton` (`components/ui`); `vi.flashSale.badge`; `haptic`.
- Produces:
  - `interface TilePricing { price: number; isFlash: boolean; salePct: number; flashVariationId?: string }`; `tilePricing(product: Pick<ProductCard, 'slug' | 'basePrice' | 'salePrice'>, flashSales: FlashSaleActiveItem[]): TilePricing`
  - `CatalogTile({ product: ProductCard; listSource: string; onOpen?: () => void })` — `ProductTile variant="grid"`; tap → `onOpen` then `navigate('/product/<slug>', { state: { listSource, variationId? } })`.
  - `CatalogGrid({ products: ProductCard[]; listSource: string; onOpen?: (product: ProductCard, index: number) => void })` — `data-testid="catalog-grid"`, 2 columns, gap 12.
  - `CatalogGridSkeleton({ count?: number })` — `data-testid="catalog-grid-skeleton"`, `aria-hidden`, each tile `data-testid="catalog-tile-skeleton"` with the real tile's body heights (10 + 20 + 2+44 + 3+20 + 4+20 + 10 = 133px under the square image).

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/components/catalog/catalog-pricing.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tilePricing } from './catalog-pricing';

const FLASH = { itemId: 'f1', variationId: 'v9', productSlug: 'nrc', productName: 'NRC', thumbnail: null, flashPrice: 50000, retailPrice: 100000, soldCount: 1, quota: 10, endAt: '2026-10-01T00:00:00.000Z' };

describe('tilePricing — quy tắc flash > sale > base (giống ProductCard cũ)', () => {
  it('không sale, không flash → giá gốc, 0%', () => {
    expect(tilePricing({ slug: 'x', basePrice: 100000, salePrice: null }, [])).toEqual({ price: 100000, isFlash: false, salePct: 0, flashVariationId: undefined });
  });

  it('có salePrice → giá sale, % giảm làm tròn', () => {
    expect(tilePricing({ slug: 'x', basePrice: 150000, salePrice: 120000 }, [])).toMatchObject({ price: 120000, isFlash: false, salePct: 20 });
  });

  it('flash rẻ hơn giá đang bán → thắng; mang variationId để PDP mở đúng phân loại', () => {
    expect(tilePricing({ slug: 'nrc', basePrice: 100000, salePrice: 80000 }, [FLASH])).toEqual({ price: 50000, isFlash: true, salePct: 50, flashVariationId: 'v9' });
  });

  it('flash KHÔNG rẻ hơn → giữ giá đang bán, nhưng vẫn mở đúng phân loại flash (như ProductCard cũ)', () => {
    expect(tilePricing({ slug: 'nrc', basePrice: 100000, salePrice: 40000 }, [FLASH])).toEqual({ price: 40000, isFlash: false, salePct: 60, flashVariationId: 'v9' });
  });
});
```

`apps/miniapp/src/components/catalog/catalog-grid.spec.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchActiveFlashSales: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('zmp-ui')>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchActiveFlashSales: mocks.fetchActiveFlashSales }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CatalogGrid, CatalogGridSkeleton } from './catalog-grid';

const SALE = { id: 'p1', slug: 'nrc', brand: 'Tubu', name: 'Nước rửa chén', thumbnail: null, basePrice: 150000, salePrice: 120000, isFeatured: false, inStock: true };
const OOS = { ...SALE, id: 'p2', slug: 'het', name: 'Hết hàng', inStock: false };

function renderGrid(onOpen?: (p: typeof SALE, i: number) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CatalogGrid products={[SALE, OOS]} listSource="search" onOpen={onOpen} />
    </QueryClientProvider>,
  );
}

describe('CatalogGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('2 thẻ; thẻ sale có badge -20%; thẻ hết hàng KHÔNG có badge % (lớp phủ trong suốt)', async () => {
    renderGrid();
    const grid = screen.getByTestId('catalog-grid');
    expect(grid.querySelectorAll('[role="button"][aria-label]')).toHaveLength(2);
    expect(await screen.findByText('-20%')).toBeInTheDocument();
    expect(screen.getAllByText(/-\d+%/)).toHaveLength(1);
  });

  it('chạm thẻ → onOpen(sp, vị trí) TRƯỚC, rồi sang PDP kèm listSource', () => {
    const onOpen = vi.fn();
    renderGrid(onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Hết hàng' }));
    expect(onOpen).toHaveBeenCalledWith(OOS, 1);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/het', { state: { listSource: 'search' } });
  });

  it('đang giờ vàng → giá flash, badge giờ vàng, mở đúng phân loại', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([
      { itemId: 'f1', variationId: 'v9', productSlug: 'nrc', productName: 'x', thumbnail: null, flashPrice: 75000, retailPrice: 150000, soldCount: 0, quota: 5, endAt: '2026-10-01T00:00:00.000Z' },
    ]);
    renderGrid();
    expect(await screen.findByText(/Giờ vàng -50%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc', { state: { listSource: 'search', variationId: 'v9' } });
  });

  it('skeleton: đúng số thẻ, ẩn với trình đọc màn hình, thân thẻ 133px như thẻ thật', () => {
    render(<CatalogGridSkeleton count={4} />);
    const sk = screen.getByTestId('catalog-grid-skeleton');
    expect(sk).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByTestId('catalog-tile-skeleton')).toHaveLength(4);
    expect(screen.getAllByTestId('catalog-tile-skeleton-body')[0]!.style.height).toBe('133px');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/catalog/catalog-pricing.ts`:

```ts
import type { FlashSaleActiveItem, ProductCard } from '../../services/shop-api';

export interface TilePricing {
  price: number;
  isFlash: boolean;
  salePct: number;
  /** Có flash cho SP này → PDP mở đúng phân loại đang giảm (dù flash không rẻ hơn). */
  flashVariationId?: string;
}

/** Quy tắc giá thẻ — y hệt ProductCard cũ + RelatedTile ở PDP (flash chỉ thắng khi rẻ hơn giá đang bán). */
export function tilePricing(
  product: Pick<ProductCard, 'slug' | 'basePrice' | 'salePrice'>,
  flashSales: FlashSaleActiveItem[],
): TilePricing {
  const flash = flashSales.find((f) => f.productSlug === product.slug);
  const standing = product.salePrice ?? product.basePrice;
  const price = flash && flash.flashPrice < standing ? flash.flashPrice : standing;
  const hasSale = price < product.basePrice;
  return {
    price,
    isFlash: price !== standing,
    salePct: hasSale ? Math.round((1 - price / product.basePrice) * 100) : 0,
    flashVariationId: flash?.variationId,
  };
}
```

`apps/miniapp/src/components/catalog/catalog-grid.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { fetchActiveFlashSales, type ProductCard } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Badge } from '../ui/badge';
import { ProductTile } from '../ui/product-tile';
import { Skeleton } from '../ui/skeleton';
import { tilePricing } from './catalog-pricing';

const FLASH_BADGE_STYLE: CSSProperties = { background: 'var(--color-flash-solid-bg)', color: 'var(--color-flash-solid-fg)' };

export interface CatalogTileProps {
  product: ProductCard;
  /** Ghi vào state điều hướng → `product_viewed.listSource` ở PDP. */
  listSource: string;
  onOpen?: () => void;
}

/** Thẻ SP của Trang chủ/Danh mục (DS v2) — thay ProductCard cũ, giữ nguyên giá giờ vàng + badge. */
export function CatalogTile({ product, listSource, onOpen }: CatalogTileProps) {
  const navigate = useNavigate();
  // Cùng queryKey với dải giờ vàng → không thêm request.
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 });
  const pricing = tilePricing(product, flashQ.data ?? []);
  return (
    <ProductTile
      product={product}
      variant="grid"
      priceOverride={{ price: pricing.price }}
      badge={
        // Hết hàng: lớp phủ của ProductTile trong suốt 72% — không để badge % lộ ra bên dưới.
        pricing.salePct > 0 && product.inStock ? (
          <Badge tone="promo" size="sm" style={pricing.isFlash ? FLASH_BADGE_STYLE : undefined}>
            {pricing.isFlash ? `${vi.flashSale.badge} -${pricing.salePct}%` : `-${pricing.salePct}%`}
          </Badge>
        ) : undefined
      }
      onPress={() => {
        haptic('light');
        onOpen?.();
        navigate(`/product/${product.slug}`, {
          state: { listSource, ...(pricing.flashVariationId ? { variationId: pricing.flashVariationId } : {}) },
        });
      }}
    />
  );
}

export interface CatalogGridProps {
  products: ProductCard[];
  listSource: string;
  onOpen?: (product: ProductCard, index: number) => void;
}

export function CatalogGrid({ products, listSource, onOpen }: CatalogGridProps) {
  return (
    <div data-testid="catalog-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {products.map((p, i) => (
        <CatalogTile key={p.id} product={p} listSource={listSource} onOpen={onOpen ? () => onOpen(p, i) : undefined} />
      ))}
    </div>
  );
}

/**
 * Khung chờ khớp ĐÚNG thẻ ProductTile dạng lưới (bài học 4a: skeleton lệch nội dung thật làm trang
 * nhảy): ảnh vuông + thân 133px = đệm 10 + nhãn hiệu 20 + tên (2 + 44) + sao (3 + 20) + giá (4 + 20) + đệm 10.
 * Đổi ProductTile thì đo lại — e2e buy-flow-4b kiểm lệch ≤ 16px.
 */
export const TILE_BODY_HEIGHT = 133;

export function CatalogGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div data-testid="catalog-grid-skeleton" aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="catalog-tile-skeleton"
          style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)', overflow: 'hidden' }}
        >
          <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
          <div data-testid="catalog-tile-skeleton-body" style={{ height: TILE_BODY_HEIGHT, padding: 10, boxSizing: 'border-box' }}>
            <Skeleton width={56} height={20} />
            <Skeleton width="90%" height={44} style={{ marginTop: 2 }} />
            <Skeleton width="50%" height={20} style={{ marginTop: 3 }} />
            <Skeleton width={80} height={20} style={{ marginTop: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/catalog` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/catalog/catalog-pricing.ts apps/miniapp/src/components/catalog/catalog-pricing.spec.ts apps/miniapp/src/components/catalog/catalog-grid.tsx apps/miniapp/src/components/catalog/catalog-grid.spec.tsx
git commit -m "feat(miniapp): DS v2 catalog tile and grid with flash pricing, plus a skeleton sized to the real tile (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Miniapp — `CategoryGrid`, `SortChips`, `ResultHeader`

**Files:**
- Create: `apps/miniapp/src/components/catalog/category-grid.tsx`
- Create: `apps/miniapp/src/components/catalog/sort-chips.tsx`
- Create: `apps/miniapp/src/components/catalog/result-header.tsx`
- Test: `apps/miniapp/src/components/catalog/catalog-controls.spec.tsx`

**Interfaces:**
- Consumes: `CategoryEntry` (Task 11); `CatalogSort` (Task 8); `ActiveFilterChip`, `SearchState` (Task 9); `Chip` with `ariaLabel` (Task 12); `Card`, `Icon`, `Heading`, `Text`, `Skeleton`, `Button` (`components/ui`); `vi.browse` (Task 8).
- Produces:
  - `CategoryGrid({ entries: CategoryEntry[]; isLoading: boolean; onSelect: (entry: CategoryEntry) => void; title?: string })` — `<section aria-label={title}>` (default `vi.browse.categories`), 2-column grid of `Card` buttons (≥48px); while loading an `aria-hidden` skeleton `data-testid="category-grid-loading"` of 4 × 48px.
  - `SORT_OPTIONS: { key: CatalogSort | undefined; label: string }[]` (Gợi ý · Bán chạy · Mới nhất · Giá tăng · Giá giảm); `SortChips({ value?: CatalogSort; onChange: (sort: CatalogSort | undefined) => void })` — `role="group"` `aria-label="Sắp xếp"`; tapping the selected chip does nothing.
  - `ResultHeader({ total: number; isLoading: boolean; chips: ActiveFilterChip[]; filterCount: number; filtersIgnored: boolean; onOpenFilters: () => void; onPatch: (patch: Partial<SearchState>) => void })` — count text in an `aria-live="polite"` paragraph (`data-testid="result-count"`), "Bộ lọc"/"Bộ lọc (n)" button, removable chips named "Bỏ lọc {label}", notice when `filtersIgnored`.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/components/catalog/catalog-controls.spec.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Baby, LayoutGrid } from 'lucide-react';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CategoryGrid } from './category-grid';
import { SORT_OPTIONS, SortChips } from './sort-chips';
import { ResultHeader } from './result-header';

const ENTRIES = [
  { kind: 'category' as const, key: 'cat-a', label: 'Tẩy rửa sinh học', icon: LayoutGrid },
  { kind: 'segment' as const, key: 'mom_baby', label: 'Cho mẹ & bé', icon: Baby },
];

describe('CategoryGrid', () => {
  it('vùng "Danh mục" với 1 nút cho mỗi mục; chạm → onSelect(mục)', () => {
    const onSelect = vi.fn();
    render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={onSelect} />);
    const region = screen.getByRole('region', { name: 'Danh mục' });
    fireEvent.click(screen.getByRole('button', { name: 'Cho mẹ & bé' }));
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[1]);
    expect(region.querySelectorAll('[role="button"]')).toHaveLength(2);
  });

  it('đang tải → khung chờ aria-hidden, chưa có nút', () => {
    render(<CategoryGrid entries={ENTRIES} isLoading onSelect={vi.fn()} />);
    expect(screen.getByTestId('category-grid-loading')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('SortChips', () => {
  it('5 lựa chọn theo spec; đang chọn có aria-pressed; chạm "Bán chạy" → best_seller; chạm lại cái đang chọn → không gọi', () => {
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual(['Gợi ý', 'Bán chạy', 'Mới nhất', 'Giá tăng', 'Giá giảm']);
    const onChange = vi.fn();
    render(<SortChips value={undefined} onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Sắp xếp' });
    expect(group.querySelector('[aria-pressed="true"]')).toHaveTextContent('Gợi ý');
    fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
    expect(onChange).toHaveBeenCalledWith('best_seller');
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('ResultHeader', () => {
  const base = { total: 1234, isLoading: false, chips: [], filterCount: 0, filtersIgnored: false, onOpenFilters: vi.fn(), onPatch: vi.fn() };

  it('hiện số kết quả (định dạng vi-VN) và nút "Bộ lọc"', () => {
    render(<ResultHeader {...base} />);
    expect(screen.getByTestId('result-count')).toHaveTextContent('1.234 sản phẩm');
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    expect(base.onOpenFilters).toHaveBeenCalled();
  });

  it('đang tải → chưa hiện số; có bộ lọc → "Bộ lọc (2)"; chip "Bỏ lọc Tubu" gọi onPatch(patch)', () => {
    const onPatch = vi.fn();
    render(
      <ResultHeader
        {...base}
        isLoading
        filterCount={2}
        onPatch={onPatch}
        chips={[{ key: 'brand:Tubu', label: 'Tubu', patch: { brands: [] } }, { key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }]}
      />,
    );
    expect(screen.getByTestId('result-count')).not.toHaveTextContent('sản phẩm');
    expect(screen.getByRole('button', { name: 'Bộ lọc (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Tubu' }));
    expect(onPatch).toHaveBeenCalledWith({ brands: [] });
  });

  it('API cũ bỏ qua bộ lọc → câu báo nhẹ', () => {
    render(<ResultHeader {...base} filtersIgnored />);
    expect(screen.getByText(/Bộ lọc nâng cao chưa dùng được/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog/catalog-controls.spec.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/catalog/category-grid.tsx`:

```tsx
import type { CSSProperties } from 'react';
import type { CategoryEntry } from '../../hooks/use-categories';
import { vi } from '../../i18n/vi';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };
/** Card viền 1px + đệm 12 + 1 dòng body-sm (22px) = 48px — khung chờ cùng chiều cao. */
const ITEM_HEIGHT = 48;

export interface CategoryGridProps {
  entries: CategoryEntry[];
  isLoading: boolean;
  onSelect: (entry: CategoryEntry) => void;
  title?: string;
}

/** Danh mục thật (có hàng) hoặc 4 phân khúc dự phòng (spec 5b.2) — dùng ở Trang chủ và trang Danh mục. */
export function CategoryGrid({ entries, isLoading, onSelect, title = vi.browse.categories }: CategoryGridProps) {
  return (
    <section aria-label={title} style={{ padding: '8px 16px' }}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        {title}
      </Heading>
      {isLoading ? (
        <div data-testid="category-grid-loading" aria-hidden="true" style={GRID}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={ITEM_HEIGHT} radius="var(--radius-card)" />
          ))}
        </div>
      ) : (
        <div style={GRID}>
          {entries.map((e) => (
            <Card key={`${e.kind}:${e.key}`} variant="outline" padding={12} onPress={() => onSelect(e)} style={{ minHeight: ITEM_HEIGHT, boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Icon icon={e.icon} size="sm" tone="brand" />
                <Text variant="body-sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.label}
                </Text>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
```

`apps/miniapp/src/components/catalog/sort-chips.tsx`:

```tsx
import type { CatalogSort } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Chip } from '../ui/chip';

export const SORT_OPTIONS: { key: CatalogSort | undefined; label: string }[] = [
  { key: undefined, label: vi.browse.sort.suggested },
  { key: 'best_seller', label: vi.browse.sort.best_seller },
  { key: 'newest', label: vi.browse.sort.newest },
  { key: 'price_asc', label: vi.browse.sort.price_asc },
  { key: 'price_desc', label: vi.browse.sort.price_desc },
];

export interface SortChipsProps {
  value?: CatalogSort;
  onChange: (sort: CatalogSort | undefined) => void;
}

/** Hàng chip sắp xếp; đệm dọc 6px để vùng chạm 44px của Chip không bị `.scroll-x` cắt. */
export function SortChips({ value, onChange }: SortChipsProps) {
  return (
    <div role="group" aria-label={vi.browse.sortGroup} className="scroll-x" style={{ gap: 8, padding: '6px 16px' }}>
      {SORT_OPTIONS.map((o) => (
        <Chip
          key={o.label}
          selected={value === o.key}
          onPress={() => {
            if (value === o.key) return;
            haptic('light');
            onChange(o.key);
          }}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
```

`apps/miniapp/src/components/catalog/result-header.tsx`:

```tsx
import { SlidersHorizontal, X } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { ActiveFilterChip, SearchState } from '../../utils/search-state';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

export interface ResultHeaderProps {
  total: number;
  isLoading: boolean;
  chips: ActiveFilterChip[];
  filterCount: number;
  filtersIgnored: boolean;
  onOpenFilters: () => void;
  onPatch: (patch: Partial<SearchState>) => void;
}

/** Số kết quả + nút "Bộ lọc" + chip đang lọc gỡ được (spec 5b.2 "Hiển thị số kết quả"). */
export function ResultHeader({ total, isLoading, chips, filterCount, filtersIgnored, onOpenFilters, onPatch }: ResultHeaderProps) {
  return (
    <div style={{ padding: '4px 16px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <p aria-live="polite" data-testid="result-count" style={{ margin: 0, minWidth: 0 }}>
          <Text variant="body-sm" tone="secondary">
            {isLoading ? ' ' : vi.browse.resultCount(total)}
          </Text>
        </p>
        <Button variant="secondary" icon={SlidersHorizontal} onPress={onOpenFilters} style={{ minWidth: 0, flex: '0 0 auto' }}>
          {filterCount > 0 ? vi.browse.filterButtonCount(filterCount) : vi.browse.filterButton}
        </Button>
      </div>
      {chips.length > 0 && (
        <div role="group" aria-label={vi.browse.activeFilters} className="scroll-x" style={{ gap: 8, padding: '6px 0' }}>
          {chips.map((c) => (
            <Chip key={c.key} selected ariaLabel={vi.browse.removeFilter(c.label)} onPress={() => onPatch(c.patch)}>
              {c.label}
              <Icon icon={X} size="sm" tone="inverse" />
            </Chip>
          ))}
        </div>
      )}
      {filtersIgnored && (
        <Text variant="caption" tone="warning" as="p">
          {vi.browse.filtersIgnored}
        </Text>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/catalog` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/catalog/category-grid.tsx apps/miniapp/src/components/catalog/sort-chips.tsx apps/miniapp/src/components/catalog/result-header.tsx apps/miniapp/src/components/catalog/catalog-controls.spec.tsx
git commit -m "feat(miniapp): category grid, sort chips and result header with removable filter chips (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Miniapp — `FilterSheet` (price, in stock, rating ≥4, brand; live result count)

**Files:**
- Create: `apps/miniapp/src/components/catalog/filter-sheet.tsx`
- Test: `apps/miniapp/src/components/catalog/filter-sheet.spec.tsx`

**Interfaces:**
- Consumes: `fetchCatalog`, `CatalogPage` (Task 8); `SearchState`, `FilterDraft`, `PRICE_RANGES`, `MIN_RATING_OPTION`, `draftFromState`, `parseSearchState`, `serializeSearchState`, `toCatalogQuery`, `priceRangeLabel` (Task 9); `useDebounced`; `BottomSheet`, `Button`, `Chip`, `Text`.
- Produces:
  - `FILTER_COUNT_DEBOUNCE_MS = 250`
  - `applyLabel(p: { settled: boolean; data?: CatalogPage; isError: boolean }): string`
  - `FilterSheet({ open: boolean; onClose: () => void; state: SearchState; brands: { brand: string; count: number }[]; onApply: (draft: FilterDraft) => void })` — draft initialised from `state` during the render in which `open` turns true (no stale frame), kept while closing (no empty content during the slide-down); count query key `['products', 'count', <canonical draft URL>]`, `limit=1`, enabled only while open.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/components/catalog/filter-sheet.spec.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchCatalog: vi.fn() }));
vi.mock('../../services/shop-api', () => ({ fetchCatalog: mocks.fetchCatalog }));

import { EMPTY_SEARCH_STATE, type SearchState } from '../../utils/search-state';
import { FilterSheet, applyLabel } from './filter-sheet';

const BRANDS = [{ brand: 'Tubu', count: 28 }, { brand: 'Mộc An', count: 2 }];
const page = (total: number, filtersIgnored = false) => ({ data: [], meta: { page: 1, limit: 1, total }, filtersIgnored });

function renderSheet(props: { open: boolean; state?: SearchState; onApply?: () => void; onClose?: () => void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = { state: EMPTY_SEARCH_STATE, onApply: vi.fn(), onClose: vi.fn(), brands: BRANDS, ...props };
  const ui = (p: typeof all) => (
    <QueryClientProvider client={qc}>
      <FilterSheet open={p.open} onClose={p.onClose} state={p.state} brands={p.brands} onApply={p.onApply} />
    </QueryClientProvider>
  );
  const r = render(ui(all));
  return { ...all, rerender: (p: Partial<typeof all>) => r.rerender(ui({ ...all, ...p })) };
}

describe('applyLabel', () => {
  it('đang gõ/đếm → "Xem kết quả"; có số → "Xem n sản phẩm"; lỗi hoặc API cũ → "Áp dụng"', () => {
    expect(applyLabel({ settled: false, isError: false })).toBe('Xem kết quả');
    expect(applyLabel({ settled: true, data: page(1234), isError: false })).toBe('Xem 1.234 sản phẩm');
    expect(applyLabel({ settled: true, isError: true })).toBe('Áp dụng');
    expect(applyLabel({ settled: true, data: page(9, true), isError: false })).toBe('Áp dụng');
  });
});

describe('FilterSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCatalog.mockResolvedValue(page(7));
  });

  it('mở với nháp lấy từ trạng thái hiện tại (chip đang bật)', async () => {
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, inStock: true, brands: ['Tubu'] } });
    expect(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tubu' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mộc An' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('chọn giá + còn hàng + từ 4★ + thương hiệu → đếm bằng limit=1 → "Xem n sản phẩm" → onApply(nháp)', async () => {
    const p = renderSheet({ open: true });
    fireEvent.click(await screen.findByRole('button', { name: '100k–200k' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Từ 4★ trở lên' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tubu' }));
    mocks.fetchCatalog.mockResolvedValue(page(3));
    const apply = await screen.findByRole('button', { name: 'Xem 3 sản phẩm' }, { timeout: 2000 });
    expect(mocks.fetchCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, limit: 1, minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4, brand: 'Tubu' }),
    );
    fireEvent.click(apply);
    expect(p.onApply).toHaveBeenCalledWith({ brands: ['Tubu'], minPrice: 100000, maxPrice: 200000, inStock: true, minRating: 4 });
  });

  it('chạm lại khoảng giá đang chọn → bỏ chọn', async () => {
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, maxPrice: 100000 } });
    const chip = await screen.findByRole('button', { name: 'Dưới 100k' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('"Xoá bộ lọc" đưa nháp về rỗng (sheet vẫn mở)', async () => {
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, inStock: true, minRating: 4 } });
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá bộ lọc' }));
    expect(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Từ 4★ trở lên' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('đóng không áp dụng rồi mở lại → nháp chưa áp dụng bị bỏ, lấy lại từ trạng thái', async () => {
    const p = renderSheet({ open: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' }));
    p.rerender({ open: false });
    p.rerender({ open: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chỉ hiện còn hàng' })).toHaveAttribute('aria-pressed', 'false'));
  });

  it('API cũ (filtersIgnored) → nút "Áp dụng", không hiện số sai', async () => {
    mocks.fetchCatalog.mockResolvedValue(page(30, true));
    renderSheet({ open: true, state: { ...EMPTY_SEARCH_STATE, inStock: true } });
    expect(await screen.findByRole('button', { name: 'Áp dụng' }, { timeout: 2000 })).toBeInTheDocument();
  });

  it('đóng → không gọi đếm', () => {
    renderSheet({ open: false });
    expect(mocks.fetchCatalog).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog/filter-sheet.spec.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/catalog/filter-sheet.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCatalog, type CatalogPage } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { useDebounced } from '../../utils/use-debounced';
import {
  MIN_RATING_OPTION, PRICE_RANGES, draftFromState, parseSearchState, priceRangeLabel, serializeSearchState, toCatalogQuery,
  type FilterDraft, type SearchState,
} from '../../utils/search-state';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Text } from '../ui/text';

export const FILTER_COUNT_DEBOUNCE_MS = 250;

/** Nhãn nút áp dụng (plan 4b Ruling 18) — không bao giờ disable nút. */
export function applyLabel(p: { settled: boolean; data?: CatalogPage; isError: boolean }): string {
  if (!p.settled) return vi.browse.filter.applyLoading;
  if (p.data && !p.data.filtersIgnored) return vi.browse.filter.apply(p.data.meta.total);
  if (p.isError || p.data?.filtersIgnored) return vi.browse.filter.applyFallback;
  return vi.browse.filter.applyLoading;
}

export interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  state: SearchState;
  brands: { brand: string; count: number }[];
  onApply: (draft: FilterDraft) => void;
}

/**
 * Bộ lọc trong BottomSheet (spec 5b.2): khoảng giá, chỉ còn hàng, đánh giá ≥4, thương hiệu; áp dụng
 * bằng nút có số kết quả. Nháp khởi tạo NGAY trong lượt render mở sheet (bài học ReorderSheet 4a:
 * không lộ 1 khung hình nháp cũ) và GIỮ NGUYÊN khi đóng (nội dung không trống lúc trượt xuống).
 */
export function FilterSheet({ open, onClose, state, brands, onApply }: FilterSheetProps) {
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromState(state));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(draftFromState(state));
  }

  const previewKey = serializeSearchState({ ...state, ...draft }).toString();
  const countKey = useDebounced(previewKey, FILTER_COUNT_DEBOUNCE_MS);
  const count = useQuery({
    queryKey: ['products', 'count', countKey],
    // queryFn suy ra từ CHÍNH khoá → số đếm luôn khớp đúng bộ lọc của khoá đó.
    queryFn: () => fetchCatalog(toCatalogQuery(parseSearchState(new URLSearchParams(countKey)), 1, 1)),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const label = applyLabel({ settled: countKey === previewKey, data: count.data, isError: count.isError });

  const toggleBrand = (b: string) =>
    setDraft((d) => ({ ...d, brands: d.brands.includes(b) ? d.brands.filter((x) => x !== b) : [...d.brands, b] }));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={vi.browse.filter.title}
      size="auto"
      footer={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onPress={() => setDraft({ brands: [], inStock: false })} style={{ minWidth: 0 }}>
            {vi.browse.filter.reset}
          </Button>
          <Button onPress={() => onApply(draft)} style={{ minWidth: 0, flex: 1 }}>
            {label}
          </Button>
        </div>
      }
    >
      <FilterGroup title={vi.browse.filter.price}>
        {PRICE_RANGES.map((r) => {
          const selected = draft.minPrice === r.min && draft.maxPrice === r.max;
          return (
            <Chip
              key={r.key}
              selected={selected}
              onPress={() =>
                setDraft((d) => (selected ? { ...d, minPrice: undefined, maxPrice: undefined } : { ...d, minPrice: r.min, maxPrice: r.max }))
              }
            >
              {priceRangeLabel(r.min, r.max)}
            </Chip>
          );
        })}
      </FilterGroup>
      <FilterGroup title={vi.browse.filter.availability}>
        <Chip selected={draft.inStock} onPress={() => setDraft((d) => ({ ...d, inStock: !d.inStock }))}>
          {vi.browse.filter.inStock}
        </Chip>
      </FilterGroup>
      <FilterGroup title={vi.browse.filter.rating}>
        <Chip
          selected={draft.minRating === MIN_RATING_OPTION}
          onPress={() => setDraft((d) => ({ ...d, minRating: d.minRating === MIN_RATING_OPTION ? undefined : MIN_RATING_OPTION }))}
        >
          {vi.browse.filter.rating4}
        </Chip>
      </FilterGroup>
      {brands.length > 0 && (
        <FilterGroup title={vi.browse.filter.brand}>
          {brands.map((b) => (
            <Chip key={b.brand} selected={draft.brands.includes(b.brand)} onPress={() => toggleBrand(b.brand)}>
              {b.brand}
            </Chip>
          ))}
        </FilterGroup>
      )}
    </BottomSheet>
  );
}

/** Nhóm chip; đệm dọc 4px để vùng chạm 44px của Chip không bị khung cuộn của sheet cắt. */
function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} style={{ paddingTop: 12 }}>
      <Text variant="label" tone="secondary" as="div" style={{ marginBottom: 4 }}>
        {title}
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 0' }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/catalog/filter-sheet.tsx` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/catalog/filter-sheet.tsx apps/miniapp/src/components/catalog/filter-sheet.spec.tsx
git commit -m "feat(miniapp): filter sheet with price, in-stock, rating and brand plus a live result count (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Miniapp — `SuggestList` (keyword, recent searches, categories, products)

**Files:**
- Create: `apps/miniapp/src/components/catalog/suggest-list.tsx`
- Test: `apps/miniapp/src/components/catalog/suggest-list.spec.tsx`

**Interfaces:**
- Consumes: `ProductSuggestion` (`shop-api.ts`); `CategoryEntry` (Task 11); `SUGGEST_MIN_CHARS` (Task 11); `includesFolded` (Task 8); `ListRow`, `Icon`, `PriceTag`, `Button`, `Text` (`components/ui`).
- Produces: `SUGGEST_LIMITS = { recent: 3, categories: 4 }`; `SuggestList({ draft: string; recent: string[]; categories: CategoryEntry[]; products: ProductSuggestion[]; loading: boolean; onPickKeyword: (term: string) => void; onPickCategory: (entry: CategoryEntry) => void; onPickProduct: (p: ProductSuggestion, index: number) => void; onClearRecent: () => void })` — `<section aria-label="Gợi ý tìm kiếm">`. Empty draft: all recent keywords + "Xoá lịch sử tìm". Non-empty draft: first row "Tìm “{draft}”", then recent (folded match, ≤3), categories (folded match, ≤4), products (as returned, ≤8); "no suggestion" text only when the draft has ≥2 chars, nothing matched and nothing is loading.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/components/catalog/suggest-list.spec.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Baby, SprayCan } from 'lucide-react';
import { SuggestList } from './suggest-list';

const CATS = [
  { kind: 'segment' as const, key: 'mom_baby', label: 'Cho mẹ & bé', icon: Baby },
  { kind: 'segment' as const, key: 'home_clean', label: 'Nhà bếp xanh', icon: SprayCan },
];
const PRODUCTS = [
  { slug: 'nrc', name: 'Nước rửa chén Tubu', thumbnail: null, basePrice: 65000 },
  { slug: 'nrbs', name: 'Nước rửa bình sữa', thumbnail: null, basePrice: 90000 },
];
function renderList(over: Partial<Parameters<typeof SuggestList>[0]> = {}) {
  const props = {
    draft: '', recent: ['nước rửa', 'xà phòng'], categories: CATS, products: [], loading: false,
    onPickKeyword: vi.fn(), onPickCategory: vi.fn(), onPickProduct: vi.fn(), onClearRecent: vi.fn(), ...over,
  };
  render(<SuggestList {...props} />);
  return props;
}

describe('SuggestList', () => {
  it('chưa gõ → toàn bộ "Tìm gần đây" + nút xoá lịch sử; chạm từ khoá → onPickKeyword', () => {
    const p = renderList();
    const recent = screen.getByRole('group', { name: 'Tìm gần đây' });
    expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['nước rửa', 'xà phòng', 'Xoá lịch sử tìm']);
    fireEvent.click(screen.getByRole('button', { name: 'xà phòng' }));
    expect(p.onPickKeyword).toHaveBeenCalledWith('xà phòng');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá lịch sử tìm' }));
    expect(p.onClearRecent).toHaveBeenCalled();
  });

  it('gõ không dấu → dòng "Tìm “…”", từ khoá gần đây + danh mục khớp không dấu, sản phẩm gợi ý theo thứ tự', () => {
    const p = renderList({ draft: 'nuoc', products: PRODUCTS, recent: ['nước rửa', 'xà phòng'] });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm “nuoc”' }));
    expect(p.onPickKeyword).toHaveBeenCalledWith('nuoc');
    expect(within(screen.getByRole('group', { name: 'Tìm gần đây' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['nước rửa']);
    expect(screen.queryByRole('group', { name: 'Danh mục' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Nước rửa bình sữa/ }));
    expect(p.onPickProduct).toHaveBeenCalledWith(PRODUCTS[1], 1);
  });

  it('danh mục khớp không dấu → chạm → onPickCategory', () => {
    const p = renderList({ draft: 'bep', recent: [] });
    fireEvent.click(within(screen.getByRole('group', { name: 'Danh mục' })).getByRole('button', { name: 'Nhà bếp xanh' }));
    expect(p.onPickCategory).toHaveBeenCalledWith(CATS[1]);
  });

  it('không có gợi ý nào (≥2 ký tự, đã tải xong) → câu hướng dẫn; đang tải → chưa hiện câu đó', () => {
    renderList({ draft: 'zzz', recent: [], loading: true });
    expect(screen.queryByText(/Chưa có gợi ý/)).toBeNull();
  });

  it('không có gợi ý, đã tải xong → câu hướng dẫn', () => {
    renderList({ draft: 'zzz', recent: [] });
    expect(screen.getByText('Chưa có gợi ý — nhấn Tìm để xem kết quả')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog/suggest-list.spec.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/catalog/suggest-list.tsx`:

```tsx
import type { ReactNode } from 'react';
import { History, Search } from 'lucide-react';
import type { CategoryEntry } from '../../hooks/use-categories';
import { SUGGEST_MIN_CHARS } from '../../hooks/use-suggest';
import type { ProductSuggestion } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { includesFolded } from '../../utils/vn-fold';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { PriceTag } from '../ui/price-tag';
import { Text } from '../ui/text';

export const SUGGEST_LIMITS = { recent: 3, categories: 4 } as const;

export interface SuggestListProps {
  draft: string;
  recent: string[];
  categories: CategoryEntry[];
  products: ProductSuggestion[];
  loading: boolean;
  onPickKeyword: (term: string) => void;
  onPickCategory: (entry: CategoryEntry) => void;
  onPickProduct: (product: ProductSuggestion, index: number) => void;
  onClearRecent: () => void;
}

/** Gợi ý khi gõ (spec 5b.2): từ khoá gần đây + danh mục (khớp không dấu ở client) + sản phẩm (API). */
export function SuggestList({ draft, recent, categories, products, loading, onPickKeyword, onPickCategory, onPickProduct, onClearRecent }: SuggestListProps) {
  const term = draft.trim();
  const recentShown = term ? recent.filter((r) => includesFolded(r, term)).slice(0, SUGGEST_LIMITS.recent) : recent;
  const categoriesShown = term ? categories.filter((c) => includesFolded(c.label, term)).slice(0, SUGGEST_LIMITS.categories) : [];
  const nothing =
    term.length >= SUGGEST_MIN_CHARS && !loading && recentShown.length === 0 && categoriesShown.length === 0 && products.length === 0;

  return (
    <section aria-label={vi.browse.suggest.title} style={{ padding: '0 16px 24px' }}>
      {term && <ListRow icon={<Icon icon={Search} size="sm" tone="muted" />} title={vi.browse.suggest.searchFor(term)} onPress={() => onPickKeyword(term)} />}
      {recentShown.length > 0 && (
        <Group
          title={vi.browse.suggest.recent}
          action={
            term ? undefined : (
              <Button variant="ghost" onPress={onClearRecent} style={{ minWidth: 0 }}>
                {vi.browse.suggest.clearRecent}
              </Button>
            )
          }
        >
          {recentShown.map((r) => (
            <ListRow key={r} icon={<Icon icon={History} size="sm" tone="muted" />} title={r} onPress={() => onPickKeyword(r)} />
          ))}
        </Group>
      )}
      {categoriesShown.length > 0 && (
        <Group title={vi.browse.suggest.categories}>
          {categoriesShown.map((c) => (
            <ListRow key={`${c.kind}:${c.key}`} icon={<Icon icon={c.icon} size="sm" tone="brand" />} title={c.label} onPress={() => onPickCategory(c)} />
          ))}
        </Group>
      )}
      {products.length > 0 && (
        <Group title={vi.browse.suggest.products}>
          {products.map((p, i) => (
            <ListRow key={p.slug} icon={<Thumb src={p.thumbnail} />} title={p.name} subtitle={<PriceTag value={p.basePrice} size="sm" />} onPress={() => onPickProduct(p, i)} />
          ))}
        </Group>
      )}
      {nothing && (
        <Text variant="body-sm" tone="tertiary" as="p" style={{ padding: '12px 0' }}>
          {vi.browse.suggest.none}
        </Text>
      )}
    </section>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
        <Text variant="label" tone="secondary">
          {title}
        </Text>
        {action}
      </div>
      {children}
    </div>
  );
}

function Thumb({ src }: { src: string | null }) {
  return (
    <div style={{ width: 40, height: 40, flex: '0 0 auto', borderRadius: 'var(--radius-control)', overflow: 'hidden', background: 'var(--stone-100)' }}>
      {src && <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/catalog/suggest-list.tsx` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/catalog/suggest-list.tsx apps/miniapp/src/components/catalog/suggest-list.spec.tsx
git commit -m "feat(miniapp): search suggestions with recent keywords, unaccented category matches and products (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 17: Miniapp — `RecentlyViewedRail`

**Files:**
- Create: `apps/miniapp/src/components/catalog/recently-viewed-rail.tsx`
- Test: `apps/miniapp/src/components/catalog/recently-viewed-rail.spec.tsx`

**Interfaces:**
- Consumes: `useRecentlyViewed` (Task 10), `recordRecentlyViewed` (Task 10, tests only); `Heading`, `Text`, `PriceTag`; `vi.browse.recentlyViewed`; `haptic`.
- Produces: `RecentlyViewedRail({ title?: string })` — renders **nothing** when empty; otherwise `<section aria-label="Đã xem gần đây">` with a horizontal row of 120px card buttons (`aria-label` = product name) → `navigate('/product/<slug>', { state: { listSource: 'recently_viewed' } })`.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/components/catalog/recently-viewed-rail.spec.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('zmp-ui')>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { recordRecentlyViewed } from '../../utils/recently-viewed';
import { RecentlyViewedRail } from './recently-viewed-rail';

describe('RecentlyViewedRail (spec 5b.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('chưa xem gì → không render (ẩn im lặng, spec §9)', () => {
    const { container } = render(<RecentlyViewedRail />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mới xem nhất đứng đầu; chạm → PDP với listSource=recently_viewed', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 45000 }, 1);
    recordRecentlyViewed({ slug: 'b', name: 'Sản phẩm B', thumbnail: null, price: 65000 }, 2);
    render(<RecentlyViewedRail />);
    const region = screen.getByRole('region', { name: 'Đã xem gần đây' });
    expect(Array.from(region.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Sản phẩm B', 'Sản phẩm A']);
    expect(region).toHaveTextContent('65.000');
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm A' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/a', { state: { listSource: 'recently_viewed' } });
  });

  it('cập nhật ngay khi có lượt xem mới (cùng tab)', () => {
    const { container } = render(<RecentlyViewedRail />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      recordRecentlyViewed({ slug: 'c', name: 'Sản phẩm C', thumbnail: null, price: 1000 });
    });
    expect(screen.getByRole('button', { name: 'Sản phẩm C' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog/recently-viewed-rail.spec.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/catalog/recently-viewed-rail.tsx`:

```tsx
import { useNavigate } from 'zmp-ui';
import { useRecentlyViewed } from '../../hooks/use-recently-viewed';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { PriceTag } from '../ui/price-tag';
import { Heading, Text } from '../ui/text';

const CARD_WIDTH = 120;

/**
 * "Đã xem gần đây" (spec 5b.4) — thẻ riêng gọn, KHÔNG dùng ProductTile: dữ liệu lưu ở máy không có
 * đánh giá/id sản phẩm, ProductTile sẽ in "★ Mới" sai và tim yêu thích không có id (plan 4b Ruling 11).
 */
export function RecentlyViewedRail({ title = vi.browse.recentlyViewed }: { title?: string }) {
  const navigate = useNavigate();
  const items = useRecentlyViewed();
  if (items.length === 0) return null;
  return (
    <section aria-label={title} style={{ padding: '8px 0 12px' }}>
      <div style={{ padding: '0 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
      </div>
      <div className="scroll-x" style={{ gap: 10, padding: '0 16px' }}>
        {items.map((it) => (
          <button
            key={it.slug}
            type="button"
            aria-label={it.name}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              navigate(`/product/${it.slug}`, { state: { listSource: 'recently_viewed' } });
            }}
            style={{
              flex: `0 0 ${CARD_WIDTH}px`,
              width: CARD_WIDTH,
              padding: 0,
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              background: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--elevation-1)',
              overflow: 'hidden',
            }}
          >
            <div style={{ aspectRatio: '1 / 1', background: 'var(--stone-100)' }}>
              {it.thumbnail && <img src={it.thumbnail} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            </div>
            <div style={{ padding: 8 }}>
              <Text
                variant="caption"
                as="div"
                style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 40 }}
              >
                {it.name}
              </Text>
              <PriceTag value={it.price} size="sm" />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/catalog` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/catalog/recently-viewed-rail.tsx` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/catalog/recently-viewed-rail.tsx apps/miniapp/src/components/catalog/recently-viewed-rail.spec.tsx
git commit -m "feat(miniapp): recently viewed rail that hides itself when empty (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 18: Miniapp — rewrite `pages/browse.tsx` on DS v2

**Files:**
- Rewrite: `apps/miniapp/src/pages/browse.tsx`
- Create: `apps/miniapp/src/pages/browse.spec.tsx`

**Interfaces:**
- Consumes: everything from Tasks 8–17: `fetchCatalog`, `fetchBrands`, `ProductCard`, `ProductSuggestion`; `trackFilterApplied`, `trackSearchPerformed`, `trackSearchResultClicked`; `useSearchState`; `useCategories`, `segmentLabel`, `CategoryEntry`; `useSuggest`; `useScrollRestoration`; `readRecentSearches`, `pushRecentSearch`, `clearRecentSearches`; `CLEAR_SEARCH_PATCH`, `activeFilterChips`, `activeFilterCount`, `changedFilterTypes`, `isBrowseRoot`, `toCatalogQuery`, `FilterDraft`; `SearchField`, `Button`, `EmptyState`, `ErrorState`, `CartButton`, `PullToRefresh`; `CatalogGrid`, `CatalogGridSkeleton`, `CategoryGrid`, `SortChips`, `ResultHeader`, `FilterSheet`, `SuggestList`, `RecentlyViewedRail`.
- Produces: the `/browse` route. Contract used by e2e (Tasks 25–26): searchbox name "Tìm sản phẩm"; while editing a "Hủy" button replaces the cart; `SuggestList` replaces the content while editing; result list query key `['products', 'browse', urlKey]`, `limit=30`; list source `search` (with `q`) or `browse`.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/pages/browse.spec.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), fetchCatalog: vi.fn(), fetchBrands: vi.fn(), fetchCategories: vi.fn(), suggestProducts: vi.fn(),
  trackFilterApplied: vi.fn(), trackSearchPerformed: vi.fn(), trackSearchResultClicked: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchCatalog: mocks.fetchCatalog, fetchBrands: mocks.fetchBrands, fetchCategories: mocks.fetchCategories,
  suggestProducts: mocks.suggestProducts, fetchActiveFlashSales: vi.fn().mockResolvedValue([]), getCart: vi.fn(),
}));
vi.mock('../services/discovery-events', () => ({
  trackFilterApplied: mocks.trackFilterApplied, trackSearchPerformed: mocks.trackSearchPerformed, trackSearchResultClicked: mocks.trackSearchResultClicked,
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'idle' }) }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import BrowsePage from './browse';

const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true });
const pageOf = (data: ReturnType<typeof card>[], filtersIgnored = false) => ({ data, meta: { page: 1, limit: 30, total: data.length }, filtersIgnored });

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}
function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <BrowsePage />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const loc = () => screen.getByTestId('loc').textContent;
const catalogCalls = () => mocks.fetchCatalog.mock.calls.map(([q]) => q as Record<string, unknown>);

describe('BrowsePage (DS v2, spec 5b.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mocks.fetchCatalog.mockResolvedValue(pageOf([card('p1', 'Nước rửa chén'), card('p2', 'Xà phòng')]));
    mocks.fetchBrands.mockResolvedValue([{ brand: 'Tubu', count: 2 }]);
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.suggestProducts.mockResolvedValue([]);
  });

  it('gốc: Danh mục (4 phân khúc khi chưa có danh mục thật), sắp xếp, số kết quả, lưới SP; không còn "Xu hướng"', async () => {
    renderAt('/browse');
    expect(await screen.findByRole('button', { name: 'Cho mẹ & bé' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
    expect(await screen.findByText('2 sản phẩm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nước rửa chén' })).toBeInTheDocument();
    expect(screen.queryByText('Xu hướng')).toBeNull();
    expect(catalogCalls()[0]).toMatchObject({ page: 1, limit: 30, q: undefined });
  });

  it('?focus=search: ô tìm được focus, bỏ focus khỏi URL, hiện gợi ý thay nội dung + nút "Hủy"', async () => {
    renderAt('/browse?focus=search');
    const input = screen.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await waitFor(() => expect(loc()).toBe('/browse'));
    expect(screen.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument();
  });

  it('gõ chỉ gợi ý (không tải kết quả); Enter mới ghi q vào URL, lưu từ khoá gần đây, bắn search_performed', async () => {
    renderAt('/browse');
    const input = screen.getByRole('searchbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nuoc rua' } });
    await waitFor(() => expect(mocks.suggestProducts).toHaveBeenCalledWith('nuoc rua'));
    expect(catalogCalls().some((q) => q.q === 'nuoc rua')).toBe(false);
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(loc()).toBe('/browse?q=nuoc+rua'));
    await waitFor(() => expect(catalogCalls().some((q) => q.q === 'nuoc rua' && q.limit === 30)).toBe(true));
    await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledWith({ q: 'nuoc rua', resultsCount: 2 }));
    expect(JSON.parse(localStorage.getItem('tubu_recent_searches')!)).toEqual(['nuoc rua']);
  });

  it('chip "Bán chạy" → URL sort=best_seller (replace) → tải lại với sort', async () => {
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Bán chạy' }));
    await waitFor(() => expect(loc()).toBe('/browse?sort=best_seller'));
    await waitFor(() => expect(catalogCalls().some((q) => q.sort === 'best_seller')).toBe(true));
  });

  it('áp dụng bộ lọc → URL đủ tham số + filter_applied cho từng loại đổi', async () => {
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Bộ lọc' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Từ 4★ trở lên' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Xem 2 sản phẩm$/ }, { timeout: 2000 }));
    await waitFor(() => expect(loc()).toBe('/browse?inStock=1&rating=4'));
    expect(mocks.trackFilterApplied.mock.calls.map(([t]) => t)).toEqual(['in_stock', 'rating']);
    expect(await screen.findByRole('button', { name: 'Bỏ lọc Còn hàng' })).toBeInTheDocument();
  });

  it('link cũ ?brand=Tubu → chip gỡ được; gỡ → URL sạch', async () => {
    renderAt('/browse?brand=Tubu');
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ lọc Tubu' }));
    await waitFor(() => expect(loc()).toBe('/browse'));
  });

  it('chạm kết quả khi đang tìm → search_result_clicked { q, position (1-based), source, slug }', async () => {
    renderAt('/browse?q=nuoc');
    fireEvent.click(await screen.findByRole('button', { name: 'Xà phòng' }));
    expect(mocks.trackSearchResultClicked).toHaveBeenCalledWith({ q: 'nuoc', position: 2, source: 'results', slug: 'p2' });
    expect(mocks.navigate).toHaveBeenCalledWith('/product/p2', { state: { listSource: 'search' } });
  });

  it('API cũ bỏ qua bộ lọc → câu báo nhẹ, vẫn có kết quả', async () => {
    mocks.fetchCatalog.mockResolvedValue(pageOf([card('p1', 'Nước rửa chén')], true));
    renderAt('/browse?inStock=1');
    expect(await screen.findByText(/Bộ lọc nâng cao chưa dùng được/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nước rửa chén' })).toBeInTheDocument();
  });

  it('không có kết quả → EmptyState + "Xoá tìm kiếm & bộ lọc" (giữ sort)', async () => {
    mocks.fetchCatalog.mockResolvedValue(pageOf([]));
    renderAt('/browse?q=zzz&inStock=1&sort=newest');
    expect(await screen.findByText('Không tìm thấy "zzz"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá tìm kiếm & bộ lọc' }));
    await waitFor(() => expect(loc()).toBe('/browse?sort=newest'));
  });

  it('lỗi tải → ErrorState "Thử lại" gọi lại', async () => {
    mocks.fetchCatalog.mockRejectedValueOnce(new Error('network'));
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.fetchCatalog.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/pages/browse.spec.tsx`
Expected: FAIL — the legacy page uses zmp `Input.Search` (no `searchbox` named "Tìm sản phẩm"), "Xu hướng", local state instead of URL.

- [ ] **Step 3: Rewrite the page**

Replace the whole content of `apps/miniapp/src/pages/browse.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchBrands, fetchCatalog, type ProductCard, type ProductSuggestion } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { trackFilterApplied, trackSearchPerformed, trackSearchResultClicked } from '../services/discovery-events';
import { CartButton } from '../components/cart-button';
import { PullToRefresh } from '../components/pull-to-refresh';
import { CatalogGrid, CatalogGridSkeleton } from '../components/catalog/catalog-grid';
import { CategoryGrid } from '../components/catalog/category-grid';
import { FilterSheet } from '../components/catalog/filter-sheet';
import { RecentlyViewedRail } from '../components/catalog/recently-viewed-rail';
import { ResultHeader } from '../components/catalog/result-header';
import { SortChips } from '../components/catalog/sort-chips';
import { SuggestList } from '../components/catalog/suggest-list';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { SearchField } from '../components/ui/search-field';
import { segmentLabel, useCategories, type CategoryEntry } from '../hooks/use-categories';
import { useScrollRestoration } from '../hooks/use-scroll-restoration';
import { useSearchState } from '../hooks/use-search-state';
import { useSuggest } from '../hooks/use-suggest';
import { vi } from '../i18n/vi';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from '../utils/recent-searches';
import {
  CLEAR_SEARCH_PATCH, activeFilterChips, activeFilterCount, changedFilterTypes, isBrowseRoot, toCatalogQuery, type FilterDraft,
} from '../utils/search-state';

const PAGE_LIMIT = 30;

/**
 * Trang Danh mục / Tìm kiếm (spec 5b.2) — DS v2. Toàn bộ trạng thái (q, sắp xếp, lọc, danh mục,
 * phân khúc, thương hiệu) nằm trong URL (`useSearchState`, replace) → quay lại từ PDP giữ nguyên,
 * vị trí cuộn khôi phục theo khoá URL. Gõ chỉ hiện GỢI Ý; Enter / chạm gợi ý mới ghi `q`.
 */
export default function BrowsePage() {
  const navigate = useNavigate();
  const { state, urlKey, focusSearch, update, consumeFocus } = useSearchState();
  const inputRef = useRef<HTMLInputElement>(null);

  // Ô nhập theo `q` của URL mỗi khi URL đổi từ ngoài (Back, chạm từ khoá) — đặt trong render, không qua effect.
  const [draft, setDraft] = useState(state.q);
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (syncedQ !== state.q) {
    setSyncedQ(state.q);
    setDraft(state.q);
  }
  const [editing, setEditing] = useState(focusSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());

  // Ô tìm ở Trang chủ chỉ là vỏ dẫn sang đây (?focus=search): focus thẳng ô thật rồi bỏ cờ khỏi URL
  // — quay lại từ PDP sẽ không bật bàn phím lần nữa (plan 4b Ruling 7).
  useEffect(() => {
    if (!focusSearch) return;
    inputRef.current?.focus();
    setEditing(true);
    consumeFocus();
  }, [focusSearch, consumeFocus]);

  // Brand/category đổi chậm (sync Pancake ~15p/lần) → cache 60s.
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000 });
  const categories = useCategories();
  const suggest = useSuggest(editing ? draft : '');

  const products = useInfiniteQuery({
    queryKey: ['products', 'browse', urlKey],
    queryFn: ({ pageParam }) => fetchCatalog(toCatalogQuery(state, pageParam, PAGE_LIMIT)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const firstPage = products.data?.pages[0];
  const list = products.data?.pages.flatMap((pg) => pg.data) ?? [];

  // Phụ thuộc PHẦN TỬ trang 1, không phải cả mảng `pages` — "Xem thêm" tạo mảng mới mà trang 1 giữ
  // nguyên tham chiếu, nên không bắn lại cho cùng một lượt tìm (review 2026-09-28).
  useEffect(() => {
    if (!state.q || !firstPage) return;
    trackSearchPerformed({ q: state.q, resultsCount: firstPage.meta.total });
  }, [state.q, firstPage]);

  const { anchorRef } = useScrollRestoration(urlKey, list.length > 0);

  const stopEditing = () => {
    setEditing(false);
    inputRef.current?.blur();
  };
  const commit = (term: string) => {
    const t = term.trim();
    stopEditing();
    setDraft(t);
    if (t.length >= 2) setRecent(pushRecentSearch(t));
    update({ q: t });
  };
  const pickCategory = (e: CategoryEntry) => {
    stopEditing();
    update(e.kind === 'category' ? { category: e.key, segment: undefined, q: '' } : { segment: e.key, category: undefined, q: '' });
  };
  const pickSuggestion = (p: ProductSuggestion, index: number) => {
    trackSearchResultClicked({ q: draft.trim(), position: index + 1, source: 'suggest', slug: p.slug });
    stopEditing();
    navigate(`/product/${p.slug}`, { state: { listSource: 'search_suggest' } });
  };
  const openResult = (p: ProductCard, index: number) => {
    if (state.q) trackSearchResultClicked({ q: state.q, position: index + 1, source: 'results', slug: p.slug });
  };
  const applyFilters = (d: FilterDraft) => {
    for (const t of changedFilterTypes(state, d)) trackFilterApplied(t);
    setFiltersOpen(false);
    update({ brands: d.brands, minPrice: d.minPrice, maxPrice: d.maxPrice, inStock: d.inStock, minRating: d.minRating });
  };

  const root = isBrowseRoot(state);
  const categoryName = state.category ? categories.categories.find((c) => c.id === state.category)?.name : undefined;
  const chips = activeFilterChips(state, { categoryName, segmentName: state.segment ? segmentLabel(state.segment) : undefined });

  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PullToRefresh onRefresh={() => Promise.all([products.refetch(), brands.refetch()])} />
      <div ref={anchorRef} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 8px' }}>
        <SearchField
          ref={inputRef}
          value={draft}
          onChange={setDraft}
          onSubmit={commit}
          onFocus={() => setEditing(true)}
          onClear={() => {
            setDraft('');
            if (state.q) update({ q: '' });
          }}
          label={vi.browse.searchLabel}
          clearLabel={vi.browse.clearSearch}
          placeholder={vi.browse.searchPlaceholder}
        />
        {editing ? (
          <Button
            variant="ghost"
            onPress={() => {
              stopEditing();
              setDraft(state.q);
            }}
            style={{ minWidth: 0, padding: '0 8px' }}
          >
            {vi.common.cancel}
          </Button>
        ) : (
          <CartButton />
        )}
      </div>

      {editing ? (
        <SuggestList
          draft={draft}
          recent={recent}
          categories={categories.entries}
          products={suggest.products}
          loading={suggest.isFetching}
          onPickKeyword={commit}
          onPickCategory={pickCategory}
          onPickProduct={pickSuggestion}
          onClearRecent={() => {
            clearRecentSearches();
            setRecent([]);
          }}
        />
      ) : (
        <>
          {root && <CategoryGrid entries={categories.entries} isLoading={categories.isLoading} onSelect={pickCategory} />}
          {root && <RecentlyViewedRail />}
          <SortChips value={state.sort} onChange={(sort) => update({ sort })} />
          <ResultHeader
            total={firstPage?.meta.total ?? 0}
            isLoading={products.isLoading}
            chips={chips}
            filterCount={activeFilterCount(state)}
            filtersIgnored={firstPage?.filtersIgnored ?? false}
            onOpenFilters={() => setFiltersOpen(true)}
            onPatch={update}
          />
          <div style={{ padding: '0 16px 24px' }}>
            {products.isLoading ? (
              <CatalogGridSkeleton count={6} />
            ) : products.isError ? (
              <ErrorState message={getErrorMessage(products.error)} onRetry={() => void products.refetch()} />
            ) : list.length === 0 ? (
              <>
                <EmptyState
                  art={state.q ? 'search' : 'leaf'}
                  heading={state.q ? vi.browse.noResultHeading(state.q) : root ? vi.browse.emptyHeading : vi.browse.noResultFiltered}
                  body={root ? vi.browse.emptyBody : vi.browse.noResultBody}
                  ctaLabel={root ? undefined : vi.browse.clearAll}
                  onCta={root ? undefined : () => update(CLEAR_SEARCH_PATCH)}
                />
                <RecentlyViewedRail />
              </>
            ) : (
              <>
                <CatalogGrid products={list} listSource={state.q ? 'search' : 'browse'} onOpen={openResult} />
                {products.hasNextPage && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 16 }}>
                    <Button
                      variant="secondary"
                      loading={products.isFetchingNextPage}
                      onPress={() => {
                        products.fetchNextPage().catch(() => undefined);
                      }}
                      style={{ minWidth: 160 }}
                    >
                      {vi.browse.loadMore}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} state={state} brands={brands.data ?? []} onApply={applyFilters} />
    </Page>
  );
}
```

- [ ] **Step 4: Run tests, types, lint, existing e2e**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/pages/browse.spec.tsx src/components src/hooks` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/pages/browse.tsx` → **0 errors** (baseline had 2; Ruling 15).
Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test miniapp.spec buy-flow-4a --workers=1 --retries=0` → PASS (Browse is not visited by these specs, but the Danh mục tab is; if the fixture reports an unmocked `GET /categories`, that default arrives in Task 24 — run this step again after Task 24 if so).

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/browse.tsx apps/miniapp/src/pages/browse.spec.tsx
git commit -m "feat(miniapp): Browse rebuilt on DS v2 with suggest, filter sheet, best-seller sort and URL-synced state (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 19: Miniapp — Home block order (`home-blocks.ts`) and `OrderStrip`

**Files:**
- Create: `apps/miniapp/src/components/home/home-blocks.ts`, `apps/miniapp/src/components/home/home-blocks.spec.ts`
- Create: `apps/miniapp/src/components/home/order-strip.tsx`, `apps/miniapp/src/components/home/order-strip.spec.tsx`

**Interfaces:**
- Consumes: `fetchOrders` (`shop-api.ts`), `getSubscriptions`, `SubscriptionDTO` (`subscriptions-api.ts`), `useActiveOrderCount` (4a, `hooks/use-active-order-count.ts`), `useAuthStore`, `ListRow`, `Card`, `Icon`, `vi.home.strip` (Task 8).
- Produces:
  - `type HomeBlockId = 'search' | 'purchased' | 'orderStrip' | 'flash' | 'forYou' | 'bestSellers' | 'categories' | 'recentlyViewed' | 'featured' | 'newArrivals' | 'extras'`
  - `type HomeCustomerKind = 'returning' | 'new'`; `homeBlockOrder(kind): readonly HomeBlockId[]`; `customerKind(purchasedCount: number | undefined): HomeCustomerKind`
  - `HOME_GRID_BLOCKS: readonly HomeBlockId[]` (`forYou`, `bestSellers`, `featured`, `newArrivals`)
  - `HOME_QUERY_PREFIXES` (readonly tuple) and `refreshHomeQueries(qc: QueryClient): Promise<unknown>` (pull-to-refresh, A2-33)
  - `dedupeAgainst<T extends { id: string }>(items: T[], seen: ReadonlySet<string>): T[]`
  - `nextActiveSubscription(subs: SubscriptionDTO[]): SubscriptionDTO | undefined`; `formatDayMonth(iso: string): string`
  - `OrderStrip()` — `<section aria-label="Đơn của bạn">` or nothing; query keys `['orders', 'home-strip']` (enabled only when authenticated and the shared active-order count > 0) and `['subscriptions']`.

- [ ] **Step 1: Write the failing tests**

`apps/miniapp/src/components/home/home-blocks.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { HOME_GRID_BLOCKS, HOME_QUERY_PREFIXES, customerKind, dedupeAgainst, homeBlockOrder, refreshHomeQueries } from './home-blocks';

const firstGrid = (order: readonly string[]) => order.findIndex((b) => (HOME_GRID_BLOCKS as readonly string[]).includes(b)) + 1;

describe('homeBlockOrder (spec 5b.1, plan 4b Ruling 8)', () => {
  it('khách cũ: tìm → Mua lại → dải đơn → Flash → Dành cho bạn → Bán chạy → Danh mục → Đã xem → Tubu chọn → Mới về → phụ', () => {
    expect(homeBlockOrder('returning')).toEqual([
      'search', 'purchased', 'orderStrip', 'flash', 'forYou', 'bestSellers', 'categories', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
    ]);
  });

  it('khách mới: ưu tiên Flash + Bán chạy + Danh mục; ô Mua lại/dải đơn GIỮ CHỖ (tự rỗng) để trang không nhảy khi dữ liệu về', () => {
    expect(homeBlockOrder('new')).toEqual([
      'search', 'purchased', 'orderStrip', 'flash', 'bestSellers', 'categories', 'forYou', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
    ]);
  });

  it('lưới SP đầu tiên nằm trong 5 khối đầu (đầu trang/logo không tính là khối)', () => {
    expect(firstGrid(homeBlockOrder('returning'))).toBeLessThanOrEqual(5);
    expect(firstGrid(homeBlockOrder('new'))).toBeLessThanOrEqual(5);
  });

  it('customerKind: ≥1 SP đã nhận → khách cũ; 0 / chưa biết (đang tải, 404 API cũ) → khách mới', () => {
    expect(customerKind(1)).toBe('returning');
    expect(customerKind(0)).toBe('new');
    expect(customerKind(undefined)).toBe('new');
  });
});

describe('refreshHomeQueries (A2-33: kéo để làm mới phải làm mới ĐỦ)', () => {
  it('invalidate mọi tiền tố query của Trang chủ, gồm for-you, flash, giỏ, Mua lại', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await refreshHomeQueries({ invalidateQueries } as unknown as QueryClient);
    expect(invalidateQueries.mock.calls.map(([f]) => f.queryKey[0])).toEqual([...HOME_QUERY_PREFIXES]);
    expect(HOME_QUERY_PREFIXES).toEqual(expect.arrayContaining(['products', 'for-you', 'flash-sales', 'cart', 'purchased-items', 'orders', 'subscriptions', 'categories']));
  });
});

describe('dedupeAgainst', () => {
  it('bỏ SP đã hiện ở khối trước (A2-32: "Tubu chọn" trùng "Dành cho bạn")', () => {
    expect(dedupeAgainst([{ id: 'a' }, { id: 'b' }], new Set(['a']))).toEqual([{ id: 'b' }]);
  });
});
```

`apps/miniapp/src/components/home/order-strip.spec.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchOrders: vi.fn(), getSubscriptions: vi.fn(), activeCount: 0, status: 'authenticated' }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('zmp-ui')>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchOrders: mocks.fetchOrders }));
vi.mock('../../services/subscriptions-api', () => ({ getSubscriptions: mocks.getSubscriptions }));
vi.mock('../../hooks/use-active-order-count', () => ({ useActiveOrderCount: () => mocks.activeCount }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { OrderStrip, nextActiveSubscription } from './order-strip';

const SUB = (id: string, status: 'ACTIVE' | 'PAUSED', nextRunAt: string) => ({
  id, status, nextRunAt, quantity: 1, intervalWeeks: 4, productName: `SP ${id}`, variationName: '', thumbnail: null, slug: null, unitPrice: 1, effectiveDiscountPct: 0,
});
function renderStrip() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrderStrip /></QueryClientProvider>);
}

describe('OrderStrip — dải "đơn đang giao / kỳ định kỳ kế tiếp" (spec 5b.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeCount = 0;
    mocks.status = 'authenticated';
    mocks.fetchOrders.mockResolvedValue({ data: [], meta: { page: 1, limit: 1, total: 0 } });
    mocks.getSubscriptions.mockResolvedValue([]);
  });

  it('nextActiveSubscription: kỳ ACTIVE sớm nhất (bỏ PAUSED)', () => {
    const subs = [SUB('b', 'ACTIVE', '2026-10-20T00:00:00.000Z'), SUB('p', 'PAUSED', '2026-10-01T00:00:00.000Z'), SUB('a', 'ACTIVE', '2026-10-15T00:00:00.000Z')];
    expect(nextActiveSubscription(subs)?.id).toBe('a');
    expect(nextActiveSubscription([])).toBeUndefined();
  });

  it('khách chưa đăng nhập → không gọi API, không render', () => {
    mocks.status = 'idle';
    const { container } = renderStrip();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.getSubscriptions).not.toHaveBeenCalled();
  });

  it('badge đơn đang xử lý = 0 → không tải danh sách đơn', async () => {
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalled());
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('có đơn SHIPPING → dòng "Đơn … đang giao" mở chi tiết đơn', async () => {
    mocks.activeCount = 2;
    mocks.fetchOrders.mockResolvedValue({ data: [{ code: 'TUBU-9' }], meta: { page: 1, limit: 1, total: 1 } });
    renderStrip();
    fireEvent.click(await screen.findByRole('button', { name: /Đơn TUBU-9 đang giao/ }));
    expect(mocks.fetchOrders).toHaveBeenCalledWith({ status: 'SHIPPING' }, 1, 1);
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TUBU-9');
  });

  it('có kỳ định kỳ → dòng "Kỳ định kỳ kế tiếp: dd/MM" mở tab Định kỳ', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB('a', 'ACTIVE', '2026-10-15T05:00:00.000Z')]);
    renderStrip();
    fireEvent.click(await screen.findByRole('button', { name: /Kỳ định kỳ kế tiếp: 15\/10/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/orders?tab=subscriptions');
  });

  it('API lỗi → ẩn im lặng', async () => {
    mocks.activeCount = 1;
    mocks.fetchOrders.mockRejectedValue(new Error('500'));
    mocks.getSubscriptions.mockRejectedValue(new Error('404'));
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/home`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/home/home-blocks.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query';

export type HomeBlockId =
  | 'search' | 'purchased' | 'orderStrip' | 'flash' | 'forYou' | 'bestSellers'
  | 'categories' | 'recentlyViewed' | 'featured' | 'newArrivals' | 'extras';

export type HomeCustomerKind = 'returning' | 'new';

const RETURNING: readonly HomeBlockId[] = [
  'search', 'purchased', 'orderStrip', 'flash', 'forYou', 'bestSellers', 'categories', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
];
// Ô 'purchased' + 'orderStrip' giữ đúng vị trí 2–3 ở CẢ hai thứ tự: chúng tự rỗng với khách mới, và
// khi purchased-items trả về thì trang không xếp lại phần đầu (guard skeleton kệ Mua lại của 4a).
const NEW: readonly HomeBlockId[] = [
  'search', 'purchased', 'orderStrip', 'flash', 'bestSellers', 'categories', 'forYou', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
];

/** Thứ tự khối Trang chủ (spec 5b.1). Đầu trang (logo, chuông, giỏ) là khung trang, không tính. */
export function homeBlockOrder(kind: HomeCustomerKind): readonly HomeBlockId[] {
  return kind === 'returning' ? RETURNING : NEW;
}

/** Khách cũ = đã nhận ≥1 SP (kệ Mua lại có hàng). Đang tải / API cũ 404 → coi là khách mới. */
export function customerKind(purchasedCount: number | undefined): HomeCustomerKind {
  return (purchasedCount ?? 0) > 0 ? 'returning' : 'new';
}

export const HOME_GRID_BLOCKS: readonly HomeBlockId[] = ['forYou', 'bestSellers', 'featured', 'newArrivals'];

/** Mọi tiền tố query mà Trang chủ hiển thị — kéo để làm mới phải làm mới ĐỦ (A2-33). */
export const HOME_QUERY_PREFIXES = [
  'products', 'for-you', 'flash-sales', 'purchased-items', 'orders', 'subscriptions', 'categories', 'brands', 'cart', 'notifications',
] as const;

export function refreshHomeQueries(qc: QueryClient): Promise<unknown> {
  return Promise.all(HOME_QUERY_PREFIXES.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function dedupeAgainst<T extends { id: string }>(items: T[], seen: ReadonlySet<string>): T[] {
  return items.filter((p) => !seen.has(p.id));
}
```

`apps/miniapp/src/components/home/order-strip.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { CalendarClock, Truck } from 'lucide-react';
import { useActiveOrderCount } from '../../hooks/use-active-order-count';
import { vi } from '../../i18n/vi';
import { fetchOrders } from '../../services/shop-api';
import { getSubscriptions, type SubscriptionDTO } from '../../services/subscriptions-api';
import { useAuthStore } from '../../store/auth';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';

export function nextActiveSubscription(subs: SubscriptionDTO[]): SubscriptionDTO | undefined {
  return subs
    .filter((s) => s.status === 'ACTIVE' && !Number.isNaN(Date.parse(s.nextRunAt)))
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0];
}

export function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

/**
 * Dải "đơn đang giao / kỳ định kỳ kế tiếp" (spec 5b.1, plan 4b Ruling 9). Danh sách đơn chỉ tải khi
 * badge đơn đang xử lý (cùng query với tab bar) > 0. Khách chưa đăng nhập / không có gì / lỗi → ẩn.
 */
export function OrderStrip() {
  const navigate = useNavigate();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const activeCount = useActiveOrderCount(true);
  const shipping = useQuery({
    queryKey: ['orders', 'home-strip'],
    queryFn: () => fetchOrders({ status: 'SHIPPING' }, 1, 1),
    enabled: authed && activeCount > 0,
    staleTime: 30_000,
    retry: false,
  });
  // Cùng queryKey với SubscriptionsPanel (tab Định kỳ) → một cache.
  const subs = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed, retry: false });
  if (!authed) return null;
  const order = shipping.data?.data[0];
  const nextSub = nextActiveSubscription(subs.data ?? []);
  if (!order && !nextSub) return null;

  return (
    <section aria-label={vi.home.strip.title} style={{ padding: '4px 16px 12px' }}>
      <Card variant="outline" padding={8}>
        {order && (
          <ListRow
            icon={<Icon icon={Truck} tone="brand" />}
            title={vi.home.strip.shipping(order.code)}
            subtitle={vi.home.strip.shippingHint}
            trailing="chevron"
            onPress={() => navigate(`/order/${encodeURIComponent(order.code)}`)}
            style={{ padding: '8px 4px' }}
          />
        )}
        {nextSub && (
          <ListRow
            icon={<Icon icon={CalendarClock} tone="brand" />}
            title={vi.home.strip.nextSubscription(formatDayMonth(nextSub.nextRunAt))}
            subtitle={nextSub.productName}
            trailing="chevron"
            onPress={() => navigate('/orders?tab=subscriptions')}
            style={{ padding: '8px 4px' }}
          />
        )}
      </Card>
    </section>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/home` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/home` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/home/home-blocks.ts apps/miniapp/src/components/home/home-blocks.spec.ts apps/miniapp/src/components/home/order-strip.tsx apps/miniapp/src/components/home/order-strip.spec.tsx
git commit -m "feat(miniapp): Home block order for returning vs new customers and the order/subscription strip (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 20: Miniapp — `HomeHeader`, `HomeSection`, `HomeExtras`

**Files:**
- Create: `apps/miniapp/src/components/home/home-header.tsx`, `apps/miniapp/src/components/home/home-section.tsx`, `apps/miniapp/src/components/home/home-extras.tsx`
- Test: `apps/miniapp/src/components/home/home-parts.spec.tsx`

**Interfaces:**
- Consumes: `CartButton`, `CountBadge` (4a); `IconButton`, `Card`, `ListRow`, `Chip`, `Button`, `Icon`, `Heading`, `Text`; `ErrorState`; `CatalogGrid`, `CatalogGridSkeleton` (Task 13); `fetchBrands`, `ProductCard`; `getErrorMessage`; `useAuthStore`; `vi.home`, `vi.community`, `vi.auth`; logo `../../assets/tubu-logo.png`.
- Produces:
  - `HomeHeader({ unreadCount: number })` — logo, bell `IconButton` (label "Thông báo") + `CountBadge` ("n thông báo chưa đọc"), `CartButton`.
  - `interface SectionQuery { isLoading: boolean; isError: boolean; error: unknown; data?: { data: ProductCard[] } }`; `HomeSection({ title: string; query: SectionQuery; listSource: string; onRetry: () => void })` — `<section aria-label={title}>`; nothing when loaded and empty; skeleton (4 tiles) while loading; inline `ErrorState` on error.
  - `HomeExtras()` — small cards "Trợ lý AI 24/7" (accessible name "Hỏi trợ lý AI 24/7") and "Mua chung giá tốt"; hero card with "Tìm sản phẩm" → `/browse?focus=search`; brand strip "Thương hiệu Việt" → `/browse?brand=<b>`; "Hành trình nguyên liệu" → `/brand-story`; community → `/feed`.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/components/home/home-parts.spec.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchBrands: vi.fn(), user: null as null | { fullName: string; pointsBalance: number } }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('zmp-ui')>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchBrands: mocks.fetchBrands, fetchActiveFlashSales: vi.fn().mockResolvedValue([]), getCart: vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: typeof mocks.user }) => unknown) => sel({ status: 'idle', user: mocks.user }),
}));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { HomeHeader } from './home-header';
import { HomeSection } from './home-section';
import { HomeExtras } from './home-extras';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const P = { id: 'p1', slug: 'p1', brand: 'Tubu', name: 'Xà phòng', thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true };

describe('HomeHeader', () => {
  it('chuông có nhãn + huy hiệu số chưa đọc; giỏ hàng', () => {
    wrap(<HomeHeader unreadCount={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/notifications');
    expect(screen.getByLabelText('3 thông báo chưa đọc')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });
});

describe('HomeSection', () => {
  const q = (over: object) => ({ isLoading: false, isError: false, error: null, ...over });

  it('đã tải, rỗng → không render', () => {
    const { container } = wrap(<HomeSection title="Bán chạy" query={q({ data: { data: [] } })} listSource="home" onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('đang tải → vùng có tiêu đề + khung chờ; có dữ liệu → lưới SP', () => {
    const { rerender } = wrap(<HomeSection title="Bán chạy" query={q({ isLoading: true })} listSource="home" onRetry={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Bán chạy' })).toContainElement(screen.getByTestId('catalog-grid-skeleton'));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <HomeSection title="Bán chạy" query={q({ data: { data: [P] } })} listSource="home" onRetry={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Xà phòng' })).toBeInTheDocument();
  });

  it('lỗi → ErrorState gọn với "Thử lại"', () => {
    const onRetry = vi.fn();
    wrap(<HomeSection title="Bán chạy" query={q({ isError: true, error: new Error('x') })} listSource="home" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('HomeExtras', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { fullName: 'Lan', pointsBalance: 60 };
    mocks.fetchBrands.mockResolvedValue([{ brand: 'Tubu', count: 3 }]);
  });

  it('A2-33: hero dùng "Tìm sản phẩm" (không còn "Khám phá vườn") → mở ô tìm', () => {
    wrap(<HomeExtras />);
    expect(screen.queryByText(/Khám phá vườn/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?focus=search');
    expect(screen.getByText(/Chào Lan/)).toHaveTextContent('60 điểm Xanh');
  });

  it('thẻ nhỏ AI / Mua chung giữ tên truy cập cũ; thương hiệu mở Browse lọc sẵn', async () => {
    wrap(<HomeExtras />);
    fireEvent.click(screen.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/ai-advisor');
    fireEvent.click(screen.getByRole('button', { name: 'Mua chung giá tốt' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/group-buy');
    fireEvent.click(await screen.findByRole('button', { name: 'Tubu' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?brand=Tubu');
    fireEvent.click(screen.getByRole('button', { name: /Hành trình nguyên liệu/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/brand-story');
    fireEvent.click(screen.getByRole('button', { name: /Cộng đồng Vườn Tubu/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/feed');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/home/home-parts.spec.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/components/home/home-header.tsx`:

```tsx
import { Bell } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import logo from '../../assets/tubu-logo.png';
import { vi } from '../../i18n/vi';
import { CartButton } from '../cart-button';
import { CountBadge } from '../ui/cart-badge';
import { IconButton } from '../ui/icon-button';

/** Đầu Trang chủ: logo + chuông (badge số chưa đọc, P1-8) + giỏ (spec 5b.1). Khung trang, không tính là khối. */
export function HomeHeader({ unreadCount }: { unreadCount: number }) {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
      <img src={logo} alt="Tubu Tree" style={{ height: 30, objectFit: 'contain' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <IconButton
            icon={Bell}
            label={vi.home.notifications}
            onPress={() => navigate('/notifications')}
            style={{ background: 'var(--color-action-secondary-bg)' }}
          />
          <CountBadge count={unreadCount} label={vi.home.unreadBadge(unreadCount)} />
        </div>
        <CartButton />
      </div>
    </div>
  );
}
```

`apps/miniapp/src/components/home/home-section.tsx`:

```tsx
import type { ProductCard } from '../../services/shop-api';
import { getErrorMessage } from '../../services/api';
import { CatalogGrid, CatalogGridSkeleton } from '../catalog/catalog-grid';
import { ErrorState } from '../ui/empty-state';
import { Heading } from '../ui/text';

export interface SectionQuery {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data?: { data: ProductCard[] };
}

/** Một khối lưới SP của Trang chủ. Rỗng sau khi tải → ẩn; lỗi → ErrorState gọn ngay trong khối. */
export function HomeSection({ title, query, listSource, onRetry }: { title: string; query: SectionQuery; listSource: string; onRetry: () => void }) {
  const items = query.data?.data ?? [];
  if (!query.isLoading && !query.isError && items.length === 0) return null;
  return (
    <section aria-label={title} style={{ padding: '16px 16px 0' }}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        {title}
      </Heading>
      {query.isLoading ? (
        <CatalogGridSkeleton count={4} />
      ) : query.isError ? (
        <ErrorState variant="inline" message={getErrorMessage(query.error)} onRetry={onRetry} />
      ) : (
        <CatalogGrid products={items} listSource={listSource} />
      )}
    </section>
  );
}
```

`apps/miniapp/src/components/home/home-extras.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { Map as MapIcon, MessagesSquare, Search, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { fetchBrands } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { Heading, Text } from '../ui/text';

/**
 * Khối phụ cuối Trang chủ (spec 5b.1, plan 4b Ruling 8): 2 nút AI/Mua chung xuống thành thẻ nhỏ,
 * hero thương hiệu với CTA "Tìm sản phẩm" (A2-33), dải thương hiệu, câu chuyện nguyên liệu, cộng đồng.
 */
export function HomeExtras() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000 });
  const go = (to: string) => {
    haptic('light');
    navigate(to);
  };

  return (
    <div style={{ padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <ShortcutCard icon={Sparkles} label={vi.home.aiCard} ariaLabel={vi.home.aiCardLabel} onPress={() => go('/ai-advisor')} />
        <ShortcutCard icon={Users} label={vi.home.groupBuyCard} ariaLabel={vi.home.groupBuyCard} onPress={() => go('/group-buy')} />
      </div>

      <Card variant="flat" padding={16}>
        <Text variant="label" tone="brand" as="div">
          {vi.home.heroKicker}
        </Text>
        <Heading variant="title-md" as="h2" style={{ marginTop: 4 }}>
          {vi.home.heroTitle}
        </Heading>
        {user && (
          <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 4 }}>
            {vi.home.greeting(user.fullName ?? vi.auth.greetingFallback)}
            {user.pointsBalance != null ? ` · ${vi.home.pointsChip(user.pointsBalance)}` : ''}
          </Text>
        )}
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" icon={Search} onPress={() => go('/browse?focus=search')} style={{ minWidth: 0 }}>
            {vi.home.heroCta}
          </Button>
        </div>
      </Card>

      {(brands.data?.length ?? 0) > 0 && (
        <section aria-label={vi.home.brandsTitle}>
          <Heading variant="title-sm" as="h2" style={{ marginBottom: 4 }}>
            {vi.home.brandsTitle}
          </Heading>
          <div className="scroll-x" style={{ gap: 8, padding: '6px 0' }}>
            {(brands.data ?? []).map((b) => (
              <Chip key={b.brand} onPress={() => go(`/browse?brand=${encodeURIComponent(b.brand)}`)}>
                {b.brand}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <Card variant="outline" padding={0}>
        <ListRow
          icon={<Icon icon={MapIcon} tone="brand" />}
          title={vi.home.brandStoryTitle}
          subtitle={vi.home.brandStoryBody}
          trailing="chevron"
          onPress={() => go('/brand-story')}
          style={{ padding: '12px' }}
        />
        <ListRow
          icon={<Icon icon={MessagesSquare} tone="brand" />}
          title={vi.community.title}
          subtitle={vi.community.subtitle}
          trailing="chevron"
          onPress={() => go('/feed')}
          style={{ padding: '12px' }}
        />
      </Card>
    </div>
  );
}

function ShortcutCard({ icon, label, ariaLabel, onPress }: { icon: LucideIcon; label: string; ariaLabel: string; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="tubu-press"
      onClick={onPress}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        boxSizing: 'border-box',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Icon icon={icon} size="sm" tone="brand" />
      <Text variant="label">{label}</Text>
    </button>
  );
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/components/home` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/components/home` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/home/home-header.tsx apps/miniapp/src/components/home/home-section.tsx apps/miniapp/src/components/home/home-extras.tsx apps/miniapp/src/components/home/home-parts.spec.tsx
git commit -m "feat(miniapp): DS v2 Home header, product section and demoted extras with the renamed hero CTA (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 21: Miniapp — rewrite `pages/home.tsx` on DS v2

**Files:**
- Rewrite: `apps/miniapp/src/pages/home.tsx`
- Modify: `apps/miniapp/src/components/reorder/purchased-rail.tsx` (export the limit only: `const RAIL_LIMIT = 10;` → `export const PURCHASED_RAIL_LIMIT = 10;` and its one use)
- Create: `apps/miniapp/src/pages/home.spec.tsx`

**Interfaces:**
- Consumes: `homeBlockOrder`, `customerKind`, `dedupeAgainst`, `refreshHomeQueries`, `HomeBlockId` (Task 19); `OrderStrip` (Task 19); `HomeHeader`, `HomeSection`, `SectionQuery`, `HomeExtras` (Task 20); `CategoryGrid` (Task 14); `RecentlyViewedRail` (Task 17); `useCategories` (Task 11); `usePurchasedItems` (4a); `PurchasedRail`, `PURCHASED_RAIL_LIMIT`; `FlashSale`, `UpcomingFlashSales` (unchanged); `fetchProducts`, `fetchForYou`; `getNotifications`; `PullToRefresh`.
- Produces: the `/` route. Contract for e2e: every block is wrapped in `<div data-home-block="<HomeBlockId>">` in `homeBlockOrder(kind)` order; search shell button named "Bạn đang tìm gì hôm nay?" → `/browse?focus=search`; sections "Dành cho bạn", "Bán chạy", "Tubu chọn cho bạn", "Mới về vườn"; queries `['products','home-best-seller']` (`sort: 'best_seller'`, `limit: 6`), `['products','home-featured']`, `['products','home-newest']`, `['for-you']`.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/pages/home.spec.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), fetchProducts: vi.fn(), fetchForYou: vi.fn(), fetchBrands: vi.fn(), fetchCategories: vi.fn(),
  fetchPurchasedItems: vi.fn(), getNotifications: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProducts: mocks.fetchProducts, fetchForYou: mocks.fetchForYou, fetchBrands: mocks.fetchBrands, fetchCategories: mocks.fetchCategories,
  fetchPurchasedItems: mocks.fetchPurchasedItems, fetchActiveFlashSales: vi.fn().mockResolvedValue([]), getCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getNotifications: mocks.getNotifications }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: null }) => unknown) => sel({ status: 'authenticated', user: null }),
}));
// Khối đã có test riêng (4a / Task 19) — ở đây chỉ kiểm thứ tự và nội dung trang.
vi.mock('../components/flash-sale', () => ({ FlashSale: () => null, UpcomingFlashSales: () => null }));
vi.mock('../components/reorder/purchased-rail', () => ({ PURCHASED_RAIL_LIMIT: 10, PurchasedRail: () => <section aria-label="Mua lại" /> }));
vi.mock('../components/home/order-strip', () => ({ OrderStrip: () => null }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import HomePage from './home';
import { homeBlockOrder } from '../components/home/home-blocks';

const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><HomePage /></QueryClientProvider>);
}
const blockOrder = () => Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => el.dataset.homeBlock);

describe('HomePage (DS v2, spec 5b.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) =>
      params.sort === 'best_seller' ? PAGE([card('bs', 'Bán chạy nhất')]) : PAGE([card('f1', 'Trùng gợi ý'), card('f2', 'Chỉ nổi bật')]),
    );
    mocks.fetchForYou.mockResolvedValue([card('f1', 'Trùng gợi ý')]);
    mocks.fetchBrands.mockResolvedValue([]);
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.getNotifications.mockResolvedValue([]);
  });

  it('khách mới: thứ tự khối "new" (Bán chạy + Danh mục trước Dành cho bạn)', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalledWith({ limit: 10 }));
    expect(blockOrder()).toEqual([...homeBlockOrder('new')]);
  });

  it('khách cũ: thứ tự khối "returning" sau khi purchased-items có hàng', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
    renderHome();
    await waitFor(() => expect(blockOrder()).toEqual([...homeBlockOrder('returning')]));
  });

  it('"Bán chạy" dùng sort=best_seller; "Tubu chọn cho bạn" bỏ SP đã có ở "Dành cho bạn"', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    const best = await screen.findByRole('region', { name: 'Bán chạy' });
    expect(best).toHaveTextContent('Bán chạy nhất');
    expect(mocks.fetchProducts).toHaveBeenCalledWith({ limit: 6, sort: 'best_seller' });
    const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
    await waitFor(() => expect(featured).not.toHaveTextContent('Trùng gợi ý'));
    expect(featured).toHaveTextContent('Chỉ nổi bật');
    expect(await screen.findByRole('region', { name: 'Dành cho bạn' })).toHaveTextContent('Trùng gợi ý');
  });

  it('không còn "Khám phá vườn", hàng phân khúc, hay khối "Cho mẹ và bé"; Danh mục dùng 4 phân khúc khi chưa có danh mục thật', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    expect(await screen.findByRole('button', { name: 'Cho mẹ & bé' })).toBeInTheDocument();
    expect(screen.queryByText(/Khám phá vườn/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Cho mẹ và bé' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm sản phẩm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/pages/home.spec.tsx`
Expected: FAIL — the legacy page has no `data-home-block`, no "Bán chạy", still "Khám phá vườn".

- [ ] **Step 3: Implement**

In `apps/miniapp/src/components/reorder/purchased-rail.tsx` change `const RAIL_LIMIT = 10;` to:

```ts
/** Export để Trang chủ dùng CHUNG query key ['purchased-items', 10] khi quyết định thứ tự khối (plan 4b). */
export const PURCHASED_RAIL_LIMIT = 10;
```

and `usePurchasedItems(RAIL_LIMIT)` to `usePurchasedItems(PURCHASED_RAIL_LIMIT)`.

Replace the whole content of `apps/miniapp/src/pages/home.tsx` with:

```tsx
import { useMemo, type ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { fetchForYou, fetchProducts } from '../services/shop-api';
import { getNotifications } from '../services/account-api';
import { useAuthStore } from '../store/auth';
import { useCategories } from '../hooks/use-categories';
import { usePurchasedItems } from '../hooks/use-purchased-items';
import { FlashSale, UpcomingFlashSales } from '../components/flash-sale';
import { PullToRefresh } from '../components/pull-to-refresh';
import { CategoryGrid } from '../components/catalog/category-grid';
import { RecentlyViewedRail } from '../components/catalog/recently-viewed-rail';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '../components/reorder/purchased-rail';
import { HomeExtras } from '../components/home/home-extras';
import { HomeHeader } from '../components/home/home-header';
import { HomeSection, type SectionQuery } from '../components/home/home-section';
import { OrderStrip } from '../components/home/order-strip';
import { customerKind, dedupeAgainst, homeBlockOrder, refreshHomeQueries, type HomeBlockId } from '../components/home/home-blocks';
import { Icon } from '../components/ui/icon';
import { Text } from '../components/ui/text';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

const SECTION_LIMIT = 6;

/**
 * Trang chủ (spec 5b.1) — DS v2 toàn trang. Thứ tự khối theo khách cũ/mới (`homeBlockOrder`):
 * khách cũ thấy "Mua lại" ngay dưới ô tìm; khách mới ưu tiên Flash + Bán chạy + Danh mục.
 * Lưới SP đầu tiên nằm trong 5 khối đầu (trước đây là khối thứ 11 — A2-32).
 */
export default function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  // Cùng queryKey với trang Thông báo (P1-8 audit mạch lạc: chuông phải báo có tin mới).
  const unreadCount =
    useQuery({ queryKey: ['notifications'], queryFn: getNotifications, enabled: authed }).data?.filter((n) => n.status !== 'READ').length ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới.
  const purchased = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const kind = customerKind(purchased.data?.items.length);

  const bestSellers = useQuery({
    queryKey: ['products', 'home-best-seller'],
    queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'best_seller' }),
  });
  const featured = useQuery({ queryKey: ['products', 'home-featured'], queryFn: () => fetchProducts({ limit: SECTION_LIMIT }) });
  const newest = useQuery({ queryKey: ['products', 'home-newest'], queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'newest' }) });
  const forYou = useQuery({ queryKey: ['for-you'], queryFn: fetchForYou, enabled: authed, select: (data) => ({ data }) });
  const categories = useCategories();

  // A2-32: với khách chưa có lịch sử, "Dành cho bạn" rơi về SP nổi bật — trùng "Tubu chọn cho bạn".
  const forYouIds = useMemo(() => new Set((forYou.data?.data ?? []).map((p) => p.id)), [forYou.data]);
  const featuredQuery: SectionQuery = {
    isLoading: featured.isLoading,
    isError: featured.isError,
    error: featured.error,
    data: featured.data ? { data: dedupeAgainst(featured.data.data, forYouIds) } : undefined,
  };

  const blocks: Record<HomeBlockId, ReactNode> = {
    search: <SearchShell />,
    purchased: <PurchasedRail source="home_rail" />,
    orderStrip: <OrderStrip />,
    flash: (
      <>
        <FlashSale />
        <UpcomingFlashSales />
      </>
    ),
    forYou: authed ? <HomeSection title={vi.home.forYou} query={forYou} listSource="home_for_you" onRetry={() => void forYou.refetch()} /> : null,
    bestSellers: (
      <HomeSection title={vi.home.bestSellers} query={bestSellers} listSource="home_best_seller" onRetry={() => void bestSellers.refetch()} />
    ),
    categories: (
      <CategoryGrid
        entries={categories.entries}
        isLoading={categories.isLoading}
        onSelect={(e) => {
          haptic('light');
          navigate(e.kind === 'category' ? `/browse?category=${encodeURIComponent(e.key)}` : `/browse?segment=${encodeURIComponent(e.key)}`);
        }}
      />
    ),
    recentlyViewed: <RecentlyViewedRail />,
    featured: <HomeSection title={vi.home.featured} query={featuredQuery} listSource="home_featured" onRetry={() => void featured.refetch()} />,
    newArrivals: <HomeSection title={vi.home.newArrivals} query={newest} listSource="home_newest" onRetry={() => void newest.refetch()} />,
    extras: <HomeExtras />,
  };

  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PullToRefresh onRefresh={() => refreshHomeQueries(qc)} />
      <HomeHeader unreadCount={unreadCount} />
      {homeBlockOrder(kind).map((id) => (
        <div key={id} data-home-block={id}>
          {blocks[id]}
        </div>
      ))}
    </Page>
  );
}

/** Ô tìm ở Trang chủ chỉ là vỏ: mở thẳng bàn phím ở ô thật bên /browse (?focus=search). */
function SearchShell() {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '0 16px 12px' }}>
      <button
        type="button"
        aria-label={vi.home.searchPlaceholder}
        className="tubu-press"
        onClick={() => {
          haptic('light');
          navigate('/browse?focus=search');
        }}
        style={{
          width: '100%',
          minHeight: 46,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 16px',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-surface)',
          boxShadow: 'var(--elevation-1)',
          boxSizing: 'border-box',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Icon icon={Search} size="sm" tone="muted" />
        <Text variant="body-sm" tone="tertiary">
          {vi.home.searchPlaceholder}
        </Text>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, types, lint, existing e2e**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/pages src/components` → PASS (4a `purchased-rail.spec.tsx` still passes; it asserts `fetchPurchasedItems({ limit: 10 })`).
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/pages/home.tsx src/components/reorder/purchased-rail.tsx` → **0 errors** (baseline `home.tsx` had 7; Ruling 15).
E2E regressions are run in Task 24 (the new Home calls `/categories` and `/me/subscriptions`, whose `mockSession` defaults land there).

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/home.tsx apps/miniapp/src/pages/home.spec.tsx apps/miniapp/src/components/reorder/purchased-rail.tsx
git commit -m "feat(miniapp): Home rebuilt on DS v2 with returning/new customer block order and a first product grid within five blocks (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 22: Miniapp — PDP records "Đã xem gần đây"

**Files:**
- Create: `apps/miniapp/src/hooks/use-record-recently-viewed.ts`, `apps/miniapp/src/hooks/use-record-recently-viewed.spec.tsx`
- Modify: `apps/miniapp/src/pages/product-detail.tsx` (import + one hook call right after the `product` query, before any early return)

**Interfaces:**
- Consumes: `recordRecentlyViewed` (Task 10), `ProductDetail` (`shop-api.ts`).
- Produces: `useRecordRecentlyViewed(product: Pick<ProductDetail, 'slug' | 'name' | 'thumbnail' | 'images' | 'basePrice' | 'salePrice'> | undefined): void` — records once per slug (`price = salePrice ?? basePrice`, `thumbnail = thumbnail ?? images[0] ?? null`); a refetch that returns a new object for the same slug does not record again.

- [ ] **Step 1: Write the failing test**

`apps/miniapp/src/hooks/use-record-recently-viewed.spec.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('../utils/recently-viewed', () => ({ recordRecentlyViewed: mocks.record }));

import { useRecordRecentlyViewed } from './use-record-recently-viewed';

const P = (slug: string, over: object = {}) => ({ slug, name: `SP ${slug}`, thumbnail: null, images: ['https://img/1.jpg'], basePrice: 100000, salePrice: 80000, ...over });

describe('useRecordRecentlyViewed (spec 5b.4: ghi ở PDP mở thành công)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('chưa có sản phẩm (đang tải / lỗi) → không ghi', () => {
    renderHook(() => useRecordRecentlyViewed(undefined));
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('có sản phẩm → ghi 1 lần: giá đang bán, ảnh = thumbnail ?? ảnh đầu', () => {
    renderHook(() => useRecordRecentlyViewed(P('a')));
    expect(mocks.record).toHaveBeenCalledWith({ slug: 'a', name: 'SP a', thumbnail: 'https://img/1.jpg', price: 80000 });
  });

  it('refetch trả object mới cùng slug → không ghi lại; chuyển sang SP khác → ghi SP mới', () => {
    const { rerender } = renderHook(({ p }) => useRecordRecentlyViewed(p), { initialProps: { p: P('a') } });
    rerender({ p: P('a', { salePrice: null }) });
    expect(mocks.record).toHaveBeenCalledTimes(1);
    rerender({ p: P('b', { salePrice: null, thumbnail: 'https://img/b.jpg' }) });
    expect(mocks.record).toHaveBeenLastCalledWith({ slug: 'b', name: 'SP b', thumbnail: 'https://img/b.jpg', price: 100000 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/hooks/use-record-recently-viewed.spec.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/miniapp/src/hooks/use-record-recently-viewed.ts`:

```ts
import { useEffect, useRef } from 'react';
import type { ProductDetail } from '../services/shop-api';
import { recordRecentlyViewed } from '../utils/recently-viewed';

type Recordable = Pick<ProductDetail, 'slug' | 'name' | 'thumbnail' | 'images' | 'basePrice' | 'salePrice'>;

/** Ghi "Đã xem gần đây" MỘT lần cho mỗi slug khi PDP tải thành công (spec 5b.4). */
export function useRecordRecentlyViewed(product: Recordable | undefined): void {
  const recordedSlug = useRef<string | null>(null);
  useEffect(() => {
    if (!product || recordedSlug.current === product.slug) return;
    recordedSlug.current = product.slug;
    recordRecentlyViewed({
      slug: product.slug,
      name: product.name,
      thumbnail: product.thumbnail ?? product.images[0] ?? null,
      price: product.salePrice ?? product.basePrice,
    });
  }, [product]);
}
```

In `apps/miniapp/src/pages/product-detail.tsx` add `import { useRecordRecentlyViewed } from '../hooks/use-record-recently-viewed';` with the other hook imports, and directly after the `const product = useQuery({ ... });` block (before `const related = ...`):

```tsx
  // "Đã xem gần đây" (spec 5b.4): ghi khi PDP mở THÀNH CÔNG. Đặt trước mọi early-return (luật hook).
  useRecordRecentlyViewed(product.isSuccess ? product.data : undefined);
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/hooks` → PASS.
Run: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` → no errors.
Run: `pnpm --filter @tubutree/miniapp exec eslint src/pages/product-detail.tsx src/hooks/use-record-recently-viewed.ts` → clean (PDP was clean at baseline and must stay clean).

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/hooks/use-record-recently-viewed.ts apps/miniapp/src/hooks/use-record-recently-viewed.spec.tsx apps/miniapp/src/pages/product-detail.tsx
git commit -m "feat(miniapp): product page records recently viewed products once per slug (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 23: Miniapp — 4b guard: no legacy CSS vars, no ZaUI layout/text in Home/Browse

**Files:**
- Create: `apps/miniapp/src/ds-legacy-vars-4b.spec.ts`

**Interfaces:**
- Consumes: every file created or rewritten in Tasks 12–22.
- Produces: a regression guard that extends the 4a guard (`ds-legacy-vars-4a.spec.ts`, left untouched — its 13 files keep the 4a regex) with (a) the **full** legacy alias family list from `css/tokens.css` for 4b files, and (b) a check that `home.tsx`/`browse.tsx` import nothing from `zmp-ui` except `Page`/`useNavigate` (spec criterion 5: Home/Browse 100% DS v2).

- [ ] **Step 1: Write the test**

`apps/miniapp/src/ds-legacy-vars-4b.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dự án 4b: file mới/viết lại không dùng bất kỳ họ biến alias legacy nào trong css/tokens.css
 * (spec §1 tiêu chí 5, §11). Rộng hơn guard 4a: thêm --sun-*, --success/--warning/--danger/--info(-bg),
 * --clay-200/800, --radius-sm/md/lg/xl/full, --shadow-*, --dealer-*, --font-body.
 * Plan 4c/4d thêm file của mình vào danh sách.
 */
const FILES_4B = [
  'src/pages/home.tsx',
  'src/pages/browse.tsx',
  'src/components/ui/search-field.tsx',
  'src/components/ui/chip.tsx',
  'src/components/catalog/catalog-grid.tsx',
  'src/components/catalog/category-grid.tsx',
  'src/components/catalog/sort-chips.tsx',
  'src/components/catalog/result-header.tsx',
  'src/components/catalog/filter-sheet.tsx',
  'src/components/catalog/suggest-list.tsx',
  'src/components/catalog/recently-viewed-rail.tsx',
  'src/components/home/home-header.tsx',
  'src/components/home/home-section.tsx',
  'src/components/home/order-strip.tsx',
  'src/components/home/home-extras.tsx',
];
const LEGACY = new RegExp(
  [
    String.raw`var\(--(neutral|primary|leaf|sun)-`,
    String.raw`var\(--(success|warning|danger|info)(-bg)?\)`,
    String.raw`var\(--clay-(200|800)\)`,
    String.raw`var\(--radius-(sm|md|lg|xl|full)\)`,
    String.raw`var\(--shadow-(xs|sm|md|lg|card)\)`,
    String.raw`var\(--dealer-`,
    String.raw`var\(--font-body\)`,
  ].join('|'),
);
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('4b — không dùng biến CSS cũ', () => {
  it.each(FILES_4B)('%s', (file) => {
    const hits = read(file)
      .split('\n')
      .map((l, i) => `${i + 1}: ${l.trim()}`)
      .filter((l) => LEGACY.test(l));
    expect(hits).toEqual([]);
  });
});

describe('4b — Trang chủ và Danh mục chỉ dùng component DS v2 (không Box/Text/Input/Button của ZaUI)', () => {
  const ALLOWED = new Set(['Page', 'useNavigate']);
  it.each(['src/pages/home.tsx', 'src/pages/browse.tsx'])('%s', (file) => {
    const imports = [...read(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*'zmp-ui'/g)]
      .flatMap((m) => m[1]!.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    expect(imports.filter((name) => !ALLOWED.has(name))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @tubutree/miniapp exec vitest run src/ds-legacy-vars-4b.spec.ts src/ds-legacy-vars-4a.spec.ts`
Expected: PASS (15 + 2 cases for 4b, 13 for 4a). A failing case is a real defect: replace the variable with its DS v2 semantic token in that file (do not drop the file from the list).

- [ ] **Step 3: ESLint gate for every 4b file**

Run: `pnpm --filter @tubutree/miniapp exec eslint src/pages/home.tsx src/pages/browse.tsx src/pages/product-detail.tsx src/components/catalog src/components/home src/components/ui/search-field.tsx src/components/ui/chip.tsx src/components/reorder/purchased-rail.tsx src/hooks src/utils src/services/shop-api.ts src/services/discovery-events.ts`
Expected: 0 errors.
Run: `pnpm lint:vars` → OK.

- [ ] **Step 4: Commit**

```bash
git add apps/miniapp/src/ds-legacy-vars-4b.spec.ts
git commit -m "test(ds): guard buy-flow 4b files against every legacy CSS alias and ZaUI layout/text imports (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 24: E2E — discovery mocks, `mockSession` defaults, Home order (returning vs new), strip, categories, recently viewed

**Files:**
- Modify: `apps/e2e/tests/support/mock-api.ts` (`mockSession` defaults)
- Create: `apps/e2e/tests/support/discovery-mocks.ts`
- Create: `apps/e2e/tests/buy-flow-4b.miniapp.spec.ts`

**Interfaces:**
- Consumes: `MockApi`, `MockCall`, `mockSession`, `makeUser`, `makeOrder`, `reply`, `test`, `expect` (`support/mock-api.ts`); `publicConfig` (`support/checkout-mocks.ts`); `PURCHASED_PAGE`, `THUMB` (`support/buy-flow-mocks.ts`); miniapp types `CartSummary`, `CategoryDTO`, `PageResponse`, `ProductCard`, `ProductDetail`, `ProductSuggestion`, `SubscriptionDTO`.
- Produces (for Tasks 25–26):
  - `interface CatalogItem extends ProductCard { categoryIds: string[]; forSegment: string[]; soldTotal: number }`
  - `NRC`, `BINH_SUA`, `XA_PHONG`, `KEM`, `CATALOG: CatalogItem[]` (30 items), `CATEGORIES: CategoryDTO[]`, `SHIPPING_CODE = 'TUBU-SHIP-4B'`, `EXTENDED_PARAMS`
  - `foldE2E(s: string): string`, `toCard(item: CatalogItem): ProductCard`, `catalogHandler(opts?: { legacy?: boolean }): (ctx: { call: MockCall }) => unknown`
  - `mockDiscovery(api: MockApi, opts?: { legacy?: boolean; returning?: boolean; shipping?: boolean; subscription?: boolean; forYou?: ProductCard[] }): void`
  - In the spec file: helpers `visibleBlocks(page)`, `flushEvents(page)`, `eventsNamed(api, name)`, `waitCatalogSettled(page, api)`.

- [ ] **Step 1: Add the session defaults**

In `apps/e2e/tests/support/mock-api.ts`, inside `mockSession`, after the `/me/purchased-items` default:

```ts
  // Trang chủ dự án 4b: Danh mục thật, dải "kỳ định kỳ kế tiếp" và (badge > 0) "đơn đang giao".
  // Spec cần dữ liệu khác thì đăng ký lại SAU (cùng độ cụ thể → đăng ký sau thắng).
  api.get('/categories', []);
  api.get('/me/subscriptions', []);
  api.get('/orders', { data: [], meta: { page: 1, limit: 1, total: 0 } });
```

(Verified: the only spec helpers that register `/orders` or `/me/subscriptions` — `mockOrdersTab` in `buy-flow-mocks.ts` — do so after `mockSession`, so they still win.)

- [ ] **Step 2: Write the mocks**

`apps/e2e/tests/support/discovery-mocks.ts`:

```ts
import type {
  CartSummary, CategoryDTO, PageResponse, ProductCard, ProductDetail, ProductSuggestion,
} from '../../../miniapp/src/services/shop-api';
import type { SubscriptionDTO } from '../../../miniapp/src/services/subscriptions-api';
import { makeOrder, makeUser, mockSession, reply, type MockApi, type MockCall } from './mock-api';
import { publicConfig } from './checkout-mocks';
import { PURCHASED_PAGE, THUMB } from './buy-flow-mocks';

/**
 * Mock cho dự án 4b (buy-flow-4b.miniapp.spec.ts): GET /products (lọc/sắp như catalog.service thật:
 * q không dấu, brand phẩy, category, segment, giá ĐANG BÁN, inStock, minRating, best_seller, phân trang),
 * GET /categories (+productCount), GET /search/suggest, PDP, dải đơn/định kỳ.
 * `legacy: true` = API trước 4b: 400 cho tham số lọc mới (forbidNonWhitelisted), best_seller bị bỏ qua,
 * /categories không có productCount.
 */
export interface CatalogItem extends ProductCard {
  categoryIds: string[];
  forSegment: string[];
  soldTotal: number;
}

function item(over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'slug' | 'name'>): CatalogItem {
  return {
    brand: 'Tubu', thumbnail: THUMB, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true,
    ratingAvg: 0, reviewCount: 0, sold: 0, categoryIds: [], forSegment: [], soldTotal: 0, ...over,
  };
}

export const NRC = item({
  id: 'p-nrc', slug: 'nuoc-rua-chen-tubu', name: 'Nước Rửa Chén Sinh Học Tubu 500ml', basePrice: 150_000, salePrice: 120_000,
  categoryIds: ['cat-cleaning'], forSegment: ['home_clean'], soldTotal: 50, sold: 50, ratingAvg: 4.6, reviewCount: 12,
});
export const BINH_SUA = item({
  id: 'p-bs', slug: 'nuoc-rua-binh-sua', name: 'Nước Rửa Bình Sữa Cho Bé', brand: 'Mộc An', basePrice: 180_000,
  categoryIds: ['cat-baby'], forSegment: ['mom_baby'], soldTotal: 80, sold: 80, ratingAvg: 4.2, reviewCount: 5,
});
export const XA_PHONG = item({
  id: 'p-xp', slug: 'xa-phong-thao-moc', name: 'Xà Phòng Thảo Mộc', basePrice: 45_000,
  categoryIds: ['cat-personal'], soldTotal: 120, sold: 120, ratingAvg: 3.5, reviewCount: 3,
});
export const KEM = item({
  id: 'p-kem', slug: 'kem-chong-nang-rau-ma', name: 'Kem Chống Nắng Rau Má', brand: 'Mộc An', basePrice: 345_000, inStock: false,
  categoryIds: ['cat-skincare'], forSegment: ['skincare'], soldTotal: 10, sold: 10, ratingAvg: 4.8, reviewCount: 9,
});
/** 26 SP "Sống xanh" để danh sách đủ dài cho kiểm tra khôi phục vị trí cuộn. */
const FILLER = Array.from({ length: 26 }, (_, i) =>
  item({ id: `p-tui-${String(i + 1).padStart(2, '0')}`, slug: `tui-vai-${i + 1}`, name: `Túi Vải Canvas Tubu số ${i + 1}`, basePrice: 600_000 + i * 1_000, forSegment: ['eco'] }),
);
export const CATALOG: CatalogItem[] = [NRC, BINH_SUA, XA_PHONG, KEM, ...FILLER];

export const CATEGORIES: CategoryDTO[] = [
  { id: 'cat-cleaning', parentId: null, name: 'Tẩy rửa sinh học', slug: 'tay-rua-sinh-hoc', image: null, sortOrder: 2, productCount: 1 },
  { id: 'cat-baby', parentId: null, name: 'Cho bé', slug: 'cho-be', image: null, sortOrder: 3, productCount: 1 },
  { id: 'cat-coffee', parentId: null, name: 'Cà phê & Đồ uống', slug: 'ca-phe-do-uong', image: null, sortOrder: 6, productCount: 0 },
];

export const SHIPPING_CODE = 'TUBU-SHIP-4B';
export const EXTENDED_PARAMS = ['minPrice', 'maxPrice', 'inStock', 'minRating'] as const;

const SUBSCRIPTION_4B: SubscriptionDTO = {
  id: 'sub-4b', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-10-15T03:00:00.000Z',
  productName: 'Nước Xả Vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nuoc-xa-vai', unitPrice: 80_000, effectiveDiscountPct: 0.12,
};
const EMPTY_CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: 0 };

/** Gấp dấu như API (đủ cho dữ liệu mẫu). */
export function foldE2E(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function toCard(x: CatalogItem): ProductCard {
  const { categoryIds: _c, forSegment: _f, soldTotal: _s, ...card } = x;
  return card;
}

export function catalogHandler(opts: { legacy?: boolean } = {}) {
  return ({ call }: { call: MockCall }) => {
    const p = call.query;
    if (opts.legacy && EXTENDED_PARAMS.some((k) => p.has(k))) {
      return reply(400, { statusCode: 400, message: ['property minPrice should not exist'], error: 'Bad Request' });
    }
    const num = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
    const q = foldE2E(p.get('q') ?? '');
    const brands = (p.get('brand') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const [min, max, rating] = [num('minPrice'), num('maxPrice'), num('minRating')];
    const category = p.get('category');
    const segment = p.get('segment');
    let rows = CATALOG.filter((x) => {
      const price = x.salePrice ?? x.basePrice;
      return (
        (!q || foldE2E(x.name).includes(q)) &&
        (brands.length === 0 || brands.includes(x.brand)) &&
        (!category || x.categoryIds.includes(category)) &&
        (!segment || x.forSegment.includes(segment)) &&
        (min == null || price >= min) &&
        (max == null || price <= max) &&
        (p.get('inStock') !== 'true' || x.inStock) &&
        (rating == null || (x.ratingAvg ?? 0) >= rating)
      );
    });
    const sort = p.get('sort');
    if (sort === 'best_seller' && !opts.legacy) rows = [...rows].sort((a, b) => b.soldTotal - a.soldTotal || a.id.localeCompare(b.id));
    if (sort === 'price_asc') rows = [...rows].sort((a, b) => a.basePrice - b.basePrice || a.id.localeCompare(b.id));
    if (sort === 'price_desc') rows = [...rows].sort((a, b) => b.basePrice - a.basePrice || a.id.localeCompare(b.id));
    const page = Number(p.get('page') ?? 1);
    const limit = Number(p.get('limit') ?? 20);
    const body: PageResponse<ProductCard> = {
      data: rows.slice((page - 1) * limit, page * limit).map(toCard),
      meta: { page, limit, total: rows.length },
    };
    return body;
  };
}

function suggestFor(q: string): ProductSuggestion[] {
  const f = foldE2E(q);
  return f ? CATALOG.filter((x) => foldE2E(x.name).includes(f)).slice(0, 8).map((x) => ({ slug: x.slug, name: x.name, thumbnail: x.thumbnail, basePrice: x.basePrice })) : [];
}

function productDetail(slug: string): ProductDetail | undefined {
  const x = CATALOG.find((c) => c.slug === slug);
  if (!x) return undefined;
  return {
    id: x.id, slug: x.slug, brand: x.brand, name: x.name, shortDesc: `Mô tả ngắn ${x.name}`, description: '<p>IT</p>',
    images: [], thumbnail: x.thumbnail, basePrice: x.basePrice, salePrice: x.salePrice, certifications: [],
    variations: [{ id: `var-${x.id}`, sku: `SKU-${x.id}`, name: 'Mặc định', attributes: {}, retailPrice: x.basePrice, salePrice: x.salePrice, stock: x.inStock ? 20 : 0 }],
  };
}

export function mockDiscovery(
  api: MockApi,
  opts: { legacy?: boolean; returning?: boolean; shipping?: boolean; subscription?: boolean; forYou?: ProductCard[] } = {},
): void {
  mockSession(api, makeUser({ id: 'user-4b', fullName: 'Khách Khám Phá' }));
  api.get('/products', catalogHandler(opts));
  api.get('/products/for-you', opts.forYou ?? []);
  api.get('/products/:slug', ({ params }) => productDetail(params.slug!) ?? reply(404, { statusCode: 404, message: 'Không tìm thấy sản phẩm.' }));
  api.get('/products/:slug/related', []);
  api.get('/products/:slug/bought-together', []);
  api.get('/products/:slug/reviews', { average: 0, count: 0, items: [] });
  api.get('/brands', [{ brand: 'Tubu', count: 28 }, { brand: 'Mộc An', count: 2 }]);
  api.get('/categories', opts.legacy ? CATEGORIES.map(({ productCount: _p, ...c }) => c) : CATEGORIES);
  api.get('/search/suggest', ({ call }) => suggestFor(call.query.get('q') ?? ''));
  api.get('/cart', EMPTY_CART);
  api.get('/flash-sales/active', []);
  api.get('/flash-sales/upcoming', []);
  api.get('/me/notifications', []);
  api.get('/me/wishlist/ids', []);
  api.get('/me/coupons', []);
  api.get('/affiliate/me', { isAffiliate: false, referralCode: '', walletBalance: 0 });
  api.get('/config/public', publicConfig());
  api.get('/me/purchased-items', opts.returning ? PURCHASED_PAGE : { items: [], nextCursor: null });
  api.get('/orders/active-count', { count: opts.shipping ? 1 : 0 });
  api.get('/orders', ({ call }) => {
    const data = opts.shipping && call.query.get('status') === 'SHIPPING' ? [makeOrder({ code: SHIPPING_CODE, status: 'SHIPPING', paymentStatus: 'PAID' })] : [];
    return { data, meta: { page: 1, limit: 1, total: data.length } };
  });
  api.get('/orders/:code', ({ params }) => makeOrder({ code: params.code!, status: 'SHIPPING', paymentStatus: 'PAID' }));
  api.get('/orders/me/returns', []);
  api.get('/me/subscriptions', opts.subscription ? [SUBSCRIPTION_4B] : []);
  api.post('/events', { accepted: 1 });
  // Fire-and-forget không liên quan nội dung test.
  api.allowUnmocked('POST /affiliate/touch', 'GET /products/:slug/reviews/can-review');
}
```

- [ ] **Step 3: Write the Home spec**

`apps/e2e/tests/buy-flow-4b.miniapp.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { BINH_SUA, SHIPPING_CODE, XA_PHONG, mockDiscovery, toCard } from './support/discovery-mocks';

/**
 * Zalo Mini App E2E — Dự án 4b "Khám phá & tìm kiếm" (spec §5). API mock toàn bộ.
 * Không dùng page.waitForTimeout; assert "vắng mặt" chỉ sau khi đã thấy request + khung chờ biến mất.
 */

/** Các khối Trang chủ CÓ nội dung (cao > 0), theo thứ tự DOM. */
async function visibleBlocks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]'))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.dataset.homeBlock!),
  );
}

/** Hàng đợi sự kiện chỉ xả khi app bị ẩn (hoặc mỗi 10s) — ép xả để các lô /events tới mock ngay. */
async function flushEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function eventsNamed(api: MockApi, eventName: string): { eventName: string; props: Record<string, unknown> }[] {
  return api
    .callsTo('POST', '/events')
    .flatMap((c) => (c.body as { events: { eventName: string; props: Record<string, unknown> }[] }).events)
    .filter((e) => e.eventName === eventName);
}

/** Trang chủ ở trạng thái CUỐI: purchased-items + categories đã trả lời, mọi khung chờ đã biến mất. */
async function waitHomeSettled(page: Page, api: MockApi): Promise<void> {
  await expect.poll(() => api.callsTo('GET', '/me/purchased-items').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => api.callsTo('GET', '/categories').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('purchased-rail-loading')).toHaveCount(0);
  await expect(page.getByTestId('category-grid-loading')).toHaveCount(0);
  await expect(page.getByTestId('catalog-grid-skeleton')).toHaveCount(0);
}

test.describe('Buy-flow 4b — Trang chủ', () => {
  test('Khách cũ: tìm → Mua lại → dải đơn → Dành cho bạn → Bán chạy → Danh mục; lưới SP đầu tiên trong 5 khối đầu', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true, subscription: true, forYou: [toCard(BINH_SUA)] });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Đơn của bạn' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Dành cho bạn' })).toBeVisible();
    await waitHomeSettled(page, api);

    const blocks = await visibleBlocks(page);
    expect(blocks.slice(0, 6)).toEqual(['search', 'purchased', 'orderStrip', 'forYou', 'bestSellers', 'categories']);
    const firstGrid = blocks.findIndex((b) => ['forYou', 'bestSellers', 'featured', 'newArrivals'].includes(b)) + 1;
    expect(firstGrid).toBeLessThanOrEqual(5);
  });

  test('Khách mới: không kệ Mua lại / dải đơn; Bán chạy (theo số đã bán) và Danh mục đứng trước Dành cho bạn', async ({ page, api }) => {
    mockDiscovery(api, { forYou: [toCard(BINH_SUA)] });
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy' });
    await expect(best).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);

    expect((await visibleBlocks(page)).slice(0, 4)).toEqual(['search', 'bestSellers', 'categories', 'forYou']);
    await expect(page.getByRole('region', { name: 'Mua lại' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Đơn của bạn' })).toHaveCount(0);
    await expect(best.getByRole('button').first()).toHaveAccessibleName(XA_PHONG.name);
    expect(api.callsTo('GET', '/products').some((c) => c.query.get('sort') === 'best_seller' && c.query.get('limit') === '6')).toBe(true);
  });

  test('Danh mục thật chỉ hiện mục có hàng; chạm "Cho bé" → /browse?category=cat-baby, có chip gỡ được', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const cats = page.getByRole('region', { name: 'Danh mục' });
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Cà phê & Đồ uống' })).toHaveCount(0);
    await cats.getByRole('button', { name: 'Cho bé' }).click();
    await expect(page).toHaveURL(/\/browse\?category=cat-baby$/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bỏ lọc Cho bé' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm');
  });

  test('A2-33: không còn "Khám phá vườn"; thẻ AI/Mua chung nằm dưới các lưới SP; "Tìm sản phẩm" mở ô tìm đã focus', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const newest = page.getByRole('region', { name: 'Mới về vườn' });
    await expect(newest).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);
    await expect(page.getByText('Khám phá vườn')).toHaveCount(0);
    const [newestBox, aiBox] = await Promise.all([newest.boundingBox(), page.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }).boundingBox()]);
    expect(aiBox!.y).toBeGreaterThan(newestBox!.y);

    await page.getByRole('button', { name: 'Tìm sản phẩm' }).click();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 15_000 }); // ?focus=search đã được dùng rồi bỏ
    await expect(page.getByRole('searchbox', { name: 'Tìm sản phẩm' })).toBeFocused();
  });

  test('Dải đơn: "Đơn … đang giao" mở chi tiết đơn; "Kỳ định kỳ kế tiếp: 15/10" mở tab Định kỳ', async ({ page, api }) => {
    mockDiscovery(api, { returning: true, shipping: true, subscription: true });
    await page.goto('/');
    const strip = page.getByRole('region', { name: 'Đơn của bạn' });
    await expect(strip.getByRole('button', { name: /Kỳ định kỳ kế tiếp: 15\/10/ })).toBeVisible({ timeout: 15_000 });
    expect(api.callsTo('GET', '/orders').some((c) => c.query.get('status') === 'SHIPPING' && c.query.get('limit') === '1')).toBe(true);
    await strip.getByRole('button', { name: new RegExp(`Đơn ${SHIPPING_CODE} đang giao`) }).click();
    await expect(page).toHaveURL(new RegExp(`/order/${SHIPPING_CODE}$`), { timeout: 15_000 });
  });

  test('Đã xem gần đây: mở 1 SP từ "Bán chạy" rồi quay lại → khối "Đã xem gần đây" có SP đó', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy' });
    await expect(best).toBeVisible({ timeout: 15_000 });
    await waitHomeSettled(page, api);
    await expect(page.getByRole('region', { name: 'Đã xem gần đây' })).toHaveCount(0);

    await best.getByRole('button', { name: XA_PHONG.name }).click();
    await expect(page.getByText(`Mô tả ngắn ${XA_PHONG.name}`)).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tubu_recently_viewed') ?? '[]').map((x: { slug: string }) => x.slug))).toEqual([XA_PHONG.slug]);
    await page.goBack();
    const recent = page.getByRole('region', { name: 'Đã xem gần đây' });
    await expect(recent.getByRole('button', { name: XA_PHONG.name })).toBeVisible({ timeout: 15_000 });
  });

  test('Analytics: chạm SP ở Trang chủ không bắn search_result_clicked (chỉ có khi đang tìm)', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy' });
    await best.getByRole('button', { name: XA_PHONG.name }).click({ timeout: 15_000 });
    await expect(page.getByText(`Mô tả ngắn ${XA_PHONG.name}`)).toBeVisible({ timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => api.callsTo('POST', '/events').length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(eventsNamed(api, 'search_result_clicked')).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the spec and the existing miniapp suites**

Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test buy-flow-4b --workers=1 --retries=0` → PASS 7/7.
Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test miniapp.spec buy-flow-4a design-system-pilot --workers=1 --retries=0` → PASS (the 4a tests that read the "Hỏi trợ lý AI 24/7" button still hold: it stays below the rail).
If the fixture reports an unmocked call on the PDP or order detail (e.g. a newly added endpoint), add exactly that `"METHOD /path"` to the `allowUnmocked` call in `mockDiscovery` with a one-line comment.
Run: `pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/tests/support/mock-api.ts apps/e2e/tests/support/discovery-mocks.ts apps/e2e/tests/buy-flow-4b.miniapp.spec.ts
git commit -m "test(e2e): Home block order for returning vs new customers, order strip, real categories and recently viewed (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 25: E2E — Browse: suggest, filters, sort, URL state + back restore, deep links, old API, events

**Files:**
- Modify: `apps/e2e/tests/buy-flow-4b.miniapp.spec.ts` (append a second `describe`)

**Interfaces:**
- Consumes: `mockDiscovery`, `NRC`, `BINH_SUA`, `XA_PHONG` (`support/discovery-mocks.ts`, Task 24); `flushEvents`, `eventsNamed` (Task 24, same file).
- Produces: nothing for later tasks.

- [ ] **Step 1: Append the tests**

Merge `NRC` into the existing `discovery-mocks` import line of `buy-flow-4b.miniapp.spec.ts`, then append:

```ts
test.describe('Buy-flow 4b — Danh mục / Tìm kiếm', () => {
  test('Gợi ý khi gõ (không tải kết quả); Enter mới tìm; từ khoá vào "Tìm gần đây"', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?focus=search');
    const box = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await expect(box).toBeFocused({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/browse$/); // ?focus=search dùng một lần rồi bỏ (replace)

    const suggested = api.waitForCall('GET', '/search/suggest');
    await box.fill('nuoc rua');
    expect((await suggested).query.get('q')).toBe('nuoc rua');
    const sug = page.getByRole('region', { name: 'Gợi ý tìm kiếm' });
    await expect(sug.getByRole('button', { name: new RegExp(NRC.name) })).toBeVisible();
    await expect(sug.getByRole('button', { name: new RegExp(BINH_SUA.name) })).toBeVisible();
    expect(api.callsTo('GET', '/products').some((c) => c.query.get('q') !== null)).toBe(false);

    const searched = api.waitForCall('GET', '/products');
    await box.press('Enter');
    expect((await searched).query.get('q')).toBe('nuoc rua');
    await expect(page).toHaveURL(/\/browse\?q=nuoc\+rua$/);
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });

    await box.click();
    await box.fill('');
    await expect(page.getByRole('group', { name: 'Tìm gần đây' }).getByRole('button', { name: 'nuoc rua' })).toBeVisible();
  });

  test('Bộ lọc: giá + còn hàng + từ 4★ + thương hiệu → nút báo đúng số → áp dụng → URL, request, chip, filter_applied ×4', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Bộ lọc' }).click();
    for (const name of ['100k–200k', 'Chỉ hiện còn hàng', 'Từ 4★ trở lên', 'Tubu']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    const apply = page.getByRole('button', { name: 'Xem 1 sản phẩm' });
    await expect(apply).toBeVisible({ timeout: 15_000 });
    expect(api.callsTo('GET', '/products').some((c) => c.query.get('limit') === '1' && c.query.get('inStock') === 'true')).toBe(true);

    const listed = api.waitForCall('GET', '/products');
    await apply.click();
    expect(Object.fromEntries((await listed).query)).toMatchObject({
      brand: 'Tubu', minPrice: '100000', maxPrice: '200000', inStock: 'true', minRating: '4', limit: '30',
    });
    await expect(page).toHaveURL(/\/browse\?brand=Tubu&minPrice=100000&maxPrice=200000&inStock=1&rating=4$/);
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bỏ lọc Tubu' })).toBeVisible();

    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'filter_applied').length, { timeout: 15_000 }).toBe(4);
    expect(eventsNamed(api, 'filter_applied').map((e) => e.props.type).sort()).toEqual(['brand', 'in_stock', 'price', 'rating']);
  });

  test('Sắp xếp "Bán chạy" → URL sort=best_seller, request có sort, thứ tự theo số đã bán', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse');
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
    const sorted = api.waitForCall('GET', '/products');
    await page.getByRole('group', { name: 'Sắp xếp' }).getByRole('button', { name: 'Bán chạy' }).click();
    expect((await sorted).query.get('sort')).toBe('best_seller');
    await expect(page).toHaveURL(/\/browse\?sort=best_seller$/);
    const tiles = page.getByTestId('catalog-grid').locator('[role="button"][aria-label]');
    await expect(tiles.nth(0)).toHaveAttribute('aria-label', XA_PHONG.name);
    await expect(tiles.nth(1)).toHaveAttribute('aria-label', BINH_SUA.name);
    await expect(tiles.nth(2)).toHaveAttribute('aria-label', NRC.name);
  });

  test('Quay lại từ trang SP giữ sắp xếp/bộ lọc và vị trí cuộn; đổi sắp xếp không thêm mục lịch sử', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?segment=eco');
    await expect(page.getByTestId('result-count')).toHaveText('26 sản phẩm', { timeout: 15_000 });
    const historyBefore = await page.evaluate(() => history.length);
    const sortGroup = page.getByRole('group', { name: 'Sắp xếp' });
    await sortGroup.getByRole('button', { name: 'Bán chạy' }).click();
    await sortGroup.getByRole('button', { name: 'Giá giảm' }).click();
    await expect(page).toHaveURL(/\/browse\?segment=eco&sort=price_desc$/);
    expect(await page.evaluate(() => history.length)).toBe(historyBefore);

    const tile = page.getByRole('button', { name: 'Túi Vải Canvas Tubu số 12', exact: true });
    await tile.scrollIntoViewIfNeeded();
    const scroller = page.locator('.zaui-page', { has: page.getByTestId('catalog-grid') }).first();
    const y = await scroller.evaluate((el) => el.scrollTop);
    expect(y).toBeGreaterThan(300);
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('tubu_scroll:segment=eco&sort=price_desc')), { timeout: 5_000 })
      .toBe(String(Math.round(y)));

    await tile.click();
    await expect(page).toHaveURL(/\/product\/tui-vai-12$/, { timeout: 15_000 });
    await expect(page.getByText('Mô tả ngắn Túi Vải Canvas Tubu số 12')).toBeVisible({ timeout: 15_000 });
    await page.goBack();

    await expect(page).toHaveURL(/\/browse\?segment=eco&sort=price_desc$/, { timeout: 15_000 });
    await expect(page.getByRole('group', { name: 'Sắp xếp' }).getByRole('button', { name: 'Giá giảm' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Bỏ lọc Sống xanh' })).toBeVisible();
    const scrollerBack = page.locator('.zaui-page', { has: page.getByTestId('catalog-grid') }).first();
    await expect.poll(async () => Math.abs((await scrollerBack.evaluate((el) => el.scrollTop)) - y), { timeout: 10_000 }).toBeLessThanOrEqual(4);
  });

  test('Link cũ từ Trang chủ: ?segment=mom_baby và ?brand=Tubu thành chip gỡ được', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?segment=mom_baby');
    const chip = page.getByRole('button', { name: 'Bỏ lọc Cho mẹ & bé' });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 sản phẩm');
    await chip.click();
    await expect(page).toHaveURL(/\/browse$/);
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });

    await page.goto('/browse?brand=Tubu');
    await expect(page.getByRole('button', { name: 'Bỏ lọc Tubu' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('28 sản phẩm');
  });

  test('API cũ: bộ lọc mới bị 400 → tải lại không lọc + câu báo, không ErrorState; danh mục về 4 phân khúc', async ({ page, api }) => {
    mockDiscovery(api, { legacy: true });
    await page.goto('/browse?inStock=1');
    await expect(page.getByText(/Bộ lọc nâng cao chưa dùng được/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm');
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
    const lists = api.callsTo('GET', '/products').filter((c) => c.query.get('limit') === '30');
    expect(lists[0]!.query.get('inStock')).toBe('true');
    expect(lists[1]!.query.get('inStock')).toBeNull();

    await page.goto('/browse');
    await expect.poll(() => api.callsTo('GET', '/categories').length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('category-grid-loading')).toHaveCount(0);
    const cats = page.getByRole('region', { name: 'Danh mục' });
    await expect(cats.getByRole('button', { name: 'Cho mẹ & bé' })).toBeVisible({ timeout: 15_000 });
    await expect(cats.getByRole('button', { name: 'Tẩy rửa sinh học' })).toHaveCount(0);
  });

  test('Chạm kết quả khi đang tìm → search_result_clicked { q, position, source, slug }; search_performed có resultsCount', async ({ page, api }) => {
    mockDiscovery(api);
    await page.goto('/browse?q=nuoc%20rua');
    await expect(page.getByTestId('result-count')).toHaveText('2 sản phẩm', { timeout: 15_000 });
    await page.getByTestId('catalog-grid').locator('[role="button"][aria-label]').nth(1).click();
    await expect(page).toHaveURL(/\/product\//, { timeout: 15_000 });
    await flushEvents(page);
    await expect.poll(() => eventsNamed(api, 'search_result_clicked').length, { timeout: 15_000 }).toBe(1);
    expect(eventsNamed(api, 'search_result_clicked')[0]!.props).toEqual({ q: 'nuoc rua', position: 2, source: 'results', slug: BINH_SUA.slug });
    expect(eventsNamed(api, 'search_performed').map((e) => e.props)).toContainEqual({ q: 'nuoc rua', resultsCount: 2 });
  });

  test('Không có kết quả → EmptyState + "Đã xem gần đây"; "Xoá tìm kiếm & bộ lọc" giữ sắp xếp', async ({ page, api }) => {
    await page.addInitScript(() =>
      localStorage.setItem('tubu_recently_viewed', JSON.stringify([{ slug: 'xa-phong-thao-moc', name: 'Xà Phòng Thảo Mộc', thumbnail: null, price: 45000, viewedAt: 1 }])),
    );
    mockDiscovery(api);
    await page.goto('/browse?q=zzzz&sort=newest');
    await expect(page.getByText('Không tìm thấy "zzzz"')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Đã xem gần đây' }).getByRole('button', { name: 'Xà Phòng Thảo Mộc' })).toBeVisible();
    await page.getByRole('button', { name: 'Xoá tìm kiếm & bộ lọc' }).click();
    await expect(page).toHaveURL(/\/browse\?sort=newest$/);
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test buy-flow-4b --workers=1 --retries=0`
Expected: PASS (7 from Task 24 + 8 here). A failing scroll-restore assertion is a real defect in `useScrollRestoration` / Browse (fix the code, not the tolerance).
Run: `pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/buy-flow-4b.miniapp.spec.ts
git commit -m "test(e2e): Browse suggest, filters, best-seller sort, URL state with back-restore, deep links, old API and search events (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 26: E2E — layout at 320/375/390px, chip hit areas, skeleton height guards

**Files:**
- Modify: `apps/e2e/tests/buy-flow-4b.miniapp.spec.ts` (append a third `describe`)

**Interfaces:**
- Consumes: `mockDiscovery`, `catalogHandler`, `BINH_SUA`, `toCard` (Task 24); `waitHomeSettled` (Task 24, same file); `MockContext` (`support/mock-api.ts`).
- Produces: screenshots `home-4b-<w>.png`, `browse-4b-<w>.png`, `filter-sheet-4b-<w>.png` (w = 320, 375, 390) under the Playwright output dir, reviewed in Task 27.

- [ ] **Step 1: Append the tests**

Add `catalogHandler` to the `discovery-mocks` import and `type MockContext` to the `mock-api` import of the spec, then append:

```ts
test.describe('Buy-flow 4b — bố cục 320/375/390, vùng chạm, khung chờ', () => {
  const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  /** Phần tử đứng yên qua 2 khung hình (sheet trượt xong) — không dùng waitForTimeout. */
  const settled = (locator: ReturnType<Page['getByRole']>) =>
    locator.evaluate(
      (el) =>
        new Promise<boolean>((resolve) => {
          const y0 = el.getBoundingClientRect().y;
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(el.getBoundingClientRect().y - y0) < 0.5)));
        }),
    );

  for (const width of [320, 375, 390]) {
    test(`${width}px: Trang chủ (khách cũ), Danh mục, Bộ lọc — không tràn ngang, nút nằm trọn, chip có vùng chạm 44px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 740 });
      mockDiscovery(api, { returning: true, shipping: true, subscription: true, forYou: [toCard(BINH_SUA)] });
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Mua lại' })).toBeVisible({ timeout: 15_000 });
      await waitHomeSettled(page, api);
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`home-4b-${width}.png`), fullPage: true });

      await page.goto('/browse');
      await expect(page.getByTestId('result-count')).toHaveText('30 sản phẩm', { timeout: 15_000 });
      expect(await noHorizontalScroll(page)).toBe(true);
      for (const name of ['Gợi ý', 'Bán chạy']) {
        const chip = page.getByRole('group', { name: 'Sắp xếp' }).getByRole('button', { name, exact: true });
        const hit = await chip.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const at = (y: number) => document.elementFromPoint(x, y)?.closest('[role="button"]') === el;
          return { above: at(r.top - 3), below: at(r.bottom + 3) };
        });
        expect(hit, `"${name}": vùng chạm phải phủ ≥ 44px theo chiều dọc`).toEqual({ above: true, below: true });
      }
      await page.screenshot({ path: test.info().outputPath(`browse-4b-${width}.png`) });

      await page.getByRole('button', { name: 'Bộ lọc' }).click();
      const apply = page.getByRole('button', { name: /^Xem \d+ sản phẩm$/ });
      await expect(apply).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => settled(apply), { timeout: 5_000 }).toBe(true);
      const b = (await apply.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, 'nút áp dụng tràn phải').toBeLessThanOrEqual(width);
      expect(b.y + b.height, 'nút áp dụng ra ngoài màn hình').toBeLessThanOrEqual(740);
      expect(b.height).toBeGreaterThanOrEqual(44);
      const reset = page.getByRole('button', { name: 'Xoá bộ lọc' });
      const label = reset.locator('.zaui-btn-container > span:not(.zaui-btn-icon)');
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), '"Xoá bộ lọc" bị rút gọn').toBe(true);
      await page.screenshot({ path: test.info().outputPath(`filter-sheet-4b-${width}.png`) });
    });
  }

  test('375px: khung chờ "Bán chạy" (Trang chủ) và lưới kết quả (Danh mục) cao xấp xỉ thẻ thật (≤ 16px)', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    mockDiscovery(api);
    const real = catalogHandler();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.get('/products', async (ctx: MockContext) => {
      if (ctx.call.query.get('sort') === 'best_seller') await gate;
      return real(ctx);
    });
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy' });
    const skel = best.getByTestId('catalog-tile-skeleton').first();
    await expect(skel).toBeVisible({ timeout: 15_000 });
    const skelH = (await skel.boundingBox())!.height;
    release();
    const tile = best.locator('[role="button"][aria-label]').first();
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await expect(best.getByTestId('catalog-tile-skeleton')).toHaveCount(0);
    const tileH = (await tile.boundingBox())!.height;
    expect(Math.abs(skelH - tileH), `Trang chủ: khung chờ ${skelH}px vs thẻ ${tileH}px`).toBeLessThanOrEqual(16);

    let release2: () => void = () => {};
    const gate2 = new Promise<void>((resolve) => { release2 = resolve; });
    api.get('/products', async (ctx: MockContext) => {
      if (ctx.call.query.get('limit') === '30') await gate2;
      return real(ctx);
    });
    await page.goto('/browse?sort=newest');
    const skel2 = page.getByTestId('catalog-tile-skeleton').first();
    await expect(skel2).toBeVisible({ timeout: 15_000 });
    const skel2H = (await skel2.boundingBox())!.height;
    release2();
    const tile2 = page.getByTestId('catalog-grid').locator('[role="button"][aria-label]').first();
    await expect(tile2).toBeVisible({ timeout: 15_000 });
    const tile2H = (await tile2.boundingBox())!.height;
    expect(Math.abs(skel2H - tile2H), `Danh mục: khung chờ ${skel2H}px vs thẻ ${tile2H}px`).toBeLessThanOrEqual(16);
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test buy-flow-4b --workers=1 --retries=0`
Expected: PASS (15 + 4). A failing layout/hit-area/skeleton assertion is a real defect in the component under test — e.g. adjust `TILE_BODY_HEIGHT` in `catalog-grid.tsx` to the measured tile body, add `minWidth: 0` to an overflowing DS `Button`, or increase a chip row's vertical padding — never loosen the threshold.
Run: `pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/buy-flow-4b.miniapp.spec.ts
git commit -m "test(e2e): 320/375/390px layout, chip hit areas and skeleton height guards for Home and Browse (buy-flow 4b)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 27: Full-suite verification, screenshots, follow-up ledger

**Files:**
- Modify: `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch ready for review; screenshots reviewed at 320/375/390px; ledger + deploy notes updated.

- [ ] **Step 1: Run every suite (Docker up for the race specs)**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json && npx jest && DATABASE_URL="$IT_DATABASE_URL" npx jest -c test/integration-race/jest.config.js --runInBand && cd ../..
pnpm --filter @tubutree/miniapp exec tsc --noEmit
pnpm --filter @tubutree/miniapp exec vitest run
pnpm lint:vars
pnpm --filter @tubutree/e2e exec tsc --noEmit -p tsconfig.json
E2E_SCOPE=miniapp pnpm --filter @tubutree/e2e exec playwright test --workers=1 --retries=0
```

Expected: all green. The race run includes pre-existing specs (only the known intermittent `order-cancel` case (b) P2028 may need one re-run). The Playwright run covers every `*.miniapp.spec.ts`; they rely on the `mockSession` defaults from Task 24.

- [ ] **Step 2: Lint the touched files (no new errors)**

```bash
pnpm --filter @tubutree/miniapp exec eslint src/pages/home.tsx src/pages/browse.tsx src/pages/product-detail.tsx src/components src/hooks src/utils src/services
cd apps/api && npx eslint "src/modules/catalog/**/*.ts" && cd ../..
```

Expected: `home.tsx`, `browse.tsx`, `product-detail.tsx` and every file created/rewritten by this plan are clean; any remaining miniapp error must be one that existed before 4b in a file this plan did not touch. For a file in doubt, lint its baseline version without touching the working tree: `git show 60643ae:apps/miniapp/<file> | pnpm --filter @tubutree/miniapp exec eslint --stdin --stdin-filename <file>` (run from the repo root; `<file>` relative to `apps/miniapp`). Any other error is new and must be fixed in the file that introduced it.

- [ ] **Step 3: Visual check at 320, 375 and 390px**

Open `apps/e2e/test-results/**/home-4b-{320,375,390}.png`, `browse-4b-*.png`, `filter-sheet-4b-*.png`. Check: Home starts with search → Mua lại → dải đơn → Dành cho bạn → Bán chạy; no "Khám phá vườn"; AI/Mua chung are small cards near the bottom; category cards legible, labels ellipsized not overflowing at 320px; sort chips and active-filter chips not clipped vertically; result count and "Bộ lọc" button on one row at 320px; filter sheet footer buttons fully visible, "Xem n sản phẩm" not truncated; double-diacritic capitals in buttons ("Xoá bộ lọc", "Tìm sản phẩm") not clipped at the top. Record any defect as a fix commit in the owning task's files before continuing.

- [ ] **Step 4: Update the follow-up ledger**

In `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md`:
- Under "Deferred review findings", in the line starting "Inter ships weights 400/500 only", change "Chip (32/36px) is under the 44px touch target" to "Chip (32/36px) is under the 44px touch target — hit area fixed in 4b (Task 12, `.tubu-hit-44`)".
- Under "Must-do early in sub-project 4", append to the guard item: "; extended in 4b (Task 23, full alias family list, Home/Browse/catalog/home components)".
- Add a section after "Buy-flow 4a follow-ups":

```markdown
## Buy-flow 4b follow-ups
- `FlashSale` / `UpcomingFlashSales` (`components/flash-sale.tsx`) still use ZaUI `Text`/`Box` and legacy vars; they render inside the DS v2 Home. Migrate with the flash-sale screens.
- Price sorts (`price_asc`/`price_desc`) still order by `basePrice` while the price filter uses the displayed price `salePrice ?? basePrice`; align when a sale-heavy catalog makes the difference visible.
- `best_seller` ranks every matching product in memory (3 columns); add a stored, indexed `soldTotal` column if the catalog grows past ~5k products.
- Real categories only show when products carry `categoryIds`; Pancake sync never writes them, so prod shows the 4 segments until categories are assigned (admin work, sub-project 7).
- PDP `RelatedTile` duplicates `CatalogTile`'s pricing/badge logic — switch it to `CatalogTile` in 4c; legacy `components/product-card.tsx` is still used by `wishlist.tsx`.
- "Xu hướng" was removed; real trending keywords need search logging (not built).
- Recently viewed is device-local (`localStorage`), not synced across devices.
```

- Under "Deploy notes", append:

```markdown
- 4b: no migration. `GET /categories` gains an additive `productCount`; `GET /products` accepts optional `minPrice`, `maxPrice`, `inStock`, `minRating`, and `sort=best_seller` now really sorts by units sold. Deploy the API before the miniapp; a pre-4b API answers 400 to the new params (the miniapp retries without them and shows a notice). Do NOT roll the API back below 4b while the 4b miniapp is live. Unaccented search uses the built-in `translate()` — no `CREATE EXTENSION`, nothing to run on the prod database.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-28-design-system-v2-followups.md
git commit -m "docs(ds): record buy-flow 4b follow-ups and deploy notes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Deploy reminder (not part of this plan's execution): API first (no migration), then miniapp.

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| 5b.1 Home fully DS v2 (no legacy vars, no ZaUI Text/Box) | 19, 20, 21, 23 |
| 5b.1 block order returning vs new; Mua lại first under search; strip "đơn đang giao / kỳ định kỳ kế tiếp" | 19 (`homeBlockOrder`, `OrderStrip`), 21, 24 |
| 5b.1 Flash sale → Dành cho bạn → Bán chạy → Danh mục thật → Đã xem gần đây → Featured/Mới về | 19, 21 (+ Ruling 8), 24 |
| 5b.1 AI/Mua chung demoted to small cards; hero copy ≠ "Khám phá vườn" (A2-33) | 20, 21, 24 |
| 5b.1 first product grid within the first 5 blocks | 19 (unit), 24 (e2e on rendered blocks) |
| 5b.2 real categories from `GET /categories`, fallback 4 segments; drop "Xu hướng" | 6, 11, 14, 18, 24, 25 (+ Rulings 4, 12) |
| 5b.2 suggest-as-you-type (`/search/suggest`, 250ms, products + categories + recent) | 4, 11, 16, 18, 25 (+ Ruling 5) |
| 5b.2 / §2 unaccented search | 1, 4, 7, 8 (+ Ruling 1) |
| 5b.2 FilterSheet (price, in stock, brand, rating ≥4), apply button with result count | 2, 3, 15, 18, 25 (+ Rulings 3, 18) |
| 5b.2 sort Gợi ý · Bán chạy · Mới nhất · Giá tăng · Giá giảm; real `best_seller` | 5, 14, 18, 25 (+ Ruling 2) |
| 5b.2 URL-synced q/sort/filters/segment/brand (`replace:true`), back from PDP restores; scroll restore via sessionStorage keyed by URL | 9, 11, 18, 25 (+ Ruling 7) |
| 5b.2 result count; `search_performed` + `search_result_clicked`; §3.4 `filter_applied` | 8, 14, 18, 24, 25 (+ Ruling 17) |
| 5b.3 `GET /products` `minPrice`, `maxPrice`, `inStock`, `best_seller`, unaccent; backward compatible | 2, 3, 4, 5, 7 |
| 5b.4 recently viewed (`tubu_recently_viewed`, 20 items, PDP write, Home + empty search) | 10, 17, 18, 21, 22, 24, 25 (+ Ruling 11) |
| §9 skeletons, silent hide when empty, ErrorState with "Thử lại" in Browse; deploy order + degradation | 13, 14, 17, 18, 19, 20 (+ Ruling 6), 25 |
| §10 unit (vitest/jest), real Postgres for new SQL, e2e mocked at 320/375/390, screenshots, full suite `--workers=1` | every task; 7; 24–27 |
| §11 unaccent risk; legacy alias block kept, 4b files free of it | Ruling 1, 23 |
| Carry-overs touching 4b files (Chip 44px, rail limit export, 4a e2e lessons) | 12, 21, Global Constraints, 24–26 (+ Ruling 19) |

No gaps for 4b. Out of scope by design: PDP layout/stock alerts (4c), cart/checkout (4d), image srcset (A2-49/50), migration of `FlashSale` components (Ruling 10).

**2. Placeholder scan** — no "TBD"/"TODO"/"similar to Task N"; every code step contains the code. The conditional instructions (add one discovered unmocked call to `allowUnmocked` in `mockDiscovery`; fix the component if a layout/hit-area/skeleton assertion fails; re-run the known P2028 race flake once) name the exact file and the action.

**3. Type consistency** — checked across tasks: `CatalogQuery`/`CatalogSort`/`CatalogPage.filtersIgnored` (Task 8) are what `toCatalogQuery` returns (Task 9) and what `FilterSheet`/Browse consume (15, 18); `SearchState`/`FilterDraft`/`ActiveFilterChip` (Task 9) match `ResultHeader.onPatch`, `FilterSheet.onApply`, `changedFilterTypes` (14, 15, 18); `FilterType` is defined once in `discovery-events.ts` and imported as a type by `search-state.ts`; `useSearchState()` → `{ state, urlKey, focusSearch, update, consumeFocus }` (9) as used in 18; `useScrollRestoration(key, ready)` → `{ anchorRef }` (11, 18); `useCategories()` → `{ entries, categories, isLoading }` and `CategoryEntry` (11, 14, 16, 18, 21); `useSuggest(draft)` → `{ products, isFetching }` (11, 18); `useRecentlyViewed()`/`recordRecentlyViewed(item, now?, storage?)` (10, 17, 22); `SectionQuery` accepts both `UseQueryResult<PageResponse<ProductCard>>` and the `select`ed for-you result (20, 21); `PURCHASED_RAIL_LIMIT = 10` keeps the 4a query key `['purchased-items', 10]` (21); `HomeBlockId` values equal the `data-home-block` attributes asserted in Tasks 21 and 24; query keys `['products','browse',urlKey]`, `['products','count',key]`, `['products','home-best-seller']`, `['categories']`, `['search-suggest',term]`, `['orders','home-strip']`, `['subscriptions']` are used consistently and all fall under `HOME_QUERY_PREFIXES`/existing invalidations; API `CategoryWithCount.productCount` ↔ miniapp `CategoryDTO.productCount?`; e2e `catalogHandler` mirrors the API's param names (`minPrice`, `maxPrice`, `inStock=true`, `minRating`) while the miniapp URL uses `inStock=1`/`rating=4` (by design: URL ≠ API params, translated in `toCatalogQuery`/`catalogParams`).

**4. Review Focus** — each line has a pinning test: Vietnamese/uppercase/NFD queries on the real collation (Task 7 tests 1–2, Task 1 `sqlFold` cross-check); `%`/`_` literal (Task 1 escape test, Task 4 escaped param, Task 7 `q: '%'`/`'_'`); 4b miniapp vs pre-4b API (Task 8 three `fetchCatalog` cases, Task 18 notice, Task 25 legacy e2e); back from PDP restores state + scroll and filters do not stack history (Task 9 `REPLACE` navigation type, Task 11 save/restore, Task 25 history length + scroll ±4px); paging under ties (Task 3 id tiebreaker, Task 5 page 1/2, Task 7 best_seller pages and 5 tied products over 3 pages).

