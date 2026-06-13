# Deploy Tubu Tree lên GCP (Compute Engine + Docker + Caddy)

Triển khai toàn bộ stack (Postgres + Redis + API + Web + Caddy auto‑HTTPS) trên **một VM** GCP.
Lý do chọn VM thay vì Cloud Run/Cloud SQL: stack có Redis (BullMQ) + nhiều service, gom 1 VM
rẻ và tự chủ hơn, lại có **IP/domain ổn định** cho webhook Pancake/ZaloPay.

> Miniapp (ZMP) KHÔNG deploy ở đây — build & lên Zalo bằng `zmp deploy` riêng.

---

## 0. Chuẩn bị
- Tài khoản GCP + 1 project.
- Domain đã có (vd `tubutree.com`) + quyền sửa DNS.
- Các key đã thu thập (xem `.env.production.example`). Tối thiểu để chạy: Postgres password + JWT secrets. Pancake/ZaloPay… thêm sau cũng được.

## 1. Tạo VM Compute Engine
Console → Compute Engine → **Create instance**:
- **Machine**: `e2-medium` (2 vCPU / 4GB) — đủ cho giai đoạn đầu (có thể `e2-small` nếu tiết kiệm).
- **Boot disk**: Ubuntu 22.04 LTS, 30GB SSD.
- **Firewall**: tick **Allow HTTP** + **Allow HTTPS**.
- Region gần VN: `asia-southeast1` (Singapore).

Hoặc bằng gcloud:
```bash
gcloud compute instances create tubu-prod \
  --zone=asia-southeast1-b --machine-type=e2-medium \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --tags=http-server,https-server
```

## 2. IP tĩnh + DNS
1. VPC network → **IP addresses** → reserve static external IP, gán cho VM.
2. Tại nhà cung cấp domain, tạo **A records** trỏ về IP đó:
   - `@`        → `<IP>`  (web: `tubutree.com`)
   - `www`      → `<IP>`
   - `api`      → `<IP>`  (API: `api.tubutree.com`)
3. Chờ DNS propagate (vài phút–vài giờ). Kiểm tra: `dig +short api.tubutree.com`.

## 3. Cài Docker trên VM
SSH vào VM (nút SSH trên Console), rồi:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && exit   # thoát ra vào lại để áp group
```

## 4. Lấy code + cấu hình env
```bash
git clone https://github.com/lahoanglong/tubutree-mini-app.git tubutree && cd tubutree
cp .env.production.example .env
nano .env        # điền WEB_DOMAIN, POSTGRES_PASSWORD, JWT secrets, các key
```
Sinh secret nhanh: `openssl rand -base64 48` (JWT), `openssl rand -base64 24` (Postgres).

## 5. Khởi chạy
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
- API tự chạy `prisma migrate deploy` khi khởi động (tạo bảng).
- Caddy tự xin cert Let's Encrypt cho `tubutree.com`, `www`, `api.tubutree.com`.

**Seed dữ liệu nền (chỉ lần đầu)** — config/hạng/bậc:
```bash
docker compose -f docker-compose.prod.yml exec api pnpm prisma:seed
```

## 6. Kiểm tra
```bash
curl https://api.tubutree.com/api/health      # {"status":"ok","db":"up"}
```
Mở `https://tubutree.com` (web) và `https://api.tubutree.com/api/docs` (Swagger).

## 7. Nối Pancake webhook
Trong Pancake → Webhook:
- **Địa chỉ**: `https://api.tubutree.com/api/webhooks/pancake`
- **Dữ liệu**: Đơn hàng
- **Request Headers**: `x-webhook-token` = đúng giá trị `PANCAKE_WEBHOOK_SECRET` trong `.env`
- Bật toggle ON.

(ZaloPay callback nếu dùng: `https://api.tubutree.com/api/webhooks/zalopay`;
Accesstrade: `https://api.tubutree.com/api/webhooks/accesstrade` + header `x-accesstrade-token`.)

## 8. Cập nhật / redeploy
```bash
cd tubutree && git pull
docker compose -f docker-compose.prod.yml up -d --build
```
Migration mới tự áp khi API khởi động lại.

## 9. Vận hành
- Log:    `docker compose -f docker-compose.prod.yml logs -f api`
- Restart:`docker compose -f docker-compose.prod.yml restart api`
- Backup DB: `docker compose -f docker-compose.prod.yml exec postgres pg_dump -U tubu tubutree > backup_$(date +%F).sql`
- Postgres/Redis dữ liệu nằm ở docker volume (`pg_data`, `redis_data`) — bền qua restart/redeploy.

## Ghi chú
- NEXT_PUBLIC_* nhúng lúc build web → đổi domain phải `up -d --build` lại web.
- Đổi key trong `.env` (trừ NEXT_PUBLIC_*) → chỉ cần `restart api`.
- Muốn tách DB ra Cloud SQL sau này: bỏ service `postgres`, set `DATABASE_URL` trong `.env` trỏ Cloud SQL (xoá override trong compose).
