# Gói P3 ctv: CTV, đại lý, hoa hồng

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói ctv) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## ctv-1 (mục E-110 làm dở ở gói ctv)

Ghi chú của worker: Đã khớp Mini: khung chờ CTV (hero 160, 4 ô, 2 thẻ, cả hai nền), trạng thái rỗng có hình, kiểu chữ mã giới thiệu, bullet điều khoản (Mini không chấm), nút Thêm sản phẩm, nền ô số liệu, màu dòng bậc hiện tại (Tân binh), ô CCCD dùng ô tải một ảnh, thanh nút đáy bước 1 ghim đáy màn hình. Để lại: cỡ chữ tiêu đề thẻ web 18px so Mini 16px (ui.sectionTitle dùng chung toàn web), chiều cao hero/ô lối tắt lệch vài px, khung Tạo bộ sưu tập (web còn bọc thẻ); chưa so ảnh 375px.

Làm nốt phần còn lại nếu không cần chủ quyết.

## ctv-2 (review lượt 1, gói ctv)

File: apps/miniapp/src/pages/storefront-builder.tsx:403 (and apps/web/src/components/affiliate/storefront-builder.tsx:360)

Vấn đề: E-108 moved pin/hide into the ⋯ menu, which removed the only visible pinned marker in each row (the brand-coloured Pin icon). Hidden items still get the 'Khách không thấy: Bạn đang ẩn món này' badge, but pinned items now show nothing. As a result, the first unpinned item has its 'Đưa lên' button disabled for no visible reason: the item above it is pinned, but the CTV cannot see that.

Cách sửa đề xuất: On both platforms, when it.isPinned, show a small Badge ('Đã ghim', with the Pin icon) under the product name, next to the hiddenReason badge. Add one assertion in storefront-builder.spec.tsx and ctv/gian-hang/page.spec.tsx.

## ctv-3 (review lượt 1, gói ctv)

File: apps/miniapp/src/pages/storefront-builder.tsx:266-275 (and apps/web/src/components/affiliate/storefront-builder.tsx:223-232)

Vấn đề: moveColMut and moveItemMut send the full orderedIds and are not serialized. Two quick taps produce two POST /reorder requests in flight; the second already contains the first move. If the server commits the second before the first, the final sortOrder is the first request's order. The second move is lost, and the refresh() in onSuccess silently shows that reverted order.

Cách sửa đề xuất: Add `scope: { id: 'storefront-reorder' }` to both useMutation calls (TanStack Query v5 then runs them in sequence). Alternatively, disable the up/down arrows while moveColMut.isPending || moveItemMut.isPending. Add a test: two quick taps send two requests in order.

## ctv-4 (review lượt 1, gói ctv)

File: apps/api/src/modules/affiliate/affiliate.service.ts:1148

Vấn đề: E-43 only alerts accounting when a whole order is reversed. order-returns.service.ts:463 calls reverseCommissionsForOrder only when shares.isFull. order-reversal.service.ts:497-505 (cited in the item's evidence) skips APPROVED/PAID commissions on partial returns, so a partial return of an order whose commission was already paid is still silent. The worker's report does not mention this gap or hand it off to the api-tin package, which owns those files.

Cách sửa đề xuất: Add to the report: 'cần gói api-tin gọi cảnh báo kế toán ở đường trả một phần khi hoa hồng đã APPROVED/PAID'. Make alertPaidCommissionOfReversedOrder public (keep the per-order dedupeKey, or key it by return request) so api-tin can call it from the partial path.

## ctv-5 (review lượt 1, gói ctv)

File: apps/web/src/components/dealer/dealer-apply.tsx:121-122

Vấn đề: Web CCCD (national ID) photos now go through BrandImageField, which uploads to Cloudinary first (public unsigned preset) before falling back to a data URL. Before, web sent a compressed data URL only. This matches the Mini (ImageUpload), but it changes where ID documents are stored on web. account-deletion.service.ts:431 only blanks the DB URL; the Cloudinary file stays. The report only says 'dùng BrandImageField' and does not mention Cloudinary. A dealer component also now imports from components/brand-owner.

Cách sửa đề xuất: Either keep CCCD out of Cloudinary on web (add a prop such as `upload="inline"` to BrandImageField so it only calls readAndCompressImage, or move the component to a shared components/ folder), or state clearly in the report that web CCCD now goes to Cloudinary like Mini and needs the owner's decision.

## ctv-6 (review lượt 1, gói ctv)

File: docs/2026-10-28-e2e/goi/ctv.md (E-108, E-109, E-110)

Vấn đề: E-108 ('Xong khi: so ảnh 375px') and E-109 ('Xong khi: không tràn ngang ở 375px') are marked done, but no 375px screenshot was taken and no Playwright test checks horizontal overflow on /chu-thuong-hieu. pro.web.spec.ts only checks text and API calls, and the vitest tests only check class names. In E-110, the reason given for leaving 'khung Tạo bộ sưu tập (web còn bọc thẻ)' is weak, since that file belongs to this package. Web First Load was not measured.

Cách sửa đề xuất: Run docs/2026-10-28-review/tools/pw-gate.sh to capture 375px screenshots of /ctv, /ctv/gian-hang, /chu-thuong-hieu and /dai-ly, and compare them with docs/2026-10-28-review/screens. Check document.documentElement.scrollWidth <= clientWidth on /chu-thuong-hieu at 375px. Until then, set E-108 and E-109 to partial (unverified). Measure web First Load with next build or record the reason.

## ctv-7 (review lượt 2, gói ctv)

File: packages/app-core/src/queries/affiliate.ts:17

Vấn đề: /ctv/gian-hang nặng thêm khoảng 3,1 KB gz (167,1 lên 170,2 KB, cùng cách đo), vượt trần 2 KB mà không ghi lý do. Chunk gốc 18,4 KB nay còn 14,7 KB, nhưng trang phải tải thêm chunk dùng chung 7058 (6,7 KB, chứa chữ của ctv-dashboard như 'Tổng quan', 'Hoa hồng', 'Số dư Ví Tubu'). Tôi nghi do queries/affiliate.ts nay import AFFILIATE_PAGE_SIZE từ '../ctv-dashboard', mà storefront-signup.tsx của trang gian hàng lại import queries/affiliate, nên trang này kéo theo cả module ctv-dashboard. Đây là suy luận từ nội dung chunk, chưa dựng lại để chứng minh.

Cách sửa đề xuất: Chuyển AFFILIATE_PAGE_SIZE và affiliateNextCursor sang một module nhỏ riêng (ví dụ packages/app-core/src/affiliate-page.ts), để queries/affiliate.ts và hai trang import từ đó; ctv-dashboard.ts có thể re-export để giữ test. Build lại, ghi First Load của /ctv/gian-hang trước và sau.

## ctv-8 (review lượt 2, gói ctv)

File: apps/miniapp/src/pages/storefront-builder.tsx:260

Vấn đề: Lỗi đổi thứ tự khi bấm liên tiếp. onError chỉ trả lại `ctx.previous`, không tải lại từ máy chủ. Nếu bấm hai lần liên tiếp và cả hai yêu cầu đều lỗi: lần 1 lỗi đưa màn về S0, lần 2 lỗi lại đưa màn về S1 (ảnh chụp lạc quan lúc bấm lần 2). Kết quả màn hiện thứ tự S1 trong khi máy chủ vẫn là S0, và không có lần tải lại nào để khớp. Web bị y hệt ở apps/web/src/components/affiliate/storefront-builder.tsx:217. Ca hẹp, nhưng CTV sẽ thấy thứ tự sai cho tới lần tải sau.

Cách sửa đề xuất: Ở onError của cả hai nền: sau khi trả lại ảnh cũ, nếu `qc.isMutating({ mutationKey: STOREFRONT_REORDER_MUTATION.mutationKey }) <= 1` thì gọi refresh(). Hoặc chuyển phần tải lại sang onSettled với cùng điều kiện. Sửa test 'máy chủ từ chối…' cho phép tải lại sau khi lỗi, và thêm ca 'hai lần liên tiếp đều lỗi thì cuối cùng tải lại gian hàng'.

## ctv-9 (review lượt 2, gói ctv)

File: apps/web/src/components/affiliate/storefront-sheets.tsx:387

Vấn đề: Web và Mini lệch nhau ở nút gỡ đăng trong Cài đặt. Mini hiện câu nhắc `vi.storefront.unpublishHint` ('Khách mở link gian hàng sẽ không thấy gì cho tới khi bạn đăng lại.') phía trên nút (apps/miniapp/src/pages/storefront-builder.tsx:1059-1062). Web chỉ có nút, không có câu nhắc và không có biểu tượng EyeOff.

Cách sửa đề xuất: Trong khối `unpublishLabel &&` của ConfigForm, thêm `<p className="mb-2 text-xs text-stone-600">Khách mở link gian hàng sẽ không thấy gì cho tới khi bạn đăng lại.</p>` và biểu tượng EyeOff trong nút. Thêm một assert vào spec ctv/gian-hang/page.spec.tsx.

## ctv-10 (review lượt 2, gói ctv)

File: apps/web/src/components/brand-owner/brand-image-field.tsx:57

Vấn đề: Nhãn cho trình đọc màn hình bị lặp chữ. Ô CCCD truyền label 'Ảnh CCCD mặt trước *' (dealer-apply.tsx:121-122), mà BrandImageField lại ghép thêm và hạ chữ thường: aria-label thành 'Chọn ảnh ảnh cccd mặt trước *', nút thành 'Tải ảnh ảnh cccd mặt trước * lên', alt thành 'Ảnh ảnh cccd mặt trước *' (dòng 57, 64, 72). Test dai-ly mock component nên không bắt được.

Cách sửa đề xuất: Ở dealer-apply.tsx truyền label 'CCCD mặt trước *' và 'CCCD mặt sau *'. Hoặc thêm prop `noun` cho BrandImageField và bỏ toLowerCase cho chữ viết tắt. Thêm test thật (không mock) kiểm aria-label 'Tải ảnh CCCD mặt trước lên'.

## ctv-11 (review lượt 2, gói ctv)

File: apps/api/src/modules/affiliate/affiliate.service.ts:138

Vấn đề: Câu lỗi không đúng ngữ cảnh. register() trả REAL_USER_REQUIRED_MSG ('Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo…'), nhưng đăng ký CTV không phải ưu đãi. Mini đã chặn trước bằng ensurePhone nên câu này chỉ lộ ra khi dữ liệu user ở máy khách cũ hơn máy chủ, hoặc khi client cũ gọi.

Cách sửa đề xuất: Ném `new BadRequestException('Cần liên kết Zalo hoặc số điện thoại để đăng ký CTV. Bạn bấm Đăng ký lại và cho phép dùng số điện thoại nhé.')` (hoặc đặt một hằng riêng trong affiliate.service.ts). Cập nhật affiliate-terms.spec.ts cho khớp.

## ctv-12 (review lượt 2, gói ctv)

File: apps/miniapp/src/pages/storefront-builder.tsx:915

Vấn đề: Có comment kể lại thay đổi, trái luật của brief: '(không còn nằm ngoài trang chính)' trong doc của prop unpublishLabel. Bản web cũng có ở apps/web/src/components/affiliate/storefront-sheets.tsx:251.

Cách sửa đề xuất: Bỏ cụm '(không còn nằm ngoài trang chính)' ở cả hai chỗ; giữ phần giải thích prop.

## ctv-13 (review lượt 3, gói ctv)

File: apps/api/src/modules/affiliate/affiliate.service.ts:1146-1152

Vấn đề: Hàm alertPaidCommissionOfReversedOrder đã thành public và có tham số returnRequestId. Doc comment ghi rằng đường trả một phần sẽ gọi thẳng hàm này, nhưng trên nhánh này không có chỗ nào gọi. Hai worktree e2e-api-tin và e2e-admin-don cũng không gọi. order-reversal.service.ts:505 (reversePartialReturn) chỉ cắt hoa hồng PENDING/LOCKED. Vì vậy, khi đơn có hoa hồng đã duyệt hoặc đã chuyển vào Ví mà khách trả một phần, kế toán vẫn không được báo. Báo cáo lượt 2 không giao lại việc này cho gói giữ orders/**. Phạm vi E-43 (cuối reverseCommissionsForOrder) đã làm đúng, nên đây không phải lỗi chặn merge.

Cách sửa đề xuất: Thêm vào báo cáo và backlog dòng: 'cần gói api-tin (chủ order-returns.service.ts, sau đó admin-don) gọi this.affiliate.alertPaidCommissionOfReversedOrder(order.id, order.code, { returnRequestId: id }) sau khi transaction duyệt trả một phần commit xong (nhánh không trả cả đơn, gần dòng 466), đặt ngoài tx'. Nếu chưa ai nhận việc trong đợt này thì sửa câu cuối doc comment thành 'dành cho đường trả một phần ở order-returns.service.ts', để không hứa một lời gọi chưa có. Không đổi logic.

## ctv-14 (còn lại trong báo cáo cuối 29/10)

Báo kế toán khi trả một phần (OrderReturnsService gọi affiliate.alertPaidCommissionOfReversedOrder ở nhánh không trả cả đơn) vẫn gửi cả khi các dòng bị trả không có hoa hồng (tỉ lệ 0% hoặc không có commission APPROVED/PAID liên quan). Chỉ gửi khi phần bị trả thật sự đụng hoa hồng đã duyệt/vào Ví; giữ nguyên hành vi khi có. Không trừ Ví, không đổi luật hoa hồng. Có test.
