export const meta = {
  name: 'uat-w18-p3-luot3',
  description: 'Lượt 3 hai gói W17: u1b03-nguong (sửa race spec chờ câu cũ, câu cho đơn có kiện đối tác còn phí giao) và q8-bac-admin (chủ chốt: % bậc không giảm, tối đa 1 chữ số lẻ, Mini App ghi 2,5%), rồi review Opus lượt 3',
  phases: [
    { title: 'Fix3', detail: 'worker Sonnet TDD' },
    { title: 'Review3', detail: 'reviewer Opus lượt 3' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const UAT = `${ROOT}/.claude/worktrees/uat`
const BRIEF = `${UAT}/docs/2026-10-20-uat/00-brief.md`
const DOCS = `${UAT}/docs/2026-10-20-uat`
const BASE = 'uat/2026-10-20'

const IMPL = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    red: { type: 'string' }, green: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    webNote: { type: 'string' },
  },
  required: ['commits', 'red', 'green', 'decisions', 'skipped', 'webNote'],
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
    key: 'u1b03-nguong', race: 25573, since: '1c2d11d9',
    goal: `Gói u1b03-nguong (mã FREESHIP trên đơn đã miễn phí giao: giỏ và thanh toán nói cùng một câu; lỗi U1-B03 quay lại sau Q12). Nhánh đã có 3256f95f, 1c2d11d9.`,
    fixes: `1. P2 review lượt 2: apps/api/test/integration-race/coupon-preview-equals-quote.race-spec.ts khoảng dòng 341-343 vẫn chờ COUPON_FREESHIP_NOTHING_REASON cho ca kiện Tubu đã miễn phí giao vì đạt ngưỡng (free_threshold 200.000, giỏ 250.000đ). Đổi kỳ vọng sang câu ngưỡng (dùng hàm/hằng trong coupons/coupon-notice, không gõ cứng nếu có hàm), đổi tên ca cho khớp; ca selfShip (khoảng dòng 333) giữ COUPON_FREESHIP_NOTHING_REASON. Chạy spec này trên cụm ${'' }riêng (lệnh dưới), phải 5/5. Rồi chạy thêm mọi race spec có chữ freeship/coupon-notice/FREESHIP (grep -l trong test/integration-race) để chắc không spec nào khác chờ câu cũ.
2. P3 review lượt 1 và 2 (phiên chính đã quyết câu chữ, không phải luật tiền): đơn có kiện Tubu đã miễn phí giao (đạt ngưỡng hoặc lý do khác) NHƯNG còn kiện gian hàng đối tác có phí giao > 0, thì câu lý do phải nói rõ phạm vi, ví dụ "Phần hàng Tubu Tree giao đã được miễn phí giao (đơn từ 199.000đ), mã FREESHIP chỉ miễn phí giao hàng Tubu Tree nên được giữ cho đơn sau." (ngưỡng lấy từ cấu hình như câu hiện có). Đơn chỉ có kiện Tubu thì giữ câu hiện tại. Xem trước ở giỏ và báo giá thanh toán phải ra cùng câu. TDD: test đơn hỗn hợp đỏ trước. Cân nhắc cùng cách cho câu đơn đầu (COUPON_FREESHIP_FIRST_ORDER_REASON) nếu cùng chỗ code; ghi decisions.
3. Không làm: chip mã ở trang giỏ không kèm lý do sau khi snackbar tắt (lỗi có từ trước, để sau, ghi skipped).`,
    files: 'apps/api/src/modules/checkout/** , apps/api/src/modules/coupons/** (+ spec), apps/api/test/integration-race/coupon-preview-equals-quote.race-spec.ts (và race spec khác nếu chờ câu cũ); apps/miniapp chỉ test nếu cần',
    checks: 'cd apps/api && npx tsc --noEmit && npx jest src/modules/checkout src/modules/coupons src/modules/cart && race spec như trên; npx eslint <file sửa> --max-warnings=0',
  },
  {
    key: 'q8-bac-admin', race: 25574, since: 'b9e24b1b',
    goal: `Gói q8-bac-admin (admin đổi được bậc thưởng quý đại lý dealer.quarterly_bonus_tiers theo Q8b; lỗi U3-B03). Nhánh đã có e311181a, b9e24b1b. Chủ vừa quyết (${DOCS}/98-cau-hoi.md mục "Chủ trả lời 2026-10-22 tối").`,
    fixes: `1. Luật ghi (apps/api/src/modules/system-config/dealer-bonus-tiers-rule.ts): bậc sau phải có pct BẰNG HOẶC CAO HƠN bậc trước (ngưỡng min vẫn tăng dần); sai thì 400 câu tiếng Việt rõ bậc nào. Thêm ca xấu vào it.each trong system-config.service.spec.ts.
2. pct tối đa 1 chữ số thập phân (2,5 được; 2,55 và 3,333 bị từ chối, câu tiếng Việt). Cẩn thận số thực: kiểm bằng Math.round(pct*10) === pct*10 hoặc tương đương an toàn (ghi decisions). Cập nhật mô tả khoá (seed.ts SYSTEM_CONFIGS và chỗ mô tả khác nếu có) nói rõ: ít nhất 1 bậc, ngưỡng tăng dần, % không giảm, tối đa 1 chữ số lẻ, trần hiện có.
3. Mini App màn đại lý (apps/miniapp/src/pages/dealer.tsx quanh dòng 982 và 1013, mọi chỗ in pct bậc thưởng): ghi số kiểu Việt, 4.5 thành "4,5%", 4 thành "4%" (toLocaleString('vi-VN', { maximumFractionDigits: 1 }) hoặc hàm định dạng sẵn có trong repo). Test vitest đỏ trước: pct 4.5 hiện "4,5%".
4. KHÔNG sửa apps/web/src/components/dealer/report-tab.tsx (vùng phiên web): ghi webNote đúng dòng và cách sửa để phiên chính chuyển phiên web.
5. Không đổi công thức thưởng, không đổi luật chụp bậc.`,
    files: 'apps/api/src/modules/system-config/** , apps/api/prisma/seed.ts (chỉ mô tả khoá) , apps/miniapp/src/pages/dealer.tsx (+ spec) , apps/web/src/components/admin/** chỉ khi cần cho hộp xác nhận',
    checks: 'cd apps/api && npx tsc --noEmit && npx jest src/modules/admin src/modules/system-config src/modules/dealer; cd apps/miniapp && npx tsc --noEmit && npx vitest run src/pages/dealer; npx eslint <file sửa> --max-warnings=0',
  },
]

const RACE = (p) => `Cụm Postgres riêng ${p.race}: ${DOCS}/tools/pg-native.sh start ${p.race}; ${DOCS}/tools/pg-native.sh createdb ${p.race} tubutree_it; cd apps/api; export DATABASE_URL=postgresql://tubu@127.0.0.1:${p.race}/tubutree_it?schema=public; npx prisma migrate deploy; npx jest -c test/integration-race/jest.config.js --runInBand <file>; xong: ${DOCS}/tools/pg-native.sh stop ${p.race}. Không dùng 5434/6381.`

const FIXER = (p) => `Đọc ${BRIEF} trước (luật cứng). ${p.goal}\n\nexport PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH; cd ${ROOT}/.claude/worktrees/uat-${p.key} (worktree có sẵn, node_modules có sẵn; không tạo worktree, không rebase/merge). git log --oneline -4.\n\nViệc (TDD, test đỏ trước):\n${p.fixes}\n\nVùng file: ${p.files}.\nKiểm: ${p.checks}. ${RACE(p)}\nComment chỉ giải thích "vì sao". Commit thêm (không amend, không push), message tiếng Việt kiểu repo, cuối: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Load trong uptime > 40 thì chờ; chỉ kill PID của mình. red = output đỏ trước khi sửa, green = output kiểm cuối (dán dòng tổng).`

const REVIEWER = (p, fix) => `Đọc ${BRIEF} trước. Review lượt 3 gói "${p.key}" trước khi gộp vào ${BASE}. ${p.goal} Worktree ${ROOT}/.claude/worktrees/uat-${p.key}. Phần mới: git diff ${p.since}..HEAD; toàn gói: git diff ${BASE}...HEAD.\n\nViệc lượt này:\n${p.fixes}\n\nBáo cáo worker: ${JSON.stringify(fix)}\n\nCố chứng minh phần mới SAI/THIẾU hoặc làm hỏng phần cũ: câu cho khách đúng và giống nhau giữa giỏ và thanh toán; race spec thật sự xanh trên Postgres thật; luật ghi chặn đúng ca xấu (pct giảm, quá 1 chữ số lẻ, lỗi số thực như 0.1+0.2) mà không chặn ca tốt (2,5; 4; mặc định 2/3/4); số trên màn đại lý đúng kiểu Việt. Tự chạy lại test (export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH; ${p.checks}; race spec thì dùng cụm riêng ${p.race + 10}: ${RACE({ race: p.race + 10 })}), dán dòng tổng vào testsRerun. Không sửa file. ok=true chỉ khi không còn P0/P1/P2.`

const results = await pipeline(
  PKGS,
  (p) => agent(FIXER(p), { label: `fix3:${p.key}`, phase: 'Fix3', agentType: 'worker', effort: 'high', schema: IMPL }),
  (fix, p) => agent(REVIEWER(p, fix), { label: `rev3:${p.key}`, phase: 'Review3', agentType: 'reviewer', schema: REVIEW }).then((rev3) => ({ key: p.key, fix, rev3 })),
)

return results.filter(Boolean).map((r) => ({
  key: r.key, commits: r.fix?.commits, red: r.fix?.red, green: r.fix?.green,
  rev3ok: r.rev3?.ok, rev3issues: r.rev3?.issues, rev3tests: r.rev3?.testsRerun,
  decisions: r.fix?.decisions, skipped: r.fix?.skipped, webNote: r.fix?.webNote,
}))
