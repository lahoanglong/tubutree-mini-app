# PB-5 - Cron múi giờ + feed + danh sách chưa giới hạn

## C-026 - XONG (mục 1/2 của gói)
- 29 `@Cron` (27 thiếu timeZone, 2 đã có literal) đều có `{ timeZone: CRON_TZ }`; hằng `CRON_TZ = 'Asia/Ho_Chi_Minh'` ở `apps/api/src/common/cron-tz.ts`. Hai cron đã có literal (`analytics-aggregation`, `pending-payment-expiry`) đổi sang hằng. Thưởng quý đại lý (`0 0 4 10 1,4,7,10 *`) nay chạy 04:00 ngày 10 giờ VN.
- `TZ=Asia/Ho_Chi_Minh` cho service `api` trong `docker-compose.prod.yml` và `docker-compose.vietnix.yml` (dev compose không có api); `apps/api/Dockerfile` runner thêm `tzdata` và `ENV TZ` (alpine cần tzdata thì TZ mới có hiệu lực).
- Test tĩnh `src/common/cron-timezone.spec.ts`: quét mọi `.ts` (trừ spec) dưới `src/`, bắt từng decorator `@Cron(...)` (cân ngoặc) và đòi có `timeZone:`; chỉ tính dòng bắt đầu bằng `@Cron(` nên comment không gây nhiễu. Đỏ: gỡ timeZone khỏi `loyalty.cron.ts` thì fail đúng file đó (24 pass, 1 fail); xanh sau khi trả lại (25/25). Cron mới của PB-2/PB-4 đã có timeZone riêng nên xanh sau merge (literal hay `CRON_TZ` đều qua).
- Helper lịch VN `src/common/vn-time.ts` (`startOfVnDay`, `startOfVnMonth`, `vnDateParts`, `vnMonthKey`, `formatVnDate`), tính bằng số học UTC. Jest chạy `TZ=UTC` qua `globalSetup` (`test/jest-global-utc.js`, khai trong `jest.config.js`) vì jest sao chép `process.env` cho từng test file, gán TZ trong spec không tác động; chạy UTC để lỗi lộ ra cả trên máy dev múi giờ VN.

### Chỗ tính "đầu ngày / tháng / ngày hiển thị" lệch (đã sửa, mỗi chỗ có test đỏ rồi xanh)
| File | Lỗi khi host UTC | Sửa |
|---|---|---|
| `feed/community-feed.service.ts` bumpReputation | trần điểm/ngày tính từ 07:00 VN | `startOfVnDay()` |
| `feed/community-reward.service.ts` | trần thưởng xu/ngày từ 07:00 VN | `startOfVnDay()` |
| `game/game.service.ts` waterTree, `game/game-garden.service.ts` waterPlot | trần coupon thu hoạch/ngày từ 07:00 VN | `startOfVnDay()` |
| `refill/refill.service.ts` usedThisMonthTx | hạn mức đổi chai tháng từ 07:00 ngày 1 VN | `startOfVnMonth()` |
| `vouchers/vouchers.service.ts` birthdayVouchers | cron 01:00 VN = 18:00Z hôm trước: lọc sinh nhật lùi 1 ngày, khoá chu kỳ sai năm/tháng ở 1/1, 1/mỗi tháng | `vnDateParts()` |
| `vouchers/vouchers.service.ts` winbackVouchers | khoá `WINBACK-yyyy-mm` theo UTC: 02:00 ngày 1 ra tháng trước | `vnMonthKey()` |
| `vouchers`, `lifecycle/remarketing`, `loyalty/loyalty-expiry` | `toLocaleDateString('vi-VN')` theo TZ host: hạn 00:00 VN hiện lùi 1 ngày trong thông báo | `formatVnDate()` |

Test đỏ trước sửa (jest TZ=UTC): 7 test fail ở 5 suite (vouchers, feed x2, game, refill); xanh sau sửa. Game-garden dùng cùng dòng với game.service nhưng chưa có test riêng (chung helper đã test).

### Rà và để nguyên (đã đúng hoặc ảnh hưởng nhỏ)
- Đã tính theo offset +7 đúng: `analytics-aggregation`, `game-quiz/game-economy/game-gift/game-reminder/game.service` dayKey, `loyalty.service` dayKey, `ctv-milestones`, `affiliate` vnDayStart, `dealer` quý/năm, `payroll`, `staff/shifts/time.util`, `vouchers.milestoneVouchers`.
- Không sửa, ghi nhận: mã đơn `ymd` theo UTC (`affiliate.service:427`, `checkout.service:632`, `zalopay.service:208`) chỉ là phần ngày trong mã, đơn tạo 00:00-07:00 VN mang ngày hôm trước, không ảnh hưởng tiền; `analytics-admin.controller retentionDaily` `since = now - n ngày` (UTC) lệch tối đa vài giờ ở biên cửa sổ; `loyalty.service` `setMonth` hạn điểm (cộng tháng lịch, không phụ thuộc TZ ở mức ngày đáng kể).
- Với `TZ=Asia/Ho_Chi_Minh` ở container, các chỗ local-time còn sót (nếu có) cũng ra giờ VN.

### Kiểm chứng (apps/api)
- `npx jest --maxWorkers=1 src/common/cron-timezone.spec.ts`: 25 pass.
- `npx jest --maxWorkers=1 src/common src/modules/vouchers src/modules/refill src/modules/feed src/modules/game src/modules/lifecycle src/modules/loyalty`: 29 suite / 627 test xanh (TZ=UTC).
- `npx jest --maxWorkers=1 src/modules/{dealer,staff,affiliate,analytics,subscriptions,flash-sale,cashback,catalog,groupbuy,storefront}`: 43 suite / 741 test xanh dưới TZ=UTC (không suite nào phụ thuộc giờ local).
- `npx tsc --noEmit -p tsconfig.json` sạch; ESLint các file đã sửa sạch.

### Migration
Không.

### Giả định / việc còn lại
- Giả định: đặt TZ=UTC cho jest toàn apps/api là chấp nhận được (chỉ 1 spec dùng Date local trước đó và vẫn xanh).
- Triển khai: compose đổi env + Dockerfile thêm tzdata nên cần build lại image api; áp dụng khi deploy. Các mục còn lại của gói (C-042 feed, C-100 danh sách chưa giới hạn) do lượt khác làm.
