export const meta = {
  name: 'uat-w13-chu-quyet-2026-10-22',
  description: 'Đợt 6b: chủ quyết 2026-10-22: Q2b tự hoàn thuế TNCN giữ dư khi từ chối lệnh rút (+ màn rút web/app-core dùng withdrawTaxPreview), Q8b chụp bảng bậc thưởng quý; worker Sonnet TDD, review Opus tới 3 lượt',
  phases: [
    { title: 'Implement', detail: 'worker Sonnet, test đỏ trước rồi sửa' },
    { title: 'Review', detail: 'reviewer Opus lượt 1' },
    { title: 'Fix', detail: 'worker sửa theo review' },
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
    commits: { type: 'array', items: { type: 'string' }, description: 'sha + tiêu đề' },
    red: { type: 'string', description: 'output test đỏ trên mã cũ (rút gọn, có tên test và lý do fail)' },
    green: { type: 'string', description: 'output các lệnh kiểm cuối (dòng Tests:/exit)' },
    files: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' }, description: 'chỗ phải chọn phương án (an toàn, đảo ngược được) + câu hỏi cho chủ' },
    skipped: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'worktree', 'commits', 'red', 'green', 'files', 'decisions', 'skipped'],
}
const REVIEW = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true khi không còn lỗi P0/P1/P2 phải sửa trước khi gộp' },
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
    testsRerun: { type: 'string', description: 'lệnh test reviewer tự chạy lại + kết quả' },
  },
  required: ['ok', 'issues', 'testsRerun'],
}

const DECIDE = `Đây là quyết định mới của chủ ngày 2026-10-22 (đọc ${DOCS}/98-cau-hoi.md mục "Chủ trả lời 2026-10-22" và mục "Chủ trả lời sáng 2026-10-20").`

const PKGS = [
  {
    key: 'q2-tncn', race: 25564,
    spec: `${DECIDE} Nhánh uat/q2-tncn đã có 3 commit (0330e149, fad111af, 523de492) làm thuế TNCN cộng dồn theo tháng VN (personalIncomeTax, lockPitMonth trong apps/api/src/modules/affiliate/affiliate.service.ts). Review Opus lượt trước còn 2 lỗi, làm cả hai:

(A) P1 web + app-core còn tính thuế theo TỪNG lần rút: packages/app-core/src/affiliate-rules.ts:67 (withdrawView gọi payoutTax(amount, pit)) và apps/web/src/components/affiliate/withdraw-sheet.tsx:67. API đã trả withdrawTaxPreview trong dashboard (affiliate.service.ts:331), Mini App đã dùng (apps/miniapp/src/pages/affiliate.tsx quanh dòng 834, đọc để làm giống). Sửa: thêm withdrawTaxPreview?: number vào kiểu AffiliateDashboard ở packages/app-core/src/api/affiliate.ts; withdrawView nhận taxPreview?: number và dùng taxPreview ?? payoutTax(...) (fallback khi API cũ chưa trả); truyền từ apps/web/src/app/ctv/page.tsx (chỗ <WithdrawSheet ở khoảng dòng 622, CHỈ sửa props ở đó, không đụng phần khác của file vì main đã đổi phần trên của file) qua WithdrawSheet vào withdrawView. Sửa comment nói luật "từng lần rút" ở affiliate-rules.ts:4 và packages/app-core/src/api/config.ts:16. Test vitest: app-core (withdrawView có taxPreview: dùng preview; không có: fallback) và web (withdraw-sheet hiện số thực nhận theo preview). Phiên web (f2) đã đồng ý cho sửa 5 file này.

(B) P2 → chủ chọn "Tự hoàn": rejectPayout (affiliate.service.ts khoảng 1710-1755) hiện không hoàn thuế đã giữ dư. Ví dụ chủ: lệnh A rút 1.500.000đ (thuế 0, còn REQUESTED), lệnh B 1.000.000đ cùng tháng bị giữ 250.000đ (10% × 2,5 triệu). Admin từ chối A: tổng tháng còn 1 triệu dưới ngưỡng, 250.000đ phải tự trả lại. Luật cụ thể (đã chọn, ghi vào decisions nếu đổi gì):
 1. Chỉ áp cho lệnh rút hoa hồng (grossAmount khác null). Lệnh rút Ví về ngân hàng (grossAmount null) giữ nguyên đường cũ.
 2. Lấy lockPitMonth(tx, payout.userId, payout.requestedAt) TRƯỚC khi đổi trạng thái (đọc userId/requestedAt bằng findUnique trước, hai trường này không đổi), để không giành khoá ngược thứ tự với requestPayout (requestPayout lấy khoá tháng trước rồi mới ghi). Sau đó updateMany có điều kiện status REQUESTED như cũ.
 3. Sau khi đánh REJECTED và trả commission về APPROVED như cũ: tính lại cho tháng VN của payout.requestedAt. monthGross = tổng grossAmount các lệnh hoa hồng khác REJECTED trong tháng. required = (pct > 0 và monthGross >= threshold) ? round(monthGross × min(pct,1)) : 0 (cùng công thức personalIncomeTax, tách hàm chung). netWithheld = tổng (taxWithheld − taxRefunded) các lệnh đó. over = netWithheld − required. over <= 0 thì thôi (thiếu thì lần rút sau trong tháng truy thu như luật cũ).
 4. over > 0: chia cho các lệnh còn lại theo requestedAt mới nhất trước, mỗi lệnh tối đa (taxWithheld − taxRefunded) của nó:
   - Lệnh còn REQUESTED (chưa duyệt, còn có thể bị từ chối): giảm taxWithheld và tăng amount (số thực nhận) đúng phần đó ngay trên lệnh. Không cộng Ví, vì nếu cộng Ví rồi lệnh này bị từ chối thì CTV nhận cả hoa hồng gốc lẫn tiền hoàn (trả thừa).
   - Lệnh APPROVED hoặc PAID (kể cả rút về Ví WALLET_BALANCE): cộng phần đó vào Ví Tubu bằng applyWalletDelta (loại sổ ví riêng, ví dụ thêm giá trị PIT_REFUND vào enum WalletTxType bằng migration; refType/refId đảm bảo không trùng unique của sổ ví và chạy lại không hoàn hai lần), và tăng cột mới Payout.taxRefunded Int @default(0) của lệnh đó. Lý do sổ ví tiếng Việt, ví dụ "Hoàn thuế TNCN giữ dư tháng 10/2026 (lệnh rút ngày dd/mm bị từ chối)". Lệnh APPROVED/PAID không thể bị từ chối nữa (kiểm lại: tìm mọi đường đổi trạng thái payout, nếu có đường huỷ APPROVED thì xử lý tương tự và ghi decisions).
 5. personalIncomeTax: số đã khấu trừ trước trong tháng = tổng (taxWithheld − taxRefunded), không chỉ taxWithheld.
 6. Mọi chỗ đọc taxWithheld để báo cáo kế toán / chứng từ khấu trừ / xuất CSV / admin (grep taxWithheld trong apps/api/src và apps/web/src/app/admin, apps/web/src/components/admin) phải dùng số thuế thực giữ = taxWithheld − taxRefunded, hoặc hiện thêm cột "đã hoàn". Sổ tay kế toán (grep "giữ dư" và "TNCN" trong docs/ của repo) sửa câu thuế giữ dư: nay tự hoàn khi từ chối.
 7. Migration mới tên 20261022100000_payout_tax_refunded (ADD COLUMN có default hằng: không khoá bảng lâu; theo quy ước go-live/HEAVY_MIGRATIONS của repo nếu có danh sách migration phải liệt kê). prisma generate sau khi sửa schema.
 8. Test: jest unit cho ví dụ của chủ (B rút Ví PAID → Ví +250.000đ, B.taxRefunded 250.000; B BANK REQUESTED → B.taxWithheld 0, B.amount 1.000.000, không có dòng ví), lệnh sau trong tháng truy thu đúng sau khi đã hoàn, từ chối lệnh rút Ví về ngân hàng không đụng thuế. Race spec Postgres (apps/api/test/integration-race/): (i) hai admin từ chối hai lệnh khác nhau cùng tháng cùng lúc → tổng hoàn đúng một lần, không âm; (ii) từ chối A song song với requestPayout C cùng tháng → sau cả hai, tổng (taxWithheld − taxRefunded) của các lệnh không REJECTED không vượt required của tháng và Ví khớp sổ.`,
    files: 'apps/api/src/modules/affiliate/** (+ spec), apps/api/src/modules/wallet/** chỉ khi cần loại sổ ví, apps/api/prisma/schema.prisma + migration 20261022100000_payout_tax_refunded, apps/api/src/config/go-live/** chỉ khi quy ước migration bắt buộc, packages/app-core/src/affiliate-rules.ts + api/affiliate.ts + api/config.ts (+ spec), apps/web/src/components/affiliate/withdraw-sheet.tsx (+ spec), apps/web/src/app/ctv/page.tsx chỉ props của WithdrawSheet, apps/web/src/app/admin/** và apps/web/src/components/admin/** chỉ chỗ hiện thuế đã giữ, apps/miniapp/src chỉ nơi hiện thuế đã giữ trong lịch sử rút, docs/** sổ tay kế toán, apps/api/test/integration-race/** (+ spec)',
  },
  {
    key: 'q8-thuong-quy', race: 25562,
    spec: `${DECIDE} Nhánh uat/q8-thuong-quy đã có 3 commit (9a986041, 2f8819c2, ae2dee3c) làm trả bù thưởng quý đại lý trong 60 ngày sau quý (DealerService.topUpQuarterlyBonuses, payoutQuarterlyBonuses, clawbackQuarterBonusForOrder trong apps/api/src/modules/dealer/dealer.service.ts; bảng bậc đọc mỗi lần qua private bonusTiers() từ SystemConfig dealer.quarterly_bonus_tiers). Lỗi còn lại: admin đổi bảng bậc cho quý mới (ví dụ 2/3/4% thành 3/5/6%) trong 60 ngày thì trả bù và thu hồi của quý cũ tính theo bậc mới, trả thừa hoặc thiếu. Chủ chọn: CHỤP bảng bậc theo quý. Luật cụ thể:
 1. Lưu bản chụp bảng bậc (đã sắp xếp) theo khoá quý (chuỗi như "Q3/2026", cùng khoá refId đang dùng), toàn cục, không theo đại lý. Bảng mới bằng migration 20261022110000_dealer_quarter_bonus_tiers, ví dụ dealer_quarter_bonus_tiers(quarter text PK, tiers jsonb NOT NULL, createdAt timestamptz DEFAULT now()), model Prisma tương ứng. KHÔNG dùng SystemConfig (màn cấu hình admin liệt kê mọi khoá, và cache cấu hình).
 2. Mốc chụp: lần đầu tính thưởng cho quý đó: payoutQuarterlyBonuses (cron ngày 10), hoặc nhánh "trả muộn" / trả bù đầu tiên của topUpQuarterlyBonuses khi ngày 10 không chạy. Ghi kiểu tạo-một-lần (INSERT … ON CONFLICT DO NOTHING rồi đọc lại, hoặc upsert update rỗng) để hai lượt cron chồng nhau cùng dùng một bản chụp.
 3. Mọi phép tính của quý đã có bản chụp dùng bản chụp: payout chạy lại, topUp (cả seenRevenue và bonusNow), clawbackQuarterBonusForOrder (phần biên). Quý chưa có bản chụp (đã trả trước bản này, hoặc quý hiện tại chưa chốt) dùng bảng hiện hành như cũ. Màn tiến độ quý hiện tại của đại lý (getQuarterProgress hay tương đương, khoảng dòng 827-851) giữ bảng hiện hành.
 4. Admin đổi bậc trong khoảng từ cuối quý tới ngày 10: lần trả ngày 10 dùng bảng lúc đó (như hiện nay). Ghi decisions câu này.
 5. Test jest: trả ngày 10 với 2/3/4%, đổi cấu hình thành 3/5/6%, đơn chốt muộn → trả bù theo 2/3/4%; huỷ đơn đã tính → thu hồi theo 2/3/4%; quý không có bản chụp → bảng hiện hành. Race spec Postgres: hai lượt payout/topUp song song cho cùng quý ghi đúng một bản chụp và không lệch số; cập nhật dealer-bonus-topup.race-spec.ts nếu cần.`,
    files: 'apps/api/src/modules/dealer/** (+ spec), apps/api/prisma/schema.prisma + migration 20261022110000_dealer_quarter_bonus_tiers, apps/api/src/config/go-live/** chỉ khi quy ước migration bắt buộc, apps/api/test/integration-race/** (+ spec)',
  },
]

const WORKER = (p) => `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt). Bạn sửa MỘT gói: "${p.key}".

Chuẩn bị (đúng thứ tự):
  export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
  cd ${ROOT}/.claude/worktrees/uat-${p.key} (worktree đã có, nhánh uat/${p.key}; KHÔNG tạo worktree mới, KHÔNG rebase/merge nhánh khác vào)
  git status; git log --oneline ${BASE}..HEAD. Có thay đổi chưa commit thì đọc kỹ: giữ nếu đúng việc của gói, không commit file trong docs/2026-10-20-uat/tools/**.
  pnpm install --prefer-offline && pnpm --filter @tubutree/shared-types build && (cd apps/api && npx prisma generate)
Chỉ làm việc trong ${ROOT}/.claude/worktrees/uat-${p.key}. Không đụng worktree khác, không đụng ${UAT}.

Việc cần sửa:
${p.spec}

Vùng file được sửa: ${p.files}. Sửa ngoài vùng này chỉ khi bắt buộc, và ghi lý do trong decisions.

Cách làm (TDD, bắt buộc):
1. Đọc mã. Viết test đỏ TRƯỚC trên mã cũ, chạy, chép output fail (tên test + lý do fail đúng lỗi, không phải lỗi biên dịch) vào trường red.
2. Sửa mã tối thiểu cho xanh. Comment chỉ giải thích "vì sao", không kể lại thay đổi. Không làm rộng phạm vi.
3. Kiểm: cd apps/api && npx tsc --noEmit; npx jest <thư mục module đã đụng> (không chạy jest toàn bộ); npx eslint <file đã sửa> --max-warnings=0; npx jest prisma/reference-data src/modules/system-config nếu đụng cấu hình. Đụng web: cd apps/web && npx tsc --noEmit && npx vitest run <file> (và TZ=UTC). Đụng app-core: cd packages/app-core && npx tsc --noEmit && npx vitest run. Đụng miniapp: cd apps/miniapp && npx tsc --noEmit && npx vitest run <file>. Race spec: ${UAT}/docs/2026-10-20-uat/tools/pg-native.sh start ${p.race} && ${UAT}/docs/2026-10-20-uat/tools/pg-native.sh createdb ${p.race} tubutree_it (đã có thì bỏ qua lỗi tồn tại; nếu DB cũ còn migration lạ thì dropdb rồi tạo lại, chỉ trên cổng ${p.race}), DATABASE_URL=postgresql://tubu@127.0.0.1:${p.race}/tubutree_it?schema=public npx prisma migrate deploy, rồi npx jest -c test/integration-race/jest.config.js --runInBand <file>; xong thì pg-native.sh stop ${p.race}. Đổi schema Prisma thì tạo migration đúng quy ước repo (prisma migrate dev --create-only trên cụm riêng, đặt đúng tên đã cho) và chạy prisma generate; kiểm không lệch: npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DB rỗng khác trên cụm ${p.race}> --exit-code.
4. Commit trong nhánh uat/${p.key} (có thể nhiều commit), message tiếng Việt theo lịch sử repo (vd "fix(affiliate): ..."), cuối message: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Không push, không amend commit cũ.
5. Gặp chỗ phải quyết mà luật chưa chốt: chọn phương án an toàn, đảo ngược được (ít mất tiền nhất), ghi vào decisions dạng "chọn X vì Y; câu hỏi cho chủ: ...; phương án khác: ...".
Máy dùng chung: trước lệnh nặng xem uptime, load > 40 thì chờ. Kill chỉ PID mình, không dùng pkill.`

const REVIEWER = (p, impl, round) => `Đọc ${BRIEF} trước. Review lượt ${round} gói "${p.key}" (tiền thật: soi kỹ) trước khi gộp vào ${BASE}. Worktree ${impl.worktree}, nhánh ${impl.branch}. Xem diff toàn gói: cd ${impl.worktree} && git diff ${BASE}...HEAD (phần mới của lượt này là các commit sau ${p.key === 'q2-tncn' ? '523de492' : 'ae2dee3c'}). Yêu cầu gốc:\n${p.spec}\n\nBáo cáo của worker:\n${JSON.stringify(impl)}\n\nCố chứng minh bản sửa SAI hoặc THIẾU: tính sai số tiền ở ví dụ của chủ? hoàn hai lần / trả thừa khi chuỗi thao tác khác (từ chối liên tiếp, từ chối rồi rút tiếp, duyệt rồi chi)? thứ tự khoá gây deadlock với đường khác? lệnh rút Ví về ngân hàng bị đụng sai? báo cáo kế toán còn đọc số cũ? migration đúng quy ước, không lệch schema? bản chụp bậc thưởng ghi hai lần / không dùng ở nhánh nào? test đỏ có thật sự đỏ trên mã cũ? chữ tiếng Việt đúng? comment kể lại thay đổi (cấm)? Tự chạy lại test của gói (jest file spec, tsc, vitest nếu đụng web/app-core; race spec trên cụm ${p.race} nếu kịp) và ghi output vào testsRerun. Không sửa file. ok=true chỉ khi không còn lỗi P0/P1/P2.`

const FIXER = (p, impl, rev) => `Đọc ${BRIEF} trước. Gói "${p.key}", worktree ${impl.worktree}, nhánh ${impl.branch}. Reviewer Opus báo các lỗi sau, sửa hết lỗi P0/P1/P2 (P3 sửa nếu rẻ), theo TDD (test đỏ trước cho lỗi hành vi), chạy lại kiểm như lần đầu (tsc, jest module, eslint file sửa, vitest nếu đụng web/app-core, race spec trên cụm Postgres cổng ${p.race}; PATH node: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH), commit thêm (không amend, không push), cuối message Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Lỗi nào không đồng ý thì ghi lý do trong decisions thay vì sửa.\n\nYêu cầu gốc:\n${p.spec}\n\nReview:\n${JSON.stringify(rev)}`

const blocking = (rev) => !rev || !rev.ok || rev.issues.some((i) => i.severity !== 'P3')

const results = await pipeline(
  PKGS,
  (p) => agent(WORKER(p), { label: `impl:${p.key}`, phase: 'Implement', agentType: 'worker', effort: 'high', schema: IMPL }),
  (impl, p) => impl && agent(REVIEWER(p, impl, 1), { label: `rev1:${p.key}`, phase: 'Review', agentType: 'reviewer', schema: REVIEW })
    .then((rev1) => ({ impl, rev1 })),
  (s, p) => {
    if (!s) return null
    if (!blocking(s.rev1)) return { ...s, fix: null }
    return agent(FIXER(p, s.impl, s.rev1), { label: `fix:${p.key}`, phase: 'Fix', agentType: 'worker', effort: 'high', schema: IMPL })
      .then((fix) => ({ ...s, fix }))
  },
  (s, p) => {
    if (!s) return null
    if (!s.fix) return { key: p.key, ...s, rev2: s.rev1 }
    return agent(REVIEWER(p, s.fix, 2), { label: `rev2:${p.key}`, phase: 'Review2', agentType: 'reviewer', schema: REVIEW })
      .then((rev2) => ({ key: p.key, ...s, rev2 }))
  },
  (s, p) => {
    if (!s) return null
    if (!blocking(s.rev2)) return s
    const last = s.fix ?? s.impl
    return agent(FIXER(p, last, s.rev2), { label: `fix2:${p.key}`, phase: 'Review3', agentType: 'worker', effort: 'high', schema: IMPL })
      .then((fix2) => agent(REVIEWER(p, fix2 ?? last, 3), { label: `rev3:${p.key}`, phase: 'Review3', agentType: 'reviewer', schema: REVIEW })
        .then((rev3) => ({ ...s, fix2, rev3 })))
  },
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  branch: r.impl.branch,
  commits: [...(r.impl.commits ?? []), ...((r.fix?.commits) ?? []), ...((r.fix2?.commits) ?? [])],
  red: r.impl.red,
  green: (r.fix2 ?? r.fix ?? r.impl).green,
  rev1ok: r.rev1?.ok, rev1issues: r.rev1?.issues,
  rev2ok: r.rev2?.ok, rev2issues: r.rev2?.issues,
  rev3ok: r.rev3?.ok, rev3issues: r.rev3?.issues,
  decisions: [...(r.impl.decisions ?? []), ...((r.fix?.decisions) ?? []), ...((r.fix2?.decisions) ?? [])],
  skipped: [...(r.impl.skipped ?? []), ...((r.fix?.skipped) ?? []), ...((r.fix2?.skipped) ?? [])],
}))
