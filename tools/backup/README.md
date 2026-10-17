# Backup DB tubutree

Bộ script dump Postgres ra `.sql.gz`, lưu local, đẩy một bản ra ngoài máy (qua `rclone`), dọn bản cũ và báo khi backup lỗi. Restore nạp vào DB tạm rồi mới đổi tên, nên chạy được trên DB đang có dữ liệu và luôn giữ lại DB cũ.

Mặc định cả hai script dùng `docker-compose.vietnix.yml` (VPS Vietnix đang chạy thật). Trên máy dùng `docker-compose.prod.yml` thì đặt `COMPOSE_FILE`.

## Yêu cầu

- Docker + plugin `docker compose` (V2) — script dùng `docker compose exec`, không phải `docker-compose`.
- `gzip`, `find`, `curl` (mặc định có trên mọi Linux distro).
- `rclone` để có bản ngoài máy (bắt buộc cho PROD — bản nằm cùng đĩa với Postgres không cứu được khi đĩa/VPS hỏng).
- Service `postgres` của compose đang chạy.

## Biến môi trường

| Biến | Mặc định | Mô tả |
|---|---|---|
| `POSTGRES_USER` | `tubu` | User DB |
| `POSTGRES_DB` | `tubutree` | Tên DB |
| `COMPOSE_FILE` | `<repo>/docker-compose.vietnix.yml` | Compose của máy đang chạy |
| `BACKUP_DIR` | `/var/backups/tubutree` | Thư mục lưu file `.sql.gz` |
| `BACKUP_KEEP_DAYS` | `30` | Giữ backup local bao nhiêu ngày |
| `RCLONE_REMOTE` | *(trống)* | Đích ngoài máy, ví dụ `r2:tubutree-backups/db`. Đặt mà upload lỗi thì script exit khác 0 |
| `REMOTE_KEEP_DAYS` | `90` | Xoá bản trên remote cũ hơn số ngày này (cron 6 giờ/lần ra ~360 file trong 90 ngày) |
| `BACKUP_LABEL` | *(trống)* | Nhãn gắn vào tên file: `tubutree_<giờ>_<nhãn>.sql.gz` (chỉ chữ và số). Cron dùng `cron`, bản trước deploy dùng `predeploy`. Trống = tên cũ `tubutree_<giờ>.sql.gz` |
| `BACKUP_KEEP_COUNT` | `0` | Giữ N bản mới nhất **cùng nhãn** trên máy, xoá bản cũ hơn. `0` = không xoá theo số bản (chỉ theo `BACKUP_KEEP_DAYS`). Nhãn khác và bản không nhãn không bị đụng |
| `HEALTHCHECK_OPTIONAL` | `0` | `1` = không in WARN khi thiếu `HEALTHCHECK_URL` (dùng cho bản trước deploy) |

Thiếu `RCLONE_REMOTE` hoặc `HEALTHCHECK_URL` thì script vẫn lưu local và thoát 0, nhưng in `WARN` vào log: bản chỉ nằm trên cùng đĩa với Postgres, và cron chết sẽ không ai được báo. Đặt `RCLONE_REMOTE` mà upload lỗi (hoặc chưa cài rclone) thì bản local vẫn giữ, việc dọn bản cũ vẫn chạy, rồi script thoát 3 và ping `/fail`.
| `HEALTHCHECK_URL` | *(trống)* | URL kiểu healthchecks.io: gọi URL khi xong, `URL/fail` khi lỗi. Dịch vụ báo động khi lỗi **hoặc** khi cron không chạy |

## Cài đặt trên VPS Vietnix (`/opt/tubutree`)

```bash
cd /opt/tubutree
chmod +x tools/backup/backup-db.sh tools/backup/restore-db.sh

# Thư mục backup + log
sudo mkdir -p /var/backups/tubutree
sudo touch /var/log/tubutree-backup.log
sudo chown "$USER" /var/backups/tubutree /var/log/tubutree-backup.log

# Bản ngoài máy: cài rclone rồi tạo remote (ví dụ Cloudflare R2, S3, Google Drive).
curl https://rclone.org/install.sh | sudo bash
rclone config                       # tạo remote, ví dụ tên "r2"
rclone mkdir r2:tubutree-backups    # bucket/thư mục đích

# Chạy thử với đúng biến sẽ đặt trong cron
RCLONE_REMOTE=r2:tubutree-backups/db ./tools/backup/backup-db.sh
ls -lh /var/backups/tubutree/ && rclone ls r2:tubutree-backups/db
```

## Cài crontab (6 giờ/lần) và bản trước mỗi deploy

Mất tối đa 6 giờ dữ liệu khi phải khôi phục (trước đây cron 02:00 một lần/ngày là tối đa 24 giờ; sổ Ví, Điểm Xanh và hoa hồng chỉ nằm trong DB này). Mẫu đầy đủ ở [ops/crontab.backup.example](../../ops/crontab.backup.example):

```bash
crontab -l 2>/dev/null | grep -v 'tools/backup/backup-db.sh' > /tmp/cron.new   # bỏ dòng 02:00 cũ nếu có
cat >> /tmp/cron.new <<'CRON'
17 */6 * * * COMPOSE_FILE=/opt/tubutree/docker-compose.vietnix.yml BACKUP_LABEL=cron BACKUP_KEEP_COUNT=120 RCLONE_REMOTE=r2:tubutree-backups/db HEALTHCHECK_URL=https://hc-ping.com/<uuid> /opt/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1
CRON
crontab /tmp/cron.new && crontab -l | grep backup-db | sed -E 's#HEALTHCHECK_URL=[^ ]+#HEALTHCHECK_URL=***#'
```

(Hoặc `crontab -e` rồi dán dòng trên, sửa remote và URL.) Dòng phải nằm trên MỘT dòng và có `RCLONE_REMOTE=` và `HEALTHCHECK_URL=` ngay trong dòng: `pnpm run go-live:check` đọc crontab theo đúng cách đó. Trên healthchecks.io đặt Period 6 giờ, Grace 1 giờ.

Giữ 120 bản `cron` trên máy (30 ngày x 4, bằng mức 30 ngày của cron 02:00 cũ). Chỉ hạ số này khi đã có `RCLONE_REMOTE` chạy thật; chưa có remote thì bản trên máy là bản duy nhất. Bản `predeploy` giữ riêng 10 bản, không bị bản cron đẩy ra. Mọi file vẫn khớp `tubutree_*.sql.gz`, nên `restore-db.sh`, `ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1` trong runbook và `go-live:check` chạy như cũ.

Bản trước mỗi deploy (chạy tay ngay trước deploy, sau khi mã mới đã về máy):

```bash
cd /opt/tubutree && COMPOSE_FILE=docker-compose.vietnix.yml RCLONE_REMOTE=r2:tubutree-backups/db bash ops/backup-predeploy.sh
```

Script này gọi `backup-db.sh` với `BACKUP_LABEL=predeploy BACKUP_KEEP_COUNT=10` và KHÔNG ping `HEALTHCHECK_URL` của cron (ping bất thường sẽ che việc cron ngừng chạy); đặt `PREDEPLOY_HEALTHCHECK_URL` nếu muốn một check riêng. Bước sao lưu lần cuối khi API đã dừng, trong [runbook deploy](../../docs/launch/deploy-rollback-runbook.md) mục 5 bước 6, vẫn dùng `backup-db.sh` trực tiếp như cũ.

Kiểm tra: `crontab -l | grep backup-db`, sau 6 giờ xem `tail /var/log/tubutree-backup.log` (không có dòng `WARN`) và `rclone ls r2:tubutree-backups/db | tail`. Kiểm cả VPS: `bash ops/check-edge.sh --local` (dòng `backup:` báo khi bản mới nhất quá 8 giờ).

## Restore

```bash
./tools/backup/restore-db.sh /var/backups/tubutree/tubutree_YYYYMMDD_HHMMSS.sql.gz
# bản ngoài máy: rclone copy r2:tubutree-backups/db/tubutree_YYYYMMDD_HHMMSS.sql.gz /tmp/ rồi restore file đó
```

Script làm theo thứ tự:

1. `gunzip -t` kiểm file, hỏi `YES`.
2. Tạo DB tạm `<db>_restore_<ts>`, nạp dump trong **một transaction** (`ON_ERROR_STOP`). Lỗi thì xoá DB tạm và dừng; DB thật không bị đụng, api vẫn chạy.
3. Dừng `api`, ngắt kết nối còn lại, đổi tên DB hiện tại thành `<db>_before_restore_<ts>` và DB tạm thành `<db>`.
4. Bật lại `api` (CMD chạy `prisma migrate deploy`, nên backup cũ hơn schema hiện tại sẽ được nâng lên).

DB cũ được giữ lại để quay về nếu bản backup có vấn đề. Kiểm app ổn rồi xoá theo lệnh script in ra cuối cùng. Cần chỗ trống trên đĩa cỡ một DB nữa trong lúc restore.

Không pipe dump thẳng vào DB đang chạy (`gunzip -c ... | psql tubutree`): dump không có `--clean`, nên lỗi ngay ở object đầu tiên (`type ... already exists`).

## Diễn tập restore (BẮT BUỘC trước go-live, sau đó mỗi tháng)

Backup mà chưa restore thử thì coi như không có backup. Diễn tập không đụng DB thật, nên lấy bản về TỪ NGOÀI MÁY (chứng minh bản trên remote nạp được, không chỉ bản local) và bấm giờ: tổng thời gian `time` in ra là thời gian khôi phục thật (RTO), ghi vào ô ở runbook mục 1.2.

```bash
DC="docker compose -f docker-compose.vietnix.yml"
# 1. Bản mới nhất TỪ REMOTE (không dùng remote thì bỏ hai dòng này, bước 2 tự lấy bản local)
RF=$(rclone lsf r2:tubutree-backups/db --files-only | sort | tail -1); echo "$RF"
rclone copy "r2:tubutree-backups/db/$RF" /tmp/ && F=/tmp/$RF
# 2. Nạp vào DB tạm rồi đếm vài bảng, so với DB thật
F=${F:-$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1)}; echo "$F"; gunzip -t "$F" && echo "gunzip OK"
time (
  $DC exec -T postgres psql -U tubu -d postgres -c 'CREATE DATABASE tubutree_drill'
  gunzip -c "$F" | $DC exec -T postgres psql -q -v ON_ERROR_STOP=1 --single-transaction -U tubu -d tubutree_drill > /dev/null
)
for db in tubutree tubutree_drill; do
  $DC exec -T postgres psql -U tubu -d $db -tAc "SELECT '$db', (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM _prisma_migrations)"
done
$DC exec -T postgres psql -U tubu -d postgres -c 'DROP DATABASE tubutree_drill'
rm -f /tmp/$RF
```

Kỳ vọng: `gunzip OK`, hai dòng số khớp (chênh vài đơn nếu bản backup cũ vài giờ). Số liệu thấp hơn hẳn hoặc lệnh `psql` báo lỗi thì bản backup không dùng được: sửa trước khi mở bán.

Đã chạy thử 2026-10-14 trên Postgres 16 với bản sao schema đầy đủ (132 migration, dữ liệu seed): backup → xoá dữ liệu → `restore-db.sh` trả lại đúng số dòng, số migration và 338 index.

## Theo dõi

```bash
tail -f /var/log/tubutree-backup.log
du -sh /var/backups/tubutree/
ls -lht /var/backups/tubutree/ | head -20
rclone ls r2:tubutree-backups/db | tail
```
