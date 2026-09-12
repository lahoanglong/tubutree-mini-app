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

## Khi có VM/VPS riêng (dọn dẹp về sau)

Quay lại `docker-compose.prod.yml` (có Caddy, không giới hạn RAM) trên máy mới, migrate DNS
sang IP mới, rồi tắt stack trên VPS Vietnix này (`docker compose -f docker-compose.vietnix.yml
down -v`) + xoá 2 file vhost Apache + xoá `/opt/tubutree`.
