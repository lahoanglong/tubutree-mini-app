# home-r3a: sửa phát hiện reviewer Opus (continue-findings2, khoá home)

Nhánh gl/1103-home, tip d4d0f395b (chưa push). Node 22.23.3, vitest `--minWorkers=1 --maxWorkers=2`, Playwright `--workers=1`, không bật lane (stub API cổng 3982 + `next dev` 3981 qua E2E_SCOPE=web, đã tắt).

## Từng phát hiện
- P2 lời chào tràn khi chưa có tên bậc: ĐÃ SỬA (commit trước d4d0f395b, "fix(home): lời chào chỉ không co khi có tên bậc"). `flexShrink:0` chỉ đặt cùng `maxWidth:60%` khi có `tierName`, cả Mini và web. Test mới (tên 'Thanhthuy1990shopmyphamthiennhien', loyalty pending/lỗi) ĐỎ với mã cũ ("expected '0' not to be '0'"), xanh sau sửa. Ca "tên bậc dài" của Mini đổi sang đợi tên bậc rồi mới kiểm flexShrink.
- P2 spec home-cls ghi sai dữ liệu: ĐÃ SỬA (d4d0f395b). Ghi `{userId,rows}` cho `tubu_home_todo_rows`, `tubu_home_kind`, cookie `tubu_web_session` + `tubu_home_hint=returning-1`. Đo lại (web, dev, stub API trống): 375 máy đã nhớ 0,0004 (trước 0,079); 1280 đã nhớ 0,0074; 375 máy mới 0,076 (lần lạnh 0,157 có thêm chân trang +0,082 do stub trả lưới rỗng); 1280 máy mới 0,005–0,016. Hai ca nay khác nhau thật. Ngưỡng siết: đã nhớ < 0,02, máy mới < 0,2. Kết luận cũ "bộ nhớ số dòng không giúp" SAI: khi máy đã nhớ, khung chờ giữ chỗ đúng, CLS ~0. Ảnh chưa chụp (chụp tập trung).
- P2 HIEUNANG-03 chưa đạt: KHÔNG SỬA, theo quyết định điều phối 03/11 23:40 (ca máy mới + summary còn chờ hoãn backlog; giữ 64px cho mọi khách làm hỏng Trang chủ đa số). Số đo máy mới 0,076 (375) là ca đã hoãn. Ca máy đã nhớ đạt (trên).
- P2 entry Mini +148 B gz: ĐO LẠI, TRONG NGƯỠNG. vite build gzip -9 trên entry: gốc 52fd5cd65 675199 raw / 208818 gz; tip 675870 / 208994 => +671 B raw, +176 B gz (< +0,2 KB cho gói home). Không cắt thêm.
- P2 thiếu bằng chứng: LÀM PHẦN CÒN LẠI TRONG PHẠM VI. Ảnh trước/sau, persona, CLS 6 route HIEUNANG-04: để phiên điều phối chụp tập trung (không còn P2). First Load web (next build, API tắt): `/` 260 kB -> 260 kB; `/thanh-toan` 245 kB -> 247 kB (page 20,5 -> 22,1 kB; shared 104 kB không đổi). eslint chạy sạch trên mọi file ts/tsx đã đổi của miniapp và web; app-core không có eslint cài (bỏ qua).
- P3 thẻ thành viên cao 84px: KHÔNG SỬA, cần chủ duyệt đổi bố cục (đã ghi trước đó).
- P3 Mini nhớ chip, web không: KHÔNG SỬA, ghi backlog parity (web dựng "Tất cả" từ HTML server; khôi phục chip gây lệch hydrate).

## Số test thật
- miniapp vitest TZ=UTC: src/components/home + src/pages: 120 file / 2693 test xanh; member-card.spec 9/9
- web vitest: src/components/home + src/lib: 155 file / 1812 test xanh; member-card.spec 8/8
- tsc --noEmit miniapp, web, e2e: sạch
- Playwright web home-cls.web.spec: 8/8 xanh (hai lượt)
