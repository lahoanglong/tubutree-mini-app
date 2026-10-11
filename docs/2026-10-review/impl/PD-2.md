# PD-2 — Dọn logic trùng, endpoint/khoá/bảng chết (API) + luật đánh giá Q-30

## Mục 1/4 — C-040 gom helper trùng về `apps/api/src/common/`

Hai lượt: lượt 1 làm mã đơn, chuẩn hoá SĐT, dayKey giờ VN; lượt 2 làm `maskName` x4 và `notifyAdminsOf` x3 (phần (b), (c) bên dưới).

| Nhóm | Trạng thái | Commit đặc tả (xanh trên bản cũ) | Commit gom |
| --- | --- | --- | --- |
| (a) Mã đơn x4 -> `common/order-code.ts` (`generateUniqueOrderCode(prisma, kind)`) | XONG | b5d02b25 | a9e4e58d |
| (b) Che tên x4 -> `common/mask-name.ts` (`maskName`, `maskFullName`) | XONG | 3b2aa2e6 | b686cfae |
| (c) Báo admin x3 -> `common/notify-admins.ts` (`notifyAdmins`) | XONG | 33bb7c40 | 5a23030b |
| (d) Chuẩn hoá SĐT x4 -> `common/phone.ts` (3 hàm) | XONG | 14af8242 | fc17c6ed |
| (e) dayKey giờ VN x7 -> `vnDateKey` trong `common/vn-time.ts` | XONG | 60f85691 | 2b0f1920 |

Lệnh kiểm của C-040 sau khi gom: `grep -rn 'private async generate.*Code\|private maskName\|function maskFullName\|notifyAdminsOf' apps/api/src --include='*.ts' | grep -v spec` chỉ còn 2 dòng: `common/mask-name.ts` (định nghĩa `maskFullName`) và `auth.service.ts:637 generateReferralCode` (mã GIỚI THIỆU của người dùng, không phải mã đơn, khớp mẫu `generate.*Code` do mẫu lệnh rộng; không thuộc C-040).

### (a) Mã đơn — các bản chép tay và khác biệt
| Nơi (cũ) | Định dạng | Ghi chú |
| --- | --- | --- |
| `checkout.service` `generateCode` | `TUBU` + yyyymmdd theo UTC + `randomInt(0,100000)` đệm 5 số | fallback `TUBU<Date.now()>` |
| `affiliate.service` `generateOrderCode` (đơn lên hộ) | giống hệt checkout | bản sao chép tay của checkout |
| `dealer.service` `generateCode` | `DLR` + 8 số cuối `Date.now()` + `randomInt(0,1000)` đệm 3 số | không có ngày lịch; fallback `DLR<Date.now()>` |
| `subscriptions.service` `generateCode` | `TUBUSUB` + 7 số cuối `Date.now()` + `randomInt(0,1000)` đệm 3 số | không có ngày lịch; fallback `TUBUSUB<Date.now()>` |

**Hành vi khác nhau (không thống nhất ngầm):** (1) ngày trong mã TUBU tính theo UTC, không theo giờ VN: đơn đặt 00:00-07:00 giờ VN mang ngày hôm trước. Đây có thể là lỗi nhỏ nhưng mã đang chạy trên PROD, đã in trên đơn/hoá đơn/Pancake nên KHÔNG đổi sang giờ VN; helper giữ UTC và ghi rõ trong comment. (2) Ba loại mã khác tiền tố/độ dài/nguồn ngẫu nhiên nên helper nhận tham số `kind` (`RETAIL` | `DEALER` | `SUBSCRIPTION`) thay vì một công thức chung. Tính duy nhất giữ nguyên: kiểm `findUnique` tối đa 6 lần, hết lượt trả `<prefix><Date.now()>` (không kiểm lại); lớp chặn thật vẫn là unique `orders.code`.

`sellable-product.race-spec.ts` từng spy `DealerService.prototype.generateCode`; đã đổi sang spy `generateUniqueOrderCode` của module `common/order-code`.

### (b) Che tên — 4 bản chép tay, 2 hành vi
| Hàm mới | Thay cho | Hành vi |
| --- | --- | --- |
| `maskName` | `maskName` private ở `game.service`, `game-gift.service`, `game-season.service` (3 bản giống hệt) | rỗng/null -> `Bạn Tubu`; chỉ tách theo dấu cách thường `' '`; từ cuối + `***`; tên toàn khoảng trắng ra `***` |
| `maskFullName` | `maskFullName` module-level ở `merchant.service` | rỗng/toàn khoảng trắng -> `Khách Tubu`; tách theo MỌI khoảng trắng (`\s+`); từ cuối + `***` |

**Hành vi khác nhau:** (1) tên toàn khoảng trắng: game cho `***`, merchant cho `Khách Tubu`; (2) tab/nbsp giữa tên: game không tách (`Lã\tLong` -> `Lã\tLong***`), merchant tách (`Long***`); (3) tên mặc định khác nhau (`Bạn Tubu` vs `Khách Tubu`). Đây là cái khách đang thấy trên BXH/danh sách bạn và cái CTV thấy trên đơn, nên giữ hai hàm, mỗi hàm một comment nói vì sao tách; KHÔNG thống nhất ngầm. Bảng ca 9 dòng chạy qua đường vào công khai của cả 4 nơi (`getSeasonLeaderboard`, `getFriends`, `getLeaderboard`, `listMerchantOrders`) ở commit 3b2aa2e6, xanh trước khi gom, giữ nguyên sau khi gom; `common/mask-name.spec.ts` chạy cùng bảng trên hai hàm mới.

### (c) Báo admin — 3 bản chép tay
Bản cũ: `DealerService.notifyAdminsOfCreditReport` (đại lý báo đã chuyển khoản, template `DEALER_CREDIT_PAYMENT_REPORTED`), `DealerService.notifyAdminsOfClaim` (yêu cầu nhận thưởng mốc, `DEALER_REWARD_CLAIM_NEW`), `UsersService.notifyAdminsOfDeletionRequest` (yêu cầu xoá tài khoản, `ACCOUNT_DELETION_REQUESTED`). Cả ba cùng khung: chưa wiring NotificationsService -> cảnh báo và bỏ qua trước khi truy vấn; lấy tối đa 20 ADMIN chưa khoá; không có admin -> cảnh báo; `Promise.allSettled` báo từng admin; đếm lỗi -> cảnh báo; lỗi truy vấn thì ném ra cho nơi gọi bắt (`.catch` + log warn, không chặn việc đã ghi).

Helper `notifyAdmins({prisma, notifications, logger}, {template, subject, data})`. `data` là hàm chạy SONG SONG với truy vấn admin (hai bản dealer vốn đã `Promise.all` truy vấn admin với truy vấn tên đại lý). Hai bản dealer dùng thêm `dealerLabel(userId)` (tên, không có thì SĐT, không có nữa thì mã) thay cho đoạn trùng. Nơi bắt lỗi giữ ở nơi gọi.

**Hành vi khác nhau:** chỉ ở câu cảnh báo log. Ba bản có ba cách đặt câu ("không báo được admin đại lý X báo đã chuyển khoản", "... admin về yêu cầu nhận thưởng X", "... yêu cầu xoá tài khoản X (request R)"). Helper thống nhất về `NotificationsService chưa wiring — không báo được admin <subject>.`, `Không có tài khoản ADMIN nào để báo <subject>.`, `Báo admin <subject>: lỗi f/n.`. Không đổi gì ngoài chữ trong log. Đặc tả (commit 33bb7c40, xanh trước khi gom) chạy qua `reportCreditPayment`, `claimReward`, `requestAccountDeletion`, nên cùng bộ ca chạy lại nguyên vẹn sau khi gom: truy vấn admin (`where`/`select`/`take: 20`), payload đủ khoá, chuỗi tên hiển thị, thiếu wiring, không có admin, một admin lỗi, truy vấn lỗi. Cảnh báo chỉ kiểm bằng `stringContaining` để chịu được thống nhất câu chữ.

### (d) SĐT — 4 bản chép tay, 3 hành vi khác nhau
| Hàm mới | Thay cho | Hành vi |
| --- | --- | --- |
| `normalizeZaloPhone` | `zalo.service` `normalizePhone` | bỏ ký tự không phải số; có `84` đầu -> `0`+phần sau; không có `0` đầu -> thêm `0`; bắt buộc đúng `0` + 9 số, sai -> `null`; rỗng/`undefined`/`null` -> `null` |
| `parseVnPhoneStrict` | `loyalty.service` `normalizeVnPhone` (qua `parseMemberCode`) | chỉ nhận `+?<số>`; `84` + 11 số -> `0`+9 số; KHÔNG tự thêm `0` đầu (9 số trần có thể là mã thành viên); bắt buộc `0` + 9 số |
| `toLocalPhone` | `affiliate.service` `normalizeToLocalPhone` và `order-reversal.service` `normalizeLocalPhone` (hai bản giống hệt) | chỉ bỏ ký tự không phải số và đổi `84` + 9 số thành `0` + 9 số, KHÔNG kiểm độ dài; rỗng -> `null` |

**Hành vi khác nhau:** ba mức chặt khác nhau (Zalo bắt thêm `0` và kiểm 10 số; quầy từ chối số không có `0` đầu; khoá gộp khách không kiểm gì). Gộp thành một hàm sẽ đổi hành vi ít nhất một nơi (vd khoá `endCustomerKey` của đơn lên hộ đang lưu trên PROD), nên giữ 3 hàm, mỗi hàm một comment nói vì sao tồn tại. Bảng `ROWS` trong `common/phone.spec.ts` đo cả 4 bản cũ trên cùng một tập đầu vào (commit 14af8242, xanh trước khi gom) và giữ nguyên sau khi gom. Thêm `zalo.service.spec.ts` kiểm đường `resolvePhoneNumber` còn gọi đúng hàm mới.

### (e) dayKey giờ VN — 7 bản chép tay
Bảy nơi: `loyalty.service` `getVnDayKey`, `game-gift`, `game-quiz`, `game-economy` (mỗi nơi `dayKey`), `game.service` `dayKey`, `subscriptions.service` `vnDateOf`, `staff/shifts/time.util` `vnDateKey`. Cả bảy cùng công thức `new Date(d + 7h).toISOString().slice(0,10)` và cho cùng kết quả trên 8 mốc biên (cuối ngày, qua ngày, qua năm, 29/2, epoch) và cùng ném `RangeError` với Date không hợp lệ (63 ca đặc tả ở commit 60f85691, xanh trên bản cũ). Không có khác biệt hành vi.
- `game.service` `dayKey` KHÔNG có nơi gọi (chết) nên xoá, không gom.
- `staff/shifts/time.util` bỏ `vnDateKey`; `attendance.service` và `time.util.spec` import từ `common/vn-time`.
- `loyalty.service.spec` đổi sang `vnDateKey()` của common (trước đó gọi method private `getVnDayKey`).
- Chưa gom (ngoài phạm vi dayKey, ghi ở "Việc còn lại"): các bản `startOfDay` (game, game-quiz, game-economy, game-reminder) tương đương `startOfVnDay` đã có trong common.

### Kiểm chứng
Xem bảng test ở phần trả về của lượt (lệnh + kết quả thật). Tóm tắt:
- `tsc --noEmit` (apps/api): exit 0; ESLint các file đã sửa: exit 0.
- Jest: `src/common`, `src/modules/staff`, `src/modules/game`, `src/modules/loyalty`, `src/modules/subscriptions`, và các spec checkout/dealer/affiliate/orders/auth liên quan: xanh.
- Race spec Postgres thật (cổng 5582, `--runInBand`, từng file): buy-flow-4a, buy-flow-4b, dealer, sellable-product, subscription-cycle-payment, subscription-duplicate, affiliate, ctv-assisted-refund, loyalty, game-spin-limit, auth-merge-guest, attendance-out-of-range.

### Giả định
- Mã đơn giữ ngày UTC (xem trên) vì đổi sẽ đổi mã đang chạy; nếu chủ dự án muốn đổi sang giờ VN thì là quyết định riêng (mã in trên đơn/Pancake).
- Hành vi xoá `game.service.dayKey`: không có nơi gọi trong `apps/api/src` (grep `this.dayKey` trong file: 0).

### Kiểm chứng lượt 2 (maskName, notifyAdminsOf)
- `npx jest src/common/mask-name.spec.ts` cùng 4 spec game/merchant (maskName): 5 suite, 155 test xanh. `npx jest src/common/notify-admins.spec.ts src/modules/dealer src/modules/users`: 10 suite, 205 test xanh.
- `tsc --noEmit` (apps/api) exit 0; ESLint các file đã sửa exit 0.
- Race spec Postgres thật (cổng 5582, `--runInBand`, từng file): dealer, dealer-claim-reopen, dealer-bigint-volume, dealer-credit-limit, dealer-bonus, account-deletion, game-spin-limit: xanh.

### Việc còn lại (mục 1)
- Gom `startOfDay` (game, game-quiz, game-economy, game-reminder) về `startOfVnDay`; `ctv-milestones`, `brand.service`, `vouchers.service`, `dealer.service` còn tự tính `VN_OFFSET` (không phải dayKey nên không thuộc nhóm (e)).

## Mục 2/4 — C-108, C-054, C-099 (bảng/cột chết, khoá config chết, khoá cửa sổ giới thiệu)

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| C-054 khoá config chết còn sót sau PC-8 | XONG (1 khoá còn sót) | e0c44d28 |
| C-099 / Q-31 khoá cửa sổ giới thiệu | XONG (đã đúng từ PA-7 + PC-8, thêm test chốt) | e0c44d28 |
| C-108 đánh dấu `/// @deprecated` bảng/cột chết | XONG (9 bảng/cột, không DROP, không migration) | 754a8428 |

### C-054 — khoá config chết còn sót
PC-8 đã làm phần lớn: `system-config/dead-config-keys.ts` liệt kê 24 khoá, admin bị chặn ghi (`admin-config-rules.ts`), `GET /admin/config` gắn `deprecated`, seed không gieo nữa. Lượt này dò lại TOÀN BỘ khoá xuất hiện trong seed, `RANGES`, luật ghi admin, che giá trị, danh sách chết (128 khoá) bằng script quét mã nguồn (bỏ spec, bỏ comment, bỏ file chỉ mô tả khoá): 25 khoá có 0 chỗ đọc = 24 khoá đã liệt kê + 1 khoá còn sót.
- Khoá sót: `cashback.merchant_tubu_share` (0,3 "Tubu giữ 30%"). Chỉ còn trong `seed.ts` và bảng `RANGES` của `system-config.service.ts`; `cashback.service.ingest` chỉ đọc `cashback.merchant_user_share` (`userReward = floor(commission * userShare)`), phần Tubu là phần còn lại. Spec cũ không bắt được vì coi `RANGES` là "chỗ đọc".
- Sửa: thêm vào `DEAD_CONFIG_KEYS` (admin hết sửa được, UI hiện "Không dùng"), gỡ khỏi `seed.ts` và `RANGES`. Dòng đã có trên DB giữ nguyên (không DELETE).
- Spec `dead-config-keys.spec.ts`: nguồn dò bỏ 4 file chỉ mô tả khoá (`dead-config-keys.ts`, `system-config.service.ts`, `admin-config-rules.ts`, `config-redaction.ts`) để lần sau khoá chỉ nằm ở bảng biên/luật không còn bị coi là "có code đọc".
- ĐỎ trước khi sửa (`Tests: 2 failed, 5 passed`): `expect(unread).toEqual([])` nhận `["cashback.merchant_tubu_share"]`; `isDeadConfigKey('cashback.merchant_tubu_share')` nhận `false`. XANH sau sửa: `src/modules/system-config src/modules/admin` 12 suite, 254 test.

### C-099 / Q-31
- Chỉ MỘT khoá cửa sổ ghi nhận giới thiệu được đọc: `affiliate.attribution_days` (`affiliate.service.ts:122`, mặc định 7, seed `createOnly` từ PA-7).
- `affiliate.last_click_window_days` đã nằm trong `DEAD_CONFIG_KEYS` (PC-8) với lý do "Cửa sổ ghi nhận giới thiệu là affiliate.attribution_days"; không có trong seed, 0 nơi đọc trong `apps/api`, `apps/web`, `apps/miniapp`, `packages`, `scripts`, `ops`. Không cần gỡ thêm.
- Hai khoá cửa sổ khác KHÔNG phải cửa sổ ghi nhận giới thiệu CTV và còn dùng: `referral.window_days` (đơn thứ 2 của người được mời, `coins.service`), `returns.window_days` (hạn đổi/trả).
- Test chốt (mới, xanh ngay vì chỉ xác nhận): `dead-config-keys.spec.ts` ca "cửa sổ ghi nhận giới thiệu CTV chỉ đọc một khoá" quét mã nguồn chạy thật, mẫu `affiliate.*(attribution|click_window)*` chỉ ra đúng `['affiliate.attribution_days']`.

### C-108 — bảng/cột đánh dấu `/// @deprecated` (không DROP, không đổi cấu trúc)
Mọi mục xác minh lại bằng `git grep -w` trên HEAD (`apps packages scripts ops`, bỏ migrations/schema/md). Lưu ý: mẫu `\b` của `git grep -E` trên macOS không chạy nên lần đầu cho kết quả rỗng sai; đã làm lại bằng `-w`.

| Bảng/cột | Đọc | Ghi | Quyết định |
| --- | --- | --- | --- |
| `CohortRepeatSnapshot` | 0 | 0 (chỉ TODO ở `analytics-aggregation.service.ts:27`) | ĐÁNH DẤU |
| `FunnelDailySnapshot` | 0 | 0 (chỉ TODO ở `analytics-aggregation.service.ts:28`) | ĐÁNH DẤU |
| `BetaFeedback` | 0 | `beta.service.ts:63` `create` (+ script seed audit) | ĐÁNH DẤU (chỉ ghi). Miniapp trang beta vẫn gửi góp ý, nên cần quyết định riêng, xem "Việc cần chủ dự án" |
| `AffiliateClick` | 0 | `affiliate.service.ts:183` `trackClick` | ĐÁNH DẤU (chỉ ghi) |
| `AffiliateClick.convertedOrderId` | 0 | 0 | ĐÁNH DẤU (A7-24 vẫn không ai set) |
| `RetentionDailySnapshot.dauEventBased` | chỉ khai báo kiểu ở `web/admin-client.ts:925` | luôn `null` (`analytics-aggregation.service.ts:168`) | ĐÁNH DẤU |
| `MembershipTier.badgeImageUrl` | 0 | 0 | ĐÁNH DẤU |
| `User.pancakeCustomerId` | 0 | 0 | ĐÁNH DẤU (còn unique index, giữ) |
| `User.zaloAccessToken`, `User.zaloRefreshToken` | 0 | không ghi giá trị; chỉ `account-deletion.service.ts:223-224` gán `null` | ĐÁNH DẤU |
| `Order.commission` | 0 (hoa hồng CTV nằm bảng `commissions`; `commission` ở `web/admin-client.ts:762` là của cashback) | 0, luôn 0 | ĐÁNH DẤU |
| `GameSpin` | `game.service.ts:131` `tx.gameSpin.count` (chặn quay quá lượt) | `game.service.ts:165`, `auth.service.ts:394` | KHÔNG đánh dấu: A2-018 ghi "đọc 0" nhưng HEAD đã đọc |
| `AffiliateLink.conversions/revenue` | `conversions` đọc ở `affiliate.service.ts:207,221` (`totalConversions`) | không bao giờ tăng (A7-24) | KHÔNG đánh dấu (còn hiển thị, luôn 0); A7-24 còn mở |
| `SystemConfigHistory` | có (audit) | có | KHÔNG (audit, chấp nhận được) |

- Chú thích sai của A2-018 cũng sửa luôn: `Order.endCustomerKey` ghi "hash SĐT" nhưng code lưu SĐT dạng nội địa rõ (`toLocalPhone`); chỉ sửa chú thích (không hash, không đổi dữ liệu).
- `prisma validate`: hợp lệ. `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` trên DB test đã migrate 123/123, trước VÀ sau khi sửa: `No difference detected.`
- `prisma format`: schema HEAD vốn chưa theo định dạng chuẩn (căn cột Order/User/Subscription lệch + vị trí chú thích `@@unique` của Commission), nên chạy `format` làm đổi ~60 dòng không liên quan. Đã KHÔNG giữ kết quả format (khôi phục bản chỉ có chú thích) để diff gói chỉ gồm chú thích; việc format cả file để riêng.
- Spec chốt `src/common/schema-deprecated.spec.ts` (10 test): danh sách `/// @deprecated` trong schema phải khớp bảng bằng chứng trong spec; model chỉ ghi chỉ được gọi `create`; cột có tên duy nhất không được dùng ngoài mẫu `dauEventBased: null`; không có SQL thô đụng các bảng chết. `zaloAccessToken`/`zaloRefreshToken` (trùng tên với tham số Zalo của chấm công) và `Order.commission` (tên quá chung) để `manual`, bằng chứng nằm ở bảng trên.
- ĐỎ: chạy bản sao spec trỏ vào schema HEAD (chưa có dấu): `danh sách đánh dấu trong schema khớp bảng bằng chứng` fail (`Expected` 11 mục, `Received []`), 9 ca còn lại xanh. XANH trên schema đã đánh dấu: `Tests: 10 passed`.

### Kiểm chứng lượt 2 (mục 2)
- `npx jest src/common src/modules/system-config src/modules/admin src/modules/dealer src/modules/users src/modules/game src/modules/merchant src/modules/affiliate src/modules/analytics --maxWorkers=1`: `Test Suites: 57 passed`, `Tests: 1095 passed`.
- Race spec Postgres thật (cổng 5582, `--runInBand`): system-config-unset-key (3), affiliate (1): xanh.
- `tsc --noEmit` (apps/api): exit 0; ESLint các file đã sửa: exit 0.

### Giả định
- Khoá chết chỉ bị chặn ghi/ẩn khỏi seed, KHÔNG xoá dòng trên DB: theo luật gói (không DELETE). PC-8 từng ghi "xoá vật lý dòng chết trên prod để PD-2"; PD-2 không làm vì cấm DELETE dữ liệu, xem "Việc cần chủ dự án".
- Đánh dấu `@deprecated` mang nghĩa "chưa ai đọc, chờ quyết định", không phải "sắp xoá". Không bảng/cột nào bị DROP.
- Khác biệt câu chữ log của `notifyAdmins` (mục 1c) coi là không đổi hành vi.

### Việc còn lại
- Gom các bản `startOfDay` (game, game-quiz, game-economy, game-reminder) về `startOfVnDay` (xem mục 1).
- Mục 3 (C-098, gỡ endpoint) và mục 4 (C-110/Q-30, đánh giá) do lượt khác làm.
- Format cả `schema.prisma` bằng `prisma format` trong một commit riêng.

### Việc cần chủ dự án
- Xoá vật lý 25 dòng khoá chết trong bảng `system_configs` trên PROD (24 khoá của PC-8 + `cashback.merchant_tubu_share`): dòng còn nguyên, chỉ hiện "Không dùng". Cần lệnh DELETE riêng, có sao lưu, do chủ dự án chạy hoặc cho phép.
- `BetaFeedback`: góp ý của khách beta đang ghi vào DB nhưng không ai xem được. Chọn: làm màn admin đọc, hoặc bỏ tính năng gửi góp ý ở trang beta.
- Bảng chết `CohortRepeatSnapshot`, `FunnelDailySnapshot` và các cột đã đánh dấu: có muốn DROP bằng migration riêng sau khi chắc không còn client cũ nào chạm (cột `dauEventBased` còn được khai báo kiểu ở web admin, `zaloAccessToken/zaloRefreshToken` còn được `account-deletion.service` gán null).
