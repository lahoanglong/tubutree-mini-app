export const meta = {
  name: 'uat-w14-p3-review2-tien',
  description: 'Đợt 6b lượt 2: sửa P3 rev1 của q2-tncn (chặn duyệt/chi theo số cũ, nhãn PIT_REFUND, sổ tay, migration comment) và q8-thuong-quy (TOCTOU bản chụp, test thu hồi), rồi review Opus lượt 2 (gói tiền), tối đa lượt 3',
  phases: [
    { title: 'Fix', detail: 'worker Sonnet sửa P3 theo TDD' },
    { title: 'Review2', detail: 'reviewer Opus lượt 2' },
    { title: 'Review3', detail: 'sửa tiếp + reviewer Opus lượt 3 khi lượt 2 còn lỗi chặn' },
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
    branch: { type: 'string' },
    worktree: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    red: { type: 'string' },
    green: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'worktree', 'commits', 'red', 'green', 'files', 'decisions', 'skipped'],
}
const REVIEW = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true khi không còn lỗi P0/P1/P2' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'location', 'problem', 'fix'],
      },
    },
    testsRerun: { type: 'string' },
  },
  required: ['ok', 'issues', 'testsRerun'],
}

const PKGS = [
  {
    key: 'q2-tncn', race: 25564, since: '06caf612',
    goal: `Gói q2-tncn (Q2 thuế TNCN cộng dồn tháng VN + Q2b tự hoàn thuế giữ dư khi admin từ chối lệnh rút; đọc ${DOCS}/98-cau-hoi.md mục "Chủ trả lời 2026-10-22"). Nhánh đã có 0330e149, fad111af, 523de492, 39ff0124, 06caf612. Luật hoàn: lệnh REQUESTED thì giảm taxWithheld và tăng amount ngay trên lệnh; lệnh APPROVED/PAID (kể cả rút về Ví) thì cộng Ví (sổ PIT_REFUND) và tăng Payout.taxRefunded; personalIncomeTax dùng tổng (taxWithheld − taxRefunded).`,
    fixes: `Review Opus lượt 1 ok, còn P3; sửa các mục sau (TDD cho mục hành vi):
1. Chặn duyệt/chi theo số cũ (rủi ro tiền thật): lệnh REQUESTED có thể tăng amount khi lệnh khác bị từ chối. Admin đang xem màn cũ bấm Duyệt rồi chuyển khoản theo số cũ thì CTV nhận thiếu. Sửa: approvePayout và markPayoutPaid (apps/api/src/modules/affiliate/affiliate.service.ts, controller/DTO tương ứng) nhận thêm expectedAmount tuỳ chọn; có expectedAmount mà khác payout.amount hiện tại (đọc trong transaction, cùng điều kiện trạng thái) thì throw ConflictException tiếng Việt kiểu "Số thực nhận của lệnh đã đổi từ X thành Y (thuế giữ dư vừa được hoàn), vui lòng tải lại trước khi duyệt/chi." Không gửi expectedAmount thì giữ hành vi cũ (tương thích). Màn admin web (apps/web/src/components/admin/** chỗ duyệt/xác nhận đã chi lệnh rút, ví dụ payout-admin-tab.tsx, và apps/web/src/lib/admin-client.ts nếu hàm gọi API nằm đó) gửi expectedAmount = số đang hiện trên dòng; nhận 409 thì báo lỗi và tải lại danh sách. Test jest (lệch → 409, khớp → qua, không gửi → qua) và vitest admin. Sổ tay kế toán chỗ dặn "chuyển đúng số hiện trên lệnh" cập nhật theo.
2. Thứ tự ghi hoàn (affiliate.service.ts khoảng 637-646): gọi applyWalletDelta trước, chỉ tăng taxRefunded khi kết quả applied=true; applied=false thì throw (không để taxRefunded tăng mà Ví không nhận). Test.
3. Nhãn sổ ví PIT_REFUND: 'Hoàn thuế TNCN giữ dư' ở packages/app-core/src/wallet-rules.ts (cạnh WITHDRAW_REFUND) và apps/web/src/lib/ledger-labels.ts (khoảng dòng 142-145). Lịch sử lệnh rút trên web CTV (apps/web/src/app/ctv/page.tsx, PayoutRow khoảng dòng 265-290, CHỈ sửa trong PayoutRow) hiện thêm "đã hoàn X vào Ví" khi taxRefunded > 0, giống Mini App (apps/miniapp/src/pages/affiliate.tsx đã có). Phiên web f2 đã đồng ý 3 chỗ này. Kiểm Mini App dùng nhãn app-core cho sổ ví (nếu Mini App có bảng nhãn riêng thì thêm luôn). Test vitest app-core + web.
4. Comment migration apps/api/prisma/migrations/20261022100000_payout_tax_refunded/migration.sql: sửa câu "image cũ tương thích": image cũ KHÔNG đọc được dòng sổ ví loại PIT_REFUND (Prisma lỗi enum), nên rollback image đi đường khôi phục 7.3; giữ migration ngoài IMAGE_COMPATIBLE_MIGRATIONS. Thêm PIT_REFUND vào danh sách enum ở docs/launch/deploy-rollback-runbook.md khoảng dòng 860 (chỗ nói CustomerRefundStatus).
5. Sổ tay kế toán docs/launch/so-tay-van-hanh/ke-toan.md khoảng dòng 41: sửa đúng theo mã: phần hoàn làm giảm "Thuế đã khấu trừ" ở tháng của NGÀY CHI (paidAt) của lệnh được hoàn; báo cáo tháng đã kê khai có thể đổi khi có lệnh bị từ chối muộn, kế toán điều chỉnh ở kỳ kê khai sau.`,
    files: 'apps/api/src/modules/affiliate/** (+ spec, DTO, controller), apps/api/prisma/migrations/20261022100000_payout_tax_refunded/migration.sql (chỉ comment), docs/launch/**, packages/app-core/src/wallet-rules.ts (+ spec), apps/web/src/lib/ledger-labels.ts (+ spec), apps/web/src/app/ctv/page.tsx chỉ PayoutRow, apps/web/src/components/admin/** + apps/web/src/lib/admin-client.ts chỉ chỗ duyệt/chi lệnh rút, apps/miniapp/src chỉ nhãn sổ ví nếu có bảng riêng, apps/api/test/integration-race/** (+ spec)',
  },
  {
    key: 'q8-thuong-quy', race: 25562, since: 'e6c5a4f4',
    goal: `Gói q8-thuong-quy (Q8 trả bù thưởng quý đại lý trong 60 ngày + Q8b chụp bảng bậc theo quý; đọc ${DOCS}/98-cau-hoi.md mục "Chủ trả lời 2026-10-22"). Nhánh đã có 9a986041, 2f8819c2, ae2dee3c, e6c5a4f4 (bảng dealer_quarter_bonus_tiers, freezeQuarterTiers, tiersForTopUp).`,
    fixes: `Review Opus lượt 1 ok, còn P3; sửa:
1. TOCTOU ở tiersForTopUp (apps/api/src/modules/dealer/dealer.service.ts khoảng 1509-1520, dùng ở 1544/1548): topUp đọc bản chụp thấy null, lúc đó payout chụp C0 và ghi QUARTER_BONUS, topUp thấy anyPaid=true nên dùng bảng hiện hành C1 cho cả lượt. Sửa: nhánh anyPaid=true đọc lại bản chụp trước khi rơi về bảng hiện hành: return anyPaid ? ((await this.quarterTiersSnapshot(this.prisma, quarter)) ?? current) : this.freezeQuarterTiers(quarter, current). Test đỏ trước bằng unit spec giả lập đúng thứ tự trên (findUnique bản chụp lần 1 null, lần 2 C0; cấu hình C1; kỳ vọng trả bù theo C0).
2. dealer-bonus-tier-snapshot.spec.ts:187: ca "quý không có bản chụp" thêm bước gọi clawbackQuarterBonusForOrder và kiểm số thu hồi theo bảng hiện hành 3/5/6% (hoặc tách ca riêng), để nhánh ?? this.bonusTiers() ở khoảng dòng 1713 có test.
3. (rẻ) Unit spec: payout chụp C0, đổi cấu hình C1, freezeQuarterTiers của topUp ghi trùng khoá → số trả bù theo C0.`,
    files: 'apps/api/src/modules/dealer/** (+ spec), apps/api/test/integration-race/** (+ spec)',
  },
]

const FIXER = (p) => `Đọc ${BRIEF} trước (luật cứng). ${p.goal}

Chuẩn bị: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH; cd ${ROOT}/.claude/worktrees/uat-${p.key} (worktree đã có, nhánh uat/${p.key}; KHÔNG tạo worktree mới, không rebase/merge). git status; git log --oneline ${BASE}..HEAD. Chỉ làm trong worktree này.

${p.fixes}

Vùng file được sửa: ${p.files}. Ngoài vùng chỉ khi bắt buộc, ghi lý do trong decisions.
Kiểm: cd apps/api && npx tsc --noEmit && npx jest <thư mục module đã đụng> && npx eslint <file sửa> --max-warnings=0. Đụng web: cd apps/web && npx tsc --noEmit && npx vitest run <file> và TZ=UTC. Đụng app-core: cd packages/app-core && npx tsc --noEmit && npx vitest run. Race spec liên quan: ${UAT}/docs/2026-10-20-uat/tools/pg-native.sh start ${p.race} (DB tubutree_it đã có; migrate deploy lại), DATABASE_URL=postgresql://tubu@127.0.0.1:${p.race}/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand <file>; xong pg-native.sh stop ${p.race}. Comment chỉ giải thích "vì sao". Commit thêm trong nhánh (không amend, không push), message tiếng Việt kiểu repo, cuối message: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Mục nào không đồng ý thì ghi lý do trong decisions. Máy dùng chung: load > 40 thì chờ; kill chỉ PID mình. Ghi output đỏ (trên mã trước khi sửa) vào red, output kiểm cuối vào green.`

const REVIEWER = (p, impl, round) => `Đọc ${BRIEF} trước. Review lượt ${round} gói "${p.key}" (tiền thật: soi kỹ) trước khi gộp vào ${BASE}. ${p.goal} Worktree ${ROOT}/.claude/worktrees/uat-${p.key}. Xem toàn gói: git diff ${BASE}...HEAD; phần mới của lượt này: git diff ${p.since}..HEAD.

Việc lượt này phải làm:
${p.fixes}

Báo cáo worker:
${JSON.stringify(impl)}

Soát lại TOÀN GÓI (không chỉ phần mới), cố chứng minh SAI hoặc THIẾU: số tiền sai ở ví dụ của chủ, hoàn hai lần, trả thừa/thiếu qua chuỗi thao tác (từ chối liên tiếp, từ chối rồi rút tiếp, duyệt rồi chi, đổi bậc giữa các lượt cron), thứ tự khoá gây deadlock, 409 expectedAmount chặn nhầm luồng hợp lệ hay để lọt, báo cáo kế toán đọc số cũ, migration lệch schema, test đỏ có thật đỏ trên mã cũ, chữ tiếng Việt, comment kể lại thay đổi (cấm). Tự chạy lại test của gói (jest các spec module, tsc; vitest nếu đụng web/app-core; race trên cụm ${p.race} nếu kịp; PATH node: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH) và ghi output vào testsRerun. Không sửa file. ok=true chỉ khi không còn P0/P1/P2.`

const FIX2 = (p, rev) => `Đọc ${BRIEF} trước. ${p.goal} Worktree ${ROOT}/.claude/worktrees/uat-${p.key}, nhánh uat/${p.key}. Reviewer Opus báo lỗi sau; sửa hết P0/P1/P2 (P3 nếu rẻ) theo TDD, chạy lại kiểm (tsc, jest module, eslint, vitest nếu đụng web/app-core, race cụm ${p.race}; PATH node: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH), commit thêm (không amend, không push), cuối message Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Không đồng ý mục nào thì ghi lý do trong decisions.\n\nReview:\n${JSON.stringify(rev)}`

const blocking = (rev) => !rev || !rev.ok || rev.issues.some((i) => i.severity !== 'P3')

const results = await pipeline(
  PKGS,
  (p) => agent(FIXER(p), { label: `fix:${p.key}`, phase: 'Fix', agentType: 'worker', effort: 'high', schema: IMPL }),
  (fix, p) => agent(REVIEWER(p, fix, 2), { label: `rev2:${p.key}`, phase: 'Review2', agentType: 'reviewer', schema: REVIEW })
    .then((rev2) => ({ key: p.key, fix, rev2 })),
  (s, p) => {
    if (!s) return null
    if (!blocking(s.rev2)) return s
    return agent(FIX2(p, s.rev2), { label: `fix2:${p.key}`, phase: 'Review3', agentType: 'worker', effort: 'high', schema: IMPL })
      .then((fix2) => agent(REVIEWER(p, fix2 ?? s.fix, 3), { label: `rev3:${p.key}`, phase: 'Review3', agentType: 'reviewer', schema: REVIEW })
        .then((rev3) => ({ ...s, fix2, rev3 })))
  },
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  commits: [...((r.fix?.commits) ?? []), ...((r.fix2?.commits) ?? [])],
  red: r.fix?.red, green: (r.fix2 ?? r.fix)?.green,
  rev2ok: r.rev2?.ok, rev2issues: r.rev2?.issues,
  rev3ok: r.rev3?.ok, rev3issues: r.rev3?.issues,
  decisions: [...((r.fix?.decisions) ?? []), ...((r.fix2?.decisions) ?? [])],
  skipped: [...((r.fix?.skipped) ?? []), ...((r.fix2?.skipped) ?? [])],
}))
