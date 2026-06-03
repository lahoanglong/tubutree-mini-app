# TUBU TREE — Build Spec (Code-Ready)

**Tài liệu triển khai cho Claude Code — v1.0**

> **Mục tiêu file này:** Tự đủ context để Claude Code triển khai Zalo Mini App + Web Shop của Tubu Tree mà không cần file khác.
>
> **Phạm vi:** Tổng hợp Technical Spec v1.1 + UI Guideline (rút gọn từ Design Brief). File này KHÔNG bao gồm phần "lý do brand DNA, persona chi tiết" — chỉ giữ những gì developer cần để build.

---

## 📋 Hướng dẫn cho Claude Code

**Trước khi viết code, đọc theo thứ tự:**
1. Section 0 (Tóm tắt quyết định kinh doanh) — biết WHY
2. Section 1-2 (Kiến trúc + Stack) — biết WHAT
3. Section 3 (Cấu trúc thư mục) — biết WHERE đặt code
4. Section 4 (Mô hình dữ liệu) — biết DATABASE schema
5. Section 5-7 (Tính năng) — đọc lướt qua, đọc kỹ phần đang code
6. Section 8 (UI Guideline) — biết HOW render
7. Section 9-15 (Integration + API + roadmap) — biết HOW kết nối ngoài

**Quy tắc khi code:**
- Bắt đầu từ Phase 0 → Phase 1 theo lộ trình mục 15.
- Mọi tham số kinh doanh (rate, ngưỡng, hold time...) PHẢI đọc từ bảng `SystemConfig` (mục 13). KHÔNG hard-code.
- Mọi integration ngoài (Pancake, ZaloPay, Accesstrade) bọc trong `apps/api/src/modules/integrations/*`.
- Tuân thủ TypeScript strict, no any, lint pass.
- Mỗi feature có unit test cho service layer + ít nhất 1 E2E happy path.
- Trước khi code mỗi module, in ra: liệt kê file sẽ tạo + hỏi xác nhận nếu ambiguous.
- Dùng dữ liệu mẫu thật từ tubutree.com (~50 sản phẩm) để seed dev DB.

---

## 0. Tóm tắt 13 quyết định kinh doanh đã chốt

| # | Vấn đề | Quyết định |
|---|--------|------------|
| 1 | Hoa hồng CTV | Config theo từng sản phẩm (input cùng file bảng giá đại lý) + bonus theo bậc doanh số tháng, retroactive khi nâng bậc |
| 2 | Tỷ lệ cashback sàn ngoài | Tubu 30% / User 70% |
| 3 | Hold + Ví Tubu | Cashback: hold **30 ngày** sau AT confirm; CTV: hold **20 ngày** sau DELIVERED; min rút STK 50k; Ví Tubu ×1.5 bất kỳ lúc |
| 4 | Đại lý | 4 bậc, max chiết khấu 45%, bảng giá Tubu input qua admin (Excel upload), thưởng quý 0-5% nếu đạt 80%-200% mục tiêu |
| 5 | Loyalty | 4 hạng (Mầm Xanh → Cổ Thụ), 2 đường lên hạng (điểm hoặc chi tiêu), multiplier 1x → 2x |
| 6 | Game thưởng | Vòng quay 9 mức giải, cây ảo 10 cấp → trồng cây thật, quiz 5 câu/ngày, leaderboard top 10 |
| 7 | Phí ship | Đơn < 200k = 19k; đơn ≥ 200k = freeship |
| 8 | Thanh toán | COD + ZaloPay + Chuyển khoản + Thẻ tín dụng |
| 9 | Đổi/trả | Chỉ đổi/trả khi hư hỏng/lỗi NSX trong 15 ngày; commission CTV hoàn ngược nếu đơn hoàn trong 20 ngày |
| 10 | Trồng cây | **PanNature "Rừng Xanh Lên"** — 50.000đ/cây, xử lý batch theo mùa mưa |
| 11 | Phase 1 scope | MVP B2C đầy đủ + Affiliate + Cashback + Dealer + Game cơ bản |
| 12 | Discovery features | 13 tính năng bứt phá (xem Section 6.14) |
| 13 | Backend source of truth | Pancake POS cho catalog/order/shipping/invoice; Tubu backend cho user/loyalty/game/affiliate/cashback |

---

## Cấu trúc tài liệu

| # | Section | Khi nào đọc |
|---|---------|-------------|
| 0 | Tóm tắt quyết định kinh doanh | Đọc trước tiên |
| 1 | Kiến trúc tổng thể | Hiểu hệ thống |
| 2 | Stack công nghệ | Setup môi trường |
| 3 | Cấu trúc thư mục (monorepo) | Setup repo |
| 4 | Mô hình dữ liệu (Prisma schema) | Setup database |
| 5 | Phân quyền & roles (RBAC) | Implement auth |
| 6 | **Tính năng chi tiết (7.1 → 7.14)** | Reference khi code feature |
| 7 | **UI Guideline** | Code component & screen |
| 8 | Tích hợp Pancake POS | Khi build module integrations/pancake |
| 9 | Tích hợp Accesstrade (cashback) | Khi build module integrations/accesstrade |
| 10 | Tích hợp thanh toán (ZaloPay/VNPay/CC) | Khi build module integrations/payment |
| 11 | Tích hợp ZNS & Zalo OA | Khi build notification |
| 12 | **API Contract (REST endpoints)** | Tham chiếu mọi endpoint |
| 13 | Bảo mật, hiệu năng, vận hành | Trước khi deploy production |
| 14 | Lộ trình triển khai (5 phase) | Đầu mỗi phase |
| 15 | Bảng config tham số tập trung | Khi seed SystemConfig table |
| 16 | Migration WordPress → Blog | Sau khi mini app ổn |
| 17 | Rủi ro & giả định | Awareness |
| 18 | Phụ lục (tham chiếu link, prompt) | Khi cần |

---

## 1. Kiến trúc tổng thể

### 1.1 Sơ đồ kiến trúc

```
┌──────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                 │
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │  Zalo Mini App   │  │  Shop Web (PWA)  │  │  Blog WordPress  │   │
│  │  (React + ZaUI)  │  │  (Next.js SSR)   │  │  tubutree.com    │   │
│  │  shop.tubutree   │  │  shop.tubutree   │  │  (chỉ blog/SEO)  │   │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘   │
│           │                     │                      │              │
└───────────┼─────────────────────┼──────────────────────┼──────────────┘
            │ HTTPS/REST          │                      │ link → shop
            ▼                     ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    BACKEND LAYER (api.tubutree.com)                   │
│                                                                       │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  API Gateway / BFF  (NestJS, REST + selective GraphQL)       │  │
│   └──┬──────────┬──────────┬──────────┬──────────┬──────────┬────┘  │
│      │          │          │          │          │          │        │
│   ┌──▼───┐  ┌──▼───┐  ┌──▼───┐  ┌──▼───┐  ┌──▼───┐  ┌──▼───┐      │
│   │ Auth │  │ Cat  │  │Order │  │Loyalty│  │ Affil │  │ Game │      │
│   │ svc  │  │ svc  │  │ svc  │  │  svc  │  │  svc  │  │ svc  │      │
│   └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘      │
│      └────┬────┴────┬────┴────┬───┴────┬─────┴────┬────┘            │
│           │         │         │        │          │                  │
│      ┌────▼────┐ ┌──▼────┐ ┌──▼────┐ ┌─▼───┐ ┌───▼────┐            │
│      │Postgres │ │ Redis │ │ S3/R2 │ │ Bull│ │OpenSearch│           │
│      │         │ │(cache)│ │(media)│ │(job)│ │ (search) │           │
│      └─────────┘ └───────┘ └───────┘ └─────┘ └──────────┘           │
└──────────┬─────────────────────────────────────────────────────────────┘
           │
           │  REST + Webhook (2 chiều)
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL INTEGRATIONS                            │
│                                                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│  │ Pancake POS │ │ Accesstrade │ │   ZaloPay   │ │   ZNS/OA    │    │
│  │  (orders,   │ │  (cashback  │ │   VNPay     │ │ (thông báo) │    │
│  │   stock,    │ │   deeplink, │ │   payment   │ │             │    │
│  │   invoice,  │ │   postback) │ │   gateway)  │ │             │    │
│  │   shipping) │ │             │ │             │ │             │    │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 Nguyên tắc
1. **Pancake là source of truth** cho: sản phẩm, kho, đơn hàng, vận chuyển, hóa đơn. Database của Tubu Tree lưu **bản sao đã được làm giàu (enriched)** + dữ liệu riêng (user mini app, điểm, hoa hồng, cashback, gamification).
2. **Đơn hàng tạo ở mini app/web → ngay lập tức push sang Pancake** qua API (idempotent với `external_id`). Mọi thay đổi trạng thái sau đó đi theo chiều `Pancake → Tubu backend` qua **webhook** (có fallback poll).
3. **Mini app & Web dùng chung 100% API** (BFF nếu cần). Không có business logic ở client.
4. **Stateless API**, scale ngang được. State đẩy vào Postgres + Redis.

---

## 2. Stack công nghệ

| Layer | Lựa chọn | Lý do |
|-------|----------|-------|
| Mini App | **React 18 + zmp-sdk + ZaUI + zmp-cli + Vite** | Stack chính thức của Zalo Mini App, có template `zaui-shop` để khởi tạo nhanh. |
| Shop Web | **Next.js 14 (App Router) + Tailwind + shadcn/ui** | SSR/ISR cho SEO sản phẩm, PWA installable, share component logic với mini app qua package nội bộ. |
| State (client) | **Zustand + React Query (TanStack Query)** | Nhẹ, type-safe, cache tốt cho catalog. |
| Backend | **NestJS (Node 20, TypeScript)** | Cấu trúc module rõ ràng cho nhiều domain (catalog/order/loyalty/affiliate/game), dễ test, dễ scale. Hoặc Fastify thuần nếu team nhỏ. |
| DB | **PostgreSQL 16** + **Prisma ORM** | Quan hệ phức tạp (loyalty, affiliate tree, commission). |
| Cache & Queue | **Redis 7** + **BullMQ** | Webhook retry, sync job, gamification cron. |
| Search | **Meilisearch** (hoặc OpenSearch nếu volume lớn) | Tìm sản phẩm tiếng Việt có dấu/không dấu, gợi ý realtime. |
| Object storage | **Cloudflare R2** hoặc **AWS S3** | Lưu ảnh đại lý upload (CMND, GPKD), ảnh review. |
| Media CDN | **Cloudflare Images** / Bunny | Resize on the fly, tối ưu LCP. |
| Email | **Resend** hoặc Amazon SES | Mail giao dịch, hóa đơn. |
| Monitoring | **Sentry** + **Grafana + Loki + Prometheus** | Frontend errors, backend log + metric. |
| Deploy | **Vercel** (Next.js, mini app static) + **Fly.io / Railway / VPS** (backend + DB) | Quen thuộc, đủ rẻ cho giai đoạn đầu. |
| CI/CD | **GitHub Actions** | Đẩy preview cho mini app + web mỗi PR. |
| Blog (giữ lại) | **WordPress** (chỉ post types: post, page) | Giữ nguyên SEO authority hiện tại. |

### 2.1 Tại sao không headless ngay cả với blog
Blog WordPress giữ nguyên giao diện WP — chỉ **gỡ WooCommerce, gỡ trang shop, redirect 301** các URL sản phẩm cũ về `shop.tubutree.com/...` (xem mục **12**). Headless WP chỉ có lợi khi cần custom front-end blog; với Tubu Tree, blog là kênh content marketing, WP-native vẫn tốt nhất cho người viết content.

---

---

## 3. Cấu trúc thư mục dự án (monorepo)

Dùng **pnpm workspaces + Turborepo** để quản lý:

```
tubutree/
├── apps/
│   ├── miniapp/                # Zalo Mini App
│   │   ├── src/
│   │   │   ├── pages/          # Home, Catalog, ProductDetail, Cart, Checkout, Orders, Profile, Affiliate, Cashback, Dealer, Game...
│   │   │   ├── components/
│   │   │   ├── services/       # api.ts (axios instance), zmp-bridge.ts (login, share, pay)
│   │   │   ├── store/          # zustand stores
│   │   │   ├── hooks/
│   │   │   └── app.tsx
│   │   ├── app-config.json     # Zalo Mini App config
│   │   ├── .env.development
│   │   ├── .env.production
│   │   └── package.json
│   │
│   ├── web/                    # Next.js shop
│   │   ├── app/
│   │   │   ├── (shop)/         # routes
│   │   │   ├── api/            # BFF routes nếu cần
│   │   │   └── layout.tsx
│   │   ├── public/
│   │   └── package.json
│   │
│   ├── api/                    # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── catalog/
│   │   │   │   ├── cart/
│   │   │   │   ├── orders/
│   │   │   │   ├── shipping/
│   │   │   │   ├── invoices/
│   │   │   │   ├── loyalty/
│   │   │   │   ├── affiliate/      # CTV nội bộ
│   │   │   │   ├── cashback/       # affiliate sàn ngoài
│   │   │   │   ├── dealer/         # B2B
│   │   │   │   ├── games/
│   │   │   │   ├── reviews/
│   │   │   │   ├── notifications/  # ZNS + OA
│   │   │   │   └── integrations/
│   │   │   │       ├── pancake/
│   │   │   │       ├── accesstrade/
│   │   │   │       ├── zalopay/
│   │   │   │       └── zns/
│   │   │   ├── jobs/               # BullMQ queues
│   │   │   ├── common/             # filters, guards, decorators
│   │   │   └── main.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── package.json
│   │
│   └── admin/                  # Admin nội bộ (Next.js, route /admin nằm trong web hoặc tách riêng)
│
├── packages/
│   ├── shared-types/           # TS types dùng chung (Product, Order, User...)
│   ├── ui/                     # component dùng chung cả miniapp + web (Button, ProductCard...)
│   ├── api-client/             # SDK gọi backend (auto-gen từ OpenAPI)
│   └── eslint-config/
│
├── tools/
│   └── wp-migration/           # script migrate WordPress
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### 3.1 Quy ước commit & branch
- Trunk-based: `main` deploy production, mỗi feature 1 PR ngắn.
- Conventional commits: `feat(cashback): add postback handler`.
- PR phải pass lint + type-check + test trước merge.


---

---

## 4. Mô hình dữ liệu (Data Model)

> Schema viết theo Prisma. Tên bảng dùng số nhiều, tiếng Anh. Một số bảng có cờ `pancake_id` để map về Pancake.

### 4.1 User & quyền

```prisma
model User {
  id              String   @id @default(cuid())
  zaloId          String?  @unique   // openId từ Zalo
  zaloAccessToken String?            // mã hóa
  phone           String?  @unique
  email           String?
  fullName        String?
  avatarUrl       String?
  role            UserRole @default(CUSTOMER) // CUSTOMER | AFFILIATE | DEALER | STAFF | ADMIN
  tierId          String?                       // hạng loyalty hiện tại
  tier            MembershipTier? @relation(fields: [tierId], references: [id])
  referralCode    String   @unique               // mã chia sẻ
  referredById    String?                        // ai mời mình
  pointsBalance   Int      @default(0)
  walletBalance   Int      @default(0)            // số dư ví (VND, để rút hoặc dùng thanh toán)
  cashbackPending Int      @default(0)            // cashback chờ duyệt (VND)
  isBlocked       Boolean  @default(false)
  pancakeCustomerId String? @unique               // map sang customer ở Pancake
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum UserRole {
  CUSTOMER
  AFFILIATE
  DEALER
  STAFF
  ADMIN
}

model MembershipTier {
  id            String @id
  name          String              // "Mầm xanh", "Lộc biếc", "Đại thụ"
  minPoints     Int                 // điểm tối thiểu để đạt
  minSpending   Int?                // hoặc/và VND chi tiêu trong 12 tháng
  discountPct   Decimal @default(0) // % giảm giá toàn shop
  perks         Json                // tự do: ["Free ship đơn từ 300k", "Quà sinh nhật"]
  badgeImageUrl String?
}

model Address {
  id          String  @id @default(cuid())
  userId      String
  user        User    @relation(fields: [userId], references: [id])
  recipient   String
  phone       String
  province    String
  district    String
  ward        String
  street      String
  isDefault   Boolean @default(false)
  // ID code chuẩn để gửi Pancake (Pancake dùng mã hành chính riêng)
  provinceCode String
  districtCode String
  wardCode     String
}
```

### 4.2 Catalog (mirror từ Pancake)

```prisma
model Product {
  id            String @id @default(cuid())
  pancakeId     String @unique          // product_id bên Pancake
  brand         String                  // "Visante", "Pơ Lang", "Fuwa3e"...
  slug          String @unique
  name          String
  description   String  @db.Text
  shortDesc     String?
  images        String[]
  thumbnail     String?
  categoryIds   String[]                // m2m qua bảng riêng nếu phức tạp
  tags          String[]
  isActive      Boolean @default(true)
  isFeatured    Boolean @default(false)
  basePrice     Int                     // giá niêm yết (VND)
  salePrice     Int?                    // giá sale
  // SEO
  metaTitle     String?
  metaDesc      String?
  // Định hướng
  forSegment    String[]                // ["mom_baby","sensitive_skin","men"]
  ingredients   Json?                   // [{name, percentage, benefit}]
  certifications String[]               // ["USDA Organic","Vegan"]
  variations    Variation[]
  reviews       Review[]
  searchVector  Unsupported("tsvector")? // full-text search VN
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Variation {
  id           String  @id @default(cuid())
  pancakeId    String  @unique
  productId    String
  product      Product @relation(fields: [productId], references: [id])
  sku          String  @unique
  name         String                  // "500ml", "Hương sả - 1L"
  attributes   Json                    // {size:"500ml", scent:"sả"}
  retailPrice  Int                     // = product.basePrice nếu không khác
  salePrice    Int?
  // Giá đại lý theo bậc
  dealerPrices Json?                   // {tier_silver: 200000, tier_gold: 190000}
  stock        Int     @default(0)     // tổng tồn (lấy từ Pancake)
  isActive     Boolean @default(true)
  weight       Int?                    // gram, dùng tính phí ship
}

model Category {
  id        String   @id @default(cuid())
  parentId  String?
  parent    Category? @relation("CatParent", fields: [parentId], references: [id])
  children  Category[] @relation("CatParent")
  name      String
  slug      String   @unique
  image     String?
  sortOrder Int      @default(0)
}
```

### 4.3 Giỏ hàng & đơn

```prisma
model Cart {
  id        String     @id @default(cuid())
  userId    String     @unique
  user      User       @relation(fields: [userId], references: [id])
  items     CartItem[]
  couponCode String?
  updatedAt DateTime   @updatedAt
}

model CartItem {
  id           String @id @default(cuid())
  cartId       String
  cart         Cart   @relation(fields: [cartId], references: [id])
  variationId  String
  variation    Variation @relation(fields: [variationId], references: [id])
  quantity     Int
}

model Order {
  id              String   @id @default(cuid())
  code            String   @unique          // "TUBU2025XXXXX" (sinh ở mini app)
  pancakeOrderId  String?  @unique          // id bên Pancake sau khi push
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  type            OrderType                  // RETAIL | DEALER
  status          OrderStatus                // mirror Pancake state
  subtotal        Int
  discount        Int      @default(0)
  shippingFee     Int      @default(0)
  total           Int
  pointsEarned    Int      @default(0)
  pointsUsed      Int      @default(0)
  paymentMethod   PaymentMethod
  paymentStatus   PaymentStatus
  paymentTxnId    String?
  shippingAddress Json                       // snapshot Address tại thời điểm đặt
  shippingPartner String?                    // GHN, GHTK, Viettel Post
  shippingCode    String?                    // mã vận đơn từ Pancake
  shippingStatus  String?
  shippingHistory Json?                      // mảng các event vận chuyển
  invoiceRequest  Json?                      // {taxCode, companyName, address, email}
  invoiceUrl      String?                    // PDF link từ Pancake/MISA
  invoiceStatus   InvoiceStatus?
  referrerUserId  String?                    // ai mời mua (CTV)
  commission      Int     @default(0)        // VND CTV được nhận
  couponCode      String?
  note            String?
  items           OrderItem[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum OrderType { RETAIL DEALER }
enum OrderStatus {
  PENDING_PAYMENT
  CONFIRMED
  PACKED
  SHIPPING
  DELIVERED
  RETURNED
  CANCELLED
}
enum PaymentMethod { COD ZALOPAY VNPAY BANK_TRANSFER WALLET }
enum PaymentStatus { UNPAID PAID REFUNDED FAILED }
enum InvoiceStatus { NOT_REQUESTED REQUESTED ISSUED FAILED }

model OrderItem {
  id           String  @id @default(cuid())
  orderId      String
  order        Order   @relation(fields: [orderId], references: [id])
  variationId  String
  productName  String                  // snapshot
  variationName String
  unitPrice    Int                     // giá tại thời điểm đặt
  quantity     Int
  total        Int
}
```

### 4.4 Loyalty & Voucher

```prisma
model PointsTransaction {
  id        String @id @default(cuid())
  userId    String
  delta     Int                          // + tích, - tiêu
  reason    String                       // "ORDER_DELIVERED:TUBU20250001", "GAME_DAILY", "REFUND"
  refType   String?                      // ORDER | GAME | REVIEW | ADMIN
  refId     String?
  expiresAt DateTime?
  createdAt DateTime @default(now())
}

model Coupon {
  id            String   @id @default(cuid())
  code          String   @unique
  type          CouponType                // PERCENT | AMOUNT | FREESHIP
  value         Int                       // %|VND
  minOrder      Int?
  maxDiscount   Int?
  startAt       DateTime
  endAt         DateTime
  usageLimit    Int?                      // tổng số lượt dùng
  perUserLimit  Int      @default(1)
  applyTo       Json?                     // {brands:[], categoryIds:[], productIds:[]}
  isStackable   Boolean  @default(false)
  scope         CouponScope               // PUBLIC | TIER | USER_GROUP | BIRTHDAY | INVITE
  scopeMeta     Json?
}
enum CouponType { PERCENT AMOUNT FREESHIP }
enum CouponScope { PUBLIC TIER USER_GROUP BIRTHDAY INVITE }

model CouponRedemption {
  id        String @id @default(cuid())
  couponId  String
  userId    String
  orderId   String?
  redeemedAt DateTime @default(now())
}
```

### 4.5 Affiliate (CTV chia sẻ link nội bộ)

```prisma
model AffiliateLink {
  id           String @id @default(cuid())
  userId       String                  // ai sở hữu link
  user         User   @relation(fields: [userId], references: [id])
  shortCode    String @unique          // dùng trong URL ?ref=XYZ
  targetType   String                  // PRODUCT | CATEGORY | HOMEPAGE | DEAL
  targetId     String?
  clicks       Int    @default(0)
  conversions  Int    @default(0)
  revenue      Int    @default(0)
  createdAt    DateTime @default(now())
}

model AffiliateClick {
  id            String @id @default(cuid())
  shortCode     String
  visitorId     String                 // cookie id / zaloId nếu logged
  ipHash        String
  userAgent     String?
  referrer      String?
  clickedAt     DateTime @default(now())
  convertedOrderId String?
}

model Commission {
  id              String @id @default(cuid())
  affiliateUserId String
  orderId         String
  orderTotal      Int
  rate            Decimal                  // %
  amount          Int                       // VND
  status          CommissionStatus          // PENDING (đơn chưa giao) | LOCKED (đã giao, đang chờ hết hạn return) | APPROVED | PAID | REJECTED
  approvedAt      DateTime?
  paidAt          DateTime?
  payoutBatchId   String?
}
enum CommissionStatus { PENDING LOCKED APPROVED PAID REJECTED }

model Payout {
  id        String @id @default(cuid())
  userId    String
  amount    Int
  method    String                          // BANK | WALLET_BALANCE | ZALOPAY
  bankInfo  Json?
  status    PayoutStatus
  requestedAt DateTime @default(now())
  paidAt    DateTime?
}
enum PayoutStatus { REQUESTED APPROVED PAID REJECTED }
```

### 4.6 Cashback (sàn ngoài qua Accesstrade)

```prisma
model CashbackMerchant {
  id            String @id @default(cuid())
  slug          String @unique             // "shopee", "lazada", "tiktokshop"
  name          String
  logoUrl       String
  category      String                     // "ecommerce" | "fashion" | "travel"
  baseRate      Decimal                    // % người dùng nhận (sau khi Tubu giữ margin)
  fullRate      Decimal                    // % Accesstrade trả Tubu
  isActive      Boolean @default(true)
  deeplinkTemplate String                  // template để gen deeplink
  terms         String?
}

model CashbackClick {
  id              String @id @default(cuid())
  userId          String
  user            User   @relation(fields: [userId], references: [id])
  merchantId      String
  merchant        CashbackMerchant @relation(fields: [merchantId], references: [id])
  utmTraceId      String @unique           // sub_id gửi Accesstrade
  destinationUrl  String
  productUrl      String?                  // nếu user click 1 sản phẩm cụ thể
  clickedAt       DateTime @default(now())
  ip              String?
}

model CashbackTransaction {
  id             String @id @default(cuid())
  userId         String
  user           User   @relation(fields: [userId], references: [id])
  clickId        String?                   // map về CashbackClick
  merchantOrderId String                   // mã đơn bên Accesstrade trả về
  orderAmount    Int
  commission     Int                       // số tiền Tubu nhận từ AT
  userReward     Int                       // số tiền hoàn cho user (giữ lại margin)
  status         CashbackStatus            // PENDING | CONFIRMED | REJECTED | PAID
  postbackPayload Json
  confirmedAt    DateTime?
  paidAt         DateTime?
}
enum CashbackStatus { PENDING CONFIRMED REJECTED PAID }
```

### 4.7 Đại lý B2B

```prisma
model DealerApplication {
  id            String @id @default(cuid())
  userId        String                       // user nộp đơn
  user          User   @relation(fields: [userId], references: [id])
  businessName  String
  taxCode       String?
  ownerName     String
  phone         String
  address       String
  cccdFrontUrl  String                       // ảnh CCCD mặt trước
  cccdBackUrl   String
  storeFrontUrl String?                      // ảnh cửa hàng (nếu có)
  monthlyVolumeEstimate Int?
  notes         String?
  status        DealerStatus @default(PENDING)
  reviewedBy    String?
  reviewedAt    DateTime?
  rejectionReason String?
  createdAt     DateTime @default(now())
}
enum DealerStatus { PENDING APPROVED REJECTED SUSPENDED }

model DealerTier {
  id            String @id
  name          String                       // "Cấp 1", "Cấp 2", "VIP"
  minOrderVolume Int                         // VND/tháng để duy trì
  discountRules Json                         // rule chiết khấu theo brand/category
  creditLimit   Int    @default(0)           // hạn mức công nợ (VND)
  paymentTerms  String?                      // "NET 30"
}

model DealerCreditLedger {
  id        String @id @default(cuid())
  userId    String
  delta     Int                              // + nợ, - thanh toán
  refType   String                           // ORDER | PAYMENT | ADJUSTMENT
  refId     String?
  note      String?
  createdAt DateTime @default(now())
}
```

### 4.8 Gamification

```prisma
model GameProfile {
  id           String @id @default(cuid())
  userId       String @unique
  user         User   @relation(fields: [userId], references: [id])
  streakDays   Int    @default(0)             // chuỗi ngày check-in
  longestStreak Int   @default(0)
  lastCheckInAt DateTime?
  treeStage    Int    @default(1)             // cấp độ cây ảo (1..10)
  totalSeeds   Int    @default(0)             // "hạt giống" (currency game)
  ecoImpact    Json?                          // {plasticBottlesSaved:12, treesPlanted:1}
  badges       String[] @default([])
}

model GameSpin {
  id           String @id @default(cuid())
  userId       String
  prizeId      String
  prizeName    String
  prizeValue   Int?
  rewardType   String                         // POINTS | COUPON | PRODUCT | NONE
  rewardRefId  String?
  spunAt       DateTime @default(now())
}

model GameQuiz {
  id        String @id
  question  String
  options   Json
  correct   Int
  rewardPts Int
  brand     String?                           // gắn brand để cross-sell
}

model GameQuizAttempt {
  id        String @id @default(cuid())
  userId    String
  quizId    String
  isCorrect Boolean
  attemptedAt DateTime @default(now())
}

model Mission {
  id          String @id
  code        String @unique                  // "FIRST_ORDER", "INVITE_3", "REVIEW_5"
  title       String
  description String
  rewardPoints Int
  rewardCoupon String?
  isRepeatable Boolean @default(false)
}

model MissionProgress {
  id        String @id @default(cuid())
  userId    String
  missionId String
  progress  Int    @default(0)
  goal      Int
  completedAt DateTime?
}
```

### 4.9 Đánh giá

```prisma
model Review {
  id        String @id @default(cuid())
  userId    String
  productId String
  orderId   String                            // ràng buộc: phải có đơn giao thành công
  rating    Int                               // 1..5
  comment   String?
  images    String[]
  pointsEarned Int @default(0)
  isVerified Boolean @default(true)
  isVisible Boolean @default(true)
  createdAt DateTime @default(now())
}
```

### 4.10 Notification

```prisma
model NotificationTemplate {
  id          String @id
  code        String @unique                  // "ORDER_CONFIRMED", "ORDER_SHIPPING", ...
  channel     String                          // ZNS | OA | EMAIL | INAPP
  zaloTemplateId String?                      // ID đã được duyệt bên Zalo
  bodyTemplate String                         // {{order_code}} ...
}

model NotificationLog {
  id        String @id @default(cuid())
  userId    String
  templateCode String
  channel   String
  payload   Json
  status    String                            // SENT | FAILED | READ
  error     String?
  sentAt    DateTime @default(now())
}
```

### 4.11 Webhook & Sync

```prisma
model PancakeWebhookEvent {
  id        String @id @default(cuid())
  eventType String                            // ORDER_UPDATED | INVENTORY_CHANGED | ...
  rawPayload Json
  receivedAt DateTime @default(now())
  processedAt DateTime?
  status    String                            // RECEIVED | PROCESSED | FAILED | RETRYING
  attempts  Int @default(0)
  error     String?
}
```


---

---

## 5. Phân quyền & roles

| Role | Quyền chính |
|------|-------------|
| `CUSTOMER` | Mua hàng B2C, dùng loyalty/game/affiliate |
| `AFFILIATE` | Tất cả của CUSTOMER + tạo link + xem dashboard hoa hồng |
| `DEALER` | Mua giá đại lý, xem bảng giá, công nợ. Không thấy giá lẻ (UI ẩn) |
| `STAFF` | Quản lý đơn, hỗ trợ KH, không sửa giá/voucher |
| `ADMIN` | Toàn quyền + cấu hình hệ thống |

> RBAC implement bằng NestJS Guard + decorator `@Roles('ADMIN')`.

---

---

## 6. Tính năng chi tiết

> Quy ước viết: mỗi tính năng có **User story**, **Flow**, **API liên quan** (đặt tên theo REST), **Edge cases**, **Telemetry/metric**.

### 6.1 Authentication & quản lý người dùng

**User story:**
- Là khách, tôi vào mini app từ Zalo, được login bằng Zalo silently (silent login). Lần đầu, mini app xin permission `scope.userInfo` + `scope.userPhonenumber` để lấy số.
- Là khách dùng web `shop.tubutree.com`, tôi có thể: (a) đăng nhập bằng OTP SMS, hoặc (b) "Đăng nhập với Zalo" (Zalo Web Login OAuth) để dùng chung tài khoản với mini app.

**Flow mini app:**
1. `apis.login()` (zmp-sdk) → lấy `code`.
2. Mini app gọi `POST /api/auth/zalo-mini-app` kèm `code` + `accessToken`.
3. Backend gọi Zalo Open API verify, lấy `zaloId` (openId), refresh token; tạo/lấy `User` rồi trả JWT (access 15 phút, refresh 30 ngày) + thông tin profile.
4. Frontend lưu access token vào memory + refresh token vào `storage` API của ZMP.
5. Khi cần số điện thoại (lần đầu thanh toán): `apis.getPhoneNumber()` → token → backend giải mã qua Zalo API.

**Flow web:**
1. Người dùng nhập SĐT → backend gửi OTP qua eSMS hoặc ZNS template OTP.
2. Verify OTP → trả JWT.
3. Hoặc "Đăng nhập với Zalo" qua OAuth: chuyển đến Zalo, callback `code` → cùng endpoint backend `/api/auth/zalo` để map `zaloId`.

**Liên kết mini app ↔ web:**
- Cả hai cùng `User.zaloId` → đăng nhập 1 lần, dùng chung giỏ hàng, điểm, đơn.
- Nếu user web chưa có `zaloId` (đăng ký bằng SĐT): khi vào mini app lần đầu sẽ match qua `phone` và merge tài khoản.

**API:**
- `POST /api/auth/zalo-mini-app` body `{code, accessToken}` → `{accessToken, refreshToken, user}`
- `POST /api/auth/otp/send` body `{phone}` → `{ok}`
- `POST /api/auth/otp/verify` body `{phone, code}` → `{accessToken, refreshToken, user}`
- `POST /api/auth/zalo-oauth` body `{code, redirectUri}`
- `POST /api/auth/refresh` body `{refreshToken}`
- `GET  /api/me`
- `PATCH /api/me` (update fullName, email, dob, gender)
- `GET /api/me/addresses` `POST /api/me/addresses` `PATCH /api/me/addresses/:id` `DELETE`

**Edge cases:**
- Hai user khác đăng nhập cùng 1 SĐT? → Merge bằng wizard: ưu tiên giữ user nhiều order hơn, gộp điểm; conflict thì để admin xử lý.
- Zalo trả `openId` khác giữa các mini app khác nhau của cùng OA: không phải vấn đề ở đây vì 1 mini app duy nhất.

### 6.2 Catalog sản phẩm

**Flow đồng bộ:**
- Cron mỗi 15 phút: poll `GET /api/v1/shops/{shopId}/products` (Pancake) → upsert vào `products`/`variations`.
- Webhook Pancake `product.updated` / `product.created` / `variation.stock_changed` → trigger sync ngay (cập nhật stock realtime).
- Có thể bật `ai_translate` để generate `searchVector` không dấu tiếng Việt.

**UI mini app & web:**
- Home: banner, brand carousel, flash sale (countdown), best-sellers, category grid, "Mới về", "Gợi ý cho bạn".
- Brand page: filter theo brand (Visante, Pơ Lang...).
- Category page: filter (Mỹ phẩm thiên nhiên, Tẩy rửa sinh học, Cho bé, Cho mẹ bầu...).
- Product Detail: gallery, variation selector (dung tích, hương), giá, tồn kho, "Khách đã mua" cross-sell, "Thường mua kèm", thành phần (ingredient panel), chứng nhận (badges USDA/Vegan), tab review.

**Filter & sort:** giá, brand, công dụng (forSegment), đánh giá, tồn kho.

**API:**
- `GET /api/products?brand=&category=&q=&sort=&page=&limit=`
- `GET /api/products/:slug`
- `GET /api/products/:slug/related`
- `GET /api/brands`
- `GET /api/categories`
- `GET /api/search/suggest?q=` (Meilisearch)

### 6.3 Giỏ hàng & thanh toán B2C

**Đặc thù Tubu Tree:**
- Hàng nặng (can 10L Fuwa3e), cần tính phí ship theo cân nặng, ưu tiên Viettel Post / GHN.
- Combo: nhiều brand bundle (vd "Combo dầu gội + gel tắm Pơ Lang") — Pancake hỗ trợ Combo, mirror sang `Product` flag `isCombo`.

**Flow:**
1. Add to cart → `POST /api/cart/items`. Backend check tồn kho realtime (gọi Pancake nếu cache cũ > 30s).
2. Coupon: `POST /api/cart/coupon` validate (scope, min order, expiry, per-user limit).
3. Checkout step 1: chọn địa chỉ.
4. Checkout step 2: tính phí ship theo rule **đơn < 200.000đ = 19.000đ phí ship; đơn ≥ 200.000đ = miễn phí**; hạng Lộc Biếc+ được freeship từ ngưỡng thấp hơn (xem 7.6). Vẫn fetch giá ship gốc từ Pancake để đối soát.
5. Checkout step 3: chọn thanh toán (COD / ZaloPay / VNPay / Bank).
6. Nếu user nhập "Yêu cầu xuất hóa đơn VAT" → mở form (MST, tên công ty, địa chỉ, email).
7. `POST /api/orders/checkout` → backend tạo `Order` local + push sang Pancake → trả `orderCode`. 
8. Nếu ZaloPay: redirect/trigger `Payment.zlpSdk.openOrderPayment` (mini app) hoặc tạo QR (web).
9. Sau khi Pancake confirm + thanh toán xong → trigger ZNS "Đã nhận đơn".

**API:**
- `GET /api/cart`
- `POST /api/cart/items` `{variationId, quantity}`
- `PATCH /api/cart/items/:id`
- `DELETE /api/cart/items/:id`
- `POST /api/cart/coupon` `{code}`
- `DELETE /api/cart/coupon`
- `POST /api/checkout/quote` (tính ship + thuế + voucher)
- `POST /api/checkout/place-order`
- `POST /api/payments/zalopay/create` `{orderId}` → `{paymentUrl|orderToken}`
- `POST /api/payments/vnpay/create`
- `POST /api/payments/webhook/zalopay` (verify signature)
- `POST /api/payments/webhook/vnpay`

**Edge cases:**
- Hết hàng giữa lúc checkout: trả 409, suggest variation thay thế.
- Pancake API timeout khi place order: dùng `idempotencyKey` + retry tối đa 3 lần, nếu fail vẫn lưu order ở DB local với status `PENDING_SYNC`, job background sẽ retry.

### 6.4 Đơn hàng & theo dõi vận chuyển

**Mục tiêu:** user thấy trạng thái realtime từ hãng vận chuyển mà **không cần gọi API hãng VC** — dùng dữ liệu Pancake (Pancake đã tích hợp sẵn GHN/GHTK/Viettel Post và cập nhật trạng thái).

**Webhook Pancake → Tubu:**
- `order.status_updated` → cập nhật `Order.status` + push notification.
- `order.shipping_updated` → cập nhật `shippingStatus` + append `shippingHistory`.

**UI:**
- Trang `Đơn hàng của tôi`: list filter theo trạng thái (Chờ xác nhận / Đang vận chuyển / Đã giao / Đã hủy).
- Trang chi tiết đơn: timeline trạng thái, sản phẩm, phí, mã vận đơn (có nút copy + nút tracking trên web của hãng VC), nút "Yêu cầu hỗ trợ" (mở Zalo OA chat).

**API:**
- `GET /api/orders?status=&page=`
- `GET /api/orders/:code`
- `POST /api/orders/:code/cancel` (chỉ khi `PENDING_PAYMENT` hoặc `CONFIRMED`, nếu sau đó thì redirect sang Zalo OA)
- `POST /api/orders/:code/repurchase` (clone vào cart)
- `POST /api/orders/:code/issue-invoice` (xem 7.5)
- `POST /api/orders/:code/return-request` (xem dưới)

**Chính sách đổi/trả** (đã chốt):
- **Chỉ chấp nhận đổi/trả khi có lỗi nhà sản xuất** (hỏng bao bì, sai hạn sử dụng, sai mã sản phẩm, không đúng mô tả). User trả vì "đổi ý" KHÔNG được chấp nhận.
- Window: **7 ngày** từ lúc nhận hàng.
- User submit form: ảnh sản phẩm + video unboxing (nếu có) + lý do.
- Admin duyệt trong 24h. APPROVED → tạo đơn hoàn ngược trên Pancake, Tubu trả phí ship cả 2 chiều. Hoàn tiền vào Ví Tubu (instant) hoặc về tài khoản ngân hàng (3-5 ngày).
- Khi đơn hoàn được duyệt: hệ thống **tự động trừ ngược commission CTV** + **rollback điểm Xanh đã tích**.
- Window rollback commission CTV: **20 ngày** từ DELIVERED, đồng nhất với cashback (xem 7.8.2).

### 6.5 Hóa đơn điện tử

- Pancake POS đã có tích hợp Viettel Sinvoice/MISA meInvoice. Tubu Tree chỉ cần:
  1. Lưu `invoiceRequest` khi user yêu cầu lúc checkout.
  2. Khi đơn `CONFIRMED` + đã thanh toán → gọi API Pancake `POST /api/v1/orders/{id}/issue-invoice` (hoặc tương đương; xác nhận với Pancake support tên endpoint chính xác cho gói tài khoản hiện tại).
  3. Nhận webhook `invoice.issued` → lưu `invoiceUrl` (PDF) → push ZNS có link tải.
- Trên giao diện đơn hàng: tab "Hóa đơn VAT", nút **Tải PDF** + nút **Gửi lại email**.

**Edge cases:**
- Nếu Pancake không phát hành được (sai MST), chuyển status `FAILED` + thông báo user nhập lại.

### 6.6 Loyalty / Membership

> **Đã chốt theo phản hồi:** đề xuất dưới đây là bản tối ưu mặc định, **toàn bộ thông số nằm trong bảng config admin (mục 21)** — anh có thể chỉnh sửa bất cứ lúc nào mà không cần redeploy.

**Cơ chế điểm:**
- **10.000 VND chi tiêu** trên đơn `DELIVERED` = **1 điểm Xanh**.
- 1 điểm Xanh đổi được **1.000 VND** khi áp vào đơn, **tối đa 20%** giá trị đơn (để tránh đốt điểm dồn 1 lần lãng phí).
- Điểm hết hạn sau **12 tháng** kể từ ngày tích.
- Đơn HOÀN → trừ điểm tương ứng (nếu đã tiêu xong thì trừ vào điểm tương lai, tạo `pointsBalance` âm tạm thời).

**Hạng (Tier):**

| Hạng | Yêu cầu (chọn 1) | Quyền lợi chính | Voucher sinh nhật |
|------|------------------|-----------------|-------------------|
| **Mầm Xanh** | Default | Tích điểm 1x | – |
| **Lộc Biếc** | 500 điểm **hoặc** 5tr/12 tháng | Tích điểm 1.2x, freeship đơn ≥ 99k | Voucher 50k |
| **Đại Thụ** | 2000 điểm **hoặc** 20tr/12 tháng | Tích điểm 1.5x, freeship toàn shop, ưu tiên hotline, được thử sản phẩm mới (beta tester) | Voucher 150k + 1 sample |
| **Cổ Thụ** | 5000 điểm **hoặc** 50tr/12 tháng | Tích điểm 2x, freeship + 5% giảm mọi đơn, quà sinh nhật cá nhân hóa (hộp gift box) | Voucher 300k + hộp quà |

**Vì sao thiết kế thế này:**
- Có **2 con đường** lên hạng (theo điểm tích lũy **hoặc** theo tổng chi tiêu) → user mua nhiều đơn nhỏ và user mua ít đơn lớn đều có cơ hội.
- **Multiplier điểm** (1x → 1.2x → 1.5x → 2x) khuyến khích user giữ hạng cao thay vì chỉ "đạt rồi thôi".
- Freeship ngưỡng thấp dần (99k → toàn shop) là chiến lược giữ chân không tốn quá nhiều vì AOV của Tubu thường ≥ 200k.

**Tracking hạng:**
- Cron hằng đêm tính lại tier dựa trên (`pointsBalance`, `total_spent_last_12_months`).
- Khi rớt hạng: **grace period 30 ngày** + push notification "Bạn còn X ngày để giữ hạng Đại Thụ — mua thêm 350k là giữ được".
- Khi lên hạng: push ZNS chúc mừng + tặng voucher chào mừng.

**Voucher / Coupon chương trình tự động:**
- **Sinh nhật**: trigger ngày 1 hằng tháng, gửi voucher theo bảng trên, hết hạn cuối tháng.
- **Welcome**: user mới đăng ký nhận voucher 30k cho đơn đầu ≥ 199k.
- **Win-back**: user 60 ngày không mua → voucher 50k + gợi ý đơn cũ đặt lại.
- **Milestone**: chi tiêu đạt 1tr/3tr/5tr trong 30 ngày → voucher tri ân lần lượt 30k/100k/200k.
- **Refer thành công** (xem mục 7.14.5): voucher 50k cho cả 2 bên.

Toàn bộ rule trên đều **config-driven** qua admin (bảng `Coupon` + cron job đọc config).

**API:** giữ nguyên như v1.0.

### 6.7 Gamification — Vườn Xanh Tubu

> **Đã chốt:** game trồng cây tưới cây kiểu Shopee Farm, cây ảo → quy đổi cây thật. Phần thưởng: voucher mua hàng + sản phẩm mini. Thiết kế brainstorm đầy đủ bên dưới.

---

#### 6.7.1 Triết lý game

Không phải game sòng bạc (vòng quay random). Không phải game điểm (tích điểm khô khan). Là **"khu vườn thiên nhiên của riêng bạn"** — gắn liền với brand "Sống xanh An Lành", mỗi hành động trong vườn phản chiếu một cam kết với thiên nhiên thật.

**3 điểm khác biệt vs Shopee Farm:**

| Shopee Farm | Tubu Vườn Xanh |
|-------------|----------------|
| Cây ngẫu nhiên, không có ý nghĩa | **Mỗi cây = 1 brand của Tubu** (Cây Sâm Visante, Cây Bơ Pơ Lang, Cây Dứa Fuwa3e...) |
| Thu hoạch = voucher Shopee chung | **Thu hoạch = sản phẩm thật của chính brand đó** (sample hoặc voucher brand) |
| Cây ảo mãi là ảo | **Cây đạt độ trưởng thành → Tubu trồng 1 cây thật** qua PanNature tại vùng nguyên liệu |
| Social: tưới cây bạn bè (viral) | **Social: mời bạn "ghé vườn"** → cả 2 nhận nước tưới, kèm story về vùng đất cây đang lớn |

---

#### 6.7.2 Cơ chế vườn (Garden Mechanics)

**Tài nguyên chính: Giọt Nước (Water Drops 💧)**

- Nguồn nhận mỗi ngày:

| Hành động | Giọt nhận | Ghi chú |
|-----------|-----------|---------|
| Mở app đăng nhập | 10 💧 | Reset 0h UTC+7 |
| Check-in liên tiếp 3 ngày | +5 💧 bonus | Stack tối đa 7 ngày |
| Check-in liên tiếp 7 ngày | +20 💧 bonus | Reset streak nếu bỏ 1 ngày |
| Đặt đơn hàng thành công | +30 💧/đơn | Không giới hạn |
| Đơn ≥ 500k | +50 💧 thêm | Cộng thêm vào 30💧 bên trên |
| Review sản phẩm có ảnh | +20 💧 | Tối đa 2 review/ngày |
| Ghé vườn bạn bè và tưới | +5 💧/lần | Tối đa 10 bạn/ngày = 50💧 |
| Bạn bè ghé vườn mình | +3 💧/lần | Tối đa 10 bạn ghé/ngày = 30💧 |
| Hoàn thành quiz "Sống xanh" | +8 💧/ngày | 4 câu × 2💧 |
| Mời bạn mới đăng ký | +50 💧/người | Bạn mua đơn đầu mới kích hoạt |
| Mua "Gói Phân Bón" (tùy chọn) | +100-500 💧 | Trả bằng điểm Xanh, không bán tiền mặt |

**Bình chứa (Tank):**
- Mặc định chứa tối đa **200💧**.
- Bình tràn → mất nước thừa (tạo urgency vào app).
- Nâng cấp bình: dùng điểm Xanh: 500đ → 300💧, 1000đ → 400💧.

---

#### 6.7.3 Danh mục cây (Plant Catalog)

Mỗi cây đại diện 1 brand. User trồng 1 cây tại 1 thời điểm, có thể có nhiều lô đất (mở thêm bằng điểm):

| Cây | Brand | Loại cây thật | Vùng trồng thật | 💧 cần đến thu hoạch | Thời gian (chăm đủ/ngày) |
|-----|-------|---------------|-----------------|----------------------|--------------------------|
| 🌿 Cây Sâm | Visante | Sâm Ngọc Linh | Quảng Nam | 1.000💧 | ~10 ngày |
| 🥑 Cây Bơ | Pơ Lang | Bơ booth7 | Đắk Lắk | 800💧 | ~8 ngày |
| 🍍 Cây Dứa | Fuwa3e | Dứa Queen | Đồng Tháp | 600💧 | ~6 ngày |
| 🥥 Cây Dừa | Cobote | Dừa Bến Tre | Bến Tre | 700💧 | ~7 ngày |
| ☕ Cây Cà Phê | Le Plateau | Arabica | Lâm Đồng | 900💧 | ~9 ngày |
| 🌾 Cây Lúa | BH.Nong | Gạo lứt | Quảng Nam | 500💧 | ~5 ngày |
| 🌴 Cây Dừa Mật | Sokfram | Mật hoa dừa | Trà Vinh | 750💧 | ~7-8 ngày |
| 🌳 Cây Đa Năng | Hector/Moshav | Đặc sản mùa vụ | Đa vùng | 1.200💧 | ~12 ngày |

**4 giai đoạn phát triển (giống Shopee nhưng có thêm "câu chuyện"):**

```
Stage 1 — Hạt mầm (0% → 25%)
  Visual: hạt giống nhú mầm nhỏ trong đất
  Story: "Hạt sâm từ Quảng Nam vừa được gieo..."

Stage 2 — Cây non (25% → 60%)
  Visual: cây có 2-4 lá xanh tươi
  Story: "Cây đang hút dưỡng chất từ đất đỏ bazan..."
  Unlock: có thể mời bạn ghé vườn

Stage 3 — Cây trưởng thành (60% → 90%)
  Visual: cây đầy lá, bắt đầu có nụ/hoa
  Story: "Lá sâm đang lan tỏa tinh chất..."
  Unlock: nhận preview phần thưởng sắp đến

Stage 4 — Thu hoạch 🎉 (100%)
  Visual: cây ra quả/hoa đẹp + animation confetti
  Story: "Cây đã sẵn sàng! Tubu sẽ trồng 1 cây [loại] thật ở [vùng]"
  Nhận phần thưởng → Reset → Trồng cây mới (có thể cùng loại hoặc đổi)
```

**Nếu không tưới 3 ngày → cây héo** (visual úa vàng). Tưới thêm 50💧 để hồi phục.
**Nếu không tưới 7 ngày → cây chết** (mất toàn bộ tiến trình, cần trồng lại).

---

#### 6.7.4 Phần thưởng khi Thu hoạch

Phần thưởng **được cấu hình trong admin** theo từng loại cây, có thể thay đổi theo mùa. Default:

| Cây | Phần thưởng chính | Phần thưởng phụ |
|-----|-------------------|--------------------|
| Cây Sâm (Visante) | Sample dầu gội Visante 20ml | Voucher 30k cho Visante |
| Cây Bơ (Pơ Lang) | Sample gel tắm Pơ Lang 30ml | Voucher 20k cho Pơ Lang |
| Cây Dứa (Fuwa3e) | Sample nước rửa chén 100ml | Voucher 25k |
| Cây Dừa (Cobote) | Sample tinh dầu dừa 5ml | Voucher 20k |
| Cây Cà Phê | 1 gói cà phê Le Plateau 10g | Voucher 35k |
| Cây Lúa (BH.Nong) | 100g gạo lứt mẫu | Voucher 20k |
| Cây Dừa Mật (Sokfram) | Sample mật hoa dừa 10ml | Voucher 25k |
| Cây Đa Năng | Surprise box (random sample 2-3 brand) | Voucher 50k |

**Cách giao thưởng:**
- **Voucher**: cộng ngay vào tài khoản, dùng trong 30 ngày.
- **Sample vật lý**: ghi nhận trong hệ thống → gửi kèm đơn hàng tiếp theo của user (không ship riêng → giảm chi phí logistics). Nếu user không mua trong 60 ngày → hủy sample (push reminder).

**Cây trồng thật:** Sau mỗi lần thu hoạch, hệ thống ghi nhận 1 "lượt trồng cây thật" → xử lý theo batch (xem 6.7.7).

---

#### 6.7.5 Social Features — "Ghé Vườn Bạn Bè"

Đây là **cơ chế viral core**, học từ Shopee Farm nhưng tinh chỉnh:

**Flow chia sẻ:**
1. User A có vườn → tap "Mời bạn ghé thăm" → sinh link deeplink.
2. User B nhận link → mở mini app → "ghé vườn" của A → tap bình nước.
3. A nhận +3💧, B nhận +5💧 (người ghé được nhiều hơn → incentive đi ghé).
4. Mỗi vườn giới hạn nhận tưới từ 10 người/ngày.

**"Gửi nước tặng bạn" 🎁:**
- User có thể gửi 10-50💧 từ bình của mình cho bạn (trừ bình mình, cộng cho bạn).
- Gửi kèm message "Chúc cây sâm của bạn mau lớn!".
- Tối đa 3 lần gửi/ngày.
- Push notification "Bạn của bạn vừa tưới giúp cây Sâm của bạn 🌿".

**Leaderboard "Vườn Xanh Nhất":**
- Top 10 user có cây phát triển nhanh nhất tuần (tính bằng % tiến trình/7 ngày).
- Không hiển thị tên thật, chỉ nickname.
- Top 1-3 nhận thêm 100-200💧 bonus cuối tuần.

---

#### 6.7.6 Cơ chế Lô Đất (Plot Expansion)

- Mặc định: **1 lô đất** (1 cây tại 1 thời điểm).
- Mở lô đất 2: dùng **500 điểm Xanh** → trồng được 2 cây song song.
- Mở lô đất 3: **1500 điểm Xanh** → 3 cây song song (tối đa).
- Lợi ích: user có động lực tích điểm Xanh (từ mua hàng) để mở rộng vườn.

**Cây đặc biệt theo mùa (Limited Edition):**
- Tết: "Cây Mai Vàng" → thu hoạch được 1 hộp quà Tết (brand curate).
- Giáng Sinh: "Cây Thông" → thu hoạch được voucher 100k.
- Ngày Môi Trường 5/6: "Cây Rừng Tây Bắc" → thu hoạch được Tubu trồng **2 cây thật** thay vì 1.
- Ra mắt sản phẩm mới: "Cây [sản phẩm mới]" → thu hoạch nhận sample sản phẩm mới trước khi lên kệ.
→ Tạo urgency + FOMO tự nhiên.

---

#### 6.7.7 Eco Impact — Cây ảo → Cây thật

**Đối tác: PanNature — Chương trình "Rừng Xanh Lên"**

Research cho thấy:
- PanNature đã trồng được gần 70.000 cây, phủ xanh hơn 100 ha rừng kể từ 2022.
- Với mỗi đóng góp 30 triệu VNĐ sẽ giúp phục hồi 1 ha rừng (khoảng 600 cây) — tức ~50.000đ/cây.
- Đã có MoMo và Vietnam Airlines đồng hành trong chiến dịch "Góp lá vá rừng 2025" — Tubu Tree hoàn toàn có thể tham gia theo mô hình tương tự.

**Vùng trồng:** PanNature hoạt động tại Tây Bắc (Sơn La, Hòa Bình) — Tubu có thể đề xuất trồng **cây bản địa phù hợp với vùng nguyên liệu** để tăng brand story:

| Brand Tubu | Cây thật đề xuất | Vùng | Chi phí ~50k/cây |
|------------|-----------------|------|-----------------|
| Visante | Sâm bản địa / Trầm hương | Quảng Nam | 50.000đ |
| Pơ Lang | Bơ rừng / Gỗ giáng hương | Đắk Lắk | 50.000đ |
| Fuwa3e | Dứa dại / Cây rừng bản địa | Đồng Tháp/TN | 50.000đ |
| Cobote | Dừa dại / Tràm | Bến Tre | 50.000đ |
| Le Plateau | Cà phê rừng shade-grown | Lâm Đồng | 50.000đ |
| Mặc định | Cây rừng bản địa Tây Bắc | Sơn La/Hòa Bình | 50.000đ |

**Cơ chế xử lý:**
- Mỗi lần user thu hoạch 1 cây ảo → hệ thống ghi nhận **1 "cây tồn kho"** vào bảng `EcoPendingTrees`.
- Cron cuối tháng: đếm tổng `pending_trees` → tính ngân sách (số_cây × 50.000đ).
- Admin xác nhận ngân sách → chuyển khoản/tài trợ cho PanNature → PanNature trồng theo batch (mùa mưa tháng 5-6 và tháng 9-10).
- PanNature gửi về: danh sách tọa độ GPS + ảnh thực tế của cây đã trồng.
- Admin upload vào hệ thống → mỗi cây được assign cho 1 user (FIFO theo ngày thu hoạch).
- User nhận ZNS: "Cây [loại] của bạn đã được trồng tại [vùng] 🌳 — Xem ảnh".
- Trang "Vườn Xanh" trong app: tab "Cây Thật Của Tôi" → list cây với ảnh + GPS + ngày trồng + "Chia sẻ chứng nhận".

**Budget planning:**
- Giả định: 500 user thu hoạch/tháng → 500 cây × 50.000đ = **25 triệu/tháng**.
- Giới hạn ngân sách tối đa (config): `eco.monthly_tree_budget = 30.000.000` VND.
- Nếu vượt budget: xử lý overflow sang tháng sau, user vẫn được báo "Cây bạn sẽ trồng vào tháng X".
- Có thể cân nhắc: giai đoạn đầu (6 tháng) Tubu tự chịu chi phí → sau đó cân bằng với AOV tăng từ gamification.

**Schema bổ sung:**

```prisma
model EcoPendingTree {
  id          String @id @default(cuid())
  userId      String
  plantType   String  // "SAM_VISANTE", "BO_POLANG"...
  harvestAt   DateTime
  batchId     String?               // sau khi xử lý
  status      EcoTreeStatus @default(PENDING)
  realTreeGps String?               // "16.1234,103.5678"
  realTreePhotoUrl String?
  plantedAt   DateTime?
  region      String?               // "Son La", "Dak Lak"...
}
enum EcoTreeStatus { PENDING BATCHED PLANTED }

model EcoPlantingBatch {
  id          String @id @default(cuid())
  month       String                // "2025-06"
  treeCount   Int
  budgetVND   Int
  partnerName String @default("PanNature")
  transferDate DateTime?
  status      String                // PLANNED | TRANSFERRED | PLANTED | REPORTED
  reportUrl   String?               // PDF báo cáo PanNature
  trees       EcoPendingTree[]
}
```

**API bổ sung:**
- `GET /api/garden/eco-impact` → `{totalHarvested, treesPlanted, treesPending, regions:[{name, count, photos:[]}]}`
- `GET /api/garden/my-trees` → danh sách cây thật của user với ảnh + GPS
- `GET /api/garden/certificate/:treeId` → PDF chứng nhận trồng cây (có tên user, loại cây, GPS, ngày)

---

#### 6.7.8 Daily Quiz "Sống Xanh"

- 4 câu/ngày, reset 0h.
- Mỗi câu đúng: +2💧 + 1 điểm Xanh.
- Câu hỏi xoay quanh: thành phần thiên nhiên trong sản phẩm Tubu, mẹo sống xanh, câu chuyện vùng nguyên liệu.
- **Cross-sell tinh tế**: sau quiz về brand Fuwa3e → hiện nhanh sản phẩm Fuwa3e nổi bật + nút "Mua thử".
- Câu hỏi do admin nhập qua form, có thể gắn brand/sản phẩm.

---

#### 6.7.9 Missions (Nhiệm vụ dài hạn)

| Mã | Nhiệm vụ | Thưởng | Kiểu |
|----|----------|--------|------|
| `FIRST_HARVEST` | Thu hoạch cây đầu tiên | +200💧 + voucher 30k | 1 lần |
| `ALL_BRANDS` | Thu hoạch đủ 7 loại cây | Badge "Vườn Đa Dạng" + sample box | 1 lần |
| `STREAK_30` | Tưới cây 30 ngày liên tiếp | +500💧 + voucher 50k | Lặp mỗi tháng |
| `INVITE_3` | Mời 3 bạn ghé vườn | +150💧 | Lặp |
| `SOCIAL_GIFTER` | Gửi nước tặng 10 bạn | Badge "Hàng Xóm Tốt Bụng" + 50💧 | 1 lần |
| `ECO_5` | Trồng được 5 cây thật | Voucher 100k + chứng nhận PDF đặc biệt | 1 lần |
| `FIRST_ORDER` | Đặt đơn đầu từ game | +100💧 + 50đ Xanh | 1 lần |
| `BIG_SPENDER` | Mua ≥ 500k trong 1 tháng | +200💧 + 1 lô đất miễn phí 7 ngày | Mỗi tháng |

---

#### 6.7.10 Vòng quay may mắn (giữ lại nhưng đơn giản hóa)

**Nguồn lượt quay:** check-in 7 ngày liên tiếp (1 lượt) + đơn ≥ 500k (1 lượt) + đổi 20 điểm Xanh (1 lượt, tối đa 3 lượt mua/ngày).

**Giải thưởng:**

| Giải | Xác suất | Giá trị |
|------|----------|---------|
| Mất lượt | 35% | — |
| +30💧 | 25% | Tương đương check-in 3 ngày |
| Voucher 10k | 18% | Đơn ≥ 199k |
| Voucher 30k | 12% | Đơn ≥ 300k |
| Voucher 50k | 7% | Đơn ≥ 500k |
| Sample sản phẩm | 2% | Gửi kèm đơn tiếp |
| Voucher 150k "Jackpot" | 0.8% | Đơn ≥ 1tr, PR-worthy |
| Mở lô đất 7 ngày miễn phí | 0.2% | Cực hiếm |

---

#### 6.7.11 Anti-fraud & Admin

- 1 user/1 lượt check-in/ngày (UTC+7).
- Rate-limit IP: 100 action/giờ.
- Audit log: mọi nhận💧, thu hoạch, phần thưởng.
- Admin dashboard: top user nhận thưởng tuần → flag bất thường.
- Mọi config (💧 mỗi action, ngưỡng bình, thưởng thu hoạch) đọc từ `SystemConfig`.

**API:**
```
GET  /api/garden                     → trạng thái vườn hiện tại
POST /api/garden/water               → tưới cây mình (+10💧 check-in)
POST /api/garden/water/:friendUserId → ghé vườn bạn
POST /api/garden/gift-water          → gửi nước tặng bạn {toUserId, amount}
POST /api/garden/harvest             → thu hoạch khi ≥ 100%
GET  /api/garden/friends             → danh sách bạn bè có vườn
GET  /api/garden/leaderboard         → top 10 vườn tuần
POST /api/garden/plant               → trồng cây mới {plantType}
GET  /api/garden/eco-impact          → eco stats
GET  /api/garden/my-trees            → cây thật của user
GET  /api/garden/certificate/:id     → PDF chứng nhận
POST /api/garden/spin                → vòng quay may mắn
GET  /api/garden/quiz/today          → 4 câu quiz hôm nay
POST /api/garden/quiz/:id/answer     → trả lời quiz
GET  /api/garden/missions            → nhiệm vụ + tiến độ
```

### 6.8 Affiliate / Cộng tác viên (CTV)

> **Đã chốt:** tỉ lệ hoa hồng **config theo từng sản phẩm** (input cùng file bảng giá đại lý). Có bonus bậc tháng.

#### 6.8.1 Cấu trúc hoa hồng

**Không có base rate theo brand cố định.** Thay vào đó:

```
commission_rate = product_commission_rate + monthly_tier_bonus
commission_amount = order_subtotal × commission_rate
```

- `product_commission_rate`: nhập trực tiếp vào bảng giá Excel khi import (cùng với giá đại lý). Mỗi variation/SKU có 1 con số hoa hồng % riêng.
- `monthly_tier_bonus`: bonus thêm theo doanh số CTV đạt được trong tháng.

**Schema bổ sung trong Variation:**
```prisma
model Variation {
  // ...existing fields
  affiliateRate  Decimal?   // % hoa hồng cho CTV, null = không áp dụng
  // dealerPrices JSON đã có
}
```

**Excel import format** (1 file dùng cho cả đại lý + CTV):
```
| SKU | Tên SP | Giá lẻ | Giá ĐL Cấp 3 | Giá ĐL Cấp 2 | Giá ĐL Cấp 1 | Giá NPP | Hoa hồng CTV% |
|-----|--------|--------|--------------|--------------|--------------|---------|---------------|
| VST-DG-500 | Dầu gội Visante 500ml | 199k | 169k | 149k | 129k | 109k | 10% |
| FW3-RC-38 | Rửa chén Fuwa3e 3.8L | 385k | 327k | 289k | 250k | 212k | 5% |
```

#### 6.8.2 Bậc doanh số tháng (Monthly Tier Bonus)

| Bậc | Doanh số tháng (đơn DELIVERED) | Bonus thêm | Tên hiển thị |
|-----|-------------------------------|------------|--------------|
| Tân binh | < 3.000.000đ | +0% | 🌱 Mầm vừa lên |
| Đồng | 3tr — 9.999.999đ | **+1%** | 🌿 Cộng tác viên Đồng |
| Bạc | 10tr — 29.999.999đ | **+2.5%** | 🌳 Cộng tác viên Bạc |
| Vàng | 30tr — 79.999.999đ | **+4%** | 🌲 Cộng tác viên Vàng |
| Kim Cương | ≥ 80.000.000đ | **+6%** | 💎 Cộng tác viên Kim Cương |

**Retroactive:** khi CTV vừa nâng bậc, toàn bộ đơn trong tháng được tính lại với rate mới, chênh lệch bù vào commission ledger ngay.

#### 6.8.3 Hold time & Wallet

- Hoa hồng CTV: hold **20 ngày** sau đơn `DELIVERED` (tránh hoàn hàng).
- Sau 20 ngày không có hoàn: `Commission.status → APPROVED` → cộng vào `wallet.withdrawable`.
- Min rút ngân hàng: **50.000đ**, miễn phí.
- Chuyển Ví Tubu (mua hàng): **bất kỳ lúc nào, bất kỳ số tiền, ×1.5**.

#### 6.8.4 Tạo link & Caption gợi ý

- Nút **"Chia sẻ — kiếm hoa hồng"** trên mọi trang sản phẩm (chỉ hiện khi role = AFFILIATE).
- 3 dạng link: deeplink mini app, web link, QR code có logo Tubu.
- **5-7 caption mẫu** theo sản phẩm (admin nhập qua bảng `AffiliateCaption`).
- Nút "Copy caption" → mở native share sheet.

#### 6.8.5 Dashboard CTV

Xem mock ASCII trong Design Brief mục 6.3 (AffiliateDashboardWidget). Key elements:
- Badge bậc hiện tại + % bonus.
- Progress bar đến bậc kế (với ước tính retroactive bonus nếu đạt).
- Tổng tháng: hoa hồng + đơn đang chạy + đã duyệt + rút được.
- KPI 4 con số: đơn thành công, khách mới, lượt click, tỷ lệ chuyển đổi.
- Bar chart 30 ngày.
- Đơn gần nhất với breakdown commission.
- Leaderboard top 20 CTV tháng.

**API:**
```
POST /api/affiliate/register
GET  /api/affiliate/me          → tier, monthly_revenue, kpis, next_tier_gap
GET  /api/affiliate/dashboard
GET  /api/affiliate/leaderboard
POST /api/affiliate/links       → {variationId|productId|brandId|homepage}
GET  /api/affiliate/links
GET  /api/affiliate/captions?productId=
GET  /api/affiliate/commissions?status=
POST /api/wallet/withdraw       → {amount, method:BANK|TUBU_WALLET}
GET  /api/wallet
```

### 6.9 Cashback mua sắm sàn ngoài

> **Đã chốt:** Tubu giữ **30%**, trả user **70%**. Hold **20 ngày**. Min rút STK **50k**. Chuyển vào Ví Tubu **×1.5 bất kỳ lúc nào**.

**Mô hình kinh tế (ví dụ Shopee):**
- Accesstrade trả Tubu 5% giá trị đơn (= 50.000đ trên đơn 1.000.000đ).
- User nhận **70% × 5% = 3.5%** (= 35.000đ).
- Tubu giữ **30% × 5% = 1.5%** (= 15.000đ).
- Nếu user chuyển sang Ví Tubu để mua hàng: được **35k × 1.5 = 52.500đ** (dù chỉ tốn của Tubu 35k vì hàng có margin sẵn).

**Hiển thị trên UI:**
- Trang merchant: **"Hoàn tiền 3.5%"** (con số user thực nhận, không show 5%/30/70 phức tạp).
- Banner ở top: *"💡 Chuyển vào Ví Tubu để mua sắm — Nhận thêm 50% (×1.5)"*

**Flow ghi nhận:**
1. User vào tab "Hoàn tiền mua sắm" → chọn merchant (Shopee/Lazada/Tiki/TikTok Shop...).
2. Click → backend `POST /api/cashback/click` tạo `CashbackClick` với `utmTraceId` duy nhất.
3. Backend gen deeplink Accesstrade thay `{{sub_id}} = utmTraceId`.
4. Mở app sàn qua `apis.openExternalUrl()` (mini app) hoặc redirect (web).
5. User mua → Accesstrade postback về Tubu webhook → tạo `CashbackTransaction` status `PENDING`.
6. Sau **20 ngày** kể từ postback `confirmed`:
   - Nếu không có rollback từ AT → status `CONFIRMED` → cộng vào `walletWithdrawable`.
   - Nếu sàn báo hoàn đơn → status `REJECTED`.

**Đối soát:**
- Cron hằng tuần kéo `GET /v1/transactions` từ Accesstrade so sánh.
- Manual claim flow: nếu user chứng minh đã đặt qua link mà chưa thấy cashback → form khiếu nại + admin xác minh thủ công.

**Hiển thị 3 trạng thái rõ ràng:**

```
┌──── HOÀN TIỀN MUA SẮM ────────────────┐
│                                        │
│  💰 Tổng số dư có thể rút: 187.000đ   │
│                                        │
│  📊 Trạng thái                         │
│  • Chờ duyệt (sẽ duyệt 20 ngày): 95k  │
│    └ Shopee #ATH123 — 95k             │
│       Hoàn vào 25/12/2025              │
│  • Đã duyệt sẵn rút: 187.000đ          │
│  • Đã rút tháng này: 320.000đ          │
│                                        │
│  [Rút về ngân hàng]                    │
│  [💎 Chuyển Ví Tubu ×1.5 = 280.500đ]  │
│                                        │
│  ─── LỊCH SỬ ─────────                 │
│  • 15/12 Tiki — 35k (Đã duyệt)        │
│  • 12/12 Shopee — 67k (Đang chờ)      │
└────────────────────────────────────────┘
```

**Anti-fraud:**
- 1 user × 1 merchant × 30 giây = 1 click (rate-limit).
- IP rate-limit toàn cục.
- KYC nhẹ khi rút STK lần đầu vượt 1tr (CCCD ảnh).
- Whitelist IP của Accesstrade cho webhook endpoint.

**API:** (xem mục 13)

### 6.10 Đại lý B2B

> **Đã chốt:** chiết khấu tối đa **45%**. Bảng giá theo bậc do Tubu input vào admin (không hard-code). Thưởng quý nếu đạt mốc doanh số.

#### 7.10.1 Bậc đại lý

> **Đây là default config — Tubu chỉnh sửa thoải mái trong admin.**

| Bậc | Điều kiện kích hoạt | Chiết khấu cơ bản | Hạn mức công nợ | Điều khoản TT |
|-----|--------------------|--------------------|-----------------|---------------|
| **Cấp 3 — Cộng tác bán lẻ** | Đơn đầu ≥ 3tr | **15%** | 0đ (prepay) | Trả trước 100% |
| **Cấp 2 — Đại lý phổ thông** | Doanh số ≥ 30tr/quý | **25%** | 5.000.000đ | NET 7 ngày |
| **Cấp 1 — Đại lý chính thức** | Doanh số ≥ 100tr/quý | **35%** | 20.000.000đ | NET 15 ngày |
| **Nhà phân phối khu vực** | Doanh số ≥ 300tr/quý + hợp đồng riêng | **45%** | 80.000.000đ | NET 30 ngày |

> Lý do dùng "Cấp 3 → Cấp 1" (ngược): user tâm lý thích "lên Cấp 1" hơn "lên Cấp 3". Đồng nhất với tier loyalty (Mầm Xanh → Cổ Thụ).

#### 7.10.2 Cơ chế bảng giá

- **Không hard-code chiết khấu trong code**. Mỗi `Variation` có trường `dealerPrices` (JSON):

```json
{
  "tier_3": 170000,    // Cấp 3 giá nhập
  "tier_2": 150000,    // Cấp 2
  "tier_1": 130000,    // Cấp 1
  "distributor": 110000 // NPP khu vực
}
```

- Khi sync sản phẩm từ Pancake, các trường này được giữ nguyên (Pancake không có khái niệm dealer tier).
- Admin có UI **upload Excel** để cập nhật bảng giá hàng loạt: cột [SKU, Cấp 3, Cấp 2, Cấp 1, NPP].
- Validation: dealer price không được cao hơn retail × (1 - max_discount_45%).
- Lịch sử thay đổi giá lưu trong `DealerPriceHistory` để truy vết.

#### 7.10.3 Thưởng quý theo doanh số (Quarterly Bonus)

> Cấu hình trong admin. Cuối quý, cron tính + xuất report.

| Đạt | Thưởng thêm | Hình thức |
|-----|-------------|-----------|
| 80% mục tiêu quý | +0% (giữ bậc) | Email công nhận |
| 100% mục tiêu quý | **+1%** trên tổng doanh thu quý | Tiền mặt vào tài khoản đại lý |
| 120% mục tiêu quý | **+2%** | Tiền mặt |
| 150% mục tiêu quý | **+3%** + xét nâng bậc sớm | Tiền mặt + ưu đãi nâng bậc |
| 200% mục tiêu quý | **+5%** + voucher du lịch / trip đối tác | Tiền mặt + Quà đặc biệt |

**Ví dụ:**
- Đại lý Cấp 2 mục tiêu quý 30tr. Đạt 65tr (216%) → bonus 5% × 65tr = **3.250.000đ tiền mặt** + voucher trip.

#### 7.10.4 Flow đăng ký đại lý

1. User mở mini app → role `CUSTOMER` → vào "Đăng ký đại lý".
2. Form: tên cửa hàng, MST (nếu có), người đại diện, SĐT, địa chỉ kho, **upload ảnh CCCD 2 mặt** + **GPKD/ảnh cửa hàng** (option), ước lượng doanh số/tháng, lý do muốn làm đại lý.
3. Submit → status `PENDING`.
4. Admin nhận notification → review trong 24h → APPROVED/REJECTED.
5. APPROVED → role chuyển `DEALER` + gán `DealerTier` (mặc định Cấp 3) + email/ZNS welcome có hướng dẫn dùng.

#### 7.10.5 UI Đại lý (siêu tối ưu cho tốc độ)

Đại lý KHÔNG cần xem ảnh đẹp, đánh giá. Họ cần: **đặt đơn nhanh, biết giá nhập, theo dõi công nợ**.

**Khi role = `DEALER`, app chuyển sang Dealer Mode:**

- Bottom tab: **Trang chủ B2B / Bảng giá / Đặt nhanh / Công nợ / Cá nhân**.
- Theme khác (xanh navy + xám đậm) để phân biệt visually với mode bán lẻ.
- Header có toggle nhỏ "Chuyển sang mua lẻ" (đại lý có thể mua nhỏ cá nhân với giá lẻ).

**Màn hình "Bảng giá":**
- Table dày, cột [SKU | Tên rút gọn | Đơn vị | Giá nhập | Tồn]. Sticky header.
- Search realtime theo SKU/tên + filter theo brand.
- Sort theo brand → category → SKU.
- Nút "Export Excel" + "In bảng giá PDF" để in cho khách của đại lý xem.

**Màn hình "Đặt nhanh" (Quick Order)** — đây là **điểm bứt phá lớn nhất so với Sinh Dược**:
- 3 cách input:
  1. **Quét barcode** sản phẩm (gói `apis.scanQRCode` của ZMP).
  2. **Gõ SKU thủ công** (autocomplete sau 3 ký tự).
  3. **Paste từ Excel/Sheet** — paste 1 cột SKU và 1 cột số lượng → tự parse thành đơn.
- **Mẫu đơn (Templates)**: đại lý lưu các combo hay đặt → next time chỉ 1 click "Nhập lại mẫu cũ".
- Hiển thị inline: stock realtime, giá nhập, thành tiền running total.
- Submit → tạo `Order` type `DEALER`, push Pancake với tag `dealer:tier_X`.

**Màn hình "Công nợ":**
- Số dư đang nợ + hạn mức.
- Cảnh báo đỏ nếu sắp/đã quá hạn thanh toán.
- Nút "Báo đã chuyển khoản" → upload ảnh ủy nhiệm chi → admin verify.
- Lịch sử giao dịch ledger đầy đủ.

#### 7.10.6 API

```
POST  /api/dealer/apply
GET   /api/dealer/me
GET   /api/dealer/pricelist?format=json|csv|xlsx|pdf
POST  /api/dealer/orders                          → body: {items: [{sku, quantity}], note?, shippingAddress}
POST  /api/dealer/orders/from-text                → paste text, parse SKU + qty
GET   /api/dealer/orders
GET   /api/dealer/order-templates
POST  /api/dealer/order-templates                 → save current cart as template
GET   /api/dealer/credit-ledger
POST  /api/dealer/credit-payment                  → upload bằng chứng chuyển khoản
GET   /api/dealer/quarterly-report
```

#### 7.10.7 Admin tools

- Upload bảng giá Excel cho từng `DealerTier`.
- Approve/reject dealer applications.
- Set quý mục tiêu cho từng đại lý (cá nhân hóa) hoặc batch theo bậc.
- Dashboard quý: doanh số/đại lý, bonus dự kiến, nợ.

### 6.11 Thông báo (ZNS / OA / In-app)

**ZNS templates cần đăng ký với Zalo (ưu tiên duyệt sớm):**

| Code | Tình huống | Channel |
|------|------------|---------|
| `OTP_LOGIN` | Gửi OTP đăng nhập | ZNS |
| `ORDER_CONFIRMED` | Đơn đã xác nhận | ZNS |
| `ORDER_SHIPPING` | Đang giao + mã vận đơn | ZNS |
| `ORDER_DELIVERED` | Đã giao, gợi ý review | ZNS |
| `INVOICE_ISSUED` | Hóa đơn VAT đã phát hành | ZNS |
| `COMMISSION_APPROVED` | Hoa hồng được duyệt | ZNS |
| `CASHBACK_CONFIRMED` | Cashback xác nhận | ZNS |
| `COUPON_BIRTHDAY` | Voucher sinh nhật | ZNS |
| `POINTS_EXPIRING` | Điểm sắp hết hạn | OA broadcast |
| `FLASH_SALE` | Flash sale | OA broadcast |

**In-app push:**
- Badge "Đơn mới về", "Có nhiệm vụ mới", "Cây sắp lên cấp".
- Implement dùng Pull khi mở app + Server-Sent Events tùy chọn.

### 6.12 Tìm kiếm & gợi ý

- Backend Meilisearch index: name, shortDesc, brand, tags, ingredients (tiếng Việt có/không dấu nhờ tokenizer custom).
- Gợi ý realtime: typeahead, hiển thị ảnh.
- "Gợi ý cho bạn": dùng đơn giản (collaborative + content-based) — phase 1 chỉ cần rule: same brand + same category + best-seller.
- "Thường mua kèm": co-occurrence trên orders trong 90 ngày.

### 6.13 Đánh giá sản phẩm

- Chỉ cho phép review sau khi đơn `DELIVERED` và sản phẩm trong đơn.
- Có ảnh + sao + nội dung.
- Tích điểm review (10đ nếu có ảnh, 5đ nếu chỉ text).
- Admin có thể ẩn review vi phạm (không xóa, có log).
- Review hiển thị badge "Đã mua" để tăng tin cậy.


### 6.14 Tính năng bứt phá so với Sinh Dược (Discovery)

> Sinh Dược (`zalo.me/s/873790322695213643`) đã có khá đầy đủ chức năng cơ bản nhưng UX rời rạc, không có cá nhân hóa, không có cashback sàn ngoài, dashboard CTV mỏng. Đây là các tính năng Tubu **làm mới hoặc làm tốt hơn hẳn** để bứt phá — toàn bộ **vào Phase 1 hoặc đầu Phase 2**, không phải backlog xa.

#### 7.14.1 Onboarding Quiz cá nhân hóa (Phase 1)

> Lý do làm: Tubu phân phối **đa thương hiệu, đa segment**. Khác Sinh Dược chỉ 1 brand. Nếu mở app ra hiển thị toàn bộ → user lạc lối.

**Flow user mới (lần đầu mở mini app):**
- 5 câu hỏi nhanh (skip được nhưng đẹp UI khuyến khích làm):
  1. *"Bạn quan tâm gì nhất?"* — Mỹ phẩm thiên nhiên / Tẩy rửa sinh học / Thực phẩm sạch / Quà tặng / Cho bé
  2. *"Bạn đang sống cùng?"* — Một mình / Vợ chồng / Có em bé / 3 thế hệ
  3. *"Vấn đề da/tóc của bạn?"* (chỉ hỏi nếu chọn mỹ phẩm) — Khô / Dầu / Mụn / Nhạy cảm / Tóc rụng
  4. *"Ngân sách thử sản phẩm mới?"* — Dưới 100k / 100k-300k / Trên 300k
  5. *"Bạn ưu tiên?"* — Giá rẻ / Chất lượng / Cam kết organic / Made in Vietnam

**Output:**
- Tự động set `user.forSegment = ["mom_baby","sensitive_skin"...]`.
- Home page hiển thị **brand + sản phẩm khớp segment** ngay đầu.
- Tặng **voucher chào mừng 30k** sau khi hoàn thành quiz (đơn ≥ 199k).
- Tạo `Mission` "Trải nghiệm gợi ý đầu tiên" — mua 1 trong các sản phẩm đề xuất → +50 điểm.

**Backend:** lưu `quizAnswers` vào `User.metadata`. Job retraining "gợi ý cho bạn" cứ 7 ngày.

#### 7.14.2 Brand Story Map — Tour ảo vùng nguyên liệu (Phase 1-2)

> Lý do làm: Tubu là cầu nối giữa nông dân Việt và người tiêu dùng. Sinh Dược không thể làm được vì 1 brand 1 vùng. Tubu có **6+ vùng đẹp**: Quảng Nam (Visante), Đắk Lắk (Pơ Lang), Trà Vinh (Sokfram), Lâm Đồng (Le Plateau Coffee), Đồng Tháp (Fuwa3e), Quảng Trị (Cobote)...

**Implementation:**
- Trang **"Câu chuyện"** trong app.
- Bản đồ Việt Nam interactive (SVG map, lib `react-simple-maps`).
- Tap mỗi tỉnh → mở popup:
  - Video 30s người dân làm sản phẩm (quay 1 lần, dùng mãi).
  - Story text ngắn về brand.
  - Ảnh GPS thực tế.
  - Link đến brand page mua hàng.
- Tap "Xem cây tôi đã trồng" (nếu đã chơi game ecocấp 10) → hiện ảnh cây thật với tọa độ.

**Lợi ích:** tăng giá trị cảm nhận, đặc biệt cho user lần đầu mua. Phù hợp share Facebook/Instagram.

#### 7.14.3 AI Tư vấn sản phẩm 24/7 (Phase 2)

> Sinh Dược không có. Đây là moat thật vì cần knowledge base + LLM integration.

**Implementation:**
- Chatbox trong app: *"Hỏi Tubu — Tư vấn miễn phí"*.
- Backend dùng **Claude API hoặc OpenAI** + RAG (Retrieval Augmented Generation):
  - Knowledge base nội bộ: thành phần, công dụng, cách dùng, câu chuyện brand, FAQ — embed sẵn vào Pinecone/Qdrant.
  - User hỏi: *"Con tôi 6 tháng tuổi bị rôm sảy, dùng sản phẩm gì?"* → AI gợi ý sản phẩm phù hợp + lý do + cách dùng + link mua.
- Fallback: nếu AI không chắc → đẩy sang tư vấn viên thật qua Zalo OA chat.
- Log câu hỏi → admin xem để bổ sung knowledge base.

**Ngân sách**: ~$0.005/query với Claude Haiku, RAG 1tr query/tháng = ~$5k chi phí AI → rất rẻ so với 1 nhân viên tư vấn.

#### 7.14.4 Subscribe & Save — Đặt định kỳ (Phase 2)

> Tubu có rất nhiều sản phẩm tiêu hao định kỳ: Fuwa3e rửa chén 3.8L (mỗi 6-8 tuần), dầu gội Visante (mỗi 4-6 tuần), sữa tắm cho bé... User Việt chưa quen với subscription nhưng đây là **cơ hội tăng LTV gấp 2-3 lần**.

**Cơ chế:**
- Trang sản phẩm có tab thứ 2: **"Đặt định kỳ — Tiết kiệm 12%"**.
- User chọn chu kỳ: 4 / 6 / 8 / 10 tuần.
- Auto-charge khi đến hạn (thẻ tín dụng / ZaloPay được token hóa).
- Có thể skip 1 kỳ / hủy / đổi sản phẩm bất kỳ lúc nào.
- Bonus: +20% điểm Xanh cho mỗi đơn subscription.

**Schema:**

```prisma
model Subscription {
  id           String @id @default(cuid())
  userId       String
  variationId  String
  quantity     Int
  intervalWeeks Int   // 4 | 6 | 8 | 10
  discountPct  Decimal @default(0.12)
  status       String  // ACTIVE | PAUSED | CANCELLED
  nextDeliveryAt DateTime
  paymentMethodToken String  // ZaloPay/CC token
  createdAt    DateTime @default(now())
}
```

#### 7.14.5 Refer 2 chiều (Phase 1)

> Mạnh hơn affiliate vì là user-to-friend 1-1, tỷ lệ convert cao.

**Khác với CTV:**
- CTV = chia sẻ link sản phẩm cho nhiều người, kiếm tiền.
- Refer = mời 1 bạn cụ thể, **cả 2 cùng nhận voucher**, không phải kiếm tiền.

**Cơ chế:**
- Mỗi user có `referralCode` unique.
- User A share code → bạn B nhập code khi đăng ký mini app.
- **B** nhận voucher **50k** đơn đầu (≥ 200k).
- **A** nhận voucher **50k** khi B đặt đơn đầu thành công.
- Nâng cấp: A mời được 5 người → tặng thêm hộp gift box.

#### 7.14.6 Refill / Đổi vỏ chai cũ lấy điểm (Phase 2)

> **Cực kỳ phù hợp brand "Sống xanh".** Sinh Dược không có. Cũng tạo lý do để user **quay lại cửa hàng vật lý** (nếu có) hoặc gửi vỏ về kho Tubu.

**Cơ chế:**
- User gửi ảnh vỏ chai sản phẩm Tubu (Fuwa3e, Visante, Pơ Lang...) qua app.
- AI / admin xác minh hợp lệ → tích **20-50 điểm Xanh / vỏ** tùy size.
- Tubu hợp tác với đơn vị tái chế thật (PRO Vietnam, Lagom Vietnam).
- Hiện counter trong profile: *"Bạn đã tái chế 12 vỏ chai, tiết kiệm 0.6kg nhựa thải"*.
- Share-worthy lên mạng xã hội.

#### 7.14.7 Lifecycle Reminder thông minh (Phase 1)

> Dùng dữ liệu lịch sử mua để **nhắc đúng lúc**.

**Cơ chế:**
- Backend tính trung bình chu kỳ mua lại của mỗi user × mỗi sản phẩm.
- Hoặc dùng default cycle theo loại sản phẩm (Fuwa3e 3.8L = 60 ngày, dầu gội 500ml = 45 ngày, son dưỡng = 90 ngày...).
- Sau (cycle × 0.85) ngày từ đơn cuối → push ZNS: *"Chai dầu gội Visante 500ml của bạn dự kiến sắp hết. Đặt lại trong 24h được giảm 10%"*.
- Quick reorder: 1 nút → cart auto fill → checkout.

**Schema bổ sung:**

```prisma
model ProductReorderCycle {
  productId    String
  defaultDays  Int  // theo loại
}

model UserReorderEstimate {
  userId       String
  variationId  String
  lastOrderAt  DateTime
  avgCycleDays Int       // computed từ lịch sử
  nextReminderAt DateTime
}
```

#### 7.14.8 Mua chung (Group Buy) (Phase 2)

> Viral feature. 1 user khởi xướng → mời bạn → đạt số lượng → tất cả cùng được giá.

**Cơ chế:**
- 1 user tạo "Mua chung" trên sản phẩm → share link cho bạn bè.
- Tối thiểu 3-5 người (theo sản phẩm) tham gia trong 48h → tất cả được giá giảm 15%.
- Nếu không đủ → hủy, không ai mất tiền.
- Người khởi xướng được thêm 5% giảm nữa (tổng 20%) như reward.

**Impact:** AOV cao + viral coefficient cao + giảm CAC.

#### 7.14.9 Review video ngắn (UGC) (Phase 2)

> Photo review đã thường. Video review 15-30s đang trend (Tiktok-style).

**Cơ chế:**
- Sau khi đơn `DELIVERED` 7 ngày → push: *"Quay video 15s chia sẻ — nhận 50 điểm Xanh + cơ hội xuất hiện trên trang chủ"*.
- Video lên trang sản phẩm tab "Trải nghiệm".
- Tubu chọn 5 video best/tháng → đăng feed Tiktok official → user nhận thêm 200k.
- Có thể tổng hợp thành quảng cáo paid sau khi xin consent.

#### 7.14.10 Wishlist + Price Drop Alert (Phase 1)

> Đơn giản nhưng Sinh Dược không làm. Tăng quay lại 30%.

**Cơ chế:**
- Tim/Save sản phẩm → vào Wishlist.
- Khi sản phẩm giảm giá / có voucher mới applicable → push ZNS *"Sản phẩm bạn yêu thích đang giảm 20%"*.

#### 7.14.11 Beta Tester Program (Phase 2)

> Hạng Đại Thụ/Cổ Thụ được nhận sản phẩm sắp ra mắt **miễn phí** đổi lấy review chi tiết.

**Cơ chế:**
- Mỗi tháng có 1-2 sản phẩm mới mở 50 slot beta cho user hạng cao.
- User apply → admin chọn dựa trên: hạng + lịch sử mua brand đó + số review trước đó.
- Nhận hàng → có 7 ngày để review (5 sao mandatory + ảnh + ý kiến).
- Feedback dùng cho launch chính thức → user thấy mình đóng góp thật → loyalty bonding.

#### 7.14.12 Community Feed nhẹ (Phase 2)

> Không full social network. Chỉ là feed các review có ảnh đẹp + Q&A.

**Cơ chế:**
- Tab "Cộng đồng" hiển thị:
  - Top review tuần (ảnh đẹp + nội dung sâu).
  - Q&A: user hỏi → user khác trả lời + admin verify.
  - Mẹo sống xanh do user chia sẻ (admin moderate).
- User trả lời được verify như "câu trả lời hay" → +20 điểm.

#### 7.14.13 So sánh tóm tắt Tubu vs Sinh Dược

| Tính năng | Sinh Dược | Tubu |
|-----------|-----------|------|
| Catalog đa brand | ❌ 1 brand | ✅ 10+ brand, có brand filter & story |
| Onboarding cá nhân hóa | ❌ | ✅ Quiz 5 câu → segment-based home |
| CTV dashboard có KPI thúc đẩy | ⚠️ có nhưng mỏng | ✅ KPI tháng + progress push + retroactive bonus |
| Cashback sàn ngoài | ❌ | ✅ Tích hợp Accesstrade, x1.5 wallet |
| Gamification gắn brand thật | ⚠️ rời rạc | ✅ Cây ảo → cây thật vùng nguyên liệu |
| AI tư vấn 24/7 | ❌ | ✅ Phase 2 |
| Subscribe & Save | ❌ | ✅ Phase 2 |
| Refill vỏ chai | ❌ | ✅ Phase 2 |
| Lifecycle reminder thông minh | ❌ | ✅ Phase 1 |
| Mua chung | ❌ | ✅ Phase 2 |
| Đại lý "đặt nhanh" | ⚠️ chậm | ✅ Barcode + paste Excel + templates |
| Wishlist + Price drop | ❌ | ✅ |
| Beta tester | ❌ | ✅ |
| Brand Story Map | ❌ | ✅ Tour ảo vùng nguyên liệu |
| Group / Community | ❌ | ✅ Phase 2 |

---

---

## 7. UI Guideline (Code-Ready)

> **Đây là phần UI/UX dành riêng cho developer.** Mọi token đã đủ để code Tailwind/CSS. Phần "lý do thiết kế, persona" xem `DESIGN_BRIEF.md` nếu muốn hiểu sâu.

### 7.1 Brand & Design Principles (rút gọn)

**Brand DNA:** "Sống xanh An Lành" — ấm áp, gần gũi, thiên nhiên Việt. KHÔNG sang chảnh xa cách, KHÔNG urgent sale style.

> ⚠️ **Màu chính xác từ logo thật (eyedropped):** Primary = **cam #E08C1C** (chữ "Tubu Tree"), Secondary = **xanh lá #509018** (tagline). Toàn bộ token đã cập nhật theo đúng màu logo.

**7 nguyên tắc code phải tuân thủ:**
1. **Tự nhiên hơn tiệt trùng** — đường cong mềm (radius 10-16px), không góc vuông cứng.
2. **Tử tế hơn khẩn cấp** — KHÔNG countdown đỏ chớp, KHÔNG "Chỉ còn 3 sp", microcopy nhẹ nhàng.
3. **Một bước, một mục đích** — mỗi screen 1 primary CTA rõ.
4. **Hiển thị niềm tin** — sản phẩm hiển thị: nguồn nguyên liệu, chứng nhận, badge.
5. **Khoảng trắng rộng** — padding ≥ 16px ngoài, gap ≥ 12px giữa block.
6. **Thumb-reach** — CTA chính nằm ở 1/3 dưới mobile.
7. **Tự hào Việt** — Be Vietnam Pro font, ngôn ngữ Việt chuẩn, KHÔNG emoji thô tre/nón lá.

### 7.2 Design Tokens (copy thẳng vào tailwind.config.js)

```javascript
// packages/ui/tailwind-tokens.js
module.exports = {
  colors: {
    // Primary — Lá tươi
    green: {
      50:  '#F1F8F2',
      100: '#DDEDE0',
      200: '#B5D6BD',
      400: '#5FA376',
      600: '#2E7D4F',  // ⭐ Primary brand
      700: '#235F3D',
      900: '#0F2D1C',
    },
    // Secondary — Đất sét
    clay: {
      50:  '#FBF4ED',
      200: '#EDD4BD',
      500: '#C97B4A',  // ⭐ Voucher, hạng, sale (mềm)
      700: '#8C4F2A',
    },
    // Accent — Nắng
    sun: {
      300: '#FDD96E',
      500: '#F4B400',  // ⭐ Star rating, badge hạng cao
    },
    // Neutral (warm white)
    neutral: {
      0:   '#FFFFFF',
      50:  '#FAFAF8',  // ⭐ App background (KHÔNG #FFF tinh)
      100: '#F2F2EF',
      200: '#E5E5E0',
      400: '#A8A8A0',
      600: '#5F5F58',
      900: '#1A1A17',
    },
    // Semantic
    success: '#2E7D4F',  // = green-600
    warning: '#E58B00',
    danger:  '#C73E3E',  // dịu hơn red thường
    info:    '#3D7BB8',

    // Brand accent (cho từng thương hiệu - dùng làm chip/tag)
    brand: {
      visante:  '#8B3A3A',  // sâm nâu đỏ
      polang:   '#D4843E',  // bơ cam
      cobote:   '#E8D9B5',  // dừa kem (text dark)
      fuwa3e:   '#E8B72C',  // vàng dứa
      babycare: '#A8D8E8',  // xanh em bé
      bhnong:   '#7A5C3A',  // nâu lúa
      sokfram:  '#DCA84A',  // vàng mật
      coffee:   '#4A2C20',  // nâu cà phê (Le Plateau)
      moshav:   '#7A8B5C',  // xanh oliu
      hector:   '#6B6B6B',  // xám
    },
  },
  fontFamily: {
    sans: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
    body: ['Inter', 'system-ui', 'sans-serif'],     // cho text dài (blog, story)
    mono: ['"JetBrains Mono"', 'monospace'],        // cho SKU, order code
  },
  fontSize: {
    // [size, lineHeight]
    'display-lg': ['32px', { lineHeight: '1.15', fontWeight: '700' }],
    'display-md': ['28px', { lineHeight: '1.2',  fontWeight: '700' }],
    'h1':         ['24px', { lineHeight: '1.25', fontWeight: '700' }],
    'h2':         ['20px', { lineHeight: '1.3',  fontWeight: '600' }],
    'h3':         ['18px', { lineHeight: '1.35', fontWeight: '600' }],
    'body-lg':    ['16px', { lineHeight: '1.5',  fontWeight: '400' }],
    'body-md':    ['14px', { lineHeight: '1.5',  fontWeight: '400' }],
    'body-sm':    ['13px', { lineHeight: '1.45', fontWeight: '400' }],
    'label':      ['12px', { lineHeight: '1.3',  fontWeight: '500' }],
  },
  spacing: {
    // 8pt grid
    '0': '0px', '1': '4px', '2': '8px', '3': '12px',
    '4': '16px', '5': '20px', '6': '24px', '8': '32px',
    '10': '40px', '12': '48px', '16': '64px', '20': '80px',
  },
  borderRadius: {
    none: '0',
    sm:   '6px',   // chip, tag
    md:   '10px',  // ⭐ default cho input, button
    lg:   '16px',  // card
    xl:   '24px',  // bottom sheet, modal
    full: '9999px',
  },
  boxShadow: {
    // Tint xanh đậm thay vì pure black
    xs:    '0 1px 2px rgba(92,52,10,0.04)',
    sm:    '0 2px 6px rgba(92,52,10,0.06)',     // ⭐ card mặc định
    md:    '0 4px 12px rgba(92,52,10,0.08)',
    lg:    '0 12px 32px rgba(92,52,10,0.12)',
    focus: '0 0 0 3px rgba(224,140,28,0.25)',    // focus ring
  },
  screens: {
    sm:  '640px',
    md:  '768px',
    lg:  '1024px',
    xl:  '1280px',
    '2xl': '1536px',
  },
  zIndex: {
    base: '0', dropdown: '10', sticky: '20', overlay: '30',
    modal: '40', popover: '50', toast: '60', tooltip: '70',
  },
};
```

### 7.3 Component Library — phải implement (priority P1)

Implement trong `packages/ui/`, dùng chung cả mini app + web. Mỗi component: variants, states, props rõ ràng. Lib base: **ZaUI** cho mini app, **shadcn/ui** cho web — wrap qua `packages/ui` để có cùng API.

#### Atoms (P1)
- `<Button>` — variants: `primary | secondary | tertiary | danger | clay`. Sizes: `sm 32 | md 44 | lg 52`. States: default, hover, pressed, focused, disabled, loading. Width: auto | full. Slot: leftIcon, rightIcon.
- `<Input>` — types: text, password, number, phone, OTP (6 ô), search. States: default, focused, error, disabled, success. Affixes prefix/suffix icon, clear button, character counter, helper/error text.
- `<Select>` — native trên mobile, custom có search trên web khi >10 option.
- `<Checkbox>`, `<Radio>` — touch target 24px, hit area 44px.
- `<Switch>` — chỉ dùng cho setting, không cho lựa chọn quan trọng.
- `<Chip>` — variants: filter (selectable), info (read-only), brand (gắn brand accent color).
- `<Badge>` — số đỏ trên icon, brand badge, status badge (Mới/Sale/Hết hàng).
- `<Avatar>` — sizes 24/32/40/56/80. Fallback: chữ đầu tên nền green-100.
- `<Divider>` — solid + dashed.
- `<Skeleton>` — shimmer animation 1.4s loop.
- `<Toast>` — auto-dismiss 3s, có action button. Variants info/success/warning/error.
- `<Spinner>` — inline + page-level + linear progress (upload, checkout step).

#### Molecules (P1)
- `<ProductCard>` — **component dùng nhiều nhất**. 3 variants: vertical (grid 2 col), horizontal (list), compact (mini). 3 modes: B2C (rating + sale), Affiliate (hoa hồng + share btn), Dealer (giá nhập + SKU + stock + qty). States: in-stock, low-stock (badge "Còn 3"), out-of-stock (overlay gray).
- `<PriceTag>` — current + struck original + % discount + range. Variant Affiliate có hoa hồng dự tính.
- `<QuantitySelector>` — `- [1] +` touch target lớn.
- `<AddressCard>` — recipient + phone + full address + "Mặc định" badge.
- `<OrderItem>` — ảnh + tên + variation + qty + giá.
- `<StepIndicator>` — checkout 3 bước.
- `<TabBar>` — bottom navigation 5 tabs, active state green-600.
- `<SegmentedControl>` — toggle "B2C / Đại lý", tab "Hoa hồng / Cashback".
- `<EmptyState>` — illustration + heading + body + CTA. Reusable mọi case (bắt buộc, xem 8.7).
- `<FilterChipGroup>` — horizontal scroll.
- `<NotificationItem>` — icon + title + body + timestamp + dot unread.
- `<ReviewCard>` — avatar + sao + tên + "Đã mua" badge + body + ảnh strip.

#### Organisms (P1)
- `<BottomSheet>` — slide từ dưới có drag handle. Dùng cho chọn variation, áp voucher, confirm hủy đơn.
- `<Modal>` — center overlay, chỉ cho important confirm.
- `<ProductGallery>` — carousel ảnh 1:1 + thumbnail strip + pinch-zoom + share.
- `<VariationSelector>` — dung tích/hương/màu, giá update realtime.
- `<CartSummary>` — sticky bottom, subtotal/voucher/ship/total + CTA Checkout.
- `<PaymentMethodList>` — radio list có logo (COD, ZaloPay, Bank, Credit Card).
- `<OrderStatusTimeline>` — vertical timeline 5 step (Đã đặt → Xác nhận → Đóng gói → Vận chuyển → Giao thành công) với thời gian thật.
- `<LoyaltyTierProgress>` — visual cây nhỏ → cây lớn, progress bar gradient green-200 → green-600.
- `<AffiliateDashboardWidget>` — KPI cards + progress bar đẩy bậc + chart 30 ngày + đơn gần nhất. Tham chiếu mock ASCII trong Section 7.8.3 (file SPEC v1.1).
- `<CashbackMerchantGrid>` — grid 3 col logo + tỉ lệ hoàn.
- `<GameSpinWheel>` — 9 phần, animation 3-4s spring → land + popup confetti.
- `<TreeGardenView>` — isometric grid, mỗi cây thuộc 1 brand với accent color, 10 stage growth.
- `<BrandStoryMap>` — VN map SVG, 6 hotspot tỉnh, tap → popup.
- `<DealerPriceTable>` — table dày: SKU | Tên | Giá lẻ | Giá nhập | CK% | Tồn | [Đặt]. Sticky header, sort, filter.
- `<QuickOrderBar>` — SKU input + qty + "Thêm" + nút "Paste Excel".

### 7.4 Mini App constraints

- **Viewport:** 375px (iPhone) → 414px (Plus). Safe area top 44pt (notch), bottom 34pt.
- **Top header:** Zalo provide (~44pt), KHÔNG design vào.
- **Bottom tab bar:** 56pt + safe area, designer/dev tự code.
- **Bundle size:** < 1MB initial. Lazy load game canvas, video player.
- **Modal pattern:** Bottom sheet > center modal trên mobile.
- **Không edge-swipe-back trên Android** → cần nút back tường minh.

### 7.5 Voice & Tone (UI Copy rules)

> Mọi string trong app phải qua bộ filter này. Tạo file `apps/miniapp/src/i18n/vi.json` + dùng key tham chiếu, không hard-code chuỗi vào JSX.

**Quy tắc:**
1. Ngôi xưng: "Bạn" / "Tubu Tree" (KHÔNG "anh/chị", "shop", "chúng tôi" trừ chính sách formal).
2. Câu ngắn: ≤ 12 từ.
3. Việt thuần: "Mời 3 bạn — nhận voucher" không "Refer 3 friends".
4. Tích cực: "Còn 3 ngày để giữ hạng" thay "Bạn sắp rớt hạng".
5. Đồng cảm: lỗi gì cũng KHÔNG đổ tại user.

**Bảng từ vựng UI (bắt buộc):**

| Tình huống | Dùng | Tránh |
|------------|------|-------|
| Đặt đơn xong | "Cảm ơn bạn đã chọn Tubu" | "Đặt hàng thành công" |
| Empty cart | "Giỏ còn trống đấy" | "No items in cart" |
| Hết hàng | "Tạm hết — sẽ về sớm" | "Out of stock" |
| Voucher hết hạn | "Voucher này đã ngừng" | "Voucher expired" |
| Loading | "Đang chuẩn bị cho bạn..." | "Loading..." |
| Lỗi server | "Có chút trục trặc, thử lại nhé" | "Server error 500" |
| CTA mua | "Thêm vào giỏ" | "Add to cart" |
| CTA share CTV | "Chia sẻ — kiếm 45k" | "Share to earn commission" |
| Lên hạng | "Chúc mừng! Bạn vừa lên Đại Thụ 🌳" | "Tier upgraded" |
| Tier requirement | "Còn 2 đơn nữa là Đại Thụ" | "Need 2 more orders" |
| Confirm hủy | "Bạn muốn hủy đơn này?" | "Cancel order?" |
| Login | "Tiếp tục với Zalo" | "Login with Zalo" |

### 7.6 Animation & Microinteractions

**Nguyên tắc:**
- Duration: 200ms micro, 300-400ms transition. KHÔNG > 500ms.
- Easing: chủ yếu `ease-out` (cảm giác lá rơi). Tránh `ease-in-out` cứng.
- Spring physics: chỉ cho game (cây lớn, vòng quay).
- Respect `prefers-reduced-motion` setting.
- Test trên Android low-end (Samsung A series cũ) — 60fps.

**Catalog actions cần animate:**

| Action | Animation |
|--------|-----------|
| Add to cart | Sản phẩm "bay" parabola về icon cart, cart badge bounce +1 |
| Pull-to-refresh | Lá xoay tròn, hết = fall xuống |
| Tab switch | Slide ngang 200ms ease-out |
| Modal open | Fade overlay 200ms + slide-up sheet 300ms ease-out |
| Heart wishlist | Pulse + đổi màu fill |
| Voucher apply success | Confetti nhẹ 1.5s + price update slide |
| Tree level up | Cây zoom + sparkle |
| Spin wheel | Spin 3-4s spring easing → slow out → pin land |
| Daily check-in | Hạt giống bay vào "kho hạt", counter +1 |
| Order success | Checkmark draw 600ms + scale-in icon |
| Loading skeleton | Shimmer left → right 1.4s loop |
| Tier up notification | Badge xoay 360° + scale 1.2 → 1 + glow |

**Haptic (mini app via Zalo SDK):**
- Light: tap chip, toggle.
- Medium: add to cart success.
- Heavy: order placed, level up, big reward.

### 7.7 Empty / Error / Loading states

**Nguyên tắc bắt buộc:** Mỗi state có illustration riêng + copy + CTA. KHÔNG bao giờ chỉ "No data".

**Empty states checklist (P1):**

| Context | Illustration | Heading | Body | CTA |
|---------|-------------|---------|------|-----|
| Cart trống | Rổ tre + lá | "Giỏ còn trống đấy" | "Khám phá sản phẩm Tubu chọn riêng cho bạn" | "Khám phá ngay" |
| Wishlist trống | Cây non chưa nở | "Chưa có sản phẩm yêu thích" | "Bấm tim để lưu sản phẩm bạn thích" | "Xem sản phẩm" |
| Order list trống | Hộp + sticky note | "Bạn chưa có đơn nào" | "Mua đơn đầu — nhận 30k voucher" | "Bắt đầu mua" |
| Search no result | Kính lúp + lá | "Không tìm thấy '<keyword>'" | "Thử từ khóa khác hoặc xem brand" | "Xem theo brand" |
| Voucher trống | Phong thư cuộn | "Chưa có voucher nào" | "Tích đơn để nhận voucher tự động" | "Khám phá" |
| Notification trống | Chuông gió | "Không có thông báo mới" | — | — |
| Affiliate links trống | Link chain + lá | "Bạn chưa tạo link nào" | "Mở 1 sản phẩm và bấm Chia sẻ" | "Xem sản phẩm" |
| Tree garden trống | Đất nâu | "Khu vườn chưa có cây" | "Check-in mỗi ngày để nhận hạt giống" | "Check-in ngay" |

**Error states:**

| Type | Display | Copy |
|------|---------|------|
| Network offline | Banner top + offline page | "Mất kết nối. Tubu sẽ thử lại khi có mạng" |
| API timeout | Toast + nút retry | "Hơi chậm tí, bạn đợi nhé" |
| 404 | Full page | "Trang này lạc đường rồi" + nút về home |
| 500 | Full page | "Tubu đang sửa lại — quay lại sau ít phút nhé" |
| Out of stock checkout | Inline cart | "Sản phẩm vừa hết — Tubu sẽ gợi ý tương tự" |
| Payment failed | Modal | "Thanh toán chưa thành công. Thử lại hoặc đổi cách khác?" |

**Loading states:**
- First load: full skeleton (KHÔNG spinner toàn màn hình).
- Subsequent: spinner inline ở vùng đang load.
- Long task > 2s: "Đang chuẩn bị..." + progress nếu biết.
- **Optimistic UI** cho: add to cart, like, check-in — update UI ngay, rollback nếu fail.

### 7.8 Accessibility (bắt buộc check trước PR)

- [ ] Text contrast ≥ 4.5:1 trên nền (WCAG AA).
- [ ] Text size base 14px+, scalable lên 1.5× (chế độ "Chữ to" cho user lớn tuổi).
- [ ] Touch target ≥ 44×44pt cho mọi action.
- [ ] Focus state rõ ràng (3px ring xanh — `shadow-focus` token).
- [ ] Form labels rõ — KHÔNG chỉ dùng placeholder.
- [ ] Error message kèm icon + màu (KHÔNG chỉ màu).
- [ ] Tab order hợp lý trên web.
- [ ] Alt text cho mọi ảnh sản phẩm.
- [ ] `aria-label` cho icon-only button.
- [ ] Skip-to-content link trên web.
- [ ] Reduced motion respect.
- [ ] Heading hierarchy đúng (h1 → h2 → h3).
- [ ] `lang="vi"` attribute trên web.

### 7.9 Theme switch B2C ↔ Dealer

**Khi user role = `DEALER`, app chuyển sang Dealer Mode hoàn toàn khác:**

| Aspect | B2C Mode | Dealer Mode |
|--------|----------|-------------|
| Primary color | `orange-600` `#E08C1C` (cam logo) | `slate-700` `#334155` (navy-gray) |
| Background | `neutral-50` (warm white) | `slate-50` `#F8FAFC` |
| Tab bar | Trang chủ / Danh mục / Quét QR / Nhiệm vụ / Cá nhân | Trang chủ B2B / Bảng giá / Đặt nhanh / Công nợ / Cá nhân |
| ProductCard | Có ảnh đẹp, rating, sale | Compact: SKU + Tên + Giá nhập + Stock + Nút "+" |
| Game/Voucher/Cashback | Hiện đầy đủ | **ẨN HOÀN TOÀN** |
| Density | Trung bình (thoáng) | Cao (table dày) |
| Animation | Đầy đủ | Tối giản (tốc độ quan trọng hơn) |
| Header có toggle | — | "Chuyển sang mua lẻ" small button (cho phép đại lý mua cá nhân) |

Implement: 1 root `<ThemeProvider mode={user.role}>` switch tokens, layouts, routes. KHÔNG có 2 codebase riêng.

### 7.10 Iconography

- **Library chính:** [Lucide Icons](https://lucide.dev) — `lucide-react` package. Stroke width 1.75. Sizes 16/20/24/32px. Radius 2px.
- **Custom icons cần vẽ riêng** (placeholder cho design team, dev import từ `packages/ui/icons`):
  - `TubuLeaf` (logo nhỏ)
  - `Seed` (hạt giống game currency)
  - `Tree1` → `Tree10` (cây 10 cấp growth)
  - `GreenPoint` (điểm Xanh loyalty)
  - `RegionPin` (pin có lá cho Brand Story Map)
  - `TierBadge_MamXanh`, `TierBadge_LocBiec`, `TierBadge_DaiThu`, `TierBadge_CoThu` (4 hạng loyalty)
  - `AffTier_TanBinh`, `AffTier_Dong`, `AffTier_Bac`, `AffTier_Vang`, `AffTier_KimCuong` (5 bậc CTV)
  - `DealerTier_Cap3`, `DealerTier_Cap2`, `DealerTier_Cap1`, `DealerTier_NPP` (4 bậc đại lý)

### 7.11 Illustration

- **Style:** flat illustration có **texture giấy nhẹ**, dùng color palette chính. Tham khảo Notion Vietnam, MoMo Hoàn Tiền.
- **KHÔNG dùng:** 3D blob, neumorphism, claymorphism, glassmorphism, stock photo phương Tây.

**Cần thiết kế (priority P1):**
1. Empty cart — rổ tre + 1 chiếc lá
2. Empty wishlist — cây non chưa nở
3. Onboarding hero — vườn 6 cây = 6 vùng nguyên liệu
4. Success order — gói hàng bọc giấy + sticky note "Cảm ơn"
5. Error 404 — chú chim đậu cành tìm tổ
6. Loading — animated leaf falling slow (Lottie)

---

## 8. Tích hợp Pancake POS (chi tiết)

> Base URL: `https://pos.pages.fm/api/v1` — auth bằng `api_key` query param hoặc header (xem doc tài khoản).

### 8.1 Setup
1. Lấy `shop_id` và `api_key` từ **Cấu hình → Webhook & API Key**.
2. Cấu hình webhook URL: `https://api.tubutree.com/webhooks/pancake` (endpoint backend).
3. Bật webhook events: `order.*`, `product.*`, `variation.stock_changed`, `invoice.issued`, `shipping.*`.
4. Lưu `PANCAKE_API_KEY`, `PANCAKE_SHOP_ID`, `PANCAKE_WEBHOOK_SECRET` vào env backend.

### 8.2 Sync sản phẩm (Pancake → Tubu)

**Job 1 (Initial):** `GET /api/v1/shops/{shop_id}/products?api_key=...&page=1` → loop pagination → upsert.

**Job 2 (Periodic):** mỗi 15 phút, fetch `?updated_since={lastRunISO}` để chỉ lấy đã đổi.

**Job 3 (Realtime via webhook):** nhận sự kiện → fetch product chi tiết → upsert.

**Mapping:**
```
Pancake field         → Tubu Product
product_id            → pancakeId
name                  → name
description           → description
images                → images
variations[i].id      → Variation.pancakeId
variations[i].sku     → sku
variations[i].fields  → attributes (size/scent...)
variations[i].retail_price → retailPrice
variations[i].sale_price → salePrice
variations[i].remain_quantity → stock
```

**Tự quản (Tubu ngoài Pancake):**
- `brand`, `forSegment`, `ingredients`, `certifications`, `slug`, SEO meta — sửa qua admin nội bộ.
- Khi sync, các trường này KHÔNG bị overwrite.

### 8.3 Tạo đơn (Tubu → Pancake)

`POST /api/v1/shops/{shop_id}/orders?api_key=...`

Body (rút gọn theo doc Pancake POS Open API):
```json
{
  "customer": {
    "name": "Nguyễn Văn A",
    "phone_number": "0901234567",
    "address": "...",
    "ward_id": "...",
    "district_id": "...",
    "province_id": "...",
    "fb_id": "<zalo_id_for_label>"
  },
  "items": [
    {
      "variation_id": "<pancake_variation_id>",
      "quantity": 2,
      "discount_each_product": 0
    }
  ],
  "shipping_fee": 30000,
  "total_discount": 50000,
  "tags": ["MINIAPP", "DEALER:GOLD"],
  "note": "Order code: TUBU20250001",
  "partner": { "partner_id": "<shipping_partner_id>" },
  "extension": { "external_order_id": "TUBU20250001" }
}
```

- `external_order_id`/`note` chứa `Order.code` để đối soát.
- Idempotency: nếu push lần 2 phát hiện trùng note `TUBU2025XXXX` → bỏ qua + lưu lại `pancakeOrderId`.

### 8.4 Webhook handler

```
POST /webhooks/pancake
Header: X-Pancake-Signature = HMAC-SHA256(body, PANCAKE_WEBHOOK_SECRET)

Body: { event: "order.status_updated", data: { ... } }
```

**Xử lý:**
1. Verify signature, fail → 401.
2. Lưu raw vào `PancakeWebhookEvent` với status `RECEIVED`.
3. Đẩy vào BullMQ queue `pancake-events`.
4. Worker xử lý theo `eventType`:
   - `order.created` (nếu order tạo từ Pancake admin, ngoài hệ thống) → map về user qua phone.
   - `order.status_updated` → update Order, push ZNS.
   - `order.shipping_updated` → update shippingStatus + history.
   - `order.cancelled` → set CANCELLED + reverse points + reverse commission.
   - `invoice.issued` → update invoiceUrl + push ZNS.
   - `variation.stock_changed` → update stock cache (nhẹ).
5. Mark `PROCESSED`.
6. Trả 200 ngay sau bước 2 để Pancake không retry (xử lý async).

### 8.5 Gọi phát hành hóa đơn
- Phụ thuộc cấu hình hợp đồng e-invoice trong Pancake (Viettel hoặc MISA). Khi tạo đơn có `extension.invoice_request: {tax_code, company_name, address, email}` Pancake sẽ tự phát hành sau khi đơn hoàn tất (theo cấu hình "Tự động phát hành" trong Pancake).
- Hoặc gọi endpoint `POST /api/v1/orders/{order_id}/issue-invoice` (xác nhận tên endpoint chính xác với Pancake support — tài liệu API chưa public toàn bộ).

### 8.6 Đối soát
- Cron hằng đêm: fetch orders mới từ Pancake `?updated_since=yesterday` + cross-check với DB local. Báo cáo discrepancy.

---

---

## 9. Tích hợp Accesstrade (cashback)

### 9.1 Setup
- Đăng ký Publisher: `accesstrade.vn` → có `publisher_id`, `accesstrade_token`.
- Bật **Postback URL**: `https://api.tubutree.com/api/cashback/postback/accesstrade`.
- Whitelist IP của Accesstrade trong firewall.

### 9.2 Lấy danh sách merchant + deeplink template
- Endpoint AT: `GET https://api.accesstrade.vn/v1/campaigns` (theo doc AT thời điểm tích hợp).
- Lưu merchant active vào `CashbackMerchant`.
- Mỗi merchant có template deeplink chứa `{{utm_content}}` hoặc tham số `aff_sub` để truyền `clickId`.

### 9.3 Gen deeplink
- Server-side gọi AT `POST /v1/product-link` với `url` (product page user click) + `utm_content=clickId`.
- Hoặc dùng landing chính: `https://gostore.accesstrade.vn/...?utm_content=clickId&campaign_id=...`.

### 9.4 Postback
- AT gọi:
```
POST /api/cashback/postback/accesstrade
{
  "utm_content": "clkXXXX",         // chính là clickId
  "order_id": "AT-ORD-12345",
  "amount": 350000,
  "commission": 17500,
  "status": "pending|approved|rejected",
  "campaign_id": "...",
  "timestamp": "..."
}
```
- Verify signature (AT có format riêng — tham khảo doc thời điểm tích hợp).
- Lookup `clickId` → `userId`.
- Tính `userReward = commission * (1 - margin)`.
- Tạo/update `CashbackTransaction`.

### 9.5 Đối soát
- Cron hằng tuần kéo report từ AT API `GET /v1/transactions?start_date=...` để so sánh.

---

---

## 10. Tích hợp thanh toán

### 10.1 ZaloPay

- Trong mini app: dùng **ZaloPay Mini App SDK** (`window.zlpSdk.Payment.openOrderPayment`) cho UX native.
- Trên web: dùng **ZaloPay Order API** tạo đơn → người dùng quét QR / mở app.

**Flow mini app:**
1. Frontend gọi `POST /api/payments/zalopay/create` → backend gọi ZaloPay tạo `orderToken` (theo doc ZaloPay Merchant).
2. Frontend gọi `zlpSdk.Payment.openOrderPayment({orderToken, ...})`.
3. ZaloPay trả callback success/fail → frontend gọi `POST /api/payments/zalopay/callback` xác nhận (server đối chiếu webhook).
4. Webhook ZaloPay → `POST /api/payments/webhook/zalopay` (verify MAC) → confirm `Order.paymentStatus=PAID`.

### 10.2 Thẻ tín dụng / Ghi nợ (Credit/Debit Card)
- Provider gợi ý: **OnePay** (cổng VN, hỗ trợ Visa/Master/JCB) hoặc **Stripe** (chuẩn quốc tế, hỗ trợ Apple/Google Pay).
- Web: nhúng widget thanh toán trong checkout.
- Mini app: mở browser ngoài thông qua `apis.openExternalUrl()` đến trang thanh toán hosted của provider.
- Token hóa thẻ để hỗ trợ **Subscribe & Save** (7.14.4) — chỉ dùng nếu user opt-in.
- Webhook callback verify chữ ký theo doc provider.

### 10.3 COD
- Không tích hợp gì, đơn ở Pancake tự xử lý.
- Hạn mức max: 5tr/đơn (config được, tránh rủi ro hủy đơn lớn).

### 10.4 Bank transfer
- Sinh QR VietQR có nội dung `TUBU<orderCode>` để team kế toán đối soát.
- Tích hợp **Casso** hoặc **TPBank API** để tự động ghi nhận thanh toán (tùy chọn).

---

---

## 11. Tích hợp ZNS & Zalo OA

### 11.1 ZNS (Zalo Notification Service)
- Đăng ký template trong **Zalo Business** → có `template_id` cho mỗi nội dung.
- Backend gọi `POST https://business.openapi.zalo.me/message/template` với `phone` + `template_id` + `template_data`.
- Lưu access token OA (refresh mỗi 90 ngày — set cron tự refresh).

### 11.2 OA Broadcast
- Dùng cho marketing campaign (Flash sale, sản phẩm mới).
- Quản lý qua admin panel (tạo segment user → chọn template → send).

### 11.3 In-app message từ OA
- Khi user "Follow" OA: được nhận tin trong app Zalo.
- Mini app có nút **Theo dõi OA** ở Home (gọi `apis.followOA({id: "<oa_id>"})`).

---

---

## 12. API Contract (REST)

> Toàn bộ endpoint trả JSON, prefix `/api`. Auth qua Bearer JWT. OpenAPI 3.1 file phát sinh từ NestJS, đẩy `/api/docs` (Swagger UI).

### 12.1 Convention
- Pagination: `?page=1&limit=20` → response `{ data: [...], meta:{ page, limit, total } }`.
- Error: `{ error: { code: "VALIDATION_FAILED", message: "...", details: {...} } }`.
- Timestamp: ISO 8601, UTC.
- Field naming: camelCase (FE Vietnamese reading-friendly).
- Idempotency: header `Idempotency-Key` cho POST tạo order, payout, withdraw.

### 12.2 Danh sách endpoint chính

```
# Auth & user
POST   /api/auth/zalo-mini-app
POST   /api/auth/zalo-oauth
POST   /api/auth/otp/send
POST   /api/auth/otp/verify
POST   /api/auth/refresh
POST   /api/auth/logout
GET    /api/me
PATCH  /api/me
GET    /api/me/addresses
POST   /api/me/addresses
PATCH  /api/me/addresses/:id
DELETE /api/me/addresses/:id

# Catalog
GET    /api/products
GET    /api/products/:slug
GET    /api/products/:slug/related
GET    /api/brands
GET    /api/brands/:slug
GET    /api/categories
GET    /api/search/suggest

# Cart & Checkout
GET    /api/cart
POST   /api/cart/items
PATCH  /api/cart/items/:id
DELETE /api/cart/items/:id
POST   /api/cart/coupon
DELETE /api/cart/coupon
POST   /api/checkout/quote
POST   /api/checkout/place-order

# Orders
GET    /api/orders
GET    /api/orders/:code
POST   /api/orders/:code/cancel
POST   /api/orders/:code/repurchase
POST   /api/orders/:code/issue-invoice
POST   /api/orders/:code/track  (force refetch from pancake)

# Payments
POST   /api/payments/zalopay/create
POST   /api/payments/zalopay/callback
POST   /api/payments/vnpay/create
POST   /api/payments/webhook/zalopay
POST   /api/payments/webhook/vnpay

# Loyalty
GET    /api/me/loyalty
GET    /api/me/points/transactions
POST   /api/me/redeem-points
GET    /api/me/coupons

# Game
POST   /api/game/check-in
GET    /api/game/profile
POST   /api/game/spin
GET    /api/game/quiz/today
POST   /api/game/quiz/:id/answer
GET    /api/game/missions
GET    /api/game/leaderboard

# Affiliate (CTV)
POST   /api/affiliate/register
GET    /api/affiliate/me
POST   /api/affiliate/links
GET    /api/affiliate/links
GET    /api/affiliate/dashboard
GET    /api/affiliate/commissions
POST   /api/affiliate/payouts
GET    /api/r/:shortCode  (redirect, web only)

# Cashback (sàn ngoài)
GET    /api/cashback/merchants
POST   /api/cashback/click
GET    /api/cashback/transactions
POST   /api/cashback/postback/accesstrade  (webhook)

# Wallet
GET    /api/me/wallet
POST   /api/wallet/withdraw

# Dealer
POST   /api/dealer/apply
GET    /api/dealer/me
GET    /api/dealer/pricelist
POST   /api/dealer/orders
GET    /api/dealer/orders
GET    /api/dealer/credit-ledger
POST   /api/dealer/credit-payment

# Reviews
POST   /api/products/:slug/reviews
GET    /api/products/:slug/reviews
DELETE /api/reviews/:id  (only owner or admin)

# Notifications
GET    /api/me/notifications
POST   /api/me/notifications/:id/read

# Webhooks (external)
POST   /webhooks/pancake
POST   /webhooks/zalopay
POST   /webhooks/vnpay
POST   /webhooks/accesstrade

# Admin (RBAC)
/api/admin/users
/api/admin/orders
/api/admin/dealer-applications/:id/review
/api/admin/coupons
/api/admin/products/overrides   (override SEO, brand metadata)
/api/admin/cashback/merchants
/api/admin/game/spins/config
/api/admin/notifications/templates
/api/admin/reports/*
```

---

---

## 13. Bảo mật, hiệu năng, vận hành

### 13.1 Bảo mật
- HTTPS bắt buộc, HSTS.
- JWT short-lived (15 phút) + refresh rotation.
- Hash mật khẩu (nếu có) bằng Argon2id.
- Tất cả PII mã hóa at-rest (Postgres `pgcrypto` cho cột `cccd`, `bankInfo`).
- Rate-limit per IP + per user qua Redis token bucket.
- Anti-fraud cashback: lưu fingerprint (IP, UA, device id), cap số transaction/user/ngày.
- CSP nghiêm cho web (no inline script, allowlist CDN ZaloPay).
- Audit log mọi hành động admin.
- OWASP Top 10 review.
- **PDPL/Nghị định 13/2023:** đăng ký Data Protection, lưu consent, có nút "Xóa tài khoản" trong mini app.

### 13.2 Hiệu năng
- Backend p95 < 300ms cho catalog read.
- Mini app bundle < 1MB initial (code-split aggressively).
- Web TTFB < 600ms (ISR cho product page, SWR refresh tồn kho).
- Image: AVIF/WebP, lazy load, CDN Cloudflare Images.
- Postgres index: `products.slug`, `orders.userId`, `orders.code`, `affiliate_links.shortCode`, `cashback_clicks.utmTraceId`, FTS `products.searchVector`.

### 13.3 Vận hành
- Logs: Loki + Promtail, retention 30 ngày.
- Metrics: Prometheus + Grafana (CPU, latency, queue depth, error rate).
- Alert: PagerDuty hoặc Slack webhook.
- Backup: daily Postgres dump → R2, retention 30 ngày + 1 năm monthly.
- Disaster recovery: RPO 1h, RTO 4h.
- Staging env clone production data đã anonymize.

### 13.4 Mini app size constraint
- Zalo Mini App giới hạn package size (kiểm tra giới hạn hiện tại trong doc Zalo, thường ~5MB).
- Tách những module nặng (game canvas, video player) bằng dynamic import.
- Ảnh banner load từ CDN, không bundle.

---

---

## 14. Lộ trình triển khai

### Phase 0 — Khởi tạo (Tuần 1–2)
- Set up monorepo, CI/CD, env, domain, DNS.
- Thiết kế Figma chi tiết (mini app + web).
- Đăng ký Zalo Mini App + OA + ZNS template (lead time duyệt).
- Đăng ký Accesstrade Publisher, ZaloPay merchant.
- Schema DB + Prisma migration v0.
- Setup Pancake sandbox + lấy API key.

### Phase 1 — MVP B2C (Tuần 3–8)
- Auth (mini app + web).
- Catalog sync Pancake.
- Cart, checkout, COD + ZaloPay.
- Order tracking + webhook Pancake.
- ZNS template order status.
- Migrate WP: redirect 301, sitemap mới.
- Deploy production beta cho 100 user invited.

### Phase 2 — Loyalty + Gamification (Tuần 9–12)
- Points, tier, voucher, birthday voucher.
- Daily check-in + cây ảo + vòng quay + quiz + missions.
- ZNS marketing template.
- Review hệ thống.

### Phase 3 — Affiliate nội bộ + Cashback sàn ngoài (Tuần 13–16)
- CTV register, link, dashboard, payout.
- Cashback: Accesstrade integration, merchant list, click tracking, postback.
- Wallet + withdraw + KYC nhẹ.

### Phase 4 — B2B Đại lý (Tuần 17–20)
- Dealer apply + admin review.
- Dealer pricing + đặt nhanh + công nợ.
- Hoàn thiện admin nội bộ.

### Phase 5 — Launch + iterate (Tuần 21+)
- Soft launch toàn user OA.
- Campaign marketing kết hợp KOL.
- Đo lường, tối ưu funnel, A/B test.

---

---

## 15. Bảng config tham số tập trung (Single Source of Truth)

> Đây là **toàn bộ con số có thể điều chỉnh** mà không cần redeploy code. Implement bằng bảng `SystemConfig` trong Postgres + UI admin để sửa.

### 15.1 Schema

```prisma
model SystemConfig {
  key         String  @id              // "loyalty.points_per_vnd"
  value       Json                     // có thể là số, string, object, array
  description String?
  category    String                    // "loyalty" | "affiliate" | "cashback" | "dealer" | "game" | "shipping" | ...
  updatedAt   DateTime @updatedAt
  updatedBy   String?
}

model SystemConfigHistory {
  id         String @id @default(cuid())
  key        String
  oldValue   Json
  newValue   Json
  changedBy  String
  changedAt  DateTime @default(now())
}
```

### 15.2 Catalog các key config

#### Loyalty
| Key | Default | Mô tả |
|-----|---------|-------|
| `loyalty.vnd_per_point` | 10000 | 10.000đ chi tiêu = 1 điểm |
| `loyalty.vnd_per_point_redeem` | 1000 | 1 điểm = 1.000đ khi áp |
| `loyalty.max_redeem_pct` | 0.20 | Tối đa 20% giá trị đơn được trừ điểm |
| `loyalty.point_expire_months` | 12 | Điểm hết hạn sau 12 tháng |
| `loyalty.tiers` | (JSON) | Bảng định nghĩa hạng, ngưỡng, multiplier, perks |
| `loyalty.tier_grace_days` | 30 | Grace period giữ hạng khi rớt |
| `loyalty.welcome_voucher_amount` | 30000 | Voucher đơn đầu |
| `loyalty.welcome_voucher_min_order` | 199000 | Min order để dùng welcome voucher |

#### Affiliate (CTV)
| Key | Default | Mô tả |
|-----|---------|-------|
| `affiliate.product_rate_source` | "variation.affiliateRate" | Rate đọc từ từng variation (import Excel) |
| `affiliate.monthly_tier_thresholds` | `[3000000, 10000000, 30000000, 80000000]` | Ngưỡng VND để lên bậc |
| `affiliate.monthly_tier_bonuses` | `[0, 0.01, 0.025, 0.04, 0.06]` | Bonus rate tương ứng |
| `affiliate.hold_days` | 20 | Hold ngày sau DELIVERED trước khi APPROVED |
| `affiliate.last_click_window_days` | 30 | Cookie/tracking window |
| `affiliate.min_withdraw_bank` | 50000 | Min rút STK |
| `affiliate.tubu_wallet_multiplier` | 1.5 | Hệ số chuyển sang Ví Tubu |
| `affiliate.kyc_required_above` | 2000000 | KYC khi rút > X/tháng |
| `affiliate.leaderboard_prizes` | (JSON) | Giải top tháng |

#### Cashback (sàn ngoài)
| Key | Default | Mô tả |
|-----|---------|-------|
| `cashback.merchant_user_share` | 0.70 | User nhận 70% commission |
| `cashback.merchant_tubu_share` | 0.30 | Tubu giữ 30% |
| `cashback.hold_days` | 30 | Hold sau khi AT confirm |
| `cashback.min_withdraw_bank` | 50000 | Min rút STK (chung wallet với CTV) |
| `cashback.tubu_wallet_multiplier` | 1.5 | x1.5 khi chuyển Ví Tubu |
| `cashback.click_rate_limit_seconds` | 30 | 1 click/merchant/user/30s |

#### Dealer
| Key | Default | Mô tả |
|-----|---------|-------|
| `dealer.tiers` | (JSON) | Định nghĩa 4 bậc + chiết khấu max + công nợ |
| `dealer.max_discount_pct` | 0.45 | Chiết khấu tối đa hard cap |
| `dealer.quarterly_bonus_tiers` | (JSON) | Bonus quý theo % đạt mục tiêu |
| `dealer.kyc_required` | true | Bắt buộc CCCD khi đăng ký |

#### Game
| Key | Default | Mô tả |
|-----|---------|-------|
| `game.daily_checkin_seeds` | 1 | Hạt giống/ngày |
| `game.daily_checkin_points` | 2 | Điểm Xanh/ngày |
| `game.streak_7_bonus` | (JSON) | `{seeds:10, free_spins:1}` |
| `game.tree_levels` | (JSON) | Cost mỗi level + reward mỗi level |
| `game.tree_level_10_reward` | (JSON) | `{plant_real_tree:true, sample:true, certificate:true}` |
| `game.spin_prizes` | (JSON) | Bảng giải vòng quay + xác suất |
| `game.spin_free_sources` | (JSON) | Các cách kiếm lượt miễn phí |
| `game.spin_buy_cost_points` | 10 | Điểm Xanh đổi 1 lượt |
| `game.spin_buy_daily_limit` | 5 | Max mua/ngày |
| `game.quiz_daily_count` | 5 | Số quiz/ngày |
| `game.quiz_correct_points` | 3 | Điểm/câu đúng |
| `game.leaderboard_prizes` | (JSON) | Giải top tháng |

#### Shipping
| Key | Default | Mô tả |
|-----|---------|-------|
| `shipping.free_threshold` | 200000 | Đơn ≥ 200k được freeship |
| `shipping.flat_fee_below_threshold` | 19000 | Phí cố định khi đơn < 200k |
| `shipping.tier_freeship_overrides` | (JSON) | Hạng được freeship trước ngưỡng |

#### Return
| Key | Default | Mô tả |
|-----|---------|-------|
| `return.allow_manufacturer_defect_only` | true | Chỉ đổi khi lỗi NSX |
| `return.window_days` | 15 | Trong 7 ngày từ DELIVERED |
| `return.shipping_paid_by_tubu_if_defect` | true | Tubu trả phí ship hoàn |
| `return.affiliate_commission_reverse_window_days` | 20 | Trừ ngược hoa hồng nếu hoàn trong X ngày |

#### Payment
| Key | Default | Mô tả |
|-----|---------|-------|
| `payment.enabled_methods` | `["COD","ZALOPAY","BANK_TRANSFER","CREDIT_CARD"]` | Phương thức bật |
| `payment.cod_max_amount` | 5000000 | Max đơn cho COD |
| `payment.credit_card_provider` | "stripe" hoặc "onepay" | Provider cụ thể |

#### Eco / Tree planting
| Key | Default | Mô tả |
|-----|---------|-------|
| `eco.real_tree_partner` | "PanNature - Rừng Xanh Lên" | Đối tác — nature.org.vn |
| `eco.real_tree_cost_each` | 50000 | ~50k/cây (PanNature rate: 30tr/600 cây) |
| `eco.real_tree_cost_each` | 50000 | Chi phí 1 cây thật (cho budget) |
| `eco.real_tree_monthly_budget` | 5000000 | Trần ngân sách trồng cây/tháng |
| `eco.tree_regions` | (JSON) | Map brand → vùng (Visante:QuangNam, Polang:DakLak,...) |

### 15.3 UI admin cho config

- Trang `/admin/config` chia tab theo category.
- Mỗi key có: name, current value, default value (để reset), description, validation rule.
- Mọi thay đổi ghi vào `SystemConfigHistory` (audit).
- Có nút "Preview impact" — tính tác động khi đổi một số config trọng yếu (VD: đổi `affiliate.tubu_wallet_multiplier` → ước tính chi phí thêm).

---

---

## 16. Migration WordPress → Blog SEO

### 16.1 Quy tắc giữ SEO
1. **Không xóa nội dung blog** đang có ranking.
2. **301 redirect** tất cả URL sản phẩm cũ (`tubutree.com/product/*`, `tubutree.com/shop`, `tubutree.com/cart`, `tubutree.com/my-account`) sang URL tương ứng `shop.tubutree.com/...`.
3. Cập nhật **sitemap.xml** + **robots.txt** mới.
4. Submit lại Google Search Console + Bing Webmaster.
5. Internal link từ blog post → trỏ sang `shop.tubutree.com`.

### 16.2 Script migration
- Script `tools/wp-migration/`:
  - Đọc WP database (REST API hoặc dump SQL).
  - Map `wp_posts` (type=product) → CSV `slug, name, brand, description, attributes`.
  - Đẩy CSV vào Pancake (Pancake hỗ trợ import) hoặc map trực tiếp `pancake_id` qua tên/slug.
  - Tải ảnh từ WP `wp-content/uploads` → đẩy lên R2/S3 → cập nhật URL mới.
- Tạo bảng `slug_redirects (old_slug, new_slug)` trong WP để dùng plugin `Redirection` áp dụng 301.

### 16.3 WP plugin cần gỡ
- WooCommerce, WooCommerce Subscriptions, WC Payment, WC Stripe, Cart hooks.
- Để lại: Yoast SEO (hoặc Rank Math), Site Kit, các plugin block editor, plugin custom blog.

### 16.4 Layout blog mới
- Trang chủ blog: featured posts, danh mục (Sống xanh, Mẹ và bé, Review thành phần, Câu chuyện thương hiệu).
- Mỗi bài blog có CTA box "Mua sản phẩm liên quan trên shop.tubutree.com".
- Hiển thị "Mini app Tubu Tree — Quét QR" ở footer.

---

---

## 17. Rủi ro & giả định

| Rủi ro | Mức độ | Giảm thiểu |
|--------|--------|-----------|
| Pancake API rate-limit (1000/min, 10000/hour) chặn sync | Trung bình | Cache, batch, queue có token bucket |
| Pancake thay đổi API không báo trước | Cao | Wrapper layer trong `integrations/pancake/`, dễ thay |
| Zalo từ chối duyệt mini app (vi phạm guideline) | Trung bình | Review pre-submission, không có content vi phạm |
| ZNS template bị từ chối do nội dung sai | Trung bình | Soạn template chuẩn theo doc, test trên sandbox |
| Accesstrade postback miss → mất cashback của user | Cao | Daily reconciliation API, manual claim flow |
| Đại lý mở tài khoản giả → chiếm chiết khấu lẻ | Trung bình | KYC bắt buộc, admin duyệt thủ công, tier 1 default conservative |
| Lạm dụng vòng quay / mission | Trung bình | Rate-limit per device, audit log, captcha khi nghi ngờ |
| Migration WP làm tụt SEO | Cao | 301 chuẩn, test bằng Screaming Frog, monitor GSC sau 1 tháng |
| Webhook Pancake mất do downtime backend | Cao | Idempotent + cron reconcile mỗi giờ |
| GDPR/PDPL khi lưu CCCD đại lý | Trung bình | Mã hóa at-rest, chỉ admin role được xem, audit log truy cập |

---

---

## 18. Phụ lục

### 18.1 Tham chiếu chính thức

| Mục đích | Link |
|----------|------|
| Zalo Mini App docs | https://mini.zalo.me/ |
| ZMP SDK npm | https://www.npmjs.com/package/zmp-sdk |
| ZaUI Shop template | https://github.com/Zalo-MiniApp/zaui-shop |
| ZaloPay Mini App SDK | https://docs.zalopay.vn/docs/miniapp/intro/ |
| ZNS docs | https://developers.zalo.me/docs/api/notification-service-v2 |
| Pancake POS Open API | https://api-docs.pancake.vn/en/ |
| Pancake POS docs | https://docs.pos.pages.fm/ |
| Accesstrade Publisher | https://accesstrade.vn/ |
| MISA meInvoice API | https://www.misa.vn/154989/tai-lieu-open-api-tich-hop-hoa-don-dien-tu-misa-meinvoice-dau-ra/ |
| Viettel Sinvoice API | https://sinvoice.viettel.vn/ |

### 18.2 Hướng dẫn cho Claude Code khi thực thi

> Dán prompt này khi bắt đầu phiên Claude Code:

```
Bạn sẽ implement dự án Tubu Tree theo SPEC.md kèm theo.
Quy tắc:
1. Đọc kỹ toàn bộ SPEC.md trước.
2. Bắt đầu với Phase 0 + Phase 1 (MVP B2C).
3. Tạo monorepo theo cấu trúc ở mục 5.
4. Backend trước (Prisma schema + module skeleton + auth), 
   rồi mini app, rồi web. 
5. Mọi tích hợp ngoài (Pancake/AT/ZaloPay/ZNS) bọc trong 
   adapter ở apps/api/src/modules/integrations/* — KHÔNG 
   gọi trực tiếp từ business logic.
6. Mỗi feature có:
   - Unit test cho service layer
   - E2E test cho 1 happy path quan trọng
7. Trước khi viết code mỗi module, in ra:
   - Liệt kê file sẽ tạo/sửa
   - Hỏi xác nhận nếu có quyết định ambiguous
8. Dùng dữ liệu mẫu thật từ tubutree.com (~50 sản phẩm) 
   để seed dev DB.
9. Tuân thủ TypeScript strict, no any, lint pass.
10. Tài liệu bằng tiếng Việt trong comment quan trọng, 
    code tiếng Anh.
```

### 18.3 Danh sách dữ liệu cần chuẩn bị trước khi code

- [ ] Logo, brand assets (SVG, PNG) — từ design team.
- [ ] Danh sách brand (10 brand) + mô tả.
- [ ] Danh sách category cuối cùng.
- [ ] CSV sản phẩm xuất từ WooCommerce hiện tại (làm chuẩn migration).
- [ ] API key Pancake (sandbox + production).
- [ ] ZaloPay merchant credentials (sandbox).
- [ ] Zalo Mini App ID + OA ID.
- [ ] Accesstrade publisher token.
- [ ] Tài khoản hóa đơn điện tử đã ký với Viettel/MISA.
- [ ] Domain DNS quyền: `shop.tubutree.com`, `api.tubutree.com`.
- [ ] Banking info để verify withdrawal.

### 18.4 Câu hỏi cần Tubu Tree quyết định trước khi code

1. **Tỷ lệ hoa hồng CTV mặc định**: 5% / 7% / 10%? Có khác theo brand?
2. **Margin cashback**: giữ lại bao nhiêu? (đề xuất: 20% của commission AT trả về)
3. **Hold time cashback** đủ để user tin tưởng? (đề xuất: 30 ngày sau confirm AT)
4. **Bậc Đại lý** cụ thể: ngưỡng nào cho Cấp 1/2/VIP? Chiết khấu mỗi bậc?
5. **Hạng loyalty** đặt tên có như đề xuất ("Mầm Xanh"...)? Quyền lợi đủ hấp dẫn?
6. **Game thưởng thật**: phần thưởng vòng quay cụ thể? Quà cho top leaderboard?
7. **Phí ship**: tự tính theo zone hay copy y nguyên từ Pancake?
8. **Phương thức thanh toán**: ZaloPay bắt buộc — VNPay có không? Apple Pay/Google Pay?
9. **Chính sách trả hàng**: bao nhiêu ngày? Ai trả phí ship hoàn?
10. **Đối tác trồng cây thật** (cho game eco): ai? Định kỳ báo cáo?

---

---

---

**Hết tài liệu build spec.** Bắt đầu Phase 0 — Khởi tạo monorepo.
