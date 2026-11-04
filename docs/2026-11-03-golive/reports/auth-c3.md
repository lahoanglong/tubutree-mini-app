# auth-c3 (gl/1103-auth, tip fd20cda05)

## Phát hiện
1. P2 entry Mini App tăng (+1472 B raw, khoảng +462 B gzip, đo bởi reviewer ở 4d1d794ca, gốc 52fd5cd65 = 675199 B): KHÔNG sửa mã. Đây là mã an toàn phiên (sessionEpoch, logoutInFlight, adoptSession, restoreParked, lastAdoptId) nằm trong store auth thuộc entry; cắt đi mở lại lỗi đăng xuất bị lọt. Tách ensurePhoneOrThrow/upgradeGuestSilently sang chunk lười chỉ gỡ khoảng 650 B, không đủ. Cần phiên điều phối 2a ghi ngoại lệ có số vào PROGRESS.md/brief: "gói auth: entry +1,5 KB raw / khoảng +0,46 KB gzip, mã an toàn phiên, chấp nhận". Tôi không sửa PROGRESS/brief (của 2a) và không tự đo lại bundle-report.
2. P3 test pendingJoin: SỬA, commit fd20cda05. Thêm ca "chạm nhóm thứ hai lúc nhóm đầu đang chờ phiên: login một lần, chỉ tham gia nhóm đầu". Kiểm đột biến: bỏ dòng `if (pendingJoin.current) return;` thì ca mới đỏ (1 failed | 43 passed), có dòng thì xanh (44/44). Chạm nhóm B bị nuốt im lặng là hành vi chấp nhận như Mua ngay Giờ vàng ở auth-4 (không đổi mã).
3. P3 kiểm chưa đủ: ĐÃ CHẠY.

## Số test thật (Node 22.23.3, 2 worker)
- vitest group-buy.spec.tsx: 44/44.
- vitest miniapp toàn bộ TZ=UTC: 419 file, 6578 test xanh.
- vitest miniapp toàn bộ TZ=America/New_York: 419 file, 6578 test xanh.
- Playwright Mini (E2E_SCOPE=miniapp, cổng 3903, --workers=1) flash-slots, offers, profile-calls, zalo-policy, referral: 35/35 xanh (1,2 phút).
- Không bật lane/API/DB; không còn tiến trình của tôi ở cổng 3903.
Chỉ đổi file test: apps/miniapp/src/pages/group-buy.spec.tsx. Chưa push.
