export const meta = {
  name: 'uat-w17-p3-sau-chay-lai',
  description: 'Hai gói P3 từ lần chạy lại UAT trên bản ứng viên: u1b03-nguong (mã FREESHIP trên đơn đã miễn phí giao theo ngưỡng Q12, giỏ và thanh toán nói cùng một câu) và q8-bac-admin (admin đổi được bậc thưởng quý đại lý theo Q8b); TDD, 2 lượt review Opus mỗi gói',
  phases: [
    { title: 'Fix', detail: 'worker Sonnet TDD' },
    { title: 'Review1', detail: 'reviewer Opus lượt 1' },
    { title: 'Fix2', detail: 'worker sửa theo review 1' },
    { title: 'Review2', detail: 'reviewer Opus lượt 2' },
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
    files: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    webNote: { type: 'string', description: 'web khách (vùng phiên web) cư xử thế nào với thay đổi này, có cần phiên web sửa gì không' },
  },
  required: ['commits', 'red', 'green', 'files', 'decisions', 'skipped', 'webNote'],
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
    key: 'u1b03-nguong', race: 25573,
    goal: `Gói u1b03-nguong: lỗi U1-B03 quay lại sau Q12 (lần chạy lại UAT ${DOCS}/uat/rerun/U1.md dòng "Ghi nhận U1-B03"; lỗi gốc ${DOCS}/uat/U1-mua-hang.md mục "U1-B03").`,
    fixes: `Hiện trạng: 8ed1f3ed chỉ xử lý khi đơn đầu đã miễn phí giao (firstOrderWaived > 0, COUPON_FREESHIP_FIRST_ORDER_REASON). Q12 hạ ngưỡng miễn phí giao thường về 199.000đ (e2dffaa4), nên đơn đầu 199.000đ nay được miễn phí giao vì ĐẠT NGƯỠNG, firstOrderWaived = 0. Hậu quả, khách áp FREESHIP:
- giỏ (xem trước mã, checkout.service.ts nhánh xem trước) coi mã hợp lệ, Mini App voucher-sheet báo "Đã áp dụng mã FREESHIP";
- báo giá thanh toán trả couponApplied:false + couponNotice câu chung COUPON_FREESHIP_NOTHING_REASON "...đơn này không có phí giao đó."
Tiền đúng (không tiêu lượt, không ghi mã). Tái hiện: ${DOCS}/uat/scripts/U1-mua-hang/u1-c-voucher-cod.mjs ca U1-14 bước (a), results/U1-14.json.

Việc (TDD, test đỏ trước):
1. Mã freeship trên đơn mà phí giao ĐÃ bằng 0 vì bất kỳ lý do nào (đạt ngưỡng miễn phí thường, đơn đầu, hạng, ...) thì xem trước ở giỏ báo không áp được (eligible false + reason), cùng câu với báo giá thanh toán. Câu theo lý do: giữ câu đơn đầu; thêm câu cho đạt ngưỡng, ví dụ "Đơn từ 199.000đ đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau." (số ngưỡng lấy từ cấu hình đang dùng, định dạng tiền kiểu repo, không cứng 199.000). Lý do khác: câu chung có nghĩa (đơn đã được miễn phí giao), không nói "không có phí giao đó".
2. Phí giao không phụ thuộc địa chỉ (comment 8ed1f3ed) nên giỏ tính được. Nếu thấy có trường hợp phụ thuộc địa chỉ thì ghi decisions và chọn hướng an toàn (không báo "Đã áp dụng" khi chưa chắc).
3. Mini App voucher-sheet đã có nhánh previewBlocked: kiểm bằng test rằng với reason mới nó báo cảnh báo, không báo "Đã áp dụng". Không đổi luật tiền, không đổi việc tiêu lượt.
4. Không sửa apps/web/src (vùng phiên web, trừ admin). Đọc web dùng xem trước mã thế nào (apps/web/src/**/coupon*, giỏ, thanh toán) và ghi webNote: web có báo "đã áp dụng" sai trong ca này không, cần phiên web đổi gì.`,
    files: 'apps/api/src/modules/checkout/** , apps/api/src/modules/coupons/** , apps/api/src/modules/cart/** (+ spec); apps/miniapp/src/components/checkout/** (+ spec); không đụng packages/app-core, shared-types trừ khi bắt buộc (ghi decisions)',
    checks: 'cd apps/api && npx tsc --noEmit && npx jest src/modules/checkout src/modules/coupons src/modules/cart; cd apps/miniapp && npx tsc --noEmit && npx vitest run src/components/checkout src/pages/cart; npx eslint <file sửa> --max-warnings=0',
  },
  {
    key: 'q8-bac-admin', race: 25574,
    goal: `Gói q8-bac-admin: lỗi U3-B03 của lần chạy lại UAT (${DOCS}/uat/rerun/U3.md). Chủ chọn Q8b (${DOCS}/98-cau-hoi.md mục "Chủ trả lời 2026-10-22"): "admin đổi bậc cho quý mới không ảnh hưởng quý cũ". Nhưng dealer.service.ts đọc bậc bằng config.get('dealer.quarterly_bonus_tiers', mặc định 50tr→2%, 100tr→3%, 200tr→4%) mà khoá này không có dòng trong system_configs và không có luật ghi, nên admin PUT /admin/config trả 400 "Không có khoá cấu hình" (admin.service.ts setConfig). Bậc thưởng quý thực tế không đổi được ngoài sửa DB tay.`,
    fixes: `Việc (TDD, test đỏ trước; tiền thật):
1. Cho admin đổi dealer.quarterly_bonus_tiers qua cấu hình: thêm luật ghi (theo mẫu có sẵn: admin-config-rules.ts hoặc SystemConfigService write rule) kiểm hình dạng đúng kiểu BonusTier mà dealer.service.ts dùng; ngưỡng doanh số nguyên dương tăng dần, không trùng; phần trăm trong khoảng hợp lý (0 < pct, trần chọn theo luật tiền sẵn có của repo, ghi decisions); mảng không rỗng hoặc rỗng = tắt thưởng (chọn một, ghi decisions và nói rõ trong mô tả khoá). Giá trị sai trả 400 câu tiếng Việt.
2. Khoá phải có sẵn trên DB mới và PROD: thêm vào giá trị mặc định nghiệp vụ của seed-reference (cờ --with-business-defaults; xem cách các khoá dealer.* khác được nạp) với đúng giá trị mặc định đang cứng trong code, mô tả tiếng Việt nói rõ: đổi bậc có hiệu lực cho quý CHƯA trả thưởng; quý đã trả giữ bảng bậc đã chụp (dealer_quarter_bonus_tiers). Seed chạy lại không ghi đè giá trị admin đã đổi (theo cách seed-reference đang làm).
3. Admin web: khoá này là cấu hình tiền, phải đi qua hộp "Xác nhận đổi cấu hình tiền/điểm" như affiliate.*, coupon.* (bản sửa U5-48). Tìm danh sách khoá tiền ở apps/web/src/components/admin/** hoặc app/admin/** (vùng UAT được sửa; KHÔNG sửa components/admin/portal-header.tsx) và thêm nếu thiếu, kèm test vitest. Nếu đã có form riêng cho dealer.* thì dùng form đó.
4. Không đổi công thức thưởng, không đổi luật chụp bậc. Test: admin đổi bậc → quý chưa chụp dùng bậc mới; quý đã chụp vẫn dùng bản chụp (có thể đã có test, thêm ca nối với luật ghi nếu thiếu).
5. Runbook docs/launch/deploy-rollback-runbook.md có số "system_configs: +130 mới" của seed-reference trên DB trống: đo lại trên cụm race ${'${race}'} (migrate deploy rồi tsx prisma/seed-reference.ts --with-business-defaults hai lần trên DB trống) và sửa số nếu đổi; ghi output vào green.`,
    files: 'apps/api/src/modules/admin/** , apps/api/src/modules/system-config/** , apps/api/src/modules/dealer/** (chỉ đọc hoặc mô tả, không đổi công thức) , apps/api/prisma/seed-reference*.ts (hoặc nơi chứa giá trị mặc định nghiệp vụ) , apps/web/src/components/admin/** hoặc apps/web/src/app/admin/** (trừ portal-header.tsx) , docs/launch/deploy-rollback-runbook.md',
    checks: 'cd apps/api && npx tsc --noEmit && npx jest src/modules/admin src/modules/system-config src/modules/dealer; cd apps/web && npx tsc --noEmit && npx vitest run src/components/admin src/app/admin; npx eslint <file sửa> --max-warnings=0',
  },
]

const PREP = (p) => `Chuẩn bị: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH; cd ${ROOT}/.claude/worktrees/uat-${p.key} (worktree mới tạo từ ${BASE}, nhánh uat/${p.key}; không tạo worktree khác, không rebase/merge). Lần đầu chưa có node_modules: pnpm install --prefer-offline; pnpm --filter @tubutree/shared-types build; cd apps/api && npx prisma generate.`

const COMMON = (p) => `Kiểm: ${p.checks}. Đụng race spec hoặc cần DB thật thì dùng cụm riêng ${p.race}: ${DOCS}/tools/pg-native.sh start ${p.race}; ${DOCS}/tools/pg-native.sh createdb ${p.race} tubutree_it; DATABASE_URL=postgresql://tubu@127.0.0.1:${p.race}/tubutree_it?schema=public npx prisma migrate deploy; ...; xong thì pg-native.sh stop ${p.race}. Không dùng 5434/6381 (dev dùng chung). Comment chỉ giải thích "vì sao". Commit (không amend, không push), message tiếng Việt kiểu repo, cuối: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Load trong uptime > 40 thì chờ; chỉ kill PID của mình, không pkill. red = output đỏ trước khi sửa, green = output kiểm cuối (dán dòng tổng).`

const FIXER = (p) => `Đọc ${BRIEF} trước (luật cứng). ${p.goal}\n\n${PREP(p)}\n\n${p.fixes}\n\nVùng file: ${p.files}.\n${COMMON(p)}`

const FIXER2 = (p, fix, rev) => `Đọc ${BRIEF} trước. Lượt sửa 2 gói "${p.key}". ${p.goal}\nWorktree ${ROOT}/.claude/worktrees/uat-${p.key} (đã có commit lượt 1: ${JSON.stringify(fix?.commits || [])}). export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH.\n\nReview Opus lượt 1: ${JSON.stringify(rev)}\n\nSửa mọi P0/P1/P2 và các P3 rẻ (TDD: test đỏ trước). P3 không sửa thì ghi lý do vào decisions/skipped. Không làm thêm việc ngoài review. Vùng file: ${p.files}.\n${COMMON(p)}\nKhông có gì phải sửa thì commits rỗng, ghi lý do.`

const REVIEWER = (p, round, fix) => `Đọc ${BRIEF} trước. Review lượt ${round} gói "${p.key}" trước khi gộp vào ${BASE}. ${p.goal} Worktree ${ROOT}/.claude/worktrees/uat-${p.key}; toàn gói: git diff ${BASE}...HEAD.\n\nYêu cầu của gói:\n${p.fixes}\n\nBáo cáo worker: ${JSON.stringify(fix)}\n\nCố chứng minh gói SAI/THIẾU: đúng luật đã chốt (Q12 ngưỡng freeship 199.000đ, Q8b chụp bậc theo quý), không đổi luật tiền ngoài yêu cầu, câu tiếng Việt cho khách đúng và nhất quán giữa giỏ và thanh toán, luật ghi cấu hình chặn được giá trị xấu, seed không ghi đè giá trị admin, hộp xác nhận cấu hình tiền, test có thật sự đỏ trước sửa. Tự chạy lại test (PATH node: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH; ${p.checks}), dán dòng tổng vào testsRerun. Không sửa file. ok=true chỉ khi không còn P0/P1/P2.`

const results = await pipeline(
  PKGS,
  (p) => agent(FIXER(p), { label: `fix:${p.key}`, phase: 'Fix', agentType: 'worker', effort: 'high', schema: IMPL }),
  (fix, p) => agent(REVIEWER(p, 1, fix), { label: `rev1:${p.key}`, phase: 'Review1', agentType: 'reviewer', schema: REVIEW }).then((rev1) => ({ fix, rev1 })),
  (s, p) => agent(FIXER2(p, s.fix, s.rev1), { label: `fix2:${p.key}`, phase: 'Fix2', agentType: 'worker', effort: 'high', schema: IMPL }).then((fix2) => ({ ...s, fix2 })),
  (s, p) => agent(REVIEWER(p, 2, { lượt1: s.fix, review1: s.rev1, lượt2: s.fix2 }), { label: `rev2:${p.key}`, phase: 'Review2', agentType: 'reviewer', schema: REVIEW }).then((rev2) => ({ key: p.key, ...s, rev2 })),
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  commits: [...(r.fix?.commits || []), ...(r.fix2?.commits || [])],
  red: r.fix?.red, green: r.fix2?.green || r.fix?.green,
  rev1ok: r.rev1?.ok, rev1issues: r.rev1?.issues,
  rev2ok: r.rev2?.ok, rev2issues: r.rev2?.issues, rev2tests: r.rev2?.testsRerun,
  decisions: [...(r.fix?.decisions || []), ...(r.fix2?.decisions || [])],
  skipped: [...(r.fix?.skipped || []), ...(r.fix2?.skipped || [])],
  webNote: r.fix2?.webNote || r.fix?.webNote,
}))
