# Immersive Product Storytelling Engine (`ProductStoryShowcase`) & Admin Story Studio — Design & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `.claude/skills/tubu-ui/SKILL.md` + `DESIGN.md` + `superpowers:subagent-driven-development`. Use **`sonnet` (`effort: medium`)** for all implementation/worker tasks, **`haiku` (`effort: low`)** for file lookups, and **`opus` (`effort: high`)** ONLY for the single final adversarial review pass.

**Goal:** Nâng cấp trải nghiệm giới thiệu sản phẩm trên cả **Zalo Mini App (`apps/miniapp`, 375px)** và **Website (`apps/web`, responsive 375px -> 1440px)** đạt chuẩn chuyển động Scrollytelling tương tác như 2 video mẫu (Video 1: *CIRO Energy* — vòng cung biến thể 3D + sản phẩm xoay tâm màn hình kèm đường kẻ chỉ điểm thành phần HUD; Video 2: *KAZE Ramen* — nguyên liệu thảo mộc/nông sản tự rơi và lắp ghép từng bước trước mắt người xem), đi kèm **Admin Story Studio + Auto-Asset Pipeline** để quản lý tài nguyên và sinh cấu hình tự động cho hàng loạt sản phẩm.

---

## 1. Quyết định thiết kế đã được Product Owner (anh Long) phê duyệt 100%

1. **Nhóm sản phẩm làm mẫu đầu tiên (Pilot Showcase — đủ cả 3 nhóm ngành hàng chủ lực của Tubu Tree):**
   - **Nhóm 1 — Chăm sóc cá nhân & Mẹ bé thảo dược:**
     - `dau-goi-buoi-po-lang` (*Dầu gội bưởi Pơ Lang* — `p-polang-shampoo`)
     - `serum-duong-am-visante` (*Serum dưỡng ẩm Visante* — `p-visante-serum`) & `kem-duong-ba-bau-visante` (*Kem dưỡng cho mẹ bầu Visante* — `p-visante-cream`)
     - `nuoc-tam-goi-be-cobote` (*Nước tắm gội thảo dược cho bé Cobote* — `p-cobote-wash`)
   - **Nhóm 2 — Thực phẩm & Đồ uống nông sản:**
     - `arabica-cau-dat-le-plateau` (*Cà phê Arabica Cầu Đất Le Plateau* — `p-leplateau-arabica`)
     - `mat-ong-rung-bhnong` (*Mật ong rừng nguyên chất BH.Nong* — `p-bhnong-honey`)
     - `granola-hat-sokfram` (*Granola ngũ cốc hạt Sokfram* — `p-sokfram-granola`) & `bot-rau-ma-sokfram` (*Bột rau má nguyên chất Sokfram* — `p-sokfram-centella`)
   - **Nhóm 3 — Chăm sóc nhà cửa sinh học:**
     - `nuoc-rua-chen-fuwa3e` (*Nước rửa chén sinh học Fuwa3e* — `p-fuwa-dishwash`) & `nuoc-giat-fuwa3e` (*Nước giặt sinh học Fuwa3e* — `p-fuwa-laundry`)
2. **Kiến trúc chuyển động (Hybrid Story Engine — kết hợp cả 2 video trong 1 bộ Engine cấu hình):**
   - Mỗi sản phẩm có thể bật 1, 2 hoặc cả 3 module cảnh (`scenes`) nối tiếp nhau:
     - **Module 1 (`variant_arc` — kiểu Video 1 CIRO `00:00–00:04`):** Vòng cung 3D chọn biến thể / dung tích / mùi hương với quầng sáng nền (`ambient token`) đổi màu mượt mà, sản phẩm đang chọn phóng to `1.22x`, nghiêng `-6deg` và nổi khối trên chữ nền lớn.
     - **Module 2 (`ingredient_assembly` — kiểu Video 2 KAZE Ramen `00:00–00:05`):** Khi người dùng cuộn trang (hoặc vuốt/bấm từng bước `01..05` trên điện thoại), các lớp nguyên liệu tách nền (`vỏ bưởi, bồ kết, hương nhu, lá rau má, hạt cà phê Arabica, giọt mật ong, lát dứa enzyme, hạt granola...`) rơi/bay/rót hoà quyện vào sản phẩm chính theo từng bước câu chuyện (`Bước 1: Tinh tuyển nguyên liệu` -> `Bước 2: Chiết xuất/Lên men` -> `Bước 3: Hoà quyện đa tầng` -> `Bước 4: Tinh chất hoàn thiện` -> `Bước 5: An lành cho cả nhà`).
     - **Module 3 (`hud_callouts` — kiểu Video 1 CIRO `00:05–00:11`):** Sản phẩm ghim ở tâm khung nhìn (sticky spotlight), xoay/zoom nhẹ vào bảng thành phần với **đường kẻ chỉ điểm SVG (HUD leader lines)** nối từ toạ độ `(xPct, yPct)` trên thân chai/hộp ra các thẻ thông số (`2% Tinh dầu vỏ bưởi`, `0% Sulfate & Paraben`, `98% Enzyme sinh học từ dứa`) kèm thanh mức độ và câu thông điệp lớn kết màn.
3. **Vị trí hiển thị trên Mini App (`375px`) & Website (`apps/web`):**
   - **Dải Scrollytelling ngay dưới khối Mua nhanh đầu trang:** Đặt ngay dưới cụm Ảnh + Giá + Chọn phân loại đầu trang (`/san-pham/[slug]` trên Web và `pages/product-detail.tsx` trên Mini App), nâng cấp khu vực *Thành phần & Mô tả sản phẩm* thành trải nghiệm tương tác sống động (vẫn giữ nguyên văn bản HTML ẩn/thu gọn hợp chuẩn SEO và tự động hiển thị trạng thái tĩnh rõ ràng khi trình duyệt bật `prefers-reduced-motion: reduce`).
   - **Nút `"Xem câu chuyện sản phẩm (Full-screen)"` ngay trên khung ảnh đầu trang:** Cho phép khách bấm mở chế độ **Full-Screen Reel / Story Mode (`100dvh`)** toàn màn hình như xem Reel, có thanh chọn phân loại + nút `Thêm vào giỏ / Mua ngay` ghim ở cạnh dưới.
4. **Hệ thống Quản lý Tài nguyên & Bộ Config đầu vào (`Admin › Sản phẩm › Story Studio` + Auto-Asset Pipeline):**
   - **Auto-Asset Pipeline:**
     - Cho phép dán URL sản phẩm từ Website thương hiệu / Sàn TMĐT (hoặc tải ảnh lên) -> trích xuất danh sách ảnh độ phân giải cao, tự động tách nền trắng/trong suốt (Canvas/Sharp alpha cutout) để lấy ảnh chai/hộp tách nền (`cutoutUrl`).
     - Cung cấp sẵn **Thư viện Nguyên liệu Tách nền Chuẩn (`Botanical & Ingredient Sprite Library`)** dạng SVG/WebP trong suốt chất lượng cao (`vỏ bưởi, lát bưởi, quả bồ kết, lá hương nhu, sả chanh, lá rau má, bơ hạt mỡ, hạt cà phê Arabica, giọt mật ong vàng, lát dứa enzyme, hạt điều/granola, lá tràm gió...`) để bất kỳ sản phẩm nào cũng gắn được hiệu ứng rơi nguyên liệu ngay lập tức.
   - **Auto-Generate Story Config (`1-Click Sinh kịch bản`):**
     - Đọc trực tiếp `name`, `brand`, `variations`, `ingredients`, `certifications`, `shortDesc`, `description` của sản phẩm để tự động sinh ra cấu hình JSON `storyConfig` đủ 3 module (`variant_arc`, `ingredient_assembly` 4–5 bước, `hud_callouts` 3–4 điểm chạm).
   - **Visual Story Studio trong Admin (`ProductEditDrawer` / Tab `Story Studio`):**
     - Cho phép bật/tắt `storyConfig`, chỉnh sửa từng bước, click trực tiếp lên ảnh sản phẩm để chấm toạ độ `(xPct, yPct)` cho đường kẻ HUD, chọn nguyên liệu bay từ thư viện hoặc ảnh tải lên, và **Xem trước trực tiếp (`Live Preview 375px Mini App & Desktop`)** ngay trong Admin trước khi Lưu.

---

## 2. Kiến trúc kỹ thuật & Phân bổ File (Tuân thủ tuyệt đối `DESIGN.md` & `tubu-ui`)

1. **`packages/shared-types` & `apps/api/prisma/schema.prisma`:**
   - Thêm cột `storyConfig Json?` vào bảng `Product` trong `apps/api/prisma/schema.prisma` (migration chỉ thêm cột nullable, an toàn 100% với dữ liệu PROD).
   - Định nghĩa kiểu `ProductStoryConfig`, `ProductStoryScene`, `IngredientLayerSprite`, `HudCalloutPoint`, `VariantArcItem` trong `packages/app-core/src/commerce/product-story.ts` (kèm hàm thuần `buildDefaultStoryConfig(product)` + unit test đầy đủ trong `product-story.spec.ts`):
     - Chuẩn hoá bảng màu chủ đề bằng semantic tokens của `packages/design-tokens/src/tokens.css` (không dùng hex trần trong component Mini/Web).
     - Mọi chuỗi giao diện mua sắm đặt trong `packages/app-core/src/shop-copy.ts` (không phạm thuật ngữ cấm của `terminology.spec.ts`).
2. **Thư viện Nguyên liệu & Preset Mẫu (`packages/app-core/src/commerce/story-presets.ts`):**
   - Khai báo bộ sprite nguyên liệu chuẩn (`pomelo-peel`, `gleditsia-pod`, `ocimum-leaf`, `centella-leaf`, `shea-butter`, `arabica-bean`, `honey-drop`, `pineapple-enzyme`, `granola-clusters`, `cajeput-leaf`, `water-droplet`...) và kịch bản mẫu giàu hình ảnh cho **10 sản phẩm chủ lực** thuộc 3 nhóm ngành hàng PO đã chọn, đồng thời tự động fallback sinh kịch bản từ `ingredients` cho mọi sản phẩm khác có `ingredients`.
3. **API & Auto-Asset Pipeline (`apps/api/src/modules/catalog/`):**
   - Cho phép đọc/ghi `storyConfig` trong `public-product.ts`, `product-admin.service.ts`, `product-admin.controller.ts`.
   - Thêm endpoint Admin `POST /api/v1/admin/products/:id/story-assets/extract` nhận URL trang sản phẩm hoặc danh sách URL ảnh -> tải/kiểm tra ảnh an toàn, hỗ trợ tách nền sáng/trắng sang PNG/WebP trong suốt hoặc trả về danh sách ảnh + cấu hình `storyConfig` gợi ý tự động.
4. **Thành phần Giao diện Đồng bộ Mini App & Web (`ProductStoryShowcase`):**
   - Đăng ký `ProductStoryShowcase` trong `docs/design/ds-map.json`, `DESIGN.md`, và `/ds-gallery` của cả 2 app.
   - **Mini App (`apps/miniapp/src/components/ui/product-story-showcase.tsx`):**
     - Thiết kế chuẩn `375px`: có thanh chuyển bước `01..05` + vuốt ngang/cuộn mượt + nút mở **Chế độ Toàn màn hình (`Full-screen Story Sheet`)** kèm thanh Mua ngay ở đáy.
   - **Web (`apps/web/src/components/mini/product-story-showcase.tsx`):**
     - Dưới `md`: cùng cấu trúc và số đo với Mini App `375px` (đảm bảo `pnpm lint:parity` và `ds-parity.shop.spec.ts` xanh 100%).
     - Từ `md`/`lg` trở lên: bố cục Scrollytelling 2 cột (`Sticky Stage` bên phải cố định khi cuộn + cột câu chuyện từng bước và chỉ báo tiến trình `01..05` bên trái) + chế độ Full-Screen Reel Modal.
5. **Admin Story Studio (`apps/web/src/components/admin/product-story-studio.tsx` gắn vào `product-edit-drawer.tsx`):**
   - Giao diện trực quan trong `ProductEditDrawer`:
     - Nút `"⚡ Tự sinh Story từ Thành phần & Mô tả"` (`1-Click Generate`).
     - Ô dán link sản phẩm / URL ảnh để trích xuất tài nguyên + chọn sprite nguyên liệu bay.
     - Khung ảnh tương tác cho phép click chấm điểm `(xPct, yPct)` của các đường chỉ HUD Callouts.
     - Khung **Live Preview** chuyển đổi tức thì giữa chế độ `Điện thoại 375px` và `Máy tính`.
