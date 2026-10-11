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
