TITLE: feat(doi-rac): chặn bật Đổi rác khi thiếu thể lệ, sửa phí ship, luồng yêu cầu và Học viện

## Vấn đề
- Go-live chưa bắt được dữ liệu thiếu của Đổi rác. Thể lệ trống mà vẫn bật được `waste.enabled`, khách vẫn phải tick "Tôi đồng ý với Thể lệ". Bốn trang chính sách còn bản nháp, thông tin công ty trống nên không báo (R-1, R-11).
- Phí ship sai tỉnh. Mã tỉnh khách lưu là `84_VN79`, bảng phí nhập `79`, API so nguyên chuỗi nên khách TP.HCM luôn thấy khung "Toàn quốc" 30.000–85.000đ. Go-live vẫn báo PASS (R-48, R-49).
- Luồng yêu cầu khó theo dõi. Trang yêu cầu không tự cập nhật khi quầy xác nhận. Tab rỗng không có chữ. Web: bấm Quay lại sau khi tạo yêu cầu về form trống (R-47, R-48, R-51).
- Khách chưa cho số điện thoại gặp lỗi 403 kèm nút Thử lại vô ích. Khách thường vẫn thấy Học viện rồi gặp cổng "chỉ dành cho CTV" (R-50, R-53).
- Web hiện "Đổi rác lấy quà" ở menu và chân trang cả khi cờ `waste.enabled` tắt (R-46).

## Đã làm
Go-live và API
- R-1: go-live báo FAIL hoặc WARN khi 4 chính sách `legal.*` còn trống. Phần điền chữ do chủ làm trong Admin, PR này chỉ phần kiểm.
- R-11: `SystemConfigService` không cho bật `waste.enabled` khi `waste.rules_text` rỗng, và không cho xoá trắng thể lệ khi cờ đang bật. Go-live báo thêm giờ mở cửa điểm nhận và vùng phí.
- R-48, R-49 (API): `sameProvince` ở `packages/shared-types/src/waste-province.ts` coi `79` và `84_VN79` là một tỉnh. `waste-fee.ts` dùng hàm này. Go-live FAIL nếu không vùng phí nào chứa tỉnh của kho đang hoạt động.

Màn Đổi rác (Mini và web)
- R-49: thứ tự thẻ cách giao nằm ở `packages/app-core/src/waste-method-order.ts`, dùng chung hai nền. Thẻ bị khoá xếp cuối. Thẻ không nhảy chỗ khi đổi tỉnh vì giữ kết quả xem trước cuối của từng cách.
- R-47: yêu cầu tự cập nhật khi quầy xác nhận, có thẻ "Vừa cộng điểm", nút "Yêu cầu của tôi" là chữ gọn.
- R-48 (web): sau khi tạo yêu cầu, Quay lại về `/doi-rac`. Cờ "vừa gửi" được xoá ở trang xong, danh sách yêu cầu và lối Thu kèm rác, nên "Đổi thêm rác" vẫn vào bước 1.
- R-50 (Mini): trang yêu cầu và trang chọn điểm hiện thẻ "Cho Tubu số điện thoại" khi khách chưa có số. Khi thông tin khách còn chờ thì hiện khung chờ, không đòi số.
- R-51: tab rỗng có chữ và nút sang tab khác.
- R-52: chip và nút nhỏ có vùng chạm 44px.
- R-54 (web): khung chờ trang, kiểm nháp trước khi gọi API.
- R-56 (web): khách chưa đăng nhập ở bước 1 về `/doi-rac`, thanh đăng nhập dính đáy như Mini.
- R-128: khung chờ chat dạng bong bóng tin nhắn (Mini).
- R-129: danh sách "Cách đổi" có số thứ tự, ô biểu tượng có nền (Mini).

Menu, chân trang, Học viện
- R-46 (web): menu đầu trang và chân trang chỉ hiện Đổi rác khi cờ bật, hoặc khi khách có yêu cầu đang mở.
- R-53: Học viện chỉ hiện và chỉ gọi API với CTV, đại lý, nhân viên, admin. Mini báo mất kết nối kèm Thử lại thay vì khung chờ mãi.

## Làm một phần hoặc để sau
- R-53 một phần. Dòng Học viện ở menu tài khoản và `earn-sheet` thuộc gói taikhoan.
- R-54 một phần. Web xong. Mini chỉ tách khung chờ trong trang ra component `recycle-page-skeleton.tsx`, màn nhìn như cũ. `RouteFallback` ở `app.tsx` giữ nguyên, khung chờ lúc tải chunk lazy chưa làm. Đổi nó làm entry Mini tăng và đổi khung chờ của mọi route lazy.
- R-55 chưa xong, chờ chủ. Chip "Sự kiện" vẫn chung nhóm lọc ở feed Mini, web còn hàng Xếp hạng, Sự kiện, Đăng bài. Cần chủ chọn một bố cục cho cả hai nền.
- R-56 một phần, chờ chủ. Web cho khách chưa đăng nhập đọc bài và chat cần endpoint đọc công khai, API hiện đòi JWT.
- R-57 (nạp lại vai trò sau đăng ký CTV, bộ nhớ vai trò 5 giây ở máy chủ) giao gói ctv. Phần sửa ở `affiliate.tsx` đã bỏ khỏi PR này.
- R-165: câu kiểm đầu của `waste-method-order.spec.ts:28` đúng cả khi chưa sửa. Chỉ câu thứ hai kiểm thay đổi.

## Quyết định của chủ áp dụng ở PR này
Không có.

## Số đo
- Bảng kiểm (`gates/doirac.txt`, 0 FAIL): tsc sạch ở api, web, miniapp, app-core, e2e. eslint sạch ở api, miniapp, web (app-core chưa có lệnh eslint). vitest app-core 946/946 (76 file), miniapp 4868/4868 (313 file, cả khi TZ=UTC), web 7446/7446 (441 file). jest api 484 suite, 11231/11231. lint:parity xanh. vite build xanh.
- Chạy lại sau commit cuối: không cần: bảng kiểm trên chạy lúc 15:55, sau commit cuối `1ef5d0203` (15:01).
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,3 phút); web gate 354 đạt, 38 bỏ qua (3,3 phút). Chạy bằng `tools/pw-gate.sh` trên commit cuối, 0 ca hỏng.
- Gói Mini App: entry 711 KB (gz 222), không đổi. Tổng raw 1911,3 → 1914,4 KB (+3,1), gz 737,1 → 738,7 KB (+1,6). Phần tăng nằm ở chunk lazy: waste-phone-needed +1,0 (mới), recycle-new +0,5, recycle-requests +0,5, recycle +0,5, unique-by-id +0,4, support-chat +0,4, history −0,4 (bỏ).
- First Load web (next build, báo cáo `reviews/doirac-d.md`):

| Trang | Trước | Sau |
|---|---|---|
| / | 204 KB | 205 KB |
| /doi-rac | 166 KB | 167 KB |
| /doi-rac/tao | 173 KB (theo review 3) | 173 KB |
| /doi-rac/yeu-cau, /diem-nhan, /xong/[id] | không có số trước | 149, 152, 145 KB |
| /cong-dong, /cong-dong/[id], /hoc-vien | không có số trước | 168, 163, 140 KB |
| Dùng chung mọi trang | 103 KB | 103 KB |

- Review Opus: 5 lượt (r1, ba lượt đợt C, lượt D1). Kết luận cuối "merge được". Không còn P0, P1, P2. P3 còn lại đã ghi vào backlog (R-55, R-56, R-165).

## Ảnh trước/sau
Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Thư mục `docs/2026-10-28-review/screens-doirac/`:
- `recycle__guest__ok__s1.png`: trang Đổi rác khách chưa đăng nhập, danh sách Cách đổi có số, thẻ đăng nhập.
- `recycle__returning__ok__s1.png`: trang Đổi rác khách cũ, Mini và web 375.
- `recycle-requests__returning__ok__s1.png`: danh sách yêu cầu, tab rỗng có chữ.
- `recycle-requests__guest__ok__s1.png`: khách chưa cho số thấy thẻ xin số thay vì lỗi 403.
- `recycle-new__returning__ok__s1.png`: bước 2, thứ tự thẻ cách giao.
- `recycle-points__returning__ok__s1.png`: trang chọn điểm nhận.
- `academy__returning__ok__s1.png`: cổng Học viện theo vai.
- `recycle__returning__slow5s__s1.png`: khung chờ mạng chậm. Mini sau giống Mini trước (R-54 Mini chưa đổi màn), web chưa chụp cột sau.

## Cách kiểm
1. Admin: đặt `waste.rules_text` rỗng rồi bật `waste.enabled`, phải bị từ chối. Bật khi có thể lệ rồi xoá trắng thể lệ, cũng bị từ chối.
2. Chạy go-live. Thiếu `legal.*`, `company.*`, giờ mở cửa hoặc vùng phí chứa tỉnh của kho thì báo lỗi. Bảng phí nhập `79` hoặc `84_VN79` đều được tính.
3. Mini và web 375, khách ở TP.HCM, bước 2: thẻ Gửi về kho không còn "Toàn quốc" khi đã có vùng phí; thẻ khoá nằm cuối và không nhảy khi đổi tỉnh.
4. Web: tạo yêu cầu, bấm Quay lại về `/doi-rac`. Từ trang xong bấm "Đổi thêm rác" vào bước 1.
5. Mini, khách chưa cho số: mở Yêu cầu của tôi và chọn điểm, thấy thẻ xin số. Khách thường mở Học viện không gọi API và không thấy lối vào.
6. Tắt `waste.enabled`: menu và chân trang web không còn Đổi rác.
Chạy lại cổng: `docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-doirac` và `docs/2026-10-28-review/tools/pw-gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-doirac <cổng gốc>`.

## Deploy và migration
- Migration: không có.
- Biến môi trường, khoá cấu hình mới: không có.
- Trước khi bật `waste.enabled` trên PROD, chủ điền trong Admin: `company.*`, 4 chính sách `legal.*`, thể lệ, giờ mở cửa điểm nhận, vùng phí mail-in (nhập cả `79` và `84_VN79`). Go-live đang FAIL `company_identity` cho tới khi điền.
- PR có sửa nhỏ ngoài thư mục của gói: `apps/web/src/app/thanh-toan/page.tsx` (xoá cờ ở lối Thu kèm rác), `apps/e2e/tests/support/mock-api.ts` (mock `/config/public`), `waste-item-thumb.tsx`. Có thể xung đột nhỏ với gói muahang.

## Thứ tự merge
1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
