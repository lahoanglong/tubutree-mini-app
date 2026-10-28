TITLE: perf(hieu-nang): API tự đổi cỡ ảnh sản phẩm bằng sharp, khung chờ theo màn, bớt truy vấn giỏ

## Vấn đề
- Trang chủ Mini App tải khoảng 26,8 MB ảnh sản phẩm gốc, danh mục 3,6 MB, giỏ hàng 1,1 MB, trên mạng điện thoại (R-5).
- Bấm chuyển màn thì trắng hoặc chờ, không có khung chờ theo hình trang; lỗi tải mã màn hay mất mạng báo câu khó hiểu hoặc không thử lại được (R-76, R-79, R-83, R-84, R-85).
- Mọi GET công khai ở Mini chờ phiên đăng nhập xong mới chạy (R-78).
- `GET /cart` chạy 12 truy vấn SQL và tạo giỏ ngay cả khi chỉ đọc; Bán chạy đọc cả phân loại mỗi lượt (R-81, R-82).
- Danh sách sản phẩm có nhiều giá trị `staleTime` khác nhau giữa Mini và web (R-80).

## Đã làm
Ảnh (R-5):
- API: endpoint `/img` đổi cỡ ảnh sản phẩm, nhãn, vật phẩm và quà đổi rác bằng sharp, lưu bản nhỏ trên đĩa VPS. Chỉ đổi cỡ ảnh có trong danh sách của hệ thống (host Pancake và Cloudinary), khoá đường dẫn Cloudinary, kiểm `?v=`, giới hạn pixel 16M, hàng đợi có giới hạn, chống SSRF. Danh sách URL hợp lệ nạp bằng một truy vấn dùng chung mỗi 5 phút, nạp lại một lần nếu gặp URL lạ sau 30 giây. Lượt sai `?v=` đếm theo IP.
- Mini App và web: ảnh sản phẩm dùng bản đổi cỡ `srcset` 1x/2x. Lỗi thì thử ảnh gốc, rồi hình lá.
- Cache đĩa có trần theo tổng byte. Khi ảnh mới không vừa, dọn xuống 80% trần rồi ghi.

Tốc độ cảm nhận:
- R-78, R-79, R-84 (Mini): GET công khai không chờ phiên; boundary và khung chờ theo route; tải trước luồng mua; Thử lại tải lại app khi lỗi tải mã màn; mỗi cổng chào hay nhận mã một SilentBoundary. Cờ vào bằng link CTV và mã `?claim=` tính và lưu ngay ở entry.
- R-76, R-83 (web): khung chờ theo hình trang, `loading.tsx` và `error.tsx` theo nhóm trang. Thử lại làm mới dữ liệu server. Lỗi tải CSS của màn cũng tải lại app.
- R-80, R-85: một `staleTime` 60 giây cho danh sách sản phẩm trong app-core, dùng chung Mini và web; web không thử lại lỗi 4xx; mất mạng báo câu trung tính.
- R-77 (một phần): `CouponClaimGate` tải lười; `isGuestUser` tách khỏi cổng. Khai báo `OnboardingGate` theo cờ để bản build không phát chunk khảo sát chào mừng khi cờ tắt.

API:
- R-82: `GET /cart` đọc giỏ một lần, không tạo giỏ khi đọc, gộp đọc khách và số đơn.
- R-81: Bán chạy không đọc phân loại, nhớ thứ hạng 60 giây.

## Làm một phần hoặc để sau
- R-82 một phần: `/cart` giảm 5 câu SQL nhưng chưa chắc đạt đích ≤ 8 với mọi giỏ: giỏ ở lane 3 và lane 9 còn 8 câu ở lần gọi thứ hai, giỏ của lane 5 (dữ liệu dùng cho số gốc) còn 13. `/home/me` còn 17–19 câu, đích ≤ 12 chưa đạt; cần gộp truy vấn đơn, điểm, định kỳ trong `home.service`.
- R-77 một phần: entry Mini về 704 KB, chưa tới đích 600 KB; cần tách `vi.ts` và lazy khối trang chủ, làm sau khi các gói gộp.
- R-83 chưa làm cho `san-pham` và `san-pham/[slug]`: `loading.tsx` làm trang không tồn tại trả 200 thay vì 404 (commit `76dbe6bc5`), nên đã bỏ. Cần khung chờ phía client hoặc cách giữ 404.
- R-158: khi khung chờ `/tai-khoan` còn hiện, nút lùi nổi ở chi tiết đơn về danh sách đơn thay vì `/tai-khoan`.
- R-159: lượt sai `?v=` tính theo IP; sau NAT nhiều khách chung IP, nếu một người spam thì ảnh hợp lệ chưa cache của IP đó trả 503 tối đa 60 giây (client rơi về ảnh gốc). Danh sách URL làm mới 5 phút nên ảnh vừa thay có thể trả 404 trong lúc chờ.
- Home hiện 37 ảnh sau so với 36 trước, chưa giải thích hết.
- Gói Mini App vượt luật của đợt 0,2 KB gzip (xem Số đo). Người giao chấp nhận và ghi lý do ở đây: entry giảm 7 KB; phần tăng là boundary, khung chờ theo màn và chọn nguồn ảnh cho mọi màn (R-79, R-84, R-5).

## Quyết định của chủ áp dụng ở PR này
- Ảnh do API tự đổi cỡ bằng sharp, lưu trên đĩa VPS.

## Số đo
- Bảng kiểm (`gates/hieunang.txt`, FAIL 0): tsc (api, web, miniapp, app-core, e2e) sạch; eslint sạch; vitest app-core 923, miniapp 4890 (cả TZ=UTC), web 7456; jest api 486 suite / 11274 test; lint:parity xanh; vite build xanh.
- Lần chạy lại sau commit cuối: `gates/hieunang-g2.txt`, chạy sau commit cuối `056eee7af`, 0 FAIL (không chạy lại jest): tsc, eslint, vitest app-core 923/923, miniapp 4890/4890 (cả TZ=UTC), web 7456/7456, lint:parity, vite build; gói Mini entry 704/219 KB, tổng 1918/740 KB.
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,3 phút); web gate 354 đạt, 38 bỏ qua (3,9 phút). Chạy bằng `tools/pw-gate.sh` trên commit cuối, 0 ca hỏng.
- Gói Mini App (`chunks-hieunang.txt`, so với main):
  - Entry: 711 KB trước, 704 KB sau (222 → 219 gz), theo `gates/hieunang-g2.txt` sau commit cuối. Chunk `index.module.js` 741,6 → 738,0 KB.
  - Tổng: 1911,3 → 1917,7 KB raw (+6,4); 737,1 → 740,3 KB gz (+3,2). Số này tính cả khampha (khampha một mình: gz +0,0).
  - Luật gói của đợt (người giao chốt sau review D): entry không tăng; tổng gzip mỗi gói tăng không quá 3 KB. Gói này +3,2 KB gz, vượt 0,2 KB, đã chấp nhận (xem mục trên).
  - Chunk đổi: `coupon-claim-gate` mới +4,8 KB (lazy, 2,2 gz); `browse` +2,1; `wallet` +0,5; `brand-story`, `ai-advisor`, `post-detail`, `brand-view` mỗi chunk +0,4; `notifications` −0,5.
- First Load web (báo cáo đợt C, trước → sau): `/` 204 → 204; `/san-pham` 157 → 158; `/san-pham/[slug]` 174 → 175; `/gio-hang` 163 → 163; `/thanh-toan` 191 → 192; `/tai-khoan` 170 → 171; `/vuon-xanh` 169 → 170; `/mua-chung` 156 → 155; `/dang-nhap` 142 → 141. Tăng tối đa 1 KB. Chưa đo lại sau đợt D (đợt D không đổi mã web).
- Hiệu năng: chưa đo lại độ trễ API. `autocannon` của công cụ bắn vào API lane 5, lane này chạy mã main, nên số độ trễ của lượt đo này chỉ phản ánh tải máy (tải lúc đo 6,3, lúc đo gốc 1,4) và không dùng. Phía khách, đo trên bản gộp 8 nhánh (`perf/after-integ.json`): LCP Mini của khách vãng lai ở Danh mục 3,3 s → 2,4 s và trang sản phẩm 3,3 s → 2,6 s (R-78, GET công khai không chờ phiên). JS tải lúc mở Mini 222 → 330 KB vì R-79 tải sẵn 4 màn mua hàng khi máy rảnh (có chủ ý); FCP không đổi (1,65 s).
- Byte ảnh tải về (R-5, đo trên Mini 375 DPR2, khách quay lại, cuộn hết trang; trước = ảnh gốc, sau = bản `/img`):

| Màn | Trước | Sau |
|---|---|---|
| Trang chủ Mini | 26.765 KB | 1.659 KB |
| Trang chủ web 375 | 26.873 KB | 1.766 KB |
| Danh mục | 3.585 KB | 162 KB |
| Chi tiết sản phẩm | 3.585 KB | 185 KB |
| Giỏ hàng | 1.124 KB | 7 KB |

- Số câu SQL mỗi request (`tools/perf/run-all.mjs --only api`, cùng dữ liệu lane 5 và cùng khách như số gốc; log có thể lẫn vài câu của cron): `/cart` 22 → 17 (lần gọi đầu), 18 → 13 (lần gọi thứ hai), GET không còn ghi; `/home` 22 → 19; `/home/me` 26 → 26 và 18 → 19 (chưa đạt R-82). Worker đo trên giỏ khác (lane 3, lane 9): `/cart` 8 câu ở lần gọi thứ hai.
- Review Opus: 6 lượt (lượt 1, 2, 3, D1, D2, lượt cuối). Lượt 3 "merge được". D1 và D2 chỉ còn P2 về tổng gói Mini vượt trần +5 KB raw; người giao đã thay trần bằng luật gzip ở trên. Lượt cuối xem merge khampha (`058a0320a`) và `056eee7af`: "merge được", không mất hành vi của nhánh nào. Có build thật kiểm không còn chunk khảo sát khi cờ tắt. P3 còn lại đã ghi ở mục trên (R-82, R-83, R-158, R-159, ảnh 37/36).

## Ảnh trước/sau
Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Ảnh ở `docs/2026-10-28-review/screens-hieunang/`, mỗi file là ghép Mini 375 cạnh web 375. Cột "trước" chụp ở lane không có ảnh sản phẩm nên chỉ hiện hình lá; byte ở bảng trên đo riêng khi chặn `/img`. Chưa có cặp trước/sau cùng có ảnh thật cho trang chủ và danh mục.
- `home__returning__ok__s1.png`: trang chủ, ảnh sản phẩm hiện đúng sau khi đổi cỡ.
- `browse-category__returning__ok__s1.png`: danh mục.
- `product-slug__returning__ok__s1.png`: chi tiết sản phẩm, ảnh 1x/2x rõ nét.
- `cart__returning__ok__s1.png`: giỏ hàng.
- `browse__returning__ok__s1.png`: duyệt sản phẩm.
- Thư mục `real-images/` có bốn ảnh cùng tên `home`, `browse-category`, `cart`, `product-slug` với ảnh thật.

## Cách kiểm
1. Mở Mini App 375 bằng khách đã quay lại, trang chủ. Mở DevTools, tab Network, lọc ảnh: ảnh sản phẩm đi qua `/api/img?...` (webp), tổng vài MB trở xuống.
2. Tắt mạng rồi bấm chuyển màn: thấy khung chờ rồi câu mất kết nối trung tính, bấm Thử lại thì app tải lại.
3. Web 375: vào `/san-pham`, `/gio-hang`, `/tai-khoan` thấy khung chờ theo hình trang.
4. Ghi một ảnh sản phẩm không có trong hệ thống vào `/img?u=...`: phải bị từ chối, không đổi cỡ.
5. Trên VPS sau deploy: `du -sh` thư mục cache ảnh, không vượt `IMAGE_CACHE_MAX_MB`, và `df -h` còn chỗ.
6. Chạy lại cổng: `docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-hieunang` và `docs/2026-10-28-review/tools/pw-gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-hieunang <cổng gốc>`.

## Deploy và migration
- Migration: không có. Không đổi `docker-compose` PROD. Không đổi Prisma schema.
- Thư viện mới: `sharp` 0.35.5 (`apps/api/package.json`). `apps/api/Dockerfile` không cài thêm gói hệ thống: bước build alpine lấy `@img/sharp-linuxmusl-x64` và `libvips` có sẵn trong lock, cây `/app` chép sang image chạy. Chưa kiểm `docker build` thật; kiểm trước khi deploy.
- Biến môi trường mới, đều tuỳ chọn (`apps/api/src/config/env.validation.ts`, ví dụ ở `.env.production.example`):
  - `IMAGE_CACHE_DIR`: thư mục cache. Mặc định `tubu-img-cache` trong thư mục tạm của container (`/tmp`). Mất khi dựng lại container, tự tạo lại dần.
  - `IMAGE_CACHE_MAX_MB`: trần dung lượng cache. Mặc định 512, tối đa 10240. Ví dụ trong `.env.production.example` đặt 200.
  - `IMAGE_RESIZE_EXTRA_HOSTS`: host ảnh cho phép thêm. Mặc định rỗng, tức chỉ host Pancake và Cloudinary.
- Đĩa VPS đã từng đầy (B-155) và cache nằm trong lớp ghi của container. Trước khi deploy: đặt `IMAGE_CACHE_MAX_MB=200` (hoặc nhỏ hơn) trong `.env` PROD và kiểm `df -h`. Cache có trần và tự dọn xuống 80% khi đầy, file quá tuổi bị xoá.
- Phải merge sau khampha: nhánh này đã gộp khampha (commit `058a0320a`). Phần riêng của hieunang xem bằng `git log --first-parent 1384ff380..HEAD`.

## Thứ tự merge
1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
