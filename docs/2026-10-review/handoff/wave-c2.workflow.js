export const meta = {
  name: 'tubutree-2026-10-wave-c2',
  description: 'Đợt C vòng C2: PC-2 hoàn tất 4b, PC-6 giao định kỳ + đơn thứ 2, PC-7 web khách DS v2, PC-9 nhân sự + câu chữ; worktree cố định, từng mục một agent',
  phases: [
    { title: 'Setup', detail: 'pnpm install + Postgres container riêng cho mỗi gói' },
    { title: 'Implement', detail: 'mỗi mục một agent trong worktree hz6-PC-N, commit ngay khi xanh' },
    { title: 'Review', detail: 'reviewer opus độc lập chỉ đọc diff' },
    { title: 'Fix', detail: 'sửa theo review' },
  ],
}

function sem(max) {
  let active = 0
  const waiters = []
  return {
    async acquire() { if (active < max) { active++; return } await new Promise(r => waiters.push(r)) },
    release() { const w = waiters.shift(); if (w) w(); else active-- },
  }
}
const TOTAL = sem(3)
const HEAVY = sem(1)
async function run(prompt, opts, heavy) {
  if (heavy) await HEAVY.acquire()
  await TOTAL.acquire()
  try { return await agent(prompt, opts) } finally { TOTAL.release(); if (heavy) HEAVY.release() }
}

const BASE = args.base

const COMMON = `Quy tắc chung UI: dùng component DS v2 sẵn có (apps/miniapp/src/components/ui, token packages/design-tokens), ESLint tubu-ds của file đã sửa phải 0 lỗi mới (npx eslint <file> trong apps/miniapp hoặc apps/web), vùng chạm >=44px, thông điệp tiếng Việt có dấu theo thuật ngữ Q-26 ("Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước"), không đổi hành vi nghiệp vụ ngoài mục tiêu. Tra bằng chứng + cách kiểm ở docs/2026-10-review/findings-catalog.md (dòng C-xxx) và báo cáo gốc 04-uiux.md / 01-pm.md theo ID gốc; quyết định chủ dự án ở 00-ROADMAP.md mục 9. Mỗi thay đổi hành vi có test vitest (miniapp/web) hoặc jest (api). Đã có sẵn từ các vòng trước (tái dùng, không làm lại): WalletLedgerService.applyDelta (sổ cái Ví Tubu, apps/api/src/modules/wallet), notification-categories (tôn trọng tắt thông báo khuyến mãi), CRON_TZ (apps/api/src/common/cron-tz.ts, mọi @Cron phải có timeZone), rowKeyboardProps/ScrollRow/Field trong components/ui.`

const PKGS = [
  { id: 'PC-2', port: 5572, model: 'sonnet', rm: 'sonnet', twoPass: false,
    spec: `GÓI PC-2 — Hoàn tất 4b (phần mã nguồn của Task 26-27) + triage minor còn tồn. Mục: C-084 (Home khi catalog/khối lỗi: hiện trạng thái lỗi + nút "Thử lại" thay vì mất khối im lặng; dùng endpoint GET /home gộp đã có ở PB-6 và cơ chế lỗi-độc-lập-từng-khối), Task 26 phần mã (vùng chạm/hit area ≥44px, skeleton đúng kích thước chống nhảy layout ở Home/Browse/Search cho 320/375/390px), và các "deferred minors" ghi trong .superpowers/sdd/2026-09-30-buy-flow-4b-discovery-search/progress.md (đọc file: chọn những minor rẻ + an toàn, ghi rõ cái nào làm/bỏ trong báo cáo). KHÔNG chạy Playwright/E2E (điều phối viên chạy ở giai đoạn T3: các phần cần chạy E2E/ảnh chụp ghi là "unverified — chờ T3").
${COMMON}
Nhóm file: apps/miniapp/src/pages/{home,browse}*, apps/miniapp/src/components/{home,browse,search}/**, apps/e2e/tests/buy-flow-4b-* (chỉ cập nhật selector nếu đổi cấu trúc; không chạy). KHÔNG sửa components/ui (đã xong ở PC-1; cần đổi thì ghi báo cáo).` },
  { id: 'PC-6', port: 5576, model: 'opus', rm: 'opus', twoPass: true,
    spec: `GÓI PC-6 — Giao định kỳ + đơn thứ 2 (có tiền: Ví Tubu, đơn tự sinh). Mục: C-015 (Q-13: đơn đầu giao NGAY hoặc khách chọn ngày bắt đầu (không phải chờ một chu kỳ); trả bằng COD / Ví Tubu / chuyển khoản (Ví: trừ qua WalletLedgerService.applyDelta trong cùng transaction với việc tạo đơn kỳ, không âm, idempotent theo (gói, kỳ); thiếu số dư khi sinh đơn kỳ → tạm dừng gói + thông báo, KHÔNG sinh đơn không thanh toán được; chuyển khoản → đơn PENDING_PAYMENT theo luồng hiện có, nhớ cron huỷ 24h); sửa được SỐ LƯỢNG và ĐỊA CHỈ của gói đang hoạt động/tạm dừng (kiểm sellable, kiểm địa chỉ thuộc user, chống trùng gói cùng địa chỉ+biến thể đã có ở PA-6 — giữ unique), nhiều gói cùng SP chỉ khi khác địa chỉ), C-017 (đẩy đơn thứ 2 trong 30 ngày: nhắc/voucher đơn thứ 2 sau đơn đầu giao thành công — chỉ cho user thật, idempotent, tôn trọng notifyPromo (notification-categories); và tin MỜI ĐÁNH GIÁ sau khi đơn giao — mã tin giao dịch, tuân thủ luật Q-30 một đánh giá/SP; cron mới có timeZone: CRON_TZ, chạy theo lô có giới hạn + khoá chống chạy chồng). Miniapp: tab "Định kỳ" ở trang Đơn hàng cho chọn ngày bắt đầu, phương thức thanh toán, sửa số lượng/địa chỉ (component DS v2).
Race spec Postgres thật bắt buộc: sinh đơn kỳ song song không ra 2 đơn/kỳ; trừ ví khi sinh đơn kỳ khớp sổ cái, thiếu ví → pause không đơn; sửa địa chỉ/số lượng song song với cron sinh đơn không ra đơn sai.
${COMMON}
Nhóm file: apps/api/src/modules/{subscriptions,vouchers,lifecycle}/**, apps/api/prisma (migration additive nếu cần, kiểm dữ liệu trước), apps/miniapp/src/pages/orders* (tab Định kỳ) + components liên quan, apps/miniapp/src/services/** (client subscriptions). KHÔNG sửa wallet-ledger.service (chỉ gọi), checkout compute, order-status.` },
  { id: 'PC-7', port: 5577, model: 'sonnet', rm: 'sonnet', twoPass: false,
    spec: `GÓI PC-7 — Web khách theo DS v2 (Q-25: đồng bộ; admin web làm ở gói PC-11 sau, KHÔNG sửa apps/web/src/app/admin). Mục: C-097 (web chuyển sang token/palette DS v2: dùng packages/design-tokens (xanh tự nhiên cao cấp, Fraunces cho tiêu đề), loại palette v1 cam/lá hard-code ở web khách: app/page.tsx, san-pham, gio-hang, thanh-toan, tai-khoan, s/[slug], site-header/footer; cập nhật apps/web/tailwind.config.ts theo preset DS v2 (PC-1 đã chỉnh màu tương phản — giữ), thay dần lớp cũ bằng lớp v2 trên các trang khách; KHÔNG đổi hành vi), C-025 (web khách: trang chi tiết đơn + hiển thị QR/thông tin chuyển khoản để trả lại đơn, ô nhập/danh sách mã giảm giá ở thanh toán, ô tìm kiếm ở header, footer có hotline 0899 149 229 + email tubutree@gmail.com lấy từ cấu hình công khai nếu có endpoint, KHÔNG dẫn khách vào "Kênh Đối Tác" (/merchant) — gỡ link đó khỏi header/footer khách), C-116 phần web (chữ <12px → ≥12px ở web home và các trang khách), C-123 (thứ tự heading đúng ở các trang web khách: h1 một lần, h2, h3; thêm h1 cho 3 trang thiếu), C-077 phần web khách (nút icon có aria-label, input có nhãn). Q-20: SITE_URL/canonical/sitemap dùng https://app.tubutree.com (apps/web cấu hình SITE_URL + fallback link chia sẻ miniapp); thêm NEXT_PUBLIC_SITE_URL=https://app.tubutree.com vào docker-compose.vietnix.yml (build arg/env như cách web đang nhận API_BASE_URL) và ghi vào báo cáo.
${COMMON}
Nhóm file: apps/web/src/app/{page.tsx,layout.tsx,san-pham,gio-hang,thanh-toan,tai-khoan,s,dang-nhap,sitemap.ts,robots.ts,globals.css}, apps/web/src/components/** (KHÔNG components/admin), apps/web/tailwind.config.ts, apps/web/src/lib/**, docker-compose.vietnix.yml (chỉ biến SITE_URL). Không đụng /admin, /merchant, /brand (admin-adjacent làm ở PC-11/PD-1).` },
  { id: 'PC-9', port: 5579, model: 'sonnet', rm: 'sonnet', twoPass: false,
    spec: `GÓI PC-9 — Nhân sự + câu chữ. Mục: C-056 (chấm công: rớt vùng GPS MỘT heartbeat không được tự chấm ra; chỉ auto-checkout sau N heartbeat liên tiếp ngoài vùng (N cấu hình SystemConfig, mặc định 3, seed createOnly) hoặc quá thời gian ngoài vùng M phút; heartbeat hợp lệ trở lại thì reset bộ đếm; test unit + race nếu đụng DB), C-073 (cộng đồng: lời và danh mục nói về cây cảnh trong khi hàng bán là mỹ phẩm, tẩy rửa, thực phẩm → viết lại i18n vi.ts (khối cộng đồng ~462-527) và danh mục cộng đồng trong seed theo ngành hàng thật; seed chỉ thêm/đổi mềm, không xoá dữ liệu cộng đồng đã có), C-074 (Q-26: thống nhất thuật ngữ "Mã giảm giá" (không "Mã ưu đãi"), "Điểm Xanh" (không "Tubu Xu/TubuXu" ở chỗ khách thấy — TubuXu sẽ gộp ở Đợt D nên chỉ đổi chữ hiển thị ở nơi không gắn logic xu; ghi những chỗ còn lại vào báo cáo), "Ví Tubu"; đưa kho voucher ("Mã giảm giá của tôi") lên đầu trang /loyalty thay vì khối thứ 7), C-083 (định dạng số nhất quán: một helper formatNumber/formatVnd/formatPoints dùng chung, thay toLocaleString trực tiếp và số trần ở game/home/order-detail), C-115 (màn đơn trống: bỏ câu 'Mua đơn đầu - nhận 30k voucher' sai nghĩa → 'Đơn đầu từ 199.000đ nhận mã giảm giá' hoặc tương đương đúng với voucher chào mừng 30k/đơn tối thiểu 199k), C-120 (lịch sử vận chuyển: map status hãng vận chuyển sang tiếng Việt, '—' khi rỗng không in chuỗi gốc), C-119 (trang 404 không bị tiêu đề đè lên hình minh hoạ).
${COMMON}
Nhóm file: apps/api/src/modules/staff/**, apps/api/prisma/seed.ts (chỉ cộng đồng + khoá config chấm công), apps/miniapp/src/i18n/**, apps/miniapp/src/pages/{order-detail,not-found,loyalty,game}* (chỉ chữ/định dạng/vị trí khối), apps/miniapp/src/utils/format* (helper mới). KHÔNG sửa logic tiền/hạng/điểm.` },
]

const ITEMS = {
  'PC-2': [
    { k: 'i1', c: 'C-084', scope: 'C-084 (Home lỗi từng khối có Thử lại) + skeleton/hit area Task 26 phần mã cho Home/Browse/Search.' },
    { k: 'i2', c: 'C-084', scope: 'Triage minors trong progress.md (làm cái rẻ+an toàn, ghi rõ cái bỏ) + hoàn thiện báo cáo gói (liệt kê phần cần E2E ở T3).' },
  ],
  'PC-6': [
    { k: 'i1', c: 'C-015', scope: 'C-015 phần API: đơn đầu giao ngay/chọn ngày, thanh toán COD/Ví/chuyển khoản (Ví qua applyDelta), sửa số lượng/địa chỉ + race spec Postgres thật.' },
    { k: 'i2', c: 'C-015', scope: 'C-015 phần miniapp (tab Định kỳ: chọn ngày bắt đầu, thanh toán, sửa gói).' },
    { k: 'i3', c: 'C-017', scope: 'C-017 (nhắc/voucher đơn thứ 2, tin mời đánh giá sau giao, cron theo lô có timeZone) + hoàn thiện báo cáo gói.' },
  ],
  'PC-7': [
    { k: 'i1', c: 'C-097', scope: 'C-097 (tailwind.config + token DS v2 + trang chủ, layout, header/footer web khách) + Q-20 SITE_URL.' },
    { k: 'i2', c: 'C-097', scope: 'C-097 phần còn lại (san-pham, gio-hang, thanh-toan, tai-khoan, s/[slug], dang-nhap) + C-116, C-123, C-077 web khách.' },
    { k: 'i3', c: 'C-025', scope: 'C-025 (chi tiết đơn + QR trả lại, mã giảm giá ở thanh toán, tìm kiếm header, footer liên hệ, gỡ lối vào Kênh Đối Tác) + hoàn thiện báo cáo gói.' },
  ],
  'PC-9': [
    { k: 'i1', c: 'C-056', scope: 'C-056 (chấm công grace nhiều heartbeat) + C-073 (cộng đồng đúng ngành hàng).' },
    { k: 'i2', c: 'C-074', scope: 'C-074, C-083, C-115, C-120, C-119 + hoàn thiện báo cáo gói.' },
  ],
}


const WT = (id) => 'D:\\tubutree-mini-app\\.claude\\worktrees\\hz6-' + id
const BR = (id) => 'hz6/' + id

function ctx(p) {
  const wt = WT(p.id)
  const dburl = 'postgresql://tubu:tubu@localhost:' + p.port + '/tubutree_it?schema=public'
  return `
BỐI CẢNH: Tubu Tree, monorepo pnpm+Turborepo (apps/api NestJS+Prisma, apps/web Next.js, apps/miniapp Zalo Mini App, apps/e2e Playwright, packages/*). Windows, có Bash (Git Bash) và PowerShell.
MÃ GÓI: ${p.id}. Bạn làm việc trong git worktree CỐ ĐỊNH của gói: ${wt} (nhánh ${BR(p.id)}, tách từ hardening/2026-10 commit ${BASE}). MỌI lệnh shell phải bắt đầu bằng cd vào thư mục đó; MỌI đường dẫn Read/Edit/Write phải nằm dưới ${wt}. Repo chính D:\\tubutree-mini-app (ngoài .claude\\worktrees) là của điều phối viên: KHÔNG sửa gì ở đó (chỉ được đọc/copy apps/api/.env).
MÁY CÓ THỂ KHỞI ĐỘNG LẠI ĐỘT NGỘT: thay đổi chưa commit sẽ MẤT. Vì vậy commit NGAY khi một bước đã xanh (git add <file cụ thể> rồi git commit), commit sớm commit nhiều. Đầu mỗi lượt chạy: git status + git log --oneline ${BASE}..HEAD để biết lần trước làm tới đâu; mục đã có commit và test xanh thì chỉ xác nhận (chạy lại test của mục) rồi trả kết quả, đừng làm lại; có thay đổi dở chưa commit thì xem lại diff, hoàn thiện rồi commit.
TÀI LIỆU: docs/2026-10-review/00-ROADMAP.md (mục 3 = gói việc, mục 9 = quyết định chủ dự án — BẮT BUỘC tuân theo), docs/2026-10-review/findings-catalog.md (dòng C-xxx), báo cáo gốc 01-pm.md..06-test-baseline.md cùng thư mục (tìm theo ID gốc để lấy bằng chứng + cách tái hiện).
MÔI TRƯỜNG (bước setup đã dựng sẵn; thiếu thì tự bổ sung): node_modules thật trong worktree (CẤM junction/symlink sang repo chính), packages/shared-types/dist, apps/api/.env (copy từ D:\\tubutree-mini-app\\apps\\api\\.env, gitignored, KHÔNG commit), Prisma client, container Postgres tubu_it_${p.id.toLowerCase().replace('-', '')} cổng ${p.port} db tubutree_it (tubu/tubu).
  DATABASE_URL cho race test và migration: ${dburl}
  Nếu docker chưa chạy (sau reboot): đợi "docker info" tới 5 phút; container tắt thì "docker start <tên>"; mất thì docker run -d --name <tên> -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${p.port}:5432 postgres:16-alpine rồi migrate deploy. KHÔNG ghi vào DB tubu_pg:5434.
  Race spec: trong apps/api chạy DATABASE_URL=${dburl} npx jest -c test/integration-race/jest.config.js --runInBand <file>.
QUY TRÌNH:
 - TDD: viết test tái hiện lỗi trước, chạy thấy ĐỎ, rồi sửa cho XANH. Lỗi tiền/race: thêm race spec apps/api/test/integration-race/<tên>.race-spec.ts trên Postgres riêng (unit test Prisma giả không đủ).
 - Mỗi mục một commit nhỏ trở lên. Message: "fix(<scope>): <mô tả> (C-xxx)", dòng trống, rồi "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>".
 - Migration an toàn với dữ liệu PROD có sẵn: additive; kiểm trùng trước khi thêm unique; backfill rõ ràng; tạo bằng "npx prisma migrate dev --create-only --name <tên>" trỏ Postgres riêng (hoặc SQL tay) và áp thử bằng migrate deploy.
 - Comment code chỉ giải thích "vì sao" không hiển nhiên, không kể lại thay đổi. Giữ phong cách code xung quanh.
 - Chạy test: chỉ spec liên quan, jest --maxWorkers=1; KHÔNG chạy full suite, KHÔNG Playwright (máy 15,5GB RAM; miniapp/web: vitest run <file>, không dùng --maxWorkers; ESLint file đã sửa; tsc). Typecheck app bị sửa (npx tsc --noEmit -p tsconfig.json trong apps/api; npx tsc --noEmit trong apps/miniapp, apps/web) và ESLint file đã sửa.
 - CẤM: git stash/reset/checkout/restore/rebase/push/merge/cherry-pick/switch; git worktree remove; deploy; đụng PROD; gọi dịch vụ ngoài thật; sửa file ngoài nhóm file của gói (buộc phải thì giữ tối thiểu và ghi lý do vì gói khác đang sửa song song).
 - Nghiệp vụ không rõ: chọn phương án an toàn tiền nhất, ghi vào "Giả định" trong báo cáo.
BÁO CÁO: ghi/append mục của bạn vào docs/2026-10-review/impl/${p.id}.md trong worktree và commit: từng mục C-xxx (XONG / MỘT PHẦN / BỎ + lý do), test thêm (đỏ→xanh), lệnh kiểm chứng + vài dòng output thật, migration, giả định, việc còn lại.
`
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'PARTIAL', 'SKIPPED', 'BLOCKED'] },
    head: { type: 'string' },
    note: { type: 'string' },
    tests: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, result: { type: 'string' } }, required: ['cmd', 'result'] } },
    migrations: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'head', 'note'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'integer' }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'issue'] } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'findings', 'summary'],
}

function setupPrompt(p) {
  const wt = WT(p.id)
  const cname = 'tubu_it_' + p.id.toLowerCase().replace('-', '')
  return `Bước SETUP môi trường cho gói ${p.id}. Worktree: ${wt} (đã tồn tại, nhánh ${BR(p.id)}). Làm lần lượt, bước nào đã xong thì bỏ qua (idempotent), mỗi lệnh bắt đầu bằng cd ${wt}:
1. Nếu chưa có node_modules thật: pnpm install --frozen-lockfile --offline (lỗi thì chạy lại không --offline). CẤM junction/symlink sang repo chính. Kiểm tra "node_modules không phải junction trỏ ra ngoài worktree".
2. pnpm --filter @tubutree/shared-types build (kiểm packages/shared-types/dist/index.js có).
3. Copy D:\\tubutree-mini-app\\apps\\api\\.env sang ${wt}\\apps\\api\\.env nếu chưa có (KHÔNG commit, KHÔNG in nội dung ra). Trong apps/api: npx prisma generate.
4. Docker: đợi docker info tối đa 5 phút. Container ${cname}: docker rm -f ${cname} 2>/dev/null; docker run -d --name ${cname} -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${p.port}:5432 postgres:16-alpine; đợi pg_isready; rồi trong apps/api: DATABASE_URL=postgresql://tubu:tubu@localhost:${p.port}/tubutree_it?schema=public npx prisma migrate deploy (kỳ vọng áp hết 119 migration).
5. Kiểm nhanh: trong apps/api chạy một spec nhỏ có sẵn bất kỳ (vd npx jest src/modules/auth --maxWorkers=1 --testPathPattern=auth.service) để chắc jest + prisma client chạy được.
KHÔNG sửa source, KHÔNG git ghi. Trả về StructuredOutput: status DONE nếu mọi bước OK (BLOCKED nếu không), head = git rev-parse HEAD, note = tóm tắt ≤5 dòng (nêu lỗi nếu có).`
}

function itemPrompt(p, it, idx, n) {
  return `${ctx(p)}
GÓI ${p.id} — MỤC ${idx + 1}/${n} (${it.c}).
TOÀN BỘ ĐẶC TẢ GÓI (để hiểu ngữ cảnh):
${p.spec}

PHẠM VI CỦA LƯỢT NÀY (chỉ làm phần này, các mục khác do lượt khác làm, có thể đã commit trong worktree): ${it.scope}
Trả về StructuredOutput: status (DONE/PARTIAL/SKIPPED/BLOCKED), head = git rev-parse HEAD sau commit cuối, note ≤8 dòng, tests [{cmd, result}] (lệnh đã chạy + kết quả thật), migrations (tên thư mục nếu có).`
}

function reviewPrompt(p, round) {
  const wt = WT(p.id)
  const cname = 'tubu_it_' + p.id.toLowerCase().replace('-', '') + '_r' + round
  return `Bạn là REVIEWER ĐỘC LẬP (lượt ${round}) cho gói ${p.id} của đợt hardening Tubu Tree. Bạn KHÔNG nhận kết luận của người làm — tự đọc diff và code.
Worktree: ${wt} (nhánh ${BR(p.id)}). Base: ${BASE}. Xem: git -C "${wt}" log --oneline ${BASE}..HEAD ; git -C "${wt}" diff ${BASE}..HEAD (bỏ qua docs/2026-10-review/impl/*.md — đó là lời tự báo, không phải bằng chứng).
YÊU CẦU CỦA GÓI (để đối chiếu):
${p.spec}
Quyết định chủ dự án: docs/2026-10-review/00-ROADMAP.md mục 9.
Nhiệm vụ: tìm lỗi THẬT trong diff — sai nghiệp vụ so với yêu cầu/quyết định, lỗ hổng tiền (sai đích, cộng/trừ 2 lần, làm tròn, số âm, thiếu thu hồi), race/transaction (đọc-rồi-ghi, P2002 trong tx, thiếu khoá), auth/IDOR, migration không an toàn với dữ liệu có sẵn, test không kiểm điều nó tuyên bố (mock che lỗi, assert yếu), thiếu test cho nhánh quan trọng, hồi quy luồng khác (grep nơi gọi). Với mỗi nghi ngờ, truy 2-3 input cụ thể qua code. Được chạy test liên quan (jest --maxWorkers=1 trong worktree; race spec cần Postgres: docker run -d --name ${cname} -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${p.port + 100 * round}:5432 postgres:16-alpine, migrate deploy, chạy, rồi docker rm -f ${cname}). KHÔNG sửa code, KHÔNG git ghi, KHÔNG chạy full suite/Playwright.
Phân loại: blocker (sai tiền/bảo mật/mất dữ liệu/làm hỏng luồng), major (sai yêu cầu, thiếu test quan trọng, race có thể xảy ra), minor (còn lại). Verdict CHANGES nếu có blocker hoặc major.
Trả về StructuredOutput: verdict, findings [{severity, file, line, issue, fix}], summary ≤8 dòng.`
}

function fixPrompt(p, review) {
  return `${ctx(p)}
SỬA THEO REVIEW cho gói ${p.id}. Làm TRỰC TIẾP trong worktree ${WT(p.id)}.
YÊU CẦU GÓI:
${p.spec}
FINDINGS của reviewer độc lập (JSON):
${JSON.stringify(review.findings, null, 1)}
Với mỗi blocker/major: xác minh lại (reviewer có thể sai — nếu sai, giải thích bằng bằng chứng trong báo cáo, không sửa mù); nếu đúng: test đỏ trước rồi sửa, commit riêng "fix(<scope>): address review <ngắn> (C-xxx)". Minor: sửa nếu rẻ và an toàn. Cập nhật docs/2026-10-review/impl/${p.id}.md mục "Review lượt ${'1'}" (từng finding: đã sửa / không sửa + lý do) và commit.
Trả về StructuredOutput: status, head, note, tests, migrations.`
}

phase('Setup')
log('Base ' + BASE + '; 4 gói trong worktree cố định hz6-*, tối đa 3 agent cùng lúc; resume được sau reboot')

const results = await pipeline(
  PKGS.map(p => ({ ...p, items: ITEMS[p.id] })),
  async (p) => {
    const s = await run(setupPrompt(p), { label: 'setup:' + p.id, phase: 'Setup', model: 'sonnet', schema: ITEM_SCHEMA })
    return { p, setup: s }
  },
  async (st, p0) => {
    const p = st.p
    if (!st.setup || st.setup.status !== 'DONE') return { id: p.id, error: 'setup ' + (st.setup ? st.setup.note : 'null') }
    const items = []
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i]
      const r = await run(itemPrompt(p, it, i, p.items.length), { label: 'impl:' + p.id + ':' + it.k, phase: 'Implement', model: p.model, schema: ITEM_SCHEMA }, false)
      items.push({ c: it.c, k: it.k, status: r ? r.status : 'FAILED', note: r ? r.note : 'agent null', head: r && r.head, tests: r && r.tests, migrations: r && r.migrations })
    }
    const r1 = await run(reviewPrompt(p, 1), { label: 'review1:' + p.id, phase: 'Review', model: p.rm || 'opus', schema: REVIEW_SCHEMA })
    let fix = null, r2 = null
    if (r1 && r1.verdict === 'CHANGES') {
      fix = await run(fixPrompt(p, r1), { label: 'fix:' + p.id, phase: 'Fix', model: p.model, schema: ITEM_SCHEMA })
      r2 = await run(reviewPrompt(p, 2), { label: 'review2:' + p.id, phase: 'Review', model: p.rm || 'opus', schema: REVIEW_SCHEMA })
    } else if (p.twoPass) {
      r2 = await run(reviewPrompt(p, 2), { label: 'review2:' + p.id, phase: 'Review', model: p.rm || 'opus', schema: REVIEW_SCHEMA })
    }
    return { id: p.id, items, r1, fix, r2 }
  },
)

return results.map(r => r && ({
  id: r.id, error: r.error,
  worktree: r.id && WT(r.id), branch: r.id && BR(r.id),
  items: r.items && r.items.map(i => ({ c: i.c, k: i.k, status: i.status, head: i.head, note: i.note, migrations: i.migrations })),
  review1: r.r1 && (r.r1.verdict + ' (' + r.r1.findings.length + ' findings): ' + r.r1.summary),
  fix: r.fix && { status: r.fix.status, head: r.fix.head, note: r.fix.note },
  review2: r.r2 && { verdict: r.r2.verdict, open: r.r2.findings.filter(f => f.severity !== 'minor'), summary: r.r2.summary },
}))
