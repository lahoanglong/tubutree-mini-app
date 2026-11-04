# auth-3 (nhánh gl/1103-auth)
- P1 login/restore chờ nhau: SỬA. login() chụp logoutInFlight/restoreInFlight ngay lúc gọi, chỉ await afterLogout khi có logout, chỉ chờ restore bắt đầu trước. 3 test mới (ca A, ca B hai thứ tự), đỏ với mã cũ (stuck sau 300 ms), xanh nay.
- P2 entry tăng: KHÔNG BÙ ĐƯỢC, cần điều phối ghi ngoại lệ. Đo lại: largest JS raw 676529 B (gốc 675199, +1330 B). Lượng tăng là mã chốt phiên khởi động. Không gỡ khối logoutInFlight trong restore vì chưa chứng minh an toàn ngoài ca test.
- P3 token chỉ ở bộ nhớ: SỬA (memToken thu hồi sau logout), test mới đỏ với mã cũ.
- P3 Mua ngay Giờ vàng: SỬA (waitingBuyId -> loading trên nút, cờ mounted bỏ mua khi rời trang), test mới.
- P3 hết trần afterLogout: SỬA (refreshSession ném StorageTimeoutError nếu logout còn chạy), test mới đỏ với mã cũ.
- P3 wishlist-heart: SỬA (.catch trước .then), test mới.
- Test: vitest 3 file liên quan 146/146 (Node 22). Cả miniapp: 2085 pass, 8 fail đều ở attendance-api.spec.ts (acquireLocationPayload), cũng đỏ trên nhánh trước thay đổi, không thuộc gói. tsc, eslint sạch.
