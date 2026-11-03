export const meta = {
  name: 'ops-1103-fix',
  description: 'Sửa 5 gói (ops, admin, ctv, game, recycle): worker Sonnet, review Opus đối kháng tới khi đủ số lượt APPROVE',
  phases: [
    { title: 'Build', detail: 'worker Sonnet sửa trong worktree của gói' },
    { title: 'Review', detail: 'reviewer Opus đối kháng; gói tiền/điểm cần 2 lượt APPROVE liên tiếp' },
  ],
}

const ROOT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees'
const BRIEF = `${ROOT}/ops-1103-docs/docs/2026-11-03-ops-review/tools/worker-brief.md`
const FINDINGS = `${ROOT}/ops-1103-docs/docs/2026-11-03-ops-review/10-review-wf1.json`

const WORK = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Đã sửa gì, theo từng mã phát hiện' },
    commits: { type: 'array', items: { type: 'string' }, description: 'sha ngắn + tiêu đề' },
    tests: { type: 'array', items: { type: 'string' }, description: 'lệnh đã chạy + kết quả (đỏ trước sửa, xanh sau sửa)' },
    migration: { type: 'string', description: 'tên migration nếu có, hoặc "không"' },
    deviations: { type: 'string', description: 'chỗ làm khác yêu cầu và lý do' },
    open_questions: { type: 'string' },
  },
  required: ['summary', 'commits', 'tests', 'migration', 'deviations', 'open_questions'],
}

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'issue', 'fix'],
      },
    },
    checked: { type: 'string', description: 'Đã kiểm gì, chạy lệnh gì, kết quả' },
  },
  required: ['verdict', 'findings', 'checked'],
}

const PKGS = [
  {
    key: 'ops', need: 1,
    task: `GÓI ops (worktree ${ROOT}/ops-1103-ops, race 46210). Mã phát hiện: OPS-01, OPS-03, OPS-04, QTUI-01, và ghi chú "missed" của vùng ops (ZNS FAILED không lên Sức khoẻ).
1. OPS-01: token Zalo OA không làm mới được thì phải hiện trên Sức khoẻ và báo động. apps/api/src/modules/integrations/zns/zalo-oa-token.service.ts (refresh thiếu refresh_token/app_id/app_secret mà đang có access token: ghi logger.error có chữ "Zalo OA" để lượt cron thành ERRORS) và apps/api/src/modules/ops/ops-health.service.ts zaloTokenProblems (có token mà chưa có mốc hết hạn hợp lệ: trả problem key "zalo.oa_token"). Kiểm cơ chế báo động ops (ops-alerts.ts, cron health-alert) để problem mới không báo dồn dập: theo đúng cách các problem khác đang chống lặp.
2. ZNS hỏng hẳn phải thấy được: thêm chỉ số/problem trên Sức khoẻ cho số notification_logs kênh ZNS ở trạng thái FAILED trong 24 giờ gần nhất (kèm mã lỗi hay gặp nhất). Theo mẫu ngưỡng ở ops-alerts.ts (chọn ngưỡng hợp lý, ghi lý do). Thêm vào kiểu dữ liệu health ở API và hiện ở apps/web/src/components/admin/ops-health-tab.tsx.
3. OPS-03: lượt thử lại ZNS không được gửi trong giờ yên lặng: apps/api/src/modules/notifications/notifications.processor.ts (+ notifications.service.ts znsQuietDelayMs). Trước deliverZns, nếu đang trong giờ yên lặng thì dời job tới hết giờ yên lặng (BullMQ moveToDelayed + DelayedError, không tính là một lượt thử). Giữ nguyên hành vi R-181 (nhận log trước khi gửi). Test: lượt thử lại rơi vào 21:01 thì dời tới 08:00.
4. OPS-04: apps/api/src/modules/lifecycle/remarketing.service.ts: lọc giỏ đã nhắc ngay trong truy vấn (abandonRemindedAt null hoặc < updatedAt, dùng field reference của Prisma 5), thêm orderBy ổn định; sendVoucherExpiryReminders lọc coupon USER_GROUP thiếu scopeMeta.userId trong truy vấn. Test chứng minh 200 giỏ đã nhắc không chặn giỏ mới.
5. QTUI-01: màn Sức khoẻ không được báo xanh "Mọi chỉ số trong ngưỡng" khi có việc nền đang lỗi: trong ops-health-tab.tsx tính cron có consecutiveFailures > 0, đưa khối cảnh báo (tên dễ đọc của job, lỗi gần nhất, giờ) lên trên các thẻ, banner thành cảnh báo. Ở khổ < sm, bảng "Việc tự chạy nền" thành thẻ (tên, kết quả, lỗi gần nhất). Trang "Hôm nay" (ops-inbox-tab.tsx + ops-inbox.service.ts) thêm một thẻ dẫn sang Sức khoẻ khi có problem hoặc cron lỗi, nếu làm được gọn bằng dữ liệu sẵn có. Không gửi thêm email/thông báo mới cho cron (đã có OPS_CRON_FAILED). Test vitest cho banner và thẻ 375.
Không migration.`,
  },
  {
    key: 'admin', need: 2,
    task: `GÓI admin (worktree ${ROOT}/ops-1103-admin, race 46220). Mã: QTAPI-01 (tiền), QTAPI-02 (quyền), QTAPI-03, QTAPI-04, QTUI-02, QTUI-03, QTUI-04, QTUI-05, QTUI-06, QTUI-07.
1. QTAPI-01: apps/api/src/modules/admin/admin.service.ts updateCoupon: khi đổi usageLimit, trong một transaction khoá dòng coupon (SELECT ... FOR UPDATE), đếm lại CouponRedemption còn hiệu lực theo đúng cách coupons.service.ts tính, rồi ghi usageLimit và usedCount = số đếm. Không sửa coupons.service.ts (vùng 2a). Race spec: mã không giới hạn đã dùng N lượt, admin đặt Tổng lượt = N (hoặc N+1), rồi K checkout/áp mã song song thì không lượt nào vượt trần. Ghi rõ khe còn lại (giao dịch đổi mã đang bay lúc đổi trần) nếu có.
2. QTAPI-02: reviewDealerApplication duyệt người đang có RoleGrant STAFF/ADMIN: gọi rbac.revokeGrantsAbove(phone, 'DEALER') và gỡ staffPermissions như setUserRole (xem admin.service.ts:629 và test admin.service.spec.ts:534). Test.
3. QTAPI-03: getDashboardStats cod_pending loại COD của gian hàng tự giao (fulfiller <> 'MERCHANT'), cùng điều kiện REVENUE_ORDER_SQL. Test.
4. QTAPI-04: apps/api/src/modules/catalog/catalog.service.ts setSoldExternal: các dòng SKU cùng sản phẩm thì CỘNG lại rồi ghi một lần (không để dòng cuối đè); apps/web/src/lib/admin-client.ts sửa kiểu trả về cho khớp API. Test.
5. QTUI-02: apps/web/src/components/admin/notification-templates-tab.tsx: chỉ khoá nút Lưu vì thiếu mã mẫu ZNS khi kênh hoặc mã mẫu thay đổi so với bản đã lưu (khớp API notification-templates-admin.service.ts:156-161); vẫn hiện dòng nhắc dạng cảnh báo. Test.
6. QTUI-03: apps/web/src/components/admin/coupon-list.tsx "Đổi hạn đến": ô ngày có min = hôm nay giờ VN; ngày mới sớm hơn hạn hiện tại thì hỏi lại bằng confirm tone danger ("Rút ngắn hạn: mã hết hạn sớm với cả khách đã nhận"). API updateCoupon từ chối endAt đã qua (400, câu tiếng Việt gợi ý tắt mã nếu muốn dừng). Test.
7. QTUI-04: tab Giờ vàng (apps/web/src/app/admin/page.tsx FlashSalesTab/FlashSaleRow ~3150-3340): nhãn trạng thái theo thời gian (Đang chạy / Sắp chạy / Đã kết thúc, cộng Đang tắt), chip lọc mặc định chưa kết thúc, chip "Đã kết thúc"; đợt đã kết thúc ẩn form thêm món. Chỉ sửa client, không đổi API flash-sale (vùng 2a). Nếu số đợt lớn, phân trang phía client. Test.
8. QTUI-05: tạo/sửa đợt Giờ vàng dùng giờ Việt Nam (hàm của lib/admin-campaign-form.ts), kể cả khi đổ dữ liệu vào ô sửa. Test chạy với TZ khác Asia/Ho_Chi_Minh.
9. QTUI-06: apps/web/src/components/admin/waste-gifts-section.tsx bảng Danh mục quà ở khổ < sm thành thẻ (tên, giá, tồn, chip trạng thái, nút Sửa), theo mẫu waste-items-section.tsx. Test.
10. QTUI-07: apps/web/src/components/admin/commission-rates-tab.tsx: sản phẩm vừa lưu đủ % không biến mất ngay; giữ thẻ với dấu "Đã đủ %" tới khi đổi bộ lọc hoặc tải lại. Test.
Không migration. Gói có đường tiền (QTAPI-01) và quyền (QTAPI-02).`,
  },
  {
    key: 'ctv', need: 2,
    task: `GÓI ctv (worktree ${ROOT}/ops-1103-ctv, race 46230). Mã: CTV-01 (quyết định chủ: thu hồi), CTV-02, CTV-03. Đường tiền/điểm.
1. CTV-01: khi đảo hoa hồng (apps/api/src/modules/affiliate/affiliate.service.ts reverseCommissionsForOrder và nhánh cắt commissionableTotal của hoa hồng APPROVED/PAID khi trả một phần, đang ở apps/api/src/modules/orders/order-reversal.service.ts:500-547) làm doanh số đã chốt của tháng (cách tính confirmedRevenue của claimMilestone/getMilestones, xem ctv-milestones.ts) rơi dưới ngưỡng của mốc ĐÃ NHẬN thì thu hồi điểm của mốc đó trong cùng transaction: trừ điểm STANDARD theo cách hệ thống điểm đang trừ (đọc points-ledger.ts, loyalty-expiry.service.ts lotRecoverable, cách REFERRAL_* thu hồi và ghi nợ REFERRAL_DEBT trong apps/api/src/modules/wallet/referral-reward.ts, commission-wallet-reversal.ts). Thiếu số dư thì ghi nợ theo đúng cơ chế nợ điểm có sẵn. refId idempotent (vd CTV_MILESTONE_REVOKE:<claimId>), chạy lại không trừ hai lần. Mốc đã thu hồi: nếu doanh số tháng đó lên lại trên ngưỡng thì CTV nhận lại được (không cộng hai lần cho cùng một lần đạt). Báo CTV một tin (dùng mẫu thông báo có sẵn nếu hợp; nếu cần mẫu mới thì được thêm migration chỉ chèn mẫu, theo cách các migration mẫu trước làm, và cập nhật seed.ts). Được thêm migration cột (vd revokedAt trên ctv_milestone_claims) nếu cần, ghi rõ. Được sửa order-reversal.service.ts chỉ để gọi hàm thu hồi trong cùng tx (2a đã biết). Sửa chú thích ctv-milestones.ts:9-10 cho đúng. Race spec: (a) mốc 10tr đã nhận, trả đơn làm doanh số còn 8,2tr thì trừ đúng điểm mốc 10tr một lần, mốc 3tr giữ; (b) trả một phần; (c) số dư thiếu thì ghi nợ; (d) đảo song song hai đơn không trừ hai lần; (e) chạy lại idempotent.
2. CTV-02: packages/app-core/src/ctv-dashboard.ts needsTaxIdForAutoTransfer dùng withdrawTaxPreview (thuế cộng dồn tháng do API trả) khi có, payoutTax chỉ làm dự phòng; truyền thêm số này ở apps/miniapp/src/pages/affiliate.tsx (~367) và apps/web/src/app/ctv/page.tsx (~389): chỉ sửa đúng các dòng đó. Unit test ca 3tr rồi 2,5tr cùng tháng. Thêm: khi cron chuyển Ví gặp PIT_TAX_ID_REQUIRED thì báo CTV một lần mỗi tháng (dedupeKey theo CTV + tháng VN) nếu có mẫu thông báo hợp hoặc dùng chung mẫu mới của mục 1 thì không; nếu phải thêm mẫu riêng thì làm trong cùng migration mẫu ở mục 1.
3. CTV-03: requestPayout dùng cùng mốc now cho requestedAt, paidAt của payout và paidAt của commission (affiliate.service.ts ~1386-1428). Test.`,
  },
  {
    key: 'game', need: 2,
    task: `GÓI game (worktree ${ROOT}/ops-1103-game, race 46240). Mã: VX-01 (P1, quyết định chủ), VX-02. Đường điểm.
1. VX-01: apps/api/src/modules/game/season-pass.service.ts (getState ~80-84 và claim ~139): Cao cấp chỉ mở khi khách có gói định kỳ ACTIVE và ít nhất một đơn định kỳ của gói đó (hoặc của khách, nếu đơn chỉ nối với khách) đã DELIVERED. Tìm cách đơn nối với gói định kỳ trong schema (subscriptions.service.ts, Order). Một hàm dùng chung cho getState và claim; claim kiểm lại TRONG transaction cấp thưởng. Nếu có cờ bật/tắt Chặng Mùa phía cấu hình thì API claim cũng từ chối khi cờ tắt (xem ghi chú "missed" của vùng garden-points trong file phát hiện). Không sửa subscriptions.service.ts (chỉ đọc). Race/integration spec: gói hẹn ngày chưa ra đơn: từ chối; gói có đơn bị huỷ: từ chối; gói đã giao 1 đơn: cho; huỷ gói sau khi nhận không ảnh hưởng mốc đã nhận.
2. VX-02: apps/api/src/modules/game/game-quiz.service.ts answerQuiz: đếm + ghi + cộng nước trong một transaction có khoá theo user (pg_advisory_xact_lock theo user hoặc SELECT ... FOR UPDATE game_profiles); chỉ nhận quizId thuộc bộ câu hôm nay theo ngày VN (tách hàm tính bộ câu của getTodayQuiz để dùng chung). Race spec: 20 câu khác nhau gửi song song thì đúng 5 lượt được ghi và cộng nước; quizId ngoài bộ hôm nay bị từ chối với lỗi rõ ràng. Cập nhật comment "vượt trần 1-2 câu" cho đúng.
Không migration (nếu thật cần thì DỪNG, ghi open_questions).`,
  },
  {
    key: 'recycle', need: 2,
    task: `GÓI recycle (worktree ${ROOT}/ops-1103-recycle, race 46250). Mã: DR-01, DR-02, DR-03 (quyết định chủ ở brief). Đường điểm.
1. DR-01: apps/api/src/modules/waste-exchange/receiving/waste-reverse.service.ts (~120) không gọi notifier.pointsReversed khi số điểm thu được là 0. Test.
2. DR-02: hộp xác nhận Thu hồi ở apps/web/src/components/admin/waste-request-detail.tsx (~477) ghi đúng: trừ tối đa số điểm đã cộng, trong giới hạn số dư hiện có của khách (kể cả điểm của đơn còn trong hạn trả), và hiện số dư hiện tại cùng số điểm dự kiến trừ nếu API chi tiết có/thêm được rẻ (waste-admin-detail.mapper.ts). Tính "dự kiến trừ" bằng đúng hàm server dùng (lotRecoverable). Test.
3. DR-03: hạn giữ chỗ = hết ngày D giờ VN, với D = ngày VN của (lúc tạo + số ngày giữ chỗ). Sửa apps/api/src/modules/waste-exchange/core/waste-hold.service.ts (~72) và mọi chỗ khác tính expiresAt cho yêu cầu (gia hạn, đổi điểm nhận...). Rà mọi nơi đọc expiresAt: waste-expiry.cron.ts, quầy (waste-desk.service.ts lookup), tin nhắc sắp hết hạn, màn khách (chỉ đọc, KHÔNG sửa màn khách: apps/web/src/components/recycle/recycle-request.tsx ~307/429, apps/miniapp/src/pages/recycle-request.tsx ~424). Bảo đảm mọi câu hiển thị cho khách vẫn đúng nghĩa với hạn mới ("Giữ chỗ tới D" và "trước <ngày>"); nếu câu nào cần đổi ngày truyền vào thì đổi ở API/biến mẫu, còn nếu phải đổi chữ màn khách thì ghi open_questions. Yêu cầu đã tạo trước bản này giữ nguyên hạn cũ (không migration). Test: tạo 01:00 ngày 01/11 với 7 ngày thì còn mở và quét được tới 23:59 ngày 08/11, cron 03:30 ngày 09/11 đóng.
Không migration.`,
  },
]

function workerPrompt(p) {
  return `Bạn là worker sửa mã cho dự án Tubu Tree. Đọc luật chung ở ${BRIEF} trước (bắt buộc), rồi đọc các mục phát hiện của gói trong ${FINDINGS}.
${p.task}
Làm hết các mục, commit trong worktree của gói. Trả về theo schema: tóm tắt từng mã, commit, lệnh test đã chạy (đỏ trước, xanh sau), migration, chỗ làm khác yêu cầu, câu hỏi còn mở.`
}

function reviewPrompt(p, round, prevApproved) {
  return `Bạn là reviewer Opus ĐỐI KHÁNG cho gói "${p.key}" của dự án Tubu Tree (đường tiền/điểm/quyền thì soi kỹ nhất). Luật và quyết định của chủ: ${BRIEF}. Phát hiện gốc: ${FINDINGS}.
Yêu cầu của gói:
${p.task}
Xem diff: cd ${ROOT}/ops-1103-${p.key} && git log --oneline origin/main..HEAD && git diff origin/main...HEAD
${prevApproved ? 'Một reviewer trước đã APPROVE lượt trước. Bạn review ĐỘC LẬP, không tin kết luận đó; tìm cái họ bỏ sót.' : ''}
Tìm lỗi thật: sai nghiệp vụ so với yêu cầu/quyết định, race (chạy song song, nhiều instance), idempotency, transaction thiếu hoặc khoá sai, số âm/làm tròn, múi giờ VN, quyền, lộ dữ liệu, hồi quy ở chỗ gọi khác (grep), test không thật sự đỏ với mã cũ hoặc chập chờn, comment kể lại thay đổi, chữ hiển thị sai/không nhất quán, vi phạm ranh giới file vùng 2a.
Được chạy test riêng lẻ của gói (jest/vitest file liên quan; race spec trên Postgres cổng của gói theo brief). Không sửa file, không đổi git.
verdict = APPROVE chỉ khi không còn P0/P1/P2. P3 vẫn liệt kê. Lượt review thứ ${round}.`
}

function fixPrompt(p, review) {
  return `Bạn là worker sửa tiếp gói "${p.key}" của dự án Tubu Tree. Luật: ${BRIEF}. Worktree ${ROOT}/ops-1103-${p.key}.
Yêu cầu gốc của gói:
${p.task}
Reviewer Opus vừa trả CHANGES với các điểm sau (sửa hết P0/P1/P2; P3 sửa nếu rẻ và đúng, còn lại ghi lý do):
${JSON.stringify(review.findings, null, 1)}
Mỗi lỗi thật cần test đỏ trước rồi xanh. Commit. Trả theo schema.`
}

async function runPkg(p) {
  let work = await agent(workerPrompt(p), { label: `worker:${p.key}`, phase: 'Build', agentType: 'worker', schema: WORK })
  const history = [{ kind: 'work', work }]
  let approvals = 0
  let last = null
  for (let round = 1; round <= 5; round++) {
    const r = await agent(reviewPrompt(p, round, approvals > 0), { label: `review${round}:${p.key}`, phase: 'Review', agentType: 'reviewer', schema: REVIEW })
    last = r
    history.push({ kind: 'review', round, review: r })
    if (!r) break
    if (r.verdict === 'APPROVE') {
      approvals++
      log(`${p.key}: lượt ${round} APPROVE (${approvals}/${p.need})`)
      if (approvals >= p.need) break
      continue
    }
    approvals = 0
    log(`${p.key}: lượt ${round} CHANGES (${r.findings.filter((f) => f.severity !== 'P3').length} P0–P2)`)
    work = await agent(fixPrompt(p, r), { label: `fix${round}:${p.key}`, phase: 'Build', agentType: 'worker', schema: WORK })
    history.push({ kind: 'work', round, work })
  }
  return { key: p.key, need: p.need, approvals, done: approvals >= p.need, last, history }
}

const results = await parallel(PKGS.map((p) => () => runPkg(p)))
log(results.filter(Boolean).map((r) => `${r.key}: ${r.done ? 'đủ APPROVE' : 'CHƯA đủ'} (${r.approvals}/${r.need})`).join(' | '))
return results
