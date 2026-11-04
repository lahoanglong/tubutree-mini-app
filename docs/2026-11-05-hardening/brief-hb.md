# Gói hb — phiên đăng nhập

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-hb`
- Nhánh: `hard/1105-hb`, gốc `d79ceeb85`
- Cổng PG: **46532**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo.

## Mục

### 1. L1-03: access token chết theo phiên

**SessionStateService:** select thêm `sessionsRevokedAt` và `mergedIntoId`.

**JwtStrategy trả 401 `SESSION_EXPIRED`:**
- khi `mergedIntoId` khác null;
- khi `payload.iat * 1000 < floor_giây(sessionsRevokedAt)`.

Lưu ý so ở mức giây: token cấp cùng giây với lần thu hồi vẫn bị chặn. Không được chặn token cấp SAU lần thu hồi.

**Logout:** thu hồi token đang dùng, và thu hồi luôn các refresh token cùng user có `rotatedAt` nằm trong khoảng ân hạn 30 s.
- Nếu cần cột `parentId` để thu hồi theo họ token thì thêm bằng migration mở rộng.

**Test:**
- unit `jwt.strategy.spec`:
  - token cấp trước `sessionsRevokedAt` → 401;
  - token đã gộp → 401;
  - token cấp sau → OK.
- unit `auth.service.spec`: logout xong, dùng lại token vừa xoay trong khoảng ân hạn → 401.
- race: phát hiện reuse rồi gọi một route có JWT bằng access token cũ → 401 (chậm nhất sau TTL cache 5 s, hoặc ngay nếu có `markStale`).

### 2. L1-04: đăng xuất mọi thiết bị

Chủ chọn: "Cả hai nút".

**API:**
- `POST /auth/logout-all` (cần JWT): gọi `revokeAllSessions(user.sub)`, rồi `sessions.invalidate`.
- `POST /admin/users/:id/revoke-sessions`:
  - chỉ ADMIN;
  - lý do bắt buộc (`MinLength 3`, `MaxLength 500`);
  - ghi `user_admin_events` với kind `SESSIONS_REVOKED`.

**Giao diện:** gọi skill `tubu-ui` trước khi sửa.
- Mini App: nút "Đăng xuất mọi thiết bị" ở màn tài khoản/cài đặt, cạnh nút đăng xuất. Có hộp xác nhận. Xong thì đăng xuất máy hiện tại.
- Web khách: cùng nút ở trang tài khoản. Theo luật project, web khổ điện thoại phải giống Mini App.
  - Phiên khác (web SEO/perf) cũng đang sửa `apps/web`. Giữ thay đổi web nhỏ, gọn trong trang tài khoản, và ghi rõ danh sách file web đã đổi trong báo cáo.
- Admin web: nút "Cắt phiên" trong drawer người dùng, chỉ ADMIN thấy. Bấm thì hỏi lý do.

**Test:**
- unit controller/service cho hai route;
- matrix spec;
- e2e/race: hai phiên, gọi logout-all ở phiên 1 → refresh ở phiên 2 trả 401, và access token của phiên 2 bị 401;
- vitest các nút.

## File không đụng
Các file của gói ha:
- `rbac.service.ts`
- `setUserRole` trong `admin.service.ts`

`admin.service.ts`: chỉ thêm hàm mới cho revoke-sessions, hoặc đặt hàm đó trong service auth.
