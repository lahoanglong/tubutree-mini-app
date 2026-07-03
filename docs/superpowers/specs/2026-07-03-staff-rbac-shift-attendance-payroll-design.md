# Thiết kế: Phân quyền theo SĐT + Ca làm + Chấm công (WiFi/GPS) + Lương nhân viên

- **Ngày:** 2026-07-03
- **Trạng thái:** Design — đã duyệt (chờ review spec)
- **Thuộc:** [[project_tubutree_v2_monorepo]] — mở rộng RBAC + module mới `staff` (rbac/shifts/attendance/payroll)
- **Quyết định chốt (từ brainstorm):** Chấm công **IP công ty + GPS (bắt buộc cả hai)**; đơn giá giờ **theo từng nhân viên**; toàn bộ màn hình **trong Mini App** (gate theo role).

---

## 1. Mục tiêu

Xây dựng hệ **quản trị nhân sự nội bộ** trên Tubu Tree Mini App gồm 4 phần phụ thuộc tuần tự:

- **A. RBAC theo SĐT** — 4 nhóm quyền: khách (mặc định), CTV/đại lý (form duyệt — đã có), nhân viên (admin thêm), admin (gán sẵn).
- **B. Ca làm** — nhân viên đăng ký ca theo tuần; admin duyệt (chỉnh được giờ). UI phải cực tiện: chọn ca, chỉnh ca, **copy ca tuần trước**.
- **C. Chấm công** — đến công ty, phải **đúng IP nội bộ + trong vùng GPS** mới checkin được; nghỉ giữa ca thì checkout rồi checkin lại; **ra khỏi vùng = auto checkout**. Kèm luật đi trễ / bỏ ca / huỷ ca.
- **D. Lương** — auto tính giờ × đơn giá → lương ngày → tổng kết tháng; admin quét VietQR chuyển khoản, tick "đã chuyển" + upload ảnh xác nhận.

**Nguyên tắc xuyên suốt:** tái dùng tối đa hạ tầng đã có (RolesGuard, `setUserRole`, VietQR trong `system_configs`, `ImageUpload`, pattern trang gate-role trong Mini App như dealer/brand-owner); tiền tệ VND dùng `Int`; phạt lưu vết đầy đủ (ai/khi nào/lý do); mọi hành động admin nhạy cảm có log.

## 2. Bối cảnh hiện tại (đã có trong code — tái dùng)

- **RBAC:** `enum UserRole { CUSTOMER, AFFILIATE, DEALER, STAFF, ADMIN }`; `User.phone @unique`; `User.role @default(CUSTOMER)`. Decorator `@Roles(...)` + `RolesGuard` (đọc `JwtPayload.role`). JWT mang `role`; đổi role có hiệu lực ở **lần refresh token kế** (đã có cơ chế refresh + rotation).
- **Đổi role theo SĐT:** `AdminService.setUserRole(adminId, phone, role)` — có log ai đổi + role cũ→mới; **KHÔNG tự tạo user** nếu SĐT chưa mở app. Endpoint `POST /admin/users/role` (`@Roles('ADMIN')`).
- **CTV/đại lý:** `DealerApplication` (KYC + `status PENDING→APPROVED/REJECTED/SUSPENDED`, `reviewedBy/reviewedAt/rejectionReason`) — admin duyệt qua `POST /admin/dealer-applications/:id/review`. **Giữ nguyên**, chỉ gom link vào hub admin.
- **VietQR/bank shop:** lưu trong `system_configs` (`payment.bank_bin`, `payment.bank_account_no`, `payment.bank_account_name`, `payment.bank_name`). Trang `bank-payment.tsx` đã dựng VietQR. **Dùng lại cách dựng QR** cho lương (nhưng nguồn bank là *của từng nhân viên*).
- **Upload ảnh:** component `ImageUpload` (Cloudinary) — dùng cho ảnh chứng cứ huỷ ca đột xuất & ảnh xác nhận đã chuyển lương.
- **FE pattern:** trang gate-role (`dealer.tsx`, `brand-owner.tsx`): query `me` → branch theo status → render sub-view; ZaUI + `@tanstack/react-query` + zustand `useAuthStore`; icon Lucide; immersive `actionBarHidden` + `back-button.tsx` nổi. Route đăng ký trong `app.tsx` (`<Route path=... element=... />`).
- **Cron:** thư mục `apps/api/src/jobs` (dùng `@nestjs/schedule`).
- **Hạ tầng mạng:** Caddy đứng trước API (`Caddyfile`) → IP thật lấy qua `X-Forwarded-For`; cần bật `trust proxy`.
- **Múi giờ:** dữ liệu là VN → ranh giới "ngày"/"tháng" tính theo **Asia/Ho_Chi_Minh** (UTC+7).

## 3. Nguyên tắc thiết kế (ràng buộc cứng)

1. **RBAC theo SĐT là nguồn sự thật** — phân quyền dựa trên số điện thoại, không phải zaloId. Cho phép cấp quyền **trước khi** người đó mở app (allowlist theo SĐT).
2. **Chỉ ca APPROVED mới cho checkin** — ca DRAFT/PENDING/REJECTED/CANCELLED không chấm công được.
3. **Checkin cần cả IP nội bộ + GPS trong vùng** — thiếu một trong hai là từ chối (thông báo rõ lý do nào fail).
4. **Không tin client về thời gian & vị trí quyết định tiền** — server chấm mốc thời gian (`new Date()` phía server), tự tính giờ công; client chỉ gửi lat/lng để server verify.
5. **Giờ công tính theo cửa sổ ca đã duyệt** — `paidMinutes = Σ overlap(session, [approvedStart, approvedEnd])`. Chặn checkin sớm "ăn giờ"; đi trễ tự giảm giờ.
6. **Mọi khoản trừ đều có vết** — mỗi phạt là một bản ghi `PayrollAdjustment` (loại, số tiền, lý do, tham chiếu ca).
7. **Idempotent & chống double** — duyệt ca / chốt lương / đánh dấu đã trả dùng guard trạng thái (updateMany theo status kỳ vọng) như `reviewReturn` hiện có.
8. **Bám design system Tubu** — tokens, ZaUI, Lucide, immersive back-button; mobile-first.
9. **Không phá luồng khách hiện tại** — thêm role/bảng mới không đổi hành vi CUSTOMER/CTV/đại lý.

## 4. Kiến trúc dữ liệu (Prisma — 1 migration)

### 4.1 RBAC — allowlist theo SĐT

```prisma
enum RoleGrantRole {
  STAFF
  ADMIN
}

/// Cấp quyền theo SĐT — áp cả khi user CHƯA mở app. Khi login/gắn SĐT, auth áp grant
/// cao nhất còn hiệu lực nếu cao hơn role hiện tại. Admin quản lý qua hub admin.
model RoleGrant {
  id        String        @id @default(cuid())
  phone     String
  role      RoleGrantRole
  grantedBy String        // adminId (hoặc "seed" cho admin gán sẵn ban đầu)
  note      String?
  revokedAt DateTime?     // null = còn hiệu lực
  createdAt DateTime      @default(now())

  @@index([phone, revokedAt])
  @@map("role_grants")
}
```

- Chỉ quản lý STAFF/ADMIN qua bảng này (CTV/đại lý vẫn đi qua `DealerApplication`).
- **Admin gán sẵn:** migration seed `RoleGrant(role=ADMIN, grantedBy="seed")` cho (các) SĐT admin lấy từ config `rbac.admin_phones` — *seed idempotent, không đè* (kiểu `ON CONFLICT DO NOTHING` như bank config). SĐT admin thực nhập qua env/config khi deploy; mặc định để trống → tôi seed 1 placeholder rõ ràng cần đổi.
- **Áp grant khi auth:** trong `AuthService`, sau khi biết `phone` (Zalo login có phoneToken hoặc `ensurePhone`), gọi `RbacService.applyGrants(userId, phone)`: lấy grant còn hiệu lực → role cao nhất (ADMIN>STAFF) → nếu cao hơn `user.role` thì update. Hạ role không tự động (tránh nhạ nhầm CTV/đại lý); admin hạ chủ động.

### 4.2 Hồ sơ nhân viên (đơn giá + bank nhận lương)

```prisma
model StaffProfile {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  hourlyRate      Int      @default(0)   // đơn giá VND/giờ, admin đặt riêng từng người
  bankBin         String?                // mã Napas BIN (dựng VietQR)
  bankAccountNo   String?
  bankAccountName String?
  qrImageUrl      String?                // QR tĩnh nhân viên tự tải (ưu tiên nếu bank trống)
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("staff_profiles")
}
```

### 4.3 Ca làm

```prisma
enum ShiftStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

/// Ca chuẩn admin định nghĩa (đơn vị phút trong ngày để render lưới nhanh, không lệch TZ).
model ShiftTemplate {
  id        String   @id @default(cuid())
  name      String              // "Ca sáng"
  startMin  Int                 // 480 = 08:00
  endMin    Int                 // 720 = 12:00
  active    Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())

  @@map("shift_templates")
}

model Shift {
  id            String       @id @default(cuid())
  staffId       String
  staff         User         @relation("StaffShifts", fields: [staffId], references: [id], onDelete: Cascade)
  workDate      DateTime     @db.Date       // ngày làm (VN)
  startAt       DateTime                    // giờ NV đăng ký (UTC, đủ instant)
  endAt         DateTime
  templateId    String?
  status        ShiftStatus  @default(PENDING)
  approvedStart DateTime?                   // admin chỉnh khi duyệt (null = dùng start/endAt)
  approvedEnd   DateTime?
  approvedBy    String?
  approvedAt    DateTime?
  rejectReason  String?
  cancelReason  String?
  cancelledAt   DateTime?
  isEmergency   Boolean      @default(false) // huỷ đột xuất (có chứng cứ)
  evidenceUrl   String?                      // ảnh chứng cứ huỷ đột xuất
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  sessions      AttendanceSession[]

  @@index([staffId, workDate])
  @@index([workDate, status])
  @@map("shifts")
}
```

- **Cửa sổ hiệu lực** để chấm công/tính lương = `[approvedStart ?? startAt, approvedEnd ?? endAt]`.
- Chống trùng: 1 nhân viên không đăng ký 2 ca chồng giờ cùng ngày (validate ở service).

### 4.4 Chấm công

```prisma
enum SessionCloseReason {
  MANUAL        // NV bấm checkout
  OUT_OF_RANGE  // heartbeat phát hiện rớt IP/GPS
  STALE         // cron: heartbeat cũ quá ngưỡng
  SHIFT_END     // cron chốt cuối ca/cuối ngày
  ADMIN         // admin chỉnh tay
}

model AttendanceSession {
  id             String              @id @default(cuid())
  shiftId        String
  shift          Shift               @relation(fields: [shiftId], references: [id], onDelete: Cascade)
  staffId        String
  checkinAt      DateTime            @default(now())
  checkoutAt     DateTime?           // null = đang mở
  checkinLat     Float
  checkinLng     Float
  checkinIp      String
  lastHeartbeatAt DateTime           @default(now())
  closeReason    SessionCloseReason?
  isLate         Boolean             @default(false) // session đầu ca & trễ > grace
  createdAt      DateTime            @default(now())

  @@index([shiftId])
  @@index([staffId, checkoutAt])
  @@map("attendance_sessions")
}
```

### 4.5 Lương

```prisma
enum PayrollMonthStatus {
  OPEN
  FINALIZED
  PAID
}

enum AdjustmentType {
  LATE          // đi trễ > grace → phạt cố định
  LATE_CANCEL   // huỷ ca < 3 ngày → phạt 1h công
  MANUAL        // admin cộng/trừ tay
}

model PayrollDay {
  id            String   @id @default(cuid())
  staffId       String
  workDate      DateTime @db.Date
  workedMinutes Int      @default(0)
  hourlyRate    Int                  // snapshot đơn giá lúc chốt
  gross         Int      @default(0) // round(workedMinutes/60 * hourlyRate)
  fines         Int      @default(0) // tổng phạt trong ngày (từ adjustments)
  net           Int      @default(0) // gross - fines (không âm)
  finalizedAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([staffId, workDate])
  @@map("payroll_days")
}

model PayrollAdjustment {
  id         String         @id @default(cuid())
  staffId    String
  workDate   DateTime       @db.Date  // gắn ngày để cộng vào PayrollDay & tháng
  type       AdjustmentType
  amount     Int                       // số tiền trừ (dương = trừ); MANUAL có thể âm = cộng
  reason     String
  shiftId    String?
  createdBy  String?                    // adminId nếu MANUAL
  createdAt  DateTime       @default(now())

  @@index([staffId, workDate])
  @@map("payroll_adjustments")
}

model PayrollMonth {
  id            String             @id @default(cuid())
  staffId       String
  year          Int
  month         Int                // 1..12
  totalMinutes  Int      @default(0)
  gross         Int      @default(0)
  totalFines    Int      @default(0)
  net           Int      @default(0)
  status        PayrollMonthStatus @default(OPEN)
  finalizedAt   DateTime?
  paidAt        DateTime?
  paidBy        String?
  proofImageUrl String?            // ảnh xác nhận đã chuyển
  note          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([staffId, year, month])
  @@map("payroll_months")
}
```

Thêm quan hệ ngược trên `User`: `staffProfile StaffProfile?`, `staffShifts Shift[] @relation("StaffShifts")` (các bảng còn lại tham chiếu `staffId` không bắt buộc quan hệ ngược để giữ `User` gọn).

## 5. Cấu hình (SystemConfig — category `attendance` / `rbac`)

| Key | Mặc định | Ý nghĩa |
|---|---|---|
| `rbac.admin_phones` | `[]` | Danh sách SĐT admin gán sẵn (seed RoleGrant) |
| `attendance.office_ips` | `[]` | Danh sách IP/CIDR nội bộ được phép checkin |
| `attendance.office_lat` | `null` | Vĩ độ công ty |
| `attendance.office_lng` | `null` | Kinh độ công ty |
| `attendance.radius_m` | `150` | Bán kính GPS cho phép (mét) |
| `attendance.late_grace_min` | `30` | Trễ quá X phút thì phạt |
| `attendance.late_fine` | `10000` | Tiền phạt đi trễ (VND) |
| `attendance.cancel_notice_days` | `3` | Huỷ ca phải báo trước X ngày |
| `attendance.emergency_cap_month` | `3` | Số lần huỷ đột xuất miễn phạt / tháng |
| `attendance.heartbeat_stale_min` | `10` | Không heartbeat quá X phút → cron auto checkout |
| `attendance.enforce_ip` | `true` | Bật kiểm IP (tắt được nếu công ty chưa có IP tĩnh) |

- **Fail-safe khi chưa cấu hình:** nếu `office_ips` rỗng **và** `office_lat/lng` null → checkin **từ chối** kèm thông báo "Chưa cấu hình chấm công, liên hệ admin" (không mở toang). Admin nhập giá trị thật qua hub trước khi dùng.
- `enforce_ip=false` cho phép vận hành tạm bằng GPS-only nếu công ty chưa có IP tĩnh (đáp ứng rủi ro đã nêu ở brainstorm) — nhưng mặc định bật.

## 6. Backend — module `staff`

Cấu trúc: `apps/api/src/modules/staff/` gồm controller + các service theo miền, tách file để mỗi phần gọn & test độc lập.

```
staff/
  staff.module.ts
  rbac/rbac.service.ts            // applyGrants, addGrant, revokeGrant, listStaff
  shifts/shifts.service.ts        // đăng ký/sửa/xoá/copy tuần, duyệt (admin), huỷ + luật phạt
  attendance/attendance.service.ts// checkin/checkout/heartbeat + verify IP/GPS + luật trễ
  attendance/geo.util.ts          // haversine
  attendance/ip.util.ts           // khớp IP trong danh sách CIDR/exact
  payroll/payroll.service.ts      // tính ngày/tháng, adjustments, đánh dấu đã trả
  staff.controller.ts             // self-service (@Roles STAFF/ADMIN)
  admin-staff.controller.ts       // quản lý (@Roles ADMIN)
  dto/*.ts
```

### 6.1 Endpoint (tóm tắt)

**Self (nhân viên — `@Roles('STAFF','ADMIN')`):**
- `GET  /staff/me` — hồ sơ (role, đơn giá, bank), ca hôm nay, session đang mở.
- `GET  /staff/shifts?from=&to=` — ca theo khoảng (lưới tuần).
- `POST /staff/shifts` — đăng ký 1..n ca (batch cho lưới tuần).
- `PATCH /staff/shifts/:id` — sửa ca PENDING.
- `DELETE /staff/shifts/:id` — xoá ca PENDING.
- `POST /staff/shifts/copy-week` — copy toàn bộ ca tuần `sourceWeekStart` sang `targetWeekStart` (tạo PENDING).
- `POST /staff/shifts/:id/cancel` — huỷ ca APPROVED (kèm `isEmergency`, `evidenceUrl`, `reason`) → áp luật phạt.
- `POST /staff/attendance/checkin` — `{shiftId, lat, lng}` → verify IP+GPS → mở session (đánh dấu trễ nếu cần).
- `POST /staff/attendance/checkout` — đóng session đang mở (MANUAL).
- `POST /staff/attendance/heartbeat` — `{lat, lng}` → cập nhật `lastHeartbeatAt`; nếu rớt IP/GPS → đóng session (OUT_OF_RANGE) + trả `{closed:true}`.
- `GET  /staff/payroll?year=&month=` — lương ngày trong tháng + tổng tháng + bank.
- `PUT  /staff/bank` — nhân viên tự cập nhật bank/QR nhận lương.

**Admin (`@Roles('ADMIN')`) — gắn vào hub admin:**
- `GET  /admin/staff` — danh sách nhân viên + đơn giá + trạng thái.
- `POST /admin/staff/grant` — `{phone, role}` thêm STAFF/ADMIN (tạo RoleGrant + áp ngay nếu user tồn tại).
- `POST /admin/staff/revoke` — `{phone}` thu hồi (revoke grant + hạ role về CUSTOMER nếu đang STAFF/ADMIN).
- `PUT  /admin/staff/:userId/rate` — đặt đơn giá giờ.
- `GET/POST/PATCH/DELETE /admin/shift-templates` — CRUD ca chuẩn.
- `GET  /admin/shifts?from=&to=&staffId=` — lịch tuần tất cả NV.
- `POST /admin/shifts/:id/approve` — `{approvedStart?, approvedEnd?}` duyệt (chỉnh giờ).
- `POST /admin/shifts/:id/reject` — `{reason}`.
- `POST /admin/shifts/bulk-approve` — `{ids[]}`.
- `GET  /admin/attendance/live` — session đang mở (giám sát).
- `POST /admin/attendance/manual` — checkin/adjust thủ công (trường hợp đặc biệt, có log).
- `GET  /admin/payroll?year=&month=` — bảng lương tháng toàn bộ NV.
- `POST /admin/payroll/:staffId/finalize` — chốt tháng (OPEN→FINALIZED).
- `POST /admin/payroll/:staffId/mark-paid` — `{proofImageUrl, note?}` (FINALIZED→PAID).
- `POST /admin/payroll/adjust` — cộng/trừ tay (`AdjustmentType.MANUAL`).

### 6.2 Verify chấm công (chi tiết)

- **IP:** lấy `req.ip` — API là **Express** và đã set `trust proxy=1` ở prod (`main.ts`) nên `req.ip` chính là IP thật từ `X-Forwarded-For` sau Caddy (không cần đổi hạ tầng) → so khớp `office_ips` (hỗ trợ exact + CIDR IPv4). `enforce_ip=false` → bỏ qua bước này. Dev (không prod) `req.ip` là IP local → test dùng `enforce_ip=false` hoặc thêm IP dev vào allowlist.
- **GPS:** `haversine(lat,lng, office_lat,office_lng) ≤ radius_m`.
- **Cả hai fail-closed:** thiếu cấu hình → từ chối. Trả mã lỗi rõ (`IP_NOT_ALLOWED` / `OUT_OF_RADIUS` / `NOT_CONFIGURED`) để FE hiện đúng thông báo.
- **Trễ:** khi mở session **đầu tiên** của ca, nếu `checkinAt > effectiveStart + late_grace_min` → `isLate=true` → tạo `PayrollAdjustment(LATE, late_fine)` (1 lần/ca, idempotent theo `shiftId+type`).

### 6.3 Auto checkout khi rời vùng

- **Heartbeat (app foreground):** FE ping mỗi ~3 phút. Server re-verify IP+GPS: đạt → cập nhật `lastHeartbeatAt`; không đạt → `checkout(OUT_OF_RANGE)` tại `now`.
- **Cron (`jobs`):** mỗi ~5 phút quét session mở có `lastHeartbeatAt < now - stale_min` → `checkout(STALE)` với `checkoutAt = lastHeartbeatAt` (không tính giờ "ma" sau khi mất kết nối).
- **Cron cuối ngày:** đóng mọi session còn mở của ca đã qua `effectiveEnd` → `checkout(SHIFT_END, checkoutAt = min(now, effectiveEnd))`.

### 6.4 Luật huỷ ca

- Huỷ ca `APPROVED`: tính số ngày từ `now` tới `workDate`.
  - `≥ cancel_notice_days` → miễn phạt, `status=CANCELLED`.
  - `< cancel_notice_days`:
    - `isEmergency && evidenceUrl` **và** số lần đột xuất trong tháng `< emergency_cap_month` → miễn phạt (đếm tăng).
    - ngược lại → phạt **1h công** = `round(hourlyRate)` → `PayrollAdjustment(LATE_CANCEL, hourlyRate)` gắn `workDate`.
- Ca `PENDING` huỷ/xoá tự do (chưa duyệt, không phạt).

### 6.5 Tính lương

- **`workedMinutes/ngày`** = `Σ` với mỗi session đã đóng: `overlap([checkinAt, checkoutAt], [effectiveStart, effectiveEnd])` (phút, ≥0). Session còn mở không tính (chờ đóng).
- **`gross`** = `round(workedMinutes / 60 * hourlyRate)`.
- **`adjTotal/ngày`** = `Σ amount` mọi `PayrollAdjustment` cùng `staffId+workDate` (LATE/LATE_CANCEL luôn dương = trừ; MANUAL có thể âm = thưởng/cộng).
- **`fines`** (cột hiển thị) = `Σ` các amount **dương** (để user thấy "đã bị trừ bao nhiêu").
- **`net`** = `max(0, gross - adjTotal)` — MANUAL âm làm `adjTotal` nhỏ lại ⇒ net tăng (thưởng). Chốt trần dưới 0.
- **Chốt ngày:** cron cuối ngày (sau khi đóng session) upsert `PayrollDay`. Cũng cho phép admin bấm tính lại.
- **Chốt tháng:** `PayrollMonth` = tổng các `PayrollDay` trong tháng (VN). `finalize` khoá lại; `mark-paid` cần `proofImageUrl`.

### 6.6 VietQR lương

- Ưu tiên `StaffProfile.qrImageUrl` nếu có; nếu không, FE dựng VietQR động từ `bankBin + bankAccountNo + bankAccountName + amount=net` (dùng lại cách `bank-payment.tsx` dựng ảnh QR VietQR `img.vietqr.io`). Nội dung CK gợi ý: `Luong T{month}/{year} {tênNV}`.

## 7. Frontend — Mini App

### 7.1 Trang nhân viên `/staff` (gate STAFF/ADMIN)

- **Hôm nay:** thẻ ca hôm nay + nút lớn **Checkin/Checkout** với trạng thái sống: đang lấy GPS…, "✓ Trong vùng công ty" / "✗ Ngoài vùng" / "✗ Sai mạng công ty". Nếu đang mở session → hiện đồng hồ đếm giờ + nút Checkout. Heartbeat chạy nền khi trang mở.
- **Lịch của tôi (lưới tuần):** 7 cột ngày × các ca; chạm ngày → sheet chọn **ShiftTemplate** hoặc giờ tuỳ chỉnh; badge trạng thái (chờ duyệt/đã duyệt/từ chối); nút **"Copy tuần trước"**; điều hướng tuần ‹ ›. Ca PENDING sửa/xoá được. Huỷ ca APPROVED → sheet lý do + toggle "đột xuất" + upload chứng cứ.
- **Lương của tôi:** chọn tháng → danh sách ngày (giờ công, phạt, thực nhận) + tổng tháng + trạng thái (đang tính/đã chốt/đã trả) + ảnh xác nhận khi PAID.
- **Nhận lương:** form bank (BIN/STK/tên) hoặc upload QR tĩnh.

### 7.2 Hub admin `/admin` (gate ADMIN) — mở rộng

- **Nhân sự:** thêm nhân viên bằng SĐT (chọn STAFF/ADMIN), danh sách + đặt đơn giá, thu hồi; link duyệt đơn CTV/đại lý (dùng lại API cũ).
- **Ca chuẩn:** CRUD ShiftTemplate.
- **Duyệt ca (lưới tuần toàn NV):** xem theo tuần, duyệt kèm **chỉnh giờ tại chỗ**, từ chối, **duyệt hàng loạt**.
- **Giám sát chấm công:** ai đang trong ca (session mở) + nút checkin/adjust thủ công.
- **Lương & chuyển khoản:** bảng tháng theo NV → net → mở VietQR (từ bank NV) → quét chuyển → **tick "Đã chuyển" + upload ảnh** → PAID.

### 7.3 Điều hướng & service

- `staff-api.ts` (self) + bổ sung `admin-api.ts`/mục staff cho hub admin.
- Route mới trong `app.tsx`: `/staff` (+ có thể `/admin` nếu chưa có trang admin trong miniapp — kiểm tra, hiện `apps/web` có `/admin` nhưng miniapp chưa; dựng hub admin trong miniapp theo pattern gate-role).
- Điểm vào: mục "Nhân viên" / "Quản trị" trong trang `profile.tsx`, hiện theo `user.role`.

## 8. Kiểm thử

- **Unit:** `haversine` (điểm trong/ngoài bán kính, biên); `ipMatch` (exact, CIDR /24, ngoài dải, IPv4 hợp lệ); `overlapMinutes` (session trong/ngoài/cắt biên cửa sổ ca; nhiều session; session mở bỏ qua); luật trễ (đúng grace, 1 lần/ca); luật huỷ (≥3 ngày miễn; <3 ngày phạt; đột xuất có/không chứng cứ; cap 3 lần/tháng); tính `PayrollDay`/`PayrollMonth` (gross/fines/net, làm tròn); `applyGrants` (chọn role cao nhất, không hạ nhầm).
- **E2E:** checkin bị chặn khi sai IP / ngoài vùng / ca chưa duyệt / chưa cấu hình; luồng checkin→checkout→tính lương; admin duyệt ca chỉnh giờ; mark-paid yêu cầu ảnh.
- Chạy `pnpm --filter @tubutree/api test` + typecheck toàn repo trước khi coi là xong.

## 9. Kế hoạch triển khai (4 phase tuần tự)

- **A. RBAC:** schema `RoleGrant` + seed admin_phones + `RbacService.applyGrants` gắn vào auth + endpoint admin thêm/thu hồi + UI hub admin (nhân sự) + test.
- **B. Ca làm:** `ShiftTemplate`/`Shift` + service đăng ký/sửa/xoá/copy-week/duyệt/huỷ + UI lưới tuần (NV) + UI duyệt (admin) + test.
- **C. Chấm công:** `AttendanceSession` + verify IP/GPS + checkin/out/heartbeat + cron auto-checkout + luật trễ + UI checkin + giám sát admin + test.
- **D. Lương:** `StaffProfile`/`PayrollDay/Month/Adjustment` + tính ngày/tháng + cron chốt + VietQR + mark-paid upload ảnh + UI lương (NV) & trả lương (admin) + test.

Mỗi phase: migration (nếu cần) → service + test → controller → FE → verify. Gộp tất cả bảng vào **1 migration** đầu (đỡ nhiều lần migrate), code theo phase.

## 10. Rủi ro & đánh đổi (đã chấp nhận ở brainstorm)

- **Cần IP tĩnh/dải cố định của công ty** — nhập qua config; nếu chưa có, tạm `enforce_ip=false` (GPS-only).
- **Từ chối GPS / mất mạng** ⇒ không checkin ⇒ có **checkin/adjust thủ công của admin** (log đầy đủ).
- **Fake GPS / VPN** ⇒ rủi ro còn lại; giảm bằng đối chiếu IP + log + admin audit.
- **Webview không chạy nền** ⇒ "auto checkout khi rời vùng" là **heuristic** (heartbeat + cron stale), không realtime tuyệt đối; chốt trần giờ tại giờ hết ca để không phát sinh giờ ma.
- **Đổi role hiệu lực ở refresh kế** (JWT mang role) — chấp nhận; có thể rút ngắn TTL nếu cần tức thời.
