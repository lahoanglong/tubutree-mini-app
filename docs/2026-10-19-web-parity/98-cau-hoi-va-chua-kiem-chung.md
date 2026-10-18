# Web parity 2026-10-19: câu hỏi cho chủ dự án và mục chưa kiểm chứng

Nguồn: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-parity/docs/2026-10-19-web-parity/impl/` (10 file báo cáo lane). Chép nguyên văn; phần "Mặc định" là mặc định lane đã dùng.

## 1. Câu hỏi cho chủ dự án

### core (0 câu)
Không có.

### core-ui (5 câu)
- core-ui:1. `oa.follow()` trên web mở `https://zalo.me/<id>` và luôn trả false vì web không đọc được trạng thái theo dõi. Mặc định: giữ vậy.
- core-ui:2. `oa.openChat` web bỏ tham số `message` (link zalo.me không nhận nội dung). Mặc định: bỏ qua.
- core-ui:3. OA id có ký tự ngoài `[A-Za-z0-9_-]` coi như chưa cấu hình. Mặc định: coi như chưa cấu hình.
- core-ui:4. `share` web không tự gắn `?ref=`; bên gọi phải gắn. Mặc định: bên gọi gắn (chỗ hoa hồng/giới thiệu phải dùng đúng như Mini App).
- core-ui:5. Bản Mini App của bridge gọi thẳng `getStorage/setStorage` của zmp-sdk vì `zmp-bridge` không có storage chung. Mặc định: gọi thẳng, như nhiều file Mini App khác.

### core-api (3 câu)
- core-api:1. Các hàm hiển thị thuần còn ở Mini App (pointsReasonLabel, rewardCardState, checkInView, tierProgressPercent, rewardClaimView...): chuyển sang app-core ở lane nào? Mặc định: để từng lane trang tự chép, không chuyển trong lane này.
- core-api:2. Chuyển các service Mini App còn lại sang gọi app-core qua `coreHttp` khi nào? Mặc định: không làm, chỉ wishlist.
- core-api:3. Có encode path param (`/feed/${id}`...) ở app-core không? Mặc định: giữ y Mini App, không encode.

### core-shell (5 câu)
- core-shell:1. Hành vi nút "Mở trên Zalo" ở trang đăng nhập đổi thành deep link đúng màn (`/gio-hang` mở `/cart`). Mặc định: deep link đúng màn.
- core-shell:2. Web nay gửi `kind` và `storefrontSlug` trong `/affiliate/touch` từ `ReferralCapture`, ref được viết hoa. API so khớp không phân biệt hoa thường. Mặc định: giống Mini App; cần xác nhận API xử lý đúng.
- core-shell:3. Khi `?s=` không kèm ref và context gian hàng là nhãn (kind khác CTV) thiếu mã giới thiệu: web không gửi touch bằng slug, Mini App thì gửi. Mặc định: không gửi (an toàn hơn). Muốn giống hệt Mini App thì cần quyết.
- core-shell:4. Tên biến compose `ZALO_OA_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` do lane đặt; cần đặt giá trị ở môi trường deploy. Mặc định: dùng các tên này.
- core-shell:5. `/cashback` đặt `private: false` theo ma trận. Khi hết pending, `/hoan-tien` vào sitemap dù cờ `CASHBACK_ENABLED` tắt. Mặc định: giữ nguyên; lane loyalty cần cân nhắc. Đã xử lý ở b8a738bb (sitemap bỏ `/hoan-tien` khi `CASHBACK_ENABLED` tắt, có test trong sitemap.spec.ts); integ2 xác nhận lại.

### account (9 câu)
- account:1. Sàn test Mini App là 4214 hay 4243? Gate cho 4214; commit 35ef41ee ghi sàn 4214 sau khi nhánh đổi rác gỡ Refill. Mặc định: coi 4214 là đúng, lane không đụng file Mini App.
- account:2. Sau khi lưu hồ sơ web ở lại trang và báo "Đã cập nhật hồ sơ" thay vì quay lại như Mini App? Mặc định: ở lại.
- account:3. Sau khi lane order gộp, thông báo nhắc mua lại mở ReorderSheet hay giữ điều hướng? Mặc định: giữ điều hướng.
- account:4. Tin OPS_* và tin chỉ gửi admin có lọc hẳn khỏi danh sách thông báo web không? Mặc định: giống Mini App (còn trong danh sách, không có nút).
- account:5. Phím Esc trong quiz onboarding coi là "Để sau"? Mặc định: có.
- account:6. Đăng nhập để nhận mã: web quay lại đúng trang, bỏ `?claim=`, giữ mã trong localStorage, chỉ tự gọi POST /coupons/claim một lần mỗi mã. Mặc định: như vậy.
- account:7. Có sửa lỗi gửi lại `dob` của Mini App (edit-profile.tsx) ở lane khác không? Mặc định: không đụng.
- account:8. Cho phép sửa `lib/zalo-mini-app.ts` (core-shell) để `miniAppLink('/points/scan')` tra ngược được thay vì dùng `miniAppPathLink`? Mặc định: giữ `miniAppPathLink`.
- account:9. Ảnh đã cắt đổi sang Blob bằng atob (không fetch data:) vì CSP connect-src web không mở data:. Mặc định: giữ atob, không nới CSP.

### loyalty (5 câu)
- loyalty:1. Mini App có 4214 test, dưới mốc 4243 của luật. Lane không sửa hay xoá spec Mini App nào. Mặc định: coi sàn đúng là 4214 (commit 35ef41ee ghi sàn này). Xin xác nhận.
- loyalty:2. Có thêm dải thay `PointsBoostStrip` trên web không, và dùng chữ nào? Mặc định: không có.
- loyalty:3. `/hoan-tien` khi cờ tắt: đã bỏ khỏi sitemap; robots.ts vẫn allow. Mặc định: giữ vậy. Có muốn đánh dấu private không?
- loyalty:4. Có muốn thêm link dự phòng "Mở sàn" ngoài trường hợp popup bị chặn (chữ khác Mini App)? Mặc định: chỉ hiện khi bị chặn.
- loyalty:5. Có muốn chèn formatter để chuyển nốt các hàm chữ sang app-core, và hợp nhất `fingerprintOf`/`newIdempotencyKey` với `utils/idempotency.ts` của Mini App? Mặc định: không.

### shop (11 câu)
- shop:1. Web có cần gửi `search_performed`, `search_result_clicked`, `filter_applied` không, tới endpoint nào? Mặc định: không gửi.
- shop:2. Hai bản mua lại (`components/reorder/*` của shop, `components/orders/*` của order): giữ bản nào? Mặc định: giữ cả hai, bản shop đã khoá CTA sau thêm một phần; xử lý ở tích hợp.
- shop:3. Khối đại lý trên `/brand/[slug]`: có hiện "Đăng ký đại lý" cho mọi người đã đăng nhập và sửa test BUYERWEB-18 không? Mặc định: chỉ hiện cho người đã có hồ sơ đại lý, ẩn khi `/dai-ly` còn pending.
- shop:4. Bài mẫu chia sẻ nhãn cho người không phải CTV: mặc định không hiện, chỉ QR, link, nút chia sẻ.
- shop:5. Chữ dải tăng điểm Trang chủ đổi từ "Mua trong Mini App tích nhiều hơn" thành "Mua trực tiếp tại Tubu Tree ...": xác nhận chữ? Mặc định: chữ mới.
- shop:6. Giờ vàng ở Trang chủ chỉ link `/san-pham/{slug}` (không truyền variationId, trang sản phẩm tự chọn phân loại đang giờ vàng). Mặc định: như vậy, chưa kiểm bằng trình duyệt.
- shop:7. Sau đăng nhập quay về trang sản phẩm: chỉ tự mở lại sheet định kỳ, không tự tạo nhóm mua chung. Mặc định: như Mini App.
- shop:8. Có muốn bỏ nút "Xem thêm" thay cho `?page=N`, tức giữ cả hai như hiện tại? Mặc định: giữ cả hai (Xem thêm cho người dùng, link trang cho crawler).
- shop:9. Đặt định kỳ chọn chuyển khoản: sang `/tai-khoan/don-hang/<code>` vì `/thanh-toan/chuyen-khoan/:code` còn pending. Đổi khi lane order xong? Đã xử lý ở 095b105a (sang `/thanh-toan/chuyen-khoan/<code>` như Mini App).
- shop:10. Emoji trong chữ hiển thị đã bỏ để khớp quy ước; emoji nhận diện nhãn ở `lib/brand-origins.ts` giữ như Mini App. Mặc định: như vậy.
- shop:11. Số sàn test Mini App 4243 trong luật so với 4214 thực tế: sàn đúng là bao nhiêu? Mặc định: coi 4214 là mốc hiện tại.

### order (5 câu + 1 câu mới từ mục "Hoàn tất sau gate/review")
- order:1. Đổi CouponBox thành VoucherSheet như Mini App? Mặc định: giữ inline.
- order:2. Điểm dùng được ở thanh toán lấy từ `/me/loyalty` như Mini App? Mặc định: giữ `redeemablePoints` của báo giá.
- order:3. Sau lỗi mạng khi đặt, nếu khách đổi lựa chọn thì chặn và báo "Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại." (lệch đề xuất gốc). Mặc định: chặn một lần, bấm sau gửi đơn mới.
- order:4. "Theo dõi ngay" OA trên web chỉ mở trang OA và luôn trả false; chữ báo "Đã mở trang Tubu Tree trên Zalo, bấm Quan tâm...". Mặc định: chữ này, do tôi tự chọn.
- order:5. Nút Thanh toán ở hub `/tai-khoan` dẫn tới trang chuyển khoản thay vì chi tiết đơn? Mặc định: giữ nguyên (lane account). Đã xử lý ở 095b105a + 9b91a9ce (xét hạn/xử lý tay như canPayOrderNow, chữ Thanh toán ngay, in hạn; nút Thanh toán ở hub dẫn `/thanh-toan/chuyen-khoan/<code>`, giống `onPay` của Mini App `orders.tsx:118`).
- order:6 (mới, mục 6 "Hoàn tất sau gate/review"). Lệch Mini App ở đặt đơn: web đóng băng body và key sau lần chưa rõ kết quả (Mini App đổi key khi fingerprint đổi, có cùng lỗ hổng khi nạp lại lúc có mạng). Giữ lệch cho web, hay sửa cả Mini App? Mặc định: giữ lệch ở web, không đụng Mini App.

### affiliate (6 câu)
- affiliate:1. Mini App và web chỉ đặt tên bộ sưu tập; API cho phép COMBO/bố cục/% giảm combo (trần `storefront.max_combo_pct`, mặc định 30). Có mở giao diện này cho cả hai nền tảng không? Mặc định: không, web giống Mini App.
- affiliate:2. Trang `/thanh-toan/chuyen-khoan/:code` còn pending. Mặc định: dẫn sang `/tai-khoan/don-hang/:code` (có QR); khi route mở sẽ hiện "Mở trang thanh toán (gửi khách)". Đã đúng từ lane affiliate (ctv-order-sheet.tsx:249-266, test ctv-order-sheet.spec.tsx:267); integ2 khoá route map ở a1bb2cca (route đã mở nên link "Mở trang thanh toán (gửi khách)" hiện và trỏ `/thanh-toan/chuyen-khoan/<code>`; test ctv-order-sheet.spec.tsx khoá cả hai nhánh).
- affiliate:3. Tạo gian hàng xong mà áp mẫu lỗi: giữ sheet mở, chọn lại gọi lại `POST /storefront` (giống Mini App). Mặc định: không đổi.
- affiliate:4. Nút "Xem trước" khi còn nháp báo cần đăng trước, không điều hướng (giống Mini App).
- affiliate:5. `shareLink` tuyệt đối của nơi khác: nút Chia sẻ chép bài mẫu kèm link. Mặc định: dùng cách này.
- affiliate:6. Nhãn trạng thái đơn cạnh dòng hoa hồng dùng chữ Mini App ("Giao thành công"), khác "Đã giao" ở danh sách đơn web. Mặc định: giữ chữ Mini App.

### game (6 câu)
- game:1. EcoImpact ở tab Vườn hay Hôm nay? Mặc định: tab Vườn như Mini App (đổi một dòng trong `page.tsx`).
- game:2. FriendGifts ở Cộng đồng, CommunityGoal ở Vườn (như Mini App), dù mô tả task ghi ngược lại. Mặc định: như Mini App.
- game:3. Chữ khung đăng nhập: "Đăng nhập để xem cộng đồng" và nút "Đăng nhập với Zalo" của `LoginRequired` chung. Mặc định: giữ như vậy.
- game:4. Nút "Dùng ngay" khi trúng voucher đi tới `/san-pham`. Mặc định: `/san-pham`.
- game:5. Khách chưa đăng nhập vào /tu-van khi server tắt AI vẫn bị đưa về `/`, không hiện cổng đăng nhập. Mặc định: về `/`.
- game:6. Có cần chạy lại gate khi máy rảnh để có summary xanh? Mặc định: chưa chạy.

## 2. Chưa kiểm chứng / cố ý để lại

### core (6 mục)
- `route-map.json` chỉ là stub `{ routes: [], features: [] }`.
- `core-http-server.ts` chép lại `BASE` và logic header bypass của `lib/api.ts` (không export, file thuộc lane khác). Muốn một nguồn thì lane sở hữu `api.ts` export rồi adapter import lại.
- Chưa có import giá trị app-core trong mã web thật; lane `core-api` hoặc `shop` là lần kiểm chứng đầu tiên.
- Script `lint` của app-core là `tsc --noEmit`.
- Không chạy Playwright.
- `apps/miniapp/package.json`, `apps/web/package.json` đã sửa; lane khác sửa hai file này cần rebase theo 06028ebe.

### core-ui (10 mục)
- Chưa chuyển code Mini App cũ sang dùng bridge (theo spec lane); không sửa `zmp-bridge.ts`.
- Chưa chạy spec Web Admin qua gate; gate chạy 1 worker nên mất khoảng 2 phút 20 giây cho 2 spec.
- `web-gate.sh` sau hai lần sửa review chưa chạy lại e2e (không chạy Playwright trong lượt review).
- `lint-parity` bị bỏ qua vì chưa có script.
- `web-gate.sh` không chạy `pnpm build`; cần `shared-types` đã có `dist`.
- Câu chữ global-setup vẫn ghi "từ api/.env" dù secret nay lấy từ `process.env`.
- Không tách QuantitySelector cho add-to-cart (khác giao diện và cách kẹp số lượng, đổi sẽ đổi hành vi). PageHeader dùng `backHref` (Link), không có nút lùi lịch sử như Mini App. Sheet không có hoạt ảnh đóng.
- Lane core-shell đang tách mảng `MIGRATED`; 10 dòng `components/ui/*.tsx` ở cuối mảng có thể phải gộp tay.
- `bridge.ts` vốn chỉ có type, nay có thêm hàm runtime `isHttpUrl`.
- Primitive: spec và code viết cùng lượt, không ghi nhận lần đỏ riêng.

### core-api (6 mục)
- Cố ý không chép: cơ chế gộp request Trang chủ (`takePublicBlock`/`takeMeBlock`), `cartStorefrontSlug()` (giỏ nhận `storefrontSlug` qua tham số), phần chặn báo lặp của `reportLaunchLinkClick` (đổi thành `reportLinkClick`, chặn lặp ở nơi gọi), `acquireLocationPayload`, `rewardClaimView`, `vnLastDayLabel`, các hàm hiển thị thuần của điểm/hạng, `invalidateAfter*` cần QueryClient.
- Chưa chuyển Mini App sang gọi app-core (trừ wishlist); `getNewCustomerOffer`/`getNotifications` của app-core là GET thẳng, không qua khối gộp `/home/me`.
- Đường dẫn nối chuỗi (`/feed/${id}`, `/game/quiz/${id}/answer`...) giữ nguyên không encode như Mini App. `getFeed` truyền khoá undefined trong query; adapter web cần bỏ khoá undefined (chưa kiểm).
- Việc 2, 3, 4, 5: spec viết sau hoặc cùng lúc với code, không có lần chạy đỏ trước (sai TDD). Spec dealer/attendance tự viết bảng từ mã nguồn vì Mini App không có bảng để chép.
- Playwright không chạy (đúng luật lane). Không push, không deploy.
- Một lần gate run3 bị dừng vì tsc lỗi, thư mục đổi tên `run3-aborted`.

### core-shell (8 mục)
- Chưa viết Playwright cho vỏ web (không thuộc mục của lane); không chạy Playwright.
- Badge đơn trên web không có tối ưu `takeMeBlock('activeOrderCount')` như Mini App.
- Dockerfile, compose, `.env` mới chỉ được `next build` kiểm gián tiếp; chưa build Docker thật (chưa kiểm chứng).
- Redirect trỏ tới route web còn pending sẽ cho 404 đến khi lane tương ứng xoá cờ pending.
- `isWebRouteReady` trả false cho đường dẫn không có trong map (chọn an toàn).
- `robots`: `/cong-dong` và `/doi-rac/quy-dinh` có allow và disallow cùng độ dài, dựa vào quy tắc allow thắng của Google; bộ thu thập khác có thể hiểu khác.
- Ca test `miniAppLink('/gio-hang')` cũ đã đổi: nay mở `/cart` thay vì trang chủ Mini App.
- Gate đầy đủ chưa chạy lại sau lần xanh lại file edit-profile.

### account (10 mục)
- Chưa chạy Playwright: các ca trong `apps/e2e/tests/account.web.spec.ts` (hub/hồ sơ, cài đặt, thông báo, giới thiệu, xoá tài khoản, nhận mã, onboarding) chỉ mới viết. Vòng đăng nhập Zalo OAuth thật cũng chưa kiểm.
- Đường tải ảnh Cloudinary chỉ có test đơn vị.
- REORDER_REMINDER: nút "Mua lại ngay" chỉ điều hướng, chờ ReorderSheet của lane order (nối tại `notification-view.ts`, kind `reorder`).
- Không chép: sự kiện analytics `notification_opened`, dòng phiên bản, hoạt ảnh/popstate của overlay chi tiết, `settings-legacy-sync`.
- Hàng "Theo dõi Zalo OA" luôn hiện "Theo dõi" (web không đọc được trạng thái theo dõi).
- Nút hành động thông báo và mục menu trỏ route lane khác sẽ ẩn cho tới khi route bỏ pending. Đã xử lý ở a1bb2cca (đích đã mở, trừ route của pro/recycle vẫn ẩn).
- Tiêu đề/noindex spec: `/gioi-thieu` là trang công khai nên không đưa vào page-titles, guest-auth-gate, session-unavailable.
- Mini App có cùng lỗi gửi lại `dob` (edit-profile.tsx); không sửa theo luật lane.
- Mục Mã giảm giá ở hub dẫn tới `/tai-khoan/diem-xanh`; lane loyalty cần đảm bảo trang đó có phần mã giảm giá.
- Thông báo spec in một dòng stderr jsdom "Not implemented: navigation", test vẫn xanh.

### loyalty (11 mục)
- Playwright chưa chạy; e2e chưa kiểm chứng.
- `use-idempotency-key` giữ hai bản (web, Mini App): app-core cấm import react (forbidden-imports.spec).
- Các hàm chữ dùng formatter (moneyShort, redeemRuleLine, tierThresholdLabel, expiringPointsNote, pointExpiryPolicyNote) vẫn ở từng app vì formatter cố ý khác nhau (web theo giờ VN, Mini App theo giờ máy).
- `tierProgressPercent` có hai bản giống công thức: Mini App giữ bản riêng vì guard `points-lots-guard.spec.ts` của Mini App (không được sửa).
- Bỏ dải `PointsBoostStrip` ("Mua trong Mini App tích gấp đôi").
- Nút chép mã chỉ dùng `navigator.clipboard`, không có dự phòng `execCommand`.
- `getMyPointsLock` trong `shop-client.ts` không còn trang nào dùng, chưa xoá.
- Lịch sử Điểm Xanh web dùng `pointsReasonDetail` và tối đa 100 dòng, Mini App dùng `pointsReasonLabel` và 20 dòng.
- Kho quà dùng LedgerShell (liên kết "← Tài khoản") thay PageHeader có nút quay lại.
- Lịch sử git có hai commit cho mục win.closed (0a313590 chỉ spec đỏ, 7233d78b code).
- Khách chưa đăng nhập trong sheet sàn thấy "Đăng nhập để nhận hoàn tiền" thay vì bấm rồi nhận 401.

### shop (12 mục)
- Playwright chưa chạy: `shop.web.spec.ts` chưa kiểm chứng; path mock và tên nút chưa thử trên trình duyệt. Ca PDP tự skip khi DB e2e rỗng.
- Sự kiện analytics tìm kiếm không gửi (web chưa có tầng analytics).
- Dòng "Nhận tối đa N Điểm Xanh" và dải tăng điểm ở trang sản phẩm (`PointsEarnLine`, `PointsBoostStrip`) chưa làm; 02-ke-hoach không giao rõ.
- Trang chủ bỏ gộp request `/home`+`/home/me`, kéo để làm mới, nhớ số ô khung chờ.
- Web không có snackbar: dùng dòng `role=status`/`alert`; mua lại một phần thì sheet ở lại kèm "Xem giỏ".
- `components/product-pagination.tsx`, `homeHref`/`pageHref` trong `lib/catalog-filter.ts` không còn nơi dùng, để nguyên.
- Link tới route lane khác (`/tu-van`, `/cong-dong`, định kỳ) bị ẩn khi pending, hiện lại khi route hết pending. Đã xử lý ở a1bb2cca (`/tu-van`, `/cong-dong`, định kỳ đều đã mở).
- Chưa kiểm chứng middleware xử lý `/san-pham` trên host CTV.
- Chat OA chỉ mở `zalo.me/<oaId>` không kèm nội dung câu hỏi. Nút chia sẻ ghi "Chia sẻ" thay vì "Chia sẻ Zalo".
- Nút Tham gia/Theo dõi khi phiên unavailable gọi retrySession.
- Một số spec chép từ Mini App (share-link, brand-origins, search-state...) hoặc viết cùng lúc với code, không có bước đỏ trước.
- Sửa ngoài chủ file (không đổi hành vi): `apps/e2e/tests/web-customer.web.spec.ts`, `lib/next-config-redirects.spec.ts`, `components/site-header.spec.tsx`, `site-search.tenant.spec.tsx`, `guest-pages.a11y.spec.tsx`, `test-utils/render-hook.tsx` (mới).

### integ2/integ4 (2 mục)
- QR trên đơn quá hạn: web không dựng QR khi quá hạn như `canPayOrderNow` của Mini App. Đã xử lý ở c63e6ea2.
- Gom mọi chỗ nối `/thanh-toan/chuyen-khoan/...` về `bankPaymentHref`. Đã xử lý ở 42134975.

### order (10 mục)
- VoucherSheet: giữ CouponBox inline.
- Chưa chuyển các hàm giỏ và đặt đơn sang `@tubutree/app-core/api/*`; vẫn dùng `@/lib/shop-client`.
- Giỏ chưa có debounce 380ms, optimistic update, StorefrontContextBar, SuggestedRail khi rỗng.
- Chưa đối chiếu màn thành công với OrderSuccess; điểm dùng được lấy từ báo giá.
- Chưa có analytics mua lại (web chưa có lớp analytics).
- Trang chi tiết đơn chỉ dựng panel QR nội tuyến khi `canPayNow` (còn hạn), đơn quá hạn hiện hạn và chữ tự huỷ; đã xử lý ở c63e6ea2, chưa kiểm chứng trên trình duyệt. Nút Thanh toán ở hub `/tai-khoan` (lane account) vẫn dẫn tới chi tiết đơn.
- Link "Thu kèm rác" ẩn tới khi lane recycle mở `/doi-rac/tao`.
- TDD không trọn ở `checkout-waste`, `use-remaining`, `reorder.ts`, `orders-tabs.ts`, `subscription-price.ts`, `oa-prompt.ts` (spec viết cùng lượt).
- Đã sửa spec cũ của lane: checkout-idempotency, checkout-waste, order-actions (ngày tương đối), guest-pages.a11y; `checkout-race.spec` nay mount cùng SiteHeader.
- Chưa chạy Playwright: các ca trong `order.web.spec.ts` chưa kiểm chứng.

### affiliate (5 mục)
- Playwright không chạy (luật cứng): `apps/e2e/tests/affiliate.web.spec.ts` mới chỉ typecheck; selector GeoPicker và ô tìm sản phẩm có thể cần chỉnh.
- Mini App không có chọn năm cho bảng kê thuế nên web cũng không thêm.
- Lệch hành vi đã biết: web chờ config cho cả ví (Mini App chỉ chờ cho BANK), theo app-core `withdrawView`.
- Spec `ctv-order-sheet` chạy khoảng 30 giây; nếu timeout do tải thì chạy lại riêng.
- Đưa `/ctv` vào menu/hub tài khoản thuộc lane khác, chưa sửa.

### game (8 mục)
- Chưa kiểm tra giao diện thật (máy tính, 320px): không chạy Playwright, chỉ viết spec.
- Gate chưa có một lần xanh trọn vẹn (xem mục 2).
- Season pass ẩn theo cờ `SEASON_PASS_ENABLED=false`, API không được gọi.
- Link đổi rác và link Bảng tin cộng đồng chỉ hiện khi `/doi-rac`, `/cong-dong` đã bỏ pending (lane khác). Đã xử lý ở a1bb2cca cho `/cong-dong`; `/doi-rac` vẫn pending (lane recycle).
- Haptic không có bản web, bỏ qua.
- Nút Gửi của /tu-van chỉ báo đang gửi bằng `aria-busy`, không có spinner.
- Spec /tu-van có 28 test so với 29 của Mini App (gộp vài ca, cùng ý nghĩa).
- Mini App gọi sớm các truy vấn board, community, friends...; web gọi theo khối dùng chúng.
