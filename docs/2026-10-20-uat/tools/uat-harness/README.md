# Bộ khung UAT đầu-cuối (uat-harness)

Mỗi agent UAT có một **lane** riêng gồm API thật (`apps/api/dist`), Postgres thật (DB riêng copy từ mẫu), Redis thật (db riêng),
Mini App thật (Vite, mã `apps/miniapp`) và web thật (next dev, mã `apps/web`). Bộ khung chỉ giả những hệ thống bên ngoài:
Zalo (đổi token, SĐT, vị trí, các lệnh native của zmp-sdk), Pancake POS, ngân hàng.

Mọi lệnh dưới đây chạy từ thư mục này, với Node 22 trong PATH:

```bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
cd docs/2026-10-20-uat/tools/uat-harness
```

Thư mục `state/` (env lane, PID, log, ảnh chụp, dữ liệu giả Pancake, bản sao web) bị `.gitignore`.

## Bảng cổng và tài nguyên

Lane N dùng cổng `32N1` (API), `32N2` (web), `32N3` (Mini App), `32N8` (giả Pancake), DB `tubutree_uat_lN`, Redis db N.

| Lane | API | Web | Mini App | Giả Pancake | DB (127.0.0.1:25432) | Redis (127.0.0.1:26379) | Ghi chú |
|---|---|---|---|---|---|---|---|
| 1 | 3211 | 3212 | 3213 | 3218 | tubutree_uat_l1 | db 1 | đã chạy thử ca mẫu |
| 2 | 3221 | 3222 | 3223 | 3228 | tubutree_uat_l2 | db 2 | **trùng** API UAT 3221 (DB tubutree_uat), web 3222, Vite 3223 của phiên khác: chỉ dùng khi các cổng đó trống |
| 3 | 3231 | 3232 | 3233 | 3238 | tubutree_uat_l3 | db 3 | 3231 từng bị `tools/uiux/d7/ssr-proxy.mjs` (phiên khác) chiếm lúc 22:2x |
| 4 | 3241 | 3242 | 3243 | 3248 | tubutree_uat_l4 | db 4 | |
| 5 | 3251 | 3252 | 3253 | 3258 | tubutree_uat_l5 | db 5 | |
| 6 | 3261 | 3262 | 3263 | 3268 | tubutree_uat_l6 | db 6 | |
| 7 | 3271 | 3272 | 3273 | 3278 | tubutree_uat_l7 | db 7 | lane dự phòng (thay lane 2) |
| 8 | 3281 | 3282 | 3283 | 3288 | tubutree_uat_l8 | db 8 | lane dự phòng |
| 9 | 3291 | — | — | 3298 | tubutree_uat_tpl (DB mẫu) | db 15 | chỉ `build-template.sh` dùng |

Sáu agent chọn sáu lane có cổng trống (gợi ý 1, 3, 4, 5, 6, 7). `lane-up.sh` dừng ngay nếu một cổng đang bận bởi tiến trình không phải
của lane đó, và nếu db Redis của lane đang có kết nối khác. Lane 9 dùng Redis db 15 vì API perf 3229 của phiên khác từng dùng db 9.

## Bắt đầu nhanh

```bash
./lane-up.sh 1 --web          # DB copy từ mẫu (nếu chưa có), giả Pancake, API, Vite Mini App, web Next
node miniapp-session.mjs 1 returning           # mở Mini App đăng nhập bằng khách quay lại, chụp ảnh, in request
node web-session.mjs 1 admin --w 1440 --path /admin
node demo-case.mjs 1          # ca mẫu đầu-cuối, dòng cuối PASS/FAIL
./lane-down.sh 1 --drop       # dừng cả cây tiến trình; --drop xoá DB lane + FLUSHDB Redis lane
```

## Các công cụ

### `lane-up.sh <N> [--web] [--fresh] [--no-mini]` và `lane-down.sh <N> [--drop]`

- DB: `lane-db.mjs create N` chạy `CREATE DATABASE "tubutree_uat_lN" TEMPLATE "tubutree_uat_tpl"`. Lệnh này từ chối khi DB mẫu còn kết nối mở
  (liệt kê được bằng `node lane-db.mjs tpl-connections`). Nếu DB lane đã có thì giữ nguyên. `--fresh` xoá rồi copy lại, và chỉ chạy khi API lane đã dừng.
  Mỗi lần DB được tạo mới thì Redis db N bị FLUSHDB và dữ liệu giả Pancake của lane bị xoá.
- Env lane nằm ở `state/lane-N/lane.env` (quyền 600). File này được sinh một lần rồi giữ secret qua các lần bật lại. Nó chứa:
  `DATABASE_URL`, `REDIS_URL`, các secret JWT/webhook riêng của lane, `PANCAKE_BASE_URL=http://127.0.0.1:32N8/api/v1`,
  `THROTTLE_BYPASS_TOKEN`, và `AUTH_COOKIE_DOMAIN=` rỗng (cookie refresh thuộc localhost).
  Mọi tích hợp ra ngoài đều tắt bằng giá trị rỗng: Zalo OA, ZaloPay, Gomdon, AccessTrade, LLM. process.env thắng `apps/api/.env`.
- Tiến trình:
  - API: `node apps/api/dist/main.js`.
  - Vite: `VITE_API_BASE_URL=http://localhost:32N1/api`, `VITE_API_TARGET` trỏ lane, để không request nào tới api.tubutree.com.
  - Web (`--web`): next dev chạy từ bản sao `state/lane-N/web`, để `.next` không dùng chung với phiên khác. Bản sao có `node_modules` là symlink.
    Biến môi trường: `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL`, `THROTTLE_BYPASS_TOKEN`.
- PID ghi ở `state/lane-N/pids/*.pid`, log ở `state/lane-N/logs/`.
- `lane-down.sh` gửi kill tới PID gốc và mọi con cháu (`pgrep -P`). Sau 15 giây, tiến trình còn sống bị `kill -9`. Cuối cùng script báo cổng còn bận hay không.
  Script không dùng `pkill -f`.

Kiểm chứng (2026-10-19 22:45, lane 1):
```
$ ./lane-down.sh 1 --drop
web: đã dừng (cây: 92738 92748 )
vite: đã dừng (cây: 92714 92719 )
api: đã dừng (cây: 92698 )
pancake: đã dừng (cây: 91429 )
đã xoá tubutree_uat_l1
đã FLUSHDB Redis db 1
3211 trống / 3212 trống / 3213 trống / 3218 trống
$ ./lane-up.sh 1 --web
đã tạo tubutree_uat_l1 từ tubutree_uat_tpl
đã FLUSHDB Redis db 1
giả Pancake 3218 lên (PID 23754)
API http://localhost:3211/api lên (PID 23815, DB tubutree_uat_l1, Redis db 1)
Mini App http://localhost:3213 lên (PID 23974)
web http://localhost:3212 lên (PID 24098); trang dịch lần đầu khi mở (next dev)
$ ./lane-up.sh 1 --fresh
--fresh cần API lane đã dừng: chạy lane-down.sh 1 trước
```

### `build-template.sh`: dựng DB mẫu (một lần, khoảng 2,5 phút)

Các bước:
1. `pg-native.sh createdb 25432 tubutree_uat_tpl`.
2. `prisma migrate deploy`.
3. `prisma/seed.ts`.
4. `seed-reference.ts --with-business-defaults`.
5. Bật lane 9 (API 3291, giả Pancake 3298, Redis db 15).
6. Chạy `seed-roles.mjs 9`.
7. Tắt lane 9 và kiểm mẫu không còn kết nối.

Chỉ dòng `users` được chèn thẳng bằng Prisma, vì API không có đường tạo user nào khác ngoài đăng nhập Zalo. Mọi dữ liệu còn lại đi qua
endpoint thật của app: role, nhóm việc STAFF, hồ sơ và duyệt đại lý, CTV, gian hàng và duyệt, nhãn hàng, lô thẻ, flash sale, địa chỉ, giỏ,
đặt đơn, webhook giao xong.

Dựng lại mẫu khi:
- có migration mới, hoặc
- flash sale đã hết hạn: mẫu dựng 2026-10-19 15:27Z, flash sale chạy tới **2026-10-25 15:27Z**, lô thẻ còn 60 ngày.

Dựng lại không đụng DB lane đã copy. Lane nào muốn dữ liệu mới thì chạy `--fresh`.

### Người dùng theo vai trò (có trong mọi lane, sinh vào `personas.json`)

| Bí danh | id | zaloId | SĐT | Role | Mô tả |
|---|---|---|---|---|---|
| new | uat_new | uat-zalo-new | 0901000001 | CUSTOMER | Khách mới: chưa đơn, SĐT đã xác minh, chưa làm onboarding |
| new_nophone | uat_new_nophone | uat-zalo-new-nophone | — | CUSTOMER | Khách mới: chưa đơn, KHÔNG có SĐT |
| returning | uat_returning | uat-zalo-returning | 0901000003 | CUSTOMER | Khách quay lại: hạng **Lộc Biếc** (LOC_BIEC), 34.400 điểm, đơn cũ TUBU2026101960369 (4 × FUWA-DW-5L, 1.720.000đ, đã giao, lùi 40 ngày), địa chỉ mặc định HCM |
| ctv | uat_ctv | uat-zalo-ctv | 0901000004 | AFFILIATE | CTV, gian hàng `/s/uatctv` ĐÃ DUYỆT, đã đăng |
| ctv_pending | uat_ctv_pending | uat-zalo-ctv-pending | 0901000005 | AFFILIATE | CTV, gian hàng `/s/uatctvpending` đã đăng, CHỜ DUYỆT |
| dealer | uat_dealer | uat-zalo-dealer | 0901000006 | DEALER | Đại lý duyệt qua hồ sơ, bậc DEALER_2 |
| staff | uat_staff | uat-zalo-staff | 0901000007 | STAFF | STAFF không nhóm việc (quầy, đổi vỏ, chấm công) |
| kho | uat_kho | uat-zalo-kho | 0901000014 | STAFF (KHO) | STAFF nhóm KHO |
| ketoan | uat_ketoan | uat-zalo-ketoan | 0901000008 | STAFF (KE_TOAN) | Kế toán |
| marketing | uat_marketing | uat-zalo-marketing | 0901000009 | STAFF (MARKETING) | Marketing (người tạo lô thẻ) |
| cskh | uat_cskh | uat-zalo-cskh | 0901000010 | STAFF (CSKH) | CSKH (kiểm duyệt cộng đồng) |
| brand | uat_brand | uat-zalo-brand | 0901000011 | CUSTOMER | Chủ nhãn hàng Fuwa3e (brand 75ae0443eea88aa90f3c2bec9bc3ece1, 6 sản phẩm) |
| admin | uat_admin | uat-zalo-admin | 0901000012 | ADMIN | ADMIN |

Mọi công cụ nhận một trong bốn cách gọi user: id, zaloId, SĐT, hoặc bí danh (`returning` sẽ thành `uat_returning`).

Dữ liệu nghiệp vụ khác trong mẫu:
- **Lô thẻ HOPSAN** gồm 30 mã (`HOPSAN-2BWSJQ6N`, ..., danh sách đủ trong `personas.json`). uat_marketing tạo lô qua `POST /admin/coupon-batches`.
  Thông số: AMOUNT 30.000đ, đơn tối thiểu 199.000đ, 60 ngày, newCustomerOnly, mỗi mã dùng 1 lần.
  Kiểm chứng trên lane 1:
  - uat_new áp mã → 201.
  - uat_returning áp mã → 400 "Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree."
  - Giỏ chỉ có hàng giờ vàng → 400 "Đơn tối thiểu 199.000đ… Hàng giờ vàng không được tính…".
- **Flash sale đang chạy** đến 2026-10-25 15:27Z: BHN-CGL-100 165.000đ, BHN-CW-500 119.000đ, BHN-HN-500 195.000đ (giảm 25%).
- `pancake.order_source_map` có thêm nguồn chat `-1|fb-page-tubu|` (đơn CSKH).

### `mint-token.mjs <lane> <user> [--ttl giây] [--json] [--login] [--web]`

- Mặc định: in access token ký tại chỗ bằng `JWT_ACCESS_SECRET` của lane. Payload giống `AuthService.issueTokens`, hạn 12 giờ.
  Ví dụ: `TOKEN=$(node mint-token.mjs 1 admin)`.
- `--json`: in kiểu LoginResponse, có refresh token thật trong DB lane.
- `--login`: chính API lane cấp cặp token qua `POST /auth/refresh`.
- `--web`: đi kèm `--login`, in thêm `Set-Cookie tubu_rt`.

Mọi lời gọi API của script nên kèm header `x-throttle-bypass: $(grep ^THROTTLE_BYPASS_TOKEN= state/lane-1/lane.env | cut -d= -f2)`.
`lib.api()` tự kèm header này.

```
$ T=$(node mint-token.mjs 1 returning); curl -s -H "authorization: Bearer $T" http://127.0.0.1:3211/api/me/loyalty
{'pointsBalance': 55040, 'lockedPoints': 0, 'lockedUntil': None, 'redeemablePoints': 55040}     (đã rút gọn)
$ node mint-token.mjs 1 uat-zalo-ctv --login --web
{'accessToken': 'eyJhbGciOi…', 'refreshToken': '', 'user': {'id': 'uat_ctv', 'role': 'AFFILIATE'}, 'setCookie': 'tubu_rt=s2O6…'}
```

### `miniapp-session.mjs`: Mini App thật trong Playwright 390x844

```js
import { open } from './miniapp-session.mjs';
const s = await open(1, 'returning', { browser: 'chromium' /* hoặc 'webkit' */, headless: true, path: '/' });
// s.page, s.context, s.user, s.login, s.requests [{method, path, status, mocked}], s.blocked, s.staticCdn, s.errors,
// await s.zmpCalls(), await s.setQr('nội dung QR lần quét tới'), await s.goto('/cart'), await s.close()
```

Tham số khác:
- `phone`: SĐT ghi cho user khi app xin SĐT (`/auth/ensure-phone`) mà user chưa có. Mặc định là một số 097xxxxxxx cố định theo id.
- `denyPhone`: khách từ chối chia sẻ SĐT.
- `mockRefresh`: `/auth/refresh` cũng được giả.
- User `guest`: không giả đăng nhập. App tự gọi `/auth/guest` tới API thật.

Phần được giả:
- Module Vite `zmp-sdk_apis.js` được bọc lại. Mọi export gốc vẫn được re-export.
- Các hàm sau bị thay:
  - đăng nhập và dữ liệu Zalo: `login`, `getAccessToken` (trả `uat-zalo-access:<zaloId>`), `getPhoneNumber`, `getLocation`, `getUserInfo`, `scanQRCode`;
  - lệnh mở UI native: `openWebview`, `openChat`, `openShareSheet`, `followOA`, `requestSendNotification`, `vibrate`, ...
- `getStorage`/`setStorage` giữ bản gốc. Ngoài Zalo, trên host `localhost`, SDK tự lưu vào localStorage.
- `POST /auth/zalo-mini-app`, `/auth/guest`, `/auth/ensure-phone` được trả bằng LoginResponse **do API lane cấp thật**:
  bộ khung chèn một refresh token vào `refresh_tokens`, rồi gọi `POST /auth/refresh` của lane.
- `/auth/refresh` đi thẳng API thật, nên mở lại trang là luồng xoay token thật.
- Request tới api.tubutree.com, họ Zalo và Sentry bị abort và ghi vào `s.blocked`.
  Riêng GET font icon zmp-ui ở `h5.zadn.vn/static` được cho qua và ghi vào `s.staticCdn`.

Kiểm chứng (lane 1 vừa copy từ mẫu, `node miniapp-session.mjs 1 returning`). Ảnh chụp ở `state/lane-1/shots/miniapp-returning-chromium.png`:
```
--- request API (method path → status, mocked = giả đổi token Zalo)
POST /auth/zalo-mini-app → 200  [mocked]
GET /me → 200
GET /home → 200
GET /home/me?purchasedLimit=10 → 200
GET /cart → 200
GET /me/wishlist/ids → 200
--- lệnh zmp-sdk app đã gọi: ["login","getAccessToken"]
--- request bị chặn: []
--- chữ đầu trang: "3\nBạn đang tìm gì hôm nay?\nMua lại\nFuwa3e\nNước rửa chén sinh học Fuwa3e · Can 5L\n★ Mới\n430.000đ\n480.000đ\nMua lại\n…Ưu đãi giờ vàng\nCòn 143h 43m…"
```
Kiểm chứng thêm:
- WebKit, sau reload: `POST /auth/refresh → 200 | GET /home → 200 | GET /me → 200 | GET /home/me?purchasedLimit=10 → 200 | GET /cart → 200 | GET /me/wishlist/ids → 200`.
  Không request nào là mocked.
- `guest`: `POST /auth/guest → 200` tới API thật, rồi `GET /me`, `/home`, `/cart` → 200.

### `web-session.mjs`: web thật đã đăng nhập, khổ 390 hoặc 1440 (cần `lane-up.sh N --web`)

Cách đăng nhập không có phần giả:
- Bộ khung đặt cookie `tubu_rt` (domain localhost, path `/api/auth`, HttpOnly, Lax) chứa refresh token thật.
- Bộ khung đặt cờ `localStorage tubu_web_session=1`.
- Web tự gọi `POST /api/auth/refresh` với `x-client: web`.

```js
import { openWeb } from './web-session.mjs';
const s = await openWeb(1, 'admin', { width: 1440, path: '/admin?tab=orders' });
```
```
$ node web-session.mjs 1 admin --w 1440 --path /admin
POST /auth/refresh → 200 / GET /me → 200 / GET /admin/customer-refunds?page=1&limit=1&status=OPEN → 200 / GET /admin/ops/inbox → 200 / GET /cart → 200
chữ đầu trang: "Tubu Tree\nQuản trị\nVề cửa hàng\nUAT\nĐăng xuất\nQuản trị Tubu Tree\nMàn thu ngân…"
$ node web-session.mjs 1 returning --w 390 --path /tai-khoan
POST /auth/refresh → 200 / GET /me → 200 / GET /config/public → 200 / GET /brand/owner/me → 404 (khách không phải chủ nhãn) / GET /orders… → 200 / GET /me/loyalty → 200 …
```
Lần đầu mở mỗi trang, next dev phải dịch trang đó (`/admin` mất khoảng 16 giây).

### Giả Pancake: `fake-pancake.mjs <lane>` (lane-up tự bật ở cổng 32N8)

Giả này phục vụ đúng các lời gọi của `pancake.client.ts`, kiểm `api_key` và shop (sai key → 401):
- geo tỉnh/xã: form địa chỉ, dữ liệu ở `fixtures/geo.json`;
- products/categories: trả rỗng;
- `POST orders`: đẩy đơn app, cấp id 92000xx, lưu ở `state/lane-N/pancake/app-orders.json`;
- `GET`/`PUT orders/:id`;
- `GET orders?search=`: tra theo mã đơn Tubu, SĐT, mã vận đơn hoặc mã đơn sàn;
- kéo dự phòng đơn sàn: `GET orders?updateStatus=`.

Đơn sàn và đơn chat nằm ở `state/lane-N/pancake/platform-orders.json`. File này được đọc lại ở mỗi request, nên sửa tay là có hiệu lực ngay.
Sáu đơn mẫu 7700001–7700006 (Shopee, TikTok, Lazada, chat) có mã vận đơn:
- `SPXVN05UAT0001` (Shopee, SĐT returning);
- `SPXVN05UAT0002` (Shopee, SĐT new);
- `GHNUAT00000003` (TikTok, đang giao);
- `LZDUAT00000004` (Lazada, đã hoàn);
- `GHTKUAT0000005`, `GHTKUAT0000006` (chat).

Cổng phụ:
- `GET /__uat/state`;
- `GET /__uat/find?code=`;
- `POST /__uat/app-orders/:id` (đổi trường đơn app);
- `GET /__uat/requests` (nhật ký mọi lời gọi API lane đã gửi tới giả).

```
search=GHNUAT00000003 → 1 [(7700003, 2, -9, 'GHNUAT00000003')]
search=0901000003     → 8 đơn (4 đơn app 92000xx + 7700001/3/4/5)
api_key sai           → 401
Tra mã vận đơn thật qua app: bật loyalty.marketplace_claim_enabled + pancake.external_lookup_enabled (PUT /admin/config, mặc định tắt),
  POST /me/external-points/claims {code:'SPXVN05UAT0002'} (chưa có trong external_orders)
  → giả Pancake nhận GET /api/v1/shops/uatshop1/orders?search=SPXVN05UAT0002 → 201 {"status":"REVIEW","channel":"shopee","points":1990,…}
  {code:'GHTKUAT0000005'} → 409 CHAT_ORDER "Đơn đặt qua tư vấn viên được cộng điểm tự động theo số điện thoại…"
```

### `pancake-webhook.mjs`: webhook Pancake tới API lane

Webhook ký bằng `x-webhook-token` = `PANCAKE_WEBHOOK_SECRET` của lane. Pancake POS không ký HMAC (`pancake-webhook.controller.ts`).
Payload là nguyên object đơn lấy từ giả Pancake, nên trạng thái hai bên đi cùng nhau. Script chờ worker BullMQ xử lý xong
(`pancake_webhook_events.status`), rồi in trạng thái đơn Tubu.

```bash
node pancake-webhook.mjs <lane> <mãĐơnTubu|idPancake> <trạngThái> [--tracking MÃ] [--carrier TÊN] [--bank SỐ] [--prepaid SỐ] [--dry]
node pancake-webhook.mjs <lane> platform <idPancake|mã vận đơn|mã đơn sàn> [trạngThái]
# trạngThái: confirmed packed shipped delivered paid returning returned partial cancelled deleted, hoặc mã số Pancake (1,2,3,4,5,6,7,8,15,16)
```
```
$ node pancake-webhook.mjs 1 platform SPXVN05UAT0001 delivered
"event": {"status": "PROCESSED", "attempts": 1}, "externalOrder": {"pancakeOrderId": "7700001", "source": "MARKETPLACE", "channel": "shopee",
 "trackingCode": "SPXVN05UAT0001", "phone": "0901000003", "goodsValue": 250000, "status": "DELIVERED", …}
```

### `bank-webhook.mjs <lane> <mãĐơn> <số tiền> [nội dung] [--dry]`: giả chuyển khoản

API không có webhook ngân hàng. Đơn BANK_TRANSFER lên PAID khi Pancake đối soát khoản chuyển theo nội dung = mã đơn, rồi gửi webhook đơn
kèm `bank_payment`. Script đóng cả vai ngân hàng lẫn Pancake:
- Nội dung không chứa mã đơn: khoản chuyển chỉ được ghi vào state, không có webhook. Kế toán phải bấm "Đã nhận tiền".
- Nội dung khớp: script cộng dồn `bank_payment` rồi gửi webhook.

Kiểm chứng trên đơn chuyển khoản TUBU2026101982118, 238.000đ:
```
"chuyen tien hang" 238000  → matched:false, đơn vẫn PENDING_PAYMENT/UNPAID
100000                     → event PROCESSED, đơn PENDING_PAYMENT/UNPAID, pancakeAttention "Khách chuyển thiếu: Pancake ghi nhận 100.000đ/238.000đ, còn thiếu 138.000đ…"
138000 "TUBU2026101982118 thanh toan" → bankPaymentTotal 238000, đơn CONFIRMED/PAID, paidAt ghi, pancakeAttention null
```

### `run-job.mjs`: chạy job/cron ngay trên lane

```bash
node run-job.mjs --list                         # 45 job @Cron: bí danh, Class.method, lịch, file
node run-job.mjs 1 points.expire
node run-job.mjs 1 DeliveredEffectsResyncCron.resyncPending
node run-job.mjs 1 LoyaltyService.recalcTier --args '["uat_returning"]'    # {"$date":"ISO"} trong args thành Date
```

Script tạo `NestFactory.createApplicationContext(AppModule)` bằng mã `apps/api/dist`, với env lane. Context không mở cổng và không giữ lease cron.
stdout chỉ chứa JSON kết quả. Log Nest đi ra stderr.

Lưu ý: chính API lane vẫn chạy cron theo lịch thật, vì mỗi lane có DB riêng nên có lease riêng. `run-job` chỉ là cách chạy ngay một job.

**Lùi ngày để job/luật thời gian có hiệu lực.** Dùng `db.mjs` với UPDATE, rồi gọi API hoặc chạy job. Cả hai ví dụ sau đã kiểm chứng trên lane 1.

Ví dụ 1: hết cửa sổ đổi/trả, nên điểm đơn hết bị khoá. Điểm này được tính lúc đọc, không cần job.
```bash
node db.mjs 1 "UPDATE orders SET \"deliveredAt\" = \"deliveredAt\" - interval '8 days' WHERE \"userId\" = 'uat_returning' AND \"deliveredAt\" > now() - interval '1 day'"
#   → {"affected": 2}; GET /me/loyalty: lockedPoints 20640 → 0, redeemablePoints = pointsBalance
```

Ví dụ 2: điểm hết hạn, sau đó chạy job.
```bash
node db.mjs 1 "UPDATE points_transactions SET \"expiresAt\" = now() - interval '1 minute' WHERE reason = 'ORDER_DELIVERED:TUBU2026101960369'"
node run-job.mjs 1 points.expire
#   → sổ có thêm dòng {delta: -34400, reason: POINTS_EXPIRED, lot: STANDARD}; users.pointsBalance 55040 → 20640
```

Các cột hay lùi:
- `orders."createdAt"`, `"deliveredAt"`, `"shippedAt"`, `"deliveredEffectsAt"`;
- `points_transactions."createdAt"`, `"expiresAt"`;
- `coupons."startAt"`, `"endAt"`;
- `flash_sales."startAt"`, `"endAt"`.

### `db.mjs <lane> "<SQL>" [--unsafe] [--tpl]`: SQL trên DB lane, in JSON

Lệnh SELECT, WITH, SHOW, EXPLAIN, VALUES in ra mảng dòng. UPDATE, INSERT, DELETE in `{affected}`. DDL và lệnh khác cần `--unsafe`.
Script chỉ nhận `tubutree_uat_l1..8` trên 127.0.0.1:25432. Lane 9 (DB mẫu) cần thêm `--tpl`.
Kết quả thử ba chuỗi kết nối với hàm chặn trong `lib.assertLaneDb`:
```
postgresql://tubu@127.0.0.1:25432/tubutree_uat → Từ chối DB không phải tubutree_uat_l1..8/tubutree_uat_tpl trên 127.0.0.1:25432
postgresql://tubu@127.0.0.1:5434/tubutree_uat_l1 → Từ chối …
node db.mjs 1 "DROP TABLE users" → Lệnh "DROP" không phải SELECT/UPDATE/INSERT/DELETE — thêm --unsafe nếu cố ý
```
Đổi role bằng SQL chỉ có hiệu lực sau tối đa 5 giây, vì `SessionStateService` cache role và quyền. Cache này chỉ bị xoá khi khoá hoặc mở khoá user.

## Ca mẫu đầu-cuối (`node demo-case.mjs 1`): **PASS**

Khách quay lại đặt đơn COD trên Mini App thật. Admin xử lý đơn trên web admin thật. Giả Pancake báo giao xong. Sau đó chạy job và
đối chiếu sổ điểm bằng SQL. Script dọn giỏ khách trước khi đặt, nên chạy lại bao nhiêu lần cũng được.

Các bước trên UI:
1. Mini App: trang chủ, vùng "Mua lại", bấm "Mua lại".
2. Bấm "Thêm vào giỏ (1)", rồi "Thanh toán (1)".
3. Ở `/checkout`, kiểm radio COD đang chọn, rồi bấm "Đặt hàng · 430.000đ".
4. Web admin 1440: mở `/admin?tab=orders`, tìm mã đơn, bấm "Xem & Sửa", rồi "Đã đóng gói".

Đơn COD vào thẳng CONFIRMED lúc đặt (`checkout.service.ts:393`). Vì vậy bước "xác nhận" của admin là chuyển đơn sang khâu kho (PACKED).

Output thật trên lane 1 vừa copy từ mẫu (2026-10-19 22:45). Ảnh chụp ở `state/lane-1/shots/demo-1-checkout.png`, `demo-1-placed.png`, `demo-3-admin.png`:
```
[0.0s] 0 sổ điểm trước {"balance":34400,"ledgerSum":34400,"rows":1}
[0.0s] 0 dọn giỏ: 0 dòng
[4.2s] OK   Mini App: phương thức COD đang chọn
[4.3s] 1 báo giá {"subtotal":430000,"shippingFee":0,"total":430000,"pointsEarned":10320}
[4.7s] OK   Mini App: POST /checkout/place-order {"status":201,"code":"TUBU2026101933739"}
[4.7s] OK   Mini App: mọi request API (trừ đổi token Zalo) đi tới API lane thật, không lỗi {"total":18,"mocked":["/auth/zalo-mini-app"],"bad":[]}
[4.7s] OK   Mini App: không request nào ra ngoài (api.tubutree.com/Zalo/Sentry) {"blocked":[],"staticCdn":["https://h5.zadn.vn/static/fonts/ZMPIcons-Regular-v3.woff2"]}
[4.7s] OK   DB: đơn mới COD, CONFIRMED, của uat_returning {"status":"CONFIRMED","paymentMethod":"COD","total":430000}
[4.7s] OK   giả Pancake: đã nhận đơn (pancakeOrderId) {"pancakeOrderId":"9200001","fake":{"id":"9200001","status":0,"cod":430000,"custom_id":"TUBU2026101933739"}}
[9.8s] OK   web admin: PUT /admin/orders/:id/status → PACKED {"status":200}
[9.9s] OK   web admin: không request nào ra ngoài []
[9.9s] OK   DB: đơn PACKED sau thao tác admin {"status":"PACKED"}
[10.5s] 4 webhook shipped {"http":200,"event":"PROCESSED","order":"SHIPPING"}
[11.0s] 4 webhook delivered {"http":200,"event":"PROCESSED","order":"DELIVERED"}
[11.0s] OK   DB: đơn DELIVERED, deliveredEffectsAt đã ghi {"status":"DELIVERED","deliveredEffectsAt":"2026-10-19T15:45:50.491Z"}
[12.7s] 5 run-job DeliveredEffectsResyncCron.resyncPending {"lane":1,"job":"DeliveredEffectsResyncCron.resyncPending","ms":317,"result":{"scanned":0,"repaired":0,"failed":0}}
[12.7s] OK   job: không có đơn nào phải cộng điểm lại (webhook đã xong việc sau giao) {"scanned":0,"repaired":0,"failed":0}
[12.7s] 6 sổ điểm sau {"after":{"balance":44720,"ledgerSum":44720,"rows":2},"rows":[{"delta":10320,"reason":"ORDER_DELIVERED:TUBU2026101933739","lot":"STANDARD","refId":"cmvffewfl000yy7yt5tnx9evj"}]}
[12.7s] OK   SQL: đúng 1 dòng ORDER_DELIVERED:<mã> trỏ tới đơn
[12.7s] OK   SQL: điểm dòng sổ = điểm báo giá hứa (quote.pointsEarned) {"ledger":10320,"quote":10320}
[12.7s] OK   SQL: users.pointsBalance = trước + điểm đơn {"before":34400,"after":44720}
[12.7s] OK   SQL: users.pointsBalance = SUM(delta) sổ STANDARD {"balance":44720,"ledgerSum":44720,"rows":2}
[12.7s] 6 GET /me/loyalty (khách thấy) {"status":200,"body":{"pointsBalance":44720,…,"lockedPoints":10320,"lockedUntil":"2026-10-26T15:45:50.470Z","redeemablePoints":34400,"earnMultiplier":1.2}}
PASS (15 kiểm tra)
```
10.320 điểm = 430.000đ × 2% × 1,2. Hệ số 1,2 là hệ số của hạng Lộc Biếc, `/me/loyalty` báo là `earnMultiplier`. Điểm đơn bị khoá tới hết cửa sổ đổi/trả 7 ngày.

Tự đối chiếu bằng SQL:
```
$ node db.mjs 1 "SELECT u.\"pointsBalance\"::int AS balance, (SELECT SUM(delta)::int FROM points_transactions p WHERE p.\"userId\" = u.id AND p.lot = 'STANDARD') AS ledger_sum, (SELECT string_agg(reason || ' ' || delta, ', ' ORDER BY \"createdAt\") FROM points_transactions p WHERE p.\"userId\" = u.id) AS rows FROM users u WHERE u.id = 'uat_returning'"
[{"balance": 44720, "ledger_sum": 44720, "rows": "ORDER_DELIVERED:TUBU2026101960369 34400, ORDER_DELIVERED:TUBU2026101933739 10320"}]
```

## Giới hạn đã biết

1. **Zalo phía server không giả được.** API lane chạy với `ZALO_APP_SECRET` rỗng, nên các đường API tự gọi Zalo đều lỗi.
   - Đổi `locationToken` ra toạ độ: điểm thu rác gần nhất, chấm công theo vị trí (`attendance/zalo-location`).
   - Giải mã phoneToken thật.
   - `/auth/ensure-phone` được giả bằng cách ghi thẳng `phone` + `phoneVerifiedAt` khi user chưa có SĐT, rồi cấp token thật.
     Nhánh gộp khách → Zalo của `ensurePhoneForCurrentUser` vì vậy **không được thử**.
2. **Tin nhắn ra ngoài tắt hết:** Zalo OA/ZNS, ZaloPay, Gomdon (thu gom rác kèm đơn), AccessTrade, LLM.
   Bản ghi thông báo trong DB vẫn được tạo hay không: **chưa kiểm chứng**. Các luồng thu gom Gomdon và thanh toán ZaloPay không thử được trên lane.
3. `VITE_ZALO_OA_ID` không đặt, nên `hasOA = false`: Mini App ẩn các nút OA (theo dõi OA, chat OA).
4. Ảnh sản phẩm trong seed trống, nên ảnh chụp chỉ có khung xám.
5. API lane chạy **cron theo lịch thật**. Ví dụ `flash-sale.notify-started` chạy mỗi phút. Dữ liệu lane vì vậy có thể đổi theo giờ, không chỉ theo thao tác của agent.
6. Role hoặc nhóm việc đổi bằng SQL chỉ có hiệu lực sau tối đa 5 giây (cache `SessionStateService`).
   `seed-roles.mjs` chờ 5,5 giây trước bước cần quyền mới.
7. Lane 2 trùng cổng 3221–3223 của stack UAT đang chạy. Dùng lane 7 hoặc 8 thay thế.
8. Web lane là next dev. Lần đầu mở mỗi trang mất 10–20 giây để dịch. Bản sao `state/lane-N/web` nặng khoảng 82 MB và được chép lại mỗi lần bật web.
9. DB mẫu có hạn dùng: flash sale hết 2026-10-25 15:27Z, lô thẻ hết sau 60 ngày. Khi có migration mới hoặc dữ liệu hết hạn, chạy `build-template.sh` rồi `lane-up.sh N --fresh`.
10. Giả Pancake chỉ phục vụ các lời gọi có trong `pancake.client.ts` (đã liệt kê ở trên). Lời gọi Pancake mới mà giả chưa biết sẽ nhận 404 và được ghi ở `/__uat/requests`.
11. `miniapp-session` dựa vào tên module `node_modules/.vite/deps/zmp-sdk_apis.js` và khối `export {…}` của esbuild.
    Nếu Vite đổi cách đóng gói deps, `open()` sẽ ném lỗi rõ ràng chứ không âm thầm chạy SDK thật.
12. Ca mẫu chỉ chạy trên Chromium. `miniapp-session` đã mở được trang chủ và reload trên WebKit, nhưng toàn bộ ca mẫu trên WebKit **chưa kiểm chứng**.
    `web-session` trên WebKit cũng **chưa kiểm chứng**.

## Sự cố trong lúc dựng (để phiên perf biết)

Lúc 22:24–22:26 ngày 2026-10-19, `build-template.sh` (bản cũ) dùng **Redis db 9** cho lane 9 và đã `FLUSHDB` db 9 vài lần. Trong lúc đó
API perf 3229 (PID 20140, DB tubutree_perf@25434) của phiên khác cũng đang dùng db 9. Worker của API perf đã nhận một job webhook của lane 9
(job xong, nhưng sự kiện bên lane 9 kẹt RECEIVED). Ngược lại, các lần FLUSHDB có thể đã xoá hàng đợi hoặc đếm throttle của API perf.

Đã sửa: lane 9 chuyển sang db 15, và `lane-up.sh` từ chối bật API khi db Redis của lane đang có kết nối khác. Lúc 22:35,
`CLIENT LIST` không còn kết nối nào ở db 9.
