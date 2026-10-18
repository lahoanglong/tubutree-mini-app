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
