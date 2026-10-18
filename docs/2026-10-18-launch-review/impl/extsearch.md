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
- N3: lượt chờ quá 3 ngày (cron không còn quét) bị đóng bằng `resolvedAt` + ghi chú khi có người gửi lại mã (chỉ lượt chưa thấy đơn; lượt đã thấy đơn chờ CSKH thì giữ). A gửi lại hoặc B gửi: mở lượt chờ mới, trả SEARCHING. Lượt cũ còn trong lịch sử và hiện trong `otherSubmitters`. Không thêm cột hay migration.
- M1: `createMany` đụng unique mà `findFirst` ra null (lượt chờ vừa đóng): thử `createMany` lại một lần; vẫn không được thì ghi NOT_FOUND và trả `CLAIMED_BY_OTHER`.
