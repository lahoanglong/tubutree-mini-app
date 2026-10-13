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
| `REMOTE_KEEP_DAYS` | `90` | Xoá bản trên remote cũ hơn số ngày này |
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

## Cài crontab (02:00 hằng ngày)

```bash
crontab -e
```

```cron
0 2 * * * COMPOSE_FILE=/opt/tubutree/docker-compose.vietnix.yml RCLONE_REMOTE=r2:tubutree-backups/db HEALTHCHECK_URL=https://hc-ping.com/<uuid> /opt/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1
```

Kiểm tra: `crontab -l | grep backup-db`, sáng hôm sau xem `tail /var/log/tubutree-backup.log` và `rclone ls r2:tubutree-backups/db`.

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

Backup mà chưa restore thử thì coi như không có backup. Diễn tập không đụng DB thật:

```bash
# Nạp bản mới nhất vào DB tạm rồi đếm vài bảng, so với DB thật
F=$(ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1)
DC="docker compose -f docker-compose.vietnix.yml"
$DC exec -T postgres psql -U tubu -d postgres -c 'CREATE DATABASE tubutree_drill'
gunzip -c "$F" | $DC exec -T postgres psql -q -v ON_ERROR_STOP=1 --single-transaction -U tubu -d tubutree_drill > /dev/null
for db in tubutree tubutree_drill; do
  $DC exec -T postgres psql -U tubu -d $db -tAc "SELECT '$db', (SELECT count(*) FROM orders), (SELECT count(*) FROM users), (SELECT count(*) FROM _prisma_migrations)"
done
$DC exec -T postgres psql -U tubu -d postgres -c 'DROP DATABASE tubutree_drill'
```

Đã chạy thử 2026-10-14 trên Postgres 16 với bản sao schema đầy đủ (132 migration, dữ liệu seed): backup → xoá dữ liệu → `restore-db.sh` trả lại đúng số dòng, số migration và 338 index.

## Theo dõi

```bash
tail -f /var/log/tubutree-backup.log
du -sh /var/backups/tubutree/
ls -lht /var/backups/tubutree/ | head -20
rclone ls r2:tubutree-backups/db | tail
```
