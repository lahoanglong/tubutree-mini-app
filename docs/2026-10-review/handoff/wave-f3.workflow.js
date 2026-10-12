export const meta = {
  name: 'tubutree-2026-10-wave-f3',
  description: 'Đợt F3: PF-5a chặn vòng quay tiêu điểm đơn trong cửa sổ đổi trả (API điểm, review opus hai lượt) và PF-5b dọn minor còn lại của miniapp/web/content-kit (review opus)',
  phases: [
    { title: 'Implement', detail: 'worker sonnet trong worktree riêng' },
    { title: 'Review', detail: 'reviewer opus độc lập' },
    { title: 'Fix', detail: 'sửa theo review' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app'
const BASE = '6c504cf8'
const WT = (id) => ROOT + '/.claude/worktrees/hz17-' + id
const BR = (id) => 'hz17/' + id

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
- Việc đầu tiên: cd vào worktree, pnpm install --frozen-lockfile, pnpm --filter @tubutree/shared-types build, và nếu gói đụng API: (cd apps/api && npx prisma generate). Không có timeout trên macOS: dùng until-loop hoặc chạy nền. Luôn dùng đường dẫn tuyệt đối (cwd shell có thể bị reset).
- TDD: viết test đỏ trước, thấy đỏ đúng lý do, rồi sửa cho xanh. Lỗi nào không viết được test tái hiện thì nói rõ vì sao và cách đã kiểm. Từng mục một commit riêng. Commit message tiếng Việt văn xuôi thường, kết thúc bằng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Mục nào xác minh trên mã thấy KHÔNG phải lỗi (đã sửa từ trước, hay không tái hiện): ghi bằng chứng vào báo cáo, không sửa mã không lỗi.
- Comment trong code chỉ giải thích "vì sao" không hiển nhiên, không tả thay đổi vừa làm. Không ghi "chủ dự án nói" vào file. Thuật ngữ Q-26: "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước". Component DS v2 sẵn có (apps/miniapp/src/components/ui, packages/design-tokens); vùng chạm >=44px; ESLint tubu-ds của file đã sửa phải 0 lỗi (--max-warnings=0).
- Docker (nếu cần Postgres cho race spec): docker run -d --rm --name <tên> --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p <cổng>:5432 postgres:16-alpine ; DB tên tubutree_it; chạy prisma migrate deploy (DATABASE_URL=postgresql://tubu:tubu@localhost:<cổng>/tubutree_it?schema=public) trước; kết thúc docker rm -f -v <tên>. Không pkill rộng; chỉ kill listener cổng của mình.
- Chạy kiểm CHỈ phạm vi gói: tsc --noEmit package đã sửa, ESLint file đã sửa (--max-warnings=0), test (jest/vitest) của file/module đã sửa, race spec nếu có. KHÔNG chạy Playwright e2e, capture/axe hay full suite (điều phối viên chạy). Phần chưa chạy ghi "unverified".
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
  'PF-5a': { id: 'PF-5a', money: true, port: 5701,
    spec: `GÓI PF-5a — API: vòng quay phải tôn trọng lockedOrderPoints (đụng điểm = tiền trả trước; review opus hai lượt). Đọc trước: docs/2026-10-review/impl/PF-3.md, PE-5.md, apps/api/src/modules/loyalty/loyalty.service.ts (reverseOrderPoints ~dòng 130-230, lockedOrderPoints ~dòng 400), loyalty-expiry.service.ts, apps/api/src/modules/game/game.service.ts (buyTree ~dòng 360-420 là mẫu đúng).
Bug (review opus lượt 2 của PF-3 tìm ra, đã xác minh sơ bộ bởi điều phối viên): GameService.spin() chỉ kiểm pointsBalance >= cost rồi trừ bằng updateMany gte; KHÔNG trừ lockedOrderPoints (điểm của đơn còn trong cửa sổ đổi trả). Khách giao đơn nhận +20 Điểm Xanh (đang bị khoá vì đơn còn đổi trả được), quay vòng quay tiêu hết 20 điểm, rồi trả hàng: thu hồi điểm đơn bị chặn bởi số dư (PF-3 giữ "không âm số dư") nên khách giữ nguyên điểm của đơn đã trả. Checkout, đổi voucher (redeemReward) và góp quỹ cây (buyTree) đều đã chặn; chỉ spin thiếu.
Việc cần làm:
1. spin(): khoá dòng user (SELECT ... FOR UPDATE) trong transaction rồi chỉ cho tiêu phần DÙNG ĐƯỢC = pointsBalance − lockedOrderPoints (gọi loyalty.lockedOrderPoints(userId, new Date(), tx) giống buyTree); từ chối với thông báo tiếng Việt cùng mẫu buyTree (dùng loyalty.lockedPointsMessage khi locked > 0). Giữ nguyên: thứ tự đếm giới hạn lượt/ngày sau khi giữ khoá, lô STANDARD/hạn thưởng điểm (winExpiresAt), không âm số dư, ledger đúng như hiện tại. Chú ý spin dùng pointsBalance (lô STANDARD); xem spin có chạm lô CONVERTED không và giữ đúng mô hình PD-3.
2. Race test thật trên Postgres (apps/api/test/integration-race/pf5-spin-locked-points.race-spec.ts, theo mẫu các race spec pf3-*): (a) đơn giao +20 đang khoá, số dư chỉ gồm 20 điểm đó, spin bị từ chối, số dư không đổi, không có dòng GAME_SPIN; (b) số dư dư phần không khoá thì spin chỉ trừ được trong phần dùng được; (c) kịch bản đầy đủ: spin bị chặn, trả hàng, thu hồi đủ 20; (d) spin song song với trả hàng cùng khách: số dư không âm, không mất điểm không có lý do, không deadlock (thứ tự khoá user rồi ledger nhất quán với reverseOrderPoints); (e) mutation: bỏ bản sửa test (a) phải đỏ.
3. Rà MỌI chỗ khác trừ điểm tiêu của chính khách mà không qua lockedOrderPoints: grep pointsBalance decrement/applyPointsDelta với delta âm trong apps/api/src (đã thấy: game.service.ts:130 spin, game.service.ts:~628, loyalty.service.ts:221 và 647, checkout.service.ts:311, referral-reward.ts:167, reviews.service.ts:301, points-ledger.ts:80). Phân loại: chi tiêu của khách (phải chặn) và thu hồi/hết hạn (không chặn). Đường chi tiêu nào còn thiếu thì sửa cùng cách và có race test; đường nào không phải chi tiêu thì ghi một dòng lý do vào báo cáo.
4. Sửa hai comment sai: loyalty.service.ts (~dòng 139-141) và loyalty-expiry.service.ts (~195-198) đang khẳng định "số dư trong cửa sổ đổi trả luôn đủ để thu hồi nhờ lockedOrderPoints". Sau bản sửa: nêu đúng các đường chi tiêu đã bị chặn bởi lockedOrderPoints, và rằng thu hồi bị chặn bởi số dư chỉ còn là lưới an toàn cuối (đường thu hồi/hết hạn không phải chi tiêu thì không bị chặn; nếu còn đường chi tiêu nào không chặn thì nói rõ).
5. docs/2026-10-review/impl/PF-3.md: dòng ~67 còn viết REVIEW_DELETE có thể có delta 0 và lịch sử có thể hiện dòng 0, đã cũ sau commit abf37df5 (REVIEW_DELETE không ghi dòng 0; ORDER_REVERSED delta 0 bị lọc khỏi lịch sử khách). Cập nhật cho đúng trạng thái hiện tại và thêm mục "Sau review lượt 2" ghi finding này và cách xử lý.
Ghi báo cáo vào docs/2026-10-review/impl/PF-5a.md. Ghi thêm: miniapp (pages game/spin) hiển thị lỗi 400 của API thế nào (chỉ đọc, KHÔNG sửa miniapp ở gói này) để điều phối viên biết thông báo mới có tới tay khách không.
Nhóm file: apps/api/src/modules/game/**, apps/api/src/modules/loyalty/** (chỉ comment, trừ khi rà ở mục 3 cho thấy phải sửa mã), apps/api/src/modules/reviews/** và checkout/** CHỈ nếu mục 3 phát hiện lỗ hổng chi tiêu thật, apps/api/test/integration-race/pf5-*, docs/2026-10-review/impl/{PF-3,PF-5a}.md. KHÔNG sửa apps/miniapp, apps/web, packages/**.` },
  'PF-5b': { id: 'PF-5b', money: false, port: 5702,
    spec: `GÓI PF-5b — Dọn các minor còn lại từ review opus của PF-1/PF-2/PF-3/PF-4 (miniapp, web, link Content Kit). Đọc báo cáo docs/2026-10-review/impl/PF-1.md, PF-2.md, PF-3.md, PF-4.md trước.
Mục:
1. apps/miniapp/src/pages/product-detail.tsx: mỗi route đúng một <h1> ở MỌI trạng thái. Hiện chỉ trạng thái bình thường có h1; nhánh đang tải (PdpSkeleton ~dòng 1029) và nhánh lỗi/không thấy sản phẩm (~dòng 237-243) không có. Thêm <h1 style={SR_ONLY}>Chi tiết sản phẩm</h1> (như bank-payment đã làm) và test trong pages/product-detail-a11y.spec.tsx: đúng một h1 ở lúc tải và lúc lỗi.
2. apps/miniapp/src/components/ui/form.spec.tsx (~dòng 196) có ca 'Checkbox không tên vẫn nhận onChange khi bấm' ghim hợp đồng đã sai trên trình duyệt thật: hitArea giờ có inert nên chấm không tên là thuần hình, cú chạm xuyên qua hàng cha (jsdom bỏ qua inert nên test xanh giả). Sửa chú thích DECORATIVE_INPUT ở form.tsx (~dòng 104-107, đang viết "vẫn bấm/đổi giá trị bình thường") và đổi/bỏ ca test đó cho đúng hợp đồng mới (hàng cha giữ onClick, chấm không tên chỉ dùng với onChange no-op; nêu rõ jsdom không mô phỏng inert). Nếu rẻ, thêm test tĩnh: mọi chỗ gọi Checkbox/Radio/Switch không tên chỉ dùng onChange no-op (grep các chỗ checkout.tsx, subscription-options.tsx).
3. apps/miniapp/src/pages/order-detail.tsx ~dòng 221: 1 nút vi phạm axe color-contrast (3,84:1 vì opacity: 0.8). Bỏ opacity (hoặc dùng token màu đủ >= 4,5:1) mà vẫn giữ ý định thị giác (trạng thái phụ); tính tỉ lệ tương phản từ giá trị token thật trong packages/design-tokens để chứng minh >= 4,5:1; thêm test nếu có cách (ví dụ kiểm style không còn opacity < 1 trên nút đó).
4. apps/miniapp/src/components/reviews-section.tsx (~tìm chỗ báo "Đã cộng Điểm Xanh" khi updated=false): sau PF-3 thưởng đánh giá chỉ nhận một lần cho mỗi (khách, sản phẩm), nên API có thể trả pointsEarned = 0 khi tạo lại sau xoá. Chỉ hiện "Đã cộng N Điểm Xanh" khi pointsEarned > 0; ngược lại thông báo trung tính "Đã gửi đánh giá" (đúng thuật ngữ Q-26). Đọc response thật của reviews.service.ts để biết trường nào. Test vitest cho cả hai nhánh.
5. apps/miniapp/src/components/home/use-block-query.ts: lastError ref phải theo từng lần mount (không dùng chung giữa các instance / lẫn giữa các lần mount). Xác minh trên mã trước, viết test đỏ nếu tái hiện (hai instance hoặc unmount/mount lại), sửa.
6. apps/miniapp/src/pages/brand-story.tsx (~dòng 383): ghim bản đồ aria-hidden còn aria-label vô nghĩa chỉ để test tìm; đổi sang data-testid nếu rẻ và cập nhật test; nếu test/e2e khó đổi thì bỏ qua và ghi lý do.
7. apps/web/src/app/merchant/page.spec.tsx (~dòng 475): tên test nói mọi trường có <label for/id> nhưng kiểm bằng unlabeledFields (chấp nhận placeholder như tên truy cập), nên 15/20 cặp htmlFor/id không được bảo vệ. Thêm khẳng định: mọi label[for] trỏ tới control tồn tại, và mọi input/select/textarea của form (trừ hidden/submit/button) có el.labels.length > 0; nếu đỏ thì sửa trang (apps/web/src/app/merchant/page.tsx) cho đủ for/id; hoặc đổi tên test cho đúng nếu không thể.
8. apps/web/src/lib/no-raw-date-format.spec.ts (~dòng 22): regex RAW_DATE chỉ bắt dạng new Date(<không ngoặc>).toLocaleString(. Mở rộng theo mẫu miniapp/pages/format-guard.spec.ts: không file nào trong apps/web/src (trừ lib/format-date.ts) được gọi .toLocaleDateString( / .toLocaleTimeString( / .toLocaleString( trên đối tượng ngày; số thì được (formatNumber hay toLocaleString trên số, hãy tách đúng: đọc cách web format số hiện nay; nếu không phân biệt được bằng regex thì bắt .toLocale(Date|Time)String( và với .toLocaleString( thì danh sách ngoại lệ có tên file và lý do). Sửa các chỗ vi phạm còn lại nếu ít; nhiều thì ghi giới hạn vào comment spec và báo cáo.
9. Link Content Kit ở NƠI SINH (PF-4 chỉ thêm redirect 307 ở web apps/web/src/app/product/[slug]/route.ts vì ngoài nhóm file): apps/api/src/modules/content-kit/content-kit.service.ts (~dòng 50) sinh \`\${baseUrl}/product/\${slug}\` và apps/miniapp/src/components/content-kit-sheet.tsx (hàm absoluteLink) cũng vậy. Xác minh baseUrl trỏ miniapp hay web; nếu link đi tới miền WEB thì phải sinh đúng đường web thật (xem apps/web/src/app/san-pham/[slug] hoặc route tương đương PF-4 đã redirect tới); nếu trỏ miniapp thì giữ nguyên và ghi bằng chứng. Giữ redirect cho link đã chia sẻ. Test jest cho content-kit.service (và vitest miniapp nếu đổi absoluteLink).
Ghi báo cáo docs/2026-10-review/impl/PF-5b.md.
Nhóm file: apps/miniapp/src/pages/{product-detail,order-detail,brand-story}* , apps/miniapp/src/components/{ui/form*,reviews-section*,content-kit-sheet*,home/use-block-query*}, các file test cạnh chúng, apps/e2e/tests/** (chỉ cập nhật selector bị đổi), apps/web/src/app/merchant/**, apps/web/src/lib/no-raw-date-format.spec.ts và file web vi phạm ở mục 8, apps/api/src/modules/content-kit/**. KHÔNG sửa apps/api/src/modules/{game,loyalty,reviews,checkout}.` },
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
Export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH trước mọi lệnh. Bạn được chạy test của phạm vi gói (jest/vitest/tsc/eslint). ${p.money ? `Nếu cần Postgres: docker run -d --rm --name tubu_rv_pf5a_${round} --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${5710 + round}:5432 postgres:16-alpine, migrate deploy, rồi docker rm -f -v khi xong.` : 'KHÔNG chạy capture/Playwright/trình duyệt; chỉ đọc mã và chạy vitest/jest/tsc/eslint của phạm vi gói.'} Không push, không đụng worktree khác, không pkill rộng.
Mục tiêu gói:
${p.spec}
${p.money ? `Đây là gói đụng điểm (tiền trả trước): tấn công nó. Bản sửa có thật sự chặn mọi đường tiêu điểm đơn trong cửa sổ đổi trả không (tự grep lại toàn bộ chỗ trừ điểm của khách, đừng tin bảng của tác giả), có mở lỗi mới (số dư âm, trừ hai lần, deadlock do thứ tự khoá user/ledger khi chạy song song với reverseOrderPoints/checkout/cron hết hạn, giữ khoá lâu, vượt trần lượt quay/ngày), test có thể xanh dù mã sai không (kiểm đột biến: bỏ bản sửa xem test có đỏ), comment đã đúng sự thật chưa. Dựng test/lệnh thật khi có thể; finding chỉ "có vẻ" thì ghi chưa chứng minh.` : `Tìm: hồi quy hành vi ngoài mục tiêu, test yếu (xanh dù mã sai: kiểm đột biến bằng cách bỏ bản sửa), mục báo "fixed" mà mã không thật sự giải quyết lỗi, mục báo "not-a-bug" thiếu bằng chứng, vi phạm luật tubu-ds/thuật ngữ Q-26, file sửa ngoài nhóm file của gói.`}
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
return await Promise.all([flow('PF-5a'), flow('PF-5b')])
