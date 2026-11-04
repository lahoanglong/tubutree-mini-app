# auth lượt 2 (sửa theo reviewer Opus), nhánh gl/1103-auth

Commit 0e2bb5db3 "fix(auth): đăng xuất chưa xong thì đường tạo phiên chờ; chạm lưu mã và Mua ngay Giờ vàng lúc đang khôi phục phiên thì chạy tiếp; test các chốt epoch" (trên b6d472ea3, ec4693ddf). Test mới ghi "đỏ với mã cũ" đã chạy thật trước khi sửa.

## Phát hiện và xử lý
- P1 logout để lọt phiên (khe chờ storage): ĐÃ SỬA. Thêm `logoutInFlight` (đặt đồng bộ ở đầu logout, gỡ ở finally). `refreshSession()`, `login()`, `restore()` chờ logout xong (`afterLogout()`, trần 3 s như storage, quá trần thì đi tiếp để bước đọc storage tự báo lỗi máy, không treo mãi). Test đỏ trước sửa: handler 401 trong khe logout, restore() trong khe logout (2 ca đỏ), cùng ca login() (P3 #6). Test mới: logout treo thì refresh chỉ chờ tới trần.
- P2 test cho các chốt epoch: ĐÃ THÊM 9 ca (describe "đăng xuất đang chạy dở"). Đột biến từng chốt, mỗi lần đúng ca tương ứng đỏ: adoptSession sau ghi (1 ca), catch tryZaloLogin (1), catch silentLogin (1), catch restore (2), login() sau chờ restore (1, kẹt 'loading'), loadFirstTouch (1).
- P2 tim đã có; kho mã (`use-claim-coupon`) và Mua ngay Giờ vàng (`flash-sale.tsx onBuy`): ĐÃ SỬA, chạm lúc 'loading' thì chờ login() rồi chạy tiếp claim/mua, một lần dù chạm nhiều (ref/busy), không ra phiên thì không làm gì. Test: `use-claim-coupon-restoring.spec.tsx` (store thật, 2 ca, đỏ với mã cũ), `flash-sale.spec.tsx` +2 ca (store giả có hành vi như thật; đỏ với mã cũ). Không dựng store thật cho cả trang Giờ vàng vì trang kéo quá nhiều mock.
- P2 entry tăng: CHƯA BÙ ĐƯỢC. Đo lại cùng phép đo (largest JS, raw/gzip): gốc 52fd5cd65 = 675199 / 210305; hiện tại = 676421 / 210767 (+1222 B raw, +462 B gzip, 0,2%). Lượng tăng nằm ở mã chốt epoch và logout trong store auth (khởi động, không lười được). Đã rút `afterLogout` còn 1 dòng dùng lại withStorageTimeout. Chuyển ensurePhone/upgradeGuest sang chunk lười chỉ gỡ khoảng 650 B raw, không đủ, và đụng đường đăng nhập, nên không làm. Cần điều phối ghi chấp nhận ngoại lệ (+0,46 KB gzip) hay chỉ định cắt chỗ khác.
- P3 tim chạm nhiều lần lúc 'loading': ĐÃ SỬA (ref `pendingLike`, một ý định). Test mới đỏ với mã cũ (thêm rồi bỏ).
- P3 comment AUTH_STORAGE_TIMEOUT_MS: ĐÃ SỬA.
- P3 login sau logout bắt đầu / adoptSession xoá nhầm token phiên mới: ĐÃ SỬA (login/restore chờ logout; xoá nền chỉ khi storage còn đúng token vừa ghi).
- P3 getStorage hỏng vĩnh viễn thì restore luôn 'error': KHÔNG SỬA, brief chọn đánh đổi này. Rủi ro ghi lại: máy mà đọc storage luôn ném thì nút Thử lại không bao giờ ra phiên (trước đây rơi xuống Zalo). Đề xuất sau N lần liên tiếp thì login Zalo giữ phiên trong bộ nhớ.

## Kiểm
- vitest auth.spec 101/101 (TZ=UTC); wishlist-heart-restoring 2/2; use-claim-coupon(+restoring) 8/8; flash-sale 38/38.
- tsc miniapp sạch. Vitest miniapp TOÀN BỘ (TZ=UTC): 6548/6564 pass, 16 đỏ ở 11 file không liên quan; chạy lại riêng: 14 đỏ do quá giờ khi tải máy 200 (qua khi chạy lại), 2 đỏ thật không do gói này vì cũng đỏ trên gốc 52fd5cd65: campaign-banner (chiến dịch theo ngày) và flash-sale.spec đồng hồ '59:59' (phụ thuộc đồng hồ thật). Chưa chạy được TZ khác (máy quá tải).
- lint:parity xanh. Playwright Mini (offers, flash-slots, zalo-policy, profile-calls, referral): 31 pass, 2 đỏ + 2 flaky ở flash-slots "Nhắc tôi khi chưa đăng nhập rồi đăng nhập xong"; cũng đỏ khi thay auth.ts, flash-sale.tsx, wishlist-heart.tsx bằng bản gốc 52fd5cd65 (đã chạy), nên không do gói này.
- Ghi chú: prettier không đúng cấu hình repo cho spec (không chạy tự động lên file đã có).
