export const meta = {
  name: 'tubutree-2026-10-wave-f4',
  description: 'Đợt F4: PF-6a nợ API điểm (đọc cấu hình ngoài transaction cho lockedOrderPoints, creditPoints chỉ cộng; review opus hai lượt) và PF-6b miniapp (kiểu createReview, câu gợi ý điểm đánh giá; review opus)',
  phases: [
    { title: 'Implement', detail: 'worker sonnet trong worktree riêng' },
    { title: 'Review', detail: 'reviewer opus độc lập' },
    { title: 'Fix', detail: 'sửa theo review' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const BASE = '63cfb5d6'
const WT = (id) => ROOT + '/.claude/worktrees/hz18-' + id
const BR = (id) => 'hz18/' + id

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
- Chỉ làm việc trong worktree của gói (đường dẫn ở trên), nhánh riêng. KHÔNG push, KHÔNG deploy, KHÔNG ghi PROD hay DB dùng chung. KHÔNG git stash/reset/checkout file không phải của mình, không đụng worktree khác hay thư mục gốc repo. Chỉ sửa file thuộc "Nhóm file" của gói; thấy lỗi ở file ngoài nhóm thì ghi vào báo cáo, không sửa (gói khác đang làm song song, sửa chồng sẽ gây xung đột merge).
- Mọi lệnh shell bắt đầu bằng: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
- Việc đầu tiên: cd vào worktree, pnpm install --frozen-lockfile, pnpm --filter @tubutree/shared-types build, và nếu gói đụng API: (cd apps/api && npx prisma generate) (chạy trong apps/api, không chạy ở gốc repo). Không có timeout trên macOS: dùng until-loop hoặc chạy nền. Luôn dùng đường dẫn tuyệt đối (cwd shell có thể bị reset).
- TDD: viết test đỏ trước, thấy đỏ đúng lý do, rồi sửa cho xanh. Lỗi nào không viết được test tái hiện thì nói rõ vì sao và cách đã kiểm. Từng mục một commit riêng. Commit message tiếng Việt văn xuôi thường, kết thúc bằng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Mục nào xác minh trên mã thấy KHÔNG phải lỗi (đã sửa từ trước, hay không tái hiện): ghi bằng chứng vào báo cáo, không sửa mã không lỗi.
- Comment trong code chỉ giải thích "vì sao" không hiển nhiên, không tả thay đổi vừa làm. Không ghi "chủ dự án nói" vào file. Thuật ngữ Q-26: "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước". Component DS v2 sẵn có (apps/miniapp/src/components/ui, packages/design-tokens); ESLint tubu-ds của file đã sửa phải 0 lỗi (--max-warnings=0).
- Docker (nếu cần Postgres cho race spec): docker run -d --rm --name <tên> --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p <cổng>:5432 postgres:16-alpine ; DB tên tubutree_it; chạy prisma migrate deploy (DATABASE_URL=postgresql://tubu:tubu@localhost:<cổng>/tubutree_it?schema=public) trước; kết thúc docker rm -f -v <tên>. Không pkill rộng (kể cả theo đường dẫn); chỉ kill listener cổng của mình.
- Chạy kiểm CHỈ phạm vi gói: tsc --noEmit package đã sửa, ESLint file đã sửa (--max-warnings=0), test (jest/vitest) của file/module đã sửa, race spec liên quan. KHÔNG chạy Playwright e2e, capture/axe hay full suite (điều phối viên chạy). Phần chưa chạy ghi "unverified".
- Viết báo cáo docs/2026-10-review/impl/<GÓI>.md trong worktree (văn xuôi tiếng Việt ngắn: từng mục → làm gì / không phải lỗi / không làm được, quyết định thiết kế, lệnh kiểm và kết quả thật, chưa verify, rủi ro) và commit.
- Kết quả cuối: trả đúng schema kèm lệnh đã chạy và exit code thật. Không báo "xong" nếu chưa chạy lại lệnh.`

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

const PKGS = {
  'PF-6a': { id: 'PF-6a', money: true, port: 5801,
    spec: `GÓI PF-6a — API điểm: hai nợ kỹ thuật do review PF-5a/PF-3 ghi lại (đụng điểm = tiền trả trước; review opus hai lượt). Đọc trước: docs/2026-10-review/impl/PF-5a.md (mục Rủi ro, Sau review), PF-3.md, apps/api/src/modules/loyalty/loyalty.service.ts (lockedOrderPoints ~dòng 400-460, returnWindowDays ~dòng 455), apps/api/src/modules/game/game.service.ts (spin ~dòng 110-180, buyTree ~dòng 360-420, creditPoints ~dòng 636), apps/api/src/modules/checkout/checkout.service.ts (~dòng 300-315).
Mục:
1. lockedOrderPoints đọc cấu hình ngay trong transaction. Mỗi lần gọi trong tx (redeemReward loyalty.service.ts ~644, CheckoutService.placeOrder ~308, GameService.buyTree ~399, GameService.spin ~140) thì lockedOrderPoints → returnWindowDays → SystemConfigService.get; khi cache cấu hình 60 giây hết hạn, lệnh get lấy THÊM một kết nối pool trong lúc kết nối của tx vẫn giữ khoá dòng user (nguy cơ cạn pool P2024 khi tải bùng nổ). PF-5a làm ấm cache trước tx ở spin nhưng khoảng hở gồm cả thời gian chờ FOR UPDATE, nên không loại hẳn. Sửa gốc: thêm tham số tuỳ chọn \`windowDays\` cho lockedOrderPoints (hoặc cách tương đương, ví dụ tách phần đọc cấu hình thành hàm public mà caller gọi TRƯỚC tx) để cả bốn caller trong tx đọc returns.window_days NGOÀI tx rồi truyền vào; caller ngoài tx (tổng quan, báo giá) giữ nguyên hành vi. Không đổi ngữ nghĩa khoá/thứ tự khoá, không đổi kết quả tính. Test: (a) unit: gọi lockedOrderPoints có truyền windowDays thì KHÔNG gọi SystemConfigService.get (spy), không truyền thì vẫn đọc như cũ; (b) với mỗi caller trong tx: bằng spy/mock chứng minh lần đọc cấu hình xảy ra TRƯỚC khi mở transaction (thứ tự gọi: get trước $transaction) và không có lần get nào bên trong callback của tx; (c) chạy lại toàn bộ race spec liên quan điểm (pf5-spin-locked-points, pd3-*, pf3-*, game-tree-*, loyalty-*, checkout-points) phải xanh. Nếu có test mock của LoyaltyService/lockedOrderPoints ở nơi khác thì cập nhật chữ ký.
2. Nhánh trừ điểm âm của GameService.creditPoints: PF-5a báo không có nơi gọi hợp lệ (spin prize.value và mission.rewardPoints đi qua nó). Xác minh trên mã: những ai gọi creditPoints, giá trị lấy từ đâu (cấu hình game.spin_prizes, game.missions...), cấu hình đó có được chặn số âm khi admin ghi (RANGES/schema ở system-config.service.ts) không. Nếu giá trị âm KHÔNG thể tới được (có chặn hoặc seed/validate dương): xoá nhánh âm, để creditPoints chỉ cộng và ném lỗi rõ ràng khi delta <= 0 (có test). Nếu giá trị âm CÓ THỂ tới được qua cấu hình admin: KHÔNG xoá nhánh; thay vào đó thêm chặn ở chỗ ghi cấu hình hoặc ở chỗ đọc (bỏ giải/nhiệm vụ có thưởng âm, ghi log), với test, và ghi rõ quyết định trong báo cáo. Giữ nguyên bất biến: điểm cộng phải có expiresAt (points-expiry-guard.spec.ts phải xanh).
Báo cáo docs/2026-10-review/impl/PF-6a.md.
Nhóm file: apps/api/src/modules/loyalty/**, apps/api/src/modules/game/**, apps/api/src/modules/checkout/** (chỉ đoạn gọi lockedOrderPoints trong tx), apps/api/src/modules/system-config/** (chỉ nếu mục 2 cần chặn cấu hình), apps/api/test/integration-race/pf6-*, docs/2026-10-review/impl/PF-6a.md. KHÔNG sửa apps/miniapp, apps/web, packages/**, schema Prisma, migration.` },
  'PF-6b': { id: 'PF-6b', money: false, port: 5802,
    spec: `GÓI PF-6b — Miniapp: kiểu createReview và câu gợi ý điểm đánh giá. Đọc docs/2026-10-review/impl/PF-3.md (thưởng đánh giá chỉ MỘT lần cho mỗi (khách, sản phẩm), kể cả xoá rồi tạo lại) và PF-5b.md mục 4 trước.
Mục:
1. apps/miniapp/src/services/shop-api.ts (hàm createReview ~dòng 422): khai kiểu trả về có \`pointsEarned?: number\` đúng với response thật của apps/api/src/modules/reviews/reviews.service.ts (đọc mã API để biết trường nào, kiểu gì; \`{ ...review, updated }\` và pointsEarned có thể là 0). Bỏ kiểu cục bộ CreatedReview bù tạm trong apps/miniapp/src/components/reviews-section.tsx (~dòng 86), dùng kiểu từ shop-api. Test vitest/tsc chứng minh không còn ép kiểu cục bộ.
2. apps/miniapp/src/components/reviews-section.tsx (~dòng 360-372): câu gợi ý trước khi gửi ("Thêm video +15 / ảnh +10 Điểm Xanh (chỉ chữ +5)...", "Bạn sẽ nhận +10 Điểm Xanh...", "Tuyệt! Đánh giá có video nhận +15 Điểm Xanh!") hứa điểm cả với khách đã nhận thưởng sản phẩm đó trước đây, trong khi sau PF-3 điểm chỉ cấp ở lần đánh giá ĐẦU TIÊN cho mỗi sản phẩm. Không đổi API. Sửa câu chữ để KHÔNG BAO GIỜ hứa sai: nêu rõ điều kiện "chỉ lần đánh giá đầu tiên của mỗi sản phẩm" ngay trong câu gợi ý (ví dụ: "Lần đầu đánh giá sản phẩm này: thêm video +15 / ảnh +10 Điểm Xanh (chỉ chữ +5)."), giữ thuật ngữ Q-26 và vùng chạm/tubu-ds. Cập nhật câu hiện có ở ~dòng 366 ("Điểm Xanh chỉ được cộng ở lần đánh giá đầu tiên, sửa đánh giá không cộng thêm.") cho nhất quán và không lặp. Test vitest cho cả ba nhánh gợi ý (chỉ chữ / có ảnh / có video) và nhánh sửa đánh giá, kiểm câu có điều kiện "lần đầu".
Ghi trong báo cáo: nếu thấy cách làm tốt hơn (API trả cờ "đã nhận thưởng" ở canReviewProduct để ẩn hẳn câu gợi ý với khách đã nhận) thì chỉ ghi đề xuất, KHÔNG làm (đụng API).
Báo cáo docs/2026-10-review/impl/PF-6b.md.
Nhóm file: apps/miniapp/src/services/shop-api.ts (và test cạnh nó), apps/miniapp/src/components/reviews-section* (và test), apps/e2e/tests/** (chỉ cập nhật selector/chuỗi bị đổi, grep trước). KHÔNG sửa apps/api, apps/web.` },
}

function implPrompt(p) {
  return `Bạn là kỹ sư thực hiện gói ${p.id} của dự án Tubu Tree (hardening 2026-10).
Worktree của gói: ${WT(p.id)} (nhánh ${BR(p.id)}, base ${BASE}). Làm CHỈ trong đó. Cổng Postgres riêng của gói (nếu cần): ${p.port}.

${p.spec}

${COMMON}`
}

function reviewPrompt(p, round, priorNote) {
  return `Bạn là reviewer độc lập, chỉ đọc (không sửa file trong worktree, không commit). Review lượt ${round} gói ${p.id}.
Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Diff: git -C ${WT(p.id)} diff ${BASE}..HEAD. Đọc file đầy đủ quanh các chỗ đổi, không chỉ hunk.
Export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH trước mọi lệnh. Bạn được chạy test của phạm vi gói (jest/vitest/tsc/eslint). ${p.money ? `Nếu cần Postgres: docker run -d --rm --name tubu_rv_pf6a_${round} --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${5810 + round}:5432 postgres:16-alpine, migrate deploy, rồi docker rm -f -v khi xong.` : 'KHÔNG chạy capture/Playwright/trình duyệt; chỉ đọc mã và chạy vitest/jest/tsc/eslint của phạm vi gói.'} Không push, không đụng worktree khác, không pkill rộng.
Mục tiêu gói:
${p.spec}
${p.money ? `Đây là gói đụng điểm (tiền trả trước): tấn công nó. Mục 1: mọi caller của lockedOrderPoints trong tx (tự grep lại toàn bộ repo, đừng tin danh sách của tác giả) đã đọc cấu hình ngoài tx chưa, có đường nào vẫn đọc trong tx; truyền windowDays có làm lệch kết quả (cutoff, đơn đang REQUESTED, đơn CANCELLED/RETURNED chưa thu hồi) không; cache cấu hình đổi giữa lúc đọc ngoài tx và dùng trong tx có mở lỗ hổng chặn điểm không (windowDays cũ vài giây có chấp nhận được không, nêu rõ). Mục 2: kết luận về số âm có đúng không (tự dò: ai ghi được game.spin_prizes và nhiệm vụ, validate ở đâu, seed ra sao), việc xoá/chặn có làm hỏng đường cộng hợp lệ nào không (thưởng vòng quay, nhiệm vụ, hết hạn). Test có thể xanh dù mã sai không (kiểm đột biến: bỏ bản sửa xem test có đỏ). Dựng test/lệnh thật khi có thể; finding chỉ "có vẻ" thì ghi chưa chứng minh.` : `Tìm: hồi quy hành vi ngoài mục tiêu, test yếu (xanh dù mã sai: kiểm đột biến), câu chữ vẫn hứa sai điểm ở chỗ nào đó (grep toàn miniapp các chỗ nói về điểm đánh giá: reviews-section, product-detail, faq, loyalty), kiểu trả về khai sai so với API thật, vi phạm luật tubu-ds/thuật ngữ Q-26, file sửa ngoài nhóm file của gói.`}
${priorNote ? priorNote : ''}
Mặc định nghi ngờ; chỉ gắn blocker/major khi có bằng chứng cụ thể (file:line hoặc lệnh). Ghi lệnh đã chạy vào ranCommands.`
}

function fixPrompt(p, findings) {
  return `Bạn đang sửa gói ${p.id} theo review độc lập. Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Làm CHỈ trong đó, và chỉ file thuộc Nhóm file của gói (spec gói ở dưới).
Finding blocker/major bắt buộc sửa; minor sửa nếu rẻ và an toàn, còn lại ghi lý do bỏ trong báo cáo.
${JSON.stringify(findings, null, 2)}
Với mỗi finding: xác minh trên mã trước (reviewer có thể sai; nếu sai ghi bằng chứng, không sửa), viết test đỏ nếu là lỗi hành vi, sửa, commit riêng. Cập nhật docs/2026-10-review/impl/${p.id}.md (mục "Sau review") và commit. Cổng Postgres riêng của gói (nếu cần): ${p.port}.
${p.spec}

${COMMON}`
}

async function flow(id) {
  const p = PKGS[id]
  try {
    const impl = await run(implPrompt(p), { label: 'impl:' + id, phase: 'Implement', schema: IMPL_SCHEMA, model: 'sonnet' })
    if (!impl) return { id, error: 'implement agent trả null' }
    const r1 = await run(reviewPrompt(p, 1, ''), { label: 'review1:' + id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
    const need = r1 ? r1.findings.filter(f => p.money ? true : f.severity !== 'minor') : []
    let fix = null, r2 = null
    if (need.length > 0) {
      fix = await run(fixPrompt(p, r1.findings), { label: 'fix:' + id, phase: 'Fix', schema: IMPL_SCHEMA, model: 'sonnet' })
    }
    if (p.money || need.length > 0) {
      r2 = await run(reviewPrompt(p, 2, r1 ? `Lượt trước có finding:\n${JSON.stringify(r1.findings)}\nKiểm từng cái đã sửa thật chưa và tìm vấn đề mới do bản sửa.` : ''), { label: 'review2:' + id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
    }
    return { id, branch: BR(id), worktree: WT(id), impl, review1: r1, fix, review2: r2 }
  } catch (e) { return { id, error: String(e) } }
}

phase('Implement')
return await Promise.all([flow('PF-6a'), flow('PF-6b')])
