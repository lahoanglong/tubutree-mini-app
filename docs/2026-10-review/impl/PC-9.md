# PC-9 — Nhân sự + câu chữ

Nhánh `hz6/PC-9` (tách từ `hardening/2026-10` @ `ee97986`). Báo cáo ghi theo từng mục; các mục sau (C-074, C-083, C-115, C-120, C-119) do lượt khác append bên dưới.

---

## C-056 — Chấm công: rớt vùng GPS một nhịp không còn tự chấm ra (XONG)

Commit `7a17cae`.

**Hành vi mới** (`apps/api/src/modules/staff/attendance/attendance.service.ts`, `heartbeat`):
- Heartbeat ngoài vùng (sai IP / ngoài bán kính / chưa cấu hình) chỉ tăng bộ đếm `outOfRangeCount` (UPDATE nguyên tử `increment`) và ghi `outOfRangeSince` ở nhịp đầu của chuỗi. Phiên vẫn mở, API trả `{ open: true, outOfRange: true, reason, missed, maxMissed }`.
- Đóng phiên (`closeReason = OUT_OF_RANGE`) khi: (a) `outOfRangeCount >= N` nhịp liên tiếp, hoặc (b) chuỗi ngoài vùng kéo dài `>= M` phút (trường hợp heartbeat thưa vì app bị cất vào túi).
- Heartbeat hợp lệ reset `outOfRangeCount = 0`, `outOfRangeSince = null`.
- Giờ ra ghi lùi về nhịp ngoài vùng ĐẦU TIÊN của chuỗi (`max(outOfRangeSince, checkinAt)`) — đúng mốc mà cách cũ (đóng ngay nhịp đầu) từng ghi, nên giờ ngoài vùng không được cộng vào công.
- Đóng bằng `updateMany({ where: { id, checkoutAt: null } })`: phiên đã bị checkout tay / QL đóng song song thì không bị ghi đè giờ ra và lý do đóng; `count = 0` trả `{ open: false }`.
- Giá trị cấu hình rác (0, âm, chuỗi) rơi về mặc định (0 nghĩa là "chấm ra ngay", đúng lỗi cần tránh).

**Cấu hình** (seed `createOnly`, admin chỉnh rồi deploy lại không reset):
- `attendance.out_of_range_max_count` = 3 (N). Miniapp gửi heartbeat 3 phút/nhịp nên 3 nhịp ≈ 6–9 phút ngoài vùng.
- `attendance.out_of_range_max_min` = 15 (M).

**Migration** `20261010180000_attendance_out_of_range_counter` (additive): `attendance_sessions` thêm `outOfRangeCount INTEGER NOT NULL DEFAULT 0`, `outOfRangeSince TIMESTAMP(3) NULL`. Phiên đang mở lúc deploy coi như đang trong vùng. Không cần backfill, không đụng unique. Đã áp thử bằng `prisma migrate deploy` trên Postgres riêng; `prisma migrate diff --from-url ... --to-schema-datamodel` báo "No difference detected".

**Test (đỏ → xanh)**
- Unit `attendance.service.spec.ts`: thay test cũ "heartbeat rớt vùng → đóng OUT_OF_RANGE" bằng 10 test mới (nhịp đầu không đóng, nhịp 2 không ghi đè mốc, đủ N đóng với giờ ra = nhịp đầu, N/M đọc từ config, cấu hình rác, checkin bị sửa lệch, đóng song song `count=0`, reset khi hợp lệ). Trước khi sửa: `Tests: 10 failed, 27 passed, 37 total`. Sau khi sửa: cả thư mục `staff/attendance` `Tests: 59 passed, 59 total`.
- Race `test/integration-race/attendance-out-of-range.race-spec.ts` (Postgres thật, cổng 5579): 7 test, gồm 10 heartbeat song song (N=100) → bộ đếm đúng 10 không mất nhịp; 8 heartbeat song song (N=3) → đóng đúng một lần, giờ ra không đổi ở lần gọi sau; nhịp hợp lệ cắt chuỗi thì đếm lại; chuỗi quá M phút; phiên đã đóng bởi QL không bị ghi đè. `Tests: 7 passed, 7 total`.

**Kiểm chứng đã chạy**
```
cd apps/api && npx jest --maxWorkers=1 src/modules/staff            -> các suite staff PASS
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5579/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand attendance-out-of-range   -> Tests: 7 passed, 7 total
cd apps/api && npx tsc --noEmit -p tsconfig.json                    -> exit 0
cd apps/api && npx eslint <file đã sửa>                              -> sạch
seed chạy thật trên DB riêng: attendance.out_of_range_max_count = 3 / max_min = 15; sửa tay max_count = 7 rồi seed lại -> vẫn 7 (createOnly)
```

**Giả định**
- Giờ ra ghi lùi về nhịp ngoài vùng đầu tiên (không phải nhịp thứ N): giữ nguyên ngữ nghĩa tiền công của cách cũ, không trả công cho thời gian đã rời vùng.
- `NOT_CONFIGURED` (admin xoá cấu hình giữa ca) cũng đếm như ngoài vùng và đóng sau N nhịp, như cách cũ đóng ngay.
- Cron `AttendanceJob` vẫn chỉ đóng khi quá giờ hết ca (không cắt theo heartbeat cũ) — không đổi.

**Còn lại / không làm**
- `apps/miniapp/src/pages/staff.tsx` (ngoài nhóm file của gói) chưa hiển thị cảnh báo "bạn đang ngoài vùng, sẽ tự checkout nếu không quay lại"; FE hiện chỉ xử lý `closed`, nên phản hồi mới `open: true, outOfRange: true` chạy bình thường nhưng im lặng. Nên làm ở gói FE nhân sự.
- `attendance.heartbeat_stale_min` vẫn là khoá chưa dùng (không thuộc mục này).

---

## C-073 — Cộng đồng nói về hàng đang bán, không phải cây cảnh (XONG)

Commit `a357651` (miniapp) và `547c985` (api/seed).

**Lời (miniapp)** — `apps/miniapp/src/i18n/vi.ts` khối `community`:
- `subtitle`: "Hỏi đáp cách dùng, chia sẻ trải nghiệm, cổ vũ nhau 🌿" (trước: "Hỏi đáp chăm cây, khoe vườn…").
- `kindShowcase`: "Trải nghiệm" (trước: "Khoe vườn").
- `titlePlaceholder`: "Tiêu đề câu hỏi (vd: Nước rửa chén sinh học dùng được cho bình sữa không?)" (trước: "Lá cây lưỡi hổ bị vàng?").
- `buyThis`: "Mua sản phẩm này" (trước: "Mua cây này"); `viewSolution`: "Xem sản phẩm gợi ý".
- `tagsPlaceholder`: "vd: da nhạy cảm, đồ cho bé …" (trước: "sen đá, tưới nước").
- `apps/miniapp/src/pages/profile.tsx` (một dòng, ngoài nhóm file nhưng chính bằng chứng của C-073 nêu): mô tả lối vào Cộng đồng "Hỏi cách dùng · chia sẻ trải nghiệm" (trước: "Hỏi chăm cây · khoe vườn"). Không nhánh hz6 nào khác đang sửa file này.

**Danh mục cộng đồng (seed)** — dữ liệu tách ra `apps/api/src/modules/feed/community-categories-seed.ts` để test được; `prisma/seed.ts` chỉ gọi:
- Mới: `my-pham-ca-nhan` (Mỹ phẩm & cá nhân), `tay-rua-nha-cua` (Tẩy rửa & nhà cửa), `me-va-be` (Mẹ & bé), `ca-phe-thuc-pham` (Cà phê & thực phẩm), `review-trai-nghiem` (Review & trải nghiệm); giữ `hoi-mua-gi`, `meo-hay` cùng slug.
- Bốn danh mục cây cảnh cũ (`cham-soc`, `sau-benh`, `phoi-canh`, `khoe-vuon`) chỉ bị ẩn `isActive = false`, KHÔNG xoá, không đổi tên, không gán lại bài: `feed_posts.categoryId` là `ON DELETE SET NULL` nên xoá sẽ làm bài mồ côi; bài đã đăng vẫn hiện ở "Tất cả" với nhãn cũ.
- Seed không ghi `isActive` cho danh mục đang dùng: admin tắt tay một danh mục thì deploy sau không bật lại.

**Test (đỏ → xanh)**
- `apps/miniapp/src/i18n/community-copy.spec.ts` (mới) + một test thêm vào `pages/profile.spec.ts`: trước khi sửa `Tests 3 failed | 5 passed (8)` (5 chuỗi vi phạm); sau khi sửa với `profile-hub.spec.tsx`: `Test Files 3 passed, Tests 10 passed`.
- `apps/api/src/modules/feed/community-categories-seed.spec.ts` (mới, 6 test): trước khi có module → suite lỗi "Cannot find module"; sau: `Tests: 6 passed`. Cùng `src/modules/feed` + `src/modules/staff`: `Test Suites: 16 passed, Tests: 394 passed`.
- Seed chạy thật trên Postgres riêng (`tubu_it_pc9`) sau khi giả lập dữ liệu cũ (6 danh mục cũ + 1 bài ở `cham-soc`): kết quả 7 danh mục active, 4 danh mục cũ `isActive=f`, bài cũ vẫn `categoryId = legacy1 / cham-soc`; seed lần 2 idempotent, danh mục `meo-hay` admin tắt tay vẫn tắt. Dữ liệu giả lập đã dọn.

**Kiểm chứng đã chạy**
```
cd apps/miniapp && npx vitest run src/i18n/community-copy.spec.ts src/pages/profile.spec.ts src/pages/profile-hub.spec.tsx  -> 3 files, 10 tests passed
cd apps/miniapp && npx tsc --noEmit                                  -> exit 0
cd apps/miniapp && npx eslint src/i18n/vi.ts src/i18n/community-copy.spec.ts src/pages/profile.spec.ts  -> sạch
cd apps/miniapp && npx eslint src/pages/profile.tsx  -> 3 lỗi tubu-ds/no-raw-color ở dòng 210/226/249, CÓ SẴN từ trước, không thuộc dòng đã sửa (dòng 32)
cd apps/api && npx tsc --noEmit -p tsconfig.json                     -> exit 0
```

**Giả định**
- Tên bậc uy tín (Mầm / Cây non / Cây trưởng thành / Cổ thụ), loại bài tự động "Thu hoạch / Sưu tập loài / Mốc cộng đồng" và tên "Cộng đồng Vườn Tubu" được giữ: là ẩn dụ thương hiệu Tubu Tree và tính năng game Vườn Xanh, không phải lời hỏi đáp về cây cảnh bán trong shop.
- Chọn ẩn danh mục cũ thay vì đổi tên tại chỗ: đổi tên giữ slug sẽ gán nhầm bài cũ về cây cảnh sang chủ đề mỹ phẩm.

**Còn lại / ghi chú cho gói khác**
- "Chăm cây ảo / Mua cây thật" ở `game.tsx`, `loyalty.tsx:370`, `refill.tsx:204`, `wallet.tsx:196` là khái niệm game Vườn Xanh (trồng cây thật góp rừng), không đụng ở mục này. Gom vào C-074 / quyết định game nếu muốn đổi.
- `community.eventRewardLabel` = "Thưởng TubuXu" (màn admin kiểm duyệt, gắn logic xu): để Đợt D gộp TubuXu theo đúng phạm vi C-074.
- Comment trong `components/community/post-composer.tsx:56` và `schema.prisma` (comment "6 danh mục cố định") còn nhắc tên cũ, không ảnh hưởng chạy.
- Khi deploy: chạy `prisma migrate deploy` (1 migration, additive) rồi seed để có khoá chấm công mới + danh mục mới. Cả hai idempotent.
