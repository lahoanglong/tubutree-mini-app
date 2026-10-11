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

phase('Spec')
log('PD-3 giai đoạn spec: một agent opus chỉ đọc code + viết ' + SPEC_FILE)
const spec = await run(specPrompt(), { label: 'spec:PD-3', phase: 'Spec', model: 'opus', effort: 'high', schema: ITEM_SCHEMA })

return { stage: 'spec', worktree: WT, branch: BR, spec }
