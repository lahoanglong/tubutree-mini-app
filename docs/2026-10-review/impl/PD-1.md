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
- Mục 2 đến 8 của PD-1 do lượt khác làm.

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

Giữ nguyên: tên biến/hàm (`buyTree`, `plantTree`, `PlantedTree`, `treesPlanted`, `certificateCode`...), route `POST /game/tree/buy`, bảng, cột, `schema.prisma`, `dead-config-keys.ts` (nhãn admin báo khoá `eco.real_tree_*` không có luồng đọc: đúng sự thật), số CO₂ ước tính (21 kg/cây) ở thẻ Tác động xanh.

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
- Mục 4 đến 8 của PD-1 do lượt khác làm (cashback đã xong ở mục 1/4; còn C-096, C-118, C-069, dọn alias legacy).
- `README.md:54` (danh sách việc chưa làm: "Tích hợp PanNature") và `DEMO_SCRIPT.md:42-43,60` (kịch bản demo nói "cây thật qua PanNature") là tài liệu nội bộ ngoài nhóm file của gói, chưa sửa. Nên đổi trước khi đem kịch bản đi demo cho đối tác.

### Việc cần chủ dự án
- Khi áp migration lên PROD (`prisma migrate deploy`): migration chỉ đổi chữ dữ liệu (5 dòng: 3 hạng, 1 câu quiz, 1 mô tả cấu hình), có thể kiểm bằng `select name, perks from membership_tiers`.
- Mốc cộng đồng "Cùng Tubu phủ xanh Cần Giờ" (tiêu đề, vùng, `treesToPlant`) nằm trong DB và do admin sửa; tiêu đề/vùng cụ thể có thể làm khách hiểu là sẽ trồng đúng tại Cần Giờ. Nếu chưa có đối tác thực hiện, nên đổi tên mốc ở trang quản trị thành tên chung hơn.
- Khi có hợp đồng đối tác trồng cây + ngân sách: mới đưa lại chữ "trồng cây thật" và tên đối tác; lúc đó cần luồng đánh dấu `PLANTED` + báo cáo cho khách.
- Muốn có lại perk "Ưu tiên hotline", "Beta tester", quà sinh nhật/hộp quà/sample: phải dựng quy trình trước (hàng đợi CSKH theo hạng, gắn hạng với chương trình beta, quy trình gửi quà), rồi mới thêm lại vào `TIERS` (test `tier-perks-seed.spec.ts` sẽ buộc khai báo cơ chế).
