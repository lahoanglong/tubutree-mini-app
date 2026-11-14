# Deploy tạm trên VPS Vietnix (chung ChoDeli) — 2026-09-12

Bối cảnh đầy đủ: `docs/2026-09-12-deploy-runbook.md` mục 4.3 và memory `deploy_infra_status_2026_09.md`.

> **Bản ghi lần chạy thử 2026-09-12, không phải quy trình deploy thật.** Lần đó seed bằng `prisma:seed` (44 sản phẩm demo).
> `prisma:seed` nay bị chặn khi `NODE_ENV=production` trừ khi đặt `ALLOW_PROD_SEED=1`
> (`apps/api/src/modules/system-config/seed-guard.ts:8`, gọi ở `apps/api/prisma/seed.ts:929`); KHÔNG đặt biến này trên VPS.
> Deploy thật nạp dữ liệu bằng `prisma:seed:reference --with-business-defaults` rồi `prisma:cleanup-demo`, theo
> [runbook](../docs/launch/deploy-rollback-runbook.md) bước 7b và 7c. Nâng cấp từ bản thử `cb92dc8` sẽ có mục riêng trong runbook.

## Đã làm, đã verify (lần chạy thử 2026-09)

- Clone repo vào `/opt/tubutree` trên VPS (`chodeli-vps` = 14.225.207.177, SSH sẵn trong
  `~/.ssh/config` cục bộ), build + chạy bằng `docker-compose.vietnix.yml` (bản KHÔNG có Caddy —
  cổng 80/443 đã do Apache/aaPanel giữ cho WordPress; api/web chỉ bind `127.0.0.1:14001` /
  `127.0.0.1:14000`, có `mem_limit` từng service để không kéo sập ChoDeli/WordPress).
- Sửa 1 bug hạ tầng thật phát hiện khi build lần đầu: `express` là phantom dependency (chỉ resolve
  được nhờ hoist khi cài full monorepo) → container crash-loop `Cannot find module 'express'`.
  Đã thêm `express` làm dependency trực tiếp của `@tubutree/api` (commit `d80ecf2`).
- Seed bằng `prisma:seed` xong (44 sản phẩm mẫu, categories, coupon, quiz...). `GET /config/public` và
  `POST /auth/guest` (cả 2 chế độ header `x-client: web` / không có) đã test qua `curl` trên
  chính VPS — đúng như mong đợi (cookie `Secure; HttpOnly; SameSite=Lax`, `refreshToken` rỗng
  trong thân khi có header).
- Vhost Apache **PHASE 1** (chỉ HTTP, chưa có SSL) đã cài và verify bằng Host header giả lập
  (DNS chưa trỏ vào đây) — cả `api.tubutree.com` và `app.tubutree.com` route đúng vào container,
  WordPress ở domain gốc (`tubutree.com`) không bị ảnh hưởng (`apachectl -k graceful`, không
  restart nên không rớt kết nối đang có).
- RAM lúc rảnh: cả 4 container Tubu Tree cộng lại **~150MB thực dùng** (giới hạn cứng 2GB),
  ChoDeli/WordPress không đổi. Không có OOM/swap tăng bất thường sau deploy.

## CÒN LẠI — cần người (DNS, tôi không có quyền truy cập)

DNS quản lý qua **Cloudflare** (`fay.ns.cloudflare.com` / `ruben.ns.cloudflare.com`). Cần đổi 2
bản ghi A, trỏ về **14.225.207.177** (IP VPS này, KHÔNG phải IP GCP cũ):

| Bản ghi | Hiện tại | Cần đổi thành |
|---|---|---|
| `api.tubutree.com` (A) | 34.142.194.160 (GCP cũ, đã chết) | `14.225.207.177` |
| `app.tubutree.com` (A) | chưa tồn tại | tạo mới, `14.225.207.177` |

**Quan trọng:** để Cloudflare proxy TẮT (DNS only / ☁ xám, không phải ☁ cam) cho 2 bản ghi này
khi mới tạo — bật proxy cam ngay từ đầu sẽ chặn certbot xác thực HTTP-01 (Cloudflare che IP
thật). Sau khi có cert xong, bật lại proxy cam nếu muốn (không bắt buộc).

**Trước khi bật ☁ cam cho `api.tubutree.com`:** API giới hạn đăng nhập/refresh theo IP (30 lượt/phút,
`throttle.config.ts`) và lấy IP từ hop cuối của `X-Forwarded-For` (`trust proxy` = 1). Qua Cloudflare,
hop đó là IP edge dùng chung cho rất nhiều khách → 429 "thao tác quá nhanh" hàng loạt. Vhost phase2 đã
có khối `mod_remoteip` (đọc `CF-Connecting-IP` chỉ khi kết nối đến từ dải IP Cloudflare); chỉ bật ☁ cam
khi đã xác nhận module được nạp và IP thật về tới API:

```bash
httpd -M 2>/dev/null | grep remoteip || apachectl -M | grep remoteip   # phải thấy remoteip_module
# Bật ☁ cam, gọi API từ điện thoại (4G), rồi xem IP mà mod_remoteip đã thay (%a) trong log:
# phải là IP 4G, không phải IP Cloudflare (172.64.x, 104.x, 162.158.x...).
# (LogFormat "combined" ghi %h; nếu cột đầu vẫn là IP Cloudflare, đổi tạm sang LogFormat có %a để kiểm.)
tail -n 5 /www/wwwlogs/api.tubutree.com-access_log
```

Không thấy `remoteip_module` thì giữ ☁ xám.

## Sau khi DNS đã trỏ đúng (tôi tự làm tiếp, không cần hỏi lại)

```bash
# Đợi DNS lan truyền rồi kiểm tra trước:
dig +short api.tubutree.com   # phải ra 14.225.207.177
dig +short app.tubutree.com

# Lấy cert (webroot — không cần dừng gì đang chạy):
sudo certbot certonly --webroot -w /var/www/certbot -d api.tubutree.com -d app.tubutree.com \
  --non-interactive --agree-tos -m <email liên hệ>

# Dán đè vhost phase 2 (có SSL + redirect http→https):
sudo cp ops/vietnix-vhost-api.conf.phase2 /www/server/panel/vhost/apache/api.tubutree.com.conf
sudo cp ops/vietnix-vhost-app.conf.phase2 /www/server/panel/vhost/apache/app.tubutree.com.conf
sudo /www/server/apache/bin/apachectl configtest && sudo /www/server/apache/bin/apachectl -k graceful

# Verify qua domain thật:
curl -s https://api.tubutree.com/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://app.tubutree.com/
```

Certbot cài theo cách này (system certbot, KHÔNG qua aaPanel) — renew tự động cần thêm cron
riêng (aaPanel không biết site này để tự renew hộ):

```bash
# Kiểm renew thử (dry-run), rồi thêm cron nếu chưa có sẵn certbot.timer/cron hệ thống:
sudo certbot renew --dry-run
sudo crontab -l  # xem đã có dòng certbot renew chưa (aaPanel thường tự có sẵn cho site của nó)
# Nếu chưa có, thêm: 0 3 * * * certbot renew --quiet --post-hook "/www/server/apache/bin/apachectl -k graceful"
```

## Deploy bản mới

> **Bản phát hành có migration đánh giá nhiều lần (`20261015150000`, kèm `20261014213300` và
> `20261015070000`): KHÔNG dùng `deploy.sh`.** Script áp migration khi API cũ còn chạy, mà migration
> này đổi chỉ mục duy nhất của bảng `reviews` (nên `deploy.sh` tự dừng, thoát 2 và chưa build gì, khi
> migration đó chưa áp mà API cũ còn chạy). Danh sách migration thật phải áp có thể dài hơn ba cái này
> nhiều (xem mục 1.0 của runbook: phải xác định bản đang chạy trước). Làm theo
> [docs/launch/deploy-rollback-runbook.md](../docs/launch/deploy-rollback-runbook.md): dừng API cũ,
> backup, migrate, bật web mới rồi API mới, kiểm khói, rollback từng trường hợp. Sau khi lên bản mới,
> chạy [docs/launch/pilot-order-playbook.md](../docs/launch/pilot-order-playbook.md) (đơn thử thật)
> trước khi mở bán. Kiểm sẵn sàng: `pnpm run go-live:check` trong `apps/api` (chỉ đọc, in bảng
> PASS/WARN/FAIL, thoát 1 nếu có FAIL).
>
> **Máy ảo GCP cũ đã đóng.** Secret GitHub `VM_HOST`, `VM_USER`, `VM_SSH_KEY` vẫn trỏ vào máy đó, nên
> `deploy.yml` và `ops.yml` lỗi ở bước SSH cho tới khi trỏ lại về VPS Vietnix (xem mục 2 của runbook).
> Trong lúc chờ, deploy và vận hành làm tay qua SSH như dưới đây.

Các lần phát hành thường (không có migration kiểu trên):

```bash
cd /opt/tubutree
# 1. Backup trước (bản pre-deploy, ngoài bản cron 6 giờ/lần). Máy chủ đã có mã mới của ops/ thì dùng
#    `bash ops/backup-predeploy.sh` (nhãn predeploy, giữ riêng 10 bản); chưa có thì dòng dưới vẫn chạy như cũ
COMPOSE_FILE=docker-compose.vietnix.yml bash tools/backup/backup-db.sh
# 2. Đưa mã lên (git bundle / git merge --ff-only)
# 3. Build -> migrate bằng image MỚI -> thay api -> thay web.
#    Bản có migration points_1d (một chiều) mà API đang chạy: deploy.sh build, kiểm .env, dừng API, backup LẠI bằng
#    ops/backup-predeploy.sh (bản ở bước 1 chạy trước build nên thiếu mọi ghi trong lúc build), migrate, seed-reference, bật API.
#    Backup lỗi thì API cũ được bật lại, chưa migrate gì.
bash tools/deploy/deploy.sh
# 4. Kiểm sau deploy (bằng image mới)
docker compose -f docker-compose.vietnix.yml run --rm --no-deps --user "$(stat -c %u:%g /var/backups/tubutree)" -v /var/backups/tubutree:/var/backups/tubutree:ro api pnpm run go-live:check
# 5. Kiểm biên và máy chủ: health, nén, cache, chứng chỉ, đĩa, container unhealthy, backup mới nhất
bash ops/check-edge.sh --local
```

(`-v /var/backups/tubutree:...:ro` để `go-live:check` thấy thư mục backup, `--user "$(stat -c %u:%g /var/backups/tubutree)"` vì thư mục đó mode 700 của người vận hành mà image api chạy bằng uid 1000 (`node`); uid:gid lấy từ chủ thư mục vì service api bỏ hết capability (cap_drop ALL) nên container phải đúng chủ mới vào được, thiếu thì dòng `backup.recent` báo "không đọc được thư mục"; trong container nó không đọc được crontab và rclone, nên 4 mục backup còn lại luôn là WARN "không kiểm được": kiểm tay bằng `crontab -l | grep backup-db` và `rclone listremotes`, xem [runbook](../docs/launch/deploy-rollback-runbook.md) mục 1.2.)

**Lần deploy đầu (hoặc DB mới): sau bước migrate, chạy thêm
`npx prisma migrate deploy && npm run prisma:seed:reference -- --with-business-defaults`** (trên VPS: `docker compose -f
docker-compose.vietnix.yml run --rm --no-deps api pnpm run prisma:seed:reference --with-business-defaults`, xem bước 7b của
runbook). Thứ tự: `deploy.sh` migrate rồi bật API ngay trong cùng một lần chạy, nên không xen lệnh này
vào giữa được; chạy nó NGAY SAU `deploy.sh` (vài chục giây API chạy với bảng tham chiếu còn trống, như
trước đây, không lỗi; khoá cấu hình vừa nạp có hiệu lực trong 60 giây, không cần khởi động lại).
Muốn dữ liệu có TRƯỚC khi API chạy thì theo thứ tự thủ công của runbook (bước 7b nằm giữa migrate và
bật API). Migration không nạp chủ đề cộng đồng, quiz, loài cây và 28 mẫu thông báo; `prisma:seed` thì
bị chặn ở production. Lệnh này chỉ tạo dòng còn thiếu, không ghi đè chỉnh sửa của admin và không đụng
sản phẩm, người dùng, mã giảm giá, tài khoản ngân hàng, nên chạy lại sau mỗi lần phát hành cũng được.
Hạng thành viên, bậc đại lý, nhiệm vụ và 6 khoá có giá trị kinh doanh chỉ nạp khi thêm `--with-business-defaults`;
chủ dự án đã chốt chạy CÓ cờ (A8), nên lệnh trên phải kèm cờ: `... pnpm run prisma:seed:reference --with-business-defaults`
(không cờ thì DB mới không có hạng, mọi khách hệ số điểm x1, admin không duyệt được hồ sơ đại lý). `deploy.sh` chỉ gọi nó trong
luồng `points_1d` (bản có migration đó chưa áp) hoặc khi API đang tắt, và tự thêm cờ; đặt `SEED_REFERENCE_ARGS=` (rỗng) để bỏ cờ trên DB
đã có sẵn các bảng đó. Deploy thường (API đang chạy, không có migration đó) vẫn không gọi.

`tools/deploy/deploy.sh` giữ đúng thứ tự: `docker compose run` **không** build lại image, nên
chạy `run --rm api pnpm exec prisma migrate deploy` trước khi build sẽ áp thư mục migrations của
image CŨ ("No pending migrations") và migration mới chỉ chạy trong CMD của container mới, sau khi
container cũ đã bị thay. Script build trước, migrate bằng image mới, migration lỗi thì dừng khi
container cũ vẫn phục vụ. Nhiều instance api cùng lúc (scale, hoặc container cũ/mới chồng nhau) thì
chỉ instance giữ lease trong bảng `cron_leases` chạy @Cron (`src/common/cron-leader`); log có dòng
`Instance <host:pid:id> chạy cron.` ở đúng một instance. Vẫn giữ một instance cho tới khi đo lại
P2028 (pool Prisma) với nhiều instance.

## Backup 6 giờ/lần (bắt buộc trước khi có khách thật)

Cài cron theo `tools/backup/README.md` mục "Cài đặt trên VPS Vietnix" và "Cài crontab (6 giờ/lần)", mẫu ở
[ops/crontab.backup.example](crontab.backup.example): `COMPOSE_FILE=/opt/tubutree/docker-compose.vietnix.yml`,
`BACKUP_LABEL=cron BACKUP_KEEP_COUNT=120` (30 ngày x 4; chỉ hạ khi đã có remote), `RCLONE_REMOTE` trỏ ra ngoài máy (R2/S3/Drive), `HEALTHCHECK_URL` để được
báo khi backup lỗi hoặc cron không chạy. Mất tối đa 6 giờ dữ liệu khi phải khôi phục. Thiếu remote hoặc healthcheck thì
backup vẫn chạy nhưng log có dòng `WARN` (và `go-live:check` báo). Diễn tập restore trước go-live và mỗi tháng (cùng README, lấy
bản về từ remote và bấm giờ). Bước diễn tập, đo thời gian backup và khôi phục khi deploy hỏng nằm ở
[runbook deploy](../docs/launch/deploy-rollback-runbook.md) mục 1.2 và mục 7.

### Bản offsite hằng ngày có theo dõi tuổi (W158, tuỳ chọn)

`bash ops/backup-offsite.sh` dump riêng (file `tubutree_<giờ>_offsite.sql.gz`), kiểm file > 0 byte và `gzip -t`, đẩy lên `RCLONE_REMOTE`, kiểm file đã có ở remote rồi mới ghi dấu `/var/backups/tubutree/.last-offsite-ok`. Chưa đặt `RCLONE_REMOTE` thì chỉ giữ bản local và in `SKIP offsite (RCLONE_REMOTE unset)` (thoát 0). Remote PHẢI là rclone `crypt` như `backup-db.sh` (remote loại khác bị từ chối, thoát 3, trừ `BACKUP_ALLOW_PLAIN_REMOTE=1`). Giữ 14 ngày ở máy và 30 ngày ở remote (`RETENTION_DAYS`, `OFFSITE_RETENTION_DAYS`), chỉ dọn file nhãn `offsite` của chính nó nên không đụng bản cron hay predeploy; dọn remote chỉ ở thư mục gốc (`--max-depth 1`), thư mục con như `archive/` không bị đụng. Upload lỗi thì bỏ qua cả việc dọn bản local (bản offsite cũ có thể là bản duy nhất chưa từng lên remote). Dòng cron mẫu (đang là comment) ở [crontab.backup.example](crontab.backup.example). Mã thoát: 0 xong, 1 sai cấu hình, 2 dump hỏng, 3 bản local xong nhưng không có bản ngoài máy.

`bash ops/check-edge.sh --local` thêm hai kiểm: bản mới nhất không rỗng (file 0 byte là dump lỗi hoặc đang chạy dở), và nếu có dấu `.last-offsite-ok` thì tuổi của nó (WARN quá `--offsite-max-hours`, mặc định 30; FAIL quá gấp 3). Chưa có dấu và chưa có bản nhãn `offsite` nào thì chỉ ghi chú `backup offsite: chưa bật`, không WARN/FAIL; đã có bản nhãn `offsite` mà chưa từng có dấu (cron bật nhưng upload lỗi mỗi đêm: thiếu rclone, remote không phải crypt) thì WARN. Lưu ý: dòng cron 6 giờ qua `backup-db.sh` cũng đẩy ra ngoài máy nhưng không ghi dấu này, nên check-edge chỉ theo dõi được đường `backup-offsite.sh`.

Kiểm thử (không cần Docker/rclone/mạng): `bash ops/test-backup-offsite.sh`, `bash ops/test-check-edge-backup.sh`.

## Nén, giữ kết nối và kiểm biên (2026-10-18)

- Vhost phase2 có `mod_deflate` (JSON/HTML/JS/CSS/SVG) và `ProxyPass ... ttl=30`; API đặt `keepAliveTimeout` 125 s, web
  `KEEP_ALIVE_TIMEOUT=55000`. Mục đích: hết 502 lẻ "error reading status line" do Apache tái dùng kết nối Node vừa đóng
  (A3-010). Dán lại hai file phase2 (khối lệnh ở runbook mục 1.5) để có hiệu lực; vhost đang chạy không dán lại vẫn hoạt động như cũ.
  Dự phòng nếu vẫn thấy 502 lẻ: thêm `disablereuse=On` sau `ttl=30`.
- `bash ops/check-edge.sh` (từ máy bất kỳ) kiểm DNS (so với `14.225.207.177`), hạn chứng chỉ (WARN dưới 21 ngày, FAIL dưới 7),
  HTTP, nén, `Cache-Control`, `cf-cache-status` và `/api/health`; thêm `--local` trên VPS để kiểm đĩa (WARN 80%, FAIL 90%),
  container `unhealthy`, cron certbot và bản backup mới nhất. Chỉ đọc, thoát 1 khi có FAIL, `--help` liệt kê tuỳ chọn. Chưa
  có giám sát ngoài: chạy tay trước và sau mỗi deploy, hoặc đặt UptimeRobot/BetterStack cho `https://api.tubutree.com/api/health`.
- Trần CPU của api/web và `USER node` của container web: xem phần đầu `docker-compose.vietnix.yml` và runbook mục 1.5.
- Đổi cấu hình `postgres` hoặc `redis` trong compose thì `tools/deploy/deploy.sh` bước 4 (`up -d --no-build api`, không có `--no-deps`)
  sẽ tạo lại chúng giữa lúc deploy (DB ngắt ~10 giây, 5xx). Muốn đổi, chạy chủ động ngoài giờ cao điểm TRƯỚC deploy:
  `docker compose -f docker-compose.vietnix.yml up -d --no-deps postgres redis`.

## Redis và log container

- Redis chạy `--maxmemory 150mb --maxmemory-policy noeviction` (BullMQ bắt buộc noeviction; trước
  đây là `allkeys-lru`, có thể xoá âm thầm job đang chờ retry). Lần deploy đầu sau thay đổi này phải
  tạo lại container redis bằng compose MỚI (`docker compose -f docker-compose.vietnix.yml up -d --no-deps redis`,
  chạy SAU khi đã lấy compose mới về máy chủ: compose cũ vẫn đặt `allkeys-lru` nên chạy lệnh đó trước thì
  không đổi gì), rồi kiểm
  `docker compose -f docker-compose.vietnix.yml exec redis redis-cli config get maxmemory-policy`. Muốn đổi
  ngay mà không khởi động lại: `... exec -T redis redis-cli config set maxmemory-policy noeviction` (mất khi
  container khởi động lại, nên vẫn phải tạo lại bằng compose mới; runbook mục 1.1 và mục 5 bước 5).
- `pnpm run go-live:check` báo FAIL nếu policy không phải `noeviction` (chỉ WARN với `--phase=pre-deploy`, vì
  compose cũ còn đặt `allkeys-lru` cho tới khi redis được tạo lại); kiểm bằng tay theo
  [runbook](../docs/launch/deploy-rollback-runbook.md) mục 1.1.
- Theo dõi bộ nhớ Redis: `docker compose -f docker-compose.vietnix.yml exec redis redis-cli info memory | grep used_memory_human`.
  Gần 150MB thì lệnh ghi lỗi OOM, enqueue rơi về cron reconcile; tìm queue nào ứ (job failed giữ
  tối đa 1000 mỗi queue) trước khi nâng trần.
- `/api/health` trả 503 khi DB **hoặc** Redis không phản hồi, nên `docker ps` hiện api `unhealthy`
  khi Redis sập. Monitor ngoài (UptimeRobot...) nên gọi `https://api.tubutree.com/api/health`.
- Mọi container ghi log json-file tối đa 5 × 10MB (`x-logging` trong compose). Theo dõi đĩa:
  `df -h /` và `docker system df`, hoặc `bash ops/check-edge.sh --local` (WARN từ 80%).

## Khi có VM/VPS riêng (dọn dẹp về sau)

Quay lại `docker-compose.prod.yml` (có Caddy, không giới hạn RAM) trên máy mới, migrate DNS
sang IP mới, rồi tắt stack trên VPS Vietnix này (`docker compose -f docker-compose.vietnix.yml
down -v`) + xoá 2 file vhost Apache + xoá `/opt/tubutree`.

## Dọn thẻ `:prev-*` an toàn (W158)

`bash tools/deploy/prune-prev-images.sh` mặc định chỉ in kế hoạch; `--dry-run` nói rõ điều đó (thắng `--apply` nếu đưa cả hai), `--apply` mới xoá, `--keep=N` hoặc `KEEP_PREV=N` đổi số bản giữ (cờ thắng biến). Luôn giữ ít nhất 3 bản: dưới 3 bị từ chối (thoát 2) trừ khi `PRUNE_ALLOW_LOW_KEEP=1`. Chỉ động tới thẻ `prev-<8 hex>` của `tubutree-api` và `tubutree-web`; không bao giờ động tới `:latest`, `:rollback`, thẻ khác, hay cặp image đang gắn `:latest` hoặc đang được một container (chạy hay đã dừng) dùng: cặp đó được giữ thêm, kế hoạch ghi `(đang chạy hoặc gắn :latest, giữ thêm)`. `dep1-prepare.sh` vẫn gọi `--apply` như cũ. Kiểm thử: `bash tools/deploy/test-prune-prev-images.sh`. Lần `--apply` thật đầu tiên trên VPS (2026-11-14 21:50, chủ duyệt): gỡ 12 thẻ (6 cặp cũ nhất, từ `prev-d2fd5f40` đến `prev-8c69755a`), 0 lỗi, giữ `prev-3eb67a6e`, `prev-0efcc543`, `prev-0e42e04e` cùng `:latest` và `:rollback`; đĩa `/` từ 78% xuống 67% (trống 11G lên 16G), `docker system df` ảnh 9,419 GB xuống 3,787 GB; `check-edge --local` 16 OK, 0 FAIL, 4 container healthy trước và sau.

## Cutover apex tubutree.com (chuẩn bị xong, CHƯA chạy)

Kết quả diễn tập, đường dẫn backup, 4 điều kiện còn thiếu và lệnh một chạm: `docs/launch/apex-cutover-rehearsal-2026-11-14.md`.
`bash ops/cutover-apex-apply.sh` chỉ kiểm điều kiện; `--apply` mới cài vhost `ops/vietnix-vhost-apex.conf.cutover` (configtest, graceful, tự quay lại nếu hỏng);
`bash ops/cutover-apex-rollback.sh` gỡ lại trong chưa tới 1 giây. Không script nào đổi DNS, cấp chứng chỉ hay deploy web.

### Bảng kiểm sẵn sàng `ops/pre-cutover-check.sh` (W159, chỉ đọc)

`bash ops/pre-cutover-check.sh` (trên VPS bằng root, để đọc `/etc/letsencrypt` và `/root/.secrets`) in mỗi hạng mục một dòng `[READY]` hoặc `[ACTION_NEEDED]`, thoát 0 khi mọi mục READY, 1 khi còn ACTION_NEEDED. Không cài vhost, không đổi DNS, không cấp hay gia hạn chứng chỉ, không ghi file nào của dự án hay hệ thống (kể cả tệp tạm), không bao giờ in giá trị token Cloudflare hay biến env nào khác của container api. Chỉ dùng `openssl`, `curl` GET (chỉ thêm header `Host`), `docker inspect --format`, `df`, `stat`, `gzip -t`; ngoại lệ duy nhất là `docker run --rm --network none --read-only` khi máy thiếu Node >= 22.18. Hạng mục: `vhost-src` (vhost cutover khai đường dẫn chứng chỉ), `cert-file` (chứng chỉ ở đường dẫn đó phủ `tubutree.com` và `www.tubutree.com`, còn >= 14 ngày, khoá khớp, chuỗi được CA tin cậy qua `openssl verify` nên chứng chỉ tự ký hoặc staging `--test-cert` không qua; `*.tubutree.com` phủ `www` nhưng không phủ apex), `cert-app`/`cert-api` (chứng chỉ đang chạy >= 14 ngày), `dns01-tool` (certbot + plugin dns-cloudflare, hoặc acme.sh + dns_cf), `cf-token` (token Cloudflare có mặt, không rỗng, tệp mode 600), `app-http` và `api-health` (trả đúng 200), `site-url` (sitemap của web ra `https://tubutree.com`, tức `NEXT_PUBLIC_SITE_URL` đúng), `cors-origins` (env `CORS_ORIGINS` của container api có `https://tubutree.com`, nếu không khách ở apex bị 403 khi đăng nhập), `live-redirect` (Next đang chạy trả 301 cho `/post-sitemap1.xml` với `Host: tubutree.com`, tức luật chuyển hướng mới đã deploy; ba mục này là các điều kiện chặn của `docs/launch/apex-cutover-rehearsal-2026-11-14.md`), `disk-free` (trống >= 20%), `pg-backup` (bản mới nhất hợp lệ `gzip -t`, trong 8 giờ), `redirect-rules` (`node scripts/ops/check-cutover-redirects.mjs --offline`, chỉ kiểm bảng luật trong mã nguồn chứ không kiểm bản đang chạy, việc đó là của `live-redirect`: bảng chuyển hướng không có đích ngoài origin, vòng lặp, chuỗi 2 chặng; Node < 22.18 thì chạy trong ảnh của container web, `--network none`, chỉ đọc). Kiểm thử: `bash ops/test-pre-cutover-check.sh`, `node --test scripts/ops/check-cutover-redirects-offline.test.mjs`.

### Cài plugin và xin chứng chỉ DNS-01 `ops/setup-apex-dns01-ssl.sh` (W162)

Gỡ hai mục `dns01-tool` và `cert-file` của bảng kiểm trên. `bash ops/setup-apex-dns01-ssl.sh` (mặc định `--check`, chỉ đọc) báo `certbot`, `plugin` (gói apt `python3-certbot-dns-cloudflare`), `credentials` (`/root/.secrets/cloudflare.ini` mode 600 hoặc 400, có dòng `dns_cloudflare_api_token = <token>` không rỗng) và `cert-file` (`/etc/letsencrypt/live/tubutree.com/fullchain.pem` còn hạn, CA tin cậy). Trình tự trên VPS bằng root:
1. `bash ops/setup-apex-dns01-ssl.sh --install-plugin`: `apt-get install -y python3-certbot-dns-cloudflare` (kèm `certbot` nếu máy chưa có), chạy lại không làm gì. Sau khi cài, script hỏi chính certbot (`certbot plugins --prepare` phải thấy `dns-cloudflare`) để bắt ca gói cài xong mà certbot không nạp được plugin (lệch bản plugin 2.0.0 với certbot 2.9.0). Certbot bản snap thì từ chối và in cách cài plugin snap. VPS Vietnix hiện là Ubuntu 24.04 với `/usr/bin/certbot` 2.9.0 và chưa có plugin (kiểm 2026-11-14); đã có tài khoản ACME cho cả production lẫn staging nên không cần `CERTBOT_EMAIL`.
2. Chủ tạo tệp token (token quyền Zone:DNS:Edit của zone `tubutree.com`, tạo trên Cloudflare): `install -d -m 700 /root/.secrets && umask 077 && printf 'dns_cloudflare_api_token = %s\n' '<token>' > /root/.secrets/cloudflare.ini`.
3. `bash ops/setup-apex-dns01-ssl.sh --staging`: xin thử với `--test-cert` vào lineage riêng `tubutree.com-staging` (thư mục `live/tubutree.com` thật không bao giờ chứa chứng chỉ staging, nên `cutover-apex-apply.sh` không thể lỡ đọc nhầm); dọn bằng `certbot delete --cert-name tubutree.com-staging`.
4. `bash ops/setup-apex-dns01-ssl.sh --issue`: `certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini --dns-cloudflare-propagation-seconds 30 -d tubutree.com -d www.tubutree.com --non-interactive --agree-tos --cert-name tubutree.com --deploy-hook "/www/server/apache/bin/apachectl -t && /www/server/apache/bin/apachectl -k graceful"` (chạy `--staging` trước vì Let's Encrypt giới hạn số lần cấp). Hook nạp lại Apache giống `renew_hook` của lineage `app`/`api` (kiểm 2026-11-14: thư mục `/etc/letsencrypt/renewal-hooks/deploy` và `post` trống nên không có hook toàn cục): thiếu nó thì Apache giữ chứng chỉ cũ sau mỗi lần gia hạn. `--deploy-hook` chạy cả lúc cấp lần đầu (có `apachectl -t` trước, graceful không cắt kết nối) chứ không chỉ lúc gia hạn; script chỉ truyền cờ cho certbot, không tự chạy `apachectl`, và bỏ cờ (có ghi chú) nếu không thấy `apachectl` chạy được (đặt `APACHECTL=` để đổi đường dẫn).

`--staging` và `--issue` đều chạy `ops/pre-cutover-check.sh` ngay sau khi certbot thành công để báo trạng thái mới (mã thoát 1 của bảng kiểm không làm hỏng lần cấp), và dừng trước khi gọi certbot nếu thiếu certbot, plugin, tệp token, mode sai, không phải root hoặc chưa có tài khoản ACME (đặt `CERTBOT_EMAIL`). Không bao giờ đụng vhost Apache/nginx hay `cutover-apex-apply.sh`, và không bao giờ in giá trị token: script không nạp token vào biến, đầu ra của certbot và của bảng kiểm đi qua bộ lọc thay mọi chỗ khớp giá trị bằng `[REDACTED]`, cả dạng thô trong tệp (có ngoặc, có chú thích ` # ...`) lẫn dạng certbot thực dùng sau khi bóc ngoặc và chú thích. Gia hạn: lineage `tubutree.com` tự vào vòng `certbot renew` của `certbot.timer` hiện có (staging cũng vậy cho tới khi `certbot delete`), nên tệp token phải còn nguyên chỗ. Kiểm thử: `bash ops/test-setup-apex-dns01-ssl.sh` (lệnh giả, không cần mạng hay root).
