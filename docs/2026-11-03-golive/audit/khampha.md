# Audit gl-1103, vùng khampha (Khám phá)

Phạm vi: Trang chủ, Danh mục (hub, danh mục con), Tìm kiếm (gợi ý, kết quả, lọc/sắp xếp, rỗng), Bán chạy, thanh đáy, thanh đầu, thương hiệu. Chỉ đọc và đo, không sửa mã, không commit, không đụng PROD. Vùng này không có làn ghi (không tim, không thêm giỏ, không đặt đơn).

Mã: worktree `gl-1103-docs` (main 52fd5cd65 = PROD 0aa8af5d1 + tài liệu). Lane 5: API 3251, web 3252, Mini 3253.
Ảnh tự chụp: `docs/2026-11-03-golive/audit/khampha/`. Ảnh ma trận chụp: `docs/2026-10-28-review/screens/<nhãn>/`. Kịch bản Playwright tự viết (không commit) ở thư mục tạm của phiên: `.../scratchpad/kp/*.mjs` (`mini-search`, `mini-multiword`, `mini-edge`, `mini-emoji`, `mini-emoji2`, `mini-nav`, `mini-homescroll`, `web-search`).

## 1. Đã kiểm gì

| Bề mặt | Phần đã kiểm | Cách |
|---|---|---|
| Mini 375 | Trang chủ (guest, new, returning) ở trạng thái ok; Danh mục hub; danh mục con; thương hiệu; Bán chạy; câu chuyện thương hiệu; Tìm kiếm (ô trống, gợi ý, kết quả, lọc, sắp xếp, rỗng, từ dài, ký tự đặc biệt, emoji, nhiều từ); bấm chuông, giỏ, "Tất cả lối tắt", danh mục, quay lại; thanh đáy; cuộn sâu rồi quay lại từ PDP/danh mục | Playwright `miniapp-session.mjs` lane 5, ảnh + số đo |
| Mini 375 | Trạng thái loading, error500, offline, empty, longtext, slow5s | Ảnh ma trận `capture.mjs` + `index-*.jsonl` (axe, vùng chạm nhỏ, lỗi API) |
| API | `/products`, `/products/:slug`, `/brand/public/:slug/products`, `/brands`, `/categories`, `/search/suggest` với từ khoá nhiều từ, dài, dấu, `%`, `_`, NUL, tham số lạ | curl lane 5 với `x-throttle-bypass` |
| Web 375 | Trang chủ (guest, new, returning) ok, `/san-pham` returning ok; axe và vùng chạm từ `index-web375.jsonl` | Ảnh ma trận đã có |
| Mã | Mini và web: home, browse, search-state, shortcut, nav, header | Đọc mã |

## 2. Chưa kiểm được (nói rõ để không hiểu nhầm là đã đạt)

- Web lane 5 và lane 6 không phản hồi trong phiên này: tải máy 50 đến 174 (`uptime` lúc cuối: load 174), `curl -m 40 http://localhost:3252/` trả 000 sau 40 giây, các lần chụp web quá 90 giây bị `TimeoutError: page.goto`. Vì vậy chưa có ảnh web 1280 của khampha nào, chưa có ảnh web 375 mới cho Bán chạy, Danh mục con, Tìm kiếm, thương hiệu, các trạng thái loading, error, offline, rỗng, chữ dài của web.
- Chưa so Mini với web 375 từng màn ngoài Trang chủ (new, returning, guest) và `/san-pham` returning. Chưa biết web 375 có mất vị trí cuộn Trang chủ sau khi quay lại không, và lối tắt Trang chủ web có nhảy khi cấu hình tải xong không.
- Thanh đầu máy tính 1280 (ô tìm không có gợi ý ở các trang ngoài `/san-pham`, thanh lọc bên, phân trang số `?page=999`) chỉ đọc mã `site-search.tsx`, `site-header.tsx`, `filter-sidebar.tsx`, `numbered-pager.tsx`, chưa chạy thử, nên không đưa vào danh sách phát hiện.
- Trang thương hiệu đã xuất bản: toàn bộ thương hiệu seed chưa xuất bản (`/brand/fuwa3e` ra trạng thái không tìm thấy), nên chỉ thấy trạng thái đó, chưa thấy trang có sản phẩm.
- Ô Mini `returning` ở một số ô chụp ma trận dính 429 từ `/auth/zalo-mini-app` (nhiều ô chụp song song dùng chung giới hạn của lane); các kịch bản tự viết của tôi đã thêm `x-throttle-bypass` nên số liệu trong báo cáo này lấy từ các lần chạy đó, không lấy từ ô dính 429.
- Không kiểm hiệu năng (vùng `hieunang` làm), không kiểm bảo mật ngoài lỗi NUL (vùng `baomat` làm).

## 3. Phát hiện

Thang mức theo `audit-brief.md`. Không có P0.

### KHAMPHA-01, P1, mini375, Trang chủ: quay lại từ PDP hoặc danh mục thì Trang chủ về đầu trang

Khách cuộn sâu Trang chủ, bấm một sản phẩm, bấm Quay lại: Trang chủ dựng lại và đứng ở đầu, mất vị trí đã cuộn. `pages/home.tsx` không dùng `useScrollRestoration`; chỉ `pages/browse.tsx:165` và `pages/best-sellers.tsx:54` dùng. Trang chủ là màn dài nhất (thẻ thành viên, lối tắt, danh mục, Bán chạy, Giờ vàng, Mua lại, feed) nên đây là điểm khách bực nhất khi lướt.

- Số đo: `scrollTop` 4529 trước khi bấm thẻ, 0 sau Quay lại; ca khác 300 thành 0.
- Ảnh: `audit/khampha/mini375-homescroll-1-deep.png`, `audit/khampha/mini375-homescroll-2-after-back.png`.
- Tái hiện: `node .../scratchpad/kp/mini-homescroll.mjs` (guest hoặc returning, cuộn sâu, bấm thẻ ở toạ độ (90, 270), `history.back()`).
- Đề xuất: gắn `useScrollRestoration('home', ready)` vào `pages/home.tsx` giống Danh mục, hoặc giữ nguyên cây trang chủ khi vào PDP. Công sức M. Web 375 chưa kiểm (Next có khôi phục cuộn mặc định nhưng feed tải client có thể chưa đủ cao lúc khôi phục).

### KHAMPHA-02, P1, api (ảnh hưởng Mini và web), Tìm kiếm: từ khoá nhiều từ phải liền nhau và đúng thứ tự mới ra kết quả

`likeContainsPattern` ghép các từ bằng một ký tự `_`: `search-text.ts:93-95` trả `%${words.join('_')}%`, `catalog.service.ts:71-78` lọc `p."nameSearch" LIKE ... ESCAPE '!'` rồi xếp `isFeatured DESC, đã bán DESC`. Hệ quả: "nước chén" ra 0 kết quả dù có "Nước rửa chén sinh học Fuwa3e"; "Fuwa3e nước", "dầu bé" cũng ra 0. Khách gõ từ khoá tự nhiên theo thứ tự khác hoặc bỏ bớt từ sẽ thấy "Không tìm thấy" và bỏ đi. Gợi ý (`/search/suggest`) cùng lỗi nên cũng rỗng. Thanh sắp xếp mặc định ghi "Liên quan" nhưng không có xếp hạng độ liên quan (chỉ nổi bật rồi bán chạy), nên nhãn không đúng nghĩa.

- Số đo: `curl "http://localhost:3251/api/products?q=nuoc%20chen"` thành `total 0`; `/api/search/suggest?q=nuoc%20chen` thành `[]`; `q=nuoc%20rua%20chen` có kết quả (liền nhau).
- Ảnh: `audit/khampha/mini375-multiword-nuoc-chen-results.png`, `...-nuoc-chen-suggest.png`, `...-fuwa-nuoc-results.png`, `...-fuwa-nuoc-suggest.png`, đối chứng `...-nuoc-rua-chen-results.png`.
- Đề xuất: tách từ, mỗi từ một điều kiện `nameSearch LIKE %từ%` nối AND (tối đa 5 đến 6 từ); xếp trước các sản phẩm khớp nguyên cụm hoặc khớp đầu tên, rồi nổi bật, rồi bán chạy; cân nhắc khớp thêm thương hiệu và danh mục. Giữ nguyên giới hạn `q` 100 ký tự và thoát `%`/`_`. Công sức M. Không đụng luật điểm, giá, pháp lý.

### KHAMPHA-03, P2, api, ký tự NUL (%00) trong tham số công khai gây 500

`/products?q=a%00`, `brand=`, `category=`, `segment=`, `slugs=`, `/search/suggest?q=nuoc%00`, `/brand/public/%00/products`, `/products/%00` đều trả 500 (PostgreSQL từ chối byte 0). Đây là điểm vào công khai, không cần đăng nhập, nên một bot cũng làm ra 500 và rác log.

- Tái hiện: `curl -i -H "x-throttle-bypass: $TOK" "http://localhost:3251/api/search/suggest?q=nuoc%00"`.
- Ảnh Mini (tìm kiếm có NUL): `audit/khampha/mini375-edge-returning-nul.png`, `audit/khampha/mini375-edge-returning-nulcat.png`.
- Đề xuất: một pipe hoặc middleware toàn cục từ chối chuỗi chứa `\u0000` bằng 400 (hoặc cắt bỏ), thay vì thêm từng DTO. Công sức S. `owner: 2a` (API catalog); lỗi chung của API nên vùng `baomat` có thể báo trùng.

### KHAMPHA-04, P2, mini375, Trang chủ: lối tắt đổi chỗ khi cấu hình tải xong

`ShortcutGrid` (`components/home/shortcut-grid.tsx:62-70`) dựng ô theo `cfg.isLoaded && cfg.waste.enabled`; trước khi `/config/public` về, `PUBLIC_CONFIG_FALLBACK.waste.enabled = false` (`hooks/use-public-config.ts:13`), nên hàng đầu hiện Giờ vàng, Mã giảm giá, Mua chung, Đổi quà, Tất cả; khi cấu hình về và `waste.enabled` bật thì Đổi rác chen vào vị trí 3 và Đổi quà bị đẩy xuống sheet "Tất cả". Khách đang nhắm bấm "Đổi quà" thì ô đổi chỗ ngay dưới ngón tay. Cờ `waste.*` đang tắt trên PROD nên chưa thấy ở khách thật, sẽ thấy khi bật.

- Ảnh: `docs/2026-10-28-review/screens/mini375-loading/home__returning__mini375-loading__s1.png` (Đổi quà ở ô 4) so với `docs/2026-10-28-review/screens/mini375/home__returning__mini375__s1.png` (Đổi rác ở ô 3, Mua chung ô 4).
- Đề xuất: giữ khung xương lối tắt (5 ô trơn) đến khi `cfg.isLoaded`, hoặc lưu cờ lần trước (như cookie gợi ý của web) để dựng đúng ngay khung đầu. Công sức S. Web 375 chưa kiểm.

### KHAMPHA-05, P2, mini375, Tìm kiếm rỗng: từ khoá dài không có khoảng trắng tràn khỏi dòng tiêu đề

Gõ chuỗi 100 ký tự liền không dấu cách thì dòng từ khoá trong tiêu đề "Không tìm thấy" không xuống dòng, rộng hơn màn hình và bị cắt cả hai mép (chữ đầu và chữ cuối không thấy).

- Ảnh: `audit/khampha/mini375-search-returning-06-q-130-aaaaa.png`.
- Đề xuất: `overflow-wrap: anywhere` (hoặc `word-break: break-word`) cho tiêu đề rỗng, hoặc cắt giữa chữ bằng `…` sau khoảng 40 ký tự. Công sức S. Web chưa kiểm.

### KHAMPHA-06, P2, mini375 và web375, Trang chủ khách mới: câu "Quà khách mới" bị cắt cụt

Khối quà khách mới (`components/home/new-customer-gift.tsx:154`, kẹp 2 dòng) chia chiều ngang cho nút "Chọn sản phẩm" nên câu lợi ích hiển thị "Miễn phí giao hàng cho đơ..." và khách không đọc được trọn điều kiện. Cùng lỗi ở web 375 (khối dùng chung bố cục).

- Ảnh: `docs/2026-10-28-review/screens/mini375/home__new__mini375__s1.png`, `docs/2026-10-28-review/screens/web375/home__new__web375__s1.png`.
- Đề xuất: đặt nút xuống dòng riêng dưới câu, hoặc bỏ mũi tên mở rộng và để câu chiếm cả hàng, hoặc rút ngắn câu ở `homeCopy` để vừa 2 dòng. Công sức S. Không đổi luật giá, chỉ bố cục.

### KHAMPHA-07, P3, mini375, Tìm kiếm: emoji nằm ngay vị trí ký tự thứ 100 làm trang báo lỗi chung

`utils/search-state.ts:80` cắt `q` ở 100 đơn vị UTF-16; nếu emoji nằm ở vị trí 99 đến 100 thì bị cắt giữa cặp thay thế (lone surrogate), tạo URL lỗi, truy vấn `/products` không được gửi và màn hiện "Chưa tải được trang này, Thử lại" (không có lỗi console). Ô tìm `components/ui/search-field.tsx` không có `maxLength`. Hiếm (cần chuỗi trên 99 ký tự) nên P3.

- Số đo (`mini-emoji2.mjs`): 99 chữ a + 😀 (109 đơn vị) thành lỗi chung, 0 lời gọi `/products`; 50a + 😀 + 49b (101 đơn vị) thành "0 sản phẩm" bình thường; `curl ...?q=` 101 ký tự thành 400 "Từ khoá không được dài quá 100 ký tự." (ngưỡng API tính 100).
- Ảnh: `audit/khampha/mini375-edge-emoji-typed.png`, `audit/khampha/mini375-edge-returning-emoji100.png`.
- Đề xuất: cắt theo điểm mã (`Array.from(s).slice(0, 100).join('')`) và đặt `maxLength={100}` trên ô nhập. Công sức S.

### KHAMPHA-08, P3, mini375 và web375, Trang chủ: gợi ý trong ô tìm bị cắt "Bạn đang tìm gì hôm ..."

Placeholder bị ellipsis ngay giữa câu ở 375 (cả Mini và web), trông như chữ chưa viết xong.

- Ảnh: `docs/2026-10-28-review/screens/mini375/home__guest__mini375__s1.png`, `docs/2026-10-28-review/screens/web375/home__new__web375__s1.png`, `audit/khampha/mini375-nav-guest-03-shortcuts-sheet.png` (nền sau sheet).
- Đề xuất: rút câu còn tối đa khoảng 24 ký tự ("Tìm sản phẩm", như Danh mục đang dùng "Tìm sản phẩm…") hoặc bỏ chữ cuối. Công sức S.

### KHAMPHA-09, P3, mini375, Trang chủ chữ dài: tên bậc trong thẻ thành viên không có ellipsis

Ở ô chụp `longtext`, tên bậc ("Bộ sản phẩm làm sạch thân...") trong `components/home/member-card.tsx` không bị cắt: chữ chạy xuyên dưới nút "Điểm danh" và lòi ra mép phải thẻ ("ng d" nằm ngoài nút). Chỉ xảy ra khi tên bậc dài bất thường.

- Ảnh: `docs/2026-10-28-review/screens/mini375-longtext/home__returning__mini375-longtext__s1.png`.
- Đề xuất: `minWidth: 0; overflow: hidden; textOverflow: ellipsis; whiteSpace: nowrap` cho span tên bậc. Công sức S.

### KHAMPHA-10, P3, mini375, Trang chủ lỗi 500: ba nút "Thử lại" trên cùng một màn

Khi server lỗi, Trang chủ hiện thẻ lỗi lớn (Thử lại + "Gọi 0984 606 774"), rồi hàng "Chào Lại / Chưa tải được hạn..." có thêm "Thử lại", rồi khối "Mua lại" có thêm "Thử lại". Ba nút làm cùng một việc, hàng chào còn cắt chữ "hạn...".

- Ảnh: `docs/2026-10-28-review/screens/mini375-error500/home__returning__mini375-error500__s1.png`.
- Đề xuất: chỉ giữ thẻ lỗi trên cùng; các khối con khi lỗi thì ẩn (hoặc hiện khung xương) và một lần Thử lại tải lại tất cả. Công sức S đến M.

### KHAMPHA-11, P3, mini375, Danh mục hub khi API lỗi: không báo lỗi, không có Thử lại, nhóm dự phòng đổi tên

Khi `/categories` lỗi, hub âm thầm hiện nhóm dự phòng cứng (`SEGMENT_ENTRIES` qua `hooks/use-categories.ts`): "Cho mẹ & bé, Nhà bếp xanh, Chăm sóc cá nhân, Sống xanh" khác tên với nhóm thật ở Trang chủ ("Mỹ phẩm thiên nhiên, Tẩy rửa sinh học, Cho bé, ..."), và trống phần còn lại, không có nút tải lại. Khách không biết đang xem bản dự phòng.

- Ảnh: `docs/2026-10-28-review/screens/mini375-error500/browse__returning__mini375-error500__s1.png` so với `docs/2026-10-28-review/screens/mini375/home__new__mini375__s1.png`.
- Đề xuất: khi lỗi hiện `ErrorState` có Thử lại thay vì nhóm dự phòng khác tên, hoặc làm tên dự phòng trùng tên thật. Công sức S.

### KHAMPHA-12, P3, mini375 và web375, Trang chủ: chip thương hiệu cao 36px

13 mục dưới 44px trong ma trận (axe không báo nhưng `smallTargets` đo): chip thương hiệu Trang chủ rộng 69 đến 82px, cao 36px (`Pơ Lang` 82x36, `Hector` 74x36, `Fuwa3e` 81x36, `Tất cả` 69x36). Vượt WCAG 2.5.8 (24px) nhưng dưới chuẩn 44px của DS.

- Bằng chứng: `docs/2026-10-28-review/screens/index-mini375.jsonl` (key `home`, `smallTargets`), `index-web375.jsonl` (14 mục, cùng nhóm).
- Đề xuất: tăng vùng chạm bằng đệm vô hình (`min-height: 44px` qua `::after`) mà giữ chiều cao nhìn thấy. Công sức S.

### KHAMPHA-13, P3, web375, Trang chủ: link logo rộng 20px, cao 30px

Trên Trang chủ web 375, `components/home/home-header.tsx:33` đặt link logo `a.block` 20x30 (dấu logo `LOGO_MARK_WIDTH`), nhỏ hơn mức tối thiểu 24px của WCAG 2.5.8 và 44px của DS. Mini không có link ở logo (nó là `h1`).

- Bằng chứng: `docs/2026-10-28-review/screens/index-web375.jsonl`, `smallTargets.examples[0]` = `{text:'Tubu Tree — trang chủ', sel:'a.block', w:20, h:30}`.
- Đề xuất: nới vùng chạm bằng padding âm margin hoặc `min-h-11 min-w-11` quanh logo, hoặc bỏ link để giống Mini. Công sức S.

### KHAMPHA-14, P3, mini375, Tìm kiếm: chip giá "500k–100k" khi giá nhỏ nhất lớn hơn giá lớn nhất

Mở `/browse?minPrice=500000&maxPrice=100000` (URL, không đặt được từ sheet lọc) cho chip "500k–100k", 31 sản phẩm hiện đầy đủ và "Lọc (1)". Khách thường không tới được, chỉ gặp qua liên kết chia sẻ sai.

- Ảnh: `audit/khampha/mini375-edge-returning-minGtMax.png`.
- Đề xuất: ở `parseSearchState` hoán đổi hai giá khi min > max, hoặc bỏ cả hai. Công sức S.

### KHAMPHA-15, P3, mini375, Tìm kiếm: lịch sử tìm gần đây dùng chung một khoá cho mọi tài khoản trên máy

`utils/recent-searches.ts:4` khoá `tubu_recent_searches` không gắn mã khách; đăng xuất rồi đăng nhập tài khoản khác trên cùng điện thoại vẫn thấy từ khoá cũ của người trước. Chỉ ảnh hưởng máy dùng chung.

- Bằng chứng: đọc mã `apps/miniapp/src/utils/recent-searches.ts:4,13,40,49`.
- Đề xuất: xoá lịch sử khi đăng xuất hoặc thêm mã khách vào khoá. Công sức S.

### KHAMPHA-16, P3, web375, `/san-pham`: axe báo `landmark-unique`

Ô chụp web 375 `/san-pham` returning có 1 vi phạm axe `landmark-unique`, node không được ghi lại. Mã có hai nơi vẽ `form role="search"` (`components/catalog/browse-view.tsx:257-258` và `components/site-search.tsx:99`); chưa xác định cái nào gây ra vì web không phản hồi nên không chạy lại được.

- Bằng chứng: `docs/2026-10-28-review/screens/index-web375.jsonl` (key `browse`, persona `returning`, `axe.byRule = {"landmark-unique": 1}`).
- Đề xuất: chạy lại axe để lấy node; thêm `aria-label` khác nhau cho từng landmark tìm kiếm. Công sức S. Chưa xác minh nguyên nhân.

### KHAMPHA-17, P3, mini375 (needsOwnerDecision), thương hiệu: chính tả Sokfarm và Sokfram, Le Plateau và Le Plateau Coffee

`packages/app-core/src/brand-origins.ts:140-141` có `brand: 'Sokfarm'` (hiển thị ở câu chuyện thương hiệu, dòng 146 "Sokfarm Trà Vinh...") nhưng `catalogBrand: 'Sokfram'` (khớp tên trong seed `apps/api/prisma/seed.ts:661-663`, "Gạo lứt huyết rồng Sokfram"). Tương tự `brand: 'Le Plateau'` so với `catalogBrand: 'Le Plateau Coffee'` (dòng 116-117). Khách thấy hai cách viết trong cùng ứng dụng. Cần chủ chốt tên thương hiệu đúng (không đọc PROD để so, chưa kiểm dữ liệu thật).

- Đề xuất: thống nhất tên đúng ở dữ liệu catalog và `brand-origins.ts`. Công sức S.

## 4. Không phải lỗi hoặc không báo

- 429 ở `/auth/zalo-mini-app` trong ô chụp ma trận: do chụp song song dùng chung giới hạn lane, không phải lỗi sản phẩm.
- Thứ tự khối Trang chủ web khác Mini ở persona `returning` khi chụp: do thiếu cookie `tubu_home_hint` trong chụp ma trận (nằm trong thiết kế trình duyệt thật).
- "6 sản phẩm" kèm lưới rỗng ở trạng thái `empty`: thành phần của kịch bản giả lập `empty`, không phải dữ liệu thật.
- Bong bóng gợi ý Vườn Xanh ("Trồng cây mỗi ngày, nhận quà thật") che hàng sản phẩm: hiện một lần rồi tự tắt (`components/garden-hint-bubble.tsx`).
- Ảnh sản phẩm trống (khung lá): dữ liệu seed, bình thường.

## 5. Lệnh đã dùng

```sh
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
TOK=$(grep '^THROTTLE_BYPASS_TOKEN=' docs/2026-10-20-uat/tools/uat-harness/state/lane-5/lane.env | cut -d= -f2- | tr -d '[:space:]')
curl -s -H "x-throttle-bypass: $TOK" "http://localhost:3251/api/products?q=nuoc%20chen"      # total 0
curl -s -H "x-throttle-bypass: $TOK" "http://localhost:3251/api/search/suggest?q=nuoc%20chen" # []
curl -s -o /dev/null -w "%{http_code}\n" -H "x-throttle-bypass: $TOK" "http://localhost:3251/api/search/suggest?q=nuoc%00" # 500
node <scratchpad>/kp/mini-homescroll.mjs   # KHAMPHA-01
node <scratchpad>/kp/mini-multiword.mjs    # KHAMPHA-02
node <scratchpad>/kp/mini-emoji2.mjs       # KHAMPHA-07
node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375 --keys home,browse,browse-category,browse-search,browse-brand,best-sellers,brand-story
```
