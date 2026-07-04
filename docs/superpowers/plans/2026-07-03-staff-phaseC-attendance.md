# Nhân sự — Phase C: Chấm công IP + GPS Implementation Plan

> REQUIRED SUB-SKILL: executing-plans. Steps dùng checkbox.

**Goal:** Nhân viên checkin/checkout tại công ty — chỉ khi **IP nội bộ + GPS trong vùng**; nghỉ giữa ca checkout rồi checkin lại; ra khỏi vùng → auto checkout (heartbeat + cron). Đánh dấu đi trễ (tiền phạt để Phase D).

**Architecture:** Model `AttendanceSession`. Logic thuần `haversine` + `ipMatch` + `verifyPresence` (TDD). `AttendanceService` đọc config → verify → mở/đóng session. GPS: FE `getLocation()` → token → BE `ZaloService.resolveLocation`. Cron sweep session cũ/hết ca. IP lấy `req.ip` (đã trust proxy prod).

**Tech Stack:** NestJS 10, Prisma 5, @nestjs/schedule (jobs), Jest. FE ZaUI + zmp-sdk getLocation.

## Global Constraints

- `@Roles('STAFF','ADMIN')` self; `@Roles('ADMIN')` giám sát/thủ công.
- **Fail-closed:** thiếu cấu hình (không IP & không toạ độ) → từ chối checkin.
- Chỉ checkin ca `APPROVED` của chính mình, đúng ngày VN (`workDate` = hôm nay VN).
- Không tin thời gian client — server dùng `new Date()`.
- Trễ: session ĐẦU của ca & `checkinAt > effectiveStart + late_grace_min` → `isLate=true` (Phase D quy 10k).
- IP `req.ip` (Express trust proxy=1 prod). CIDR IPv4 + exact. `enforce_ip=false` → bỏ IP (GPS-only).
- Lệnh: test `pnpm --filter @tubutree/api test -- <path>`; typecheck `pnpm -w turbo run typecheck`; generate `prisma:generate`.

## File Structure

- Modify `schema.prisma`: enum `SessionCloseReason`, model `AttendanceSession`; `Shift` thêm `sessions AttendanceSession[]`.
- Migration `20260703040000_staff_phase_c_attendance/migration.sql`.
- Seed: thêm config `attendance.*` vào `SYSTEM_CONFIGS`.
- `attendance/geo.util.ts` (+spec) — haversine.
- `attendance/ip.util.ts` (+spec) — ipMatch (exact + CIDR IPv4).
- `attendance/verify.ts` (+spec) — verifyPresence(cfg, ip, lat, lng).
- `attendance/attendance.service.ts` (+spec).
- `attendance/attendance.dto.ts`.
- Mở rộng `staff.controller.ts` (checkin/checkout/heartbeat/status) + `admin-attendance.controller.ts` (live/manual).
- `auth/zalo.service.ts`: `resolveLocation`.
- `jobs/attendance.job.ts` (+ đăng ký trong QueueModule/jobs) — sweep.
- FE `attendance-api.ts`; thêm card "Hôm nay" vào `staff.tsx`; `zmp-bridge` thêm `requestZaloLocation`.

---

### Task 1: Schema + seed config

- [ ] enum + model:

```prisma
enum SessionCloseReason {
  MANUAL
  OUT_OF_RANGE
  STALE
  SHIFT_END
  ADMIN
}

model AttendanceSession {
  id              String              @id @default(cuid())
  shiftId         String
  shift           Shift               @relation(fields: [shiftId], references: [id], onDelete: Cascade)
  staffId         String
  checkinAt       DateTime            @default(now())
  checkoutAt      DateTime?
  checkinLat      Float
  checkinLng      Float
  checkinIp       String
  lastHeartbeatAt DateTime            @default(now())
  closeReason     SessionCloseReason?
  isLate          Boolean             @default(false)
  createdAt       DateTime            @default(now())

  @@index([shiftId])
  @@index([staffId, checkoutAt])
  @@map("attendance_sessions")
}
```

`Shift` thêm dòng: `sessions AttendanceSession[]` (virtual — không đổi SQL bảng shifts).

- [ ] Migration SQL: CreateEnum `SessionCloseReason`; CreateTable `attendance_sessions` (cột như trên: Float cho lat/lng → `DOUBLE PRECISION`; bool default false; FK shiftId → shifts ON DELETE CASCADE); 2 index.

- [ ] Seed `SYSTEM_CONFIGS` thêm:

```typescript
  { key: 'attendance.office_ips', value: [], category: 'attendance', description: 'Danh sách IP/CIDR nội bộ được phép checkin' },
  { key: 'attendance.office_lat', value: null, category: 'attendance', description: 'Vĩ độ công ty' },
  { key: 'attendance.office_lng', value: null, category: 'attendance', description: 'Kinh độ công ty' },
  { key: 'attendance.radius_m', value: 150, category: 'attendance', description: 'Bán kính GPS cho phép (m)' },
  { key: 'attendance.late_grace_min', value: 30, category: 'attendance', description: 'Trễ quá X phút thì phạt' },
  { key: 'attendance.late_fine', value: 10000, category: 'attendance', description: 'Tiền phạt đi trễ (VND)' },
  { key: 'attendance.cancel_notice_days', value: 3, category: 'attendance', description: 'Huỷ ca báo trước X ngày' },
  { key: 'attendance.emergency_cap_month', value: 3, category: 'attendance', description: 'Số lần huỷ đột xuất miễn phạt/tháng' },
  { key: 'attendance.heartbeat_stale_min', value: 10, category: 'attendance', description: 'Không heartbeat quá X phút → auto checkout' },
  { key: 'attendance.enforce_ip', value: true, category: 'attendance', description: 'Bật kiểm IP (tắt nếu chưa có IP tĩnh)' },
```

(cancel_notice_days/emergency_cap_month đã dùng ở Phase B — seed bổ sung để có default.)

- [ ] generate + commit.

---

### Task 2: `geo.util.ts` (haversine) — TDD

```typescript
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
```

Test: cùng điểm → 0; ~1 vĩ độ ≈ 111km (±1%); 2 điểm gần (100m) trong khoảng hợp lý.

---

### Task 3: `ip.util.ts` (ipMatch) — TDD

```typescript
function ipToLong(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** Chuẩn hoá IPv4-mapped IPv6 (::ffff:1.2.3.4) → 1.2.3.4. */
function normalizeIp(ip: string): string {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1]! : ip;
}

/** Khớp ip với 1 mục: exact IPv4 hoặc CIDR 'a.b.c.d/nn'. */
export function ipMatchOne(ip: string, entry: string): boolean {
  const target = ipToLong(normalizeIp(ip));
  if (target === null) return false;
  if (entry.includes('/')) {
    const [net, bitsStr] = entry.split('/');
    const bits = Number(bitsStr);
    const netLong = ipToLong(net ?? '');
    if (netLong === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (target & mask) === (netLong & mask);
  }
  return target === ipToLong(entry.trim());
}

export function ipMatch(ip: string, list: string[]): boolean {
  return list.some((e) => ipMatchOne(ip, e));
}
```

Test: exact khớp/không; CIDR /24 trong dải/ngoài dải; /32; IPv4-mapped; IP rác → false; list rỗng → false.

---

### Task 4: `verify.ts` (verifyPresence) — TDD

```typescript
import { haversineMeters } from './geo.util';
import { ipMatch } from './ip.util';

export interface AttnConfig {
  officeIps: string[];
  lat: number | null;
  lng: number | null;
  radiusM: number;
  enforceIp: boolean;
}
export type VerifyResult =
  | { ok: true; distanceM: number }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'IP_NOT_ALLOWED' | 'OUT_OF_RADIUS' };

export function verifyPresence(cfg: AttnConfig, ip: string, lat: number, lng: number): VerifyResult {
  const gpsConfigured = cfg.lat !== null && cfg.lng !== null;
  const ipConfigured = cfg.officeIps.length > 0;
  if (!gpsConfigured && !(cfg.enforceIp && ipConfigured)) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (cfg.enforceIp && ipConfigured && !ipMatch(ip, cfg.officeIps)) return { ok: false, reason: 'IP_NOT_ALLOWED' };
  if (gpsConfigured) {
    const d = haversineMeters(cfg.lat!, cfg.lng!, lat, lng);
    if (d > cfg.radiusM) return { ok: false, reason: 'OUT_OF_RADIUS' };
    return { ok: true, distanceM: Math.round(d) };
  }
  return { ok: true, distanceM: 0 };
}
```

Test: chưa cấu hình gì → NOT_CONFIGURED; enforceIp + sai IP → IP_NOT_ALLOWED; đúng IP + ngoài bán kính → OUT_OF_RADIUS; đúng cả → ok; enforce_ip=false + trong bán kính → ok (bỏ IP).

---

### Task 5: `AttendanceService` — checkin/checkout/heartbeat

Đọc config qua `SystemConfigService.get<T>`. Methods:
- `private async loadCfg(): Promise<AttnConfig & { graceMin; staleMin }>`.
- `async status(staffId)` → ca APPROVED hôm nay + session đang mở.
- `async checkin(staffId, ip, { shiftId, lat, lng })`:
  - shift = findFirst {id:shiftId, staffId, status:APPROVED}; !shift → NotFound.
  - verifyPresence(cfg, ip, lat, lng); !ok → BadRequest(reason).
  - đã có session mở của ca? → BadRequest 'Đang trong ca'.
  - effectiveStart = approvedStart ?? startAt; đếm session của ca → nếu 0 và now > effectiveStart + grace → isLate=true.
  - create session {shiftId, staffId, checkinLat/Lng/Ip, isLate}.
- `async checkout(staffId, { lat?, lng? })`: đóng session mở gần nhất (MANUAL). Không có → BadRequest.
- `async heartbeat(staffId, ip, { lat, lng })`: session mở? không → {open:false}. verify → fail → đóng OUT_OF_RANGE, {open:false,closed:true,reason}. ok → update lastHeartbeatAt, {open:true}.
- Admin: `listLive()` session mở (+staff), `manualCheckin/Adjust`.

Test (mock prisma + config): checkin ca không APPROVED → NotFound; sai IP → BadRequest; đúng → create isLate đúng; đang có session mở → BadRequest; heartbeat rớt vùng → đóng OUT_OF_RANGE.

> Toạ độ: nhận trực tiếp `lat/lng` (đã resolve từ token ở controller). Service không phụ thuộc Zalo → test thuần.

---

### Task 6: ZaloService.resolveLocation + controller resolve

- `resolveLocation(token, accessToken): Promise<{lat,lng}|null>` — GET `graph.zalo.me/v2.0/me/info` header {access_token, code: token, secret_key}; parse `data.data.latitude/longitude` (best-effort, log lỗi trả null). *Cần kiểm chứng shape với Zalo thật.*
- Controller checkin/heartbeat nhận `{ locationToken?, zaloAccessToken?, lat?, lng? }`. Nếu có token+accessToken → resolve; else dùng lat/lng. Không ra được toạ độ → BadRequest 'Không lấy được vị trí (bật GPS)'.

---

### Task 7: Cron sweep (jobs)

`attendance.job.ts` (@Injectable, @Cron mỗi 5 phút):
- `sweepStale()`: session mở, `lastHeartbeatAt < now - staleMin*60000` → update checkoutAt=lastHeartbeatAt, closeReason=STALE.
- `sweepShiftEnd()`: session mở JOIN shift, effectiveEnd(approvedEnd??endAt) < now → checkoutAt=min(now, effectiveEnd), SHIFT_END.
Đăng ký provider trong module có ScheduleModule (thêm vào StaffModule hoặc jobs). Test: hàm nhận now, tính đúng (có thể tách logic `computeStaleCutoff`); tối thiểu smoke test service method với mock prisma.

---

### Task 8: FE — attendance-api + card "Hôm nay" + getLocation

- `zmp-bridge.ts`: `requestZaloLocation(): Promise<{token} | null>` bọc getLocation.
- `attendance-api.ts`: getStatus(), checkin(body), checkout(body), heartbeat(body); admin live.
- `staff.tsx`: card "Hôm nay" trên cùng — ca hôm nay + nút lớn Checkin/Checkout. Khi bấm: lấy token getLocation + zaloAccessToken → gọi checkin. Đang trong ca → hiện đồng hồ + nút Checkout + heartbeat interval (mỗi 3 phút). Trạng thái GPS/IP hiển thị theo lỗi trả (IP_NOT_ALLOWED → "Sai mạng công ty", OUT_OF_RADIUS → "Ngoài vùng công ty", NOT_CONFIGURED → "Chưa cấu hình chấm công").
- (Tùy chọn) admin: mục giám sát session mở.

Verify: typecheck + build FE; full api test; repo typecheck.

## Self-Review

- Spec coverage: §4.4 AttendanceSession, §5 config, §6.2 verify IP+GPS + trễ, §6.3 auto-checkout (heartbeat+cron), §7.1 card hôm nay — có task. Tiền phạt trễ = Phase D (đọc `session.isLate`).
- Placeholder: code thật cho util/verify; resolveLocation ghi rõ cần kiểm chứng shape Zalo (wrapper mỏng như resolvePhoneNumber đã ship).
- Type consistency: `verifyPresence` reason enum dùng chung BE message + FE mapping.
