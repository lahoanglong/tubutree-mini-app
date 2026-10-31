# Backend gap: năng lực sẵn có cho 4 nhóm chức năng mới (2026-10-31)

Vai: kỹ sư backend, chỉ đọc mã ở main 13536d955. Đối chiếu với skill `ecc:api-design` và `ecc:prisma-patterns`. Mọi đường dẫn tính từ gốc repo.

## Tóm tắt

- Nền tiền đã chắc: thứ tự giảm giá cố định (giờ vàng → combo → mã → hạng → điểm), chia về từng dòng (`OrderItem.paidTotal`), hoàn tiền một phần, hoa hồng và đối soát đều đọc cùng số. Gói mới nào đụng giá phải **đi qua đúng đường chia dòng này**, không mở đường thứ hai.
- **Làm được chỉ ở frontend:** Top bán chạy theo danh mục, nhãn Mới/sao/đã bán, lưới "Gợi ý hôm nay" cuộn vô tận (đã có, phân trang theo trang), thanh % đã bán ở dải Giờ vàng (đã có), ví mã "đã nhận" (đã có `/me/coupons`). Thêm một việc: hiện combo của gian hàng CTV. Combo đang được trừ tiền ở giỏ nhưng trang gian hàng Mini và web không hề hiện.
- **Cần backend nhỏ (S):** trường `fulfilment` trên thẻ cho nhãn Freeship; kẹp % combo khi trả cho trang gian hàng; thêm nhiều món vào giỏ một lần.
- **Cần backend vừa (M):** trang Giờ vàng theo khung giờ (API chưa có khái niệm khung cho khách, món hết suất biến mất, khách chưa đăng nhập không xem được "sắp diễn ra"); kho voucher "có thể nhận"; banner và trang chiến dịch (chưa có model nào).
- **Cần backend lớn (L), đụng tiền:** combo và mua kèm giảm giá toàn sàn do Tubu tài trợ (hiện combo chỉ của gian hàng CTV, chỉ áp khi đơn ghi công gian hàng). Dùng nhiều mã một đơn cũng là L, cần chủ quyết.
- Không có P0 backend: không thấy lỗi tiền ở mã hiện tại trong phạm vi này.

| Gói | Độ lớn | Chỉ frontend? | Đụng tiền? | Migration |
|---|---|---|---|---|
| 1a Top bán chạy theo danh mục | S | Có | Không | Không |
| 1b Trang Giờ vàng theo khung giờ | M (BE S–M + FE M) | Một phần (xem §1) | Không (chỉ đọc) | Có: `FlashSaleItem.sortOrder` |
| 1c Bán chạy theo cửa sổ 30 ngày | S–M | Không | Không | Có: cột mới |
| 2a Nhãn Mới / sao / đã bán | S | Có | Không | Không |
| 2b Nhãn Freeship | S | Không (thêm 1 trường) | Không | Không |
| 2c Nhãn Yêu thích | S hoặc M | Tuỳ nghĩa (xem §2) | Không | M thì có |
| 2d Gợi ý hôm nay cuộn vô tận | đã có; `sort=daily` S | Có | Không | Không |
| 3a Banner + trang chiến dịch | M | Không | Không | Có: 3 bảng |
| 3b Kho voucher (có thể nhận / đã nhận) | M | "Đã nhận" có; "có thể nhận" thì không | Có (lượt nhận) | Có: 2 cột |
| 3c Nhiều mã một đơn | L | Không | Có | Có |
| 4a Hiện combo gian hàng CTV + tạo combo ở Mini | S–M | Có | Không (đã tính đúng) | Không |
| 4b Combo / mua kèm toàn sàn | L | Không | Có | Có: 2–3 bảng |

## 0. Quy ước API sẵn có, gói mới phải theo

- Danh sách phân trang theo trang: `{ data, meta: { page, limit, total } }`, `limit` ≤ 100 (`apps/api/src/common/pagination.ts:5-27`). Danh sách theo con trỏ đã có dạng `{ items, nextCursor }` (`apps/api/src/modules/catalog/home.service.ts:187`, `PurchasedItemsService`). Endpoint con trỏ mới dùng đúng dạng này, đừng nghĩ dạng thứ ba.
- Route công khai: `@Public()` kèm `@PublicCache('STATIC'|'CATALOG'|'LIVE')`. Ba mức TTL nằm ở `apps/api/src/common/decorators/public-cache.decorator.ts:12-21`. Route theo khách thì dùng `private, no-store` (`apps/api/src/modules/catalog/home.controller.ts:21-26`). Không trộn trạng thái riêng của khách (đã nhắc, đã nhận) vào route công khai có cache.
- Màn quản trị: `@Roles('ADMIN') @AllowStaff('MARKETING')`, kèm trần ngân sách của nhân viên khi tạo ưu đãi (`apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts:31-33`, `flash-sale.service.ts:485-504`). Gói nào để nhân viên tạo ưu đãi tốn tiền thì phải có trần này. Nhân viên không được hưởng ưu đãi mình tạo (`coupons/coupon-scope.ts:28-30`, `flash-sale/flash-line-price.ts:7`).
- Ảnh lưu trong DB (data URL hoặc link), phát ra qua `publicImage`. Hiện chỉ có 3 loại `product | brand | academy` (`apps/api/src/common/public-image.ts:4,11`). Ảnh banner cần thêm loại `campaign`.
- Lỗi: `BadRequestException` kèm câu tiếng Việt cho khách. Mã ổn định cho FE xử lý theo nhánh: `PRICE_CHANGED`, `TOTAL_CHANGED` (`checkout/total-changed.ts:4`, `checkout.service.ts:403-405, 486`).
- Route mới của khách phải vào `packages/app-core/src/route-map.json` (cặp Mini/web), như mọi route hiện có.
- Màn quản trị web dồn trong một file `apps/web/src/app/admin/page.tsx` (4336 dòng; tab Giờ vàng ở `:3114`). Tab mới nên viết thành component riêng trong `apps/web/src/components/admin/` theo mẫu `coupon-list.tsx` và `storefronts-tab.tsx`, đừng nhồi thêm vào `page.tsx`.

## 1. Flash sale theo khung giờ + thanh % đã bán + trang riêng; Top bán chạy theo danh mục

### Đã có
- Model: `FlashSale` (một đợt = một khung giờ có `startAt/endAt`), `FlashSaleItem` (`flashPrice`, `quota`, `soldCount`, `perUserLimit`), `FlashSalePurchase`, `FlashSaleReminder` (`apps/api/prisma/schema.prisma:791-849`).
- API khách: `GET /flash-sales/active` (công khai, LIVE), `GET /flash-sales/upcoming` (cần đăng nhập), `POST|DELETE /flash-sales/items/:itemId/remind` (`flash-sale/flash-sale.controller.ts:12-33`).
- Quản trị: CRUD đợt và món (`flash-sale-admin.controller.ts:35-66`). Món không được trùng giữa hai đợt chồng giờ (`flash-sale.service.ts:404-416`). Quota không vượt tồn kho (`:475`). Có trần % giảm và trần thời lượng đợt (`:42-45, 65-77`). Tab quản trị web ở `apps/web/src/app/admin/page.tsx:3114-3409`.
- Tiền: trừ suất nguyên tử trong transaction đặt đơn (`flash-sale.service.ts:213-300`), hoàn suất khi huỷ hoặc trả (`orders/order-reversal.service.ts:323-363`). Có các bài race `r13-flash-*`, `merge-reversal-flash-lock`, `staff-flash-sale` (`apps/api/test/integration-race/`).
- Cron: nhắc "đã bắt đầu" mỗi phút (`flash-sale.service.ts:629-700`), báo người đã thả tim khi giá giảm (`:707-750`).
- Thanh % đã bán: đã hiện ở dải Giờ vàng Trang chủ (`apps/miniapp/src/components/flash-sale.tsx:137,182`) và trong giỏ (`cart/cart.service.ts:205`).
- Top bán chạy theo danh mục: `GET /products?category=<id>&sort=best_seller&limit=N` đã chạy được (`catalog/catalog.controller.ts:16-21`, `catalog.service.ts:160,184-196,334`). Danh mục kèm số SP đang bán (`catalog.service.ts:582-600`).

### Thiếu
1. Không có API "khung giờ" cho khách. `listActive` không trả `saleId`, `title`, `startAt` (`flash-sale.service.ts:180-196`), nên trang riêng không dựng được tab theo khung.
2. Món hết suất và món hết kho bị loại khỏi danh sách (`flash-sale.service.ts:179`, `flash-active.ts:18`). Trang Giờ vàng kiểu Shopee cần giữ món "Đã bán hết" (mờ, thanh 100%) để khách thấy độ khan hiếm. Hiện thanh % không bao giờ chạm 100%.
3. `/flash-sales/upcoming` cần JWT (`flash-sale.controller.ts:19-23`). Khách chưa đăng nhập không thấy khung sắp tới.
4. Không có thứ tự do quản trị đặt: món xếp theo giá tăng dần (`flash-active.ts:13`). Không đẩy được món chủ lực lên đầu.
5. `listActive` không có `limit`. Blob Trang chủ mang toàn bộ danh sách (`catalog/home.service.ts:93`). Có trang riêng rồi thì dải Trang chủ chỉ cần khoảng 10 món.
6. "Bán chạy" là tổng mọi thời gian, gồm cả `soldExternal` do admin nhập tay từ sàn khác (`schema.prisma:449-450`, `catalog.service.ts:184-196`). `soldApp` chỉ đếm đơn DELIVERED, tính lại lúc 03:00 hằng ngày (`catalog.service.ts:669-722`). Chưa làm được "Top bán chạy tuần/tháng".
7. Lọc danh mục khớp đúng một id, không gồm danh mục con (`catalog.service.ts:334`), dù `Category` có `parentId` (`schema.prisma:851-863`). Hiện danh mục đang phẳng thì chưa sao. Có cây thì Top của danh mục cha sẽ rỗng.

### Đề xuất
- `GET /flash-sales/slots?day=YYYY-MM-DD` (công khai, LIVE): `[{ id, title, startAt, endAt, status: 'LIVE'|'UPCOMING'|'ENDED', itemCount, serverNow }]`. Nguồn là `FlashSale` có `isActive` trong ngày giờ VN.
- `GET /flash-sales/slots/:id/items` (công khai, LIVE): gồm cả món hết suất, mỗi món có cờ `soldOut`, kèm `productId`, `categoryIds` để FE tự lọc theo danh mục (danh sách nhỏ). Không phân trang: một đợt vài chục món. Trạng thái "đã nhắc" lấy riêng qua `GET /flash-sales/upcoming` (đã có, theo khách).
- `listActive` nhận `limit` cho dải Trang chủ; trang riêng dùng endpoint mới.
- Migration: `FlashSaleItem.sortOrder Int @default(0)`, sắp `sortOrder, flashPrice, variationId, id`. Có thể thêm `FlashSale.bannerUrl String?` nếu muốn mỗi khung có ảnh. Ô sửa thứ tự trong tab Giờ vàng.
- Tuỳ chọn S: nút "Nhân bản đợt" sang khung khác. Phải gọi lại `addItem` cho từng món để giữ kiểm trùng và trần nhân viên (`flash-sale.service.ts:451-515`), không chép thẳng bằng SQL.
- Top bán chạy theo cửa sổ (1c): thêm `Product.soldApp30d Int @default(0)`, tính trong cùng cron 03:00 (`catalog.service.ts:669-722`, lọc `deliveredAt ≥ now−30d`), thêm `sort=best_seller_30d`. Đây cũng là bước "cột có index" mà R-81 đã ghi (`docs/2026-10-28-review/20-backlog.md:105`). Không báo lại R-81.
- Route mới: `/flash-sale` ↔ `/gio-vang` trong `route-map.json`.

### Độ lớn, phần làm được chỉ ở frontend
- 1a Top bán chạy theo danh mục: **S, chỉ FE.** Một lời gọi `/products?category&sort=best_seller&limit=10` cho mỗi chip danh mục đang chọn; thứ hạng có cache 60 giây (`catalog.service.ts:246-288`).
- 1b Trang Giờ vàng: **M.** Bản chỉ FE làm được nhưng kém: tab "Đang diễn ra" từ `/active`, tab "Sắp diễn ra" gom theo `startAt` từ `/upcoming`. Ba hạn chế: khách vãng lai không thấy tab sắp tới, món hết suất biến mất, không có tên khung. Nên làm backend trước.

## 2. Nhãn thẻ (Mới, Freeship, Yêu thích, sao, đã bán) + "Gợi ý hôm nay" cuộn vô tận

### Đã có
- Thẻ SP trả `ratingAvg`, `reviewCount`, `sold`, `isFeatured`, `inStock`, `createdAt`, `repVariationId` (`catalog.service.ts:632-663`). `ProductCard` ở app-core cũng có các trường này (`packages/app-core/src/api/catalog.ts:10-29`).
- Nhãn "Mới": `isNewProduct` (30 ngày, bỏ hàng nạp đợt đầu theo `catalog.launch_date`) ở `packages/app-core/src/product-badges.ts:25-33`, `catalog/catalog-launch-date.ts`. Thẻ đã dùng ở `apps/miniapp/src/components/ui/product-tile.tsx:90`.
- Sao và đã bán: đã vẽ trên thẻ (`product-tile.tsx:217-229`).
- Giá Giờ vàng trên thẻ: FE ghép danh sách `/flash-sales/active` vào thẻ qua `cardPricing` (`packages/app-core/src/flash-price.ts:72-100`). Máy chủ dùng cùng luật khi xếp theo giá (`catalog/variation-order.ts:68-80`).
- "Gợi ý hôm nay": đã có lưới cuộn vô tận, 3 chip, tải tiếp bằng IntersectionObserver và nút "Xem thêm" (`apps/miniapp/src/components/home/suggest-feed.tsx:21-96`). Phân trang theo trang, khử trùng bằng `mergeSuggestions` (`packages/app-core/src/home-layout.ts:318-327`). Thứ tự mặc định ổn định nhờ khoá phụ `id` (`catalog.service.ts:166-168`).

### Thiếu
1. **Freeship:** thẻ không có `fulfilment` (`catalog.service.ts:632-663`), nên FE không phân biệt hàng kho Tubu (theo luật freeship Tubu) với hàng đối tác tự giao (theo `freeShipFrom` riêng của gian hàng, `schema.prisma` Storefront). Ngưỡng chung có trong cấu hình công khai (`system-config/public-config.ts:58`); ngưỡng theo hạng ở `pricing/pricing.service.ts:21-28`.
2. **Yêu thích:** chưa có số liệu. `Wishlist` không có quan hệ với `Product`, không có index `productId` (`schema.prisma:2999-3008`), và không có cột đếm.
3. **Con trỏ:** chưa có, nhưng chưa cần. Catalog khoảng 100–2000 SP, thứ tự có khoá phụ `id`, FE đã khử trùng. Shopee-like "hôm nay" (đổi thứ tự mỗi ngày) thì chưa có.

### Đề xuất
- 2b Freeship (**S**): thêm `fulfilment: p.fulfilment` vào `toCard`. Cột vô hướng đã nằm sẵn trong mọi `findMany ... include` gọi `toCard`, nên không thêm join. FE hiện "Freeship" chỉ cho hàng `TUBU` khi ngưỡng freeship đang bật; dùng ngưỡng của hạng khách nếu đã đăng nhập. Hàng `MERCHANT` không gắn nhãn ở bản đầu.
- 2c Yêu thích: **cần chủ chọn nghĩa.**
  (a) "Tubu chọn" = `isFeatured`, đã có trên thẻ: S, chỉ FE.
  (b) "N người thích": thêm `Product.wishlistCount Int @default(0)`, tăng/giảm trong `wishlist.service.ts:66,85` bằng `increment`/`decrement` trong cùng transaction; thêm `@@index([productId])` cho `Wishlist`; có script đối soát. Mức M.
- 2d "Gợi ý hôm nay" xoay theo ngày (**S, tuỳ chọn**): thêm `sort=daily` vào `ProductQuery` (`catalog/dto/product-query.dto.ts:19-21`), xếp trong `listRanked` theo `md5(id + ngàyVN)`. Khoá cache theo ngày, không cần migration. Muốn con trỏ thì thêm `after=<productId>`: `listRanked` đã giữ danh sách id đã xếp (`catalog.service.ts:220-243`), con trỏ chỉ là `indexOf`. Trả `{ items, nextCursor }` như §0.

### Độ lớn
Nhóm 2 nhìn chung **S**. Mới, sao, đã bán, Gợi ý hôm nay làm được chỉ ở FE ngay. Freeship cần 1 trường backend.

## 3. Banner chiến dịch + trang chiến dịch + kho voucher

### Đã có
- `BrandPromotion` theo từng nhãn hàng (`title`, `subtitle`, `themeColor`, `couponCode`, `startAt/endAt`, `sortOrder`; `schema.prisma:533-550`). Hiện trên trang nhãn (`brand/brand.service.ts:106-142`), ẩn mã không còn dùng được (`:302-314`), có CRUD cho admin và chủ nhãn (`brand-admin.controller.ts:47-58`, `brand.controller.ts:54-62`). Chỉ dùng cho một nhãn, không có ảnh, không phải banner toàn sàn.
- Ví mã của khách: `GET /me/coupons` trả mã PUBLIC, TIER đúng hạng, USER_GROUP của khách và mã CLAIM khách đã nhận; chỉ mã còn hạn, chưa hết lượt (`loyalty/loyalty.controller.ts:30-33`, `loyalty.service.ts:844-935`). Danh sách và lúc áp dùng chung một luật (`coupons/coupon-scope.ts:32-50`). Trang Ưu đãi đang vẽ danh sách này (`apps/miniapp/src/pages/offers.tsx:52,231-253`).
- Nhận mã: `POST /coupons/claim {code}`. Có khoá advisory theo mã để không nhận vượt `usageLimit`, mỗi khách một dòng (`coupons/coupons.controller.ts:21-25`, `coupon-claim.service.ts:47-103`).

### Thiếu
1. **Banner, chiến dịch:** không có model, endpoint hay màn quản trị nào. Tìm `banner|campaign` trong `apps/api/src` chỉ ra chỗ ghi nguồn UTM (`common/attribution.ts`, `schema.prisma:3166-3167`). Không có loại ảnh `campaign` (`common/public-image.ts:4`).
2. Trang chiến dịch không có cách gom một bộ SP tuỳ ý. `GET /products?slugs=` nhận tối đa 20 (`catalog.service.ts:47,324`). `Product.tags` thì admin không sửa được (`catalog/product-admin.service.ts:12-19`), chỉ đối tác ghi lúc tạo (`merchant/merchant.service.ts:598`).
3. **Kho voucher "có thể nhận":** mã CLAIM được thiết kế là mã ẩn in trên thẻ hộp hàng (`schema.prisma:1359-1360`). Không có cờ để liệt kê công khai, không có `title` hiển thị, không có số đã nhận để vẽ thanh "Đã nhận 72%". Mã PUBLIC thì tự vào ví, không cần bấm "Lưu".
4. **Một đơn một mã:** `Cart.couponCode` và `Order.couponCode` chỉ một mã (`schema.prisma:888,1019`). `Coupon.isStackable` không nơi nào đọc (`schema.prisma:1377`). Kho voucher có cả mã FREESHIP lẫn mã giảm tiền thì khách chỉ dùng được một trong hai, khác Shopee.

### Đề xuất
- **3a Chiến dịch (M).** Migration thêm bảng:
  ```prisma
  model Campaign {
    id          String   @id @default(cuid())
    slug        String   @unique
    title       String
    subtitle    String?
    bannerImage String            // như Brand.coverUrl; phát qua publicImage('campaign', …)
    bannerWide  String?           // ảnh ngang cho web ≥ md
    themeColor  String?
    placements  String[]          // HOME_HERO | OFFERS | BROWSE
    linkType    String            // PAGE | PRODUCT | CATEGORY | FLASH | URL
    linkValue   String?
    startAt     DateTime
    endAt       DateTime
    isActive    Boolean  @default(true)
    sortOrder   Int      @default(0)
    createdById String?
    products    CampaignProduct[]
    coupons     CampaignCoupon[]
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt
    @@index([isActive, startAt, endAt])
  }
  model CampaignProduct { campaignId String; productId String; sortOrder Int @default(0); @@id([campaignId, productId]); @@index([productId]) }
  model CampaignCoupon  { campaignId String; couponId  String; sortOrder Int @default(0); @@id([campaignId, couponId]) }
  ```
  Endpoint:
  - `GET /campaigns?placement=HOME_HERO` (công khai, STATIC); cũng gộp vào phần tĩnh của `/home` (`home.service.ts:117-128`), để mở Trang chủ không thêm request.
  - `GET /campaigns/:slug` (công khai, CATALOG).
  - `GET /campaigns/:slug/products?page=` (CATALOG): trả thẻ qua `toCard` và `PUBLIC_PRODUCT_WHERE`, không viết bộ lọc thứ hai.
  - `/admin/campaigns` CRUD, `@AllowStaff('MARKETING')`.

  Thêm `campaign` vào `PublicImageKind` và controller ảnh công khai. Route `/campaign/:slug` ↔ `/chien-dich/:slug`. Ghi nguồn bằng `campaign` sẵn có trong AnalyticsEvent, không cần cột trên Order.
- **3b Kho voucher (M).** Migration: `Coupon.listed Boolean @default(false)` (chỉ mã scope CLAIM được bật), `Coupon.title String?`; `@@index([listed, endAt])`.
  - `GET /coupons/collectable` (công khai, CATALOG): mã `listed`, còn hạn, `isActive`, kèm `claimedCount` bằng một `groupBy` trên `coupon_claims`. Unique `(couponId, userId)` đã có cột `couponId` đứng đầu nên đi index (`schema.prisma:1404-1414`).
  - Trạng thái riêng của khách (đã nhận chưa, đã dùng) lấy từ `/me/coupons`. Không cần endpoint "lưu" mới: mã đã liệt kê thì không còn bí mật, FE gọi luôn `POST /coupons/claim {code}`, giữ được khoá và trần lượt nhận.
  - Admin: thêm ô "Hiện ở kho voucher" và "Tên hiển thị" vào form mã. Mã CLAIM của lô thẻ in (`batch`) không được bật `listed`; chặn ở DTO.
- **3c Nhiều mã một đơn (L, cần chủ quyết).** Phải đổi `Cart`/`Order` sang nhiều mã (hoặc thêm `freeshipCouponCode`), sửa `compute`, `allocateLineAmounts`, `redeem`/`release` và hoàn tiền. Đề xuất bản đầu giữ một mã. Kho voucher ghi rõ "Mỗi đơn dùng 1 mã".

### Độ lớn, phần làm được chỉ ở frontend
- Tab "Đã nhận" của kho voucher: **S, chỉ FE** (`/me/coupons` đã có).
- Banner: không làm chỉ FE cho sạch được. Ảnh cố định trong mã thì mỗi lần đổi chiến dịch là một lần deploy.
- 3a M, 3b M, 3c L.

## 4. Combo + mua kèm giảm giá (chi tiết SP và giỏ, áp vào giá đơn)

### Đã có
- Combo của gian hàng CTV: `StorefrontCollection.kind = COMBO` + `comboDiscountPct` (`schema.prisma:707-720,1491-1494`). Trần `storefront.max_combo_pct` (mặc định 30) kẹp hai lớp: lúc ghi (`storefront/storefront.service.ts:59-63`) và lúc tính tiền (`combo.service.ts:108-111`). Cần ít nhất 2 SP khác nhau (`combo.service.ts:21`). Chủ gian hàng mua ở gian hàng mình thì không được giảm (`:103`). Hàng của gian hàng đối tác không được giảm combo (`:112-114`).
- Tính tiền: phần giảm combo chia về từng dòng (`combo.service.ts:29-55`), ghi vào `OrderItem.total` và `Order.comboDiscount` (`checkout.service.ts:512,553`, `schema.prisma:964`). Giỏ, báo giá và đặt đơn dùng chung `goodsAfterComboOf` (`combo.service.ts:61-73`, `cart/cart.service.ts:214-215,316`). Đã có bài race `cart-combo-equals-quote`.
- "Thường mua kèm" ở trang chi tiết: theo các đơn 90 ngày, chỉ gợi ý, không giảm (`catalog.service.ts:444-483`).

### Thiếu
1. **Khách không thấy combo của gian hàng.** Trang gian hàng Mini chỉ vẽ tiêu đề và lưới 2 cột, bỏ qua `kind`, `comboDiscountPct` và cả `layout` (`apps/miniapp/src/pages/storefront-view.tsx:142-158`). Web cũng vậy (`apps/web/src/app/s/[slug]/page.tsx:264-289`). API đã trả đủ (`storefront.service.ts:363-365`). Tiền vẫn bị trừ lặng lẽ ở giỏ (`apps/miniapp/src/pages/cart.tsx:738-739`).
2. **Mini không tạo được combo.** Màn dựng gian hàng Mini chỉ tạo bộ sưu tập thường (`apps/miniapp/src/pages/storefront-builder.tsx:214`), web thì có (`apps/web/src/components/affiliate/storefront-builder.tsx:347-350`). API đã nhận `kind/layout/comboDiscountPct` (`storefront.controller.ts:46-53`).
3. **Không có combo toàn sàn.** Combo chỉ áp khi đơn ghi công một gian hàng (`combo.service.ts:87-88`, `checkout.service.ts:1060-1071`). Khách mua thẳng ở Tubu không bao giờ có combo. `Product.isCombo` không nơi nào ghi (`schema.prisma:446`), chỉ được trả ra ở trang chi tiết (`catalog/catalog-public.ts:23`).
4. **Không có "mua kèm deal sốc"** (mua A thì B có giá riêng): không model, không luật giá.
5. **Không thêm được nhiều món vào giỏ một lần:** `POST /cart/items` mỗi lần một món (`cart/cart.controller.ts:19`). "Thêm cả combo" mà FE gọi lặp thì lỗi giữa chừng để lại giỏ dở dang.
6. % combo trả cho trang gian hàng không kẹp trần (`storefront.service.ts:365`), trong khi lúc tính tiền có kẹp (`combo.service.ts:108-111`). Dữ liệu ghi trước khi có trần mà vượt trần thì trang hứa nhiều hơn số tiền thật được trừ.

### Đề xuất
- **4a (S–M, chỉ FE):**
  - Vẽ bộ sưu tập COMBO thành khối riêng: tiêu đề "Mua đủ N món giảm X%", danh sách món, tổng trước/sau, nút "Thêm cả combo". Theo `layout`: CAROUSEL dùng `ScrollRow`, GRID dùng lưới, STACK dùng danh sách.
  - Trang chi tiết mở trong ngữ cảnh gian hàng (đã có thanh ngữ cảnh) tra các bộ COMBO trong dữ liệu công khai của gian hàng có chứa SP này để hiện "Có trong combo −X%".
  - Mini builder thêm chọn loại, bố cục và % combo như web.
- **4a-BE (S):** sửa `storefront.service.ts:365` thành `Math.min(pct, max_combo_pct)`. Thêm `POST /cart/items/batch { items: [{ variationId, quantity }] }` chạy trong một transaction, lỗi thì không ghi món nào, dùng lại kiểm tra của `addItem`.
- **4b Combo, mua kèm toàn sàn (L).** Migration:
  ```prisma
  model Bundle {
    id          String   @id @default(cuid())
    kind        String            // BUNDLE_PCT (mua đủ bộ giảm %), ADDON (mua kèm giá riêng)
    title       String
    pct         Int?              // BUNDLE_PCT, kẹp theo cấu hình bundle.max_pct
    startAt     DateTime
    endAt       DateTime
    isActive    Boolean  @default(true)
    createdById String?
    items       BundleItem[]
    @@index([isActive, startAt, endAt])
  }
  model BundleItem {
    bundleId    String
    productId   String
    role        String            // MAIN | ADDON
    addonPrice  Int?              // ADDON: giá mua kèm mỗi đơn vị
    maxQty      Int     @default(1) // ADDON: số đơn vị giá riêng mỗi đơn
    @@id([bundleId, productId])
    @@index([productId])
  }
  ```
  Bản đầu **không có quota toàn cục** cho ADDON (chỉ `maxQty` mỗi đơn), để khỏi thêm một bộ đếm khoá trong transaction đặt đơn. Muốn quota thì làm theo mẫu `consumeQuotas`, kèm bài race (xem §6).

  Tích hợp: mở rộng `ComboService` thành `computeDiscounts(slug, lines, buyerId)`, trả cùng dạng `{ total, perLine }`. Combo gian hàng, BUNDLE_PCT và ADDON quy về số đồng của từng dòng. Mỗi dòng lấy khoản lớn nhất, không cộng dồn. Ghi vào đúng `comboPerLine` và `Order.comboDiscount`, nhờ đó hoàn tiền, hoa hồng và đối soát tự đúng mà không sửa thêm (`checkout-split.ts:187-191,236-245`, `affiliate/commission-base.ts:9-21`, `orders/refund-allocation.ts`).

  API:
  - `GET /products/:slug/bundles` (CATALOG) cho trang chi tiết.
  - Giỏ trả thêm `bundleHints` ("Thêm 1 món nữa để giảm 10%").
  - `/admin/bundles` có trần nhân viên như Giờ vàng.

### Độ lớn
4a S–M (gần như chỉ FE). 4b L, gồm: model, quản trị, luật giá, gợi ý trong giỏ, race test, câu thể lệ khi trả một phần.

## 5. Quy tắc giá: thứ tự hiện có và chỗ gói mới chen vào

Thứ tự hiện có ghi ở `checkout.service.ts:1078-1121`, chia dòng ở `checkout/checkout-split.ts:198-232`.

| Bước | Áp trên | Hiện có | Gói mới |
|---|---|---|---|
| 0. Đơn giá dòng | Đại lý: luồng riêng `DealerService.placeOrder`, `discount: 0`, không Giờ vàng/mã/combo (`dealer/dealer.service.ts:241,268,363,1990-1997`). Khách lẻ và CTV: `salePrice ?? retailPrice` | — | Không đổi. Combo/mua kèm **không** áp cho đơn đại lý. |
| 1. Giờ vàng | Dòng có suất: `min(flash, giá đang bán)`; dòng đó không nhận combo, mã, hạng (`flash-line-price.ts:27-35`, `checkout-split.ts:187-195`) | Có | Giữ: dòng Giờ vàng không nhận combo/mua kèm. |
| 2. Combo | Dòng không phải Giờ vàng, không phải hàng đối tác; mỗi dòng lấy % cao nhất (`combo.service.ts:29-55`) | Combo gian hàng | Combo gian hàng, BUNDLE_PCT và ADDON cùng ở bước này; **mỗi dòng lấy khoản lớn nhất**, không cộng. |
| 3. Mã giảm giá | Phần còn lại sau combo (cũng là nền kiểm `minOrder`); một mã mỗi đơn (`checkout.service.ts:1093-1107`) | Có | Kho voucher không đổi bước này. Combo làm nền tụt dưới `minOrder` thì FE đọc `couponNotice` (`:1104,1201`). |
| 4. Giảm theo hạng | Sau mã, chỉ dòng không Giờ vàng (`:1119-1121`) | Có | Không đổi. |
| 5. Điểm Xanh | Hàng Tubu sau 2–4 cộng hàng Tubu Giờ vàng; hàng đối tác không nhận (`:1123-1170`) | Có | Không đổi. |
| 6. Phí giao | Ngưỡng freeship tính trên tiền hàng **trước** giảm (`amounts.subtotal`, `:1189`; `checkout-split.ts:282`) | Có | Combo không làm khách mất freeship. Ghi rõ trong thể lệ. |
| Tích điểm | Trên `goodsAfterAll` của từng kiện (`checkout.service.ts:1217`) | Có | Combo, mua kèm làm giảm điểm tích. Đúng luật hiện hành, cần ghi thể lệ. |
| Hoa hồng CTV | Trên `paidTotal` từng dòng (`affiliate/commission-base.ts:9-21`) | Có | Combo toàn sàn làm giảm hoa hồng CTV. **Chủ cần quyết**: chấp nhận, hay tính hoa hồng trên giá trước combo Tubu. |
| Hoàn tiền một phần | Theo `paidTotal` từng dòng, cộng dồn không lệch đồng (`orders/refund-allocation.ts:1-30`, `order-returns.service.ts:142-147`) | Có | Trả 1 món của combo: khách giữ giá combo cho phần còn lại (giống combo gian hàng hiện nay). **Chủ cần quyết**: giữ, hay thu lại phần giảm. Thu lại thì phải sửa `refund-allocation`. |

## 6. Chỗ đụng đường tiền cần race test

Mẫu sẵn trong `apps/api/test/integration-race/`. Gói mới phải có bài race trước khi merge.

1. **Combo/mua kèm toàn sàn (4b):** số ở giỏ = báo giá = đặt đơn, theo mẫu `cart-combo-equals-quote.race-spec.ts` và `coupon-preview-equals-quote.race-spec.ts`. Đợt combo hết giờ giữa lúc báo giá và đặt đơn: tổng tăng thì `TOTAL_CHANGED` (`checkout.service.ts:403`), tổng giảm thì đơn đi tiếp. Combo cùng Giờ vàng trên một SP: dòng Giờ vàng không nhận combo. Đơn tách kiện (`split-checkout.race-spec.ts`): phép chia không âm, `allocationError` (`checkout-split.ts:307`) không bật.
2. **ADDON có quota (nếu làm):** trừ quota trong transaction đặt đơn, đúng thứ tự khoá đã kiểm ở `n2b-lock-graph.race-spec.ts` (giữ kho → suất Giờ vàng → người dùng, `checkout.service.ts:460-489`, `flash-sale.service.ts:200-212`). Hoàn quota khi huỷ, trả trong `order-reversal.service.ts:323-363`.
3. **Kho voucher (3b):** N khách bấm "Lưu" cùng lúc một mã còn 1 lượt thì chỉ 1 người nhận được, theo mẫu `claim-first-order.race-spec.ts` và `harvest-coupon-count.race-spec.ts`; khoá ở `coupon-claim.service.ts:81-101`. Nhận rồi đặt đơn song song không vượt `perUserLimit` (đã có guard ở `redeem`).
4. **Thêm nhiều món vào giỏ (4a-BE):** hai yêu cầu batch song song cùng một biến thể không làm `CartItem` trùng (unique `(cartId, variationId)`, `schema.prisma:896-906`). Batch xen với lúc đặt đơn phải ra `CartChangedError` (`checkout.service.ts:456-457`).
5. **Nhân bản đợt Giờ vàng:** đi qua `addItem` nên giữ được `lockItemClash` và trần nhân viên (`staff-flash-sale.race-spec.ts`).

## 7. Chỗ cần cache

- Phần tĩnh của `/home` đã cache RAM 20 giây, gom yêu cầu đồng thời (`home.service.ts:90-128`). Gộp banner chiến dịch vào đây, không thêm request.
- `/flash-sales/slots` và `/slots/:id/items`: `@PublicCache('LIVE')` cộng cache RAM 3 giây như `flashSlot` (`home.service.ts:24-26,93`). Gắn `serverNow` sau khi đọc cache (`withServerNow`, `:99-103`).
- `/coupons/collectable`: CATALOG (15/30 giây). `claimedCount` cũ vài giây là chấp nhận được; trần thật kiểm lúc nhận.
- `/campaigns*`: STATIC/CATALOG. Danh sách SP chiến dịch đọc thẻ tươi.
- Top bán chạy theo danh mục, `sort=daily`: dùng `rankCache` có sẵn (`catalog.service.ts:246-288`). Đây là cache theo từng instance; chuyển Redis là việc của R-81, không tách gói mới.
- Không cache: `/me/coupons`, `/flash-sales/upcoming`, gợi ý trong giỏ (theo khách, `no-store`).

## 8. Phát hiện

| # | Mức | Màn | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|---|
| BG-1 | P1 | `/s/:slug` Mini + web | `apps/miniapp/src/pages/storefront-view.tsx:142-158`; `apps/web/src/app/s/[slug]/page.tsx:264-289`; dữ liệu có ở `storefront.service.ts:363-365` | Combo của gian hàng và `layout` không được vẽ. Khách không biết có combo, giỏ vẫn trừ tiền lặng lẽ (`cart.tsx:738-739`). | Khối combo riêng: "Mua đủ N món giảm X%", nút "Thêm cả combo". Tôn trọng `layout` (CAROUSEL dùng `ScrollRow`). Chỉ FE, dùng `Badge tone="promo"`, `PriceTag`, `ScrollRow` sẵn có. |
| BG-2 | P1 | `/storefront` Mini | `storefront-builder.tsx:214` so với web `storefront-builder.tsx:347-350` | Mini không tạo được combo và không đổi được bố cục; web làm được. Lệch hai nền tảng. | Thêm chọn loại, bố cục, % combo vào Mini builder (API sẵn, `storefront.controller.ts:46-53`). Chỉ FE. |
| BG-3 | P1 | Trang Giờ vàng (mới) | `flash-sale.service.ts:179-196`; `flash-active.ts:13,18`; `flash-sale.controller.ts:19-23` | Không có khung giờ cho khách, món hết suất biến mất, khách vãng lai không thấy khung sắp tới, không đặt được thứ tự món. | §1: `GET /flash-sales/slots`, `/slots/:id/items` (gồm món hết suất), `FlashSaleItem.sortOrder`, `limit` cho dải Trang chủ. |
| BG-4 | P1 | Thẻ SP (mọi lưới) | `catalog.service.ts:632-663` | Thiếu `fulfilment`, nên nhãn Freeship không biết món nào theo luật Tubu. | Thêm `fulfilment` vào `toCard` và `ProductCard` (S). |
| BG-5 | P1 | Trang chủ, Ưu đãi | Không có model; `common/public-image.ts:4` | Không có banner hay trang chiến dịch nào; đổi chiến dịch chỉ bằng deploy. | §3a: `Campaign` + `CampaignProduct` + `CampaignCoupon`, ảnh loại `campaign`, gộp vào `/home`. |
| BG-6 | P1 | Ưu đãi / kho voucher | `schema.prisma:1359-1360`; `loyalty.service.ts:844-935` | Chưa có mã "có thể nhận" công khai, tên hiển thị, số đã nhận. | §3b: `Coupon.listed`, `Coupon.title`, `GET /coupons/collectable`; nhận bằng `POST /coupons/claim` sẵn có. |
| BG-7 | P1 | Chi tiết SP, giỏ | `combo.service.ts:87-88`; `checkout.service.ts:1060-1071`; `schema.prisma:446` | Không có combo hay mua kèm toàn sàn; `isCombo` là cột chết. | §4b. Chủ chốt trước: ai tài trợ, có giảm hoa hồng CTV không, trả một phần xử lý ra sao (§5). |
| BG-8 | P2 | `/s/:slug` | `storefront.service.ts:365` so với `combo.service.ts:108-111` | % combo trên trang không kẹp trần như lúc tính tiền. | Trả `Math.min(pct, storefront.max_combo_pct)`. |
| BG-9 | P2 | Giỏ, gian hàng | `cart.controller.ts:19` | Không thêm nhiều món một lần; "Thêm cả combo" có thể lỗi giữa chừng. | `POST /cart/items/batch`, một transaction. |
| BG-10 | P2 | Kệ Bán chạy, Top theo danh mục | `schema.prisma:449-450`; `catalog.service.ts:184-196,669-722` | Bán chạy là tổng mọi thời gian, gồm số nhập tay từ sàn khác; không có "tuần/tháng". | `soldApp30d` trong cron 03:00, thêm `sort=best_seller_30d`. |
| BG-11 | P2 | Kho voucher, thanh toán | `schema.prisma:888,1019,1377` | Một đơn một mã; `isStackable` không ai đọc. | Bản đầu ghi "Mỗi đơn dùng 1 mã". Nhiều mã là L, chờ chủ. Xoá hoặc đánh dấu `isStackable` để khỏi ai tưởng đã hỗ trợ. |
| BG-12 | P2 | Thẻ SP | `schema.prisma:2999-3008` | Nhãn "Yêu thích" không có số liệu; `Wishlist` không có index `productId`. | Chủ chọn: dùng `isFeatured` (S, FE) hay `wishlistCount` (M). |
| BG-13 | P2 | Top theo danh mục | `catalog.service.ts:334`; `schema.prisma:851-863` | Lọc danh mục không gồm danh mục con. | Khi dùng cây danh mục: lọc `hasSome` trên id cha và id con. Hiện danh mục phẳng thì để sau. |
| BG-14 | P2 | Giờ vàng Mini + web | `apps/miniapp/src/utils/flash-display.ts:7`; `apps/web/src/lib/flash-display.ts:7` | `soldPercent` chép ở hai app, dễ lệch khi làm trang Giờ vàng. | Chuyển vào `packages/app-core/src/flash-price.ts` cạnh `flashDisplay`, hai app import chung. |

## 9. Gói làm được ngay chỉ ở frontend (dữ liệu đã có)

1. Top bán chạy theo danh mục (1a).
2. Nhãn Mới, sao, đã bán trên mọi lưới; nhãn "Tubu chọn" từ `isFeatured` nếu chủ chọn nghĩa (a) cho "Yêu thích".
3. "Gợi ý hôm nay": đổi tên khối, giữ phân trang hiện có.
4. Thanh % đã bán: đã có ở dải Giờ vàng; đưa vào thẻ trên lưới khi thẻ đang ở giá Giờ vàng (ghép từ `/flash-sales/active` như `cardPricing`).
5. Tab "Voucher của tôi" của kho voucher, từ `/me/coupons`.
6. Hiện combo gian hàng (BG-1), Mini builder tạo combo (BG-2), "Có trong combo" ở trang chi tiết khi đang trong ngữ cảnh gian hàng.
7. Trang Giờ vàng bản tạm (chỉ "Đang diễn ra" + "Sắp diễn ra" cho khách đã đăng nhập), nếu chưa chờ được BG-3.

Thứ tự đề xuất: frontend-only (mục 9) → BG-4, BG-8, BG-9 (S) → BG-3 Giờ vàng (M) → BG-6 kho voucher (M) → BG-5 chiến dịch (M) → BG-7 combo toàn sàn (L, sau khi chủ chốt 3 câu hỏi ở §5).
