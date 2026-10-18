# 02 — Kế hoạch lane

Mỗi lane: worktree `.claude/worktrees/web-<lane>`, nhánh `web/<lane>` từ tip `web/integration` mới nhất. Implement bằng Sonnet 5.5 (effort medium; `core` effort high), review bằng Opus 5.5 effort high. Số dòng ma trận theo `00-ma-tran.md`.

**Thứ tự và Q7.** Q7 xếp `core → shop → account → loyalty → community → affiliate → game/ai → pro → recycle`. Kế hoạch giữ thứ tự đó, có hai chỗ điều chỉnh:
1. "account" của Q7 tách thành `order` (giỏ, thanh toán, đơn) và `account` (hub, hồ sơ, cài đặt, thông báo, giới thiệu). Một lane gộp cả hai quá lớn cho một vòng review.
2. Q8 cho 4 lane mỗi đợt, nên đợt 1 chạy `shop`, `order`, `account`, `loyalty` cùng lúc.

## Đợt 0a — `core` (một mình, gộp xong mới sang 0b)

1. `packages/app-core`: `package.json`, `tsconfig`, vitest, `http.ts`, `features.ts` (chuyển từ `apps/miniapp/src/utils/features.ts`, Mini App re-export), spec cấm import.
2. Gắn vào hai app: dependency, `transpilePackages`, chứng minh `next build`, `vite build`, vitest hai app nạp được.
3. Adapter: `apps/web/src/lib/core-http.ts` (client, bọc `apiFetch`, dựng query bỏ `null`/`undefined`), `apps/web/src/lib/core-http-server.ts` (server, bọc fetch ISR của `lib/api.ts`), `apps/miniapp/src/services/core-http.ts` (chỉ chuyển tham số được truyền). Mỗi adapter có spec.

Review: **2 lượt** (bọc `apiFetch`, phần token).

## Đợt 0b — 3 lane song song

| Lane | Việc | File chính | Review |
|---|---|---|---|
| `core-api` | Chép **mọi** hàm service Mini App (`apps/miniapp/src/services/*-api.ts`, `shop-api.ts`, `account-api.ts`, …) vào `app-core/src/api/<miền>.ts` + `queries/<miền>.ts`, kèm contract spec chép bảng kỳ vọng từ spec service Mini App. **Không sửa Mini App**, trừ module mẫu wishlist: `wishlist-api.ts` của Mini App gọi app-core qua adapter, test không sửa | `packages/app-core/src/{api,queries}/**`, `apps/miniapp/src/services/wishlist-api.ts` | 1 lượt |
| `core-shell` | `route-map.json` (53 route + 3 feature); `scripts/check-platform-parity.mjs` + test + `lint:parity` + bước CI; `redirects()`; `PRIVATE_PATHS` dạng tiền tố + `allow` trong `robots.ts`; `sitemap.ts`; thanh đáy + điều hướng header (ẩn link `pending`); `components/app-gates.tsx` rỗng gắn vào `app/layout.tsx`; ghi nguồn `?s=` trong `storefront-tracker.tsx` (dòng 54); `MiniAppOnlyNotice` + deep link theo route map (`lib/zalo-mini-app.ts`); biến build mới vào Dockerfile/compose/`.env*.example`, CSP `connect-src` Cloudinary; tách các spec danh sách thành khối theo lane; `AGENTS.md`, `CLAUDE.md` | `packages/app-core/src/route-map.json`, `scripts/**`, `package.json` (root), `.github/workflows/ci.yml`, `apps/web/next.config.mjs`, `lib/site.ts`, `app/robots.ts`, `app/sitemap.ts`, `app/layout.tsx`, `components/site-header.tsx`, `components/bottom-nav.tsx`, `components/app-gates.tsx`, `components/storefront-tracker.tsx`, `lib/zalo-mini-app.ts`, `apps/web/Dockerfile`, `docker-compose.*.yml`, spec danh sách (`ds-v2-guest`, `ds-palette-pc11`, `page-titles`, `session-unavailable`, `guest-auth-gate`) | **2 lượt** (hoa hồng `?s=`, SEO, robots) |
| `core-ui` | `bridge.ts` + `platform-bridge.ts` cho web và Mini App; primitive `Sheet`, `SegmentedTabs`, `PageHeader`, `ErrorState`, `Skeleton`, `Badge`, `ProgressBar`, `QuantitySelector`, `QrCode` (thêm `qrcode`), `Field`; hạ tầng e2e: `E2E_SCOPE=web` (bỏ server Mini App), cổng web/miniapp/API cấu hình qua biến môi trường, project Playwright "Web Customer Mobile" (thiết bị di động), script `apps/e2e/scripts/web-gate.sh` dựng Postgres + Redis tạm (`docker run --rm --tmpfs`), `prisma migrate deploy` + seed vào DB tạm, xuất `DATABASE_URL`/`REDIS_URL`/`JWT_*`, `CI=1`, dọn `docker rm -f -v` | `packages/app-core/src/bridge.ts`, `apps/web/src/lib/platform-bridge.ts`, `apps/miniapp/src/services/platform-bridge.ts`, `apps/web/src/components/ui/**`, `apps/web/package.json`, `apps/e2e/**` | 1 lượt |

## Đợt 1 — 4 lane song song

| Lane | Dòng | File chính | Review |
|---|---|---|---|
| `shop` | 1, 2, 3, 10, 11, 12, 13 | `app/page.tsx` + `components/home/**`, `app/san-pham/page.tsx`, `app/san-pham/[slug]/**`, `components/site-search.tsx`, `lib/home-seo.ts`, khối chuyển hướng `/?q|category|brand` → `/san-pham` trong `next.config.mjs`, `app/tai-khoan/yeu-thich/**`, `app/mua-chung/**`, `app/brand/[slug]/**`, `app/cau-chuyen/**`, `components/catalog/**` | **2 lượt** (mã giảm giá trang sản phẩm, mua chung, đặt định kỳ) |
| `order` | 4–9 | `app/gio-hang/**`, `app/thanh-toan/**`, `app/tai-khoan/don-hang/**`, `app/tai-khoan/orders-section.tsx` + `orders-list.spec.tsx`, `app/tai-khoan/dia-chi/**`, `components/checkout/**`, `components/orders/**` | **2 lượt** (thanh toán, hoàn tiền) |
| `account` | 15, 17–20, 52, 53 | `app/tai-khoan/page.tsx`, `profile-section.tsx`, `app/tai-khoan/{ho-so,cai-dat,thong-bao}/**`, `app/gioi-thieu/**`, `components/account/**`, `components/app-gates.tsx` | **2 lượt** (nhận mã giảm giá, xoá tài khoản) |
| `loyalty` | 21–26 | `app/tai-khoan/{diem-xanh,vi-tubu}/**`, `app/tai-khoan/ledger-shell.tsx` + `ledger-pages.spec.tsx`, `app/kho-qua/**`, `app/hoan-tien/**`, `components/loyalty/**` | **2 lượt** (điểm, rút tiền) |

Ranh giới đợt 1:
- `account` **không gỡ** `OrdersSection` khỏi hub (spec `app/guest-pages.a11y.spec.tsx:265,283` kiểm link đơn ở hub); chỉ thêm menu như Mini App. `order` dùng lại `OrdersSection` cho `/tai-khoan/don-hang`.
- Hàm app-core đã có từ `core-api`. Lane thiếu hàm thì thêm vào file miền tương ứng kèm contract spec, ghi vào `impl/<lane>.md`.
- File của core (`site-header`, `bottom-nav`, `layout.tsx`, `lib/site.ts`, `robots.ts`, `sitemap.ts`, primitive): lane không sửa; cần đổi thì ghi vào `impl/<lane>.md`.
- `route-map.json` và các spec danh sách: lane chỉ sửa khối của mình.
- Test mới viết vào file spec mới; không sửa spec dùng chung ngoài khối lane.

## Đợt 2 — 4 lane song song

| Lane | Dòng | File chính | Review |
|---|---|---|---|
| `community` | 29–33 | `app/cong-dong/**`, `app/hoc-vien/**`, `components/community/**` | 1 lượt |
| `affiliate` | 14, 35, 36 | `app/ctv/**`, `app/s/[slug]/**`, `components/affiliate/**` | **2 lượt** (hoa hồng, thuế, rút) |
| `game` | 28, 34 | `app/vuon-xanh/**`, `app/tu-van/**`, `components/game/**` | **2 lượt** (vòng quay, phần thưởng) |
| `pro` | 37–41 | `app/dai-ly/**`, `app/nhan-vien/**`, `app/chu-thuong-hieu/**`, tab mới trong `app/admin/page.tsx` + `components/admin/{staff,shift,payroll}-*` | **2 lượt** (công nợ, lương) |

## Đợt 3

| Lane | Dòng | File chính | Review |
|---|---|---|---|
| `recycle` | 43–51 | `app/doi-rac/**`, `components/recycle/**` | **2 lượt** (điểm) |

## Gate của lane

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
pnpm install --frozen-lockfile --prefer-offline    # nếu lane đổi package.json thì bỏ --frozen-lockfile
pnpm --filter @tubutree/shared-types build
pnpm --filter @tubutree/app-core typecheck && pnpm --filter @tubutree/app-core test
pnpm --filter @tubutree/web typecheck && pnpm --filter @tubutree/web lint && pnpm --filter @tubutree/web test
(cd apps/web && TZ=UTC npx vitest run)
pnpm --filter @tubutree/miniapp typecheck && pnpm --filter @tubutree/miniapp test   # Tests >= 4243
pnpm lint:vars && pnpm lint:parity
pnpm --filter @tubutree/web build && pnpm --filter @tubutree/miniapp build
```

Lane đụng `apps/api`: thêm `npx prisma generate` và `npx tsc --noEmit` trong `apps/api`, jest các module liên quan.

Playwright **không chạy trong lane** (`global-setup` ghi DB theo `apps/api/.env`, API nối BullMQ vào Redis dùng chung, cổng 3112/3113 cố định). Lane chỉ viết spec. Gate cuối chạy `apps/e2e/scripts/web-gate.sh` (do `core-ui` viết) một lần. Trang công khai server component gọi API thật, nên spec của chúng cần DB tạm có seed.

## Gộp

Phiên chính tự chạy lại gate trên nhánh lane, rồi gộp `--no-ff` vào `web/integration` trên một worktree rảnh. Xung đột hay gặp: `route-map.json`, spec danh sách (khối lane), `pnpm-lock.yaml` (chạy lại `pnpm install`). Sau mỗi đợt: gate đầy đủ trên `web/integration`, cập nhật `00-ma-tran.md` và `PROGRESS.md`. Trước mỗi đợt: gộp commit mới của `review/2026-10-18-launch` và `feat/recycle-rewards` (mục 0 của PROMPT).
