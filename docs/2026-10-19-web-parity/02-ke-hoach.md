# 02 — Kế hoạch lane

Mỗi lane: worktree `.claude/worktrees/web-<lane>`, nhánh `web/<lane>` từ tip `web/integration` mới nhất. Implement bằng Sonnet 5.5 (`core` effort high, còn lại medium), review bằng Opus 5.5 effort high. Số dòng ma trận theo `00-ma-tran.md`.

## Đợt 0 — `core` (chạy một mình)

Làm toàn bộ mục 1–5 của `01-thiet-ke.md`:
1. `packages/app-core`: `http.ts`, `bridge.ts`, `features.ts`, `route-map.json` (đủ 51 dòng, `pending` cho route web chưa có), spec cấm import.
2. Adapter `core-http.ts` cho web và Mini App; `platform-bridge.ts` cho web và Mini App; `MiniAppOnlyNotice`.
3. Module mẫu: wishlist (`GET /me/wishlist`, `GET /me/wishlist/ids`, `POST /me/wishlist`, `DELETE /me/wishlist/:productId`) vào `app-core/src/api/wishlist.ts` + `queries/wishlist.ts`; Mini App `wishlist-api.ts` gọi qua adapter, test Mini App không sửa.
4. `scripts/check-platform-parity.mjs` + test, `lint:parity`, bước CI.
5. `next.config.mjs` `redirects()` từ route map. `PRIVATE_PATHS` sinh từ route map. `sitemap.ts` thêm route tĩnh công khai từ route map (dòng có `"public": true`, không tham số, không `pending`).
6. Vỏ web: thanh đáy điện thoại, điều hướng header máy tính.
7. Primitive: `Sheet`, `SegmentedTabs`, `PageHeader`, `ErrorState`, `Skeleton`, `Badge`, `ProgressBar`, `QuantitySelector`, `QrCode`, `Field` (dùng lại cái đã có).
8. `ds-v2-guest.spec.ts`: thêm sẵn glob cho thư mục mới của mọi lane (`app/san-pham/page.tsx`, `app/mua-chung/**`, `app/cau-chuyen/**`, `app/gioi-thieu/**`, `app/kho-qua/**`, `app/doi-vo/**`, `app/hoan-tien/**`, `app/vuon-xanh/**`, `app/cong-dong/**`, `app/hoc-vien/**`, `app/tu-van/**`, `app/ctv/**`, `app/dai-ly/**`, `app/nhan-vien/**`, `app/chu-thuong-hieu/**`, `app/doi-rac/**`, `app/tai-khoan/{yeu-thich,ho-so,cai-dat,thong-bao,don-hang}/**`, `app/thanh-toan/chuyen-khoan/**`, `components/ui/**`), chấp nhận glob chưa có file. Mục đích: lane khác không phải sửa danh sách.
9. `AGENTS.md`, `CLAUDE.md`.

Review: 1 lượt Opus (đụng `client-api.ts` thì xem kỹ phần token và header).

## Đợt 1 — 4 lane song song

| Lane | Dòng | File chính (không lane nào khác sửa) | Review |
|---|---|---|---|
| `shop` | 1, 2, 3, 10, 11, 12, 13 | `app/page.tsx` + `components/home/**`, `app/san-pham/page.tsx`, `app/san-pham/[slug]/**`, `app/tai-khoan/yeu-thich/**`, `app/mua-chung/**`, `app/brand/[slug]/**`, `app/cau-chuyen/**`, `components/catalog/**`, `app-core/src/{api,queries}/{catalog,group-buy,brand}.ts` | 1 lượt |
| `order` | 4, 5, 6, 7, 8, 9 | `app/gio-hang/**`, `app/thanh-toan/**`, `app/tai-khoan/don-hang/**`, `app/tai-khoan/dia-chi/**`, `components/checkout/**`, `components/orders/**`, `app-core/src/{api,queries}/{cart,orders,subscriptions,addresses}.ts` | **2 lượt** (thanh toán, hoàn tiền) |
| `account` | 15, 17, 18, 19, 20 | `app/tai-khoan/page.tsx` + các file hub, `app/tai-khoan/{ho-so,cai-dat,thong-bao}/**`, `app/gioi-thieu/**`, `components/account/**`, `app-core/src/{api,queries}/{account,notifications,support}.ts` | 1 lượt; 2 lượt nếu sửa `auth-context.tsx` |
| `loyalty` | 21, 22, 23, 24, 25, 26 | `app/tai-khoan/{diem-xanh,vi-tubu}/**`, `app/kho-qua/**`, `app/doi-vo/**`, `app/hoan-tien/**`, `components/loyalty/**`, `app-core/src/{api,queries}/{loyalty,wallet,rewards,refill,cashback}.ts` | **2 lượt** (điểm, rút tiền) |

Ranh giới: `order` không sửa `app/tai-khoan/page.tsx` (hub thuộc `account`); `account` thay `OrdersSection` trong hub bằng lối sang `/tai-khoan/don-hang`. Thanh đáy, header, primitive thuộc `core`: lane cần sửa thì ghi vào `impl/<lane>.md`, không tự sửa.

## Đợt 2 — 4 lane song song

| Lane | Dòng | File chính | Review |
|---|---|---|---|
| `community` | 29–33 | `app/cong-dong/**`, `app/hoc-vien/**`, `components/community/**`, `app-core/src/{api,queries}/{feed,academy}.ts` | 1 lượt |
| `affiliate` | 14, 35, 36 | `app/ctv/**`, `app/s/[slug]/**`, `components/affiliate/**`, `app-core/src/{api,queries}/{affiliate,storefront}.ts` | **2 lượt** (hoa hồng, thuế, rút) |
| `game` | 28, 34 | `app/vuon-xanh/**`, `app/tu-van/**`, `components/game/**`, `app-core/src/{api,queries}/{game,ai}.ts` | **2 lượt** (vòng quay, phần thưởng) |
| `pro` | 37–41 | `app/dai-ly/**`, `app/nhan-vien/**`, `app/chu-thuong-hieu/**`, tab mới trong `app/admin/page.tsx` + `components/admin/{staff,shift,payroll}-*`, `app-core/src/{api,queries}/{dealer,staff,payroll,brand-owner}.ts` | **2 lượt** (công nợ, lương) |

## Đợt 3

| Lane | Dòng | File chính | Review |
|---|---|---|---|
| `recycle` | 43–51 | `app/doi-rac/**`, `components/recycle/**`, `app-core/src/{api,queries}/waste.ts`; tuỳ chọn endpoint "điểm gần" nhận toạ độ trình duyệt trong `apps/api/src/modules/waste-exchange/customer/` | **2 lượt** (điểm) |

## Gate của lane

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
pnpm --filter @tubutree/shared-types build
pnpm --filter @tubutree/app-core typecheck && pnpm --filter @tubutree/app-core test
pnpm --filter @tubutree/web typecheck && pnpm --filter @tubutree/web lint && pnpm --filter @tubutree/web test
(cd apps/web && TZ=UTC npx vitest run)
pnpm --filter @tubutree/miniapp typecheck && pnpm --filter @tubutree/miniapp test     # số test không giảm so với mốc
pnpm lint:vars && pnpm lint:parity
pnpm --filter @tubutree/web build && pnpm --filter @tubutree/miniapp build
```

Lane đụng `apps/api`: thêm `npx prisma generate` và `npx tsc --noEmit` trong `apps/api`, jest các module liên quan.

Playwright web **không chạy trong lane** vì `global-setup` ghi DB theo `apps/api/.env` và chiếm cổng 3112. Lane chỉ viết spec (mock API trong spec). Gate cuối chạy toàn bộ spec web một lần với Postgres tạm (`docker run --rm --tmpfs`), `DATABASE_URL` riêng, `E2E_API_PORT` riêng, `CI=1`.

## Gộp

Phiên chính tự chạy lại gate trên nhánh lane, rồi gộp `--no-ff` vào `web/integration` trên một worktree rảnh. Xung đột hay gặp: `route-map.json` (cờ `pending`), `pnpm-lock.yaml` (chạy lại `pnpm install`). Sau mỗi đợt: gate đầy đủ trên `web/integration`, cập nhật `00-ma-tran.md` và `PROGRESS.md`.
