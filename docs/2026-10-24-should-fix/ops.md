# Ghi chú vận hành: gói ops 2026-10-24

## 1. deploy.sh và zalo-bridge
- Bridge chỉ được xử lý khi compose có service `zalo-bridge` VÀ (`.env` có `ZALO_BRIDGE_SECRET` hoặc bridge đang chạy). Ngược lại deploy.sh ghi một dòng "Bỏ qua zalo-bridge" và đi tiếp (chat Zalo cá nhân dự kiến TẮT lúc go-live; thiếu khoá thì bridge restart-loop).
- Api và web build + thay trước. Bridge build riêng và thay sau cùng. Bridge lỗi (build, up hoặc không healthy) thì thoát mã 4: api và web đã chạy bản mới, chỉ chat tạm ngưng. Mã 3 vẫn là api/web không healthy.
- Biết và chấp nhận: tạo lại bridge có thể làm một tin đang chuyển tiếp bị gửi hai lần.

## 2. Backup trước mọi migration đang chờ
- Sau bước kiểm .env, deploy.sh chạy `prisma migrate status` bằng image mới và in kết quả vào log. Không nối được DB (P1000-P1002, "Can't reach database server") thì dừng mã 2, chưa backup, chưa migrate. Thoát khác 0 vì lý do khác (còn migration chờ, lệch, lỗi) thì chạy `ops/backup-predeploy.sh` ngay trước `migrate deploy`.
- Giữ nguyên nhánh points_1d: dừng API cũ rồi backup. Với migration khác API cũ vẫn chạy, nên ghi sau bản backup sẽ mất nếu khôi phục. Backup lỗi vẫn dừng deploy với exit 2.

## 3. Cấu hình production bị chặn khi boot
- `JWT_ACCESS_SECRET` và `JWT_REFRESH_SECRET` phải từ 32 ký tự khi NODE_ENV=production. Sinh bằng `openssl rand -base64 48`. Đổi khoá đang chạy sẽ đăng xuất mọi người dùng.
- Đã đặt `ZALOPAY_APP_ID` mà `ZALOPAY_ENDPOINT` còn là sandbox (mặc định của schema là sandbox) thì không boot, trừ khi `ZALOPAY_ALLOW_SANDBOX=1`. Endpoint thật: `https://openapi.zalopay.vn/v2`.
- Quy tắc nằm trong `apps/api/src/config/env.validation.ts`. `check-env.ts` chỉ gọi lại `validateEnv`, không có bản sao quy tắc nào khác.
- Việc cần làm trước deploy tới: xem `.env` trên VPS có JWT secret đủ 32 ký tự chưa. Nếu chưa, deploy sẽ dừng ở bước kiểm .env (an toàn), nhưng đổi khoá vẫn đăng xuất mọi người.
- Bằng chứng deploy dừng trước khi thay container cũ, không có downtime (`tools/deploy/deploy.sh`):
  - dòng 184: `dc run --rm --no-deps api node dist/config/check-env.js` chạy bằng image mới (compose đặt NODE_ENV=production cho api), lỗi thì `exit 2`.
  - dòng 209 (`dc stop api`, chỉ nhánh points_1d), dòng 257 (`up -d --no-build api`), 264 (web), 276 (bridge) đều nằm sau dòng 184.
  - Chỉ `docker compose build` chạy trước, và nó không đụng container đang chạy.

## 4. Trần heap Node
- `docker-compose.vietnix.yml`: api `NODE_OPTIONS=--max-old-space-size=512` (mem_limit 768m), web `--max-old-space-size=352` (mem_limit 512m), khoảng 70%. Trước đó không có NODE_OPTIONS ở Dockerfile, compose hay `.env.production.example`.
- Kiểm cú pháp: `docker compose -f docker-compose.vietnix.yml config -q` với `.env` giả (POSTGRES_PASSWORD, WEB_DOMAIN), đã xoá sau khi chạy.
- Nếu `.env` trên VPS có NODE_OPTIONS riêng thì giá trị trong compose (khối `environment`) thắng `env_file`.

## 5. Workflow VM cũ bị khoá
- `deploy.yml`, `ops.yml`, `logs.yml`, `smoke.yml`, `smoke-purchase.yml`: bước đầu tiên của job thất bại, trừ khi biến repo `VM_WORKFLOWS_ENABLED` bằng `true`. Các bước sau không chạy khi bước này đỏ.
- Muốn dùng lại: kiểm VM_HOST, VM_USER, VM_SSH_KEY trỏ đúng máy, rồi đặt biến ở Settings > Secrets and variables > Actions > Variables. Nhớ: deploy.yml chạy git pull + deploy.sh, smoke*.yml ghi user thử vào DB thật.
- `ops-workflows.spec.ts` kiểm cả năm file có khoá này ở bước đầu.
