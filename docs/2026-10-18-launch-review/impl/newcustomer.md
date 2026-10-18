# Gói newcustomer: khách mới thấy ưu đãi ngay, chữ không nói sai số (D2-07, D2-06, D5-07, D5-10, D7 việc 1)

Nhánh `lr/newcustomer`, tách từ `review/2026-10-18-launch`. Sáu mục, mỗi mục một commit. Không chạm file đang bị phiên đổi-rác giữ (`app.tsx`, `checkout.tsx`, `loyalty.tsx`, `game.tsx`, `modules/checkout/*`, `seed.ts`): `git diff --name-only` cho cả nhánh không có file nào trong danh sách đó.

Ba khoá SystemConfig mới, đều có mặc định trong mã, có luật ghi ở `system-config.service.ts` và nằm trong danh sách khoá nạp tham chiếu (`config-selection.ts`, `APPROVED_LOADED_KEYS`):

| Khoá | Mặc định | Luật ghi | Việc |
|---|---|---|---|
| `home.new_customer_layout` | `false` | chỉ boolean | đổi thứ tự khối Trang chủ cho khách chưa có đơn |
| `community.public_preview` | `false` | chỉ boolean | khách chưa đăng nhập xem trước vài bài cộng đồng |
| `dealer.review_hours` | `24` | số nguyên 1 đến 720 | chữ "xét duyệt trong N giờ" ở trang đăng ký đại lý |

## 1. Đã làm gì

### D2-07a: cấp voucher chào mừng ngay khi tạo tài khoản thật (`fdfc8a1a`)

- `VouchersService.grantWelcomeNow(userId)` dùng đúng điều kiện và đúng `grant()` của cron `welcomeVouchers` (khách thật, role CUSTOMER, chưa có đơn, tạo trong 24 giờ, mã tất định `WELCOME-<USERID>`, mệnh giá và đơn tối thiểu đọc từ `voucher.welcome_amount` / `voucher.welcome_min_order`). Không đổi mệnh giá, điều kiện hay hạn 30 ngày. Cron mỗi giờ vẫn chạy làm lưới an toàn.
- `AuthService` gọi hàm này ở ba chỗ tạo hoặc nâng tài khoản thật: đăng nhập Zalo Mini App lần đầu, đăng nhập OAuth lần đầu, và `ensurePhoneForCurrentUser` khi tài khoản khách vãng lai được nâng tại chỗ thành tài khoản Zalo thật. Khách vãng lai (zaloId `guest_*`, không số điện thoại) không được cấp. Lỗi cấp bị nuốt và ghi log, không làm rớt đăng nhập; cron cấp bù ở lượt sau.
- Chống cấp trùng nhờ mã tất định (`coupon.code` unique) và `grant()` nuốt P2002.
- Chưa có công tắc tắt voucher chào mừng: luật ghi `voucher.welcome_amount` có min 1.000đ, nên đường cấp ngay chạy y như cron. Đây là hành vi cũ, không đổi.
- Race test trên Postgres thật: `apps/api/test/integration-race/welcome-voucher-signup.race-spec.ts` (7 ca): 8 tài khoản đăng nhập lần đầu song song với 2 lượt cron mỗi tài khoản đúng 1 voucher và 1 thông báo; ép hai lần cấp ngay cùng qua cửa kiểm trùng (barrier trên `coupon.findUnique`) thì một bên thua P2002 nhưng trả false, không ném lỗi; ép cấp ngay và cron cùng qua cửa kiểm trùng; 5 lần đăng nhập lại song song; khách vãng lai, tài khoản có đơn, tài khoản quá 24 giờ không được cấp; nâng khách vãng lai song song với cron; cấp ngay lỗi thì cron cấp bù đúng 1 mã. Đã kiểm đột biến: bỏ nhánh nuốt P2002 thì ca "ép hai lần cấp ngay" đỏ.
- File chính: `vouchers/vouchers.service.ts`, `vouchers.module.ts` (export), `auth/auth.service.ts`, `auth.module.ts`.

### D2-07b + D7 việc 1: khối "Quà khách mới" ở Trang chủ Mini App và Trang chủ web (`47dfb06e`)

- API `GET /me/new-customer-offer` (`loyalty.service.ts#getNewCustomerOffer`) trả `isNewCustomer` khi là khách thật (`isRealUser`, cùng luật voucher chào mừng và freeship đơn đầu) và theo định nghĩa đơn đầu có sẵn (`common/first-order.ts`, `hasPriorOrder`: chưa có đơn nào ngoài `CANCELLED`) và voucher chào mừng còn dùng được của khách (nếu có). Mã voucher dựng bằng hàm dùng chung `vouchers/voucher-code.ts`, cùng với cron.
- Config công khai tách thành `system-config/public-config.ts#buildPublicConfig`, dùng chung cho `GET /config/public` và khối `publicConfig` của `GET /home`, nên hai nơi luôn cùng số. `/home` và `/home/me` gộp thêm `publicConfig` và `newCustomerOffer`; Trang chủ vẫn chỉ gọi đúng 2 request (spec `home-requests.spec.tsx` giữ nguyên ngân sách).
- Miniapp: `components/home/new-customer-gift.tsx`. Hiện voucher của khách (nếu có) và 3 lợi ích mua trực tiếp: freeship (đơn đầu nếu `shipping.first_order_free_enabled` bật, không thì theo ngưỡng `shipping.free_threshold`), Điểm Xanh (mỗi X đồng được 1 điểm, 1 điểm giảm Y đồng), đặt định kỳ giảm P%. Mọi số lấy từ config công khai; thiếu số (API cũ) thì bỏ dòng. Khách chưa đăng nhập chỉ thấy phần lợi ích. Chưa biết có phải khách mới (đang tải) hay lỗi thì không vẽ gì, không có khung chờ (xem mục 3c, L1). Vùng chạm nút ≥ 44px, dùng token DS v2.
- Thứ tự khối (`home-blocks.ts`): cờ `home.new_customer_layout` tắt (mặc định) thì giữ nguyên thứ tự cũ, khối `welcome` đứng sau Danh mục, trước "Dành cho bạn". Cờ bật thì khách mới thấy `search, purchased, orderStrip, welcome, categories, flash, ...`: quà và danh mục lên ngay sau ô tìm và dải đơn, trước giờ vàng. Khách cũ không đổi.
- Web (`apps/web/src/app/page.tsx`): thêm hàng danh mục dưới hero (`<nav aria-label="Mua theo danh mục">`, chỉ danh mục còn hàng, liên kết `/?category=<id>#san-pham`, cao ≥ 44px; bấm lại danh mục đang chọn thì bỏ lọc). `category` chỉ nhận id có thật trong danh sách (chuỗi tuỳ ý trên URL không đi xuống API), giữ nguyên khi đổi nhãn hàng hoặc phân trang. Trang lọc theo danh mục `noindex` (cùng sản phẩm với trang chủ) và không in canonical riêng. API danh mục lỗi thì bỏ hàng này, lưới sản phẩm vẫn hiện. Ba cam kết gộp thành một hàng ba ô ở mọi cỡ màn hình (điện thoại chỉ giữ tiêu đề). Chữ của ba cam kết giữ nguyên, không đụng tới D5-08.
- File chính: `loyalty/loyalty.service.ts`, `catalog/home.service.ts`, `system-config/public-config.ts`, `miniapp/components/home/*`, `miniapp/pages/home.tsx`, `web/src/app/page.tsx`, `web/src/lib/api.ts`, `web/src/lib/catalog-filter.ts`.

### D2-07c: dòng điểm ở trang sản phẩm (`6c196feb`)

- Tách công thức tích điểm thành `pricing/points-earn.ts#pointsForGoods`; `PricingService.calcPointsEarned` (hàm server dùng khi chốt đơn) gọi lại hàm này. Miniapp có bản sao `utils/points-earn.ts` (miniapp không import chéo package). Hai bên khớp nhờ hai spec: API so `calcPointsEarned` với `pointsForGoods`, miniapp so bản sao với chính file của API trên lưới giá trị hàng × mốc × hệ số hạng (gồm mốc làm tròn xuống và cấu hình hỏng).
- Dòng "Nhận tối đa N Điểm Xanh (≈N.000đ) khi đơn giao thành công" (`components/product/points-earn-line.tsx`, đặt dưới giá). Mốc `vndPerPoint` và giá trị 1 điểm `vndPerPointRedeem` đọc từ config công khai, nhân hệ số hạng, tính cho giá × số lượng đang chọn.
- Chỉ nêu số khi biết đủ tham số. Chưa chắc thì viết "Nhận Điểm Xanh khi đơn giao thành công", không số: API cũ chưa trả mốc, phiên đang kiểm tra, hoặc tài khoản có hạng mà tổng quan Điểm Xanh chưa nằm trong bộ nhớ đệm. Khách chưa đăng nhập và tài khoản chưa có hạng dùng hệ số 1 (đúng `getTierMultiplier`), kể cả khi bộ nhớ đệm có tổng quan hiển thị hạng thấp nhất (xem mục 3c, L2). Hàng rẻ hơn một mốc điểm thì không hiện dòng nào.
- Chữ "tối đa" vì mã giảm giá, giảm theo hạng và điểm dùng ở thanh toán làm giá trị hàng tính điểm thấp hơn giá niêm yết; PDP không biết trước các khoản đó.

### D2-06: lời mời theo dõi OA (`b60c468f`)

- `order-detail.tsx`: "Nhận thông báo cập nhật đơn hàng và ưu đãi mới" đổi thành "Nhận cập nhật đơn và tư vấn từ Tubu Tree qua Zalo — không bỏ lỡ tin quan trọng". Spec mới `order-detail-oa-prompt.spec.tsx` render lời mời và kiểm không còn chữ "ưu đãi".
- Hộp thoại xin quyền thông báo là của Zalo SDK (`requestSendNotification` không nhận chữ), app không có lời nào để sửa ở đó. Hàng "Theo dõi Zalo OA" ở Cài đặt không có lời hứa nào.

### D5-07: cộng đồng, nút đăng bài đầu tiên và xem trước công khai (`d1025313`)

- Miniapp `feed.tsx`: feed trống thật (không lọc, không tìm) có nút "Đăng bài đầu tiên" mở khung soạn. Đang lọc mà không có kết quả thì không mời đăng bài.
- API `GET /feed/public-preview` (công khai, `@PublicCache('USER_CONTENT')`, `s-maxage=60`): tự kiểm cờ `community.public_preview`, chỉ boolean true mới bật, tắt thì 404 và không đọc DB. Chỉ bài `PUBLISHED` do người dùng viết (MANUAL, QUESTION, SHOWCASE, TIP; bỏ bài tự sinh có `meta` về vườn riêng), 5 bài, ghim trước rồi mới nhất. Trường trả về dựng từ danh sách cho phép (`community-public-preview.ts`): id, loại, tiêu đề, tiêu đề và đoạn đầu 160 ký tự đã che số điện thoại và email, ảnh bìa, tên gọi (từ cuối của họ tên; tên có số hoặc "@" thì dùng "Bạn Tubu"), huy hiệu chuyên gia, danh mục, số tim, số bình luận. Không avatar, không id người đăng, không `meta`, không cờ của người xem. Truy vấn Prisma cũng chỉ select các cột đó. Đọc chi tiết bài, thích, bình luận, đăng bài vẫn là route cần đăng nhập (spec kiểm metadata `Public` chỉ có trên route xem trước).
- Config công khai thêm `communityPublicPreview` để miniapp chỉ gọi route khi cờ bật. Khách chưa đăng nhập với cờ bật thấy các thẻ chỉ để đọc (không nút thích, bình luận, không mở bài) và một nút "Tiếp tục với Zalo". Xem trước lỗi hoặc chưa có bài nào thì về cổng đăng nhập cũ.

### D5-10: bỏ số cứng trong chữ (`4139fa7b`)

- Màn đơn hàng trống: mệnh giá và ngưỡng voucher chào mừng theo `voucher.welcome_amount` / `voucher.welcome_min_order` qua config công khai (mã không đòi đơn tối thiểu thì bỏ cụm "từ …"; chưa có số thì không nhắc voucher).
- Trang đăng ký đại lý: "Giá sỉ đến X%" theo `dealer.max_discount_pct` (dùng `formatRatePct` sẵn có); "xét duyệt trong vòng N giờ" theo khoá mới `dealer.review_hours`. Chưa có số (API cũ, chưa tải xong, cấu hình hỏng) thì bỏ con số, không hiện số mặc định. Mặc định 45% và 24 giờ nằm một chỗ ở `dealer/dealer-config.ts`, `DealerService` và config công khai cùng dùng.
- Gợi ý thưởng sự kiện cộng đồng (trang kiểm duyệt, chỉ admin): "1 điểm = Y, tối đa M điểm" với Y từ `loyalty.vnd_per_point_redeem` và M từ hằng số API `EVENT_REWARD_MAX_POINTS` (`feed/community-limits.ts`, DTO `@Max` dùng chung). M là giới hạn của API chứ không phải SystemConfig.
- Config công khai thêm `dealer { maxDiscountPct, reviewHours }` (giá trị hỏng thành null) và `community { eventRewardMaxPoints }`.
- Spec mới `i18n/vi-no-hardcoded-amounts.spec.ts` cấm số tiền cứng trong `vi.ts` và `pages/about-data.ts` (bỏ qua dòng chú thích; kiểu viết được nhận ra ở mục 3c, L5). Ngoại lệ phải ghi `// hardcoded-amount-ok: <lý do ≥ 15 ký tự>` ngay trên dòng. Hiện chưa có ngoại lệ nào.

## 2. Lệnh kiểm chứng đã chạy

Chạy ở worktree `lr-newcustomer`, Node 22, DB race `lr-newcustomer-pg` (cổng 5568, `tubutree_it`). Không chạy full suite, build, Playwright; không đụng DB dev hay PROD. Kết quả sau lượt sửa review (tip `9a4da79b` trước commit báo cáo này):

```
cd apps/api && npx jest src/modules/vouchers src/modules/auth src/modules/feed src/modules/loyalty src/modules/system-config src/modules/catalog src/modules/pricing src/modules/dealer src/common
  Test Suites: 87 passed, 87 total   Tests: 2002 passed, 2002 total
  (`prisma/reference-data` không có spec riêng trong jest; phần đó do reference-config-selection.spec.ts ở system-config và race reference-seed phủ)
cd apps/api && DATABASE_URL=<.../tubutree_it> npx jest -c test/integration-race/jest.config.js --runInBand reference-seed welcome-voucher-signup vouchers-real-user auth-merge-guest
  Test Suites: 4 passed, 4 total     Tests: 34 passed, 34 total   (xem ghi chú về độ ổn định bên dưới)
cd apps/miniapp && TZ=UTC npx vitest run <mọi spec đã đổi từ nhánh gốc> src/pages/product-detail src/components/home src/pages/home src/services src/i18n src/utils
  Test Files  81 passed (81)         Tests  924 passed (924)
  (lặp lại với TZ=Asia/Ho_Chi_Minh: cùng kết quả 81 passed, 924 passed)
npx tsc --noEmit  (apps/api, apps/miniapp, apps/web)   cả ba exit 0
npx eslint <mọi file .ts/.tsx đã đổi từ nhánh gốc> --max-warnings=0 (api 32 file, miniapp 34 file, web 6 file)   exit 0
npm run -s lint:vars   OK — every var(--x) reference is defined.
```

Web không đổi trong lượt sửa review; kết quả vitest web của lượt đầu (56 file, 771 test, cả hai múi giờ) vẫn là bản mới nhất.

Ghi chú độ ổn định: trong lúc kiểm chứng máy có tải rất cao (load average 65 đến 70, nhiều phiên chạy song song). Bộ bốn race spec chạy 5 lần: 3 lần xanh hoàn toàn; 1 lần `auth-merge-guest` đỏ một test (không lưu thông báo lỗi) và 1 lần `reference-seed` đỏ ở DB C vì tiến trình con `npx tsx prisma/seed.ts` thoát mã 1 (test dựng seed.ts gốc bằng `spawnSync`, không in lỗi của nó). Cả hai chạy lại ngay sau đó đều xanh, `auth-merge-guest` xanh cả khi chạy riêng; hai chỗ này không đụng file nào của gói (seed.ts và code gộp tài khoản khách không đổi). Coi là chập chờn do tải, nhưng chưa chứng minh được nguyên nhân; nên chạy lại hai spec này trên máy rảnh trước khi gộp.

Mỗi mục đều viết test đỏ trước rồi mới sửa mã (đã thấy đỏ đúng lý do ở từng mục), kể cả các mục L1 đến L5.

## 3. Chưa làm hoặc cố ý để lại

- `loyalty.tsx` (phiên đổi-rác giữ) không sửa. Còn hai chỗ viết cứng "30 ngày" ở đó: dòng ~636 "HSD 30 ngày sau đổi" và dòng ~828 "Mã giảm giá sau khi đổi có hạn 30 ngày". Cần số ngày hạn mã đổi quà từ config công khai (chưa có khoá nào; chủ dự án quyết hạn mã). Phiên đổi-rác nên sửa khi đã quyết, và có thể thêm số vào `buildPublicConfig`. Spec cấm số tiền cứng trong `vi.ts` không bắt chỗ này vì nó nằm trong `loyalty.tsx`, và là "30 ngày" chứ không phải số tiền.
- D2-06 dài hạn (đường gửi tin OA theo người theo dõi, ánh xạ `User.zaloId` sang ID người theo dõi OA, thưởng nhỏ khi theo dõi) chưa làm; chỉ làm phần sửa lời ngắn hạn như yêu cầu.
- PDP không gọi thêm API `/me/loyalty` để biết hệ số hạng (PDP là trang đông khách nhất). Tài khoản có hạng, chưa mở màn Điểm Xanh/Ví/Hồ sơ/Thanh toán trong phiên sẽ thấy dòng chung không số. Chỉ tài khoản chưa có hạng mới luôn có số (hệ số 1). Nếu chủ dự án muốn luôn có số, thêm một query dùng chung khoá `['loyalty']` (cần cập nhật mock `account-api` của 10 spec product-detail).
- Giảm theo hạng (tier discount), mã giảm giá và điểm dùng ở thanh toán không được tính ở PDP (nên ghi "tối đa").
- `/feed/public-preview` cache `USER_CONTENT` (30 giây trình duyệt, 60 giây proxy/CDN, chỉ khi thành công) và máy khách giữ bản xem trước tối đa 30 giây (`staleTime` ở `feed.tsx`; trước đó 5 phút nên bài đã gỡ có thể còn hiện khoảng 6 phút). Tắt cờ hoặc gỡ bài vi phạm thì bài còn hiện tối đa khoảng 2 phút trong trường hợp xấu nhất (60 giây ở CDN, rồi 30 giây ở bộ nhớ đệm HTTP của máy, rồi 30 giây `staleTime`); đây là ước tính từ các hằng số, chưa đo.
- Xem trước công khai hiện bài `PUBLISHED`. Bài của người đã được tin cậy (nhân viên, đại lý, CTV, người có bài từng được duyệt, người đã có đơn giao thành công) và không dính bộ lọc từ cấm hay liên kết lạ được đăng `PUBLISHED` ngay, không qua duyệt tay. Vì vậy khi bật `community.public_preview`, một bài rác không dính bộ lọc vẫn hiện ở phần xem trước cho tới khi CSKH gỡ.
- Xem trước công khai chỉ cho đọc đoạn đầu bài; chạm vào thẻ không mở bài (chi tiết cần đăng nhập). Không có SEO cho bài cộng đồng.
- Web home: hàng danh mục không có số đếm sản phẩm trên chip, không có ảnh danh mục. Không đụng D5-08 (câu "100% Thuần Chay/Nguyên bản Việt Nam" chờ chủ dự án).
- Cron `welcomeVouchers` vẫn quét hết cửa sổ 24 giờ mỗi giờ như cũ; chưa tối ưu (không thuộc phạm vi).
- Khoá mới chỉ có trong mã và `EXTRA_CONFIGS` của seed-reference; DB đang chạy dùng mặc định trong mã cho tới khi chủ dự án đặt giá trị ở tab Cấu hình, hoặc chạy lại seed-reference.

## 3b. Chồng ưu đãi của khách mới (cần chủ dự án biết trước khi mở bán)

Mỗi giỏ chỉ nhận một mã (`cart.couponCode`), nên "chồng" nghĩa là giữa các đơn và giữa mã với phí giao:

- Voucher chào mừng `WELCOME-<id>` (30.000đ, đơn từ 199.000đ, mỗi khách một mã, cấp ngay khi tạo tài khoản thật) và mã demo `WELCOME30` (PUBLIC, cũng 30.000đ từ 199.000đ, 1 lượt mỗi người, không giới hạn khách mới) là hai mã khác nhau. Khách mới dùng được cả hai, mỗi mã trên một đơn, tức tổng 60.000đ giảm cho hai đơn đầu thay vì 30.000đ như chữ "Quà khách mới" nói.
- `WELCOME-<id>` cộng được với freeship đơn đầu (`shipping.first_order_free_enabled`) trên cùng đơn: giảm 30.000đ và miễn phí giao, vì phí giao tính riêng khỏi mã.
- Hai ưu đãi trên đơn đầu cộng với giảm theo hạng (nếu có) và Điểm Xanh dùng ở thanh toán vẫn chịu các trần có sẵn của giá và điểm.

Vì vậy nên khuyên tắt `WELCOME30` trước khi mở bán thật: chạy `prisma:cleanup-demo -- --apply --expect-db=tubutree --coupons=expire` mà không truyền `--keep-coupon=WELCOME30`, để ưu đãi mới chỉ đi qua mã cá nhân có kiểm soát. Nếu chủ dự án vẫn muốn giữ `WELCOME30` làm mã ra mắt thì chữ "Quà khách mới" cần nói đúng tổng ưu đãi.

## 3c. Sửa sau review (APPROVE kèm sửa)

Merge `review/2026-10-18-launch` vào nhánh (`de43d29b`), `config-selection.ts` xung đột được giải bằng cách giữ cả hai phía (EXTRA_CONFIGS của gói hoa hồng và của gói này).

| Mã | Commit | Việc |
|---|---|---|
| M1 | `bd431768` | `reference-seed.race-spec.ts` danh sách khoá bổ sung thành 10 (5 cũ, 2 của hoa hồng, 3 của gói này); chạy race trên DB riêng, xanh |
| L1 | `44d558b1` | Khối Quà khách mới không vẽ khung chờ 236px trước khi biết `isNewCustomer`, chỉ vẽ khi API trả true. Mô tả cờ `home.new_customer_layout` sửa đúng: cờ chỉ đổi thứ tự, khối chào mừng luôn hiện với khách mới (spec chốt nội dung mô tả) |
| L2 | `13252806` | API `getOverview` trả thêm `earnMultiplier` (1 khi chưa có hạng, dù `tier` hiển thị hạng thấp nhất). PDP: `tierId` null luôn là 1; tài khoản có hạng dùng `earnMultiplier`, API cũ thì dùng hệ số hạng hiển thị. Test hạng thấp nhất hệ số 1.2 với `tierId` null cho ra hệ số 1 (đỏ trước) |
| L3 | `723dbbb8` | `getNewCustomerOffer` kiểm `isRealUser` trước, khách deviceId (zaloId `guest_...`, chưa SĐT) nhận `isNewCustomer: false`, không chạm bảng đơn và ví voucher; dòng guest đã có SĐT vẫn là khách thật. Khớp `pricing.service.ts` `firstOrderFreeShipFrom` |
| L4 | `5cba21ef` | Xem trước cộng đồng che số điện thoại và email ở tiêu đề (hàm `publicTitle`) như đoạn đầu bài; route chuyển sang policy mới `USER_CONTENT` (`max-age=30, s-maxage=60`) thay cho STATIC (`s-maxage=300`) |
| L5 | `9a4da79b` | Regex số tiền cứng nhận thêm `30k`, `199.000 đ`, `199.000 ₫`, `1.000đ` (đã có), `199000đ`, `5 triệu`, `VND`, không bắt nhầm "10.000 điểm" hay "2 ký tự"; quét thêm `pages/about-data.ts`. FAQ dự phòng thành `fallbackFaq(cfg)` đọc từ config công khai: mốc tích, giá trị 1 điểm, trần %, hạn điểm, số ngày đổi trả (API thêm `loyalty.maxRedeemPct`, `loyalty.pointExpireMonths`, chuẩn hoá giống `getOverview` và `pointsExpiryFrom`). Thiếu hay hỏng thì bỏ riêng phần đó |

Số trong `about-data.ts` không nằm trong config: chỉ còn "100%" của lô điểm quy đổi từ xu cũ (luật cố định ở `pricing.service`, không có khoá), có chú thích lý do ngay trên dòng. Danh sách ngoại lệ có `// hardcoded-amount-ok` của spec vẫn trống vì "100%" không phải số tiền.

## 4. Câu hỏi cho chủ dự án

1. Bật bố cục Trang chủ cho khách mới (`home.new_customer_layout`) từ ngày nào? Mặc định đã dùng: tắt (thứ tự cũ, khối "Quà khách mới" đứng sau Danh mục).
2. Cho khách chưa đăng nhập xem trước cộng đồng (`community.public_preview`)? Mặc định đã dùng: tắt. Báo cáo D5 đề xuất "có"; nên bật sau khi D4 nạp bài hạt giống và ít nhất vài bài thật đã được duyệt, vì phần xem trước hiện tối đa 5 bài mới nhất và ghim. Chỉ nên bật khi đã có người trực duyệt và gỡ bài (bài của người tin cậy lên ngay, không qua duyệt tay; xem mục 3).
3. Số giờ hẹn duyệt hồ sơ đại lý (`dealer.review_hours`) có đúng 24 không? Mặc định đã dùng: 24 (đúng chữ cũ). Tubu có thật sự duyệt trong số giờ này không? Nếu không chắc thì đặt số dài hơn (khoá không có giá trị "tắt": giá trị hợp lệ nhỏ nhất là 1 giờ).
4. Dòng điểm ở PDP dùng chữ "Nhận tối đa N Điểm Xanh (≈N.000đ)". Muốn bỏ chữ "tối đa" (ngắn hơn, nhưng có thể lệch khi có mã giảm giá hoặc giảm theo hạng)? Mặc định đã dùng: giữ "tối đa".
5. Hạn mã đổi quà "30 ngày" ở `loyalty.tsx`: có muốn thành khoá SystemConfig công khai không? Mặc định đã dùng: để nguyên (file thuộc phiên đổi-rác).
6. Xem trước cộng đồng hiện tên gọi (từ cuối của họ tên) và không avatar. Có muốn cho thấy avatar hoặc họ tên đầy đủ khi chưa đăng nhập không? Mặc định đã dùng: không (an toàn dữ liệu cá nhân).

## Lệnh commit đã dùng

```
fdfc8a1a feat(vouchers): cấp voucher chào mừng ngay khi tạo tài khoản thật, cron giữ làm lưới (D2-07a)
47dfb06e feat(home): khối "Quà khách mới" cho khách chưa có đơn, hàng danh mục và hàng cam kết gọn ở web (D2-07b, D7 việc 1)
6c196feb feat(pdp): dòng "Nhận tối đa N Điểm Xanh (≈N.000đ)" ở trang sản phẩm, N theo đúng công thức server (D2-07c)
b60c468f fix(miniapp): lời mời theo dõi OA chỉ hứa cập nhật đơn và tư vấn, bỏ "ưu đãi mới" (D2-06)
d1025313 feat(community): nút "Đăng bài đầu tiên" khi bảng tin trống, xem trước công khai sau cờ community.public_preview (D5-07)
4139fa7b fix(i18n): bỏ số cứng trong chữ, đọc từ config công khai; spec cấm số tiền cứng trong vi.ts (D5-10)
de43d29b Merge review/2026-10-18-launch vào lr/newcustomer (lấy cả hai phía EXTRA_CONFIGS và hằng đường dẫn)
bd431768 test(reference-seed): ba khoá bổ sung của gói khách mới nằm trong danh sách khoá seed-reference thêm trên DB (M1)
44d558b1 fix(home): khối Quà khách mới không vẽ khung chờ trước khi biết khách mới; mô tả cờ home.new_customer_layout nói đúng chỉ đổi thứ tự (L1)
13252806 fix(pdp): hệ số điểm ở PDP theo đúng hệ số server dùng, khách chưa có hạng là 1 (L2)
723dbbb8 fix(loyalty): getNewCustomerOffer chỉ coi khách thật là khách mới, khách deviceId không bị hứa quà (L3)
5cba21ef fix(feed): xem trước cộng đồng che số điện thoại và email cả ở tiêu đề, proxy chỉ giữ 60 giây (L4)
9a4da79b fix(i18n): FAQ dự phòng đọc số từ config công khai; bộ lọc số tiền cứng bắt thêm 30k, "199.000 đ", "199.000 ₫" (L5)
```
