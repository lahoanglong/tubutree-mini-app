# Tubu Tree — Deploy Runbook

## 1. Backend public hosting (Railway recommend)

### Prerequisites
- Tài khoản GitHub (đã có) + repo này push lên main
- Tài khoản Railway: https://railway.app (free tier $5 credit/tháng)
- Pancake POS Dashboard access để cấu hình webhook URL

### Step-by-step Railway

1. **Tạo project mới**
   - Vào https://railway.app → New Project → Deploy from GitHub repo
   - Chọn `lahoanglong/tubutree-mini-app`
   - Set **Root Directory** = `tubutree-api` (nếu Railway hỏi)
   - Railway sẽ tự detect `Dockerfile` + `railway.json`

2. **Thêm Postgres addon**
   - Trong project → New → Database → PostgreSQL
   - Railway tự tạo `DATABASE_URL` biến vào service

3. **Thêm Redis addon**
   - New → Database → Redis
   - Railway tạo `REDIS_URL`

4. **Set env variables** (vào service → Variables, copy từ [.env.example](tubutree-api/.env.example)):
   ```
   PORT=3001
   NODE_ENV=production
   JWT_SECRET=<openssl rand -base64 48>
   WEBHOOK_SECRET=<openssl rand -base64 32>
   ADMIN_ZALO_UIDS=<zalo_uid_của_bạn>
   ZALO_APP_ID=565779011239360460
   ZALO_APP_SECRET=mQhjICzWAiFgEnQs6SuI
   PANCAKE_SHOP_ID=20021276
   PANCAKE_API_KEY=9ef74177bc164987a0e98932aeb71747
   VIETQR_BANK_ID=TCB
   VIETQR_ACCOUNT_NO=9984606774
   VIETQR_ACCOUNT_NAME=LA HOANG LONG
   VIETQR_TEMPLATE=compact
   UPLOAD_DIR=/app/uploads
   MAX_UPLOAD_SIZE_MB=5
   ```
   `DATABASE_URL` và `REDIS_URL` Railway tự inject — không set tay.

5. **Generate public domain**
   - Service → Settings → Networking → Generate Domain
   - Lấy URL dạng `https://tubutree-api-production.up.railway.app`

6. **Add persistent volume cho uploads**
   - Service → Settings → Volumes → New Volume
   - Mount path: `/app/uploads`
   - Size: 1GB đủ cho vài nghìn CTV

7. **Test**
   ```
   curl https://<your-domain>/health
   # → {"status":"ok","db":"connected"}
   ```

8. **Cấu hình Pancake webhook**
   - Pancake Dashboard → Webhooks
   - URL: `https://<your-domain>/api/webhook/pancake`
   - Custom header: `X-Webhook-Secret: <giá-trị-WEBHOOK_SECRET-vừa-tạo>`
   - Subscribe events: order.confirmed, order.shipping, order.delivered, order.cancelled

### Alternative: Render (Web Service)
- Cùng pattern, dùng `Dockerfile`. Free tier không có Redis miễn phí → Upstash.

---

## 2. Frontend — Deploy Zalo Mini App testing

### Switch backend URL
```powershell
cd tubutree-app
# Sửa .env trỏ về backend public
echo "VITE_API_URL=https://<your-railway-domain>/api" > .env
```

### Build + Deploy
```powershell
npx vite build --outDir www
npx zmp login
# → Nhập Mini App ID: 565779011239360460
# → Browser mở, đăng nhập Zalo Developer account
npx zmp deploy --testing
# → Bản testing, mở Zalo Studio scan QR để test
```

Production deploy: bỏ `--testing` flag (yêu cầu Zalo audit thủ công).

---

## 3. Pancake discount real verify

**Mục đích**: confirm Pancake POS có honor `discount`/`total_discount_amount` field trong order create payload không. Nếu không → invoice POS hiển thị giá gốc, COD driver thu sai tiền.

### Cách 1: Tự động qua script
```powershell
cd tubutree-api
npx ts-node scripts/test-pancake-discount.ts
```
Script tạo 1 đơn test 50,000 VND với discount 10,000 VND, in response Pancake để bạn xem có field discount/total_price tương ứng không. **Nó tạo đơn thật trên Pancake** — sau khi verify, vào Pancake Dashboard huỷ đơn test này.

### Cách 2: Tạo đơn thật qua app
1. Mở Mini App đã deploy
2. Login, mua 1 sản phẩm rẻ (vd 50k)
3. Apply voucher KM20 (giảm 10k)
4. Đặt đơn COD
5. Vào Pancake Dashboard → Orders → đơn vừa tạo
6. **Verify**: tổng tiền hiển thị là 40,000 VND (không phải 50,000)

### Nếu Pancake không honor:
Update [tubutree-api/src/controllers/order.controller.ts](tubutree-api/src/controllers/order.controller.ts) — encode discount thành line item:
```javascript
items: [
  ...realItems,
  { product_id: null, name: 'Khuyến mãi', quantity: 1, price: -totalDiscount }
]
```
Hoặc switch sang bỏ qua Pancake hoàn toàn cho đơn có discount (lưu DB local, xử lý tay).

---

## 4. Maintenance

- **Logs**: Railway → Service → Deployments → View Logs
- **DB migrations**: tự chạy mỗi lần boot qua `prisma db push --skip-generate` trong CMD
- **Rolling restart**: Railway tự rolling deploy khi push GitHub
- **Backup DB**: Railway → Postgres → Backups (daily, retain 7 days free tier)
- **Monitor `AdminAuditLog` cho PANCAKE_ORPHAN / REVERSE_FAILED_ON_CANCEL** — đây là alerts cho ops, hiện chưa có notification automation, check tay weekly.

## 5. Trouble-shooting

| Triệu chứng | Nguyên nhân | Fix |
|------------|-------------|-----|
| Server crash boot | `JWT_SECRET` thiếu hoặc <16 ký tự | Set env var đúng |
| Webhook 401 | `WEBHOOK_SECRET` không match Pancake config | Đồng bộ 2 chỗ |
| Login user nào cũng `is_admin: false` | `ADMIN_ZALO_UIDS` chưa có UID | Login lần đầu, copy `zalo_uid` từ DB → thêm vào env → redeploy |
| Upload 413 | `MAX_UPLOAD_SIZE_MB` thấp | Tăng giá trị, restart |
| KYC images 404 sau deploy | Volume không persistent | Mount Railway Volume vào `/app/uploads` |
