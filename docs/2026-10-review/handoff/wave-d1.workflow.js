export const meta = {
  name: 'tubutree-2026-10-wave-d1',
  description: 'Đợt D vòng D1: PD-1 (ẩn/xoá tính năng thừa, dọn alias DS) + PD-2 (gom logic trùng, gỡ endpoint/khoá chết, Q-30 đánh giá); worktree cố định hz8-*, review opus hai lượt',
  phases: [
    { title: 'Implement', detail: 'mỗi mục một agent trong worktree hz8-PD-N, commit từng mục' },
    { title: 'Review', detail: 'reviewer opus độc lập chỉ đọc diff, chạy lại lệnh đo' },
    { title: 'Fix', detail: 'sửa theo review, review lượt sau nếu còn blocker/major' },
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
// PC-12 đang chạy ở workflow khác (1 agent một lúc) => ở đây tối đa 2 để tổng không quá 3 subagent.
const TOTAL = sem(args.maxAgents || 2)
async function run(prompt, opts) {
  await TOTAL.acquire()
  try { return await agent(prompt, opts) } finally { TOTAL.release() }
}

const BASE = args.base
const REPO = args.repo
const NODEBIN = args.nodebin
const WT = (id) => REPO + '/.claude/worktrees/hz8-' + id
const BR = (id) => 'hz8/' + id

const PKGS = [
  {
    id: 'PD-1', port: null, rm: 'opus', twoPass: true,
    lens: 'Đây là gói ẨN/XOÁ tính năng + đổi chữ hướng khách + sửa dữ liệu hạng thành viên. Kiểm kỹ: (1) không xoá bảng/cột/dữ liệu, không DROP, migration chỉ UPDATE idempotent theo điều kiện khớp nội dung cũ; (2) không để sót lối vào (grep mọi nơi: miniapp, web, API trả chữ, seed, template thông báo, i18n, e2e); (3) không để khối trống/khoảng hở/link chết/route 404 do xoá; (4) cam kết quảng cáo còn sót ("cây thật", "PanNature" như cam kết, perk không có quy trình); (5) chữ mới đúng Q-16/Q-26; (6) guard/test cũ bị xoá hoặc nới lỏng một cách đáng ngờ; (7) tokens.css: xoá alias không làm vỡ biến đang dùng (chạy node scripts/check-undefined-css-vars.mjs, static-scan).',
    spec: `GÓI PD-1 — Ẩn/xoá tính năng thừa theo quyết định chủ dự án Q-15, Q-16, Q-19. Chỉ ẩn lối vào / đổi chữ / xoá mã chết; KHÔNG xoá bảng, cột, dữ liệu; KHÔNG DROP; API giữ nguyên trừ khi mục nêu rõ. Đọc docs/2026-10-review/00-ROADMAP.md mục 6 và 9, findings-catalog.md dòng C-010, C-044, C-086, C-096, C-118, C-069.
File sở hữu: apps/miniapp/src/** (trừ components/ui/** ngoài primitives.tsx), apps/web/src/** (chỉ các chỗ nêu bên dưới), apps/api/src/modules/{game,loyalty,notifications}/** chỉ phần chữ hướng khách, apps/api/prisma/seed.ts + migration MỚI (chỉ UPDATE dữ liệu chữ/perk, idempotent), apps/e2e/tests/** (chỉ cập nhật selector/chữ bị đổi, không chạy). KHÔNG đụng apps/api checkout/wallet/loyalty logic tiền (PD-3 làm sau).
Các mục (mỗi mục MỘT commit nhỏ trở lên, test đỏ rồi xanh):
 1. C-044 Season Pass: ẩn hoàn toàn khỏi miniapp (khối trong components/game/*, pages/game.tsx, lời gọi API season-pass, thông báo/huy hiệu mùa nếu có). Giữ endpoint, bảng, dịch vụ. Không để khối trống hay khoảng hở. Test: trang game không render và không gọi API season-pass.
 2. C-010 + Q-16 "cây thật": đổi mọi chữ hướng khách "cây thật" / "Mua cây thật" / "cam kết trồng cây thật cùng PanNature" thành cách nói "góp quỹ trồng cây" (không hứa trồng một cây thật cụ thể, không nêu PanNature như cam kết thực hiện). Đã khảo sát: miniapp components/game/{eco-impact,harvest-celebration,garden-plots,tree-actions,community-goal,use-game-actions}.tsx, pages/{refill,about}.tsx, services/game-api.ts (comment), web admin app/admin/page.tsx (dòng "cây thật góp PanNature"), API game.service.ts + game-community.service.ts (chữ trả về FE), seed.ts (câu quiz q6, mô tả config game.tree_xu_price). Tự grep lại toàn repo (cả "cay that", "PanNature", "Rừng Xanh Lên") để chắc không sót; tên biến/hàm nội bộ giữ nguyên. Chữ nằm trong dữ liệu DB (quiz, mô tả): sửa seed + thêm migration SQL idempotent (UPDATE ... WHERE nội dung đúng bằng chuỗi cũ), không DELETE.
 3. Perk hạng không có quy trình (Q-16): kiểm từng perk trong seed.ts membership_tiers.perks và trong UI (pages/about.tsx dòng ~14-50, loyalty) bằng grep xem có cơ chế thực hiện trong mã không (tích điểm hệ số, freeship, voucher sinh nhật, giảm 5% = có cơ chế; "Ưu tiên hotline", "Beta tester", "hộp quà", "1 sample", "Quà sinh nhật cá nhân hóa" = nghi không có). Bỏ perk KHÔNG có cơ chế khỏi UI + seed + migration UPDATE idempotent cho membership_tiers.perks (khớp đúng mảng cũ theo tên hạng, thận trọng với kiểu cột JSON). Ghi bảng bằng chứng từng perk trong báo cáo.
 4. C-086 phần cashback + Q-15: ẩn "Hoàn tiền sàn ngoài" (cashback) khỏi hub Cá nhân (profile.tsx danh sách + tập READY là mã chết) và mọi lối vào khác trong miniapp (wallet, home, settings, thông báo). Giữ trang, route, API (có thể bật lại): gom thành một hằng số/cờ trong apps/miniapp/src/utils/features.ts nếu rẻ. Test: hub không có mục này.
 5. C-096 + Q-19 /merchant: web khách không còn lối vào /merchant (PC-7 đã gỡ link ở header/footer/hero: rà lại toàn apps/web/src ngoài app/merchant và app/admin: header, footer, hero, sitemap.ts, robots.ts, trang tài khoản, điều hướng sau đăng nhập, trang 404, CTA "Kênh Đối Tác"); miniapp không link sang. Giữ nguyên trang /merchant (đối tác vẫn vào bằng URL), thêm noindex (metadata robots) + Disallow trong robots.ts nếu chưa có. Test vitest web.
 6. C-118 + Q-19 /beta: xoá trang Beta Tester: pages/beta.tsx + spec, đăng ký route, mục trong settings.tsx (~dòng 95), i18n key chỉ dùng ở đó, e2e liên quan; API beta giữ nguyên (PD-2 xử lý endpoint). Cập nhật mọi spec/guard nhắc beta.
 7. C-069: xoá components/ui/primitives.tsx + primitives.spec.tsx (grep chứng minh 0 import ngoài spec); cập nhật chỗ liệt kê nếu có.
 8. Dọn alias legacy DS (hậu C-076): sau mục 6-7 alias legacy chỉ còn khai báo trong apps/miniapp/src/css/tokens.css. Xoá khối "LEGACY v1 → v2 ALIAS" (kể cả --dealer-* vì dealer đã dùng css/dealer-theme.css) khỏi tokens.css; giữ các biến NGOÀI khối đó còn dùng (--safe-top, --dur-*, --font-body, --radius-lg, --shadow-card... kiểm bằng lint:vars và grep; nếu tên nằm trong regex LEGACY của scripts/uiux/static-scan.mjs mà còn dùng thì thay chỗ dùng bằng token v2). Thêm guard spec apps/miniapp/src/ds-no-legacy-aliases.spec.ts quét MỌI file src/**/*.{ts,tsx,css} (trừ *.spec.*): cấm var(--neutral-*, --primary-*, --leaf-*, --sun-*, --success/warning/danger/info(-bg), --radius-sm/md/xl/full, --shadow-xs/sm/md/lg, --dealer-*, --clay-200/800) và hex/rgb thô, với danh sách ngoại lệ NHỎ, có chú thích lý do (css/dealer-theme.css, utils/storefront-theme.ts mã màu CTV chọn, định nghĩa token). Chạy: node scripts/check-undefined-css-vars.mjs (phải OK), node scripts/uiux/static-scan.mjs (miniapp legacy=0), npx eslint miniapp (0 lỗi/0 cảnh báo), vitest miniapp các spec ds-*.
Thuật ngữ Q-26: "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước"; không thêm chữ "TubuXu" mới.`,
    items: [
      { k: 'i1', c: 'C-044', model: 'sonnet', scope: 'Mục 1 (Season Pass) và mục 4 (cashback khỏi hub).' },
      { k: 'i2', c: 'C-010', model: 'sonnet', scope: 'Mục 2 (đổi chữ "cây thật" toàn repo) và mục 3 (perk hạng không có quy trình, kèm migration UPDATE idempotent + seed + test migration trên Postgres không cần: chỉ kiểm SQL bằng đọc, nếu cần DB dùng container tubu_it_main cổng 5550).' },
      { k: 'i3', c: 'C-096', model: 'sonnet', scope: 'Mục 5 (/merchant), mục 6 (xoá /beta), mục 7 (xoá ui/primitives.tsx).' },
      { k: 'i4', c: 'C-076', model: 'sonnet', scope: 'Mục 8 (dọn alias legacy + guard toàn cục) + hoàn thiện báo cáo gói (bảng bằng chứng perk, danh sách chuỗi đã đổi, giả định, việc cần chủ dự án).' },
    ],
  },
  {
    id: 'PD-2', port: 5582, rm: 'opus', twoPass: true,
    lens: 'Đây là gói DỌN LOGIC TRÙNG + GỠ ENDPOINT/KHOÁ CHẾT (khó hoàn tác trên PROD) + sửa luật đánh giá có thưởng điểm. Kiểm kỹ: (1) helper gom lại giữ ĐÚNG hành vi từng bản sao (mã đơn: định dạng ngày, độ dài, tiền tố, tính duy nhất; maskName; chuẩn hoá SĐT 84/+84/0; dayKey múi giờ VN vs UTC) — tự dựng input biên (23:59/00:01 giờ VN, SĐT có dấu cách/+84) so bản cũ và mới; (2) mỗi endpoint bị gỡ có đủ bằng chứng (không có lời gọi trong miniapp/web ở HEAD VÀ commit PROD cb92dc8, không phải callback/webhook/cron/script/e2e/loadtest/ops) — endpoint nghi ngờ mà bị gỡ = blocker; endpoint công khai cho bên ngoài bị gỡ = blocker; (3) bảng/cột chỉ đánh dấu deprecated, không DROP, không migration phá dữ liệu; (4) Q-30: race không thưởng điểm hai lần, sửa đánh giá không cộng điểm, đánh giá của người khác không sửa được (IDOR), đánh giá cần đơn đã giao như luật hiện hành; (5) test không bị xoá/nới lỏng vô cớ.',
    spec: `GÓI PD-2 — Dọn logic trùng, endpoint/khoá/bảng chết (API) + luật đánh giá Q-30. KHÔNG đổi hành vi nghiệp vụ trừ mục i4; KHÔNG DROP bảng/cột; KHÔNG xoá dữ liệu. Đọc docs/2026-10-review/00-ROADMAP.md mục 6 và 9, findings-catalog.md dòng C-040, C-054, C-098, C-099, C-108, C-110 và impl/PC-8.md (C-054 đã xử lý một phần), impl/PA-7.md (Q-31).
File sở hữu: apps/api/src/common/**, apps/api/src/modules/** (mọi module, chỉ phần liên quan mục), apps/api/prisma/schema.prisma (CHỈ chú thích /// @deprecated, không đổi cấu trúc), apps/api/prisma/seed.ts (khoá config chết), apps/miniapp/src/components/reviews-section.tsx + services review (chỉ mục i4), spec tương ứng. DB test: container tubu_it_pd2 cổng 5582, DATABASE_URL=postgresql://tubu:tubu@localhost:5582/tubutree_it?schema=public (đã migrate 123/123). Race spec: trong apps/api chạy DATABASE_URL=... npx jest -c test/integration-race/jest.config.js --runInBand <file> (một spec/lần, chạy lại các race spec của module bị đụng).
Các mục:
 1. C-040 gom helper trùng về apps/api/src/common/: (a) sinh mã đơn x4 (checkout.service.ts ~621-632, dealer.service.ts ~1426-1433, subscriptions, affiliate...), (b) maskName x4, (c) notifyAdminsOf x3, (d) chuẩn hoá SĐT x3, (e) dayKey giờ VN x7 (có thể đã có helper: grep). Mỗi nhóm: viết test đặc tả (characterization, xanh trên bản cũ) cho TỪNG bản sao TRƯỚC khi gom, liệt kê khác biệt giữa các bản; bản sao khác hành vi (vd ymd UTC vs VN ở mã đơn) thì KHÔNG ngầm thống nhất: giữ hành vi từng chỗ qua tham số, hoặc nếu là lỗi thì ghi "Hành vi khác nhau" trong báo cáo và chọn cách an toàn (không đổi định dạng mã đơn đang chạy; tính duy nhất giữ nguyên). Sau gom: grep lệnh của C-040 chỉ còn định nghĩa trong common/. Chạy lại spec + race spec của module đụng (checkout, dealer, subscriptions, affiliate, game).
 2. C-108 + C-054 + C-099: đánh dấu bảng/cột chết/chỉ ghi không đọc bằng chú thích /// @deprecated trong schema.prisma (CohortRepeatSnapshot, FunnelDailySnapshot, BetaFeedback, cột dauEventBased, badgeImageUrl, pancakeCustomerId nếu đúng chết: tự grep xác minh từng cái, KHÔNG DROP; chạy npx prisma validate + prisma format không đổi cấu trúc, migrate diff phải "No difference"); bảng chết ghi vào báo cáo. C-054: khoá config chết còn sót sau PC-8 (grep từng khoá: 0 nơi đọc ngoài seed/spec) gỡ khỏi whitelist sửa được ở system-config và khỏi seed mới (KHÔNG xoá giá trị trong DB). C-099/Q-31: xác nhận chỉ một khoá cửa sổ giới thiệu được đọc (PA-7 đã đặt 7 ngày cấu hình), khoá còn lại (last_click_window_days) gỡ như khoá chết.
 3. C-098 gỡ endpoint không FE nào gọi (khoảng 19 endpoint: faqs, issue-invoice, redeem-points, status-history...; danh sách gốc ở docs/2026-10-review/01-pm.md mục A1-042, tự dựng lại bằng scripts/uiux/extract-endpoints.mjs hoặc grep). Điều kiện gỡ BẮT BUỘC cho từng endpoint (ghi BẢNG BẰNG CHỨNG trong báo cáo: endpoint | grep HEAD | grep cb92dc8 | callback/cron/script/e2e | quyết định): (1) không có lời gọi trong apps/miniapp/src và apps/web/src (cả admin, merchant) ở HEAD VÀ ở commit PROD cb92dc8 (git grep cb92dc8 -- apps/web/src apps/miniapp/src); (2) không phải callback/webhook/cron của bên ngoài (Pancake, ZaloPay, ZNS, Gomdon, POS, healthcheck, sitemap); (3) không có e2e/loadtest/script/ops gọi (apps/e2e, scripts, ops); (4) không phải endpoint admin dùng công cụ ngoài. Thiếu bằng chứng hoặc nghi ngờ => KHÔNG gỡ, ghi "giữ" + lý do. Gỡ = xoá handler + DTO + method service chết + spec, giữ method nếu nơi khác còn dùng. Mỗi nhóm endpoint cùng module một commit.
 4. C-110/Q-30 đánh giá: mỗi người một đánh giá cho mỗi sản phẩm (giữ unique), khi đã có đánh giá thì gọi tạo lại (mua lại) SỬA đánh giá cũ (sao, nội dung, ảnh) thay vì lỗi; thưởng Điểm Xanh CHỈ lần đầu (sửa không thưởng; chạy song song cũng đúng một lần). Quyền: chỉ chủ đánh giá sửa được; luật điều kiện đã mua/giao như hiện hành. Race spec Postgres thật: 2 request tạo đồng thời cùng user+SP => đúng 1 đánh giá, đúng 1 lần thưởng; sửa không đổi số điểm. Miniapp reviews-section: hiện "Sửa đánh giá của bạn" khi đã có, form điền sẵn (giữ DS v2 như PC-10c3 vừa di cư).
Thuật ngữ Q-26 như mọi gói. Không thêm luồng xu mới (PD-3 sẽ gộp TubuXu vào Điểm Xanh).`,
    items: [
      { k: 'i1', c: 'C-040', model: 'sonnet', scope: 'Mục 1 (gom helper trùng) — mã đơn, SĐT, dayKey.' },
      { k: 'i2', c: 'C-040', model: 'sonnet', scope: 'Mục 1 phần còn lại (maskName, notifyAdminsOf) + mục 2 (đánh dấu deprecated, khoá config chết, C-099).' },
      { k: 'i3', c: 'C-098', model: 'sonnet', scope: 'Mục 3 (gỡ endpoint không ai gọi, có bảng bằng chứng).' },
      { k: 'i4', c: 'C-110', model: 'sonnet', scope: 'Mục 4 (đánh giá Q-30, race spec) + hoàn thiện báo cáo gói (bảng endpoint giữ/gỡ, bảng khác biệt hành vi helper, bảng deprecated, giả định).' },
    ],
  },
]

function ctx(p) {
  const wt = WT(p.id)
  const db = p.port ? `DB TEST RIÊNG của gói: container tubu_it_${p.id.toLowerCase().replace('-', '')} cổng ${p.port} (đã migrate 123/123): DATABASE_URL=postgresql://tubu:tubu@localhost:${p.port}/tubutree_it?schema=public. Container tắt thì docker start <tên>; mất thì docker run -d --name <tên> -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${p.port}:5432 postgres:16-alpine rồi npx prisma migrate deploy. KHÔNG ghi vào DB khác.` : 'Gói này không cần Postgres (nếu cần: container tubu_it_main cổng 5550, DATABASE_URL=postgresql://tubu:tubu@localhost:5550/tubutree_it).'
  return `
BỐI CẢNH: Tubu Tree, monorepo pnpm + Turborepo (apps/api NestJS+Prisma, apps/web Next.js, apps/miniapp Zalo Mini App, apps/e2e Playwright, packages/*). macOS, shell zsh.
MÃ GÓI: ${p.id}. Bạn làm việc trong git worktree CỐ ĐỊNH của gói: ${wt} (nhánh ${BR(p.id)}, tách từ hardening/2026-10 commit ${BASE}). MỌI lệnh shell bắt đầu bằng: export PATH=${NODEBIN}:$PATH; cd ${wt} && ... (bắt buộc Node 22; shell không nhớ biến giữa các lệnh). MỌI đường dẫn Read/Edit/Write nằm dưới ${wt}. Repo chính ${REPO} là của điều phối viên: KHÔNG sửa gì ở đó.
MÁY CÓ THỂ SẬP: thay đổi chưa commit sẽ MẤT. Commit NGAY khi một bước đã xanh (git add <file cụ thể>, không dùng git add -A), commit sớm, commit nhiều. Đầu mỗi lượt chạy: git status + git log --oneline ${BASE}..HEAD để biết lần trước làm tới đâu; mục đã có commit và test xanh thì chỉ xác nhận (chạy lại lệnh kiểm) rồi trả kết quả, đừng làm lại; có thay đổi dở thì xem diff, hoàn thiện rồi commit.
TÀI LIỆU: docs/2026-10-review/HANDOFF.md, 00-ROADMAP.md (mục 6 Đợt D, mục 9 = quyết định chủ dự án, BẮT BUỘC tuân theo), findings-catalog.md (dòng C-xxx), báo cáo gốc 01-pm.md, 02-arch-data.md, 04-uiux.md, impl/*.md các gói đã xong.
MÔI TRƯỜNG: node_modules thật trong worktree, packages/shared-types/dist, Prisma client đã dựng. ${db}
QUY TRÌNH:
 - TDD: viết test thấy ĐỎ rồi sửa cho XANH; refactor giữ hành vi thì viết test đặc tả (xanh trên bản cũ) TRƯỚC. Lỗi tiền/race: race spec apps/api/test/integration-race/<tên>.race-spec.ts trên Postgres thật.
 - Mỗi mục một commit nhỏ trở lên. Message: "<type>(<scope>): <mô tả> (C-xxx)", dòng trống, rồi đúng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
 - Migration: chỉ file SQL idempotent, an toàn dữ liệu PROD, áp thử bằng npx prisma migrate deploy lên Postgres test của gói; KHÔNG DROP/DELETE dữ liệu.
 - Comment code chỉ giải thích "vì sao" không hiển nhiên, không kể lại thay đổi. Giữ phong cách code xung quanh.
 - Test: chỉ spec liên quan (miniapp/web: npx vitest run <đường dẫn spec>, KHÔNG dùng --maxWorkers; api: npx jest <spec> --maxWorkers=1; race: --runInBand một file). KHÔNG chạy full suite, KHÔNG Playwright, KHÔNG dev server (máy 15,5GB RAM, chỉ 1 job nặng một lúc, điều phối viên chạy). Được chạy tsc --noEmit của app bị sửa và ESLint file đã sửa.
 - CẤM: git stash/reset/checkout/restore/rebase/push/merge/cherry-pick/switch; git worktree remove; deploy; đụng PROD; gọi dịch vụ ngoài thật; sửa file ngoài nhóm file của gói (buộc phải thì giữ tối thiểu và ghi lý do).
 - Nghiệp vụ không rõ: chọn phương án an toàn nhất (không đổi hành vi, không mất dữ liệu), ghi vào "Giả định".
BÁO CÁO: ghi/append mục của bạn vào docs/2026-10-review/impl/${p.id}.md trong worktree và commit: từng mục (XONG / MỘT PHẦN / BỎ + lý do), test thêm (đỏ -> xanh), lệnh kiểm chứng + vài dòng output thật, migration, giả định, việc còn lại, "Việc cần chủ dự án".
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

function itemPrompt(p, it, idx, n) {
  return `${ctx(p)}
GÓI ${p.id} — MỤC ${idx + 1}/${n} (${it.c}).
TOÀN BỘ ĐẶC TẢ GÓI (để hiểu ngữ cảnh):
${p.spec}

PHẠM VI CỦA LƯỢT NÀY (chỉ làm phần này; các mục khác do lượt khác làm và có thể đã commit trong worktree): ${it.scope}
Trả về StructuredOutput: status (DONE/PARTIAL/SKIPPED/BLOCKED), head = git rev-parse HEAD sau commit cuối, note <= 8 dòng, tests [{cmd, result}] (lệnh đã chạy + kết quả thật), migrations (tên thư mục nếu có).`
}

function reviewPrompt(p, round) {
  const wt = WT(p.id)
  const cname = 'tubu_it_' + p.id.toLowerCase().replace('-', '') + '_r' + round
  const rport = (p.port || 5590) + 100 * round
  return `Bạn là REVIEWER ĐỘC LẬP (lượt ${round}) cho gói ${p.id} của đợt hardening Tubu Tree. Bạn KHÔNG nhận kết luận của người làm — tự đọc diff và code, tự chạy lại lệnh đo.
Môi trường: mọi lệnh shell bắt đầu bằng export PATH=${NODEBIN}:$PATH; cd ${wt} && ... Worktree: ${wt} (nhánh ${BR(p.id)}). Base: ${BASE}. Xem: git -C "${wt}" log --oneline ${BASE}..HEAD ; git -C "${wt}" diff ${BASE}..HEAD -- . ':!docs/2026-10-review/impl' (impl/*.md là lời tự báo, không phải bằng chứng).
YÊU CẦU CỦA GÓI:
${p.spec}
Quyết định chủ dự án: docs/2026-10-review/00-ROADMAP.md mục 9.
TRỌNG TÂM RIÊNG CỦA GÓI NÀY: ${p.lens}
Nhiệm vụ: tìm lỗi THẬT trong diff — sai yêu cầu/quyết định, đổi hành vi ngoài mục tiêu, mất chức năng, lỗ hổng (tiền, auth/IDOR, dữ liệu), race/transaction, migration không an toàn với dữ liệu có sẵn, test không kiểm điều nó tuyên bố (mock che lỗi, assert yếu), thiếu test nhánh quan trọng, hồi quy luồng khác (grep nơi gọi). Với mỗi nghi ngờ truy 2-3 input cụ thể qua code. Được chạy test liên quan (npx jest <spec> --maxWorkers=1 trong apps/api; vitest <file> trong apps/miniapp|web; race spec cần Postgres: docker run -d --name ${cname} -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${rport}:5432 postgres:16-alpine, npx prisma migrate deploy, chạy, rồi docker rm -f ${cname}), tsc, eslint. KHÔNG sửa code, KHÔNG git ghi, KHÔNG chạy full suite/Playwright/dev server.
Phân loại: blocker (sai tiền/bảo mật/mất dữ liệu/gỡ nhầm thứ đang dùng/làm hỏng luồng chính), major (sai yêu cầu, thiếu test quan trọng, race có thể xảy ra, đổi hành vi ngoài mục tiêu), minor (còn lại). Verdict CHANGES nếu có blocker hoặc major.
Trả về StructuredOutput: verdict, findings [{severity, file, line, issue, fix}], summary <= 8 dòng (kèm kết quả lệnh đo thật).`
}

function fixPrompt(p, review, round) {
  return `${ctx(p)}
SỬA THEO REVIEW lượt ${round} cho gói ${p.id}. Làm TRỰC TIẾP trong worktree ${WT(p.id)}.
YÊU CẦU GÓI:
${p.spec}
FINDINGS của reviewer độc lập (JSON):
${JSON.stringify(review.findings, null, 1)}
Với mỗi blocker/major: xác minh lại (reviewer có thể sai — nếu sai, giải thích bằng bằng chứng trong báo cáo, không sửa mù); nếu đúng: test đỏ trước rồi sửa, commit riêng "fix(<scope>): address review <ngắn> (C-xxx)". Minor: sửa nếu rẻ và an toàn. Cập nhật docs/2026-10-review/impl/${p.id}.md mục "Review lượt ${round}" (từng finding: đã sửa / không sửa + lý do) và commit.
Trả về StructuredOutput: status, head, note, tests, migrations.`
}

phase('Implement')
log('Base ' + BASE + '; ' + PKGS.length + ' gói trong worktree cố định hz8-*, tối đa ' + (args.maxAgents || 2) + ' agent cùng lúc ở workflow này; resume được sau sập máy')

const results = await pipeline(
  PKGS,
  async (p) => {
    const items = []
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i]
      const r = await run(itemPrompt(p, it, i, p.items.length), { label: 'impl:' + p.id + ':' + it.k, phase: 'Implement', model: it.model, schema: ITEM_SCHEMA })
      items.push({ c: it.c, k: it.k, status: r ? r.status : 'FAILED', note: r ? r.note : 'agent null', head: r && r.head, tests: r && r.tests, migrations: r && r.migrations })
    }
    const r1 = await run(reviewPrompt(p, 1), { label: 'review1:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    let fix1 = null, r2 = null, fix2 = null, r3 = null
    if (r1 && r1.verdict === 'CHANGES') {
      fix1 = await run(fixPrompt(p, r1, 1), { label: 'fix1:' + p.id, phase: 'Fix', model: 'sonnet', schema: ITEM_SCHEMA })
      r2 = await run(reviewPrompt(p, 2), { label: 'review2:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    } else if (p.twoPass) {
      r2 = await run(reviewPrompt(p, 2), { label: 'review2:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    }
    if (r2 && r2.verdict === 'CHANGES') {
      fix2 = await run(fixPrompt(p, r2, 2), { label: 'fix2:' + p.id, phase: 'Fix', model: 'sonnet', schema: ITEM_SCHEMA })
      r3 = await run(reviewPrompt(p, 3), { label: 'review3:' + p.id, phase: 'Review', model: p.rm, effort: 'high', schema: REVIEW_SCHEMA })
    }
    return { id: p.id, items, r1, fix1, r2, fix2, r3 }
  },
)

return results.map(r => r && ({
  id: r.id,
  worktree: WT(r.id), branch: BR(r.id),
  items: r.items.map(i => ({ c: i.c, k: i.k, status: i.status, head: i.head, note: i.note, migrations: i.migrations })),
  review1: r.r1 && (r.r1.verdict + ' (' + r.r1.findings.length + ' findings): ' + r.r1.summary),
  fix1: r.fix1 && { status: r.fix1.status, head: r.fix1.head, note: r.fix1.note },
  review2: r.r2 && { verdict: r.r2.verdict, open: r.r2.findings.filter(f => f.severity !== 'minor'), summary: r.r2.summary },
  fix2: r.fix2 && { status: r.fix2.status, head: r.fix2.head, note: r.fix2.note },
  review3: r.r3 && { verdict: r.r3.verdict, open: r.r3.findings.filter(f => f.severity !== 'minor'), summary: r.r3.summary },
}))
