# PD-2 — Dọn logic trùng, endpoint/khoá/bảng chết (API) + luật đánh giá Q-30

## Mục 1/4 — C-040 gom helper trùng về `apps/api/src/common/`

Phạm vi lượt này: mã đơn, chuẩn hoá SĐT, dayKey giờ VN. `maskName` x4 và `notifyAdminsOf` x3 do lượt khác của mục 1 xử lý (grep lệnh C-040 hiện vẫn còn `maskName` ở game, game-gift, game-season, `maskFullName` ở merchant và `notifyAdminsOf*` ở dealer, users).

| Nhóm | Trạng thái | Commit đặc tả (xanh trên bản cũ) | Commit gom |
| --- | --- | --- | --- |
| (a) Mã đơn x4 -> `common/order-code.ts` (`generateUniqueOrderCode(prisma, kind)`) | XONG | b5d02b25 | a9e4e58d |
| (d) Chuẩn hoá SĐT x4 -> `common/phone.ts` (3 hàm) | XONG | 14af8242 | fc17c6ed |
| (e) dayKey giờ VN x7 -> `vnDateKey` trong `common/vn-time.ts` | XONG | 60f85691 | 2b0f1920 |

### (a) Mã đơn — các bản chép tay và khác biệt
| Nơi (cũ) | Định dạng | Ghi chú |
| --- | --- | --- |
| `checkout.service` `generateCode` | `TUBU` + yyyymmdd theo UTC + `randomInt(0,100000)` đệm 5 số | fallback `TUBU<Date.now()>` |
| `affiliate.service` `generateOrderCode` (đơn lên hộ) | giống hệt checkout | bản sao chép tay của checkout |
| `dealer.service` `generateCode` | `DLR` + 8 số cuối `Date.now()` + `randomInt(0,1000)` đệm 3 số | không có ngày lịch; fallback `DLR<Date.now()>` |
| `subscriptions.service` `generateCode` | `TUBUSUB` + 7 số cuối `Date.now()` + `randomInt(0,1000)` đệm 3 số | không có ngày lịch; fallback `TUBUSUB<Date.now()>` |

**Hành vi khác nhau (không thống nhất ngầm):** (1) ngày trong mã TUBU tính theo UTC, không theo giờ VN: đơn đặt 00:00-07:00 giờ VN mang ngày hôm trước. Đây có thể là lỗi nhỏ nhưng mã đang chạy trên PROD, đã in trên đơn/hoá đơn/Pancake nên KHÔNG đổi sang giờ VN; helper giữ UTC và ghi rõ trong comment. (2) Ba loại mã khác tiền tố/độ dài/nguồn ngẫu nhiên nên helper nhận tham số `kind` (`RETAIL` | `DEALER` | `SUBSCRIPTION`) thay vì một công thức chung. Tính duy nhất giữ nguyên: kiểm `findUnique` tối đa 6 lần, hết lượt trả `<prefix><Date.now()>` (không kiểm lại); lớp chặn thật vẫn là unique `orders.code`.

`sellable-product.race-spec.ts` từng spy `DealerService.prototype.generateCode`; đã đổi sang spy `generateUniqueOrderCode` của module `common/order-code`.

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

### Việc còn lại (mục 1)
- `maskName` x4, `notifyAdminsOf` x3 (lượt khác).
- Gom `startOfDay` (game, game-quiz, game-economy, game-reminder) về `startOfVnDay`; `ctv-milestones`, `brand.service`, `vouchers.service`, `dealer.service` còn tự tính `VN_OFFSET` (không phải dayKey nên không thuộc nhóm (e)).
