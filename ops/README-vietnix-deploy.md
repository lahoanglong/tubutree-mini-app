# Deploy tạm trên VPS Vietnix (chung ChoDeli) — 2026-09-12

Bối cảnh đầy đủ: `docs/2026-09-12-deploy-runbook.md` mục 4.3 và memory `deploy_infra_status_2026_09.md`.

## Đã làm, đã verify

- Clone repo vào `/opt/tubutree` trên VPS (`chodeli-vps` = 14.225.207.177, SSH sẵn trong
  `~/.ssh/config` cục bộ), build + chạy bằng `docker-compose.vietnix.yml` (bản KHÔNG có Caddy —
  cổng 80/443 đã do Apache/aaPanel giữ cho WordPress; api/web chỉ bind `127.0.0.1:14001` /
  `127.0.0.1:14000`, có `mem_limit` từng service để không kéo sập ChoDeli/WordPress).
- Sửa 1 bug hạ tầng thật phát hiện khi build lần đầu: `express` là phantom dependency (chỉ resolve
  được nhờ hoist khi cài full monorepo) → container crash-loop `Cannot find module 'express'`.
  Đã thêm `express` làm dependency trực tiếp của `@tubutree/api` (commit `d80ecf2`).
- Seed xong (44 sản phẩm mẫu, categories, coupon, quiz...). `GET /config/public` và
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
# 1. Backup trước (bản pre-deploy, ngoài bản cron hằng ngày)
COMPOSE_FILE=docker-compose.vietnix.yml bash tools/backup/backup-db.sh
# 2. Đưa mã lên (git bundle / git merge --ff-only)
# 3. Build -> migrate bằng image MỚI -> thay api -> thay web
bash tools/deploy/deploy.sh
# 4. Kiểm sau deploy (bằng image mới)
docker compose -f docker-compose.vietnix.yml run --rm --no-deps api pnpm run go-live:check
```

**Lần deploy đầu (hoặc DB mới): sau bước migrate, chạy thêm
`npx prisma migrate deploy && npm run prisma:seed:reference`** (trên VPS: `docker compose -f
docker-compose.vietnix.yml run --rm --no-deps api pnpm run prisma:seed:reference`, xem bước 7b của
runbook). Migration không nạp chủ đề cộng đồng, quiz, nhiệm vụ, loài cây, hạng thành viên, bậc đại lý
và 28 mẫu thông báo; `prisma:seed` thì bị chặn ở production. Lệnh này chỉ tạo dòng còn thiếu, không ghi
đè chỉnh sửa của admin và không đụng sản phẩm, người dùng, mã giảm giá, tài khoản ngân hàng, nên chạy
lại sau mỗi lần phát hành cũng được. `deploy.sh` chưa gọi nó.

`tools/deploy/deploy.sh` giữ đúng thứ tự: `docker compose run` **không** build lại image, nên
chạy `run --rm api pnpm exec prisma migrate deploy` trước khi build sẽ áp thư mục migrations của
image CŨ ("No pending migrations") và migration mới chỉ chạy trong CMD của container mới, sau khi
container cũ đã bị thay. Script build trước, migrate bằng image mới, migration lỗi thì dừng khi
container cũ vẫn phục vụ. Nhiều instance api cùng lúc (scale, hoặc container cũ/mới chồng nhau) thì
chỉ instance giữ lease trong bảng `cron_leases` chạy @Cron (`src/common/cron-leader`); log có dòng
`Instance <host:pid:id> chạy cron.` ở đúng một instance. Vẫn giữ một instance cho tới khi đo lại
P2028 (pool Prisma) với nhiều instance.

## Backup hằng ngày (bắt buộc trước khi có khách thật)

Cài cron theo `tools/backup/README.md` mục "Cài đặt trên VPS Vietnix" và "Cài crontab":
`COMPOSE_FILE=/opt/tubutree/docker-compose.vietnix.yml`, `RCLONE_REMOTE` trỏ ra ngoài máy
(R2/S3/Drive), `HEALTHCHECK_URL` để được báo khi backup lỗi hoặc cron không chạy. Diễn tập restore
trước go-live và mỗi tháng (cùng README). Bước diễn tập, đo thời gian backup và khôi phục khi deploy
hỏng nằm ở [runbook deploy](../docs/launch/deploy-rollback-runbook.md) mục 1.2 và mục 7.

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
  `df -h /` và `docker system df`.

## Khi có VM/VPS riêng (dọn dẹp về sau)

Quay lại `docker-compose.prod.yml` (có Caddy, không giới hạn RAM) trên máy mới, migrate DNS
sang IP mới, rồi tắt stack trên VPS Vietnix này (`docker compose -f docker-compose.vietnix.yml
down -v`) + xoá 2 file vhost Apache + xoá `/opt/tubutree`.
