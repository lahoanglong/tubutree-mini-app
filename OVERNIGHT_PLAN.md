# OVERNIGHT PLAN — Tubu Tree Mini App (đêm 2026-06-15 → 16)

> Nguồn sự thật cho cả đêm. Cập nhật liên tục theo từng phase.
> Branch: `overnight/2026-06-15` · Backup tag: `pre-overnight-2026-06-15` (rollback an toàn).

---

## ⭐ KẾT QUẢ AUDIT (Phase 0) — đọc kỹ phần này trước

**Kết luận quan trọng nhất, ngược với giả định của đề bài:**
Dự án **KHÔNG hề bị mất work** và **KHÔNG cần rebuild**. Toàn bộ work của các phiên trước **đã commit lên `main`, đã build sạch, đã có test, và đã deploy LIVE lên production.**

### Bằng chứng đối chiếu "claim cũ vs thực tế"
| Hạng mục | Claim (handoff/spec) | Thực tế kiểm chứng đêm nay | Khớp? |
|---|---|---|---|
| Backend §6.1–6.14 | "xong, user-facing đầy đủ" | 35 test-suite, **244 unit test PASS** (claim 236). 4 app build sạch sau `prisma generate`. | ✅ Khớp (còn hơn) |
| Vườn Xanh 2.0 | "4 phase + social" | 8 service `game/*` + `.spec.ts` đủ; FE `game.tsx` wired; 5 migration game có mặt. | ✅ Khớp |
| Prod LIVE | "api+app.tubutree.com live, CD wired" | `GET /api/health` = `{"status":"ok","db":"up"}`; `app.tubutree.com` = 200; `/api/products` trả **101 sản phẩm** (`meta.total:101`). | ✅ Khớp |
| Git | "đã push hết, tree sạch" | `main` sạch, up-to-date origin; lịch sử commit dày, mạch lạc; **không có branch `overnight/*` cũ kẹt, không stash.** | ✅ Khớp |

→ **Nghi vấn "work cũ không land/không deploy" là KHÔNG có cơ sở.** Có lẽ cảm giác "không đổi nhiều" đến từ việc code đã hoàn thiện từ trước; mỗi phiên là incremental trên nền đã rất đầy đủ. Việc cần làm đêm nay **không phải** sửa lỗi mất work, mà là **nâng chất + bổ sung giá trị demo + deploy/verify lại cho chắc.**

### Tình trạng môi trường máy này (ảnh hưởng cách làm)
- ✅ Node 24, pnpm 9, git — OK. `pnpm install` xong, 244 test pass, 4 build pass.
- ❌ **Không có Docker** → không dựng Postgres/Redis local → không E2E với DB thật tại máy. Dựa vào: unit test (mock), typecheck, build, và **prod API thật** (đang sống) để verify.
- ❌ **Không có `zmp` CLI / không có session login Zalo** ở máy này → **không thể `zmp deploy` Mini App lên Zalo đêm nay.** Đây là blocker DUY NHẤT đúng như đề bài lường trước. Xử lý: build bundle 100% sẵn sàng + viết `DEPLOY_ZALO.md`.
- ❌ Không có `gh` CLI → deploy backend qua **`git push main`** (CD GitHub Actions tự SSH vào VM build lại — đã wired). Verify bằng gọi API prod trực tiếp.
- ✅ Migration tự áp khi container API khởi động (`prisma migrate deploy` trong Dockerfile CMD) → **một data-migration idempotent là đường duy nhất tự động đẩy thay đổi dữ liệu lên prod.**

### Bề mặt "deploy + verify tận mắt" khả thi đêm nay
- **Backend**: đổi code/migration → `git push main` → CD build lại VM → verify bằng gọi `https://api.tubutree.com/api/*`. ✅ Đầy đủ, kiểm chứng được.
- **Mini App (Zalo)**: build bundle + `DEPLOY_ZALO.md`; **không** lên Zalo được đêm nay (thiếu login). Verify code-level: typecheck + build + đọc kỹ.
- **Web app** (`app.tubutree.com`): ngoài scope trừ khi bị ảnh hưởng.

---

## BACKLOG (ưu tiên, đã lọc theo: giá trị thật · an toàn · verify được)

### LOGIC / DATA
- [x] L0. Audit money-path (checkout idempotency, atomic ví/điểm, ship 200k/19k, voucher, points/tier, affiliate per-product, cashback 30/70 hold 30d) → **code đúng, không thấy bug.**
- [x] L1. Catalog demo nghèo (6 SP/3 brand, ảnh rỗng) → đã xử lý ở D1+D2 (backfill ảnh trên prod).

### DATA / DEMO CREDIBILITY (đề bài yêu cầu ≥8 brand, ≥40 sp có ảnh)
- [x] D1. Enrich `seed.ts` → **8 brand, 44 SP có ảnh** + flash-deal + 2 coupon + 3 category. ĐÃ chạy seed trên PG thật (44 SP).
- [x] D2. **Migration idempotent** `20260616000000_demo_catalog_multibrand` (chèn brand mới + backfill ảnh, NOT EXISTS chống xung đột). ĐÃ test PG thật + **đã LIVE prod** (verify: 9 brand, backfill 6 SP cũ OK).

### BACKEND
- [~] B1. `/api/brands` metadata — **BỎ có chủ đích**: FE consume nó chỉ deploy được khi `zmp deploy` (đêm nay không có) → giá trị deferred, thêm API surface vô ích. Ưu tiên deploy sạch.

### UX / UI
- [x] U2. ProductCard fallback ảnh — **đã có sẵn** (`LeafPlaceholder`), không cần làm.
- [x] U-auth. Auth timeout chống treo loading (zmp-bridge) — fix robust thật, phát hiện khi render thử.
- [~] U1. Soát các trang — **đã soát home/loyalty/browse/product-card: đã polished, demo-ready**, không cần đụng (tránh phá thứ đang chạy + không verify hình ảnh được).

### FEATURES NET-NEW
- [x] Catalog đa thương hiệu (38 SP + 5 brand mới + 2 coupon) = giá trị net-new thật, deploy+verify được.
- [~] Không bịa thêm "feature" hình thức vào app đã đủ chức năng (xem CHANGELOG mục 6).

---

## PHASES & TRẠNG THÁI
- **P0 Audit & Plan** — ✅ tag backup + branch + baseline xanh (244 test, 4 build).
- **P1 Logic & Data** — ✅ catalog 8 brand/44 SP + migration prod-safe; loyalty tier nền.
- **P2 UX polish** — ✅ auth timeout (robust); các trang đã polished sẵn (không cần đụng).
- **P3 Features** — ✅ net-new = catalog đa thương hiệu (deploy+verify). Không bịa thêm.
- **P4 E2E smoke** — ✅ Postgres thật + API thật + **E2E 19/19** + build/test/typecheck xanh.
- **P5 Deploy + Verify** — ✅ merge `main` + push → CD deploy; **verify prod API (9 brand, ảnh, backfill) + web SSR**. Mini App: bundle sẵn + `DEPLOY_ZALO.md` (cần `zmp login`).
- **P6 Docs** — ✅ `DEMO_SCRIPT.md` + `CHANGELOG_OVERNIGHT.md` + `DEPLOY_ZALO.md`.

> Giới hạn trung thực: không pixel-screenshot Mini App được ở môi trường này (không Docker; headless không render zmp-ui; không Chrome kết nối). Verify ở mức API thật + E2E + web SSR + build xanh.

## NGUYÊN TẮC THỰC THI
- Incremental, rollback-able. KHÔNG đập đi xây lại (vì code đang rất tốt).
- Chỉ push code **xanh** (test + build + typecheck) lên `main` (prod LIVE — an toàn là trên hết).
- Commit liên tục, prefix phase. Cập nhật file này sau mỗi bước.
- Trung thực tuyệt đối trong báo cáo: cái gì verify được nói rõ, cái gì không (Zalo deploy) nói rõ.
