# Nhân sự — Phase E: Tinh chỉnh chấm công/lương + UX Implementation Plan

> REQUIRED SUB-SKILL: executing-plans.

**Goal:** (1) Sửa lỗi auto-close hại NV (bỏ STALE); (2) checkout lùi giờ (chống quên checkout, chỉ giảm được); (3) QL sửa giờ phiên + xem lại giờ từng NV; (4) lương tháng xổ theo tuần + lịch sử checkin/out; (5) đăng ký ca nhanh hơn (áp nhiều ngày + native time + copy tuần).

**Quyết định chốt:** nghỉ trưa/quên checkout = checkout lùi giờ + QL sửa; bỏ auto-close theo heartbeat (STALE), chỉ tự chốt ở giờ hết ca (SHIFT_END).

## Tasks

### E1: Bỏ STALE khỏi auto-close
- `attendance.job.ts` `computeAutoClose`: chỉ trả SHIFT_END (bỏ nhánh STALE). Phiên còn mở chỉ tự đóng khi quá giờ hết ca (tại giờ hết ca). Cập nhật `attendance.job.spec.ts` (bỏ test STALE, thêm test "heartbeat cũ nhưng chưa hết ca → null").
- Giữ heartbeat OUT_OF_RANGE (app mở + rời vùng) trong AttendanceService (không đổi).

### E2: Checkout lùi giờ
- `AttendanceService.checkout(staffId, at?: Date)`: nếu `at` → phải `checkinAt < at <= now`, else BadRequest; set checkoutAt=at, closeReason MANUAL. Không `at` → now.
- DTO `CheckoutDto { at?: ISO }`; controller `/staff/attendance/checkout` nhận body.
- Test: at hợp lệ (quá khứ) OK; at tương lai → BadRequest; at ≤ checkin → BadRequest; không at → now.

### E3: QL sửa/ thêm phiên (điều chỉnh giờ làm) + recompute
- `AttendanceService.adminEditSession(sessionId, {checkinAt?, checkoutAt?})`: load session (+shift.workDate, staffId); validate checkin<checkout; update; trả {staffId, workDate}.
- `AttendanceService.adminAddSession(shiftId, checkinAt, checkoutAt)`: tạo phiên thủ công (closeReason ADMIN, checkinLat/Lng/Ip=0/'admin'); trả {staffId, workDate}.
- Controller admin: `POST /admin/attendance/session/:id/edit`, `POST /admin/attendance/session` → sau khi sửa gọi `PayrollService.recomputeDay(staffId, workDate)`.
- Test: edit checkout ≤ checkin → BadRequest; edit hợp lệ → update + trả staffId/workDate.

### E4: Lịch sử phiên (self + admin detail)
- `AttendanceService.history(staffId, from, to)` → phiên theo checkinAt trong khoảng (id, shiftId, checkinAt, checkoutAt, isLate, closeReason).
- Self `GET /staff/attendance/history?from&to`.
- Admin `GET /admin/payroll/:staffId/detail?year&month` (controller): recompute + trả {days: PayrollDay[], sessions}.

### E5: FE — lương tháng xổ tuần + lịch sử
- `attendance-api.ts`: getHistory(from,to). `payroll-api.ts`: adminGetDetail(staffId,y,m).
- `my-payroll.tsx`: gom days theo TUẦN (T2–CN) → subtotal giờ+net mỗi tuần; xổ 1 ngày → hiện phiên (checkin HH:mm → checkout HH:mm, trễ). Giữ tổng tháng + ảnh PAID.

### E6: FE — đăng ký ca nhanh
- `staff.tsx` sheet thêm ca: native `<Input type="time">`; **tap template = thêm ngay**; thêm chế độ **"Áp nhiều ngày"**: chọn 1 template + tick các thứ (T2..CN) → createShifts batch. Giữ Copy tuần trước.
- Today card checkout: nút Checkout (mặc định now) + tuỳ chọn "Tôi về lúc…" (time) → checkout(at).

### E7: FE — QL review + sửa giờ
- `admin.tsx` tab Lương: mỗi NV có nút "Xem giờ" → sheet chi tiết tháng (tuần/ngày + phiên), mỗi phiên có "Sửa giờ" (2 time input) → editSession + recompute; nút "Thêm phiên" cho ca quên chấm. Sau đó "Chốt" (finalize) + "Đã chuyển" (proof) như cũ.

### E8: Verify — full api test + repo typecheck + build FE.

## Self-Review
- Đáp ứng: xem lương tháng xổ tuần + lịch sử checkin/out (E4,E5); đăng ký dễ + copy tuần + chỉnh nhanh (E6); QL review + duyệt + up ảnh (E7 + đã có); QL sửa giờ (E3); xử lý quên checkout = checkout lùi giờ + bỏ STALE (E1,E2) + QL sửa (E3).
- Money-critical có test: computeAutoClose, checkout lùi giờ, editSession recompute.
