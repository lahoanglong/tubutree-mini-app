TITLE: feat(ctv): hoa hồng đã duyệt tự vào Ví Tubu, trang CTV ba tab, sửa đại lý và nhân viên

## Vấn đề
- Trang CTV: số to "Hoa hồng tháng này" gồm cả hoa hồng chưa chốt, trong khi "Có thể chuyển vào Ví" là 0đ. Ô "Chuyển vào Ví" mờ, bấm không phản hồi, không nói lý do (R-12).
- Trang CTV dài 12 khối, "Lịch sử hoa hồng" ở màn thứ ba, mở trang gọi 15 request. Ví Tubu chỉ có một lối vào, chữ lệch với trang CTV (R-59, R-60).
- Khách mới đăng ký CTV xong mất lối Học viện vì máy chủ nhớ vai trò cũ; người chưa có gian hàng hay nhãn mở trang là có lỗi 404 đỏ ở console (R-57, R-66).
- Gian hàng CTV có điều kiện luôn tích ✓, nút dính đáy kéo khách sang danh mục chung (R-58, R-61). Link chia sẻ trong Mini là link web, người nhận rời Mini App (R-67).
- Đại lý và nhân viên: bảng giá tên bị cắt, form phải gõ lại tên và SĐT, thẻ chấm công báo "không có ca" khi đang tải hoặc lỗi, nút bị cắt chữ, trang chặn quyền không có đường về (R-62, R-63, R-64, R-65, R-137, R-141).

## Đã làm
**Hoa hồng và Ví (API, Mini App, web)**
- Hoa hồng CTV đã duyệt tự vào Ví Tubu, đi qua đúng đường "Chuyển vào Ví" bấm tay (`requestPayout`): cùng khoá tháng, khấu trừ TNCN, sổ Ví. Không có đường ghi tiền thứ hai. Cron duyệt hoa hồng chạy mỗi giờ, sau bước duyệt thì quét mọi hoa hồng APPROVED còn sót. Khoá idempotency theo tập hoa hồng, cron chồng nhau hay CTV bấm tay cùng lúc chỉ cộng một lần.
- CTV thiếu MST mà bị khấu trừ thì không tự chuyển, vẫn bấm tay và nhận tin "đã duyệt, chưa tự vào Ví". CTV bị khoá không tự chuyển. Thuế ăn hết số tiền thì báo CTV bằng tin riêng.
- Tin mới trong app: "Đã cộng … hoa hồng vào Ví Tubu" và "toàn bộ khấu trừ thuế". CTV đã tự cộng không nhận thêm tin "đã duyệt".
- R-12: số to là "Có thể chuyển vào Ví"; khi cờ bật và hết hoa hồng chờ chuyển thì là "Số dư Ví Tubu", có dòng "Xem Ví Tubu". Dòng "Đang chờ" nói lý do (đơn chưa giao, hoặc trong thời gian đổi/trả). Hero có khung chờ lúc tải, không nhảy số. Sau khi chuyển, dashboard làm mới sau Ví.

**Trang CTV**
- R-59, R-60, R-142: ba tab Tổng quan, Hoa hồng, Chia sẻ, query theo tab, mốc thưởng thu gọn, thẻ "Việc đầu tiên", lối sang Ví; ô đầu trang mở bảng chia sẻ, nút trong thẻ mã là "Sao chép mã". Bảng chia sẻ, lên đơn hộ, chuyển vào Ví và thư viện QR nạp theo nhu cầu.
- R-57: đăng ký CTV xoá bản nhớ vai trò của phiên. R-66: `/storefront/me` và `/brand/owner/me` trả 200 với null khi chưa có, hai client xử lý.
- R-67: link chia sẻ (sao chép, lời đăng, QR, bộ nội dung CTV, trang sản phẩm, Cá nhân) dùng link Mini App; web giữ link web.

**Ví, gian hàng, đại lý, nhân viên**
- R-60, R-139: Ví dùng chung câu "Hoa hồng đang chờ", ô tiền chờ bấm sang tab Hoa hồng, nhãn hạng dài được cắt.
- R-58: điều kiện mở gian hàng tích theo trạng thái thật, dòng chưa đạt có vòng tròn rỗng và lối làm; trình đọc màn hình đọc được "Đã đạt/Chưa đạt".
- R-61: khách xem gian hàng CTV không còn nút dính đáy, chỉ có link phụ "Xem thêm ở Tubu Tree".
- R-62, R-63 (phần điền sẵn), R-137: bảng giá đại lý tên hai dòng và phân loại riêng, điền sẵn tên và SĐT, rỗng đúng ngữ cảnh kèm "Đặt đơn sỉ", "Báo đã chuyển khoản", tab giữ trên URL.
- R-64, R-65, R-141: thẻ chấm công không báo sai khi đang tải hoặc lỗi (có Thử lại), nút "Đăng ký ca" và "Chép tuần" không bị cắt, thẻ ngày hôm nay nổi bật (Mini và web), trang chặn có hình và nút "Về Cá nhân" ở cả hai nền tảng.

## Làm một phần hoặc để sau
- R-63: chỉ điền sẵn tên và SĐT. Chữ pháp lý của form CCCD (mục đích, thời hạn lưu, ô đồng ý) không đụng, chờ chủ.
- R-66: không sửa 403 của `/merchant/store` (guard auth).
- R-160 (mới, P3, chờ chủ): số to là "Số dư Ví Tubu" khi hết hoa hồng chờ chuyển, mà số dư Ví gồm cả tiền hoàn tiền. Chủ chốt có giữ không. Chưa có ảnh ca này.
- R-161 (mới, P3): ngay sau khi chuyển vào Ví, nút "Chuyển vào Ví Tubu" còn bấm được tới khi dashboard tải lại. Máy chủ từ chối nên không mất tiền, nhưng khách thấy lỗi. Guard `autoCredited.has` (`affiliate.service.ts:1420`) không bao giờ có tác dụng.
- Chưa đo lại CLS/LCP của `/ctv` sau khi hero chờ thêm Ví.

## Quyết định của chủ áp dụng ở PR này
- Hoa hồng CTV đã duyệt tự vào Ví (R-12).

**Chủ cần biết trước khi deploy:** lượt cron đầu tiên sau deploy sẽ tự chuyển mọi hoa hồng đang APPROVED vào Ví Tubu của CTV, kể cả khoản tồn từ trước. Khoản tự chuyển bị khấu trừ TNCN như bấm tay. CTV thiếu MST mà thuộc diện khấu trừ thì không tự chuyển. Muốn dừng thì đặt `affiliate.auto_wallet_transfer_enabled` = false trước khi deploy.

## Số đo
- Bảng kiểm (`gates/ctv.txt`): tsc (shared-types, api, web, miniapp, app-core, e2e) PASS; eslint api/miniapp/web PASS; vitest app-core 942/942 (72 file), miniapp 4888/4888 (314 file, cả TZ=UTC), web 7454/7454 (441 file); jest api 485 suite / 11239 test; lint:parity PASS; vite build PASS. Lần chạy lại sau commit cuối: không cần, bảng kiểm trên chạy lúc 16:04, sau commit cuối `af7cf59a4` (15:32).
- Race toàn bộ trên nhánh này: 293 suite / 2257 test đạt.
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,4 phút); web gate 354 đạt, 38 bỏ qua (4,2 phút). Chạy bằng `tools/pw-gate.sh` trên commit cuối, 0 ca hỏng.
- Gói Mini App: entry 711 KB raw / 222 KB gz, không đổi. Tổng raw 1911,3 → 1919,1 KB (+7,8), gz 737,1 → 739,8 KB (+2,7). Chunk đổi (KB raw): affiliate 45,2 → 48,3; ctv-dashboard mới 1,5; dealer +0,7; staff +0,6; storefront-signup +0,5; storefront-builder +0,5; wallet +0,4. Đạt luật: entry không tăng, tổng gz tăng không quá 3 KB. Review cuối đo theo trần cũ +5 KB raw nên ghi P2, xem dưới.
- First Load web (KB, trước → sau): /ctv 179 → 157; /ctv/gian-hang 178 → 170; /s/[slug] 159 → 151; /dai-ly 161 → 162; /tai-khoan/vi-tubu 142 → 144; /nhan-vien 148 → 150; /nhan-vien/bang-luong 162 (không có số trước để so).
- Review Opus: 5 lượt (chưa merge; chưa merge; merge được; chưa merge; chưa merge). Hai lượt cuối chỉ còn P2 về bundle Mini (+7,8 KB raw so với trần cũ +5 KB raw), đạt theo luật hiện hành. Không còn P0, P1. P3 còn lại đã ghi vào backlog (R-160, R-161); hai P3 khác: ca race mới (`approveDueCommissions` thật) đã chạy trong lần race toàn bộ ở trên, và việc chụp ảnh ca "Số dư Ví Tubu".

## Ảnh trước/sau
Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Thư mục `screens-ctv/`:
- `affiliate__ctv__ok__s1.png`: trang CTV trước/sau, số to và ba tab.
- `affiliate__ctv__sau-mini375-hero.png`: hero Mini 375 với persona CTV có hoa hồng chờ.
- `affiliate__ctv__sau-web375-hero.png`: hero web 375, khớp Mini.
- `wallet__ctv__sau-mini375.png`: Ví Tubu Mini, thẻ "Hoa hồng đang chờ".
- `wallet__ctv__sau-web375.png`: Ví Tubu web 375, khớp Mini.
- `dealer__dealer__ok__s1.png`: bảng giá đại lý tên hai dòng.
- `staff__staff__sau-mini375.png`: thẻ ngày hôm nay và nút "Chép tuần" (Mini).
- `staff__staff__sau-web375.png`: cùng màn trên web 375.

## Cách kiểm
1. Đăng nhập CTV có hoa hồng APPROVED, mở trang CTV: ba tab, số to và dòng "Đang chờ" nói đúng lý do.
2. Chờ lượt cron giờ kế tiếp (hoặc gọi `approveDueCommissions` trên môi trường thử): hoa hồng thành PAID, Ví tăng đúng số sau thuế, CTV nhận tin "Đã cộng …".
3. CTV thiếu MST có hoa hồng vượt ngưỡng thuế: không tự chuyển, vẫn bấm tay được.
4. Ví Tubu: bấm thẻ "Hoa hồng đang chờ" sang tab Hoa hồng; tên hạng dài bị cắt "…".
5. Đại lý: bảng giá thấy tên và phân loại tách dòng, form đăng ký đã điền sẵn tên và SĐT. Nhân viên: mở bằng tài khoản thường thấy trang chặn và nút "Về Cá nhân".
6. Chạy lại cổng:
`docs/2026-10-28-review/tools/gate.sh <worktree>` và `docs/2026-10-28-review/tools/pw-gate.sh <worktree> <cổng gốc>`.

## Deploy và migration
- Migration `20261028130000_affiliate_auto_wallet_transfer`: chỉ ghi dữ liệu, không đổi schema. Thêm dòng `system_configs` `affiliate.auto_wallet_transfer_enabled` = true (`ON CONFLICT DO NOTHING`, không đè giá trị admin đã chỉnh), thêm hai mẫu tin trong app `COMMISSION_WALLET_CREDITED` và `COMMISSION_WALLET_TAX_ONLY`, và sửa chữ mẫu `COMMISSION_APPROVED` (chỉ khi còn bản gốc) thành "chưa tự vào Ví, bạn chuyển tay".
- Cờ `affiliate.auto_wallet_transfer_enabled`: bật khi mặc định; thiếu cờ thì client coi là tắt. Tắt thì về hành vi cũ (bấm tay). Cờ có trong danh sách nạp prod.
- Phải phát hành Mini App cùng lúc với API. `/brand/owner/me` giờ trả 200 với thân rỗng; Mini App bản cũ trên Zalo Live đọc `!q.data` mà không phải 404 nên người chưa có nhãn sẽ thấy "không tải được" thay vì màn trống.
- Không đổi tỉ lệ hoa hồng, `hold_days`, ngưỡng thuế.

## Thứ tự merge
1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
