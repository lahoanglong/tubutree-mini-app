# D10-docker-env — Docker và biến môi trường

Nhánh DOCKER + ENV của phiên UAT 2026-10-20. Nền `05e6ae97` (nhánh `uat/2026-10-20`). Không sửa mã ứng dụng, không SSH, không deploy, không đẩy image. Mọi thứ tôi tạo nằm trong `docs/2026-10-20-uat/` (báo cáo này, `tools/d10/`, `logs/d10-*`).

## Tóm tắt

Có 10 phát hiện: 1 P1, 2 P2, 7 P3. Không có P0.

- P1 (D10-01): build Mini App production mà không đặt `VITE_API_BASE_URL` vẫn thành công và nhúng `http://localhost:3001/api` vào bundle. Đã chạy thật. Không có chốt chặn nào. Đây là mục A7-08 của `docs/audit-2026-09/07-tech-analytics.md:440`, chưa được sửa.
- P2 (D10-02): `docs/GO-LIVE-KEYS.md:99` và `docs/ZALOPAY-SETUP.md:47` bảo chủ chạy `docker compose -f docker-compose.prod.yml` (thư mục `~/tubutree`), trong khi VPS thật dùng `docker-compose.vietnix.yml` ở `/opt/tubutree`.
- P2 (D10-03): `.env.production.example:14` gợi ý `openssl rand -base64 24` cho `POSTGRES_PASSWORD`. Khoảng 39,5% chuỗi sinh ra có ký tự `/`, làm `DATABASE_URL` hỏng (Prisma P1013). Đã chạy thật.
- 7 mục P3: lệch compose prod, lệch chữ trong runbook (1.3 và 0.2), danh sách `HEAVY_MIGRATIONS` thiếu, `ops.yml` gin không truyền `COMPOSE_FILE`, API chạy root, và các file mẫu env lệch.

Kiểm bằng máy, đạt:
- `docker compose config -q` cho cả hai file compose: thoát 0 với env giả.
- Build thật `tubu-uat-api:local` (154,01 giây) và `tubu-uat-web:local` (214,29 giây): cả hai thoát 0.
- Dựng cả stack vietnix (postgres, redis, api, web) trong project tạm: cả 4 container healthy. API tự `migrate deploy` 207 migration trong CMD, `/api/health` trả `db:up, redis:up`.
- Dừng êm API: nhận SIGTERM, `exit=0`, `oomkilled=false`, bật lại tới healthy trong khoảng 6 giây.
- Runbook mục 5 bước 4 (`check-env.js`, `go-live:check --phase=pre-deploy`) và mục 3.4 (diễn tập migrate với `POSTGRES_DB=tubutree_drill`) chạy được đúng như văn bản.
- 4 spec `check-env`, `deploy-compose`, `env.validation`, `deploy-scripts`: 74/74 đạt (`logs/d10-jest-config.txt`).

Chưa làm hết: xem mục "Chưa kiểm chứng" ở cuối.

## Bảng phát hiện

| ID | Mức | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D10-01 | P1 | chưa soát | agent sửa ngay (giá trị Cloudinary và OA: chủ tự làm) | uat | `apps/miniapp/src/services/api.ts:6`; `apps/miniapp/vite.config.mts:7-21`; `apps/miniapp/package.json:10`; `DEPLOY_ZALO.md:15-18`; `.gitignore:18`; cũ: A7-08 (`docs/audit-2026-09/07-tech-analytics.md:440`) | Build Mini App không có `VITE_API_BASE_URL` vẫn thoát 0 và nhúng `http://localhost:3001/api`. Kịch bản: chủ làm bước 13 của runbook ("phát hành Zalo Mini App"), build trên máy không có `.env.production` (file này bị `.gitignore:18` chặn nên không có trong repo), rồi `zmp deploy`. Mọi điện thoại gọi `localhost` trong máy mình, không đơn nào lên, phải chờ Zalo duyệt bản sửa. `DEPLOY_ZALO.md:15-18` còn ghi "API base đã trỏ api.tubutree.com (xác nhận trong bundle)" nhưng bundle `apps/miniapp/www` trong cây này (thời điểm sửa 22:02 ngày 2026-10-19, nguồn gốc chưa rõ) giống từng byte bản build không env của tôi và chỉ chứa `localhost`. Runbook không có lệnh build Mini App nào. | Thêm `apps/miniapp/build-env.mts` (hàm thuần `assertMiniappBuildEnv(mode, env)`), gọi trong `vite.config.mts` bằng `loadEnv`: mode `production` mà `VITE_API_BASE_URL` rỗng, không phải `https://` hoặc chứa `localhost` thì throw. Thêm `apps/miniapp/.env.production.example` (chủ copy thành `.env.production`). Thêm vào runbook bước 13 lệnh build và kiểm `grep -c localhost apps/miniapp/www/assets/*.js` phải ra 0. Sửa `DEPLOY_ZALO.md`. Test: vitest cho `assertMiniappBuildEnv` (thiếu, localhost, http, https hợp lệ, mode development bỏ qua). |
| D10-02 | P2 | chưa soát | agent sửa ngay | chung | `docs/GO-LIVE-KEYS.md:99`; `docs/ZALOPAY-SETUP.md:40`, `:47`; `docs/DEPLOY-GCP.md:56-92`; `docker-compose.vietnix.yml:4`, `:20`; `docs/launch/deploy-rollback-runbook.md:21-25` (mục 0.3) | Hai tài liệu mà chủ làm theo (bước E10 của GO-LIVE-KEYS, nhận khoá ZaloPay) ghi lệnh với `docker-compose.prod.yml`. VPS thật dùng `docker-compose.vietnix.yml` ở `/opt/tubutree` (runbook 0.3). Kịch bản: chủ chạy `docker compose -f docker-compose.prod.yml up -d api` trong `/opt/tubutree` sau khi điền khoá ZaloPay. Hai file khác nhau ở api (không có `ports` 127.0.0.1:14001, không có `mem_limit`, `cpus`, `connection_limit`), redis (không có `--maxmemory 150mb`), postgres (không có `mem_limit`) (xem `logs/d10-compose-prod-vs-vietnix.txt`). Suy luận từ cách compose hoạt động, chưa chạy trên VPS: cùng tên project nên compose tạo lại api và các dịch vụ phụ thuộc theo cấu hình mới, mất cổng 14001 mà Apache đang trỏ vào, khách thấy 502 đến khi chạy lại bằng file vietnix. Riêng GO-LIVE-KEYS dùng `cd ~/tubutree` nên có thể dừng ngay ở `cd` (chưa kiểm chứng thư mục này có trên VPS không). | Thay mọi lệnh bằng `cd /opt/tubutree && docker compose -f docker-compose.vietnix.yml ...` (hoặc `$DC` của runbook 0.4), thêm `--no-deps` cho lệnh chỉ khởi động lại một dịch vụ, ghi chú "máy riêng dùng prod.yml". Đánh dấu `DEPLOY-GCP.md` là tài liệu cũ. Test: thêm vào `deploy-compose.spec.ts` kiểm `docs/GO-LIVE-KEYS.md` và `docs/ZALOPAY-SETUP.md` không chứa chuỗi `docker-compose.prod.yml`. |
| D10-03 | P2 | chưa soát | agent sửa ngay | chung | `.env.production.example:14`; `docs/DEPLOY-GCP.md:52`; `docker-compose.vietnix.yml:87`; `docker-compose.prod.yml:66`; `apps/api/src/config/env.validation.ts:12` (`DATABASE_URL: z.string().url()`) | Mẫu bảo sinh mật khẩu Postgres bằng `openssl rand -base64 24`. Compose ghép nguyên văn mật khẩu vào `DATABASE_URL`. Kịch bản: mật khẩu sinh ra có `/` (đo: 39,5% chuỗi base64 24 byte có `/`, 39,8% có `+`). Kết quả đã chạy: `check-env.js` báo `DATABASE_URL: Invalid url`; Prisma báo `P1013: invalid port number in database URL`. Container api vào vòng khởi động lại, web không lên (chờ api healthy). Ký tự `+` chưa kiểm chứng. Giảm nhẹ: không ảnh hưởng PROD hiện có (mật khẩu đã đặt); bước 4 của runbook chạy `check-env.js` trước khi dừng API cũ nên bắt được; nhưng thông báo không nói nguyên nhân là mật khẩu. | Đổi gợi ý thành `openssl rand -hex 24` ở `.env.production.example:14` và `DEPLOY-GCP.md:52`. Thêm ghi chú "không dùng `/`, `@`, `:`, `#`, `?`, `%`". Thêm vào `check-env`/go-live một thông báo riêng khi `DATABASE_URL` không parse được ("mật khẩu có ký tự đặc biệt cần mã hoá %2F"). Test: `check-env.spec.ts` với `postgresql://tubu:ab/cd@postgres:5432/db` phải thoát 1 và chứa chữ "mật khẩu". `deploy-compose.spec.ts`: dòng `POSTGRES_PASSWORD` trong mẫu không được chứa `base64`. |
| D10-04 | P3 | chưa soát | agent sửa ngay | chung | `docker-compose.prod.yml:66`, `:85-95`; `docker-compose.vietnix.yml:108-111`; `apps/web/Dockerfile` (cảnh báo build); cũ: D6-17(1) (`docs/2026-10-18-launch-review/D6-infra-perf.md:69`), `docs/2026-10-review/impl/PC-7.md:260` | Compose prod (dự phòng "khi có máy riêng") còn lệch compose vietnix: `DATABASE_URL` thiếu `connection_limit=20&pool_timeout=30`, redis thiếu `--maxmemory 150mb`, thiếu `NEXT_PUBLIC_SITE_URL` và `NEXT_PUBLIC_TENANT_ROOT_DOMAIN` ở build web. Kịch bản: dựng staging đổi `WEB_DOMAIN` bằng compose prod: canonical, sitemap vẫn trỏ `app.tubutree.com`; gian hàng CTV theo gốc `tubutree.com`; `go-live:check` báo WARN `redis.maxmemory` "không giới hạn" (`apps/api/src/config/go-live/redis-checks.ts:83-84`; suy từ mã, chưa chạy với compose prod). Ngoài ra `NEXT_PUBLIC_APP_URL` truyền ở cả hai compose nhưng không có `ARG` trong Dockerfile và mã web không đọc: build in `[Warning] One or more build-args [NEXT_PUBLIC_APP_URL] were not consumed` (`logs/d10-build-web.log`). | Đồng bộ ba chỗ trên vào compose prod, xoá `NEXT_PUBLIC_APP_URL` ở cả hai file. Test: `deploy-compose.spec.ts` so hai file: mọi biến `NEXT_PUBLIC_*` trong `build.args` phải có `ARG` trong `apps/web/Dockerfile`; `DATABASE_URL` và lệnh redis của hai file phải khớp trừ danh sách khác biệt có chủ ý. |
| D10-05 | P3 | chưa soát | agent sửa ngay | chung | `docs/launch/deploy-rollback-runbook.md:176-181`; `apps/api/src/config/ops-email-config.ts:79-112`; `apps/api/src/config/env.validation.ts:55`, `:163-169` | Mục 1.3 lệch mã. (a) Dòng 181 "đặt đủ cả bảy hoặc để trống cả bảy": mã chỉ bắt buộc `OPS_ALERT_EMAIL_TO` + `SMTP_HOST` + (`SMTP_FROM` hoặc `SMTP_USER` là email), `SMTP_USER` đi cặp `SMTP_PASS`; `SMTP_PORT`, `SMTP_SECURE` tuỳ chọn. Đã thử: TO+HOST+FROM chạy; TO+HOST+USER+PASS chạy; chỉ TO+HOST lỗi `SMTP_FROM` (`logs/d10-env-semantics.txt`). (b) Dòng 180 "bắt đầu bằng https://": mã nhận cả `http://` (thử `http://n8n.local/hook` chạy), thiếu scheme thì lỗi. (c) Dòng 176 "ngoài các khoá Pancake, Gomdon, Zalo đã có" không nhắc `ACCESSTRADE_WEBHOOK_SECRET`, vốn bắt buộc ở production từ commit `f3350401` (mã `env.validation.ts:163-169`, go-live FAIL). Không gây hỏng (văn bản chặt hơn mã), chỉ làm người đọc đặt thừa hoặc quên khoá Accesstrade. | Sửa dòng 181 theo quy tắc thật, dòng 180 ghi "có scheme `https://` (khuyến nghị)", thêm hàng `ACCESSTRADE_WEBHOOK_SECRET` vào bảng 1.3. Test: không cần (tài liệu); có thể mở rộng `deploy-compose.spec.ts` kiểm mọi khoá bắt buộc ở production (xuất từ `env.validation.ts`) có trong `.env.production.example`. |
| D10-06 | P3 | chưa soát | agent sửa ngay | chung | `docs/launch/deploy-rollback-runbook.md:19` (mục 0.2 ràng buộc 5); `apps/api/src/config/go-live/db-checks.ts:25-29` | Mục 0.2 ghi "thêm 22 migration ngoài sáu cái này (mọi `20261018*`, `20261019*` và `20261020000000_waste_exchange`)". Đếm lại: glob cho đúng 22 thư mục, nhưng `20261020000000_waste_exchange` chính là một trong sáu (`IMAGE_COMPATIBLE_MIGRATIONS`, `db-checks.ts:25-29`). Ngoài sáu cái chỉ còn 21 trong glob đó. Số sai lệch 1, không đổi kết luận (quay lại chỉ bằng 7.3). | Sửa thành 21, hoặc viết "22 migration kể cả waste_exchange". Test: không cần. |
| D10-07 | P3 | chưa soát | agent sửa ngay | uat | `apps/api/src/config/go-live/db-checks.ts:34-41`; migration `20261016210000_r11_delivered_effects_marker`, `20261018140000_lr_reports_source_indexes`, `20261018170100_lr_orders_filter_indexes` | `HEAVY_MIGRATIONS` chỉ liệt kê pd3 ×2, p1, p8, p4, r6. Ba migration sau cũng khoá `orders` mà không nằm trong danh sách: r11 (ALTER + `UPDATE "orders"` toàn bảng + index), `lr_reports_source_indexes` (index `orders_userId_createdAt_idx`), `lr_orders_filter_indexes` (4 index không CONCURRENTLY trên `orders`). Kịch bản: PROD có hàng trăm nghìn đơn: `db.orders_lock` và `db.pending_scope` báo cửa sổ khoá ngắn hơn thực tế. Ảnh hưởng thấp hiện nay (chủ xác nhận chưa có dữ liệu khách thật, runbook `:58-60`); runbook 3.4 (diễn tập đo thật) là lưới an toàn. | Thêm ba tên vào `HEAVY_MIGRATIONS` (`ordersLock: true`). Test: `db-checks` spec: với danh sách chờ áp chỉ có `20261018170100_lr_orders_filter_indexes`, `db.pending_scope` phải nhắc tên migration đó. |
| D10-08 | P3 | chưa soát | agent sửa ngay | chung | `.github/workflows/ops.yml:90`, `:185`; `tools/db/create-gin-indexes-concurrently.sh:19`; `tools/db/phase5-indexes-concurrently.sh:20` | Hành động `gin` của `ops.yml` gọi `bash tools/db/create-gin-indexes-concurrently.sh` nhưng `COMPOSE_FILE` ở dòng 90 là biến shell không `export` (workflow không có từ khoá `export` nào), nên script rơi về mặc định `docker-compose.prod.yml` (dòng 19) bất kể `vars.COMPOSE_FILE`. Hành động `backup` (dòng 178) truyền `COMPOSE_FILE="$COMPOSE_FILE"` tường minh nên không bị. Kịch bản: `vars.COMPOSE_FILE` đặt khác prod, chạy `gin`: `docker compose -f docker-compose.prod.yml exec` đọc file không khớp project. Dùng được hay không khi cả hai file cùng tên project: chưa chạy. `ops.yml` đang hỏng vì secret `VM_*` trỏ máy GCP đã đóng (runbook 0.3) nên chưa ảnh hưởng thực tế. | Dòng 185 thành `COMPOSE_FILE="$COMPOSE_FILE" bash tools/db/create-gin-indexes-concurrently.sh`. Đổi mặc định hai script sang `docker-compose.vietnix.yml` như `tools/backup/README.md:5`. Test: `deploy-scripts.spec.ts` kiểm mọi lời gọi `bash tools/...` trong `ops.yml` truyền `COMPOSE_FILE`. |
| D10-09 | P3 | chưa soát | cần chủ quyết | uat | `apps/api/Dockerfile:24-41` (stage `runner` không có `USER`); `apps/web/Dockerfile:73` (`USER node`) | Container API chạy bằng root (`docker exec api id -un` ra `root`, `logs/d10-image-api-checks.txt`), web chạy bằng `node`. Kịch bản: lỗ hổng thực thi mã trong API thì kẻ tấn công có root trong container. Hạn chế thực tế: container không `privileged`, không mount docker.sock (xem `d10-compose-vietnix-config.txt`). Đổi sang `USER node` có thể gây lỗi quyền ghi trong container (chưa thử) nên không tự làm. | Chủ quyết có làm trước mở khách không. Nếu làm: `USER node` ở runner, `chown` thư mục cần ghi, chạy lại bước 4, 7 của runbook (`migrate deploy`, `go-live:check`) trong container để chắc không lỗi quyền. Test: dựng stack như `tools/d10/d10-stack.sh up probe drill`, kỳ vọng health, migrate, go-live chạy được. |
| D10-10 | P3 | chưa soát | cần chủ quyết (mục e), còn lại agent sửa ngay | chung | `apps/api/src/config/env.validation.ts:22`, `:98`; `apps/api/src/config/go-live/env-checks.ts:55-57`, `:302`; `apps/api/.env.example`; `apps/web/.env.example`; `apps/miniapp` (không có file mẫu); cũ: D3-03 (`D3-migration-deploy.md`) | File mẫu và khoá lệch. (a) `apps/api/.env.example` thiếu `ZNS_BASE_URL` (có ở `.env.production.example:93`). (b) `apps/web/.env.example` thiếu `NEXT_PUBLIC_ZALO_APP_ID`: `Dockerfile` web dừng build nếu rỗng (đã thử, bước 25, `logs/d10-web-guard-test.txt`), nhưng build tay `next build` không có gì nhắc. (c) Mini App không có file mẫu cho `VITE_API_BASE_URL`, `VITE_WEB_BASE_URL`, `VITE_ZALO_OA_ID`, `VITE_CLOUDINARY_*` (gắn với D10-01). (d) `.env.production.example` thiếu 4 khoá đã nêu ở D3-03 (không báo lại). (e) `JWT_REFRESH_SECRET` bắt buộc (≥16 ký tự) nhưng mã không dùng, chỉ validate (`env.validation.ts:22`) và go-live kiểm khác `JWT_ACCESS_SECRET`; `ACCESSTRADE_PUBLISHER_ID` chỉ go-live đọc (`env-checks.ts:302`). Người vận hành bị ép đặt khoá vô nghĩa. | (a)-(c): thêm dòng vào ba file mẫu. (e): chủ quyết giữ để dự phòng hay bỏ ràng buộc; nếu bỏ, đổi `.min(16)` thành tuỳ chọn và sửa go-live. Test: `check-env.spec.ts` cho (e); (a)-(c) có thể kiểm bằng spec so mọi khoá schema với file mẫu (như đề xuất ở D3-03). |

## Chi tiết P1

### D10-01 (P1)

Vị trí:
- `apps/miniapp/src/services/api.ts:6`: `const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';`
- `apps/miniapp/vite.config.mts:7-21`: không có kiểm biến, không `loadEnv`.
- `apps/miniapp/package.json:8,10`: `build` = `tsc --noEmit && vite build`, `deploy` = `zmp deploy -M production`, không đặt biến nào.
- `.gitignore:18`: `.env.*` (nên không có `.env.production` trong repo). Cây này không có file `apps/miniapp/.env*`.
- `DEPLOY_ZALO.md:15-18`: nói bundle "trỏ `https://api.tubutree.com/api` (xác nhận trong bundle)".
- Runbook bước 13 (`deploy-rollback-runbook.md:795`) và mục 1.4 (`:196`) nhắc "Mini App đã build sẵn nhưng chưa phát hành" nhưng không có lệnh build nào.

Bằng chứng (đã chạy):
1. `env -u VITE_API_BASE_URL pnpm exec vite build --outDir <scratch> --emptyOutDir` trong `apps/miniapp`: thoát 0, `✓ built in 9.67s`.
2. `grep` bundle ra đúng 1 lần `http://localhost:3001/api`, 0 lần `api.tubutree.com` (`logs/d10-miniapp-build-no-env.txt`).
3. `shasum` bundle build không env trùng từng byte với `apps/miniapp/www/assets/index.ByCae4Gy.module.js` có sẵn trong cây (cùng sha `c265372f...`, file `www` có thời điểm sửa 22:02 ngày 2026-10-19). Vậy bundle trong `www` hiện tại cũng trỏ `localhost`, trái với `DEPLOY_ZALO.md`.
4. Đã xoá thư mục build scratch.

Kịch bản: xem bảng. Tiền đề chưa biết: máy của chủ có `apps/miniapp/.env.production` hay không, và `zmp deploy -M production` có tự build với mode `production` rồi đọc file đó hay không (chưa kiểm chứng, cần `zmp` CLI và phiên đăng nhập, không có trên máy này). Vì không có chốt chặn nào, mức P1 giữ nguyên dù tiền đề chưa rõ. Nếu máy chủ không có file env thì nâng thành P0.

Trạng thái cũ: A7-08 (P1, `docs/audit-2026-09/07-tech-analytics.md:440`) đề xuất đúng chốt này ("`mode==='production'` mà biến thiếu hoặc là localhost thì throw"). Mục này không có trong `docs/2026-10-review/findings-catalog.md` và các tài liệu launch-review, tức chưa được theo dõi hay sửa. Hiện chưa có chốt nào.

## Phần 1. Ma trận biến môi trường

Bảng đầy đủ do `tools/d10/d10-env-matrix.mjs` sinh từ mã (60 khoá trong `env.validation.ts`, 11 khoá đọc ngoài schema, 15 khoá web, 5 khoá Mini App, 11 khoá chỉ có ở compose): `logs/d10-env-matrix-api.md`. Mỗi dòng có cột: mã đọc ở `path:line`, có trong `apps/api/.env.example`, `.env.production.example`, compose prod, compose vietnix, `docs/GO-LIVE-KEYS.md`, runbook 1.3, runbook mục khác, bắt buộc ở production. Dưới đây là phần cần hành động.

### Khoá làm API không khởi động ở production (đã thử bằng `tools/d10/d10-required-probe.cjs`, `logs/d10-required-probe.txt`)

Thiếu từng khoá một trên một cấu hình hợp lệ, ở NODE_ENV production:

| Khoá | Mã bắt | Mẫu prod | GO-LIVE-KEYS | Runbook 1.3 |
|---|---|---|---|---|
| `DATABASE_URL` | `env.validation.ts` (cả dev lẫn prod) | compose ghép từ `POSTGRES_*` | không | không (đúng, compose lo) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `env.validation.ts:22` (≥16 ký tự) | có | không | không |
| `PANCAKE_API_KEY`, `PANCAKE_SHOP_ID` | `env.validation.ts:154-161` | có | có | "đã có" |
| `PANCAKE_WEBHOOK_SECRET` | `env.validation.ts:146-151` | có | có | "đã có" |
| `ACCESSTRADE_WEBHOOK_SECRET` | `env.validation.ts:163-169` | có (để trống) | có | không (D10-05c) |
| `CORS_ORIGINS` | `env.validation.ts:173-183` (`","` cũng lỗi) | có | không | có |
| `GOMDON_WEBHOOK_SECRET` | `env.validation.ts:188-192`, chỉ khi đã đặt cả `GOMDON_PHONE` và `GOMDON_PASSWORD` | có | có | không |

Các khoá khác chỉ lỗi khi đặt sai: `PORT` rỗng, `REDIS_URL` rỗng, `OPS_ALERT_WEBHOOK_URL` thiếu scheme, nhóm email đặt dở, `THROTTLE_BYPASS_TOKEN` ngắn hơn 32 ký tự (31 lỗi, 32 chạy), `AUTH_COOKIE_SAMESITE=None` viết hoa (`logs/d10-env-semantics.txt`).

### Thiếu, thừa, sai tên

- Thiếu trong `apps/api/.env.example`: `ZNS_BASE_URL`. Thừa so với schema: không có.
- Thiếu trong `.env.production.example`, đáng kể: `ZALO_OA_REFRESH_TOKEN`, `ZALO_OA_WEBHOOK_SECRET`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN` (đã nêu ở D3-03). Không đáng kể: `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL` (compose đặt), nhóm AI (`DEEPSEEK_*`, `GEMINI_*`, `ANTIGRAVITY_*`, `AI_ADVISOR_*`; mục 1.7 của runbook nói riêng). Thừa so với schema và hạ tầng: không có.
- Khác giá trị giữa hai file mẫu: `CORS_ORIGINS` (api mẫu có thêm `admin.tubutree.com`), `ZALO_APP_ID` (api mẫu rỗng, prod mẫu `2070857098114207963`), `PANCAKE_WEBHOOK_SECRET` và `ACCESSTRADE_WEBHOOK_SECRET` (api mẫu có giá trị dev). Hợp lý, không báo.
- Sai tên: không có. Mọi khoá ở file mẫu, compose, GO-LIVE-KEYS và runbook 1.3 đều khớp một khoá trong mã.
- Dư (không ai đọc): `NEXT_PUBLIC_APP_URL` (D10-04). `JWT_REFRESH_SECRET` và `ACCESSTRADE_PUBLISHER_ID` chỉ được validate (D10-10e).
- Web, build-arg thiếu ở compose prod: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TENANT_ROOT_DOMAIN` (D10-04).
- Mini App: 5 khoá `VITE_*` đọc ở `apps/miniapp/src/services/api.ts:6`, `utils/web-base-url.ts:7,12`, `services/zmp-bridge.ts:181,184`, `components/image-upload.tsx:6,7`; không file mẫu, không compose, không runbook (D10-01, D10-10c).

## Phần 2. `docker compose config` với env giả

Env giả: `tools/d10/d10-fake.env`. Bằng chứng: `logs/d10-compose-*.txt`.

| Kiểm | Kết quả |
|---|---|
| `config -q` compose prod và vietnix | thoát 0 cả hai |
| Dịch vụ | prod: postgres, redis, api, web, caddy. vietnix: postgres, redis, api, web (không Caddy) |
| Image | postgres:16-alpine, redis:7-alpine, api và web build từ `apps/*/Dockerfile` |
| Volume | prod: `caddy_data`, `caddy_config`, `pg_data`, `redis_data`. vietnix: `pg_data`, `redis_data`. Tên volume theo tên project (thư mục) |
| Healthcheck vietnix | api và web: interval 15s, timeout 5s, retries 5, start_period 30s. postgres và redis: interval 10s, timeout 5s, retries 5. `depends_on` dùng `service_healthy` |
| `API_CPUS=2 WEB_CPUS=0.5` | `cpus: 2` và `cpus: 0.5` đúng |
| `API_CPUS=abc` | lỗi rõ: `failed to cast to expected type: strconv.ParseFloat: parsing "abc"` |
| `API_CPUS=` (rỗng) | về mặc định `cpus: 1` |
| `API_CPUS=2` trên compose prod | không có `cpus` (compose prod bỏ qua biến) |
| `docker run --cpus` lớn hơn số CPU của máy ảo | Docker từ chối: `range of CPUs is from 0.01 to 6.00`. Khớp ghi chú ở `docker-compose.vietnix.yml:14` và `.env.production.example:19`: đặt `API_CPUS` theo `nproc` |
| `WEB_DOMAIN` không đặt | vietnix: vẫn dựng, ra `https://api./api` (không chặn). prod: dừng với "đặt WEB_DOMAIN trong .env" (chỉ ở dịch vụ caddy). Vietnix không có chốt này |
| `POSTGRES_PASSWORD` không đặt | cả hai: dừng với "đặt POSTGRES_PASSWORD trong .env" |
| Chú thích cuối dòng trong `.env` theo kiểu `.env.production.example` (`KEY=value   # ghi chú`) | compose bỏ phần chú thích, giá trị đúng |
| Mật khẩu có `/` và `+` | `DATABASE_URL` ghép nguyên văn, không mã hoá (D10-03) |
| Mục 3.4: `POSTGRES_DB=tubutree_drill` đứng trước lệnh | `DATABASE_URL` của api trỏ `tubutree_drill`; postgres không bị tạo lại khi dùng `run --no-deps` |
| Khác biệt prod và vietnix | `logs/d10-compose-prod-vs-vietnix.txt`: prod không có `ports`, `mem_limit`, `cpus`, `connection_limit`, `--maxmemory 150mb`, `KEEP_ALIVE_TIMEOUT` (D10-04) |

Ghi chú nhỏ: `WEB_DOMAIN` không đặt trên vietnix dựng được `NEXT_PUBLIC_API_BASE_URL=https://api./api` rồi mới hỏng lúc chạy. Mức P3, không lập mục riêng vì `.env.production.example` có sẵn dòng `WEB_DOMAIN`.

## Phần 3. Build, chạy thử, dọn

Điều kiện: Colima 6 CPU, không có buildx nên dùng `DOCKER_BUILDKIT=0` (bộ dựng cũ). Tải máy trước khi build: 18,91 (build api, 22:09) và 22,39 (build web, 22:11), dưới ngưỡng 30 của brief.

| Image | Thời gian (real) | Kết quả | Ghi chú |
|---|---|---|---|
| `tubu-uat-api:local` | 154,01 giây | thoát 0 | build context 64,14MB. 207 migration trong image. Trong image: `node_modules` 463,4MB, `dist` 10,0MB, `src` 11,1MB, `test` 3,8MB. Không có `.env*` trong `/app` (`logs/d10-image-secrets.txt`). Chạy bằng root (D10-09) |
| `tubu-uat-web:local` | 214,29 giây | thoát 0 | build context 96,78MB. Cảnh báo `NEXT_PUBLIC_APP_URL were not consumed` (D10-04). Runtime `/app` 42,6MB, user `node`, `.next/cache` ghi được. Giá trị `NEXT_PUBLIC_API_BASE_URL` giả có trong bundle client (đã kiểm). Không có `.env*` |
| Thử chốt ZALO_APP_ID rỗng | 29,90 giây, dừng ở bước 25/37 | đúng thiết kế | thông báo "LOI: NEXT_PUBLIC_ZALO_APP_ID rong...", container tạm đã xoá |

Kích thước tổng của image: chưa ghi lại (tôi xoá image trước khi chạy `docker images`). Chưa kiểm chứng.

Chạy thử stack vietnix trong project `tubu-d10`, cổng 3297 (api) và 3298 (web) trên 127.0.0.1, volume tmpfs, env giả, không đụng `tubu_pg`, `tubu_redis`, `tubu-uat-redis`, cổng 14000/14001:
- 4 container healthy. Lệnh `up` xong sau 17 giây (22:16:22 đến 22:16:39), gồm chờ postgres, redis, api healthy. `migrate deploy` trong CMD áp 207 migration, bảng `_prisma_migrations` có 207 dòng, mới nhất `20261020000000_waste_exchange`.
- `/api/health`: `{"status":"ok","db":"up","redis":"up",...}` HTTP 200. Web `/`: HTTP 200 trong 0,015 giây.
- Giới hạn: `mem_limit` 536870912 (postgres), 201326592 (redis), 805306368 (api), 536870912 (web). `cpus` 1,0 cho api và web. `restart: unless-stopped` cả bốn.
- Redis: `maxmemory-policy noeviction`, `maxmemory 157286400` (150MB), `appendonly yes`.
- Api: PID 1 là `node dist/main.js` (ash `exec` node, nên SIGTERM tới đúng tiến trình), `TZ=Asia/Ho_Chi_Minh`.
- Dừng êm api: `exit=0`, `oomkilled=false`. Bật lại tới healthy trong khoảng 6 giây.
- Web khi api dừng: `/`, `/san-pham`, `/dang-nhap` vẫn HTTP 200; healthcheck của web vẫn đạt.
- Log api có một dòng ERROR `PancakeSyncService ... connect ECONNREFUSED 127.0.0.1:9`: do env giả trỏ Pancake vào cổng 9, đúng kỳ vọng, không phải lỗi.
- Từ container, `host.docker.internal` (192.168.5.2) tới được Postgres UAT 25432, Redis UAT 26379, API UAT 3221 (`logs/d10-host-reach.txt`). Tôi không ghi gì vào các cổng đó.

Dọn: `docker compose -p tubu-d10 down -v`, `docker rm -f -v` container lỗi từ lần thử chốt, `docker rmi -f tubu-uat-api:local tubu-uat-web:local`, xoá layer treo, xoá thư mục tạm. Kiểm lại lúc kết thúc: `docker ps -a` chỉ còn `tubu-uat-redis`, `tubu_pg`, `tubu_redis`; không còn image `tubu*`, network hay volume `d10`; không tiến trình nghe cổng 3297, 3298. API 3221 không bị dừng. Tôi không bật trình duyệt hay máy chủ dev nào.

## Phần 4. Runbook đối chiếu mã

Runbook: `docs/launch/deploy-rollback-runbook.md` (983 dòng). Mọi đường dẫn tệp mà các mục dưới đây nhắc đều tồn tại.

| Mục | Khẳng định | Kiểm | Kết quả |
|---|---|---|---|
| 0.1 | `deploy.sh` tự dừng mã 2 khi migration `20261015150000` còn chờ và API cũ còn chạy | đọc `tools/deploy/deploy.sh:91`, `:135-137` + `deploy-scripts.spec.ts` đạt | Đúng. Script còn một chốt thứ hai cho `points_1d` (`:94`, `:143-173`, cũng thoát mã 2) mà văn bản 0.1 không nhắc; chặt hơn runbook, không gây hại |
| 0.2 (5) | 22 migration ngoài sáu cái | đếm thư mục | Lệch 1 (D10-06) |
| 0.3 | VPS `/opt/tubutree`, file `docker-compose.vietnix.yml`, `VM_*` trỏ máy GCP đóng | `.github/workflows/ops.yml:89-90`, `deploy.yml:55` mặc định `vars.DEPLOY_DIR || '/opt/tubutree'` và `docker-compose.vietnix.yml` | Khớp mã. Các tài liệu khác chưa khớp (D10-02) |
| 1.0 A | `ls prisma/migrations \| grep -c "^[0-9]"` trong image | chạy trong image mới | ra 207 |
| 1.0 A | SQL `SELECT count(*), max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL` | chạy trên DB sau khi api tự migrate | ra `207\|20261020000000_waste_exchange` |
| 1.3 | Khoá SMTP, webhook, label, CORS, cookie, throttle | `env.validation.ts`, `ops-email-config.ts`, thử từng trường hợp | Lệch chữ (D10-05). `THROTTLE_BYPASS_TOKEN`: WARN khi trống, FAIL khi <32 (`env-checks.ts:157-170`), API không khởi động khi <32: đúng |
| 1.3 | `ops.yml set-env` không ghi `THROTTLE_BYPASS_TOKEN`, `AUTH_COOKIE_*`; ghi đè `DEEPSEEK_*`, `GEMINI_*` | đọc nhánh `set-env` của `ops.yml` | Đúng |
| 3.4 | `POSTGRES_DB=tubutree_drill $DC run --rm --no-deps api pnpm exec prisma migrate deploy` | chạy qua compose với image mới trên DB trống | `All migrations have been successfully applied.` 207 migration, 2,19 giây. `migrate status`: "Database schema is up to date!". `DROP DATABASE` sau đó chạy |
| 3.4 | Phần khôi phục từ file `.sql.gz` thật | không có backup trong sandbox | Chưa kiểm chứng ở nhánh này (nhánh D3 đã diễn tập `pg_dump` rồi `psql` với DB khác) |
| 5 bước 4 | `check-env.js` bằng image mới | chạy qua `$DC run --rm --no-deps` | Đạt với env hợp lệ ("Cấu hình môi trường hợp lệ", thoát 0); thiếu `PANCAKE_API_KEY` và `CORS_ORIGINS` thì thoát 1 và nêu đúng hai khoá |
| 5 bước 4 | `go-live:check --phase=pre-deploy` trong image (có mount `:ro`) | chạy | Chạy được. 35 PASS, 19 WARN, 3 FAIL; 3 FAIL đều do sandbox (Pancake URL giả, chưa có ADMIN, chưa có backup). `db.migrations_pending` đạt 207/207, `redis.*` đạt |
| 5 bước 5 đến 9 | `stop_grace_period 30s`, dừng và bật lại api, web khi api dừng | chạy | Đạt (Phần 3) |

## Đã kiểm, không lỗi

- Hai file compose qua `config -q`; chốt `${POSTGRES_PASSWORD:?}` hoạt động ở cả hai.
- Dockerfile api và web build sạch; bí mật (`apps/api/.env` 3.961 byte có trên đĩa) không lọt vào image api hoặc web.
- Healthcheck của cả 4 dịch vụ chạy thật; `depends_on: service_healthy` đúng thứ tự.
- Redis `noeviction` và trần 150MB áp thật trong container.
- API là PID 1 và nhận SIGTERM; không bị OOM kill.
- Chốt `NEXT_PUBLIC_ZALO_APP_ID` rỗng trong Dockerfile web dừng build đúng như `docs/GO-LIVE-KEYS.md` bước E10 mô tả.
- Mọi khoá trong ví dụ và compose khớp tên với mã; không khoá sai tên.

## Chưa kiểm chứng

- Build bằng BuildKit/buildx (máy không có buildx; chỉ chạy bộ dựng cũ `DOCKER_BUILDKIT=0`). CI dùng `docker/build-push-action` có thể cho kết quả khác về cache và về cảnh báo.
- `docker compose build` (build qua compose); tôi build bằng `docker build` rồi gắn thẻ ảnh cho override.
- Phiên bản `docker compose` trên VPS Vietnix (tôi dùng bản trên máy Colima; cú pháp `!override` chỉ dùng trong file override của tôi, không trong file của repo).
- `docker compose up` với `docker-compose.prod.yml` (có Caddy, cổng 80/443); chỉ kiểm bằng `config`.
- Bộ nhớ và OOM dưới tải thật với `mem_limit` (api 768MB, web 512MB, postgres 512MB, redis 192MB); stack thử chạy không tải.
- Hậu quả cụ thể của việc chạy compose prod trên VPS (D10-02) và của `COMPOSE_FILE` không export trong `ops.yml` gin (D10-08): suy luận, chưa chạy (không SSH).
- Ký tự `+` và `=` trong mật khẩu Postgres đi qua Prisma (D10-03); chỉ chứng minh được `/`.
- `zmp deploy -M production` có tự build với mode production và đọc `.env.production` hay không (D10-01); máy này không có `zmp` CLI.
- Có hay không `ACCESSTRADE_WEBHOOK_SECRET`, `CORS_ORIGINS`, `THROTTLE_BYPASS_TOKEN` trong `.env` thật trên VPS (không SSH).
- Kích thước tổng hai image (chưa ghi lại trước khi xoá).
- Lệnh gọi bên thứ ba thật (Pancake, Zalo, ZaloPay, SMTP, Cloudinary): không gọi.
- Mức dùng RAM và CPU thực của image khi chạy `go-live:check` nặng (chỉ chạy một lần với DB trống).

## File công cụ và bằng chứng

Công cụ (đều chạy lại được, ghi chú đầu file nói cách dùng):
- `docs/2026-10-20-uat/tools/d10/d10-env-matrix.mjs`: sinh ma trận biến từ mã (`node d10-env-matrix.mjs <thư mục gốc repo>`).
- `docs/2026-10-20-uat/tools/d10/d10-required-probe.cjs`: thiếu từng khoá bắt buộc, báo khoá nào làm API không khởi động.
- `docs/2026-10-20-uat/tools/d10/d10-stack.sh` (`prep|up|probe|drill|down`), `d10-override.yml`, `d10-fake.env`: dựng và dọn stack vietnix tạm.

Bằng chứng: `docs/2026-10-20-uat/logs/d10-*`:
- Ma trận: `d10-env-matrix-api.md`, `d10-env-set-diff.txt`, `d10-required-probe.txt`, `d10-env-semantics.txt`.
- Compose: `d10-compose-config-q.txt`, `d10-compose-vietnix-config.txt`, `d10-compose-variants.txt`, `d10-compose-summary.txt`, `d10-compose-prod-vs-vietnix.txt`.
- Build và image: `d10-build-api.log`, `d10-build-web.log`, `d10-web-guard-test.txt`, `d10-image-api-checks.txt`, `d10-image-web-checks.txt`, `d10-image-secrets.txt`, `d10-golive-in-image.txt`.
- Chạy thử: `d10-stack-up.txt`, `d10-stack-probe.txt`, `d10-stack-drill.txt`, `d10-stack-step4.txt`, `d10-stack-logs.txt`, `d10-stack-stop.txt`, `d10-stack-web-api-down.txt`, `d10-stack-down.txt`, `d10-host-reach.txt`.
- Mini App: `d10-miniapp-build-no-env.txt`.
- Spec: `d10-jest-config.txt`.
