export const meta = {
  name: 'uat-w8-fix-wave4a',
  description: 'Sửa đợt 4a: 5 gói API + tài liệu không đụng file đợt 3 (hoàn sau huỷ, mua chung, tài liệu deploy, P3 thưởng/tin, P3 nhân viên), TDD worker Sonnet, review Opus 2 lượt',
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

const PKGS = [
  {
    key: 'don-sau-huy', race: 25581,
    spec: `Đọc ${DOCS}/D12-vong-doi-don.md mục D12-02 (P2, tiền/điểm). Sau khi tx CANCELLED/RETURNED commit, lỗi ở loyalty.reverseOrderPoints hoặc reverseCommissionsForOrder (P2024, đứt kết nối, SIGTERM) làm bỏ qua phần sau của setStatus (apps/api/src/modules/orders/order-status.service.ts:364-389: hoàn hoa hồng, refundReportedUnderpayment, enqueueGomdonCancel, pancakeHooks.afterLocalCancel, báo merchant, báo khách). Lần thử lại thoát sớm ở :195-204 vì status đã CANCELLED. Khách mất vĩnh viễn điểm STANDARD đã dùng; đơn Pancake DEFERRED không bao giờ được xếp lệnh huỷ. Sửa theo đề xuất trong báo cáo: (1) chuyển khoản hoàn điểm STANDARD đã dùng vào tx của reverseFinancials (như refundConvertedPoints), idempotent theo reason; (2) các hiệu ứng sau commit phải chạy lại được khi đơn đã ở trạng thái cuối (vd nhánh "resync hiệu ứng huỷ" giống nhánh DELIVERED, hoặc mỗi bước tự idempotent và lỗi bước này không chặn bước sau), kèm log/cảnh báo khi bước lỗi. Test: jest cho ca reverseOrderPoints ném lỗi rồi thử lại → điểm hoàn đủ một lần, afterLocalCancel và tin khách chạy đúng một lần; race spec trên Postgres thật nếu đụng transaction. Kèm P3 từ ${DOCS}/impl/dot2.md (gói pancake-hoan-cod, mục còn lại): order-status.service.ts:344-349 + :662-669 settleClosedOrderAlerts có thể xoá lý do ATTENTION_COD_RETURN_UNVERIFIED vừa ghi; sửa để lý do COD giữ tới khi Kế toán xử lý.`,
    files: 'apps/api/src/modules/orders/order-status.service*.ts, apps/api/src/modules/orders/order-reversal.service*.ts, apps/api/src/modules/loyalty/loyalty.service*.ts (chỉ reverseOrderPoints), apps/api/src/modules/integrations/pancake/pancake-sync-hooks*.ts, pancake-push-reconcile*.ts, apps/api/test/integration-race/** (spec mới)',
  },
  {
    key: 'mua-chung', race: 25582,
    spec: `Đọc ${DOCS}/D11-tien-don-si-dinh-ky.md mục D11-05 (P3, tiền). Mã mua chung tính 15% trên giá sản phẩm (= giá biến thể rẻ nhất) ở apps/api/src/modules/groupbuy/groupbuy.service.ts:88-89, :205, :390-402 và coupons/coupons.service.ts:86-95: biến thể 430.000đ chỉ giảm 18.000đ (4,2%) trong khi trang nhóm ghi 15%. Chọn cách ít đổi luật nhất và không cho giảm quá 15% của giá thật: ưu tiên cấp mã PERCENT theo groupbuy.discount_pct có maxDiscount = 15% giá biến thể đắt nhất của sản phẩm và chỉ áp cho sản phẩm đó (hoặc nhóm theo biến thể nếu mã hiện có đã hỗ trợ). Không đổi % đã chốt. Test đỏ trước: 'sản phẩm 2 biến thể 120k/430k → mua biến thể 430k được giảm 64.500đ'. Kiểm chữ hiển thị trang nhóm (Mini App apps/miniapp/src/pages/group-buy*.tsx nếu có) vẫn đúng. Không đụng file khác ngoài vùng.`,
    files: 'apps/api/src/modules/groupbuy/**, apps/api/src/modules/coupons/coupons.service*.ts (chỉ nhánh mã mua chung), apps/miniapp/src/pages/group-buy*.tsx (chỉ chữ nếu cần)',
  },
  {
    key: 'tai-lieu-deploy', race: 25583,
    spec: `Đọc ${DOCS}/D10-docker-env.md và sửa D10-02, D10-03, D10-04, D10-05, D10-06, D10-07, D10-08, D10-10 (a)-(d) (mục (e) cần chủ quyết: chỉ ghi vào decisions, không đổi). Không đụng D10-09 (chủ đã chốt để sau ra mắt). Không đổi mã nghiệp vụ. D10-03: mẫu sinh mật khẩu phải an toàn cho URL (vd openssl rand -hex 24) và tài liệu nói rõ. D10-07: thêm r11, lr_reports_source_indexes, lr_orders_filter_indexes vào HEAVY_MIGRATIONS ở apps/api/src/config/go-live/db-checks.ts kèm test. Kèm các P3 tài liệu: (1) docs/launch/deploy-rollback-runbook.md:655 bước 7c còn gọi WELCOME30/FREESHIP/XANH10 là 'chưa duyệt' (đã chốt giữ, xem 00-brief); (2) runbook :19, :609, :902 đếm tập migration: đêm nay thêm 3 migration mới (20261020010000_waste_item_warehouse_only, 20261020100000_best_answer_reward_note_template, 20261020100000_review_return_reversal) — đếm lại bằng ls apps/api/prisma/migrations và cập nhật, đồng bộ IMAGE_COMPATIBLE/danh sách trong db-checks.ts nếu có; (3) docs/launch/pilot-order-playbook.md:213-216 nói ZNS tới trong 1-2 phút: thêm giờ yên tĩnh 08:00-21:00 (khoá notifications.zns_*); (4) apps/api/src/config/grant-admin.spec.ts:147 comment sai sau guard require.main. Chạy lint:vars sau khi đổi .env mẫu.`,
    files: 'docs/** (trừ docs/2026-10-19-web-parity/** và docs/2026-10-20-uat/**), docker-compose*.yml, .env*.example, apps/api/.env.example, apps/web/.env.example, .github/workflows/ops.yml, tools/db/*.sh, apps/api/src/config/go-live/** (+ spec), apps/api/src/config/env.validation.ts (chỉ nếu D10-10 cần), apps/api/src/config/grant-admin.spec.ts',
  },
  {
    key: 'p3-thuong-tin', race: 25584,
    spec: `Sửa các P3 còn lại sau review (đọc chi tiết ở ${DOCS}/impl/dot1.md, gói thuong-tra-hang, zns, tin-cong-dong, quyen-admin): (1) apps/api/src/modules/reviews/reviews.service.ts:247-257 rewardAlreadyKept không tính dòng REVIEW_RETURN:<reviewId>; (2) reviews.service.ts:94 canReview.rewardAvailable không xét sản phẩm đã có dòng trả APPROVED (chỉ sửa API; Mini App reviews-section.tsx KHÔNG sửa ở gói này); (3) reviews.service.ts:457 FOR SHARE có thể deadlock với gộp phiên khách auth.service.ts:521 — sửa thứ tự khoá hoặc bỏ khoá thừa, có race spec; (4) apps/api/src/modules/game/game.service.ts:38 MISSION_WAITING_NOTE sai chữ khi đơn qua hạn nhưng còn yêu cầu trả REQUESTED; (5) apps/api/src/modules/notifications/notifications.service.ts:196-214 quietDelayMs() đọc SystemConfig ngoài try/catch sau khi log PENDING đã ghi — lỗi DB làm log kẹt PENDING; (6) notifications.service.ts:253/:211 trần 2 tin/tháng tính theo sentAt lúc tạo trong khi tin giờ yên tĩnh tới tay khách hôm sau — chọn cách an toàn (tính theo tháng của thời điểm giao dự kiến) và ghi decisions; KHÔNG đổi việc REVIEW_REQUEST có thuộc MARKETING_TEMPLATE_CODES hay không (chờ chủ, chỉ ghi decisions); (7) mô tả admin của community.author_notify_interval_minutes lệch (seed.ts:108, system-config.service.ts:104, migration 20261018100100) — chỉ sửa mô tả ở seed/system-config, không sửa migration cũ; (8) apps/api/src/modules/ops/ops-inbox.service.ts:100 dealerClaims chỉ đếm PENDING, thưởng đại lý đã duyệt chờ chi không có ai thấy — làm như payoutsToPay (audience KE_TOAN, trạng thái APPROVED) chỉ khi dealer-admin.controller.ts:49-53 cho kế toán bấm chi; nếu không thì ghi decisions. Thêm khoá InboxKey mới thì KHÔNG sửa apps/web (đợt sau làm), ghi tên khoá vào decisions.`,
    files: 'apps/api/src/modules/reviews/**, apps/api/src/modules/game/game.service*.ts, apps/api/src/modules/notifications/notifications.service*.ts, apps/api/src/modules/ops/ops-inbox.service*.ts, apps/api/src/modules/system-config/system-config.service.ts (chỉ mô tả), apps/api/prisma/seed.ts (chỉ mô tả), apps/api/test/integration-race/** (spec mới hoặc spec ops-health)',
  },
  {
    key: 'p3-nhan-vien', race: 25585,
    spec: `Sửa P3 còn lại (chi tiết ở ${DOCS}/impl/dot1.md, gói flash-sale-staff và race-p3): (1) apps/api/src/modules/flash-sale/flash-sale.service.ts:436 trần 100.000đ của nhân viên xét theo từng dòng, không theo đơn — một đơn mua 10 dòng của sale nhân viên được giảm 10 × 100.000đ; xét tổng giảm của các dòng flash sale do nhân viên tạo trong một đơn ≤ 100.000đ (B19), chặn đúng chữ tiếng Việt; (2) flash-sale.service.ts:310-315 + apps/api/src/modules/admin/coupon-input-rules.ts:163-169: dòng ADMIN thêm vào sale của nhân viên bị tính vào ngân sách 10 triệu/ngày của nhân viên và bị áp trần nhân viên — tách theo người tạo dòng nếu schema có, không có thì ghi decisions và giữ an toàn; (3) flash-sale.service.ts:122, :151-180: người tạo sale bị bỏ giá flash im lặng — trả cờ/lý do để Mini App hiện 'Bạn tạo sale này nên không mua được giá flash' (chỉ API trả lý do; chữ ở Mini App ghi decisions để đợt sau làm); (4) apps/api/src/modules/staff/payroll/payroll.service.ts:405-416 reopen chạy updateMany ngoài withMonthLock — đưa vào khoá, có race spec 'Mở lại' vs 'Đã chi'; (5) shifts.service.ts:226-236, attendance.service.ts:232 (sweep OUT_OF_RANGE), check-in/check-out ghi dữ liệu tính lương ngoài khoá tháng và không kiểm tháng đã chốt — đưa qua writeInMonth hoặc chặn khi tháng FINALIZED/PAID; (6) payroll.service.ts:111 recomputeDay không còn nơi gọi: xoá nếu chỉ còn spec dùng; (7) comment lệch ở attendance.service.ts:327,337,357,380 và payroll.service.ts:373-375. Hai nhân viên tạo mã cho nhau (flash-sale.service.ts:118-122, admin.service.ts:1485, coupon-scope.ts:28-29): KHÔNG sửa, chỉ ghi decisions (cần chủ quyết).`,
    files: 'apps/api/src/modules/flash-sale/** , apps/api/src/modules/admin/coupon-input-rules*.ts, apps/api/src/modules/staff/**, apps/api/test/integration-race/** (spec mới)',
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
