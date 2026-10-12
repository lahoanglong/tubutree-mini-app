# PG-3: heading-order ở web và ghim bản đồ /brand-story

Nhánh hz20/PG-3, gốc da4c671a. Không push, không deploy, không ghi PROD.

## Mục 1: axe `heading-order` ở apps/web

Nguyên nhân: 11 route (tính ở 1440px) bị h1 "Quản trị Tubu Tree" hoặc h1 của cổng đối tác rồi nhảy thẳng xuống h3. Danh sách route lấy từ kết quả capture cũ (scripts/uiux/results/web.jsonl ở thư mục gốc): admin-config, admin-flashSales, admin-faqs, admin-contentKit, admin-academy, admin-quickReplies, merchant-1, merchant-2, merchant-3, merchant-5, merchant-ctv. Tính cả hai khung 1440 và 390 thì là 22 lỗi, khớp con số trong PF-4.

Đã làm: đổi h3 thành h2 (giữ nguyên class nên giao diện không đổi) cho tiêu đề form/khối của sáu tab admin trong apps/web/src/app/admin/page.tsx, hai thẻ cấu hình trong apps/web/src/components/admin (gomdon-config-card, loyalty-config-card), và các tiêu đề tab trong apps/web/src/app/merchant/page.tsx (kèm tiêu đề modal đăng sản phẩm). Hai tiêu đề phụ "Mô phỏng Mobile" và "Mô phỏng VietQR khách quét" nâng từ h4 lên h3 để nối tiếp h2. Tên gian hàng trong khung điện thoại mô phỏng là chữ trang trí nên đổi h5 thành `p`. Các test cũ chọn theo `h3` được đổi sang `h2`. Tiêu đề h3 "Cấp / đổi vai trò theo SĐT" ở tab Người dùng giữ nguyên vì đã đứng sau h2.

Test mới (đỏ trước đúng lý do "nhảy cấp h1 -> h3" ở 10 ca, rồi xanh): `thứ bậc heading của các tab` trong admin/page.spec.tsx (8 tab) và merchant/page.spec.tsx (5 tab, cộng một ca kiểm không còn h5). Tab "Quản Lý Sản Phẩm" vốn không có tiêu đề nên đã đạt từ đầu.

Số liệu axe (capture web 1440 normal, các route admin-* và merchant-*, 27 route): trước 11 lỗi `heading-order` (từ web.jsonl cũ), sau 0 lỗi; axe chạy được trên cả 27 route và không báo luật nào khác. Số "trước" lấy từ file kết quả cũ, không chạy lại trên mã cũ. Khung 390: chưa chạy lại (unverified), nhưng cùng mã nguồn nên dự kiến cùng kết quả.

Cách chạy capture: API không chạy sẵn nên dùng máy chủ giả cổng 3001 (chỉ trả `/api/products` và `/api/brands` cho phần mở đầu của script, phần còn lại do ApiRouter mock), `next dev` cổng 3112, rồi tắt đúng các tiến trình đã bật.

## Mục 2: ghim bản đồ /brand-story (miniapp)

Tái hiện được: ở khung bản đồ 328x503 (màn 360px) năm ghim miền Nam (Pơ Lang, Visante, Hector, Le Plateau, Cobote, Sokfarm) có vòng tròn hoặc nhãn đè nhau; test đỏ báo 7 cặp chồng.

Đã làm: thêm `labelSide` (trái/phải) vào BrandOrigin để nhãn tên nằm cạnh vòng tròn thay vì bên dưới, dịch lệch vài ghim, và tách hàm thuần `pinBoxes` trong apps/miniapp/src/utils/brand-origins.ts. Test mới apps/miniapp/src/utils/brand-origins.spec.ts kiểm không cặp nào chồng nhau và mọi ghim nằm trong khung. Không thêm thư viện. Vùng chạm 44px và thuộc tính aria-hidden của ghim giữ nguyên.

Kiểm bằng mắt: capture miniapp `/brand-story` 390px (ảnh docs/2026-10-review/screens/miniapp/brand-story__normal__390.png, thư mục bị gitignore): cả tám ghim và nhãn đọc được, không đè nhau. Còn một điểm nhỏ: ghim Pơ Lang che một phần chữ "Khánh Hòa"/"Lâm Đồng" vẽ sẵn trong SVG bản đồ; đó là chữ trang trí cố định, không nằm trong phạm vi sửa. Hàm `pinBoxes` ước lượng độ rộng nhãn (6px mỗi ký tự cộng 16px), nên đây là kiểm xấp xỉ, đã đối chiếu với ảnh chụp.

## Lệnh đã chạy (exit code thật)

- apps/web: `npx tsc --noEmit` exit 0; `npx vitest run src/app/admin src/app/merchant src/components` exit 0 (32 file, 378 test); `next lint --max-warnings=0` trên các file đổi: sạch.
- apps/miniapp: `npx tsc --noEmit` exit 0; `npx vitest run src/pages/brand-story.spec.tsx src/utils` exit 0 (24 file, 255 test); `npx eslint --max-warnings=0` trên ba file đổi exit 0.
- Gốc: `npm run lint:vars` exit 0; `node scripts/uiux/static-scan.mjs` exit 0 (phải tạo thư mục scripts/uiux/results trong worktree).
- `node scripts/uiux/capture.mjs web --only '^(admin|merchant)-' --vp 1440 --states normal --force` exit 0; `node scripts/uiux/capture.mjs miniapp --only brand-story --vp 390 --states normal --force` exit 0.

## Chưa verify

Playwright e2e và full suite không chạy theo quy định. Capture web khung 390 sau sửa chưa chạy. Chưa kiểm khung bản đồ hẹp hơn 328px (màn dưới 360px). Chưa chạy `next build`.
