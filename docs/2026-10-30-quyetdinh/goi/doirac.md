# Gói qd doirac: quà quá hạn tự huỷ, quầy xem quà đã xử lý, phiên bản thể lệ, mục quầy cho nhân viên điểm

Gốc: main d915f19b5. Đọc kỹ luật chung `tools/brief-worker.md`. Gói đụng điểm nên phải có race spec, và được thêm migration.

Cờ đổi rác đang TẮT trên PROD. Không đổi cờ. Mã mới phải tôn trọng cờ giống các cron và endpoint đổi rác đang có.

## E-126: quà hiện vật quá hạn nhận thì tự huỷ, hoàn điểm, báo khách

Chủ chốt: "quà hiện vật đổi rác quá hạn nhận thì tự huỷ, hoàn điểm, báo khách một tin."

Hiện trạng:
- `WasteGiftRedemption` có `claimExpiresAt`.
- `waste-exchange/catalog/waste-gift-redemptions.service.ts` (khoảng :144) tính cờ `overdue`, nhưng quà vẫn ở READY mãi và quầy vẫn trao được (`markFulfilled`, khoảng :150-162).
- Bộ lọc hàng chờ quá hạn: `core/waste-queue-filters.ts:44` (`wasteGiftOverdueWhere`).

Luật mới:
1. Quà READY có `claimExpiresAt < now` thì không trao được nữa. `markFulfilled` (và mọi đường trao khác) từ chối với lời rõ ràng, ví dụ "Quà đã quá hạn nhận, hệ thống sẽ huỷ và hoàn điểm cho khách". Thêm điều kiện hạn vào `where` của updateMany để quầy và cron không cùng thắng.
2. Một cron (theo mẫu `pickup/waste-expiry.cron.ts`: `TrackCron`, bỏ qua khi cờ tắt, chạy mỗi giờ) tìm quà READY quá hạn rồi xử lý từng quà trong một transaction:
   - Đổi sang CANCELLED, có guard `status: 'READY'`.
   - Hoàn đúng `pointsCost` qua chính đường hoàn điểm mà luồng huỷ quà hiện có đang dùng (tìm nơi đặt CANCELLED cho quà). Không viết sổ điểm mới. Lô điểm và hạn điểm hoàn theo luật của đường đó.
   - Ghi `writeWasteEvent` với kind sẵn có hoặc kind mới (ví dụ GIFT_EXPIRED), meta có before/after.
3. Báo khách một tin trong app:
   - Mã tin mới theo `waste-notify.codes.ts`, ví dụ `WASTE_GIFT_EXPIRED`. Mẫu tin chèn bằng migration.
   - Câu đề xuất: "Quà {{gift_name}} đã quá hạn nhận nên Tubu Tree đã huỷ và hoàn {{points}} điểm vào tài khoản của bạn."
   - Gửi đúng một lần cho mỗi quà, kể cả khi cron chạy lại hoặc hai tiến trình chạy cùng lúc.
   - Route bấm tin dẫn tới trang quà đổi rác của khách. Thêm vào `packages/app-core/src/notification-route.ts` nếu cần.
4. Màn khách (Mini + web) hiện quà đã huỷ do quá hạn với nhãn rõ, ví dụ "Đã huỷ: quá hạn nhận". Quầy và admin cũng thấy lý do này.

Test bắt buộc:
- Unit cho guard trao quà.
- Race spec mới cho các ca:
  - cron huỷ và hoàn đúng số điểm;
  - cron chạy hai lần: hoàn một lần, gửi một tin;
  - quầy trao đúng lúc cron chạy: chỉ một bên thắng, không vừa trao vừa hoàn;
  - quà chưa tới hạn không bị đụng.
- Chạy lại race spec cũ của đổi rác (grep `waste` trong `apps/api/test/integration-race/`).

## E-38(a): quầy tra mã hiện cả quà đã trao/đã huỷ, chỉ đọc

Chủ chốt: "quầy đổi rác hiện cả quà đã trao/đã huỷ (chỉ đọc) khi tra mã."

Hiện trạng: `waste-exchange/receiving/waste-desk.service.ts` (khoảng :50-58, :134-142). Tra mã quà đã FULFILLED hay CANCELLED thì quầy báo "không tìm thấy", nên nhân viên không giải thích được cho khách.

Luật mới:
- Tra đúng mã thì trả cả quà FULFILLED và CANCELLED, kèm trạng thái, thời điểm, điểm trao (nếu có) và lý do huỷ (gồm quá hạn của E-126).
- Ẩn mọi nút thao tác. Không lộ thêm thông tin khách ngoài những gì quà READY đang hiện.
- Hai nền quầy: Mini `apps/miniapp/src/pages/recycle-desk.tsx` và web `apps/web/src/components/recycle/recycle-desk.tsx`. Hai bên hiện giống nhau.
- Phần (b) (đồng nghiệp cùng điểm xem yêu cầu vừa duyệt) đã làm ở đợt trước. Giữ nguyên.

Test: unit API cho tra mã từng trạng thái, kiểm tra quyền như hiện có, vitest hai nền cho thẻ chỉ đọc.

## E-128: phiên bản thể lệ do admin đặt, khách đồng ý lại khi đổi

Chủ chốt: "phiên bản thể lệ đổi rác do admin đặt; khách đồng ý lại khi số phiên bản đổi."

Hiện trạng:
- `waste.constants.ts:2` gắn cứng `WASTE_CONSENT_VERSION = '2026-10-17.1'`.
- `customer/waste-requests.service.ts:260` ghi phiên bản này vào yêu cầu.
- Admin sửa được `waste.rules_text` (`waste-config.keys.ts:178`) nhưng phiên bản không đổi theo.

Luật mới:
1. Thêm khoá cấu hình, ví dụ `waste.rules_version`: chuỗi ngắn, khác rỗng, tối đa 32 ký tự.
   - Giá trị mặc định là `2026-10-17.1`, để deploy xong không bắt ai đồng ý lại.
   - Admin sửa ở cùng chỗ sửa thể lệ. Kèm câu nhắc: "Đổi số này khi sửa nội dung thể lệ để khách đồng ý lại".
   - Khoá công khai cho client nếu client cần so sánh.
2. API ghi `consentVersion` bằng giá trị cấu hình hiện tại thay cho hằng số.
3. Khách đồng ý lại khi số phiên bản đổi. Tìm xem client đang nhớ "đã đồng ý" ở đâu (state, localStorage, trường người dùng, hoặc mỗi yêu cầu một lần tick).
   - Nếu client nhớ sự đồng ý: phải hỏi lại khi phiên bản khác bản đã đồng ý.
   - Nếu mỗi lần tạo yêu cầu khách đều tick: client gửi kèm phiên bản đã đọc, API từ chối khi phiên bản cũ. Lời từ chối bảo khách đọc lại thể lệ. Ca này bắt buộc với bản Mini Live cũ không gửi phiên bản: quyết định an toàn và ghi vào báo cáo.
   - Không chặn khách đang có yêu cầu dở.
4. Hai nền Mini + web làm giống nhau.

Test: unit API (ghi đúng phiên bản cấu hình; ca phiên bản lệch), validator khoá, `reference-seed.race-spec.ts`, vitest hai nền cho màn đồng ý lại.

## tin-canhan-14/20: mục quầy ở Cá nhân cho nhân viên điểm đối tác

Chủ chốt: "`/auth/me` trả cờ nhẹ 'có điểm đối tác' để Cá nhân hiện mục Nhận hàng tại điểm cho nhân viên điểm."

Hiện trạng:
- Nhân viên điểm đối tác (`WastePointStaff`) có thể mang vai CUSTOMER (`waste-admin-points.service.ts` addStaff; `waste-access.service.ts:132-139`).
- Bộ lọc `mayHaveDesk` (Mini `apps/miniapp/src/pages/profile.tsx` khoảng :144, web `apps/web/src/app/tai-khoan/page.tsx` khoảng :124, `apps/web/src/components/account/account-menu.ts`) chỉ xét STAFF, ADMIN, hoặc DEALER khi cờ đổi rác bật. Vì vậy họ không thấy hàng "Nhận hàng tại điểm".

Luật mới:
- `/auth/me` trả thêm trường tuỳ chọn, ví dụ `hasDeskPoint: boolean`: có dòng `WastePointStaff` đang hoạt động ở điểm đang hoạt động.
  - Truy vấn nhẹ, có index, không thêm lời gọi API mới cho khách thường.
  - Thêm trường vào DTO chung ở app-core.
- Client hiện hàng khi `mayHaveDesk || hasDeskPoint`.
  - Bản Mini cũ không có trường thì chạy như trước.
  - Vẫn tôn trọng cờ đổi rác như logic hiện có.

Test: unit API `/auth/me` (có/không có điểm, điểm tắt, nhân viên tắt); vitest Mini profile và web tai-khoan/account-menu.

## Báo cáo thêm cho chủ
- Tên mã tin mới và câu chữ.
- Khoá cấu hình mới và giá trị mặc định.
- Việc chủ làm sau deploy, ví dụ đổi `waste.rules_version` khi sửa thể lệ.
