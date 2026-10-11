# PD-1 — Ẩn/xoá tính năng thừa (Q-15, Q-16, Q-19)

Chỉ ẩn lối vào / đổi chữ / xoá mã chết. Không xoá bảng, cột, dữ liệu; API giữ nguyên.

## Mục 1/4 — C-044 Season Pass + C-086 phần cashback (Q-16, Q-15)

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| C-044 ẩn Chặng Mùa (Season Pass) khỏi trang Vườn Xanh | XONG | 160834ad |
| C-086 (phần cashback) ẩn Hoàn tiền sàn ngoài khỏi hub Cá nhân và Ví | XONG | fef504e5 |

### C-044 Season Pass
- `apps/miniapp/src/utils/features.ts` (mới): `SEASON_PASS_ENABLED = false`.
- `components/game/use-game-data.ts`: truy vấn `['game','seasonPass']` chỉ chạy khi `authed && SEASON_PASS_ENABLED`, nên trang game không còn gọi `GET /game/season-pass`.
- `pages/game.tsx`: khối `<SeasonPass>` chỉ dựng khi cờ bật. Khối nằm trong luồng cột (`gap: 12`), điều kiện sai thì không sinh phần tử nên không có khung trống hay khoảng hở.
- Giữ nguyên: `season-pass.tsx`, `claimPassM`, `game-api.ts`, i18n `game.seasonPass`, mọi thứ ở API (endpoint, bảng `seasons`, `season-pass.service.ts`). Bật lại bằng đổi cờ.
- Không đụng: `SeasonBanner` và `SeasonLeaderboard` (mùa/sự kiện, tự ẩn khi `getSeason` trả null hoặc bảng rỗng; không phải Season Pass). Nhãn lịch sử giao dịch `SEASONPASS:*` trong `account-api.ts` giữ để sao kê cũ vẫn đọc được.
- Không có thông báo/huy hiệu mùa nào trong miniapp, web hay e2e (grep `season|chặng mùa` ở `apps/miniapp/src`, `apps/web/src`, `apps/e2e/tests`).

Test (`pages/game-behavior.spec.tsx`):
- Thêm `GamePage — Chặng Mùa (Season Pass) đã ẩn`: server trả mùa đang chạy có bậc, mở tab Cộng đồng, khẳng định `fetchSeasonPass` không được gọi và không có chữ "Chặng Mùa"/"Season Pass". ĐỎ trước khi sửa (`expected "spy" to not be called at all, but actually been called 1 times`), XANH sau.
- Chưa đăng nhập cũng không gọi `fetchSeasonPass`.
- Sáu ca hành vi cũ của Chặng Mùa giữ lại, chạy với `SEASON_PASS_ENABLED` mock bật (`describe ... khi bật cờ`), để mã ngủ không mục.

### C-086 cashback (Q-15)
- Hub Cá nhân: mục đã được bỏ ở PC-4 (81375f7c: MENU không còn `/cashback`, tập `READY` đã xoá, có `profile.spec.ts` và `profile-hub.spec.tsx`). Lượt này gom về cờ: `CASHBACK_ENABLED = false` trong `utils/features.ts`, `profile.tsx` chỉ chèn `{ label: 'Hoàn tiền sàn ngoài', to: '/cashback' }` vào nhóm "Hợp tác" khi cờ bật. Thêm 2 ca: không nhãn nào nhắc "sàn ngoài"; bật cờ thì mục quay lại giữa CTV và đại lý (ĐỎ rồi XANH).
- Lối vào còn sót ở Ví (`pages/wallet.tsx`):
  - Chú thích dưới thẻ số dư "Tiền thật từ hoa hồng & hoàn tiền sàn ngoài" giờ chỉ nhắc sàn ngoài khi bật cờ.
  - Gợi ý trong sheet Đổi TubuXu khi số dư 0đ ("...hoặc Hoàn tiền sàn ngoài") giờ chỉ nhắc khi bật cờ.
  - Thẻ "Hoàn tiền đã duyệt, chờ về Ví": ẩn khi `cashbackPending === 0` và cờ tắt; còn khoản đã duyệt chờ về Ví thì vẫn hiện (là tiền của khách, không giấu). Cả khối bọc điều kiện nên không để khoảng trống.
  - Test `wallet.spec.tsx`: 3 ca ĐỎ rồi XANH (chú thích, thẻ 0đ, gợi ý sheet), 2 ca bảo vệ (khoản còn chờ vẫn hiện; sao kê cũ loại `CASHBACK` vẫn có nhãn "Hoàn tiền sàn ngoài"), 1 ca bật cờ.
- Giữ nguyên: trang `pages/cashback.tsx` + spec, route `/cashback` trong `components/app.tsx` (vào bằng URL/deeplink), `services/cashback-api.ts`, toàn bộ API cashback, nhãn loại giao dịch `CASHBACK` trong `utils/wallet-rules.ts` (sao kê lịch sử), thông báo `CASHBACK_*` (đã phát từ trước; liên kết đi `/wallet`, không đi `/cashback`).
- Đã rà home, settings, thông báo, affiliate, components: không còn nút/liên kết nào dẫn tới `/cashback` ngoài route đăng ký.

### Lệnh kiểm chứng
```
cd apps/miniapp
npx vitest run src/pages/game-behavior.spec.tsx src/pages/game-layout.spec.tsx src/pages/game-numbers.spec.tsx src/pages/game-wheel-tabs.spec.tsx src/ds-c076-pc10a.spec.ts
  Test Files 5 passed (5) | Tests 235 passed (235)
npx vitest run src/pages/wallet.spec.tsx src/pages/profile.spec.ts src/pages/profile-hub.spec.tsx
  Test Files 3 passed (3) | Tests 40 passed (40)
npx vitest run src/pages/cashback.spec.tsx src/pages/notifications.spec.ts src/ds-c076-pc10a.spec.ts src/ds-c076-pc10b.spec.ts src/ds-c076-pc10c1.spec.ts src/ds-c076-pc10c2.spec.ts src/ds-c076-pc10c3.spec.ts
  tất cả passed (cashback 10, notifications 30, ds-c076 lần lượt 141, 246 gộp pc10b/c2/c3, 73)
npx tsc --noEmit          -> exit 0, không có lỗi
npx eslint <file đã sửa>  -> 0 lỗi, 0 cảnh báo
```

### Giả định
- "Ẩn Season Pass" = ẩn khối và ngừng gọi API ở miniapp; giữ mã miniapp ngủ sau cờ thay vì xoá, để bật lại khi có công cụ tạo mùa (Q-16 phương án 1: "tới khi có công cụ tạo mùa").
- Banner mùa và bảng xếp hạng mùa không thuộc Season Pass nên để nguyên (đã tự ẩn khi không có mùa/dữ liệu).
- Khoản `cashbackPending > 0` vẫn phải hiển thị ở Ví dù lối vào đã ẩn: không giấu số tiền thật của khách.

### Việc còn lại
- Không còn (mục 2 đến 8 đã xong, xem các mục dưới và Tổng kết cuối file).

### Việc cần chủ dự án
- Khi có công cụ tạo mùa: đổi `SEASON_PASS_ENABLED` thành `true` (kèm kiểm bảng `seasons` có mùa đang chạy).
- Khi có key AccessTrade và đo được tác động lên đơn: đổi `CASHBACK_ENABLED` thành `true`.

## Mục 2-3/4 — C-010 "cây thật" thành "góp quỹ trồng cây" + quyền lợi hạng không có quy trình (Q-16)

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| C-010 đổi chữ "cây thật / PanNature / Rừng Xanh Lên" ở miniapp | XONG | b1aed272 |
| C-010 thẻ Tổng quan admin (web) | XONG | 8286bc7d |
| C-010 API game (lời báo lỗi + chú thích) | XONG | 2e6d4980 |
| C-010 quyền lợi hạng + câu quiz q6 + mô tả cấu hình: seed + migration UPDATE | XONG | 7ddb55bd |

### Đổi chữ (khách thấy "góp quỹ trồng cây", không hứa một cây cụ thể, không nêu PanNature)
Miniapp (`components/game`, `pages`, `services`):
- `tree-actions.tsx`: nút "Mua cây thật" thành "Góp quỹ trồng cây"; dòng chú thích "Mua bằng TubuXu" thành "Góp bằng TubuXu" (không thêm chữ TubuXu mới, chỉ đổi động từ).
- `use-game-actions.ts`: snackbar "Đã mua 1 cây thật" thành "Đã góp 1 cây vào quỹ trồng cây ... · mã ...".
- `harvest-celebration.tsx`: "Tubu sẽ góp 1 cây thật vào rừng Rừng Xanh Lên cùng PanNature" thành "Tubu sẽ góp 1 cây vào quỹ trồng cây"; "Mã chứng nhận cây thật" thành "Mã đóng góp quỹ trồng cây".
- `eco-impact.tsx`: nhãn "Cây thật đã trồng" thành "Cây đã góp quỹ"; lời cảm ơn không còn PanNature/Rừng Xanh Lên; "Khu rừng của tôi — chứng nhận" thành "Đóng góp của tôi"; huy hiệu "Đã cam kết" thành "Đã góp quỹ"; lời mời khi chưa có cây không còn "cây thật cho rừng Việt Nam".
- `community-goal.tsx`: "mục tiêu N cây thật" thành "mục tiêu góp quỹ trồng N cây"; "Tubu trồng cây thật cùng PanNature" thành "Tubu góp quỹ trồng cây".
- `garden-hero.tsx`: dòng tổng hợp "🌳 thật: N" thành "🌳 góp quỹ: N" (sót ngoài danh sách khảo sát ban đầu).
- `garden-plots.tsx`: "cho coupon, cây thật" thành "cho mã giảm giá, phần góp quỹ trồng cây" (đồng thời "coupon" thành "mã giảm giá" theo Q-26 vì cùng câu).
- `refill.tsx`: "nuôi cây thật" thành "nuôi cây, góp quỹ trồng cây".
- `wallet.tsx` (sót ngoài danh sách): "mua hàng, mua nước 💧 và mua cây 🌳" thành "mua hàng và góp quỹ trồng cây 🌳". Bỏ luôn "mua nước" vì API đã trả 410 Gone từ C-009 (câu cũ hứa thứ không còn làm được).
- `game-api.ts`, `game.tsx`, `community-goal.tsx`: chỉ chú thích.
Web admin (`app/admin/page.tsx`): thẻ "Sản phẩm & Rừng Xanh / N cây thật góp PanNature" thành "Sản phẩm & Quỹ trồng cây / N cây góp quỹ trồng cây".
API (`game.service.ts`): lời báo lỗi "Tính năng mua cây chưa khả dụng." thành "Tính năng góp quỹ trồng cây chưa khả dụng."; chú thích ở `game.service.ts`, `game-garden.service.ts`, `game-community.service.ts`. `game-community.service.ts` không trả chữ nào cho FE (tiêu đề/vùng mốc lấy từ DB), chỉ có chú thích.
Dữ liệu DB (seed + migration, mục dưới): câu quiz q6, mô tả khoá `game.tree_xu_price`.

Giữ nguyên: tên biến/hàm (`buyTree`, `plantTree`, `PlantedTree`, `treesPlanted`, `certificateCode`...), route `POST /game/tree/buy`, bảng, cột, `schema.prisma`, `dead-config-keys.ts` (nhãn admin báo khoá `eco.real_tree_*` không có luồng đọc: đúng sự thật). Ô "CO₂ hấp thụ/năm" ở thẻ Tác động xanh đã bỏ sau review lượt 1.

### Quyền lợi hạng: bằng chứng cơ chế từng perk (seed `TIERS[].perks`, cột `membership_tiers.perks` kiểu JSONB)
| Perk cũ | Cơ chế trong mã | Kết luận |
| --- | --- | --- |
| "Tích điểm 1x / 1.2x / 1.5x / 2x" | `MembershipTier.pointMultiplier` đọc ở `loyalty.service.ts:424` (getMultiplier), `:860`, `:980`; `pricing.service.ts` `calcPointsEarned(goods, tierMultiplier)` | GIỮ |
| "Freeship đơn ≥ 99k" (Lộc Biếc) | `PricingService.calcShippingFee` đọc `shipping.tier_freeship_overrides[tier.id]` (seed `LOC_BIEC: 99000`), gọi từ checkout/cart/subscriptions | GIỮ |
| "Freeship toàn shop" (Đại Thụ) | cùng cơ chế, `DAI_THU: 0` | GIỮ |
| "Freeship + giảm 5% mọi đơn" (Cổ Thụ) | freeship `CO_THU: 0` + `checkout.service.ts:592-595` tính `tierDiscount` từ `MembershipTier.discountPct` (seed 0.05) | GIỮ |
| "Voucher sinh nhật 50k / 150k / 300k" | `VouchersService.birthdayVouchers` (cron 01:00) cấp đúng `MembershipTier.birthdayVoucherAmount` (`vouchers.service.ts:173-188`) | GIỮ (chỉ đổi chữ "Voucher" thành "Mã giảm giá" theo Q-26) |
| "+ 1 sample" (Đại Thụ) | cron chỉ tạo mã giảm giá dạng AMOUNT; grep `sample` ở `apps/api/src` chỉ ra biến nội bộ ở storefront-reminder | BỎ phần "+ 1 sample" |
| "+ hộp quà" (Cổ Thụ) | như trên, không có luồng quà vật lý | BỎ phần "+ hộp quà" |
| "Ưu tiên hotline" (Đại Thụ) | grep `hotline` chỉ ra cấu hình hiển thị số CSKH chung (`support.hotline`), không có hàng đợi/ưu tiên theo hạng | BỎ |
| "Beta tester" (Đại Thụ) | `BetaService.isBetaTester` không có nơi nào gọi; đăng ký beta là tự nguyện, không gắn hạng | BỎ |
| "Quà sinh nhật cá nhân hóa" (Cổ Thụ) | không có mã nào; chỉ có mã giảm giá theo mức hạng | BỎ |

UI miniapp (`pages/about.tsx`, `pages/loyalty.tsx`) không có perk gõ cứng: `loyalty.tsx` in nguyên mảng `tier.perks` từ API, nên bỏ perk ở dữ liệu là đủ (không cần đổi UI). `grep` toàn repo các chuỗi perk nghi vấn chỉ còn trong fixture test và migration.
Tên hạng/mảng mới:
- Lộc Biếc: Tích điểm 1.2x, Freeship đơn ≥ 99k, Mã giảm giá sinh nhật 50k
- Đại Thụ: Tích điểm 1.5x, Freeship toàn shop, Mã giảm giá sinh nhật 150k
- Cổ Thụ: Tích điểm 2x, Freeship + giảm 5% mọi đơn, Mã giảm giá sinh nhật 300k
- Mầm Xanh: không đổi (Tích điểm 1x)

### Migration `20261011090000_pd1_tree_fund_wording_tier_perks`
Chỉ 5 câu UPDATE (không INSERT/DELETE/DROP/ALTER), mỗi câu có WHERE khớp đúng nội dung cũ (admin đã sửa tay thì giữ nguyên):
1. `membership_tiers.perks` của Lộc Biếc, Đại Thụ, Cổ Thụ: `WHERE "name" = '<tên hạng>' AND "perks" = '<mảng cũ>'::jsonb` (so sánh JSONB, đúng thứ tự phần tử).
2. `game_quizzes` q6: câu hỏi mới "Khi thu hoạch cây ảo, giọt nước bạn đã tưới được góp vào đâu?" (đáp án đúng vẫn ở vị trí 0 nên lượt trả lời cũ không lệch); `WHERE id='q6' AND correct=0 AND question=<cũ> AND options=<cũ>::jsonb`.
3. `system_configs` `game.tree_xu_price`: mô tả "Giá góp 1 cây vào quỹ trồng cây bằng xu"; `WHERE key=... AND description=<cũ>`.
Kiểm bằng Postgres thật (container `tubu_it_main` cổng 5550, DB tạm `pd1_scratch` tạo mới rồi xoá, không đụng `tubutree_it`):
```
DATABASE_URL=postgresql://tubu:tubu@localhost:5550/pd1_scratch npx prisma migrate deploy
  -> prisma migrate status: 124 migrations found, Database schema is up to date! (migration mới finished_at = t)
chèn 4 hạng + q6 + khoá cũ rồi chạy migration.sql lần 1 -> UPDATE 1 x5
  Đại Thụ | ["Tích điểm 1.5x", "Freeship toàn shop", "Mã giảm giá sinh nhật 150k"]
  Cổ Thụ  | ["Tích điểm 2x", "Freeship + giảm 5% mọi đơn", "Mã giảm giá sinh nhật 300k"]
  q6 | Khi thu hoạch cây ảo, giọt nước bạn đã tưới được góp vào đâu? | ["Hồ nước chung của cộng đồng", ...] | 0
chạy lại lần 2 -> UPDATE 0 x5 (idempotent)
```
`seed.ts` đã đổi cùng nội dung (`TIERS`, `QUIZZES` q6, mô tả `game.tree_xu_price`); seed upsert `update: tier` nên chạy seed vẫn khớp bản migration.

### Test thêm (đỏ rồi xanh)
- `apps/miniapp/src/i18n/tree-fund-copy.spec.ts` (mới, 4 ca, guard quét `src/**/*.{ts,tsx}` trừ spec): không còn "cây thật" / "🌳 thật", không PanNature / "Rừng Xanh Lên", không "mua cây", không "Mã chứng nhận". ĐỎ trước (cả 4 ca, kê file vi phạm), XANH sau.
- `game-behavior.spec.tsx`, `game-numbers.spec.tsx`: cập nhật chữ mới và thêm khẳng định chữ mới cho hộp thu hoạch, mốc cộng đồng, lời mời tác động xanh, lời cảm ơn góp quỹ. ĐỎ 9 ca trước khi sửa mã, XANH sau.
- `wallet.spec.tsx`: thêm ca chú thích dưới TubuXu (ĐỎ rồi XANH).
- `apps/web/src/app/admin/page.spec.tsx`: thêm ca thẻ Sản phẩm nói "góp quỹ trồng cây", không cây thật/PanNature/Rừng Xanh (ĐỎ rồi XANH).
- `apps/api/src/modules/game/game.service.spec.ts`: thêm ca lời báo lỗi "Tính năng góp quỹ trồng cây chưa khả dụng." (ĐỎ rồi XANH).
- `apps/api/src/modules/loyalty/tier-perks-seed.spec.ts` (mới, 10 ca): mỗi perk của `TIERS` phải khớp một cơ chế thật (pointMultiplier, `shipping.tier_freeship_overrides`, discountPct, birthdayVoucherAmount) nên perk không cơ chế mới thêm vào sẽ đỏ; danh sách perk chốt từng hạng; q6 và mô tả cấu hình; migration chỉ có UPDATE có WHERE, khớp mảng cũ theo tên hạng, mảng mới trùng seed. ĐỎ 8/10 trước khi sửa seed + viết migration, XANH sau.

### Lệnh kiểm chứng
```
cd apps/miniapp
npx vitest run src/i18n src/pages/game-behavior.spec.tsx src/pages/game-numbers.spec.tsx src/pages/game-layout.spec.tsx src/pages/game-wheel-tabs.spec.tsx src/pages/wallet.spec.tsx src/pages/refill.spec.tsx src/ds-c076-pc10a.spec.ts
  Test Files 11 passed (11) | Tests 287 passed (287)
npx tsc --noEmit  -> exit 0;  npx eslint <file đã sửa> -> 0 lỗi, 0 cảnh báo
cd apps/web
npx vitest run src/app/admin/page.spec.tsx -> Test Files 1 passed | Tests 51 passed (51)
npx tsc --noEmit -> exit 0;  npx eslint src/app/admin/page.tsx src/app/admin/page.spec.tsx -> 0
cd apps/api
npx jest src/modules/game src/modules/loyalty/tier-perks-seed.spec.ts src/modules/system-config src/modules/notifications/notification-templates-seed.spec.ts src/modules/pricing --maxWorkers=1
  Test Suites: 18 passed, 18 total | Tests: 247 passed, 247 total
npx tsc --noEmit -p tsconfig.json -> exit 0;  npx eslint <file đã sửa> -> 0
```

### Giả định
- "Cây thật" thay bằng "góp quỹ trồng cây" ở mọi chữ hướng khách; nhãn kỹ thuật vẫn là `PlantedTree`/`certificateCode`, chỉ đổi chữ hiển thị "mã chứng nhận" thành "mã đóng góp quỹ trồng cây" (mã này chỉ là bản ghi khoản góp, không phải chứng nhận của đối tác).
- Perk ghép (Mã sinh nhật + "1 sample" / "hộp quà"): giữ phần có cơ chế (mã giảm giá sinh nhật), cắt phần không có.
- Đổi "Voucher sinh nhật" thành "Mã giảm giá sinh nhật" ở cả ba hạng (kể cả Lộc Biếc không bị cắt perk nào) để bậc thang hạng nhất quán theo Q-26; chỉ đổi chữ.
- Câu quiz q6 thay bằng câu về cơ chế hồ nước chung (đúng với `community-goal.tsx`: giọt nước tưới khi thu hoạch góp vào hồ chung); phương án sai là chữ trung tính. Admin đã sửa q6 tay thì migration không đụng.
- Số CO₂ ước tính (21 kg/cây/năm) ở thẻ Tác động xanh giữ nguyên vì là số tính toán, không phải lời hứa cụ thể; nếu chủ dự án muốn tránh cả diễn đạt "CO₂ hấp thụ" khi chưa trồng thật thì đổi nhãn ở `eco-impact.tsx`.
- `PLANTED` ("Đã trồng") vẫn là nhãn khi admin đánh dấu một khoản góp đã được trồng; hiện không có luồng nào đặt trạng thái này nên khách chỉ thấy "Đã góp quỹ".

### Việc còn lại
- Không còn mục mã nào của PD-1 (C-096, C-118, C-069, dọn alias legacy đã xong ở các mục dưới).
- `README.md:54` (danh sách việc chưa làm: "Tích hợp PanNature") và `DEMO_SCRIPT.md:42-43,60` (kịch bản demo nói "cây thật qua PanNature") là tài liệu nội bộ ngoài nhóm file của gói, chưa sửa. Nên đổi trước khi đem kịch bản đi demo cho đối tác.

### Việc cần chủ dự án
- Khi áp migration lên PROD (`prisma migrate deploy`): migration chỉ đổi chữ dữ liệu (5 dòng: 3 hạng, 1 câu quiz, 1 mô tả cấu hình), có thể kiểm bằng `select name, perks from membership_tiers`.
- Mốc cộng đồng "Cùng Tubu phủ xanh Cần Giờ" (tiêu đề, vùng, `treesToPlant`) nằm trong DB và do admin sửa; tiêu đề/vùng cụ thể có thể làm khách hiểu là sẽ trồng đúng tại Cần Giờ. Nếu chưa có đối tác thực hiện, nên đổi tên mốc ở trang quản trị thành tên chung hơn.
- Khi có hợp đồng đối tác trồng cây + ngân sách: mới đưa lại chữ "trồng cây thật" và tên đối tác; lúc đó cần luồng đánh dấu `PLANTED` + báo cáo cho khách.
- Muốn có lại perk "Ưu tiên hotline", "Beta tester", quà sinh nhật/hộp quà/sample: phải dựng quy trình trước (hàng đợi CSKH theo hạng, gắn hạng với chương trình beta, quy trình gửi quà), rồi mới thêm lại vào `TIERS` (test `tier-perks-seed.spec.ts` sẽ buộc khai báo cơ chế).

## Mục 5-7/8 — C-096 /merchant, C-118 /beta, C-069 ui/primitives.tsx (Q-19)

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| C-096 web khách và miniapp không còn lối vào `/merchant`; trang giữ nguyên, noindex + Disallow | XONG (rà soát, mã đã sạch từ PC-7; thêm guard khoá lại) | 6eb2d07f |
| C-118 xoá trang Beta Tester khỏi miniapp | XONG | d05785c1 |
| C-069 xoá `components/ui/primitives.tsx` + spec | XONG | ee5ba135 |

### C-096 `/merchant` (Q-19)
Rà toàn `apps/web/src` ngoài `app/merchant`, `app/admin`, `components/admin`: header, footer, hero/trang chủ, `sitemap.ts`, `robots.ts`, trang tài khoản, trang đăng nhập + callback, `not-found.tsx`, `middleware.ts`, `lib/*`. Không có link, chuỗi đường dẫn hay chữ "Kênh Đối Tác" nào dẫn khách vào `/merchant` (PC-7 đã gỡ). Miniapp: không có route/navigate/webview tới `/merchant`; chỉ có API `/cashback/merchants` (sàn cashback, không liên quan).
Đã có sẵn, giữ nguyên: `app/merchant/layout.tsx` có `robots: { index: false, follow: false }`; `PRIVATE_PATHS` trong `lib/site.ts` chứa `/merchant` nên `robots.ts` ra `Disallow: /merchant` và `/merchant/`; `sitemap.ts` chỉ liệt kê trang chủ, sản phẩm, gian hàng `/s/*`. Trang `/merchant` và API `merchant` không đổi, đối tác vẫn vào bằng URL.
Không có mã nào phải sửa nên không có bước ĐỎ; test là test đặc tả (xanh trên bản cũ). Đã chứng minh guard có tác dụng: tạm chèn file `lib/zz-tmp-probe.ts` chứa `'/merchant/doanh-thu'` và `'Kênh Đối Tác'` thì 2 ca ĐỎ kê đúng file đó, rồi xoá file.
Test thêm:
- `apps/web/src/merchant-no-guest-entry.spec.ts` (6 ca): quét mã nguồn khách (trừ khu của đối tác/quản trị, `merchant-client.ts`, `site.ts`, `robots.ts`) không có chuỗi `'/merchant`, không có "Kênh Đối Tác"/"Cổng đối tác"; `sitemap()` không có `/merchant`, `/admin`; `robots()` chặn `/merchant` và `/merchant/`; metadata layout merchant noindex+nofollow.
- `apps/miniapp/src/no-merchant-web-entry.spec.ts` (3 ca): miniapp không có `/merchant` hay chữ mời đối tác (`/cashback/merchants` không bị tính).

### C-118 `/beta` (Q-19)
- Xoá `pages/beta.tsx` (không có spec riêng), `services/beta-api.ts` (client chỉ trang beta dùng), route `/beta` và `lazy` import trong `components/app.tsx` (đường dẫn `/beta` giờ rơi vào trang 404 `*`), hàng "Beta Tester — trải nghiệm sớm" trong `pages/settings.tsx` (hàng "Sổ địa chỉ" thành hàng cuối, đặt `last` để bỏ viền dưới).
- `scripts/uiux/routes.mjs`: bỏ `r('beta', '/beta')` (ngoài nhóm file của gói, giữ tối thiểu: harness chụp màn hình sẽ chụp trang 404 nếu còn).
- Không có i18n key riêng cho beta (chữ nằm thẳng trong trang), không có e2e nào nhắc beta (`grep -rni beta apps/e2e` rỗng), không có link beta từ thông báo API.
- API `apps/api/src/modules/beta/*`, bảng `BetaTester`/`BetaFeedback`, `scripts/audit/*` (seed persona, `routes.json`) giữ nguyên (PD-2 xử lý endpoint).
Test (ĐỎ trước khi sửa, XANH sau):
- `apps/miniapp/src/beta-removed.spec.ts` (4 ca, mới): không còn `pages/beta.tsx`, `services/beta-api.ts`; không route/import beta; không điều hướng hay gọi `/beta`; không còn chữ "Beta Tester". ĐỎ 4/4 trước.
- `pages/settings.spec.tsx`: thêm ca nhóm Tài khoản chỉ có "Chỉnh sửa hồ sơ", "Sổ địa chỉ", không chữ Beta, hàng cuối không viền dưới. ĐỎ trước.

### C-069 `ui/primitives.tsx`
Bằng chứng 0 import: `grep -rn "primitives" apps scripts packages` (ts, tsx, mjs, json, css) chỉ ra `primitives.spec.tsx` (import chính nó) và 3 chú thích nhắc tên file ở `list-row.tsx`, `list-row.spec.tsx`, `button-guard.spec.ts`; không có barrel `index.ts` trong `components/ui`; không ai import `Txt/Btn/Stack/Row` từ nơi khác.
- Xoá `primitives.tsx` (157 dòng) và `primitives.spec.tsx` (52 dòng).
- Sửa 3 chú thích trỏ tới file đã xoá (không đổi hành vi).
- Test `components/ui/primitives-removed.spec.ts` (2 ca, mới): file không còn, không ai import `.../primitives`. ĐỎ trước (ca 2 kê đúng `primitives.spec.tsx` là importer duy nhất).
- Alias legacy (`--neutral-*`, `--primary-*`, `--leaf-*`, `--danger`...) mà primitives dùng cũng biến mất theo; `beta.tsx` cũng dùng `--neutral-*`/`--leaf-*`/`--radius-lg`. Mục 8 dọn khối alias trong `tokens.css` ngay sau đó.

### Lệnh kiểm chứng
```
cd apps/web
npx vitest run src/merchant-no-guest-entry.spec.ts src/lib/site.spec.ts src/components/site-header.spec.tsx src/components/site-footer.spec.tsx src/components/hide-on-portals.spec.tsx src/app/merchant/layout.spec.tsx
  Test Files  6 passed (6) | Tests  27 passed (27)
npx tsc --noEmit -> exit 0;  npx eslint src/merchant-no-guest-entry.spec.ts -> 0
cd apps/miniapp
npx vitest run src/no-merchant-web-entry.spec.ts src/beta-removed.spec.ts src/components/ui/primitives-removed.spec.ts src/pages/settings.spec.tsx src/pages/settings-legacy-sync.spec.tsx src/components/ui
  Test Files  35 passed (35) | Tests  232 passed (232)
npx vitest run src/ds-c076-pc10a.spec.ts ... src/ds-legacy-vars-4b.spec.ts src/index-html.spec.ts -> 9 files, 547 tests passed
npx tsc --noEmit -> exit 0;  npx eslint src -> 0 lỗi, 0 cảnh báo
```

### Giả định
- Q-19 "ghi rõ chỉ xem": trang `/merchant` đã nói "bạn chỉ xem, không tự chuyển trạng thái tại đây được" ở khu đơn hàng (`page.tsx:1201`), không thêm banner mới vì roadmap chỉ yêu cầu bỏ lối vào, noindex và Disallow.
- `scripts/uiux/generated/miniapp-endpoints.json` (file sinh ra) còn 4 endpoint `/beta/*` cũ; chạy lại `node scripts/uiux/extract-endpoints.mjs miniapp` khi cần làm mới, không ảnh hưởng chạy thật. `scripts/uiux/scorecard.mjs` (điểm audit lịch sử) và `scripts/audit/routes.json` giữ nguyên.
- Tài liệu lịch sử (`docs/2026-10-review/*`, `docs/audit-2026-09/*`) nhắc `primitives.tsx` giữ nguyên vì là báo cáo tại thời điểm viết.

### Việc còn lại
- Mục 8 (xoá khối "LEGACY v1 → v2 ALIAS" trong `tokens.css` + guard `ds-no-legacy-aliases.spec.ts`) đã xong ở mục dưới; hai mục 6-7 đã gỡ 2 file dùng alias legacy.
- PD-2: gỡ/đóng endpoint API `/beta/*` và module `beta`.

### Việc cần chủ dự án
- Không có quyết định mới. Nếu sau này muốn đối tác vào `/merchant` dễ hơn (đăng nhập riêng, link trong email mời), cần chốt hướng marketplace (Q-19 phương án 2) trước.

## Mục 8 — Dọn alias legacy DS v1 trong `tokens.css` + guard toàn `src` (hậu C-076)

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| Xoá khối "LEGACY v1 → v2 ALIAS" khỏi `css/tokens.css`, thay chỗ dùng còn sót, thêm guard `ds-no-legacy-aliases.spec.ts` | XONG | d6a8f160 |

### Hiện trạng trước khi sửa (bằng chứng alias hết người dùng)
- `grep` toàn `apps/miniapp`, `packages`, `scripts` (loại `node_modules`, `dist`, `.next`) tìm `--neutral-`, `--primary-`, `--leaf-`, `--sun-`, `--success|warning|danger|info`, `--dealer-`, `--clay-200|800`, `--radius-sm|md|lg|xl|full`, `--shadow-xs|sm|md|lg`: ngoài spec chỉ còn (a) 5 chú thích nhắc tên cũ (`order-status.ts`, `cart-badge.tsx`, `storefront-view.tsx`, `dealer-theme.css`, `scorecard.mjs`) và (b) 3 chỗ dùng CHÍNH trong `tokens.css`: `.tubu-card` (`--radius-lg`), `.tubu-skeleton` (`--neutral-100`, `--radius-md`).
- `node scripts/uiux/static-scan.mjs` trước khi sửa: `miniapp files 242 hex 5 rgb 4 legacy 3` (3 chỗ trên; hex 5 = `utils/storefront-theme.ts`; rgb 4 = shimmer, pulse x2 trong `tokens.css` + chấm trang ảnh ở `product-detail.tsx`).

### Thay đổi
- `css/tokens.css` (494 → 407 dòng):
  - Xoá nguyên khối 93 dòng "LEGACY v1 → v2 ALIAS" (neutral/primary/leaf/sun/status/clay-200,800/radius-sm,md,xl,full/shadow-xs..lg/`--dealer-*` cả hex cũ).
  - `.tubu-card`: `--radius-lg` thành `--radius-card` (cùng giá trị, vì `--radius-lg` vốn alias `--radius-card`); alias `--radius-lg` bỏ vì tên nằm trong regex LEGACY của static-scan và không còn người dùng.
  - `.tubu-skeleton`: `--neutral-100` thành `--stone-100`, `--radius-md` thành `--radius-control` (đúng ánh xạ cũ của khối alias nên hình ảnh không đổi).
  - Giữ các biến ngoài khối: `--safe-top`, `--safe-bottom`, `--shadow-card` (còn `.tubu-card` dùng), `--dur-fast|base|slow`, `--ease-out`, `--font-body` (còn `.t-body` dùng). Không nằm trong regex LEGACY của static-scan nên không ảnh hưởng `legacy=0`.
  - Chú thích đầu khối `:root` còn lại viết lại: nói rõ đây là biến tiện ích của miniapp và cấm khai báo lại họ tên v1.
  - Màu thô còn lại gom thành 4 token ở cuối `:root` (dòng định nghĩa token là chỗ được giữ màu thô): `--color-skeleton-shimmer` (trắng 65%), `--color-media-dot-idle` (trắng 85%), `--color-pulse-ring` và `--color-pulse-ring-end` (cam 35% và 0%). Giá trị giữ nguyên từng chữ số nên hình ảnh không đổi; chỗ dùng (`.tubu-skeleton::after`, `@keyframes tubu-pulse`, chấm trang ảnh ở `pages/product-detail.tsx`) chỉ tham chiếu tên.
- `css/dealer-theme.css`: chỉ sửa chú thích (họ `--dealer-*` của v1 đã xoá, `--color-dealer-*` là tên đang dùng).
- Xoá `ds-legacy-alias-contrast.spec.ts` (kiểm tương phản alias `--neutral-400` trên 6 nền): spec này đọc chính `--neutral-400` trong `tokens.css` nên không còn đối tượng. Độ tương phản chữ phụ vẫn được `packages/design-tokens/src/tokens.spec.ts` giữ (kiểm `--color-text-secondary` và `--color-text-tertiary` đạt 4,5:1 trên các nền, dòng 71-79).

### Guard mới `apps/miniapp/src/ds-no-legacy-aliases.spec.ts` (42 ca)
- Quét MỌI `src/**/*.{ts,tsx,css}` trừ `*.spec.*|*.test.*` (không dùng danh sách file như `ds-c076-pc10*.spec.ts`). Có ca kiểm walker thật sự thấy >200 file, thấy `css/tokens.css`, `pages/home.tsx` và không thấy spec.
- Cấm: `var(--neutral-N|primary-N|leaf-N|sun-N|success|warning|danger|info(-bg)|clay-200|clay-800|radius-sm|md|lg|xl|full|shadow-xs|sm|md|lg|dealer-*)` (cả dạng có fallback `var(--danger, #f00)`); cấm khai báo lại các tên đó trong file `.css`; cấm hex và `rgb()/rgba()/hsl()/hsla()` thô.
- Bộ so khớp cùng nguồn `scripts/uiux/static-scan.mjs` (LEGACY, HEX, RGB) để guard và số đo không lệch; riêng guard thêm `hsl/hsla` và `--radius-lg` (static-scan đã có `radius-lg`). Tên v2 và biến còn định nghĩa (`--shadow-card`, `--font-body`, `--color-dealer-*`, `--clay-500`...) có ca "không bắt".
- Ngoại lệ hex/rgb, tối đa 3 mục, mỗi mục kèm lý do (có ca kiểm độ dài danh sách, có lý do, và mục thừa thì đỏ):
  - `css/dealer-theme.css`: palette navy của kênh đại lý, DS v2 chưa thiết kế dealer; trang chỉ tham chiếu `--color-dealer-*`.
  - `utils/storefront-theme.ts`: bảng mã màu cửa hàng do CTV chọn; mã hex là dữ liệu lưu ở backend, không phải màu của DS.
  - Dòng định nghĩa token trong file `.css` (`--ten: giá trị`: `brand-theme.css`, `zaui-bridge.css`, `dealer-theme.css`, token mới của `tokens.css`) không tính là màu thô, cùng quy ước với static-scan.
- ĐỎ rồi XANH: chạy guard khi `tokens.css` còn khối alias: `Tests 3 failed | 39 passed (42)` (ca "tham chiếu biến alias" kê 3 chỗ dùng trong `tokens.css`; ca "khai báo lại tên alias v1" kê từng dòng `--neutral-0` ... `--dealer-bg`; ca "hex/rgb thô" kê 4 dòng: `tokens.css` shimmer + pulse x2, `product-detail.tsx`). Sau sửa: `Tests 42 passed (42)`.

### Lệnh kiểm chứng
```
node scripts/check-undefined-css-vars.mjs
  OK — every var(--x) reference is defined.
node scripts/uiux/static-scan.mjs
  miniapp files 242 hex 5 rgb 0 legacy 0      (hex 5 = storefront-theme.ts, ngoại lệ có lý do)
cd apps/miniapp
npx vitest run src/ds-c076-pc10a.spec.ts src/ds-c076-pc10b.spec.ts src/ds-c076-pc10c1.spec.ts src/ds-c076-pc10c2.spec.ts src/ds-c076-pc10c3.spec.ts src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/ds-no-legacy-aliases.spec.ts src/css src/components/ui src/pages/product-detail tailwind.config.spec.ts src/index-html.spec.ts
  Test Files  46 passed (46) | Tests  809 passed (809)
npx eslint "src/**/*.{ts,tsx}" --max-warnings=0 -> exit 0 (0 lỗi, 0 cảnh báo)
npx tsc --noEmit -> exit 0
```

### Giả định
- Giữ `--shadow-card` và `--font-body` (kèm `.tubu-card`, `.t-body`): theo đặc tả gói chỉ xoá khối alias, các biến ngoài khối còn dùng thì giữ. Hai class này hiện không có nơi nào gắn trong `src` (chỉ `.tubu-skeleton` còn dùng); chưa xoá vì ngoài phạm vi và an toàn hơn khi để nguyên. Nếu muốn dọn tiếp thì xoá `.tubu-card`, `.t-body`, `--shadow-card`, `--font-body` cùng lúc.
- Gom rgba thô thành token thay vì thêm vào danh sách ngoại lệ để danh sách ngoại lệ chỉ còn 2 file có lý do thật (dữ liệu CTV chọn, palette dealer).
- Xoá `ds-legacy-alias-contrast.spec.ts` thay vì viết lại: tên v2 tương ứng đã được `packages/design-tokens/src/tokens.spec.ts` kiểm tương phản.
- Các spec `ds-c076-pc10*.spec.ts`, `ds-legacy-vars-4a/4b.spec.ts` giữ nguyên (còn kiểm thêm ZaUI, emoji, nhãn file); chồng lấn với guard mới ở phần cấm alias nhưng không mâu thuẫn.

### Việc còn lại
- `scripts/uiux/scorecard.mjs:44` còn ghi chú lịch sử "121 alias; `--dealer-*` giữ hex v1": là điểm audit đã chốt, không sửa.
- Tài liệu lịch sử (`docs/2026-10-review/impl/PC-*.md`) còn nhắc `ds-legacy-alias-contrast.spec.ts` trong lệnh kiểm chứng cũ; giữ nguyên vì là báo cáo tại thời điểm viết.

### Việc cần chủ dự án
- Không có quyết định mới. Nếu sau này thiết kế lại kênh đại lý trong DS v2 thì chuyển `css/dealer-theme.css` sang token v2 rồi bỏ ngoại lệ tương ứng trong guard.

## Tổng kết gói PD-1

| Mục | Phát hiện | Trạng thái | Commit |
| --- | --- | --- | --- |
| 1 | C-044 Season Pass (Q-16) | XONG | 160834ad |
| 2 | C-010 "cây thật" thành "góp quỹ trồng cây" (Q-16) | XONG | b1aed272, 8286bc7d, 2e6d4980, 7ddb55bd |
| 3 | Perk hạng không có quy trình (Q-16) | XONG | 7ddb55bd |
| 4 | C-086 cashback (Q-15) | XONG | fef504e5 |
| 5 | C-096 `/merchant` (Q-19) | XONG (mã đã sạch từ PC-7, thêm guard) | 6eb2d07f |
| 6 | C-118 `/beta` (Q-19) | XONG | d05785c1 |
| 7 | C-069 `ui/primitives.tsx` | XONG | ee5ba135 |
| 8 | Dọn alias legacy + guard toàn `src` | XONG | d6a8f160 |

Không có mục BỎ hay MỘT PHẦN. Migration: `20261011090000_pd1_tree_fund_wording_tier_perks` (chỉ UPDATE có WHERE khớp nội dung cũ, áp thử lên Postgres tạm 2 lần: lần 1 mỗi câu `UPDATE 1`, lần 2 `UPDATE 0`) và `20261011110000_pd1_review_wording` (thêm ở review lượt 1, xem mục Review lượt 1).

### Bảng bằng chứng perk hạng (chi tiết ở Mục 2-3/4)
Giữ (có cơ chế trong mã): tích điểm hệ số (`pointMultiplier`), freeship theo hạng (`shipping.tier_freeship_overrides`), giảm 5% (`discountPct` ở `checkout.service.ts`), mã giảm giá sinh nhật (`birthdayVoucherAmount`, cron `birthdayVouchers`). Bỏ (không có mã nào): "+ 1 sample", "+ hộp quà", "Ưu tiên hotline", "Beta tester", "Quà sinh nhật cá nhân hóa". Test `tier-perks-seed.spec.ts` buộc mọi perk trong seed phải khớp một cơ chế thật.

### Danh sách chuỗi hướng khách đã đổi (chi tiết ở Mục 2-3/4)
Miniapp: `tree-actions.tsx`, `use-game-actions.ts`, `harvest-celebration.tsx`, `eco-impact.tsx`, `community-goal.tsx`, `garden-hero.tsx`, `garden-plots.tsx`, `refill.tsx`, `wallet.tsx`. Web admin: `app/admin/page.tsx` (thẻ Sản phẩm). API: lời báo lỗi `game.service.ts`. Dữ liệu DB: 3 mảng `membership_tiers.perks`, câu quiz q6, mô tả khoá `game.tree_xu_price` (seed + migration). Guard giữ chữ cũ không quay lại: `i18n/tree-fund-copy.spec.ts`.
Grep cuối (`cây thật|cay that|PanNature|Rừng Xanh Lên|mua cây`, loại `docs/`): chỉ còn ở `README.md:54`, `DEMO_SCRIPT.md:42-43,60`, `design_handoff/**` (spec thiết kế lịch sử), chú thích `apps/api/prisma/schema.prisma:1493-1517`, nhãn `dead-config-keys.ts` (đúng sự thật: chưa có luồng trồng cây thật), migration cũ + migration mới (chuỗi cũ để khớp WHERE), và các spec guard. Không còn chữ nào hiển thị cho khách.

### Giả định (gộp)
- Ẩn = ngừng gọi API và ngừng dựng lối vào ở miniapp, giữ mã ngủ sau cờ (`SEASON_PASS_ENABLED`, `CASHBACK_ENABLED` trong `utils/features.ts`), giữ route, bảng, endpoint để bật lại.
- "Cây thật" thành "góp quỹ trồng cây" ở mọi chữ hướng khách; tên biến, route, bảng, cột giữ nguyên; ô số CO₂ ước tính đã bỏ sau review lượt 1.
- Perk ghép giữ phần có cơ chế, cắt phần không có; "Voucher sinh nhật" thành "Mã giảm giá sinh nhật" theo Q-26.
- Khoản cashback đã duyệt chờ về Ví vẫn hiển thị ở Ví dù lối vào đã ẩn (không giấu tiền của khách).
- Q-19 `/merchant`: không thêm banner "chỉ xem"; chỉ bỏ lối vào, noindex, Disallow (đã có).
- Mục 8: chi tiết ở Giả định của Mục 8.

### Việc còn lại
- PD-2: gỡ/đóng endpoint API `/beta/*` và module `beta`.
- `README.md:54` và `DEMO_SCRIPT.md:42-43,60` còn nói "PanNature/cây thật" (tài liệu nội bộ ngoài nhóm file của gói); nên sửa trước khi đem kịch bản đi demo.
- `scripts/uiux/generated/miniapp-endpoints.json` còn 4 endpoint `/beta/*` cũ; chạy lại `node scripts/uiux/extract-endpoints.mjs miniapp` khi cần.
- Chưa chạy Playwright/e2e và dev server (quy ước gói); e2e không nhắc beta, cashback, Season Pass, "cây thật" nên không phải đổi selector (`grep -rniE "season|cashback|hoàn tiền sàn|beta|cây thật|pannature" apps/e2e/tests` chỉ ra `cashbackPending`/`cashbackHoldDays` là dữ liệu mock API trong `support/checkout-mocks.ts`, không phải selector hay chữ hiển thị).

### Việc cần chủ dự án
- Áp hai migration `20261011090000_pd1_tree_fund_wording_tier_perks` và `20261011110000_pd1_review_wording` lên PROD bằng `prisma migrate deploy` khi phát hành (chỉ đổi chữ: 4 hạng, 1 câu quiz, 1 mô tả cấu hình, 1 mốc cộng đồng); kiểm bằng `select name, perks from membership_tiers` và `select title, region from community_goals`.
- Mốc cộng đồng seed đã đổi sang "Cùng Tubu góp quỹ trồng cây" / "Cộng đồng Tubu" (migration `20261011110000_pd1_review_wording`, chỉ khớp khi admin chưa sửa tay). Mốc nào admin đã tự đặt tên một địa điểm cụ thể thì cần admin tự rà.
- Bật lại khi có điều kiện: `SEASON_PASS_ENABLED` (khi có công cụ tạo mùa), `CASHBACK_ENABLED` (khi có key AccessTrade và đo được tác động lên đơn), chữ "trồng cây thật" + tên đối tác (khi có hợp đồng và ngân sách, kèm luồng `PLANTED` + báo cáo cho khách), perk hạng đã bỏ (khi dựng xong quy trình thật).

## Review lượt 1

Reviewer độc lập đưa 4 phát hiện (1 major, 3 minor). Đã xác minh từng điểm trên mã.

| # | Mức | Phát hiện | Kết luận | Commit |
| --- | --- | --- | --- | --- |
| 1 | major | `eco-impact.tsx` còn ô `~${treesPlanted*21}kg CO₂ hấp thụ/năm` ngay cạnh "Cây đã góp quỹ" | ĐÚNG, đã sửa | fee8f36e |
| 2 | minor | Seed mốc cộng đồng còn "phủ xanh Cần Giờ" + vùng "Rừng ngập mặn Cần Giờ, TP.HCM" | ĐÚNG, đã sửa | a880da16 |
| 3 | minor | `scripts/uiux/generated/miniapp-endpoints.json` còn 4 chỗ trỏ `beta-api.ts` đã xoá | KHÔNG SỬA, ghi nhận file cũ (lý do dưới) | không |
| 4 | minor | Perk còn "Tích điểm 1.2x/1.5x/2x", Q-26 chuẩn là "Điểm Xanh" | ĐÚNG, đã sửa | a880da16 |

### 1. CO₂ gán cho cây khách đã góp (major) — XONG
Xác minh: ô số liệu là `treesPlanted * 21` kg, nhãn "CO₂ hấp thụ/năm (ước tính)" đặt cạnh "Cây đã góp quỹ N". Khách góp 3 cây thấy "~63kg", nghĩa là cây của mình đang hấp thụ CO₂, trong khi `PlantedTree` vẫn `PLEDGED` và chưa có luồng trồng thật. Đây đúng là lời hứa cây cụ thể mà Q-16 gỡ; test `game-behavior.spec.tsx` còn khoá "~63kg".
Cách sửa: bỏ ô CO₂ (cùng import `Wind`), thẻ Tác động xanh còn hai ô "Cây đã góp quỹ" và "Giọt nước đã góp". Không thay bằng câu "mỗi cây hấp thụ ~21kg" vì vẫn là tuyên bố môi trường không có nguồn.
Test (đỏ rồi xanh):
- `i18n/tree-fund-copy.spec.ts`: ca mới "không gán số CO₂ hấp thụ cho phần cây khách đã góp" quét `src/**/*.{ts,tsx}` (trừ spec) tìm `CO₂|CO2|hấp thụ`. ĐỎ: kê `components/game/eco-impact.tsx`; XANH sau khi bỏ ô.
- `pages/game-behavior.spec.tsx`: thay `toContain('~63kg')` bằng `not.toMatch(/CO₂|kg/)`. ĐỎ trước khi sửa mã (textContent có "~63kgCO₂ hấp thụ/năm"), XANH sau.

### 2. Mốc cộng đồng seed nêu địa điểm (minor) — XONG
Xác minh: `community-goal.tsx` in `goal.title` và `{goal.region} · mục tiêu góp quỹ trồng N cây`; seed `cg-cangio-2026` đặt title "Cùng Tubu phủ xanh Cần Giờ", region "Rừng ngập mặn Cần Giờ, TP.HCM", nên khách đọc ra cam kết trồng tại một địa điểm có tên mà chưa có quy trình. Dữ liệu nằm trong DB, migration trước không đụng tới.
Cách sửa: seed đổi thành title "Cùng Tubu góp quỹ trồng cây", region "Cộng đồng Tubu" (cột `region` NOT NULL nên không đặt rỗng); migration mới `UPDATE community_goals ... WHERE id='cg-cangio-2026' AND title=<cũ> AND region=<cũ>`. `treesToPlant`, `targetDrops` không đổi. Mốc admin đã đổi tay thì không khớp WHERE nên giữ nguyên.
Giữ nguyên: mùa `se-2026-he-cangio` ("Mùa Hè Xanh — Phủ xanh Cần Giờ") và vùng của loài cây ở sổ tay: Season Pass đã ẩn khỏi miniapp (C-044), vùng loài cây là kiến thức về loài, không phải cam kết trồng.

### 4. Perk dùng "Điểm Xanh" (minor) — XONG
Xác minh: `Điểm Xanh` là thuật ngữ đang dùng khắp miniapp (ví dụ `wheel.tsx`, `reviews-section.tsx`, `account-api.ts`); perk còn "Tích điểm Nx" lệch Q-26. Làm vì rẻ và nằm đúng nhóm file seed + migration.
Cách sửa: seed và migration đổi cả bốn hạng thành "Tích Điểm Xanh x1", "x1.2", "x1.5", "x2" (hệ số vẫn đọc từ `pointMultiplier`). `loyalty.tsx` in nguyên mảng `perks` từ API nên không phải sửa UI.
Test (đỏ rồi xanh): `loyalty/tier-perks-seed.spec.ts` đổi regex cơ chế `Tích Điểm Xanh x([\d.]+)` và danh sách perk chốt, thêm 5 ca cho migration mới (chỉ UPDATE có WHERE, mảng cũ = kết quả migration trước, mảng mới = seed, mốc cộng đồng). ĐỎ 8 ca trước khi sửa seed + viết migration; XANH 15/15 sau.

### Migration `20261011110000_pd1_review_wording`
5 câu UPDATE (không INSERT/DELETE/DROP/ALTER), mỗi câu có WHERE khớp đúng kết quả của migration trước: 4 hạng (`membership_tiers.perks`, so sánh JSONB theo tên hạng) và 1 mốc cộng đồng. Đứng sau `20261011090000_pd1_tree_fund_wording_tier_perks` nên chuỗi cũ khớp trên PROD.
Kiểm bằng Postgres thật (container `tubu_it_main`, cổng 5550, DB tạm `pd1_scratch_r1` đã xoá, không đụng `tubutree_it`): `prisma migrate deploy` áp đủ migration; chèn trạng thái sau migration trước (Cổ Thụ có thêm perk do admin gõ tay, thêm một mốc admin tự đặt tên) rồi chạy `migration.sql`:
```
lần 1: UPDATE 1 / UPDATE 1 / UPDATE 1 / UPDATE 0 (Cổ Thụ sửa tay, giữ nguyên) / UPDATE 1 (mốc cg-cangio-2026)
lần 2: UPDATE 0 x5 (idempotent)
 Mầm Xanh | ["Tích Điểm Xanh x1"]
 Lộc Biếc | ["Tích Điểm Xanh x1.2", "Freeship đơn ≥ 99k", "Mã giảm giá sinh nhật 50k"]
 cg-cangio-2026 | Cùng Tubu góp quỹ trồng cây | Cộng đồng Tubu
 cg-admin-edit  | Mốc admin đặt | Rừng ngập mặn Cần Giờ, TP.HCM   (giữ nguyên)
```

### 3. `miniapp-endpoints.json` cũ (minor) — KHÔNG SỬA
Xác minh: đúng, còn 4 tham chiếu `beta-api.ts`. Đã thử `node scripts/uiux/extract-endpoints.mjs miniapp`: diff 1.427 dòng (+1.122/-305) vì file chưa được sinh lại từ lúc audit, gồm cả số dòng dịch chuyển của mọi gói PC đã xong, không riêng PD-1. Không bước CI nào đọc file này (chỉ harness chụp màn hình `scripts/uiux`), và PD-2 cũng sửa `/beta/*` nên dễ xung đột khi gộp. Đã đưa file về nguyên trạng và ghi nhận ở "Việc còn lại": nên sinh lại một lần sau khi gộp PD-2.

### Lệnh kiểm chứng (review lượt 1)
```
cd apps/miniapp
npx vitest run src/i18n src/pages/game-behavior.spec.tsx src/pages/game-numbers.spec.tsx src/pages/game-layout.spec.tsx src/pages/game-wheel-tabs.spec.tsx src/ds-no-legacy-aliases.spec.ts
  Test Files 9 passed (9) | Tests 149 passed (149)
npx tsc --noEmit -> exit 0;  npx eslint <file đã sửa> -> 0 lỗi, 0 cảnh báo
cd apps/api
npx jest src/modules/loyalty/tier-perks-seed.spec.ts src/modules/game --maxWorkers=1
  Test Suites: 11 passed, 11 total | Tests: 170 passed, 170 total
npx tsc --noEmit -p tsconfig.json -> exit 0;  npx eslint src/modules/loyalty/tier-perks-seed.spec.ts -> 0 lỗi
```

### Giả định
- Vùng mốc cộng đồng đặt "Cộng đồng Tubu" (trung tính, không địa điểm) vì cột `region` bắt buộc có giá trị; chủ dự án đổi lại được ở tab quản trị khi có đối tác trồng thật.
- Bỏ ô CO₂ thay vì viết lại, vì mọi cách diễn đạt số kg gần ô "cây đã góp" đều dễ bị đọc thành cây của khách.

### Việc còn lại
- Sinh lại `scripts/uiux/generated/miniapp-endpoints.json` sau khi gộp PD-2 (`node scripts/uiux/extract-endpoints.mjs miniapp`).
- Ghi chú ở `apps/api/prisma/schema.prisma` (`CommunityGoal.region` ví dụ "Rừng phòng hộ Cần Giờ") là chú thích, ngoài nhóm file của gói, giữ nguyên.

### Việc cần chủ dự án
- Không có quyết định mới. Nhắc áp thêm migration `20261011110000_pd1_review_wording` cùng migration trước khi phát hành.
