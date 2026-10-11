# PD-2 — Dọn logic trùng, endpoint/khoá/bảng chết (API) + luật đánh giá Q-30

## Tổng hợp gói (4 mục)

| Mục | Finding | Trạng thái | Chi tiết |
| --- | --- | --- | --- |
| 1 | C-040 gom helper trùng về `apps/api/src/common/` | XONG (5 nhóm, mỗi nhóm có test đặc tả xanh trên bản cũ trước khi gom; hành vi khác nhau giữ qua tham số hoặc hàm riêng) | Mục 1/4 |
| 2 | C-108 bảng/cột chết, C-054 khoá config chết, C-099/Q-31 | XONG (9 bảng/cột đánh dấu `/// @deprecated`, 1 khoá chết nữa, không DROP, không migration) | Mục 2/4 |
| 3 | C-098 gỡ endpoint không FE nào gọi | MỘT PHẦN theo luật "thiếu bằng chứng thì giữ": gỡ 5, giữ 21 kèm lý do | Mục 3/4 |
| 4 | C-110 / Q-30 đánh giá | XONG (API + race spec Postgres thật + miniapp) | Mục 4/4 |

Không có migration nào trong cả gói (`prisma migrate diff` trên schema trước/sau mục 2: `No difference detected.`; mục 4 giữ nguyên `@@unique([userId, productId])`).

Các bảng theo yêu cầu nằm trong từng mục: bảng khác biệt hành vi của helper ở Mục 1 (a)-(e), bảng `/// @deprecated` ở Mục 2 (C-108), BẢNG BẰNG CHỨNG endpoint giữ/gỡ ở Mục 3, giả định ở cuối mỗi mục, danh sách "Việc cần chủ dự án" gộp ở cuối tài liệu.

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
- Mục 3 (C-098, gỡ endpoint) xem mục 3/4, mục 4 (C-110/Q-30, đánh giá) xem mục 4/4.
- Format cả `schema.prisma` bằng `prisma format` trong một commit riêng.

### Việc cần chủ dự án
- Xoá vật lý 25 dòng khoá chết trong bảng `system_configs` trên PROD (24 khoá của PC-8 + `cashback.merchant_tubu_share`): dòng còn nguyên, chỉ hiện "Không dùng". Cần lệnh DELETE riêng, có sao lưu, do chủ dự án chạy hoặc cho phép.
- `BetaFeedback`: góp ý của khách beta đang ghi vào DB nhưng không ai xem được. Chọn: làm màn admin đọc, hoặc bỏ tính năng gửi góp ý ở trang beta.
- Bảng chết `CohortRepeatSnapshot`, `FunnelDailySnapshot` và các cột đã đánh dấu: có muốn DROP bằng migration riêng sau khi chắc không còn client cũ nào chạm (cột `dauEventBased` còn được khai báo kiểu ở web admin, `zaloAccessToken/zaloRefreshToken` còn được `account-deletion.service` gán null).

## Mục 3/4 — C-098 gỡ endpoint không FE nào gọi

Trạng thái: MỘT PHẦN, theo đúng luật "thiếu bằng chứng hoặc nghi ngờ thì giữ". Gỡ 5 endpoint (4 module), giữ 21 endpoint không có lời gọi FE kèm lý do. Danh sách gốc A1-042 (19 endpoint, dựng ở commit 080bc75) đã cũ: 3 endpoint từ đó đã có FE ở HEAD, và quét lại tìm thêm 2 endpoint mới không ai gọi.

### Cách dựng lại danh sách
- Quét AST (TypeScript compiler API) mọi `@Controller` trong `apps/api/src`: 362 route (path không kèm tiền tố `/api` của `setGlobalPrefix`). Quét AST mọi chuỗi/mẫu chuỗi bắt đầu bằng `/` trong `apps/web/src` và `apps/miniapp/src` (bỏ spec), suy ra phương thức từ `api.get|post|...` và `apiFetch(..., { method })`, bỏ phần `?query` nối bằng biến. Khớp route với lời gọi theo phương thức và từng đoạn path.
- Chạy trên 5 nguồn FE và lấy HỢP: HEAD của worktree, commit PROD `cb92dc8`, đầu nhánh `hardening/2026-10` (đã có PC-12), `hz8/PD-1`, `hz9/PD-3` (để không gỡ nhầm endpoint mà FE đang được nối ở gói khác). Kết quả: 26 route không có lời gọi ở bất kỳ nguồn nào.
- Hai lỗi của lần quét đầu đã sửa: (1) mẫu `...${qs ? ... : ''}` làm lọt 2 endpoint có FE (`GET /admin/loyalty/pos-credits` ở `admin-client.ts:914`, `GET /admin/cashback/transactions` ở `admin-client.ts:771`); (2) lời gọi có biến nền `${BASE}/x` khớp nhầm mọi route có đoạn cuối là tham số, nên với mẫu này chỉ coi là khớp khi đoạn tĩnh trùng đúng.
- Cùng đợt: `GET /admin/customer-refunds` và `POST /admin/customer-refunds/:id/mark-paid` KHÔNG có FE ở HEAD của worktree (base 0fe7c050) nhưng CÓ ở đầu `hardening/2026-10` (`customer-refunds-tab.tsx`, `admin-client.ts:893`, gói PC-12) nên không phải ứng viên.

### BẢNG BẰNG CHỨNG
Cột "grep HEAD" và "grep cb92dc8" là `git grep` trong `apps/web/src apps/miniapp/src` (bỏ spec). Cột "ngoài" gộp (2) callback/webhook/cron của bên ngoài và (3) e2e/loadtest/script/ops/.github/packages (`git grep` ở HEAD).

| Endpoint | grep HEAD | grep cb92dc8 | Ngoài (callback/cron/script/e2e) | Quyết định |
| --- | --- | --- | --- | --- |
| POST /me/redeem-points | 0 | 0 | JWT khách, không phải callback; 0 ở e2e/scripts/ops. Chỉ còn trong `design_handoff` và snapshot `docs/2026-09-08-feature-map.md` | GỠ (1bffb2a5). Chỉ tính số tiền xem trước; đổi điểm thật là `/me/loyalty/rewards/:id/redeem` và `pointsToUse` ở checkout, khoá `loyalty.vnd_per_point_redeem` vẫn do `pricing.service` đọc |
| GET /feed/events/:id | 0 (miniapp chỉ gọi `/events`, `/events/:id/posts`, `close`, `winner`) | 0 (FE bỏ `getEvent` từ 69c7fb8a, 2026-07-04) | JWT khách; 0 | GỠ (7063c14e), kèm `getEvent` của service và spec của nó |
| GET /brand/owner/me/promotions | 0 (chỉ POST/PATCH/DELETE, `brand-owner-api.ts:32-36`) | 0 | JWT chủ nhãn; 0 | GỠ (d00fe547). Màn chủ nhãn đọc `promotions` từ `GET /brand/owner/me` (`getOwnedBrand` có `include: promotions`); `listPromotions` giữ vì admin còn dùng |
| POST /orders/:code/issue-invoice | 0 (chỉ route admin `/admin/orders/:id/issue-invoice`, `admin-client.ts:304`) | 0 | JWT khách; 0 | GỠ (f5af33af). Checkout đã đặt `invoiceStatus = REQUESTED` (`checkout.service.ts:266`), admin ghi nhận đã xuất qua route admin có UI |
| POST /orders/:code/track | 0 | 0 | JWT khách; 0 | GỠ (f5af33af). Chỉ trả lại trường đã có trong `GET /orders/:code` (`detailView` trả cả đơn), không gọi Pancake |
| GET /auth/me | 0 | 0 | `scripts/loadtest/scenarios.cjs:69`, `page-weight.cjs:40` | GIỮ: loadtest gọi |
| GET /health | 0 | 0 | healthcheck hạ tầng | GIỮ |
| POST /webhooks/pancake, /webhooks/gomdon, /webhooks/gomdon/:token, /webhooks/zalo-oa, /webhooks/zalopay, /webhooks/cashback/:provider, /webhooks/accesstrade | 0 | 0 | callback của Pancake, Gomdon, Zalo OA, ZaloPay, AccessTrade (`@Public`, ký) | GIỮ (điều kiện 2) |
| GET /storefront/by-host | 0 | 0 | 0 trong repo, nhưng audit A5-53 đề xuất middleware web tra tên miền riêng bằng route này | GIỮ: nghi ngờ, tính năng tên miền riêng chưa kiểm chứng |
| POST /payments/zalopay/create | 0 | 0 | ZaloPay đang ẩn; `docs/ZALOPAY-SETUP.md` còn bước go-live dùng route này | GIỮ: đường tiền, có runbook |
| GET /admin/attendance/live | 0 | 0 | A1-030 ghi "chỉ làm được bằng gọi API tay"; đề xuất của A1-030 là thêm nút, không phải gỡ | GIỮ: công cụ vận hành |
| POST /admin/attendance/manual-checkout | 0 | 0 | như trên | GIỮ |
| POST /admin/payroll/:staffId/recompute | 0 | 0 | như trên; chú thích code mô tả dùng khi đơn giá nhập sai | GIỮ |
| POST /admin/pancake/sync | 0 | 0 | như trên; chú thích code ghi đây là đường sửa tồn kho DUY NHẤT trong app | GIỮ |
| POST /admin/products/recompute-sold | 0 | 0 | như trên (cron 03:00 vẫn chạy, đây là nút chạy ngay) | GIỮ |
| GET /admin/dealer-prices/history | 0 | 0 | như trên; sổ lịch sử giá vẫn được ghi, đây là đường đọc duy nhất | GIỮ |
| POST /admin/brands/:id/products | 0 (có GET, DELETE cùng path) | 0 | admin gọi tay được; không có bằng chứng ngược | GIỮ: điều kiện 4, chờ nối UI |
| PATCH /admin/promotions/:id | 0 (chỉ DELETE) | 0 | như trên | GIỮ |
| PATCH /admin/dealer-rewards/:id | 0 (chỉ DELETE) | 0 | như trên; ngưỡng BigInt đã có race spec `dealer-bigint-volume` | GIỮ |
| DELETE /reviews/:id | 0 | 0 | 0 | GIỮ: chủ đánh giá và admin còn dùng được; Q-30 đã chốt ở mục 4/4 (xoá hoàn điểm đã thưởng nên xoá rồi viết lại vẫn đúng một lần thưởng, có race spec), nhưng FE chưa có nút xoá nên vẫn chờ quyết định có nối UI hay không |
| GET /admin/orders/:id/status-history | 1 (`admin-client.ts:323`) | 0 | 0 | GIỮ: đã có FE sau PROD (C-092) |
| GET /faqs | 1 (`about-data.ts:50`) | 0 | 0 | GIỮ: đã có FE sau PROD |
| POST /reviews/:id/visibility | 1 (`admin-client.ts:1000`) | 0 | 0 | GIỮ: đã có FE sau PROD |
| GET /admin/customer-refunds, POST /admin/customer-refunds/:id/mark-paid | 0 | 0 | FE có ở `hardening/2026-10` (PC-12) | GIỮ: FE đang được merge |

`/admin/faqs`, `/admin/loyalty/pos-credits`, `/admin/cashback/transactions`, `/storefront/public-list` có FE (đường dẫn nối query hoặc biến nền `${BASE}`), không phải ứng viên.

### Test chốt
`apps/api/src/common/endpoint-inventory.spec.ts`: dựng bảng route từ metadata Nest của 14 controller (`PATH_METADATA`, `METHOD_METADATA`), có hai bảng. `REMOVED` (5 route phải không còn) và `KEPT_WITHOUT_FE` (14 route cố ý giữ, mỗi dòng ghi lý do). ĐỎ trước khi gỡ từng nhóm (mỗi lần thêm một nhóm vào `REMOVED` thì spec fail đúng route đó, vd `Tests: 1 failed, 16 passed` cho feed; `2 failed, 18 passed` cho orders), XANH sau khi gỡ. Mỗi module một commit gồm spec + code:
- 1bffb2a5 loyalty (kèm tạo spec và bỏ `SystemConfigService` thừa ở constructor)
- 7063c14e feed (controller + `getEvent` + 2 test của `getEvent`)
- d00fe547 brand (controller + `listOwnedPromotions`)
- f5af33af orders (2 handler + `issueInvoice` + `track` của service); sau đó 1 commit chú thích

### Kiểm chứng
- `npx jest src/common src/modules/loyalty src/modules/feed src/modules/brand src/modules/orders src/modules/admin --maxWorkers=1`: `Test Suites: 47 passed`, `Tests: 1104 passed`.
- `tsc --noEmit` (apps/api): exit 0; ESLint các file đã sửa: exit 0.
- Race spec Postgres thật (cổng 5582, `--runInBand`, từng file): loyalty (5), brand-owner-sales (4), dealer-bigint-volume (3), feed-like-count (4), admin-invoice (4), order-cancel (2), cod-return-refund (3): xanh.
- Còn lại trong `apps/api/src` (không spec) khớp `redeem-points|issue-invoice|:code/track|feed/events/:id|owner/me/promotions`: chỉ route admin `orders/:id/issue-invoice` và POST/PATCH/DELETE của `owner/me/promotions` (còn FE gọi).

### Giả định
- Endpoint admin không có UI được coi là "có thể gọi tay bằng token admin" (A1-030 viết đúng như vậy), nên giữ cho tới khi chủ dự án xác nhận. Gỡ sau là một dòng chuyển từ `KEPT_WITHOUT_FE` sang `REMOVED` kèm code, không cần thiết kế lại.
- Không có DB, migration hay cấu hình nào đổi. Không có khoá config nào thành khoá chết do gỡ (`loyalty.vnd_per_point_redeem` còn do `pricing.service` đọc).
- Không sửa `docs/2026-09-08-feature-map.md` (ảnh chụp theo ngày 2026-09-08, vẫn liệt kê các route này) và `design_handoff/specs` (spec gốc).
- Chưa có bằng chứng về bản miniapp cũ hơn `cb92dc8` còn chạy trên Zalo. Bốn endpoint của khách (redeem-points, feed events/:id, issue-invoice, track) chưa từng có lời gọi FE trong lịch sử hoặc đã bỏ từ 2026-07-04 (`git log -S`), nên rủi ro client cũ gọi là rất thấp.

### Việc còn lại / Việc cần chủ dự án
- Với 3 endpoint admin giữ vì "nghi ngờ" (`POST /admin/brands/:id/products`, `PATCH /admin/promotions/:id`, `PATCH /admin/dealer-rewards/:id`) và 6 công cụ vận hành của A1-030: chọn nối nút vào web admin (C-091) hoặc xác nhận bỏ để gỡ tiếp.
- `DELETE /reviews/:id`: luật Q-30 đã xử lý ở mục 4/4 (không cần tính theo sổ điểm vì lần xoá đã hoàn điểm, xem đó). Còn lại: có thêm nút "Xoá đánh giá" vào miniapp hay gỡ endpoint.
- `GET /storefront/by-host` và `POST /payments/zalopay/create`: giữ cho tới khi quyết định tên miền riêng và ZaloPay.

## Mục 4/4 — C-110 / Q-30 đánh giá: một đánh giá mỗi sản phẩm, mua lại thì sửa, thưởng lần đầu

Trạng thái: XONG. Quyết định áp dụng là phương án khuyến nghị của Q-30 (phương án 1): giữ một đánh giá cho mỗi (người, sản phẩm), cho sửa khi mua lại, thưởng Điểm Xanh chỉ lần đầu. Phần "hiển thị đã mua N lần" của Q-30 không nằm trong đặc tả gói nên chưa làm (xem "Việc còn lại").

| Việc | Commit |
| --- | --- |
| API: tạo khi đã có đánh giá thì SỬA, không thưởng; `can-review` trả `myReview`; spec đơn vị | 0a7d577a |
| Race spec Postgres thật `test/integration-race/review-edit.race-spec.ts` | 3d652a14, 72b5957f |
| Miniapp `reviews-section.tsx`: "Sửa đánh giá của bạn", form điền sẵn; spec | 251f77ba |

### Hành vi sau khi sửa (`apps/api/src/modules/reviews/reviews.service.ts`)
- `POST /products/:slug/reviews` (`create`): giữ nguyên luật điều kiện (sản phẩm tồn tại, phải có đơn `DELIVERED` chứa sản phẩm). Rồi vòng tối đa 3 lần: đọc đánh giá của CHÍNH người gọi cho sản phẩm; chưa có thì `createFirst` (tạo đánh giá + ghi `pointsTransaction` + cộng `pointsBalance` + tính lại sao + analytics `review_created`, tất cả trong một transaction như cũ); đã có thì `updateOwn` (thay sao, nội dung, ảnh, video, tính lại sao trung bình, analytics `review_updated` với `pointsEarned: 0`).
- Sửa KHÔNG đụng `pointsEarned` (nên xoá sau đó hoàn đúng số điểm đã thưởng), `orderId`, `isVisible` (sửa không gỡ được lệnh ẩn của admin), `createdAt`. Thay thế toàn bộ như lúc tạo: bỏ trống nội dung/ảnh/video thì các trường đó bị xoá (form miniapp điền sẵn nên người dùng không mất dữ liệu ngoài ý muốn).
- Quyền: chỉ chủ đánh giá sửa được, vì khoá đọc và khoá ghi đều là `(userId của người gọi, productId)`; người khác tạo cho cùng sản phẩm ra đánh giá riêng của họ. Không có endpoint sửa theo `id` nên không có đường sửa đánh giá người khác. Đã có đánh giá nhưng không còn đơn `DELIVERED` (vd đơn chuyển `RETURNED`) thì không sửa được, như luật điều kiện hiện hành.
- Race: hai request tạo đồng thời cùng người + sản phẩm cùng thấy "chưa có" và cùng vào `createFirst`. Unique `(userId, productId)` cho một bên thắng; bên thua nhận `P2002` ở bước `review.create`, TRƯỚC bước ghi điểm và trong cùng transaction nên không ghi gì; sau đó đọc lại và chuyển sang `updateOwn`. Chiều ngược lại (đánh giá bị xoá đúng lúc đang sửa, `P2025`) đọc lại và tạo mới như lần đầu (hợp lệ vì lần xoá đã hoàn điểm). Quá 3 lần thua liên tiếp thì `ConflictException`. Trước đây bên thua nhận lỗi 400 "Bạn đã đánh giá sản phẩm này rồi".
- Phản hồi `POST` trả đánh giá kèm `updated: boolean` để FE chọn câu báo đúng.
- `GET /products/:slug/reviews/can-review`: đã có đánh giá thì `canReview: true`, `reason: null`, kèm `myReview { id, rating, comment, images, videoUrl }`; chưa mua vẫn `NOT_PURCHASED`. Lý do `ALREADY_REVIEWED` không còn được trả. Tương thích bản miniapp cũ: bản cũ chỉ ẩn nút khi `canReview === false`, nên bản cũ giờ thấy nút "Viết đánh giá" với form trống; gửi lên thì sửa đánh giá cũ (thay toàn bộ, ảnh/nhận xét cũ bị thay bằng nội dung form). Chấp nhận được vì người dùng chủ động bấm gửi.
- Xoá đánh giá (`DELETE /reviews/:id`) giữ nguyên: hoàn đúng `pointsEarned` rồi xoá, mở lại unique. Xoá rồi viết lại: sổ điểm `[+10, -10, +10]`, số dư 10, tức đúng một lần thưởng, không farm được.

### Miniapp (`apps/miniapp/src/components/reviews-section.tsx`, `services/shop-api.ts`)
- Có `myReview` thì nút là "Sửa đánh giá của bạn", tiêu đề sheet "Sửa đánh giá", nút lưu "Lưu đánh giá", lời nhắn "Điểm Xanh chỉ được cộng ở lần đánh giá đầu tiên, sửa đánh giá không cộng thêm." (không hứa +5/+10/+15 khi sửa). Chưa có thì giữ nguyên chữ cũ.
- Form điền sẵn sao, nhận xét, ảnh, video từ `myReview`. Nháp người dùng đã gõ vẫn được giữ khi đóng/mở sheet (như P1-2); lưu xong thì xoá nháp, lần mở sau điền theo đánh giá mới nhất từ BE. Sau mỗi lần gửi thành công làm mới cả `['reviews', slug]` và `['can-review', slug]`, nên viết xong lần đầu thì nút đổi ngay thành "Sửa đánh giá của bạn" (trước đây không làm mới nên vẫn hiện nút "Viết đánh giá").
- Câu báo thành công theo `updated` của BE chứ không theo chế độ form: `true` thì "Đã cập nhật đánh giá của bạn", `false` thì giữ "Cảm ơn đánh giá của bạn! Đã cộng Điểm Xanh". Nhờ vậy đúng cả khi đánh giá được tạo từ thiết bị khác.
- Giữ DS v2 của PC-10c3: chỉ dùng `Button`, `BottomSheet`, `Text` có sẵn; `ds-c076-pc10c3.spec.ts` (111 ca) vẫn xanh. Thuật ngữ theo Q-26 (Điểm Xanh), không thêm luồng xu.

### Test thêm (đỏ -> xanh)
- `reviews.service.spec.ts` (API): thay 2 ca cũ coi "đã có thì lỗi" (`đã đánh giá ... BadRequest`, `race P2002 ... BadRequest`) bằng ca mới; thêm 10 ca: sửa đúng dữ liệu và khoá `userId_productId`; không ghi `pointsTransaction`/`user.update`/`pointsEarned`; không có `isVisible` trong dữ liệu sửa; bỏ trống thì xoá trường; analytics `review_updated` cùng tx; mất đơn `DELIVERED` thì không sửa; chủ đánh giá theo `userId`; `P2025` rồi tạo mới; thua 3 lần thì `ConflictException`; `P2002` rồi sửa không thưởng lần hai; `can-review` đã có đánh giá trả `myReview`, mất đơn thì `NOT_PURCHASED`. ĐỎ: `Tests: 12 failed, 18 passed, 30 total` trước khi sửa service. XANH: `Tests: 30 passed, 30 total`.
- `review-edit.race-spec.ts` (Postgres thật, 8 ca): (1) 2 request tạo đồng thời (rào chắn `barrierOnFirstCalls` ép cả hai cùng thấy "chưa có") => không lỗi, đúng 1 dòng `reviews`, đúng 1 `pointsTransaction` `REVIEW`, số dư bằng `pointsEarned`, `[updated=false, updated=true]`; (2) 8 request đồng thời => 1 đánh giá, 1 lần thưởng (+5), 7 request thành sửa; (3) mua lại: sửa sao/nội dung/ảnh/video, `pointsEarned`/`orderId` giữ nguyên, 1 giao dịch điểm, số dư 5, `Product` `{ratingAvg: 2, reviewCount: 1}`, xoá sau đó về 0; (4) sửa không bỏ ẩn đánh giá bị ẩn, `Product` `{0, 0}`; (5) người khác tạo ra đánh giá riêng, không đụng đánh giá của chủ; (6) không có đơn `DELIVERED` thì không tạo, đơn chuyển `RETURNED` thì không sửa; (7) `can-review`; (8) xoá rồi viết lại ra sổ điểm `[10, -10, 10]`. ĐỎ trên `reviews.service.ts` cũ (`git show HEAD~1`, đã khôi phục sau đó): `Tests: 6 failed, 1 passed, 7 total` (lúc đó chưa có ca 8). XANH: `Tests: 8 passed, 8 total`; bản 7 ca (trước khi thêm ca 8) chạy lặp 3 lần đều xanh.
- `reviews-section.spec.tsx` (miniapp): sửa 1 ca cũ (`ALREADY_REVIEWED` không còn tồn tại, đổi sang `NOT_PURCHASED`) và thêm 7 ca (nút "Sửa đánh giá của bạn"; form điền sẵn + lời nhắn không cộng điểm; lưu gọi `createReview` đúng payload và báo "đã cập nhật"; đóng/mở giữ phần đang sửa; lần mở sau lưu lấy bản mới từ BE; tạo xong nút đổi thành "Sửa"; BE trả `updated=true` ở form viết mới). ĐỎ: `Tests  7 failed | 12 passed (19)`. XANH: `19 passed`.

### Kiểm chứng
- `npx jest src/modules/reviews src/modules/admin src/modules/game --maxWorkers=1`: `Test Suites: 18 passed`, `Tests: 407 passed`. `npx jest src/common/endpoint-inventory.spec.ts`: 20 passed.
- Race spec Postgres thật (cổng 5582, `--runInBand`, từng file): review-edit (8), second-order-review-invite (5), admin-lookups (5), auth-merge-guest (10): xanh.
- Miniapp: `npx vitest run src/components/reviews-section.spec.tsx src/ds-c076-pc10c3.spec.ts`: `130 passed`.
- `tsc --noEmit` apps/api và apps/miniapp: exit 0; ESLint các file đã sửa: exit 0.
- KHÔNG chạy Playwright/e2e: `apps/e2e` chỉ mock `can-review` với `NOT_PURCHASED` (còn hợp lệ) và `allowUnmocked` cho route này, không có ca nào dựa vào `ALREADY_REVIEWED`.

### Migration
Không có. `@@unique([userId, productId])` giữ nguyên (đúng nội dung Q-30), không đổi schema.

### Giả định
- Gọi tạo khi đã có đánh giá thay THẾ toàn bộ sao/nội dung/ảnh/video (cùng ngữ nghĩa với lúc tạo) thay vì chỉ cập nhật trường có gửi, vì form miniapp điền sẵn và gửi đủ.
- Điều kiện sửa dùng đúng luật tạo (có đơn `DELIVERED` chứa sản phẩm), nên mua lại không cần đơn mới được giao, chỉ cần còn một đơn `DELIVERED`. `orderId` của đánh giá giữ đơn đầu tiên, không chuyển sang đơn mua lại (không đổi dữ liệu có sẵn).
- Sửa không đổi `createdAt` nên đánh giá đã sửa giữ vị trí cũ trong danh sách; không có cột `updatedAt` và không thêm cột (không migration).
- Đánh giá bị admin ẩn vẫn sửa được nhưng vẫn ẩn.

### Việc còn lại
- Hiển thị "đã mua N lần" (Q-30 phương án 1) và nhãn "đã chỉnh sửa": cần đếm đơn `DELIVERED` hoặc thêm cột `updatedAt` nên để lượt riêng.
- Số dư điểm có thể âm khi xoá đánh giá đã thưởng mà người dùng đã tiêu hết điểm (hành vi cũ của `remove`, `increment: -pointsEarned` không kẹp 0). Ngoài phạm vi Q-30, ghi để quyết cùng PD-3 (gộp TubuXu vào Điểm Xanh).

## Việc cần chủ dự án (gộp cả gói)
- Mục 2: xoá vật lý 25 dòng khoá chết trong `system_configs` trên PROD (cần lệnh DELETE riêng có sao lưu); quyết `BetaFeedback` (làm màn admin đọc hay bỏ gửi góp ý); có DROP các bảng chết bằng migration riêng hay không.
- Mục 3: nối UI hay gỡ tiếp 3 endpoint admin nghi ngờ và 6 công cụ vận hành; quyết tên miền riêng (`/storefront/by-host`) và ZaloPay (`/payments/zalopay/create`); có thêm nút "Xoá đánh giá" hay gỡ `DELETE /reviews/:id`.
- Mục 4: chỉ cần xác nhận Q-30 phương án 1 như khuyến nghị (đã áp dụng); có làm "đã mua N lần" hay không.
