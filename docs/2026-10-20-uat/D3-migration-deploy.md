# D3-migration-deploy — Migration và deploy

## Tóm tắt

Không có phát hiện P0 từ góc migration và deploy.

Đã diễn tập đầy đủ trên DB tạm (cổng 25433, đã dừng):
- `migrate deploy` áp 207/207 migration trong khoảng 2,2 giây trên DB trống. `migrate status` báo "Database schema is up to date!". `migrate diff --exit-code` không thấy khác biệt.
- `check-partial-indexes` kỳ vọng 30 index một phần, thấy 30.
- `seed-reference` không cờ, chạy hai lần: +122 khoá cấu hình, +28 mẫu tin, 7 chủ đề, 43 quiz, 10 loài cây, 1 mục tiêu. Lần hai toàn "đủ sẵn".
- `seed-reference --with-business-defaults`, chạy hai lần: +6 khoá kinh doanh, +4 hạng thành viên, +4 bậc đại lý, +4 nhiệm vụ. Lần hai toàn "đủ sẵn". Hạng đã theo đơn vị 1đ: Lộc Biếc minPoints 30000 / ×1,2; Cổ Thụ 1000000 / ×2.
- `seed-reference` từ chối chạy trên DB chưa có migration, và từ chối cờ viết sai.
- `cleanup-demo` theo phương án (c) của runbook: tắt 44 sản phẩm và 48 biến thể, giữ 0 trong 3 mã bị tắt. Chạy lại thay đổi 0 dòng.
- `go-live-check` (sau deploy): mọi dòng migration đạt. `db.bank_account` hiện BIN 970407, tài khoản đuôi 0906. `db.demo_coupons` là WARN "đã chấp nhận giữ". Các FAIL còn lại chỉ do thiếu env cục bộ (JWT, Zalo, Pancake...), chưa có tài khoản ADMIN, chưa có cron.
- Vòng `pg_dump | gzip` rồi `psql --single-transaction ON_ERROR_STOP` vào DB mới: số dòng giữ nguyên (44 sản phẩm, 207 khoá cấu hình, 207 migration, 471 index, 4 trigger). DB khôi phục có status, diff sạch và 30/30 index một phần.

Kiểm bằng đọc mã:
- Migration trước points_1d không chứa giá trị điểm theo đơn vị mới. Migration sau points_1d (external_*, chat_*, waste) chèn giá trị đã theo đơn vị mới.
- Thứ tự seed và migrate được `assertPoints1dApplied` ép.
- Cron trùng khi `API_CPUS=2`: API là một tiến trình (không cluster, không worker_threads). Mọi `@Cron` đi qua khoá thuê trong DB của `CronLeaderService`. Không có `setInterval` hay `@Interval` khác.
- Runbook 7.3 đã đổi container về image cũ trước `restore-db.sh`, tránh áp lại migration.
- 4 file spec deploy đạt 114/114 test.

Phát hiện chính: D3-01 (P1), runbook và `deploy.sh` lệch quyết định A8. Có thêm 4 mục P3.

## Phạm vi đã đọc

Đã đọc:
- `apps/api/prisma/seed-reference.ts`, `reference-data/config-selection.ts`, `cleanup-demo-data.ts`, `scripts/go-live-check.ts`, `reconcile-points.ts`, `reconcile-wallet.ts`, `grant-admin.js`.
- Migration points_1d, launch_owner_config, waste_exchange (phần INSERT config), chat_review1, external_claims, chat_order_points. Quét các lệnh DELETE/UPDATE/DROP/CREATE UNIQUE trong mọi migration 20261018* đến 20261020*.
- `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`, `docker-compose.vietnix.yml`, `docker-compose.prod.yml` (các dòng chính).
- `tools/deploy/deploy.sh`, `tools/backup/backup-db.sh`, `restore-db.sh`, `ops/backup-predeploy.sh`, `ops/crontab.backup.example`, nhánh crontab và grant-admin của `.github/workflows/ops.yml`.
- `docs/launch/deploy-rollback-runbook.md` (mục 0.1 đến 1.8, 3.4, 5 bước 1 đến 10, 7.0 đến 7.4), dàn ý `docs/GO-LIVE-KEYS.md`, `.env.production.example`.
- `cron-leader.service.ts`, `health.controller.ts`, `system-config.service.ts` (quy tắc set và ghi), `env-checks.ts` (phần Zalo), quyết định A1 đến A12 và B1 đến B6 trong `03-cau-hoi-sang.md`.

Diễn tập trên Postgres 25433 (DB tubutree_rehearsal, tubutree_noflag, tubutree_order, tubutree_restored), cụm đã dừng. Chạy jest: deploy-scripts, deploy-compose, reference-config-selection, check-env (4 suite, 114/114).

Chưa làm hoặc chưa kiểm:
- `docker build` (ngoài phạm vi giao) và chạy `check-env.js` từ dist.
- Chạy thử reconcile-points và reconcile-wallet trên DB UAT: bị hệ thống quyền chặn, chỉ đọc mã, chưa chạy.
- Đo thời gian migration trên dữ liệu cỡ PROD (chỉ đo trên DB trống).
- `pnpm run ... --with-business-defaults` trong image container (đã chạy bằng tsx trực tiếp).
- Chưa soát lại sâu logic points_1d (đã soát ở các vòng trước), chỉ kiểm danh sách cột có phủ các cột kiểu điểm trong schema.
- Chưa so toàn bộ GO-LIVE-KEYS với set-env trong ops.yml.

## Bảng phát hiện

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D3-01 | P1 | CONFIRMED | agent sửa ngay | chung | `docs/launch/deploy-rollback-runbook.md:239`, `:623`, `:627`; `tools/deploy/deploy.sh:217`; `apps/api/prisma/seed-reference.ts:11`; `apps/api/src/config/go-live/db-checks.ts:450`; `apps/api/src/modules/loyalty/loyalty.service.ts:616` | Runbook bước 7b, mục 1.6 và `deploy.sh` vẫn coi `--with-business-defaults` là "chờ chủ duyệt" dù A8 đã chốt chạy có cờ. Deploy lên DB mới theo đúng runbook: seed không cờ, `membership_tiers` = 0, mọi khách có `tierId` null, `getTierMultiplier` trả 1. Khách Lộc Biếc, Đại Thụ, Cổ Thụ không được ×1,2, ×1,5, ×2. Không có freeship theo hạng, vòng quay "chưa cấu hình", Vườn Xanh không có nhiệm vụ, chưa có bậc đại lý. `go-live-check` không báo gì. | Sửa runbook 7b dùng lệnh có cờ, bỏ câu "chưa quyết" và "đúng ý", thêm A8 vào mục 1.6, sửa comment đầu `seed-reference.ts`. `deploy.sh` thêm biến `SEED_REFERENCE_ARGS` mặc định `--with-business-defaults`. `go-live-check` thêm `db.membership_tiers`, FAIL khi trống hoặc thiếu hệ số 1/1,2/1,5/2 (WARN cho `dealer_tiers` = 0). Test: spec db-checks với `membershipTierCount = 0` phải ra FAIL `db.membership_tiers`; `deploy-scripts.spec` kiểm `deploy.sh` truyền cờ. |
| D3-02 | P3 | chưa soát | agent sửa ngay | uat | `apps/api/scripts/grant-admin.js:16`, `:19`, `:27`; `apps/api/src/config/go-live/db-checks.ts:418` | `grant-admin.js` không chuẩn hoá `ADMIN_PHONE`. Nhập `+84912345678` hoặc `84912345678`: script không thấy user Zalo thật (lưu dạng `0912345678`), tạo user mới role ADMIN. `go-live` vẫn PASS `db.admin_user`. Chủ đăng nhập Zalo vẫn là CUSTOMER. | Chuẩn hoá `ADMIN_PHONE` như `normalizeZaloPhone` (bỏ ký tự không phải số, 84 thành 0, kiểm 10 số), sai định dạng thì thoát lỗi. Ghi định dạng vào gợi ý `db-checks.ts:418`. Test: `deploy-scripts.spec` chạy grant-admin với `+84912345678` trên DB có user `0912345678` phải nâng đúng user đó, không tạo user mới. |
| D3-03 | P3 | chưa soát | agent sửa ngay | chung | `.env.production.example:37`, `:41`; `apps/api/src/config/env.validation.ts:38`; `apps/api/src/config/go-live/env-checks.ts:279` | `.env.production.example` thiếu `ZALO_OA_REFRESH_TOKEN`, `ZALO_OA_WEBHOOK_SECRET`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN` mà mã đọc. Dựng `.env` bằng `cp` rồi điền đủ ô có sẵn: token OA không tự xoay, khoảng 25 giờ sau ZNS ngừng gửi (go-live chỉ WARN). Webhook CSKH bị từ chối ở production. | Thêm 4 khoá (để trống, kèm chú thích) vào `.env.production.example` dưới khối Zalo và khối JWT. Test: thêm kiểm vào `deploy-compose.spec` hoặc `check-env.spec`: mọi khoá trong `env.validation.ts` không có default rỗng phải có trong `.env.production.example`. |
| D3-04 | P3 | chưa soát | agent sửa ngay | uat | `apps/api/src/config/demo-data/cleanup.ts:421` | Bản xem trước `cleanup-demo` vẫn in "CẢNH BÁO: khách dùng được mã chủ dự án chưa duyệt" cho WELCOME30, FREESHIP, XANH10 dù A4 đã chốt giữ. Go-live ghi "đã chấp nhận giữ". Người gõ lệnh có thể dừng, hoặc thêm `--coupons=expire` và tắt nhầm ba mã chủ đã chốt giữ. | Dùng chung danh sách mã đã chấp nhận (cùng nguồn với go-live) trong `formatPlan`: ba mã A4 in "GIỮ NGUYÊN (chủ dự án đã chốt giữ, A4)". Test: cleanup spec, `formatPlan` với WELCOME30 còn hạn không được chứa "chưa duyệt". |
| D3-05 | P3 | chưa soát | agent sửa ngay | chung | `docs/launch/deploy-rollback-runbook.md:613`, `:641` | Số kỳ vọng ở bước 7b đã cũ. Runbook ghi "quiz = 43, mau_tin = 100" và "khoảng 80 khoá cấu hình". Thực tế mau_tin = 122, seed nạp +122 khoá, tổng cfg = 201. Ngưỡng "≥ 100" vẫn đúng nên không chặn deploy, nhưng người kiểm có thể gọi Tech lead không cần thiết. | Sửa thành "DB mới hoàn toàn: quiz = 43, mau_tin = 122 (bản 2026-10-19)" và "khoảng 160 khoá cấu hình", hoặc bỏ số chính xác, chỉ giữ ngưỡng ≥. |

## Chi tiết P0/P1

### D3-01 (P1, CONFIRMED)

Vị trí:
- `docs/launch/deploy-rollback-runbook.md:239`, `:623`, `:627`
- `tools/deploy/deploy.sh:217`
- `apps/api/prisma/seed-reference.ts:11`
- `apps/api/src/config/go-live/db-checks.ts:450`
- `apps/api/src/modules/loyalty/loyalty.service.ts:616`

Kịch bản:
1. Deploy lên DB mới, hoặc PROD chưa từng chạy `seed.ts`.
2. Người gõ lệnh làm đúng runbook. Bước 7b chạy lệnh không cờ.
3. Dòng in ra "chưa nạp (giá trị kinh doanh chờ chủ dự án duyệt)" được runbook gọi là "đúng ý".
4. Mục 1.6 nói các giá trị đã chốt "không cần làm tay, TRỪ duyệt gian hàng".
5. `deploy.sh` cũng chỉ gọi lệnh không cờ.
6. Kết quả: `membership_tiers` = 0, mọi khách có `tierId` null, `getTierMultiplier` trả 1. Khách Lộc Biếc, Đại Thụ, Cổ Thụ không được ×1,2, ×1,5, ×2 như luật đã chốt.
7. Không có freeship theo hạng. Vòng quay "chưa cấu hình". Vườn Xanh không có nhiệm vụ. Chưa có bậc đại lý.
8. `go-live-check` ra cùng bộ PASS/WARN ở nhóm DB nên không ai thấy.

Bằng chứng:
- `03-cau-hoi-sang.md:25`: "A8 | Nạp bộ giá trị kinh doanh mặc định (--with-business-defaults)" (đã chốt 2026-10-18). Dòng `:88`: "Có. Chạy lệnh có cờ --with-business-defaults".
- Runbook `:627`: "CHỈ chạy lệnh có cờ sau khi chủ dự án đã duyệt bảng giá trị". Runbook `:623`: "Đó là các con số tiền, điểm, xác suất chủ dự án chưa quyết". Runbook `:239` không nêu A8.
- `deploy.sh:217`: `dc run --rm --no-deps api pnpm run prisma:seed:reference` (không cờ). Runbook nói ở đường `deploy.sh` "chỉ cần chạy nó", nên cờ không bao giờ chạy trên đường này.
- `ops/README-vietnix-deploy.md:134-136` và đầu `apps/api/prisma/seed-reference.ts:11-12` nói cùng nội dung cũ.
- Diễn tập DB `tubutree_noflag` (migrate, seed-reference không cờ, cleanup-demo --apply): truy vấn ra `[{"hang":0,"bac":0,"nv":0}]`.
- So `go-live-check` giữa DB có cờ và DB không cờ: lệnh `diff` trên các dòng `db.*` in "db checks identical with/without business defaults".
- `grep -c tier src/config/go-live/db-checks.ts` = 0. Grep trong `src/config/go-live` chỉ thấy `merchant.commission_pct`.
- Không migration nào INSERT vào `membership_tiers` (grep INSERT trong `prisma/migrations` không thấy).
- `loyalty.service.ts:614-616`: `if (!tierId) return 1; ... return tier ? Number(tier.pointMultiplier) : 1;`.

Lý do soát chéo (CONFIRMED, giữ P1):
- Đã kiểm từng điểm, không bác được điểm nào.
- Nạp hạng muộn không tự lành. `recalcTier` thoát ở `:319` khi chưa có hạng, nên khách giữ `tierId` null. `recalcAllTiers` (`:405`) chỉ quét user có `tierId` khác null. Khách có đơn giao trước khi nạp hạng vẫn không có hạng cho đến đơn giao kế tiếp.
- Giảm nhẹ: người vận hành biết A8 có thể suy ra "đã duyệt" và chạy cờ; runbook có cảnh báo về bậc đại lý. Chưa đủ, vì câu chữ nói rõ là không chạy.
- Không nâng P0: đây là lỗi tài liệu và quy trình, một lệnh sửa được trước khi mở khách, chưa mất tiền.

## Bỏ sót do soát chéo phát hiện

- `apps/api/src/modules/loyalty/loyalty.service.ts:319` cùng `:405`: nếu deploy không cờ và khách có đơn giao trước khi nạp hạng, `recalcTier` thấy `tiers=[]` và thoát, không đặt `tierId`. Chạy `--with-business-defaults` sau đó, job đêm `recalcAllTiers` chỉ quét `tierId: { not: null }`, nên các khách này vẫn không có hạng (hệ số ×1, không freeship theo hạng) cho đến khi có đơn giao kế tiếp. Khách đã chi đủ cho Lộc Biếc hoặc Đại Thụ mà không có đơn nào nữa thì không bao giờ được lên hạng. Chỉ sửa runbook không cứu được lần deploy đã lỡ. Đề xuất: chạy tính lại hạng một lần cho mọi user sau khi nạp hạng, hoặc bỏ lọc `tierId` trong `recalcAllTiers`. Cùng gốc với D3-01.

## Đã bác bỏ

Không có phát hiện nào bị bác bỏ.
