# PG-7: đo lại axe web khách ở khung 390px

Kết quả: cả 36 route web ở 390px, trạng thái normal, có 0 vi phạm axe ở mọi mức (critical 0, serious 0, moderate 0, minor 0). Không sửa mã nguồn nào, vì không có gì để sửa. Mục 2 của báo cáo 99 ghi "khung 390px của web chưa đo lại sau PG-3": nay đã đo, kết quả sạch.

Cách đo: máy chủ API giả cổng 3001 (chỉ trả `/api/products`, `/api/brands` và `/api/products/:slug` đúng hình dạng `ProductCard`/`ProductDetail` của `apps/web/src/lib/api.ts`), `next dev` cổng 3112 với `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api`, rồi `node scripts/uiux/capture.mjs web --vp 390 --states normal --force` (exit 0). Axe chạy các tag wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa và best-practice.

Bằng chứng từ `scripts/uiux/results/web.jsonl` (file bị gitignore): 36 dòng, cả 36 có mảng `axe` rỗng, không dòng nào `fail`, không route nào tràn ngang, không có PAGEERROR, mỗi route đúng 1 h1 và có `main`, không route nào bị chuyển hướng.

Lưu ý phương pháp: lần đo đầu dùng máy chủ giả trả sai hình dạng sản phẩm (thiếu `basePrice`, `brand` là object) nên 4 route (home, san-pham, gio-hang, thanh-toan) rơi vào trang lỗi và dev overlay `nextjs-portal` của Next gây 5 vi phạm serious và 4 moderate (color-contrast, document-title, region). Đó là nhiễu của phép đo, không phải lỗi của web; đã sửa máy chủ giả và đo lại, kết quả 0. Số "trước" thật sự không có vì mã nguồn không đổi từ PG-3.

Lệnh kiểm trong phạm vi: `npm run lint:vars` exit 0; `node scripts/uiux/static-scan.mjs` exit 0. Không chạy tsc, vitest, eslint vì không sửa file mã nguồn. Playwright e2e và full suite không chạy theo đúng phạm vi. Chỉ đo trạng thái normal, các trạng thái khác (empty, error, long) và khung 1440 mới (sau PG-3) cho toàn 36 route: unverified (1440 đã đo ở PG-3 chỉ cho 27 route admin và merchant).

Dữ liệu là mock từ ApiRouter, nên nội dung thật (ảnh sản phẩm thật, chữ dài) chưa được axe kiểm.
