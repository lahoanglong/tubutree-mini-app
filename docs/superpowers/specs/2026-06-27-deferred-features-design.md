# Thiết kế: Các tính năng hoãn (deferred) — storefront

- **Ngày:** 2026-06-27
- **Thuộc:** [[project_storefront]] — các mục §13 spec gốc đã hoãn, nay làm.
- **Trạng thái:** Đang triển khai tuần tự (mỗi mục 1 section, brainstorm khi tới).

Quyết định nghiệp vụ đã chốt với user:
- **Quyền SP affiliate:** GIỮ "mọi SP active trừ `affiliateBlocked`" (không đổi).
- **Attribution:** giữ trong phiên + **3 ngày sau** (last-touch). → Mục 1 dưới đây.

---

## Mục 1 — Attribution 3 ngày (referral last-touch persistent)

**Vấn đề:** Hiện attribution (`referralCode`/`storefrontSlug`) chỉ sống trong sessionStorage; đóng app/hết phiên là mất. User muốn CTV vẫn được công nếu khách quay lại mua trong **3 ngày**.

**Hướng đã chốt (A — server-side, theo user đăng nhập Zalo):** bền, đúng cả khi đổi thiết bị cùng tài khoản, không phụ thuộc localStorage.

### Data
```prisma
model ReferralTouch {
  id              String   @id @default(cuid())
  userId          String   @unique            // khách (đã đăng nhập)
  referrerUserId  String                       // CTV được công
  storefrontSlug  String?                      // chỉ set khi đến từ gian hàng CTV (kind=ctv); brand → null
  kind            String   @default("ctv")     // ctv | brand
  expiresAt       DateTime                      // now + config(affiliate.attribution_days=3)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([expiresAt])
  @@map("referral_touches")
}
```

### Backend (AffiliateService — @Global, đã được CheckoutService inject)
- `recordTouch(userId, dto:{referralCode, storefrontSlug?, kind?})`: resolve `referralCode`→`referrerUserId` (bỏ qua nếu không có/độ trỏ chính mình); upsert `ReferralTouch{userId}` với `referrerUserId, storefrontSlug, kind, expiresAt = now + days` (days = `config('affiliate.attribution_days', 3)`). Mỗi lần mở link làm mới hạn (last-touch).
- `getActiveTouch(userId, now=new Date())`: findUnique theo userId; trả `{referrerUserId, storefrontSlug, kind}` nếu `expiresAt > now`, ngược lại null.
- Endpoint: `POST /affiliate/touch` (auth) body `{referralCode, storefrontSlug?, kind?}` → recordTouch. Trả `{ok:true}`.

### Checkout fallback (CheckoutService.placeOrder)
- Resolve **trước** khi `compute()`:
  - `referrerUserId = resolveReferrer(dto.referralCode, userId)`; nếu null → `touch = getActiveTouch(userId)`; nếu có → `referrerUserId = touch.referrerUserId`.
  - `effectiveSlug = dto.storefrontSlug ?? (touch?.kind==='ctv' ? touch.storefrontSlug : null)`.
- Truyền `effectiveSlug` vào `compute()` (combo + attribution) và lưu `Order.storefrontSlug = effectiveSlug`, `Order.referrerUserId = referrerUserId`.
- Ưu tiên giá trị tường minh của phiên; touch chỉ là fallback khi phiên mất.
- **Không** xoá touch sau đơn đầu — để hết hạn tự nhiên (đúng "3 ngày sau đó", hỗ trợ nhiều đơn trong cửa sổ).

### Frontend
- Helper `recordTouch` trong `affiliate-api`/`storefront-api`; gọi fire-and-forget (chỉ khi đã đăng nhập) tại nơi đã bắt ngữ cảnh:
  - `app.tsx` khi bắt `?ref`/`?s` (link affiliate thuần).
  - `storefront-view.tsx` (CTV): `{referralCode: slug, storefrontSlug: slug, kind:'ctv'}`.
  - `brand-view.tsx` (brand): `{referralCode: ste.referralCode|từ ?ref, kind:'brand'}` (không storefrontSlug).
- Lỗi 401 (chưa đăng nhập) → nuốt, không sao (touch theo userId).

### Test
- Unit (mock Prisma): recordTouch resolve + upsert + expiresAt; bỏ qua self/invalid; getActiveTouch còn hạn/hết hạn.
- Checkout integ: không có referralCode nhưng có touch còn hạn → referrerUserId + storefrontSlug từ touch; có referralCode → ưu tiên phiên; touch hết hạn → bỏ qua.
- E2E: recordTouch → (giả lập hết phiên) đặt đơn không kèm referralCode → commission vẫn tạo cho CTV.

### Cấu hình
`affiliate.attribution_days` (mặc định 3) — chỉnh qua admin config.

---

## Mục 2 — "Đã bán N" trên thẻ SP (Hybrid: sàn ngoài + đơn Tubu)

**Chốt:** Hiển thị **tổng đã bán** = `soldExternal` (admin nhập, gom từ Shopee/Lazada/TikTok…) + `soldApp` (đơn DELIVERED trong app, cộng dồn trọn đời). Hiển thị kiểu Shopee ("Đã bán 1,2k+"). Auto-sync API từng sàn = hoãn (cần credentials).

### Data
- `Product.soldExternal Int @default(0)` — admin-owned (baseline sàn ngoài).
- `Product.soldApp Int @default(0)` — system-owned (đơn DELIVERED).
- Tổng hiển thị = `soldExternal + soldApp`.

### Backend
- **CatalogService.recomputeSoldCounts()** (idempotent): `orderItem.groupBy(variationId, where order.status=DELIVERED, _sum quantity)` → map variation→productId → tổng theo product → reset toàn bộ `soldApp=0` rồi set theo nhóm (transaction). Không double-count, tự giảm khi đơn bị RETURNED. `@Cron` 03:00 hằng ngày + chạy 1 lần khi boot (catalog nhỏ ~143 SP).
- **Admin setSoldExternal(rows: {sku, count}[])**: cập nhật `soldExternal` theo SKU (variation.sku → product). Endpoint `POST /admin/products/sold-external` nhận `csv` ("sku,count" mỗi dòng) hoặc `rows` — tái dùng pattern `importDealerPrices`.
- Payload public kèm `sold` (= soldExternal+soldApp) ở: catalog list, storefront `getPublicBySlug` items, brand `getPublicBySlug` products.

### Frontend
- Util `formatSold(n)`: n<1 → ẩn; <1000 → "Đã bán {n}"; <1tr → "Đã bán {n/1000}k+" (dấu phẩy thập phân VN, vd 1,2k+); ≥1tr → "Đã bán {n/1tr}tr+".
- Badge trên thẻ SP (miniapp ProductCard, web product-card, ô SP trong brand/storefront) + PDP. Đặt cạnh giá/★ giống Shopee.

### Test
- Unit `formatSold` (các mốc + làm tròn + ẩn 0).
- Unit `recomputeSoldCounts` (mock groupBy → set đúng + reset về 0 khi không còn DELIVERED).
- Unit `setSoldExternal` (map sku→product, cập nhật).
- E2E: tạo đơn DELIVERED → recompute → `sold` tăng; set soldExternal → tổng = external+app.
## Mục 3 — DealerReward: hiển thị điều kiện + tiến trình (đã chốt gọn)

**Làm rõ với user:** TOUR/GIFT/OTHER chỉ là *loại* phần thưởng (nhãn) để hiển thị "thẻ điều kiện" — KHÔNG có chức năng đặt tour/gửi quà. Trao thưởng admin làm OFFLINE. **Chọn mức gọn:** chỉ hiển thị điều kiện + tiến trình đại lý (KHÔNG cron/notify/bảng achievement).

- **`DealerService.rewardsProgress(userId, now)`**: đối chiếu doanh số nhập kỳ (quý + năm, giờ VN, đơn `type='DEALER'` không huỷ/hoàn) với từng `DealerReward` active → trả `{ quarter, year, quarterVolume, yearVolume, rewards: [{id,type,title,description,threshold,period,volume,achieved,toGo}] }`. period='YEAR' dùng yearVolume, còn lại quarterVolume.
- Endpoint `GET /dealer/rewards` (auth dealer).
- FE miniapp `dealer.tsx` tab Báo cáo: card "🏪 Phần thưởng đại lý" — mỗi thưởng có thanh tiến trình volume/threshold + "Còn X để đạt" / "Đã đạt — Tubu sẽ liên hệ trao thưởng".
- Test: unit rewardsProgress (map period, achieved/toGo, chặn non-dealer).
## Mục 4 — Brand-owner tự quản (lộ trình B) — (chờ brainstorm)
