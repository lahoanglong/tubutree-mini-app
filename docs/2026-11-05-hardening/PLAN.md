# Đợt hoàn thiện 05/11 (Admin / API / Mini App) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đợt nối tiếp sec/1104-audit. Gồm hai phần:
- Đóng các việc tồn từ đợt trước.
- Rà và sửa tiếp ba nhóm, đều ngoài những gì đợt trước đã sửa:
  - Security: phiên đăng nhập, thao tác admin, webhook phát lại.
  - Performance: truy vấn chậm, export, gọi dịch vụ ngoài.
  - Edge case: tiền, idempotency, trạng thái lỗi trên Mini App và admin.

**Architecture:**
- Pha 0: chuẩn bị nhánh.
- Pha A: 3 việc đã biết rõ đầu vào, làm ngay.
- Pha B: 4 làn audit chỉ đọc chạy song song, mỗi làn trả JSON cùng một khuôn.
- Pha C: chủ quyết các điểm cần quyết, rồi chia gói.
- Pha D: mỗi gói làm trong worktree riêng: TDD, sau đó Opus duyệt đối kháng, sau đó tôi tự kiểm toàn bộ.
- Pha E: gộp vào một nhánh tích hợp, review chéo, kiểm cuối đầy đủ, PR, 4f deploy.

**Tech Stack:** NestJS + Prisma 5.22 + Postgres 16 + BullMQ (apps/api); Vite + zmp + react-query 5 (apps/miniapp); Next 15 (apps/web admin); Playwright (apps/e2e); jest race suite (apps/api/test/integration-race).

**Spec:**
- `/tmp/prompt-tubu-sec-perf-seo.md` phần 2.
- `docs/2026-11-04-sec-perf/PROGRESS.md`: danh sách đã sửa, quyết định của chủ, "Lưu ý cho chủ".

## Global Constraints

- Phiên này KHÔNG deploy; 2a/4f deploy. KHÔNG ghi PROD. Đọc PROD phải được chủ cho phép trước.
- Không `push --force`, `--no-verify`, `git stash` trần, amend hay rebase-squash. Không kill tiến trình mình không tạo.
- Không merge vào main giữa lúc 4f báo "dep1 bắt đầu" và lúc báo "dep3 xong".
- Thay đổi về tiền, auth, tin nhắn tới khách, dữ liệu PROD: bắt buộc Opus duyệt đối kháng tới APPROVE.
- Mọi chuỗi của API và giao diện:
  - Không có "Vui lòng" hay "chúng tôi" (`packages/app-core/src/terminology.spec.ts`).
  - Tiếng Việt có dấu, viết "Hoá" chứ không "Hóa" (NFC).
- Migration:
  - Chạy trong transaction, nên không dùng `CONCURRENTLY`.
  - Tách ADD COLUMN khỏi UPDATE backfill.
  - Chỉ mở rộng, để image `:prev-*` vẫn chạy được.
  - Migration nặng phải vào `HEAVY_MIGRATIONS` (`apps/api/src/config/go-live/db-checks.ts`) và bảng §1.0 của `docs/launch/deploy-rollback-runbook.md`, kèm câu đếm chỉ đọc.
- Giờ: lưu UTC; hiển thị và cắt ngày theo Asia/Ho_Chi_Minh.
- Web khổ 375px phải giống Mini App cả giao diện; mọi thay đổi UI khách phải so ảnh 375px.
- Commit message tiếng Việt, kết thúc bằng trailer Co-Authored-By. Comment chỉ giải thích "vì sao", không kể việc vừa làm.
- File dùng chung với 4f, sửa phải hỏi trước: `packages/app-core`, `packages/shared-types`, `apps/e2e/playwright.config.*`, `apps/web/next.config.*`, `apps/web/src/middleware.ts`, CSP.
- Tự kiểm mỗi gói phải chạy jest + race TOÀN BỘ trên DB mới, không chỉ thư mục đổi (bài học đợt 04/11).

## Review Focus

- **Admin hai tab cùng làm một việc tiền** (duyệt rút, hoàn, cộng Ví): phải ra đúng một lần, lần thứ hai nhận 409 kèm câu rõ ràng. Test: race đồng thời ở gói tiền của Pha D.
- **Webhook phát lại hoặc tới sai thứ tự** (Pancake, AccessTrade, Gomdon, Zalo OA): trạng thái cuối không đổi và không gửi tin trùng. Test: race phát lại ×2 và đảo thứ tự, ở làn L2.
- **Mạng chập chờn trên Mini App giữa lúc gửi đơn hay rút tiền:** không tạo hai lần; trả lời mất thì tải lại thấy đúng trạng thái. Test: Playwright route abort sau khi request đã gửi, ở làn L4.
- **Đổi vai trò hay quyền nhân viên khi người đó đang đăng nhập:** quyền mới áp ngay ở request kế tiếp (gắn với markStale của 4f). Test: e2e đổi quyền rồi gọi lại API, ở làn L1.
- **Export CSV hay báo cáo admin trên dữ liệu lớn:** không làm API hết bộ nhớ, không giữ kết nối quá trần. Test: seed 200k dòng rồi đo bộ nhớ và thời gian, ở làn L3.

---

## Pha 0 — Chuẩn bị (sau khi sec/1104-audit vào main và 4f deploy xong)

- [ ] **Bước 1:** `git fetch`; xác nhận main chứa merge của sec/1104-audit và web/1104-seo-perf. Chạy `git log --oneline -3 origin/main`, phải thấy cả hai merge.
- [ ] **Bước 2:** tạo worktree `.claude/worktrees/hard-1105`, nhánh `hard/1105` từ origin/main.
- [ ] **Bước 3:** chép kế hoạch này vào `docs/2026-11-05-hardening/PLAN.md` và tạo `PROGRESS.md` cùng thư mục. Commit `docs(hardening): kế hoạch và tiến độ đợt 05/11`.
- [ ] **Bước 4:** phân cổng:
  - Postgres cho gói: 46501–46509.
  - Postgres cho làn audit, nếu cần chạy EXPLAIN: 46511–46514.
  - Gốc pw-gate: 47200.

## Pha A — Việc đã biết rõ (làm ngay, song song với audit)

### Task A1: Sổ sự kiện ghi mọi lần đổi dấu thu hồi CTV

Vì sao: `setUserRole` khi vai trò không đổi không ghi sự kiện ROLE (`admin.service.ts:675`), nhưng vẫn xoá dấu. Hậu quả: lịch sử không cho biết ai mở lại quyền rút; backfill sau này cũng không phát lại được.

**Files:**
- Modify: `apps/api/src/common/user-admin-events.ts:5`, thêm kind `'AFFILIATE_REVOKE'`.
- Modify: `apps/api/prisma/schema.prisma:346` (doc comment kind).
- Modify: `apps/api/src/modules/admin/admin.service.ts` ~662–676 (setUserRole).
- Modify: `apps/api/src/modules/storefront/sample-storefronts.ts:297`.
- Test: `apps/api/src/modules/admin/admin.service.spec.ts`, `apps/api/test/integration-race/affiliate-payout-role-downgrade.race-spec.ts`.

**Interfaces:**
- Produces: sự kiện `{ kind: 'AFFILIATE_REVOKE', from: <ISO cũ> | null, to: <ISO mới> | null, actorId }`, ghi cùng tx mỗi khi giá trị `affiliateRevokedAt` thực sự đổi.

- [ ] **Bước 1:** viết test `setUserRole DEALER→DEALER trên người có dấu: xoá dấu và ghi AFFILIATE_REVOKE (from ISO, to null)`. Assert `recordUserAdminEvent` được gọi với `kind: 'AFFILIATE_REVOKE'`, `to: null`.
- [ ] **Bước 2:** viết test `CTV→CUSTOMER: ghi ROLE và AFFILIATE_REVOKE (from null, to ISO)`.
- [ ] **Bước 3:** viết test `STAFF→STAFF không đụng dấu: không ghi AFFILIATE_REVOKE`.
- [ ] **Bước 4:** chạy `npx jest src/modules/admin/admin.service.spec.ts -t AFFILIATE_REVOKE`. Kỳ vọng: FAIL.
- [ ] **Bước 5:** sửa setUserRole: so `user.affiliateRevokedAt` (đọc từ dòng đã khoá) với giá trị sau patch, khác nhau thì ghi sự kiện. Làm tương tự ở `sample-storefronts.ts:297`.
- [ ] **Bước 6:** thêm race test: chuỗi hạ, `setUserRole` cùng vai trò, đọc `user_admin_events`, phải có 2 dòng AFFILIATE_REVOKE đúng thứ tự.
- [ ] **Bước 7:** chạy jest admin + affiliate + storefront, và race spec trên. Kỳ vọng: PASS.
- [ ] **Bước 8:** commit `fix(admin): ghi sổ mỗi lần đổi dấu thu hồi CTV, kể cả đặt lại cùng vai trò`.

### Task A2: Admin thấy dấu thu hồi CTV

Vì sao: admin hiện không thấy dấu ở đâu. Đại lý bị hạ rồi được duyệt lại sẽ không có hoa hồng mà không ai biết lý do.

**Files:**
- Modify: `apps/api/src/modules/admin/admin.service.ts:749` (getUserDetail select `affiliateRevokedAt`).
- Modify: `admin.service.ts:310` (listDealerApplications: trả `applicantAffiliateRevoked: boolean`).
- Modify: `apps/web/src/lib/admin-client.ts:2240` (`AdminUserDetail.affiliateRevokedAt: string | null`) và kiểu `DealerApp` (`applicantAffiliateRevoked: boolean`).
- Modify: `apps/web/src/components/admin/user-detail-drawer.tsx`.
- Modify: `apps/web/src/app/admin/page.tsx` ~945 (hàng hồ sơ đại lý).
- Test:
  - `user-detail-drawer.spec.tsx`
  - `apps/web/src/app/admin/page.spec.tsx`
  - `admin.service.spec.ts`
  - fixture `dealerApp` trong `apps/e2e/tests/admin.spec.ts`

**Interfaces:**
- Consumes: không.
- Produces: các trường API trên; câu chữ cố định:
  - Drawer: `Đã thu hồi quyền CTV ngày {dd/MM/yyyy}. Hoa hồng cũ bị giữ; đổi vai trò sang CTV hoặc Đại lý để cấp lại.`
  - Hàng hồ sơ đại lý: `Người này từng bị thu hồi quyền CTV. Duyệt hồ sơ không mở lại quyền rút hoa hồng.`

- [ ] **Bước 1:** test API: `getUserDetail` trả `affiliateRevokedAt`; `listDealerApplications` trả `applicantAffiliateRevoked` đúng true/false. Chạy, kỳ vọng FAIL.
- [ ] **Bước 2:** sửa select trong API. Chạy lại, kỳ vọng PASS.
- [ ] **Bước 3:** test vitest drawer: có dấu thì hiện đúng câu, ngày theo giờ VN (dùng `formatVnDate` ở `apps/web/src/lib/subscription-options.ts:53`, hoặc formatter ngày VN admin đang dùng); không dấu thì không hiện. Thêm test page: hồ sơ có `applicantAffiliateRevoked` thì hiện câu cảnh báo. Chạy, kỳ vọng FAIL.
- [ ] **Bước 4:** sửa UI, rồi cập nhật fixture e2e `dealerApp` thêm `applicantAffiliateRevoked: false`.
- [ ] **Bước 5:** chạy vitest web (drawer, page), `tsc-e2e`, và Playwright `admin.spec.ts`. Kỳ vọng: PASS.
- [ ] **Bước 6:** commit `feat(admin): hiện dấu thu hồi CTV ở chi tiết người dùng và hồ sơ đại lý`.

### Task A3: Hoa hồng APPROVED của CTV đã bị thu hồi (CẦN CHỦ QUYẾT trước khi làm)

Hiện trạng: cron chuyển Ví bỏ qua người có dấu và log warn mỗi giờ (`affiliate.service.ts` ~1682–1700); tiền treo vô thời hạn.

Lựa chọn hỏi chủ (AskUserQuestion):
- **(a) Admin tự xử lý (khuyên):** thêm nút "Huỷ hoa hồng chờ rút" ở drawer người dùng. Nút đổi mọi commission APPROVED của người có dấu sang CANCELLED trong một tx, ghi sự kiện `WALLET_FORFEIT`, và bắt buộc nhập lý do.
- **(b) Giữ nguyên:** chỉ giảm log còn một lần mỗi ngày cho mỗi người.
- **(c) Tự huỷ sau N ngày.**

Nếu chủ chọn (a):

**Files:**
- Create: `apps/api/src/modules/admin/dto/forfeit-commissions.dto.ts` (`reason: string`, MaxLength 500, NO_HTML).
- Modify: `admin.controller.ts`: `POST /admin/users/:id/forfeit-commissions`, quyền ADMIN.
- Modify: `admin.service.ts`: `forfeitRevokedCommissions(adminId, userId, reason): Promise<{ cancelled: number; amount: number }>`.
  - Khoá users trước, rồi commissions, theo thứ tự khoá của `requestPayout`.
  - Người không có dấu: 409.
- Modify: `user-detail-drawer.tsx`: nút và hộp xác nhận nhập lý do. Chỉ hiện khi có dấu và còn hoa hồng APPROVED.
- Test: unit, race (đồng thời với `requestPayout` và cron; đúng một bên thắng, tổng tiền khớp), vitest drawer.

- [ ] Các bước TDD như A1. Bắt buộc Opus duyệt (đây là việc tiền).

## Pha B — Audit chỉ đọc (4 làn song song, Opus, mỗi làn một agent)

Khuôn kết quả chung, ghi vào `docs/2026-11-05-hardening/10-audit-<làn>.json`:

```json
{ "lane": "L1", "findings": [ { "id": "L1-01", "severity": "CRITICAL|MAJOR|MINOR", "title": "...", "files": ["path:line"], "scenario": "đầu vào/trạng thái → kết quả sai", "fix": "...", "test": "unit|race|playwright: tên + assert", "needsOwner": false } ] }
```

Mỗi làn nhận trong brief:
- Danh sách ID đợt 04/11 đã sửa (A1–A4, W1–W9, F1–F12, SEC-F1–F4, D1–D13 trừ D9, V1–V11, cùng các mục đã sửa ở gói j), để không báo lại.
- Ngoài phạm vi: web khách (của 4f), hạ tầng Caddy/Cloudflare.

### Làn L1 — Phiên đăng nhập, quyền, thao tác admin
- Đổi vai trò hoặc quyền nhân viên trong lúc người đó đang đăng nhập: JWT cũ còn hiệu lực bao lâu? Đối chiếu với markStale của 4f (account-deletion, setUserRole, rbac, system-config).
- Refresh token: phát hiện dùng lại (reuse) khi bị lộ; thu hồi cả họ token; logout ở mọi thiết bị.
- Mọi route admin và staff: guard kiểm đúng `staffPermissions` của từng nhóm việc, không chỉ role. Lập bảng route và quyền.
- IDOR trên các route mới hoặc vừa đổi từ 04/11 (`git diff 42050c881..origin/main -- '*.controller.ts'`): id trong path hay body phải thuộc đúng người gọi.
- Thao tác admin nhạy cảm (tiền, vai trò, cấu hình, khoá user, xuất dữ liệu): có `user_admin_events` hoặc audit log chưa? Có lý do bắt buộc chưa?
- Rate limit cho OTP, đăng nhập Zalo, rút tiền, đổi điểm, mã giảm giá (dò mã), tìm user ở admin.
- Gộp tài khoản (`mergedIntoId`): token và phiên của dòng cũ có còn dùng được không.

### Làn L2 — Tiền, idempotency, webhook (edge case)
- Mọi endpoint di chuyển tiền hoặc điểm (Ví, rút, hoàn, đổi điểm, voucher, flash sale tồn kho, công nợ đại lý, thưởng mốc, quay thưởng). Với mỗi endpoint, kiểm:
  - Gửi đôi.
  - Hai tab admin.
  - Số 0, số âm, số rất lớn, số lẻ.
  - Làm tròn.
  - Khoá idempotency.
- Job BullMQ: retry có an toàn không (idempotent), backoff, job chết thì có báo không.
- Webhook (Pancake, AccessTrade, Gomdon, Zalo OA, bridge): phát lại, đảo thứ tự, trùng id, thiếu trường, giá trị lạ.
- Cron đổi tiền hoặc điểm chạy giữa lúc deploy, có lease (gói i): lượt bị cắt ngang có để lại trạng thái dở không.

### Làn L3 — Hiệu năng API / DB
- Dựng Postgres có seed lớn (`docs/2026-10-28-review/tools/seed-data.mjs`, nâng lên khoảng 200k đơn và 50k user) rồi chạy EXPLAIN (ANALYZE, BUFFERS) cho:
  - 30 endpoint nóng nhất: danh sách admin, báo cáo, Trang chủ, giỏ, checkout.
  - Mọi cron.
- Danh sách admin không trần `limit`; export CSV hay báo cáo dồn cả bảng vào bộ nhớ.
- Gọi dịch vụ ngoài (Pancake, Zalo, Cloudinary, AccessTrade, VietQR, SMTP): có timeout, retry có trần, circuit khi bên kia sập không.
- Kích thước pool Prisma so với số cron, worker BullMQ và request đồng thời; giao dịch dài.
- Khoá Redis thiếu TTL; khoá cache phình to.
- Kích thước JSON trả về của 20 endpoint nóng nhất. Ngưỡng báo: trên 100 KB.

### Làn L4 — Mini App + admin UI (độ bền, hiệu năng, edge case)
- Trạng thái lỗi, rỗng, mất mạng, hết phiên ở mọi màn có gọi API. Không màn nào trắng hoặc kẹt spinner.
- Nút gửi tiền hoặc đơn: chặn bấm đôi; mất response thì tải lại hiển thị đúng.
- `maxLength` trên ô nhập phải khớp trần DTO mới của gói b. Lập bảng ô nhập và trần.
- Danh sách dài (đơn, thông báo, ví, admin): có phân trang hoặc ảo hoá không; bộ nhớ sau 5 phút cuộn.
- Interval, listener hay subscription không dọn khi rời màn; poll vẫn chạy khi tab ẩn (admin).
- Bundle: Mini App so với ngân sách bước `bundle` của gate; admin First Load JS sau gói g.
- 375px web và Mini App: các màn đợt này sửa phải giống nhau.

## Pha C — Phân loại và chủ quyết

- [ ] **Bước 1:** gộp 4 file JSON và bỏ trùng; mỗi mục ghi vào `PROGRESS.md`, một dòng ngắn kèm file:line.
- [ ] **Bước 2:** gom các mục `needsOwner` cùng A3 vào một lượt AskUserQuestion, tối đa 4 câu mỗi lượt, có lựa chọn "(Recommended)".
- [ ] **Bước 3:** chia gói theo ranh giới file, để không hai gói cùng sửa một file:
  - `ha` (auth)
  - `hb` (tiền/webhook)
  - `hc` (DB/perf)
  - `hd` (Mini App)
  - `he` (admin UI)
  - Nếu ít mục thì gộp gói.
### Kết quả phân gói (04/11 ~17:30)

Nguồn: `audit-1105-findings.md`, gồm 4 làn và 2 vòng quyết định của chủ. Pha A gộp vào gói `ha`, vì cùng sửa `setUserRole`.

**Không gói nào sửa trùng hàm.** Hai file lớn bị nhiều gói cùng sửa, mỗi gói ở hàm khác nhau:
- `admin.service.ts`
- `apps/web/src/app/admin/page.tsx`

Vì vậy lúc tích hợp, gộp theo thứ tự đợt dưới đây. Gói nào gộp sau thì tự giải xung đột.

| Gói | Phạm vi | Mục |
|---|---|---|
| `ha` | Vai trò, CTV thu hồi, nhân sự (admin.service users + `setUserRole`, rbac, staff, affiliate, admin web tab Người dùng/Nhân sự) | A1, A2, A3 (nút huỷ hoa hồng chờ rút); L1-02; L1-05 (7 ngày + cấm mời ADMIN số lạ + danh sách lời mời chờ); L1-06 (CSKH phải tìm); L1-07 (`admin_export_logs`); L1-08 (`reason` bắt buộc + `commission_rate_history`) |
| `hb` | Phiên đăng nhập (auth, jwt.strategy, session-state; nút ở Mini App và web) | L1-03; L1-04 (`/auth/logout-all` + `/admin/users/:id/revoke-sessions`). Phần web khách: hỏi phiên web-seo-perf trước khi sửa `apps/web` ngoài admin |
| `hc` | Tiền, webhook (cashback, vouchers, ZNS, rút hoa hồng) | L2-01..L2-09. L2-02: giữ quyết định của Kế toán, báo khi lệch. L2-05: bù chênh lệch |
| `hd1` | Index và truy vấn (migration) | L3-08, 09, 10, 11, 13, 14, 15, 16, 18, 19, 20 |
| `hd2` | Runtime (hộp việc, timeout, queue, breaker) | L3-04, L3-05 (`DATABASE_URL` options + runbook + `maxWait`), L3-06, L3-07, L3-12, L3-21 |
| `hd3` | Payload ảnh/cột nặng | L3-01 (MINOR), L3-02, L3-03, L3-17 |
| `he` | Mini App | L4-01 (timeout ảnh 60–90 s), L4-02, L4-03 (phần Mini App), L4-04, L4-05 |
| `hf` | Admin web + nhãn lỗi | L4-03 (admin + `FIELD_LABELS`), L4-06 (API + UI flash sale) |

**Đợt chạy.** Mỗi đợt tối đa 3 worker song song; mỗi worker dùng một cổng PG riêng, đánh số từ 46531 (gói k của sec/1104 đang giữ 46521).
1. `ha`, `hb`, `hc`. Đây là đợt tiền và auth; reviewer Opus bắt buộc.
2. `hd1`, `hd2`, `hd3`.
3. `he`, `hf`.

- [ ] **Bước 4:** mỗi gói có brief riêng `docs/2026-11-05-hardening/brief-<gói>.md`, ghi:
  - từng mục, kèm test bắt buộc (RED trước);
  - cổng Postgres;
  - các file không được đụng.

## Pha D — Làm từng gói (worker Sonnet, worktree `hard-1105-<gói>`)

Mỗi gói đi đủ các bước sau, tôi theo dõi:
- [ ] **Bước 1:** worker làm TDD; mỗi mục một commit; báo cáo dán output thật.
- [ ] **Bước 2:** tôi tự chạy lại: `tsc` các app bị đổi, jest api TOÀN BỘ, race TOÀN BỘ trên DB mới (`pg-native.sh createdb <port> tubutree_it`), drift = 0, vitest app bị đổi, `terminology.spec.ts` khi có chuỗi mới.
- [ ] **Bước 3:** Opus duyệt đối kháng (agent `reviewer`). Lặp lại tới APPROVE. Mục tiền, auth, tin khách thì không bỏ qua MINOR nào.
- [ ] **Bước 4:** ghi trạng thái vào `PROGRESS.md`.

## Pha E — Tích hợp và giao deploy

- [ ] **Bước 1:** gộp các gói vào `hard/1105` theo thứ tự ít xung đột trước (hc, ha, hb, hd, he).
- [ ] **Bước 2:** Opus review chéo toàn diff: gói đụng nhau, thứ tự migration, rollback.
- [ ] **Bước 3:** kiểm cuối trên tip cuối:
  - `bash docs/2026-10-28-review/tools/gate.sh <wt> --base <main> --out <f>`
  - race toàn bộ trên DB mới
  - drift 0
  - `docs/2026-10-28-review/tools/pw-gate.sh <wt> 47200`

  Mọi bước phải PASS.
- [ ] **Bước 4:** push, mở PR (thân kết thúc bằng dòng Claude Code), chờ CI xanh, merge ngoài cửa sổ dep1–dep3.
- [ ] **Bước 5:** nhắn 4f: SHA, danh sách migration và cách hoàn tác, câu kiểm sau deploy.
- [ ] **Bước 6:** cập nhật memory và báo chủ bằng tiếng Việt.

## Để ngoài đợt này (có lý do)

- **D9** (image-resize unnest `products.images`): làm khi catalog đối tác lớn.
- **NIT backfill gian hàng CTV đã xoá:** không còn tiền để rút.
- **Việc của chủ hoặc hạ tầng:**
  - webhook Pancake 401 trên PROD;
  - khoá Zalo OA;
  - rate limit Cloudflare;
  - HSTS;
  - preset Cloudinary;
  - câu đếm backfill trên PROD trước deploy (cần chủ cho đọc).
- **CSP bật thật** (bỏ `unsafe-inline`): chờ dữ liệu `/api/csp-report` vài ngày; next.config là của 4f.
