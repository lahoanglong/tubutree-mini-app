# auth-4 (gl/1103-auth, commit 242797071)

| Phát hiện | Kết quả |
|---|---|
| P2 entry +1,3 KB raw | KHÔNG sửa trong gói: cần điều phối (2a) ghi ngoại lệ (mã chốt epoch/logoutInFlight/adoptSession là an toàn phiên) hoặc duyệt tách ensurePhoneOrThrow/upgradeGuestSilently sang chunk lười (~650 B, chưa đủ bù hết). Gói này cộng thêm ~+0,1 KB (restoreParked + điều kiện error). Chưa đo lại bundle vì máy tải 100+ (vitest 76 tiến trình của các phiên khác). |
| P3 login/restore chờ nhau | Sửa: biến `restoreParked` (đếm restore đỗ sau logout), login() không chờ restore đang đỗ. Test đỏ (stuck) trước, xanh sau. |
| P3 login đăng nhập lại khi restore lỗi storage | Sửa: login() dừng khi sau restore status='error' && error===sessionStorage. Test đỏ (loginZalo bị gọi 1 lần) trước, xanh sau. |
| P3 logout treo quá trần đè phiên mới | Không sửa: cần storage treo >3 s, cùng một người Zalo, chỉ sai trạng thái; sửa cần bộ đếm adoptedEpoch chạm nhiều đường, rủi ro lớn hơn lợi. Ghi nhận đánh đổi. |
| P3 aria-disabled Mua ngay | Sửa: `item.soldOut || buyPending || undefined`. Phần "chạm món B khi A đang chờ bị nuốt" không sửa (đổi hành vi UX, ngoài phạm vi). |

Test: auth.spec.ts 108 xanh (2 ca mới, đỏ trước khi sửa). Chạy rộng src/pages + flash chưa kết thúc do máy tải 100+: 452 ca xanh, 0 đỏ tới lúc dừng. tsc, bundle, lint:parity CHƯA chạy (unverified).
