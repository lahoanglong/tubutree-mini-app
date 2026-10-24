# Ghi chú vận hành: ba lỗ hổng hạ tầng (nhánh pb/ops)

## 1. API chạy bằng user `node`

- `apps/api/Dockerfile` (stage runner) có `USER node`. API không ghi file nào lúc chạy (không có upload cục bộ, log ra stdout, Prisma engine nằm sẵn trong `node_modules`), nên cây `/app` vẫn do root sở hữu.
- pnpm: trước đây corepack cất pnpm trong `~/.cache` của root, user `node` không thấy và sẽ tải lại từ npm mỗi lần `pnpm exec prisma migrate deploy` (hỏng khi mất mạng). Nay `COREPACK_HOME=/opt/corepack`, chown cho `node` lúc build.
- Các lệnh trong `deploy.sh` / runbook chạy dưới `node` đã thử: `node dist/config/check-env.js`, `pnpm exec prisma migrate deploy`, `pnpm run prisma:seed:reference`. Ai dùng `docker compose run --rm -u root` thì chạy root như cũ.
- `docker-compose.vietnix.yml`: api, web, zalo-bridge có `security_opt: ["no-new-privileges:true"]` và `cap_drop: [ALL]` (postgres, redis giữ nguyên). Có hiệu lực khi container được tạo lại ở lần deploy tới.
- Volume `zalo_bridge_data` đã thuộc `node` từ trước, không cần chown lại.

## 2. HSTS cho web

- `ops/vietnix-vhost-app.conf.phase2` (vhost `*:443`): `Header always set Strict-Transport-Security "max-age=31536000"`, bọc `<IfModule mod_headers.c>`. Không includeSubDomains, không preload. Vhost api giữ nguyên (helmet đã gửi). Caddyfile (cho `docker-compose.prod.yml`) có cùng header.
- Áp: dán lại vhost phase2 vào aaPanel, `apachectl configtest`, graceful. Thử: `curl -sI https://app.tubutree.com | grep -i strict-transport`. Cần `mod_headers` bật (aaPanel mặc định có; vhost đã dùng `RequestHeader`, cùng module).
- HSTS không gỡ nhanh được: trình duyệt nhớ 1 năm. Chỉ bật khi chắc HTTPS của app ổn định.

## 3. Backup ngoài máy phải mã hoá

- `tools/backup/backup-db.sh` từ chối đẩy lên remote không phải rclone `crypt`: log `ERROR`, `UPLOAD_FAILED=1`, thoát 3 và ping `/fail` của healthchecks.io (cùng đường với lỗi upload cũ; bản local vẫn giữ). Ngoại lệ: `BACKUP_ALLOW_PLAIN_REMOTE=1`.
- **Hệ quả khi triển khai**: `ops/backup-predeploy.sh` (gọi cùng script) cũng bị từ chối nếu `RCLONE_REMOTE` còn là `gdrive:...`, và deploy dừng ở bước backup. Phải tạo remote crypt và đổi `RCLONE_REMOTE` trong cron lẫn lệnh predeploy TRƯỚC lần deploy tới.
- `docs/launch/deploy-rollback-runbook.md` (mục backup, dòng ~285-288) vẫn ghi `RCLONE_REMOTE=gdrive:tubutree-backups` và lấy bản từ `gdrive:`: lỗi thời, cần sửa theo `tubucrypt:` (file đó ngoài phạm vi nhánh này).
- `pnpm run go-live:check` (`backup.offsite`): WARN khi remote đang dùng không phải crypt (đọc từ `rclone listremotes --long`).

### Tạo remote crypt bọc remote Drive đang có

Cú pháp theo tài liệu rclone; máy dev chưa cài rclone nên CHƯA chạy thử thật. Chạy trên VPS rồi kiểm bằng ba lệnh cuối.

```bash
PASS1=$(openssl rand -base64 32); PASS2=$(openssl rand -base64 32)
rclone config create tubucrypt crypt \
  remote gdrive:tubutree-backups-enc \
  filename_encryption standard directory_name_encryption true \
  password "$(rclone obscure "$PASS1")" password2 "$(rclone obscure "$PASS2")"
echo "$PASS1"; echo "$PASS2"     # chép vào password manager NGAY, rồi: history -c; unset PASS1 PASS2
chmod 600 ~/.config/rclone/rclone.conf
rclone listremotes --long         # phải có dòng: tubucrypt:  crypt
echo test | rclone rcat tubucrypt:thu.txt && rclone cat tubucrypt:thu.txt && rclone delete tubucrypt:thu.txt
RCLONE_REMOTE=tubucrypt: HEALTHCHECK_OPTIONAL=1 COMPOSE_FILE=docker-compose.vietnix.yml ./tools/backup/backup-db.sh
```

Mật khẩu `password` và `password2`: cất trong password manager của chủ (và một bản thứ hai ngoài máy), KHÔNG để trên VPS. `rclone.conf` trên VPS chỉ chứa bản obscure (đảo ngược được), nên chmod 600 và đừng chép đi. **Mất cả hai mật khẩu là mất mọi bản backup ngoài máy, không có cách khôi phục.** Bản `.sql.gz` trần cũ trong `gdrive:tubutree-backups` (kể cả thùng rác Drive) cần xoá sau khi có bản crypt đầu tiên.

### Diễn tập restore từ ngoài máy (làm một lần trước ra mắt, trên máy khác VPS)

```bash
rclone config create tubucrypt crypt remote gdrive:tubutree-backups-enc \
  filename_encryption standard directory_name_encryption true \
  password "$(rclone obscure '<password>')" password2 "$(rclone obscure '<password2>')"
RF=$(rclone lsf tubucrypt: --files-only | sort | tail -1); echo "$RF"
rclone copy "tubucrypt:$RF" /tmp/ && gunzip -t "/tmp/$RF" && echo "giải mã + gunzip OK"
./tools/backup/restore-db.sh "/tmp/$RF"     # trên VPS, theo diễn tập ở tools/backup/README.md
```

`restore-db.sh` nhận file `.sql.gz` trên đĩa nên không cần đổi: `rclone copy tubucrypt:...` đã giải mã khi tải về.

### Chạy test script backup

`cd apps/api && npx jest src/config/deploy-scripts.spec.ts` (dùng `docker` và `rclone` giả trên PATH; ca crypt, drive, `BACKUP_ALLOW_PLAIN_REMOTE=1`, remote lạ). `pnpm test:ci` của CI chạy file này.
