export const meta = {
  name: 'uat-w15-p3-review3-tien',
  description: 'Đợt 6b lượt 3: sửa P3 rẻ còn lại của review lượt 2 (q8: cửa sổ <10 ngày, lỗi một đại lý chặn cả lượt, chữ mẫu tin trả bù; q2: expectedAmount null, runbook thứ tự deploy) rồi review Opus lượt 3',
  phases: [
    { title: 'Fix', detail: 'worker Sonnet sửa theo TDD' },
    { title: 'Review3', detail: 'reviewer Opus lượt 3' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const UAT = `${ROOT}/.claude/worktrees/uat`
const BRIEF = `${UAT}/docs/2026-10-20-uat/00-brief.md`
const DOCS = `${UAT}/docs/2026-10-20-uat`
const BASE = 'uat/int'

const IMPL = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    red: { type: 'string' }, green: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
  },
  required: ['commits', 'red', 'green', 'files', 'decisions', 'skipped'],
}
const REVIEW = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, location: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'location', 'problem', 'fix'] } },
    testsRerun: { type: 'string' },
  },
  required: ['ok', 'issues', 'testsRerun'],
}

const PKGS = [
  {
    key: 'q8-thuong-quy', race: 25562, since: 'd39a8183',
    goal: `Gói q8-thuong-quy (Q8 trả bù thưởng quý đại lý trong 60 ngày + Q8b chụp bảng bậc theo quý; ${DOCS}/98-cau-hoi.md mục "Chủ trả lời 2026-10-22"). Nhánh đã có 9a986041, 2f8819c2, ae2dee3c, e6c5a4f4, d39a8183.`,
    fixes: `Review Opus lượt 2 ok, còn P3; sửa (TDD):
1. Cửa sổ trả bù 1–9 ngày: mô tả cấu hình nói "0 hoặc dưới 10 = tắt" nhưng cửa sổ 9 ngày vẫn quét quý một lần (ví dụ now=2026-04-09T22:00Z: closesAt = expiresAt, điều kiện quét đúng). Hậu quả: payout ngày 10 chưa chạy + đơn chốt 00:00–04:00 ngày 10 → nhánh trả muộn ghi QUARTER_BONUS delta 0 hoặc thiếu, payout chạy tay sau đó thấy existed nên bỏ qua → đại lý mất thưởng. Sửa: topUpWindowDays trả 0 khi giá trị cấu hình < 10 (đúng mô tả); nhánh trả muộn chỉ ghi khi bonusNow > 0. Test: cửa sổ 9 ngày lúc 05:00 ngày 10 → không quét; nhánh trả muộn bonusNow 0 → không ghi dòng.
2. Lỗi một đại lý chặn cả lượt (dealer.service.ts khoảng 1605-1606 trong topUpQuarterlyBonuses, và cùng mẫu trong payoutQuarterlyBonuses): lỗi khác P2002 thì throw err dừng mọi đại lý sau. Sửa: bắt lỗi từng đại lý, logger.error kèm id đại lý và quý, continue; cuối lượt log số đại lý lỗi (kết quả trả về có thể thêm trường failed). Test: đại lý 1 ném lỗi, đại lý 2 vẫn được trả/bù.
3. Chữ mẫu tin DEALER_BONUS_TOPUP (migration 20261020120000_dealer_bonus_topup_template/migration.sql và apps/api/prisma/seed.ts khoảng 829, chưa deploy nên sửa thẳng migration này được): "bạn được cộng thêm {{amount}}đ vào công nợ đại lý" đọc như nợ tăng, thật ra nợ giảm. Đổi thành câu rõ chiều, ví dụ "công nợ đại lý của bạn được giảm {{amount}}đ". Mẫu cũ DEALER_BONUS_PAID và DEALER_BONUS_ADJUSTED (đã có trên PROD) KHÔNG sửa, chỉ ghi decisions câu đề xuất để chủ quyết.
4. Không sửa (ghi decisions + sổ tay đối soát nếu có chỗ hợp lý trong docs/launch): mốc "doanh số đã tính" suy từ createdAt dòng thưởng có khe mili giây khi đơn commit sau lúc đọc doanh số mà paidAt sớm hơn createdAt dòng bù; xác suất thấp, chấp nhận, đối soát tay.`,
    files: 'apps/api/src/modules/dealer/** (+ spec), apps/api/prisma/migrations/20261020120000_dealer_bonus_topup_template/migration.sql, apps/api/prisma/seed.ts (chỉ mẫu DEALER_BONUS_TOPUP), apps/api/src/modules/system-config/** chỉ mô tả khoá nếu cần, docs/launch/** (sổ tay)',
  },
  {
    key: 'q2-tncn', race: 25564, since: '6331d192',
    goal: `Gói q2-tncn (Q2 thuế TNCN cộng dồn tháng VN + Q2b tự hoàn thuế giữ dư; expectedAmount khi duyệt/chi). Nhánh đã có 0330e149, fad111af, 523de492, 39ff0124, 06caf612, 54812730, fd8c6bf3, 6331d192.`,
    fixes: `Review Opus lượt 2 ok, còn P3; sửa:
1. expectedAmount null: @IsOptional cho null lọt qua, điều kiện expectedAmount !== undefined khiến where có amount: null → Prisma lỗi, trả 400 chung. Sửa: điều kiện expectedAmount != null (approvePayout, markPayoutPaid trong apps/api/src/modules/affiliate/affiliate.service.ts khoảng 1776, 1872). Test null → như không gửi.
2. Runbook deploy (docs/launch/deploy-rollback-runbook.md): ValidationPipe forbidNonWhitelisted nên web admin mới gửi expectedAmount lên API cũ sẽ bị 400, admin không duyệt/chi được. Ghi: API lên trước hoặc cùng lúc với web; rollback quay cả API và web. Đặt ở mục thứ tự deploy/rollback có sẵn.`,
    files: 'apps/api/src/modules/affiliate/** (+ spec), docs/launch/deploy-rollback-runbook.md',
  },
]

const FIXER = (p) => `Đọc ${BRIEF} trước (luật cứng). ${p.goal}

Chuẩn bị: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH; cd ${ROOT}/.claude/worktrees/uat-${p.key} (worktree đã có; không tạo mới, không rebase/merge). git status; git log --oneline -3.

${p.fixes}

Vùng file: ${p.files}. Kiểm: cd apps/api && npx tsc --noEmit && npx jest <thư mục module đụng> (q8 thêm src/modules/system-config prisma) && npx eslint <file sửa> --max-warnings=0. Đụng race spec thì chạy trên cụm ${p.race} (${UAT}/docs/2026-10-20-uat/tools/pg-native.sh start ${p.race}; DATABASE_URL=postgresql://tubu@127.0.0.1:${p.race}/tubutree_it?schema=public npx prisma migrate deploy; npx jest -c test/integration-race/jest.config.js --runInBand <file>; stop). Comment chỉ giải thích "vì sao". Commit thêm (không amend, không push), message tiếng Việt kiểu repo, cuối: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Mục không đồng ý thì ghi lý do trong decisions. Load > 40 thì chờ; kill chỉ PID mình. red = output đỏ trước khi sửa, green = output kiểm cuối.`

const REVIEWER = (p, fix) => `Đọc ${BRIEF} trước. Review lượt 3 gói "${p.key}" (tiền thật) trước khi gộp vào ${BASE}. ${p.goal} Worktree ${ROOT}/.claude/worktrees/uat-${p.key}. Phần mới: git diff ${p.since}..HEAD; toàn gói: git diff ${BASE}...HEAD.

Việc lượt này:
${p.fixes}

Báo cáo worker: ${JSON.stringify(fix)}

Cố chứng minh phần mới SAI/THIẾU hoặc làm hỏng phần cũ (bắt lỗi từng đại lý có nuốt mất lỗi cần dừng không, có để transaction dở không; cửa sổ <10 có tắt đúng cả nhánh trả muộn; chữ mẫu tin rõ chiều; expectedAmount null). Soát nhanh lại toàn gói nếu thấy điểm nghi. Tự chạy lại test (jest module, tsc; PATH node: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH), ghi output vào testsRerun. Không sửa file. ok=true chỉ khi không còn P0/P1/P2.`

const results = await pipeline(
  PKGS,
  (p) => agent(FIXER(p), { label: `fix:${p.key}`, phase: 'Fix', agentType: 'worker', effort: 'high', schema: IMPL }),
  (fix, p) => agent(REVIEWER(p, fix), { label: `rev3:${p.key}`, phase: 'Review3', agentType: 'reviewer', schema: REVIEW })
    .then((rev3) => ({ key: p.key, fix, rev3 })),
)

return results.filter(Boolean).map((r) => ({
  key: r.key, commits: r.fix?.commits, red: r.fix?.red, green: r.fix?.green,
  rev3ok: r.rev3?.ok, rev3issues: r.rev3?.issues, rev3tests: r.rev3?.testsRerun,
  decisions: r.fix?.decisions, skipped: r.fix?.skipped,
}))
