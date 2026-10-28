TITLE: feat(trang-chu): màn đầu gọn, món hàng lên đầu, trang chủ hết nhảy bố cục ở lần mở đầu, sửa Khám phá

## Vấn đề
- Trang chủ nhảy bố cục khi từng khối tải xong. Giờ vàng, Quà khách mới, Việc cần làm chen vào sau, lưới lối tắt đổi chiều cao (R-2). Web đo trước: CLS 0,2383 (khách mới), 0,1167 (khách cũ).
- Màn đầu không có món hàng nào. 8 lối tắt chiếm hai hàng, 4 ô trùng chỗ khác (R-3).
- Lần mở đầu có lớp "Chào mừng" phủ kín, khảo sát dài, bong bóng Vườn Xanh che nội dung 6–8 giây (R-4).
- Gợi ý tìm nuốt lỗi, không có Thử lại (R-14). Nhãn không tồn tại báo "Chưa tải được" kèm Thử lại vô ích, 3 lỗi console (R-19).
- Bản đồ "8 vùng đất": 6/8 ghim nằm sai tỉnh (R-20).
- Web: khách chưa đăng nhập không thấy quà khách mới (R-15); danh sách đầu `/san-pham` đã dựng ở máy chủ nhưng trình duyệt gọi lại `/products` (R-17); `/flash-sales/active` bị gọi 2 lần (R-16).

## Đã làm
Trang chủ (Mini và web)
- R-2: màn đầu giữ chỗ cho từng khối. Mini chưa nhớ loại khách thì giữ chỗ thẻ thành viên, không dựng bố cục khách mới rồi đổi hai lần. Web tải Giờ vàng ở máy chủ nên khối nằm trong HTML đầu (revalidate 60 giây). Khung chờ Giờ vàng cao 300px khớp thẻ thật. Chữ đồng hồ lệch giữa HTML cũ và trình duyệt không làm hỏng hydrate. Bản dựng sẵn bỏ suất đã hết giờ.
- R-2 (bổ sung sau khi đo bản gộp, `6c1f04082`): lần mở đầu trên máy chưa nhớ loại khách (khách mới, hoặc khách cũ đổi máy), mọi khối dưới thẻ thành viên là một khung chờ chung, rồi hiện cùng lúc khi dữ liệu quyết định hình dạng đã về: Việc cần làm, Giờ vàng, Danh mục. Giữ tối đa 4,5 giây, đã thả thì không giữ lại khi làm mới. Trước đó Giờ vàng, Mua lại, Việc cần làm, Bán chạy lần lượt chen lên trên khối đã vẽ. Máy đã nhớ loại khách và khách vãng lai trên web không đổi.
- R-3: màn đầu gọn, món hàng lên đầu (quyết định của chủ, xem dưới).
- R-4: tắt khảo sát lúc mở app. Bong bóng Vườn Xanh hiện một lần, bấm cả bong bóng là mở, tự tắt khi cuộn.
- R-15 (web): khách chưa đăng nhập thấy lời hứa quà khách mới.
- R-18: dải Việc cần làm có dòng đơn đang chuẩn bị.
- R-21 (web 1280): thẻ và lối tắt không còn dồn lệch trái.
- R-87: web, `/me` lỗi thì giữ thẻ thành viên kèm "Thử lại", giống Mini.
- R-88 (Mini): nút Việc cần làm cỡ nhỏ, tiêu đề tối đa 2 dòng.
- R-16 bước 1 (web): `/flash-sales/active` gọi một lần cho cả khối Giờ vàng và thẻ sản phẩm. Đường công khai không gửi Authorization.

Khám phá và thương hiệu
- R-14: gợi ý tìm báo lỗi, có Thử lại và khung chờ.
- R-17: `/san-pham` ở máy chủ không còn lấy `PAGE_LIMIT` từ file client (lỗi 400 khiến danh sách đầu không có trong HTML).
- R-19: nhãn không có hiện "Không tìm thấy nhãn hàng" kèm nút Danh mục. Theo dõi và chia sẻ chỉ hỏi sau khi nhãn tải xong và đã đăng nhập.
- R-20: ghim 8 nhãn đúng mảnh tỉnh, tên ra khoảng trống kèm đường dẫn. Bảng toạ độ dùng chung ở `packages/app-core/src/brand-origins.ts`.
- R-89: trang danh mục có tiêu đề, hàng chip đổi danh mục, ô tìm dính đầu trang, ở Mini và web 375.
- R-90: Mini có lối sang trang nhãn khi lọc theo nhãn công khai.
- R-91: chip lọc dài cắt "…", luôn giữ dấu X.
- Mini: khảo sát chào mừng đang tắt nên không còn phát chunk riêng (hằng lúc build).

## Làm một phần hoặc để sau
- R-16 một phần. Bước 2 (web dùng `/home` + `/home/me`) chưa làm, cỡ M, đụng cả cây home-view web.
- R-156 (P2): khách cũ mất mạng lúc mở app Mini vẫn thấy quà khách mới (`store/auth.ts:140,198`). Có từ trước.
- R-157: `new-customer-gift.tsx` còn nhắc "định kỳ" khi Mini tắt Định kỳ. Sửa sau khi khampha và muahang cùng gộp.
- R-164: Giờ vàng còn hai ca nhảy một lần: HTML ISR cũ trả sau giờ hết suất, và bản dựng rỗng rồi tải lại có suất mới. Cũng còn ca `initial` undefined ở `flash-sale.tsx:101`. Hiếm, chưa đo bằng `cls-probe`.
- R-165: `routes.json` chỉ khai persona returning cho browse-search; nên thêm new và guest.
- R-177 (P2): đổi lấy CLS ~0, món hàng ở Mini hiện chậm hơn ở lần mở đầu (số ở mục Số đo). Chủ chọn giữ hay bỏ bản sửa `6c1f04082`.
- R-173..R-176 (P3 của review `6c1f04082`): web giữ khung chờ đủ 4,5 giây khi phiên lỗi; khách cũ mở web trên máy mới thấy món hàng dựng ở máy chủ biến mất rồi hiện lại; thiếu test trang cho ca truy vấn lỗi và hẹn giờ; chiều cao khung chờ chung viết tay.
- Bong bóng Vườn Xanh còn che thẻ Giờ vàng hoặc thẻ sản phẩm ở vài ảnh. Chủ đã chốt hiện một lần.

## Quyết định của chủ áp dụng ở PR này
- Trang chủ gọn, món hàng lên đầu (R-3).
- Khảo sát lúc mở app tắt; bong bóng Vườn Xanh hiện một lần (R-4).

## Số đo
- Bảng kiểm (`gates/khampha.txt`, 0 FAIL): tsc sạch ở api, web, miniapp, app-core, e2e. eslint sạch ở api, miniapp, web. vitest app-core 917/917 (71 file), miniapp 4875/4875 (314 file, cả khi TZ=UTC), web 7451/7451 (441 file). jest api 484 suite, 11217/11217. lint:parity xanh. vite build xanh.
- Chạy lại sau bản sửa CLS (`gates/khampha-g3.txt`, sau `6c1f04082`; `ba0ad78f1` chỉ sửa chú thích), 0 FAIL: tsc, eslint, vitest app-core 921/921 (71 file), miniapp 4879/4879 (315 file, cả TZ=UTC), web 7455/7455 (442 file), jest api 484 suite / 11217 test, lint:parity, vite build; gói Mini entry 707/221 KB, tổng 1911/738 KB (main: 711/222, 1911/737).
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,3 phút); web gate 354 đạt, 38 bỏ qua (3,3 phút). Chạy bằng `tools/pw-gate.sh` sau bản sửa CLS `6c1f04082`, 0 ca hỏng.
- Gói Mini App: entry 711 → 706 KB (gz 222 → 220). Tổng raw 1911,3 → 1910,2 KB (−1,1), gz 737,1 → 737,1 KB. Chunk đổi: browse +2,1, wallet +0,5, brand-story +0,4, post-detail +0,4, brand-view +0,3, notifications −0,5, index (entry) −5,1.
- First Load web (báo cáo `reviews/khampha-d.md`):

| Trang | Trước | Sau |
|---|---|---|
| / | 204 KB | 206 KB |
| /san-pham | 157 KB | 158 KB |
| Dùng chung mọi trang | 103 KB | 103 KB |

- Hiệu năng, đo trên bản gộp 8 nhánh (`perf/after-integ.json` bằng `tools/perf/run-all.mjs`, 4G chậm, CPU x4; tải máy lúc đo 19,7, lúc đo gốc 1,4) và `tools/perf/home-probe.mjs` (2 lần mỗi ca):
  - CLS Trang chủ (run-all): web khách cũ 0,416 → 0,000; Mini khách cũ 0,456 → 0,000; Mini khách vãng lai 0,828 → 0,066; Lighthouse web khách vãng lai 0,143 → 0,005.
  - home-probe, main → bản gộp: Mini khách vãng lai 0,83–0,88 → 0,000; Mini khách cũ trên máy mới 0,456 → 0,000; Mini khách cũ trên máy quen 0,200 → 0,075; web khách vãng lai 0,075 → 0,007; web khách cũ trên máy mới 0,416 → 0,000; web khách cũ trên máy quen 0,107 → 0,026.
  - Cái giá (R-177): ở lần mở đầu, Mini chờ biết khách là ai mới hiện các khối. Thẻ sản phẩm đầu tiên của khách vãng lai 2,2 s → 3,3 s, khách cũ trên máy mới 2,3 s → 2,6 s.
  - `/san-pham` web: LCP 3,0 s → 0,6 s; Lighthouse 85 → 100 (R-17).
  - LCP web Trang chủ 0,67 s → 3,9 s, Lighthouse 94 → 78: phần tử LCP là chữ nhỏ tới sau (bóng gợi ý Vườn Xanh 3.520 px², dòng "Chờ chuyển khoản") vì dữ liệu lane không có ảnh sản phẩm. Ở PROD, ảnh thẻ sản phẩm lớn hơn nhiều; chưa đo với ảnh thật.
  - Số của worker trước bản sửa CLS, đo bằng `tools/perf/cls-probe.mjs` (web khổ 375, API chậm giả lập 1200 ms):
  - Web trước: khách mới 0,2383; khách cũ 0,1167 (`reviews/khampha-b.md`, đo ở `next dev`).
  - Web sau, suất Giờ vàng còn hơn 2 ngày: khách mới 0,0048; khách cũ 0,022; khách vãng lai 0,0048. Suất còn dưới 24 giờ: cùng số.
  - Mini sau: khách mới 0,0374; khách cũ 0,074.
  - Mục tiêu R-2 là dưới 0,1; đạt cả năm. Số kiểm kê ban đầu ở `03-perf-runtime.md`: Mini khách cũ 0,456, khách vãng lai 0,828, web 0,416 (điều kiện đo khác).
- Review Opus: 6 lượt (ba lượt đợt C, D1, D2, lượt xem `6c1f04082`). Lượt cuối "merge được", 0 P1/P2; P3 sửa chú thích ở `ba0ad78f1`, còn lại ghi vào backlog (R-156, R-157, R-164, R-165, R-173..R-176).

## Ảnh trước/sau
Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Thư mục `docs/2026-10-28-review/screens-khampha/`:
- `home__returning__ok__s1.png`: trang chủ khách cũ, Mini và web 375 giống nhau, có món hàng ở màn đầu.
- `home__new__ok__s1.png`: khách mới, không còn khảo sát phủ màn, món hàng trong màn đầu.
- `home__guest__ok__s1.png`: khách vãng lai, web có lời hứa quà khách mới.
- `home__new__slow5s__s1.png`: mạng chậm 5 giây, khung giữ chỗ thay cho khối nhảy vào.
- `browse-category__returning__ok__s1.png`: trang danh mục có tiêu đề và hàng chip.
- `brand-story__returning__ok__s1.png`: bản đồ với 8 ghim đúng tỉnh.
- `browse-search__returning__ok__s1.png`: ô tìm và gợi ý.
- `brand-slug__new__ok__s1.png`: nhãn không tồn tại.

## Cách kiểm
1. Mini, khách mới và khách cũ, mạng chậm: trang chủ không đổi thứ tự khối khi tải, món hàng thấy ngay ở màn đầu.
2. Web 375: mở `/`, cuộn nhẹ khi tải, không có khối nào đẩy nội dung xuống. Chưa đăng nhập thấy lời hứa quà và nút Nhận quà.
3. Mini, lần mở đầu: không có lớp Chào mừng. Bong bóng Vườn Xanh hiện một lần rồi biến mất.
4. Tìm kiếm khi tắt mạng: có câu báo lỗi và nút Thử lại. Mở nhãn không tồn tại: thấy "Không tìm thấy nhãn hàng".
5. Câu chuyện nhãn: 8 ghim đúng tỉnh, Sokfarm trên đất liền.
Chạy lại cổng: `docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-khampha` và `docs/2026-10-28-review/tools/pw-gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-khampha <cổng gốc>`.

## Deploy và migration
- Migration: không có.
- Biến môi trường, khoá cấu hình mới: không có.
- Trang chủ web dựng ở máy chủ và làm mới mỗi 60 giây (ISR). Bản đang chạy sẽ đổi sau lần làm mới đầu.
- Thứ tự: nhánh `hieunang` đã gộp `khampha`, nên `khampha` phải merge trước `hieunang`.

## Thứ tự merge
1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
