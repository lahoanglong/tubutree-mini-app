export const meta = {
  name: 'tubutree-2026-10-wave-d2',
  description: 'Đợt D vòng D2: PD-3 gộp TubuXu vào Điểm Xanh (Q-03/Q-03a). Giai đoạn spec (opus, chỉ đọc code + viết spec) rồi giai đoạn impl (worktree hz9-PD-3, review opus hai lượt)',
  phases: [
    { title: 'Spec', detail: 'opus khảo sát toàn bộ điểm đụng xu và viết spec PD-3' },
    { title: 'Implement', detail: 'từng mục một agent trong worktree hz9-PD-3' },
    { title: 'Review', detail: 'reviewer opus độc lập hai lượt + kiểm bất biến tiền' },
    { title: 'Fix', detail: 'sửa theo review' },
  ],
}

function sem(max) {
  let active = 0
  const waiters = []
  return {
    async acquire() { if (active < max) { active++; return } await new Promise(r => waiters.push(r)) },
    release() { const w = waiters.shift(); if (w) w(); else active-- },
  }
}
const TOTAL = sem(args.maxAgents || 1)
async function run(prompt, opts) {
  await TOTAL.acquire()
  try { return await agent(prompt, opts) } finally { TOTAL.release() }
}

const BASE = args.base
const REPO = args.repo
const NODEBIN = args.nodebin
const ID = 'PD-3'
const WT = REPO + '/.claude/worktrees/hz9-' + ID
const BR = 'hz9/' + ID

const SPEC_FILE = 'docs/2026-10-review/impl/PD-3-SPEC.md'

const DECISIONS = `QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (BẮT BUỘC, docs/2026-10-review/00-ROADMAP.md mục 9):
- Q-03: GỘP ngay TubuXu vào Điểm Xanh trong đợt này. Khách chỉ còn: Ví Tubu (tiền thật VND, rút được), Điểm Xanh, Mã giảm giá. Bỏ đổi Ví -> Xu. (Findings-catalog Q-03 phương án 1: "Gộp xu thưởng vào Điểm Xanh, bỏ đổi Ví -> Xu, cho Ví trả một phần đơn". Phần "Ví trả một phần đơn" đã có/không thuộc gói này nếu mã hiện tại đã cho: tự kiểm.)
- Q-03a: quy đổi số dư xu hiện có: 1.000 xu = 1 Điểm Xanh, LÀM TRÒN LÊN (ceil). Lô quy đổi KHÔNG hết hạn, KHÔNG bị trần 20% đơn (loyalty.max_redeem_pct) khi dùng, KHÔNG ra tiền mặt (không rút, không chuyển Ví). Xu mua từ Ví là tiền trả trước nên không được hết hạn và phải giữ sổ giao dịch cũ (coin_transactions không xoá).
- Giá trị hiện hành: 1 xu = 1đ khi trả đơn (payment method XU); 1 Điểm Xanh = loyalty.vnd_per_point_redeem = 1.000đ => quy đổi bảo toàn giá trị, làm tròn lên có lợi cho khách tối đa 999đ/người (tính tổng chi phí này trên số dư thật và ghi vào spec).
- Q-26 thuật ngữ: "Điểm Xanh", "Ví Tubu", "Mã giảm giá", "giọt nước"; chữ "TubuXu" biến mất khỏi mọi chỗ hướng khách sau gói này.
- PA-5 và PA-7 đã cố ý không tạo thêm luồng xu mới; Q-02 đã bỏ mua giọt nước bằng xu; PD-1 đã ẩn Season Pass và đổi "cây thật" thành "góp quỹ trồng cây" (có thể đang chạy song song, tránh đụng các file đó ngoài việc đổi đơn vị xu -> Điểm Xanh).`

function specPrompt() {
  return `Bạn là KIẾN TRÚC SƯ TIỀN (opus) cho gói PD-3 của đợt hardening Tubu Tree: gộp TubuXu (users.coinsBalance + coin_transactions, payment method XU) vào Điểm Xanh (users.pointsBalance + points_transactions). Đây là thay đổi chạm TIỀN TRẢ TRƯỚC của khách (xu mua từ Ví với thưởng x1.2 là tiền thật). Giai đoạn này CHỈ ĐỌC code và VIẾT SPEC, KHÔNG sửa mã nguồn.
Môi trường: mọi lệnh shell bắt đầu bằng export PATH=${NODEBIN}:$PATH; cd ${WT} && ... Worktree: ${WT} (nhánh ${BR}, tách từ hardening/2026-10 commit ${BASE}). Mọi đường dẫn nằm dưới ${WT}. Repo chính ${REPO} là của điều phối viên: không sửa. Máy có thể sập: ghi file spec sớm rồi cập nhật, commit ngay sau mỗi phần lớn (git add <file cụ thể>; message kết thúc bằng đúng dòng "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"). CẤM git stash/reset/checkout/restore/rebase/push/merge, deploy, đụng PROD hay DB dùng chung.
${DECISIONS}
Tài liệu cần đọc: docs/2026-10-review/00-ROADMAP.md, findings-catalog.md (C-047, C-105, Q-03, Q-26), 01-pm.md (A1-001), 02-arch-data.md (A2-019), impl/PA-5.md, PA-7.md, PB-3.md (sổ cái ví, WalletLedgerService), impl/PD-1.md nếu đã có, docs/superpowers/specs/2026-06-24-tubuxu-referral-cashback-design.md (thiết kế gốc của xu), apps/api/src/modules/{wallet,loyalty,checkout,game,affiliate,feed,auth,storefront,users,orders}/** và apps/api/prisma/schema.prisma + migration của partial unique index trên coin_transactions/points_transactions (apps/api/prisma/check-partial-indexes.ts liệt kê 14 index).
NHIỆM VỤ: viết ${SPEC_FILE} (tiếng Việt, có bảng, trích dẫn file:dòng) gồm ĐỦ các mục sau, mỗi khẳng định có bằng chứng từ mã thật (tự grep, không đoán):
 1. KIỂM KÊ: mọi nơi cộng/trừ/đọc coinsBalance, CoinTransaction, paymentMethod 'XU', 'xu' trong thông báo/template, admin web, miniapp, web khách, e2e, seed, khoá SystemConfig (coins.*, game.*xu*), cron, partial unique index trên coin_transactions (tên + điều kiện), reason/refType đang dùng. Bảng: file:dòng | hành động (grant/spend/convert/refund/read/display) | đơn vị và số tiền hiện tại | khoá config.
 2. MÔ HÌNH ĐIỂM sau gộp: biểu diễn "lô quy đổi không hết hạn, không trần 20%" như thế nào trong points_transactions/pointsBalance (đọc loyalty.service.ts, loyalty-expiry.service.ts, pricing resolvePointsRedemption, lockedOrderPoints, tier calc tierPointsWhere): cách tách số dư theo loại (hết hạn có trần / không hết hạn không trần), thứ tự tiêu (ưu tiên điểm sắp hết hạn có trần trước, phần còn lại từ lô quy đổi không trần? chứng minh không làm khách thiệt/lợi sai), cách hết hạn không động tới lô quy đổi, cách xét hạng KHÔNG tính điểm quy đổi (Q-09: hạng chỉ tính mua), khoá/đảo điểm khi đơn bị huỷ/trả (hoàn về đúng loại lô), điểm danh/thưởng.
 3. MIGRATION số dư (SQL idempotent, an toàn dữ liệu PROD, áp lên DB trống và lên bản sao có dữ liệu): với mỗi user coinsBalance > 0: points = ceil(coinsBalance/1000); ghi 1 dòng PointsTransaction (lô quy đổi, expiresAt NULL, refType riêng, refId = userId) + 1 dòng CoinTransaction âm (delta = -coinsBalance) để giữ bất biến coinsBalance == SUM(CoinTransaction.delta) rồi coinsBalance = 0; pointsBalance tăng đúng points; chỉ áp MỘT LẦN mỗi user (partial unique index hoặc bảng đánh dấu); không DROP, không xoá lịch sử; bảng chụp trước (snapshot) để hoàn tác; truy vấn đo tổng chi phí làm tròn lên và tổng giá trị chuyển đổi; xử lý số dư âm/null/đơn đang chờ trả bằng XU (PENDING?) và giao dịch đang chạy trong lúc migrate (thứ tự deploy: tắt ghi xu trước khi migrate). Viết SQL mẫu hoàn chỉnh trong spec.
 4. NGUỒN CỘNG XU hiện có (đổi Ví -> xu x1.2, thưởng giới thiệu/mốc, cộng đồng, nhiệm vụ gian hàng, game, auth/welcome, affiliate milestone, hoàn đơn trả bằng XU...): với từng nguồn: số tiền + đơn vị hiện tại + khoá config -> cách trả bằng Điểm Xanh sau gộp (công thức, làm tròn, hạn dùng điểm mới thưởng, cơ chế idempotent thay cho partial unique index trên coin_transactions: tên index mới trên points_transactions). CẢNH BÁO RỦI RO ĐƠN VỊ: giá trị config đang tính bằng XU (vd 20.000) KHÔNG được hiểu thành 20.000 Điểm Xanh (=20 triệu đồng): spec phải nêu cách đổi giá trị config (khoá mới tính bằng điểm hoặc chia 1.000 lúc cấp), có test chặn.
 5. BỎ ĐỔI VÍ -> XU: endpoint WalletService.convertToXu (+ UI) tắt thế nào (trả lỗi rõ hay gỡ), WalletTxType.XU_CONVERT giữ cho lịch sử; thưởng x1.2 chấm dứt.
 6. NƠI TIÊU XU: payment method XU ở checkout (bỏ khỏi lựa chọn; đơn XU cũ vẫn tồn tại: huỷ/trả hoàn bằng gì? -> Điểm Xanh lô quy đổi, làm tròn ra sao, dòng hoàn ghi sổ thế nào), game (mua hạt giống/cây/mở lô bằng XU: unlockPlot SEEDS/XU, buyTree...): quyết định tiêu bằng Điểm Xanh theo tỉ lệ 1.000:1 hay bỏ lối đó; nêu phương án khuyến nghị + hệ quả kinh tế (không để game rút Điểm Xanh quy đổi ra giá trị vượt tiền đã bỏ), xoá tài khoản (account-deletion.service), order-reversal.
 7. UI/API/chữ: danh sách màn miniapp/web/admin phải đổi (hub Cá nhân 'chỉ còn <=3 số dư', ví, checkout, game, thông báo, FAQ/about, admin), thuật ngữ Q-26, API trả về (coinsBalance còn trong payload? giữ trường = 0 hay bỏ + tương thích miniapp bản cũ chưa cập nhật: PROD hiện CHƯA có miniapp trên Zalo nên không có client cũ, nhưng web PROD (cb92dc8) có gọi gì liên quan xu không? kiểm git grep cb92dc8).
 8. TEST PLAN: unit + race spec Postgres thật (cộng/tiêu song song không âm, migrate chạy 2 lần không nhân đôi, tổng Điểm Xanh sau migrate == ceil theo từng user, bất biến SUM(points_transactions.delta) == pointsBalance (kiểm bất biến có đang đúng không), lô quy đổi không hết hạn khi cron chạy, không bị trần 20%, tiêu đúng thứ tự, hoàn đơn đúng lô, xét hạng không tính điểm quy đổi), test chặn lỗi đơn vị config (mục 4), test migration trên DB trống và trên dữ liệu mẫu.
 9. KẾ HOẠCH CÔNG VIỆC chia <= 5 mục cho 5 lượt implement tuần tự (mỗi mục: phạm vi file sở hữu, kiểm chứng chính), thứ tự an toàn (schema/migration + mô hình điểm + race test trước; rồi nguồn cộng; rồi nơi tiêu; rồi FE; rồi dọn chữ/seed/config).
 10. ROLLBACK + DEPLOY: thứ tự BE -> migrate -> web -> miniapp; cách tắt ghi xu trước migrate; cách hoàn tác bằng bảng snapshot; thứ phải theo dõi sau deploy.
 11. GIẢ ĐỊNH + CÂU HỎI MỞ cho chủ dự án (liệt kê rõ từng giả định có hệ quả tiền; đánh dấu cái nào đã được Q-03a quyết, cái nào do bạn đề xuất).
Cuối spec: bảng "Điểm rủi ro tiền" xếp theo mức độ + cách chặn. Commit file spec. Trả về StructuredOutput: status DONE nếu spec đủ 11 mục, head, note <= 12 dòng nêu các rủi ro lớn nhất và các câu hỏi mở.`
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'PARTIAL', 'SKIPPED', 'BLOCKED'] },
    head: { type: 'string' },
    note: { type: 'string' },
    tests: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, result: { type: 'string' } }, required: ['cmd', 'result'] } },
    migrations: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'head', 'note'],
}


const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'integer' }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'issue'] } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'findings', 'summary'],
}

const PORT = 5583
const DBURL = 'postgresql://tubu:tubu@localhost:' + PORT + '/tubutree_it?schema=public'

const IMPL_COMMON = `
BỐI CẢNH: Tubu Tree, monorepo pnpm + Turborepo (apps/api NestJS+Prisma, apps/web Next.js, apps/miniapp Zalo Mini App, apps/e2e Playwright, packages/*). macOS, shell zsh.
MÃ GÓI: PD-3 — gộp TubuXu vào Điểm Xanh (ĐỤNG TIỀN TRẢ TRƯỚC của khách). Bạn làm việc trong git worktree CỐ ĐỊNH: ${WT} (nhánh ${BR}). MỌI lệnh shell bắt đầu bằng: export PATH=${NODEBIN}:$PATH; cd ${WT} && ... (bắt buộc Node 22; shell không nhớ biến giữa các lệnh). MỌI đường dẫn Read/Edit/Write nằm dưới ${WT}. Repo chính ${REPO} là của điều phối viên: KHÔNG sửa gì ở đó.
SPEC LÀ LUẬT: đọc TRỌN ${SPEC_FILE} (trong worktree) trước khi làm; làm đúng mô hình, công thức, tên migration/index/cột, test T1..T21 và giả định trong spec. Chỗ spec mâu thuẫn với mã thật: ghi rõ trong báo cáo, chọn phương án AN TOÀN TIỀN hơn, không im lặng bỏ qua. Câu hỏi mở OQ-1..15: dùng đúng đề xuất mặc định của spec (chủ dự án chưa duyệt; ghi vào báo cáo "Việc cần chủ dự án").
MÁY CÓ THỂ SẬP: commit NGAY khi một bước xanh (git add <file cụ thể>, không dùng git add -A), commit sớm, commit nhiều. Đầu mỗi lượt: git status + git log --oneline ${BASE}..HEAD để biết lần trước làm tới đâu; mục đã commit và test xanh thì chỉ xác nhận (chạy lại test) rồi trả kết quả; thay đổi dở thì xem diff, hoàn thiện rồi commit.
DB TEST RIÊNG: container tubu_it_pd3 cổng ${PORT} (DB tubutree_it): DATABASE_URL=${DBURL}. Container tắt thì docker start tubu_it_pd3; mất thì docker run -d --name tubu_it_pd3 -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${PORT}:5432 postgres:16-alpine. Áp migration bằng npx prisma migrate deploy (trong apps/api), kiểm drift bằng npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code, kiểm index bằng npx tsx prisma/check-partial-indexes.ts (cập nhật số kỳ vọng). Race spec: DATABASE_URL=${DBURL} npx jest -c test/integration-race/jest.config.js --runInBand <file> (một file mỗi lần). KHÔNG ghi vào DB khác, KHÔNG đụng PROD.
QUY TRÌNH: TDD (test ĐỎ thấy được rồi mới sửa; refactor giữ hành vi thì test đặc tả trước). Mọi bất biến tiền có race spec Postgres thật. Mỗi bước một commit nhỏ trở lên; message "<type>(<scope>): <mô tả> (PD-3)", dòng trống, rồi đúng dòng: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Migration an toàn PROD: chỉ thêm / UPDATE idempotent, KHÔNG DROP/DELETE dữ liệu; áp được lên DB trống VÀ lên DB có dữ liệu mẫu (dựng dữ liệu mẫu bằng SQL: nhiều user, số dư xu 0/1/999/1000/1001/123456, sổ lệch, số âm, đơn XU đang chờ). Comment code chỉ giải thích "vì sao" không hiển nhiên. Giữ phong cách code xung quanh.
Test: chỉ spec liên quan (api: npx jest <spec> --maxWorkers=1; miniapp/web: npx vitest run <spec>, KHÔNG --maxWorkers). KHÔNG chạy full suite, KHÔNG Playwright, KHÔNG dev server (máy 15,5GB RAM, một job nặng một lúc; điều phối viên chạy). Được chạy tsc --noEmit và ESLint file đã sửa.
CẤM: git stash/reset/checkout/restore/rebase/push/merge/cherry-pick/switch; git worktree remove; deploy; đụng PROD; gọi dịch vụ ngoài thật; sửa file ngoài nhóm file của lượt (buộc phải thì tối thiểu + ghi lý do).
BÁO CÁO: ghi/append mục của bạn vào docs/2026-10-review/impl/PD-3.md trong worktree rồi commit: từng mục (XONG/MỘT PHẦN/BỎ + lý do), test thêm (đỏ -> xanh) kèm output thật, migration, khác biệt so với spec, giả định, việc còn lại, "Việc cần chủ dự án".
`

const LOOPS = [
  { k: 'L1', model: 'opus', scope: 'LƯỢT L1 theo spec mục 9: schema + migration A (lot/pointsConvertedBalance/pointsUsedConverted, index, CHECK) + migration B (quy đổi số dư một lần, bảng chụp, RAISE khi sổ lệch/âm) + SQL hoàn tác (đặt ở apps/api/prisma/manual/, KHÔNG tự chạy) + mô hình điểm theo lô (points-ledger.ts, lọc lot STANDARD trong hết hạn, points-reconcile theo lô, gộp khách, xoá tài khoản) + check-partial-indexes cập nhật + race spec T1-T5, T7, T15, T21. Migration đặt tên theo spec, timestamp tăng dần từ 20261012100000 trở đi.' },
  { k: 'L2', model: 'opus', scope: 'LƯỢT L2 theo spec mục 9 + mục 4: mọi NGUỒN CỘNG xu chuyển sang Điểm Xanh (RewardPointsService, referral, cộng đồng, nhiệm vụ gian hàng, affiliate milestone, season pass), migration đổi khoá config *_points (CEIL, KHÔNG chia nguyên), RANGES, khoá cũ DEAD, kiểm idempotent đọc HỢP hai sổ (points + coin_transactions cũ), test chặn lỗi đơn vị T16, race T13-T14. Migration timestamp tiếp theo sau L1.' },
  { k: 'L3', model: 'opus', scope: 'LƯỢT L3 theo spec mục 9 + 2.3 + 2.5 + 5 + 6: checkout chia lô (s, c) + bỏ phương thức XU + đơn 0đ ép COD + hoàn đúng lô (reverseOrderPoints) + đơn XU cũ huỷ/trả hoàn điểm quy đổi + game (bỏ mở lô bằng xu, góp quỹ trồng cây 50 điểm) + convert Ví->xu trả 410 + migration C đóng băng xu (CHECK users_coins_frozen) SAU khi mọi đường ghi xu đã gỡ; grep chứng minh không còn grantCoins/spendCoins/coinsBalance increment ngoài test và đọc lịch sử; race T6, T8-T12, T17, T18.' },
  { k: 'L4', model: 'sonnet', scope: 'LƯỢT L4 theo spec mục 7: FE miniapp + web + admin + shared-types: bỏ mọi hiển thị/đường vào "TubuXu/xu" (hub Cá nhân còn <= 3 số dư, ví, checkout bỏ chọn trả bằng xu + hiển thị "trong đó N điểm không hết hạn", đơn 0đ, game, thông báo, about/FAQ, admin account-deletion-panel, web order-view/export-csv) theo Q-26, cập nhật test T19. PD-1 đã vào nhánh nền: không đảo ngược việc của PD-1 (Season Pass ẩn, chữ "góp quỹ trồng cây"). Tuân thủ DS v2 (không alias legacy, không hex thô; guard ds-no-legacy-aliases.spec.ts).' },
  { k: 'L5', model: 'sonnet', scope: 'LƯỢT L5 theo spec mục 9: dọn chữ/seed/mẫu thông báo (migration UPDATE idempotent mẫu tin CASHBACK_PAID, COMMUNITY_BEST_ANSWER, mẫu mới XU_CONVERTED), chú thích API còn "xu", e2e mock apps/e2e/tests (không chạy được: ghi unverified, tsc xanh), T20, chạy lại toàn bộ T1-T21 + lệnh quét chữ mục 7.2 + truy vấn 3.3 trên DB mẫu; hoàn thiện docs/2026-10-review/impl/PD-3.md (bảng Việc cần chủ dự án = OQ-1..15 + chi phí làm tròn lên đo trên dữ liệu mẫu).' },
]

function loopPrompt(l) {
  return IMPL_COMMON + `
${l.scope}
Trả về StructuredOutput: status (DONE/PARTIAL/SKIPPED/BLOCKED), head = git rev-parse HEAD, note <= 10 dòng, tests [{cmd, result}] (lệnh đã chạy + kết quả thật), migrations (tên thư mục).`
}

function reviewPrompt(tag, scopeText, round) {
  const cname = 'tubu_it_pd3_r' + tag.toLowerCase() + round
  const rport = 5600 + (tag.charCodeAt(0) - 65) * 10 + round
  return `Bạn là REVIEWER ĐỘC LẬP (opus, tag ${tag}, lượt ${round}) cho gói PD-3 (gộp TubuXu vào Điểm Xanh, ĐỤNG TIỀN TRẢ TRƯỚC của khách) của đợt hardening Tubu Tree. Bạn KHÔNG nhận kết luận của người làm — tự đọc diff, spec và code, tự chạy lại test, tự thử phá.
Môi trường: mọi lệnh shell bắt đầu bằng export PATH=${NODEBIN}:$PATH; cd ${WT} && ... Worktree ${WT} (nhánh ${BR}). Base ${BASE}. Xem: git -C "${WT}" log --oneline ${BASE}..HEAD ; git -C "${WT}" diff ${BASE}..HEAD -- . ':!docs/2026-10-review/impl' (impl/*.md là lời tự báo, không phải bằng chứng). SPEC: ${SPEC_FILE} (đối chiếu từng mục, từng rủi ro R1..R12, từng test T1..T21).
${DECISIONS}
PHẠM VI LƯỢT REVIEW NÀY: ${scopeText}
Cách làm: (1) với MỖI đường tiền (cộng điểm, tiêu điểm, hoàn điểm, quy đổi số dư, hết hạn, gộp khách, xoá tài khoản) truy 3 kịch bản cụ thể qua code VÀ chạy thật khi được: song song 2 request, chạy lại lần 2 (idempotent), số biên (0, 1, 999, 1000, 1001, âm, null, Int overflow), đơn bị huỷ giữa chừng; (2) đơn vị xu <-> điểm: tìm MỌI chỗ còn đọc số tiền theo xu mà hiểu thành điểm (hoặc ngược lại), làm tròn ceil/floor sai hướng, config cũ còn được đọc; (3) bất biến: users.pointsBalance == SUM(delta lot STANDARD), pointsConvertedBalance == SUM(delta lot CONVERTED), coinsBalance == 0 và == SUM(coin_transactions) sau migrate; tự dựng DB mẫu (docker run -d --name ${cname} -e POSTGRES_USER=tubu -e POSTGRES_PASSWORD=tubu -e POSTGRES_DB=tubutree_it -p ${rport}:5432 postgres:16-alpine; npx prisma migrate deploy; chèn dữ liệu mẫu bằng SQL) chạy migration và các truy vấn bất biến, rồi docker rm -f ${cname}; (4) lô quy đổi KHÔNG hết hạn, KHÔNG bị trần 20%, KHÔNG ra tiền mặt/Ví, KHÔNG vào vòng quay/đổi voucher, KHÔNG tính hạng; (5) migration an toàn: áp lên DB trống và có dữ liệu, chạy 2 lần, thứ tự timestamp, không DROP/DELETE, drift 0, check-partial-indexes khớp; (6) test: có assert thật, không mock che lỗi, race spec thật sự song song; test cũ bị xoá/nới lỏng vô cớ; (7) lộ coinsBalance/xu còn sót ở FE/API/seed/thông báo (Q-26).
Chạy lại các test liên quan (jest --maxWorkers=1, race spec --runInBand một file mỗi lần, tsc, eslint). KHÔNG sửa code, KHÔNG git ghi, KHÔNG chạy full suite/Playwright.
Phân loại: blocker (sai tiền: nhân đôi/mất/âm điểm, hết hạn lô quy đổi, vượt trần sai chiều, quy đổi sai đơn vị, migration phá dữ liệu hoặc không idempotent, lộ lô quy đổi ra tiền), major (sai spec/quyết định, thiếu test quan trọng, race có thể xảy ra, lỗi luồng khách), minor (còn lại). Verdict CHANGES nếu có blocker hoặc major.
Trả về StructuredOutput: verdict, findings [{severity, file, line, issue, fix}], summary <= 10 dòng (kèm kết quả lệnh thật).`
}

function fixPrompt(tag, review, round) {
  return IMPL_COMMON + `
SỬA THEO REVIEW (tag ${tag}, lượt ${round}). FINDINGS của reviewer độc lập (JSON):
${JSON.stringify(review.findings, null, 1)}
Với mỗi blocker/major: xác minh lại bằng mã/test thật (reviewer có thể sai: nếu sai, giải thích bằng bằng chứng trong báo cáo, không sửa mù); nếu đúng: test đỏ trước rồi sửa, commit riêng "fix(<scope>): address review ${tag}${round} <ngắn> (PD-3)". Minor: sửa nếu rẻ và an toàn. Cập nhật docs/2026-10-review/impl/PD-3.md mục "Review ${tag}${round}" (từng finding: đã sửa / không sửa + lý do) và commit. Chạy lại race spec/jest bị ảnh hưởng.
Trả về StructuredOutput: status, head, note, tests, migrations.`
}

async function reviewLoop(tag, scopeText, maxRounds) {
  const out = { tag, rounds: [] }
  let round = 1
  while (round <= maxRounds) {
    const r = await run(reviewPrompt(tag, scopeText, round), { label: 'review' + tag + round + ':PD-3', phase: 'Review', model: 'opus', effort: 'high', schema: REVIEW_SCHEMA })
    out.rounds.push({ round, verdict: r && r.verdict, open: r && r.findings.filter(f => f.severity !== 'minor'), summary: r && r.summary })
    if (!r) break
    if (r.verdict === 'CHANGES') {
      const f = await run(fixPrompt(tag, r, round), { label: 'fix' + tag + round + ':PD-3', phase: 'Fix', model: 'sonnet', schema: ITEM_SCHEMA })
      out.rounds[out.rounds.length - 1].fix = f && { status: f.status, head: f.head, note: f.note }
      round++
      continue
    }
    break
  }
  return out
}

const stage = args.stage || 'spec'
if (stage === 'spec') {
  phase('Spec')
  log('PD-3 giai đoạn spec: một agent opus chỉ đọc code + viết ' + SPEC_FILE)
  const spec = await run(specPrompt(), { label: 'spec:PD-3', phase: 'Spec', model: 'opus', effort: 'high', schema: ITEM_SCHEMA })
  return { stage: 'spec', worktree: WT, branch: BR, spec }
}

// stage === 'impl': L1 -> review A (schema/mô hình) -> L2 -> L3 -> review B (cộng/tiêu) -> L4 -> L5 -> review C + D (toàn bộ diff, hai lượt độc lập)
phase('Implement')
log('PD-3 impl: 5 lượt tuần tự trong ' + WT + '; review A sau L1, review B sau L3, review C/D cuối (toàn diff)')
const done = []
const reviews = []
async function loop(l) {
  const r = await run(loopPrompt(l), { label: 'impl:PD-3:' + l.k, phase: 'Implement', model: l.model, effort: l.model === 'opus' ? 'high' : undefined, schema: ITEM_SCHEMA })
  done.push({ k: l.k, status: r ? r.status : 'FAILED', head: r && r.head, note: r ? r.note : 'agent null', migrations: r && r.migrations })
  return r
}
const L = (k) => LOOPS.find(x => x.k === k)

const r1 = await loop(L('L1'))
if (!r1 || r1.status === 'BLOCKED') return { stage, done, reviews, stopped: 'L1 blocked/failed' }
reviews.push(await reviewLoop('A', 'Chỉ lượt L1: schema, migration A/B, SQL hoàn tác, mô hình điểm theo lô, hết hạn, gộp khách, xoá tài khoản, race spec T1-T5, T7, T15, T21. Trọng tâm R2, R3, R8, R11, R12. Chạy migration A+B trên DB trống và DB mẫu, chạy 2 lần.', 3))

const r2 = await loop(L('L2'))
if (!r2 || r2.status === 'BLOCKED') return { stage, done, reviews, stopped: 'L2 blocked/failed' }
const r3 = await loop(L('L3'))
if (!r3 || r3.status === 'BLOCKED') return { stage, done, reviews, stopped: 'L3 blocked/failed' }
reviews.push(await reviewLoop('B', 'Lượt L2 + L3: nguồn cộng, đổi khoá config, kiểm idempotent hai sổ, checkout chia lô, bỏ XU, đơn 0đ, hoàn đúng lô, đơn XU cũ, game, convert Ví->xu 410, migration C. Trọng tâm R1, R4, R5, R6, R7, R9. Soát grep: không còn đường ghi xu.', 3))

await loop(L('L4'))
await loop(L('L5'))

reviews.push(await reviewLoop('C', 'TOÀN BỘ diff PD-3 (L1..L5), lượt kiểm cuối thứ nhất: bất biến tiền end-to-end, đơn vị, FE/API còn sót xu, migration đủ chuỗi A -> config -> B -> C trên DB trống và trên DB mẫu, drift, check-partial-indexes.', 3))
reviews.push(await reviewLoop('D', 'TOÀN BỘ diff PD-3, lượt kiểm cuối thứ hai ĐỘC LẬP với lượt C (đừng tin kết luận của C): thử PHÁ — song song, lặp, số biên, đơn huỷ giữa chừng, deploy thứ tự sai, rollback; viết thêm race spec tạm (KHÔNG commit) nếu cần để chứng minh một lỗi.', 3))

return { stage, worktree: WT, branch: BR, done, reviews }
