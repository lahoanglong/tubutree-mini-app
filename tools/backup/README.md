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
| `RCLONE_REMOTE` | *(trống)* | Đích ngoài máy, ví dụ `tubucrypt:`. PHẢI là remote rclone loại `crypt` (xem "Mã hoá bản ngoài máy"); loại khác thì script không đẩy, in ERROR và exit 3. Đặt mà upload lỗi thì script exit khác 0 |
| `BACKUP_ALLOW_PLAIN_REMOTE` | `0` | `1` = cho đẩy bản KHÔNG mã hoá lên remote không phải crypt. Chỉ dùng khi chủ chấp nhận rủi ro; mặc định cấm vì dump có SĐT, địa chỉ, tài khoản ngân hàng hoàn tiền của khách |
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
# Dump chứa SĐT, địa chỉ, tài khoản ngân hàng của khách: thư mục 700, file 600 (script tự đặt umask 077 cho file nó tạo).
sudo mkdir -p /var/backups/tubutree
sudo touch /var/log/tubutree-backup.log
sudo chown "$USER" /var/backups/tubutree /var/log/tubutree-backup.log
sudo chmod 700 /var/backups/tubutree

# Bản ngoài máy: cài rclone rồi tạo remote. Đã chốt dùng Google Drive (cách tạo remote từng bước ở mục dưới);
# S3 hay Cloudflare R2 vẫn dùng được, chỉ đổi tên remote trong RCLONE_REMOTE.
curl https://rclone.org/install.sh | sudo bash
rclone config                       # tạo remote tên "gdrive" (xem "Remote Google Drive")
rclone mkdir gdrive:tubutree-backups    # thư mục đích

# Chạy thử với đúng biến sẽ đặt trong cron
RCLONE_REMOTE=tubucrypt: ./tools/backup/backup-db.sh
ls -lh /var/backups/tubutree/ && rclone ls tubucrypt:
```

## Remote Google Drive (`gdrive:tubutree-backups`)

Cần một tài khoản Google còn chỗ trống (một bản dump nén vài chục MB, 90 ngày x 4 bản/ngày vẫn là vài GB). Nên dùng tài khoản của công ty, không dùng tài khoản cá nhân của một người.

1. **Trên VPS**: `rclone version` (cài bằng lệnh ở mục trên nếu chưa có). VPS không có trình duyệt nên KHÔNG chọn đăng nhập tự động.
2. **Trên laptop có trình duyệt**: cài rclone cùng bản (`rclone version` hai bên không lệch nhiều), chạy `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="` (chuỗi sau là `{"scope":"drive.file"}` mã hoá base64; bước 3 trên VPS cũng in sẵn đúng lệnh này, nếu khác thì dùng lệnh nó in: chỉ cấp quyền thấy các file do rclone tạo, không đọc được phần còn lại của Drive). Trình duyệt mở ra, đăng nhập tài khoản Google rồi cho phép. Terminal in một khối JSON bắt đầu bằng `{"access_token":...`: chép đúng khối đó.
3. **Trên VPS**: `rclone config` → `n` (new remote) → tên `gdrive` → loại `drive` → để trống `client_id` và `client_secret` (hoặc dán client id riêng nếu bị Google giới hạn tốc độ) → `scope`: chọn `drive.file` → để trống `service_account_file` → `Edit advanced config`: `n` → `Use web browser to automatically authenticate`: **`n`** → khi hỏi `config_token>`, dán khối JSON ở bước 2 → `Configure this as a Shared Drive`: `n` → `y` xác nhận.
4. Dọn bản cũ theo `REMOTE_KEEP_DAYS` mặc định đưa file vào thùng rác của Drive, vẫn chiếm dung lượng tới khi thùng rác tự dọn: chạy `rclone config update gdrive use_trash false` để xoá hẳn.
5. Thử: `rclone mkdir gdrive:tubutree-backups && rclone lsd gdrive:` (thấy thư mục `tubutree-backups`), rồi chạy thử một bản (lệnh ở "Cài đặt" bên trên) và `rclone ls gdrive:tubutree-backups`.
6. Token hết hạn hay bị thu hồi thì upload lỗi, script thoát 3 và healthchecks.io báo: lặp lại bước 2 và 3 (`rclone config reconnect gdrive:` rồi dán token mới).

Biến cho cron: `RCLONE_REMOTE=tubucrypt:`, `REMOTE_KEEP_DAYS=90` (đặt thêm vào dòng cron nếu muốn khác 90; 6 giờ/lần ra khoảng 360 file trong 90 ngày).

## Cài crontab (6 giờ/lần) và bản trước mỗi deploy

Mất tối đa 6 giờ dữ liệu khi phải khôi phục (trước đây cron 02:00 một lần/ngày là tối đa 24 giờ; sổ Ví, Điểm Xanh và hoa hồng chỉ nằm trong DB này). Mẫu đầy đủ ở [ops/crontab.backup.example](../../ops/crontab.backup.example):

```bash
crontab -l 2>/dev/null | grep -v 'tools/backup/backup-db.sh' > /tmp/cron.new   # bỏ dòng 02:00 cũ nếu có
cat >> /tmp/cron.new <<'CRON'
17 */6 * * * COMPOSE_FILE=/opt/tubutree/docker-compose.vietnix.yml BACKUP_LABEL=cron BACKUP_KEEP_COUNT=120 RCLONE_REMOTE=tubucrypt: REMOTE_KEEP_DAYS=90 HEALTHCHECK_URL=https://hc-ping.com/<uuid> /opt/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1
CRON
crontab /tmp/cron.new && crontab -l | grep backup-db | sed -E 's#HEALTHCHECK_URL=[^ ]+#HEALTHCHECK_URL=***#'
```

(Hoặc `crontab -e` rồi dán dòng trên, sửa remote và URL.) Dòng phải nằm trên MỘT dòng và có `RCLONE_REMOTE=` và `HEALTHCHECK_URL=` ngay trong dòng: `pnpm run go-live:check` đọc crontab theo đúng cách đó. Trên healthchecks.io đặt Period 6 giờ, Grace 1 giờ.

Giữ 120 bản `cron` trên máy (30 ngày x 4, bằng mức 30 ngày của cron 02:00 cũ). Chỉ hạ số này khi đã có `RCLONE_REMOTE` chạy thật; chưa có remote thì bản trên máy là bản duy nhất. Bản `predeploy` giữ riêng 10 bản, không bị bản cron đẩy ra. Mọi file vẫn khớp `tubutree_*.sql.gz`, nên `restore-db.sh`, `ls -t /var/backups/tubutree/tubutree_*.sql.gz | head -1` trong runbook và `go-live:check` chạy như cũ.

Bản trước mỗi deploy (chạy tay ngay trước deploy, sau khi mã mới đã về máy):

```bash
cd /opt/tubutree && COMPOSE_FILE=docker-compose.vietnix.yml RCLONE_REMOTE=tubucrypt: bash ops/backup-predeploy.sh
```

Script này gọi `backup-db.sh` với `BACKUP_LABEL=predeploy BACKUP_KEEP_COUNT=10` và KHÔNG ping `HEALTHCHECK_URL` của cron (ping bất thường sẽ che việc cron ngừng chạy); đặt `PREDEPLOY_HEALTHCHECK_URL` nếu muốn một check riêng. Bước sao lưu lần cuối khi API đã dừng, trong [runbook deploy](../../docs/launch/deploy-rollback-runbook.md) mục 5 bước 6, vẫn dùng `backup-db.sh` trực tiếp như cũ.

Kiểm tra: `crontab -l | grep backup-db`, sau 6 giờ xem `tail /var/log/tubutree-backup.log` (không có dòng `WARN`) và `rclone ls tubucrypt: | tail`. Kiểm cả VPS: `bash ops/check-edge.sh --local` (dòng `backup:` báo khi bản mới nhất quá 8 giờ).

## Mã hoá bản ngoài máy (rclone crypt)

`backup-db.sh` chỉ đẩy lên remote loại `crypt` (đọc loại bằng `rclone listremotes --long`). Remote Google Drive trần (`gdrive:`) bị từ chối: log `ERROR: remote 'gdrive' không phải rclone crypt`, không upload, `UPLOAD_FAILED=1` nên script thoát 3 và ping `/fail` của healthchecks.io (bản local vẫn giữ). Remote crypt là lớp mã hoá bọc ngoài Drive: Google chỉ thấy file tên lạ và nội dung mã hoá; `rclone copy tubucrypt: ...` tải về tự giải mã, nên `restore-db.sh` không phải đổi gì (nó nhận file `.sql.gz` đã giải mã trên đĩa).

Tạo remote (chạy MỘT lần trên VPS, sau khi `gdrive` đã chạy được theo mục trên). Cú pháp dưới đây theo tài liệu rclone, CHƯA chạy thử trên máy này vì máy dev chưa cài rclone: kiểm bằng bước "thử" ngay sau đó.

```bash
# Mật khẩu: sinh ngẫu nhiên, CHÉP NGAY vào password manager, đừng gõ tay
PASS1=$(openssl rand -base64 32); PASS2=$(openssl rand -base64 32)
rclone config create tubucrypt crypt \
  remote gdrive:tubutree-backups-enc \
  filename_encryption standard directory_name_encryption true \
  password "$(rclone obscure "$PASS1")" password2 "$(rclone obscure "$PASS2")"
echo "$PASS1"; echo "$PASS2"   # chép vào password manager rồi xoá khỏi lịch sử terminal: history -c
unset PASS1 PASS2
rclone listremotes --long       # dòng "tubucrypt:  crypt"
echo test | rclone rcat tubucrypt:thu.txt && rclone cat tubucrypt:thu.txt && rclone delete tubucrypt:thu.txt
```

Rồi đổi mọi chỗ `RCLONE_REMOTE=gdrive:...` (dòng cron, `ops/backup-predeploy.sh`, runbook) sang `RCLONE_REMOTE=tubucrypt:`. Thư mục `tubutree-backups` cũ trên Drive còn các bản `.sql.gz` chưa mã hoá: tải về nếu cần rồi xoá thủ công (`rclone purge gdrive:tubutree-backups`), kể cả trong thùng rác Drive.

Giữ mật khẩu ở đâu: `password` và `password2` (và cả bản `rclone config show tubucrypt` nếu cần dựng lại) cất trong password manager của chủ, KHÔNG để trên VPS ngoài file `~/.config/rclone/rclone.conf` (đã obscure, không phải mã hoá: ai đọc được file này giải mã được backup, nên `chmod 600` và đừng chép ra ngoài). **Mất cả hai mật khẩu thì mọi bản backup ngoài máy không đọc lại được, không có cách khôi phục.** Cất thêm một bản ở nơi thứ hai (két, người thứ hai tin cậy).

Diễn tập restore từ máy khác (chứng minh mật khẩu trong password manager đủ để đọc backup, không phụ thuộc VPS):

```bash
rclone config create tubucrypt crypt remote gdrive:tubutree-backups-enc \
  filename_encryption standard directory_name_encryption true \
  password "$(rclone obscure '<password>')" password2 "$(rclone obscure '<password2>')"
RF=$(rclone lsf tubucrypt: --files-only | sort | tail -1); echo "$RF"
(umask 077; rclone copy "tubucrypt:$RF" /tmp/) && gunzip -t "/tmp/$RF" && echo "giải mã + gunzip OK"
```

## Restore

```bash
./tools/backup/restore-db.sh /var/backups/tubutree/tubutree_YYYYMMDD_HHMMSS.sql.gz
# bản ngoài máy: (umask 077; rclone copy tubucrypt:tubutree_YYYYMMDD_HHMMSS.sql.gz /tmp/) rồi restore file đó
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
RF=$(rclone lsf tubucrypt: --files-only | sort | tail -1); echo "$RF"
(umask 077; rclone copy "tubucrypt:$RF" /tmp/) && F=/tmp/$RF
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
rclone ls tubucrypt: | tail
```
