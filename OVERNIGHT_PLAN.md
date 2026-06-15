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
- [x] L0. Audit money-path (checkout idempotency, atomic ví/điểm, ship 200k/19k, voucher, points/tier, affiliate per-product, cashback 30/70 hold 30d) → **đọc kỹ checkout.service + catalog.service: code đúng, không thấy bug.** (Test phủ tốt.)
- [ ] L1. Catalog demo nghèo: 6 sản phẩm / 3 brand thật, **ảnh rỗng** (`thumbnail:null`) → heroes featured trên prod hiển thị KHÔNG có ảnh. (gap thật, prod-visible)

### DATA / DEMO CREDIBILITY (đề bài yêu cầu ≥8 brand, ≥40 sp có ảnh)
- [ ] D1. Enrich `seed.ts` → **8 brand** (Visante, Pơ Lang, Fuwa3e, Cobote, Le Plateau Coffee, BH.Nong, Sokfram, Hector), **≥40 sản phẩm có ảnh thật**, thêm flash-deal (salePrice), coupon mẫu, category cà phê/thực phẩm. (demo/fresh DB)
- [ ] D2. **Migration idempotent backfill ảnh** cho các sản phẩm seed đang null ảnh trên prod → heroes có ảnh sau deploy (prod-verifiable, an toàn, không đụng 95 sp Pancake).

### BACKEND (additive, có test, prod-verifiable)
- [ ] B1. `/api/brands` trả thêm metadata hiển thị (accent, tagline, story ngắn, logo emoji) từ registry brand tĩnh + fallback an toàn. Có unit test. (làm brand strip/landing "đã mắt" hơn)

### UX / UI (build-verified, bundle-ready)
- [ ] U1. Soát product-detail / affiliate / cashback / cart / wishlist tìm điểm nông & polish an toàn (microcopy ấm, empty/error/skeleton, ảnh fallback).
- [ ] U2. ProductCard: ảnh fallback đẹp khi `thumbnail` null (chống vỡ layout khi demo gặp sp thiếu ảnh).

### FEATURES NET-NEW (chọn ≥3, fit kiến trúc, không thêm infra)
- [ ] F1. (xác định trong Phase 3 sau khi soát kỹ — ưu tiên cái tăng "wow" demo và an toàn.)

---

## PHASES & TRẠNG THÁI
- **P0 Audit & Plan** — ✅ (file này) · tag backup + branch tạo xong · baseline xanh (244 test, 4 build).
- **P1 Logic & Data** — D1, D2, U2.
- **P2 UX polish** — U1.
- **P3 Features** — B1 + F1 (≥3 net-new).
- **P4 E2E smoke** — build + test + typecheck + lint xanh toàn bộ; load thử FE nếu khả thi.
- **P5 Deploy + Verify** — merge `main`, push (CD deploy backend), verify prod API; build bundle Mini App + `DEPLOY_ZALO.md`.
- **P6 Docs** — `DEMO_SCRIPT.md` + `CHANGELOG_OVERNIGHT.md` (gồm audit + verify sau deploy).

## NGUYÊN TẮC THỰC THI
- Incremental, rollback-able. KHÔNG đập đi xây lại (vì code đang rất tốt).
- Chỉ push code **xanh** (test + build + typecheck) lên `main` (prod LIVE — an toàn là trên hết).
- Commit liên tục, prefix phase. Cập nhật file này sau mỗi bước.
- Trung thực tuyệt đối trong báo cáo: cái gì verify được nói rõ, cái gì không (Zalo deploy) nói rõ.
