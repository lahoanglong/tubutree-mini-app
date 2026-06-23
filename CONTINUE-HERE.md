# ▶️ CONTINUE-HERE — bàn giao sang máy khác (cập nhật 2026-06-23)

> Mọi thứ đã **push lên `main`**. Trên máy mới chỉ cần `git clone` (hoặc `git pull`) là có đủ.

## 1. Trạng thái hiện tại

**Prod đang LIVE:**
- API: `https://api.tubutree.com` (health ok)
- Web: `https://app.tubutree.com` (200)
- Mini App: bundle production sẵn ở `apps/miniapp/www/`, **chưa `zmp deploy`**

**Mức sẵn sàng go-live 30/06: ~88%** (từ 75% đầu phiên).

## 2. Việc đã làm phiên 22→23/06 (4 commit mới sau `225f73d`)

| Commit | Nội dung |
|---|---|
| `f335040` `feat(security+ops)` | Wave A (6 bảo mật) + Wave C (4 ops) — fail-closed webhook, rate-limit, CORS allowlist, Swagger gate, healthcheck, backup script, deploy.yml gate CI |
| `ad5a6e9` `fix(money-path)` | Wave B (B1-B5) + 24 adversarial fix — atomic cancel/refund, coupon scope+atomic, TOCTOU loyalty, oversell, 4 migration mới |
| `bd2de91` `feat(game+perf+ux)` | C1 quiz crash, catalog cache 60s, GIN index migration, miniapp staleTime/debounce/error states |
| `db457c1` `test+docs` | ~40 spec mới (money-path, atomic, race) + `PRODUCTION_READINESS.md` báo cáo |

**Tổng diff:** 49 file, +2024 / -242. **0 bug critical/high còn lại** (đã sửa hết qua adversarial review).

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

### 3.2. Verify build trên máy mới
```bash
cd D:/path/to/tubutree-mini-app
git pull
bash tools/verify-fixes.sh   # script all-in-one: install + prisma generate + typecheck + test 6 module + lint
```

Script trả exit code rõ ràng (1=thiếu deps, 2=install fail, 3=typecheck fail, 4=test fail, 5=migration fail).

### 3.3. Deploy
- Push `main` → `deploy.yml` chờ workflow_run "CI" pass rồi tự deploy qua SSH + pg_dump backup + rebuild.
- Sau deploy: `https://api.tubutree.com/api/health` xanh + monitor log Prisma error.

### 3.4. `zmp deploy` (Mini App)
```bash
cd apps/miniapp
zmp login        # 1 lần/máy
zmp deploy       # = pnpm --filter @tubutree/miniapp deploy
```
Bundle production đã build sẵn (`apps/miniapp/www/`, trỏ API prod).

## 4. Risk còn lại & monitor sau launch

| Risk | Mức | Mitigation |
|---|---|---|
| Quên GIN runbook → downtime 30s–vài phút lúc deploy đầu tiên | **Cao** | Bắt buộc mục 3.1(a) |
| Coupon perUserLimit race khi `perUserLimit > 1` | Thấp | Đã thu hẹp window bằng re-check trong tx. Chấp nhận. |
| Catalog cache per-instance — multi-replica sẽ desync 60s | Thấp | Hiện 1 replica trên VM, không issue |
| FE Zalo Mini App chưa `zmp deploy` | **Cao — blocker launch** | Mục 3.4 |
| Test miniapp chưa có (0 test runner) | Trung bình | Backlog post-launch |

**Monitor 48h đầu:**
- Log Prisma error (P2025 giờ log full context qua `PrismaExceptionFilter`).
- Partial unique violation `points_transactions` / `coupon_redemptions` — nếu xuất hiện P2002 ≥1/giờ là dấu hiệu race thật đang được chặn idempotent (good signal).
- Số request/min throttler (mặc định 60/min global, auth 5/min) — nếu user thật bị 429 → cân nhắc nới.

## 5. Code review xhigh chưa hoàn tất

`/code-review` xhigh được chạy ở cuối phiên nhưng bị ngắt do session limit. Đã có:
- 2/10 finder hoàn tất (13 raw candidate)
- 0/13 verifier hoàn tất → **không phân biệt được confirmed vs refuted**

**Nếu muốn rigorous hơn trước launch:** sau quota reset chạy lại `/code-review` trên 4 commit vừa tạo:
```bash
git diff HEAD~4...HEAD
```
Hoặc trust adversarial review (đã 24 confirmed → fixed) + monitor 48h sau launch.

## 6. Bản đồ tài liệu

| File | Nội dung |
|---|---|
| `CONTINUE-HERE.md` | (file này) điểm vào nhanh |
| `PRODUCTION_READINESS.md` | Báo cáo audit + kế hoạch 8 ngày (đã hoàn thành đa số) |
| `DEPLOY_ZALO.md` | 2 lệnh đưa Mini App lên Zalo |
| `CHANGELOG_OVERNIGHT.md` | Lịch sử phiên trước (2026-06-15→16) |
| `OVERNIGHT_PLAN.md` | Audit + backlog phiên trước |
| `docs/SESSION-HANDOFF.md` | Bàn giao tổng thể (keys go-live còn thiếu, vận hành VM) |
| `tools/local-test/README.md` | Test local không cần Docker |
| `tools/backup/README.md` | Backup DB tự động (script + crontab guide) |
| `tools/verify-fixes.sh` | Script all-in-one verify trên máy có pnpm |

## 7. Lưu ý môi trường

- Node/pnpm có thể không nằm trên PATH của shell non-interactive → thêm `C:\Program Files\nodejs` + `%APPDATA%\npm` (Windows).
- `prisma generate` + build `@tubutree/shared-types` phải chạy trước khi typecheck/build FE.
- Keys go-live còn thiếu (ZaloPay/OA-ZNS/Accesstrade) — xem `docs/SESSION-HANDOFF.md` mục 5. Demo dùng COD/Ví đầy đủ.
- **Mới:** `@nestjs/throttler ^6.0.0` đã thêm vào `apps/api/package.json` → nhớ `pnpm install` trên máy mới.
