# Gói P3b ctv-ref: Ghi công CTV, CSP, comment E-43, trang CTV web 375

Gốc: main 2ca045580. Nguồn: P3 ở lượt review cuối các gói đợt P3 29/10 (docs/2026-10-29-p3, đã merge PR #75 và deploy), mục làm dở, và vài mục còn lại trong báo cáo.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (đường dẫn worktree p3-* trong mô tả cũ đã xoá, đọc ở worktree của gói này; dòng có thể lệch). Đã hết thì skipped + bằng chứng file:dòng. Mục cần chủ quyết (giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ.

## muahang-r1

File: apps/miniapp/src/hooks/use-referral-touch.ts:18,24,32

Vấn đề: Mini nhớ 'mã đã chạm như CTV' bằng useRef, nên WebView tải lại (back-forward, khôi phục phiên) là mất dấu. Trong khi đó ngữ cảnh tubu_sf_ctx vẫn còn trong sessionStorage với kind 'partner' và mã CTV. Sau khi tải lại, hook chạm kiểu brand, và máy chủ upsert cả dòng (affiliate.service.ts recordTouch: storefrontSlug = dto.storefrontSlug ?? null) nên slug gian hàng CTV bị xoá khỏi chạm. Web đã sửa đúng lỗ này ở R1-1 (chuyển sang sessionStorage), Mini thì chưa, nên hai nền lệch nhau. Hoa hồng không đổi, chỉ mất combo/storefrontSlug ở nhánh fallback khi phiên mất về sau.

Cách sửa đề xuất: Giữ dấu trong sessionStorage như web: thêm trường ctvTouched vào store storefront-context của Mini (persist cùng tubu_sf_ctx, xoá trong clear()), hoặc dùng khoá riêng 'tubu_sf_ctv_touched'. Hook đọc và ghi dấu qua store thay cho useRef. Thêm ca vào use-referral-touch.spec.tsx: chạm ctv ok:true, unmount, renderHook lần mới (giả lập tải lại), setContext partner cùng mã thì touch không được gọi thêm.

## muahang-r2

File: apps/web/src/lib/storefront-context.ts:17,218-235; apps/web/src/lib/auth-context.tsx:214-226

Vấn đề: Khoá tubu_web_ctv_touched không bị xoá khi đăng xuất. clearStorefrontContext chỉ được gọi trong test, không có chỗ gọi nào ở mã chạy thật. Trong khi đó dòng chạm trên máy chủ là theo từng người dùng. Ca máy dùng chung, cùng tab: người A chạm CTV AN123, đăng xuất, người B đăng nhập khi đang ở gian hàng đối tác mang mã AN123. Lần chạm brand của B bị bỏ qua, nên B không có dòng chạm nào cho mã này. Hẹp vì đơn vẫn mang mã từ ngữ cảnh tab.

Cách sửa đề xuất: Trong logout của auth-context gọi một hàm mới clearCtvTouched() (sessionStorage.removeItem(CTV_TOUCHED_KEY)), hoặc lưu dấu kèm user id (`${userId}:${code}`) rồi so khi đọc. Thêm ca test: markCtvTouched, logout, wasCtvTouched trả false.

## muahang-r3

File: apps/web/src/components/storefront-tracker.tsx:73-76; apps/miniapp/src/hooks/use-referral-touch.ts:24,32

Vấn đề: Dấu chỉ được đặt sau khi lần chạm ctv trả ok:true. Nếu khách sang gian hàng đối tác khi POST chạm ctv còn đang chạy, một lần chạm brand vẫn được gửi, và máy chủ có thể xử lý nó sau, xoá slug CTV. Cửa sổ cỡ vài trăm ms, cả hai nền đều có.

Cách sửa đề xuất: Đặt dấu ngay trước khi gửi chạm ctv; gỡ dấu khi máy chủ trả ok:false hoặc lỗi từ chối hẳn. Hoặc xếp các lần chạm vào một chuỗi promise duy nhất để lần chạm brand đợi lần chạm ctv xong rồi kiểm dấu.

## muahang-r4

File: apps/web/next.config.mjs:46-57

Vấn đề: Mục muahang-18 (CSP Report-Only thiếu media-src cho video Cloudinary và blob:) giao cho gói dondep, nhưng đợt P3 này không có gói dondep (tools/groups.json chỉ có 8 gói, và grep 'media-src' trong goi/*.md chỉ thấy muahang.md). Nếu chỉ ghi vào báo cáo gói thì mục này dễ mồ côi khi chuyển CSP sang chế độ chặn.

Cách sửa đề xuất: Ghi vào PROGRESS hoặc backlog của đợt (mục chờ chủ hoặc gói sau): thêm "media-src 'self' blob: https://res.cloudinary.com" vào cspReportOnly trước khi bật chặn thật.

## e43-comment

**BỎ khỏi đợt này: phiên b4 đang sửa affiliate.service.ts dòng 1468–1565 (nhánh review/1028c-ctv-vi), comment này nằm ngay dưới. Không sửa; nếu worktree đã sửa chỗ này thì trả lại như gốc 2ca045580. Báo cáo ghi skipped.**

File: apps/api/src/modules/affiliate/affiliate.service.ts (khoảng dòng 1606)

Vấn đề: Comment cũ còn ghi hoa hồng APPROVED là "không đảo được", trong khi E-43 (đã merge, docs/2026-10-29-p3/goi/e43-vi-ctv.md) đã đảo và cắt cả APPROVED/PAID.

Cách sửa đề xuất: Sửa comment theo hành vi hiện tại (nói vì sao, không kể chuyện thay đổi). grep thêm comment khác trong affiliate/ và orders/ còn nói "không đảo được" hoặc "chỉ báo kế toán, không trừ Ví".

## ctv-1

**BỎ khỏi đợt này: phiên b4 đang sửa apps/web/src/app/ctv/page.tsx và apps/miniapp/src/pages/affiliate.tsx (nhánh review/1028c-ctv-vi). Không sửa; nếu worktree đã sửa chỗ này thì trả lại như gốc 2ca045580. Báo cáo ghi skipped.**

File: apps/web (trang CTV / hoa hồng, khổ 375) so với apps/miniapp (trang CTV)

Vấn đề: Mục ctv-1 đợt trước làm một phần: thẻ hoa hồng web 375 đã khớp Mini (tiêu đề 16px, số 32px, chữ phụ 13px, cao 248px), phần còn lại của trang CTV web 375 chưa so ảnh với Mini.

Cách sửa đề xuất: Chụp ảnh 375px cùng dữ liệu mock hai nền (Playwright, xem apps/e2e), sửa phần web còn lệch giao diện so với Mini (khoảng cách, cỡ chữ, thứ tự khối). Không đổi chức năng, không đổi chữ pháp lý. Ghi ảnh trước/sau vào checks.

