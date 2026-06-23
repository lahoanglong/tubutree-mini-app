# Backup DB tubutree

Bộ script tự động dump Postgres ra `.sql.gz`, lưu local + (optional) upload Google Cloud Storage, kèm cleanup.

## Yêu cầu

- Docker + plugin `docker compose` (V2) — script dùng `docker compose exec`, không phải `docker-compose`.
- `gzip`, `find` (mặc định có trên mọi Linux distro).
- **Optional**: `gsutil` (Google Cloud SDK) nếu muốn upload lên GCS.
- Service `postgres` trong `docker-compose.prod.yml` đang chạy.

## Biến môi trường

| Biến | Mặc định | Mô tả |
|---|---|---|
| `POSTGRES_USER` | `tubu` | User DB |
| `POSTGRES_DB` | `tubutree` | Tên DB |
| `BACKUP_DIR` | `/var/backups/tubutree` | Thư mục lưu file `.sql.gz` |
| `BACKUP_KEEP_DAYS` | `30` | Giữ backup local bao nhiêu ngày |
| `GCS_BUCKET` | *(empty)* | Ví dụ `gs://tubutree-backups` — bỏ trống = chỉ lưu local |
| `COMPOSE_FILE` | `<repo>/docker-compose.prod.yml` | Override nếu cần |

## Cài đặt

```bash
# 1. Clone repo lên server (giả sử /opt/tubutree)
cd /opt/tubutree

# 2. Cấp quyền thực thi
chmod +x tools/backup/backup-db.sh tools/backup/restore-db.sh

# 3. Tạo thư mục backup + log
sudo mkdir -p /var/backups/tubutree
sudo touch /var/log/tubutree-backup.log
sudo chown "$USER" /var/backups/tubutree /var/log/tubutree-backup.log

# 4. Test chạy thử
./tools/backup/backup-db.sh
ls -lh /var/backups/tubutree/
```

## Cài crontab

```bash
crontab -e
```

Thêm dòng sau (chạy 2h sáng hằng ngày):

```cron
0 2 * * * /opt/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1
```

Nếu muốn upload GCS, set env trong crontab:

```cron
0 2 * * * GCS_BUCKET=gs://tubutree-backups /opt/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1
```

## Verify restore (BẮT BUỘC test trước go-live)

### Cách nhanh — kiểm tra file dump không bị hỏng

```bash
gunzip -t /var/backups/tubutree/tubutree_YYYYMMDD_HHMMSS.sql.gz && echo "OK"
```

### Cách đầy đủ — restore vào DB

```bash
./tools/backup/restore-db.sh /var/backups/tubutree/tubutree_YYYYMMDD_HHMMSS.sql.gz
```

Hoặc thủ công (1 dòng):

```bash
gunzip -c backup.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U tubu tubutree
```

> **Khuyến nghị**: trước khi go-live, dump 1 lần → drop DB staging → restore → chạy smoke test. Backup mà không test restore thì coi như không có backup.

## Theo dõi

```bash
# Xem log gần nhất
tail -f /var/log/tubutree-backup.log

# Kiểm tra dung lượng folder backup
du -sh /var/backups/tubutree/

# List backup theo thời gian
ls -lht /var/backups/tubutree/ | head -20
```
