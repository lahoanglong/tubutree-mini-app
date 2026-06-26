# Thiết kế: Gian hàng CTV & Trang nhãn hàng (Storefront)

- **Ngày:** 2026-06-26
- **Trạng thái:** Design — chờ duyệt
- **Thuộc:** [[project_tubutree_v2_monorepo]], mở rộng module Affiliate (CTV) + Dealer + Brand
- **Mockup tham chiếu:** `.superpowers/brainstorm/1487-1782457110/content/` (ctv-A-appstyle-v3, ctv-builder, brand-showcase-v3)

---

## 1. Mục tiêu

Cho phép **CTV tự dựng một "gian hàng" cá nhân** — chọn lọc & sắp xếp sản phẩm họ muốn giới thiệu, chia sẻ **một link duy nhất** (kèm mã giới thiệu) thay vì rải link lẻ → tăng tỉ lệ chuyển đổi, tăng giá trị đơn (combo), kéo dài attribution hoa hồng.

Song song, dựng **trang showcase nhãn hàng** (flagship) — gom sản phẩm theo nhãn + câu chuyện thương hiệu + chứng nhận + khuyến mãi + chương trình đại lý — dùng **chung một bộ renderer** với gian hàng CTV.

**Nguyên tắc xuyên suốt (rút từ research thị trường — §3):** một storefront tuyển chọn dưới một link thắng kiểu rải link; builder là *stack khối có sẵn* (không canvas tự do); sản phẩm *chọn từ catalog* (không gõ lại); với đồ eco, *chứng nhận + minh bạch* là đòn bẩy niềm tin số 1; trên Zalo *không có discovery miễn phí* → luồng share/QR/OG-preview phải xuất sắc.

## 2. Bối cảnh hiện tại (đã có trong code)

- **CTV/Affiliate:** `User.role=AFFILIATE` + `User.referralCode`; `AffiliateLink` (shortCode, targetType, targetId, clicks/conversions/revenue); `Commission` (PENDING→LOCKED→APPROVED→PAID); `Variation.affiliateRate` (% hoa hồng từng SP); dashboard `affiliate.tsx`; payout BANK/Ví ×1.5; bậc doanh số tháng (`monthlyTier`).
- **Đơn & attribution:** `Order.referrerUserId` + `Order.commission`; `createCommissionForOrder` tính hoa hồng theo `item.total × rate%` từng dòng.
- **Brand:** hiện chỉ là **trường chuỗi** `Product.brand` (chưa có entity). `brand-story.tsx` (câu chuyện 6 vùng nguyên liệu) đã có.
- **Dealer:** `DealerApplication` (apply + KYC), `DealerTier` (minOrderVolume, discountRules Json, creditLimit), `DealerCreditLedger`, dealer B2B mode `dealer.tsx`.
- **Khuyến mãi:** `Coupon` (scope, scopeMeta, applyTo Json, maxDiscount, usageLimit); flash-sale component.
- **Hạ tầng FE:** ZaUI + react-query + zmp-bridge `shareLink`; Cloudinary `ImageUpload`; design tokens `tokens.css` (cam #e08c1c, lá #509018, đất sét #c97b4a, ★ nắng #f4b408); `ProductCard`.
- **TubuXu** (tiền tệ tiêu trong app) + điểm Xanh — dùng cho gamification.

## 3. Insight thị trường (tóm tắt — nguồn đầy đủ ở workflow research 2026-06-26)

Nghiên cứu 6 hướng (LTK, ShopMy, Amazon Influencer, TikTok Showcase, Linktree/Beacons/Stan, Selly/Shopee/TikTok VN, Amazon/Shopee/Laz brand store, CRO Baymard/Google/McKinsey/Nielsen, động lực creator):

1. **Một storefront, một link** là primitive thắng ở mọi nền tảng.
2. **CTV page và brand page = cùng một block-renderer, hai nguồn dữ liệu** — đừng build 2 hệ thống.
3. **Builder = stack dọc khối có sẵn + kéo thả + "đẩy lên đầu"**, KHÔNG canvas tự do (Koji chết vì canvas). Sản phẩm chọn từ catalog.
4. **Themed collections** (3–5 bộ, mỗi bộ 4–8 SP) là đơn vị tổ chức chủ đạo.
5. **Header danh tính**: CTV = avatar+tên+lời nhắn cá nhân (micro-influencer convert tốt hơn mega); Brand = logo+banner+badge chính hãng+nguồn gốc.
6. **Thẻ SP ảnh-trước** + badge quét nhanh (giá, ★, real-data badges). Trên Zalo: hero gọn + ~3 SP trên màn đầu.
7. **Eco = chứng nhận + minh bạch nguồn gốc** là module niềm tin số 1 (người mua VN được "huấn luyện" nghi packaging xanh) — chỉ hiện cert đã xác minh, tránh greenwashing.
8. **CTV bỏ cuộc vì không thấy công sức thành tiền** → dashboard hoa hồng theo từng link/SP + "early win".
9. **VN**: ~95% mobile, COD áp đảo, nghi hàng/review giả → social proof phải THẬT; Zalo là kênh quan hệ (không discovery) → share/OG-preview quyết định; cẩn thận spam-ban khi rải link.

**Cảnh báo (từ bước verify):** nhiều số liệu (+53.9%, +32.97%…) là blog vendor → chỉ dùng định hướng; phải có **empty-state/cold-start**, **governance kiểm soát SP**, **vòng đời draft→publish**; xác nhận dữ liệu review/ảnh có thật trước khi khoá thiết kế thẻ (✔ đã xác nhận: `ratingAvg/reviewCount` có sẵn; "đã bán N" chưa có field → để phase sau).

## 4. Nguyên tắc thiết kế (ràng buộc cứng)

1. **Một renderer, hai nguồn** — `Storefront.type = CTV | BRAND`. Cùng tập khối; khác data source + "động cơ" (CTV=cá nhân, Brand=niềm tin).
2. **Chọn từ catalog, không gõ lại** — `StorefrontItem` trỏ tới `Variation`/`Product`.
3. **Builder constrained** — kéo thả (⠿) + đẩy lên đầu (⤒) + ẩn/hiện (👁); theme một-chạm (không CSS tự do).
4. **Không lộ % hoa hồng cho khách** — chỉ CTV thấy badge "+% HH".
5. **Chỉ dữ liệu THẬT** — ★ rating chỉ hiện khi có review; badge giảm tông **đất sét** (không đỏ gắt, "tử tế hơn khẩn cấp"); không countdown giả, không "X người đang xem".
6. **Brand chỉ hiện cert đã xác minh** — admin kiểm soát; chống greenwashing & mạo danh.
7. **Bám design system Tubu** — `tokens.css`, `ProductCard`, ZaUI; immersive + back-button nổi.
8. **Mobile/Zalo first** — ảnh WebP + lazy-load + carousel, không tải full catalog; ẩn scrollbar hàng ngang.

## 5. Kiến trúc dữ liệu (Phương án A — đã chốt)

### 5.1 Brand → entity thật

```prisma
model Brand {
  id            String   @id @default(cuid())
  slug          String   @unique          // /brand/[slug]
  name          String   @unique          // khớp Product.brand (migrate dữ liệu)
  logoUrl       String?
  coverUrl      String?
  tagline       String?                    // "Bến Tre từ 2015"
  story         String?  @db.Text          // câu chuyện thương hiệu (tái dùng brand-story)
  storyImages   String[]
  origin        String?                    // nguồn gốc/vùng nguyên liệu
  certifications Json?                      // [{code, label, verified, proofUrl}] — CHỈ hiện verified=true
  isVerified    Boolean  @default(false)   // badge "Chính hãng" — admin cấp
  isPublished   Boolean  @default(false)
  ownerUserId   String?                    // null ở v1 (admin quản); set khi mở cho đối tác (lộ trình B)
  followerCount Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@map("brands")
}
```

> **Migrate:** sinh `Brand` từ các giá trị `Product.brand` hiện có (name = brand string). Giữ `Product.brand` (string) làm khoá nối, thêm `Product.brandId` optional trỏ `Brand.id` (backfill). Không phá dữ liệu cũ.

### 5.2 Storefront / Collection / Item (lõi dùng chung)

```prisma
enum StorefrontType { CTV BRAND }
enum CollectionKind { NORMAL COMBO }
enum CollectionLayout { GRID CAROUSEL STACK }

model Storefront {
  id          String   @id @default(cuid())
  type        StorefrontType
  slug        String   @unique            // CTV: /s/[slug] (mặc định = referralCode); BRAND: nối brand.slug
  ownerUserId String?                      // CTV: chủ; BRAND: null/owner (lộ trình B)
  brandId     String?  @unique             // chỉ với type=BRAND
  title       String                       // "Cửa hàng của Linh"
  headerNote  String?                      // lời nhắn cá nhân (CTV)
  avatarUrl   String?
  coverUrl    String?                      // ảnh bìa CTV (Cloudinary) — optional
  theme       String   @default("leaf-orange") // preset gradient (one-tap)
  isPublished Boolean  @default(false)     // draft → published; khách chỉ thấy bản published
  publishedAt DateTime?
  collections StorefrontCollection[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([ownerUserId])
  @@map("storefronts")
}

model StorefrontCollection {
  id           String   @id @default(cuid())
  storefrontId String
  storefront   Storefront @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  title        String                      // "Skincare mình đang dùng"
  kind         CollectionKind @default(NORMAL)
  layout       CollectionLayout @default(CAROUSEL)
  sortOrder    Int      @default(0)
  // COMBO:
  comboDiscountPct Int?                     // % giảm (shop tài trợ)
  items        StorefrontItem[]
  @@index([storefrontId])
  @@map("storefront_collections")
}

model StorefrontItem {
  id           String   @id @default(cuid())
  collectionId String
  collection   StorefrontCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  productId    String
  variationId  String?                     // null = để khách tự chọn biến thể ở PDP
  note         String?                     // "vì sao mình giới thiệu" (CTV)
  sortOrder    Int      @default(0)
  isPinned     Boolean  @default(false)    // ⤒ đẩy lên đầu
  isHidden     Boolean  @default(false)    // 👁 ẩn (giữ chỗ, không xoá → không "dead link")
  @@index([collectionId])
  @@map("storefront_items")
}
```

### 5.3 Khuyến mãi nhãn hàng (editorial, nối Coupon)

```prisma
model BrandPromotion {
  id          String   @id @default(cuid())
  brandId     String
  title       String                       // "MUA 2 TẶNG 1"
  subtitle    String?                      // "Dòng dầu gội · đến 30/6"
  themeColor  String?
  couponCode  String?                      // optional nối Coupon hiện có (cơ chế giảm dùng lại)
  startAt     DateTime
  endAt       DateTime
  isActive    Boolean  @default(true)
  sortOrder   Int      @default(0)
  @@index([brandId, isActive])
  @@map("brand_promotions")
}
```

> Cơ chế giảm giá vẫn do `Coupon` (đã có scope/applyTo/maxDiscount/usageLimit) xử lý; `BrandPromotion` chỉ là **thẻ hiển thị editorial** admin kiểm soát hiện gì trên trang nhãn.

### 5.4 Chương trình đại lý — thưởng doanh số ("tour")

```prisma
enum DealerRewardType { TOUR GIFT OTHER }

model DealerReward {
  id          String   @id @default(cuid())
  brandId     String?                      // null = chương trình toàn shop
  type        DealerRewardType
  title       String                       // "Tour Phú Quốc 3N2Đ"
  description String?                      // "Đạt doanh số nhập 50tr/quý"
  threshold   Int                          // doanh số nhập (VND) cần đạt
  period      String   @default("QUARTER") // QUARTER | YEAR
  isActive    Boolean  @default(true)
  sortOrder   Int      @default(0)
  @@index([brandId, isActive])
  @@map("dealer_rewards")
}
```

> **MVP:** chỉ *hiển thị* (động lực cho đại lý) + đối chiếu thủ công với doanh số nhập (đã track qua dealer). Chiết khấu theo bậc dùng `DealerTier.discountRules` đã có. Cấp thưởng = admin xử lý tay (không tự động hoá booking).

### 5.5 Mở rộng nhỏ trên model có sẵn

- `Product.affiliateBlocked Boolean @default(false)` — admin tick để **loại SP nhạy cảm** khỏi gian hàng CTV (mặc định mọi SP active đều được đưa).
- `AffiliateLink.targetType` thêm giá trị `STOREFRONT` (+ `targetId` = storefrontId/slug) cho link gian hàng & brand.
- `Order` thêm `storefrontSlug String?` (+ index) — attribution cấp gian hàng (ngoài `referrerUserId`), phục vụ phân tích "đơn từ gian hàng nào".

## 6. Màn hình & bố cục (đã duyệt qua visual companion)

### 6.1 Gian hàng CTV (khách thấy) — *Hướng A, Kiểu header A*
Ảnh bìa ~78px (avatar tròn nhô lên đè bìa, tên+lời nhắn nằm dưới) → trust badge 1 dòng ("✓ CTV chính thức Tubu" · "🛡️ Đổi trả · chính hãng") → **⭐ Mình tâm đắc nhất** (collection ghim, có note) → bộ sưu tập carousel → **combo** (badge đất sét) → thanh dính đáy **Mua sắm + Chia sẻ**. Hero gọn, ~3 SP trên màn đầu. Không banner full che SP.

### 6.2 Builder CTV (chế độ sửa)
Segment **Trang | Hoa hồng**. Mỗi SP có **⠿ kéo thả · ⤒ đẩy lên đầu · 👁 ẩn/hiện**; badge **xanh "+% HH"** (chỉ CTV) + **🔥 Bán chạy**. Nút **+ Thêm sản phẩm** mở sheet chọn từ catalog (search + chips lọc: Bán chạy / Đang giảm / HH cao; mỗi SP hiện giá + % HH + nút Thêm; SP đã thêm hiện "✓"). **+ Tạo bộ sưu tập / combo**. Đáy **Xem trước + Lưu & Đăng** (draft → publish).

### 6.3 Trang nhãn hàng (flagship — giàu hơn CTV)
**Bar dính trên: "Cửa hàng [Nhãn]" + nút ⤺ Về Tubu Tree**. Cover+logo → tên + badge "✓ Chính hãng" + tagline → proof tổng hợp (★ rating · số đánh giá · theo dõi) → **hàng chứng nhận** (ẩn scrollbar) → cam kết hoàn tiền → **💰 CTV share-to-earn** (chỉ CTV, % HH tối đa) → **🎉 Khuyến mãi** → 🔥 Bán chạy → dòng SP → **🏪 Chương trình đại lý** (chiết khấu theo bậc + thưởng doanh số/tour) → câu chuyện thương hiệu → đáy **+ Theo dõi nhãn + Chia sẻ**.

## 7. Luồng nghiệp vụ

### 7.1 Tạo & publish gian hàng (CTV)
CTV (role AFFILIATE) → "Tạo gian hàng" → tạo `Storefront` draft (slug mặc định = referralCode) → thêm collections/items → **Xem trước** → **Lưu & Đăng** (`isPublished=true`). Khách chỉ thấy bản published; CTV sửa tiếp ở bản nháp (sửa trực tiếp, publish lại — MVP không cần versioning phức tạp). SP `isHidden`/hết hàng → vẫn giữ chỗ trong builder nhưng **không render** cho khách (tránh link chết).

### 7.2 Combo & luật hoa hồng (đã chốt)
Combo = collection `kind=COMBO` + `comboDiscountPct`. **Giảm giá do shop tài trợ** (như coupon). Khi đặt combo: phân bổ phần giảm **theo tỉ lệ** vào từng `OrderItem.total` → `createCommissionForOrder` (đã có) tính HH trên `item.total × affiliateRate%` = **HH trên giá thực trả sau giảm**. Không phá unit-economics; không cần luật HH riêng cho combo.

### 7.3 Store-context navigation (cả CTV & brand — đã chốt)
- Link chia sẻ mang `?s=<slug>` (gian hàng) [+ `?ref=<code>` cho CTV]. Khi mở:
  - Lưu **storefrontContext** (zustand + sessionStorage): `{slug, type, code}`.
  - Mọi điều hướng giữ context; **back** và **sau khi đặt đơn** quay về **trang gian hàng** (không về trang chủ Tubu).
  - Header có nút **"⤺ Về Tubu Tree"** → xoá context → về trang chủ (mua nhiều nhãn).
  - Attribution: `referrerUserId` (từ code) + `Order.storefrontSlug` (từ context) gắn vào đơn lúc checkout.
- Áp cho cả web (Next.js: route `/s/[slug]`, `/brand/[slug]`) và miniapp.

### 7.4 Share-kit ("gói chia sẻ sẵn")
Nút Chia sẻ (gian hàng / collection / từng SP) → tạo: **caption tiếng Việt mẫu** (đính slug+ref) + **QR** + **share-to-Zalo** (`shareLink` zmp-bridge) + **OG preview đẹp** (ảnh + "Cửa hàng của [Tên] — tuyển chọn sống xanh"). Cho phép share **một collection / một SP** làm sub-link cho traffic high-intent.

### 7.5 CTV share-to-earn trên trang nhãn
Khi viewer là CTV (role AFFILIATE) → hiện banner "Chia sẻ nhãn này — nhận tới X% HH" (X = max `affiliateRate` SP của nhãn). Share brand link gắn `?ref=<code>` → đơn phát sinh tính HH như thường. Khách thường **không thấy** banner này.

### 7.6 Dashboard hoa hồng theo link/SP (tab "Hoa hồng")
Mở rộng `affiliate.tsx`: tổng quan (đã có) + **bảng theo từng link/storefront/SP**: clicks · đơn · tỉ lệ chuyển đổi · HH đã/chờ (từ `AffiliateLink.clicks/conversions/revenue` + `Commission`). + **gợi ý hành động** ("Thêm 2 SP đang hot để lên bậc", "Gian hàng thiếu ảnh bìa").

### 7.7 Gamification điểm/tiến trình (mở rộng)
Biến bậc doanh số tháng tĩnh thành **điểm/progress** thưởng cả **hành vi dựng gian hàng** (hoàn thiện hồ sơ, thêm SP, có traffic) + doanh số — milestone thưởng **TubuXu/badge** để CTV mới có "early win". Tái dùng TubuXu + tier có sẵn. (Effort cao — xem phân pha §10.)

### 7.8 Brand (v1 admin) + đại lý
Admin tạo `Brand` (logo/cover/story/cert/verified) → auto gom SP theo brand + curate collection. Module đại lý: hiện `DealerTier.discountRules` (chiết khấu bậc) + `DealerReward` (thưởng tour/quà theo doanh số) → nút "Đăng ký đại lý" nối `DealerApplication` đã có. Lộ trình B: set `Brand.ownerUserId` + role để đối tác tự quản (không đổi data model).

## 8. API (REST — theo convention `/api/...` hiện có)

**CTV storefront (self):**
- `POST /storefront` tạo/khởi tạo gian hàng của tôi
- `GET /storefront/me` · `PATCH /storefront/me` (title/note/avatar/cover/theme/publish)
- `POST /storefront/me/collections` · `PATCH/DELETE /storefront/me/collections/:id` (title/kind/layout/sortOrder/comboDiscountPct)
- `POST /storefront/me/collections/:id/items` (thêm productId/variationId) · `PATCH/DELETE …/items/:id` (note/sortOrder/isPinned/isHidden) · `PATCH …/items/reorder` (batch)
- `GET /storefront/me/products?search=&filter=bestseller|sale|highcommission` (catalog picker, kèm affiliateRate + cờ bán chạy; loại `affiliateBlocked`)
- `GET /storefront/me/share-kit?scope=store|collection|product&id=` (caption + QR data + OG meta)
- `GET /storefront/me/analytics` (theo link/SP)

**Public (khách xem):**
- `GET /s/:slug` (gian hàng CTV published) · `GET /brand/:slug` (trang nhãn)
- `GET /r/:shortCode` (đã có — track click + redirect, gắn storefront context)

**Brand (admin):**
- `POST/PATCH /admin/brands/:id` · `PATCH /admin/brands/:id/verify`
- `POST/PATCH/DELETE /admin/brands/:id/promotions`
- `GET/POST/PATCH/DELETE /admin/dealer-rewards`

## 9. Bảo mật & guardrails

- **Brand chỉ admin tạo & cấp `isVerified`** (chống mạo danh — tiền lệ Hasaki cảnh báo fake-CTV).
- **`affiliateBlocked`** loại SP nhạy cảm khỏi gian hàng CTV.
- **Không lộ % hoa hồng cho khách**; chỉ render cho viewer role AFFILIATE (sở hữu).
- **Cert chỉ hiện `verified=true`** (chống greenwashing/pháp lý).
- **Chỉ dữ liệu thật** (rating/sold) — không số liệu giả.
- **Slug an toàn** — sinh từ referralCode/brand slug; chống chiếm slug; storefront người khác chỉ đọc bản published.
- **Share có chừng mực** — khuyến nghị share qua Mini App + OG preview (tránh Zalo spam-ban); không khuyến khích rải link hàng loạt.
- **Phân quyền sửa** — chỉ chủ sở hữu sửa `Storefront` của mình; brand do admin (v1).

## 10. Phân tách triển khai (tất cả trong "bản đầu" theo yêu cầu — đây là THỨ TỰ build an toàn)

- **Lớp 1 (lõi, làm trước):** Brand entity + migrate; Storefront/Collection/Item + API CRUD; renderer công khai `/s/:slug` & `/brand/:slug`; builder kéo-thả/đẩy-lên-đầu/ẩn-hiện; catalog picker (`affiliateBlocked`); publish draft.
- **Lớp 2:** store-context navigation (back/checkout return + Về Tubu) + attribution `storefrontSlug`; share-kit (caption+QR+Zalo+OG); combo (phân bổ giảm + HH); dashboard hoa hồng theo link/SP.
- **Lớp 3:** brand modules (cert · khuyến mãi `BrandPromotion` · chương trình đại lý + `DealerReward` · CTV share-to-earn); trang nhãn flagship đầy đủ.
- **Lớp 4 (nặng nhất):** gamification điểm/tiến trình + TubuXu/badge (mở rộng tier).

> Nếu cần cắt giảm để ship nhanh: Lớp 4 có thể tách thành đợt sau mà không ảnh hưởng Lớp 1–3.

## 11. Empty / cold-start states (bắt buộc thiết kế)

- **CTV chưa có gian hàng:** màn mời tạo + nút "Tạo gian hàng trong 1 phút" + gợi ý thêm 3 SP bán chạy.
- **Gian hàng mới (1 SP, 0 đơn):** vẫn render đẹp với 1 collection + theme mặc định; CTA "Thêm SP" cho chủ; với khách: ẩn các khối rỗng (không hiện "0 đánh giá").
- **SP chưa có review:** ẩn hàng ★ (không hiện "(0)").
- **Brand mỏng:** ẩn khối rỗng (khuyến mãi/đại lý/cert) nếu chưa có dữ liệu — không để khung trống.

## 12. Rủi ro & quyết định mở

- **Greenwashing/mạo danh** → admin kiểm soát brand + cert verified (đã xử lbằng guardrail).
- **Không discovery miễn phí trên Zalo** → giá trị phụ thuộc share flow; ưu tiên OG-preview + QR.
- **Hiệu năng grid ảnh** → WebP + lazy-load + carousel bắt buộc.
- **Mở:** (a) chính sách trách nhiệm chất lượng khi CTV giới thiệu SP (đã chọn "mọi SP active trừ bị chặn" — cân nhắc thêm whitelist theo danh mục nếu phát sinh khiếu nại); (b) cách *tự động* đối soát đạt mốc `DealerReward` (MVP làm tay); (c) "đã bán N" để phase sau (chưa có field).

## 13. Ngoài phạm vi (MVP)

Booking/thanh toán tour thực sự (đã làm rõ "tour" = thưởng đại lý, không bán vé); brand-owner tự đăng nhập quản trị (lộ trình B); "đã bán N" trên thẻ; A/B testing framework; versioning nhiều bản publish.
