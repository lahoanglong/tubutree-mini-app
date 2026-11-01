---
name: tubu-ui
description: Use before creating or changing any screen, component or style in apps/miniapp or apps/web of Tubu Tree (shop, product, cart, vouchers, flash sale, storefront). Gives the shop design-system rules, which existing component to reuse for each need, where copy and shelves are declared, and the checks that prove the new UI matches both the Mini App and the web.
---

# tubu-ui: làm giao diện mua sắm Tubu Tree

Làm đúng thứ tự dưới đây. Luật đầy đủ ở `DESIGN.md` (gốc repo); file này là lối vào.

1. **Đọc `DESIGN.md`**: mục Thành phần (cần gì thì dùng gì), Luật kệ, Luật nhãn và giá, Chữ chuẩn, Khuôn trang web.
2. **Tra `docs/design/ds-map.json`**: thành phần đã có thì dùng, KHÔNG dựng thẻ, tiêu đề, nhãn, giá hay phiếu mới. Thiếu biến thể thì thêm biến thể vào thành phần có sẵn ở cả hai app, không tạo file song song. Tên trong mục `upcoming` là việc gói khác đang làm: đừng dựng bản riêng, hỏi người giao việc.
3. **Logic** (giá, nhãn, chữ đếm ngược, tổng combo, bố cục khối) viết ở `packages/app-core/src/commerce/` kèm spec; app chỉ vẽ.
4. **Kệ hàng** khai ở `packages/app-core/src/merch/shelves.ts` (trần, sàn, hạng chống trùng, "Xem tất cả"); route mới khai ở `packages/app-core/src/route-map.json`.
5. **Chữ** lấy từ `packages/app-core/src/shop-copy.ts` (`fillCopy`), thêm khoá mới ở đó kèm ngân sách độ dài; không viết chữ thẳng trong mã. Không dùng thuật ngữ cấm (Nhãn hàng, Top, Freeship, Kho voucher, Flash sale, "Vui lòng"...): bảng ở `DESIGN.md`.
6. **Làm Mini ở 375px trước**, rồi web cùng nhánh, cùng tên thành phần, cùng props. Web dưới `md` phải ra cùng số đo với Mini; từ `lg` dùng khuôn trong `apps/web/src/components/layouts/`.
7. **Chỉ dùng token** semantic/component: không hex, không `var(--stone-…)`, không `fontSize` số, không lề âm ngang tay, giá gạch chỉ qua `PriceTag`. Thành phần mới có màu mới thì thêm cặp vào `apps/miniapp/src/css/contrast.spec.ts`, có nút mới thì thêm vào `apps/miniapp/src/components/ui/hit-target-guard.spec.tsx`.
8. **Kiểm trước khi báo xong, dán output:**
   - `pnpm lint:parity` (route, thành phần Mini ↔ web, bánh cóc px và `max-md:` so `scripts/uiux/ds-baseline.json`: chỉ được giảm, sửa mã chứ không nới baseline; sửa bớt mã cũ thì `node scripts/uiux/ds-ratchet.mjs --write`), `pnpm lint:vars`
   - `pnpm --filter @tubutree/app-core test` (có `terminology.spec`, `shop-copy.spec`, `shelves.spec`, `design-docs.spec`)
   - `pnpm --filter @tubutree/miniapp test` và `pnpm --filter @tubutree/web test` (có `ds-shop-guard.spec` mỗi app)
   - Màn mua sắm đổi hình: `apps/e2e/tests/ds-parity.shop.spec.ts` (số đo 375px so bảng chuẩn) và `apps/e2e/tests/a11y-shop.miniapp.spec.ts`, `apps/e2e/tests/a11y-shop.web.spec.ts` (axe, serious/critical chặn)
   - Thành phần mới: thêm vào `docs/design/ds-map.json`, vẽ trong `/ds-gallery`, ghi vào mục Thành phần của `DESIGN.md`.
9. **Chụp so 375px Mini ↔ web** màn đã đổi: `apps/e2e/tests/visual-tour.miniapp.spec.ts` và `apps/e2e/tests/visual-tour.web.spec.ts` (chạy khi có `VISUAL_DIR`), rồi `node apps/e2e/scripts/visual-pairs.mjs <VISUAL_DIR>` ghép cặp. Cách dựng API giả và cổng ở `docs/2026-10-31-shop-redesign/plans/handoff-wave2.md`. Chụp cả trạng thái chờ, rỗng, lỗi, hết hàng.
