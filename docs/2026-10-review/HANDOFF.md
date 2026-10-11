# Bàn giao hardening 2026-10 (ghi ngày 2026-10-11)

Nhánh tích hợp: `hardening/2026-10` (từ `feat/buy-flow-4b-discovery-search` 080bc75). Đọc theo thứ tự: file này → `00-ROADMAP.md` (mục 9 = quyết định chủ dự án Q-01..Q-31) → `findings-catalog.md` → `impl/*.md` (báo cáo từng gói).

Lý do bàn giao: máy cũ hay crash. Mọi tiến độ đã nằm trong git; workflow chạy nền chết mỗi lần restart session nên không còn gì chạy dở ngoài worktree/branch ghi bên dưới.

## 1. Trạng thái

| Mốc | Trạng thái |
|---|---|
| Đợt A (PA-1..PA-8, chặn deploy: tiền, auth, throttle) | XONG, đã merge, đã deploy PROD |
| Đợt B (PB-1..PB-6, data/perf/cron/Home) | XONG, đã merge, đã deploy PROD (`cb92dc8`) |
| Vòng C1 (PC-1,3,4,5,8) | XONG, đã merge (`ee97986`), CHƯA deploy |
| Vòng C2 (PC-2,6,7,9) | XONG, review APPROVE, đã merge (HEAD `4b53388`), CHƯA deploy |
| Vòng C3 (PC-10a/b/c, PC-11, C-076, UI hoàn tiền thủ công, cấu hình liên hệ) | XONG, đã merge, CHƯA deploy |
| Đợt D (PD-1, PD-2, PD-3) | XONG, đã merge, CHƯA deploy |
| Giai đoạn 4 (T1–T5) | XONG; T5 review đã sửa và merge (HEAD `c46fe6a6`) |
| Giai đoạn 5 (`99-release-readiness.md`) | XONG. Kết luận: kỹ thuật đạt, PROD NO-GO tới khi chủ dự án qua 5 cổng trong báo cáo |

PROD (VPS Vietnix `chodeli-vps` 14.225.207.177, `/opt/tubutree`) đang chạy `cb92dc8` = Đợt A+B. Miniapp CHƯA lên Zalo. Không deploy Đợt C/D khi chưa có lệnh rõ của chủ dự án.

### Verify sau merge C2 (HEAD `4b53388`)
- Đã chạy, đạt: `tsc --noEmit` apps/api, apps/miniapp, apps/web, apps/e2e đều 0 lỗi (sau `npx prisma generate`); API unit `npx jest` = 159 suite / 2872 test pass.
- **Chưa verify** (cần chạy lại): race suite trên Postgres thật; vitest miniapp và web; ESLint API (và `tubu-ds` cho miniapp); `check-partial-indexes.ts`; áp 123 migration lên DB trống + kiểm drift; Playwright e2e.
- Race suite lần chạy cuối bị 49/49 suite fail do container `tubu_it_main` (cổng 5550) đã tắt: `P1001 Can't reach database server`. Đó là lỗi môi trường, KHÔNG phải kết quả code. Đừng đọc nó là regression.
- Trước C2, mốc xanh gần nhất (HEAD `ee97986`): API unit 2835, race 255/46 suite, miniapp 1138, web 314, tsc 5 gói 0, lint API 0, 119 migration áp sạch, 14/14 partial index.

## 2. Việc cần làm tiếp (theo thứ tự)

1. Dựng lại môi trường test và hoàn tất verify C2 (mục 4). Sửa lỗi nếu có rồi commit.
2. Vòng C3: dùng lại workflow mẫu ở `handoff/` (mục 5). Gói:
   - PC-10a (sonnet): `game`, `loyalty`, C-082 chia khối, C-113 emoji ngoài game.
   - PC-10b (sonnet): `affiliate`, `dealer`, `storefront*`, `brand-story`, C-079.
   - PC-10c (haiku, ESLint `tubu-ds` làm chốt): các trang còn dùng alias legacy.
   - PC-11 (sonnet): admin web sang DS v2 (Q-25, Q-29). Làm SAU PC-7 vì dùng chung `apps/web/tailwind.config`. PC-7 đã merge nên làm được.
   - C-076: di cư các trang miniapp còn lại sang DS v2 (baseline 105 lỗi ESLint `tubu-ds`).
   - Màn admin hàng đợi hoàn tiền thủ công `/admin/customer-refunds` (API đã có từ PA-1, chưa có UI).
   - Cấu hình liên hệ hotline 0899 149 229 / email tubutree@gmail.com (Q-17): footer web đã đọc từ `/config/public`, kiểm tra miniapp.
3. Đợt D:
   - PD-1 (sonnet): ẩn Season Pass; đổi "cây thật" → "góp quỹ trồng cây"; bỏ perk hạng không có quy trình; ẩn Hoàn tiền sàn ngoài; bỏ lối vào `/merchant` khỏi web khách (PC-7 đã gỡ link ở header/footer/hero, rà lại); xoá `/beta`; xoá `ui/primitives.tsx` chết. Không xoá bảng/dữ liệu.
   - PD-2 (sonnet/haiku): gom helper trùng (mã đơn, maskName, SĐT, dayKey) về `api/common`; gỡ endpoint không ai gọi (xác nhận không có client cũ trên PROD gọi); đánh dấu bảng chết là deprecated, không DROP.
   - PD-3 (opus, hai lượt review): gộp TubuXu vào Điểm Xanh, 1.000 xu = 1 điểm làm tròn lên, lô quy đổi không hết hạn, không trần 20%, không ra tiền mặt. Cần spec ngắn + migration quy đổi số dư + race test. Đụng tiền trả trước của khách nên bắt buộc review độc lập.
4. Giai đoạn 4:
   - T1 full unit/integration/lint/build.
   - T2 race trên Postgres thật.
   - T3 Playwright e2e mọi luồng ở 390px + desktop, có ảnh chụp. Chạy cả các e2e đã viết nhưng chưa chạy: `buy-flow-4b.miniapp.spec.ts` (16 ca, mới `--list`), sửa `admin.spec.ts` của PC-8 (`getByLabel('Bậc đại lý')`), e2e của PC-1/PC-2. Chụp ảnh lỗi Home (`capture.mjs --states error`).
   - T4 test tải trước/sau (`scripts/loadtest`, DB `tubutree_perf` trong container `tubu_pg` cổng 5434) và áp migration từ DB trống + từ bản sao ẩn danh.
   - T5 exploratory/adversarial + review cuối toàn bộ diff.
5. Giai đoạn 5: viết `docs/2026-10-review/99-release-readiness.md` gồm bảng luồng × kết quả có bằng chứng, bug còn mở, rủi ro, tải trước/sau, checklist deploy (BE → web → miniapp), rollback, ghi chú đăng xuất refresh-token, việc chỉ chủ dự án làm được, kết luận GO/NO-GO. Cập nhật memory dự án. Báo cáo cuối ≤25 dòng.

## 3. Bài học môi trường (máy 15,5GB RAM, Windows, Docker Desktop)

- Race test cần DB tên đúng `tubutree_it`: `DATABASE_URL=postgresql://tubu:tubu@localhost:5550/tubutree_it`, chạy `cd apps/api && npx jest -c test/integration-race/jest.config.js --runInBand`. Trước đó chạy `npx prisma migrate deploy` với cùng URL.
- Container race: `docker run -d --name tubu_it_main -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p 5550:5432 postgres:16-alpine`. Các container `tubu_it_*` không có restart policy nên mất sau mỗi lần reboot/Docker restart.
- Docker Desktop nghẽn mạng khi mở hơn ~20 kết nối mới cùng lúc (Prisma `P2028` trong race spec). Cách sửa: restart Docker Desktop (kill tiến trình, `wsl --shutdown`, mở lại). `warmPool(prisma, 20)` trong `apps/api/test/integration-race/helpers.ts` giúp một phần, không thay được việc restart.
- Job nặng chạy tuần tự (E2E/load/Playwright/full suite song song làm máy sập OOM). Tối đa 3 subagent song song, chỉ 1 job nặng một lúc. Vitest 2.x: không dùng `--maxWorkers`. Script workflow phải LF.
- Sau mỗi lần merge schema Prisma phải `npx prisma generate` rồi mới `tsc`, nếu không có lỗi giả `outOfRangeCount`/`paymentMethod` does not exist.
- Workflow (tool Workflow) chạy nền bị chết mỗi lần session restart; chạy lại bằng `resumeFromRunId` thì agent đã xong được cache. Máy mới không có run id cũ: dùng worktree `hz*` đã đẩy lên nhánh hoặc chạy lại từ script mẫu.

## 4. Lệnh dựng lại môi trường và verify

```bash
pnpm install
cd apps/api && npx prisma generate
docker run -d --name tubu_it_main -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p 5550:5432 postgres:16-alpine
export DATABASE_URL=postgresql://tubu:tubu@localhost:5550/tubutree_it
npx prisma migrate deploy                       # kỳ vọng 123 migration, lần cuối 20261010191000_subscription_second_order_templates_fix
npx jest                                        # kỳ vọng 2872 pass
npx jest -c test/integration-race/jest.config.js --runInBand
npx eslint src --max-warnings=0
npx tsx prisma/check-partial-indexes.ts          # kỳ vọng 14/14
cd ../miniapp && npx tsc --noEmit && npx vitest run
cd ../web && npx tsc --noEmit && npx vitest run
cd ../e2e && npx tsc --noEmit -p tsconfig.json
```

Kiểm tra thêm: `npx prisma migrate diff` không drift; áp toàn bộ migration lên DB trống.

## 5. Workflow mẫu để chạy C3/D

`handoff/wave-c2.workflow.js` là script Workflow hoàn chỉnh của vòng C2 (setup → implement từng mục → review 1 → fix → review 2 cho gói tiền/auth, worktree cố định `hz6-PC-N`, container `tubu_it_pcN`). `handoff/wave-c2-body.js` là phần PKGS/ITEMS, `handoff/wave-c2-build.py` là cách ghép từ script vòng trước. Để làm C3: sao chép, đổi `hz6` → `hz7`, thay mảng gói/mục theo mục 2, đổi base sang HEAD hiện tại, đổi số migration trong prompt (123). Hoặc làm tay từng gói bằng Agent trong worktree riêng. Quy tắc bất biến: mỗi agent một worktree, commit ngay từng mục, chỉ người điều phối merge, agent không `git stash/reset/checkout` file không phải của mình, TDD, bình luận code chỉ giải thích "vì sao", commit kết thúc bằng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## 6. Việc còn mở từ review C2 (minor, không chặn merge)

- PC-2: `retrying/isFetching` là mã chết (React Query v5), khối lỗi chớp skeleton mỗi 60s khi poll giờ vàng; Browse chạm chip không `setDraft(state.q)`; kệ Mua lại mất im lặng khi refresh lỗi còn data cũ (thuộc PC-3). 5 ca e2e 320/375/390 chưa chạy.
- PC-6 (quyết định chủ dự án): (a) mua định kỳ rồi huỷ ngay vẫn hưởng giảm giá "Đăng ký & Tiết kiệm" của đơn đầu; (b) ví thiếu thì gói PAUSED, khi bật lại kỳ lỡ bị bỏ chứ không giao bù (thông báo đã nói rõ ngày kế tiếp); (c) giả định voucher đơn thứ 2: giảm 30.000đ cho đơn từ 199.000đ, chỉnh được trong SystemConfig. Ngày bắt đầu chỉ đặt được lúc tạo gói. Chưa kiểm ô chọn ngày trong Zalo WebView.
- PC-7: link Content Kit `/product/` trả 404 trên web (có từ trước); nền toàn cục mới ảnh hưởng admin (PC-11 sẽ xử lý); ô tìm kiếm nháy trên host CTV; khung "Đã nhận thanh toán" biến mất ngay. Chưa chạy ESLint `tubu-ds` và `next build` cho web.
- PC-9: ngày dd/MM/yyyy chưa phủ hết ~12 chỗ `toLocaleDateString`; `formatVnd` che giá rỗng thành "0đ"; 'Nhập mã ưu đãi' còn ở web; chữ "TubuXu" còn ở logic xu (chờ PD-3); 11 lỗi ESLint `tubu-ds` có từ trước ở game/loyalty/profile (PC-10a xử lý). Ngoài vùng không kiểm khoảng trống giữa các nhịp, FE chưa cảnh báo.
- Cũ còn mở: 36 trang thiếu h1; nested-interactive ở hàng checkout; hàng địa chỉ thiếu keyboard props; TimeInput trùng tên "Giờ" trong admin.tsx/staff.tsx; PB-1: `CREATE INDEX` khoá ghi ~3,7s ở 200k đơn, `/search/suggest` trả `[]` cho <2 ký tự ảnh hưởng ô chọn CTV/cộng đồng gọi từ 1 ký tự; PA-1 yêu cầu 5 (userId = khách cuối) cố ý hoãn; PA-2/3/6/7 minor.

## 7. Lưu ý khi deploy (khi có lệnh)

Cách đã dùng cho `cb92dc8`: `git bundle` lên VPS, `pg_dump` backup trước, `git merge --ff-only`, `docker compose -f docker-compose.vietnix.yml up -d --build`, migrate, smoke test. Seed chỉ an toàn khi PROD chưa có người dùng thật; sau đó chỉ chèn bản ghi mới. Migration C1+C2 áp từ `cb92dc8`: các thư mục từ `20261010170000_orders_invoice_open_index` trở đi, cộng các migration C1 (xem `git diff --stat cb92dc8..HEAD -- apps/api/prisma/migrations`). PC-6 chèn mẫu thông báo bằng migration (không phụ thuộc seed). Cấu hình mới của PC-9 (`createOnly` N=3, M=15 chấm công ngoài vùng) cần seed hoặc chèn tay vào PROD. Đăng nhập web dùng cookie refresh HttpOnly nên deploy web đăng xuất mọi phiên một lần. Miniapp chỉ lên Zalo bản test (`zmp deploy -t -e`), không nộp production. Không đụng root `tubutree.com` (chung VPS với ChoDeli/WordPress).

## 8. Việc chỉ chủ dự án làm được

- Cloudflare: trỏ `api.tubutree.com` và `app.tubutree.com` về 14.225.207.177, DNS-only, không proxy (hiện vẫn trỏ IP GCP đã chết 34.142.194.160); sau đó mới cấp SSL.
- Duyệt quy tắc PA-7: đơn đã thưởng cho cùng người mời thì không thưởng lại.
- Quyết định 3 mục PC-6 ở mục 6.
- Quét QR UAT trên Zalo thật; nhập nội dung FAQ/Academy.
- Dọn sau cùng: worktree `.claude/worktrees/hz*-*` (không `git worktree remove --force`, coi chừng junction), container `tubu_it_*`.
