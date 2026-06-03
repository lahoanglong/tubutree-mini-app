# 🌿 Tubu Tree — Design Handoff cho Claude Code

**Phiên bản:** Design Handoff v1.0  
**Ngày:** 02/06/2026  
**Tài liệu này dành cho:** Developer dùng Claude Code để triển khai Zalo Mini App + Web Shop của Tubu Tree.

---

## ⚠️ Lưu ý quan trọng trước khi đọc

Tất cả file `.html` trong thư mục này là **design prototype** — được tạo bằng React/JSX chạy trong browser để demo giao diện. Chúng **KHÔNG phải production code** để copy sang app thật.

**Nhiệm vụ của Claude Code là:** Đọc các prototype này để hiểu UI/UX mong muốn → Triển khai lại trong môi trường thật theo stack đã chốt (Zalo Mini App: React + ZaUI + zmp-sdk; Web: Next.js 14 + Tailwind + shadcn/ui).

---

## 📋 Trạng thái thiết kế

| Milestone | Nội dung | Trạng thái |
|-----------|---------|------------|
| **M1 — Brand Foundation** | Design tokens, màu sắc, typography, atoms | ✅ Hoàn thành |
| **M2 — Design System** | Component library (atoms → organisms) | ✅ Hoàn thành |
| **M3 — Mini App MVP Screens** | ~50 màn hình P1 chia 6 batch | ✅ Hoàn thành |
| M4 — Full Mini App (79 màn) | Phần còn lại + game nâng cao | ⏳ Chưa thiết kế |
| M5 — Web Shop + Admin | 45+31 màn | ⏳ Chưa thiết kế |

> **Khuyến nghị:** Claude Code bắt đầu với M1-M3 (đã có prototype đầy đủ). M4/M5 sẽ handoff sau khi design xong.

---

## 📁 Cấu trúc file handoff

```
design_handoff/
├── README.md                          ← File này
├── specs/
│   ├── TUBU_TREE_BUILD_SPEC_v1.1.md   ← Spec kỹ thuật đầy đủ (đọc trước khi code)
│   └── TUBU_TREE_DESIGN_BRIEF.md      ← Design brief (personas, tokens, components)
├── m1_brand/
│   └── Tubu Tree - M1 Brand Foundation.html   ← Prototype: tokens + brand atoms
├── m2_design_system/
│   └── Tubu Tree - M2 Design System.html      ← Prototype: component library
├── m3_screens/
│   ├── Tubu Tree - M3 Batch 1.html   ← Home, PDP, Cart, Checkout, Orders
│   ├── Tubu Tree - M3 Batch 2.html   ← Brand pages, Art direction
│   ├── Tubu Tree - M3 Batch 3.html   ← Loyalty, Wallet, Affiliate
│   ├── Tubu Tree - M3 Batch 4.html   ← Game (Vườn Xanh), Gamification
│   ├── Tubu Tree - M3 Batch 5.html   ← Dealer mode, B2B
│   └── Tubu Tree - M3 Batch 6.html   ← Search, Browse, Vouchers
└── assets/
    └── tubu-logo.png
```

---

## 🎨 Design System — Tokens cần implement

### Màu sắc (đọc từ M1/M2 prototype)

```css
/* Primary — Lá tươi */
--green-50:  #F1F8F2;
--green-100: #DDEDE0;
--green-200: #B5D6BD;
--green-400: #5FA376;
--green-600: #2E7D4F;   /* CTA chính ⭐ */
--green-700: #235F3D;   /* hover/pressed */
--green-900: #0F2D1C;   /* heading */

/* Secondary — Đất sét */
--clay-50:  #FBF4ED;
--clay-200: #EDD4BD;
--clay-500: #C97B4A;    /* accent: voucher, hạng */
--clay-700: #8C4F2A;

/* Accent — Nắng */
--sun-300: #FDD96E;
--sun-500: #F4B400;     /* star rating, badge hạng cao */

/* Neutral */
--neutral-0:   #FFFFFF;
--neutral-50:  #FAFAF8;   /* app background (warm white) */
--neutral-100: #F2F2EF;
--neutral-200: #E5E5E0;   /* border */
--neutral-400: #A8A8A0;   /* placeholder, disabled */
--neutral-600: #5F5F58;   /* body text */
--neutral-900: #1A1A17;   /* heading */

/* Semantic */
--success: #2E7D4F;
--warning: #E58B00;
--danger:  #C73E3E;
--info:    #3D7BB8;
```

### Typography

```
Font chính:  "Be Vietnam Pro" (Google Fonts) — mọi UI element
Font body:   "Inter" — đoạn văn dài
Font mono:   "JetBrains Mono" — SKU, order code
```

| Token | Mobile | Desktop | Weight | Dùng cho |
|-------|--------|---------|--------|---------|
| display-lg | 32px | 48px | 700 | Hero heading |
| display-md | 28px | 36px | 700 | Section heading |
| h1 | 24px | 28px | 700 | Page title |
| h2 | 20px | 22px | 600 | Subsection |
| h3 | 18px | 18px | 600 | Card title |
| body-lg | 16px | 16px | 400 | Body chính |
| body-md | 14px | 14px | 400 | Body phụ |
| body-sm | 13px | 13px | 400 | Caption |
| label | 12px | 12px | 500 | Form label, tag |

### Spacing (8pt grid)
```
4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80px
```

### Border radius
```
sm: 6px   (chip, tag)
md: 10px  (input, button — default)
lg: 16px  (card)
xl: 24px  (bottom sheet, modal)
full: 9999px (pill, avatar)
```

### Shadow
```
shadow-sm: 0 2px 6px rgba(15,45,28,0.06)   ← card mặc định
shadow-md: 0 4px 12px rgba(15,45,28,0.08)  ← elevated card
shadow-lg: 0 12px 32px rgba(15,45,28,0.12) ← modal, dropdown
```

---

## 📱 Màn hình đã thiết kế (M3 — 6 Batch)

### Batch 1 — Core Shopping Flow
| Screen | Mô tả |
|--------|-------|
| **Home** | Banner hero, brand carousel, flash sale, best-sellers, "Cho mẹ và bé" section |
| **PDP (Product Detail)** | Gallery, variation selector, ingredient panel, add to cart CTA sticky |
| **Cart** | Item list, voucher input, subtotal/shipping/total, checkout CTA |
| **Checkout Step 1** | Address selection, danh sách địa chỉ saved |
| **Checkout Step 2** | Shipping method, toggle xuất hóa đơn VAT |
| **Checkout Step 3** | Payment method (COD/ZaloPay/Bank), order summary |
| **Order Success** | Illustration + order code + 2 CTA |
| **Orders List** | Filter theo status (Chờ xác nhận / Đang giao / Đã giao / Đã hủy) |
| **Order Detail** | Timeline trạng thái, items, summary, tracking |

### Batch 2 — Brand & Art Direction
| Screen | Mô tả |
|--------|-------|
| **Brand Page** | Brand hero, story snippet, sản phẩm theo brand |
| **Art direction samples** | Ảnh sản phẩm, lifestyle, vùng nguyên liệu |

### Batch 3 — Loyalty & Wallet
| Screen | Mô tả |
|--------|-------|
| **Loyalty Dashboard** | Tier visual (Mầm Xanh → Cổ Thụ), progress bar, benefits |
| **Points History** | List giao dịch điểm Xanh |
| **Wallet** | 3 số: Withdrawable / Tubu Wallet / Pending; convert ×1.5 |
| **Affiliate Dashboard** | Hoa hồng hôm nay/tháng, KPI strip, bar chart 30 ngày |
| **Share Product Modal** | 3 dạng link + caption gợi ý |
| **Commission History** | List + status (Pending/Locked/Approved/Paid) |

### Batch 4 — Game (Vườn Xanh Tubu)
| Screen | Mô tả |
|--------|-------|
| **Game Hub** | Khu vườn + daily check-in + vòng quay + quiz + missions |
| **Tree Garden** | Isometric view, cây 10 cấp, nút tưới, animation |
| **Daily Check-in** | Animation hạt giống + streak counter |
| **Spin Wheel** | Vòng quay 9 phần thưởng |
| **Quiz Daily** | 5 câu quiz về thiên nhiên/brand |
| **Missions List** | Progress bar + claim reward |
| **Brand Story Map** | Bản đồ VN SVG + hotspot 6 vùng nguyên liệu |

### Batch 5 — Dealer Mode (B2B)
| Screen | Mô tả |
|--------|-------|
| **Dealer Application** | Multi-step: business info → upload docs → review |
| **Dealer Home** | Doanh số tháng/quý, quick stats, nút Đặt nhanh |
| **Price List** | Table dày: SKU, tên, giá lẻ, giá nhập, chiết khấu %, tồn kho |
| **Quick Order** | SKU input + qty + autocomplete + paste-from-Excel |
| **Dealer Cart** | Items B2B + chọn ngày giao |
| **Credit Ledger** | Công nợ hiện tại + hạn thanh toán + lịch sử |

### Batch 6 — Search & Discovery
| Screen | Mô tả |
|--------|-------|
| **Search** | Recent searches, trending, autocomplete tiếng Việt |
| **Browse / Category** | Filter chips (brand, giá, công dụng), grid 2 cột |
| **Vouchers** | Available / locked / expired tabs |
| **PDP (variant)** | PDP với variation bottom sheet |
| **Cart (variant)** | Cart với coupon applied |

---

## 🔑 Interactions & Behavior quan trọng

### Navigation (Mini App)
- Stack-based navigation: `go(screen, params)` + `back()`
- Bottom tab bar: 5 tabs (Home / Browse / Game / Wallet / Profile)
- Active tab: `green-600`

### Cart
- Add to cart: animation "bay vào icon cart", badge bounce +1
- Persistent: lưu localStorage, sync với backend khi login
- Realtime stock check khi checkout (gọi Pancake API)

### Checkout
- Freeship rule: đơn **< 200.000đ = phí ship 19.000đ**, đơn **≥ 200.000đ = miễn phí**
- Hạng Lộc Biếc+: freeship từ 99k
- Khi chọn "Xuất hóa đơn VAT": mở form (MST, tên công ty, địa chỉ, email)

### Loyalty Tiers
| Hạng | Yêu cầu | Điểm tích |
|------|---------|-----------|
| Mầm Xanh | Default | 1x |
| Lộc Biếc | 500đ hoặc 5tr/12th | 1.2x |
| Đại Thụ | 2000đ hoặc 20tr/12th | 1.5x |
| Cổ Thụ | 5000đ hoặc 50tr/12th | 2x |

- **1 điểm Xanh = 10.000đ chi tiêu**
- **1 điểm Xanh = 1.000đ** khi đổi, tối đa 20% giá trị đơn

### Dealer Mode
- Khi `user.role === 'DEALER'`: app vào thẳng Dealer Home
- Theme: navy-gray (KHÔNG dùng green B2C)
- Ẩn: game, voucher cá nhân, cashback sàn ngoài
- Hiện: bảng giá, quick order, công nợ

### Animations
```
Micro transitions:    200ms ease-out
Screen transitions:   300-400ms ease-out
Game animations:      spring physics
Max duration:         500ms (không vượt quá)
```

---

## 💳 Payment Methods
- **COD** — Thanh toán khi nhận hàng
- **ZaloPay** — `Payment.zlpSdk.openOrderPayment()` trong mini app
- **VNPay** — Redirect URL
- **Chuyển khoản** — Bank transfer với QR
- **Ví Tubu** — Dùng `user.walletBalance`

---

## 🔗 External Integrations

| Service | Dùng cho | Ghi chú |
|---------|---------|---------|
| **Pancake POS** | Catalog, orders, shipping, invoices | Source of truth cho sản phẩm & đơn hàng |
| **ZaloPay** | Thanh toán trong mini app | SDK tích hợp native |
| **Accesstrade** | Cashback sàn ngoài (Shopee, Lazada...) | Sub ID tracking |
| **ZNS (Zalo)** | Push notification đơn hàng | Template đã duyệt bởi Zalo |
| **GHN / GHTK** | Vận chuyển | Qua Pancake, không gọi trực tiếp |

---

## 🚀 Thứ tự implement theo Build Spec

Đọc `specs/TUBU_TREE_BUILD_SPEC_v1.1.md` để có đầy đủ chi tiết. Lộ trình đề xuất:

```
Phase 0 (1 tuần):  Setup monorepo + DB schema + auth Zalo
Phase 1 (3 tuần):  Catalog + Cart + Checkout + Orders + Payment
Phase 2 (2 tuần):  Loyalty + Affiliate + Wallet
Phase 3 (2 tuần):  Game (Vườn Xanh) + Cashback
Phase 4 (2 tuần):  Dealer mode + Admin basic
Phase 5 (ongoing): Web shop (Next.js) + Admin đầy đủ
```

> ⚡ Bắt đầu từ **Phase 0** — đừng nhảy vào feature trước khi setup monorepo + Prisma schema + Zalo auth xong.

---

## 📐 Quy tắc code (từ Build Spec)

1. **TypeScript strict** — no `any`
2. **Mọi business param** (rate, ngưỡng, hold time) đọc từ bảng `SystemConfig` — KHÔNG hard-code
3. **Pancake là source of truth** cho catalog/order/shipping
4. **Đơn hàng** tạo ở mini app → push sang Pancake ngay lập tức (idempotent với `external_id`)
5. **Mỗi feature** có unit test cho service layer + ít nhất 1 E2E happy path
6. **Stateless API** — state trong Postgres + Redis

---

## 🖼️ Assets

| File | Mô tả |
|------|-------|
| `assets/tubu-logo.png` | Logo chính Tubu Tree |
| Prototype HTML files | Xem trực tiếp trong browser để kiểm tra UI chi tiết |

> Ảnh sản phẩm thật, illustration, Lottie animation chưa có — cần team creative bổ sung.

---

## 💬 Liên hệ & câu hỏi

Khi Claude Code cần làm rõ về design intent, mở file prototype tương ứng và xem trực tiếp trong browser.  
Mọi logic nghiệp vụ phức tạp → xem `specs/TUBU_TREE_BUILD_SPEC_v1.1.md`.
