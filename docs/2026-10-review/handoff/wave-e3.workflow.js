export const meta = {
  name: 'tubutree-2026-10-wave-e3',
  description: 'PE-5: dòng điểm âm của huỷ/trả đơn (ORDER_REVERSED...) ăn đúng lô gốc khi cron tính hạn; chứng minh lỗi bằng race test trước, review opus hai lượt',
  phases: [
    { title: 'Implement', detail: 'một agent trong worktree hz15-PE-5, TDD, chứng minh lỗi trước' },
    { title: 'Review', detail: 'reviewer opus độc lập, hai lượt vì đụng điểm' },
    { title: 'Fix', detail: 'sửa theo review' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const BASE = 'a7415605'
const WT = ROOT + '/.claude/worktrees/hz15-PE-5'
const BR = 'hz15/PE-5'
const PORT = 5596

const COMMON = `Quy tắc bất biến:
- Chỉ làm việc trong worktree của gói (đường dẫn ở trên), nhánh riêng. KHÔNG push, KHÔNG deploy, KHÔNG ghi PROD hay DB dùng chung. KHÔNG git stash/reset/checkout file không phải của mình, không đụng worktree khác hay thư mục gốc repo.
- Mọi lệnh shell bắt đầu bằng: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
- Việc đầu tiên: cd vào worktree, pnpm install --frozen-lockfile, pnpm --filter @tubutree/shared-types build, (cd apps/api && npx prisma generate). Không có timeout trên macOS: dùng until-loop hoặc chạy nền.
- TDD: viết test đỏ trước, thấy đỏ đúng lý do, rồi sửa cho xanh. Từng mục một commit riêng. Commit message tiếng Việt văn xuôi thường, kết thúc bằng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Comment trong code chỉ giải thích "vì sao" không hiển nhiên, không tả thay đổi vừa làm. Không ghi "chủ dự án nói" vào file.
- Docker cho race spec: docker run -d --rm --name tubu_it_pe5 --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${PORT}:5432 postgres:16-alpine ; DB tên tubutree_it; chạy prisma migrate deploy trước; kết thúc docker rm -f -v tubu_it_pe5. Không pkill rộng.
- Chạy kiểm CHỈ phạm vi gói: tsc --noEmit apps/api, ESLint file đã sửa (--max-warnings=0), jest module loyalty/reviews/orders liên quan, race spec liên quan (các spec loyalty-refund-expiry, pe3-reward-expiry, pd3-order-reversal, pd3-points-lots, order-cancel, cod-return-refund, loyalty.race và spec bạn thêm). KHÔNG chạy Playwright hay full suite (điều phối viên chạy). Phần chưa chạy ghi "unverified".
- Viết báo cáo docs/2026-10-review/impl/PE-5.md trong worktree (văn xuôi tiếng Việt ngắn: việc làm, quyết định thiết kế, lệnh kiểm kết quả thật, chưa verify, rủi ro) và commit.
- Kết quả cuối: trả đúng schema, kèm lệnh đã chạy và exit code thật. Không báo "xong" nếu chưa chạy lại lệnh.`

const SPEC = `GÓI PE-5 — Cron hết hạn điểm: dòng âm của huỷ/trả đơn phải ăn đúng lô gốc (đụng điểm = tiền, review opus hai lượt).

Bối cảnh: apps/api/src/modules/loyalty/loyalty-expiry.service.ts hàm thuần computePointExpiry replay sổ lô STANDARD theo FIFO: mỗi delta dương là một lô, mỗi delta âm tiêu dần lô CŨ NHẤT. Ngoại lệ đã có: dòng POINTS_EXPIRED ăn các lô đã hết hạn tại thời điểm nó ghi (PE-1a), và dòng âm refType REVIEW có refId ăn trước vào lô dương cùng refType/refId (PE-3, commit 0d0bf01d, đọc commit này và test của nó trước khi làm: git show 0d0bf01d).
Nghi vấn cần CHỨNG MINH TRƯỚC BẰNG TEST (race spec Postgres thật, theo mẫu apps/api/test/integration-race/pe3-reward-expiry.race-spec.ts và loyalty-refund-expiry.race-spec.ts, dựng "thời gian trôi" bằng cách lùi createdAt/expiresAt như các spec đó): LoyaltyService.reverseOrderPoints ghi dòng ORDER_REVERSED:<mã> (delta âm, refType ORDER, refId order.id) để thu hồi điểm đã cộng ở ORDER_DELIVERED:<mã> (cùng refId), nhưng computePointExpiry replay dòng âm này vào lô CŨ NHẤT. Nếu khách có lô cũ hơn (ví dụ lô không hạn 30, hoặc lô hết hạn muộn hơn) thì: lô ORDER_DELIVERED (có hạn) vẫn nguyên trong replay, tới hạn cron lại trừ chính số điểm đã thu hồi, khách mất điểm hai lần. Dựng ca: lô cũ không hạn 30; đơn giao +20 có hạn; huỷ/trả đơn (dòng ORDER_REVERSED −20); ageLedger qua hạn; chạy cron hai lần → kỳ vọng số dư 30 và không có POINTS_EXPIRED; nếu hiện tại ra 10 thì đã chứng minh lỗi. Nếu KHÔNG tái hiện được thì báo cáo ngắn gọn bằng chứng và dừng mục 1 (không sửa mã không lỗi).
Mục 1 (nếu lỗi được chứng minh): tổng quát hoá cơ chế của REVIEW_DELETE thành "dòng âm đảo ngược một khoản cộng cụ thể": liệt kê TOÀN BỘ dòng âm lô STANDARD có refType/refId trỏ tới một dòng dương trong sổ (grep mọi pointsTransaction.create/applyPointsDelta với delta âm: ORDER_REVERSED, REVIEW_DELETE, thu hồi thưởng giới thiệu (REFERRAL clawback / reason của PA-7 và PD-3), đảo điểm game/mission nếu có, trừ điểm khi xoá cộng đồng... — tự tra, đừng tin danh sách này) và quyết cái nào thật sự là đảo ngược một lô (ăn lô cùng refType/refId trước, phần dư FIFO) và cái nào là TIÊU (ORDER_REDEEM, đổi voucher, góp quỹ cây: phải tiếp tục FIFO). Làm cơ chế khớp bằng refType+refId (không khớp bằng chuỗi reason mong manh) nếu được; PointExpiryTxn cần refType/refId. Thêm test đột biến: bỏ cơ chế → race spec đỏ. Bảo đảm bất biến cũ: kết quả y hệt khi không có dòng đảo ngược; cron chạy lại không trừ lần hai; findPointsLotDrift rỗng; pointsBalance = tổng dòng STANDARD.
Mục 2: hai bản sao công thức hạn khác LoyaltyService.pointsExpiresAt: creditOrderPoints (loyalty.service.ts) và RewardPointsService.expiresAt (wallet) — PE-3 báo cáo chúng khác khi loyalty.point_expire_months là 0 hoặc âm. Đọc mã, viết test chứng minh khác biệt (nếu có), rồi cho cả hai dùng pointsExpiresAt (hoặc helper chung) nếu không đổi hành vi với cấu hình hợp lệ (>0); ghi rõ hành vi với 0/âm trước và sau. Nếu thay đổi hành vi hợp lệ thì KHÔNG sửa, chỉ ghi vào báo cáo.
Mục 3 (báo cáo, không sửa mã): nêu tác động hồi tố của cơ chế mới lên sổ đã ghi trước bản này (replay đổi nghĩa cho dòng cũ): câu SQL đếm user bị ảnh hưởng để chạy trên DB có dữ liệu trước deploy (chưa có khách thật nhưng bản thử VPS có thể có dữ liệu).
Nhóm file: apps/api/src/modules/loyalty/**, apps/api/src/modules/wallet/** (chỉ RewardPointsService.expiresAt), apps/api/test/integration-race/** (spec mới). KHÔNG sửa checkout, order-reversal, schema.prisma/migration.`

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    bugReproduced: { type: 'boolean' },
    verification: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exitCode: { type: 'number' }, summary: { type: 'string' } }, required: ['command', 'exitCode', 'summary'] } },
    unverified: { type: 'array', items: { type: 'string' } },
    designNotes: { type: 'string' },
  },
  required: ['commits', 'verification', 'unverified', 'bugReproduced'],
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

function reviewPrompt(round, prior) {
  return `Bạn là reviewer độc lập, chỉ đọc (không sửa file trong worktree, không commit). Review lượt ${round} gói PE-5.
Worktree: ${WT} (nhánh ${BR}). Diff: git -C ${WT} diff ${BASE}..HEAD. Đọc file đầy đủ quanh các chỗ đổi.
Export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH trước mọi lệnh. Nếu cần Postgres: docker run -d --rm --name tubu_rv_pe5_${round} --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${PORT + 10 + round}:5432 postgres:16-alpine, migrate deploy, rồi docker rm -f -v khi xong. Không push, không đụng worktree khác, không pkill rộng.
Mục tiêu gói:
${SPEC}
Đây là gói đụng điểm (tiền trả trước của khách): tấn công nó. Tự grep độc lập MỌI dòng âm lô STANDARD (đừng tin danh sách của tác giả): dòng nào bị phân loại nhầm giữa "đảo ngược một lô" và "tiêu"? Khớp refType/refId có thể khớp nhầm lô (cùng refId khác refType, nhiều dòng dương cùng refId, đảo ngược nhiều lần/một phần)? Kết quả có đổi cho sổ không có dòng đảo ngược? Cron chạy lại có trừ lần hai không? Dòng đảo ngược lớn hơn lô gốc (phần dư) xử lý sao? Thứ tự createdAt trùng mili giây? Mục 2 có đổi hành vi cấu hình hợp lệ không? Dựng test/lệnh thật chứng minh khi có thể; finding chỉ "có vẻ" thì ghi rõ chưa chứng minh.
${prior ? `Lượt trước có các finding sau; kiểm từng cái đã sửa thật chưa (chạy lại test chứng minh) và tìm vấn đề mới do bản sửa:\n${JSON.stringify(prior)}` : ''}
Mặc định nghi ngờ; chỉ gắn blocker/major khi có bằng chứng cụ thể (file:line hoặc lệnh). Ghi lệnh đã chạy vào ranCommands.`
}

phase('Implement')
const impl = await agent(`Bạn là kỹ sư thực hiện gói PE-5 của dự án Tubu Tree (hardening 2026-10).
Worktree: ${WT} (nhánh ${BR}, base ${BASE}). Làm CHỈ trong đó. Cổng Postgres race của gói: ${PORT}.

${SPEC}

${COMMON}`, { label: 'impl:PE-5', phase: 'Implement', schema: IMPL_SCHEMA, model: 'sonnet' })
if (!impl) return { error: 'implement null' }
phase('Review')
const r1 = await agent(reviewPrompt(1, null), { label: 'review1:PE-5', phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
let fix = null, r2 = null
if (r1 && r1.findings.length > 0) {
  phase('Fix')
  fix = await agent(`Bạn đang sửa gói PE-5 theo review độc lập. Worktree: ${WT} (nhánh ${BR}). Làm CHỈ trong đó.
Các finding (blocker/major bắt buộc sửa; minor sửa nếu rẻ và an toàn, còn lại ghi lý do bỏ trong báo cáo):
${JSON.stringify(r1.findings, null, 2)}
Với mỗi finding: xác minh trên mã trước (reviewer có thể sai; nếu sai ghi bằng chứng, không sửa), viết test đỏ nếu là lỗi hành vi, sửa, commit riêng. Cập nhật impl/PE-5.md (mục "Sau review") và commit.
Cổng Postgres race của gói: ${PORT}.
${COMMON}`, { label: 'fix:PE-5', phase: 'Fix', schema: IMPL_SCHEMA, model: 'sonnet' })
}
phase('Review')
r2 = await agent(reviewPrompt(2, r1 ? r1.findings : null), { label: 'review2:PE-5', phase: 'Review', schema: REVIEW_SCHEMA, model: 'opus', effort: 'high' })
return { id: 'PE-5', branch: BR, worktree: WT, impl, review1: r1, fix, review2: r2 }
