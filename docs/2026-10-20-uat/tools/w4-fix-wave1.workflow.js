export const meta = {
  name: 'uat-w4-fix-wave1',
  description: 'Sửa đợt 1 từ review D1–D5: 8 gói, mỗi gói worktree riêng, TDD bằng worker Sonnet, review Opus 2 lượt',
  phases: [
    { title: 'Implement', detail: 'worker Sonnet, test đỏ trước rồi sửa' },
    { title: 'Review', detail: 'reviewer Opus lượt 1' },
    { title: 'Fix', detail: 'worker sửa theo review' },
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

const PKGS = [
  {
    key: 'voucher-moc', race: 25551,
    spec: `D1-02 (P1) + phát hiện bỏ sót: voucher mốc chi tiêu (apps/api/src/modules/vouchers/vouchers.service.ts:332-389, cron milestoneVouchers) cấp từ đơn còn trong hạn đổi trả và từ đơn đại lý / đơn CTV lên hộ. Sửa: chỉ cộng đơn RETAIL, placedForCustomer=false (như voucher đơn thứ 2 ở cùng file :452-453), DELIVERED và deliveredAt <= now - returns.window_days ngày, không có return_request đang mở (REQUESTED/APPROVED chưa xong — đọc enum). Đơn tạo cuối tháng qua hạn đổi trả sang tháng sau vẫn phải được tính cho kỳ của tháng tạo đơn: cron đánh giá cả kỳ tháng trước (khoá chống trùng MILESTONE<spend>-yyyy-mm giữ nguyên nên không cấp hai lần). Giữ nguyên số tiền mốc (A7). Test đỏ trước: đơn 5.000.000đ deliveredAt = now-1 ngày → không có coupon MILESTONE*; now-8 ngày → có; đơn DEALER / placedForCustomer → không; đơn tạo 30/tháng trước giao xong, qua hạn ngày 8 tháng này → được mã kỳ tháng trước đúng một lần.`,
    files: 'apps/api/src/modules/vouchers/**',
  },
  {
    key: 'thuong-tra-hang', race: 25552,
    spec: `D1-01: thưởng đánh giá (reviews.service.ts:183,208, review-eligibility.ts) và nhiệm vụ FIRST_ORDER / REVIEW_3 (game/game.service.ts:545-650) cấp ngay khi đơn DELIVERED, trả hàng không thu hồi. Sửa an toàn, ít đổi trải nghiệm: (1) nhiệm vụ FIRST_ORDER, REVIEW_3 chỉ đếm đơn DELIVERED đã qua returns.window_days và không có yêu cầu trả đang mở (đánh giá của REVIEW_3 cũng chỉ tính khi đơn gốc thoả điều kiện đó); thẻ nhiệm vụ hiện chữ chờ hợp lý nếu đã có đơn nhưng chưa qua hạn (đọc getMissions, đừng đổi chữ Mini App nếu không cần); (2) điểm thưởng đánh giá bị thu hồi khi dòng hàng được đánh giá bị trả (trả cả đơn trong order-reversal.service.ts reverseFinancials, và trả một phần đã APPROVED đúng sản phẩm đó), dùng lại đúng logic thu hồi đang có ở reviews.service.ts remove() (cùng cách xử lý số dư không đủ như thu hồi điểm đơn), idempotent (khoá reason duy nhất). KHÔNG đổi loyalty.service.ts lockedOrderPoints. Test đỏ trước: claimMission FIRST_ORDER với đơn giao 1 ngày trước, window_days=7 → ném lỗi; đánh giá có ảnh rồi trả cả đơn → pointsBalance trở về và có dòng thu hồi; trả một phần đúng SP đã đánh giá → thu hồi; trả SP khác → không thu hồi; gọi đảo hai lần → thu hồi một lần. Thêm race spec nếu có đường đồng thời (đảo đơn chạy song song với xoá đánh giá).`,
    files: 'apps/api/src/modules/{reviews,game,orders}/** (game.service.ts, reviews.service.ts, review-eligibility.ts, order-reversal.service.ts, order-returns*.ts); KHÔNG game-economy.service.ts',
  },
  {
    key: 'flash-sale-staff', race: 25553,
    spec: `D2-01 (P1) + D2-05: nhân viên MARKETING (không phải ADMIN) dùng flash sale vượt trần mã của nhân viên (B19: tối đa 30% / 100.000đ mỗi đơn, 10 triệu đ/ngày/người, không tự dùng mã mình tạo, không sửa/bật lại mã ADMIN tạo). Áp luật tương đương cho flash sale khi actor không phải ADMIN, đọc ngưỡng từ cùng khoá coupon.staff_max_percent, coupon.staff_max_amount_vnd, coupon.staff_daily_budget_vnd (KHÔNG thêm khoá mới nếu không cần): addItem/updateItem chặn % giảm > staff_max_percent, chặn (giá gốc − flashPrice) × perUserLimit > staff_max_amount_vnd, tổng (giá gốc − flashPrice) × quota tính vào ngân sách ngày cùng cách assertStaffCouponCaps tính (đọc admin.service.ts quanh :1485 và hàm caps; nếu ngân sách ngày đang gộp mã + lô thẻ thì gộp thêm flash sale của cùng người trong ngày). Nhân viên không sửa/xoá/thêm item/bật lại sale do ADMIN tạo (như assertStaffCreatedCoupons). Người tạo sale (createdBy) mua hàng thì không được giá flash của sale đó: làm giống luật "không tự dùng mã mình tạo" (đọc chỗ coupon chặn và chữ báo lỗi, áp ở nơi checkout/pricing lấy giá flash). ADMIN không bị trần. Test đỏ trước: MARKETING thêm item giảm 50% → 400; MARKETING sửa sale của ADMIN → 403; STAFF mua item flash của sale mình tạo → không có giá flash/bị chặn đúng chữ; ADMIN thêm item 90% vẫn được; quyền ma trận staff-permissions.matrix.spec cập nhật nếu cần.`,
    files: 'apps/api/src/modules/flash-sale/**, chỗ lấy giá flash ở pricing/checkout (chỉ dòng cần thiết), apps/api/src/common/staff-permissions.matrix.spec.ts nếu cần',
  },
  {
    key: 'quyen-admin', race: 25554,
    spec: `Ba lỗi quyền: (1) D2-02 (P1): CSKH và MARKETING ghim được bài cộng đồng (apps/api/src/modules/feed/community-feed.controller.ts:317-322 có @AllowStaff), trái B8 chỉ ADMIN ghim. Sửa API thành chỉ ADMIN, cập nhật staff-permissions.matrix.spec.ts:273 và community-feed.controller.permissions.spec.ts:33 ('pin' sang ADMIN_ONLY), ẩn nút Ghim/Bỏ ghim trong apps/web/src/components/admin/community-moderation-tab.tsx:260-289 khi người xem không phải ADMIN (phiên UAT đã được giữ apps/web/src/components/admin/** trừ portal-header.tsx), thêm test web vitest cho nút. Kiểm luôn màn kiểm duyệt Mini App (apps/miniapp/src/pages/community-moderation.tsx) có nút ghim cho staff không, có thì ẩn tương tự. (2) D2-03: ops-inbox.service.ts:111-112 invoicePending không hiện cho kế toán (KE_TOAN) dù B18 cho kế toán xuất VAT; thêm KE_TOAN vào audience, sửa comment cũ, thêm khoá đếm payout đã ADMIN duyệt chờ "Đã chi" cho KE_TOAN; kiểm web admin hiện khoá mới (components/admin hoặc app/admin), thiếu chữ thì thêm. (3) D2-04: admin-order-filter.ts:249-274: viewer bị che SĐT (seesFullOrderPhones=false, vd KE_TOAN) dò lại SĐT bằng tìm chuỗi con; với viewer đó chỉ khớp chính xác SĐT đầy đủ sau chuẩn hoá. Test đỏ trước cho cả ba (canRun('pin', cskh)=false / POST pin bằng CSKH 403; inbox KE_TOAN có invoicePending; KE_TOAN tìm '0901' không ra đơn của 0901234567, tìm '0901234567' ra).`,
    files: 'apps/api/src/modules/feed/community-feed.controller*.ts, apps/api/src/common/staff-permissions.matrix.spec.ts, apps/api/src/modules/ops/**, apps/api/src/modules/admin/admin-order-filter*.ts, apps/web/src/components/admin/community-moderation-tab*.tsx, file inbox web admin, apps/miniapp/src/pages/community-moderation*.tsx',
  },
  {
    key: 'trien-khai', race: 25555,
    spec: `Sẵn sàng deploy (đọc ${DOCS}/D3-migration-deploy.md): (1) D3-01 (P1): runbook docs/launch/deploy-rollback-runbook.md bước 7b (:239, :613-641) và mục 1.6, tools/deploy/deploy.sh:217, comment đầu apps/api/prisma/seed-reference.ts:11 vẫn coi --with-business-defaults là "chờ chủ duyệt" dù A8 đã chốt chạy CÓ cờ. Sửa runbook dùng lệnh có cờ, deploy.sh thêm biến SEED_REFERENCE_ARGS mặc định "--with-business-defaults" (giữ đường tắt bỏ cờ cho DB đã có), go-live (apps/api/src/config/go-live/db-checks.ts) thêm kiểm db.membership_tiers FAIL khi trống hoặc thiếu hệ số 1/1,2/1,5/2, WARN khi dealer_tiers = 0. (2) Bỏ sót: loyalty.service.ts recalcAllTiers (~:405) chỉ quét tierId not null nên khách có đơn giao trước khi nạp hạng không bao giờ lên hạng; quét cả user tierId null có đơn DELIVERED (giới hạn lô, không quét user chưa mua). (3) D3-02: apps/api/scripts/grant-admin.js chuẩn hoá ADMIN_PHONE (+84/84 → 0, 10 số, sai thì thoát lỗi) như normalizeZaloPhone. (4) D3-03: .env.production.example thêm ZALO_OA_REFRESH_TOKEN, ZALO_OA_WEBHOOK_SECRET, AUTH_COOKIE_SAMESITE, AUTH_COOKIE_DOMAIN (trống + chú thích), thêm test: mọi khoá env.validation.ts không có default phải có trong .env.production.example. (5) D3-04: apps/api/src/config/demo-data/cleanup.ts:421 formatPlan in "GIỮ NGUYÊN (A4)" cho WELCOME30/FREESHIP/XANH10, dùng chung danh sách với go-live. (6) D3-05: số kỳ vọng ở runbook 7b (mau_tin = 122, số khoá cấu hình) lấy từ chạy thật seed-reference trên DB mới (cụm tạm cổng 25555). Test đỏ trước cho (1) go-live, (2) recalcAllTiers, (3) grant-admin, (4) env example, (5) formatPlan. Không SSH, không chạy deploy.sh thật.`,
    files: 'docs/launch/deploy-rollback-runbook.md, tools/deploy/deploy.sh (+spec), apps/api/prisma/seed-reference.ts (comment), apps/api/src/config/go-live/**, apps/api/src/config/demo-data/**, apps/api/src/modules/loyalty/loyalty.service.ts (chỉ recalcAllTiers), apps/api/scripts/grant-admin.js, .env.production.example',
  },
  {
    key: 'race-p3', race: 25556,
    spec: `Bốn lỗi đồng thời (đọc ${DOCS}/D4-race.md): (1) D4-01 pancake-order.service.ts:177-281: sau claim, quyết định tra đơn Pancake trước khi tạo phải dựa trên dữ liệu DB tại lúc claim (vd claim bằng UPDATE ... RETURNING lấy pancakePushClaimedAt/attempts cũ), không dùng lần đọc trước claim; tránh tạo 2 đơn Pancake cho 1 đơn Tubu. (2) D4-02 game-economy.service.ts checkIn ghi đè streakFreezes/streakDays từ lần đọc cũ: khoá hàng (SELECT ... FOR UPDATE trong $transaction) hoặc CAS trong WHERE + thử lại; làm cho checkIn, buyStreakFreeze, repairStreak. (3) D4-03 payroll.service.ts:172-209 recompute ghi đè tháng FINALIZED/PAID: nhánh update chỉ khi status OPEN (updateMany có điều kiện), payrollDay tương tự, hoặc advisory lock theo (staffId, year, month) cho recompute + finalize + markPaid. Đây là tiền lương: review kỹ. (4) D4-05 zalo-oa-events.processor.ts:30-46: claim sự kiện RECEIVED → PROCESSING bằng updateMany trước khi sendText, chỉ gửi khi count=1. Test đỏ trước: race spec thật (apps/api/test/integration-race) cho (1)(2)(3) trên cụm Postgres tạm cổng của gói; unit test cho (4).`,
    files: 'apps/api/src/modules/integrations/pancake/pancake-order.service*.ts, apps/api/src/modules/game/game-economy.service*.ts, apps/api/src/modules/staff/payroll/**, apps/api/src/modules/integrations/zalo-oa/zalo-oa-events.processor*.ts, apps/api/test/integration-race/<file mới>',
  },
  {
    key: 'zns', race: 25557,
    spec: `Tin ZNS (đọc ${DOCS}/D5-tin-nhan-khach.md): (1) D5-01 (P1): apps/api/src/modules/integrations/zns/zns.client.ts:47 gửi SĐT dạng 0xxxxxxxxx; ví dụ chính thức của Zalo ZNS dùng 84xxxxxxxxx. Đổi 0+9 số thành 84+9 số ngay trước khi gửi, số đã 84 giữ nguyên, giữ số gốc cho log/maskPhone; cập nhật ghi chú giả định ở docs/launch/pilot-order-playbook.md:217. (2) D5-02: luật đã chốt (03-cau-hoi-sang Nhóm C): tin hậu mãi tối đa 2 tin/khách/tháng; thêm giờ yên tĩnh. Làm ở lớp dispatch ZNS (notifications.service.ts, in-app KHÔNG đổi): ZNS ngoài khung 08:00–21:00 giờ VN thì làm trễ job (BullMQ delay) tới 08:00, không bỏ; với nhóm mã khuyến mãi/hậu mãi (dùng đúng danh sách mẫu khuyến mãi mà marketing được sửa, đã có trong code, grep danh sách 24 mẫu) đếm ZNS theo user theo tháng VN từ notification_logs (PENDING/RETRYING/SENT), đủ 2 thì bỏ kênh ZNS (in-app vẫn gửi). Khung giờ và trần đọc từ SystemConfig mới (vd notifications.zns_quiet_start_hour=21, notifications.zns_quiet_end_hour=8, notifications.zns_promo_monthly_cap=2) thêm vào seed.ts SYSTEM_CONFIGS + reference-data đúng quy ước repo, rồi chạy npx jest prisma/reference-data src/modules/system-config. (3) D5-04: GROUP_BUY_SUCCESS (groupbuy.service.ts:223) gửi thêm product (tên SP), code (mã coupon), expires (formatVnDate); viết bảng tham số cho 3 mẫu ZNS đã chốt (REVIEW_REQUEST, GROUP_BUY_SUCCESS, GROUP_BUY_FAILED: khoá → ý nghĩa → ví dụ) ở docs/GO-LIVE-KEYS.md mục ZNS, sửa chỗ tài liệu còn hướng ORDER_CONFIRMED/ORDER_SHIPPING cho đúng quyết định. (4) D4-04: groupbuy.service.ts:77-105 giới hạn số nhóm mở mỗi người đếm ngoài transaction: count + create trong $transaction có pg_advisory_xact_lock theo user. Test đỏ trước: zns sendTemplate('0910087109') gửi 84910087109; notify REORDER_REMINDER lúc 02:00 VN → job ZNS delay > 0; tin khuyến mãi thứ 3 trong tháng không có log ZNS, có INAPP; grantAllMembers có product/code/expires; race spec 10 lần tạo nhóm song song → đúng max_open_per_user.`,
    files: 'apps/api/src/modules/integrations/zns/**, apps/api/src/modules/notifications/notifications.service*.ts, apps/api/src/modules/groupbuy/groupbuy.service*.ts, apps/api/prisma/seed.ts (chỉ SYSTEM_CONFIGS), reference-data, docs/GO-LIVE-KEYS.md, docs/launch/pilot-order-playbook.md, apps/api/test/integration-race/<file mới>',
  },
  {
    key: 'tin-cong-dong', race: 25558,
    spec: `Tin cộng đồng/game/cashback (đọc ${DOCS}/D5-tin-nhan-khach.md): (1) D5-03: tin COMMUNITY_BEST_ANSWER hứa Điểm Xanh dù không cộng (chạm trần ngày community.daily_best_answer_cap, thưởng 0, lỗi grant): rewardWithDailyCap/rewardBestAnswer (community-reward.service.ts:67,115-121) trả boolean; selectBestAnswer (community-feed.service.ts:969-990) truyền {reward_note} vào mẫu (" Bạn nhận thêm X Điểm Xanh thưởng." khi đã cộng, "" khi chưa); sửa nội dung mẫu ở apps/api/prisma/seed.ts NOTIFICATION_TEMPLATES (mẫu thành "...hay nhất! 🌿{{reward_note}}"), kiểm renderer bỏ biến rỗng đúng; pickWinner (:1471-1482) chỉ nói thưởng khi rewardEventWinner không lỗi. (2) D5-06 (theo luật nhóm C: tin thích/bình luận dùng chung công tắc Vườn Xanh, gộp tối đa 1 tin mỗi bài mỗi 60 phút): đưa GAME_WATER_GIFT và COMMUNITY_NEW_ANSWER vào nhóm GARDEN (notification-categories.ts:24); COMMUNITY_NEW_ANSWER gộp theo bài 60 phút (dedupeKey + dedupeWithinMs như LIKED/COMMENTED). (3) D5-07: cashback.service.ts:333-350 không gửi CASHBACK_PAID khi userReward = 0. Test đỏ trước cho từng mục (notification-prefs.spec, community spec, cashback spec).`,
    files: 'apps/api/src/modules/feed/community-feed.service*.ts, apps/api/src/modules/feed/community-reward.service*.ts, apps/api/src/modules/notifications/notification-categories*.ts (+ prefs spec), apps/api/src/modules/game/game-gift.service*.ts nếu cần, apps/api/src/modules/cashback/cashback.service*.ts, apps/api/prisma/seed.ts (chỉ NOTIFICATION_TEMPLATES)',
  },
]

const WORKER = (p) => `Đọc ${BRIEF} trước (luật cứng, quyết định đã chốt). Bạn sửa MỘT gói: "${p.key}".

Chuẩn bị (đúng thứ tự):
  export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
  cd ${ROOT} && git worktree add -b uat/${p.key} .claude/worktrees/uat-${p.key} ${BASE}
  cd ${ROOT}/.claude/worktrees/uat-${p.key} && pnpm install --prefer-offline && pnpm --filter @tubutree/shared-types build && (cd apps/api && npx prisma generate)
Chỉ làm việc trong ${ROOT}/.claude/worktrees/uat-${p.key}. Không đụng worktree khác, không đụng ${UAT} (đang chạy UAT).

Việc cần sửa:
${p.spec}

Vùng file được sửa: ${p.files}. Sửa ngoài vùng này chỉ khi bắt buộc, và ghi lý do trong decisions. Không sửa apps/web/src ngoài components/admin và app/admin (trừ components/admin/portal-header.tsx).

Cách làm (TDD, bắt buộc):
1. Đọc mã và báo cáo nguồn. Viết test đỏ TRƯỚC trên mã cũ, chạy, chép output fail (tên test + lý do fail đúng lỗi, không phải lỗi biên dịch) vào trường red.
2. Sửa mã tối thiểu cho xanh. Comment chỉ giải thích "vì sao", không kể lại thay đổi. Không làm rộng phạm vi.
3. Kiểm: cd apps/api && npx tsc --noEmit; npx jest <thư mục module đã đụng> (không chạy jest toàn bộ); npx eslint <file đã sửa> --max-warnings=0. Đụng web: cd apps/web && npx tsc --noEmit && npx vitest run <file>. Đụng miniapp: cd apps/miniapp && npx tsc --noEmit && npx vitest run <file> (và TZ=UTC nếu có ngày giờ). Thêm khoá SystemConfig: cd apps/api && npx jest prisma/reference-data src/modules/system-config. Race spec: dựng cụm riêng ${UAT}/docs/2026-10-20-uat/tools/pg-native.sh start ${p.race} && ${UAT}/docs/2026-10-20-uat/tools/pg-native.sh createdb ${p.race} tubutree_it, DATABASE_URL=postgresql://tubu@127.0.0.1:${p.race}/tubutree_it?schema=public npx prisma migrate deploy, rồi npx jest -c test/integration-race/jest.config.js --runInBand <file>; xong thì pg-native.sh stop ${p.race}. Đổi schema Prisma thì tạo migration đúng quy ước repo (prisma migrate dev --create-only trên cụm riêng) và chạy prisma generate.
4. Commit trong nhánh uat/${p.key} (có thể nhiều commit), message tiếng Việt theo lịch sử repo (vd "fix(vouchers): ..."), cuối message: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Không push.
5. Gặp chỗ phải quyết mà luật chưa chốt: chọn phương án an toàn, đảo ngược được (ít mất tiền nhất, dễ tắt bằng cấu hình), ghi vào decisions dạng "chọn X vì Y; câu hỏi cho chủ: ...; phương án khác: ...".
Máy dùng chung: trước lệnh nặng xem uptime, load > 40 thì chờ. Kill chỉ PID mình.`

const REVIEWER = (p, impl, round) => `Đọc ${BRIEF} trước. Review lượt ${round} gói "${p.key}" trước khi gộp vào ${BASE}. Worktree ${impl.worktree}, nhánh ${impl.branch}. Xem diff: cd ${impl.worktree} && git diff ${BASE}...HEAD. Yêu cầu gốc của gói:\n${p.spec}\n\nBáo cáo của worker:\n${JSON.stringify(impl)}\n\nCố chứng minh bản sửa SAI hoặc THIẾU: lỗi gốc còn đường khác lọt qua? test đỏ có thật sự đỏ trên mã cũ (tự kiểm: git stash không được dùng; thay vào đó checkout file mã cũ sang thư mục tạm hoặc đọc lý luận)? bản sửa làm hỏng luồng khác (gọi các nơi dùng hàm đã đổi)? trái luật đã chốt? đồng thời/idempotency? migration/khoá cấu hình đúng quy ước? chữ hiển thị tiếng Việt đúng thuật ngữ? comment kể lại thay đổi (cấm)? Tự chạy lại test của gói (npx jest <file spec của gói>, tsc) và ghi output vào testsRerun. Không sửa file. ok=true chỉ khi không còn lỗi P0/P1/P2.`

const FIXER = (p, impl, rev) => `Đọc ${BRIEF} trước. Gói "${p.key}", worktree ${impl.worktree}, nhánh ${impl.branch}. Reviewer Opus báo các lỗi sau, sửa hết lỗi P0/P1/P2 (P3 sửa nếu rẻ), theo TDD (test đỏ trước cho lỗi hành vi), chạy lại kiểm như lần đầu (tsc, jest module, eslint file sửa, race spec nếu có, cụm Postgres cổng ${p.race}), commit thêm (không amend, không push), cuối message Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>. Lỗi nào không đồng ý thì ghi lý do trong decisions thay vì sửa.\n\nYêu cầu gốc:\n${p.spec}\n\nReview:\n${JSON.stringify(rev)}`

const results = await pipeline(
  PKGS,
  (p) => agent(WORKER(p), { label: `impl:${p.key}`, phase: 'Implement', agentType: 'worker', effort: 'high', schema: IMPL }),
  (impl, p) => impl && agent(REVIEWER(p, impl, 1), { label: `rev1:${p.key}`, phase: 'Review', agentType: 'reviewer', schema: REVIEW })
    .then((rev1) => ({ impl, rev1 })),
  (s, p) => {
    if (!s) return null
    if (s.rev1 && s.rev1.ok && !s.rev1.issues.some((i) => i.severity !== 'P3')) return { ...s, fix: null }
    return agent(FIXER(p, s.impl, s.rev1), { label: `fix:${p.key}`, phase: 'Fix', agentType: 'worker', effort: 'high', schema: IMPL })
      .then((fix) => ({ ...s, fix }))
  },
  (s, p) => {
    if (!s) return null
    const last = s.fix ?? s.impl
    return agent(REVIEWER(p, last, 2), { label: `rev2:${p.key}`, phase: 'Review2', agentType: 'reviewer', schema: REVIEW })
      .then((rev2) => ({ key: p.key, ...s, rev2 }))
  },
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  branch: r.impl.branch,
  commits: (r.fix ?? r.impl).commits,
  rev1ok: r.rev1?.ok, rev1issues: r.rev1?.issues?.length,
  fixed: !!r.fix,
  rev2ok: r.rev2?.ok, rev2issues: r.rev2?.issues,
  decisions: [...(r.impl.decisions ?? []), ...((r.fix?.decisions) ?? [])],
  skipped: [...(r.impl.skipped ?? []), ...((r.fix?.skipped) ?? [])],
}))
