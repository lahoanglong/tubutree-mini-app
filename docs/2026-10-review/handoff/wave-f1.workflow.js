export const meta = {
  name: 'tubutree-2026-10-wave-f1',
  description: 'Xử các bug còn lại: PF-1 a11y/ngữ nghĩa miniapp, PF-2 hành vi miniapp, PF-3 điểm + cấu hình API (hai lượt review), PF-4 web; mỗi gói một worktree, review opus',
  phases: [
    { title: 'Implement', detail: 'mỗi gói một agent trong worktree hz16-<gói>' },
    { title: 'Review', detail: 'reviewer opus độc lập chỉ đọc diff' },
    { title: 'Fix', detail: 'sửa theo review, review lượt 2 cho gói điểm/tiền' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const BASE = '0c481225'
const WT = (id) => ROOT + '/.claude/worktrees/hz16-' + id
const BR = (id) => 'hz16/' + id

function sem(max) {
  let active = 0
  const waiters = []
  return {
    async acquire() { if (active < max) { active++; return } await new Promise(r => waiters.push(r)) },
    release() { const w = waiters.shift(); if (w) w(); else active-- },
  }
}
const TOTAL = sem(3)
async function run(prompt, opts) {
  await TOTAL.acquire()
  try { return await agent(prompt, opts) } finally { TOTAL.release() }
}

const COMMON = `Quy tắc bất biến:
- Chỉ làm việc trong worktree của gói (đường dẫn ở trên), nhánh riêng. KHÔNG push, KHÔNG deploy, KHÔNG ghi PROD hay DB dùng chung. KHÔNG git stash/reset/checkout file không phải của mình, không đụng worktree khác hay thư mục gốc repo. Chỉ sửa file thuộc "Nhóm file" của gói; thấy lỗi ở file ngoài nhóm thì ghi vào báo cáo, không sửa (các gói khác đang làm song song, sửa chồng sẽ gây xung đột merge).
- Mọi lệnh shell bắt đầu bằng: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
- Việc đầu tiên: cd vào worktree, pnpm install --frozen-lockfile, pnpm --filter @tubutree/shared-types build, và nếu gói đụng API: (cd apps/api && npx prisma generate). Không có timeout trên macOS: dùng until-loop hoặc chạy nền.
- TDD: viết test đỏ trước, thấy đỏ đúng lý do, rồi sửa cho xanh. Lỗi nào không viết được test tái hiện thì nói rõ vì sao và cách đã kiểm. Từng mục một commit riêng. Commit message tiếng Việt văn xuôi thường, kết thúc bằng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Mục nào xác minh trên mã thấy KHÔNG phải lỗi (đã sửa từ trước, hay không tái hiện): ghi bằng chứng vào báo cáo, không sửa mã không lỗi.
- Comment trong code chỉ giải thích "vì sao" không hiển nhiên, không tả thay đổi vừa làm. Không ghi "chủ dự án nói" vào file. Thuật ngữ Q-26: "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước". Component DS v2 sẵn có (apps/miniapp/src/components/ui, packages/design-tokens); vùng chạm >=44px; ESLint tubu-ds của file đã sửa phải 0 lỗi (--max-warnings=0).
- Docker (nếu cần Postgres cho race spec): docker run -d --rm --name <tên> --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p <cổng>:5432 postgres:16-alpine ; DB tên tubutree_it; chạy prisma migrate deploy trước; kết thúc docker rm -f -v <tên>. Không pkill rộng; chỉ kill listener cổng của mình (lsof -ti tcp:<cổng> -sTCP:LISTEN | xargs kill).
- Chạy kiểm CHỈ phạm vi gói: tsc --noEmit package đã sửa, ESLint file đã sửa, test (jest/vitest) của file/module đã sửa, race spec nếu có. KHÔNG chạy Playwright e2e hay full suite (điều phối viên chạy). Phần chưa chạy ghi "unverified".
- Viết báo cáo docs/2026-10-review/impl/<GÓI>.md trong worktree (văn xuôi tiếng Việt ngắn: từng mục → làm gì / không phải lỗi / không làm được, quyết định thiết kế, lệnh kiểm và kết quả thật, chưa verify, rủi ro) và commit.
- Kết quả cuối: trả đúng schema kèm lệnh đã chạy và exit code thật. Không báo "xong" nếu chưa chạy lại lệnh.`

const CAPTURE = `Công cụ đo a11y/ảnh: scripts/uiux/capture.mjs (axe tích hợp). Cách dùng: node scripts/uiux/capture.mjs <miniapp|web> --only <regex id route> --vp 390 --states normal [--force]; ghi scripts/uiux/results/<app>.jsonl và ảnh vào docs/2026-10-review/screens/ (thư mục bị gitignore). Cần API ở cổng 3001 (pnpm --filter @tubutree/api dev, DB dev tubutree trên localhost:5434 đã migrate+seed; cấu hình DATABASE_URL lấy từ apps/api/.env), miniapp 3113 (pnpm --filter @tubutree/miniapp dev), web 3112 (pnpm --filter @tubutree/web dev). Đọc scripts/uiux/routes.mjs để biết id route. Chỉ MỘT gói chạy capture tại một thời điểm (điều phối viên đã xếp lịch): đúng, bạn là gói đó. Đo TRƯỚC khi sửa (lưu kết quả axe theo route vào file tạm ngoài repo để so sánh) và SAU khi sửa, báo số vi phạm serious/critical từng route trước/sau. Tắt server khi xong.`

const PKGS = {
  'PF-1': { id: 'PF-1', twoPass: false, port: 5601,
    spec: `GÓI PF-1 — Miniapp: a11y và ngữ nghĩa (không đổi hành vi nghiệp vụ).
Danh sách bug (nguồn: docs/2026-10-review/99-release-readiness.md mục 6, 04-uiux.md, findings-catalog.md C-114/C-077):
1. axe serious/critical còn lại trên miniapp: \`nested-interactive\` ở checkout, feed, orders (nút/liên kết lồng trong phần tử tương tác khác: tách để mỗi thứ là một điều khiển riêng, giữ nguyên bố cục và hành vi); \`scrollable-region-focusable\` ở brand-view, product-detail (vùng cuộn ngang cần focus được bằng bàn phím: tabIndex/role/aria-label hợp lệ hoặc dùng ScrollRow có sẵn); \`target-size\` ở brand-story (vùng chạm dưới 24px/44px).
2. C-114: thiếu <main> và <h1> ở phần lớn trang miniapp (axe landmark-one-main, page-has-heading-one): sửa ở components/ui/page-header.tsx và layout gốc để mỗi route có đúng một main và một h1 (kiểm trang nào PageHeader không dùng).
3. Hàng địa chỉ thiếu keyboard props (dùng rowKeyboardProps có sẵn ở components/ui).
4. TimeInput trùng tên truy cập "Giờ" trong pages admin.tsx và staff.tsx (miniapp): mỗi ô cần nhãn phân biệt ("Giờ bắt đầu"/"Giờ kết thúc" hoặc theo ngữ cảnh), kèm cập nhật test/selector e2e phụ thuộc (grep apps/e2e).
Mỗi sửa có test vitest bắt hồi quy khi khả thi (Testing Library: không có button trong button/a, role và name đúng, aria-label phân biệt).
${CAPTURE}
Với mục 2: chạy capture miniapp TẤT CẢ route một lần trước và một lần sau (--vp 390 --states normal), báo số route còn vi phạm landmark-one-main/page-has-heading-one trước/sau, và toàn bộ vi phạm serious/critical còn lại sau khi sửa (liệt kê, kể cả cái không sửa được và lý do).
Nhóm file: apps/miniapp/src/pages/{checkout,feed,orders,brand-view,product-detail,brand-story,address,admin,staff}* (và các file con của chúng), apps/miniapp/src/components/{ui,feed,checkout,address,brand}/** , apps/miniapp/src/css/**, apps/e2e/tests/** (chỉ cập nhật selector bị đổi). KHÔNG sửa pages home, browse, search, game, loyalty, wallet và các service (gói PF-2 làm song song).` },
  'PF-2': { id: 'PF-2', twoPass: false, port: 5602,
    spec: `GÓI PF-2 — Miniapp: hành vi và hiển thị (vitest, không chạy Playwright).
Danh sách bug (nguồn: docs/2026-10-review/HANDOFF.md mục 6, 99-release-readiness.md mục 6, impl/PC-2.md, PC-3.md, PC-9.md, PB-1.md):
1. PC-2: Home — khối lỗi/skeleton chớp mỗi 60 giây khi poll "giờ vàng" (refetch nền không được thay nội dung đang hiện bằng skeleton; chỉ skeleton ở lần tải đầu); \`retrying/isFetching\` là mã chết với React Query v5 (dọn, thay bằng cờ đúng); Browse: chạm chip không gọi setDraft(state.q) (ô tìm không phản ánh chip); kệ "Mua lại" (PC-3) mất im lặng khi làm mới lỗi còn dữ liệu cũ (giữ dữ liệu cũ hiển thị, báo lỗi nhẹ hoặc nút thử lại, không biến mất).
2. PC-9: \`formatVnd\` che giá rỗng/null thành "0đ" (giá thiếu phải hiện "—" hoặc ẩn, KHÔNG hiện 0đ; giá 0 hợp lệ vẫn là 0đ; rà mọi chỗ gọi để không đổi nghĩa); ngày dd/MM/yyyy chưa phủ hết ~12 chỗ \`toLocaleDateString\`/\`toLocaleString\` trực tiếp (dùng helper định dạng ngày có sẵn ở utils/format, thêm test chặn dùng toLocaleDateString trực tiếp nếu gọn); rà chữ "TubuXu"/"Tubu Xu"/"xu" còn hiển thị cho khách (đã có terminology.spec guard: kiểm guard phủ hết, bổ sung nếu sót).
3. Cảnh báo React "two children with the same key" ở trang loyalty và game (miniapp): tái hiện bằng vitest với dữ liệu có hình dạng THẬT của API (đọc DTO/response trong apps/api và seed: phần thưởng, hạng, nhiệm vụ, bảng xếp hạng có thể trùng code/tên/hạng bằng nhau), tìm .map dùng key không duy nhất (name, rank, index đơn thuần) và sửa bằng key ổn định (id/code + tiền tố) hoặc kết hợp; kèm test bắt console.error. Không tái hiện được thì ghi bằng chứng.
4. PB-1: \`/search/suggest\` trả [] cho dưới 2 ký tự trong khi ô chọn CTV/cộng đồng gọi từ 1 ký tự: phía miniapp chỉ gọi khi đủ 2 ký tự và hiện gợi ý "Nhập ít nhất 2 ký tự" (KHÔNG đổi API).
Nhóm file: apps/miniapp/src/pages/{home,browse,search,game,loyalty,wallet}* và file con, apps/miniapp/src/components/{home,browse,search,game,loyalty,reorder*,wallet}/**, apps/miniapp/src/utils/format*, apps/miniapp/src/services/** (chỉ client search/home nếu cần), test liên quan. Kệ "Mua lại": nếu nằm trong pages/orders* hoặc components/ui thì CHỈ sửa file riêng của kệ, ghi báo cáo nếu cần sửa file chung (gói PF-1 đang sửa orders, checkout, feed, components/ui). KHÔNG sửa pages checkout, orders, feed, brand-*, product-detail, admin, staff, address.` },
  'PF-3': { id: 'PF-3', twoPass: true, port: 5603,
    spec: `GÓI PF-3 — API: điểm Điểm Xanh, cấu hình, hạ tầng build/test (đụng điểm = tiền trả trước, sẽ bị review opus hai lượt). Đọc trước: impl/PE-1a.md, PE-3.md, PE-5.md (cơ chế hạn điểm, ghép lô thu hồi REVERSAL_RULES trong loyalty-expiry.service.ts).
Danh sách bug:
1. LoyaltyService.reverseOrderPoints (loyalty.service.ts): (a) không khoá dòng user (SELECT ... FOR UPDATE) trong transaction, trong khi cron hết hạn điểm khoá và tính lại sổ trong tx: dựng race test (reverse song song cron) chứng minh lệch nếu có, rồi khoá dòng user theo quy ước của các luồng điểm khác (buyTree, checkout); (b) khi lô ORDER_DELIVERED đã hết hạn và cron đã trừ POINTS_EXPIRED trước lúc huỷ/trả (xảy ra khi admin đặt loyalty.point_expire_months ngắn hơn cửa sổ đổi trả): thu hồi pointsEarned lần nữa là trừ hai lần. Chứng minh bằng race test (lùi createdAt/expiresAt như pe5-reversal-expiry.race-spec.ts). Sửa: chỉ thu hồi phần còn lại của lô (không bao giờ âm số dư, không đòi lại điểm đã tiêu), dùng sổ lô đã có; nếu thiết kế cho thấy không thể xảy ra hoặc đã đúng thì ghi bằng chứng và không sửa.
2. ReviewsService.remove: xoá đánh giá đã thưởng mà khách đã tiêu hết điểm có thể đẩy số dư âm (nguồn: impl/PD-2.md). Chứng minh bằng test trên Postgres thật; sửa để không bao giờ đẩy pointsBalance xuống dưới 0 (thu hồi tối đa phần còn lại, ghi rõ trong sổ), giữ nguyên các bất biến của PE-3 (REVIEW_DELETE ăn đúng lô REVIEW, không trừ hai lần khi lô đã hết hạn).
3. Khoá cấu hình loyalty.point_expire_months chưa có biên trong RANGES của system-config.service.ts (cấu hình 0/âm/quá lớn). Thêm biên 1..120 (số nguyên) kèm note tiếng Việt; kiểm giá trị seed/migration hiện có nằm trong biên và test từ chối giá trị ngoài biên.
4. Hạ tầng build/test: (a) apps/api/src/common/route-graph.ts chỉ dùng cho test nhưng bị nest build đưa vào dist: loại khỏi bản build (tsconfig.build.json exclude hoặc chuyển sang thư mục test) mà không làm hỏng các spec dùng nó (endpoint-inventory.spec, beta-removed.spec); (b) beta-removed-audit.spec.ts đọc file ngoài package, walk đi cả thư mục sinh ra/gitignore: bỏ qua results, .probe, generated; thêm vào turbo.json inputs của task test cho apps/api gồm scripts/audit/** và scripts/uiux/**; siết regex hai ca (seed gọi prisma tách dòng; khoá scorecard có nháy: /prisma\\s*\\.\\s*beta(Tester|Feedback)\\s*\\.\\s*(create|createMany|upsert)\\b/ chạy trên cả nội dung file, /^\\s*['"]?beta['"]?\\s*:\\s*\\[/m).
5. Gộp phiên khách (auth.service.ts đổi userId của dòng sổ điểm khi gộp tài khoản khách vào tài khoản chính) chưa có test với các dòng thu hồi ghép lô (ORDER_REVERSED, REVIEW_DELETE, REFERRAL_*_REVOKE): viết race test (gộp xong, chạy cron hết hạn, số dư không lệch, không trừ hai lần, findPointsLotDrift rỗng); sửa nếu phát hiện lỗi.
Nhóm file: apps/api/src/modules/{loyalty,reviews,system-config,wallet(chỉ đọc),auth(chỉ sửa nếu mục 5 chứng minh lỗi)}/**, apps/api/src/common/{route-graph*,beta-removed-audit.spec.ts,endpoint-inventory.spec.ts}, apps/api/tsconfig.build.json, turbo.json, apps/api/test/integration-race/** (spec mới). KHÔNG sửa checkout, order-reversal, schema.prisma/migration. Cổng Postgres race: 5603, container tên tubu_it_pf3.` },
  'PF-4': { id: 'PF-4', twoPass: false, port: 5604,
    spec: `GÓI PF-4 — Web: a11y và lỗi nhỏ (không đổi hành vi nghiệp vụ). Nguồn: 99-release-readiness.md mục 6, HANDOFF.md mục 6 (PC-7, PC-9), 04-uiux.md.
1. axe serious/critical trên web: \`select-name\` ở 7 màn admin/merchant (select thiếu nhãn truy cập: thêm aria-label/label gắn đúng), \`label\` ở 4 màn (input thiếu nhãn), \`target-size\` ở 2; web 3 trang thiếu h1 (C-114). Dùng scripts/uiux/capture.mjs web để đo trước/sau (xem hướng dẫn công cụ).
2. PC-7: link Content Kit \`/product/\` trả 404 trên web (đúng đường dẫn là /san-pham/<slug>; sửa nơi sinh link và test); ô tìm kiếm nháy (mount/unmount lại) trên host CTV (apps/web/src/app/s/** và site-header); khung "Đã nhận thanh toán" biến mất ngay sau khi hiện (giữ hiển thị cho tới khi khách thao tác hoặc rời trang, kiểm logic poll/clear).
3. PC-9: chữ "Nhập mã ưu đãi" còn ở web → "Mã giảm giá" (Q-26); rà chữ TubuXu/xu còn hiển thị cho khách ở web (thanh-toan, tai-khoan); ngày dd/MM/yyyy dùng helper chung thay toLocaleDateString trực tiếp ở web khách.
4. Cảnh báo React trùng \`key\` ở admin-config (web): tái hiện bằng vitest với dữ liệu hình dạng thật của API config (đọc DTO/seed; khoá cấu hình lặp, group trùng tên), sửa bằng key ổn định kèm test bắt console.error; không tái hiện được thì ghi bằng chứng.
${CAPTURE}
Nhóm file: apps/web/src/** (admin, merchant, khách), apps/web/src/lib/**, apps/e2e/tests/** (chỉ cập nhật selector bị đổi). KHÔNG sửa apps/api, apps/miniapp.` },
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, outcome: { type: 'string', enum: ['fixed', 'not-a-bug', 'not-reproduced', 'cannot-do', 'deferred'] }, evidence: { type: 'string' } }, required: ['item', 'outcome'] } },
    verification: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exitCode: { type: 'number' }, summary: { type: 'string' } }, required: ['command', 'exitCode', 'summary'] } },
    unverified: { type: 'array', items: { type: 'string' } },
  },
  required: ['commits', 'items', 'verification', 'unverified'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      file: { type: 'string' }, line: { type: 'number' },
      issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'file', 'issue', 'fix'] } },
    ranCommands: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'findings'],
}

const RESUME = `LƯU Ý TIẾP TỤC: lần chạy trước của gói này bị ngắt giữa chừng nên worktree có thể đã chứa commit (git log ${BASE}..HEAD) và file sửa dở (git status). Việc đầu tiên: đọc git log, git diff và git status của worktree để biết mục nào đã commit (không làm lại, kiểm lại bằng test của mục đó), mục nào đang sửa dở (hoàn thiện hoặc bỏ có chủ đích; KHÔNG git reset/stash/checkout), mục nào chưa làm. Dev server hay container của lần chạy trước đã bị dọn sạch (cổng 3001/3112/3113 và container tubu_it_pf3 trống). Báo cáo impl/<GÓI>.md nếu chưa có thì viết, nếu đã có thì cập nhật cho đủ mọi mục. Bảng items trong kết quả cuối phải phủ TẤT CẢ mục của gói, kể cả mục đã commit ở lần trước.`

function implPrompt(p) {
  return `Bạn là kỹ sư thực hiện gói ${p.id} của dự án Tubu Tree (hardening 2026-10).
Worktree của gói: ${WT(p.id)} (nhánh ${BR(p.id)}, base ${BASE}). Làm CHỈ trong đó. Cổng Postgres riêng của gói (nếu cần): ${p.port}.
${(p.id === 'PF-1' || p.id === 'PF-3') ? '\n' + RESUME + '\n' : ''}
${p.spec}

${COMMON}`
}

function reviewPrompt(p, round, prior) {
  const money = p.id === 'PF-3'
  return `Bạn là reviewer độc lập, chỉ đọc (không sửa file trong worktree, không commit). Review lượt ${round} gói ${p.id}.
Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Diff: git -C ${WT(p.id)} diff ${BASE}..HEAD. Đọc file đầy đủ quanh các chỗ đổi, không chỉ hunk.
Export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH trước mọi lệnh. Bạn được chạy test của phạm vi gói (jest/vitest/tsc/eslint). ${money ? `Nếu cần Postgres: docker run -d --rm --name tubu_rv_pf3_${round} --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${5610 + round}:5432 postgres:16-alpine, migrate deploy, rồi docker rm -f -v khi xong.` : 'KHÔNG chạy capture/Playwright/trình duyệt (việc nặng điều phối viên đã xếp lịch); chỉ đọc mã và chạy vitest/tsc/eslint của phạm vi gói.'} Không push, không đụng worktree khác, không pkill rộng.
Mục tiêu gói:
${p.spec}
${money ? `Đây là gói đụng điểm (tiền trả trước): tấn công nó. Với từng mục: bản sửa có thật sự đúng không, có mở lỗi mới (số dư âm, trừ hai lần, lệch lô, deadlock do thứ tự khoá, giữ khoá lâu), test có thể xanh dù mã sai không (kiểm đột biến: bỏ bản sửa xem test có đỏ), mục nào tác giả báo "không phải lỗi/không tái hiện" có bằng chứng đủ không (tự kiểm lại). Dựng test/lệnh thật khi có thể; finding chỉ "có vẻ" thì ghi chưa chứng minh.` : `Tìm: hồi quy hành vi ngoài mục tiêu, test yếu (xanh dù mã sai: kiểm đột biến bằng cách bỏ bản sửa), mục báo "fixed" mà mã không thật sự giải quyết lỗi, mục báo "not-a-bug" thiếu bằng chứng, vi phạm luật tubu-ds/thuật ngữ Q-26, file sửa ngoài nhóm file của gói.`}
${prior ? `Lượt trước có các finding sau; kiểm từng cái đã sửa thật chưa (chạy lại test chứng minh) và tìm vấn đề mới do bản sửa:\n${JSON.stringify(prior)}` : ''}
Mặc định nghi ngờ; chỉ gắn blocker/major khi có bằng chứng cụ thể (file:line hoặc lệnh). Ghi lệnh đã chạy vào ranCommands.`
}

const FIX_HINT_PF3 = `GỢI Ý THIẾT KẾ của điều phối viên cho hai blocker của review lượt 1 (xác minh trên mã trước, được chọn cách khác nếu có bằng chứng tốt hơn):
- Blocker 1 (vòng lặp farm điểm đánh giá: tạo +15, tiêu hết bằng một đơn COD, xoá thì thu hồi 0, tạo lại +15): gốc rễ là điểm thưởng đánh giá bị cấp lại sau khi xoá. Quyết định Q-30 là "thưởng điểm lần đầu": điểm thưởng đánh giá chỉ cấp MỘT lần cho mỗi (user, sản phẩm) kể cả khi xoá rồi tạo lại. Kiểm xem tạo lại sau xoá hiện có cấp lại không (khoá unique/ledger REVIEW:<slug>); nếu có thì đóng lỗ hổng ở đó và chứng minh bằng test vòng lặp (3 vòng tạo/tiêu/xoá chỉ nhận thưởng đúng một lần). Nếu cách đó đổi hành vi hợp lệ của khách (xoá khi điểm chưa tiêu vẫn phải thu hồi đúng phần còn lại, không âm số dư), giữ phần đó.
- Blocker 2 (lotRemaining replay FIFO coi điểm tiêu từ lô KHÁC là đã tiêu từ lô đơn khi lô đơn cũ nhất, trong khi lockedOrderPoints đảm bảo trong cửa sổ đổi trả số dư luôn đủ để thu hồi): chỉ coi phần điểm của lô đơn là "đã mất" khi nó đã bị cron trừ vì HẾT HẠN (lô có expiresAt <= bây giờ và POINTS_EXPIRED đã phủ), KHÔNG coi là mất khi bị FIFO ăn bởi chi tiêu. Trần theo số dư hiện có chỉ dùng như lưới an toàn cuối, tính SAU khi đã cộng phần hoàn điểm tiêu (ORDER_REFUND_POINTS) trong cùng transaction.
- Dòng thu hồi delta 0 không được ghi vào sổ điểm (không hiện trong lịch sử khách) trừ khi cần cho idempotency; nếu cần giữ dòng 0 cho idempotency thì chặn nó khỏi API lịch sử điểm của khách.`

function fixPrompt(p, findings) {
  return `Bạn đang sửa gói ${p.id} theo review độc lập. Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Làm CHỈ trong đó, và chỉ file thuộc Nhóm file của gói (spec gói ở dưới).
Các finding (blocker/major bắt buộc sửa; minor sửa nếu rẻ và an toàn, còn lại ghi lý do bỏ trong báo cáo):
${JSON.stringify(findings, null, 2)}
Với mỗi finding: xác minh trên mã trước (reviewer có thể sai; nếu sai ghi bằng chứng, không sửa), viết test đỏ nếu là lỗi hành vi, sửa, commit riêng. Cập nhật docs/2026-10-review/impl/${p.id}.md (mục "Sau review") và commit.
Cổng Postgres riêng của gói (nếu cần): ${p.port}.
${p.id === 'PF-3' ? FIX_HINT_PF3 : ''}
${p.spec}

${COMMON}`
}

async function flow(p) {
  try {
    const impl = await run(implPrompt(p), { label: 'impl:' + p.id, phase: 'Implement', schema: IMPL_SCHEMA, model: 'sonnet' })
    if (!impl) return { id: p.id, error: 'implement agent trả null' }
    const r1 = await run(reviewPrompt(p, 1, null), { label: 'review1:' + p.id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
    const blocking = r1 ? r1.findings.filter(f => f.severity !== 'minor') : []
    let fix = null, r2 = null
    if (r1 && r1.findings.length > 0 && (blocking.length > 0 || p.twoPass)) {
      fix = await run(fixPrompt(p, r1.findings), { label: 'fix:' + p.id, phase: 'Fix', schema: IMPL_SCHEMA, model: 'sonnet' })
    }
    if (p.twoPass || blocking.length > 0) {
      r2 = await run(reviewPrompt(p, 2, r1 ? r1.findings : null), { label: 'review2:' + p.id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
    }
    return { id: p.id, branch: BR(p.id), worktree: WT(p.id), impl, review1: r1, fix, review2: r2 }
  } catch (e) {
    return { id: p.id, error: String(e) }
  }
}

phase('Implement')
const f1 = flow(PKGS['PF-1'])
const f2 = flow(PKGS['PF-2'])
const f3 = flow(PKGS['PF-3'])
// PF-4 cũng chạy capture (Chromium, cổng 3001/3112/3113): chờ PF-1 xong để không hai gói cùng chiếm cổng và trình duyệt.
const f4 = f1.then(() => flow(PKGS['PF-4']))
const out = await Promise.all([f1, f2, f3, f4])
return out
