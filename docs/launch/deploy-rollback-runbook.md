# Triển khai và quay lại (rollback) trên VPS Vietnix, bản có migration đánh giá nhiều lần

Dành cho chủ shop và người giúp việc gõ lệnh theo từng bước. Không cần biết lập trình: mỗi bước ghi rõ gõ gì, thấy gì thì đúng, thấy gì khác thì DỪNG và gọi người.

Phạm vi: lần phát hành chứa ba migration `20261014213300_r6_admin_orders_recipient_search`, `20261015070000_r8_refill_locations_table`, `20261015150000_r8_multi_reviews_unique_per_order`. Kịch bản thử đơn thật sau khi lên bản mới nằm ở [pilot-order-playbook.md](pilot-order-playbook.md).

## 0. Đọc trước

### 0.1 Vì sao KHÔNG dùng `bash tools/deploy/deploy.sh` cho lần này

`deploy.sh` áp migration trong lúc API cũ vẫn đang chạy. Lần này không được, vì migration `20261015150000` đổi khoá duy nhất của bảng đánh giá, trong khi API cũ vẫn ghi đánh giá theo khoá cũ. Vì vậy lần này làm tay theo thứ tự dưới đây: dừng API cũ, sao lưu, migrate, bật web mới, bật API mới. Các lần phát hành sau mà không có migration kiểu này có thể quay lại dùng `deploy.sh`.

### 0.2 Bốn ràng buộc của tech lead (đã gài vào các bước)

1. Bật API mới TRƯỚC khi phát hành bản Zalo Mini App mới (màn đánh giá của Mini App cần dữ liệu `can-review` mới từ API).
2. DỪNG API cũ TRƯỚC khi chạy `prisma migrate deploy` (migration đổi chỉ mục duy nhất của bảng đánh giá).
3. Web mới lên CÙNG LÚC hoặc TRƯỚC API mới. Tab admin đã mở từ trước deploy phải được tải lại (xem mục 5, bước 12).
4. Migration `20261014213300` khoá bảng `orders` (khoảng 14 giây cho mỗi 300.000 đơn, khoảng 2 giây dưới 50.000 đơn). Cách chọn giờ nằm ở mục 3.

### 0.3 Hạ tầng hiện tại (đọc kỹ)

- Chạy trên VPS Vietnix `14.225.207.177`, chung với ChoDeli và WordPress. Thư mục `/opt/tubutree`, file compose `docker-compose.vietnix.yml`. Chi tiết nền: [ops/README-vietnix-deploy.md](../../ops/README-vietnix-deploy.md).
- **Máy ảo GCP cũ đã đóng.** Ba secret GitHub `VM_HOST`, `VM_USER`, `VM_SSH_KEY` vẫn trỏ vào máy đó. Hệ quả: các workflow `deploy.yml` và `ops.yml` (audit, backup, gin, set-env, crontab, grant-admin) sẽ lỗi ở bước SSH cho tới khi trỏ lại. Mục 2 nói cần trỏ lại những gì. Cho đến lúc đó, mọi việc làm tay qua SSH theo tài liệu này.
- Kể cả khi đã trỏ lại: KHÔNG chạy `deploy.yml` cho lần phát hành này (nó gọi `deploy.sh`, vi phạm ràng buộc 2).

### 0.4 Hai dòng gõ đầu mỗi cửa sổ SSH

Mỗi lần mở cửa sổ SSH mới, gõ lại cả khối này:

```bash
cd /opt/tubutree
export DC="docker compose -f docker-compose.vietnix.yml"
PGUSER=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true); PGUSER=${PGUSER:-tubu}
PGDB=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true); PGDB=${PGDB:-tubutree}
psqlq() { $DC exec -T postgres psql -U "$PGUSER" -d "$PGDB" "$@"; }
```

Từ đây `$DC` thay cho `docker compose -f docker-compose.vietnix.yml`, và `psqlq` mở psql vào đúng DB của Tubu Tree.

### 0.5 Ai làm gì

| Vai | Việc |
|---|---|
| Chủ shop | Quyết định giờ deploy, quyết định rollback, nhận báo kết quả |
| Người gõ lệnh | Gõ từng bước, dán kết quả vào nhóm chat khi gặp điểm DỪNG |
| Tech lead | Gọi khi gặp điểm DỪNG trong mục 6 |
| Người theo dõi màn admin | Mở Quản trị, Sức khoẻ hệ thống suốt lúc deploy và 1 giờ sau |

Điền số điện thoại trước ngày deploy: Chủ shop ____________, Tech lead ____________, Người giữ quyền root VPS ____________.

## 1. Việc phải xong TRƯỚC ngày deploy (T-2 đến T-1)

Tick từng ô. Chưa tick hết thì chưa chọn giờ deploy.

### 1.1 Redis phải là `noeviction`

```bash
$DC exec -T redis redis-cli config get maxmemory-policy
```

Phải thấy dòng thứ hai là `noeviction`. Nếu không: tạo lại container Redis (dữ liệu nằm trong volume, không mất), làm ngoài giờ cao điểm vì API báo lỗi vài giây:

```bash
$DC up -d redis
$DC exec -T redis redis-cli config get maxmemory-policy
$DC exec -T redis redis-cli config get appendonly
```

Kỳ vọng: `noeviction` và `yes`. Vì sao: BullMQ giữ mọi job trong Redis, `allkeys-lru` có thể xoá âm thầm job đang chờ (huỷ vận đơn Gomdon, gửi lại ZNS).

- [ ] Redis `noeviction` và `appendonly yes`

### 1.2 Backup hằng ngày, bản ngoài máy, và diễn tập khôi phục

Làm theo [tools/backup/README.md](../../tools/backup/README.md), các mục "Cài đặt trên VPS Vietnix", "Cài crontab" và "Diễn tập restore". Tóm tắt những gì phải có:

- `rclone config` đã tạo remote (ví dụ tên `r2`), thử được: `rclone lsd r2:`.
- Cron 02:00 có `RCLONE_REMOTE=<remote>:<thư mục>` và `HEALTHCHECK_URL=...`. Kiểm: `crontab -l | grep backup-db | sed -E 's#HEALTHCHECK_URL=[^ ]+#HEALTHCHECK_URL=***#'`.
- Một bản backup chạy tay thành công, và đã **diễn tập khôi phục** vào DB tạm rồi so số dòng:

```bash
COMPOSE_FILE=docker-compose.vietnix.yml POSTGRES_USER=$PGUSER POSTGRES_DB=$PGDB RCLONE_REMOTE=<remote>:<thư mục> ./tools/backup/backup-db.sh
F=$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1); echo "$F"
$DC exec -T postgres psql -U "$PGUSER" -d postgres -c 'CREATE DATABASE tubutree_drill'
gunzip -c "$F" | $DC exec -T postgres psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$PGUSER" -d tubutree_drill > /dev/null
for db in "$PGDB" tubutree_drill; do
  $DC exec -T postgres psql -U "$PGUSER" -d $db -tAc "SELECT '$db', (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM _prisma_migrations)"
done
$DC exec -T postgres psql -U "$PGUSER" -d postgres -c 'DROP DATABASE tubutree_drill'
```

Kỳ vọng: hai dòng số khớp nhau (chênh vài đơn mới nếu đang có khách). Ghi lại thời gian chạy `backup-db.sh` (dùng `time` đứng trước lệnh): cần cho mục 3.

- [ ] Có remote rclone, cron, healthcheck
- [ ] Đã diễn tập khôi phục, số dòng khớp
- [ ] Thời gian một lần backup: ______ phút

### 1.3 Biến môi trường trong `/opt/tubutree/.env`

Mở file bằng `nano .env` (hoặc trỏ lại GitHub Actions ở mục 2 rồi chạy `ops.yml`, hành động `set-env`, cái này chỉ ghi khoá khi secret không rỗng). Đối chiếu với [docs/GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md). Phải có, ngoài các khoá Pancake, Gomdon, Zalo đã có:

| Khoá trong `.env` | Ghi chú |
|---|---|
| `OPS_ALERT_WEBHOOK_URL` | URL webhook Slack, Google Chat hoặc n8n (bắt đầu bằng `https://`) |
| `OPS_ALERT_EMAIL_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Đặt đủ cả bảy hoặc để trống cả bảy. Đặt dở thì API không khởi động |
| `OPS_ALERT_ENV_LABEL` | Ví dụ `production`. Tối đa 24 ký tự, không có `[` `]` |
| `CORS_ORIGINS` | Ví dụ `https://app.tubutree.com,https://tubutree.com` |
| `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN` | `lax` và (nếu cần chia sẻ phiên giữa subdomain) `.tubutree.com` |
| `THROTTLE_BYPASS_TOKEN` | Chuỗi ngẫu nhiên từ 32 ký tự (`openssl rand -hex 32`), CÙNG một giá trị cho `api` và `web` (xem ghi chú dưới) |

Ghi chú về `THROTTLE_BYPASS_TOKEN`: production nên đặt (xem [docs/2026-10-review/impl/PA-2.md](../2026-10-review/impl/PA-2.md)). Web render phía máy chủ gọi API từ một IP, nên không có token thì khi đông các lượt render cùng dính giới hạn 300 yêu cầu/phút cho mỗi route và khách thấy lỗi 429. Token dài dưới 32 ký tự thì API không khởi động. Không thêm tiền tố `NEXT_PUBLIC_` (sẽ lộ ra trình duyệt). `go-live:check` báo WARN khi chưa đặt, FAIL khi quá ngắn. Theo dõi 429 bằng `$DC logs --since 1h web | grep -c 429`.

- [ ] `.env` đủ khoá, `THROTTLE_BYPASS_TOKEN` đã đặt (≥ 32 ký tự, cùng giá trị cho api và web)

### 1.4 Chọn giờ (mục 3) và báo trước

- [ ] Đã chọn giờ theo mục 3 và báo các admin (mẫu tin ở mục 5, bước 12)
- [ ] Bản Zalo Mini App mới đã build sẵn nhưng CHƯA phát hành (ràng buộc 1)
- [ ] Còn trống đĩa: `df -h /` còn ít nhất 3 lần dung lượng bảng orders (migration viết lại mọi dòng): `psqlq -tAc "SELECT pg_size_pretty(pg_total_relation_size('orders'))"`

## 2. Trỏ lại GitHub Actions (máy ảo GCP đã đóng)

Việc của người giữ quyền admin repo GitHub (Settings, Secrets and variables, Actions). Không cần làm trước deploy tay, nhưng phải làm trước khi dùng lại `ops.yml`.

| Loại | Tên | Giá trị cần trỏ lại |
|---|---|---|
| Secret | `VM_HOST` | `14.225.207.177` (VPS Vietnix), KHÔNG phải IP GCP cũ |
| Secret | `VM_USER` | Tài khoản SSH trên VPS Vietnix |
| Secret | `VM_SSH_KEY` | Private key MỚI; public key tương ứng nằm trong `~/.ssh/authorized_keys` của tài khoản đó. Không dùng lại key của máy GCP |
| Variable | `DEPLOY_DIR` | `/opt/tubutree` (mặc định đã đúng) |
| Variable | `COMPOSE_FILE` | `docker-compose.vietnix.yml` (mặc định đã đúng) |

Các biến báo động vận hành (secret trừ khi ghi khác), dùng bởi `ops.yml` hành động `set-env`:

| Loại | Tên |
|---|---|
| Secret | `OPS_ALERT_WEBHOOK_URL` |
| Secret | `OPS_ALERT_EMAIL_TO` |
| Secret | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| **Variable** (không phải secret) | `OPS_ALERT_ENV_LABEL` |

Và cho backup (hành động `crontab`): variable `BACKUP_RCLONE_REMOTE`, secret `BACKUP_HEALTHCHECK_URL`. Cho cấp admin đầu tiên: secret `ADMIN_PHONE`. Các khoá tích hợp (Pancake, Gomdon, Zalo, ZaloPay, Accesstrade) đã liệt kê ở `ops.yml`.

Lưu ý khi dùng lại `ops.yml`: các hành động `backup`, `gin`, `crontab`, `grant-admin` tự chạy `git pull --ff-only origin main` trên máy chủ trước, nên máy chủ phải pull được từ origin và nhánh `main` phải là nhánh đang chạy. Nếu deploy bằng `git bundle` từ nhánh khác thì đừng dùng các hành động đó, làm tay.

## 3. Chọn giờ deploy

### 3.1 Đếm đơn và ước tính thời gian khoá

```bash
psqlq -tAc 'SELECT count(*) FROM orders'
```

Quy tắc ước tính (khớp với `go-live:check`): dưới 50.000 đơn khoảng 2 giây; từ đó trở lên khoảng 14 giây cho mỗi 300.000 đơn (`số đơn × 14 / 300.000`, làm tròn lên). Chính migration viết lại mọi đơn có tên người nhận và dựng chỉ mục tìm kiếm, nên thời gian tỉ lệ với số đơn.

| Số đơn | Khoá `orders` ước tính |
|---|---|
| dưới 50.000 | khoảng 2 giây |
| 300.000 | khoảng 14 giây |
| 600.000 | khoảng 28 giây |
| 1.000.000 | khoảng 47 giây |

Vì API đã dừng lúc migrate (ràng buộc 2) nên khoá này không chặn khách mà chỉ kéo dài thời gian ngừng phục vụ.

### 3.2 Cửa sổ nên xin

```
cửa sổ (phút) = 10 + thời gian backup đo ở mục 1.2 + 5 × (ước tính khoá, tính ra phút), làm tròn lên bội số của 15, tối thiểu 30
```

10 phút là: dừng API 30 giây, bật lại và chờ khoẻ 3 phút, kiểm tra khói 5 đến 7 phút. Hệ số 5 là biên an toàn vì máy dùng chung với ChoDeli nên chậm hơn lúc đo. Ví dụ 200.000 đơn, backup 2 phút: 10 + 2 + 5 × 0,1 = 12,5, nên xin 30 phút.

### 3.3 Chọn giờ vắng nhất

Đếm đơn theo giờ trong ngày (giờ Việt Nam) trong 14 ngày qua, chọn giờ có ít đơn nhất:

```bash
psqlq -c "SELECT extract(hour FROM \"createdAt\" AT TIME ZONE 'Asia/Ho_Chi_Minh') AS gio, count(*) FROM orders WHERE \"createdAt\" > now() - interval '14 days' GROUP BY 1 ORDER BY 2, 1"
```

Tránh: giờ có flash sale hoặc chiến dịch, và lúc có đơn thu gom Gomdon đang chạy. Webhook của Gomdon chỉ thử lại 3 lần cách nhau 30 giây (xem [docs/integrations/gomdon.md](../integrations/gomdon.md)); sự kiện nào đến lúc API đang dừng quá lâu sẽ mất. Webhook Pancake và các cron đối soát (đẩy đơn mỗi 15 phút, sự kiện mỗi 10 phút) sẽ bù lại sau khi API chạy lại.

## 4. Bảng điểm dừng (đọc trước khi bắt đầu)

| Nếu thấy | Làm | Gọi |
|---|---|---|
| `check-env` hoặc `go-live:check` báo FAIL (trừ các WARN đã nêu ở bước 4) trước khi dừng API | DỪNG, chưa dừng API. Sửa `.env` rồi chạy lại | Tech lead nếu không tự sửa được |
| Backup lỗi, file `.sql.gz` không qua `gunzip -t`, hoặc nhỏ bất thường so với bản hôm qua | DỪNG. Không migrate khi chưa có bản backup tốt | Tech lead |
| Migrate báo lỗi (bất kỳ dòng `Error`) hoặc chạy quá 5 lần ước tính | DỪNG. Làm mục 7.1. Không bật API | Tech lead, Chủ shop |
| `_prisma_migrations` có dòng `finished_at IS NULL` | DỪNG. Làm mục 7.1 | Tech lead |
| API mới không `healthy` sau 5 phút | Xem log, quyết định trong 15 phút: quay lại theo mục 7 | Chủ shop quyết, Tech lead |
| Smoke test (bước 11) có mục FAIL | Quay lại theo mục 7, hoặc sửa tiến nếu chỉ là lỗi giao diện và schema ổn | Chủ shop, Tech lead |
| `go-live:check` sau deploy có FAIL | Không mở bán, không phát hành Mini App. Sửa rồi chạy lại | Tech lead |
| Email báo "Cần xử lý" ồ ạt hoặc màn Sức khoẻ hệ thống đỏ trong 1 giờ đầu | Làm theo hướng dẫn từng dòng; nếu không giải thích được trong 15 phút, quay lại | Tech lead, Chủ shop |

## 5. Trình tự deploy (ngày D)

Ghi giờ bắt đầu từng bước vào cột bên phải của bản in hoặc nhóm chat.

### Bước 1. Lấy mã mới về máy chủ

```bash
git fetch origin            # nếu máy chủ pull được từ origin
git status --short          # phải trống
git merge --ff-only <SHA đã chốt>
git log -1 --format='%h %s'
```

Nếu máy chủ không pull được từ origin, dùng `git bundle`: trên máy dev `git bundle create /tmp/tubutree.bundle <nhánh>`, chép lên máy chủ bằng `scp`, rồi trên máy chủ `git fetch /tmp/tubutree.bundle <nhánh>` và `git merge --ff-only FETCH_HEAD`.

Kỳ vọng: `git log -1` in đúng mã SHA đã chốt. Nếu `git status` không trống hoặc `--ff-only` từ chối: DỪNG, gọi Tech lead.

### Bước 2. Ghi lại image đang chạy và giữ một bản để quay lại

Làm TRƯỚC khi build, vì build sẽ đổi tên image sang bản mới.

```bash
API_ID=$(docker inspect -f '{{.Image}}' "$($DC ps -q api)"); API_NAME=$(docker inspect -f '{{.Config.Image}}' "$($DC ps -q api)")
WEB_ID=$(docker inspect -f '{{.Image}}' "$($DC ps -q web)"); WEB_NAME=$(docker inspect -f '{{.Config.Image}}' "$($DC ps -q web)")
printf 'API_ID=%s\nAPI_NAME=%s\nWEB_ID=%s\nWEB_NAME=%s\n' "$API_ID" "$API_NAME" "$WEB_ID" "$WEB_NAME" | tee .rollback-images
docker tag "$API_ID" "${API_NAME%%:*}:rollback"
docker tag "$WEB_ID" "${WEB_NAME%%:*}:rollback"
docker images | grep -E 'rollback'
```

Kỳ vọng: bốn dòng `API_ID=sha256:...`, và hai dòng image có thẻ `rollback`. Thẻ này giữ cho `docker image prune` không xoá mất image cũ. Nếu `$DC ps -q api` trống (API không chạy) thì DỪNG: không có gì để quay lại, báo Tech lead.

### Bước 3. Build image mới (container cũ vẫn phục vụ khách)

```bash
$DC build api web
```

Mất vài phút và ăn RAM máy chủ dùng chung; nên chạy ngoài cửa sổ deploy, vào buổi tối hôm trước, rồi chỉ chạy lại ở ngày D (nhanh nhờ cache). Container đang chạy không bị đổi cho tới bước 6.

### Bước 4. Kiểm cấu hình và go-live check bằng image MỚI (API cũ vẫn chạy)

```bash
$DC run --rm --no-deps api node dist/config/check-env.js
$DC run --rm --no-deps -v /var/backups/tubutree:/var/backups/tubutree:ro api pnpm run go-live:check -- --phase=pre-deploy
```

(`npm run go-live:check -- --phase=pre-deploy` cũng chạy được; lệnh `go-live:check` nằm trong `apps/api/package.json`.)

Kỳ vọng:
- `check-env` in `Cấu hình môi trường hợp lệ.` và thoát 0.
- `go-live:check` thoát 0 (không FAIL). Các dòng WARN được phép ở bước này: `db.migrations_pending` và `db.required_migrations` ("sẽ được áp khi deploy"), `db.orders_lock` (nếu từ 50.000 đơn), và các dòng backup `không kiểm được` (xem ghi chú). Mọi WARN khác phải đọc và chốt "chấp nhận" hoặc sửa trước.
- Dòng `db.migrations_pending` liệt kê tên các migration sắp áp: phải có ba migration của đợt này. Ghi lại số lượng: ______.
- Dòng `db.orders_lock` cho số đơn và ước tính. Đối chiếu với mục 3.

Ghi chú về các dòng backup: lệnh này chạy BÊN TRONG container nên không nhìn thấy crontab và rclone của máy chủ (kết quả là WARN "không kiểm được", không phải FAIL). Gắn thêm `-v ...:ro` như trên cho dòng `backup.recent` (tuổi bản backup gần nhất) kiểm được. Hai việc còn lại kiểm tay trên máy chủ:

```bash
crontab -l | grep backup-db | sed -E 's#HEALTHCHECK_URL=[^ ]+#HEALTHCHECK_URL=***#'
rclone listremotes
```

Phải thấy dòng cron có `RCLONE_REMOTE=` khác rỗng và tên remote có trong `rclone listremotes`.

Nếu `go-live:check` báo `env.throttle_bypass` WARN (chưa đặt) hoặc FAIL (ngắn hơn 32 ký tự): đặt `THROTTLE_BYPASS_TOKEN` đủ dài, cùng giá trị cho api và web (xem mục 1.3).

### Bước 5. Bắt đầu cửa sổ: dừng API cũ

Báo vào nhóm: "Bắt đầu bảo trì lúc HH:MM". Rồi:

```bash
date '+%H:%M:%S'
$DC stop api
$DC ps
```

Kỳ vọng: `api` ở trạng thái `exited` (dừng êm trong tối đa 30 giây nhờ `stop_grace_period`). `web` vẫn chạy nhưng sẽ báo lỗi vì không gọi được API: đó là trạng thái bảo trì bình thường. Từ giờ phút này khách không đặt hàng được.

### Bước 6. Sao lưu lần cuối và đếm số dòng (điểm quay lại)

Làm SAU khi API đã dừng, để bản này chứa mọi dữ liệu và không còn ai ghi vào DB:

```bash
COMPOSE_FILE=docker-compose.vietnix.yml POSTGRES_USER=$PGUSER POSTGRES_DB=$PGDB RCLONE_REMOTE=<remote>:<thư mục> ./tools/backup/backup-db.sh
ROLLBACK_DUMP=$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1)
echo "$ROLLBACK_DUMP" | tee .rollback-dump
ls -lh "$ROLLBACK_DUMP" && gunzip -t "$ROLLBACK_DUMP" && echo "gunzip OK"
psqlq -tAc "SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM reviews), (SELECT count(*) FROM bottle_returns), (SELECT count(*) FROM _prisma_migrations)"
```

Kỳ vọng: backup in `OK`, `gunzip OK`, dung lượng cùng cỡ bản hôm qua. Ghi bộ 5 số đếm: orders ______ users ______ reviews ______ bottle_returns ______ migrations ______. Điểm dừng: lỗi hoặc file quá nhỏ.

### Bước 7. Migrate bằng image MỚI

```bash
date '+%H:%M:%S'
time $DC run --rm --no-deps api pnpm exec prisma migrate deploy
date '+%H:%M:%S'
```

Kỳ vọng: liệt kê các migration "Applying migration `...`" gồm ba migration của đợt, kết thúc bằng `All migrations have been successfully applied.` Thời gian khớp ước tính ở mục 3 (cho phép gấp vài lần vì máy dùng chung). Điểm dừng: bất kỳ lỗi nào (mục 7.1).

Xác minh sau migrate:

```bash
psqlq -c "SELECT migration_name, finished_at IS NOT NULL AS xong FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 4"
psqlq -c "SELECT count(*) AS dang_do FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL"
psqlq -c "SELECT indexname FROM pg_indexes WHERE tablename='reviews' AND indexname LIKE 'reviews_userId_productId%'"
psqlq -c "SELECT count(*) AS diem_nhan_vo FROM refill_pickup_locations"
psqlq -c "SELECT count(*) AS thieu_tim_kiem FROM orders WHERE COALESCE(\"shippingAddress\" ->> 'recipient','') <> '' AND \"recipientSearch\" = ''"
```

Kỳ vọng: bốn migration mới nhất đều `xong = t`; `dang_do = 0`; chỉ còn đúng một chỉ mục `reviews_userId_productId_orderId_key` (chỉ mục cũ `reviews_userId_productId_key` đã mất); `diem_nhan_vo` bằng 0 hoặc 1 (1 nếu trước đó đã có địa chỉ `refill.pickup_address`); `thieu_tim_kiem = 0`.

### Bước 8. Bật web mới

```bash
$DC up -d --no-build --no-deps web
```

`--no-deps` bắt buộc: nếu không, compose chờ API (đang dừng) khoẻ rồi mới bật web. Web bật trước API là chủ ý (ràng buộc 3). Chưa cần chờ web khoẻ vì nó cần API để render.

### Bước 9. Bật API mới và chờ khoẻ

```bash
$DC up -d --no-build api
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$($DC ps -q api)" 2>/dev/null || echo unknown)
  echo "$(date +%H:%M:%S) api=$s"; [ "$s" = healthy ] && break; sleep 3
done
curl -s http://127.0.0.1:14001/api/health; echo
```

Kỳ vọng: `api=healthy` trong vòng 3 phút (3 giây một lần, tối đa 180 giây); `/api/health` trả `{"status":"ok","db":"up","redis":"up",...}`. Điểm dừng: chưa healthy sau 5 phút, xem `$DC logs --tail 100 api`.

Container API khởi động bằng lệnh `prisma migrate deploy && node dist/main.js`, nên lúc này nó in "No pending migrations" (đã áp ở bước 7): đúng.

```bash
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' "$($DC ps -q web)" 2>/dev/null || echo unknown); echo "$(date +%H:%M:%S) web=$s"; [ "$s" = healthy ] && break; sleep 3; done
date '+%H:%M:%S'
```

Ghi giờ kết thúc: khách đã đặt hàng được lại từ lúc này. Tổng thời gian ngừng phục vụ: từ bước 5 đến đây: ______ phút.

### Bước 10. Go-live check sau deploy

```bash
$DC run --rm --no-deps -v /var/backups/tubutree:/var/backups/tubutree:ro api pnpm run go-live:check
```

Kỳ vọng: thoát 0, không FAIL. Các dòng migration phải PASS (giai đoạn mặc định là `post-deploy`: migration thiếu là FAIL). Dán kết quả vào nhóm chat.

### Bước 11. Kiểm tra khói (smoke test)

Người gõ lệnh làm phần máy; người theo dõi màn admin làm phần giao diện. Tick từng dòng.

Máy (chạy từ máy bất kỳ có internet):

```bash
curl -s https://api.tubutree.com/api/health; echo
curl -s -o /dev/null -w 'config/public %{http_code}\n' https://api.tubutree.com/api/config/public
curl -s -o /dev/null -w 'web %{http_code}\n' https://app.tubutree.com/
curl -s -o /dev/null -w 'pancake-webhook-khong-token %{http_code}\n' -X POST https://api.tubutree.com/api/webhooks/pancake
curl -s -o /dev/null -w 'gomdon-webhook-khong-token %{http_code}\n' -X POST https://api.tubutree.com/api/webhooks/gomdon
$DC exec -T redis redis-cli config get maxmemory-policy
$DC logs --since 10m api | grep -iE 'chạy cron|error' | head
```

Kỳ vọng: `health` có `"db":"up","redis":"up"`; `config/public` 200; `web` 200; hai webhook không kèm token đều trả **401** (chứng tỏ đường vào tồn tại và từ chối người lạ; không gửi dữ liệu thật); Redis `noeviction`; log có đúng một dòng `Instance ... chạy cron.` và không có `error` lặp.

Giao diện:

- [ ] Quản trị, Sức khoẻ hệ thống: không có dòng đỏ; bấm "Gửi email thử" (nếu đã cấu hình SMTP): email tới hộp thư báo động trong vài phút.
- [ ] Quản trị, Đơn hàng: ô tìm kiếm gõ tên người nhận (có dấu và không dấu) ra kết quả (migration `recipientSearch`).
- [ ] Quản trị, Đổi vỏ chai, Điểm nhận vỏ: danh sách mở được, thấy các điểm đã có.
- [ ] Quản trị, Duyệt SP đối tác: mở được; mở một sản phẩm chờ duyệt thấy hộp Pancake. KHÔNG bấm duyệt thật ở bước này.
- [ ] Web khách (đăng nhập bằng tài khoản thử): trang một sản phẩm đã mua hiện khối đánh giá (API trả dữ liệu `can-review` mới với `reviewableOrders` và `myReviews`).
- [ ] Đăng nhập Zalo trên web hoạt động (xem [pilot-order-playbook.md](pilot-order-playbook.md) mục 1).

### Bước 12. Báo admin tải lại tab

Gửi tin cho mọi admin và nhân viên CSKH đang có tab Quản trị mở từ trước giờ deploy:

> Hệ thống vừa cập nhật. Anh/chị vui lòng đóng tab Quản trị đang mở và mở lại (hoặc tải lại cứng: Ctrl+Shift+R trên Windows, Cmd+Shift+R trên Mac) trước khi duyệt sản phẩm đối tác. Tab cũ gửi dữ liệu duyệt theo kiểu cũ nên có thể duyệt sai mã Pancake.

Lý do: dòng không có mã Pancake, web mới gửi `''` (chuỗi rỗng), còn tab cũ gửi `null`. API mới hiểu `null` là "không nói gì" và duyệt theo mã đang lưu, nên một quyết định "không có mã" của admin có thể bị bỏ qua.

### Bước 13. Theo dõi 30 đến 60 phút rồi mới phát hành Zalo Mini App

Ràng buộc 1: chỉ phát hành Mini App mới SAU khi API mới đã ổn. Trong 30 đến 60 phút: màn Sức khoẻ hệ thống không đỏ, không email báo động lạ, `$DC logs --since 30m api | grep -ci error` thấp. Chỉ khi đó mới phát hành Mini App mới: lên kênh test (`zmp deploy -t -e` ở `apps/miniapp`), quét QR kiểm trên Zalo thật, rồi mới nộp bản production. Cách làm nằm ở [DEPLOY_ZALO.md](../../DEPLOY_ZALO.md) và mục 7 của [docs/2026-10-review/99-release-readiness.md](../2026-10-review/99-release-readiness.md).

Vì sao chờ: nếu phải quay API về bản cũ sau khi Mini App mới đã ra, màn đánh giá của Mini App mới sẽ hỏng. Chờ cho tới khi gần như không còn khả năng phải quay lại.

### Bước 14. Theo dõi 24 giờ

- [ ] Sáng hôm sau: `tail /var/log/tubutree-backup.log` thấy backup 02:00 thành công, `rclone ls <remote>:<thư mục> | tail -3` thấy file mới, healthcheck xanh.
- [ ] Chạy lại `go-live:check` (không kèm `--phase`).
- [ ] Màn Sức khoẻ hệ thống: không còn dòng đỏ tồn quá 1 giờ.
- [ ] Làm [pilot-order-playbook.md](pilot-order-playbook.md) (đơn thử thật) trước khi mở bán rộng.

## 6. Gọi ai và khi nào

| Tình huống | Gọi | Mong đợi họ làm |
|---|---|---|
| Mọi điểm dừng ở mục 4 | Tech lead | Chẩn đoán, quyết định sửa tiến hay quay lại |
| Cần quyết định quay lại | Chủ shop | Chốt "quay lại" hoặc "sửa tiến"; chịu trách nhiệm báo khách nếu cần |
| Không đăng nhập được VPS, hết đĩa, Docker lỗi | Người giữ quyền root VPS | Xử lý hạ tầng chung với ChoDeli |
| Có khách phản ánh lỗi hàng loạt sau deploy | Chủ shop rồi Tech lead | Đọc log, quyết định |

Không tự ý chạy các lệnh trong mục 7 khi chưa có Chủ shop đồng ý, trừ 7.1 (migrate lỗi, chưa bật API: không ảnh hưởng khách vì API đang dừng).

## 7. Quay lại (rollback)

### 7.0 Chọn đường nào

| Tình huống | Đường | Mất dữ liệu? |
|---|---|---|
| Migrate lỗi (chưa bật API) | 7.1 | Không |
| Migrate xong, API/web mới lỗi, API mới CHƯA nhận khách (vài phút đầu) và không có đánh giá trùng | 7.2 (chỉ quay image) | Không |
| Quay image nhưng đã có khách ghi đánh giá lần hai cho cùng một sản phẩm | 7.3 (khôi phục bản backup) hoặc gộp tay đánh giá rồi 7.2 | 7.3 mất dữ liệu sau điểm backup |
| Hỏng nặng, không rõ nguyên nhân, cần về đúng trạng thái trước deploy | 7.3 | Mất mọi thứ ghi sau bước 6 |
| Chỉ lỗi giao diện hoặc lỗi nhỏ, schema ổn | KHÔNG quay lại: sửa tiến bằng hotfix, deploy lại theo mục 5 (bỏ bước migrate nếu không có migration mới) | Không |

**Điều cần hiểu trước:** migration `20261015150000` (đánh giá nhiều lần) là **một chiều (forward-only)**. Sau khi áp, một khách có thể có nhiều đánh giá cho cùng một sản phẩm (mỗi lần mua một đánh giá). Chỉ mục cũ (một đánh giá cho mỗi khách và sản phẩm) không thể dựng lại nếu đã có đánh giá trùng. Vì vậy quay schema về bản cũ chỉ làm được bằng một trong hai cách: (a) khôi phục bản backup trước deploy (7.3), hoặc (b) gộp các đánh giá trùng trước rồi dựng lại chỉ mục cũ (7.2). Các migration `20261014213300` (cột tìm kiếm người nhận + trigger) và `20261015070000` (bảng điểm nhận vỏ + cột `pickupLocationId` cho phép rỗng) chỉ THÊM, bản code cũ bỏ qua chúng nên không cần hoàn tác.

### 7.1 Migrate lỗi giữa chừng (API vẫn đang dừng)

1. Xem tình trạng:

```bash
psqlq -c "SELECT migration_name, started_at, finished_at, rolled_back_at, left(logs, 300) AS log FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL"
```

2. Mỗi migration chạy trong một giao dịch, nên migration lỗi không để lại thay đổi dở dang trong schema (vẫn nên xác nhận bằng các truy vấn xác minh ở bước 7). Không còn dòng nào ở trên thì migrate đã dừng sạch giữa các migration: sửa nguyên nhân (hết đĩa, lock bị giữ, v.v.) rồi chạy lại bước 7.
3. Còn dòng dở thì đánh dấu đã hoàn tác rồi chạy lại: `$DC run --rm --no-deps api pnpm exec prisma migrate resolve --rolled-back <tên migration>`, sau đó bước 7. Làm cùng Tech lead.
4. Không sửa được trong 15 phút, hoặc không chắc schema còn nguyên: 7.3 (khôi phục backup) rồi bật lại API cũ (xem 7.3).
5. Muốn trả dịch vụ ngay khi chưa migrate được (migration chưa áp, schema còn nguyên bản cũ): chỉ cần bật lại API cũ, không cần dựng chỉ mục. Container API cũ vẫn còn nguyên (mới `stop`), nên `$DC start api` là đủ, miễn là CHƯA chạy `up -d` thay container ở bước 8 và 9.

### 7.2 Chỉ quay image (giữ DB đã migrate, giữ dữ liệu phát sinh)

Điều kiện BẮT BUỘC (nếu không thoả, sang 7.3):

```bash
psqlq -c "SELECT \"userId\", \"productId\", count(*) FROM reviews GROUP BY 1,2 HAVING count(*) > 1"
```

Phải ra **0 dòng**. Nếu có dòng: DỪNG. Hoặc khôi phục backup (7.3), hoặc Chủ shop và Tech lead chọn đánh giá nào giữ (xoá hoặc gộp các đánh giá còn lại) rồi chạy lại truy vấn cho tới khi ra 0 dòng.

Các bước:

```bash
. ./.rollback-images
$DC stop web api
docker tag "${API_NAME%%:*}:rollback" "$API_NAME"
docker tag "${WEB_NAME%%:*}:rollback" "$WEB_NAME"
psqlq -c 'CREATE UNIQUE INDEX "reviews_userId_productId_key" ON "reviews"("userId", "productId")'
$DC up -d --no-build --no-deps api
$DC up -d --no-build --no-deps web
docker inspect -f '{{.Image}}' "$($DC ps -q api)"; echo "mong đợi: $API_ID"
```

Giải thích: dựng lại chỉ mục cũ để code cũ chạy đúng ràng buộc của nó. Chỉ mục mới `reviews_userId_productId_orderId_key` cứ để đó (vô hại với code cũ). Hai id in ra phải giống nhau: chứng tỏ container API đang chạy đúng image cũ. Image cũ chạy `prisma migrate deploy` trên DB đã có thêm ba migration mới sẽ báo "No pending migrations to apply" và không kẹt (đã thử cục bộ: thư mục migration bản cũ chạy với DB đã migrate đủ, kết quả đúng như vậy; mục 8 của `99-release-readiness.md` ghi nhận cùng hành vi cho lần phát hành trước).

Sau khi quay image: màn Quản trị, Sức khoẻ hệ thống và `curl .../api/health` phải ổn. Dữ liệu phát sinh sau deploy được giữ nguyên.

**Khi sau này phát hành lại bản mới (sau 7.2) phải gỡ chỉ mục cũ**, nếu không tính năng đánh giá nhiều lần sẽ bị chặn âm thầm (migration đã ghi là áp rồi nên sẽ không chạy lại):

```bash
psqlq -c 'DROP INDEX "reviews_userId_productId_key"'
```

### 7.3 Khôi phục bản backup trước deploy (về đúng trạng thái trước bước 7)

MẤT mọi dữ liệu ghi sau bước 6 (đơn, thanh toán, đánh giá, đăng ký mới...). Chỉ làm khi Chủ shop đồng ý bằng lời trong nhóm chat.

Thứ tự quan trọng: phải đưa container về image CŨ trước, vì `restore-db.sh` bật lại API bằng `docker compose start api` (khởi động lại đúng container hiện có). Nếu container đó đang là bản mới, API mới sẽ bật lên trên DB cũ và `prisma migrate deploy` áp lại ba migration.

```bash
. ./.rollback-images
ROLLBACK_DUMP=$(cat .rollback-dump); echo "$ROLLBACK_DUMP"; gunzip -t "$ROLLBACK_DUMP" && echo OK
$DC stop web api
docker tag "${API_NAME%%:*}:rollback" "$API_NAME"
docker tag "${WEB_NAME%%:*}:rollback" "$WEB_NAME"
$DC up --no-start --no-build --no-deps api web
docker inspect -f '{{.Image}}' "$($DC ps -aq api)"; echo "mong đợi: $API_ID"
COMPOSE_FILE=docker-compose.vietnix.yml POSTGRES_USER=$PGUSER POSTGRES_DB=$PGDB ./tools/backup/restore-db.sh "$ROLLBACK_DUMP"
```

`restore-db.sh` hỏi, gõ `YES`. Script nạp bản backup vào DB tạm, đổi tên, bật API cũ (đã là container image cũ). DB hỏng được giữ lại với tên `<db>_before_restore_<giờ>` để đối chiếu. Rồi:

```bash
$DC start web
psqlq -tAc "SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM reviews), (SELECT count(*) FROM bottle_returns), (SELECT count(*) FROM _prisma_migrations)"
curl -s http://127.0.0.1:14001/api/health; echo
```

Kỳ vọng: bộ 5 số khớp bộ ghi ở bước 6 (migrations là số cũ, không có ba migration mới), `health` ổn.

Việc sau khôi phục:

1. Đối chiếu các đơn phát sinh giữa bước 6 và lúc khôi phục (không có nếu quay lại ngay sau migrate, vì API dừng từ bước 5): so với Pancake POS và sao kê ngân hàng; đơn nào có tiền mà không có trong DB thì tạo lại hoặc hoàn tiền.
2. Hàng đợi Redis còn job cũ tham chiếu đơn không còn: xem Sức khoẻ hệ thống, các dòng `queue.<tên>`; xử lý hoặc xoá job lỗi sau khi đối chiếu.
3. DB `<db>_before_restore_...` chỉ xoá khi Tech lead đồng ý (lệnh `DROP DATABASE` nằm cuối đầu ra của `restore-db.sh`).
4. Nếu Mini App mới đã được phát hành trước đó: màn đánh giá của nó sẽ không khớp API cũ. Báo Tech lead và Chủ shop để quyết định cách gỡ Mini App mới hay chấp nhận tạm thời. (Đó là lý do chờ ở bước 13.)

### 7.4 Chỉ web có vấn đề

Web không có schema riêng: quay web một mình bằng `docker tag "${WEB_NAME%%:*}:rollback" "$WEB_NAME" && $DC up -d --no-build --no-deps web`. Lưu ý cặp web cũ với API mới: tab admin cũ sẽ gửi `null` cho mã Pancake rỗng (xem bước 12), nên chỉ làm tạm.

## 8. Tham chiếu

- [ops/README-vietnix-deploy.md](../../ops/README-vietnix-deploy.md): nền tảng VPS, DNS, chứng chỉ, Redis và log.
- [tools/backup/README.md](../../tools/backup/README.md): backup, restore, diễn tập.
- [docs/GO-LIVE-KEYS.md](../GO-LIVE-KEYS.md): khoá và kênh báo động.
- [docs/2026-10-review/99-release-readiness.md](../2026-10-review/99-release-readiness.md): lần phát hành trước, kể cả đo thời gian migration.
- [pilot-order-playbook.md](pilot-order-playbook.md): kịch bản đơn thử thật sau khi lên bản mới.
- Lệnh kiểm tra: `pnpm run go-live:check` (trong `apps/api`), mã nguồn ở `apps/api/scripts/go-live-check.ts` và `apps/api/src/config/go-live/`.
