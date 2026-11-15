# Rà 13 SKU còn thiếu bảng thành phần (15/11/2026)

**Kết luận: trong repo không có văn bản thành phần thật của nhà sản xuất cho bất kỳ SKU nào trong 13 SKU này. Cả 13 phải xin nhãn hàng.**

Không một thành phần nào trong tài liệu này được suy đoán, đoán từ sản phẩm tương tự, hay lấy từ mô tả marketing. Cả 13 dòng giữ trống cho tới khi có chữ INCI/thành phần do nhà sản xuất cung cấp hoặc do người đã đọc trực tiếp bao bì xác nhận.

## Cách lấy danh sách 13

Chưa đọc PROD. Danh sách là phép trừ trong repo: trong 111 SKU nhà (`apps/api/src/modules/catalog/prod-house-skus.fixtures.ts`), lấy SKU mà bảng chữ dự phòng (`packages/shared-types/src/product-copy-fallback.ts`) không có dòng thành phần nào. Kết quả đúng 13, khớp spec `catalog-copy-enrichment-prod111.spec.ts` ("13 SKU không có nguồn thành phần để trống") và ghi nhớ W160 (PƠ LANG 6, Fuwa3e 6, Visante 1). Báo cáo `/tmp/tubu-w160-report.md` không còn nên không đối chiếu được bản gốc.

Mã Pancake không nằm trong repo. Cột SKU dùng slug đầy đủ; 6 ký tự cuối slug là mã băm Pancake.

## Bảng 13 SKU

| STT | SKU (slug) | Tên | Nhãn hàng | Nguồn thành phần trong repo |
|---|---|---|---|---|
| 1 | `combo-sach-diu-nhe-po-lang-srm-tt-757657` | Combo sạch dịu nhẹ PƠ LANG (SRM & TT) | PƠ LANG | không có |
| 2 | `dau-u-toc-po-lang-50ml-867391` | Dầu ủ tóc PƠ LANG 50ml | PƠ LANG | không có |
| 3 | `mat-na-ngu-po-lang-30g-7a51db` | Mặt nạ ngủ PƠ LANG 30g | PƠ LANG | không có |
| 4 | `nuoc-tay-trang-po-lang-300ml-97f185` | Nước tẩy trang PƠ LANG 300ml | PƠ LANG | không có |
| 5 | `son-duong-co-mau-po-lang-a01-a03-a04-a05-ef066b` | Son dưỡng có màu PƠ LANG (A01, A03, A04, A05) | PƠ LANG | không có |
| 6 | `sua-rua-mat-tao-bot-po-lang-150ml-f15f0c` | Sửa rửa mặt tạo bọt PƠ LANG 150ml | PƠ LANG | không có |
| 7 | `gel-rua-chen-cho-may-fuwa3e-2000ml-ea1def` | Gel rửa chén cho máy Fuwa3e 2000ml | Fuwa3e | không có |
| 8 | `lau-noi-that-o-to-fuwa3e-300ml-b202d9` | Lau nội thất ô tô Fuwa3e 300ml | Fuwa3e | không có |
| 9 | `nuoc-rua-chen-fuwa3e-100ml-c1337b` | Nước rửa chén Fuwa3e 100ml | Fuwa3e | không có |
| 10 | `refill-nuoc-rua-tay-dang-bot-fuwa3e-10l-ab8688` | Refill Nước rửa tay dạng Bọt Fuwa3e 10L | Fuwa3e | không có |
| 11 | `xit-khu-mui-o-to-fuwa3e-150ml-f33f4a` | Xịt khử mùi ô tô Fuwa3e 150ml | Fuwa3e | không có |
| 12 | `xit-thom-huong-xuan-fuwa3e-300ml-ff93d6` | Xịt thơm hương Xuân Fuwa3e 300ml | Fuwa3e | không có |
| 13 | `tay-te-bao-chet-da-dau-thao-duoc-visante-lam-sach-nhe-nhang-150g-4500ef` | Tẩy Tế Bào Chết Da Đầu Thảo Dược VISANTE Làm Sạch Nhẹ Nhàng 150g | Visante | không có |

Không dòng nào ở trạng thái "có, trích nguyên văn", nên không có đoạn trích nào kèm đường dẫn nguồn.

## Đã tìm ở đâu

- Mọi tệp trong repo (trừ `node_modules`, `.git`, build) tìm các từ INCI điển hình (aqua, glycerin, sodium laureth, tocopherol, parfum, phenoxyethanol, citric acid, v.v.): chỉ một lần khớp, là chuỗi mẫu trong `packages/app-core/src/commerce/product-copy-fallback.spec.ts`, không thuộc SKU nào.
- Tên 13 SP trong `docs/**`, `scripts/**`, `apps/api/prisma/**`, fixture và spec: chỉ gặp tên, giá, slug, bảng ảnh WordPress (`apps/api/src/modules/catalog/wp-image-sync.core.ts`), bảng chuyển hướng (`apps/web/src/lib/legacy-wp-redirects.ts`) và chữ dự phòng dựng từ tên. Không có chữ thành phần của nhà sản xuất.
- `apps/api/prisma/seed.ts` và migration demo có sản phẩm Visante và thành phần mẫu, nhưng đó là dữ liệu demo khác slug (ví dụ `nuoc-tay-trang-rau-ma-visante`), không phải 13 SKU này.
- Repo không chứa bản sao nội dung WordPress. `scripts/ops/wp-public-export.mjs` xuất ra thư mục sao lưu trên máy chủ, không vào repo.

## Chủ cần làm

1. **Xin từng nhãn hàng bảng thành phần (INCI) kèm ảnh chụp rõ mặt sau bao bì, cho đúng từng SKU và từng quy cách.** Không dùng bảng của quy cách khác hay sản phẩm tương tự.
   - **PƠ LANG (6 SP):** xin bảng thành phần của từng SP. Combo SRM & TT (dòng 1) gồm sữa rửa mặt và nước tẩy trang (theo ghi chú trong `wp-image-sync.core.ts`): xin hai bảng riêng, đừng gộp. Son có màu (dòng 5) có 4 mã màu: hỏi nhãn hàng bốn mã chung một bảng hay mỗi mã một bảng.
   - **Fuwa3e (6 SP):** xin bảng thành phần từng SP. Bản 2000ml (dòng 7) và 100ml (dòng 9) cần xác nhận riêng, đừng chép từ bản 500ml. Ảnh Nước rửa chén Fuwa3e 100ml trên PROD đang ghi "VỆ SINH BỒN CẦU" (theo ghi nhớ W160), tức ảnh của hàng khác: không dùng ảnh đó làm nguồn.
   - **Visante (1 SP):** xin bảng thành phần Tẩy tế bào chết da đầu 150g (dòng 13).
2. **Ảnh trên PROD không giúp được.** Theo ghi nhớ W160 (chưa đọc lại PROD): 9 SP chỉ có ảnh banner nên OCR không đọc được nhãn, 4 SP chưa có ảnh. Đối chiếu ảnh chụp catalog 12/11 trong `packages/app-core/src/commerce/prod-catalog-full.fixture.ts`, SP chưa có ảnh nhiều khả năng là dòng 1, 10, 11, 12; dòng 8 là một trong 4 SP được nạp ảnh WordPress loại EXACT sau đó (suy ra, chưa kiểm PROD). Cần ảnh mặt sau thật hoặc bảng thành phần dạng chữ.
3. **Trang WordPress cũ để chủ mở xem** (có mục thành phần do nhãn hàng viết không thì chủ tự kiểm, repo không chứa nội dung): `/product/dau-u-toc-bo-po-lang-50ml/`, `/product/mat-na-ngu-po-lang/`, `/product/nuoc-tay-trang-po-lang/`, `/product/son-duong-moi-co-mau-bo-tuoi-po-lang/`, `/product/sua-rua-mat-tao-bot-rau-ma-po-lang/`, `/product/tay-te-bao-chet-da-dau-thao-duoc-visante/`, và `xit-ve-sinh-noi-that` (WooCommerce 7022) cho dòng 8. Chỉ coi là nguồn khi đó là chữ nhãn hàng cung cấp.
4. **Nạp vào hệ thống** sau khi có nguồn thật và chủ đã đọc đối chiếu bao bì:
   - **Cách khuyên dùng (đã có sẵn, không cần mã mới):** Admin → Bán hàng → **Kiểm tra catalog** → khối **Bổ sung thành phần**. Khối này chỉ liệt kê SP đang bán mà cột thành phần còn trống (đúng 13 SP này nếu PROD chưa đổi), có thanh "Đã đủ thành phần X/111 sản phẩm". Mỗi SP: gõ mỗi dòng một thành phần, hoặc thả ảnh mặt sau để AI đọc ra bản nháp, xem lại rồi bấm **Lưu thành phần**. AI không tự lưu.
   - **Cách thay thế cho cả loạt:** `scripts/ops/backfill-w160-seo-ingredients.ts` (lõi ở `apps/api/src/modules/catalog/seo-backfill.cli.ts`) với `--verified-file=<json|->`, tệp dạng `{"<slug>": ["tên thành phần", ...]}`. Mặc định là dry-run, `--apply` mới ghi, chỉ điền ô đang trống. Chỉ chạy khi chủ duyệt rõ; trên PROD chạy bản `dist/` trong container api và chạy `bash ops/backup-predeploy.sh` trước (deploy không có migration không tự sao lưu). Tài liệu này không chạy lệnh nào trên PROD.
   - `/admin/catalog-wp-images` là màn bổ sung ảnh sản phẩm hàng loạt, dùng khi cần thêm ảnh mặt sau; luồng thành phần nằm ở Kiểm tra catalog như trên.
5. **Giới hạn cần chủ quyết trước khi nạp bảng INCI dài.** Lưu thành phần qua Admin có trần 8 tên mỗi SP và 80 ký tự mỗi tên, chặn công dụng y tế và chứng nhận (xem `ingredient-enrich.service.ts`, `COPY_INGREDIENTS_MAX` trong `ai-advisor/copy-draft.ts`). Quá 8 tên thì máy chủ trả lỗi 400, không cắt lặng lẽ. Bảng INCI mỹ phẩm thường dài hơn 8: chủ quyết nâng trần hay chỉ ghi 8 thành phần đầu, rồi mới nạp.

## Bộ lọc "Thiếu thành phần" trong Admin

Đã có, không thêm gì. Màn Admin → Bán hàng → Kiểm tra catalog đã lọc đúng các SP đang bán có `ingredients` trống (`hasIngredients` từ `catalog-audit.service.ts`, danh sách `missingIngredients` ở `apps/web/src/app/admin/catalog-quality-tab.tsx`, hiển thị bởi `catalog-ingredients-fill.tsx`). Thêm huy hiệu ở màn "Sản phẩm" sẽ trùng chức năng.

## Ghi chú ngoài phạm vi 13

- 98 SKU còn lại "có thành phần" theo bảng chữ dự phòng (`product-copy-fallback.ts`), nhưng các dòng đó dựng từ tên sản phẩm hoặc chữ in trên bao bì ("Theo tên sản phẩm", "Theo chữ in trên bao bì"), không phải bảng INCI của nhà sản xuất. Muốn thành phần đầy đủ cho các SP này cũng cần nguồn nhãn hàng.
- Tên SKU dòng 6 trên PROD ghi "Sửa rửa mặt" (có vẻ là "Sữa rửa mặt"); chủ quyết có sửa tên ở Pancake không.
