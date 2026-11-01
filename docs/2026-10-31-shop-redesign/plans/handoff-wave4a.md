# Bàn giao đợt 4a (P11 chiến dịch, P12 Giờ vàng theo khung, P13 Bán chạy nhất, F3 sửa sau đợt 3)

Gộp vào nhánh tích hợp (base gói 77433c0d0), theo thứ tự: F3 bd15071b6 → 266bb4262, P13 1910c4e9a → 4f43289df, P11 edfab8faf → f7607c356, F4 (sửa lỗi nhỏ sau review của P11/P13/F3) → ee67364bf, P12 c516b4998 → 1f11cc35a, rồi main 6f4fd6733 (#96). Review: F3, P13, P11 APPROVE lượt 1; P12 APPROVE lượt 3 (lượt 1 hai MAJOR: thanh "Vừa mở bán" ở khung chưa mở, tab khung giờ chưa dính; lượt 2 làm lại §4 Q14 vốn bị hoãn).

Máy khởi động lại lúc ~08:32 làm chết workflow giữa review P12 và xoá sạch `/private/tmp` (scratchpad, API giả cũ); workflow chạy tiếp bằng resume.

Xung đột khi gộp, đã gỡ:
- `apps/web/src/components/mini/mini.css` (F3 + P13): giữ cả khối `.tubu-bleed*` của F3 và luật tablist của P13.
- `apps/miniapp/src/components/app.tsx` (P13 + P11): giữ cả route `/best-sellers` và `/campaign/:slug`.
- `packages/app-core/src/merch/route-fallback.ts` + spec, `route-map.json`, `home-shelves.spec.ts`, `shelves.spec.ts` (P12 + P13): `/flash-sale` và `/best-sellers` đều `pending: false`, `PENDING_TARGET` chỉ còn `/vouchers`; câu đầu chú thích chỉ còn `/vouchers` P14; `PLANNED_ROUTES` trong `shelves.spec.ts` đã bỏ hẳn vì không còn route nào chờ.

Sửa thêm trên nhánh tích hợp sau khi gộp:
- 97f7fb00f: chip mã ở chân dính giỏ web điện thoại `text-[11px]` → `text-caption` (guard C-116 không cho chữ dưới 12px; gate của F3 bị máy khởi động lại cắt ngang nên lọt).
- ea6df8ed9: khung dấu logo Trang chủ 26 → 20px ở cả hai app (c2 thấy logo bị cắt chữ trên PROD): dấu hết ở cột 58/249 của ảnh, chữ bắt đầu ở cột 63; 26px lộ một dải chữ "T"/"S". Test giải nén PNG và kiểm mép khung nằm trong khe trống.
- 69f0e89c2 (cùng nội dung với hotfix PR #99 vào main): khung chờ "Quà khách mới" web bỏ `pb-3`. #95 chuyển lề giữa khối ra vỏ khối nhưng quên khung chờ, nên khung chờ cao 76px so với dải thật 64px; khách có phiên trên máy mới thấy các khối nhảy 12px rồi trả lại (main đỏ `profile-calls.web.spec.ts:62`, CLS 0,0227).
- F5 (sửa lỗi nhỏ sau review P12): món hết hàng ở khung sắp mở hiện dòng "Hết hàng" (`flash.outOfStock` trong `shop-copy.ts`) và nút "Nhắc tôi" khoá có `aria-describedby` tới dòng đó, hai app; `generateSlots` chỉ tạo khung có `start > now`, không tạo đợt LIVE rỗng.
- 609bc4750: đổi tên migration `campaigns` và `flash_item_sort_order` sang `20261101100000_*` / `20261101100100_*`, sau `20261101090000_account_deletion_wallet_override` của #96 đã chạy trên PROD.

## Deploy

- Chủ chốt (qua c2, 01/11): hotfix #99 KHÔNG deploy riêng, lên PROD cùng #101. Người deploy: PROD hiện 6f4fd6733, rollback `:prev-a5469abe`; trước dep1 dời các file `.golive-*` của 6f4fd673 sang `/root/golive-archive/6f4fd673/`.
- Hai migration mới: `20261101100000_campaigns` (chỉ thêm bảng Campaign/CampaignProduct/CampaignCoupon), `20261101100100_flash_item_sort_order` (thêm cột `FlashSaleItem.sortOrder`).
- Khoá cấu hình `flashsale.slots` (P12, §4 Q14) nằm trong dữ liệu tham chiếu nạp kiểu createOnly (`APPROVED_LOADED_KEYS`). Chưa nạp thì `generateSlots` dùng mặc định trong mã 12:00/20:00.
- P12 gỡ ràng buộc deploy của handoff-wave3: ô lối tắt Giờ vàng, "Xem tất cả" của khối Giờ vàng và "Nhắc tôi" (trên trang `/flash-sale`) trở lại. PROD hiện (6f4fd6733) đang thiếu ba thứ này vì chủ chọn deploy #95 trước.
- Bundle Mini: entry 630 KB (giới hạn 700), tổng 2119 KB, vượt mốc cảnh báo 2048 từ trước đợt này. F3 so từng chunk base d389e5d8b ↔ 77433c0d0: không có chunk lặp hay import thừa để cắt rẻ, phần tăng do tính năng thật.

## Đã có, gói sau dùng lại

- **Chiến dịch (P11):** model Campaign* + API `campaigns` (công khai và admin, quyền MARKETING); banner trong phần tĩnh của `GET /home` (`HomePublicDTO.campaigns` tuỳ chọn); `useCampaignSlides` hai app cùng hợp đồng (lọc `campaignVisible`, web tính `now` sau hydrate); gợi ý `tubu_home_banner` ('1'/'0') giữ chỗ 137px lúc banner chưa về; `campaignProductPages` (app-core) cho "Xem thêm"; `CAMPAIGN_INTERNAL_TARGETS` nay ở `packages/shared-types/src/campaign.ts`, API trả 400 với đích ngoài danh sách; e2e `mock-api.ts` có `api.fallback('GET', '/campaigns', [])`. Admin: mục "Chiến dịch" cuối nhóm "Khuyến mãi và điểm" (51 → 52 mục), giờ nhập theo giờ VN qua `vnLocalToIso`.
- **Giờ vàng (P12):** trang `/flash-sale` ↔ `/gio-vang`: `SlotTabs` (tablist, roving tabindex, mũi tên/Home/End), Countdown `mode=clock`, chip danh mục, ProductTile `variant=line` + FlashSoldBar + Mua ngay / Nhắc tôi; món hết suất mờ và xuống cuối. Lỗi vượt giới hạn `{ code: 'FLASH_LIMIT', limit }` (`overLimitError`). Admin: ô "Thứ tự" món và nút sinh khung giờ (`generateSlots`, khoá advisory, race spec có). Thanh tab dính Mini dùng `top: 8px` (đo từ chỗ nội dung `.page` bắt đầu), không phải `calc(var(--safe-top) + 56px)`.
- **Bán chạy nhất (P13):** `/best-sellers` ↔ `/ban-chay`, `bestSellersHref`, tab danh mục tầng 1 + "Tất cả" (SegmentedTabs cuộn, chỉ ẩn thanh cuộn dưới md), ProductTile `variant=rank`, `sort=best_seller_30d`, 20 món/trang; "Xem tất cả" của kệ Bán chạy Trang chủ và hub Danh mục trỏ về đây (giữ `category`). Trang `/ban-chay` theo quy tắc robots/canonical của `/san-pham`.
- **Tràn mép (F3):** lớp `.tubu-bleed` (dưới md) và `.tubu-bleed-rail` (kệ, từ md lùi đúng đệm kệ 12px) ở web `mini.css`, `.tubu-bleed` ở Mini `css/tokens.css`. Web lùi theo rem như khung trang `PAGE_WIDE`. Guard `ds-shop-guard.spec` hai app chặn lề âm ngang tay (Tailwind `-m[xlrse]-`, longhand và shorthand `margin` âm ngang); Mini miễn đúng 4 đoạn nới vùng chạm có sẵn (`TOUCH_AREA`, theo đoạn mã chứ không theo file). `.tubu-flash-fill` làm thanh Đã bán hai app rộng bằng nhau khi giảm chuyển động.

## Việc còn mở

- **Mini dính thấp 48px có thể có ở chỗ khác:** `STICKY_TOP = calc(var(--safe-top) + 56px)` ở `brand-view.tsx`, `storefront-view.tsx` và lớp `sticky-below-back` (game.tsx/tokens.css). P12 đo thấy cách tính này hở 48px trên `.page`; các chỗ kia chưa đo. P10 (storefront) kiểm `storefront-view`, P17 kiểm phần còn lại.
- **CLS Trang chủ web từ lg, khách cũ có gợi ý banner nhưng phiên chưa khôi phục xong:** khung chờ banner `lg:hidden`, banner 8 cột chèn vào sau. Không thuộc P14 như P11 ghi; P17 rà cuối.
- **Banner `/offers` chưa giữ chỗ chống nhảy:** P14 dựng lại `/offers`, làm luôn.
- **"Theo lượt bán 30 ngày qua"** vẫn hiện khi `fetchBestSellersPage` lùi về `best_seller` (API cũ trả 400). PROD đã có `best_seller_30d` nên ít khi xảy ra.
- **`/best-sellers?category=` lúc cây danh mục chưa về:** tabpanel mang tên "Tất cả" dù đang lọc. Nhỏ, P17.
- **"Nhắc tôi" sau đăng nhập không tự đặt lại,** khách phải bấm lần nữa.
- **CLS PDP web sản phẩm Giờ vàng 0,0957,** sát ngưỡng 0,1: thanh Giờ vàng cao thêm hay khung nhìn thấp hơn thì phải tải Giờ vàng ở server làm `initialData` cho `pdp-extras.tsx`.
- **`visual-tour` báo thiếu cấu hình cho route `/offers`** (`support/tour.ts`): có từ trước; P14 thêm `TOUR['/offers']`.
- **Ảnh 375px chưa có:** món hết hàng ở khung sắp mở và UI admin Giờ vàng (ô Thứ tự, nút sinh khung giờ).

## Bẫy môi trường

- Máy khởi động lại xoá `/private/tmp`: API giả cho e2e web cục bộ phải dựng lại (`scratchpad/fake-api.cjs`: `/api/health`, `/api/products` dạng `{data,meta}`, `/api/categories`, `/api/brands`, còn lại 404).
- Gate trên máy quá tải (load 85–100) sinh FAIL giả do hết giờ ở các file vitest nặng (`suggest-feed`, `admin/page`, `shop-products-tab`...) và một spec jest (`image-resize`). Chạy riêng file đỏ trước khi kết luận hồi quy.
- Ca CLS e2e chập chờn (lần đầu đỏ, chạy lại xanh) là lỗi thật: chạy `--repeat-each=10 --retries=0` và gắn MutationObserver để thấy phần tử nào chen vào.
