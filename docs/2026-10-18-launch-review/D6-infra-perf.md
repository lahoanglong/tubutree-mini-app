# D6 — Hạ tầng, performance, sẵn sàng ra mắt

- **Ngày:** 2026-10-18 · **Mã đọc:** `main` 0cc2fe62 (worktree `launch-review`) · **Vai:** SRE/performance, chỉ đọc.
- **Đã làm:** đọc `03-perf.md`, `99-release-readiness.md`, `GO-LIVE-KEYS.md`, hai file compose, `Caddyfile`, `ops/`, `tools/{deploy,backup,db}`, `docs/launch/deploy-rollback-runbook.md`, Dockerfile api/web, 7 workflow, và mã API/web/miniapp liên quan (bootstrap, throttle, cache, ảnh, cron, retention, go-live check).
- **Không làm (đúng luật nhánh):** không build, không test, không load test. Không chạy `go-live:check`: script mở Prisma tới DB trong env của máy này (`apps/api/scripts/go-live-check.ts`), ra bảng của DB dev chứ không phải PROD nên không có giá trị. Không có `dist/`, `.next/`, `apps/miniapp/www/` trong cây này nên **không đo lại được bundle hiện tại**.
- **Giới hạn quan trọng:** tôi không truy cập được VPS, DNS, Cloudflare, Zalo Developers. Mọi câu hỏi "trên VPS đã cài chưa" (cron backup, rclone, uptime monitor, chứng chỉ, mod_deflate, mod_remoteip, vCPU, dung lượng đĩa, snapshot Vietnix) ghi **"chưa kiểm"** hoặc "không có bằng chứng trong repo". Số hiệu năng lấy từ `03-perf.md` (máy dev 14 lõi, 2026-10-09), không phải số của VPS.

---

## 1. Tóm tắt

1. **Mức hoàn thiện nhánh này: mã và tài liệu trong repo ~85%; hạ tầng thật trên VPS ~35% (gần như không có bằng chứng chạy thật); gộp ~55-60%.** Phần mã làm rất kỹ (deploy.sh đúng thứ tự, runbook rollback 675 dòng, lease cron, throttle theo userId, cache công khai, retention, health 503 khi DB/Redis chết). Phần còn thiếu nằm ở bên ngoài repo.
2. **Lỗ hổng 1 (P0): backup chưa có bằng chứng chạy trên VPS** (cron, remote ngoài máy, healthcheck, diễn tập restore). RPO mặc định 24 giờ trong khi sổ Ví/Điểm/hoa hồng chỉ nằm trong DB này (D6-01).
3. **Lỗ hổng 2 (P0): gian hàng đại lý `<tên>.tubutree.com` được giao diện quảng bá nhưng hạ tầng chỉ có `api.` và `app.`** (không DNS wildcard, không vhost, không chứng chỉ wildcard). Mục tiêu 4 (đại lý/CTV có gian hàng riêng) đang hứa một đường link chưa phục vụ được (D6-02).
4. **Lỗ hổng 3 (P1): không có giám sát từ ngoài.** Cảnh báo vận hành chạy BÊN TRONG API (cron 5 phút, `ops-health.service.ts:501`), nên API treo/chết/đầy đĩa thì im lặng; Docker không tự khởi động lại container `unhealthy` (D6-03).
5. **Ảnh là điểm yếu performance lớn nhất còn lại**: ảnh sản phẩm là URL Pancake nguyên bản (không resize/WebP/CDN), ảnh người dùng rơi về base64 trong Postgres vì Cloudinary chưa cấu hình; danh sách feed vẫn trả ảnh bìa base64 nội tuyến (D6-05).
6. **Các mục lớn của `03-perf.md` đã đóng và tôi đã kiểm lại trong mã**: A3-001 (coupon), 002/004 (throttle), 003 (SSR 404), 005 (đếm feed), 006/007 (index), 008 (retention), 009 (`GET /home`), 011 (lease cron + pool), 012 (Cache-Control), 014, 015, 017. **Còn mở: A3-010 (keepAliveTimeout), A3-013 (bundle miniapp), A3-016 (Pancake sync tuần tự).**
7. **`99-release-readiness.md` đã cũ so với `main`**: nói 132 migration, `main` có 186; viết "dùng `deploy.sh`" cho lần deploy đầu, nhưng script tự dừng ở lần đầu (mục 4). Cổng kỹ thuật "ĐẠT" chưa được lặp lại trên `main` hiện tại; race suite (204 file `*.race-spec.ts`) không nằm trong CI.
8. **Lần deploy đầu bắt buộc làm tay 14 bước** (71 migration chờ áp nếu PROD còn `cb92dc8`, `ops.yml`/`deploy.yml` trỏ VM GCP đã đóng) mà chưa có staging nào để diễn tập (D6-10).
9. VPS dùng chung với ChoDeli/WordPress (đang bán thật): build image ngay trên VPS và không có cảnh báo đĩa/RAM là rủi ro lây sang ChoDeli (D6-11).
10. Việc agent làm được ngay trong repo xếp ở mục 5A (chủ yếu S/M); việc chỉ chủ dự án làm được ở 5B (DNS, tài khoản, khoá, VPS).

---

## 2. Kiến trúc triển khai hiện tại (đọc từ repo)

| Lớp | Hiện trạng | Bằng chứng |
|---|---|---|
| Máy | VPS Vietnix `14.225.207.177`, **dùng chung** ChoDeli + WordPress/MariaDB; 7,8 GB RAM. vCPU, dung lượng đĩa, snapshot: **chưa kiểm** (repo không ghi) | `docker-compose.vietnix.yml:2-13` |
| Proxy/TLS | aaPanel Apache (không phải Caddy) → `127.0.0.1:14001` (api), `:14000` (web). Chứng chỉ Let's Encrypt cấp tay bằng certbot webroot cho đúng `api.` + `app.`; renew phải tự thêm cron. Caddyfile chỉ dùng cho `docker-compose.prod.yml`, **không chạy ở Vietnix** | `ops/vietnix-vhost-*.phase2`, `ops/README-vietnix-deploy.md` |
| Container | `postgres:16-alpine` (mem 512m), `redis:7-alpine` (192m, AOF, `noeviction`, 150mb), `api` (768m, pool Prisma 20, `pool_timeout=30`, `stop_grace_period 30s`), `web` Next standalone (512m). Tổng ~1,98 GB. Log json-file 5×10 MB. Postgres/Redis không publish cổng, api/web chỉ bind loopback. Chạy bằng root, không đặt `cpus` | `docker-compose.vietnix.yml:28,46,51,70,79,108,83,122` |
| Tiến trình API | MỘT process Node gánh HTTP + ~50 job `@Cron` + worker BullMQ. Lease `cron_leases` bảo đảm chỉ một instance chạy cron (nhân bản ngang vẫn chưa an toàn: cache và throttler nằm RAM, A3-011) | `common/cron-leader/cron-leader.service.ts`, `bootstrap.ts:35-37` |
| Deploy | Tay qua SSH. `tools/deploy/deploy.sh`: build → `check-env` → `migrate deploy` bằng image mới → thay api → thay web; build chạy NGAY trên VPS. `deploy.yml` chỉ `workflow_dispatch`; ba secret `VM_*` còn trỏ VM GCP đã đóng nên `deploy.yml`/`ops.yml`/`smoke*.yml`/`logs.yml` đều hỏng ở bước SSH | `deploy.sh:86-98`, `deploy.yml` đầu file, `ops/README-vietnix-deploy.md:99` |
| Migration | 186 migration (mới nhất `20261018000100_n1_indexes`). Image api `CMD` vẫn chạy `migrate deploy` làm lưới an toàn | `ls apps/api/prisma/migrations`, `apps/api/Dockerfile:41` |
| Rollback | Gắn thẻ `:rollback` cho image cũ + runbook mục 7 (quay image nếu schema tương thích, không thì restore backup). Chưa ai diễn tập trên VPS | `docs/launch/deploy-rollback-runbook.md` mục 5 bước 2, mục 7 |
| Backup | `tools/backup/backup-db.sh` (pg_dump gz, local 30 ngày, rclone ra ngoài, healthchecks.io) + `restore-db.sh` (nạp DB tạm rồi đổi tên). Cron/remote **chưa có bằng chứng đã cài** | `tools/backup/README.md` |
| Giám sát | `/api/health` (503 khi DB hoặc Redis chết). Cảnh báo Pancake/Gomdon/hàng đợi đi in-app + webhook + SMTP, do cron trong API phát. **Không** uptime monitor ngoài, **không** error tracking (grep sentry/bugsnag/uptime trong `apps/` rỗng), không cảnh báo đĩa/RAM/hạn chứng chỉ | `health.controller.ts`, `ops-health.service.ts:501` |
| Redis/queue | Chỉ BullMQ (đẩy Pancake, Gomdon, ZNS). Không dùng làm cache; throttler và cache catalog nằm RAM từng instance | `docker-compose.vietnix.yml:47-51`, `catalog.service.ts:29-40` |
| Secrets | `.env` trên VPS (không vào git: `.gitignore:17-19`, `.dockerignore`), nạp từ GitHub Secrets bằng `ops.yml set-env` (đang hỏng vì `VM_*`). API fail-fast khi thiếu khoá bắt buộc (`env.validation.ts`, `check-env.js`). Không có vault, không có quy trình xoay JWT/webhook secret | `GO-LIVE-KEYS.md` mục 4 |
| Ảnh | Sản phẩm: URL Pancake giữ nguyên (`pancake-sync.service.ts:357`), web dùng `<img>` trần (`product-gallery.tsx:11-14` ghi chưa dùng next/image), không resize/WebP/CDN. Ảnh người dùng: Cloudinary unsigned nếu có `VITE_CLOUDINARY_*`, nếu không thì base64 trong Postgres (`uploaded-image.ts:12`) | xem D6-05 |
| Cache | `Cache-Control` công khai qua `PublicCache` (STATIC 60s/300s, CATALOG 15s/30s, LIVE 5s/10s) trên 12 route; `GET /home` gộp (LIVE) và `/home/me` (`private, no-store`); ảnh đánh giá `immutable`. Web: Data Cache của `fetch` nằm trong `.next/cache` của container; trang vẫn động (`private, no-store`) | `public-cache.decorator.ts`, `home.controller.ts`, `99:169` |
| Dọn dữ liệu | Cron 04:30: `analytics_events` 395 ngày, `notification_logs` 180, `webhook_events` 90, `refresh_tokens` 30, theo lô 5.000, có trần thời lượng 90 phút | `data-retention.service.ts:9-22` |
| Font | Tự host 6 file woff2 (~147 KB), `font-display: swap`, không preload | `packages/design-tokens/src/fonts.css`, `fonts/` |

---

## 3. Bảng phát hiện

Quy ước: **Mức** theo brief. "Chủ DA" = chủ dự án. Chỗ ghi "chưa kiểm" là chỗ tôi không với tới được.

| ID | Mức | Vai trò | Hiện trạng + bằng chứng | Đề xuất | Công sức | Cần chủ DA quyết? |
|---|---|---|---|---|---|---|
| D6-01 | **P0** | admin, kế toán, khách (mất số dư ví/điểm) | **Backup chưa có bằng chứng chạy trên VPS.** Script sẵn (`tools/backup/backup-db.sh`, `restore-db.sh`) nhưng cron, remote rclone, healthcheck chỉ có trong tài liệu; ô kiểm ở runbook 1.2 chưa tick, "Thời gian một lần backup: ______" để trống. Diễn tập restore mới chạy trên máy dev (`tools/backup/README.md:94`: 132 migration, dữ liệu seed), chưa trên VPS, chưa trên DB cỡ thật. Đường cài cron tự động (`ops.yml action=crontab`) hỏng vì `VM_*` trỏ VM GCP đóng. Cron 02:00 một lần/ngày = RPO tối đa 24 giờ; Pancake giữ đơn/kho nhưng sổ Ví, Điểm Xanh, hoa hồng chỉ có ở DB này. Không WAL/PITR; Vietnix có snapshot VPS không: chưa kiểm | **Chủ DA:** tạo nơi lưu ngoài máy (R2/Drive) + `rclone config` + check healthchecks.io, cài cron theo README, chạy diễn tập restore trên VPS và ghi giờ (đó là RTO thật). **Agent:** đổi cron mẫu sang mỗi 6 giờ + bản pre-deploy (S); thêm vào `go-live:check` hướng dẫn gắn `-v /var/backups/tubutree:...:ro` (D6-15) | S (chủ DA 1-2 giờ) | **Y**: lưu ở đâu (R2 vài USD/tháng hay Google Drive sẵn có)? Chấp nhận mất tối đa 6 giờ hay 24 giờ sổ ví/điểm? |
| D6-02 | **P0** | đại lý/CTV, khách, marketing | **Gian hàng subdomain chưa có hạ tầng.** Giao diện nói với CTV "gian hàng của bạn là `ten.tubutree.com`" và web chia sẻ link đó (`storefront-builder.tsx:295,911`; `merchant/page.tsx:297`; `s/[slug]/page.tsx:150`); middleware rewrite theo nhãn đầu của host (`middleware.ts:26-36`). Nhưng chỉ có vhost `ServerName api.tubutree.com` và `app.tubutree.com` (`ops/vietnix-vhost-*.phase2`), Caddyfile cũng chỉ hai host, chứng chỉ certbot webroot chỉ cấp cho hai tên (wildcard bắt buộc DNS-01 hoặc để Cloudflare phát chứng chỉ ngoài biên). Không tài liệu nào trong repo nói về wildcard DNS/TLS (grep "wildcard" chỉ ra `GO-LIVE-KEYS.md:94`, nói về Zalo OAuth). Audit tháng 9 đã ghi "UNKNOWN" (A6-35, A5-53), đợt hardening tháng 10 không đóng. Thêm: `tubutree.com` gốc đang là WordPress/ChoDeli, nên DNS `*` trỏ về VPS này mà không có vhost wildcard sẽ đẩy mọi subdomain lạ vào site mặc định của aaPanel | Chọn một: **(A)** bật Cloudflare proxy (cam) + bản ghi `*` + Universal SSL (phủ `*.tubutree.com`, một cấp) + chứng chỉ Origin của Cloudflare cho Apache + vhost `ServerAlias *.tubutree.com` đặt SAU `api.`/`app.`; kèm kiểm Zalo OAuth `redirect_uri` ở subdomain (`UAT-ZALO.md` mục 12). **(B)** chưa làm subdomain: đổi mọi chỗ hiển thị/chia sẻ sang `app.tubutree.com/s/<slug>` (agent làm được: S, vài chuỗi + test), giữ code subdomain cho sau; (B) cũng loại luôn rủi ro Zalo callback | A: M (chủ DA làm DNS/Cloudflare); B: S (agent) | **Y**: ra mắt có link `ten.tubutree.com` không? Mặc định khuyên (B) cho ngày ra mắt, (A) làm sau khi DNS-only đã ổn định |
| D6-03 | P1 | admin, CSKH, khách | **Không giám sát từ ngoài.** Cảnh báo vận hành là cron trong chính API (`ops-health.service.ts:501`): API chết, Node treo (event loop bị chặn), Postgres/disk đầy → không ai được báo. Docker chỉ restart khi process thoát; container `unhealthy` giữ nguyên (không có autoheal). `ops/README-vietnix-deploy.md:150` chỉ "khuyến nghị" UptimeRobot, chưa có ai đặt. Không error tracking: lỗi 5xx chỉ nằm trong log json-file xoay vòng 5×10 MB. Không cảnh báo đĩa (`df`), RAM, hạn chứng chỉ (renew tự thêm cron, chưa kiểm cron này có chưa) | **Chủ DA:** tạo uptime monitor (UptimeRobot/BetterStack, miễn phí) cho `https://api.tubutree.com/api/health`, `https://app.tubutree.com/`, hạn TLS, gửi qua Zalo/Telegram/email chủ; gắn healthchecks.io cho backup (D6-01). **Agent:** thêm service `autoheal` vào compose Vietnix (S); nối Sentry (DSN qua env, rỗng = tắt) cho api/web/miniapp (M); thêm `ops/check-edge.sh` đọc-chỉ kiểm `dig`, hạn cert, `df -h`, `docker ps` health (S) | S (chủ DA) + M (agent) | N (mặc định: làm cả hai) |
| D6-04 | P1 | khách, admin | **DNS/TLS: chi tiết chưa nêu ở 99 (DNS/QR UAT đã biết, không báo lại).** (1) Chứng chỉ cấp tay, renew cần cron riêng chưa chắc có (`ops/README-vietnix-deploy.md` mục certbot); hết hạn sau 90 ngày mà không ai thấy thì Mini App và web chết cùng lúc. (2) Bật ☁ cam trước khi `mod_remoteip` được xác nhận làm mọi khách chung IP biên Cloudflare; throttle đăng nhập 30/phút/IP (`throttle.config.ts` `AUTH_IP_LIMIT`) sẽ trả 429 hàng loạt (khối RemoteIP chỉ có ở vhost api, `vietnix-vhost-api.conf.phase2:38`). (3) Zalo Mini App có thể yêu cầu khai báo domain API trên Zalo Developers: chưa kiểm | Làm đúng thứ tự trong README (DNS-only → certbot → kiểm `remoteip_module` → mới bật cam). Agent viết `ops/check-edge.sh` (D6-03) in `dig`, ngày hết hạn cert, `curl -I` (cf-cache-status, content-encoding). Chủ DA xác nhận mục domain trên Zalo Developers | S | N |
| D6-05 | P1 | khách, đại lý, admin | **Ảnh không có CDN/resize/WebP; Cloudinary chưa cấu hình.** (a) Ảnh sản phẩm: `images/thumbnail` lấy nguyên URL Pancake (`pancake-sync.service.ts:346-357`), thẻ web `<img loading="lazy">` không `width/height/sizes` (`product-card.tsx:18-24`), lưới Home miniapp tải ảnh đủ cỡ; kích thước thật của ảnh Pancake: chưa đo. (b) `VITE_CLOUDINARY_*` "KHÔNG có trong bất kỳ .env" (`dealer.dto.ts:19-21`) và ghi rõ "trường hợp hiện tại ở PROD" (`uploaded-image.ts:11-12`): ảnh bài cộng đồng, hồ sơ đại lý, minh chứng đổi trả lưu **base64 trong Postgres** (≤ 700.000 ký tự/ảnh bài, `uploaded-image.ts:22`). (c) `GET /feed` mỗi trang 20 bài (tối đa 50) `findMany` không `select` nên đọc hết `images` của mọi bài rồi chỉ cắt ảnh đầu (`community-feed.service.ts:315,380-391`): trả ảnh bìa base64 nội tuyến cho từng bài, ước hàng MB mỗi lần mở Cộng đồng trên 4G (chưa đo). Đánh giá và đổi trả đã chuyển sang đường ảnh có cache (`reviews.controller.ts:54`), feed thì chưa. (d) Đổi ảnh đại diện: `avatarUrl` chỉ nhận URL (`update-me.dto.ts:15-17`), nên khi không có Cloudinary, ảnh bị bỏ âm thầm sau khi miniapp báo "Đã chọn ảnh" (`edit-profile.tsx:104`). (e) DB và backup phình theo ảnh base64; retention A3-008 không phủ các bảng này | **Chủ DA:** mở Cloudinary (hoặc R2 + Cloudflare Images), tạo unsigned preset, đặt `VITE_CLOUDINARY_*` khi build miniapp. **Agent:** (1) endpoint ảnh cache cho feed như `reviews/:id/images/:i` và danh sách chỉ trả URL (M); (2) ảnh sản phẩm: 4 thẻ đầu `eager` + `fetchPriority=high`, thêm `width/height/sizes` (S); (3) bộ resize qua Cloudflare Image Resizing/`/cdn-cgi/image` hoặc `next/image` với danh sách host cố định (M, cần chốt host, xem câu hỏi) | M | **Y**: dùng dịch vụ ảnh nào và ngân sách? Pancake CDN có cho đổi kích thước bằng tham số không (chưa kiểm)? |
| D6-06 | P1 | khách | **A3-010 vẫn mở: không đặt `keepAliveTimeout`/`headersTimeout`.** `grep keepAliveTimeout apps/api/src` rỗng, `bootstrap.ts:35` chỉ `listen`. Node mặc định đóng kết nối rảnh sau 5 s; Apache `mod_proxy` tái dùng kết nối tới `127.0.0.1:14001`, nên thỉnh thoảng gặp kết nối vừa bị Node đóng: 502 lẻ "error reading status line" (`03-perf` A3-010 đo ECONNRESET ~3,3% ở 800 rps, chưa tìm nguyên nhân). Đường thật ở Vietnix đi qua Apache nên rủi ro hiện hữu | Sau `app.listen`: `server.keepAliveTimeout = 65_000; server.headersTimeout = 66_000` (S) + test; thêm `ProxyPass ... disablereuse=On` làm phương án dự phòng trong vhost; đo lại bằng `scenarios.cjs home`. Web (Next standalone) cần đặt tương đương: biến môi trường tên chính xác chưa kiểm | S | N |
| D6-07 | P1 | khách | **Nén phản hồi và cache biên chưa được xác nhận.** API không có `compression` (không có trong `apps/api/package.json`), hai vhost Apache phase2 không có `DEFLATE`; `encode gzip zstd` nằm ở `Caddyfile` mà Vietnix không dùng. aaPanel có mod_deflate toàn cục hay không: chưa kiểm (PROD chưa chạy). `PublicCache` đặt `s-maxage` (STATIC/CATALOG/LIVE) nhưng chỉ hữu ích khi có cache phía trước; Cloudflare mặc định không cache JSON và có thể bỏ qua phản hồi `Vary: Origin` (CORS thêm header này): chưa kiểm | Chủ DA: bật Cloudflare proxy (tự gzip/brotli) **hoặc** thêm `AddOutputFilterByType DEFLATE application/json text/html text/css application/javascript` vào hai vhost. Cache Rule cho `/api/home`, `/api/products*`, `/api/brands`, `/api/categories`, `/api/config/public`, `/api/flash-sales/active` rồi `curl -I` hai lần xem `cf-cache-status`. Agent: ghi dòng DEFLATE vào `ops/*.phase2` (S) | S | N |
| D6-08 | P1 | khách (Zalo) | **A3-013 vẫn mở: bundle miniapp không đo lại được.** Đo 2026-10-09: entry `index.*.js` 617 KB / 196 KB gz + CSS 125 KB, tổng 1.526 KB (`03-perf` 1.5), tăng dần theo thời gian (`DEPLOY_ZALO.md` cũ ghi 937 KB; audit tháng 9: 1,38 MB). `vite.config.mts` không có `manualChunks`/ngân sách; `HomePage` import tĩnh (`components/app.tsx:6`), 38 trang còn lại `lazy`. Từ commit đo (`080bc75`) mã miniapp tăng ròng ~8.000 dòng không tính test (`git diff --shortstat`: +18.384/−10.414 ở 205 file). Giới hạn dung lượng gói của Zalo: **chưa kiểm số hiện hành** | Agent: thêm bước CI build miniapp và **chặn** khi entry vượt ngân sách (`scripts/loadtest/bundle-size.cjs` sẵn có) (S); tách vendor `manualChunks`, sửa import tĩnh/động `store/auth.ts` (M). Chủ DA: xác nhận giới hạn dung lượng trên Zalo Developers và đo thật trên thiết bị Zalo (chưa ai đo thời gian khởi động thật) | M | N |
| D6-09 | P1 | admin, kế toán (tiền, điểm) | **CI không kiểm hai thứ làm hỏng ngày deploy.** (a) `ci.yml` chỉ `pnpm build`, không `docker build`; lỗi `express` thiếu dependency chỉ lộ khi build thật trên VPS (`ops/README-vietnix-deploy.md` mục "Sửa 1 bug hạ tầng"). (b) Race suite Postgres thật (204 file `*.race-spec.ts` ở `apps/api/test/integration-race`) không chạy trong CI: `jest.config.js` có `rootDir: 'src'`, `testRegex .*\.spec\.ts$`; `pnpm test:ci` loại e2e. Logic tiền/điểm/flash-sale chỉ được bảo vệ bằng lần chạy tay ghi ở 99 mục 2 (trên mã cũ). Không có Dependabot/`pnpm audit` (`.github/` chỉ có `workflows/`) | Agent: job `docker build api web` (không push) và job race suite với `services: postgres` trên PR vào `main` hoặc nightly (M); thêm Dependabot (S) | M | N |
| D6-10 | P1 | admin, CSKH | **Lần deploy đầu: đường duy nhất là 14 bước tay, chưa diễn tập.** `deploy.sh` từ chối (thoát 2) khi migration `20261015150000` chưa áp mà API cũ còn chạy (`deploy.sh:60,83`), và nếu PROD còn `cb92dc8` (115 migration, theo 99) thì 71 migration áp một lượt, chỉ rollback được bằng restore backup (`runbook 0.2` ràng buộc 5). `ops.yml`/`deploy.yml` hỏng do `VM_*`. Không có staging: mọi thử nghiệm (migration 71 cái trên DB có dữ liệu, `go-live:check`, đơn thử `pilot-order-playbook.md` 1.066 dòng) diễn ra thẳng trên VPS thật dùng chung. Thời gian khoá `orders` phụ thuộc số đơn (runbook mục 3) | Chủ DA: trỏ lại `VM_HOST/VM_USER/VM_SSH_KEY` sang VPS Vietnix với khoá mới (runbook mục 2) hoặc chấp nhận làm tay hết. Agent: dựng staging bằng compose Vietnix trên máy Mac/CI để diễn tập migration + runbook trước ngày D, ghi thời gian thật (M) | M | **Y**: có thuê/mở staging (cùng spec VPS) không, hay diễn tập trên Docker cục bộ rồi deploy thẳng? Khuyên: Docker cục bộ + đơn thử như playbook |
| D6-11 | P2 | khác (ChoDeli đang bán thật) | **Build image ngay trên VPS dùng chung.** `deploy.sh:87` `dc build api web`: `mem_limit` chỉ áp lúc chạy, không áp cho `next build`/`nest build`/`pnpm install` (mức RAM/CPU lúc build: chưa đo). Không giới hạn `cpus`, không dọn image cũ tự động (mỗi lần deploy thêm ~1-2 GB + thẻ `:rollback`), không cảnh báo đĩa. Lần build cũ qua được (README ghi RAM ~150 MB lúc rảnh) nhưng ở giờ cao điểm hoặc đĩa đầy thì ChoDeli/WordPress chịu chung | Agent: build image trong GitHub Actions rồi đẩy GHCR riêng tư, VPS chỉ `pull` (M); tạm thời: build ngoài giờ cao điểm, `docker image prune` có điều kiện sau deploy, thêm `cpus: '2'` cho `api`/`web` (S) | M | **Y**: chấp nhận chung VPS với ChoDeli lâu dài hay chuyển VPS riêng (chi phí)? Khuyên: chung được nếu build ở CI |
| D6-12 | P2 | khách (web, link CTV chia sẻ), marketing (SEO) | **Web không có ISR thật, LCP chưa đo.** Đo 2026-10-13: `/`, `/brand`, `/s`, `/san-pham` đều `ƒ` (động), `Cache-Control: private, no-cache, no-store`, `revalidate = 300` không tạo bản ISR (`99:169`); chỉ Data Cache `fetch` giữ dữ liệu, nằm trong container nên mất khi tạo lại. Ảnh thẻ trên màn hình đầu vẫn `loading="lazy"` (`product-card.tsx:22`), không `fetchpriority`, không `width/height` → LCP trễ, CLS rủi ro. LCP thật: chưa đo (cấm chạy). Trang chủ đọc `searchParams` nên bắt buộc động | Agent: `eager` + `fetchPriority="high"` cho 4 thẻ đầu, `width/height`/`aspect-ratio` rõ (S); tách `/` không tham số thành tĩnh hoặc cache HTML 60 s ở Cloudflare (M); đo Lighthouse trên staging | S-M | N |
| D6-13 | P2 | khách (ngày chiến dịch kéo khách từ sàn) | **Năng lực chưa được đo trên `main` và trên spec VPS.** 03-perf: một process bão hoà ~16 kết nối, gãy p95>1s ở ~96 kết nối đồng thời trên máy dev 14 lõi, ước 300-500 người cùng thao tác; VPS nhỏ hơn thì thấp hơn (vCPU: chưa kiểm). Số "trước/sau" ở 99 mục 4 là trên mã `hardening/2026-10` trước 936 commit. ~50 cron và worker BullMQ chung event loop với khách (nhiều job trùng giờ chẵn: 03:00 ×5, 04:30 ×2, đầu giờ ×4); Pancake sync 15 phút còn tuần tự theo biến thể (A3-016: `pancake-sync.service.ts:396-430` `findUnique` + `upsert` trong vòng `for`). Không scale ngang được vì cache/throttler RAM (A3-011) | Trước chiến dịch kéo khách lớn: chạy lại `scripts/loadtest` + flash sale trên staging cùng spec (agent làm khi máy rảnh, M). Nếu cần: tách cron/worker sang container thứ hai (cần cờ tắt HTTP/cron; chưa có) và chuyển throttler/cache sang Redis (L). Gom upsert Pancake theo lô (M) | M-L | **Y**: dự kiến bao nhiêu khách đồng thời ở đợt chiến dịch đầu (livestream, flash sale)? |
| D6-14 | P2 | admin | **Hardening container và giới hạn chọn tay.** `apps/api/Dockerfile:33` copy nguyên `/app` (gồm devDependencies, mã nguồn) và không có `USER node` (api và web chạy root, `apps/web/Dockerfile:52-56`); Postgres `mem_limit 512m` không `shm_size` (mặc định 64 MB, truy vấn song song lớn có thể báo "could not resize shared memory segment"); `mem_limit` chọn tay, chưa có đo RSS trên dữ liệu thật; `docker restart` sau reboot VPS (daemon bật khi khởi động, `restart: unless-stopped`) chưa được thử. **Lưu ý:** `smoke.yml`/`smoke-purchase.yml` chạy `pnpm exec tsx scripts/dev-token.ts` trong container PROD, nên gỡ devDependencies sẽ làm hai workflow này hỏng | Agent: `USER node`, `shm_size: 256m` cho Postgres, tách stage runtime nhẹ rồi sửa smoke theo (S-M). Chủ DA: thử reboot VPS một lần ngoài giờ | S-M | N |
| D6-15 | P3 | admin | `go-live:check` chạy trong container (cách runbook chỉ) thì 5 mục backup luôn "không kiểm được" vì container không thấy crontab/rclone/`/var/backups` (`collect.ts:167-169`, `backup-checks.ts` CANNOT_TELL_HOST), dễ đọc lướt là ổn | Runbook thêm `-v /var/backups/tubutree:/var/backups/tubutree:ro` và nhắc kiểm cron bằng tay (S) | S | N |
| D6-16 | P3 | khách | Font tự host (Inter 400/500/600/700 + Fraunces 500/600, ~147 KB) không preload; bản subset ~27 KB/weight: **chưa kiểm phủ ký tự tiếng Việt** (nếu thiếu, dấu rơi sang font hệ thống) | Thử render "ẩợẵữỳ" trên bản build; preload Inter 400 (S) | S | N |
| D6-17 | P3 | admin | Tồn nhỏ hạ tầng: (1) `docker-compose.prod.yml:66` `DATABASE_URL` thiếu `connection_limit=20&pool_timeout=30` (chỉ ảnh hưởng nếu chuyển sang compose này); (2) `DEPLOY_ZALO.md` còn kể "backend tự deploy qua CI/CD, 937 KB, GCP" (cũ); (3) `appleboy/ssh-action` không ghim `fingerprint`, `ops.yml` chuyển mọi secret qua `envs`; (4) không có quy trình xoay `JWT_*`/webhook secret; (5) A3-016 xem D6-13 | Đồng bộ compose, viết lại `DEPLOY_ZALO.md`, ghim fingerprint, thêm mục xoay khoá vào `GO-LIVE-KEYS.md` (S) | S | N |

---

## 4. Đối chiếu `99-release-readiness.md` và `03-perf.md`: còn đúng không?

### 4.1 Các mục "còn chặn" của 99

| Mục 99 | Hiện nay | Kết luận |
|---|---|---|
| DNS Cloudflare `api.`/`app.` → `14.225.207.177`, DNS-only (mục 1) | Không có bằng chứng đã làm; DNS ngoài tầm với (chưa kiểm). `ops/README-vietnix-deploy.md` vẫn ghi `api` trỏ IP GCP chết | **Còn đúng.** Thêm chi tiết ở D6-04 |
| Quét QR UAT trên Zalo thật | Không có kết quả UAT nào trong repo sau 99 | **Còn đúng** (chủ DA) |
| Nhập FAQ/Academy | Nội dung, không phải hạ tầng; không đổi | **Còn đúng** (chủ DA) |
| Giả định "VPS chỉ là bản thử, chưa khách thật" | Không có bằng chứng ngược; runbook 1.0 xác nhận lại 2026-10-15 | **Còn đúng**; hết hiệu lực khi có khách thật dùng bản thử |
| "Cổng kỹ thuật ĐẠT" (132 migration, jest 190 suite…) | `main` có **186** migration; 936 commit sau 2026-10-12. Theo ghi nhớ phiên, CI + Playwright xanh ở 0cc2fe62 (tôi không chạy lại, bị cấm). Race suite và đo tải trước/sau không nằm trong CI | **Đã cũ.** Cần lặp lại cổng trên `main` trước ngày D (D6-09, D6-13) |
| 7.2: deploy bằng `bash tools/deploy/deploy.sh` | Lần đầu **không dùng được**: script thoát mã 2 khi migration `20261015150000` chưa áp mà API cũ còn chạy (`deploy.sh:60,83`). Phải theo `docs/launch/deploy-rollback-runbook.md` | **Sai cho lần đầu.** Sau lần đầu có thể quay lại `deploy.sh` |
| Rủi ro "migration dừng giữa chừng, crash-loop" | `deploy.sh` migrate bằng image mới trước khi thay container (`deploy.sh:86-98`); `CMD` vẫn chạy `migrate deploy` (`Dockerfile:41`) nên đường `up -d` tay vẫn còn nguy cơ cũ | **Giảm** (có điều kiện: phải dùng đúng script/runbook) |
| Redis `noeviction` | Compose đã đặt (`docker-compose.vietnix.yml:51`); container đang chạy trên VPS có thể còn `allkeys-lru` tới khi tạo lại (runbook 1.1). `go-live:check` FAIL nếu sai | **Còn đúng**, việc trên VPS |
| P2028 pool | `connection_limit=20&pool_timeout=30` đã đặt (`docker-compose.vietnix.yml:79`); chưa đo dưới tranh chấp thật; `docker-compose.prod.yml:66` chưa đặt | **Đã xử lý một phần** (D6-17) |
| Web cold-start khi API chưa lên | `deploy.sh` đợi api healthy rồi mới thay web; Data Cache mất khi tạo lại container web | **Còn đúng**, nhưng được thứ tự deploy bù |
| `CREATE INDEX` khoá ghi vài giây | Migration mới nhất (`n1_indexes`) cố ý không `CONCURRENTLY`, ghi "bảng còn gần rỗng trước launch" | **Đúng chỉ tới ngày ra mắt**; sau đó dùng `tools/db/*-concurrently.sh` |
| `ops.yml`/`deploy.yml` hoạt động | `VM_*` vẫn trỏ VM GCP đóng (`ops/README-vietnix-deploy.md:99`, `GO-LIVE-KEYS.md:246-249`) | **Còn đúng** (chủ DA, D6-10) |
| Subdomain gian hàng CTV phục vụ được | 99 không nhắc; audit 9 ghi UNKNOWN | **Lỗ hổng mới so với 99** (D6-02) |

### 4.2 Các mục `03-perf.md` (kiểm lại trong mã `main`)

| ID cũ | Trạng thái | Bằng chứng |
|---|---|---|
| A3-001 `/me/coupons` | Đóng | SQL lọc scope + hai partial index (`loyalty.service.ts:668-690`, migration `20261010040000_coupon_scope_partial_indexes`), cron dọn coupon cá nhân hết hạn (`coupon-cleanup.cron.ts:38`) |
| A3-002/004 throttle | Đóng | 300/phút/route theo userId, đăng nhập 10 theo định danh + 30/IP (`throttle.config.ts`); miniapp xử lý 429 (`services/api.ts`) |
| A3-003 SSR 404 giả | Đóng | `ApiUnavailableError`, chỉ 404 mới `null` (`web/lib/api.ts:28-60`); SSR gửi `x-throttle-bypass` |
| A3-005 đếm feed | Đóng | `countsForPage` chỉ cho id của trang (`community-feed.service.ts:343-360`) |
| A3-006/007 index admin/tìm kiếm | Đóng | migrations `20261010042435_admin_cron_query_indexes`, `20261010053812_catalog_name_search_index`, cột `nameSearch` (`schema.prisma` ~410) |
| A3-008 bảng phình | Đóng | `data-retention.service.ts` (xem mục 2). Còn thiếu ảnh base64 (D6-05) |
| A3-009 Home 17 request | Đóng | `GET /home` + `/home/me` (`home.controller.ts`), `miniapp/services/home-feed.ts` |
| A3-011 nhân bản/pool | Đóng một phần | lease cron + `connection_limit`; cache/throttler vẫn RAM (chấp nhận khi 1 instance) |
| A3-012 Cache-Control | Đóng ở API | `PublicCache` 12 route; còn thiếu bước CDN/nén (D6-07) |
| A3-014 gộp giỏ N+1 | Đóng | `auth.service.ts:411-423` dùng SQL theo tập |
| A3-015 `take` | Đóng | `affiliate.service.ts:222`, `subscriptions.service.ts:404` |
| A3-017 cron đêm | Đóng | `analytics-aggregation.service.ts` tính theo ngày VN |
| **A3-010 keepAlive** | **Còn mở** | D6-06 |
| **A3-013 bundle** | **Còn mở** | D6-08 |
| **A3-016 Pancake tuần tự** | **Còn mở (P3)** | `pancake-sync.service.ts:396-430` |

---

## 5. Danh sách việc trước ra mắt

### 5A. Agent làm được trong repo (không cần quyền ngoài)

Thứ tự đề xuất theo giá trị/công sức:

| # | Việc | Liên quan | Công sức |
|---|---|---|---|
| 1 | `keepAliveTimeout`/`headersTimeout` cho API + `disablereuse` dự phòng trong vhost mẫu | D6-06 | S |
| 2 | Dòng `DEFLATE` vào `ops/vietnix-vhost-*.phase2`; viết `ops/check-edge.sh` (dig, hạn cert, header nén/cache, `df`, health) | D6-04, 07, 03 | S |
| 3 | Cron backup mẫu 6 giờ + bản pre-deploy; runbook gắn `-v /var/backups/...:ro` cho `go-live:check` | D6-01, 15 | S |
| 4 | Ảnh web: 4 thẻ đầu `eager` + `fetchPriority`, `width/height/sizes` | D6-05, 12 | S |
| 5 | Phương án (B) subdomain: đổi chuỗi hiển thị/chia sẻ sang `app.tubutree.com/s/<slug>` (nếu chủ DA chọn B) | D6-02 | S |
| 6 | CI: job `docker build api web`; job race suite (postgres service); Dependabot; bước chặn ngân sách bundle miniapp | D6-09, 08 | M |
| 7 | Autoheal trong compose Vietnix; `USER node`, `shm_size`, `cpus` | D6-03, 14 | S-M |
| 8 | Endpoint ảnh có cache cho feed, danh sách feed chỉ trả URL (và `select` bỏ `images` thô) | D6-05 | M |
| 9 | Sentry (DSN qua env, rỗng = tắt) cho api/web/miniapp | D6-03 | M |
| 10 | Tách vendor miniapp (`manualChunks`), sửa import `store/auth.ts` | D6-08 | M |
| 11 | Build image trong CI → GHCR, VPS chỉ pull | D6-11 | M |
| 12 | Diễn tập trước ngày D: dựng stack Vietnix bằng Docker cục bộ, chạy runbook 14 bước + migration 186 cái, ghi thời gian; chạy lại gate (jest, race, load test, Playwright) trên `main` khi máy rảnh | D6-10, 13 | M |
| 13 | Gom upsert Pancake theo lô; đồng bộ `docker-compose.prod.yml`; dọn `DEPLOY_ZALO.md`; thêm mục xoay khoá | D6-13, 17 | S-M |

### 5B. Chủ dự án phải làm (DNS, khoá, VPS, tài khoản)

| # | Việc | Bắt buộc? | Ghi chú |
|---|---|---|---|
| 1 | Trỏ DNS Cloudflare `api.`/`app.` → `14.225.207.177`, DNS-only; certbot; kiểm `remoteip_module` rồi mới bật ☁ cam | P0 (đã biết ở 99) | Theo `ops/README-vietnix-deploy.md`; thêm cron renew certbot |
| 2 | Tạo nơi lưu backup ngoài máy + `rclone config` + healthchecks.io; cài cron; **diễn tập restore trên VPS và ghi thời gian** | P0 | D6-01 |
| 3 | Quyết định subdomain gian hàng (A hay B) và, nếu A, làm DNS `*`, Cloudflare Universal SSL, chứng chỉ Origin, vhost wildcard | P0 | D6-02 |
| 4 | Tạo uptime monitor (UptimeRobot/BetterStack) cho `api/health`, `app`, hạn TLS; kênh nhận cảnh báo | P1 | D6-03 |
| 5 | Mở Cloudinary (hoặc dịch vụ ảnh khác), tạo unsigned preset, đặt `VITE_CLOUDINARY_*` lúc build miniapp | P1 | D6-05; ảnh đại diện đang không lưu được nếu thiếu |
| 6 | Trỏ lại `VM_HOST`, `VM_USER`, `VM_SSH_KEY` (khoá SSH mới) hoặc xác nhận làm tay hết | P1 | D6-10, runbook mục 2 |
| 7 | Đặt kênh báo động `OPS_ALERT_WEBHOOK_URL`, SMTP; `THROTTLE_BYPASS_TOKEN` (≥ 32 ký tự, giống nhau cho api và web); `CORS_ORIGINS`; `AUTH_COOKIE_*` | P1 | runbook 1.3 (ba khoá cuối phải sửa tay) |
| 8 | Điền khoá bắt buộc: Pancake (API key, shop id, webhook secret), `ZALO_APP_ID` (build web dừng nếu rỗng), ZaloPay/ZNS/OA khi muốn bật | P0/P1 theo tính năng | `GO-LIVE-KEYS.md`; ZNS template lead time 7-14 ngày |
| 9 | Xác nhận trên Zalo Developers: giới hạn dung lượng gói hiện hành, danh sách domain API, thời gian duyệt khi nộp bản production (chưa kiểm) | P1 | D6-04, D6-08 |
| 10 | Thông tin VPS: số vCPU, dung lượng đĩa, có snapshot Vietnix không, ai giữ root; thử reboot một lần ngoài giờ | P1 | D6-14; điền số điện thoại ở runbook 0.5 |
| 11 | Quyết định chung VPS với ChoDeli hay VPS riêng; cho phép mở staging | P2 | D6-10, 11 |
| 12 | Quét QR UAT trên Zalo thật; nhập FAQ/Academy | P0 (đã biết ở 99) | `UAT-ZALO.md` |

---

## 6. Đề xuất tính năng/công cụ mới (theo giá trị/công sức)

1. **Ảnh qua một cửa (`/img` hoặc Cloudflare Image Resizing) + `next/image` với danh sách host cố định.** Giúp mục tiêu 1 (khách sàn quen ảnh sắc nét, tải nhanh) và 3 (cộng đồng đăng ảnh không làm nặng feed). Công sức M, cần chốt dịch vụ (D6-05).
2. **Trang "Trạng thái hệ thống" công khai/nội bộ + `ops/check-edge.sh`.** Giúp mục tiêu 5 (nhân sự khỏi hỏi dev khi chậm): một trang xem health, hạn cert, tuổi bản backup mới nhất, dung lượng đĩa. Có sẵn màn Sức khoẻ hệ thống ở admin; chỉ cần thêm 3 chỉ số hạ tầng. M.
3. **Cache HTML biên cho `/`, `/brand/*`, `/s/*`, `/san-pham/*` (Cloudflare Cache Rule 60 s + stale-while-revalidate).** Giúp mục tiêu 1 và 4: link gian hàng đại lý chia sẻ trên Zalo/Facebook mở nhanh, chịu được đợt đổ khách. S-M sau khi bật proxy.
4. **Ngân sách hiệu năng trong CI (entry miniapp, First Load JS web, số request Home).** Giúp mọi mục tiêu: chặn hồi quy bundle từng PR thay vì phát hiện bằng audit. S-M.
5. **Chế độ bảo trì nhẹ (trang "đang nâng cấp" ở Apache khi deploy cửa sổ migration).** Giảm 502 thô trong cửa sổ khoá bảng `orders` của runbook. S.

---

## 7. Câu hỏi cho chủ dự án (chỉ những câu đổi quyết định)

| # | Câu hỏi | Phương án mặc định khuyên |
|---|---|---|
| 1 | Ra mắt có dùng link gian hàng `ten.tubutree.com` không? | **Không** ở ngày ra mắt: dùng `app.tubutree.com/s/<slug>` (D6-02 phương án B), làm subdomain sau khi DNS/Cloudflare ổn định |
| 2 | Backup lưu ở đâu và chấp nhận mất tối đa bao lâu dữ liệu ví/điểm? | Cloudflare R2 (hoặc Google Drive sẵn có), cron 6 giờ + bản trước mỗi lần deploy |
| 3 | Dịch vụ ảnh nào (Cloudinary / R2 + Cloudflare Images) và ngân sách? | Cloudinary gói miễn phí để chạy ngay (đã có sẵn code); xem lại khi lượng ảnh tăng |
| 4 | Có bật Cloudflare proxy (cam) sau khi xác nhận `mod_remoteip` không? | Có: được nén, cache biên, chống DDoS và che IP VPS; giữ DNS-only cho tới khi kiểm xong |
| 5 | Chung VPS với ChoDeli lâu dài hay tách VPS riêng? Có mở staging không? | Chung được nếu build ở CI (D6-11); staging là Docker cục bộ + đơn thử theo playbook, chưa cần thuê máy |
| 6 | Dự kiến lượng khách đồng thời ở đợt chiến dịch đầu (livestream, flash sale)? | Nếu trên ~300 đồng thời: chạy lại load test trên `main` trước ngày D, cân nhắc nâng VPS |
| 7 | Cho phép agent đổi `ops.yml`/vhost mẫu và thêm job CI (docker build, race suite, bundle budget) không? | Có; không đụng PROD, chỉ đổi file trong repo |
