# ProductStoryShowcase + Story Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Dải scrollytelling `ProductStoryShowcase` (Mini App 375px + web responsive) cho trang chi tiết sản phẩm, 10 kịch bản mẫu thuộc 3 nhóm hàng, cộng Admin Story Studio và Auto-Asset Pipeline.

**Architecture:** Một cấu hình `ProductStoryConfig` (JSON, cột `Product.storyConfig` nullable) mô tả 3 loại cảnh. Kiểu và bộ kiểm hợp lệ nằm ở `packages/shared-types` (API không phụ thuộc app-core). Logic thuần (preset, tự sinh, view model) ở `packages/app-core/src/commerce`; hai app chỉ vẽ cùng tên thành phần, cùng props. Sprite nguyên liệu là dữ liệu SVG nội tuyến trong app-core (không cần tải tài nguyên, dùng được trong Admin Live Preview).

**Tech Stack:** NestJS + Prisma + sharp, Next 15, Vite Mini App, vitest/jest, Playwright, CSS tokens `packages/design-tokens`.

**Spec:** `docs/superpowers/specs/2026-11-05-immersive-product-story-design.md`

## Global Constraints

- Làm đúng `DESIGN.md` + `.claude/skills/tubu-ui/SKILL.md`: chỉ token semantic, không hex, không `fontSize` số, không lề âm ngang, giá gạch chỉ qua `PriceTag`.
- Chữ giao diện chỉ ở `packages/app-core/src/shop-copy.ts` (+ ngân sách `shop-copy-budget.ts`), không thuật ngữ cấm của `terminology.spec.ts`.
- Mini 375px làm trước, web cùng nhánh, cùng tên `ProductStoryShowcase`, cùng props; web dưới `md` cùng số đo Mini (`pnpm lint:parity`, `ds-parity.shop.spec.ts` xanh, không nới `scripts/uiux/ds-baseline.json`).
- Migration chỉ thêm cột nullable: `ALTER TABLE ... ADD COLUMN "storyConfig" JSONB`.
- `prefers-reduced-motion: reduce` → trạng thái tĩnh đủ nội dung; văn bản mô tả/thành phần HTML vẫn có trong DOM (SEO).
- Nút mới vào `hit-target-guard.spec.tsx` (≥44px); màu mới vào `contrast.spec.ts`.
- RAM: `VITEST_MAX_WORKERS=1` mọi lệnh test; tối đa 2 subagent song song, model `sonnet` effort `medium`; `opus` chỉ cho review cuối.
- Không push, không PR, không deploy, không đụng PROD/DB chung (chủ chưa cho phép). Commit cục bộ trên `feat/product-story-showcase-1105`.
- Giới hạn cấu hình (hằng `STORY_LIMITS` ở shared-types): ≤3 cảnh, ≤5 bước, ≤6 lớp nguyên liệu mỗi bước, ≤4 điểm HUD, ≤8 mục vòng cung, nhãn ≤40 ký tự, thân bước ≤140, toạ độ 0–100, JSON ≤16 KB.

## Review Focus

- `storyConfig` rác/độc (script trong nhãn, URL `javascript:`, số âm/NaN, mảng khổng lồ): API từ chối 400 và phía vẽ không vỡ; nhãn luôn là text, ảnh chỉ https.
- Sản phẩm không có `storyConfig`, không preset, không `ingredients`: không vẽ gì, trang không đổi.
- Sản phẩm 1 biến thể hoặc 0 biến thể: không vẽ vòng cung.
- `ingredients` thiếu `percentage`/`benefit`, `ingredients` là chuỗi hay object lạ (cột Json cũ): tự sinh không ném lỗi.
- URL trích xuất trỏ về mạng nội bộ (`127.0.0.1`, `169.254.169.254`, redirect sang IP riêng), ảnh khổng lồ, không phải ảnh: từ chối.
- Bật modal toàn màn hình: Esc đóng, trả focus, khoá cuộn nền, thanh Mua ngay không che nội dung.

---

### Task 1: Kiểu và bộ kiểm hợp lệ `storyConfig` (shared-types)

**Files:**
- Create: `packages/shared-types/src/product-story.ts`, `packages/shared-types/src/product-story.spec.ts`
- Modify: `packages/shared-types/src/index.ts` (export)

**Interfaces:**
- Produces: `STORY_LIMITS`; `type StoryAmbient = 'leaf'|'amber'|'rose'|'sky'|'sand'`; `type StoryFrom = 'top'|'left'|'right'|'bottom'`; `interface IngredientLayerSprite { id: string; spriteId?: string; imageUrl?: string; label: string; from: StoryFrom; xPct: number; yPct: number; scale: number; rotateDeg: number }`; `interface AssemblyStep { title: string; body: string; layers: IngredientLayerSprite[] }`; `interface HudCalloutPoint { id: string; xPct: number; yPct: number; label: string; value?: string; barPct?: number; side: 'left'|'right' }`; `interface VariantArcItem { variationId?: string; label: string; ambient: StoryAmbient }`; `type StoryScene = {kind:'variant_arc'; items: VariantArcItem[]} | {kind:'ingredient_assembly'; steps: AssemblyStep[]} | {kind:'hud_callouts'; points: HudCalloutPoint[]; closing: string}`; `interface ProductStoryConfig { version: 1; enabled: boolean; cutoutUrl?: string; scenes: StoryScene[] }`; `parseStoryConfig(raw: unknown): { ok: true; value: ProductStoryConfig } | { ok: false; error: string }` (nghiêm: bỏ khoá lạ, kẹp toạ độ 0–100, từ chối vượt giới hạn, `imageUrl`/`cutoutUrl` chỉ `https:` hoặc đường dẫn `/api/...` của ảnh đã đăng ký; nhãn bị cắt `<`/`>`).

- [ ] **Step 1: Test hỏng** — `product-story.spec.ts`: `parses a valid 3-scene config`; `rejects javascript: imageUrl`; `rejects >5 steps`; `clamps xPct 140 to 100 and -5 to 0`; `rejects NaN yPct`; `strips unknown keys`; `rejects JSON over 16KB`; `strips angle brackets from labels`; `rejects version 2`.
- [ ] **Step 2: Chạy, thấy đỏ** — `VITEST_MAX_WORKERS=1 pnpm --filter @tubutree/shared-types test product-story` → FAIL (module thiếu). (Nếu package dùng jest thì dùng lệnh `test` của nó.)
- [ ] **Step 3: Cài `parseStoryConfig` + kiểu + `STORY_LIMITS`** theo khối Interfaces. Không dùng thư viện; hàm thuần.
- [ ] **Step 4: Chạy, thấy xanh** — cùng lệnh → PASS.
- [ ] **Step 5: Commit** — `feat(story): kiểu và bộ kiểm storyConfig`.

### Task 2: Cột `storyConfig` + đọc/ghi qua API

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (thêm `storyConfig Json?` sau `certifications`, dòng ~499), `apps/api/src/modules/catalog/catalog.service.ts:203` (`publicProductSelect` thêm `storyConfig: true`), `apps/api/src/modules/catalog/catalog-public.ts` (thêm `'storyConfig'` vào `PUBLIC_PRODUCT_DETAIL_KEYS`), `apps/api/src/modules/catalog/product-admin.service.ts` (SELECT, `ProductPatch.storyConfig?: unknown | null`, `view`), `apps/api/src/modules/catalog/product-admin.controller.ts` (`UpdateProductDto.storyConfig`), `apps/web/src/lib/product-categories.ts` (`ProductDetail.storyConfig`, `ProductPatch.storyConfig`), `packages/app-core/src/api/catalog.ts` (`ProductDetail.storyConfig?: ProductStoryConfig | null`)
- Create: `apps/api/prisma/migrations/20261105200000_product_story_config/migration.sql`
- Test: `apps/api/src/modules/catalog/product-admin.service.spec.ts`, `apps/api/src/modules/catalog/catalog-public.spec.ts` (hoặc spec cạnh nhất có sẵn)

**Interfaces:**
- Consumes: `parseStoryConfig` (Task 1).
- Produces: `GET /products/:slug` trả `storyConfig: ProductStoryConfig | null` (không kèm ở thẻ danh sách: `card-select.ts` giữ nguyên); `PATCH /admin/catalog-products/:id` nhận `storyConfig` (đối tượng hợp lệ hoặc `null` = xoá); `GET` admin trả `storyConfig`.

- [ ] **Step 1: Test hỏng** — `product-admin.service.spec.ts`: `saves a valid storyConfig`; `null clears storyConfig`; `rejects invalid storyConfig with 400 and does not write`; `partner-owned product may still get storyConfig` (admin được sửa, khác ảnh/mô tả); `public detail exposes storyConfig, card select does not`.
- [ ] **Step 2: Chạy, thấy đỏ** — `pnpm --filter @tubutree/api exec jest product-admin.service catalog-public` → FAIL.
- [ ] **Step 3: Viết migration SQL + sửa schema + `prisma generate`** (chạy trong `apps/api`, xem `env-lessons`). Service: `parseStoryConfig` → lỗi thì `BadRequestException('Cấu hình câu chuyện sản phẩm không hợp lệ: ...')`; `null` ghi `Prisma.DbNull`; `storyConfig` không làm đổi `thumbnail`/`touchesContent`.
- [ ] **Step 4: Chạy xanh** + `pnpm --filter @tubutree/api exec tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(story): cột storyConfig, đọc công khai, ghi qua admin`.

### Task 3: Logic thuần app-core: sprite, preset, tự sinh, view model, chữ

**Files:**
- Create: `packages/app-core/src/commerce/story-sprites.ts`, `story-presets.ts`, `product-story.ts`, và spec cạnh từng file
- Modify: `packages/app-core/src/shop-copy.ts` + `shop-copy-budget.ts` (khoá `story.*`), barrel `commerce` nếu có

**Interfaces:**
- Consumes: `ProductStoryConfig`, `parseStoryConfig` (Task 1); `ProductDetail` (`api/catalog.ts`).
- Produces:
  - `STORY_SPRITES: Record<string, { label: string; viewBox: string; paths: { d: string; tone: StoryTone }[] }>` đủ 13 id: `pomelo-peel, pomelo-slice, gleditsia-pod, ocimum-leaf, lemongrass, centella-leaf, shea-butter, arabica-bean, honey-drop, pineapple-enzyme, granola-clusters, cajeput-leaf, water-droplet`; `StoryTone` = `'leaf'|'amber'|'rose'|'sky'|'sand'|'ink'` (tên token semantic).
  - `STORY_PRESETS: Record<string, ProductStoryConfig>` khoá theo slug, đủ 10 slug trong spec §1.1.
  - `buildDefaultStoryConfig(p: Pick<ProductDetail,'name'|'brand'|'shortDesc'|'description'|'ingredients'|'certifications'|'variations'>): ProductStoryConfig | null` — null khi không có `ingredients` dùng được và không có ≥2 biến thể; bước 1–5 lấy chữ từ `story.step1..5`; điểm HUD từ `ingredients[].percentage`; chịu được `ingredients` kiểu lạ.
  - `resolveStoryConfig(p: ProductDetail): ProductStoryConfig | null` — thứ tự: `p.storyConfig` (hợp lệ, `enabled`) > preset theo `p.slug` > `buildDefaultStoryConfig`; `enabled:false` → null.
  - `storyView(config: ProductStoryConfig, opts: { reducedMotion: boolean }): StoryViewModel` — thuần, cho cả hai app: cảnh, `steps` có nhãn `01..05`, cờ `animated`, `staticLayers` khi giảm chuyển động.
  - `ambientVar(a: StoryAmbient): string` trả tên biến CSS semantic (đọc `tokens.css`, chọn cặp có sẵn; không hex).

- [ ] **Step 1: Test hỏng** — `story-presets.spec.ts`: `every one of the 10 spec slugs has a preset that passes parseStoryConfig` (đủ 3 nhóm); `every preset spriteId exists in STORY_SPRITES`. `product-story.spec.ts`: `resolve prefers stored config over preset`; `enabled:false returns null`; `falls back to default from ingredients`; `weird ingredients (string, object, null) never throw`; `no ingredients and 1 variation returns null`; `storyView reducedMotion has staticLayers and animated=false`. `shop-copy` specs xanh với khoá mới.
- [ ] **Step 2: Chạy đỏ** — `VITEST_MAX_WORKERS=1 pnpm --filter @tubutree/app-core test story`.
- [ ] **Step 3: Cài** theo Interfaces. Preset viết tay bằng tiếng Việt có dấu theo thành phần thật trong `apps/api/prisma/seed.ts` (dòng 447–611); kịch bản 5 bước theo spec (Tinh tuyển → Chiết xuất/Lên men → Hoà quyện → Tinh chất hoàn thiện → An lành cho cả nhà); số liệu HUD (`2%`, `0%`, `98%`) chỉ dùng khi có trong `ingredients` hoặc chứng nhận của seed, không bịa thông số.
- [ ] **Step 4: Chạy xanh** — cùng lệnh + `pnpm --filter @tubutree/app-core test` đủ bộ (`terminology`, `shop-copy`, `design-docs`).
- [ ] **Step 5: Commit** — `feat(story): sprite, 10 preset, tự sinh, view model`.

### Task 4: Mini App `ProductStoryShowcase` + nối vào PDP

**Files:**
- Create: `apps/miniapp/src/components/ui/product-story-showcase.tsx` + `.spec.tsx`, `apps/miniapp/src/components/ui/story-sprite.tsx` (vẽ SVG sprite)
- Modify: `apps/miniapp/src/pages/product-detail.tsx` (chèn ngay dưới khối ảnh/giá/phân loại, trước khối thành phần dòng ~904; nút "Xem câu chuyện sản phẩm" trên khung ảnh), `apps/miniapp/src/css/*` (kiểu cảnh, `@media (prefers-reduced-motion)`), `contrast.spec.ts`, `hit-target-guard.spec.tsx`

**Interfaces:**
- Consumes: `resolveStoryConfig`, `storyView`, `ambientVar` (Task 3).
- Produces: `ProductStoryShowcase(props: { product: ProductDetail; selectedVariationId?: string; onSelectVariation?: (id: string) => void; onAddToCart?: () => void; onBuyNow?: () => void; fullscreen?: boolean; onClose?: () => void; previewConfig?: ProductStoryConfig })` — `previewConfig` ghi đè cấu hình (dùng cho Admin Live Preview). Props giữ y hệt ở web.

- [ ] **Step 1: Test hỏng** — `renders nothing when no config`; `variant arc: tapping an item calls onSelectVariation and sets ambient`; `steps 01..05 chips switch the active step (aria-current)`; `reduced motion renders all steps statically`; `fullscreen: Esc calls onClose, role=dialog, buy bar has 2 buttons`; `HUD callouts render label+value as text`; `hostile label renders as text not HTML`.
- [ ] **Step 2: Chạy đỏ** — `VITEST_MAX_WORKERS=1 pnpm --filter @tubutree/miniapp test product-story-showcase`.
- [ ] **Step 3: Cài** component: 3 cảnh theo `storyView`; chuyển động bằng CSS transform + `IntersectionObserver` (không thư viện); thanh bước `01..05` + vuốt ngang bằng `scroll-snap`; chế độ toàn màn hình khung `100dvh` + khoá cuộn nền + trả focus. Ghép vào PDP; phân loại dùng chung state với khối chọn hiện có.
- [ ] **Step 4: Chạy xanh** + `pnpm --filter @tubutree/miniapp test` đủ bộ (`ds-shop-guard`, `hit-target-guard`, `contrast`, `product-detail*`) + `tsc`.
- [ ] **Step 5: Commit** — `feat(story): ProductStoryShowcase Mini App`.

### Task 5: Web `ProductStoryShowcase` + trang `/san-pham/[slug]`

**Files:**
- Create: `apps/web/src/components/mini/product-story-showcase.tsx` + `.spec.tsx` (+ `story-sprite.tsx`, phần cảnh trong `mini.css`)
- Modify: `apps/web/src/app/san-pham/[slug]/page.tsx` (chèn dưới khối Mua nhanh, trước `below`), `apps/web/src/components/mini/index.ts`

**Interfaces:**
- Consumes: giống Task 4; **cùng props** (kiểm bởi `check-ds-parity.mjs`).
- Produces: web dưới `md` cùng số đo Mini; từ `md` hai cột (sân khấu `position: sticky` bên phải, cột bước bên trái + chỉ báo `01..05`), modal Reel.

- [ ] **Step 1: Test hỏng** — bộ test Task 4 chuyển sang web + `md layout renders two columns` (kiểm cấu trúc DOM) + `page renders SSR description text even when story present`.
- [ ] **Step 2: Chạy đỏ** — `VITEST_MAX_WORKERS=1 pnpm --filter @tubutree/web test product-story-showcase`.
- [ ] **Step 3: Cài**, dùng lại `story-sprite`/`storyView`; không chép logic.
- [ ] **Step 4: Chạy xanh** — `pnpm --filter @tubutree/web test` + `pnpm lint:parity` + `pnpm lint:vars` + `tsc`.
- [ ] **Step 5: Commit** — `feat(story): ProductStoryShowcase web`.

### Task 6: Auto-Asset Pipeline (API trích xuất)

**Files:**
- Create: `apps/api/src/modules/catalog/story-assets.service.ts` + `.spec.ts`, `story-assets.controller.ts` + spec, `story-cutout.ts` + spec
- Modify: `apps/api/src/modules/catalog/catalog.module.ts`, `apps/api/src/common/endpoint-inventory.spec.ts` (nếu bắt buộc đăng ký)

**Interfaces:**
- Consumes: không dùng `buildDefaultStoryConfig` (khác package): API chỉ trả danh sách ảnh và bản tách nền; client sinh gợi ý config.
- Produces: `POST /api/v1/admin/products/:id/story-assets/extract` body `{ pageUrl?: string; imageUrls?: string[] }` → `{ images: { url: string; width: number; height: number }[]; cutouts: { sourceUrl: string; dataUrl: string }[] }`; `cutoutWhite(buf: Buffer): Promise<Buffer>` (PNG alpha, nền sáng→trong suốt, dùng `sharp`); `assertPublicHttpUrl(url: string): Promise<URL>` (từ chối `localhost`, IP riêng/loopback/link-local/metadata, port lạ, redirect >2 hoặc sang IP riêng; kiểm lại sau mỗi redirect).

- [ ] **Step 1: Test hỏng** — `rejects 127.0.0.1, 10.x, 169.254.169.254, [::1], localhost`; `rejects redirect to private ip`; `rejects non-image content-type`; `rejects image over 8MB`; `cutoutWhite makes white border pixels alpha 0 and keeps dark centre`; `pageUrl extraction returns og:image and img src absolute https, max 12`; `requires ADMIN role`.
- [ ] **Step 2: Chạy đỏ** — `pnpm --filter @tubutree/api exec jest story-assets story-cutout`.
- [ ] **Step 3: Cài** (`fetch` với `redirect: 'manual'`, timeout 8s, trần 8MB; tìm ảnh bằng regex `og:image|<img src>`, không thêm thư viện; kết quả cutout trả `dataUrl` WebP, KHÔNG ghi đĩa/DB; admin tự đưa vào `cutoutUrl` qua ảnh đã đăng ký).
- [ ] **Step 4: Chạy xanh** + `tsc` + `endpoint-inventory` spec.
- [ ] **Step 5: Commit** — `feat(story): endpoint trích xuất ảnh và tách nền`.

### Task 7: Admin Story Studio

**Files:**
- Create: `apps/web/src/components/admin/product-story-studio.tsx` + `.spec.tsx`
- Modify: `apps/web/src/components/admin/product-edit-drawer.tsx` (mục "Câu chuyện sản phẩm", `patch.storyConfig` vào `dirty`), `apps/web/src/lib/product-categories.ts` (`extractStoryAssets(id, body)`)

**Interfaces:**
- Consumes: `ProductStoryShowcase` (Task 5, `previewConfig`), `buildDefaultStoryConfig`, `STORY_SPRITES`, `parseStoryConfig`, endpoint Task 6.
- Produces: `ProductStoryStudio(props: { product: ProductDetail; value: ProductStoryConfig | null; onChange: (v: ProductStoryConfig | null) => void; disabled?: boolean })`.

- [ ] **Step 1: Test hỏng** — `generate button fills config from ingredients`; `toggle enabled flips config.enabled`; `clicking cutout image sets xPct,yPct of selected HUD point rounded to integers`; `editing a step title updates value`; `sprite picker adds layer`; `invalid config shows error and keeps Lưu disabled`; `preview toggles 375px / desktop frame`; `extract error shows notice role=alert`.
- [ ] **Step 2: Chạy đỏ** — `VITEST_MAX_WORKERS=1 pnpm --filter @tubutree/web test product-story-studio product-edit-drawer`.
- [ ] **Step 3: Cài** component và nối drawer; Lưu chỉ gửi `storyConfig` khi đổi. Chữ admin viết thẳng tiếng Việt như phần còn lại của drawer.
- [ ] **Step 4: Chạy xanh** + `tsc` + `pnpm lint:vars`.
- [ ] **Step 5: Commit** — `feat(story): Admin Story Studio`.

### Task 8: Tài liệu thiết kế, gallery, parity, e2e, review

**Files:**
- Modify: `docs/design/ds-map.json` (thêm `ProductStoryShowcase` vào `components`, `screens` theo tên route Mini của PDP), `DESIGN.md` (mục Thành phần + nhật ký quyết định), `apps/miniapp/src/pages/ds-gallery.tsx`, `apps/web/src/app/ds-gallery/gallery.tsx`, `packages/app-core/src/commerce/ds-gallery-data.ts`, `scripts/uiux/ds-baseline.json` (chỉ khi ratchet giảm)
- Create: `apps/e2e/tests/product-story.spec.ts` (bước 01..05, modal, reduced motion); thêm ca vào `ds-parity.shop.spec.ts`, `a11y-shop.*.spec.ts`

- [ ] **Step 1: Cập nhật tài liệu + gallery** (ba trạng thái: có cấu hình, chờ, giảm chuyển động).
- [ ] **Step 2: Chạy toàn bộ kiểm của tubu-ui** — `pnpm lint:parity && pnpm lint:vars`; `VITEST_MAX_WORKERS=1` cho `app-core`, `miniapp`, `web` test và `api exec jest` các mục đã đổi; e2e `ds-parity.shop`, `a11y-shop.miniapp`, `a11y-shop.web`, `product-story` → toàn xanh, dán output.
- [ ] **Step 3: Chụp 375px Mini ↔ web** (`VISUAL_DIR`, `visual-pairs.mjs`) cho 10 sản phẩm mẫu, đủ trạng thái chờ/rỗng/lỗi.
- [ ] **Step 4: Review Opus (`reviewer`, một lượt)** cả nhánh, ưu tiên Review Focus; sửa lỗi nó nêu; chạy lại kiểm.
- [ ] **Step 5: Commit** — `docs(story): ds-map, DESIGN, gallery, e2e`. Báo chủ: nhánh sẵn sàng, chưa push.

## Phân công (tối đa 2 subagent sonnet medium cùng lúc)

- Tôi làm Task 1–3 (hợp đồng kiểu, không song song được).
- Sau Task 3: **worker A = Task 4 → Task 5**; **worker B = Task 6** (độc lập, chỉ API).
- Task 7 sau Task 5+6; Task 8 tôi làm, chạy lại lệnh kiểm của mọi báo cáo worker.
