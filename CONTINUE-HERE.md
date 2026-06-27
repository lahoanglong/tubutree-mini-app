# ▶️ CONTINUE-HERE — bàn giao (cập nhật 2026-06-27)

> Mọi thứ đã **push lên `main`**. Trên máy mới chỉ cần `git clone` (hoặc `git pull`) là có đủ.

## 1. Trạng thái hiện tại

**Prod đang LIVE:**
- API: `https://api.tubutree.com` (health ok)
- Web: `https://app.tubutree.com` (200)
- Mini App: bundle production sẵn ở `apps/miniapp/www/`, **chưa `zmp deploy`**

**Mức sẵn sàng go-live 30/06: ~95%** (từ 88% phiên 23/06).

**Verify 27/06 tối:** typecheck 3/3 xanh, **55 suite / 556 test PASS**, working tree sạch.

## 2. Việc đã làm

### Phiên 26→27/06: Storefront 4 lớp + Deferred features (~30 commit)

**Storefront — 4 lớp hoàn chỉnh:**

| Lớp | Nội dung | Commits chính |
|-----|----------|---------------|
| 1 — Gian hàng CTV | CRUD collections/items, public render, FE builder + trang khách, share-kit | `ca7132f`→`84c3bfa` |
| 2 — Attribution | store-context, checkout gửi slug, analytics per-storefront/per-product, web OG, share-kit QR | `73524c8`→`fe7d7b4` |
| 3 — Brand flagship | Brand entity + slugifyVi, admin CRUD + gán SP, public brand page, cert verified-only, combo pricing, BrandFollow, BrandPromotion, DealerReward, gamification quest TubuXu | `6b8828e`→`8899980` |
| 4 — Deferred features | Attribution 3 ngày, "Đã bán N" hybrid, DealerReward tiến trình, Brand-owner tự quản | `af40587`→`00c795f` |

**Deferred features (spec `2026-06-27-deferred-features-design.md`):**

| # | Tính năng | Commit | Chi tiết |
|---|-----------|--------|----------|
| 1 | Attribution 3 ngày (ReferralTouch server-side) | `af40587` | last-touch persistent, checkout fallback, FE fire-and-forget |
| 2 | "Đã bán N" hybrid | `343a55d` | soldExternal (admin) + soldApp (cron DELIVERED), formatSold Shopee-style |
| 3 | DealerReward tiến trình | `f66c297` | rewardsProgress quý/năm, GET /dealer/rewards, card FE |
| 4 | Brand-owner tự quản nhãn | `00c795f` | auth ownership (ownerUserId), sửa info+KM, admin gán, miniapp /brand-owner |

**5 migration mới (27/06):**
1. `20260627010000_brand_promotion_dealer_reward`
2. `20260627020000_coin_quest_unique`
3. `20260627030000_brand_follow`
4. `20260627040000_referral_touch`
5. `20260627050000_product_sold`

### Phiên 22→23/06: Security + Money-path (4 commit)

| Commit | Nội dung |
|---|---|
| `f335040` | Wave A (6 bảo mật) + Wave C (4 ops) — fail-closed webhook, rate-limit, CORS, Swagger gate, healthcheck, backup, deploy gate CI |
| `ad5a6e9` | Wave B (B1-B5) + 24 adversarial fix — atomic cancel/refund, coupon scope, TOCTOU loyalty, oversell |
| `bd2de91` | C1 quiz crash, catalog cache 60s, GIN index, miniapp staleTime/debounce/error |
| `db457c1` | ~40 spec mới (money-path, atomic, race) + `PRODUCTION_READINESS.md` |

### Code review money-path — ĐÃ HOÀN TẤT (2026-06-24)

6 bug CONFIRMED → FIX (TDD). Chi tiết: `docs/CODE-REVIEW-2026-06-24-moneypath.md`.

## 3. Việc CÒN LẠI để go-live 30/06 ⚠️

### 3.1. BẮT BUỘC trước deploy đầu tiên
```bash
# (a) Chạy GIN index CONCURRENTLY thủ công trước khi migration tự áp,
#     tránh lock bảng products khi container API restart:
ssh VM_HOST "cd ~/tubutree && bash tools/db/create-gin-indexes-concurrently.sh"
ssh VM_HOST "cd ~/tubutree/apps/api && pnpm prisma migrate resolve --applied 20260622010000_catalog_gin_indexes"

# (b) Backup DB thủ công lần đầu (xác minh quy trình restore):
ssh VM_HOST "cd ~/tubutree && bash tools/backup/backup-db.sh"
ssh VM_HOST "ls -la /var/backups/tubutree/"

# (c) Set env prod (env.validation giờ FAIL-FAST nếu thiếu):
#     .env trên VM cần có:
#       PANCAKE_WEBHOOK_SECRET=<rotate value — value cũ đã lộ trong git history>
#       ACCESSTRADE_WEBHOOK_SECRET=<value thật>
#       CORS_ORIGINS=https://tubutree.com,https://app.tubutree.com,https://admin.tubutree.com

# (d) Verify reverse proxy set X-Forwarded-For đúng (Throttler giờ trust proxy=1).

# (e) Cài crontab backup tự động:
ssh VM_HOST 'crontab -l 2>/dev/null | { cat; echo "0 2 * * * /home/$USER/tubutree/tools/backup/backup-db.sh >> /var/log/tubutree-backup.log 2>&1"; } | crontab -'
```

### 3.2. Deploy backend (đẩy code mới lên prod)
```bash
git push origin main
# → deploy.yml chờ CI pass → SSH deploy + pg_dump backup + rebuild
# → 5 migration 27/06 tự apply khi API restart
# Sau deploy: GET https://api.tubutree.com/api/health xanh + monitor log
```

### 3.3. `zmp deploy` (Mini App) — **BLOCKER launch**
```bash
cd apps/miniapp
zmp login          # quét QR Zalo (1 lần/máy, token cũ hết hạn ~June 15)
zmp deploy -M production -p -m "Storefront 4 layers + deferred features"
```
Sau deploy: vào [developers.zalo.me](https://developers.zalo.me) → App Tubu Tree → Mini App → Versions → Submit/Preview.

Bundle production đã build sẵn (`apps/miniapp/www/`, trỏ API prod `https://api.tubutree.com/api`).

### 3.4. Verify trên Zalo (sau zmp deploy)
1. Mở Mini App trên Zalo (hoặc quét QR từ Studio).
2. Trang chủ: dải thương hiệu 8 brand, ảnh SP, badge "Đã bán N".
3. Trang nhãn `/brand/:slug` — logo, cover, KM, nút Theo dõi.
4. Gian hàng CTV `/s/:slug` — SP, combo, share-to-earn.
5. Checkout COD → đơn `CONFIRMED`.
6. Vườn Xanh: điểm danh, quiz, tưới, quest, thu hoạch.
7. Profile → Quản lý nhãn (nếu là brand-owner).

## 4. Risk còn lại & monitor sau launch

| Risk | Mức | Mitigation |
|---|---|---|
| Quên GIN runbook → downtime 30s–vài phút lúc deploy đầu tiên | **Cao** | Bắt buộc mục 3.1(a) |
| FE Zalo Mini App chưa `zmp deploy` | **Cao — blocker** | Mục 3.3 |
| Coupon perUserLimit race khi `perUserLimit > 1` | Thấp | Đã thu hẹp window bằng re-check trong tx |
| Catalog cache per-instance desync 60s | Thấp | Hiện 1 replica, không issue |
| Test miniapp chưa có (0 test runner) | Trung bình | Backlog post-launch |

**Monitor 48h đầu:**
- Log Prisma error (P2025 → PrismaExceptionFilter).
- Partial unique violation `points_transactions` / `coupon_redemptions` — P2002 ≥1/giờ = idempotent chặn race (good signal).
- Throttler (60/min global, 5/min auth) — nới nếu user thật bị 429.

## 5. Tương lai (backlog)

- Auto-sync API sàn ngoài (Shopee/Lazada/TikTok) — cần credentials từng sàn.
- Test miniapp (Vitest + 5 luồng critical).
- Tích hợp PanNature trồng cây thật.
- Admin upload Excel giá, AI tư vấn 24/7, group buy, UGC review video.

## 6. Bản đồ tài liệu

| File | Nội dung |
|---|---|
| `CONTINUE-HERE.md` | (file này) điểm vào nhanh |
| `docs/superpowers/specs/2026-06-27-deferred-features-design.md` | Spec 4 deferred features (attribution, sold, dealer, brand-owner) |
| `docs/CODE-REVIEW-2026-06-24-moneypath.md` | Review money-path TubuXu: 6 bug→fixed + 4 backlog |
| `PRODUCTION_READINESS.md` | Audit + kế hoạch 8 ngày (đã hoàn thành đa số) |
| `DEPLOY_ZALO.md` | 2 lệnh đưa Mini App lên Zalo |
| `docs/SESSION-HANDOFF.md` | Bàn giao tổng thể (keys go-live, vận hành VM) |
| `tools/verify-fixes.sh` | Script all-in-one verify |
| `tools/backup/README.md` | Backup DB tự động |

## 7. Lưu ý môi trường

- Node/pnpm có thể không nằm trên PATH của shell non-interactive → thêm `C:\Program Files\nodejs` + `%APPDATA%\npm` (Windows).
- `prisma generate` + build `@tubutree/shared-types` phải chạy trước khi typecheck/build FE.
- Keys go-live còn thiếu (ZaloPay/OA-ZNS/Accesstrade) — xem `docs/SESSION-HANDOFF.md` mục 5. Demo dùng COD/Ví đầy đủ.
- `@nestjs/throttler ^6.0.0` đã thêm vào `apps/api/package.json` → `pnpm install` trên máy mới.
