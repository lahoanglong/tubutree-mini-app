# Lane 5 và 6 (review 2026-10-28)

Mọi lệnh cần: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
`H=docs/2026-10-20-uat/tools/uat-harness`, `R=docs/2026-10-28-review` (chạy từ gốc worktree `review-1028`).
Mã đang chạy là CHÍNH worktree này (main 9d0e95bd5): API `apps/api/dist` build 28/10, web next dev từ bản sao `state/lane-N/web`, Mini App Vite.

## Hạ tầng dùng chung
- Postgres nhúng 25432: `docs/2026-10-20-uat/tools/pg-native.sh start 25432` (dữ liệu ~/.cache/tubu-uat/data-25432).
- Redis 26379: container `tubu-uat-redis`. Bật lại khi mất:
  `docker run -d --rm --tmpfs /data --name tubu-uat-redis -p 127.0.0.1:26379:6379 redis:7-alpine redis-server --save "" --appendonly no`
  (`--rm --tmpfs` nên mất container là mất cả dữ liệu Redis; sau đó chạy `lane-up.sh` lại và nạp lại hàng đợi nếu cần).
- DB mẫu `tubutree_uat_tpl` dựng 25/10, THIẾU migration mới. DB lane copy từ mẫu rồi phải `prisma migrate deploy` (bước dưới). Kiểm: `_prisma_migrations` 236 dòng đã xong = 236 thư mục migrations.

## Bảng lane

| Lane | Dùng cho | API | Web | Mini App | Giả Pancake | DB | Redis db | params |
|---|---|---|---|---|---|---|---|---|
| 5 | chụp ảnh | http://localhost:3251/api | http://localhost:3252 | http://localhost:3253 | 3258 | tubutree_uat_l5 | 5 | `R/tools/params-l5.json` |
| 6 | đi luồng | http://localhost:3261/api | http://localhost:3262 | http://localhost:3263 | 3268 | tubutree_uat_l6 | 6 | `R/tools/params-l6.json` |

Web dùng host `localhost`, không dùng 127.0.0.1. Env lane: `$H/state/lane-N/lane.env`; log: `$H/state/lane-N/logs/`.

## Persona (13 user trong DB, thêm `guest` không có user)
`returning` (Lộc Biếc, 4 đơn mẫu đã giao + đơn chuyển khoản chờ + giỏ có 2 dòng + yêu thích 2 + nhóm mua chung + bài cộng đồng),
`new` (SĐT đã xác minh, chưa đơn), `new_nophone`, `guest` (Mini App tự gọi /auth/guest), `ctv` (gian hàng /s/uatctv đã duyệt),
`ctv_pending`, `dealer` (DEALER_2), `staff`, `kho`, `ketoan`, `marketing`, `cskh`, `brand` (chủ nhãn Fuwa3e), `admin`.
Chi tiết bí danh, SĐT, id: `$H/personas.json` và `$H/README.md`. Đổi role/nhóm việc bằng SQL có hiệu lực sau tối đa 5 giây.

## Dữ liệu seed (`R/tools/seed-data.mjs`)
`node $R/tools/seed-data.mjs --lane N all` (pre + post + bank + extra) ghi `params-lN.json`: groupBuyId, postId, eventId, courseId,
wastePointId (kho "Điểm nhận Tubu Quận 1"), wasteDoneId (đã xác nhận), wasteRequestId (đang mở), bankOrderCode (đơn chuyển khoản
`PENDING_PAYMENT`, giỏ returning còn 3 món), orderCode (đơn đã giao có sẵn trong mẫu).
Cờ đã bật: `waste.enabled`, `chat.enabled`, `loyalty.marketplace_claim_enabled`, `waste.lane_pickup_enabled` (nhận tại điểm `waste.lane_dropoff_enabled`
và gửi bưu điện `waste.lane_mailin_enabled` đã bật sẵn trong mẫu). Bật/tắt lại: `seed-data.mjs --lane N flags on|off`.
Lỗi biết trước khi seed (không phải hỏng): `POST /admin/waste/points/:id/staff` 400 (kho Tubu không gắn người); yêu cầu đổi rác thứ hai bị 409 hạn mức ngày, `extra` tạo lại bằng vật phẩm khác.
Ảnh sản phẩm trong seed trống nên ảnh chụp chỉ có khung lá.

## Route (`R/tools/routes.json`, lane 5)
Dựng bằng `node $R/tools/build-routes.mjs --lane 5` từ `packages/app-core/src/route-map.json` + `params-l5.json`.
Có: 58 route Mini App, 63 trang web khách, 43 mục admin (42 tab + `/admin/pos`), 54 cặp Mini App/web, 11 tab admin dùng hằng ngày (`adminDaily`).
Không chụp (ghi ở `skips`): `/refill` (chuyển sang /recycle), `/khoi-phuc/[hint]`, `/product/[slug]` (307), `/dang-nhap/callback`.
Đã đối chiếu: mọi `<Route path>` trong `apps/miniapp/src/components/app.tsx` đều có (trừ `/refill`, chuyển hướng); mọi `page.tsx` web đều có (trừ ba trang trên).
Dựng cho lane 6: `build-routes.mjs --lane 6` ghi đè routes.json, nên chỉ chạy khi cần (đổi lane thì capture in cảnh báo).

## Chụp ảnh (`R/tools/capture.mjs`)
```
node $R/tools/capture.mjs --list
node $R/tools/capture.mjs --lane 5 --phase mini375 [--state ok] [--keys key|home,cart] [--filter chuỗi] [--limit n] [--force]
```
Khổ: `mini375 mini1280 web375 web768 web1280 admin1280 admin375`. Trạng thái: `ok loading slow5s error500 offline empty longtext`
(định nghĩa ở đầu file). Trạng thái khác `ok` chỉ chạy 17 màn của `KEY_SCREENS` (đổi bằng `--keys`).
Ảnh `R/screens/<nhãn>/...png`; index `R/screens/index-<nhãn>.jsonl` (mỗi nhãn một file, chạy song song hai tiến trình an toàn nếu khác nhãn).
Mỗi dòng: files, apiCalls, apiErrors (status ≥400; request bị abort mang status 0), consoleErrors, pageErrors, blank, hasRetry, hasSkeleton, axe, smallTargets, textHead, msToIdle (slow5s thêm `s1`).
Lệnh mẫu: `node $R/tools/capture.mjs --lane 5 --phase mini375,mini1280 --keys key` ; `... --phase web375 --state error500,offline --keys key`.
Ghi chú: `offline` và `error500/empty/longtext` miễn `/api/auth/*` (đăng nhập lại sau nạp trang cần token), `empty` còn miễn `/api/me`; `loading`/`slow5s` làm chậm cả auth.
Resume: ô đã có trong bất kỳ index nào thì bỏ qua; muốn chụp lại dùng `--force` hoặc xoá dòng index.
Đã chụp thử 2 ô mỗi khổ + mỗi trạng thái (cart/home/orders/tab-orders/tab-dashboard); ảnh thử vẫn nằm trong `R/screens/` và được coi là đã chụp. Xoá (tay) `R/screens/*` trước khi chụp thật nếu muốn sạch.
Bộ khung `miniapp-session.mjs`, `web-session.mjs` đã được thêm tuỳ chọn `viewport` + `consoleErrors` (chép từ bản chưa commit ở worktree ux-review).

## Bật lại lane / dừng
```
$H/lane-up.sh 5 --web          # giữ DB, bật API/Pancake giả/Vite/web còn thiếu
$H/lane-up.sh 5 --web --fresh  # xoá DB, copy lại từ mẫu (cần lane-down trước)  -> PHẢI migrate lại rồi seed lại:
  ( cd apps/api && DATABASE_URL=$(grep ^DATABASE_URL= ../../$H/state/lane-5/lane.env | cut -d= -f2-) npx prisma migrate deploy )
  (bật lại API: lane-down.sh 5 && lane-up.sh 5 --web) ; node $R/tools/seed-data.mjs --lane 5 all ; node $R/tools/build-routes.mjs --lane 5
$H/lane-down.sh 5              # dừng cả cây tiến trình (không --drop để giữ DB)
```
Sau `--fresh` thứ tự đúng: `lane-down` → `lane-db.mjs create N --fresh` → migrate deploy → `lane-up --web` → seed.
Mã `apps/` đổi thì build lại: `pnpm --filter @tubutree/shared-types build` rồi `(cd apps/api && pnpm build)` và khởi động lại API lane.

## Tạo đơn, duyệt đổi rác bằng bộ khung
- Token: `T=$(node $H/mint-token.mjs 6 returning)`; header `x-throttle-bypass` lấy từ `grep ^THROTTLE_BYPASS_TOKEN= $H/state/lane-6/lane.env`.
- Đặt đơn thật qua UI: `node $H/miniapp-session.mjs 6 returning --path /cart`, hoặc `node $H/demo-case.mjs 6` (COD → admin đóng gói → giao → điểm, dòng cuối PASS/FAIL).
- Đặt đơn qua API: `POST /checkout/place-order {addressId, paymentMethod: COD|BANK_TRANSFER}` + header `idempotency-key` (xem hàm `bank()` trong seed-data.mjs).
- Đơn đổi trạng thái: `node $H/pancake-webhook.mjs 6 <mãĐơn> confirmed|packed|shipped|delivered|...`; chuyển khoản: `node $H/bank-webhook.mjs 6 <mãĐơn> <số tiền> "<mãĐơn> thanh toan"`.
- Đổi rác: tạo `POST /waste/requests {method:'DROP_OFF', pointId, lines:[{itemId, declaredQty}], consent:true}` bằng persona returning (header idempotency-key);
  duyệt `POST /admin/waste/requests/:id/confirm {lines:[{itemId, declaredQty, receivedQty}]}` bằng persona admin (hoặc `staff` ở quầy `/recycle/desk`). Hàm `mk` trong `post()` của seed-data.mjs là mẫu.
  Hạn mức ngày theo vật phẩm: 409 "hôm nay bạn chỉ còn mang tới điểm nhận được N" thì đổi vật phẩm (`/waste/items`) hoặc lùi ngày bằng `db.mjs`.
- Đơn sàn/tích điểm: giả Pancake `$H/state/lane-N/pancake/platform-orders.json`; mã mẫu `SPXVN05UAT0001..2`.
- SQL: `node $H/db.mjs 6 "SELECT ..."`; job: `node $H/run-job.mjs 6 points.expire`.
- Mỗi API lane chạy cron thật theo lịch (flash sale, nhắc...), dữ liệu có thể đổi theo giờ.
