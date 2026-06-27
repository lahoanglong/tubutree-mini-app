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

## Mục 2 — "Đã bán N" trên thẻ SP — (chờ brainstorm nguồn dữ liệu)
## Mục 3 — Auto đối soát DealerReward — (chờ brainstorm)
## Mục 4 — Brand-owner tự quản (lộ trình B) — (chờ brainstorm)
