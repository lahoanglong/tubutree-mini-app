TITLE: feat(diem-xanh): gộp chuỗi điểm danh, báo trước khi hạ hạng, gọn Vườn, Kho quà và Hạng

## Vấn đề
- Một lần điểm danh mà ba chỗ báo ba số nước khác nhau (Ưu đãi "+10", Vườn "nhận 60", toast "+60 · +50 quà đầu"). Có hai lịch điểm danh chạy song song (chu kỳ N1–N7 và chuỗi nước), Vườn có hai nút "Điểm danh" (R-10, R-37).
- Khách bị hạ hạng âm thầm. Hệ thống có hạn giữ hạng nhưng màn không hiện và không ai báo trước (R-42).
- Kho quà: khách Lộc Biếc thấy món đầu chưa đủ điểm, đổi xong "Xem ví mã" mở nhầm trang Hạng, màn rỗng web khác Mini (R-39, R-40, R-123, R-124).
- Vườn Xanh dài hơn bốn màn, lưới sổ tay loài cây tràn mép phải ở Mini, thẻ câu đố báo "đã xong" cả khi chưa có câu (R-38, R-45, R-119).
- Web: khách chưa đăng nhập vào Ưu đãi chỉ thấy tường, `/hoan-tien` vẫn mở dù cờ hoàn tiền tắt, Ưu đãi không nằm trong khung tài khoản (R-43, R-44, R-126).

## Đã làm
**Điểm danh và Vườn (Mini, web, API)**
- R-10: số nước hôm nay chỉ có một nguồn (API `daily-check-in`, gồm quà mốc 3 và 7 ngày, quà đầu, quà quay lại, cắt theo bình). Ưu đãi, Vườn và toast cùng một số.
- R-37: gộp hai chuỗi thành một chuỗi (chuỗi nằm ở hồ sơ Vườn, ngày Điểm Xanh = ((chuỗi − 1) mod 7) + 1). Bỏ nút điểm danh thứ hai ở Vườn. Bỏ endpoint cũ `POST /me/loyalty/check-in` (không còn client nào gọi). Bảng điểm, số giọt, quà mốc giữ nguyên.
- R-38: lưới sổ tay loài cây `minmax(0, 1fr)`, không tràn.
- R-45: thẻ nhiệm vụ chỉ hiện 3 việc chưa xong kèm "Xem tất cả", chuỗi thu thành dải gọn. Sheet "Kiếm nước" không hứa số nước khi bình đầy.
- R-119: thẻ câu đố tách ba trạng thái (đã làm, chưa có câu, lỗi có Thử lại), có khung chờ.
- R-120: nút vé giữ lửa và giọt sương có số.

**Hạng và Ưu đãi**
- R-42: dòng giữ hạng từ `tierGraceUntil` ("mua thêm … đơn giao thành công trước ngày …"), cùng một hàm `tierKeepGap` cho dòng này và tin báo. Tin báo trước hạ hạng xem mục Quyết định.
- R-41: "Xem thêm" cho lịch sử điểm.
- R-117: biểu tượng hạng tra theo thứ hạng, không theo tên.
- R-118: lỗi từng khối ghi tiêu đề riêng.
- R-127: thẻ thành viên chỉ tải khi mở (bớt 1 request).
- R-43 (một phần), R-126: web `/uu-dai` cho khách chỉ lời mời đăng nhập như Mini; Ưu đãi nằm trong khung tài khoản bản máy tính, thêm mục menu "Ưu đãi".
- R-44: web `/hoan-tien` chuyển về trang chủ khi cờ hoàn tiền tắt, như Mini.

**Kho quà**
- R-39: quà đủ điểm lên trước, hộp xác nhận cảnh báo khi đổi freeship thừa.
- R-123: luật vào nút "Thể lệ", số dư 0 thì hiện thẻ "Cách kiếm Điểm Xanh". Ghi chú điểm chưa dùng được vẫn hiện ở đầu trang.
- R-40: "Xem ví mã" mở Quà của tôi, mã vừa đổi nổi lên với nhãn "Mới".
- R-124: màn rỗng web dùng chung hình, chữ, nút với Mini.

## Làm một phần hoặc để sau
- R-43: chỉ làm `/uu-dai`. `/vuon-xanh` không đổi vì Mini cũng là tường đăng nhập (GameLoginGate), không có gì để chép.
- R-45: không làm hai ô câu đố và vòng quay cạnh nhau (rủi ro bố cục).
- R-24 (phần Điểm Xanh): không tái hiện được lỗi hydrate nên không có sửa mã.
- R-162 (mới, P3): khung chờ web dạng thẻ, Mini dạng khối ở Điểm Xanh và Vườn khi mạng chậm. Có từ trước gói.
- P3 còn lại sau review cuối, đã vào backlog (R-170, R-171):
  - Khi hàng đợi ZNS lỗi, log ZNS vẫn mang dedupeKey nên ZNS không được gửi lại đêm sau (`notifications.service.ts:228-235`).
  - Khung "số còn thiếu để giữ hạng" tính theo `until − 12 tháng`, còn cron hạ hạng 03:15 tính theo giờ chạy; chênh vài giờ (`loyalty.service.ts:650`).
  - Comment ở `loyalty.service.ts:642` nói sai: khách đủ mốc thì được bỏ hạn giữ hạng, không bị hạ.

## Quyết định của chủ áp dụng ở PR này
- Gộp hai chuỗi điểm danh (R-37).
- Tin Zalo OA báo trước khi hạ hạng (R-42).

**Chủ cần biết trước khi merge: ngày chuyển đổi chuỗi.** Ngày chuyển đổi lấy theo chuỗi nước. Khách đang ở N6 của chu kỳ Điểm Xanh cũ mà chuỗi nước ở ngày 1 thì hôm chuyển nhận điểm ngày 2 (1.000) thay vì ngày 7 (2.000), tức mất tối đa một ngày tiến độ. Muốn tránh phải đổi chuỗi nước, mà luật cấm đổi số giọt. Cần chủ chấp nhận và ghi vào PROGRESS.

## Số đo
- Bảng kiểm (`gates/diemxanh.txt`): tsc (shared-types, api, web, miniapp, app-core, e2e) PASS; eslint api/miniapp/web PASS; vitest app-core 932/932 (72 file), miniapp 4874/4874 (313 file, cả TZ=UTC), web 7448/7448 (442 file); jest api 486 suite / 11265 test; lint:parity PASS; vite build PASS. Lần chạy lại sau commit cuối: `gates/diemxanh-g2.txt`, chạy sau commit cuối `8093132a1`, 0 FAIL (không chạy lại jest; các commit API cuối lúc 15:07 nằm trong lần chạy đầu): số test như trên; gói Mini entry 711/222 KB, tổng 1916/739 KB.
- Race Postgres (đợt D, 10 suite liên quan điểm danh, hạng, tin báo): 104/104 qua. Toàn bộ race ở đợt B: 293 suite / 2249 test.
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,3 phút); web gate 354 đạt, 40 bỏ qua (4,4 phút). Chạy bằng `tools/pw-gate.sh` trên commit cuối, 0 ca hỏng.
- Gói Mini App: entry 711 KB raw / 222 KB gz, không tăng (chunk `index` 741,6 → 741,3 KB raw, gz −0,2). Tổng raw 1911,3 → 1915,9 KB (+4,6), gz 737,1 → 739,0 KB (+1,9). Chunk đổi: game 57,9 → 60,4 (+2,4); rewards 10,1 → 10,9; reward-rules 2,4 → 3,0; daily-check-in-card 4,2 → 4,8; loyalty 13,7 → 14,1 (KB raw).
- First Load web (KB, trước → sau): kho-qua 153 → 153; kho-qua/cua-toi 151 → 153; diem-xanh 179 → 180; uu-dai 165 → 165; vuon-xanh 169 → 170; hoan-tien 141 → 141. Đo ở đợt B; đợt C và D không đổi web quá một dòng.
- Review Opus: 4 lượt (merge được; chưa merge; merge được; merge được). Kết luận cuối "merge được", không còn P0, P1, P2. P3 còn lại ghi ở trên.

## Ảnh trước/sau
Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Thư mục `screens-diemxanh/`:
- `game__returning__ok__s1.png`: Vườn một nút điểm danh, một số nước, câu đố, nhiệm vụ gọn.
- `offers__returning__ok__s1.png`: Ưu đãi "Hôm nay nhận +1.000 Điểm Xanh · +60 giọt nước", khớp Vườn.
- `loyalty__returning__ok__s1.png`: dòng giữ hạng, biểu tượng hạng, Xem thêm lịch sử.
- `rewards__returning__ok__s1.png`: Kho quà, quà đủ điểm lên đầu, nút Thể lệ.
- `rewards-mine__returning__ok__s1.png`: Quà của tôi, mã vừa đổi có nhãn Mới.
- `cashback__returning__ok__s1.png`: web `/hoan-tien` khi cờ tắt.
- `offers__returning__error500__s1.png`: lỗi một khối ghi tiêu đề riêng, Mini và web khớp.

## Cách kiểm
1. Đăng nhập khách cũ, mở Ưu đãi rồi Vườn: số nước hôm nay giống nhau, Vườn chỉ có một nút điểm danh.
2. Bấm điểm danh: toast, Ưu đãi, Vườn cùng một số giọt; ngày Điểm Xanh theo chuỗi.
3. Hạng: khách có hạn giữ hạng thấy dòng "mua thêm … trước ngày …"; bấm Xem thêm ở lịch sử điểm.
4. Kho quà: 0 điểm thấy thẻ "Cách kiếm"; đổi một quà, bấm Xem ví mã, thấy mã vừa đổi lên đầu có nhãn Mới.
5. Web 375: mở `/uu-dai` khi chưa đăng nhập, thấy lời mời đăng nhập giống Mini; `/hoan-tien` về trang chủ.
6. Chạy lại cổng:
`docs/2026-10-28-review/tools/gate.sh <worktree>` và `docs/2026-10-28-review/tools/pw-gate.sh <worktree> <cổng gốc>`.

## Deploy và migration
- Migration `20261028120000_tier_drop_notice`: thêm cột nullable `users.tierDropNoticeFor` và một mẫu tin trong app `TIER_DROP_NOTICE` (`ON CONFLICT DO NOTHING`). Chỉ thêm, không sửa hay xoá gì.
- Hai khoá cấu hình mới (thêm vào `seed.ts`, chỉ tạo nếu chưa có; tiền tố `loyalty` nằm trong danh sách nạp):
  - `loyalty.tier_drop_notice_days`: mặc định 14, nhận 0 đến 365, 0 là tắt.
  - `loyalty.tier_drop_zns_template_id`: mặc định trống. Chưa có mã mẫu ZNS (số, đã duyệt ở Zalo) thì chỉ báo trong app, không lỗi. Có mã mẫu thì gửi thêm ZNS (biến `tier`, `date`, `need`) cho khách có SĐT. Tin ZNS thật chưa gửi thử được, mới test bằng mock.
- Tin báo trước hạ hạng là tin tài khoản: khách tắt Khuyến mãi vẫn nhận. Gửi một lần mỗi kỳ giữ hạng (khoá chống trùng `tier-drop:<hạn>`); kỳ mới báo lại.
- Cron mới 03:45 giờ VN, sau lượt tính lại hạng 03:15. Lượt đầu sau deploy sẽ báo mọi khách đang có hạn giữ hạng còn từ 14 ngày trở xuống và chưa đủ điều kiện giữ hạng.
- Việc nền mới hiện tên ở Sức khoẻ hệ thống (admin).
- API bỏ `POST /me/loyalty/check-in`. Client hiện tại không gọi, Mini App bản cũ trên Zalo Live cũng đã dùng `/me/daily-check-in`.

## Thứ tự merge
1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
