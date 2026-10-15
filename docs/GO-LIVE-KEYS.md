# Hướng dẫn đăng ký & cấu hình KEY GO-LIVE — Tubu Tree

Tài liệu này hướng dẫn **đăng ký từng dịch vụ bên thứ ba** rồi **đặt key vào hệ thống** để bật chức năng thật.
Hệ thống được thiết kế **fail-safe**: thiếu key thì chức năng đó tự tắt/êm (COD, Ví, TubuXu, in-app vẫn chạy),
KHÔNG làm sập app. Khi có key → bật dần từng cái.

> ⚠️ **Bảo mật:** TUYỆT ĐỐI không commit key vào git. Key đặt ở 3 nơi (mục cuối): GitHub Secrets → VM `.env` (qua `ops.yml`).

Tóm tắt việc cần làm (theo độ ưu tiên):

| Dịch vụ | Dùng để | Lead time | Biến env |
|---|---|---|---|
| **ZaloPay Merchant** | Thanh toán online trong app | ~1–2 tuần duyệt | `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2` |
| **Zalo OA + ZNS** | Gửi thông báo ZNS (đơn hàng, voucher) + đăng nhập web | OA ~3–5 ngày, **template ZNS ~7–14 ngày** | `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_ID`, `ZALO_OA_ACCESS_TOKEN` |
| **Accesstrade** | Hoàn tiền (cashback) mua sàn ngoài | ~3–7 ngày duyệt publisher | `ACCESSTRADE_TOKEN`, `ACCESSTRADE_PUBLISHER_ID`, `ACCESSTRADE_WEBHOOK_SECRET` |
| **Pancake POS** (bắt buộc) | Nguồn chân lý catalog, tồn kho, đơn và vận chuyển | Có ngay (tài khoản shop) | `PANCAKE_API_KEY`, `PANCAKE_SHOP_ID`, `PANCAKE_WEBHOOK_SECRET` — mục 6 |
| **Gomdon** (nếu bật thu gom tái chế) | Vận đơn đổi hàng BestExpress | Liên hệ quản trị Gomdon | `GOMDON_PHONE`, `GOMDON_PASSWORD`, `GOMDON_WEBHOOK_SECRET` — mục 7 |
| **Kênh báo động vận hành** (khuyến nghị) | Báo sự cố Pancake/Gomdon/hàng đợi ra Slack/Google Chat/n8n và/hoặc email | Tạo ngay (incoming webhook; hộp thư SMTP) | `OPS_ALERT_WEBHOOK_URL`; email: `OPS_ALERT_EMAIL_TO`, `SMTP_HOST`, `SMTP_FROM`… — mục 8 |

> **Pancake khác các dịch vụ còn lại:** production thiếu `PANCAKE_API_KEY`/`PANCAKE_SHOP_ID`/`PANCAKE_WEBHOOK_SECRET`
> thì **API không khởi động** (không có kho thì không bán được đơn nào). `tools/deploy/deploy.sh` kiểm `.env` bằng
> image mới trước khi thay container nên thiếu khoá thì deploy dừng, bản đang chạy vẫn phục vụ. Đặt khoá theo
> mục 6 trước lần deploy đầu tiên.

---

## 1) ZaloPay Merchant (thanh toán online)

**Mục tiêu:** lấy `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`.

### Các bước đăng ký
1. Truy cập **ZaloPay for Business**: https://merchant.zalopay.vn (hoặc liên hệ Sales ZaloPay qua https://zalopay.vn/business).
2. Đăng ký tài khoản Merchant bằng **thông tin doanh nghiệp** (cần Giấy phép kinh doanh + tài khoản ngân hàng doanh nghiệp đứng tên công ty).
3. Vào mục **Tích hợp (Integration) → Ứng dụng**: tạo 1 Application cho Tubu Tree.
   - Loại tích hợp: **Cổng thanh toán / App-to-App** (Mini App dùng luồng tạo đơn `create order` rồi redirect/SDK).
4. ZaloPay cấp **môi trường Sandbox trước**:
   - `App ID` → `ZALOPAY_APP_ID`
   - `Key1` (MAC tạo đơn) → `ZALOPAY_KEY1`
   - `Key2` (xác thực callback) → `ZALOPAY_KEY2`
   - Endpoint sandbox: `https://sb-openapi.zalopay.vn/v2` (đã set sẵn `ZALOPAY_ENDPOINT`).
5. Khai báo **Callback/Redirect URL** trong dashboard ZaloPay:
   - Callback (server → server): `https://api.tubutree.com/api/webhooks/zalopay`
   - Redirect (sau thanh toán): tuỳ luồng Mini App (link ZMP của app).
6. Test trên Sandbox (ZaloPay có app/tài khoản test). Khi OK → ZaloPay duyệt **Production** và cấp bộ `App ID/Key1/Key2` PROD mới + đổi endpoint sang `https://openapi.zalopay.vn/v2`.

### Đặt vào hệ thống
```bash
gh secret set ZALOPAY_APP_ID  --body "<app_id>"
gh secret set ZALOPAY_KEY1    --body "<key1>"
gh secret set ZALOPAY_KEY2    --body "<key2>"
gh workflow run ops.yml -f action=set-env   # ghi vào VM .env
# rồi deploy/restart để API nạp env (xem mục cuối)
```
> Khi lên Production: thêm `gh secret set ZALOPAY_ENDPOINT --body "https://openapi.zalopay.vn/v2"`.

---

## 2) Zalo Official Account (OA) + ZNS (thông báo)

**Mục tiêu:** lấy `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_ID`, `ZALO_OA_ACCESS_TOKEN`.
Dùng cho: gửi **ZNS** (xác nhận đơn, giao hàng, voucher) và **đăng nhập web bằng Zalo** (cần thêm Bước E: đăng ký Callback URL).

### Bước A — Tạo OA
1. Tạo **Official Account** tại https://oa.zalo.me → loại **Doanh nghiệp** (cần GPKD).
2. Gửi **xác minh OA** (verified) — bắt buộc để dùng ZNS. Lead time ~3–5 ngày.

### Bước B — Tạo ứng dụng trên Zalo Developers
3. Vào https://developers.zalo.me → **Tạo ứng dụng** → loại có **Official Account API**.
   - `App ID` → `ZALO_APP_ID`
   - `App Secret` (mục Thông tin ứng dụng) → `ZALO_APP_SECRET`
4. **Liên kết OA với ứng dụng** (Quản lý ứng dụng → Official Account → liên kết OA đã tạo ở bước A).
   - `OA ID` (ID của Official Account) → `ZALO_OA_ID`

### Bước C — Lấy OA Access Token + Refresh Token (hệ thống TỰ làm mới)
5. Cấp quyền để lấy **OA Access Token + Refresh Token** (luồng OAuth của Zalo, scope gửi ZNS).
   - `Access Token` → `ZALO_OA_ACCESS_TOKEN`
   - `Refresh Token` → `ZALO_OA_REFRESH_TOKEN`
   - ✅ **Đã có cron tự refresh (2026-06-26):** access token Zalo hết hạn ~25h và refresh_token **xoay vòng** mỗi lần — hệ thống tự gọi Zalo OAuth mỗi 6h (khi sắp hết hạn), lưu token mới vào DB. Bạn **chỉ cần cấp 2 token ban đầu**; sau đó hệ thống tự duy trì, không cần can thiệp.

### Bước D — Đăng ký template ZNS (LEAD TIME LÂU NHẤT ~7–14 ngày)
6. Trong Zalo OA → **ZNS → Tạo mẫu thông báo**. Mỗi loại thông báo là 1 template được Zalo **duyệt nội dung** riêng.
   Nội dung mẫu lấy từ `apps/api/prisma/seed.ts` (mảng `NOTIFICATION_TEMPLATES`). Ưu tiên đăng ký các mã đang để `channel: 'ZNS'`:
   - `ORDER_CONFIRMED` — "Đơn {{order_code}} đã được xác nhận…"
   - `ORDER_SHIPPING` — "Đơn {{order_code}} đang được giao…"
   - (tuỳ nhu cầu: voucher welcome/birthday, nhắc mua lại…)
7. Mỗi template Zalo duyệt sẽ cấp **Template ID**. Báo lại các Template ID này để map vào hệ thống (cấu hình `system_configs` hoặc `notification_templates`).

### Bước E — Đăng nhập web bằng Zalo (BẮT BUỘC để khách mua được trên web)
Web khách (`https://app.tubutree.com`) chỉ có **một** cách đăng nhập là Zalo OAuth. Thiếu bước này thì mọi khách web không đặt được hàng, dù Mini App vẫn chạy bình thường.

8. Trên https://developers.zalo.me → ứng dụng ở Bước B → **Đăng nhập (Zalo Login)** → bật sản phẩm và thêm **Callback URL**:
   - `https://app.tubutree.com/dang-nhap/callback`
   - Web tự dựng `redirect_uri = <origin của trang đang mở>/dang-nhap/callback`, nên **mỗi origin có nút đăng nhập phải khớp một Callback URL đã đăng ký**. Origin chính là `https://app.tubutree.com`.
   - Gian hàng CTV chạy ở subdomain (`https://<ten-gian-hang>.tubutree.com`) cũng dùng chính mã đăng nhập này. Mình **chưa có bằng chứng** Zalo chấp nhận wildcard hay subdomain tuỳ ý (chưa chạy với Zalo thật). Kiểm ở `docs/2026-10-review/UAT-ZALO.md` mục 12: nếu Zalo từ chối `redirect_uri` ở subdomain thì phải chốt phương án (đăng ký từng subdomain đang bán hàng, hoặc chuyển khách sang `app.tubutree.com` để đăng nhập) trước khi mở link gian hàng CTV cho khách.
9. Kiểm **trạng thái ứng dụng**: nếu ứng dụng còn ở chế độ phát triển thì thường chỉ tài khoản Zalo đã thêm làm người phát triển/thử nghiệm mới đăng nhập được. Chuyển sang trạng thái công khai trước khi mở cho khách.
10. `ZALO_APP_ID` phải có **trước khi build web**: web nhúng `NEXT_PUBLIC_ZALO_APP_ID` vào bản dựng (không đọc lúc chạy). Docker build của web **dừng với lỗi** nếu giá trị này rỗng (chỉ bản thử không dùng Zalo mới đặt `ALLOW_EMPTY_ZALO_APP_ID=1` trong `.env` để bỏ qua; khi đó trang đăng nhập hiện thông báo "chưa cấu hình" thay cho nút). Đổi App ID thì phải **build lại web**:
   ```bash
   cd ~/tubutree && docker compose -f docker-compose.prod.yml up -d --build web
   ```
11. Kiểm sau deploy: mở `https://app.tubutree.com/dang-nhap`, bấm **Đăng nhập với Zalo**, trình duyệt phải sang `oauth.zaloapp.com` với đúng `app_id`, đăng nhập xong quay lại `app.tubutree.com`. Checklist đầy đủ: `docs/2026-10-review/UAT-ZALO.md` mục 12.

### Đặt vào hệ thống
```bash
gh secret set ZALO_APP_ID          --body "<app_id>"
gh secret set ZALO_APP_SECRET      --body "<app_secret>"
gh secret set ZALO_OA_ID            --body "<oa_id>"
gh secret set ZALO_OA_ACCESS_TOKEN  --body "<oa_access_token>"
gh secret set ZALO_OA_REFRESH_TOKEN --body "<oa_refresh_token>"   # để cron tự làm mới
gh workflow run ops.yml -f action=set-env
```

---

## 3) Accesstrade (hoàn tiền mua sàn ngoài — cashback)

**Mục tiêu:** lấy `ACCESSTRADE_TOKEN`, `ACCESSTRADE_PUBLISHER_ID`, đặt `ACCESSTRADE_WEBHOOK_SECRET`.

### Các bước đăng ký
1. Đăng ký **Publisher** tại https://accesstrade.vn → "Đăng ký làm Publisher/Đối tác".
   - Khai báo "kênh quảng bá" = **Tubu Tree Mini App** (website/app), lĩnh vực mẹ & bé / tiêu dùng xanh.
2. Sau khi được duyệt, vào **Dashboard Publisher → Công cụ / API**:
   - Lấy **API Token** (Access Token cho API publisher) → `ACCESSTRADE_TOKEN`.
   - Lấy **Publisher ID** (mã định danh publisher) → `ACCESSTRADE_PUBLISHER_ID`.
3. Đăng ký **chiến dịch (campaign)** với các sàn muốn cho cashback (Shopee/Lazada/Tiki…) — cần được advertiser duyệt.
4. **Postback/Webhook conversion:** khai báo URL nhận thông báo phát sinh hoa hồng:
   - URL: `https://api.tubutree.com/api/webhooks/accesstrade`
   - `ACCESSTRADE_WEBHOOK_SECRET`: token bí mật bạn TỰ đặt, khai báo trùng 2 phía (Accesstrade dashboard + env). Hệ thống dùng nó để **verify** postback (chống giả mạo). Nếu Accesstrade không cho đặt secret, ta xác thực bằng cơ chế khác — báo lại.

> Hiện tại `ops.yml action=set-env` **tự sinh 1 `ACCESSTRADE_WEBHOOK_SECRET` ngẫu nhiên** để API boot được ở prod (fail-closed). Khi go-live thật, **đặt lại** giá trị khớp 2 phía bằng `gh secret set` (xem dưới).

### Đặt vào hệ thống
```bash
gh secret set ACCESSTRADE_TOKEN          --body "<token>"
gh secret set ACCESSTRADE_PUBLISHER_ID   --body "<publisher_id>"
gh secret set ACCESSTRADE_WEBHOOK_SECRET --body "<secret_tu_dat>"   # khớp với dashboard Accesstrade
gh workflow run ops.yml -f action=set-env
```

---

## 4) Cách đặt key vào hệ thống (chuẩn cho MỌI key)

Key đi qua **2 lớp**, không bao giờ nằm trong git:

1. **GitHub Secrets** (kho bí mật của repo):
   ```bash
   gh secret set <TÊN_BIẾN> --body "<giá_trị>"
   gh secret list            # kiểm tra đã có (không in giá trị)
   ```
2. **VM `.env`** — nạp từ GitHub Secrets qua workflow `ops.yml` (chỉ in `SET/EMPTY`, không lộ giá trị):
   ```bash
   gh workflow run ops.yml -f action=set-env
   ```
3. **API nạp env mới** ở lần deploy/restart kế tiếp:
   ```bash
   # cách 1: đẩy 1 commit bất kỳ lên main → CI xanh → tự deploy (rebuild container, nạp .env)
   # cách 2 (không cần commit): SSH vào VPS Vietnix, tạo lại container api để nạp .env
   cd /opt/tubutree && docker compose -f docker-compose.vietnix.yml up -d api
   ```
4. **Kiểm tra đã nhận key (không lộ giá trị):**
   ```bash
   gh workflow run ops.yml -f action=audit   # xem mục ENV: SET/EMPTY
   ```

> Có thể đặt nhiều `gh secret set` rồi chạy `set-env` **một lần** cho tất cả.

---

## 5) CSKH Quick-reply/Auto-reply (webhook tin nhắn Zalo OA)

**Mục tiêu:** lấy `ZALO_OA_WEBHOOK_SECRET` (tự đặt, không phải Zalo cấp) + đăng ký webhook +
quyền gửi tin "Tư vấn/CSKH" — **khác** quyền gửi ZNS đã đăng ký ở mục 2.

1. Trong Zalo OA (đã tạo ở mục 2) → xin quyền gửi **tin nhắn tư vấn/CSKH** (Message API,
   khác ZNS) nếu OA app hiện chưa có sẵn quyền này.
2. Khai báo **Webhook URL** nhận tin khách nhắn vào OA trong Zalo OA dashboard:
   - URL: `https://api.tubutree.com/api/webhooks/zalo-oa`
   - Token xác thực: tự đặt 1 giá trị bí mật, khai báo trùng 2 phía (Zalo OA dashboard +
     env `ZALO_OA_WEBHOOK_SECRET`) — hệ thống dùng để verify webhook (chống giả mạo),
     tương tự cơ chế `PANCAKE_WEBHOOK_SECRET`.
3. Vào Admin → "CSKH mẫu tin nhanh" tạo các template (từ khoá + nội dung trả lời) và 1
   template "Lời chào tự động" — nội dung biên tập, seed không tạo sẵn.

**Không bắt buộc để go-live** (khác ZaloPay/OA-ZNS/Accesstrade): thiếu key/webhook chưa
đăng ký → tính năng tự tắt êm (endpoint từ chối request chưa xác thực), không ảnh hưởng
phần còn lại của app. Có thể bật sau.

### Đặt vào hệ thống
```bash
gh secret set ZALO_OA_WEBHOOK_SECRET --body "<secret_tu_dat>"   # khớp với Zalo OA dashboard
gh workflow run ops.yml -f action=set-env
```

---

## 6) Pancake POS (bắt buộc — catalog, tồn kho, đơn, vận chuyển)

### Lấy key
1. Đăng nhập Pancake POS bằng tài khoản chủ shop → phần cài đặt nâng cao → kết nối bên thứ ba →
   **Webhook/API** → tạo **API key** (khoá POS, khác khoá Pancake chat/inbox; có toàn quyền shop, giữ kín).
   Tên mục trên giao diện có thể khác theo phiên bản Pancake.
2. **Shop ID**: số id của shop trên POS (thấy trên URL trang quản trị shop, hoặc gọi
   `GET https://pos.pages.fm/api/v1/shops?api_key=<key>` từ máy của bạn và lấy `id`).
3. **Webhook đơn hàng/kho** (cùng mục Webhook/API): URL `https://api.tubutree.com/api/webhooks/pancake`,
   thêm Request Header `x-webhook-token: <secret>` với secret tự sinh `openssl rand -hex 32`.
   Production thiếu secret thì webhook bị từ chối (401).

### Đặt vào hệ thống
```bash
gh secret set PANCAKE_API_KEY --body "<api_key>"
gh secret set PANCAKE_SHOP_ID --body "<shop_id>"
gh secret set PANCAKE_WEBHOOK_SECRET --body "<secret_trùng_header_webhook>"
gh workflow run ops.yml -f action=set-env
gh workflow run ops.yml -f action=audit   # PANCAKE_* phải là SET
```
`PANCAKE_BASE_URL` để mặc định `https://pos.pages.fm/api/v1`.

### Kiểm sau khi đặt key (trước khi mở bán)
1. Đặt một đơn thật nhỏ (COD), đợi ~1 phút rồi kiểm đơn đã lên Pancake:
   `SELECT code, "pancakeOrderId" FROM orders ORDER BY "createdAt" DESC LIMIT 1;` — `pancakeOrderId` phải
   có giá trị. Còn `NULL` thì xem log `docker compose -f docker-compose.vietnix.yml logs api | grep -i pancake`
   (key sai, shop id sai, hoặc response tạo đơn không có id). Huỷ đơn thử trên cả hai phía.
2. Đổi trạng thái đơn đó trên Pancake và kiểm webhook đã về:
   `SELECT status, "receivedAt" FROM pancake_webhook_events ORDER BY "receivedAt" DESC LIMIT 5;`.

---

## 7) Gomdon (thu gom tái chế — chỉ khi bật tính năng)

Chi tiết đầy đủ ở `docs/integrations/gomdon.md` mục 3. Tóm tắt:

1. Tài khoản Gomdon (số điện thoại + mật khẩu đăng nhập `admin.gomdon.com.vn`) do Gomdon cấp.
2. Sinh secret webhook `openssl rand -hex 32`. Production đã đặt `GOMDON_PHONE`/`GOMDON_PASSWORD` mà thiếu
   `GOMDON_WEBHOOK_SECRET` thì API **không khởi động**.
3. Nhờ quản trị Gomdon đăng ký webhook: có header thì URL `https://api.tubutree.com/api/webhooks/gomdon`
   kèm `x-webhook-token: <secret>`; chỉ nhập được URL thì `https://api.tubutree.com/api/webhooks/gomdon/<secret>`.
4. Bật lựa chọn ở checkout: SystemConfig `shipping.gomdon.recycling_enabled = true` (mặc định `false`).

```bash
gh secret set GOMDON_PHONE --body "<sdt>"
gh secret set GOMDON_PASSWORD --body "<mat_khau>"     # KHÔNG nhập vào tab Cấu hình admin
gh secret set GOMDON_WEBHOOK_SECRET --body "<secret>"
gh workflow run ops.yml -f action=set-env
```

> Workflow `ops.yml`/`deploy.yml`/`smoke*.yml`/`logs.yml` SSH vào máy theo secret `VM_HOST`/`VM_USER`/`VM_SSH_KEY`
> và biến repo `DEPLOY_DIR` (mặc định `/opt/tubutree`), `COMPOSE_FILE` (mặc định `docker-compose.vietnix.yml`).
> Đến 2026-10 ba secret `VM_*` vẫn trỏ VM GCP đã đóng: cập nhật sang VPS Vietnix trước khi dùng
> `set-env`/`audit`; chưa cập nhật thì đặt key thẳng vào `/opt/tubutree/.env` trên VPS rồi tạo lại container api.

---

## 8) Báo động vận hành (kênh ngoài app)

Cron 5 phút của API so tình trạng Pancake, Gomdon và hàng đợi với ngưỡng ở tab **Cấu hình → ops**
(`ops.alert_unsynced_minutes`, `ops.alert_stuck_orders`, `ops.alert_webhook_failed`, `ops.alert_queue_failed_1h`,
`ops.alert_gomdon_backlog_minutes`, `ops.alert_repeat_hours`). Có sự cố mới thì báo **một lần** (nhắc lại sau
`ops.alert_repeat_hours` giờ nếu chưa hết), hết sự cố thì báo "Vận hành đã ổn trở lại". Báo động luôn có thông báo
in-app cho admin; `OPS_ALERT_WEBHOOK_URL` thêm một kênh ngoài app để không phụ thuộc việc có người đang mở trang admin.
Lời báo động nêu tới 5 mã đơn; danh sách đầy đủ, nút **Chạy lại / Đã xử lý** cho webhook lỗi nằm ở màn
**Sức khoẻ hệ thống** của web admin.

**Định dạng gửi** (POST JSON, timeout 5 giây; gửi lỗi thì lượt kiểm 5 phút sau gửi lại):
- URL `hooks.slack.com` (Slack incoming webhook) hoặc `chat.googleapis.com` (Google Chat webhook): chỉ `{"text": "..."}`
  — tiêu đề in đậm, mỗi sự cố một dòng.
- URL khác (n8n, Zapier, máy chủ riêng): `{"text", "status": "ALERT"|"RECOVERED", "title", "summary",
  "problems": [{"key", "message"}], "generatedAt"}`.

```bash
gh secret set OPS_ALERT_WEBHOOK_URL --body "https://hooks.slack.com/services/T.../B.../..."   # phải có https://
gh workflow run ops.yml -f action=set-env
gh workflow run ops.yml -f action=audit   # OPS_ALERT_WEBHOOK_URL phải là SET
```
URL thiếu `https://` thì `set-env` từ chối ghi và API cũng không khởi động với giá trị đó. Bỏ trống = chỉ báo in-app.

### Email (kênh thứ hai, tuỳ chọn)

Email đi qua SMTP (nodemailer) và gửi **đúng những lần webhook gửi** — mở sự cố, có việc mới ở hàng việc cho người, nhắc
lại sau `ops.alert_repeat_hours`, báo "Vận hành đã ổn trở lại" — dùng chung trí nhớ chống báo lặp với webhook nên không
bao giờ nhiều hơn webhook. Hai kênh độc lập: SMTP lỗi không chặn webhook, cron hay app (chỉ ghi cảnh báo, lượt kiểm 5 phút
sau gửi lại riêng email; kênh đã gửi được không bị gửi lại), webhook lỗi cũng không làm email gửi lại.

| Biến | Ý nghĩa |
|---|---|
| `OPS_ALERT_EMAIL_TO` | Người nhận, cách nhau bằng dấu phẩy hoặc chấm phẩy; mỗi địa chỉ được kiểm tra |
| `SMTP_HOST` | Máy chủ SMTP (chỉ tên máy chủ/IP, không kèm `smtp://` hay cổng) |
| `SMTP_PORT` | Để trống = 587 (465 khi `SMTP_SECURE=true`) |
| `SMTP_SECURE` | `true` = TLS ngay từ đầu (thường cổng 465); `false`/trống = STARTTLS (cổng 587). Có tài khoản mà không dùng TLS ngay từ đầu thì bắt buộc STARTTLS, không gửi mật khẩu dạng thô |
| `SMTP_USER`, `SMTP_PASS` | Tài khoản đăng nhập SMTP, đi **cặp** (cả hai hoặc không cái nào). Mật khẩu nên là mật khẩu ứng dụng, không chứa `$` hay dấu nháy |
| `SMTP_FROM` | Địa chỉ gửi: `alerts@tubutree.com` hoặc `Tubu Tree <alerts@tubutree.com>`. Để trống thì dùng `SMTP_USER` nếu nó là địa chỉ email |
| `OPS_ALERT_ENV_LABEL` | Tuỳ chọn: nhãn môi trường trong tiêu đề (vd `staging`). Trống = `NODE_ENV`. Staging chạy `NODE_ENV=production` thì đặt nhãn để không lẫn với prod. Tối đa 24 ký tự, một dòng, không chứa `[` `]`. **Không bí mật**: đặt bằng biến GitHub (`gh variable set`), không dùng `gh secret set` |

Bỏ trống **cả bảy** biến email = tắt kênh, app chạy như cũ. Đã đặt một biến thì phải đủ (`OPS_ALERT_EMAIL_TO`,
`SMTP_HOST`, và `SMTP_FROM` hoặc `SMTP_USER` là địa chỉ email) và đúng định dạng — dở dang thì API không khởi động và
`tools/deploy/deploy.sh` dừng ở bước kiểm `.env`, thông báo nêu rõ khoá còn thiếu (không in mật khẩu); bản đang chạy vẫn
phục vụ. `set-env` cũng từ chối ghi khi gộp secret mới với `.env` hiện có vẫn thiếu khoá.

**Nội dung email:** tiêu đề `[Tubu Tree · <môi trường>] Sự cố vận hành: N vấn đề cần xử lý` (hoặc `Vận hành đã ổn trở lại`);
thân văn bản + HTML nêu từng vấn đề, số lượng và mã đơn cũ nhất như lời báo của webhook. Số điện thoại, khoá/token và
thông tin đăng nhập trong URL nằm trong thông điệp lỗi tự do bị che; email không bao giờ chứa tên, SĐT hay địa chỉ khách.
**Không có đường link** vì hệ thống chưa có cấu hình địa chỉ trang quản trị — email chỉ dẫn vào trang quản trị → **Sức khoẻ
hệ thống** để xử lý.

```bash
gh secret set OPS_ALERT_EMAIL_TO --body "ops@tubutree.com,ceo@tubutree.com"
gh secret set SMTP_HOST --body "smtp.example.com"
gh secret set SMTP_USER --body "alerts@tubutree.com"
gh secret set SMTP_PASS --body "<mat_khau_ung_dung>"      # KHÔNG commit, không nhập vào tab Cấu hình admin
gh secret set SMTP_FROM --body "Tubu Tree <alerts@tubutree.com>"
gh variable set OPS_ALERT_ENV_LABEL --body "staging"      # tuỳ chọn, biến (vars) chứ không phải secret; prod để trống
gh workflow run ops.yml -f action=set-env
gh workflow run ops.yml -f action=audit   # in SET/EMPTY từng khoá email (SMTP_PORT, SMTP_SECURE, OPS_ALERT_ENV_LABEL trống là bình thường)
```

**Gửi thử** (không đụng trí nhớ chống báo lặp, không làm mất hay thêm báo động thật), bằng token đăng nhập của admin:

```bash
curl -sS -X POST "https://<api>/api/admin/ops/alert-email/test" -H "Authorization: Bearer <access token admin>"
# 201 {"ok":true,"message":"Đã gửi email thử tới 2 địa chỉ nhận. ..."}
# 400: chưa cấu hình hoặc dở dang (nêu khoá) · 502: máy chủ SMTP từ chối (kèm lý do, đã che tài khoản/mật khẩu)
```

**Theo dõi:** màn **Sức khoẻ hệ thống** (web admin) có thẻ "Báo động qua email": trạng thái kênh, số người nhận, lần gửi
thành công và lỗi gần nhất (cùng dữ liệu ở `GET /admin/ops/health`, trường `alertChannels.email`). Lỗi SMTP không tự
thành một "sự cố vận hành" mới (tránh báo động về chính kênh báo động); cảnh báo cũng được ghi ở log API, không kèm bí mật.

---

## Thứ tự khuyến nghị go-live
1. **Zalo OA + ZNS** trước (lead time template lâu nhất ~2 tuần) — đăng ký sớm.
2. **ZaloPay** (cần cho thanh toán online; trước mắt COD/Ví/TubuXu đã đủ bán hàng).
3. **Accesstrade** (cashback — tính năng tăng trưởng, có thể bật sau).
4. **CSKH Quick-reply webhook** (tính năng tăng trưởng, không bắt buộc — bật khi rảnh).
5. **Kênh báo động vận hành** (mục 8) trước ngày mở bán, để sự cố Pancake/Gomdon không chỉ nằm trong app.

Sau mỗi lần go-live 1 dịch vụ: chạy `ops.yml action=audit` để xác nhận, rồi test 1 giao dịch thật nhỏ.
