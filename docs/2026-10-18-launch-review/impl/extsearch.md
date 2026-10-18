# extsearch: gửi mã khi mã đang có người khác chờ

## Lỗi
Khách A gửi mã X khi đơn chưa về: A có attempt UNMATCHED (chờ tìm lại tối đa 3 ngày). Khách B gửi cùng mã X: `persist` ghi attempt NOT_FOUND cho B (do unique một phần "một lần chờ mỗi mã") nhưng vẫn trả `SEARCHING` ("đang tìm"). Sai: chỉ lần chờ của A được tìm tiếp, mã của B sẽ không bao giờ được tìm.

## Sửa
- `external-claim.service.ts`: `persist` trả `Persisted` mới `WAITING_OTHER` khi lần chờ đang có thuộc người khác (A gửi lại vẫn `SEARCHING`, không ghi gì thêm). `submit` đổi thành phản hồi `status: 'CLAIMED_BY_OTHER'`, `claimId: null`, câu: "Mã này đang được một tài khoản khác dùng để tích điểm. Nếu đây là đơn của bạn, liên hệ CSKH." Không lộ gì về tài khoản kia.
- shared-types: `SubmitExternalClaimStatus` thêm `CLAIMED_BY_OTHER` (chưa có trạng thái nào phù hợp). Web admin không dùng kiểu này.
- Attempt NOT_FOUND của B vẫn được ghi như cũ nên CSKH thấy hai người cùng gửi một mã. Không thêm bảng, không migration.
- Mini App `pages/external-points.tsx` + `i18n/vi.ts` (`resultClaimedByOther`): đúng câu trên, icon thông tin, không icon đồng hồ "đang tìm", không dòng "Đã ghi nhận đơn". `services/external-points-api.ts` không cần đổi mã (kiểu được re-export từ shared-types); thêm spec xác nhận trạng thái đi nguyên vẹn.

## Đã kiểm, không đổi
- A đã có claim PENDING hoặc CREDITED trên đơn đã khớp: B bị từ chối `ALREADY_CLAIMED` (đúng, không phải SEARCHING). Có test khoá hành vi này.
- Hàng việc CSKH (`external-points-attention.ts`) chỉ đếm attempt UNMATCHED chưa xử lý, không có mục "mã trùng": attempt NOT_FOUND của B không được đếm. Chỉ thấy được ở lịch sử attempt của mã. Không thêm mục (ngoài phạm vi); nếu cần là việc riêng.
- NOT_FOUND của B vẫn tính vào khoá 24 giờ (5 lần trong cửa sổ), như trước.

## Kiểm thử
`test/integration-race/external-claims-extsearch.race-spec.ts` (3 ca): đỏ trước khi sửa 2/2 ca lỗi (nhận `SEARCHING`), ca ALREADY_CLAIMED xanh sẵn. Vitest miniapp: `external-points.spec.tsx` (1 ca mới), `external-points-api.spec.ts` (mới).

## Sửa sau review Opus
Đỏ trước khi sửa (a4a7e908): race N1, N2, N3a, N3b đỏ; unit M1 hai ca đỏ.
- N1: `waitingOther` được xét trước `unknown`: đơn nguồn UNKNOWN mà A đang chờ thì B nhận `CLAIMED_BY_OTHER`, không còn REVIEW "không cần làm gì".
- N2: dòng attempt chờ trong danh sách admin (`listAttempts`) có `otherSubmittersCount` và `otherSubmitters` (tối đa 10 người khác, SĐT che, giờ gửi; lượt UNMATCHED hoặc NOT_FOUND cùng mã trong 30 ngày, kể cả lượt đã đóng). Tab admin hiện "N người khác cùng gửi mã này" kèm danh sách. Dòng của A đã nằm trong "Cần xử lý" nên không thêm hàng đợi. Comment ở `persist` đã sửa.
- N3 (đã sửa lại ở C1 bên dưới): lượt chờ quá 3 ngày của CHÍNH khách gửi lại được đóng bằng `resolvedAt` + ghi chú rồi mở lượt mới, trả SEARCHING; lượt cũ còn trong lịch sử. Lượt của người khác không bao giờ bị đóng.
- M1: `createMany` đụng unique mà `findFirst` ra null (lượt chờ vừa đóng): thử `createMany` lại một lần; vẫn không được thì ghi NOT_FOUND và trả `CLAIMED_BY_OTHER`.

## Hai mục nhỏ từ review nhanh chatpts (74862043)
- S1: hộp ghi chú duyệt trên web kiểm cùng luật với API: bỏ ký tự vô hình và khoảng trắng, dưới 3 ký tự thì khoá nút và hiện "Ghi chú cần ít nhất 3 ký tự" ngay dưới ô. Hằng số và hàm dùng chung ở `lib/external-claims.ts` (`NOTE_MIN_CHARS`, `INVISIBLE_CHARS`, `noteContentLength`, `approveNoteError`); `ConfirmDialog` nhận thêm `input.validate`, `input.initial`, `input.error`. API vẫn trả 400 `NOTE_REQUIRED` khi hộp ghi chú đang mở thì hộp mở lại ngay, lỗi hiện trong hộp, giữ nội dung đã gõ.
- S2: `INVISIBLE` chuyển sang `external-claim-note.ts` với `/[\p{Cf}͏ᅟᅠ឴឵᠎⠀ㅤﾠ]/gu` (nhóm Cf gồm U+00AD, U+200B..U+200F, U+202A..U+202E, U+2060..U+2064, U+FEFF); web dùng cùng biểu thức. Test từng nhóm ký tự ở API (`external-claim-note.spec.ts`, race) và web (`lib/external-claims.spec.ts`, tab).

## Giới hạn đã biết
`maskVnPhonesInText` (che SĐT trong ghi chú) không đổi và còn sót vài dạng: `901 234 567` (không đầu 0), `0084...`, số ngăn bằng dấu phẩy; ngược lại có thể che nhầm một đoạn số bắt đầu bằng 0 trong mã vận đơn. Người duyệt vẫn được nhắc không ghi SĐT đầy đủ.

## Sửa lỗi chặn C1 (review lượt 2)
Bản N3 đầu đóng lượt chờ quá hạn của BẤT KỲ ai cùng mã nên B chiếm được mã của A (đơn về thì ghép cho B, A không được báo và biến khỏi "Cần xử lý"). Probe Q1 thành race test, đỏ trên 3abb0efc (B nhận SEARCHING, claim ghép cho B).
- `updateMany` đóng lượt quá hạn giờ có `userId` của người đang gửi: chỉ chủ lượt gửi lại mới đóng và mở lượt mới (SEARCHING).
- Người khác gửi trùng luôn nhận `CLAIMED_BY_OTHER` và ghi NOT_FOUND, kể cả khi lượt của A đã quá hạn. Lượt quá hạn của A vẫn mở, vẫn nằm trong "Cần xử lý" kèm `otherSubmitters` có B để CSKH quyết.
- Race: N3b thay bằng "C1" (B gửi khi lượt A quá hạn: CLAIMED_BY_OTHER, lượt A mở, A có trong `listAttempts` kèm B) và "Q1" (đơn về sau khi B gửi: không có claim cho B, lượt của A còn mở, vẫn trong hàng đợi). Lưu ý: cron `rematchUnmatched` chỉ quét lượt trong 3 ngày nên KHÔNG tự ghép lượt quá hạn của A khi đơn về; CSKH gắn tay từ "Cần xử lý" (không đúng như dự kiến "cron ghép cho A").
- S-a: cột `result` là chuỗi tự do chứ không có enum, và không có giá trị "đã hết hạn" sẵn có, nên lượt đã đóng giữ `result = 'UNMATCHED'` với `resolvedAt` và ghi chú "Quá hạn tìm lại...". Không thêm migration. Giới hạn: truy vấn theo `result` một mình không phân biệt lượt hết hạn với lượt chưa đóng, phải lọc thêm `resolvedAt`.
