export const meta = {
  name: 'tubutree-2026-10-wave-e2',
  description: 'PE-3 (điểm thưởng game/nhiệm vụ/đánh giá có hạn, đụng điểm, review opus hai lượt) + PE-4 (dọn tham chiếu /beta còn sót); mỗi gói một worktree',
  phases: [
    { title: 'Implement', detail: 'mỗi gói một agent trong worktree hz14-<gói>, TDD, commit từng mục' },
    { title: 'Review', detail: 'reviewer opus độc lập chỉ đọc diff' },
    { title: 'Fix', detail: 'sửa theo review rồi review lượt 2' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const BASE = '03293ee5'
const WT = (id) => ROOT + '/.claude/worktrees/hz14-' + id
const BR = (id) => 'hz14/' + id

const COMMON = `Quy tắc bất biến:
- Chỉ làm việc trong worktree của gói (đường dẫn ở trên), nhánh riêng. KHÔNG push, KHÔNG deploy, KHÔNG ghi PROD hay DB dùng chung. KHÔNG git stash/reset/checkout file không phải của mình, không đụng worktree khác hay thư mục gốc repo.
- Mọi lệnh shell bắt đầu bằng: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
- Việc đầu tiên: cd vào worktree, chạy pnpm install --frozen-lockfile, rồi (cd apps/api && npx prisma generate) nếu gói đụng API; build shared-types nếu tsc cần (pnpm --filter @tubutree/shared-types build). Không có timeout trên macOS: dùng until-loop hoặc chạy nền.
- TDD: viết test đỏ trước, thấy đỏ đúng lý do, rồi sửa cho xanh. Từng mục một commit riêng. Commit message tiếng Việt văn xuôi thường, kết thúc bằng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Comment trong code chỉ giải thích "vì sao" không hiển nhiên, không tả thay đổi vừa làm. Không ghi "chủ dự án nói" vào file.
- Docker (nếu cần Postgres cho race spec): docker run -d --rm --name <tên> --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p <cổng>:5432 postgres:16-alpine ; DB phải tên tubutree_it; kết thúc phải docker rm -f -v <tên>. Không dùng pkill rộng.
- Chạy kiểm CHỈ phạm vi gói: tsc --noEmit của package đã sửa, ESLint các file đã sửa (--max-warnings=0), test của file/module đã sửa (jest/vitest), race spec của phần đã sửa nếu có. KHÔNG chạy Playwright hay full suite (điều phối viên chạy sau). Phần chưa chạy ghi rõ "unverified".
- Viết báo cáo docs/2026-10-review/impl/<GÓI>.md trong worktree (văn xuôi tiếng Việt, ngắn: việc đã làm, quyết định thiết kế, lệnh kiểm và kết quả thật, việc chưa verify, rủi ro còn lại) và commit.
- Kết quả cuối: trả đúng schema, kể cả các lệnh đã chạy và exit code thật. Không báo "xong" nếu chưa chạy lại lệnh.`

const PKGS = [
  { id: 'PE-3', port: 5594, twoPass: true,
    spec: `GÓI PE-3 — Điểm Xanh thưởng còn ghi không hạn (đụng điểm = tiền, sẽ bị review opus hai lượt).

Bối cảnh: chủ dự án đã duyệt (OQ-1, docs/2026-10-review/00-ROADMAP.md cuối file): thưởng mới là Điểm Xanh lô STANDARD, hết hạn sau loyalty.point_expire_months tháng, trần dùng 20%/đơn. Gói PE-1a (đã merge, báo cáo impl/PE-1a.md) đã sửa dòng hoàn ORDER_REFUND_POINTS và liệt kê các nơi còn ghi điểm dương lô STANDARD với expiresAt NULL (không bao giờ hết hạn): game.service creditPoints (GAME_SPIN_WIN:<prize>, MISSION:<code>:<cycleKey>) và reviews.service (REVIEW:<slug>, apps/api/src/modules/reviews/reviews.service.ts quanh dòng 135).
Việc: cho các khoản đó expiresAt = now + loyalty.point_expire_months bằng đúng helper mà điểm danh và ORDER_REFUND_POINTS đang dùng (pointsExpiresAt trong loyalty.service.ts; tái dùng, không viết lại cách tính tháng). Đọc cả luồng xung quanh: creditPoints có chạy trong transaction của caller (tx), đọc cấu hình NGOÀI tx để không giữ kết nối; không làm đổi số điểm, reason, idempotency hay unique (reason, refId) hiện có.
Rà TOÀN BỘ nơi ghi điểm dương lô STANDARD (grep pointsTransaction.create, applyPointsDelta, creditPoints, và mọi chỗ tăng pointsBalance) và lập bảng trong báo cáo: nguồn → có/không expiresAt → đã sửa hay giữ lý do. Nguồn nào cố ý không hạn (nếu có, ví dụ do spec PD-3 ghi rõ) thì giữ và nêu lý do dẫn spec impl/PD-3-SPEC.md; nguồn nào là lỗi bỏ sót thì sửa cùng gói. Cân nhắc một test guard (vitest/jest) bắt lỗi tái phát: mọi nơi ghi điểm dương STANDARD phải đi qua helper có hạn hoặc nằm trong danh sách ngoại lệ có lý do — chỉ thêm nếu viết được gọn và không giòn.
Kiểm: cron hết hạn (loyalty-expiry.service.ts, đã sửa ở PE-1a: dòng POINTS_EXPIRED replay vào lô đã hết hạn) và đối soát reconcile-points vẫn nhất quán khi có nhiều lô có hạn khác nhau trộn với lô không hạn cũ. Test đỏ→xanh: unit cho từng nguồn (expiresAt đúng), race spec Postgres thật (cổng ${'5594'}, container tubu_it_pe3) cho: nhận thưởng → chạy cron ở thời điểm sau hạn → điểm bị trừ đúng một lần, pointsBalance khớp tổng dòng lô STANDARD, findPointsLotDrift rỗng; chạy lại cron không trừ lần hai. Không backfill dòng cũ (chưa có dữ liệu thật; ghi trong báo cáo).
Nhóm file: apps/api/src/modules/{game,reviews,loyalty}/** (chỉ chỗ liên quan), apps/api/test/integration-race/** (spec mới), docs. KHÔNG sửa checkout, order-reversal, wallet, schema.prisma/migration.` },
  { id: 'PE-4', port: 5595, twoPass: false,
    spec: `GÓI PE-4 — Dọn tham chiếu /beta còn sót sau PE-2 (không đụng tiền).

(1) scripts/audit/routes.json (dòng ~339, ~350) còn liệt kê trang miniapp /beta, và scripts/audit/seed-audit-personas.ts (~1577 và các dòng ~580-581, 647, 1259-1261 seed beta.features, betaTester, betaFeedback) đã lỗi thời vì trang /beta bị xoá ở PD-1 và 4 route /beta/* ở BE bị gỡ ở PE-2. Gỡ mẫu route /beta khỏi routes.json và phần seed/persona chỉ phục vụ trang đó; GIỮ bảng/model BetaFeedback (không DROP) và giữ dữ liệu seed nào còn bảng đích hợp lệ nếu gỡ thì rủi ro hơn (tự quyết, ghi lý do trong báo cáo). Kiểm các script audit/uiux khác còn nhắc /beta (grep -rn "beta" scripts/ apps/e2e apps/miniapp/src apps/web/src, bỏ qua node_modules và dữ liệu sinh ra), sửa nếu rõ là sót.
(2) apps/api/src/common/endpoint-inventory.spec.ts: 4 mục REMOVED cho /beta/* không bao giờ đỏ vì ROUTES dựng từ danh sách tay 14 controller không có BetaController (review độc lập PE-2 đã chỉ ra). Chọn một: (a) dựng ROUTES từ đồ thị AppModule bằng helper dùng chung với beta-removed.spec.ts (chuyển collectControllers sang helper chung nếu cần) để mục REMOVED có tác dụng thật, hoặc (b) bỏ 4 mục và ghi rõ beta-removed.spec.ts mới là nơi bảo vệ. Ưu tiên (a) nếu gọn; chứng minh bằng đột biến (thêm lại một route /beta giả vào một controller → test đỏ, gỡ → xanh). Sửa câu tương ứng trong docs/2026-10-review/impl/PE-2.md cho đúng.
Nhóm file: scripts/audit/**, apps/api/src/common/endpoint-inventory.spec.ts, apps/api/src/**/beta-removed*.spec.ts hoặc helper dùng chung trong apps/api/src/common/, docs/2026-10-review/impl/PE-2.md (chỉ câu cần sửa). KHÔNG đụng logic nghiệp vụ.` },
]

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    verification: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exitCode: { type: 'number' }, summary: { type: 'string' } }, required: ['command', 'exitCode', 'summary'] } },
    unverified: { type: 'array', items: { type: 'string' } },
    designNotes: { type: 'string' },
  },
  required: ['commits', 'verification', 'unverified'],
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

function implPrompt(p) {
  return `Bạn là kỹ sư thực hiện gói ${p.id} của dự án Tubu Tree (hardening 2026-10).
Worktree của gói: ${WT(p.id)} (nhánh ${BR(p.id)}, base ${BASE}). Làm CHỈ trong đó.
Cổng Postgres riêng cho race spec của gói: ${p.port}.

${p.spec}

${COMMON}`
}

function reviewPrompt(p, round, prior) {
  const money = p.id === 'PE-3'
  return `Bạn là reviewer độc lập, chỉ đọc (không sửa file trong worktree, không commit). Review lượt ${round} gói ${p.id}.
Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Diff: git -C ${WT(p.id)} diff ${BASE}..HEAD. Đọc cả file đầy đủ quanh các chỗ đổi, không chỉ hunk.
Export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH trước mọi lệnh. Bạn được chạy test của phạm vi gói; nếu cần Postgres: docker run -d --rm --name tubu_rv_${p.id.toLowerCase().replace('-', '')}_${round} --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${p.port + 10 + round}:5432 postgres:16-alpine rồi docker rm -f -v khi xong. Không push, không đụng worktree khác, không pkill rộng.
Mục tiêu gói:
${p.spec}
${money ? `Đây là gói đụng điểm (tiền trả trước của khách): tấn công nó. Tìm: nguồn ghi điểm dương STANDARD còn sót expiresAt NULL (tự grep độc lập, đừng tin bảng của tác giả), thay đổi làm lệch số điểm/idempotency/unique, đọc cấu hình trong tx giữ kết nối, cron hết hạn trừ đôi hoặc lệch pointsBalance khi trộn lô có hạn và không hạn, reconcile-points lệch, lỗi múi giờ/tháng cuối tháng của hạn, nguồn cố ý không hạn bị đổi nhầm. Dựng test/lệnh thật để chứng minh khi có thể; finding chỉ "có vẻ" thì ghi rõ chưa chứng minh.` : `Tìm: hồi quy ngoài mục tiêu, test yếu (xanh dù mã sai; kiểm đột biến), sót chỗ tham chiếu, script audit vẫn trỏ route đã gỡ.`}
${prior ? `Lượt trước có các finding sau; kiểm từng cái đã sửa thật chưa (chạy lại test chứng minh) và tìm thêm vấn đề mới do bản sửa:\n${JSON.stringify(prior)}` : ''}
Mặc định nghi ngờ: nếu không chạy được lệnh kiểm, ghi vào ranCommands cái đã chạy và nêu cái không chạy được. Chỉ gắn blocker/major khi có bằng chứng cụ thể (file:line hoặc lệnh).`
}

function fixPrompt(p, findings) {
  return `Bạn đang sửa gói ${p.id} theo review độc lập. Worktree: ${WT(p.id)} (nhánh ${BR(p.id)}). Làm CHỈ trong đó.
Các finding (blocker/major bắt buộc sửa; minor sửa nếu rẻ và an toàn, còn lại ghi lý do bỏ trong báo cáo gói):
${JSON.stringify(findings, null, 2)}
Với mỗi finding: xác minh trên mã trước (reviewer có thể sai; nếu sai thì ghi bằng chứng, không sửa), viết test đỏ nếu là lỗi hành vi, sửa, commit riêng. Cập nhật docs/2026-10-review/impl/${p.id}.md (mục "Sau review") và commit.
${COMMON}`
}

phase('Implement')
const results = await parallel(PKGS.map(p => async () => {
  const impl = await agent(implPrompt(p), { label: 'impl:' + p.id, phase: 'Implement', schema: IMPL_SCHEMA, model: 'sonnet' })
  if (!impl) return { id: p.id, error: 'implement agent trả null' }
  const r1 = await agent(reviewPrompt(p, 1, null), { label: 'review1:' + p.id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
  let fix = null, r2 = null
  const blocking = r1 ? r1.findings.filter(f => f.severity !== 'minor') : []
  const needFix = r1 && r1.findings.length > 0 && (blocking.length > 0 || p.twoPass)
  if (needFix) {
    fix = await agent(fixPrompt(p, r1.findings), { label: 'fix:' + p.id, phase: 'Fix', schema: IMPL_SCHEMA, model: 'sonnet' })
  }
  if (p.twoPass || blocking.length > 0) {
    r2 = await agent(reviewPrompt(p, 2, r1 ? r1.findings : null), { label: 'review2:' + p.id, phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
  }
  return { id: p.id, branch: BR(p.id), worktree: WT(p.id), impl, review1: r1, fix, review2: r2 }
}))
return results.filter(Boolean)
